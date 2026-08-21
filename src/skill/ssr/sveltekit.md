# SSR — SvelteKit

Read [integrate/svelte.md](../integrate/svelte.md) first. This adds the server half.

## 0. What this track actually delivers

**Read [core/rendering-mode.md](../core/rendering-mode.md) before this track.** The short version, because it is the thing most often misunderstood:

> **`$t`, `<Phrase>` and `<Translate>` render the base language during SSR.** `init()` runs in `onMount`, which does not run on the server, so the catalog is never populated during the server render. Seeding does not change this.

What this track gives you is **server-fetch, client-hydrate**: one catalog request instead of two, no flash after hydration, and a *current* catalog per request. It does **not** put translated body copy in the HTML by itself.

To put translated text in server HTML — for crawlers, and for social scrapers that never run JavaScript at all — resolve it from the fetched catalog with the pure function in [core/rendering-mode.md](../core/rendering-mode.md#resolve-crawler-visible-text-through-a-pure-catalog-function). §4 below shows it in place.

### Is there a server at runtime?

```bash
grep -rn "export const prerender" src/routes | head
grep -E "adapter-static|adapter-node|adapter-cloudflare|adapter-auto" package.json
```

`prerender = true` in the root layout, or `@sveltejs/adapter-static`, means **no server at runtime** — per-request locale resolution and per-request catalog freshness are both gone. `scan` reports this as `PRERENDERED / STATIC`.

Prefer a runtime adapter for a public site:

```js
// svelte.config.js
import adapter from '@sveltejs/adapter-node';        // or -cloudflare, -vercel, -netlify
export default { kit: { adapter: adapter() } };
```

If static is a hard constraint, prerender **per locale** under `/[lang]/` — the seeding and the pure-catalog lookup both work unchanged at build time; only freshness differs.

```ts
// src/routes/[lang]/+layout.ts
export const prerender = true;
export const entries = () => [{ lang: 'en' }, { lang: 'es' }, { lang: 'fr' }];
```

## 1. Server: resolve the locale, fetch the catalog

`Accept-Language` alone is not enough in production. Use a precedence chain, and filter every non-URL source through an offerability check:

```ts
// src/routes/[[lang=lang]]/+layout.server.ts
import type { LayoutServerLoad } from './$types';
import { LangsysApp } from 'langsys-js-svelte';
import { LANGSYS_PROJECT_ID, LANGSYS_API_KEY } from '$env/static/private';

// YOUR PROJECT'S locales. Not getLocalesFlat() — see the warning below.
const OFFERED = ['en-US', 'es-CR', 'fr-FR'];
const BASE = 'en-US';
const isOfferable = (l?: string | null | false) => !!l && OFFERED.includes(l);

export const load: LayoutServerLoad = async ({ params, cookies, request, fetch }) => {
    // detectPreferredLocale does the language -> region resolution: with
    // OFFERED above, 'es' becomes 'es-CR' and 'fr-CA' becomes 'fr-FR'.
    const negotiated = LangsysApp.detectPreferredLocale(
        request.headers.get('accept-language'),
        OFFERED,
    );

    // Highest precedence first. EVERY source is filtered through isOfferable,
    // including the negotiated one — see the warning below for why.
    const locale =
        [params.lang, cookies.get('locale'), negotiated].find(isOfferable) ?? BASE;

    const res = await fetch(
        `https://api.langsys.dev/api/translations?project_id=${LANGSYS_PROJECT_ID}&locale=${locale}`,
        { headers: { 'X-API-KEY': LANGSYS_API_KEY } },
    );
    const translations = res.ok ? (await res.json())?.data ?? null : null;

    return { locale, initialTranslations: translations, langsysReady: !!translations };
};
```

**Why every source is filtered, including `detectPreferredLocale`'s own output.** Verified by executing `langsys-js-typescript@0.6.5`:

```
detectPreferredLocale('es',    ['es-CR','it-IT','fr-FR','en-US'])  ->  'es-CR'   resolved
detectPreferredLocale('fr-CA', ['es-CR','it-IT','fr-FR','en-US'])  ->  'fr-FR'   resolved
detectPreferredLocale('de',    ['es-CR','it-IT','fr-FR','en-US'])  ->  'de'      NOT in your list
detectPreferredLocale('!!!',   ['es-CR','it-IT','fr-FR','en-US'])  ->  '!!!'     not even a locale
```

**On no match it returns the visitor's own tag unchanged** — not `false`, not your base locale — and it does not validate the input, so a malformed header comes straight back out. Store that and you have a locale with no catalog. A stale cookie is the same shape: well-formed, truthy, and no longer offered. `|| BASE` cannot catch any of these, because the value is present.

> **`supportedLocales` must be YOUR PROJECT's locales.** Building it from `LangsysApp.getLocalesFlat()` passes the ~573-entry global CLDR list, against which nearly any `Accept-Language` "matches" — so the helper confidently returns `de-de`, and the catalog request 422s with an empty result. This was a live defect in the Svelte SDK's own README.

**Do not widen by hand with `canonicalizeLocale`.** It normalizes case and separators only — `'en_us'` → `'en-US'`, `'zh-tw'` → `'zh-TW'` — and leaves `'es'` as `'es'`. It will not turn `es` into `es-CR`. Only `detectPreferredLocale(header, OFFERED)` does that resolution.

`$env/static/private` keeps the key out of the client bundle entirely. Use it, not `PUBLIC_`, for the server fetch.

`+layout.ts` should carry the SSR flags and **not** the catalog — routing it through the universal load only re-serializes a payload that is already most of the document:

```ts
// src/routes/[[lang=lang]]/+layout.ts — the whole file
export const ssr = true;
export const prerender = false;
```

## 2. Client: seed on hydration

```svelte
<!-- src/routes/[[lang=lang]]/+layout.svelte -->
<script lang="ts">
    import { writable } from 'svelte/store';
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';
    import { LangsysApp } from 'langsys-js-svelte';
    import { PUBLIC_LANGSYS_PROJECT_ID, PUBLIC_LANGSYS_API_KEY } from '$env/static/public';

    let { data, children } = $props();
    const userLocale = writable(data.locale);

    onMount(async () => {
        if (!browser) return;
        const res = await LangsysApp.init({
            projectid: PUBLIC_LANGSYS_PROJECT_ID,
            key: PUBLIC_LANGSYS_API_KEY,          // READ-ONLY in production
            UserLocaleStore: userLocale,
            baseLocale: 'en-US',
            initialTranslations: data.initialTranslations,   // ← both, or neither works
            initialTranslationsLocale: data.locale,
            ssrTokenStrategy: 'client',
        });
        if (!res.status) console.error('Langsys init failed', res.errors);
    });
</script>
```

> **`init()` belongs in `onMount` — but not for the reason you may assume.** It is not `document is not defined`. Calling `init()` during SSR *works*, and then corrupts concurrent requests: `LangsysApp` is a module singleton whose catalog lives in module globals, so one request's locale overwrites another's mid-render. **A `typeof window` guard does not make server-side init safe.** There is no request-scoped translator; see [core/rendering-mode.md](../core/rendering-mode.md).

Three behaviors of the seeding path worth knowing, all verified against `langsys-js-typescript@0.6.5`:

- **Both parameters, or nothing happens.** The guard is `if (initialTranslations && initialTranslationsLocale)` with no `else` and no warning. Pass one alone and it is ignored with **no diagnostic at all** — not a gated one, none. Under `debug: true` you can only infer it from an *absence*: the line `Populated sTranslations with initial data for locale: …` never appears. Checking for a missing log line is the only signal there is.
- **`init()` mutates the object you pass it**, writing a `__category__` key into every category and adding `__uncategorized__` if absent. That object is your SvelteKit `data`. Do not hand it something frozen or shared.
- **The seeded no-refetch window is 60 seconds, not permanent.** A long-lived session that re-settles on the same locale later *will* fetch again. Correct behavior, surprising in a network tab.

## 3. The ready gate: a failure path, not a loading state

Gate, but seed the gate from the server so it never fires on the happy path:

```svelte
<script lang="ts">
    import { untrack } from 'svelte';
    let isLangsysReady = $state(untrack(() => data.langsysReady || false));
</script>

{#if !isLangsysReady}
    <div class="overlay">
        <p>Initializing language system…</p>
        <button onclick={() => (isLangsysReady = true)}>Continue in English</button>
    </div>
{:else}
    {@render children()}
{/if}
```

> **Do not gate on hydration when seeding** — but not because the server markup is translated. It is not. Gate on hydration and you replace *readable base-language text* with a spinner, and hand crawlers an empty page instead of English. Strictly worse.

**Always give the gate an escape hatch.** A translation outage must never be a site outage.

## 4. Crawler-visible text

`$t` is inert during SSR, so anything a crawler must read comes from the catalog directly:

```svelte
<script lang="ts">
    import { interpolate } from 'langsys-js-typescript';

    // Pure, request-scoped, no module state. Mirrors the SDK's own buildTFn
    // minus missing-token harvesting, so SSR output matches CSR output.
    const ct = (phrase: string, ...rest: any[]) => {
        const category = typeof rest[0] === 'string' ? rest[0] : '';
        const params   = typeof rest[0] === 'object' ? rest[0] : rest[1];
        const value    = data.initialTranslations?.[category || '__uncategorized__']?.[phrase];
        // A content block is an OBJECT — `|| phrase` would not fall back correctly.
        const translated = typeof value === 'string' && value.length > 0 ? value : phrase;
        return params ? interpolate(translated, params, data.locale) : translated;
    };
</script>

<svelte:head>
    <title>{ct(page.seo.title, 'PageSeo')}</title>
    <meta name="description" content={ct(page.seo.description, 'PageSeo')} />
    <meta property="og:title" content={ct(page.seo.title, 'PageSeo')} />
</svelte:head>

<h1>{ct('Hydration begins with better water', 'Home')}</h1>
```

Use `$t` for interactive UI, `ct` for anything indexed or scraped.

**Do not shorten `ct` to a raw lookup.** Dropping `interpolate` makes `ct('Hello {name}', { name })` server-render the literal `Hello {name}` — and ICU forms render as raw source — while the client renders them correctly. That is a hydration mismatch on exactly the strings that carry data, and it looks like plausible text rather than an error. Pass `data.locale`, never the SDK's `currentlyLoadedLocale`; reading that global is the coupling `ct` exists to avoid.

> **Server-only phrases do not self-register.** The SDK harvests missing tokens inside `$t`; `ct` deliberately does not, because a process-global flush queue would reintroduce the cross-request coupling. A phrase that renders only through `ct` is never discovered — exercise it once client-side in development with a write key, or add it in the Translation Manager.

## 5. Locale in the URL

**Put the locale in the URL.** The SEO argument is the weaker one; the decisive reason is that a content-negotiated single URL has **no stable identity** — you cannot emit `hreflang`, cannot link to a specific language, cannot cache per locale, and a visitor cannot share the page in the language they read it in.

```ts
// src/params/lang.ts — permissive on purpose; the runtime does real validation
export const match = (p: string) => /^[a-z]{2,3}(-[a-z]{4})?$/.test(p);
```

Route as `[[lang=lang]]` (optional), base locale un-prefixed and canonical, with 307/308 redirects in `+layout.server.ts` to canonicalize. Keeping the matcher permissive means a new locale needs no redeploy; SvelteKit's route ranking keeps static segments like `/buy` ahead of the optional param, which is what makes permissiveness safe. Allow three letters — `fil` exists.

### Deduplicate offered locales before rendering `hreflang`

**This one has taken a whole site down.** Two locales can collapse to the same URL token — `zh-tw` and `zh-cn` both reduce to `zh`. Keyed markup over that list throws `each_key_duplicate`, and in SvelteKit that blanks **every page on the site**, not just the affected locale. A content-only change in the Translation Manager becomes an outage with no deploy.

```svelte
{#each dedupeByToken(offered) as alt (alt.hreflang)}
    <link rel="alternate" hreflang={alt.hreflang} href={alt.href} />
{/each}
```

Collapse region-only twins; **keep script subtags distinct** — `zh-hant` and `zh-hans` are different written languages and must route independently.

## 6. Locale switching

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

Persist the choice in a cookie and read it in `+layout.server.ts`, ahead of `Accept-Language` and behind `params.lang`.

## 7. Caching: a shorter fuse, not realtime

SSR does not make translations realtime for crawler-visible text — it shortens the fuse. A representative production stack:

| Layer | TTL |
|---|---|
| CDN / HTTP | `no-store` — none |
| In-process catalog memo | 5 minutes |
| Client SDK re-fetch window | 60 seconds |

A phrase fixed in the Translation Manager appears within about five minutes.

> **If you run more than one worker, that window is *inconsistent*, not just delayed.** Two PM2 instances mean two independent in-process caches: during propagation the same URL alternates between old and new copy depending on which worker answers. To a non-engineer it reads as "my change didn't save." Any per-process memo behind a load balancer has this property.

Leave the pages people edit *because they are wrong* — legal notices, an Impressum — **uncached**. A slower page beats one that flickers between two versions while someone is trying to correct it.

## Plain Node SSR (no SvelteKit)

Same shape: resolve locale, fetch the catalog before rendering, resolve crawler-visible strings from it directly, serialize it into the HTML, and seed `init()` on the client.

## Common failures

| Symptom | Cause |
|---|---|
| Body copy is base language in `curl` output | **Expected.** `$t` is inert during SSR — verify in a browser |
| Head/meta is base language | Using `$t` in `<svelte:head>`; use the pure catalog lookup |
| Server HTML shows a literal `{name}` or raw ICU | `ct` was shortened to a raw lookup — it must call `interpolate` |
| A phrase renders but never appears in the Translation Manager | It renders only server-side; `ct` does not harvest missing tokens |
| Seeding appears to do nothing | Only one of `initialTranslations` / `initialTranslationsLocale` passed — fails silently |
| Wrong locale served under load | `init()` called during SSR — module globals raced across requests |
| Catalog request 422s: "not a base or target locale" | A bare `es` where the project offers `es-CR`, or `supportedLocales` built from the global CLDR list |
| Empty catalog | The 422 above — search the console for `Langsys`; both the warning and the error print by default |
| Two catalog requests per load | Seeding missing, or more than 60 s between init and locale settle |
| Every page blank after adding a locale | Duplicate `hreflang` keys — dedupe by URL token |
| Every string renders as its category name | Stale SDK build inlined at deploy time — pin or verify `link:`/workspace deps |
| Hydration mismatch on `<html lang>` | Locale resolved differently on server and client — resolve once server-side |
| Key in the client bundle | Server fetch must use `$env/static/private` |

## Checklist

- [ ] Server fetch uses `$env/static/private`
- [ ] Locale resolved once server-side, through a precedence chain with an offerability check
- [ ] `supportedLocales` is the **project's** locale list, not `getLocalesFlat()`
- [ ] `detectPreferredLocale`'s own result is validated against that list before use
- [ ] `+layout.ts` carries flags only, not the catalog
- [ ] Both `initialTranslations` and `initialTranslationsLocale` passed
- [ ] `init()` inside `onMount`, never during SSR
- [ ] Ready gate seeded from the server, with an escape hatch
- [ ] Crawler-visible strings resolved from the catalog, not `$t`
- [ ] `hreflang` list deduplicated by URL token
- [ ] Verified **in a browser**, not with `curl`
- [ ] One catalog request in the network tab
- [ ] Read-only key in production
