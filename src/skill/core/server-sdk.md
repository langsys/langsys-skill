# `langsys-js-server` — translated HTML on the server

**Use this when a public site needs crawler-visible translated body copy.** For an app behind a
login, skip it — see [rendering-mode.md](./rendering-mode.md).

```bash
npm install langsys-js-server
```

Verified against the published `langsys-js-server@0.1.0` tarball, installed from the registry.

> **0.1.0 has no provenance attestation.** It was published outside CI. Do not tell anyone to
> verify one; later releases will have it.

## Why it exists

In React, Vue and Svelte, `t()` / `<Phrase>` / `<Translate>` render the **base language** during
SSR — `init()` runs in a client-only hook and the catalog lives in module globals only it writes.
Seeding does not change that; it removes the flash and the second fetch. This package puts a
**request-scoped** catalog on the server so `t()` resolves during the render.

## What 0.1.0 does and does not do

| Primitive | Server-rendered | A crawler receives | How you would notice if it were wrong |
|---|---|---|---|
| `t()` | **yes** | **translated** | — |
| `<Phrase>` | no | base language | `auditRenderedHtml()` lists it — the marker is in the markup |
| `<Translate>` | no | base language | **Nothing signals it by default.** The host carries no marker, so the audit cannot see it. Use view-source, or pass `contentBlockAttributes` if your app marks its own hosts |

**That third column is the point.** A limitation nobody can detect is indistinguishable from
working, which is the failure this whole family keeps producing. `<Phrase>` and `<Translate>`
server rendering is 0.2.0.

## The shape

```ts
import { createLangsysServer, t } from 'langsys-js-server';

const langsys = createLangsysServer({
    projectId: process.env.LANGSYS_PROJECT_ID,
    apiKey: process.env.LANGSYS_API_KEY,   // READ-ONLY in production
    baseLocale: 'en-US',
    cache: sharedCache,                     // see below — required for multi-worker
});

const result = await langsys.run({ locale }, () => render());
// result.value    the render's return
// result.catalog  hand to the client SDK to seed hydration
// result.missing  LIVE view of the miss queue
```

Four methods: `run()`, `flush(result)`, `preloadCatalog(locale)`, `invalidate(locale)`.

## Four things that are wrong by default if you guess

**1. Wrap `resolve()` in the framework's request hook, not a layout.** `load` functions run
*before* layout components, and `load` is exactly where `<title>`, meta and OG copy are built —
the indexed strings that motivate the package. A layout-scoped `run()` leaves them outside the
scope, rendering base language. **`t()` outside a scope does not throw** — it returns the base
phrase and warns — so a too-narrow scope fails quietly and looks fine in the base locale.

**2. `result.missing` is a live view, not a snapshot.** A streamed body keeps calling `t()` after
`run()` resolves; those phrases resolve correctly and land in the array afterwards. **Copy it if
you intend to hold it.** Late misses schedule their own drain and are not dropped.

**3. `flush(result)` needs the actual `RenderResult`.** It carries a private symbol pointing at
the scope that rendered. A shallow copy survives — `{...result}` copies symbol keys — but a
hand-built object from the public fields gets a fresh drain latch, and the edge path
(`run()` then `ctx.waitUntil(flush(result))`) then **POSTs the same queue twice** against a shared
catalog. That pollution is permanent.

**4. `preloadCatalog(locale)` exists for hook ordering.** Any host with a "set locals, then
render" shape needs the catalog **before** the render, not from the result. Assigning after
`await resolve(event)` means the hand-off never happens and the payload serialises `undefined`.

## Operational

**Pass a `cache` in any multi-worker deployment.** Two workers mean two independent catalogs, so
during propagation the same URL alternates between old and new copy depending on which answers —
which reads to a non-engineer as *"my change didn't save"*. The package warns if you omit it, but
**on the first `run()` or `preloadCatalog()`, not at construction** — the warning lives in the
catalog-resolution path. Close to boot in practice; not in your boot logs.

**A shared cache must never be an availability dependency.** Reads, writes and deletes are all
guarded; a dropped Redis connection logs and falls through to the API rather than 500-ing every
SSR request on every worker.

**Catalogs are cloned per request**, because the client SDK's `init()` mutates the catalog it is
given and you are told to pass it there.

**Harvesting requires a write key**, so development only. With a read-only key the package refuses
locally and says so — server-rendered phrases will not self-register, which is the **correct**
production configuration, not a misconfiguration to fix.

> **That message comes from the post-response drain, so it appears only when a phrase was actually
> missing.** A fully-translated page is silent — and that silence tells you nothing about your key.
>
> Three different states produce no warning: a read-only key with nothing missing, a write key with
> nothing missing, and a read-only key on a page that happened to resolve everything. **Absence is
> not an all-clear.** To check a key deliberately, render a phrase you know is unregistered and
> watch for the refusal.

Measured against `0.1.0`: no warning at construction; the cache warning on the first `run()`; the
harvest refusal only on a render that misses.

## Verify

Two checks, both cheap:

```bash
curl -s https://yoursite/it | grep -c 'known Italian phrase'   # counts BYTES, valid here
node -e "import('langsys-js-server').then(m=>console.log(m.auditRenderedHtml(html)))"
```

`curl` is valid for this one specific thing — **counting bytes in the served HTML** — because that
is the property being tested. It remains invalid for judging whether translation works, since
client-side translation happens after hydration. See [../verify.md](../verify.md).

`auditRenderedHtml(html)` lists every element still carrying a phrase marker, so *"which of my
copy is still base language"* is a list rather than an inference. It is a development aid and is
not called automatically — a parse in the TTFB path for a build-time question would be the wrong
trade.
