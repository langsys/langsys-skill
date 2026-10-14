# SSR — Nuxt


> ### ⛔ Don't seed the catalog store during SSR here — unsafe in practice
>
> [core/rendering-mode.md](../core/rendering-mode.md) describes seeding `sTranslations` +
> `currentlyLoadedLocale` during the render so `t()` server-renders. **That is recommended on
> SvelteKit and not recommended here.** `langsys-js-vue` does re-export both settable signals, so the
> code will look like it works — and it does, until two requests overlap.
>
> **Measured 2026-08-30** against published `langsys-js-vue@0.2.1`. Bare Vue SSR first,
> then a real Nuxt 3 app (`nuxt build`, `node .output/server/index.mjs`, seed in a Nitro
> `request` hook). Concurrency was instrumented server-side — max 47 and 80 requests
> genuinely in flight — so the zeros are real negatives, not a serialised harness.
>
> | Read position | `await` between seed and read? | Wrong-language responses |
> |---|---|---|
> | Bare Vue, synchronous `setup()` | no | 0 / 80, and 0 / 400 |
> | `app.vue` setup, before any await | no | **0 / 80** |
> | Page inside `<NuxtPage>`'s Suspense, **synchronous** page | no | **0 / 80** |
> | `app.vue` setup, after `await useAsyncData` | yes | **67 / 80** |
> | Page inside Suspense, after `useAsyncData` | yes | **71 / 80** |
>
> **`<Suspense>` by itself is not the problem, and neither is Nuxt's structure.** A Suspense
> boundary wrapping a *synchronous* child is clean at 80 concurrent. The rule here is the
> same one-liner as every other framework: **any await point between the seed and a `t()`
> read**. `renderToString` is async but runs synchronously until its first `await`, and a
> fully synchronous tree completes inside that prefix.
>
> **So this is "unsafe in practice", not "structurally forbidden".** The rows above show
> clean results for reads in `app.vue` setup above any await, even with Suspense-wrapped
> routes below. Don't rely on them yet, for two reasons.
>
> **Those rows seeded in a Nitro `request` hook, and that result is unexplained.** On
> SvelteKit, seeding in a server hook and then awaiting before render bled 70/80. Nuxt's request
> pipeline should also await between its hooks and the render (reasoned from its design, not
> verified), so a clean 0/80 here is either a real
> difference between the frameworks or a masked result, like the two harness traps in
> [verify.md](../verify.md). Until someone explains it or re-measures it, treat the safe
> position as unconfirmed.
>
> **And even taken at face value, it's one line from collapsing:** adding `await useAsyncData`, which is *the* idiomatic way a Nuxt
> app fetches, took that exact position from 0/80 to 67/80. And every routed page that awaits
> anything is unsafe regardless, which is most real pages.
>
> **Recommend request scoping** — [`langsys-js-server`](../core/server-sdk.md), or the pure
> catalog function (§ below), which holds no module state and is immune by construction.
> Not because Nuxt forbids the seed, but because a Nuxt app that never awaits above its
> translated reads is not a Nuxt app anyone writes.

> **Condition 3 (reset on failure) applies here regardless of renderer.** See "the failure
> path must reset" in [core/rendering-mode.md](../core/rendering-mode.md). It bit under the
> *synchronous* renderer too, so passing the concurrency test above buys no protection from it.


Read [integrate/vue.md](../integrate/vue.md) first. This adds the server half.

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
| Flash of untranslated content | `initialTranslations` missing or missing its locale |
| Hydration mismatch | Locale re-detected on the client — use `useState` so it transfers |
| Two catalog requests | Seeding missing, or `useFetch` re-running client-side |
| Write key in the browser | `public` runtime config should carry the read-only key only |
| `t()` body copy is base language in `curl` output | **Expected on this track**, which doesn't seed the store. Verify body copy in a browser; head tags and anything from the pure catalog function *should* be translated in `curl` |
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
