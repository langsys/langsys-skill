# VERIFIED.md

Every load-bearing claim the skill makes, checked against the **published artifact users actually install** — `npm pack <pkg>@<version>` / Packagist — never a sibling working tree (PLAN.md §1).

**Verified:** 2026-08-16

## Published versions at time of verification

| Package | Published | Local checkout | Peer deps | Depends on base |
|---|---|---|---|---|
| `langsys-js-typescript` | **0.6.5** | 0.4.1 | — | `intl-messageformat@^11.2.7` |
| `langsys-js-react` | **0.6.6** | 0.4.1 | `react@^18 \|\| ^19` | `^0.6.5` |
| `langsys-js-svelte` | **3.6.3** | 3.4.0 | `svelte@^5` | `^0.6.4` |
| `langsys-js-vue` | **0.2.0** | 0.1.1 | `vue@^3.4` | `^0.6.5` |
| `langsys/langsys-php` | **1.3.1** | — | PHP ≥7.4 + ext-intl | — |

All three binding carets now resolve to base **`0.6.4` or newer** (React `^0.6.5`, Vue `^0.6.5`, Svelte `^0.6.4`), verified from each published `package.json`. That closes a structural gap worth naming: the old Vue range `^0.4.1` capped at `0.4.3`, so **every base-SDK fix from `0.5.0` onward was unreachable for Vue consumers regardless of what any document claimed.** A caret is part of the API surface — a correct fix behind a stale range ships as no fix at all.

### A defect in a NEWER published version is not proof of regression

Vue's release history, from the published record:

```
0.1.1   defects present   (what I originally audited)
0.1.2   defects STILL present — published by a second maintainer, from a branch point predating the fixes
0.2.0   defects fixed
```

`0.1.2` was a version-bump commit that happened to carry previously-unreleased doc work — work that *contained* the two defects I had reported. Had I re-audited during that window, I would have found my own reported defects in a **newer** published version and concluded the fix regressed or never landed. Neither was true.

> **The disambiguator is ancestry, not version order.** Ask whether the fix commit is an ancestor of the release tag. A parallel release cut from an older branch point reproduces old defects without regressing anything.

This is a real hazard for `drift-guard`, which compares a claim against *the latest published artifact* and has no notion of branch topology. It can therefore report a resolved item as open again, with complete accuracy about the artifact and a wrong conclusion about the code. When a closed defect reappears, check the release's ancestry **before** reopening the row — and prefer reopening as "present in <version>" over "regressed", because the first is what was observed and the second is an inference.

## Verified claims

| # | Claim | Verdict | Evidence (published artifact) |
|---|---|---|---|
| 1 | `t()` signature is `(phrase, category?, params?)` | **CONFIRMED** | `langsys-js-typescript@0.4.3/dist/index.d.ts:183-186` — `interface TFunction { <P>(phrase: P, ...args); <P>(phrase: P, category: string, ...args) }` |
| 2 | `apiUrl` is **not** a field on `iLangsysInitConfig` | **CONFIRMED** | Absent from `dist/index.d.ts` entirely. Use `LangsysAppAPI.setBaseUrl()` before `init()`. Contradicts `langsys-js-vue/README.md:95`. |
| 3 | `detectPreferredLocale(header, supported)` has **two** failure modes returning different things | **CONFIRMED, with a correction to my earlier wording** | `dist/index.mjs:860-867` — see below. |
| 4 | Unmatched-params debug warning exists at ≥0.4.3 | **CONFIRMED** | `warnUnmatchedParams` present in `dist/index.mjs` (3 sites). Absent from published 0.4.1 — the version gate is real. |
| 5 | All three bindings export `Translate`, `Phrase`, `DontTranslate` | **CONFIRMED** | React `dist/index.d.ts:245` (export list); Svelte `dist/index.d.ts:15-17`; Vue `dist/index.d.ts` declares all three. **Full parity.** |
| 6 | `<Phrase>` nests inside `<Translate>`; block tokenizer skips it | **CONFIRMED** (source) | `data-ls-phrase` early-return at `translate.ts:195`, `content-block.ts:204`. Internal marker — authors write `<Phrase>`, never the attribute. |

### Claim 3 in detail — two failure modes, only one returns `false`

I earlier wrote that the documented `|| 'en-US'` idiom "never fires." **That was wrong**, and the imprecision would have produced a bad lint rule. Corrected by the Vue agent against `dist/index.mjs:860-867`:

```js
const userLocales = this.getUserLanguagePreferences(acceptLanguageHeader);
if (userLocales.length === 0) return false;        // ← nothing detectable at all
if (supportedLocales?.length) {
  const bestMatch = this.findBestLocaleMatch(userLocales, supportedLocales);
  if (bestMatch) return bestMatch;
}
return canonicalizeLocale(userLocales[0]);          // ← detected but unsupported
```

| Situation | Returns |
|---|---|
| Nothing detectable (empty `Accept-Language`, no `navigator.languages`) | `false` — **`\|\| 'en-US'` does fire** |
| Detected but not in `supportedLocales` | the user's top preference, canonicalized — **`\|\| 'en-US'` does not fire** |

So the fallback works, just on the wrong one of the two cases. **This is why the bug survives casual testing:** an engineer testing with no header sees the fallback behave perfectly. `dist/index.d.ts:357` declares `string | false`, so the type is honest that `false` is reachable — it just cannot express which case.

**Lint consequence:** a rule flagging `detectPreferredLocale(…) || …` as dead code would be a **false positive**. The accurate, narrower claim is that the fallback does not cover the no-match case. The guard that actually works:

```ts
const detected = LangsysApp.detectPreferredLocale(header, supported);
const locale = detected && supported.includes(detected) ? detected : 'en-US';
```

### Claim 2 severity refinement — TypeScript users were never exposed

`langsys-js-vue`'s `iLangsysInitConfig` is `extends Omit<iVanillaInitConfig, 'UserLocaleStore'>` — it *inherits* rather than redeclaring, so `apiUrl` was never in the type. A TypeScript consumer pasting the bad example gets an excess-property error at compile time.

**Only plain-JS consumers were exposed** — a narrower blast radius than "copied code fails", but worse where it lands, because JS is precisely where there is no signal. The property is silently dropped and the SDK keeps talking to production while the developer believes they are pointed at localhost.

## Defects confirmed **in published artifacts**

Not working-tree issues — these are shipped to users today.

| # | Defect | Location (published) | Impact |
|---|---|---|---|
| A | ~~`composer require langsys/langsys-php` does not work~~ | **RESOLVED** | Vendor-namespace permission resolved upstream. `langsys/langsys-php` is live with `v1.0.0`–`v1.1.0` published; requires `php >=7.4` + `ext-curl`/`ext-json`/`ext-intl`. Track now leads with Composer. `doctor` flipped green with no code change — the three-state check already covered it. |
| G1 | ~~Content-block `custom_id` diverges between SDKs for non-ASCII~~ | **RESOLVED in 0.6.0** | `generateCustomId` now uses standard MD5 over canonical JSON. Independently verified against the published tarball: `md5` agrees with UTF-8 MD5 for `Café`, `Don't miss out`, `日本語`, `Ελλάδα`; upstream reports 12/12 match against langsys-php's reference fixtures with byte-identical canonical JSON. |
| G2 | ~~Same root cause could make the JS SDK collide with itself~~ | **RESOLVED in 0.6.0** | The OR-absorption class no longer exists. Verified `éa`/`ǩa`, `Café`/`Cafǩ`, `abéa`/`abǩa` all distinct — **and the `abéb`/`abǩb` control stayed distinct**, so a fix that collided everything could not have read as progress. |

> **Migration is automatic and lookup-only.** `Translate` resolves the corrected id first and falls back to the legacy id on a miss, so existing blocks keep serving their translations; registration always uses the corrected id, so the legacy population only shrinks. `md5Legacy` and `generateLegacyCustomId` are exported for reconciliation tooling, deprecated on arrival. **Pure-ASCII ids are byte-identical to before** — verified `md5(x) === md5Legacy(x)` for ASCII — so only non-ASCII blocks rebase.

| B | ~~Svelte `<Phrase>` doc example uses `{n}`~~ | **RESOLVED in 3.5.0** | Now `Based on %n% <strong>reviews</strong>`. Confirmed in the published tarball by drift-guard. |
| H | ~~`<select>` content blocks get different `custom_id`s across SDKs~~ | **RESOLVED in 0.6.3** | The JS tokenizer harvested every `<option>` twice. **Verified by a third party** — the PHP agent ran the *published* `0.6.3` tarball in a jsdom DOM against both shared fixtures: html→tokens 17/17, tokens→custom_id 17/17, custom-id fixtures 12/12. `tokenizeElement` now yields `["S","M"]` matching PHP; `legacyTokenizeElement` still yields `["S","M","S","M"]`, which it must, or the migration fallback would key against nothing and existing `<select>` blocks would orphan rather than resolve. |

| I | ~~Missing/null ICU argument produces broken or silently-wrong output~~ | **RESOLVED in 0.6.4** | Three distinct paths, only two sharing a fix: a **missing** argument makes `intl-messageformat` throw (→ raw pattern shipped to users); a **`null`** argument does *not* throw, coercing to `0`, so `{count:null}` and `{count:0}` were byte-identical `0 items` — **a defect that renders as valid data**. Verified independently against published `0.6.4` (6/6), matching PHP v1.3.1 exactly: select missing/null → `Bienvenide Sarah`; plural missing/null → `{count} items`; genuine `0` → `0 items`. The null path needed a separate pre-check and is confirmed fixed. Standing check: `langsys-php/tests/fixtures/interpolation-reference.json`. |

| C | ~~Same stale example + `params` doc comment~~ | **RESOLVED in 0.2.0** | Verified in the published tarball: `dist/index.d.ts:203` now reads `%n%` / `%name%`, and `:215` `Based on %n% <strong>reviews</strong>`, with six further lines explaining that the bare form survives in Vue only because Vue consumes `{{ }}` alone. The last open defect from the Vue audit. |
| J | ~~Svelte README claims `Date` values serialize to ISO 8601~~ | **RESOLVED in 3.6.3** | The claim is gone from the published README. Verified by absence in the tarball — which is the weaker form of evidence, so what is recorded is "the claim is no longer made", not "the behaviour was changed". |
| K | Vue `README.md:105` cites "the current base SDK (`0.4.3`)" while `0.2.0` depends on `^0.6.5` | **fixed pending release** (open in published `0.2.0`) | Found while verifying C. The surrounding guidance is correct; the version reference is two minors stale, so a reader checking `0.4.3` for `setBaseUrl` draws the wrong conclusion about which versions the note applies to. |
| D | ~~Svelte declaration header omits `Phrase`/`DontTranslate`~~ | **RESOLVED in 3.5.0** | Header now lists all three and states *why* `Phrase` exists (agreement/pluralization), plus the `%name%` vs `{name}` split. This was the highest-value fix: the declaration header is what IDE hover surfaces unprompted. |
| E | `langsys-js-react@0.4.3` `<Phrase>` example is correct (`%n%`) with rationale | React `dist/index.d.ts` | **Reference wording** — B and C are a verbatim port, not a rewrite. |

## Consequences for the skill

- **PHP track (task #17) must not open with `composer require`.** It teaches the manual `autoload.php` install until defect A is resolved, and `doctor` checks for the package rather than assuming Composer resolution succeeds.
- Base SDK floor for the unmatched-params verification step is **0.4.3** (claim 4). `doctor` gates on it; below that, `verify.md` falls back to the ast-grep rule alone.
- `<Phrase>`/`<DontTranslate>` are documented for **all three** bindings (claim 5), regardless of upstream README/declaration coverage.
- Claims 2 and 3 mean the Vue track actively corrects two README instructions.

## Methodology: published artifact vs working tree — two audiences, two sources

Verifying against `npm pack` is right for **what the skill teaches**, because that is what users install. It is *wrong* as the basis for **reporting a defect to the agent who owns the repo**, whose working tree may already be fixed.

By the time the Svelte and Vue agents replied, every defect below was **already corrected in their trees and awaiting a release call**. Re-reporting from tarball output would have been a false positive against work already done.

| Audience | Source of truth | Why |
|---|---|---|
| Skill content, `doctor` gates, version boundaries | **Published artifact** | It is what users actually install |
| Defect reports to a peer repo | **Working tree, checked first** | Their tree may lead the registry by several commits |

So each entry carries an **observation timestamp** and a published-vs-fixed status. A defect being "open" here means *open in the published artifact* — not that anyone is sitting on it.

### Why docs go stale: the stranding mechanism

The founding rule of this file — *verify against source, not documentation* — was arrived at empirically, from finding wrong claims. There is a **mechanism** behind it, traced in two repos independently:

| Release | What shipped | Changelog entry | Result |
|---|---|---|---|
| `langsys-js-typescript@0.2.0` | `t(category, phrase)` → `t(phrase, category?)` | **none** | `CLAUDE.md` stranded on the old signature for 11 releases; README unfixed until 0.5.0 |
| `langsys-js-svelte@3.1.0` | added `<Phrase>`/`<DontTranslate>`, removed `contentBlocks` | **none** | components undocumented for 4 minor releases; stale `.d.ts` header; `CLAUDE.md` citing a removed export |

**A missing changelog entry removes the prompt to update every other doc surface.** The docs were not written carelessly — they were correct when written, then stranded by a release that announced nothing.

This reframes my own first finding. I recorded "Svelte lacks `<Phrase>`, steer users to `<Translate>`" after reading its README. That was not a misreading: it was an agent reading documentation that was **accurate for a release the code had moved past**. The doc-vs-source gap I built this whole file to defend against is largely a *downstream symptom* of releases shipping without changelog entries.

Hence `src/bin/changelog-coverage.mjs` — standalone so each repo can run it in its own CI, on every release rather than when someone remembers. As of the latest run all four SDK repos are fully covered.

**Caveat on filling a gap:** reconstruction is only cheap where commit-message discipline already held. Where commit bodies explain the mechanism, history is recoverable; where they are terse, you can *detect* the gap but not fill it accurately. There the honest move is a stub recording that the release exists and is undocumented — **never an invented reconstruction**, which is worse than an acknowledged gap because it stops anyone looking further.

### A comment inside a source file is documentation, not source

I documented PHP's `data-notrans` after reading `HtmlParser.php:184`:

```php
// Skip elements with translate="no" or data-notrans
```

The comment stated **intent**. The implementation did the opposite — a bare `data-notrans` extracted the content instead of skipping it. I recorded "I read the source" as verification when what I had actually read was **prose that happened to live in a `.php` file**.

> **Reading a source file is not the same as reading the source.** A comment is a claim by the author about the code, with exactly the same failure modes as a README — including going stale, and including being wrong on the day it was written.

Verification means reading the *implementation*, or better, **executing it**. Every defect in the list below was found by execution; none by reading.

### The absence pattern — nine instances, one generalisation

Checks and fixes that produce no signal because they never ran, or because their evidence cannot be reproduced:

| # | Instance | Found by |
|---|---|---|
| 1 | ast-grep rule files silently rejected → whole scan aborts, reads as clean | me, testing |
| 2 | `--strict` satisfiable by a fabricated changelog entry | base-SDK agent |
| 3 | `changelog-coverage` in CI with no tags fetched → vacuous pass | Svelte agent, reproducing |
| 4 | Cross-SDK parity test comparing PHP's `md5()` against PHP's `md5()` | base-SDK agent, reproducing |
| 5 | Release `sed` fails **open** — a non-matching pattern ships the literal word "unreleased" | base-SDK agent, testing all branches |
| 6 | `custom-id-reference.json` shipped a `custom_id` computed from an **unrecorded** category — unreproducible from outside, while reading as verified data | base-SDK agent, running their implementation against it and getting 0/17 |
| 7 | `requires_intl` **inferred** from "does the template contain ICU syntax" — wrong in both directions (recovery cases need no intl; a plain `{id}` does), 4 of 19 wrong, and not the four anyone would guess | PHP agent, generating the fixture twice — with and without the extension — and taking the flag from the diff |
| 8 | A translatable-attribute list written from **memory** rather than from `TRANSLATABLE_ATTRIBUTES`: invented `summary`, omitted nine real entries, and missed `value` entirely | Vue agent's report, checked against the published constant |
| 9 | `## 0.2.0 - unreleased` shipped in the published Vue tarball. Not a bad value — a value with a **correctness window**: right when written, wrong the instant it shipped, with nothing watching the boundary | me, reading the tarball; **cause corrected by the Vue agent** — see below |

Instance 7 generalises cleanly on its own: **when a property is expensive to reason about and cheap to observe, observe it.** The inferred flag would have shipped skip conditions that silently did not run on hosts without `intl`, while appearing to cover them.

Instance 8 is mine, and it is the plainest case in the table. `scan`'s attribute list looked authoritative, was tested, and passed — because the tests asserted the list against *itself*. Nothing in the harness could distinguish a correct list from a confidently wrong one; only the published constant could, and I had not read it. **A test written from the same memory as the code inherits its errors.** The list is now transcribed from `langsys-js-typescript@0.6.5` `dist/index.js:1140`, with the citation in the source so the next reader can re-derive it rather than trust it.

**The generalisation the list supports: every instance was found by someone other than the author, and every one by executing or by reading the artifact rather than reviewing.** Instance 6 was written by the PHP agent and caught by the base-SDK agent — filing it as self-caught would destroy the only pattern here worth having.

That is also the argument for cross-SDK reference fixtures over per-repo assertions: a fixture only proves something when a *different* implementation runs against it. The Svelte agent's line is worth keeping beside the count — **the next instance probably looks like none of the previous ones.**

### Same symptom, four different causes — why "which pattern is this?" is a question

I diagnosed instance 9 as the fails-open `sed` of instance 5 and reported it to the Vue agent that way. **It is not.** Their correction: `_dev_/publish.sh` performs no changelog substitution at all, so there is no guard missing and nothing broken to repair — the gap is that dating the heading is a manual step with nothing enforcing it. Instance 5 needs a guard added to an existing substitution; this needs a substitution that does not exist. Different remedy, and my version would have misdirected whoever picked up the row.

The diagnosis never reached this file — it lived only in the message — so there is nothing to retract here. That is luck, not process: had I recorded it at the same speed I asserted it, the wrong cause would now be the durable record.

They invited a check before generalising, and it was worth running. All four repos, verified from the published tarballs and the scripts:

| Repo | Ships `CHANGELOG.md` to npm | Substitution | On no match | Exposed |
|---|---|---|---|---|
| `langsys-js-typescript@0.6.5` | yes | guarded | hard stop | no |
| `langsys-js-react@0.6.6` | yes | guarded | prompt → abort | no |
| `langsys-js-svelte@3.6.3` | **no** | guarded | **warn and continue** | no |
| `langsys-js-vue@0.2.0` | yes | **none** | — | **yes — and it reached npm** |

Their guess was "the base SDK has it and the bindings don't". Wrong in the opposite direction from mine: react and svelte both have it, and **Vue is the sole outlier** — the byte-identical-scripts premise no longer holds.

The safe generalisation is not about `sed` at all:

> **A changelog stamp needs enforcement proportional to its reach.** Ship the file to consumers and the stamp must be enforced; don't ship it and a warning is sufficient.

Svelte's warn-and-continue is *correct* because Svelte publishes only `dist/`, so a missed stamp cannot reach anyone — and its script says exactly that in a comment beside the check. Vue is the only repo that ships the file with no enforcement, which is precisely why it is the only one where this became a published defect. Anyone porting a fix should take **react's** block, not Svelte's: Svelte's leniency is calibrated to a repo that does not ship the file.

### The inverse failure: a harness that fails spuriously

The six above all **fail to fire**. The mirror image is a check that fires *wrongly* — and it is more dangerous socially, because the output is a defect report about someone else's code.

Worked example, from verifying defect H. The PHP agent's first cross-SDK run reported **0/17** on the tokens leg. Not a real divergence: they had called `encodeRichText` (the `<Phrase>` markup tokenizer, which emits `{m0o}` tokens) instead of `tokenizeElement` (the block tokenizer producing phrase lists). Both are exported from `langsys-js-typescript@0.6.3`, and both are plausibly "the tokenizer":

```
encodeRichText, generateLegacyCustomId, legacyTokenizeElement,
markupTokenValues, md5Legacy, tokenizeElement
```

What stopped a dramatic false report was the *shape* of the failure:

> **A real divergence is usually narrow. A total failure across every case — including the trivial ones — is usually the harness.**

Every case returned `{phrase, slots}` rather than a list, *including inputs with no markup at all*. That is wrong-function, not wrong-output.

Two things follow. Before reporting a defect in someone else's code, check whether the failure is uniform and structurally odd; if it is, suspect your own harness first. And when a package exports several similarly-named functions, an integrator will pick the wrong one — worth naming explicitly in any cross-implementation fixture.

### Refusing second-hand documentation is a detection mechanism, not just hygiene

The rule "verify against source" is usually framed as protecting *the reader*. It also protects *the source*, and there is a worked example.

The Svelte agent declined to document PHP's `data-langsys-phrase` from the base-SDK agent's description, on the grounds that documenting from a peer's summary is exactly how I came to record "Svelte lacks `<Phrase>`". That refusal prompted the base-SDK agent to check whether their *own* README claim about the attribute was second-hand — it was. Reading `HtmlParser.php` directly surfaced an opt-out semantic nobody had mentioned: presence enables, but an explicit `false`/`0` disables.

That semantic was **missing from shipped code**, not just from docs. Base 0.6.0 matched on presence alone, so a subtree an author had deliberately un-marked was skipped by JS and translated by neither SDK. Fixed in 0.6.1.

**So a refusal to propagate a second-hand claim found a live bug two links up the chain.** Generalised:

> When a claim cannot be traced to a primary source, the right move is to decline to repeat it — and to say so. The person who made the claim may not know it is second-hand either, and asking them to check is often what surfaces the defect.

This is the counterpart to the tautological-check lesson: fabricated evidence closes an open question, and unsourced repetition launders an open question into a settled one.

### The audit path that actually works

From the Svelte agent, and worth generalizing: **two of that repo's three defects survived because they live outside markdown** — a JSDoc block and a type-declaration header. Any "do our docs cover X?" audit that greps the README misses both by construction.

The path that found them was: **enumerate the real exports first, then check whether the docs agree.** That ordering is what the drift guard (task #24) must implement — it checks `dist/*.d.ts` declaration headers and JSDoc blocks, not just `README.md`.

## Defect status

| # | Published | Working tree | Note |
|---|---|---|---|
| A — PHP not on Packagist | **open** | `v1.0.0` re-tagged at `9a4fbf9` | **Package renamed `langsys/php-sdk` → `langsys/langsys-php`** to match the repo; Packagist identity comes from `composer.json`, so the old name will never resolve. Blocked on a **vendor-namespace permission**: `langsys/` is owned by another Packagist account, and Packagist only accepts `langsys/*` from an existing vendor maintainer — reporting the refusal as though the repo were claimed. Renaming does not help. Blocks task #29. |
| F — PHP ICU plural paths unverified | **RESOLVED** | verified on CI | Closed. CI ran with `intl 8.4.24` / ICU 74.2 across PHP 7.4–8.4: Russian plurals (incl. 21→`one`, 111→`many`), Arabic's six categories with Arabic-Indic digits, locale number formatting, ICU-vs-simple byte equality, malformed-ICU fallback — **all passing**, and `LANGSYS_REQUIRE_INTL` turns the skip into a hard failure on CI so they cannot pass by omission. Per-language plural correctness is now verified, not assumed. |
| B — Svelte `{n}` example | open in 3.4.1 | **fixed**, unreleased | Repo swept for other brace-in-markup examples; this was the only one |
| C — Vue `{n}` example | open in 0.1.1 | **fixed**, unreleased | Plus a third site at `README.md:253` and a commented-out `apiUrl` at `README.md:68` that I had not found |
| D — Svelte declaration header | open in 3.4.1 | **fixed**, unreleased | Now lists all three components; also fixed the layering summary at `README.md:27`, same root cause, which I missed |
| E — React reference wording | n/a | correct | Source for B and C fixes |
| Vue `README.md:95` (`apiUrl`) | **RESOLVED in 0.2.0** | fixed | **Correction to an earlier entry of mine.** I recorded this as a published defect after reading the *local working tree*. The published 0.1.1 README contains no `apiUrl` — verified by drift-guard against the tarball. The underlying API fact (claim 2, `apiUrl` is not a config field) is unaffected and remains verified from `dist/index.d.ts`. |
| Vue `README.md:308` (`detectPreferredLocale`) | open in 0.1.1 | **fixed**, unreleased | Both paths of claim 3 now documented, with the working guard |
| Svelte `README.md:140` ISO 8601 | open in 3.4.1 | **fixed**, unreleased | Confirmed empirically against the published bundle: Dates render `Mar 14, 2026` / `14.03.2026`. Went stale at the 3.2.0 CLDR adoption |

## Re-verification

Re-run before each release, and after Svelte 3.4.2 / Vue 0.1.2 ship — both agents committed to confirming on their threads. The CI drift guard (task #24) checks published artifacts across **all three doc surfaces** (README, declaration headers, JSDoc) and fails when a status changes, so fixed items don't linger here as open and regressions don't pass silently.
