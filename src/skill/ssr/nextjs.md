# SSR — Next.js (App Router & Pages Router) / Remix


> ### ⛔ Do NOT seed the catalog store during SSR here — three separate verdicts
>
> [core/rendering-mode.md](../core/rendering-mode.md) describes seeding `sTranslations` +
> `currentlyLoadedLocale` during the render so `t()` server-renders. **That is permitted on
> SvelteKit and not here.** `langsys-js-react` does re-export both settable signals, so the
> code will look like it works. Measured **2026-08-30** against published
> `langsys-js-react@0.6.7`, production builds.
>
> **1. Pages Router / plain `renderToString` — works, and the reason matters.**
> 8 locales × 10 rounds all in flight, witnessed concurrency 58–80: 0/80 wrong.
> **`getServerSideProps` runs *before* render**, so the idiomatic Pages Router shape puts the
> await *before* the seed rather than between seed and read. **This is idiom, not
> architecture** — React is not structurally safer. Force an `await` into that same app's
> render body and it bleeds **70/80**, identically to streaming. Nuxt is the contrast: its
> idiomatic fetch, `useAsyncData`, awaits *inside* `setup()`, which is exactly between the
> seed and the reads. **Same rule, different idioms: Pages Router's usual shape keeps the
> await before the seed, Nuxt's usual shape puts it in the middle.**
>
> **2. Streaming with any suspension between seed and read — unsafe, 70/80 wrong.**
> The renderer is not the problem: `renderToPipeableStream` over a *synchronous* tree is
> 0/80, and moving the seed *inside* the suspended subtree is also 0/80. It is the await
> point between them. A narrowly safe placement therefore exists, but it is unshippable as
> a rule — it is a property of the whole subtree, **nothing reports a violation** (no error,
> no warning, no dev hint), and it breaks the moment anyone adds a `<Suspense>`, a lazy
> import, or an `await` between the provider and a `t()` call.
>
> **3. App Router / RSC — non-functional. Not "unsafe": it cannot work at all.**
> This one is not a race, and low traffic does not make it fine. The Server Component and
> the Client Component hold **separate module instances** of `langsys-js-react`. The seed
> lands in the react-server graph and reads back correctly *there*; the client component
> reads a different singleton still in its initial state. Measured at **concurrency 1, one
> request in flight**: every non-base locale renders base-locale content, every time.
>
> ```
> <p id="serverSideGlobal">it-IT</p>              seed landed in the react-server graph
> <p id="serverSideWord">Ciao</p>                 and reads back correctly THERE
> <p id="word">Hello</p>                          the client component: untranslated
> <p id="catalogKeys">["__uncategorized__"]</p>   client singleton still in initial state
> ```
>
> That is exactly the production symptom this whole track exists to prevent — a localized
> route byte-identical to the base locale — except that in App Router it is the **default
> outcome of following the rule**, not an edge case reachable under load.
>
> > **⚠ How to test this, because the obvious harness certifies it as fine.** A
> > concurrency harness asks *does response A contain response B's content?* On App Router
> > that answer is **zero**, correctly — every response is uniformly wrong in the same way,
> > so there is nothing to contaminate. The seed never reaches the reader at all.
> >
> > **Compare each response against its own expected content, not against the other
> > responses.** One request is enough. A contamination-shaped detector passes this bug, which
> > is this codebase's oldest failure mode: a check that produces no signal reads as a pass.
>
> ### The App Router story that does work — both halves measured
>
> **Crawler-visible copy: the pure catalog function in a Server Component.** Measured
> 2026-08-30 — raw `curl`, no browser: localized routes return genuinely translated body
> copy, ICU plurals intact (via the SDK's exported pure `interpolate`, so real plural rules),
> `serverGlobalLocale` empty because no module state is touched at all. 8 × 10 concurrent:
> **80 responses, 80 correct, 0 bleeds.** Immune to the graph split by construction — a pure
> function has no singleton to land in the wrong graph. See §4 below, or
> [`langsys-js-server`](../core/server-sdk.md).
>
> **Hydration: `init({ initialTranslations, initialTranslationsLocale })`** passed through
> the RSC payload into a client boundary. Measured working — the client graph seeds, which is
> the graph that needs it. **Do not describe this as fixing the flash** (see below); it fixes
> the double fetch and the eventual content.
>
> **Never touch the global stores from a Server Component.**
>
> **Condition 3 (reset on failure) applies to all three, regardless of renderer.** See "the
> failure path must reset" in [core/rendering-mode.md](../core/rendering-mode.md). It bit
> under the *synchronous* renderer, so passing verdict 1 buys no protection from it.



Read [integrate/react.md](../integrate/react.md) first. This adds the server half.

> **Decide the rendering mode first: [core/rendering-mode.md](../core/rendering-mode.md).**
> Public site → SSR; app behind a login → client-only with a ready gate, and skip this track.
>
> **Know what SSR does and does not give you here.** `t()`, `<Phrase>` and `<Translate>`
> render the **base language** during server rendering on this track. `init()` runs in a
> client-only hook, passing it `initialTranslations` doesn't change that, and seeding the store
> directly isn't recommended here (see the box above).
> This track buys one catalog fetch instead of two, no flash after hydration, and a
> *current* catalog per request. For text a crawler or a social scraper must read,
> resolve it from the fetched catalog directly — see
> [core/rendering-mode.md](../core/rendering-mode.md#resolve-crawler-visible-text-through-a-pure-catalog-function).

> ## For crawler-visible translated body copy, use `langsys-js-server`
>
> This track's seeding removes the flash and the second fetch. It does **not** translate the
> server render — `t()` and the components render the base language during SSR, because the
> catalog lives in module globals that only a client-only hook writes.
>
> **`langsys-js-server` puts a request-scoped catalog on the server so `t()` resolves during the
> render.** Read [core/server-sdk.md](../core/server-sdk.md) before choosing between them.
>
> `<Phrase>` and `<Translate>` are still client-only in its 0.1.0 — and **nothing signals that for
> `<Translate>`**, since its host carries no marker. Check that document's capability matrix
> rather than assuming parity.

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

On no match it returns the visitor's tag unchanged — not `false`, not your base locale. Storing that gives you a locale with no catalog, and the request 422s.

**The diagnostic is not hidden.** Neither `Logger.warn` nor `Logger.error` is debug-gated, so the 422 prints by default — with the server's exact sentence, the locale sent, and the project id:

```
[Langsys Warning] LangsysAppAPI failed to query
  { message: 'The locale provided is not a base or target locale for this project',
    http: { status: 422, data: '{"project_id":"…","locale":"de-de"}' } }
```

Malformed input is the gated case: `'!!!'` is *detected* as invalid BCP 47, but that warning fires only under `debug: true`, and the value still passes through as a "locale".

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

- **Both parameters, or nothing happens.** The guard is `if (initialTranslations && initialTranslationsLocale)` with no `else` and no warning. Pass one alone and it is ignored with **no diagnostic at all** — not a gated one, none. Under `debug: true` you can only infer it from an *absence*: the line `Populated sTranslations with initial data for locale: …` never appears. Checking for a missing log line is the only signal there is.
- **`init()` mutates the object you pass it.** It writes a `__category__` key into every category and adds `__uncategorized__` if absent. That object is your server payload — do not hand it something frozen or shared.
- **The seeded no-refetch window is 60 seconds, not permanent.** A long-lived session that re-settles on the same locale later *will* fetch again. Correct behavior, surprising in a network tab.

> **`init()` must not run during server rendering — and the reason is not `document is not defined`.** `LangsysApp` is a hard module singleton whose catalog lives in module globals. Under a long-lived Node server, one process serves every concurrent request, so server-side init is a **cross-request data race**: an in-flight `/de` render can observe `/it`'s catalog. Constructing your own `Translations` does not escape it — its constructor subscribes to the same globals. **A `typeof window` guard does not make server-side init safe.**

## Crawler-visible text

Because this track doesn't seed the store, the reactive primitives render base language during SSR, so anything a crawler or a social scraper must read has to come from the fetched catalog directly. It is a pure lookup, so none of the singleton's problems apply:

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
| `t()` body copy is base language in `curl` output | **Expected on this track**, which doesn't seed the store. Verify body copy in a browser; head tags and anything from the pure catalog function *should* be translated in `curl` |
| Head/meta is base language | Using `t()` for head fields; use the pure catalog lookup |
| Wrong locale served under load | `init()` called during SSR — module globals raced across requests |
| Catalog request 422s: "not a base or target locale" | A bare `es` where the project offers `es-CR`, or `supportedLocales` built from the global CLDR list |
| Empty catalog | The 422 above — search the console for `Langsys`; both the warning and the error print by default |

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
