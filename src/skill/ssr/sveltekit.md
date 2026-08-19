# SSR — SvelteKit

Read [integrate/svelte.md](../integrate/svelte.md) first. This adds the server half.

## 0. First: is this public, and is there a server at runtime?

**Read [core/rendering-mode.md](../core/rendering-mode.md) before this track.** It carries the decision; this section is only the SvelteKit-specific detection and shapes.

Short version: **public site → SSR**, because only SSR puts *current* translations in the HTML a crawler fetches. **App behind a login → client-only with a ready gate**, and skip this track entirely.

```bash
grep -rn "export const prerender" src/routes | head
grep -E "adapter-static|adapter-node|adapter-cloudflare|adapter-auto" package.json
```

`prerender = true` in the root `+layout.ts`, or `@sveltejs/adapter-static`, means **static output** — no server at runtime, so everything below this section cannot run as written. `scan` reports this as `PRERENDERED / STATIC`.

### If the site is public and currently static

Prerendering emits translated HTML, so it passes the obvious check — but what it emits is a **build-time snapshot**. The client corrects the page after hydration, so humans see current text while the crawler indexed the old copy. A fixed mistranslation stays in search results until the next build, and nobody reports it because everyone who looks sees the corrected page.

Prefer a runtime adapter:

```js
// svelte.config.js
import adapter from '@sveltejs/adapter-node';        // or -cloudflare, -vercel, -netlify
export default { kit: { adapter: adapter() } };
```

and drop `export const prerender = true` from the root layout. Then follow this track as written — per-request locale detection and seeding come back, and translations are current on every render.

### If static is a hard constraint

Prerender **per locale**, which is much better than client-only and keeps this track's seeding mechanism unchanged — only *when* it runs and *where the locale comes from* differ:

```ts
// src/routes/[lang]/+layout.ts
export const prerender = true;
export const entries = () => [{ lang: 'en' }, { lang: 'es' }, { lang: 'fr' }];

export async function load({ params }) {
    // BUILD time, once per locale — not per request.
    return { locale: params.lang };
}
```

Pass `initialTranslations` and `initialTranslationsLocale` from that load exactly as §2 describes. Then schedule rebuilds against translation updates, and tell whoever owns the site that indexed content is only as fresh as the last build.

A locale in the URL is worth having regardless: `Accept-Language` negotiation produces one URL that renders differently per visitor, which crawlers handle badly under any rendering model.

## The problem

Without seeding, the server renders untranslated markup, the client fetches the catalog after hydration and re-renders. Flash of base language, two fetches.

## 1. Server-side fetch

```ts
// src/routes/+layout.server.ts
import type { LayoutServerLoad } from './$types';
import { LANGSYS_PROJECT_ID, LANGSYS_API_KEY } from '$env/static/private';

const SUPPORTED = ['en-US', 'es-ES', 'fr-FR'];

export const load: LayoutServerLoad = async ({ request, fetch }) => {
    const accept = request.headers.get('accept-language');
    const detected = resolveLocale(accept, SUPPORTED);
    // Two failure modes — undetectable returns false, unsupported returns the
    // user's top preference. `|| 'en-US'` alone does not cover the second.
    const locale = detected && SUPPORTED.includes(detected) ? detected : 'en-US';

    const res = await fetch(
        `https://api.langsys.dev/api/translations?project_id=${LANGSYS_PROJECT_ID}&locale=${locale}`,
        { headers: { 'X-API-KEY': LANGSYS_API_KEY } },
    );

    return {
        locale,
        initialTranslations: res.ok ? (await res.json())?.data ?? null : null,
    };
};
```

`$env/static/private` keeps the key out of the client bundle entirely — use it, not `PUBLIC_`, for the server fetch.

## 2. Seed on the client

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
    import { writable } from 'svelte/store';
    import { onMount } from 'svelte';
    import { LangsysApp } from 'langsys-js-svelte';
    import { PUBLIC_LANGSYS_PROJECT_ID, PUBLIC_LANGSYS_API_KEY } from '$env/static/public';

    let { data, children } = $props();

    const userLocale = writable(data.locale);

    onMount(async () => {
        const res = await LangsysApp.init({
            projectid: PUBLIC_LANGSYS_PROJECT_ID,
            key: PUBLIC_LANGSYS_API_KEY,          // READ-ONLY in production
            UserLocaleStore: userLocale,
            baseLocale: 'en-US',
            initialTranslations: data.initialTranslations,   // ← both required
            initialTranslationsLocale: data.locale,
            ssrTokenStrategy: 'client',
        });
        if (!res.status) console.error('Langsys init failed', res.errors);
    });
</script>

<svelte:head><html lang={data.locale} /></svelte:head>

{@render children()}
```

> **Do not gate rendering on a `ready` flag when seeding.** The server already emitted translated markup; a loading gate would replace correct content with a spinner and reintroduce the flash you are removing. Gate only in client-only apps.

## 3. Locale switching

```svelte
<script lang="ts">
    import { LangsysApp } from 'langsys-js-svelte';
    export let userLocale;

    async function change(next: string) {
        userLocale.set(next);
        await LangsysApp.translationsLoadingPromise;
        document.documentElement.lang = next;
    }
</script>
```

To persist across reloads, store the choice in a cookie and read it in `+layout.server.ts` ahead of `Accept-Language`.

## Plain Node SSR (no SvelteKit)

Same shape: fetch the catalog before rendering, serialize it into the HTML, read it on the client and pass to `init`.

## Common failures

| Symptom | Cause |
|---|---|
| Flash of untranslated content | `initialTranslations` missing, or passed without its locale |
| Two catalog requests per load | Seeding missing |
| `document is not defined` | SDK touched during SSR — keep `init` in `onMount` |
| Hydration mismatch on `<html lang>` | Locale resolved differently on server and client — resolve once server-side |
| Key in the client bundle | Server fetch should use `$env/static/private` |

## Checklist

- [ ] Server fetch uses `$env/static/private`
- [ ] Locale resolved once in `+layout.server.ts`
- [ ] Both `initialTranslations` and `initialTranslationsLocale` passed
- [ ] Locale fallback uses the explicit guard
- [ ] `init` inside `onMount`
- [ ] Rendering not gated on `ready` when seeded
- [ ] One catalog request in the network tab
- [ ] Read-only key in production
