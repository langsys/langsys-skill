# Changelog

All notable changes to `langsys-skill`.

The rule this file exists to honour, learned from `langsys-js-typescript@0.2.0` —
which flipped `t(category, phrase)` to `t(phrase, category?)` with **no changelog
entry**, leaving `CLAUDE.md` stranded on the old signature for eleven releases:

> **A missing changelog entry is a doc defect that causes other doc defects.**
> No entry means nothing prompts the README, the agent-facing docs, or downstream
> consumers to update. `drift-guard` checks that every released tag has a section
> here.

## 0.1.1 - unreleased

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
