# Rendering mode: the decision before the SSR track

**Read this before any `ssr/` document.** It applies to every framework — Next.js, Nuxt, SvelteKit, PHP — because the reasoning is about Langsys, not about the framework.

## The one question

> **Do crawlers matter for this app?**

That is the whole decision, and it is a product question, not a technical one.

| | Public website — marketing, docs, storefront, blog | Application — behind a login, or a tool |
|---|---|---|
| **Lean** | **SSR** | **Client-only, with a ready gate** |
| Why | Crawlers must see translated text, and see it *current* | No crawler, so there is nothing to serve HTML for |

## Why SSR for anything public

Langsys is a **realtime** translation manager: someone fixes a phrase in the Translation Manager and the change is live. Whether that property survives depends entirely on where the HTML comes from.

| Mode | Crawler sees translated HTML | Crawler sees *current* translations | Realtime for humans |
|---|---|---|---|
| **SSR** | yes | **yes** | yes |
| Prerendered / static | yes | **no — a build-time snapshot** | yes, after hydration |
| Client-only | **no** | n/a | yes |

**Only SSR gives you both.** Every request renders against the current catalog, so a translation fixed five minutes ago is in the HTML a crawler fetches now.

### Prerendering is the trap, because it looks like it works

A prerendered site *does* emit translated HTML, so it passes the obvious check. What it emits is a snapshot from build time.

The client SDK then re-fetches after hydration and corrects the page — so **a human visitor sees current text and nothing looks wrong**. The crawler does not run your JavaScript on that schedule; it indexed the snapshot. So:

- a mistranslation fixed today is still in search results next month
- adding a locale requires a rebuild and re-crawl before it exists to anyone searching
- nobody reports it, because every human who looks at the page sees the corrected version

That is a silent staleness with the same signature as the other failures this skill exists to prevent: correct in the case you check, wrong in the case that matters.

**If the site must be static** — no runtime available, a CDN-only host, an existing pipeline — prerendering per locale is still far better than client-only, and the SSR track's seeding mechanism works unchanged at build time. Just schedule rebuilds against translation updates, and know that your indexed content is only as fresh as your last build.

## Why client-only is genuinely fine for an app

Behind a login there is no crawler, so serving translated HTML buys nothing. Client-only is **simpler, and loses none of the realtime property**:

- one `init()` high in the tree
- a ready gate — a loader — until `init()` resolves
- no seeding, no hydration reconciliation, no locale mismatch between server and client

The flash-of-untranslated-content problem that SSR seeding exists to solve is handled by the gate: render the loader, not the base language, until translations are in. Do not skip the gate and let the base language paint first — that is the FOUC the seeding docs are about, reintroduced by hand.

This is a real simplification, not a compromise. Reach for the SSR track when crawlers matter; otherwise the loader is the right answer.

## The in-between cases

**A marketing site in front of an app.** These are usually one deployment and two rendering needs. SSR the public routes; the authenticated routes can gate on a loader. Do not force one mode across both.

**A public app with thin marketing pages** — a dashboard with a landing page. Prerender or SSR just the landing routes; the app itself gates.

**Docs sites.** Almost always the strongest case for SSR: heavily indexed, frequently corrected, and the corrections are exactly what you want crawlers to pick up.

## What to do with this

1. Decide public vs. app **before** opening an `ssr/` track.
2. Public → SSR. Read the matching `ssr/` document and follow it as written.
3. App → skip `ssr/` entirely. Gate on `ready` and move on.
4. Static-only constraint → prerender per locale, and be explicit with whoever owns the site that indexed translations are as fresh as the last build.

`scan` reports the deployment posture it detects, including whether the site is prerendered. It reports what is there — it cannot tell you whether crawlers matter for your product. That part is yours.
