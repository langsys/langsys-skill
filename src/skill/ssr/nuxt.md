# SSR — Nuxt

Read [integrate/vue.md](../integrate/vue.md) first. This adds the server half.

> **Decide the rendering mode first: [core/rendering-mode.md](../core/rendering-mode.md).**
> Public site → SSR, because only SSR puts *current* translations in the HTML a crawler
> fetches; a prerendered page serves a build-time snapshot that humans never see as stale.
> App behind a login → client-only with a ready gate, and skip this track entirely.

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

## Common failures

| Symptom | Cause |
|---|---|
| Flash of untranslated content | `initialTranslations` missing or missing its locale |
| Hydration mismatch | Locale re-detected on the client — use `useState` so it transfers |
| Two catalog requests | Seeding missing, or `useFetch` re-running client-side |
| Write key in the browser | `public` runtime config should carry the read-only key only |

## Checklist

- [ ] Private runtime config for the server fetch; `public` holds the read-only key
- [ ] Locale resolved once via `useState` so it transfers in the payload
- [ ] Both `initialTranslations` and `initialTranslationsLocale` passed
- [ ] Locale fallback uses the explicit guard
- [ ] `useHead` sets `<html lang>`
- [ ] One catalog request in the network tab
