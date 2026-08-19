# SSR — SvelteKit

Read [integrate/svelte.md](../integrate/svelte.md) first. This adds the server half.

## 0. First: is there a server at runtime?

**Everything below assumes a request reaches your app.** If the site is fully prerendered there is no request and no server, and the seeding recipe in this track cannot run as written.

```bash
grep -rn "export const prerender" src/routes | head
grep -E "adapter-static" package.json
```

`prerender = true` in the root `+layout.ts`, or `@sveltejs/adapter-static`, means **static output**. `scan` reports this as `PRERENDERED / STATIC`.

### What breaks, and what it costs

`+layout.server.ts` runs at **build** time, once, with no `Accept-Language` header. So per-request locale detection has nothing to detect, and every prerendered page is generated in exactly one locale.

Client-only Langsys still works — the page loads, the SDK fetches, the text swaps. But the HTML served to a crawler contains only the base language. **For a marketing or docs site that means the translated pages do not rank**, which is usually the entire reason for translating them.

That is a product decision, not a technical one. Three honest options:

| Option | Translated HTML | Cost |
|---|---|---|
| **A. Client-only, accept it** | no | Zero work. Correct for an app behind a login, where crawlers are irrelevant. |
| **B. Prerender one route tree per locale** | yes | `/[lang]/…` with `entries()` returning every locale. Each build fetches the catalog and emits static HTML per language. More build time, more output, real URLs per locale — which is what SEO wants anyway. |
| **C. Move to a runtime adapter** | yes | `adapter-node`/`adapter-cloudflare` and follow this track as written. Gives per-request detection back, at the cost of running a server. |

**B is usually right for a static marketing site**, because a locale in the URL is what makes translated pages indexable and shareable in the first place — `Accept-Language` negotiation produces one URL that renders differently per visitor, which crawlers handle badly regardless of rendering model.

```ts
// src/routes/[lang]/+layout.ts
export const prerender = true;
export const entries = () => [{ lang: 'en' }, { lang: 'es' }, { lang: 'fr' }];

export async function load({ params }) {
    // Runs at BUILD time, once per locale. Seed from here, not from a request.
    return { locale: params.lang };
}
```

Then pass `initialTranslations` and `initialTranslationsLocale` from that build-time load, exactly as §2 below describes — the seeding mechanism is unchanged, only *when* it runs and *where the locale comes from*.

Read on for the request-based version.


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
