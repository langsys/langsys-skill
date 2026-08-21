# SSR — Nuxt

Read [integrate/vue.md](../integrate/vue.md) first. This adds the server half.

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

## 1. Runtime config

```ts
// nuxt.config.ts
export default defineNuxtConfig({
    runtimeConfig: {
        langsysApiKey: process.env.LANGSYS_API_KEY,        // server-only
        langsysProjectId: process.env.LANGSYS_PROJECT_ID,  // server-only
        public: {
            langsysApiKey: process.env.NUXT_PUBLIC_LANGSYS_API_KEY,       // READ-ONLY
            langsysProjectId: process.env.NUXT_PUBLIC_LANGSYS_PROJECT_ID,
        },
    },
});
```

Two sets on purpose: the server fetch uses the private pair, so the write key never reaches the browser.

## 2. Server-side fetch

```ts
// server/api/langsys-translations.get.ts
export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig();
    const locale = getQuery(event).locale as string;

    const res = await $fetch<{ data: unknown }>(
        `https://api.langsys.dev/api/translations`,
        {
            params: { project_id: config.langsysProjectId, locale },
            headers: { 'X-API-KEY': config.langsysApiKey },
        },
    );
    return res?.data ?? null;
});
```

## 3. Resolve locale and seed

```vue
<!-- app.vue -->
<script setup lang="ts">
import { LangsysApp, useLocaleStore } from 'langsys-js-vue';

const SUPPORTED = ['en-US', 'es-ES', 'fr-FR'];

// Runs on the server, transferred to the client via Nuxt payload — no refetch.
const locale = useState('langsys-locale', () => {
    const header = useRequestHeaders(['accept-language'])['accept-language'];
    const detected = LangsysApp.detectPreferredLocale(header, SUPPORTED);
    // detectPreferredLocale returns the user's top preference when nothing
    // matches — NOT false — so `|| 'en-US'` does not cover that case.
    return detected && SUPPORTED.includes(detected) ? detected : 'en-US';
});

const { data: initialTranslations } = await useFetch('/api/langsys-translations', {
    query: { locale },
});

const { store } = useLocaleStore(locale.value);
const config = useRuntimeConfig();

onMounted(async () => {
    const res = await LangsysApp.init({
        projectid: config.public.langsysProjectId,
        key: config.public.langsysApiKey,
        UserLocaleStore: store,
        baseLocale: 'en-US',
        initialTranslations: initialTranslations.value,   // ← both required
        initialTranslationsLocale: locale.value,
        ssrTokenStrategy: 'client',
    });
    if (!res.status) console.error('Langsys init failed', res.errors);
});

useHead({ htmlAttrs: { lang: locale } });
</script>

<template>
    <NuxtPage />
</template>
```

`useState` is the key piece — it serializes into the Nuxt payload, so the client reuses the server's locale instead of re-detecting and risking a mismatch.

> **Do not gate rendering on a `ready` flag when seeding** — the server already produced translated markup.

Already keep the locale in Pinia or `useState`? Adapt it rather than creating a second source of truth:

```ts
import { refToLocaleSource } from 'langsys-js-vue';
LangsysApp.init({ UserLocaleStore: refToLocaleSource(locale), /* … */ });
```

## Plain Vite SSR (no Nuxt)

Same shape: fetch before render, serialize into the HTML, read on the client, pass to `init`.

## What seeding actually does — three verified behaviors

All three checked against the published `langsys-js-typescript@0.6.5`:

- **Both parameters, or nothing happens.** The guard is `if (initialTranslations && initialTranslationsLocale)` with no `else` and no warning. Pass one alone and it is ignored with **no diagnostic at all** — not a gated one, none. Under `debug: true` you can only infer it from an *absence*: the line `Populated sTranslations with initial data for locale: …` never appears. Checking for a missing log line is the only signal there is.
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
| Flash of untranslated content | `initialTranslations` missing or missing its locale |
| Hydration mismatch | Locale re-detected on the client — use `useState` so it transfers |
| Two catalog requests | Seeding missing, or `useFetch` re-running client-side |
| Write key in the browser | `public` runtime config should carry the read-only key only |
| Body copy is base language in `curl` output | **Expected** — `t()` is inert during SSR. Verify in a browser |
| Head/meta is base language | Using `t()` in `useHead`; use the pure catalog lookup |
| Wrong locale served under load | `init()` called during SSR — module globals raced across requests |

## Checklist

- [ ] Private runtime config for the server fetch; `public` holds the read-only key
- [ ] Locale resolved once via `useState` so it transfers in the payload
- [ ] Both `initialTranslations` and `initialTranslationsLocale` passed
- [ ] Locale fallback uses the explicit guard
- [ ] `useHead` sets `<html lang>`
- [ ] Crawler-visible strings resolved from the catalog, not `t()`
- [ ] `init()` never runs during server rendering
- [ ] Verified **in a browser**, not with `curl`
- [ ] One catalog request in the network tab
