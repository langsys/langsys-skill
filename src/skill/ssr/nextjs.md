# SSR — Next.js (App Router & Pages Router) / Remix

Read [integrate/react.md](../integrate/react.md) first. This adds the server half.

> **Decide the rendering mode first: [core/rendering-mode.md](../core/rendering-mode.md).**
> Public site → SSR; app behind a login → client-only with a ready gate, and skip this track.
>
> **Know what SSR does and does not give you here.** `t()`, `<Phrase>` and `<Translate>`
> render the **base language** during server rendering — `init()` runs in a client-only
> hook, so the catalog is never populated on the server, and seeding does not change that.
> This track buys one catalog fetch instead of two, no flash after hydration, and a
> *current* catalog per request. For text a crawler or a social scraper must read,
> resolve it from the fetched catalog directly — see
> [core/rendering-mode.md](../core/rendering-mode.md#resolve-crawler-visible-text-through-a-pure-catalog-function).

## The problem

Without seeding, the client fetches the catalog after hydration and re-renders — a flash of the base language, and two fetches for one page.

## The solution

Fetch the catalog on the server, pass it to the client, seed it through `initialTranslations`.

**What seeding does not do is translate the server render.** The server HTML carries base-language body copy either way; seeding removes the *flash* and the second fetch. Text that must be translated in the served HTML has to be resolved from the catalog directly — see §"Crawler-visible text" below.

---

## App Router

### 1. Server-side fetch

```ts
// src/lib/langsys-server.ts
import 'server-only';
import { LangsysAppAPI } from 'langsys-js-react';

export async function fetchTranslations(locale: string) {
    const res = await fetch(
        `https://api.langsys.dev/api/translations?project_id=${process.env.LANGSYS_PROJECT_ID}&locale=${locale}`,
        {
            headers: { 'X-API-KEY': process.env.LANGSYS_API_KEY! },
            next: { revalidate: 300 },   // cache — do not refetch per request
        },
    );
    if (!res.ok) return null;
    return (await res.json())?.data ?? null;
}
```

Note the env vars are **unprefixed** — this runs only on the server, so the key never enters the client bundle. That is strictly better than `NEXT_PUBLIC_`.

### 2. Seed in the root layout

```tsx
// src/app/layout.tsx
import { headers } from 'next/headers';
import { fetchTranslations } from '@/lib/langsys-server';
import { LangsysProvider } from './LangsysProvider';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const accept = (await headers()).get('accept-language');
    const supported = ['en-US', 'es-ES', 'fr-FR'];

    // Two failure modes: undetectable → false; detected-but-unsupported →
    // the user's top preference. So `|| 'en-US'` alone is NOT enough.
    const detected = detectFromHeader(accept, supported);
    const locale = detected && supported.includes(detected) ? detected : 'en-US';

    const initialTranslations = await fetchTranslations(locale);

    return (
        <html lang={locale}>
            <body>
                <LangsysProvider
                    locale={locale}
                    initialTranslations={initialTranslations}
                >
                    {children}
                </LangsysProvider>
            </body>
        </html>
    );
}
```

### 3. Client provider

```tsx
'use client';
// src/app/LangsysProvider.tsx
import { useEffect, useState, type ReactNode } from 'react';
import { LangsysApp, useLocaleStore } from 'langsys-js-react';

export function LangsysProvider({
    locale, initialTranslations, children,
}: { locale: string; initialTranslations: any; children: ReactNode }) {
    const [, , localeStore] = useLocaleStore(locale);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        LangsysApp.init({
            projectid: process.env.NEXT_PUBLIC_LANGSYS_PROJECT_ID!,
            key: process.env.NEXT_PUBLIC_LANGSYS_API_KEY!,   // READ-ONLY in production
            UserLocaleStore: localeStore,
            baseLocale: 'en-US',
            initialTranslations,             // ← both required
            initialTranslationsLocale: locale,
            ssrTokenStrategy: 'client',
        }).then((res) => setReady(res.status));
    }, [localeStore, initialTranslations, locale]);

    if (!ready) return <>{children}</>;   // seeded markup is already correct
    return <>{children}</>;
}
```

> **Do not gate rendering on `ready` when seeding.** The server already produced translated markup; blocking would replace correct content with a spinner. Gate only in client-only apps.

---

## Pages Router

```tsx
// pages/_app.tsx
export default function App({ Component, pageProps }: AppProps) {
    const [, , localeStore] = useLocaleStore(pageProps.locale ?? 'en-US');
    useEffect(() => {
        LangsysApp.init({
            projectid: process.env.NEXT_PUBLIC_LANGSYS_PROJECT_ID!,
            key: process.env.NEXT_PUBLIC_LANGSYS_API_KEY!,
            UserLocaleStore: localeStore,
            baseLocale: 'en-US',
            initialTranslations: pageProps.initialTranslations,
            initialTranslationsLocale: pageProps.locale,
        });
    }, [localeStore, pageProps.initialTranslations, pageProps.locale]);
    return <Component {...pageProps} />;
}
```

```ts
import { LangsysApp } from 'langsys-js-react';

// YOUR PROJECT'S locales — not getLocalesFlat(), which is the global CLDR list.
const OFFERED = ['en-US', 'es-CR', 'fr-FR'];
const BASE = 'en-US';

export const getServerSideProps: GetServerSideProps = async ({ req }) => {
    // Resolves language -> region: 'es' becomes 'es-CR', 'fr-CA' becomes 'fr-FR'.
    const detected = LangsysApp.detectPreferredLocale(req.headers['accept-language'], OFFERED);
    // MUST be validated: on no match it returns the visitor's own tag unchanged.
    const locale = detected && OFFERED.includes(detected) ? detected : BASE;

    return { props: { locale, initialTranslations: await fetchTranslations(locale) } };
};
```

**Validate `detectPreferredLocale`'s output — always.** Verified by executing `langsys-js-typescript@0.6.5`:

```
detectPreferredLocale('es',  OFFERED)  ->  'es-CR'   resolved
detectPreferredLocale('de',  OFFERED)  ->  'de'      NOT in your list
detectPreferredLocale('!!!', OFFERED)  ->  '!!!'     not even a locale
```

On no match it returns the visitor's tag unchanged — not `false`, not your base locale — and it does not validate its input. Storing that gives you a locale with no catalog: the catalog request 422s with *"The locale provided is not a base or target locale for this project"*, and `getTranslations()` logs that **only** under `debug: true`. Empty catalog, clean console.

> **`supportedLocales` must be your project's locale list.** Built from `LangsysApp.getLocalesFlat()` it is the ~573-entry global CLDR list, against which nearly any `Accept-Language` "matches" — so the helper confidently returns `de-de` and every catalog fetch 422s.

Return them from **every** page that renders translated content, or use `getInitialProps` in `_app` to do it once.

## Remix

Same shape: fetch in the root `loader`, read with `useLoaderData()`, pass to `init`.

## `ssrTokenStrategy`

| Value | Behavior |
|---|---|
| `'client'` *(default)* | Tokens found during SSR flush from the client after hydration. Best performance |
| `'server'` | Sent during SSR. Use when registration must not depend on hydration |
| `'auto'` | ≤5 from the server, larger batches from the client |

Only meaningful with a write key — i.e. in development.

## What seeding actually does — three verified behaviors

All three checked against the published `langsys-js-typescript@0.6.5`:

- **Both parameters, or nothing happens.** The guard is `if (initialTranslations && initialTranslationsLocale)` with no `else` and no warning. Pass one alone and it is ignored with **zero diagnostics** — visible only under `debug: true`.
- **`init()` mutates the object you pass it.** It writes a `__category__` key into every category and adds `__uncategorized__` if absent. That object is your server payload — do not hand it something frozen or shared.
- **The seeded no-refetch window is 60 seconds, not permanent.** A long-lived session that re-settles on the same locale later *will* fetch again. Correct behavior, surprising in a network tab.

> **`init()` must not run during server rendering — and the reason is not `document is not defined`.** `LangsysApp` is a hard module singleton whose catalog lives in module globals. Under a long-lived Node server, one process serves every concurrent request, so server-side init is a **cross-request data race**: an in-flight `/de` render can observe `/it`'s catalog. Constructing your own `Translations` does not escape it — its constructor subscribes to the same globals. **A `typeof window` guard does not make server-side init safe.**

## Crawler-visible text

Because the reactive primitives are inert during SSR, anything a crawler or a social scraper must read has to come from the fetched catalog directly. It is a pure lookup, so none of the singleton's problems apply:

```ts
import { interpolate } from 'langsys-js-typescript';

// One request's catalog + locale in, a TFunction-shaped translator out.
// Mirrors the SDK's buildTFn minus missing-token harvesting.
const makeCatalogT = (catalog, locale) => (phrase, ...rest) => {
    const category = typeof rest[0] === 'string' ? rest[0] : '';
    const params   = typeof rest[0] === 'object' ? rest[0] : rest[1];
    const value    = catalog?.[category || '__uncategorized__']?.[phrase];
    // A content block is an OBJECT — `|| phrase` would not fall back correctly.
    const translated = typeof value === 'string' && value.length > 0 ? value : phrase;
    return params ? interpolate(translated, params, locale) : translated;
};
```

**Do not shorten this to `catalog[cat]?.[phrase] || phrase`.** That drops interpolation, so `t('Hello {name}', { name })` server-renders the literal `Hello {name}` and ICU forms render as raw source — then interpolate correctly on the client, producing a hydration mismatch on exactly the strings that carry data. Pass the **request's** locale, never the SDK's `currentlyLoadedLocale`.

> **Server-only phrases do not self-register.** Harvesting lives inside `t()`; a pure translator deliberately omits it. A phrase that renders only server-side is never discovered — register it by exercising it once client-side in development, or add it in the Translation Manager.

Use `makeCatalogT(catalog, locale)` for `<title>`, `<meta name="description">`, Open Graph and Twitter fields, `<h1>`, and any copy you actually want indexed. Use the reactive primitives for interactive UI.

**Social scrapers never run your JavaScript at all** — Facebook, Slack, LinkedIn and iMessage read the served HTML once and stop. For those, the server-resolved head is the only thing they will ever see.

## Common failures

| Symptom | Cause |
|---|---|
| Flash of untranslated content | `initialTranslations` not passed, or passed without `initialTranslationsLocale` |
| Two catalog requests per page load | Seeding missing; the client refetches what the server already had |
| Hydration mismatch | Server and client resolved different locales — resolve once on the server and pass it down |
| Works in dev, not in prod | Write key in dev vs read-only in prod, and the phrase was never registered. Exercise it in dev first |
| Key visible in the client bundle | Server-only fetch should use unprefixed env vars |
| Body copy is base language in `curl` output | **Expected** — `t()` is inert during SSR. Verify in a browser |
| Head/meta is base language | Using `t()` for head fields; use the pure catalog lookup |
| Wrong locale served under load | `init()` called during SSR — module globals raced across requests |
| Catalog request 422s: "not a base or target locale" | A bare `es` where the project offers `es-CR`, or `supportedLocales` built from the global CLDR list |
| Empty catalog, nothing in the console | The 422 above — logged **only** under `debug: true` |

## Checklist

- [ ] Server fetch uses **unprefixed** env vars
- [ ] Locale resolved **once** on the server and passed down
- [ ] `supportedLocales` is the **project's** locale list, not `getLocalesFlat()`
- [ ] `detectPreferredLocale`'s result validated against that list before use
- [ ] Both `initialTranslations` and `initialTranslationsLocale` passed
- [ ] Locale fallback uses the explicit guard, not `|| 'en-US'`
- [ ] Rendering **not** gated on `ready` when seeded
- [ ] Network tab shows one catalog request, not two
- [ ] Crawler-visible strings resolved from the catalog, not `t()`
- [ ] `init()` never runs during server rendering
- [ ] Verified **in a browser**, not with `curl`
- [ ] Read-only key in production
