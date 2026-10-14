# Rendering mode: the decision before the SSR track

**Read this before any `ssr/` document.** It carries a fact about the JS SDKs that changes what SSR is *for*, and getting it wrong sends you down a track chasing something the SDK does not do.

## The fact that governs everything below

**`t()` server-renders correctly once the catalog is seeded. `<Phrase>` and `<Translate>`
never do, and no seeding changes that.** The split is not about configuration; the two
groups work by different mechanisms.

| Construct | Mechanism | Server-renders? |
|---|---|---|
| `t()` / `$t()` | function call, reads the catalog store | **Yes** — once seeded |
| `<Phrase>` | effect mounts a rich-text handler onto the DOM | **No** |
| `<Translate>` | effect mounts a DOM walker that rewrites text | **No** |

`<Phrase>` and `<Translate>` translate by mounting onto an element that has already
rendered and rewriting its text. **Effects do not run during SSR.** The mechanism requires
a DOM that does not exist yet, so these emit base-locale children on the server no matter
what you seed. This is a structural limit, not a bug, and it is scheduled for a server
path in `0.2.0`.

`t()` is different, and this is the part the skill previously got wrong. The catalog lives
in a module-global signal — but that signal is **publicly settable**, and setting it
during the render makes `t()` resolve for the whole tree:

```ts
import { sTranslations, currentlyLoadedLocale } from 'langsys-js-svelte';
sTranslations.set(catalog);          // Signal<iCategories>.set()
currentlyLoadedLocale.set(locale);   // Signal<string>.set()
```

The SDK documents this path itself, in the JSDoc for `Translations.markLoaded`:

> *"Record that a locale's catalog is already present without fetching — e.g. after an SSR
> handoff seeds `sTranslations` + `currentlyLoadedLocale`."*

Verified against `langsys-js-typescript@0.6.5`: `Signal<T>` exposes `set()`, `get()` and
`update()`, and `sTranslations` / `currentlyLoadedLocale` are re-exported by all three
framework SDKs.

> **Correction, 2026-08-30.** This document previously stated that all four primitives
> render base language during SSR "always", and that seeding the globals server-side was a
> cross-request data race with no safe path. The first half was false for `t()`. The store
> genuinely is shared mutable state — but the render is synchronous, which closes the
> window, and the conditions for keeping it closed are stateable (see below). The error was
> found in production: seven sites served **byte-identical** HTML on every localized route,
> and Google folded them into one cluster. See [VERIFIED.md](../../VERIFIED.md).

### The four conditions that keep seeding safe

The store is a per-process singleton shared across every request. It is safe to seed only
under all four of these. Breaking any one is a live defect, not a style problem.

1. **Seed synchronously from the component body** of the root shell — never from
   `onMount` / `useEffect` / `mounted`. Those never run on the server at all, and on the
   client they land *after* hydration, so the browser hydrates base-locale text over
   localized markup.
2. **The seed and every `t()` read must occur in one uninterrupted synchronous execution.**
   Nothing may suspend in between. This is a constraint on the whole subtree, not on the
   line you write — if another request can interleave between the seed and the read, the
   shared singleton hands it the wrong catalog. Measured: **70 of 80** concurrent React
   responses and **65–72 of 80** Vue responses came back in the wrong language with a
   suspension in that position; move it out and the same renderer is clean 80/80.

   **What differs between frameworks is how you can violate it, not the rule itself:**

   | Framework | How the rule gets broken | Can a caller avoid it? |
   |---|---|---|
   | **Svelte** | Seeding **outside** the render pass — a `handle` hook that then `await`s `resolve()`, measured **70/80**. Or `compilerOptions.experimental.async` **plus a read after an await in the same script** — measured **3/4**, and that is the shape most people write. | **Yes, in the default renderer.** `render()` returns a `RenderOutput` that is fully populated synchronously, so no component-tree construction — `{#await}` included — can put a suspension between seed and read |
   | **React / Vue** | Any suspension inside the tree between seed and read | Only by inspecting the whole subtree, with nothing reporting a violation |
   | **Next App Router** | Not this rule at all — separate module graphs | **No.** Non-functional; see below |

   > **This is why Svelte is permitted and the others are not.** Not because Svelte is
   > better written, but because its renderer cannot yield, so the condition is a structural
   > guarantee rather than a property you have to keep re-verifying after every refactor.
3. **The failure path must RESET, never return early.** This is the subtle one. An early
   return on a failed catalog fetch reads as a harmless no-op; it is not, because the
   singleton still holds *the previous request's* catalog. Serve `/it`, then have `/es`
   time out, and the Spanish page renders in Italian under `<html lang="es">` with Spanish
   canonical and `hreflang` — confidently mislabelled content, which is worse than
   untranslated. **When a store is process-global, not writing is a decision, not an
   abstention.**
4. **Keep write-side bookkeeping browser-only** — cache timestamps, "already loaded" marks.
   It exists to suppress a redundant client refetch; writing it server-side mutates shared
   state for no benefit.

Also **copy the catalog before normalizing it.** The loader's object is usually a shared
cache entry *and* is serialized into the client payload; stamping category markers onto it
in place edits the server's cache for every later request.

### Framework scope — measured, 2026-08-30

Published tarballs, production builds, 8 locales × 10 rounds all in flight:

| Framework | Configuration | Wrong-language responses |
|---|---|---|
| Svelte | seed in `+layout.svelte` body, synchronous tree | **0 / 80** (0/400 stressed) |
| Svelte | `{#await}` between seed and read | **0 bleeds** — but renders nothing; see below |
| Svelte | seed in `hooks.server.js`, `await resolve()` before render | **70 / 80** |
| React | `renderToString` | **0 / 80** |
| React | `renderToPipeableStream`, synchronous tree | **0 / 80** |
| React | streaming, suspension **between** seed and read | **70 / 80** |
| React | streaming, seed moved **inside** the suspended subtree | **0 / 80** |
| React | **App Router / RSC**, concurrency **1** | **100% of non-base locales** |
| Vue | synchronous `setup()` | **0 / 80** (and 0 / 400) |
| Vue | `async setup()` between seed and read | **65–72 / 80** |
| Vue | `<Suspense>` around an **async** child | **68 / 80** |
| Nuxt 3 | `app.vue` setup, before any await | **0 / 80** |
| Nuxt 3 | page inside `<NuxtPage>` Suspense, **synchronous** page | **0 / 80** |
| Nuxt 3 | `app.vue` setup, after `await useAsyncData` | **67 / 80** |
| Nuxt 3 | page inside Suspense, after `useAsyncData` | **71 / 80** |

**The renderer is not the variable — the await point is.** Streaming is safe when the seed
and the reads share a synchronous block; a synchronous renderer is unsafe when they do not.

**App Router is a different failure and deserves different words.** It is not a race: the
Server Component and the Client Component hold *separate module instances* of the binding,
so the seed lands in a graph the reader is not in. Every non-base locale renders base
content with one request in flight. Calling that "unsafe under concurrency" understates it
and wrongly implies low traffic makes it fine. **Non-functional by construction.**

**A Suspense boundary is not itself the hazard.** Wrapping a *synchronous* child is clean
at 80 concurrent; the Nuxt rows prove it. What breaks the pattern is an await between the
seed and the read, wherever it sits and whatever put it there. **There is one rule, and it
is the same in all three frameworks** — the frameworks differ only in how likely you are to
violate it, and in whether you can guarantee you have not.

- **SvelteKit** — permitted, and in the **default renderer** the condition is structurally
  guaranteed rather than merely satisfiable. Two ways to lose it, both in
  [ssr/sveltekit.md](../ssr/sveltekit.md): seeding outside the render pass (`hooks.server.js`),
  and turning on `compilerOptions.experimental.async`.
- **Nuxt** — a clean result was measured for reads in `app.vue` setup above any await,
  but with the seed in a Nitro hook, which bled on SvelteKit, so it's unexplained and
  unconfirmed. Even taken at face value it collapses the moment anyone writes
  `await useAsyncData`, which is how Nuxt apps fetch. Unsafe *in practice*, not
  structurally forbidden. Recommend request scoping.
- **Next Pages Router / `renderToString`** — safe by idiom, not architecture.
  `getServerSideProps` fetches before render, so the usual shape has no await between the
  body seed and the reads. Put an `await` in the render and it bleeds like anything else.
- **Next App Router** — a different failure entirely; see below.

Those needing request scoping want `langsys-js-server`, `AsyncLocalStorage`, or the pure
catalog function — not a relocated seed. See [ssr/nextjs.md](../ssr/nextjs.md) and
[ssr/nuxt.md](../ssr/nuxt.md).

> **It converges — it does not scatter.** Every suspended request resumes after the others
> have seeded, so they all read the *same* last writer. The result is a near-uniform wrong
> language, not sporadic corruption: 70 of 80 wrong, from a single source. An operator
> sampling a few responses sees one consistent wrong language, which reads as a **config
> error rather than a race** — so the instinct is to check env vars, find nothing, and move
> on. Budget for that when diagnosing.

> **StrictMode was tested and is a non-issue.** 80 component-body invocations for 80
> requests; no server-side double-render in production. Recorded so it is not re-litigated.

**PHP is the exception to all of the above**, and the reason is structural:
`translatePage($html)` post-processes finished HTML on the server, so PHP genuinely emits
fully translated body copy with none of these conditions to manage.
## What that means for crawlers

| | `t()` body copy | `<Phrase>` / `<Translate>` body copy | Realtime for humans |
|---|---|---|---|
| **SSR (JS), seeded** | **translated, current per request** | base language | yes |
| **SSR (JS), not seeded** | base language | base language | yes |
| **Prerendered (JS)** | translated, build-time snapshot | base language | yes, after hydration |
| **Client-only (JS)** | no HTML at all | no HTML at all | yes |
| **PHP SSR** | **translated, current** | **translated, current** | yes |

**Row two is the failure this document exists to prevent.** An unseeded SSR app is not
subtly degraded — it serves every localized route with a byte-identical base-locale body.
Google reads those as duplicates of one another, folds them into a single cluster, and
keeps one arbitrary representative. More locales means more identical copies competing, so
the damage scales with exactly the thing you were trying to grow.

The second column is the residue you cannot seed away. Measured on a production platform
after seeding landed: **4–24% of prose per page** remained base-locale, all of it inside
`<Phrase>` and `<Translate>`. Treat that as the honest ceiling of an SSR-first integration
today, and state it up front rather than letting someone discover it in a search result.

**Do not wrap plain text in `<Translate>`.** On that same platform, 21 of 60 `<Translate>`
blocks held no markup at all — invisible to crawlers for no benefit, and each one movable
to `t()` for free, since the catalog key is the same and existing translations carry over.
Reach for the markup-bearing components only when a run genuinely contains inline markup.

### Resolve crawler-visible text through a pure catalog function

> **Rank depends on the framework, as of 2026-08-30.** On **SvelteKit**, prefer **seeding
> the store** (above): free, no dependency, every existing `t()` call site server-renders
> with no rewrite. On **React App Router and Nuxt, this helper ranks FIRST** — seeding doesn't
> work on App Router and isn't recommended on Nuxt, and a pure function is immune to both failure modes by construction: it
> holds no module state, so there is no singleton to leak across requests and none to land
> in the wrong module graph. Prefer **[`langsys-js-server`](./server-sdk.md)** over this helper if you want
> request scoping as a structural property rather than as four conditions you must not
> violate, plus harvesting for server-only phrases.
>
> The honest trade between the first two: **seeding is free but fragile** — the four
> conditions above are invariants you own — while the **server SDK costs a dependency and
> buys structural safety**. Neither extends coverage to `<Phrase>` / `<Translate>`; nothing
> does before `0.2.0`.
>
> Keep reading only if you want head-tag resolution that does not depend on the reactive
> store at all. **That remains genuinely worth doing even after seeding** — `<title>`, meta
> and OG copy are the one place a wrong string reaches crawlers and social unfurlers with no
> chance of client-side correction, and a direct catalog read is a second independent path
> to a correct head for about one line. See R4 in the SSR tracks.

> **Superseded by `langsys-js-server`.** The hand-rolled helper below covers plain strings only —
> no `<Phrase>`, no `<Translate>` — so indexed copy containing an `<em>` or an inflected count is
> still base language. It also does not harvest, so the strings it renders never reach the
> catalog. **Prefer [server-sdk.md](./server-sdk.md).**
>
> Keep reading only if you cannot add a dependency. Migrating off it is a delete-and-reimport —
> `t()` is signature-compatible — with **one behavioural surprise**: the helper does not harvest
> and the package does, so a deployment that has run this over its SEO copy for months will see a
> **burst of new registrations on first deploy**. That is the feature working. Do the first deploy
> with a read-only key if you want to see the volume before committing to it.

Four lines, no globals, safe under concurrency, and it works in every JS framework, including the two where seeding the store doesn't:

```ts
import { interpolate } from 'langsys-js-typescript';

/**
 * One request's catalog and locale in, a TFunction-shaped translator out.
 * Reads and writes no module state, so it is safe under concurrency.
 *
 * Mirrors the SDK's own buildTFn exactly, minus missing-token harvesting:
 *   - same argument overloads: (phrase), (phrase, category), (phrase, params),
 *     (phrase, category, params)
 *   - same string guard — a content block is an OBJECT, so `|| phrase` is not
 *     enough to fall back correctly
 *   - same interpolation, through the SDK's exported `interpolate` (pure)
 */
export function makeCatalogT(catalog, locale) {
    return (phrase, ...rest) => {
        const category = typeof rest[0] === 'string' ? rest[0] : '';
        const params   = typeof rest[0] === 'object' ? rest[0] : rest[1];

        const value = catalog?.[category || '__uncategorized__']?.[phrase];
        const translated =
            typeof value === 'string' && value.length > 0 ? value : phrase;

        return params ? interpolate(translated, params, locale) : translated;
    };
}
```

**Do not simplify this to a raw lookup.** A `catalog[cat]?.[phrase] || phrase` one-liner is wrong in three ways that all render as plausible text rather than as errors:

- **It drops interpolation.** `t('Hello {name}', { name: 'Ada' })` would server-render the literal `Hello {name}`, and ICU forms like `{count, plural, ...}` would render as raw source — then interpolate correctly on the client. A hydration mismatch on exactly the strings that carry data.
- **`|| phrase` does not guard the object case.** A catalog entry can be a content block, i.e. an object; the SDK checks `typeof value === 'string' && value.length > 0` for that reason.
- **It is not `TFunction`-shaped**, so it cannot stand in for `t()` / `$t` without rewriting every call site.

Pass the **request's** locale to `interpolate`, never the SDK's `currentlyLoadedLocale` — reading that global is the coupling this function exists to avoid.

> **Server-only phrases do not self-register.** The SDK harvests missing tokens inside `t()`; a pure translator deliberately does not, because a process-global flush queue would reintroduce the cross-request coupling. So a phrase that renders *only* server-side — a meta description, a PDF, an email — is never discovered, even though it renders every request. Register it by exercising it once client-side in development with a write key, or add it in the Translation Manager by hand.

The fallback to `phrase` matches what `t()` does before a catalog loads: a translation outage degrades to base language, never to a blank page.

Use it for everything a crawler or a social scraper reads and JavaScript never fixes in time:

- `<title>`, `<meta name="description">`, Open Graph and Twitter card fields
- `<h1>` and the copy you actually want indexed
- anything rendered into a PDF, an email, or a feed

Use the reactive primitives for everything else. They are correct for interactive UI; they are simply not a server-rendering tool.

> **Social scrapers never run your JavaScript at all.** Facebook, Slack, LinkedIn and iMessage read the served HTML once and stop. For those, the server-resolved head is not an optimization — it is the only thing they will ever see.

## So: SSR or not?

> **Do crawlers matter for this app?**

Still the right question, still a product question — but answer it knowing what each mode actually buys.

| | Public website — marketing, docs, storefront, blog | Application — behind a login, or a tool |
|---|---|---|
| **Lean** | **SSR** | **Client-only, with a ready gate** |
| Why | A current catalog on every render, and one client fetch instead of two | No crawler, so there is nothing to serve HTML for |

**SSR is still the right default for a public site.** The reasons are narrower than "the crawler sees translated markup", and they are real:

1. Server-resolved strings are rendered against a **current** catalog per request, not a build-time snapshot.
2. The client is seeded, so there is one catalog fetch instead of two, and no flash.
3. Per-request locale resolution — cookie, header, URL — works at all.

**Prerendering should keep seeded `t()` copy**, since it renders through the same SSR path. That's reasoned, not measured here, so check the built HTML with `ssr-i18n-check`. Like SSR, it never has `<Phrase>`/`<Translate>` copy. What it loses is freshness — a phrase fixed today stays wrong in indexed head and SEO copy until the next build. If static is a hard constraint, prerender per locale and schedule rebuilds against translation updates.

**Client-only remains genuinely fine for an app.** No crawler, no seeding, no hydration reconciliation — one `init()`, one ready gate, done.

> **The pre-`init()` flash is not base language — it is the locale the user previously
> viewed.** `sTranslations` is `persist('translations', …)`, i.e. localStorage, so the store
> rehydrates from whatever locale that browser last loaded. Measured 2026-08-30 by sampling
> the DOM every 60ms: with a prior `fr-FR` visit, loading `/de-DE` renders **"Bonjour" for
> 180–240ms** before flipping to "Hallo". On a locale switcher — the single most likely
> navigation — the user watches the language they just left.
>
> Two consequences. **This is the strongest argument for the ready gate in an app**, because
> the thing it hides is wrong content rather than merely untranslated content. And it is a
> reason not to sell `init({ initialTranslations })` as removing the flash: the seed sits
> behind `await LangsysAppAPI.validate()` (measured 405–490ms; treat the number as
> environment-specific, the structure as the point), so data already in hand still waits on a
> network round-trip.
>
> **Root cause, confirmed at source.** `sTranslations` is `persist('translations', …)` and
> reads localStorage at *module load*, before any `init()`. `currentlyLoadedLocale` is a
> plain signal and is **not** persisted. So the stored catalog carries **no locale tag** —
> nothing downstream can tell that it is stale, or which locale it belongs to. That asymmetry
> is the whole defect.
>
> **On a seeded SSR page it is worse than a flash: it destroys correct server output.**
> Measured on SvelteKit — server HTML correctly reads `Hola` under `<html lang="es-ES">`,
> then localStorage wins at module load and hydration repaints `Ciao`, the previously viewed
> locale, until `init()` lands. A crawler that executes JavaScript sees the stale language.
> Server-rendering the right language and then replacing it is worse than never having
> server-rendered it, for exactly the audience the seeding was for.
>
> **The component-body seed closes it** — one placement, two hazards. Because the seed runs
> during the hydration render pass, before any child reads, it overwrites the stale persisted
> catalog before anything can render from it. Measured: without a body seed, hydration paints
> `Ciao`; with it, `Hola es-ES` and **no flash at all**.
>
> **`init({ initialTranslations })` in `onMount` / `useEffect` does NOT fix this**, because
> those run *after* hydration — the stale paint has already happened.
>
> **Not framework-specific** — it is `persist()` plus init sitting behind an await. Note that
> the client has **no cross-request concurrency hazard** (one browser, one user), so the
> reasons not to seed on the React and Vue *servers* don't automatically apply to a
> client-side body seed. Whether that closes the flash there is **untested** — do not assume it does.

The gate is what prevents that flash: render the loader, not the stale locale, until `init()` resolves. **On a public, crawler-visible route the gate is prohibited instead** — a server-rendered spinner gets indexed as the page. See the SSR tracks.

## The in-between cases

**A marketing site in front of an app.** One deployment, two rendering needs. SSR the public routes with server-resolved head and hero copy; let the authenticated routes gate on a loader.

**A public app with thin marketing pages.** SSR or prerender just the landing routes; the app itself gates.

**Docs sites.** The strongest case for SSR — heavily indexed and frequently corrected — and also the strongest case for putting real work into the pure-catalog path, because the indexed body copy is the product.

## What to do with this

1. Decide public vs. app **before** opening an `ssr/` track.
2. Public → SSR. On SvelteKit, seed the store in the layout body so `t()` server-renders. On Next App Router or Nuxt, resolve crawler-visible strings through the pure catalog function or `langsys-js-server`. Either way, resolve head tags from the catalog directly.
3. App → skip `ssr/` entirely. Gate on `ready` and move on.
4. Static-only constraint → prerender per locale; indexed head copy is as fresh as the last build.
5. **Which check works depends on whether server HTML is meant to be translated.** If it is (seeded SvelteKit, the pure function, `langsys-js-server`), `curl` is the check that matters: run `ssr-i18n-check`. If it isn't (client-only), `curl` shows base language whether the app works or not, so open a browser. See [verify.md](../verify.md).

`scan` reports the deployment posture it detects, including whether the site is prerendered. It cannot tell you whether crawlers matter for your product. That part is yours.
