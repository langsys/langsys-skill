---
name: langsys
description: Integrate the Langsys translation SDK into a project, or migrate a project from i18next/react-intl/vue-i18n onto Langsys. Use for any request about adding translations, internationalization, i18n, l10n, localization, multi-language support, or the langsys-js-react / langsys-js-vue / langsys-js-svelte / langsys-js-typescript / langsys-php SDKs.
---

# Langsys integration

Langsys is a realtime translation manager. Phrases are discovered from your running app — **the source text is the key**, so there are no catalog files in your repo.

If you know i18next, react-intl, or vue-i18n, several of your instincts are wrong here. Read [core/invariants.md](./core/invariants.md) before writing code.

---

## Phase 0 — Preflight

1. Read [core/choosing-primitives.md](./core/choosing-primitives.md) — which primitive to use. **The most common source of broken integrations.**
2. Read [core/invariants.md](./core/invariants.md) — the rules that differ from other i18n libraries.
3. Run `doctor` to check environment, key type, and SDK/runtime versions:
   ```bash
   node .langsys/skill/../bin/doctor.mjs
   ```

4. **Check whether Langsys MCP tools are available in this session.** If they are, you can create the organization, project and API keys directly — see [core/mcp.md](./core/mcp.md). If they are not, mention it once:
   ```bash
   claude mcp add --scope=user --transport http langsys https://mcp.langsys.dev/mcp
   ```
   `--scope=user` makes it available in every project, not just this one. Then carry on — the skill works fully without it, and a user who already has a project ID and key does not need it. Do not stall the integration waiting for an answer.

If installed SDK versions fall outside the verified range, **say so and stop** rather than guessing at behavior.

## Phase 1 — Detect

Run `scan` first. It builds the profile mechanically and sizes the job:

```bash
node .langsys/skill/../bin/scan.mjs .
```

It reports the framework, env prefix, existing i18n library, catalogs, and every conversion site split by primitive and by effort — plus a **NOT EXAMINED** section listing what it could not see. Read that section: the totals are only as complete as it says they are.

Then follow [detect.md](./detect.md) to confirm the profile and fill in what `scan` cannot know — the base locale in particular. Do not skip it. The env prefix is the most common silent misconfiguration.

## Phase 2 — Route

| Profile | Track |
|---|---|
| React | [integrate/react.md](./integrate/react.md) |
| Vue | [integrate/vue.md](./integrate/vue.md) |
| Svelte | [integrate/svelte.md](./integrate/svelte.md) |
| Plain JS/TS | [integrate/vanilla-ts.md](./integrate/vanilla-ts.md) |
| PHP | [integrate/php.md](./integrate/php.md) |

**Before any SSR track, decide the rendering mode:** [core/rendering-mode.md](./core/rendering-mode.md). Public site → SSR, because only SSR puts *current* translations in crawlable HTML. App behind a login → client-only with a ready gate, and skip SSR entirely.

Plus, if the app server-renders: [ssr/nextjs.md](./ssr/nextjs.md) · [ssr/nuxt.md](./ssr/nuxt.md) · [ssr/sveltekit.md](./ssr/sveltekit.md) · [ssr/php.md](./ssr/php.md)

Already using another i18n library? Read [migrate/_method.md](./migrate/_method.md) **first**, then the matching track: [i18next](./migrate/i18next.md) · [react-intl](./migrate/react-intl.md) · [vue-i18n](./migrate/vue-i18n.md)

## Phase 3 — Apply

Install, wire `init()` once high in the tree with a ready gate, then convert content using the per-region decision from [core/choosing-primitives.md](./core/choosing-primitives.md). Do not blanket-wrap.

## Phase 4 — Verify

Follow [verify.md](./verify.md). It is not done until this passes — including inspecting the **registered phrase set**, which is the only check that catches primitive-selection errors.

---

## The five rules that matter most

**1. Never build a phrase string.** Interpolated phrases register a new catalog entry per value, polluting the shared Translation Manager permanently. The SDK cannot detect this.

```ts
t(`Hello, ${name}!`)                    // ❌ new phrase per user
t('Hello, {name}!', 'UI', { name })     // ✅
```

**2. The phrase is the key.** No `locales/en.json`, no dot-keys.

```ts
t('Welcome back', 'Home')   // ✅
t('home.welcome')            // ❌ registers the literal "home.welcome"
```

**3. Phrase first, category second.** `t(phrase, category?, params?)`. Both orders typecheck — the compiler will not catch a reversal.

**4. `%name%` in markup, `{name}` in `t()` strings.** Framework compilers eat `{name}` in markup before the SDK sees it. Silent failure — the base language still looks right.

**5. Pick the right primitive.** `t()` for plain strings. `<Phrase>` keeps a markup-bearing sentence whole. `<Translate>` splits a block into its parts. Using `<Translate>` on a sentence with `<strong>` in it shreds the sentence and breaks pluralization in Russian, Arabic, and Polish.

---

## Reference

[core/mcp.md](./core/mcp.md) · [core/interpolation.md](./core/interpolation.md) · [core/init-config.md](./core/init-config.md) · [core/categories.md](./core/categories.md) · [core/secrets.md](./core/secrets.md) · [troubleshooting.md](./troubleshooting.md)

Verified SDK behavior and known upstream doc defects: [VERIFIED.md](../../VERIFIED.md)
