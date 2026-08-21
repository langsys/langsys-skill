# Changelog

All notable changes to `langsys-skill`.

The rule this file exists to honour, learned from `langsys-js-typescript@0.2.0` —
which flipped `t(category, phrase)` to `t(phrase, category?)` with **no changelog
entry**, leaving `CLAUDE.md` stranded on the old signature for eleven releases:

> **A missing changelog entry is a doc defect that causes other doc defects.**
> No entry means nothing prompts the README, the agent-facing docs, or downstream
> consumers to update. `drift-guard` checks that every released tag has a section
> here.

## 0.1.4 - 2026-08-21

Everything here came out of five SDK agents and a production SvelteKit deployment
measuring the shipped code rather than reasoning about it.

### Added
- **A warning that `<Translate>` around a single element destroys the element.**
  This is a live defect in the shipped SDK, verified against
  `langsys-js-typescript@0.6.5` (`dist/index.mjs:1408`, `:1427`). When a subtree
  yields exactly one token the SDK assigns `element.innerText`, replacing every
  child. The premise — one token means one text node — is false: a translatable
  **attribute** produces a token with no text node anywhere, so
  `<Translate><img alt="Logo" /></Translate>` **destroys the `<img>`**. Plain DOM,
  no framework, no SSR. And the locale guard is only set on the multi-token path,
  so the write **re-runs on every locale change**.

- **A troubleshooting entry for blocks that freeze**, with the measured scope:
  `{#if}` and lone reactive expressions freeze under a plain client-only mount;
  runes and stores fail identically; multi-token subtrees are clean. The
  `{#await}` client-only cell is the **worst** case, not the safe one — nothing is
  registered at all, because the effect runs before the block populates the host
  and marks it parsed without tokenizing it. Enabling SSR converts that invisible
  non-registration into a visible freeze.

- **`<Translate>` and `<Phrase>` are two pipelines, not two settings.** `<Translate>`
  tokenizes each text node and registers a content block with a computed id;
  `<Phrase>` encodes the run into one phrase string with no content block and no
  id. The SDKs shipped the right advice with the wrong mechanism named, twice,
  which is evidence the distinction is not obvious from the code.

### Fixed
- **Invariant 6 rewritten with the measured mechanism.** "Keep `<Translate>`
  children static" gave the reconciliation reason, which reads as a style note.
  The real reason: a content block's `custom_id` is a hash of its **rendered**
  token text, so wrapping an interpolation mints a new block per distinct value —
  permanent shared-catalog growth keyed on user data. That is invariant 0 on the
  block path, and the document never connected them. Extended to cover `{#each}`,
  `{#if}` and `{#await}`, which change the token array with **no interpolation
  present**, and to say plainly: **do not verify this by counting text nodes.** An
  `{#if}` wrapping an element branch leaves the text-node count unchanged while the
  token array changes.

- **`drift-guard` reported a resolved defect as reopened** because the Svelte SDK's
  improved docs discuss `{n}` more often — the guard was penalising a document for
  explaining the trap. It now distinguishes an **encoded phrase** (`%n%` encodes to
  `{n}`, so `{n}` in a stored phrase is correct) from `{n}` in source markup, using
  the markup token `{m0o}` as the discriminator. Made importable without side
  effects so the classifier is unit-testable.

- Verified pin for `langsys-js-svelte` moved `3.6.3` → `3.6.9`; base range `^0.6.4`
  and peer `^5.0.0` confirmed unchanged.

## 0.1.3 - 2026-08-21

### Fixed
- **Five wrong line citations in `VERIFIED.md`**, which ships in the package.
  Caught by the base-SDK agent, who re-ran their own citations before committing
  a review and found six of theirs off by a few lines — then found four of mine
  that had already shipped in 0.1.2.

  Auditing all fifteen citations produced a clean split: **11 of 11 derived by
  grepping the published artifact myself were correct; 4 of 4 inherited from a
  peer's message and recorded as-is were wrong.** Two were `src/` line numbers
  recorded against `dist/` — `:144` and `:136` point at `patch()` and `post()`,
  unrelated code. Two more were off by one or two lines at each end, which is
  worse, because a citation landing two lines from the truth reads as correct to
  anyone spot-checking.

### Added
- A new rule, contributed by the base-SDK agent: **a cited line number is not
  evidence until something reads it back.** An inherited citation is an inherited
  premise wearing the costume of evidence — a line number looks like the most
  checkable thing in a document, which is exactly why nobody checks it, and a
  wrong one makes an unverified claim look verified to every future reader,
  including the one who wrote it.

## 0.1.2 - 2026-08-21

The SSR tracks were wrong at the premise, not in the details. Found by
consulting a production SvelteKit deployment and then verified through four
rounds of review with the base-SDK and Svelte SDK agents.

### Fixed
- **The SSR tracks promised crawler-visible translated body copy that the JS
  SDKs cannot produce.** `t()` / `$t` / `<Phrase>` / `<Translate>` render the
  **base language** during server rendering in React, Vue and Svelte alike,
  because `init()` runs in a client-only lifecycle hook and the catalog lives in
  module globals that only it writes. Four documents said the opposite. **PHP is
  the one SDK where the original claim was true** — `translatePage()`
  post-processes finished HTML server-side.

  Measured on a production Italian page: 5,031 characters of visible SSR body
  text, 100% English, with the full Italian catalog shipped in the hydration
  payload.

  It survived because `curl | grep` shows base language on a correctly working
  page *and* on a completely broken one, so every cheap check agreed with the
  false version. `verify.md` now leads with **verify in a browser, never curl**.

- **Two phantom locale helpers.** The tracks called `resolveLocale` (Next.js)
  and `negotiate` (SvelteKit) — neither exists. The second was introduced by the
  commit that fixed the first. Markdown does not typecheck, so an agent
  following either track wrote code that could not run. Both now use
  `LangsysApp.detectPreferredLocale`, with its result validated against the
  project's locale list.

- **A prescribed server-side translator that dropped interpolation.** Caught by
  the base-SDK agent before publish: it would have rendered the literal
  `Hello {name}` server-side and correctly client-side — a hydration mismatch on
  exactly the strings carrying data. Now routes through the SDK's public, pure
  `interpolate` and guards the content-block object case.

- **A false claim that the locale 422 is `debug`-gated.** It is not.
  `Logger.warn` and `Logger.error` are both ungated, so the server's exact
  sentence is on the console by default. Telling users the diagnostic was
  missing would have sent them hunting for a line in front of them.

- **`install` silently ignored unknown options.** `--target=claude` — a
  plausible typo for `--host=` — installed to every detected host and reported
  success. Unknown options now exit non-zero with usage.

### Added
- `core/rendering-mode.md` rebuilt around what each mode actually delivers, and
  around resolving crawler-visible text from the fetched catalog directly, which
  is the only way to put translated text in server HTML in a JS framework.
- Real locale precedence chains with an offerability filter, replacing the
  undefined helpers. Measured behavior included: `detectPreferredLocale` returns
  the visitor's own tag on no match, does not validate input, and `false` is
  close to unreachable — so the common `|| BASE` idiom guards a branch that
  essentially never fires.
- The `supportedLocales` trap: built from `getLocalesFlat()` it is the ~573-entry
  global CLDR list, so nearly any `Accept-Language` "matches" and every catalog
  fetch 422s.
- `hreflang` deduplication by URL token. Two locales sharing one token
  (`zh-tw`/`zh-cn` → `zh`) threw `each_key_duplicate` and blanked **every page**
  of a production site — a content-only change in the Translation Manager,
  no deploy.
- Honest cache TTLs, including that two workers mean two independent caches, so
  the same URL alternates between old and new copy during propagation.
- `src/lint/phantom-helpers.mjs` — flags domain-shaped identifiers that are
  neither defined in the sample nor exported by the SDK, with the allowlist read
  from the pinned `dist/index.d.ts` rather than from memory.

## 0.1.1 - 2026-08-20

Found by using the skill on a real project — a Svelte 3 + Rollup app that had
never been touched by Langsys. Every item below is something the trial hit.

### Fixed
- **`doctor` reported zero errors on a project that cannot install the SDK at
  all.** The peer-floor check read `node_modules` and skipped when the package
  was absent, so on a fresh clone — or any project being scoped before an
  install — it silently did nothing. That is the moment the answer matters most,
  and the declared range was in `package.json` the whole time. It now checks the
  declared range and says explicitly when it could not verify.
- **`scan` recommended a package the project could not install.** `scan` runs
  before `doctor` and is what produces the recommendation, so a Svelte 3 project
  was routed to a binding requiring Svelte 5 with a clean-looking profile. It now
  reports a BLOCKER, while still reporting scope — the work is real, it just is
  not actionable yet.
- **`scan` said "none required" for env prefixes under Rollup and webpack.**
  Neither injects anything, and `process.env` does not exist in a browser bundle,
  so the key resolves to `undefined` with no build error. Both are now detected
  and named as having no convention.
- **The installer documented `-g` but only handled `--global`.** `-g` and `-n`
  now work.

### Fixed — reported from a live static site
- **`scan` understated a real project by roughly half.** It counted 71 markup
  sites while the largest single body of copy — a typed content module holding
  taglines, blurbs, feature bodies and spec labels — went unmentioned, because
  bare literals in `.ts` are not sites. The blind spot was correctly declared and
  still left the reader with a number that was wrong by 2×. `scan` now reports a
  **CONTENT MODULES** section: it looks, gives the magnitude, names the files, and
  refuses to fold them into the site totals, because it cannot tell a tagline from
  a log line and a wrong total is worse than an honest range.
- **`scan` routed a fully prerendered site to the SSR track.** With
  `prerender = true` and `adapter-static` there is no server at runtime, so that
  track's per-request `Accept-Language` seeding cannot run — the recipe is
  unexecutable on that deployment. `scan` now detects the posture and says so
  before routing, and `ssr/sveltekit.md` opens with a section on what breaks, what
  it costs (translated pages do not appear in the HTML, so they do not rank), and
  the three real options.

### Added
- **`core/rendering-mode.md`** — the decision that belongs before any SSR track,
  and it is about Langsys rather than about a framework. Only SSR puts *current*
  translations in the HTML a crawler fetches. Prerendering emits translated HTML
  too, so it passes the obvious check — but it is a build-time snapshot, and the
  client corrects the page after hydration, so humans see current text while the
  crawler indexed the old copy. A fixed mistranslation stays in search results
  until the next build and nobody reports it. Public site → SSR; app behind a
  login → client-only with a ready gate, which loses nothing. All four SSR tracks
  and `scan` now route to this first.
- **`core/mcp.md`** — the Langsys MCP server. Connected, the skill can create the
  organization, project and both API keys instead of asking for a paste.
  `doctor` reports whether it is registered and at which scope, reading config
  rather than `claude mcp list` (which health-checks over the network and took
  7.3s — a preflight check that slow gets skipped). Registered for one project
  only is called out, because the next project silently will not have it.

### Changed
- **README rewritten.** It led with the tool's own file layout and justified
  itself in terms of correcting an agent's wrong beliefs, before ever showing
  what using it looks like. It now opens with what happens when you point an
  agent at a project.
- **Svelte track** carried a stale `3.4.1` banner and a note that published
  READMEs "barely mention" `<Phrase>`/`<DontTranslate>` — true at 3.4.1, and
  false since 3.5.0 fixed exactly that. Now verified against 3.6.3, with the
  Svelte 5 requirement stated up front rather than as an aside.
- **Svelte track only showed the SvelteKit shape.** `$env/static/public` and
  `+layout.svelte` do not exist in a plain Svelte app. Added the Vite/Rollup
  path, plus how to inject env vars where the bundler has no convention.

## 0.1.0 - 2026-08-19

Initial build.

### Payload
- Router (`SKILL.md`) plus 23 markdown documents: 6 core, 5 integrate tracks,
  4 SSR tracks, 4 migration documents, detection, verification, troubleshooting.
- `core/choosing-primitives.md` — the `t()` / `<Phrase>` / `<Translate>` decision,
  led by grammatical agreement rather than formatting.
- `core/invariants.md` §3.0 — never pre-format a phrase; the only failure in the
  set that corrupts shared state rather than one app.

### Tooling
- `scan` — inventory and scoping, run before anything else. Builds the integration
  profile mechanically and classifies every conversion site by primitive
  (`t()` / `<Phrase>` / `<Translate>`) and by effort. Read-only, and exits 0 on
  findings: on a codebase that predates Langsys a `sprintf()` is a work item, not
  a defect, so it reports **scope, not fault**. Every run prints a NOT EXAMINED
  section — skipped files, unscanned types, and four declared blind spots — because
  a total is only as complete as its skip list.
- `doctor` — env prefix vs bundler, key type vs environment, SDK/peer/runtime
  version floors, Packagist resolvability in three distinguishable states.
- `install` — one canonical payload, per-host shims for Claude Code, Codex,
  Gemini CLI and Cursor; project and `--global` scopes; idempotent managed blocks.
- `drift-guard` — re-verifies claims against published artifacts across README,
  type-declaration headers and JSDoc; checks agent-facing docs; checks changelog
  coverage of released tags; and flags a **published artifact whose own changelog
  calls that version unreleased**. The condition is "ships the file AND the shipped
  file contradicts the registry" — not "the release script lacks a guard", which
  would fire on a repo that publishes only `dist/` and has nothing to fix.
  Enforcement has to be proportional to reach.
- ast-grep ruleset (7 JS/TS rules × 3 languages + 3 PHP rules) plus a purpose-built
  markup checker for `.svelte`/`.vue`, which ast-grep cannot parse.

### Verified
- Every claim checked against the published npm tarball / Packagist, never a local
  checkout. See `VERIFIED.md`.
- Pinned: `langsys-js-typescript@0.6.5`, `langsys-js-react@0.6.6`,
  `langsys-js-svelte@3.6.3`, `langsys-js-vue@0.2.1`, `langsys/langsys-php@1.3.1`.
- `doctor` also checks each binding's **base-SDK caret**, not just its version. Vue
  shipped `^0.4.1`, which capped the base SDK at `0.4.3` and made every fix from
  `0.5.0` on unreachable for its consumers. Nothing in the binding's own docs or
  tests could reveal it — the binding was correct; the range was not.

### Known limitations
- ~~Content-block `custom_id` agrees across SDKs for ASCII only.~~ Resolved in base `0.6.0`: JS hashed UTF-16 code units, which both diverged from PHP and was lossy enough to collide with itself. Verified against the published tarball (`VERIFIED.md` G1/G2).
- Migration tracks cover i18next, react-intl and vue-i18n; svelte-i18n, Paraglide,
  next-intl, Laravel and gettext are not yet written.
- No end-to-end fixture projects — rules are tested against synthetic files and
  the SDKs' own examples.
- `scan` does not count bare string literals in `.ts`/`.js`. Nothing reliably
  separates a user-visible string from a CSS class or an API path, and a
  fabricated number would be worse than no number. Declared in every report
  rather than left for the reader to discover.
