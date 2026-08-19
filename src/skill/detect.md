# Detection: build the integration profile

**Do this before touching code.** Write the profile down, then follow it. Guessing the framework or the env prefix produces work that has to be redone.

## Step 0 — Run `scan`

```bash
node ../bin/scan.mjs .          # or: npx langsys-scan .
```

`scan` performs steps 1–4 and 6 mechanically and prints the profile in the shape below. **Use it instead of the manual commands** — the manual steps remain here for when it cannot run, and as the explanation of what it is doing.

Two things it produces that the manual steps do not:

- **Conversion sites split by primitive** — how many `t()`, `<Phrase>`, and `<Translate>` sites, and how many carry a placeholder next to inline markup (the pluralization trap). This is the number that predicts how hard the job is.
- **A NOT EXAMINED section**, printed on every run including when empty. Read it. A total is only as complete as the skip list says it is.

`scan` cannot determine the **base locale** (step 5). That one is still yours.

## Step 1 — Framework

```bash
cat package.json 2>/dev/null | grep -E '"(react|vue|svelte|next|nuxt|@sveltejs/kit|@remix-run)"'
cat composer.json 2>/dev/null | grep -E '"(php|laravel/framework)"'
```

| Found | SDK | Track |
|---|---|---|
| `react` | `langsys-js-react` | [integrate/react.md](./integrate/react.md) |
| `vue` | `langsys-js-vue` | [integrate/vue.md](./integrate/vue.md) |
| `svelte` | `langsys-js-svelte` | [integrate/svelte.md](./integrate/svelte.md) |
| none of the above, but JS/TS | `langsys-js-typescript` | [integrate/vanilla-ts.md](./integrate/vanilla-ts.md) |
| `composer.json` | `langsys/langsys-php` | [integrate/php.md](./integrate/php.md) |

Both a JS framework and PHP? They are separate integrations sharing one project. Do the frontend first.

## Step 2 — Meta-framework → does SSR apply?

| Dependency | SSR track |
|---|---|
| `next` | [ssr/nextjs.md](./ssr/nextjs.md) — determine App Router (`app/`) vs Pages Router (`pages/`) |
| `nuxt` | [ssr/nuxt.md](./ssr/nuxt.md) |
| `@sveltejs/kit` | [ssr/sveltekit.md](./ssr/sveltekit.md) |
| `@remix-run/*` | [ssr/nextjs.md](./ssr/nextjs.md) — same seeding pattern |
| vite only, no meta-framework | none — client-only SPA |
| PHP | [ssr/php.md](./ssr/php.md) — server rendering is the default mode |

## Step 3 — Bundler → env prefix

**The most common silent misconfiguration.** Get this from the build tool, not from the framework:

| Signal | Prefix |
|---|---|
| `vite.config.*` | `VITE_` |
| `@sveltejs/kit` | `PUBLIC_` (via `$env/static/public`) |
| `next.config.*` | `NEXT_PUBLIC_` |
| `nuxt.config.*` | `NUXT_PUBLIC_` |
| `react-scripts` | `REACT_APP_` |
| server-only / Node | none |

Full table: [core/secrets.md](./core/secrets.md).

## Step 4 — Existing i18n → integrate or migrate?

```bash
grep -E '"(i18next|react-i18next|next-intl|react-intl|vue-i18n|svelte-i18n|@inlang/paraglide-js|@formatjs/[a-z-]+)"' package.json
ls -d locales/ public/locales/ src/locales/ messages/ lang/ resources/lang/ 2>/dev/null
grep -rl "__(\|trans(\|gettext(" --include="*.php" . 2>/dev/null | head
```

| Found | Route |
|---|---|
| nothing | **Integrate** track |
| `i18next` / `react-i18next` | [migrate/i18next.md](./migrate/i18next.md) |
| `react-intl` / `@formatjs/*` | [migrate/react-intl.md](./migrate/react-intl.md) |
| `vue-i18n` | [migrate/vue-i18n.md](./migrate/vue-i18n.md) |
| `next-intl`, `svelte-i18n`, Paraglide, Laravel `__()`, gettext | [migrate/_method.md](./migrate/_method.md) — no dedicated track yet; apply the method and proceed carefully |

Catalog files but no library? Still a migration — the strings are your input.

## Step 5 — Base locale

In order of preference:

1. Existing i18n config (`fallbackLng`, `defaultLocale`, `locale`)
2. `<html lang="...">`
3. **Ask.** Do not assume `en-US` — `en-GB` and `en-US` are different catalogs.

## Step 6 — String inventory

`scan` does this properly. Fall back to a rough count only if it cannot run:

```bash
ast-grep --lang tsx -p '<$TAG>$TEXT</$TAG>' src/ 2>/dev/null | wc -l
```

That fallback gives an order of magnitude and nothing else — it cannot tell a `t()` site from a `<Phrase>` site, and the primitive split is the part that predicts effort. Treat it as a floor, not an inventory.

---

## The profile

Record before proceeding:

```
Framework:        React 18
Meta-framework:   Next.js (App Router)   → SSR track applies
Bundler prefix:   NEXT_PUBLIC_
Existing i18n:    none                   → integrate
Base locale:      en-US
Scale:            412 sites — 287 t(), 44 attribute, 68 <Phrase>, 13 <Translate>
                  331 mechanical / 69 judgment / 12 human
Hot spots:        src/components (244), src/app (98)
Package:          langsys-js-react
Tracks:           integrate/react.md + ssr/nextjs.md
```

**The `human` bucket is the schedule risk**, not the total. Those are sites where a count sits next to the noun it inflects, a phrase is built by concatenation, or a namespaced key needs its source text recovered from the base-locale catalog. Each needs a decision no tool can make.

## Then

1. Run `doctor` — verify env, key type, and SDK/runtime versions
2. Read [core/choosing-primitives.md](./core/choosing-primitives.md) and [core/invariants.md](./core/invariants.md)
3. Follow the routed track
4. Verify with [verify.md](./verify.md)
