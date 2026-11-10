# Changelog

All notable changes to `langsys-skill`.

The rule this file exists to honour, learned from `langsys-js-typescript@0.2.0` —
which flipped `t(category, phrase)` to `t(phrase, category?)` with **no changelog
entry**, leaving `CLAUDE.md` stranded on the old signature for eleven releases:

> **A missing changelog entry is a doc defect that causes other doc defects.**
> No entry means nothing prompts the README, the agent-facing docs, or downstream
> consumers to update. `drift-guard` checks that every released tag has a section
> here.

## 0.3.4 - 2026-11-09

- `SKILL.md` rule 2 (never write ICU) names its two gaps. **Gender forms** need `name_gender`
  passed beside `name`. `langsys-js-typescript` 0.7.3 and `langsys/langsys-php` 2.2.1 accept it
  anywhere. On core 0.6.5 (React 0.6.x, Vue 0.2.x, Svelte 3.x) an object literal in `t()` is a
  type error, but a `<Phrase>`/`<Translate>` `params` prop or a prebuilt params object renders
  the gendered form. **No SDK formats a time of day.** A `Date` renders `dateStyle: medium` in
  core 0.6.5 and 0.7.3, and `IntlDateFormatter::MEDIUM`/`NONE` in langsys-php 2.2.1, so a time is
  passed as a string the app formatted in the user's locale and time zone.
  Rule 2 also says to pass dates and every number but the count as formatted strings. Inside a
  sentence Langsys gave plural or gender forms, which a call cannot know about, a non-count
  number renders unformatted in core 0.6.5, core 0.7.3 and langsys-php 2.2.1 alike. On core
  0.6.5 a `Date` comes back as an array, which crashes a React render.
  `pinned/core-0.6/interpolation.md` carries the core 0.6 side, including a fallback for the
  catalog locale (which starts empty), Vue's ref, and the request's locale on the server. It also
  says that plurals follow the loaded catalog's locale. The react-intl and vue-i18n migration
  guides no longer say a raw number or `Date` param is formatted.
  `pinned/core-0.6/troubleshooting.md` no longer says the gender param cannot be supplied.
  Reported by the React tab, and checked by running the published packages.
- `categories.md`: a whole renamed category moves with one setting in `langsys/langsys-php`
  ≥ 2.2.1, the Client option `previous_categories` (`messages_previous_category` for the
  messages category), checked in the v2.2.1 archive (9585bc5, which Packagist serves). It names
  2.2.1 rather than 2.2.0 because 2.2.1 is the version whose keyless dry run (`Planner::offline()`)
  also plans the messages-category move.
  Laravel stays out, since it is still on `langsys-php` 1.3.x.
- `sdk-versions.md`: the PHP routing row names Packagist's latest, 2.2.1.

## 0.3.3 - 2026-11-09

- `categories.md`: a new section, **Moving content to another category**. Until now an agent
  told to recategorize would edit the category in place, which registers the content as new and
  machine translates and charges it again. It now names the previous category in the same
  change: `inCategory(…, { previousCategory })` in `langsys-js-typescript` ≥ 0.7.3, and
  `'previous_category'` in `langsys/langsys-php` ≥ 2.1.0, both checked in the published
  artifacts. It also covers moving every use in one release, that the option acts once, the
  90-day retirement and that a revert is a move. For SDKs without the option (React 0.6.x, Vue
  0.2.x, Laravel 1.0.0) it points to `POST /api/translatable-items/recategorize` and its MCP
  tool, with deploy first and move second. Rules are from SDK spec 8.7.0, MOVE-1 to MOVE-5.
  - Svelte: `langsys-js-svelte` ≥ 4.1.0 (requires core ^0.7.3) exports `inCategory`, and its
    `<Translate>` and `<Phrase>` take `previousCategory`. This was checked by installing the
    published 4.1.0. Earlier Svelte goes through the endpoint.
  - The endpoint only fully avoids a charge for items the new code has not registered yet, so
    move as soon as it runs anywhere write-enabled. Content blocks are named by item id.
  - The option is deleted once the new category's translation is in the catalog, not merely
    after registration, because it also drives the old-category fallback.
  - Past the 90-day purge, an old release re-registering the old category restores it with its
    translations and no charge, after one miss. This is per the API team, whose feature tests
    cover it.
- `sdk-versions.md`: a fresh install of `langsys-js-typescript`, and of `langsys-js-svelte` 4.1.0,
  now resolves core **0.7.3**, measured in empty projects.

## 0.3.2 - 2026-11-06

Developers never write ICU. Langsys makes each language's plural and gender forms from a flat
phrase, the base language included, and the SDKs render them. The entry skill now says so as a
rule every SDK shares, and the pinned guides stop teaching plurals written by hand.

### Fixed

- **A new rule 2: never write a plural or a gender form.** Write the sentence flat with its
  `{placeholders}`; Langsys runs the same plural check on the base-language text, so English
  renders `You have 1 new message` with no ICU in English either, once the phrase has been
  checked. A sentence that says something different at zero, or that differs in the source
  language itself, is its own phrase. The rule also says that the skills in
  `langsys-js-typescript` 0.7.1 and `langsys/langsys-php` 2.0.1 and the `langsys-php-laravel`
  1.0.0 README show ICU written by hand, and that on `langsys/langsys-php` 1.x, which Laravel
  apps run, the API flattens each plural to the one form its language uses for several things.
  The later rules are 3 to 8. The same rule is in `choosing-sdks.md` and in the rules the
  installer writes for Codex, Gemini, Cursor and other hosts (`AGENTS.md`, `GEMINI.md`,
  `.cursor/rules/langsys.mdc`), and a test holds all of them to it.
- **The migration guides collapse plurals into one flat phrase.** `_method.md`, `i18next.md`,
  `vue-i18n.md` and `react-intl.md` turned `_one`/`_other` keys, pipe forms and react-intl's
  ICU messages into hand-written ICU; they now give the flat sentence, with a zero form or a
  source-language variant (i18next's context suffixes, a react-intl `select`) as its own phrase.
  react-intl's formatted arguments and its number and date components format in code with
  `Intl` and pass the value as a param, and an ordinal is phrased so it needs no ending.
- **The Laravel guide** says never to write ICU in a phrase, in place of its README's example.
- **The base language "reads as written"** in `SKILL.md` and `choosing-sdks.md`, where it said
  it "always looks right": until a phrase's plural check has run, English shows the flat
  sentence.
- **The core-0.6 interpolation guide**, which React and Vue projects read, starts its plural
  section with the same rule in place of a hand-written ICU example.
- **`sdk-versions.md`** shows `langsys-js-typescript` 0.7.2 and `langsys-js-svelte` 4.0.3, which
  resolve core 0.7.2, measured by installing each into an empty project.

## 0.3.1 - 2026-10-31

`langsys/langsys-php` 2.0.1 and `langsys-js-svelte` 4.0.2 ship their own skills, so the entry
skill routes those projects to them, and `doctor` can tell whether a copied PHP skill is current.
Every SDK that has a skill now ships it; the guides remaining under `pinned/` are for the four
packages that do not — React, Vue, Laravel and the JS server SDK.

### Fixed

- **A Composer package's installed version is read from `vendor/composer/installed.json`.** A
  package in `vendor/` carries no `version` in its own composer.json — declaring one there is
  discouraged, and `langsys/langsys-php` does not — so Composer records what resolution settled
  on in `installed.json` instead. Reading the package's manifest left the version unknown, and
  `doctor` then reported a copied PHP skill as matching against nothing: the one comparison it
  exists to make was a pass that could not fail. Both layouts are read, Composer 2's
  `{packages: […]}` and Composer 1's bare array.
- **Composer's recorded version is the git tag, so its leading `v` is stripped.** `installed.json`
  holds `v2.0.1` while a skill's frontmatter declares `2.0.1`. `doctor`'s output and the
  `installed` field in `.langsys/skills.json` stay bare semver, like every other version it
  prints. A recorded version that does not begin with a digit is left alone, because it is not
  a version.
- **PHP and Svelte projects are routed to their own skills, not to the packages' READMEs.** The
  entry skill's fallback list named `langsys/langsys-php` and `langsys-js-svelte` among the
  packages shipping no skill of their own. Both now ship one, so no package is in that list.
- **The measured version table was stale in a way a reader cannot check.** `langsys-js-svelte`
  is published at 4.0.2 and declares `^0.7.1`, not 4.0.0 and `^0.7.0`, and `langsys-js-typescript`
  at 0.7.1, not 0.7.0. Re-measured by installing each published binding: Svelte resolves core
  **0.7.1**; React `^0.6.5` and Vue `^0.6.5` are unchanged at **0.6.5**.
- **A Composer dev checkout is no longer reported as the SDK shipping a broken skill.** Composer
  records a branch or path install as `dev-main`, which carries no version; comparing it anyway
  reported the package and its skill as out of step and told the agent to report an SDK bug that
  does not exist. It is now reported as a dev checkout, with the comparison explicitly not made.
- **`doctor` says when it could not read the installed version, instead of reporting a match.**
  A hand-vendored tree, a custom `config.vendor-dir` or an unreadable file leaves the version
  unknown; the check used to print a green `matches … ` line against the absence. A skill copied
  before this release recorded no Composer version at all, and now asks for a re-install.
- **`npx langsys-skill install <path>` is an error naming `--dir=<path>`, not a silent install
  into the current directory.** `doctor` and `scan` both take their root as a positional
  argument, so a bare path is the natural thing to type — and it was dropped without a word by
  the tool that writes files.
- **`sdk-versions.md` enumerates every state `doctor` can report** for a copied skill, not three
  of them. Two of the undocumented ones became reachable with this release, and neither is a
  match: an unreadable version and a development checkout both mean the skill is **unverified**.
- **A Laravel app is routed to `pinned/laravel.md`, never to the `langsys-php` core skill.**
  `langsys-php-laravel@1.0.0` constrains the core to `^1.3`, so it installs PHP SDK 1.3.x while
  the core skill describes 2.0 — the same caret trap as React and Vue on the JavaScript side.
  The routing table had named a `langsys-laravel` skill that no package ships.

## 0.3.0 - 2026-10-30

The skill becomes a tree that mirrors the SDKs. Each SDK ships its own skill, written by the
lane that writes the code and released with it; this package is the **entry skill** — what is
true in every language — and the **installer** for the rest.

### Upgrading from 0.2.0

- **Re-run `npx langsys-skill install`.** It now also copies the skill of every Langsys package
  the project has installed, into `.langsys/skills/<name>/` and your agent's skill folder.
- **The guides for TypeScript, Svelte and PHP are gone from this package.** They ship inside
  `langsys-js-typescript`, `langsys-js-svelte` and `langsys/langsys-php`. Until each release
  lands, those SDKs' own READMEs are the answer, and the skill says so rather than offering a
  guide for a version you do not have: 0.2.0's described TypeScript 0.4.3–0.6.5, Svelte 3.6.x
  and PHP 1.x, against current releases of 0.7.0, 4.0.0 and 2.0.0.
- **React, Vue, Laravel and the JS server SDK keep their guides here**, under `pinned/`, each
  naming the one published version it was verified against. Outside that version you are routed
  to the package's README.
- **`src/skill/` is restructured.** Anything linking into the payload by path needs updating;
  `src/skill/projects-and-keys.md` is a stable entry point that SDK skills link to.

### Added

- **`sdk-versions.md`**, and it is the file to read before installing anything. Which core a
  binding resolves to decides which rules apply, and a binding's own version does not say:
  measured, `langsys-js-react@0.6.7` and `langsys-js-vue@0.2.1` resolve core **0.6.5**, because
  `^0.6.5` pins the minor on a 0.x version. Adding the core yourself to reach a 0.7 feature
  gives the app **two cores** — two module instances, two catalogs, two registration queues,
  nothing erroring. The skill states that as a prohibition, and `doctor` reports it as an error.
- **`projects-and-keys.md`** carries write capability as a cross-language concept: the server's
  per-session decision, an answer without it being read-only, `ip_write` gated by its
  allow-list, per-user write grants, and a symptom tree for "nothing is registering". A
  read-only session's report is **recorded**, not registered — content reaches the catalog only
  when a write-enabled session renders the page.
- **`two-languages.md`** for a project rendering through two SDKs: the id and tokenizing rules
  both follow, both marker families, deciding which side owns which content, and
  `data-ls-resolved` so a browser SDK does not re-register a server-translated page. The hash
  agreement is checkable in two commands rather than asserted.
- **`preamble.md`**, the source of truth for the shared opening every core and child skill
  carries, and **`skill-contract.mjs`**, which checks every SDK skill's copy against it and
  verifies that each `docs.langsys.dev/skill/langsys/<path>` link an SDK skill carries still
  resolves here. A published SDK skill cannot be edited, so a rename here is caught before it
  ships.
- **`.langsys/skills.json`**, recording each copied skill's package, declared version, installed
  version and per-file hashes — so `doctor` can tell a **stale** copy from an **edited** one and
  warn before a re-install discards someone's edits.
- **`tools.md`**, **`choosing-sdks.md`** and a shared **`verify.md`** whose acceptance criteria
  are language-independent.

### Fixed

- **The drift guard reported a false regression on the most load-bearing claim in the skill.**
  0.7.0's build moved `TFunction` into a content-hashed chunk re-exported from
  `dist/index.d.ts`, and the guard read only the entry file — so it reported the `t()` signature
  as changed when it was byte-identical, and would have done so again on every rebuild. It now
  resolves the type surface by following re-exports and never names a file.
- **`apiUrl` is a real `init()` field as of core 0.7.0**, and preferred over
  `LangsysAppAPI.setBaseUrl()`, which must run before `init()` and leaves the SDK permanently
  inert if it runs after. The `no-init-apiurl` rule is now a **warning** naming the version
  boundary it cannot see, rather than an error: the same line is correct on 0.7 and silently
  dropped on 0.6.x, so an error would fire on correct code in half the fleet. As a warning over
  the published examples it immediately found `init({ apiUrl })` in Vue's own Nuxt example,
  where the field is dropped and that example talks to production.
- **The markup rule inverts under Svelte 4's build transform.** `langsysPreprocess()` reads
  `{expression}` in `<Translate>`/`<Phrase>` from the source, so braces there are correct where
  it is configured. `markup-check.mjs` now detects it and downgrades to a warning naming the
  ambiguity, without guessing which files a config's transform covers.
- **The installer always reported the payload as unchanged**, because it compared the landed
  file against the content it had just written it from. A first install into an empty directory
  read as a no-op.
- **A test helper could not observe warning-severity lint findings at all** — it returned
  nothing whenever ast-grep exited 0, which it does for warnings. Harmless while every rule was
  an error; a silent hole the moment one was not.

### Fixed in branch review

A read-only review of the branch found nine defects in the new machinery. Each is fixed with a
test that fails without the fix.

- **`doctor` could not find the manifest a `--global` install wrote.** It read only
  `<project>/.langsys/skills.json`, while `install --global` writes under the home directory —
  and the installer's own closing line runs `doctor` with no argument, so the documented happy
  path reported "no skill has been installed" and advised re-running the install that had just
  succeeded. It now checks both, project first, and resolves each copy through the path the
  manifest recorded.
- **Uninstalling an SDK left its skill copied on disk.** Nothing pruned it, and `doctor`'s
  orphan check walks the manifest — which no longer listed it — so the stale copy was
  simultaneously readable by the agent and invisible to the tool, the exact inverse of the
  "a copy goes stale visibly" guarantee the copy-not-link design rests on. The installer now
  removes copies it previously recorded and says which, and only those: the manifest is the
  record of what it wrote, so it is the only safe licence to delete.
- **Two `PINNED` entries were never read.** `langsys-js-server` and the Laravel package were
  checked inside a loop over four hardcoded npm binding names, so the two packages whose guides
  claim an exact version got no check at all. Laravel's resolved version is read from
  `composer.lock`, which is where it actually lives.
- **A package with no pinned guide produced no output at all.** Silence is the state every check
  in `doctor` exists to prevent, and the one that looks most like a pass. It now says where
  guidance comes from instead.
- **Non-markdown files in an SDK's `skill/` were corrupted on copy.** They were read as UTF-8
  while the manifest hashed raw bytes, so any asset would have been reported as **edited**
  forever, on a copy nobody touched, with a re-install that could not fix it. Copies are now
  byte-for-byte.
- **`skill-contract --json` exited 0 when it found nothing to check.** The exit-2 decision lived
  inside the human-readable branch, so automation reading the JSON form got precisely the
  green-run-that-verified-nothing the check exists to prevent.
- **`skill-contract` gained `--source=<dir>`**, which checks exactly the directories named. An
  SDK's release gate needs to ask whether *its* skill satisfies the entry skill without the
  answer depending on what else is checked out; this repo's suite needs the same isolation so a
  drift in another repo cannot turn these tests red.
- **The drift guard's re-export walk matched single quotes only.** Which quote a bundler emits
  is a formatting setting, so a config change would have collapsed the type surface back to one
  file and resurrected the false "t() signature changed" alarm this walk was added to kill.
  `typeSurface` is now exported and unit-tested, as that file already argued for its other
  helper.
- **A test fixture was created inside the repo and removed only on the last line.** Any failing
  assertion in between left it in the working tree, so every later contract run reported a
  violation unrelated to the code. It is now a temp directory removed in a `finally`.

### Fixed after the TypeScript lane's review

- **The "nothing is registering" symptom tree pointed at the wrong fault.** It read an unset
  write answer as "init never authorized", but in a browser a refused or unconfigured `init()`
  sets the answer to **false**, not unset — re-measured here on published core 0.7.0 with the
  network stubbed. So `false`, which the tree described as the server refusing a write key, is
  ambiguous between three faults, and a reader was sent to check an `ip_write` allow-list for
  what was actually a missing credential. The tree now branches on unset / false × three causes
  / true, with `isConfigured()` as the discriminator: it separates "no credentials reached
  `init()`" from "authorization was refused", and unlike `init()`'s return value it is still
  readable after the moment of failure.

### Fixed after Docs' mirror link check

- **Seven links pointed at a directory rather than a page.** On disk an agent can list a
  directory, so the defect is invisible where this payload is developed; served over HTTP by
  Docs, the link dead-ends. Three were inherited from 0.2.0's `../ssr/` links and three more
  were introduced by this release's restructure, which rewrote them to `../`. Every one now
  names the page it means.
- **The link test could not see them.** Its pattern required a `.md` suffix, so a link to a
  directory was structurally unmatchable — the check reported "all links resolve" while seven
  did not resolve for any reader on the web. It now matches any relative target and asserts the
  target is a file.
- **`skill-contract` treated a directory as resolved too.** It now decides by **mode**, because
  the mode says whether the link can still be fixed. `--source=<dir>`, which an SDK lane runs on
  its own skill before releasing, **fails** on a directory link: it is their link and the release
  has not happened. The aggregate sweep over already-published packages **reports** it, since
  those cannot be edited and Docs generates a per-directory index that resolves it. A missing
  path is a violation in both modes — nothing backstops that. A directory link inside this
  payload fails the suite, which is the same principle applied to our own tree.

### Changed

- `doctor` reports which core each binding resolved to, and whether each installed skill
  matches its package (`match` / `stale` / `edited`).
- Pinned guides are verified against an exact published version, not a floor. `doctor` routes
  you to the package's README outside it.
- Findings in sibling SDK examples are baselined in the suite rather than failing it. They are
  defects in repos this one does not own and cannot fix, and a permanently red suite stops being
  read — but anything new fails, and each known entry records where it was reported.

## 0.2.0 - 2026-10-14

### Fixed
- **The SSR rewrite left older text in the same files saying the opposite.** Found in
  review: `ssr/sveltekit.md`'s banner, §0, §4, common-failures table and checklist still said
  seeding doesn't server-render, and the checklist still required the render gate §3
  prohibits. `rendering-mode.md` still called the pure function "the only way" and said
  "never with `curl`". All brought in line. Also fixed the §2 sample, which seeded from
  `data.translations` while `load` returned `initialTranslations`, so every request reset to
  base language. Stopped calling Nuxt "prohibited". Removed a stale "being re-measured" note.
  Fixed `verify.md`'s "string literal" checklist item, and the three remaining
  `translationsLoadingPromise` sites. The Nuxt Nitro-hook result was flagged in review
  and then re-measured and confirmed (sole writer, positive control in the same responses,
  Nuxt 3.21.11 and 4.6.1). The window opens on an event-loop turn, not on an await.
- **`invariants.md` said "the phrase argument must always be a literal."** The lint rules
  never enforced that; they flag *construction* (template substitution, concatenation,
  `sprintf()`, PHP `"$var"`), not a variable argument. The real rule is cardinality:
  `t(product.description)` from a CMS is a bounded editorial set and is correct. Corrected in
  `invariants.md`, `SKILL.md` and the rules `install.mjs` inlines for Codex/Gemini/Cursor,
  which now also say plainly that content from a CMS, database or third-party API needs no
  special handling.
- **`compilerOptions.experimental.async` is now documented as unsafe with a module-global
  seed**, with the measured table. The trigger is not the flag but a read landing after an
  `await` in the same script — 3/4 wrong-locale, and that is the shape most people write.
  With the flag on, SvelteKit leaves the structurally-guaranteed category and joins Nuxt's.
- **Corrected the mechanism:** `render()` returns a `RenderOutput` that is also a thenable,
  fully populated synchronously only in the default renderer — not "a string, not a Promise".
- **`translationsLoadingPromise` was described as a success signal in six places.** Verified
  against published `0.6.5`: it is pre-resolved before `init()`, stays pre-resolved if key
  validation fails, and resolves normally on a failed catalog fetch. Its declared type is
  `Promise<unknown>` with no JSDoc — the success semantic was this skill's inference. Now
  documented as *"the change is no longer in flight"*, with the note that a locale mismatch
  is not a failure test either and an error state needs a caller-supplied timeout.
- **App Router now has a documented path instead of a prohibition.** The pure catalog
  function in a Server Component is measured working — 80/80 concurrent, ICU intact, no
  module state touched — and is immune to the module-graph split by construction.
  `init({ initialTranslations })` covers hydration.
- **Documented the persisted-catalog defect and that the component-body seed closes it.**
  `sTranslations` persists to localStorage and rehydrates at module load with **no locale
  tag**, so nothing can tell it is stale. On a client-only app that is a 180–240ms flash of
  the previously viewed language; on a seeded SSR page it *destroys correct server output* at
  hydration. Seeding in the component body closes both that and the concurrency window — one
  placement, two hazards. `init({ initialTranslations })` in `onMount` does not help, because
  it runs after the stale paint.
- **Corrected: "a total outage looks fine" holds only from a cold process.** Once any locale
  has succeeded the singleton is poisoned, and a later total outage mislabels every locale
  rather than none.
- **SSR catalog seeding is now framework-scoped, measured rather than assumed.** Recommended
  on SvelteKit; **unsafe in practice on Nuxt** — a safe position exists (Nitro hook seed,
  `app.vue` reads before any await), but `await useAsyncData`, the idiomatic Nuxt fetch, takes
  it from 0/80 to 67/80; **non-functional on the Next App Router**, where Server and
  Client Components hold separate module instances so the seed lands in a graph the reader
  is not in — 100% of non-base locales wrong at concurrency 1. The operative rule is *no
  suspension between the seed and any `t()` read*, which is a subtree property, not a
  statement about where the seed goes.
- **The pure catalog helper is re-ranked, not demoted.** It ranks first on App Router and
  Nuxt: holding no module state, it is immune to both cross-request leakage and the
  module-graph split by construction.
- **SSR guidance was wrong about `t()`, and it cost seven production sites their search
  visibility.** `core/rendering-mode.md` claimed all four primitives render base language
  during SSR "always" and that seeding the catalog server-side was an unavoidable data
  race. `t()` server-renders correctly once `sTranslations` and `currentlyLoadedLocale` are
  set during the render — a path the SDK's own `markLoaded` JSDoc describes. Rewritten with
  the four conditions that keep seeding safe, verified on SvelteKit under concurrent load.
  `<Phrase>` / `<Translate>` genuinely cannot server-render; the track now gives the real
  reason (effects mount DOM walkers) and the measured 4–24% residue that implies.
- **`verify.md` told readers `curl` could never verify SSR translations.** True only of the
  unseeded pattern this skill documented, and it steered people away from the single check
  that exposes the failure. Now split by whether the app seeds, with the byte-identical
  diff test and both concurrency tests.
- **`integrate/svelte.md` typed `sTranslations` as `Readable` and called it "rarely
  needed".** It is `Signal<iCategories>` with a public `set()`, and it is the load-bearing
  SSR primitive.
- **`ssr/sveltekit.md` recommended a render gate.** A replacing loading/error state is
  server-rendered on a slow or failed fetch, so a crawler indexes the spinner as the page.
  Failure states now overlay, never replace.
- **`VERIFIED.md` contained two tables that contradicted each other.** The `Defect status`
  table still called `langsys/langsys-php` unpublished and four Svelte/Vue fixes
  *"fixed, unreleased"*, while the table above it recorded all of them as RESOLVED. Re-checked
  every row against the published artifacts and consolidated: PHP is live on Packagist through
  `v1.3.1`; B, C, D, the Vue `detectPreferredLocale` guidance and the Svelte ISO-8601 claim are
  all resolved in shipped versions, each now citing the file and line that proves it.

  Verified by **paired presence, not absence** — the corrected text is quoted from the tarball
  (`README.md:303`, `dist/index.d.ts:215`, `README.md:144`), because a defect pattern can vanish
  from a doc that was deleted, reworded or moved.

- **The `Working tree` column is retired.** It described peer repos' uncommitted state, which is
  unverifiable by construction: it recorded what an agent told me, not what a user can install.

- **`VERIFIED.md` carried one global `Verified:` date** covering claims re-verified over the ten
  days after it. It now scopes the date to the snapshot table and points at `drift-guard` as the
  live answer.

- **`langsys-js-server@0.1.0` was missing from the version table** despite being the sixth
  supported package and the target of every JS SSR track since 0.1.6.

- **`PLAN.md` still called `data-langsys-phrase` "approved but unreleased"** with "no version
  number yet". It shipped in PHP `v1.1.0`, and `integrate/php.md` has required `^1.1` since.
  Kept as the worked example of boundary-documentation — the method held: no release-day rewrite.

- **The README advertised "82 tests"** against a suite of 94. Replaced with "the full suite"
  rather than the new number: nothing checks that count, so any number there is a standing
  drift claim that resets rather than resolves.

### Known
- **`drift-guard`'s `RESOLVED` lines are confirmations, not tasks.** They are emitted whenever a
  defect is absent upstream, with no awareness that `VERIFIED.md` already records it — so all
  five print on every run, forever, asking for work already done. The cost is documented above:
  the standing noise is what let the `Defect status` table drift unnoticed. The sharper half is
  that a resolved defect **returning** upstream would print as `still open in <pkg>@<version>`,
  which reads as no news. Not fixed here; this release is documentation only.

## 0.1.8 - 2026-08-22

### Fixed
- **The README did not know about its own new surface.** `Supported` gained
  `langsys-js-server`, which the SSR tracks have routed to since 0.1.6, and the
  installed layout now documents `/langsys-scan` and `/langsys-doctor` — shipped in
  0.1.5 and mentioned nowhere a reader would look. Both are thin routers over the
  same payload, and the same tools are on `PATH` via `npx` for anyone not in
  Claude Code.

## 0.1.7 - 2026-08-22

### Fixed
- **Two timing claims in `core/server-sdk.md` were wrong**, found by the
  `langsys-js-server` builder reading my published track against their published
  tarball — the reverse of the direction I had run. Re-measured against `0.1.0`:

  - The missing-`cache` warning fires on the **first `run()`**, not at
    construction. "Warns at construction" sends someone to boot logs it is not in.
  - **The read-only-key refusal comes from the post-response drain**, so it
    appears only when a phrase was actually missing. A fully-translated page is
    silent.

  The second mattered more than the first. My wording — "the package says so at
  startup" — invited *no warning → not read-only*, and **silence is produced by
  three different states**. That is this project's own "a check that produces no
  signal reads as a pass", arriving in the shape of a log rather than a test.
  Recorded in `VERIFIED.md` with the generalisation: **before documenting a
  warning as a way to verify something, ask what else produces silence.**

## 0.1.6 - 2026-08-22

`langsys-js-server@0.1.0` is on npm, so the SSR tracks now route to it. Verified
by installing the published package from the registry and exercising it, not from
the repo.

### Added
- **`core/server-sdk.md`** — the contract for server-rendered translated HTML.
  Written once and referenced by all three JS SSR tracks rather than triplicated.

  Its capability matrix carries a third column — **"how you would notice if it
  were wrong"** — because a limitation nobody can detect is indistinguishable
  from working. That column immediately caught an error of mine: I wrote "same"
  in `<Translate>`'s row, and `<Translate>` is the one primitive with **no
  detector at all** — its host stamps no marker, so `auditRenderedHtml()` cannot
  see it. Confirmed against the published tarball.

- The four things that are wrong by default if you guess: wrap the framework's
  **request hook**, not a layout (`load` runs first, and `t()` outside a scope
  returns the base phrase and warns rather than throwing); `result.missing` is a
  **live view**, not a snapshot; `flush()` needs the actual `RenderResult`, since
  a hand-built one double-POSTs the queue; and `preloadCatalog()` exists because
  "set locals, then render" needs the catalog before the render.

### Fixed
- **Two internal links were wrong for the layout readers actually see.** The
  payload's links are written for where the files *live* — `.langsys/skill/`
  beside `.langsys/VERIFIED.md` — so `SKILL.md` resolved in the source tree and
  pointed outside `.langsys/` once installed, while `rendering-mode.md` was the
  mirror image. The link test now **installs first and validates there**.
- The interim hand-rolled catalog helper is marked superseded, with the
  behavioural surprise stated: it does not harvest and the package does, so a
  deployment that has run it for months sees a **burst of registrations** on
  first deploy.
- `"English"` no longer stands in for the base locale where config is meant —
  audited, two real instances, and the ones about English's two plural forms
  correctly left alone.
- The cross-SDK **marker matrix**: `data-ls-phrase` is absent from PHP, and
  `data-langsys-contentblock` has no JS equivalent. A `<Translate>` is identified
  by its component, not by anything in the markup.

## 0.1.5 - 2026-08-21

Two standalone skills, and a bug in the global install that made the skill's own
first instruction fail. Every item below was found by a review agent that was
asked to **break the tests and confirm they went red** — five of six regressions
were caught, and the one that escaped is the reason `scopePaths` is now a
separate, unit-tested module.

### Added
- **`/langsys-scan`** — sizes a job without starting one. Profile, sites split by
  primitive and effort, deployment posture, content modules. Leads on the NOT
  EXAMINED section rather than burying it: a site count presented without its
  exclusions reads as a survey when it is a sample.
- **`/langsys-doctor`** — interprets findings rather than printing them. Includes
  what `doctor` **cannot** tell you (base locale, whether phrases register
  correctly) and states plainly that a clean run is not a verified integration.

Both are thin routers over the same payload, never copies — a second copy of the
guidance is a second thing to strand.

### Fixed
- **A global install told the agent to run tools that were not there.** Markdown
  **links** were rewritten per scope; embedded **commands** were not. So
  `node .langsys/bin/doctor.mjs` resolved against the project directory while the
  payload sat in `$HOME/.langsys/` — Phase 0's first instruction failed with
  "Cannot find module", in a file whose documentation links two lines above
  resolved correctly.
- **The first fix was incomplete in three of five hosts.** It was applied inside
  `writeManagedBlock()`, which `codex`, `gemini` and `cursor` never call — they
  interpolate the shared block through a bare write. Now scoped at the source's
  construction, so no host can inherit the wrong paths however it writes them.
- **`verify.md`'s ast-grep command was never scoped at all**, and the payload is
  copied verbatim, so a global install routed the agent to a document whose one
  executable line pointed nowhere. The rewriter now covers `lint` as well as
  `bin`, and the payload is scoped after copying.
- **`--global` with `--dir` silently ignored `--dir`.** The user believes the
  install was scoped; it was not. Now an error.
- `scopePaths` is idempotent. Without the guard, running twice produced
  `~/~/.langsys/…` — latent today, reachable by ordering, and invisible to any
  assertion on installed output. That is why it is unit-tested directly.
- Re-running an unchanged install reports `0 written` again; the payload's
  changed-detection now compares against what would actually be written.

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
