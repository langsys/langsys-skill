# SSR — SvelteKit

Read [integrate/svelte.md](../integrate/svelte.md) first. This adds the server half.

> ## `t()` server-renders here once you seed the store in the layout body
>
> §2 is the step that does it: set `sTranslations` and `currentlyLoadedLocale` synchronously
> in the root layout's component body, and every `$t()` in the tree resolves during SSR. On
> SvelteKit this is the recommended path. It is safe because the default renderer cannot
> yield, and it is measured clean under concurrent load.
>
> **`<Phrase>` and `<Translate>` stay base-locale in server HTML no matter what you seed.**
> They translate by mounting onto rendered DOM in an effect, and effects don't run during
> SSR. Expect a residue of untranslated prose from them, and keep plain text out of them.
>
> [`langsys-js-server`](../core/server-sdk.md) is the alternative if you want request scoping
> as a structural property rather than conditions you maintain. It does not extend coverage:
> its 0.1.0 is `t()`-only too.

## 0. What this track actually delivers

**Read [core/rendering-mode.md](../core/rendering-mode.md) before this track.** The short version, because it is the thing most often misunderstood:

> **`init()` alone never populates the server render.** It runs in `onMount`, which doesn't run on the server. Passing `initialTranslations` to `init()` removes the second fetch and the flash, but the HTML is still base language. **The body seed in §2 is what makes `$t()` server-render.** `<Phrase>` and `<Translate>` stay base-locale either way.

What this track gives you: the server fetches the catalog once per request, §2 seeds it so `$t()` copy is translated in the served HTML, and `init()` takes over on the client with no second fetch.

For `<title>`, meta and Open Graph tags, also resolve directly from the fetched catalog with the pure function in [core/rendering-mode.md](../core/rendering-mode.md#resolve-crawler-visible-text-through-a-pure-catalog-function). That gives the one copy a crawler can't wait for a second path that doesn't depend on the store. §4 shows it.

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

## 2. Seed the store — in the component body, on both server and client

**This is the step that makes `t()` server-render.** `init()` alone cannot do it: it runs
in `onMount`, which never executes on the server and, on the client, lands *after*
hydration — so the browser hydrates base-locale text over whatever the server emitted.

```ts
// src/lib/langsys-seed.ts
import { sTranslations, currentlyLoadedLocale, LangsysApp } from 'langsys-js-svelte';
import { browser } from '$app/environment';

const EMPTY = {
    __uncategorized__: { __category__: '__uncategorized__', __symbol__: '__uncategorized__' },
};

export function seedTranslations(translations, locale) {
    // RESET on the miss path — never return early, and never store a nullish
    // catalog. Two reasons, both load-bearing:
    //  1. The store is a per-process singleton. Leaving it as-is renders THIS
    //     request in the PREVIOUS request's language, under this request's
    //     <html lang>, canonical and hreflang.
    //  2. `$t()`'s optional chain is on the SECOND hop — cats[cat]?.[phrase] —
    //     so a null/undefined catalog in the store throws on the first lookup
    //     instead of falling back. `load` returns null on a failed fetch; this
    //     branch turns that into an empty catalog so the store never holds null.
    if (!translations || !locale) {
        sTranslations.set(structuredClone(EMPTY));
        currentlyLoadedLocale.set(locale ?? '');
        console.error('[langsys] catalog missing; reset to base locale', { locale });
        return false;
    }

    // COPY before stamping markers. The loader's object is a shared cache entry and
    // is serialized into the client payload; mutating it in place edits both.
    const catalog = {};
    for (const [category, phrases] of Object.entries(translations)) {
        catalog[category] = { ...phrases, __category__: category };
    }
    catalog.__uncategorized__ ??= structuredClone(EMPTY.__uncategorized__);

    sTranslations.set(catalog);
    currentlyLoadedLocale.set(locale);

    // Browser-only bookkeeping. It suppresses a redundant client refetch; writing it
    // server-side mutates shared state for no benefit.
    if (browser) LangsysApp.Translations?.markLoaded?.(locale);
    return true;
}
```

```svelte
<!-- +layout.svelte — the call site is the rule, not a preference -->
<script lang="ts">
    import { untrack } from 'svelte';
    import { seedTranslations } from '$lib/langsys-seed';

    let { data, children } = $props();

    // Component BODY. Runs during SSR before any child renders, so t() resolves for
    // the whole tree; runs before hydration on the client. No `await` may precede it —
    // the render being synchronous is what stops another request interleaving.
    untrack(() => seedTranslations(data.initialTranslations, data.locale));
</script>
```

`untrack()` is there so Svelte 5 does not warn about reading `$props()` outside a closure;
reading the initial value is the intent.

> **The same placement closes a second, unrelated hazard.** `sTranslations` persists to
> localStorage and rehydrates at module load, *before* `init()` — and the persisted catalog
> carries no locale tag, so nothing can tell it is stale. Without a body seed, a correctly
> server-rendered `Hola` under `<html lang="es-ES">` is repainted as `Ciao` at hydration,
> destroying the SSR output this whole track exists to produce. With the body seed it is
> `Hola es-ES` and there is no flash at all, because the seed runs during the hydration
> render pass before any child reads. `init({ initialTranslations })` in `onMount` does not
> help — it runs after hydration, when the stale paint has already happened.
>
> One rule, two hazards: seed in the component body, and both the concurrency window and the
> stale-locale repaint close together.

**`init()` still runs**, unchanged, in `onMount` below. It owns key validation, the user
locale store and every subsequent locale change. The seed only front-runs the part the
first paint depends on.

Verified under load: 8 locales × 10 rounds, all in flight simultaneously against an
`adapter-node` production build — 80 responses, zero cross-request bleed.

> **In the default renderer the condition is structurally guaranteed, and there are two ways
> to break it:** seeding in a hook (below) and `experimental.async` (further below). Measured 2026-08-30 against published `langsys-js-svelte@3.6.10`, production
> `adapter-node` build, 8 locales × 10 rounds in flight, with a positive control proving the
> harness detects bleeds on Svelte (70/80 when deliberately broken).
>
> | Configuration | Wrong-language responses |
> |---|---|
> | Seed in `+layout.svelte` body, synchronous page | **0 / 80** (0/400 stressed, 0/70 with base locale excluded) |
> | `{#await}` between seed and read | **0 bleeds** — but see below |
> | Svelte 5 `experimental.async`, `await` in a parent, read in a child (separate 4-locale run) | **0 / 4**, which holds only for that shape; see below |
> | **Seed in `hooks.server.js`, `await resolve()` before render** | **70 / 80** |
>
> **Why Svelte is safe where React and Vue are not:** in the **default renderer**,
> `render()` from `svelte/server` returns a `RenderOutput` that is fully populated
> synchronously before control returns to the event loop. **No component-tree construction
> can put a suspension between the seed and a read** — `{#await}` renders its *pending*
> branch and never resolves server-side. So the condition is a property of the renderer, not
> of your codebase, and it survives refactors.
>
> ### ⚠ `compilerOptions.experimental.async` — the guarantee holds only in the default renderer
>
> Measured against Svelte 5.55.8, four locales rendering concurrently, module-global seed in
> a parent body. Flag verified genuinely on two ways: the compiled output opens with
> `import 'svelte/internal/flags/async'`, and the same source fails to compile without it.
>
> | Shape | flag | Wrong-locale |
> |---|---|---|
> | No `await` in the tree | off | 0 / 4 |
> | No `await` in the tree | on | 0 / 4 |
> | `await` in a **parent's** script, read in a **child** | on | 0 / 4 |
> | **`await` then read in the *same* script** | on | **3 / 4** |
>
> **The flag alone is not the trigger. The read landing after the await in the same closure
> is.** With an await in a parent, the compiler hoists it into `$$renderer.run([...])` and
> keeps walking children synchronously — so that row is genuinely safe. Put the read after
> the await in one script and it compiles into a gated continuation instead:
>
> ```js
> var $$promises = $$renderer.run([
>     () => deferred,
>     () => { word = sTranslations.get()?.Greeting?.Hello; }   // deferred — reads after the gap
> ]);
> ```
>
> **Row 4 is the way almost anyone would write it** — `const data = await something;` and
> then read. A layout that seeds in its body plus a page that awaits before reading *is*
> row 4. So with this flag on, SvelteKit stops being structurally safe and joins Nuxt's
> category: a safe shape exists, and the idiomatic one violates it.
>
> **Do not enable `experimental.async` with a module-global seed.** If you need it, use
> request scoping. And note the failures converge on whichever request seeded last rather
> than scattering, so sampling a few responses reads as a config error.


### ⛔ Seed in the component body — never in `hooks.server.js`

The one shape that breaks it looks completely idiomatic. A `handle` hook is exactly where a
SvelteKit developer puts per-request setup:

```js
// ❌ hooks.server.js — 70/80 responses in the wrong language
export async function handle({ event, resolve }) {
    seedTranslations(await getCatalog(event), event.locals.locale);
    return await resolve(event);   // ← await between the seed and every read
}
```

Anything that seeds server-side and then awaits before rendering has the window. The
component body is the only position with no await between it and the tree it feeds.

> **If you reproduce this, remove the layout seed first.** The first measurement of this
> scenario came back 0/80 and nearly reported hooks as safe — the test routes still inherited
> the root `+layout.svelte`, which re-seeded synchronously just before the render and masked
> the hook entirely. The tell was that all 8 seeds completed before any render, yet every
> render read its own locale, which is impossible with a shared singleton. **Leave a
> component-body seed in place and you will measure the safe path while believing you
> measured the dangerous one.**

### `{#await}` does not bleed, but it renders nothing

Zero contamination — because the `t()` read never happens on the server at all. Every such
response body is the pending branch. So `{#await}` and streamed `load` promises are safe
*and* invisible: **any copy that must reach a crawler cannot sit behind one.** That is the
same SEO conclusion this track already reaches, now with a second mechanism behind it.


## 2b. Client: `init()` on hydration

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

> **`init()` belongs in `onMount` — but not for the reason you may assume.** It is not `document is not defined`. Calling `init()` during SSR *works*, and then corrupts concurrent requests: `LangsysApp` is a module singleton whose catalog lives in module globals, so one request's locale overwrites another's mid-render. **A `typeof window` guard does not make server-side init safe.** The SDK has no request-scoped translator of its own. On the server, use the body seed in §2, or [`langsys-js-server`](../core/server-sdk.md) for real request scoping.

Three behaviors of the seeding path worth knowing, all verified against `langsys-js-typescript@0.6.5`:

- **Both parameters, or nothing happens.** The guard is `if (initialTranslations && initialTranslationsLocale)` with no `else` and no warning. Pass one alone and it is ignored with **no diagnostic at all** — not a gated one, none. Under `debug: true` you can only infer it from an *absence*: the line `Populated sTranslations with initial data for locale: …` never appears. Checking for a missing log line is the only signal there is.
- **`init()` mutates the object you pass it**, writing a `__category__` key into every category and adding `__uncategorized__` if absent. That object is your SvelteKit `data`. Do not hand it something frozen or shared.
- **The seeded no-refetch window is 60 seconds, not permanent.** A long-lived session that re-settles on the same locale later *will* fetch again. Correct behavior, surprising in a network tab.

## 3. Never gate rendering on translation readiness

**Nothing in the tree may be replaced by a loading or error state.** A "still loading
translations" spinner or a full-screen init error is *server-rendered* on any slow or
failed fetch — so the crawler indexes the spinner **as the page**, and visitors get an
overlay instead of the site. One flaky fetch becomes total content loss on every route at
once.

The trade never pays. A translation failure means text falls back to the base locale, and
in a phrase-keyed SDK **the phrase IS the base-locale copy**. That is a degraded page, not
a broken one. Gating converts a partial-translation problem into a no-content problem.

```svelte
<!-- ❌ failure replaces the document -->
{#if error}
    <FullScreenError />
{:else if !ready}
    <Spinner />              <!-- ← this gets indexed AS the page -->
{:else}
    <Site />
{/if}
```

```svelte
<!-- ✅ the site always paints; state is layered OVER it -->
{@render children()}

{#if dev && error}
    <DevBanner />            <!-- compiled out of production -->
{/if}
```

**If you move a failure banner behind `dev`, add a `console.error` on that branch.**
Otherwise the one signal meaning "the SDK is genuinely misconfigured" becomes write-only in
production. Hiding the banner from visitors is right; hiding the signal from the team is
not.

> **Changed 2026-08-30.** This section previously recommended a gate seeded from the server
> so it "never fires on the happy path". That is still a replacing gate, and it fires on
> exactly the unhappy path a crawler is most likely to hit. Overlay, never replace.

## 4. Crawler-visible text

With §2 in place `$t` resolves during SSR. For head tags, still read from the catalog directly. A wrong `<title>` or OG tag reaches crawlers and social unfurlers with no chance of client correction, so it deserves a second path that doesn't depend on the store:

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
        await LangsysApp.translationsLoadingPromise;   // settles on failure too
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
| `$t()` body copy is base language in `curl` output | Seed missing, misplaced (a hook, not the layout body), or reading the wrong `data` field. `ssr-i18n-check` in [verify.md](../verify.md) fails on this. `<Phrase>`/`<Translate>` copy staying base language is **expected** |
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
- [ ] Catalog seeded in the root layout's **component body**, never a `hooks.server.js` hook
- [ ] Seed's failure path **resets** the store; it never returns early
- [ ] `compilerOptions.experimental.async` is off
- [ ] No render gate that replaces the page; failure states overlay it
- [ ] Head tags resolved from the catalog directly
- [ ] `hreflang` list deduplicated by URL token
- [ ] `ssr-i18n-check` passes for a non-base locale, tested from a warm process as well as a cold one
- [ ] One catalog request in the network tab
- [ ] Read-only key in production
