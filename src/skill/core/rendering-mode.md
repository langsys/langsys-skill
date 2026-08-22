# Rendering mode: the decision before the SSR track

**Read this before any `ssr/` document.** It carries a fact about the JS SDKs that changes what SSR is *for*, and getting it wrong sends you down a track chasing something the SDK does not do.

## The fact that governs everything below

**In React, Vue and Svelte, the reactive primitives — `t()`, `$t()`, `<Phrase>`, `<Translate>` — render the base language during server rendering. Always.**

Not sometimes, not when misconfigured. The catalog lives in module-global signals that only `LangsysApp.init()` writes, `init()` runs in a client-only lifecycle hook (`useEffect` / `onMounted` / `onMount`), and those hooks do not run on the server. So the server emits your base-language text and the client swaps it after hydration.

`init()` cannot simply be moved to the server to fix this. `LangsysApp` is a hard module singleton and the catalog lives in module globals, so under a long-lived Node server one process serves every concurrent request: seeding those globals server-side is a **cross-request data race** — an in-flight `/de` render can observe `/it`'s catalog. Constructing your own `Translations` does not escape it either; its constructor subscribes to the same globals. **There is no request-scoped translator in the SDK.** (Verified against `langsys-js-typescript@0.6.5`; see [VERIFIED.md](../../VERIFIED.md).)

**PHP is the exception**, and the reason is structural: `translatePage($html)` post-processes finished HTML on the server, so PHP genuinely emits fully translated body copy. Everything in this document about base-language server output applies to the **JS frameworks only**.

## What that means for crawlers

| | Body copy from `t()`/`<Phrase>`/`<Translate>` | Strings you resolve from the fetched catalog | Realtime for humans |
|---|---|---|---|
| **SSR (JS)** | base language | **translated, current per request** | yes |
| **Prerendered (JS)** | base language | translated, build-time snapshot | yes, after hydration |
| **Client-only (JS)** | no HTML at all | n/a | yes |
| **PHP SSR** | **translated, current** | n/a | yes |

The second column is the one that matters, and it is the part most people miss. **The catalog is already on your server** — fetching it is what seeding requires. Nothing stops you from resolving a string against it directly during the render. That is a pure lookup, so it has none of the singleton's problems.

### Resolve crawler-visible text through a pure catalog function

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

Four lines, no globals, safe under concurrency, and it is the only way to put translated text in server HTML in a JS framework:

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

**Prerendering is not the trap I once described**, because it does not lose translated body copy: SSR never had it either. What it loses is freshness in the first column above — a phrase fixed today stays wrong in indexed head and SEO copy until the next build. If static is a hard constraint, prerender per locale and schedule rebuilds against translation updates.

**Client-only remains genuinely fine for an app.** No crawler, no seeding, no hydration reconciliation — one `init()`, one ready gate, done. The gate is what prevents the flash: render the loader, not the base language, until `init()` resolves.

## The in-between cases

**A marketing site in front of an app.** One deployment, two rendering needs. SSR the public routes with server-resolved head and hero copy; let the authenticated routes gate on a loader.

**A public app with thin marketing pages.** SSR or prerender just the landing routes; the app itself gates.

**Docs sites.** The strongest case for SSR — heavily indexed and frequently corrected — and also the strongest case for putting real work into the pure-catalog path, because the indexed body copy is the product.

## What to do with this

1. Decide public vs. app **before** opening an `ssr/` track.
2. Public → SSR, and resolve every crawler-visible string through the pure catalog function. The reactive primitives will not do it for you.
3. App → skip `ssr/` entirely. Gate on `ready` and move on.
4. Static-only constraint → prerender per locale; indexed head copy is as fresh as the last build.
5. **Verify in a real browser, never with `curl`.** Because body copy translates after hydration, `curl | grep` shows base language on a correctly working page *and* on a badly broken one. See [verify.md](../verify.md).

`scan` reports the deployment posture it detects, including whether the site is prerendered. It cannot tell you whether crawlers matter for your product. That part is yours.
