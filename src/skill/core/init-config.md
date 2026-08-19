# `LangsysApp.init()` configuration

Verified against `langsys-js-typescript@0.4.3`.

```ts
const res = await LangsysApp.init({
    projectid: '...',
    key: '...',
    UserLocaleStore: localeStore,
    baseLocale: 'en-US',
    debug: false,
    ssrTokenStrategy: 'client',
});

if (!res.status) console.error('Langsys init failed', res.errors);
```

## Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `projectid` | `string` | ✅ | Project UUID from Langsys.dev |
| `key` | `string` | ✅ | API key. Write in dev, read-only in prod |
| `UserLocaleStore` | `Signal<string>` * | ✅ | The user's selected locale. SDK subscribes and reacts to changes |
| `baseLocale` | `string` | — | The language your source phrases are written in |
| `debug` | `boolean` | — | Console diagnostics + the unmatched-params warning (≥0.4.3). Never `true` in production |
| `ssrTokenStrategy` | `'client' \| 'server' \| 'auto'` | — | Default `'client'`. See below |
| `initialTranslations` | `iCategories` | — | Server-fetched catalog, to skip the hydration refetch |
| `initialTranslationsLocale` | `string` | — | Which locale `initialTranslations` corresponds to. **Required if you pass it** |

\* **Svelte** takes a standard Svelte `Writable<string>`. React and Vue take a `Signal<string>` — build one with `useLocaleStore()` / `createLocaleStore()`, or in Vue adapt an existing ref with `refToLocaleSource()`.

## Return value

```ts
interface iLangsysResponse {
    status: boolean;
    errors?: string[];
}
```

**Always check `status`.** A silently failed init looks identical to "translations don't work."

---

## ⚠️ `apiUrl` is NOT a config field

Some documentation shows `init({ apiUrl: '...' })`. **It does not exist** in `iLangsysInitConfig` — the property is silently dropped and the SDK keeps talking to production.

To point at a local or self-hosted server:

```ts
import { LangsysApp, LangsysAppAPI } from 'langsys-js-react';

LangsysAppAPI.setBaseUrl('http://localhost:8000/api');   // MUST be before init()
await LangsysApp.init({ /* ... */ });
```

TypeScript users get an excess-property error from the bad form. **Plain-JS users get no signal at all** — it just quietly doesn't work.

---

## `ssrTokenStrategy`

Controls when phrases discovered during server rendering are sent to the API.

| Value | Behavior | Use when |
|---|---|---|
| `'client'` *(default)* | Tokens collected on the server flush from the client after hydration | Best performance — the default is usually right |
| `'server'` | Sent immediately during SSR | You need registration guaranteed even if the client never hydrates |
| `'auto'` | Batches ≤5 flush from the server, larger ones wait for the client | Mixed workloads |

Only relevant with a **write key**. A read-only key registers nothing regardless.

---

## SSR seeding

```ts
await LangsysApp.init({
    projectid, key, UserLocaleStore, baseLocale: 'en-US',
    initialTranslations,              // fetched server-side
    initialTranslationsLocale: 'es-ES',
});
```

Pass **both** or neither — translations without their locale cannot be matched to a request. See the [ssr/](../ssr/) tracks.

---

## After init

| Call | Purpose |
|---|---|
| `LangsysApp.refresh()` | Force-refetch the current locale's catalog |
| `LangsysApp.translationsLoadingPromise` | Resolves when the current locale's translations are ready |
| `LangsysApp.t` | Current `TFunction` (getter — reads fresh state each call) |

Switching locale mid-session and need to re-run dependent code:

```ts
LangsysApp.translationsLoadingPromise.then(() => { /* new catalog is live */ });
```

---

## Locale helpers

```ts
await LangsysApp.getCountries(inLocale?);     // [{ code, label }]
await LangsysApp.getDialCodes(inLocale?);     // [{ country_code, dial_code, name }]
await LangsysApp.getCurrencies(inLocale?);    // [{ code, name, symbol }]
await LangsysApp.getLocales(inLocale?);       // { LanguageName: [{ code, name }] }
await LangsysApp.getLocalesFlat(inLocale?);   // [{ code, name }]
await LangsysApp.getLocaleNameWithLookup('es-ES', true, 'fr-FR');  // 'espagnol'
```

`getLocaleName()` (synchronous) only reads an in-memory cache populated by `getLocalesData()` or `getLocaleNameWithLookup()`. Called before that, it warns and returns `''` — **prefer `getLocaleNameWithLookup()`** unless you know the data is loaded.

### Detecting the user's locale

```ts
LangsysApp.detectPreferredLocale();                    // browser: navigator.languages
LangsysApp.detectPreferredLocale(acceptLanguageHeader); // SSR
LangsysApp.detectPreferredLocale(header, supported);    // matched against your locales
```

Script-aware CLDR matching: `es-MX` matches `es-ES`; `zh-TW` matches `zh-Hant` and **never** `zh-Hans`. Results are canonical BCP 47.

**Two failure modes, only one returns `false`:**

```ts
// nothing detectable at all    → false
// detected but not supported   → the user's top preference, canonicalized
```

So `detectPreferredLocale(header, supported) || 'en-US'` does **not** cover the unsupported case. Use:

```ts
const detected = LangsysApp.detectPreferredLocale(header, supported);
const locale = detected && supported.includes(detected) ? detected : 'en-US';
```
