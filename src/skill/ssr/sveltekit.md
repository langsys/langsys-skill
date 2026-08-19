# SSR — SvelteKit

Read [integrate/svelte.md](../integrate/svelte.md) first. This adds the server half.

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
