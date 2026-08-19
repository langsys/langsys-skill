# SSR — Next.js (App Router & Pages Router) / Remix

Read [integrate/react.md](../integrate/react.md) first. This adds the server half.

## The problem

Without seeding, the server renders untranslated markup, then the client fetches the catalog after hydration and re-renders. Users see a flash of the base language, and you pay for two fetches.

## The solution

Fetch the catalog on the server, pass it to the client, seed it through `initialTranslations`.

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
export const getServerSideProps: GetServerSideProps = async ({ req }) => {
    const locale = resolveLocale(req.headers['accept-language']);
    return { props: { locale, initialTranslations: await fetchTranslations(locale) } };
};
```

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

## Common failures

| Symptom | Cause |
|---|---|
| Flash of untranslated content | `initialTranslations` not passed, or passed without `initialTranslationsLocale` |
| Two catalog requests per page load | Seeding missing; the client refetches what the server already had |
| Hydration mismatch | Server and client resolved different locales — resolve once on the server and pass it down |
| Works in dev, not in prod | Write key in dev vs read-only in prod, and the phrase was never registered. Exercise it in dev first |
| Key visible in the client bundle | Server-only fetch should use unprefixed env vars |

## Checklist

- [ ] Server fetch uses **unprefixed** env vars
- [ ] Locale resolved **once** on the server and passed down
- [ ] Both `initialTranslations` and `initialTranslationsLocale` passed
- [ ] Locale fallback uses the explicit guard, not `|| 'en-US'`
- [ ] Rendering **not** gated on `ready` when seeded
- [ ] Network tab shows one catalog request, not two
- [ ] Read-only key in production
