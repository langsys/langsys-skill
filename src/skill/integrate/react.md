# React integration

`langsys-js-react@0.4.3` · requires **React 18 or 19** (built on `useSyncExternalStore`).

Covers React, Next.js, Remix, and Vite SPAs. Server-rendering? Also read [ssr/nextjs.md](../ssr/nextjs.md).

## 1. Install

```bash
npm install langsys-js-react
```

`langsys-js-typescript` comes along as a transitive dependency. `react` is a peer you already have.

## 2. Environment

Prefix must match your bundler ([core/secrets.md](../core/secrets.md)):

```bash
# .env.local  — Vite
VITE_LANGSYS_PROJECT_ID=...
VITE_LANGSYS_API_KEY=...      # write key in dev, read-only in prod
```

Next.js uses `NEXT_PUBLIC_`; CRA uses `REACT_APP_`.

## 3. Provider

```tsx
// src/LangsysGate.tsx
import { useEffect, useState, type ReactNode } from 'react';
import { LangsysApp, useLocaleStore } from 'langsys-js-react';

export function LangsysGate({ children }: { children: ReactNode }) {
    const [, , localeStore] = useLocaleStore('en-US');
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        LangsysApp.init({
            projectid: import.meta.env.VITE_LANGSYS_PROJECT_ID,
            key: import.meta.env.VITE_LANGSYS_API_KEY,
            UserLocaleStore: localeStore,
            baseLocale: 'en-US',
            debug: import.meta.env.DEV,
            ssrTokenStrategy: 'client',
        }).then((res) => {
            if (res.status) setReady(true);
            else setError(res.errors?.join(', ') ?? 'Init failed');
        });
    }, [localeStore]);

    if (error) return <p>Langsys init failed: {error}</p>;
    if (!ready) return <p>Loading…</p>;
    return <>{children}</>;
}
```

Wrap the app once, above anything that translates:

```tsx
<LangsysGate><App /></LangsysGate>
```

Prefer the locale store at module scope? `const localeStore = createLocaleStore('en-US')` works too.

## 4. Translate strings — `useT()`

```tsx
import { useT } from 'langsys-js-react';

function Welcome({ name }: { name: string }) {
    const t = useT();
    return (
        <>
            <h1>{t('Welcome to my app', 'Home')}</h1>
            <p>{t('Hello, {name}!', 'Home', { name })}</p>
        </>
    );
}
```

`useT()` re-renders the component when translations or the loaded locale change. Call it in **every** component that translates — it is a subscription, not a one-time read.

Placeholder names are type-checked against the phrase literal: a missing or extra key is a compile error.

## 5. Markup — pick the right component

Full decision procedure: [core/choosing-primitives.md](../core/choosing-primitives.md).

### `<Phrase>` — one sentence containing inline markup

```tsx
import { Phrase } from 'langsys-js-react';

<Phrase category="ProductCard" params={{ n: reviewCount }}>
  Based on %n% <strong>reviews</strong>
</Phrase>
```

Registers as **one** phrase. Required whenever a count and the noun it inflects share a sentence.

### `<Translate>` — a block of markup

```tsx
import { Translate } from 'langsys-js-react';

<Translate category="Blog" tag="article">
  <h1 className="title">My article title</h1>
  <p>My content <strong>is the best</strong> when internationalized.</p>
</Translate>
```

Splits into per-node phrases, registered together as one content block. Use for prose, marketing copy, CMS output, forms with placeholders.

```tsx
<Translate category="News" tag="div">
  <div dangerouslySetInnerHTML={{ __html: article?.content ?? '' }} />
</Translate>
```

### `<DontTranslate>` — never translated

```tsx
Built with <DontTranslate>Kangen®</DontTranslate> on <DontTranslate>langsys.dev</DontTranslate>
```

### ⚠️ `%name%`, never `{name}`, in markup

```tsx
<Translate params={{ count }}>You have %count% items.</Translate>   {/* ✅ */}
<Translate params={{ count }}>You have {count} items.</Translate>   {/* ❌ */}
```

JSX evaluates `{count}` before the SDK's walker sees the text — **silent failure**, correct-looking in the base language. Inside a `t()` string literal, `{count}` stays correct even when the call sits inside JSX.

### Keep children static

`<Translate>` and `<Phrase>` mutate the DOM in place. Dynamic per-string values belong in `useT()`; dynamic *values* belong in `params`.

## 6. Switching locale

```tsx
function LocaleSwitcher() {
    const [locale, setLocale] = useLocaleStore();
    return (
        <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="en-US">English</option>
            <option value="es-ES">Español</option>
        </select>
    );
}
```

Re-run dependent code after the new catalog lands:

```tsx
useEffect(() => {
    LangsysApp.translationsLoadingPromise.then(() => { /* … */ });
}, [locale]);
```

## Exports

| Export | Notes |
|---|---|
| `useT()` | The everyday API. Re-renders on translation/locale change |
| `useCurrentLocale()` | Locale whose translations are loaded (lags the selected locale during fetch) |
| `useLocaleStore(initial?)` | `[locale, setLocale, store]` — pass `store` to `init` |
| `useTranslations()` | Raw catalog. Rarely needed |
| `useSignal(signal)` | Subscribe to any base-SDK signal |
| `createLocaleStore(initial?)` | Locale store outside React |
| `canonicalizeLocale(s)` | `'en-us'` → `'en-US'` |
| `<Translate>` | `category?` `custom_id?` `label?` `params?` `tag?` `className?` |
| `<Phrase>` | `category?` `params?` `tag?` `className?` |
| `<DontTranslate>` | `tag?` `className?` |

## Checklist

- [ ] React 18/19
- [ ] Env prefix matches bundler
- [ ] `LangsysGate` wraps the app once; `res.status` checked
- [ ] `useT()` called in every translating component
- [ ] `%name%` in markup, `{name}` in `t()` strings
- [ ] `<Phrase>` for markup-bearing sentences, not `<Translate>`
- [ ] No template literals or concatenation in phrase arguments
- [ ] Read-only key + `debug: false` in production

Then [verify.md](../verify.md).
