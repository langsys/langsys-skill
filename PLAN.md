# Langsys LLM Skill — Plan

A portable skill that lets any coding agent (Claude Code, Codex, Gemini CLI, Cursor) **integrate a Langsys SDK into any project**, and **migrate a project off an existing i18n library onto Langsys**.

Scope is SDK usage and integration. The skill does **not** document the Langsys REST API — anything not reachable through an SDK is out of scope and gets an explicit hand-off instead.

---

## 1. Founding principle: verify against source, not READMEs

While surveying the SDKs I found several documentation claims that are false against the shipped code. Each would have been copied verbatim into the skill and would fail silently in user projects:

| Claim | Where | Reality (verified) |
|---|---|---|
| `LangsysApp.init({ apiUrl })` points the SDK at a self-hosted server | `langsys-js-vue/README.md:95` | `apiUrl` is not a field on `iLangsysInitConfig` in `langsys-js-typescript@0.4.1` (`src/types/config.ts`). Only `LangsysAppAPI.setBaseUrl()` exists (`src/api.ts:39`), and it must run before `init()`. |
| `detectPreferredLocale(header, supported)` returns `false` when nothing matches, so `\|\| 'en-US'` is a reliable fallback | `langsys-js-vue/README.md:308` | Returns `canonicalizeLocale(userLocales[0])` on no-match (`src/langsys-app.ts:305-310`). The `\|\|` fallback never fires. |
| `t(category, phrase, params?)` | `langsys-js-typescript/CLAUDE.md` | `TFunction` is `(phrase, category?, ...params)` (`src/types/translation-fn.ts:54-56`). Argument order is reversed. |
| Dates serialize to ISO 8601 | `langsys-js-svelte/README.md:140` | Base SDK does CLDR medium-date formatting; Svelte depends on the same `langsys-js-typescript@^0.4.1`. |
| *(by omission)* Svelte has only `<Translate>` | `langsys-js-svelte/README.md` | It exports `Translate`, `Phrase`, **and** `DontTranslate` (`src/lib/index.ts:54-56`). Full parity with React and Vue. `<Phrase>` appears only twice in passing (`:206`, `:211`) with no section and no props list; `<DontTranslate>` is not mentioned once. |

That last row is the cautionary one. I originally recorded "Svelte lacks `<Phrase>`/`<DontTranslate>`" because the README barely mentions them — inferring absence from documentation silence, which is the same class of error as trusting a wrong claim. **A README's silence is not evidence.** The base SDK's own `CLAUDE.md` has the same problem: its `src/` layout listing omits `phrase.ts` and `richtext.ts` entirely, which are the files that implement the single most misunderstood feature.

**Therefore:** every factual claim in the skill is verified against SDK source or tests, annotated with the SDK version it was verified against, and regression-tested in CI against fixture projects. `VERIFIED.md` records what was checked and when. `doctor` warns when an installed SDK falls outside the verified range rather than letting the agent apply stale guidance.

### Version provenance: verify against the published tarball, not a sibling working tree

A trap I walked into while drafting this. The sibling checkout `langsys-js-typescript/` has `package.json` at **0.4.1**, but npm's latest is **0.4.3** and the working tree already contains the 0.4.3 feature commits (`6de474a`, `d03d8ff` — the unmatched-params debug warning). A working tree's declared version can lag the behavior its source actually implements.

Had the skill pinned "verified against 0.4.1" by reading that `package.json`, it would have attributed 0.4.3-only behavior to 0.4.1 and told users on 0.4.1 to rely on a warning their installed SDK does not emit — the mirror image of the README-drift problem, and harder to spot.

**Rule:** `VERIFIED.md` claims are checked against `npm pack langsys-js-typescript@<pinned>` (the published artifact users actually install), never against a peer's live working directory. Sibling checkouts are useful for *understanding* mechanism — that is where `richtext.ts` explained the design behind §2 — but never for *asserting* version-gated behavior.

### Convention: document both sides of a version boundary

Features land while users stay put. When a capability arrives in version *N*, the skill does **not** replace the old guidance with the new — it documents both, separated by an explicit `as of vN` marker, and lets `doctor` decide which half applies to the project in front of it.

The PHP keep-together primitive (§7) is the live case: `data-langsys-phrase` is approved and scoped but unreleased, so the track carries the workaround *and* the primitive with the boundary marked. The alternative — rewriting the track on release day — silently breaks every user still on the prior version, which is the same class of harm as a stale doc, just self-inflicted.

This also means an approved-but-unreleased feature is safe to write against, provided it never appears without its boundary marker.

### Corollary: published source comments drift worse than READMEs

The same suspicion must extend to **example code inside doc comments**, which no reader proofreads and no test exercises. Verified:

| File | Example | Status |
|---|---|---|
| `langsys-js-svelte/src/lib/components/Phrase.svelte:10` | `Based on {n} <strong>reviews</strong>` | **Broken.** Svelte compiles `{n}` away — this example cannot work. |
| `langsys-js-vue/src/components/Phrase.ts:25` (and `:12`) | same | Works only by luck (Vue consumes just `{{ }}`) and contradicts that binding's own portability guidance. |
| `langsys-js-react/src/components/Phrase.tsx:28` | `Based on %n% …` + rationale at `:31-33` | **Correct — the reference wording** the other two should adopt. |

These predate the `%name%` decision and were never updated. They are more dangerous than a wrong README because agents and IDEs surface doc comments on hover and completion, and because a wrong example is copied verbatim while wrong prose is at least read. The skill treats an example found in a `.svelte` / `.tsx` / `.ts` doc block as unverified until it passes the same ast-grep rules the skill applies to user code (§9) — and the lint therefore runs over comment-embedded examples, not just live code.

---

## 2. The decision that breaks integrations: which primitive?

**This is the spine of the skill.** Agents reach for `t()` for everything, or wrap the world in `<Translate>`, because that is what i18next-shaped experience teaches. Langsys has three primitives and they answer three different questions.

### The rule

| Content | Primitive | What it does |
|---|---|---|
| Plain string, no markup | `t()` / `$t()` | One phrase. Nothing to decide. |
| A block of markup — article, nav, form, marketing section | `<Translate>` | **Splits.** Walks the subtree and tokenizes each text node and translatable attribute as its own phrase, registered together as one content block. |
| One sentence that happens to contain inline markup | `<Phrase>` | **Keeps together.** Encodes the whole run as a single phrase, replacing inline elements with neutral markup tokens. Does not split at tag boundaries. |

The axis is **not** "how big is it" — it is **"where are the phrase boundaries, and does this tag boundary belong to the language or to the layout?"**

### Why getting it wrong is silent

Reaching for `<Translate>` on a sentence with inline markup shreds it:

```jsx
// WRONG — splits into "Based on", "5", "reviews": three fragments no
// translator can work with, and no language can reorder.
<Translate category="ProductCard">
  Based on <strong>{n}</strong> reviews
</Translate>

// RIGHT — one phrase: "Based on {n} {m0o}reviews{m0c}"
<Phrase category="ProductCard" params={{ n }}>
  Based on %n% <strong>reviews</strong>
</Phrase>
```

Fragmented output still *renders* — it just produces word-salad in every non-base locale, which nobody on the team can read. It surfaces as a translator complaint weeks later, not as a build error.

The inverse error is cheaper but still wrong: `<Phrase>` around a whole article collapses it into one enormous untranslatable phrase, and `<Translate>` or `<Phrase>` around a bare string with no markup is just a slower `t()`.

### Why `<Phrase>` exists at all

Three reasons, in priority order. The first is the one to lead with, because getting it wrong produces *confidently wrong grammar* rather than merely awkward phrasing:

1. **Grammatical agreement — pluralization.** A count and the noun it inflects must live in **one** phrase. Split `Based on {n} <strong>reviews</strong>` at the tag boundary and the catalog gets "Based on {n}" and "reviews" as separate entries — no ICU plural can then select the right noun form, because the count now sits in a different phrase from the word it governs. Fatal in Russian (4 plural categories), Arabic (6), and Polish, where the noun form changes with the number. `PhraseOptions.params` is documented as "`{n}` for pluralization" for exactly this reason.
2. **Word order — reordering languages.** Inline elements become `{m0o}`…`{m0c}` markup-token pairs — ordinary ICU placeholders, so the translator/model places them around the *translated* word. `<span>White</span> House` → `Casa <span>Blanca</span>`. Impossible once split.
3. **Key stability.** The SPA's real markup never leaves the SDK. Framework scoped-CSS classes (`svelte-a1b2c3`, Vue hashes) change every build; were they part of the phrase, the key would drift and silently re-translate the whole app. The wire form only ever contains `{m0o}`/`{m0c}`; real elements are reconstituted around the translated text at render.

Reasons 1 and 2 are distinct and the skill must not conflate them: **reordering is about word ORDER, agreement is about word FORM.** A team can live with awkward order; wrong noun forms read as broken.

### Two decisions, not one

The top-level choice is genuinely **three-way**, per the table above — `t()`, `<Phrase>`, or `<Translate>`. **Standalone `<Phrase>` is first-class**; it does not need a `<Translate>` parent. A single sentence with inline markup is a `<Phrase>` on its own, and wrapping it in a content block that has no other content is wrong.

Nesting is a *second, independent* decision that only arises **inside** a block: having chosen `<Translate>`, protect specific runs with `<Phrase>` so the tokenizer skips them (it early-returns on the `data-ls-phrase` marker — `translate.ts:195`, `content-block.ts:204`).

```svelte
<!-- Decision 1: this is a block → <Translate> -->
<Translate category="Pricing">
  <h2>Simple pricing</h2>             <!-- split out as its own phrase -->
  <p>Everything you need to ship.</p>  <!-- and this one -->

  <!-- Decision 2, only because we're inside a block: protect this run -->
  <Phrase params={{ n: seats }}>
    Includes %n% <strong>seats</strong>
  </Phrase>
</Translate>

<!-- Equally valid standalone — no <Translate> anywhere in sight -->
<Phrase category="ProductCard" params={{ n: reviewCount }}>
  Based on %n% <strong>reviews</strong>
</Phrase>
```

The skill teaches decision 1 per *content region*, and decision 2 per *text run within a block*. Teaching only the nested form would leave agents believing `<Phrase>` requires a `<Translate>` parent — pushing them to manufacture pointless content blocks around single sentences.

### Supporting rules

- `<DontTranslate>` marks runs that must survive verbatim — brand names, domains, code, product SKUs. Renders `translate="no"`, which the tokenizer and renderer both honor.
- Markup children of `<Translate>`/`<Phrase>` must be **static**. The walker mutates the DOM in place; framework-dynamic children fight reconciliation. Dynamic values go through `params`, not through interpolated children.
- Placeholders in markup are `%name%`, never `{name}` — see §3.

---

## 3. The other failure modes

### 3.0 The one that corrupts shared state: never pre-format a phrase

Every other failure in this document is local — wrong output in one app, fixed by editing one file. This one writes garbage into the **shared Translation Manager that every SDK and every teammate reads**, and it cannot be undone by changing code.

```php
$client->translate(sprintf('Hello, %s!', $name));   // ❌ PHP
```
```ts
t(`Hello, ${name}!`);                                // ❌ JS — identical hazard
```

Each distinct value registers a **brand-new catalog phrase** — "Hello, Sarah!", "Hello, Ahmed!", one per user, each queued to the API. Unbounded catalog pollution, billed as translatable words, landing in the same project the other SDKs read.

```php
$client->translate('Hello, {name}!', null, null, null, ['name' => $name]);   // ✅
```
```ts
t('Hello, {name}!', 'Greetings', { name });                                   // ✅
```

Three properties make this the skill's problem specifically:

1. **Neither SDK can detect it at runtime.** An interpolated string is indistinguishable from an authored one by the time it reaches `translate()`. There is no warning to add.
2. **It is the natural thing to write** — especially in PHP, where until the current release there was no `params` argument at all, so `sprintf` was the only option and is now legacy muscle memory.
3. **It looks completely correct in the base locale.** Like §3.3, it surfaces only downstream — here as a bloated catalog and a translator asking why there are four hundred greetings.

Documentation is the entire runtime defense — which puts it squarely in this skill's lane. **But it is statically detectable**, and §9 lints it at the call site: a template literal with substitutions, a `sprintf`, or a concatenation in first-argument position is structurally obvious even though it is invisible at runtime.

---

An agent arrives with i18next priors. Beyond §2 and §3.0, these are the ones to overwrite, in rough order of frequency:

1. **Invents a key file.** Creates `locales/en.json` and calls `t('home.title')`. In Langsys the phrase *is* the key and *is* the base-language default. There are no catalog files in the repo, ever.
2. **Reverses the arguments.** `t('UI', 'Home')` instead of `t('Home', 'UI')`. Reinforced by a stale line in the base SDK's own `CLAUDE.md`.
3. **Writes `{name}` inside `<Translate>`/`<Phrase>` markup.** JSX and Svelte compile the braces away before the DOM walker sees the text. **Fails silently** — the base locale renders correctly, so it passes review and breaks only when a user switches language. Markup needs `%name%`; JS strings passed to `t()` keep `{name}`. (Vue tolerates `{name}` since it only consumes `{{ }}`, but the skill teaches `%name%` uniformly — one rule, portable across bindings.)

   **The split is deliberate and permanent**, so the skill should teach it as a rule with a reason rather than a quirk: `t()` phrases are JS strings with no compiler in the way, and ICU MessageFormat is brace-based by spec — so "one syntax everywhere" is not reachable. Markup = `%name%`, `t()` = `{name}`.

   **Runtime safety net (base SDK ≥ 0.4.3).** With `debug: true`, the SDK detects this exact mistake: passing `params` whose keys have no matching placeholder in the captured content is an unmistakable fingerprint of braces the compiler already ate. It warns and names the fix, treats ICU slots as legitimate, re-warns only when the params key-*set* changes (so a ticking counter won't spam), and is silent in production. The skill teaches `%name%` as the primary rule and this warning as the **verification step** — see §6 Phase 4. It cannot observe the original braces (already substituted), so it is a net, not a detector.
4. **Leaks the write key to production**, or uses the wrong env prefix for the bundler (`VITE_` / `NEXT_PUBLIC_` / `NUXT_PUBLIC_` / `REACT_APP_` / bare).
5. **Vue reactivity slip.** `useT()` returns a `ShallowRef` — `t(...)` in templates (auto-unwrap), `t.value(...)` in script.
6. **Skips SSR seeding.** No `initialTranslations` / `initialTranslationsLocale` → duplicate fetch on hydration and a flash of untranslated content.
7. **No init gate.** Renders before `init()` resolves.
8. **Skips categorization**, collapsing genuinely different meanings ("Home" the nav item vs "Home" the noun) onto one translation.

§2 plus items 1–3 are the load-bearing content: they fail silently or fail late, which is precisely where an agent's self-review does not catch them.

---

## 4. Repository layout

One canonical, host-agnostic payload; thin generated shims per host.

```
langsys-skill/
├── package.json                    # @langsys/skill — bin: langsys-skill
├── VERIFIED.md                     # claim → SDK version → source ref
├── src/
│   ├── skill/                      # ◀ CANONICAL PAYLOAD (all markdown)
│   │   ├── SKILL.md                # router only, ≤200 lines
│   │   ├── core/
│   │   │   ├── choosing-primitives.md   # §2 — the spine
│   │   │   ├── invariants.md            # the rules, wrong/right pairs
│   │   │   ├── interpolation.md         # {key} vs %key% decision table
│   │   │   ├── init-config.md           # iLangsysInitConfig, field by field
│   │   │   ├── categories.md            # naming + when to categorize
│   │   │   └── secrets.md               # write vs read key, env prefix matrix
│   │   ├── detect.md               # decision tree → integration profile
│   │   ├── integrate/
│   │   │   └── react.md vue.md svelte.md vanilla-ts.md php.md
│   │   ├── ssr/
│   │   │   └── nextjs.md nuxt.md sveltekit.md php.md
│   │   ├── migrate/
│   │   │   ├── _method.md          # the 6-phase methodology
│   │   │   └── i18next.md react-intl.md vue-i18n.md
│   │   ├── recipes/                # copy-paste-ready files per framework
│   │   ├── verify.md               # acceptance checklist
│   │   └── troubleshooting.md      # symptom → cause → fix
│   ├── lint/
│   │   ├── sgconfig.yml
│   │   └── rules/*.yml             # ast-grep, see §9
│   └── bin/
│       ├── install.mjs             # --global | --project, --host=…
│       └── doctor.mjs
├── adapters/                       # shim templates per host
└── fixtures/                       # test projects, see §11
```

**Budget discipline.** Claude's SKILL.md ≤200 lines because progressive disclosure loads the rest on demand. Codex/Gemini have no such mechanism, so their entry doc inlines the primitive-selection table and the invariants (≤250 lines) and instructs "read `<path>` before doing X". Every track file ≤300 lines.

---

## 5. Distribution — npm primary, global supported

`npx @langsys/skill install` writes the payload once, then generates host shims that point into it.

- **Project:** payload at `.langsys/skill/`
- **Global:** payload at `~/.langsys/skill/`

| Host | Shim written | Notes |
|---|---|---|
| Claude Code | `.claude/skills/langsys/SKILL.md` (YAML frontmatter) | progressive disclosure into the payload |
| Codex CLI | `AGENTS.md` block + `.codex/prompts/langsys.md` | primitives + invariants inlined |
| Gemini CLI | `GEMINI.md` block + `.gemini/commands/langsys.toml` | same |
| Cursor | `.cursor/rules/langsys.mdc` | `alwaysApply: false` + globs |
| Generic | `AGENTS.md` | fallback (Aider, Cline, …) |

Global targets are the same shims under `~/.claude/skills/`, `~/.codex/prompts/`, `~/.gemini/commands/`.

Two properties matter more than the file list:

- **Idempotence.** Everything written into a shared file goes inside `<!-- langsys:skill:start v1.2.0 -->` … `<!-- langsys:skill:end -->` markers. Re-running replaces only that block and never touches surrounding user content. Upgrades are just a re-run.
- **Detection, not interrogation.** The installer detects which hosts are present and writes shims for those, with `--host` to override. Copy-paste installs from a git clone stay supported by keeping the payload plain markdown with no build step.

---

## 6. Runtime flow

Four phases. The agent writes its findings down as an **integration profile** before touching code, so later steps are deterministic and reviewable.

**Phase 0 — Preflight.** Read `core/choosing-primitives.md` and `core/invariants.md`. Run `doctor`. If installed SDK versions are outside the verified range, say so and stop rather than guessing.

**Phase 1 — Detect.** Produce the profile:

| Signal | Source | Determines |
|---|---|---|
| Framework | `package.json` / `composer.json` | which binding to install |
| Meta-framework | `next` / `nuxt` / `@sveltejs/kit` / `remix` / vite-only | whether the SSR track applies |
| Bundler | vite / webpack / next / nuxt | **env var prefix** — the #1 silent misconfiguration |
| Existing i18n | i18next, react-i18next, next-intl, react-intl, vue-i18n, svelte-i18n, paraglide, gettext | integrate vs migrate track |
| Base locale | existing config, `<html lang>`, or ask | `baseLocale` |

**Phase 2 — Route.** Profile → one integrate track (+ optional SSR track) or one migrate track.

**Phase 3 — Apply.** Install, wire init once high in the tree with a ready gate, then convert content **using the §2 decision procedure per text run** — not by blanket-wrapping.

**Phase 4 — Verify.** Run `verify.md`: typecheck, ast-grep lint clean, then boot with a **write** key and `debug: true` and read the console. Two checks that catch the silent failures before a locale switch exposes them in production:

- **No unmatched-params warning** (base SDK ≥ 0.4.3). Its presence means braces were compiled away — fix the markup to `%name%` (§3.3).
- **Switch locale and confirm the registered phrase set**, not just that text changed. A sentence with inline markup must appear as one phrase, not fragments (§2).

Then swap to the **read-only** key for production config.

---

## 7. Per-SDK tracks

All five ship in v1. Component parity across the three framework bindings is **complete** — `Translate`, `Phrase`, `DontTranslate` everywhere — so §2 transfers unchanged. The differences are in reactivity and init.

Versions below are **npm-published** pins (§1), not sibling-checkout `package.json` values.

| Track | Package | Pinned | Binding-specific traps |
|---|---|---|---|
| React | `langsys-js-react` | 0.4.x | `useT()` per component; peer React 18/19 (`useSyncExternalStore`); `%key%` mandatory in markup |
| Svelte | `langsys-js-svelte` | 3.4.x | `$t` store, not `useT`; Svelte 5 only; `UserLocaleStore` is a Svelte `Writable`, not a `Signal`; `<Phrase>`/`<DontTranslate>` exist but are effectively undocumented upstream |
| Vue | `langsys-js-vue` | 0.1.x | `useT()` is a ref — `t()` in template, `t.value()` in script; `refToLocaleSource()` for Pinia/`useState`; **README's `apiUrl` and `detectPreferredLocale` claims are wrong** (§1) |
| Vanilla TS | `langsys-js-typescript` | **0.4.3** | subscribe `tSignal` manually; `new Translate(el, opts)` / `new Phrase(el, opts)` + `.destroy()`; bring your own `Signal` or `createSignal`; unmatched-params debug warning lands here |
| PHP | `langsys/php-sdk` | — | `translatePage()` via output buffering; queue flushes on shutdown; cache driver; `data-langsys-category` / `data-langsys-contentblock`. **§2's keep-together half has no PHP equivalent yet — see below.** |

### PHP: the §2 decision is currently one-directional

The PHP SDK is working toward parity with the JS bindings, and the gap that matters most for this skill is the `<Phrase>` half of §2. Mapping the primitives as they stand:

| JS primitive | PHP equivalent | Status |
|---|---|---|
| `t()` | `translate()` | present |
| `<Translate>` | `data-langsys-contentblock` (+ `translateContentBlock()`) | present — forces the **split** direction |
| `<DontTranslate>` | `translate="no"` / `data-notrans` | present (`HtmlParser.php:184`, `PageTranslator.php:281`) |
| **`<Phrase>`** | *(none)* | **missing — no way to force the keep-together direction** |

This is not cosmetic, because PHP **splits by default**. The PHP agent ran these through `HtmlParser::extractPhrases()`:

```
<p>Based on <strong>5</strong> reviews</p>     => ["Based on", "5", "reviews"]
<p>Based on {n} <strong>reviews</strong></p>   => ["Based on {n}", "reviews"]   ← teach this one
<p>Read the <a href="#">docs</a> now</p>       => ["Read the", "docs", "now"]
<p><strong>Hello World</strong></p>            => ["Hello World"]               ← survives
```

Line 2 is the demonstration for the track: the ICU placeholder `{n}` and the noun `reviews` land in **separate catalog entries**, so no plural rule can reach across the boundary and the count cannot govern the noun's form. §2's reason-1 failure, produced automatically with no opt-out.

The operative rule is **"sole child keeps together, mixed content shreds"** (line 4 vs the rest) — and mixed content is the common case in real copy. `data-langsys-contentblock` only forces the direction PHP already defaults to; there is no attribute meaning "this markup-bearing run is one phrase."

**Direct feature tension:** ICU MessageFormat support (plurals via `ext-intl`, correct per-language categories) is landing *now* — and is partly unreachable for any phrase containing inline markup, for exactly this reason. The two features work against each other until a keep-together primitive exists.

**Roadmap status: APPROVED and scoped.** `data-langsys-phrase` will be built, using the same `{m0o}`/`{m0c}` markup-token wire format as the JS `<Phrase>` — not a PHP-specific invention — so entries registered from either SDK are mutually consumable. The grammatical-agreement argument is what carried the decision: it was put as a correctness problem (wrong noun forms read as broken, not merely awkward) rather than a formatting preference.

**No version number yet** — the interpolation work lands first, and the PHP agent will send the exact release once cut. So the track is **boundary-documented** rather than rewritten (see §1):

- **Until that release:** the workaround — keep a markup-bearing sentence whole by removing the inline markup, or accept the split and its plural limitation. The track states plainly that `data-langsys-contentblock` does **not** solve this; it forces a block, the opposite of what's needed.
- **From that release:** `data-langsys-phrase` on the run.

`doctor` reads the installed version and the track shows the applicable half.

**Attribute prefixes — settled: no rename, and it is by design.** `data-ls-phrase` is an *internal tokenizer marker* on the JS side (`phrase.ts:7` — "Attribute marker the `Translate` tokenizer uses to skip a `<Phrase>` subtree"); authors write `<Phrase>`, never the attribute. `data-langsys-*` is PHP's author-facing API. Different surfaces — my earlier "inconsistency" framing was wrong, and renaming a published author-facing API would be breaking for cosmetic gain.

**The skill documents the per-SDK spelling as intended, not as a wart awaiting cleanup:** PHP authors write `data-langsys-*`; JS authors write `<Phrase>` / `<Translate>` components. The one thing the track must state explicitly, because it is the failure mode most likely to cost someone an afternoon: **`data-ls-*` in hand-authored HTML is silently ignored by PHP** — no error, it simply does not apply.

SSR sub-tracks — Next.js (App + Pages Router), Nuxt, SvelteKit, and the PHP server-render path — share one shape: fetch on the server, seed `initialTranslations` + `initialTranslationsLocale`, choose `ssrTokenStrategy` (`'client'` default / `'server'` / `'auto'`).

---

## 8. Migration methodology

v1 covers **i18next (incl. react-i18next), react-intl/FormatJS, and vue-i18n**. `svelte-i18n`, Paraglide, next-intl, Laravel `__()`, and gettext follow in v1.1 — each needs its own verified mapping table, and shipping one unverified is worse than shipping none.

Six phases, in `migrate/_method.md`:

1. **Inventory.** ast-grep the old call sites; parse the base-locale catalog. Output counts and a file list before changing anything.
2. **Resolve.** Map key → base-locale string. Keys computed at runtime (``t(`errors.${code}`)``) **cannot** be resolved statically — quarantined into a report for a human, never guessed. This is where a naive migration corrupts an app.
3. **Categorize.** Derive category from key namespace (`checkout.*` → `Checkout`), falling back to file path. The mapping table is written to disk and reviewed **before** any rewrite.
4. **Rewrite.** Codemod call sites to phrase-first. `{{var}}` → `{var}`. Convert plural forms to the ICU syntax the base SDK renders via `intl-messageformat`. **Map `<Trans>` → `<Phrase>`, not `<Translate>`** — `<Trans>` exists precisely because a sentence with inline markup must stay one unit, so it is a direct `<Phrase>` analogue. Mapping it to `<Translate>` shreds every sentence it was protecting (§2).
5. **Rewire.** Remove the old provider and config; install Langsys init per the matching integrate track. Delete old catalog files only after phase 6 passes.
6. **Verify.** Full §6 Phase 4 checklist, plus a diff review of the quarantine report.

**On importing existing translations.** The SDK path registers *phrases* using the project write key. Getting an existing translated catalog's *text* into Langsys is not exposed by the SDKs — it needs user-level auth. Per scope, the skill states this plainly and hands off to the Langsys UI rather than documenting endpoints. Practically: migrate the source strings, let machine translation and translation memory refill the targets.

---

## 9. ast-grep lint ruleset

The skill's self-check, and the only reliable defense against the silent failures. Runs in Phase 4 and optionally in the project's CI.

**Primitive-selection rules (§2):**

| Rule | Severity | Catches |
|---|---|---|
| `<Translate>` whose subtree contains an inline element (`strong`/`em`/`a`/`span`/`b`/`i`) inside a text run | warn | sentence about to be shredded — probably `<Phrase>` |
| ↳ same, and the run also contains a numeric param | **error** | pluralization about to be broken: count separated from the noun it inflects (§2 reason 1) |
| `<Phrase>` containing a block element (`p`/`div`/`h1`-`h6`/`ul`/`section`) | error | a block wrongly collapsed into one phrase |
| `<Translate>` / `<Phrase>` wrapping a single text node with no markup | warn | should be `t()` |
| `t()` first argument contains an HTML tag | error | markup in a `t()` string never renders as markup |

**Catalog-pollution rules (§3.0)** — the highest-value rules in the set, because the runtime cannot see these and the damage is to shared state:

| Rule | Severity | Catches |
|---|---|---|
| First arg to `t()`/`$t()` is a template literal containing a substitution — `` t(`Hello, ${name}!`) `` | error | a new catalog phrase per distinct value |
| First arg is a concatenation — `t('Hello, ' + name)`, `translate('Hello, ' . $name)` | error | same |
| First arg to `translate()` is a `sprintf`/`vsprintf`/`printf`-family call | error | same, PHP's dominant spelling |
| First arg is any non-literal expression (variable, method call, ternary) | warn | can be legitimate (a constant), so warn and require review |

These run over **comment-embedded examples as well as live code** (§1 corollary) — the binding repos have carried a broken `<Phrase>` example through multiple releases precisely because nothing lints doc blocks.

### The rule keys on position, not spelling

The single most dangerous rule to get wrong. `{name}` is a defect in one position and **mandatory** in another, and the two are visually identical in a diff:

| Position | Verdict |
|---|---|
| `{ident}` in JSX/Svelte/Vue markup that is a child of `<Translate>`/`<Phrase>` | **defect** — the compiler eats it before the walker sees it |
| `{ident}` inside a string literal passed to `t()` / `$t()` | **correct — never rewrite.** It is a JS string; no compiler touches it |
| ↳ …including when that `t()` call is lexically nested inside component markup | **still correct** |

That last row is the trap. All three bindings' own examples contain it:

```jsx
<p>{t('Hello, {name}! You have {count} new messages.', 'Greetings', { name, count })}</p>
```
<sub>`langsys-js-react/example/App.tsx:79`, `langsys-js-vue/example/App.vue:85`, `langsys-js-svelte/src/routes/+page.svelte:81`</sub>

A naive `{ident}`-in-a-binding-repo sweep flags every one. An agent acting on that lint rewrites them to `%name%` **inside a JS string**, where nothing normalizes it — silently breaking interpolation in precisely the way the rule exists to prevent. The lint would manufacture the bug it was written to catch.

**Consequences for the build:**

- **ast-grep, never regex.** String literals are distinct AST nodes; the positional distinction is only expressible structurally. This is the concrete reason the ruleset is structural rather than textual.
- **Negative test cases are first-class.** The fixture suite asserts these three lines are *not* flagged, alongside asserting the true positives are. A rule that only proves it fires is half-tested.
- The audit target is not "braces in a binding repo" — it is **"braces in a position where a compiler will eat them."** Same distinction the base SDK draws at capture time.

**Correctness rules (§3):**

| Rule | Severity | Catches |
|---|---|---|
| `{ident}` in `<Translate>`/`<Phrase>` children (JSX, Svelte, Vue) — **positional, see above** | error | the silent interpolation bug |
| `t('a.b.c')` dot-shaped first arg | error | leftover i18next key idiom |
| Reversed args — short/TitleCase first arg + sentence-like second | warn | `t('UI', 'Home')` |
| Write-key literal in source; `.env` not gitignored | error | credential leak |
| `<Translate>`/`<Phrase>` with expression children | warn | walker vs. reconciler conflict |
| `t(` in Vue `<script setup>` without `.value` | error | ref misuse |
| SDK imported but no `LangsysApp.init` anywhere | error | missing init |
| `LangsysApp.init({ apiUrl })` | error | not a real config field at 0.4.1 (§1) |

---

## 10. `doctor`

Pre- and post-flight sanity, using only what the SDK already exposes:

- env vars present, and the **prefix matches the detected bundler**
- key validates via the SDK's own init/validate path; reports write vs read
- write key + production build → error
- installed SDK versions inside the verified range; peers satisfied (React 18/19, Svelte 5, Vue 3.4+)
- **PHP: floor is version-dependent and just moved.** The current release raises the minimum from **5.6 → 7.4** and makes **`ext-intl` a hard composer requirement** (it backs ICU plural/select). `doctor` must check the target's PHP version and `ext-intl` presence *before* recommending an upgrade, since the SDK will no longer install on 5.6–7.3 — an unusually sharp gate for a PHP codebase, where old runtimes are common
- **base SDK ≥ 0.4.3** — below that, the unmatched-params warning does not exist, so `verify.md` must fall back to the ast-grep rule alone and say so rather than instructing the user to look for a warning that will never fire
- `.env` is gitignored

---

## 11. Testing — what makes this robust rather than plausible

Fixture projects under `fixtures/`:

- Integration targets: `vite-react`, `next-app-router`, `next-pages-router`, `sveltekit`, `nuxt`, `vanilla-ts`, `php-plain`
- Migration targets: the same, pre-loaded with `i18next`, `react-intl`, and `vue-i18n`

CI runs, per fixture:

1. Apply the track → typecheck / build must pass
2. ast-grep ruleset clean
3. Assert no `{key}` survives in `<Translate>`/`<Phrase>` markup and no catalog files were created
4. **Primitive-selection golden test** — a fixture page containing all three cases (plain string, markup block, inline-markup sentence) where the assertion is on the *registered phrase set*: the sentence must register as ONE phrase with `{m0o}`/`{m0c}` tokens, not three fragments. This is the regression test for §2 and the one that matters most.
5. Snapshot migration codemod output; diffs reviewed, not auto-accepted
6. Installer smoke test: install into each host layout, assert files land, re-run and assert byte-identical output

Plus a drift guard closing the loop on §1: grep the SDK READMEs for the known-bad claims and fail when they change, so the skill and the docs cannot silently diverge.

---

## 12. Upstream fixes to hand back to the SDK teams

- `langsys-js-vue/README.md:95` — `apiUrl` is not an `init()` field at base 0.4.1; document `LangsysAppAPI.setBaseUrl()` (pre-`init`) or ship the field
- `langsys-js-vue/README.md:308` — `detectPreferredLocale` no-match behavior is wrong; the documented `|| 'en-US'` idiom does not work
- `langsys-js-typescript/CLAUDE.md` — `t()` argument order reversed vs the actual `TFunction`; and the `src/` layout listing omits `phrase.ts` and `richtext.ts`
- `langsys-js-svelte/README.md:140` — Date formatting stale (says ISO 8601; base SDK does CLDR)
- `langsys-js-svelte/README.md` — **`<Phrase>` and `<DontTranslate>` are exported but effectively undocumented**: `<Phrase>` appears twice in passing (`:206`, `:211`) with no section and no props list, `<DontTranslate>` not at all. Highest-value fix on this list — it is why the split-vs-keep decision is invisible to Svelte users and to any agent reading only that README. (The `%name%` interpolation guidance in that same README is excellent and should be the template for the missing sections.)
- `langsys-js-svelte/src/lib/components/Phrase.svelte:10` and `langsys-js-vue/src/components/Phrase.ts:12,25` — **the `<Phrase>` doc-comment example is `Based on {n} <strong>reviews</strong>`**, which is broken in Svelte and self-contradictory in Vue. `langsys-js-react/src/components/Phrase.tsx:28-33` already has the correct wording; port it verbatim to both.
- **All bindings** — consider a short "which primitive do I use?" section (§2) in each README, leading with the pluralization rationale. Its absence is the single largest source of incorrect Langsys integrations.

### Where the lint rules should live

Scoped with the base-SDK agent. The base SDK has no component usage to lint (only `example/index.html`, plain HTML with no compiler in the way), so the markup rules would find nothing there.

| Rules | Home |
|---|---|
| Reversed `t()` args | **Base SDK CI** — useful in any repo, and the mistake most likely to survive review since both orders type-check when the phrase is a plain string |
| All markup/primitive rules | **The three binding repos** (their examples and demo pages contain real component usage, and have demonstrably carried stale examples across releases) **+ shipped to users in the skill** — the real payoff |

---

## 13. Milestones

| # | Deliverable |
|---|---|
| **M1** | Payload core (`SKILL.md`, `core/` incl. `choosing-primitives.md`, `detect.md`), React + Svelte integrate tracks, ast-grep ruleset, `doctor`, Claude Code shim |
| **M2** | Vue + vanilla-TS + PHP tracks, all four SSR tracks, Codex/Gemini/Cursor shims, `--global` install |
| **M3** | Migration tracks (i18next, react-intl, vue-i18n), fixtures, full CI incl. the primitive-selection golden test |
| **M4** | `VERIFIED.md`, README, npm publish as `@langsys/skill` |

v1.1: remaining migration sources (svelte-i18n, Paraglide, next-intl, Laravel, gettext).
