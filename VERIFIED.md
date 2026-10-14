# VERIFIED.md

Every load-bearing claim the skill makes, checked against the **published artifact users actually install** — `npm pack <pkg>@<version>` / Packagist — never a sibling working tree (PLAN.md §1).

**Verified:** table below captured 2026-08-16; defect statuses re-verified against the
published tarballs on **2026-08-26**.

> A single date on a living file goes stale silently, which is this file's own failure class.
> Treat the date as belonging to the **snapshot table**, not to every claim — each entry names
> the version it was verified against. For "is this still true *right now*", the authoritative
> answer is `node src/bin/drift-guard.mjs`, which re-fetches the published artifacts.

## Published versions at time of verification

| Package | Published | Local checkout | Peer deps | Depends on base |
|---|---|---|---|---|
| `langsys-js-typescript` | **0.6.5** | 0.4.1 | — | `intl-messageformat@^11.2.7` |
| `langsys-js-react` | **0.6.6** | 0.4.1 | `react@^18 \|\| ^19` | `^0.6.5` |
| `langsys-js-svelte` | **3.6.9** | 3.4.0 | `svelte@^5` | `^0.6.4` |
| `langsys-js-vue` | **0.2.1** | 0.1.1 | `vue@^3.4` | `^0.6.5` |
| `langsys/langsys-php` | **1.3.1** | — | PHP ≥7.4 + ext-intl | — |
| `langsys-js-server` | **0.1.0** | — | none (`parse5`, `intl-messageformat`), Node ≥18 | — (does not depend on the base SDK) |

`langsys-js-server` is the one package here that is **not** a binding over `langsys-js-typescript` —
it reimplements translation against finished HTML, which is why it has no base-SDK dependency and no
peer framework. Its claims live in `src/skill/core/server-sdk.md`, verified against the `0.1.0`
tarball; `0.1.0` carries **no provenance attestation**, having been published outside CI.

**Two packages have published newer versions since this snapshot** — `langsys-js-react@0.6.7` and
`langsys-js-svelte@3.6.10`. The pins above are deliberately **not** bumped: a version number is not
evidence, and re-pinning without re-reading the artifact would launder an assumption into a
verified claim. The defect statuses below *were* re-checked against `3.6.10` and are cited as such.

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
| A | ~~`composer require langsys/langsys-php` does not work~~ | **RESOLVED** | Vendor-namespace permission resolved upstream. `langsys/langsys-php` is live with `v1.0.0`–`v1.3.1` published (queried 2026-08-26); requires `php >=7.4` + `ext-curl`/`ext-json`/`ext-intl`. Track now leads with Composer. `doctor` flipped green with no code change — the three-state check already covered it. |
| G1 | ~~Content-block `custom_id` diverges between SDKs for non-ASCII~~ | **RESOLVED in 0.6.0** | `generateCustomId` now uses standard MD5 over canonical JSON. Independently verified against the published tarball: `md5` agrees with UTF-8 MD5 for `Café`, `Don't miss out`, `日本語`, `Ελλάδα`; upstream reports 12/12 match against langsys-php's reference fixtures with byte-identical canonical JSON. |
| G2 | ~~Same root cause could make the JS SDK collide with itself~~ | **RESOLVED in 0.6.0** | The OR-absorption class no longer exists. Verified `éa`/`ǩa`, `Café`/`Cafǩ`, `abéa`/`abǩa` all distinct — **and the `abéb`/`abǩb` control stayed distinct**, so a fix that collided everything could not have read as progress. |

> **Migration is automatic and lookup-only.** `Translate` resolves the corrected id first and falls back to the legacy id on a miss, so existing blocks keep serving their translations; registration always uses the corrected id, so the legacy population only shrinks. `md5Legacy` and `generateLegacyCustomId` are exported for reconciliation tooling, deprecated on arrival. **Pure-ASCII ids are byte-identical to before** — verified `md5(x) === md5Legacy(x)` for ASCII — so only non-ASCII blocks rebase.

| B | ~~Svelte `<Phrase>` doc example uses `{n}`~~ | **RESOLVED in 3.5.0** | Now `Based on %n% <strong>reviews</strong>`. Confirmed in the published tarball by drift-guard. |
| H | ~~`<select>` content blocks get different `custom_id`s across SDKs~~ | **RESOLVED in 0.6.3** | The JS tokenizer harvested every `<option>` twice. **Verified by a third party** — the PHP agent ran the *published* `0.6.3` tarball in a jsdom DOM against both shared fixtures: html→tokens 17/17, tokens→custom_id 17/17, custom-id fixtures 12/12. `tokenizeElement` now yields `["S","M"]` matching PHP; `legacyTokenizeElement` still yields `["S","M","S","M"]`, which it must, or the migration fallback would key against nothing and existing `<select>` blocks would orphan rather than resolve. |

| I | ~~Missing/null ICU argument produces broken or silently-wrong output~~ | **RESOLVED in 0.6.4** | Three distinct paths, only two sharing a fix: a **missing** argument makes `intl-messageformat` throw (→ raw pattern shipped to users); a **`null`** argument does *not* throw, coercing to `0`, so `{count:null}` and `{count:0}` were byte-identical `0 items` — **a defect that renders as valid data**. Verified independently against published `0.6.4` (6/6), matching PHP v1.3.1 exactly: select missing/null → `Bienvenide Sarah`; plural missing/null → `{count} items`; genuine `0` → `0 items`. The null path needed a separate pre-check and is confirmed fixed. Standing check: `langsys-php/tests/fixtures/interpolation-reference.json`. |

| C | ~~Same stale example + `params` doc comment~~ | **RESOLVED in 0.2.0** | Verified in the published tarball: `dist/index.d.ts:203` now reads `%n%` / `%name%`, and `:215` `Based on %n% <strong>reviews</strong>`, with six further lines explaining that the bare form survives in Vue only because Vue consumes `{{ }}` alone. The last open defect from the Vue audit. |
| J | ~~Svelte README claims `Date` values serialize to ISO 8601~~ | **RESOLVED in 3.6.3** | The claim is gone from the published README. Verified by absence in the tarball — which is the weaker form of evidence, so what is recorded is "the claim is no longer made", not "the behaviour was changed". |
| K | ~~Vue `README.md:105` cites "the current base SDK (`0.4.3`)"~~ | **RESOLVED in 0.2.1** | Found while verifying C. The surrounding guidance is correct; the version reference is two minors stale, so a reader checking `0.4.3` for `setBaseUrl` draws the wrong conclusion about which versions the note applies to. |
| D | ~~Svelte declaration header omits `Phrase`/`DontTranslate`~~ | **RESOLVED in 3.5.0** | Header now lists all three and states *why* `Phrase` exists (agreement/pluralization), plus the `%name%` vs `{name}` split. This was the highest-value fix: the declaration header is what IDE hover surfaces unprompted. |
| E | `langsys-js-react@0.4.3` `<Phrase>` example is correct (`%n%`) with rationale | React `dist/index.d.ts` | **Reference wording** — B and C are a verbatim port, not a rewrite. |

### SSR seeding internals — `langsys-js-typescript@0.6.5`

Read directly from the published `dist/index.mjs`. These govern every JS SSR track:

| Behavior | Line | Consequence for the skill |
|---|---|---|
| `if (initialTranslations2 && initialTranslationsLocale)` — no `else`, no warning | `:783` | Passing one alone is a **silent** no-op. The only log sits *inside* the success branch, so `debug: true` is the sole way to see it |
| `initialTranslations2[cat]["__category__"] = cat`, plus injected `__uncategorized__` | `:784-791` | `init()` **mutates the object you pass it** — which is the framework's server payload. Never pass something frozen or shared |
| `var LangsysApp = new LangsysAppClass()` | `:991` | Hard module singleton — the root cause of the SSR data race |
| `sTranslations`, `currentlyLoadedLocale` as module-level signals | `:255-256` | Catalog state is process-global, not request-scoped |
| `Translations` constructor subscribes to both globals | `:410-411` | **Constructing your own instance does not isolate it.** There is no request-scoped translator |
| `!force && locale === this.locale && Math.abs(lastLoaded[locale] - now) < 60` | `:598` | The seeded no-refetch guarantee is a **60-second window**, not permanent |

Reported to the base-SDK and Svelte agents as a feature request: a request-scoped translator factory — a pure closure over one request's catalog with no module-global writes — would make genuine SSR of body copy possible and make the SSR README's SEO claim true rather than aspirational.
### Locale resolution — measured by execution, not by reading

Reported by the `langsys-js-svelte` agent — **their own finding**, made while verifying the SSR report above, and distinct from the production measurement that prompted it — then re-verified here by **running** `langsys-js-typescript@0.6.5` rather than reading it:

```
canonicalizeLocale('en_us')                     ->  'en-US'
canonicalizeLocale('zh-tw')                     ->  'zh-TW'
canonicalizeLocale('es')                        ->  'es'      NOT widened

detectPreferredLocale('es',    ['es-CR','it-IT','fr-FR','en-US'])  ->  'es-CR'
detectPreferredLocale('fr-CA', [...])                              ->  'fr-FR'
detectPreferredLocale('de',    [...])                              ->  'de'      not offered
detectPreferredLocale('!!!',   [...])                              ->  '!!!'     not a locale
detectPreferredLocale(null,    [...])                              ->  'en-US'
```

Four consequences, three of which contradicted what the skill said:

1. **`canonicalizeLocale` does not widen.** A bare `es` stays `es` — a valid BCP 47 tag that **422s** on a project whose Spanish target is `es-CR`. Only `detectPreferredLocale(header, supported)` resolves language→region. The skill now says so in invariant 9.
2. **On no match the helper returns the visitor's own tag** (`:932`, `return canonicalizeLocale(userLocales[0])`), not `false` and not the base locale. The skill had this right; the SSR tracks were not applying it.
3. **The input is not validated** — `'!!!'` comes back as `'!!!'`. Nothing in the signature suggests this.
4. **`false` is close to unreachable.** `null`, `undefined` and `''` all produced a locale. So the widespread `detectPreferredLocale(h, s) || BASE` idiom guards a branch that essentially never fires, while the branch that does fire — a truthy, unsupported tag — passes straight through.

**The `supportedLocales` trap.** Building that argument from `LangsysApp.getLocalesFlat()` passes the ~573-entry **global CLDR** list, not the project's locales. Nearly any `Accept-Language` then "matches", so the helper confidently returns e.g. `de-de` and every catalog request 422s. This was a live defect in the Svelte SDK's own README, since fixed.

### Three diagnostics, three different gatings — and I got one wrong

I asserted the 422 was `debug`-gated. **It is not**, and the base-SDK agent caught it. `Logger.log()` checks `debugEnabled`; `Logger.warn()` and `Logger.error()` do not (`dist/index.mjs`, `var Logger = class`). Executed against the published dist with a stubbed 422 and `debug: false`:

```
>> warn: [Langsys Warning] LangsysAppAPI failed to query
   {"status":false,"message":"The locale provided is not a base or target locale
    for this project","http":{"status":422,…}}
console.warn calls with debug:false = 1  => NOT debug-gated
```

The corrected picture — each of the three is gated differently, which is exactly why guessing failed:

| Failure | Diagnostic |
|---|---|
| Locale not a project target (422) | **Warns by default.** Server's exact sentence, locale sent, project id. Label is generic (`LangsysAppAPI failed to query`) and does not enumerate valid targets |
| Malformed BCP 47 (`'!!!'`) | **Detected but `debug`-gated.** The value still passes through as a "locale" |
| Seeding XOR — one parameter without the other | **No diagnostic at all.** Not gated: absent. Under `debug` it shows only as a *missing* line — `Populated sTranslations…` never prints |

Corrected again on a second pass: **there are two ungated channels, not one.** `Logger.error()` is no more gated than `warn()`, and both fire with `debug: false`. My probe counted only `console.warn`, so I under-reported the very diagnostic I had just wrongly called absent.

**Do not record a line count.** Mine came out higher than the Svelte agent's because I stubbed a transport that failed every call while they ran against the live API — the number tracks how many fetches the path makes, not how loud the SDK is. Two measurements disagreeing without either being wrong is the signal that the count was never the fact. The durable instruction is to **search the console for `Langsys`**, which is label-agnostic and count-agnostic.

Three lessons, and the third came from the Svelte agent:

- **Neighbouring facts made the false one plausible.** Two genuinely gated diagnostics sat on either side of it, so a third read as consistent with everything around it and I asserted it without executing it. Same shape as the interpolation defect I shipped: the wrong claim was *coherent*.
- **My first probe returned the answer I expected, for the wrong reason.** It printed `warn calls = 0 -> silent`, which would have confirmed my claim — but it had failed config validation before ever reaching the HTTP path. A test that exits early produces the same output as the phenomenon under test. **Before believing a negative result, prove the code path ran**: the corrected probe asserts on the returned error (`HTTP 422`), not merely on the absence of output.
- **Inherited premises are the least-verified thing in any report — including a well-verified one.** The Svelte agent's diagnosis of their own repeat of this error, and it is the most useful sentence in the whole exchange. Every other claim they sent me they had executed or curl'd: the route split, the 573 CLDR entries, `detectPreferredLocale`'s mappings. This one they passed through untested and then *strengthened* — from my "logged only under `debug`" to "turns an invisible failure into a loud one" — an escalation with no verification behind it. What separated the checked claims from the unchecked one was not difficulty; a stubbed 422 was the cheapest test in the set. It was that **the unchecked claim arrived as a premise inside someone else's argument rather than as a question**, so it never presented itself as something needing a test. When acting on a peer report, the claims to re-run first are the ones you are building *on top of*, not the ones being argued *for*.


**Data that exists on the wire and is discarded.** `GET /api/authorize-project/{id}` returns `base_locale`, `target_locales` and a `default_locales` map (`{es: "es-CR", …}`), but `init()` reads only `key_type` from that response (`dist/index.mjs:774-782`) and ignores the rest. Everything needed to resolve `es` → `es-CR` automatically is already fetched. Raised with the base-SDK agent.

> **Two routes, and they resolve locales differently.** The Svelte agent found that the legacy `GET /api/projects/{id}/translations?locale=…` resolves loosely (a bare `es` returns the `es-CR` catalog, 200) while the current `GET /api/translations?project_id=…&locale=…` — the one the SDK itself calls, `dist:122` — matches literally and 422s. A guide that hand-fetches via the legacy route therefore produces a **populated server seed and an empty client catalog**: every string renders as its base phrase. Checked: all three of this skill's JS tracks already emit the current route, so the seam bug does not apply here. Recording it because the failure only appears where the two fetches must agree, which no single-request test exercises.

### Three phantom helpers, and the guard that now catches them

Across three consecutive commits the SSR tracks called locale helpers that **do not exist**: `resolveLocale` (Next.js), `negotiate` (SvelteKit), and `resolveLocale` again — the last two introduced by *me*, in the commits that fixed the previous one. Nothing caught them: markdown does not typecheck, and every name read as plausible. An agent following those tracks writes code that cannot run.

`src/lint/phantom-helpers.mjs` now flags domain-shaped identifiers that are neither defined in the sample nor exported by the SDK, with the allowlist read from the pinned `dist/index.d.ts`. Two defects in the guard itself surfaced on first run and are worth recording, because both are the same family:

- It scanned **inside comments**, so prose warning *against* a helper counted as calling it.
- Its allowlist came from the `export { … }` line only, which omits class **methods** — so it reported `detectPreferredLocale` and `getLocalesFlat`, the SDK's own API, as invented.

Its blind spot is stated in the source and asserted in `test/run.mjs`: the domain filter that keeps it quiet is also what makes it miss `negotiate`, a plausible name containing no domain word. Widening it reproduces the unusably noisy version. **A documented gap beats a guard nobody runs — but only if the gap is asserted, so it cannot quietly become a claimed pass.**


**A third defect in the guard, caught by the Svelte agent before it could bite here.** They built the same kind of checker on my warning, and their first run reported **five real re-exported types as invented** — their regex matched `export { … }` but not `export type { … }`, and `langsys-js-svelte` emits all twenty of its type re-exports through the latter. Mine had that bug *and* a worse one: it read only the **last** export statement. The base SDK happens to emit one combined statement, so the parser looked correct; pointed at the Svelte package — seven statements — it recognised 6 names instead of 46 and would have condemned most of the real API.

That is the failure mode that kills a new checker: not missing a fake, but producing a long list of confident findings against working code, which gets it deleted on day one rather than debugged. The Svelte agent added the asymmetry that matters: **their bug failed loudly on first run — five findings against real types, unmissable. Mine passed.** It was correct on the only package it was ever pointed at, because the base SDK happens to emit a single combined statement. A checker that is right on its first input and wrong on its second is indistinguishable from a working one until the second input exists. **A fixture set of one proves nothing about a parser.** Their discipline is the transferable part and now applies here — **run a new checker against unmodified inputs first, then inject a known-fake and confirm it fires.** Clean-run-only looks like a working checker in either direction. `test/run.mjs` now asserts both directions and both `.d.ts` shapes.
### The replacement fix was itself defective — caught before publish

My first correction prescribed a four-line pure lookup, `catalog[cat]?.[phrase] || phrase`, into four SSR tracks. The base-SDK agent rejected it against `buildTFn`, and the published dist confirms all three faults:

| Fault | Published evidence | How it would have surfaced |
|---|---|---|
| Drops interpolation | `dist/index.mjs:473` — `return params ? interpolate(translated, params, …) : translated` | `t('Hello {name}', {name})` renders the literal `Hello {name}` server-side and correctly client-side — a **hydration mismatch on exactly the strings carrying data**. ICU forms render as raw source |
| `\|\| phrase` does not guard objects | `:466` — the SDK checks `typeof value === 'string' && value.length > 0` | A content-block entry is an object; the fallback returns it instead of the phrase |
| Not `TFunction`-shaped | `:459-460` — `(phrase, ...rest)` with four overloads | Cannot substitute for `t()`/`$t` without rewriting every call site |

`interpolate(template, params, locale?)` is a **public, pure export** — `dist/index.d.ts:852`, runtime export list at `dist/index.mjs:1729` — so the corrected helper routes through the SDK's own implementation rather than reimplementing it. The prescribed version now mirrors `buildTFn` exactly, minus harvesting, and passes the **request's** locale rather than reading the `currentlyLoadedLocale` global.

Two things worth keeping from this:

- **The same failure signature, one level up.** Instance 10 was a claim that rendered as plausible text; so was its fix. A dropped interpolation does not throw — it produces a sentence with a brace in it, on the subset of strings that carry data, only under SSR. It would have shipped into four tracks and been found by users.
- **The omission that must be documented, not inferred.** A pure translator cannot harvest missing tokens without a process-global flush queue, which is the coupling it exists to remove. So **server-only phrases never self-register even though they render every request**. That is a deliberate trade, and the skill now states it in `verify.md` §3d rather than leaving it to be discovered.

### A log you have to earn is not a status indicator

Caught by the `langsys-js-server` builder, reading my published track against their published
tarball — the reverse of the direction I had run.

I wrote that the package "says so explicitly at startup" when the API key is read-only. Measured
against `0.1.0`:

```
at construction        no warning at all
first run()            the missing-cache warning fires here
render, NO misses      the read-only warning NEVER fires
render WITH a miss     fires, after the response flushes
```

The read-only refusal is emitted from the **post-response drain**, so a fully-translated page never
produces it. My wording invited an inference — *see the warning → read-only; no warning → something
else* — and **silence is produced by three different states**: a read-only key with nothing missing,
a write key with nothing missing, and a read-only key on a page that happened to resolve everything.

That is this file's own rule arriving in the shape of a **log** rather than a test: *a check that
produces no signal reads as a pass*. A diagnostic that only fires on a specific code path cannot be
read as a status indicator for the condition it describes, and prose saying "the package tells you"
quietly promotes it to one.

**The generalisation worth carrying:** before documenting a warning as a way to verify something,
ask *what else produces silence*. If the answer is more than "the good case", the warning is
evidence when present and evidence of nothing when absent — and the doc has to say so, because a
reader will otherwise use it as a two-way test.

Neither of us had documented the timing, so the inference was reasonable and the fix belonged on
both sides. Their README now states when each warning fires and that absence is not evidence; they
also found a stale "once per process" in the same paragraph that should have read **once per
instance**, since two tenants must not swallow each other's warnings — proven with two instances and
four renders rather than asserted.

### A green typecheck over vendored code is not evidence of anything

Contributed by the `langsys-js-server` builder, in their framing, and it is a genuinely new
disguise for this file's failure class.

Their vendor script renamed a function's declaration but not its two call sites — a guaranteed
`ReferenceError` on first call. **`tsc --noEmit` reported clean**, because vendored code carries
`@ts-nocheck`: it is someone else's JavaScript copied verbatim, and annotating it would mean
editing it, which defeats the point of vendoring. Only executing the module found it.

What makes it a rule rather than an anecdote is the disguise. The earlier rules here are about
**tests** that exit early. This is a **typechecker** reporting success over a region it was
explicitly instructed not to look at — and **nobody thinks of a typechecker as something that can
be hollowed out**, so its green reads as *stronger* evidence than a green test suite rather than
weaker.

The fix they shipped is the shape to copy: the vendor script now **executes** the emitted module
against the published package and compares 22 outputs before it will write the file. The check
moved from "does this parse" to "does this compute the same answers as the thing it copies."

Generalise it as: **any tool told to skip a region will report success about that region.**
`@ts-nocheck`, `eslint-disable`, `# type: ignore`, a coverage exclusion, a test filter. The
suppression is usually justified; the green it produces is not evidence, and the more authoritative
the tool, the more the absence of a finding will be read as a finding of absence.

### Instrument the step your claim is about — one level deeper is not automatically deep enough

The sharpest refinement of this file's method, contributed by the Svelte SDK owner, correcting a
generalisation I had written a day earlier.

I had recorded: **measure the mechanism, not the symptom.** That came from their near-miss on the
`<Translate>` freeze — their first run showed `{#await}` "updating fine" client-side, and only
instrumenting the `innerText` setter revealed that the write had simply never happened. Outcome-only
measurement cannot distinguish *the bug did not fire* from *the bug fired and was harmless*, and
those have opposite implications.

Then a second claim needed checking — that under a client-only mount the block registers **nothing
at all**, rather than registering the placeholder. **Instrumenting the write could not answer it.**
Both hypotheses predict zero writes. Only spying on the SDK's phrase **lookup** separates them:

```
client-only, {#await}   phrases looked up: []            innerText writes: []
hydrated,    {#await}   phrases looked up: ["loading"]   innerText writes: ["loading"]
```

Their formulation, which supersedes mine:

> The symptom told me the truth about my environment and nothing about the bug. Instrumenting the
> write told me the bug's behaviour, but even that would have missed this one — the write and the
> lookup are **different observation points**, and only the lookup distinguishes *never registered*
> from *registered the placeholder*. So: **instrument the specific step whose presence or absence
> your claim is about.** One level of instrumentation deeper than the symptom is not automatically
> deep enough.

Mine implies a fixed depth — go one layer below the symptom and stop. Theirs makes the depth a
function of the claim: **the observation point must match the proposition, and a different
proposition needs a different probe even about the same bug.**

**The consequence was not academic.** Their published `3.6.7` table marked the client-only
`{#await}` cell "updates" — which every reader takes as the safe case. It is the **silent total
failure**: nothing registers, the content never reaches the catalog, and there is no frozen block to
notice. The frozen cell is the one that at least tells you something is wrong. Corrected in `3.6.8`;
my own copy of that table carried the identical defect and is corrected too.

**And the rule that caught it was the one from the previous thread.** They nearly skipped verifying
my claim, because it was a mechanism read from the same published artifact they had already read and
it sounded right. They ran it because of *re-run the claims you build on, not the ones being argued
for* — and this was a premise about to be encoded in a table in a published README, which is exactly
the load-bearing position that rule names. **The same rule, one thread later, on a different
project, catching a different error.**

### The measurement you specify can be the one that cannot see the defect

I asked the SvelteKit reference deployment to settle whether server and client tokenize a
`<Translate>` identically. The measurement I specified was: **count text nodes** in the served
bytes and in the hydrated DOM, and compare.

They ran it, and then ran token arrays as well. One case separates the two:

```
{#if show}before<em>yes</em>after{/if}   with show true on the server, false on the client

  text nodes   2  ->  2      IDENTICAL — my check reports "no change"
  tokens       3  ->  2      the id changes
```

The lost token lived **inside the `<em>` the branch removed**, so it never touched the host's
direct child text nodes. My check was blind to the single case in the set that most needed
catching.

**Node counting is the intuitive proxy, and it is wrong in the direction that matters** — it
under-reports. Anything the walk descends into (an element branch, nested markup, an attribute)
can add or remove tokens while the node count sits still.

The general form, and the reason this belongs here rather than in the spec:

> **A question can only test what its author already suspects.** I specified a check against the
> mechanism I had in mind — text-node splitting — and it could not observe a mechanism I had not
> thought of. The measurement did not fail; it succeeded at answering a question that was too
> narrow.

Two practices follow, both cheap:

- **Ask for the artifact the system actually keys on, not a proxy you can reason about.** Here that
  is `tokens[]` and `custom_id` — what identity is computed from — rather than node counts, which
  merely correlate with it.
- **Say what you suspect and ask them to check around it.** Both of this deployment's major
  findings were *adjacent* to the question asked, not answers to it: the 5,031-character
  measurement came from a question about seeding, and this one from a question about node arity.
  Someone with the running system finds things the question did not contain, and a question phrased
  as a single assertion to confirm suppresses exactly that.

Related and worth stating in the same breath: they also reported that **no hydration warning fired
on any divergent case** — Svelte hydrated a three-item server list against two-item client state
in silence. The framework is not a backstop here either.

### Two correct statements can compose into a wrong generalisation

The subtlest variant of this file's failure class, and the only one with **nothing falsifiable in
it**. Contributed by the base-SDK owner, diagnosing their own doc comment.

Context: the SDK has two identity mechanisms with deliberately opposite text handling —
`_walkForTokens` (the `<Translate>` path) must **never** coalesce adjacent text nodes, because
token arity is identity; `encodeRichText` (the `<Phrase>` path) **must** coalesce them, because a
sentence has to survive whole or plural agreement is impossible in languages with more than two
forms.

The contract comment on the first said:

> *"do not scope this contract to a framework"* — and — *"the invariant is about the token array,
> not about any renderer."*

**Both statements are true.** Together they push a reader toward *"never coalesce adjacent text
nodes, anywhere"* — which is the misapplication, delivered as the lesson.

Why this is worse than the other instances in this file:

- A **wrong claim** can be checked and refuted.
- A **silent absence** can be caught by asking what produced no signal.
- A **wrong citation** can be read back.
- **This** has no wrong sentence to find. A proofreader finds nothing; a reviewer agrees with every
  line; the defect lives entirely in what the statements jointly imply. And the reader who
  internalises it then meets the opposite mechanism, **recognises it as the exact defect they were
  warned about, and corrects it** — shipping the bug as a fix, confidently, with the documentation
  on their side.

The fix that worked is worth copying: **state the boundary in the rule, and put the counter-warning
where the well-intentioned edit would actually land** — not only where the rule is stated. The
scope section now names both mechanisms side by side, and the opposite site carries its own comment
saying the coalescing there is correct and *why*.

Two rules follow:

- **A rule that does not name its own boundary is an invitation to apply it past the boundary.**
  Generality is not free; every "this applies broadly" widens the set of places a reader will carry
  it to.
- **The mutation should be the mistake you are actually afraid of.** They mutation-checked the new
  tests by modelling the literal misapplication — trimming each text node independently, exactly
  what applying the other rule there would look like — rather than any edit that produces red. An
  arbitrary break proves a test *can* fail, not that it catches the thing it exists for.

### Every absence assertion needs a paired presence — in the same test

Contributed by the React SDK owner while seeding the cross-SDK conformance fixtures, and it
prompted an audit of this suite.

Their case: a fixture asserting that an *excluded* `alt` attribute produces no token passes
trivially if `alt` was never harvested in the first place. **The absence is equally consistent
with "exclusion works" and "the feature does not exist."** The control — the same `alt` alone
yielding a token — proves harvesting is possible, which is what makes the absence mean anything.
It also fails loudly if `alt` ever leaves the attribute list, which would otherwise hollow out the
exclusion case while leaving it green.

> **Half the interesting properties in this domain are exclusions** — `translate="no"`,
> `data-notrans`, phrase markers, excluded subtrees, "this lint rule must not fire" — **and every
> one of them is vulnerable to passing for the wrong reason.**

**Audit of this suite: every absence assertion was paired, but three pairings were implicit** —
the presence control lived in a neighbouring test rather than in the same one. That is a pairing
which survives exactly as long as nobody edits the neighbour, and nothing links them. The weakest
(`scan` reporting no content modules for a file of paths, class lists and identifiers) now carries
its control inline: the same `scan` must detect real prose in the same test, or the absence proves
nothing.

The two already-correct patterns are worth naming, because they are what the rule looks like when
it is being followed:

- Asserting `doesNotMatch(out, /…/)` on a tool's output **alongside** a `match` proving the tool
  ran and reached that check. Without it, a crash reads as a pass.
- Asserting no duplicate rule ids **alongside** `ids.length >= 22`. Without it, a broken id
  extractor yields an empty list and "no duplicates" is vacuously true.

This is §10's absence pattern arriving in test design rather than in a check — the same shape,
one level up. A test is a check, and a check that produces no signal reads as a pass.

### Agreement is not evidence when the category is wrong

Contributed by the React SDK owner, correcting a worse version of the same lesson that I had
written first.

Designing the server SDK's tokenizer, I saw two frameworks (Vue and Svelte) emit HTML comment
markers into their server output that differed between capture and inline rendering. They looked
like framework noise, so I wrote **"strip HTML comments before tokenizing"** into the
specification as a settled core requirement.

React's owner then measured the third case. React emits `<!-- -->` **precisely where it has
adjacent text children** and omits it where it does not — and the tokenizer does not coalesce
adjacent text nodes. So in React those comments are an exact isomorphism of the client's
text-node structure. Stripping them merges text runs and produces a different `custom_id`,
fragmenting the catalog **at interpolation boundaries — exactly where parameters live**.

My first write-up called this "two agreeing observations are not a general rule." Theirs is
better, and it is the one worth keeping:

> Vue's and Svelte's markers *are* framework noise; that read was correct. React's look identical
> and are the opposite. The tell was not that there were two observations instead of three.
> **"Comment" is a *syntactic* category, and the property that mattered — does this node carry
> structure — is *semantic*.** A third framework agreeing would not have helped. Reading one
> renderer's reason for emitting them would have.

The distinction matters because the two lessons prescribe different actions. Mine implies
**collect more samples**. Theirs says samples cannot help: **no number of instances repairs a
category error, only the reason does.** Three agreeing frameworks would have produced a more
confident wrong answer, not a right one.

The familiar half is intact — a stripped-comment tokenizer emits clean, plausible HTML and a
stable-looking id. The defect is invisible from inside the function and exists only relative to a
catalog you cannot see from there.

### A cited line number is not evidence until something reads it back

Contributed by the base-SDK agent, who found six of their own citations off by a few lines
when they re-ran them before committing — and caught four of mine that had already shipped in
`langsys-skill@0.1.2`.

Auditing all fifteen line citations in this file produced a clean division:

| Origin | Result |
|---|---|
| Derived by grepping the published artifact myself | **11 of 11 correct** |
| Inherited from a peer's message and recorded as-is | **4 of 4 wrong** |

Not one inherited citation survived. Two were `src/` line numbers recorded against `dist/` —
`:144` and `:136` point at `patch()` and `post()`, code with no relationship to the claim
beside them. Two more were off by one or two lines at each end, which is worse: a citation
landing two lines from the truth reads as correct to anyone spot-checking.

This is the absence pattern and the inherited-premise rule intersecting, and the intersection
is where it bites — **an inherited citation is an inherited premise wearing the costume of
evidence.** A line number looks like the most checkable thing in a document, which is exactly
why nobody checks it, and a wrong one makes an unverified claim look verified to every future
reader, including the one who wrote it.

Reading a citation back costs one `sed -n 'Np'`. Do it for every citation, including those
that arrived from someone who had clearly done the work.


---

## Defect in THIS SKILL's own guidance — found in production, 2026-08-30

**The most consequential error the skill has shipped.** Recorded here because this file's
job is claim → version → evidence, and a wrong claim of ours belongs in it as much as an
upstream one.

**What we claimed.** `core/rendering-mode.md`: *"In React, Vue and Svelte, the reactive
primitives — `t()`, `$t()`, `<Phrase>`, `<Translate>` — render the base language during
server rendering. Always."* Justified by *"there is no request-scoped translator in the
SDK"* and *"seeding those globals server-side is a cross-request data race."*

**What is actually true.**

| Claim | Verdict | Evidence |
|---|---|---|
| `<Phrase>` / `<Translate>` cannot server-render | **Correct**, wrong reason given | They mount DOM walkers in effects; effects do not run during SSR. Not a seeding problem |
| `t()` cannot server-render | **FALSE** | `sTranslations.set()` + `currentlyLoadedLocale.set()` during the render makes `t()` resolve for the whole tree |
| No request-scoped translator exists | **True but inert** | There is none; the render being synchronous closes the window anyway |
| Seeding globals is a data race | **False as absolute** | Shared state, yes — safe under four stateable conditions. 8 locales × 10 rounds concurrent on `adapter-node`: 80 responses, zero bleed |

**Verified against published artifacts, 2026-08-30** (not a working tree):

- `langsys-js-typescript@0.6.5` — `dist/index.d.ts:18-26`, `Signal<T>` exposes `set()`,
  `get()`, `update()`. Publicly settable.
- `langsys-js-typescript@0.6.5` — `dist/index.d.ts:242-249`, the JSDoc on
  `Translations.markLoaded` reads *"Record that a locale's catalog is already present
  without fetching — e.g. after an SSR handoff seeds `sTranslations` +
  `currentlyLoadedLocale`."* **The SDK documented the path the skill said did not exist.**
- `langsys-js-svelte@3.6.10`, `langsys-js-react@0.6.7`, `langsys-js-vue@0.2.1` — all three
  re-export `sTranslations` and `currentlyLoadedLocale` from the core. Not Svelte-only.

**Production impact.** Seven affiliate sites, SvelteKit. Every localized route served HTML
byte-identical to the base locale — `/benefits` vs `/it/benefits`, 4473 characters each;
`/technology` vs `/it/technology`, 3735 each — with correct `hreflang` promising they were
translations of one another. Google folded them into one cluster and kept one arbitrary
representative: an exact-match **English** phrase returned exactly one result network-wide,
and the URL was `/it/`. Undetected for months because every page is correct in a browser.

**Measured ceiling after the fix: 4–24% of prose per page** remains base-locale, all of it
inside `<Phrase>` / `<Translate>`. This is the honest limit of an SSR-first integration
until those get a server path (`0.2.0`). Separately, 21 of 60 `<Translate>` blocks on that
platform wrapped plain text with no markup — invisible to crawlers for no benefit.

**Why it survived.** `verify.md` told readers *"Verify in a real browser. `curl` cannot do
it."* That was true **only of the unseeded pattern this skill documented**, and it steered
people away from the one check that exposes the bug. A self-confirming instruction: the
guidance created the condition that made its own verification advice correct.

**Framework scope — measured 2026-08-30, published tarballs, production builds.**

Independently run by the React and Vue SDK owners in their own repos, 8 locales × 10 rounds
all in flight:

| Framework / config | Wrong-language responses |
|---|---|
| Svelte — body seed, synchronous tree (`3.6.10`) | 0 / 80 |
| React — `renderToString` (`0.6.7`) | 0 / 80 |
| React — `renderToPipeableStream`, synchronous tree | 0 / 80 |
| React — streaming, suspension **between** seed and read | **70 / 80** |
| React — streaming, seed **inside** the suspended subtree | 0 / 80 |
| React — **App Router / RSC**, concurrency **1** | **100% of non-base locales** |
| Vue — synchronous `setup()` (`0.2.1`) | 0 / 80, and 0 / 400 |
| Vue — `async setup()` between seed and read | **65–72 / 80** |
| Vue — `<Suspense>` around an **async** child | **68 / 80** |
| Nuxt 3 — `app.vue` setup, before any await | **0 / 80** |
| Nuxt 3 — page inside `<NuxtPage>` Suspense, **synchronous** page | **0 / 80** |
| Nuxt 3 — `app.vue` setup, after `await useAsyncData` | **67 / 80** |
| Nuxt 3 — page inside Suspense, after `useAsyncData` | **71 / 80** |

**The renderer is not the variable; the await point is.** React's last two rows isolate it:
streaming is clean when seed and read share a synchronous block, and the same renderer bleeds
70/80 when a suspension sits between them. Vue's owner reached it from the other direction —
`renderToString` runs synchronously until its first `await`, and a fully synchronous tree
completes inside that prefix.

**A Suspense boundary is not itself the hazard — this corrected a claim published here.**
The first Vue report derived that Nuxt must be unsafe everywhere, since Nuxt wraps pages in
`<Suspense>` and the Suspense configuration bled 68/80. The middle step was false: that
configuration wrapped an *async* child, so it measured the await, not the boundary. A real
Nuxt 3 build shows Suspense around a **synchronous** page is clean at 80 concurrent. The
owner re-ran and retracted their own derivation before it went further than one document.

**So there is one rule, identical in all three frameworks:** no await between the seed and
any `t()` read. Frameworks differ only in how likely a violation is, and whether a caller
can guarantee its absence.

- **SvelteKit** — permitted; satisfiable by inspection.
- **Nuxt** — a safe position exists (`app.vue` setup above any await, even with
  Suspense-wrapped routes below) but collapses the moment anyone writes `await
  useAsyncData`, which took that exact position from 0/80 to 67/80. **Unsafe in practice,
  not structurally forbidden** — and the distinction matters for the document's credibility:
  a reader who tests the narrow safe case, finds it working, and has been told it is
  impossible will stop trusting the rest.
- **Next Pages Router** — same shape: satisfiable, easily broken.
- **Next App Router** — a different failure; see below.

**This corrected a claim in this skill within 48 hours of writing it.** `rendering-mode.md`
condition 2 originally read "no `await` before the seed". The measured boundary is *no
suspension anywhere between the seed and any `t()` read* — a subtree property, not a
statement about the line you write. The Svelte 0/80 came from one production app that
happened not to contain that shape; a SvelteKit-specific `{#await}` re-measurement is in
flight.

**Two properties worth more than the counts:**

- **It converges, it does not scatter.** Suspended requests all resume after the others have
  seeded, so they read the same last writer: a near-uniform wrong language, 70 of 80 from a
  single source. An operator sampling a few responses sees one consistent wrong language and
  reads it as a **config error rather than a race**.
- **"A total outage looks fine" is true only from cold.** Once any locale has succeeded, the
  singleton is poisoned and a later total outage mislabels *every* locale instead of none. In
  a long-lived process, poisoned is the steady state. The reassuring version of this was
  written into two documents here and is now corrected.

**App Router is a distinct failure, not a severe case of the same one.** The Server
Component and the Client Component hold *separate module instances* of `langsys-js-react`.
The seed lands in the react-server graph and reads back correctly there; the client
component reads a different singleton, still in its initial state. At **concurrency 1**,
every non-base locale renders base-locale content — the exact production symptom this work
started from, except that in App Router it is the default outcome of following the rule
rather than an edge case reachable under load. "Unsafe under concurrency" is the wrong
phrase: it understates it and implies low traffic makes it fine.

**Consequence for the pure catalog helper.** It was demoted to "third choice of three" on
2026-08-30 on the assumption that seeding was strictly better wherever it worked. That is
false for React App Router and Nuxt, where it now ranks **first**: holding no module state,
it is immune to both failure modes by construction — nothing to leak across requests, and
nothing to land in the wrong module graph.

### App Router has a working path — measured 2026-08-30

Reported by the React SDK owner; not re-run here.

| Approach | Result |
|---|---|
| Pure catalog function in a Server Component | `curl` returns genuinely translated body copy, ICU plurals intact via the exported pure `interpolate`, module state untouched. 8 × 10 concurrent: **80/80 correct, 0 bleeds** |
| `init({ initialTranslations })` via RSC payload into a client boundary | Client graph seeds correctly. Fixes the double fetch and the eventual content — **not** the flash |
| Seeding the global stores from a Server Component | Non-functional; separate module graphs |

**This reverses the 2026-08-30 demotion of the pure catalog helper**, now on measurement
rather than inference. It ranks first wherever seeding is prohibited.

**Pages Router is safer by idiom, not by architecture** — a claim corrected mid-thread
after it was first reported as architectural. `getServerSideProps` runs *before* render, so
the default shape puts the await before the seed. But forcing an `await` into that same
app's render body bleeds 70/80, and **Nuxt has the identical safe shape available** — seed
in a Nitro `request` hook with a synchronous page, measured 0/80. Nuxt's safe path simply
is not the one its own docs teach. Same rule everywhere; the frameworks differ in their
*priors*, not their capabilities: safe-by-default on Pages Router, near-certain violation on
Nuxt.

### New defect: the persisted catalog has no locale tag

Found by the React owner while measuring App Router, root-caused and extended by the Svelte
owner. Reported to me; not re-run here.

`sTranslations` is `persist('translations', …)` and reads localStorage at **module load**,
before any `init()`. `currentlyLoadedLocale` is a plain signal and is **not** persisted. So
the stored catalog carries **no locale tag** — nothing downstream can tell it is stale or
which locale it belongs to. That asymmetry is the defect; everything below is a symptom.

**Client-only symptom.** With a prior `fr-FR` visit, loading `/de-DE` renders "Bonjour" for
180–240ms before flipping to "Hallo" (React, sampled every 60ms). Cleared storage gives the
expected base-language flash instead, ~300ms. On a locale switcher — the most likely
navigation there is — the user watches the language they just left.

**SSR symptom, and it is worse: it destroys correct server output.** Measured on SvelteKit —
server HTML correctly reads `Hola` under `<html lang="es-ES">`, then localStorage wins at
module load and hydration repaints `Ciao`. A crawler that executes JavaScript sees the stale
language. Server-rendering the right language and then replacing it is worse than never
server-rendering it, for precisely the audience seeding was for.

**The component-body seed closes it — one placement, two hazards.** The seed runs during the
hydration render pass, before any child reads, overwriting the stale catalog before anything
renders from it. Without it, hydration paints `Ciao`; with it, `Hola es-ES` and no flash.
This is a second, independent justification for the placement rule.

**`init({ initialTranslations })` in `onMount` / `useEffect` does not fix it** — those run
after hydration, when the stale paint has already happened.

Compounding: `init()`'s `initialTranslations` block runs after `await LangsysAppAPI.validate()`
(measured 405–490ms; environment-specific, but structurally it gates data already in hand on
a network round-trip). A failed validate does not early-return; the seed still lands.

**A fix already exists upstream, and it is broader than anything proposed here.** Verified
in the `langsys-js-typescript` repo on 2026-09-01: `origin/feature/838_write_key_gating_reland`
(26 commits ahead of `main`, mid-rebase) replaces `persist` with **`persistScoped`**, keying
the catalog by **project *and* locale**, with `scopeCatalogCache` called from `change()` to
solve the ordering problem — `persist` reads its key at module load, before project or locale
exist. Superseded keys are cleaned up.

That branch's own doc comment describes the measured defect in advance, and names a second
population nobody in this thread raised: **two projects sharing an origin overwrote and then
served each other's content.** The Svelte owner's proposal — persist `{locale, catalog}` and
discard on mismatch — was correct and is a strict subset of it.

**This is unreleased.** Published `0.6.5` still has the bare `translations` key, so every
measurement above stands for what users install today. Re-verify when 838 lands; the pins
are not moved on the existence of a branch.

**Open, untested.** The client has no cross-request concurrency hazard — one browser, one
user — so the *server-side* prohibition on seeding does not automatically forbid a
client-side body seed in React or Vue. Whether that closes the flash there has not been
measured. Do not assume it does.

### Also corrected here

The Svelte package's `README-SSR.md` states that server-rendered translated body copy is not
achievable on SvelteKit. That is true of the `onMount` + `initialTranslations` pattern it
documents, and was measured and published by that owner earlier this month — but it is false
of the component-body seed, which server-rendered `Ciao` inside `<html lang="it-IT">` clean
at 400 concurrent. That owner is correcting the guide rather than leaving two Langsys
documents disagreeing about whether SvelteKit can SSR translations.

### Corrected by measurement: "a total outage looks fine"

Both the React and Vue owners independently disproved this after it was written here. It
holds only from a **cold** process. Warm — one prior success, then everything 500s — every
locale renders in the previously-succeeded language:

```
/it-IT -> "Ciao"  /es-ES -> "Ciao"  /fr-FR -> "Ciao"  /ja-JP -> "Ciao"   globalLocale=it-IT
```

Strictly worse than the partial outage originally framed as the dangerous case, because it
is *all* requests rather than some. A long-lived server is warm essentially always, so the
cold result is the unrepresentative one.

### Svelte re-measured: the recommendation holds, the reason was wrong

Reported by the Svelte SDK owner; not re-run here. Published `langsys-js-svelte@3.6.10`,
production `adapter-node`, 8 × 10 in flight, with a positive control (70/80 when
deliberately broken) proving the harness detects bleeds on this stack.

| Configuration | Wrong-language responses |
|---|---|
| Seed in `+layout.svelte` body, synchronous page | 0 / 80; 0 / 400 stressed; 0 / 70 base-locale excluded |
| `{#await}` between seed and read | 0 bleeds — renders nothing server-side |
| Svelte 5 `experimental.async`, real `await` in a child | 0 bleeds — same |
| **Seed in `hooks.server.js`, `await resolve()`** | **70 / 80** |

**The caveat published here was too pessimistic.** This file said the Svelte result might be
a property of the reference codebase rather than the framework. It is the framework:
`render()` from `svelte/server` returns a string, not a Promise, and cannot yield, so **no
component-tree construction can place a suspension between seed and read**. The condition is
structurally guaranteed and survives refactors.

**A real trap was found that nobody had asked about.** Seeding in a `handle` hook — the
idiomatic home for per-request setup — then awaiting `resolve()` bleeds 70/80. The rule for
Svelte is therefore *seed in the component body*, and the reason is that this is the only
position with no await between it and the tree it feeds.

**`{#await}` is safe and invisible.** Zero contamination because the read never happens
server-side; the response body is the pending branch. Any copy that must reach a crawler
cannot sit behind one.

**Two reproducer hazards recorded by that owner**, both instances of measuring the wrong
thing: a layout-body seed left in place masks a hook seed entirely (first run reported 0/80
and nearly certified hooks as safe); and the fixture word `Hallo-NL` contains `de-DE`'s
`Hallo`, so a substring scan reports 10 phantom cross-locale hits per run.

### Cross-check against the published Svelte guide — 2026-09-01

Verified **here**, against the published `langsys-js-svelte@3.6.14` tarball (not the repo,
and not `3.6.10` which this file previously cited).

**The two documents agree.** That package's README now carries the same seeding pattern the
skill's `ssr/sveltekit.md` does, on every load-bearing point: layout component body, `$t()`
resolving during SSR, safety grounded in the server renderer being unable to yield, 400
requests × 8 locales, the stale-locale flash also being closed by it, and `hooks.server.js`
bleeding 70/80. No contradiction to reconcile.

**Two defects found in that published artifact**, both live at `3.6.14`:

1. **The README contradicts itself about ten lines apart.** Its "Reactive stores" table types
   `sTranslations` as `Readable<iCategories>` and annotates it *"Rarely needed in app code"*,
   directly above the SSR section that describes seeding that store as the entire mechanism.
   `sTranslations` is `Signal<iCategories>` with a public `set()` — verified against the
   `langsys-js-typescript@0.6.5` tarball. **This skill shipped the identical defect** in
   `integrate/svelte.md` until 2026-08-30; it is the one line that hid the seeding path.
2. **`README-SSR.md` is not in the tarball.** Only `README.md` ships, yet it defers *"limits
   and the failed-fetch case"* — hazard 2, the reset-on-miss rule — to that file. So an
   installed user can implement the pattern correctly and never encounter its safety
   condition. The pattern ships; the condition does not.

**Pin note.** This file's Svelte citations reference `3.6.10`, the version the concurrency
work measured. `3.6.14` is latest, and `drift-guard` reports **0 regressions** against it —
but that guard only checks the `DEFECTS` array, not the SSR claims, so the zero is narrower
than it looks. Per this repo's rule the pins are **not** bumped on version number alone; the
export and `Signal` claims above were re-verified against `0.6.5` core and hold.

### The inverse of the Svelte tarball gap — Vue, verified 2026-09-01

Checked by the Vue owner against `npm pack --dry-run --json` rather than against the `files`
array, on the grounds that `files` can list something a glob or `.npmignore` still drops.
**Worth adopting as the method:** a `files` entry is an intention, the pack output is the
artifact.

Result: `README.md`, `README-SSR.md` and `CHANGELOG.md` all ship. So Vue has no tarball gap —
and that is **worse than Svelte's, not better**. Svelte withholds a document containing a
safety condition. Vue reliably delivers one that walks the reader into base-language SSR,
because its SSR walkthrough calls `init()` inside `onMounted`. The file ships; its guidance
is the defect.

**Deliberately left unfixed, and the reasoning is right.** The obvious local patch — move the
seed into `app.vue` setup — is exactly the fragile position the measurements condemned
(0/80 → 67/80 the moment anyone adds `await useAsyncData`). Patching it would make that
document agree with this skill while teaching the thing that breaks on the next fetch someone
writes. Blocked pending a decision, and visibly wrong beats quietly wrong and plausible.

### `translationsLoadingPromise` was documented here as a success signal — it is not

Flagged by the React owner from the `localstorage-locale-flash` thread; **verified here**
against published `langsys-js-typescript@0.6.5`, `dist/index.js` and `dist/index.d.ts`.
Wrong in three ways, not the one reported:

1. **Before `init()`** — the constructor assigns `this.translationsLoadingPromise =
   Promise.resolve()`. Awaiting it at startup returns immediately, nothing loaded.
2. **On failed key validation** — the real assignment sits inside `sUserLocale.subscribe(...)`
   behind `if (!validateResponse.status) return;`, so the property keeps the constructor's
   already-resolved promise permanently.
3. **On failed catalog fetch** — it is assigned `this.Translations.change(locale, false)`,
   which returns normally rather than throwing.

Declared type is `Promise<unknown>` with **no JSDoc**. The artifact never claimed a success
semantic; this skill inferred one and stated it in six places as *"resolves when the current
locale's translations are ready"*. Corrected 2026-09-01.

**The related trap, also recorded:** a locale mismatch is not a failure test. The locale write
is deferred behind the promise, so `currentlyLoadedLocale !== requested` just after settle is
the normal success path mid-flight. **No signal in the SDK separates a failed fetch from one
that just succeeded** — an error state requires a caller-supplied timeout. The Svelte binding
had shipped the `readyResolve` mechanism in a changelog and is correcting it; this skill never
described that mechanism, so only the success-semantic claim needed fixing.

### A third variant of the scope problem: the facts moved, the document didn't

The React owner's `README-SSR.md` promised three things — *"the first paint already reflects
the seeded translations"*, *"No flash of untranslated content"*, *"Better SEO with
server-rendered translations"* — all measured false on the App Router **during this very
thread**, while that guide sat unchanged. Fixed in `0d96a33`, with the dropped claims called
out explicitly rather than deleted, on the reasoning that *a silently shorter list reads as
tidying rather than as a retraction*.

Their framing is the part worth keeping: **the guide was correct when written and was
invalidated by its own author's later measurements, and no review catches that, because a
document does not change when the facts do.** Distinct from items 1–7 (claims wrong about
their scope) and from item 8 (a correct claim that was no longer needed). Here the claim was
correct, needed, and quietly expired.

**Unreleased, and this is the sharpest release argument in the set.** npm `0.6.7` still serves
the old guide, so an installed React user is today reading that they get server-rendered
translations and no flash on the App Router, and may build an SEO strategy on it. That is a
step beyond documentation drift.

### Both Svelte README defects fixed — `3.6.15`, verified here 2026-09-01

Reported by this skill on 2026-09-01, fixed and published the same day. **Verified against
the downloaded `langsys-js-svelte@3.6.15` tarball**, not on report:

- Stores table now types all three as `Signal<T>`; *"Rarely needed in app code"* is gone;
  `t` gained an explicit **"Never write to it"** — the type had been quietly wrong in the
  *safe* direction, so the prohibition was implied rather than stated.
- `README-SSR.md` **is now in the tarball**, and the two safety conditions are *also* inlined
  into `README.md`. That owner did both rather than choosing, on the reasoning that shipping
  the guide alone fixes a broken link but leaves the safety condition one click from a reader
  who already believes they have the pattern — *"the same shape as the defect itself: the
  pattern was reachable and its condition wasn't."*

**A technical condition we did not have, now adopted into `ssr/sveltekit.md`:** a failed
fetch must yield `{}` from `load`, never `null`/`undefined`, because `$t()`'s optional chain
sits on the **second** hop (`cats[cat]?.[phrase]`) — a nullish catalog throws on the first
lookup rather than falling back to base language. Our reset branch already produced an object,
so the guidance was safe; it is now safe *for a stated reason*.

**Their diagnosis of why it survived is worth keeping:** `c756e56` corrected this claim in the
`index.ts` JSDoc and in `CLAUDE.md` and never touched the README table, because *"a grep for
`Readable` would have caught it; I greped for the sentence I remembered writing."* And on the
annotation itself — it was **load-bearing in the negative direction**: it did not merely fail
to describe the mechanism, it actively told a careful reader not to look. Two documents
converging on the right pattern does not help when a type signature upstream of both says the
mechanism is not there.

**Superseded by `3.6.16` within the hour.** A correctness review of the `3.6.15` commit found
six defects. Three matter here:

1. **The inlined safety conditions shipped two of three.** The dropped one was
   `experimental.async` — per that owner, *"the one that voids the guarantee entirely"* — and
   the same edit removed the pointer to the guide that would have led a reader to it. So
   `README.md` asserted flatly that the renderer "cannot yield" while `README-SSR.md`, now
   shipping **beside it in the same tarball**, said a one-line config flag makes it await
   mid-tree. **Two installed documents contradicting each other, created by the release that
   put them together.**
2. **`README-SSR.md` shipped pointing at `CLAUDE.md` and `CHANGELOG.md`, neither of which
   ships.** In that owner's words: *"I fixed a doc that linked to a document installed users
   don't have by shipping a document that links to two more."* This skill cites neither path,
   so nothing here breaks — but it is the reported defect recurring one layer down, inside
   its own fix.
3. **`Signal<T>` was not re-exported at `3.6.15`.** `import type { Signal } from
   'langsys-js-svelte'` fails TS2305 against that tarball; the old `Readable<T>` was at least
   importable from `svelte/store`. For that one line `3.6.15` was a **net regression for
   anyone using the type rather than reading it** — the prose got more correct while the code
   got less usable, which a doc review does not look for. Re-exported in `3.6.16`; gate any
   typed store annotation at `>=3.6.16`. This skill shows the types in a table and never
   imports them, so nothing here breaks.

**Pin:** `3.6.16` supersedes `3.6.10` for the store-type claims. Per this repo's rule the
pins are moved only against re-verified evidence — the store table above was re-read from the
`3.6.15` tarball; the concurrency measurements remain as run against `3.6.10`.

### Cross-project bleed — measured on published `0.6.5`, not inferred

The React owner declined to measure the `838` branch because it was force-pushed mid-rebase
during the exchange — *"a number I take off a branch mid-rebase can be stale before I finish
writing it up, and worse, it would look like a measurement rather than a snapshot of a moving
target."* Correct call, and it matches this file's premise: packages document published
behaviour, because that is what `npm install` gives people.

Instead they measured the half nobody had. Two projects, one origin, published `0.6.5`, real
Chromium:

```
project A seeds      shown "Ciao@projA";  localStorage keys: ["translations"]   <- one bare key
project B, unseeded  251ms / 751ms / 1251ms / 2001ms all "Ciao@projA"
                     final: client="Ciao@projA"  server="Ciao@projB"  phase="init-resolved"
```

**Project B serves project A's content** beside correct project-B copy from the server, with
`init` reporting itself resolved. So the `838` branch's doc comment is confirmed by an
independent measurement rather than by its own author's description of the bug being fixed.

**Two scoping caveats, both required when stating this:**

1. **Same origin only.** Different origins get separate `localStorage`; this needs two Langsys
   projects on one host — multi-tenant under a single domain, or projects sharing a dev
   server. Real, not universal.
2. **Permanence depends on the fetch failing.** With a reachable API it degrades to a flash;
   the probe used dummy credentials so B's catalog never arrived. Same qualification as the
   locale case — *"the catalog fetch failed" is the condition the original defect shipped
   under.*

Worth separating from the locale case in any writeup: stale-locale is **your own** content
from a minute ago; cross-project is **another tenant's**. One unlabelled key, materially
different consequence.

### Correctness versus currency

The React owner's synthesis, kept because it organises items 8 and 9 better than "scope" did.
Items 1–7 are claims **wrong about their scope**. Items 8 and 9 are claims that were *true when
made* and then expired:

- **Item 8 — the code moved.** A top-priority roadmap item was already implemented, more
  broadly, on an unmerged branch.
- **Item 9 — the facts moved.** A shipped guide was invalidated by its own author's later
  measurements, and no review catches that, because a document does not change when the facts do.

**These are failures of currency, not correctness**, and they need a different defence:
verifying a claim harder does not detect either. The checks are *"has someone already done
this?"* before scheduling work, and *"what did I measure since I wrote this?"* before trusting
a document you authored.

### Watch item: branch `663` would invalidate a claim here

`refactor/663_unify_cb_dedup_and_fix_id_hash` (and its Svelte counterpart
`refactor/663_drop_contentBlocks_reexport`) drops the `contentBlocks` re-export.
`integrate/vanilla-ts.md:181` lists `contentBlocks` among the exports. **Correct today** —
it is present in published `0.6.5` — and it becomes wrong the day that branch lands. Recorded
rather than pre-emptively changed: this file documents published artifacts, and editing ahead
of a merge would make the doc wrong now to be right later. `838` (write-key gating) is the
other branch that moves a surface documented here.

### Resolved: `experimental.async` — both statements were true, about different shapes

The conflict recorded here on 2026-09-01 is settled. **The `3.6.16` claim was reasoned from
reading the renderer and SvelteKit's `render.js`; the turn-20 result was measured.** The
measurement was *not* a false negative from a flag that never took effect — the flag was
verified on two ways (compiled output opens with `import 'svelte/internal/flags/async'`, and
the same source fails to compile without it, `code: 'experimental_async'`).

Measured, Svelte 5.55.8, four locales concurrent, module-global seed in a parent body:

| Shape | flag | Wrong-locale |
|---|---|---|
| No `await` in the tree | off | 0 / 4 |
| No `await` in the tree | on | 0 / 4 |
| `await` in a **parent's** script, read in a **child** | on | 0 / 4 |
| **`await` then read in the *same* script** | on | **3 / 4** |

**The flag alone is not the trigger — the read landing after the await in the same closure
is.** With an await in a parent the compiler hoists it into `$$renderer.run([...])` and keeps
walking children synchronously; row 4 compiles the read into a gated continuation instead.
The turn-20 harness was row 3: a true result about a shape that cannot bleed.

**What does not survive is the sentence built on it** — *"there is no component-tree
construction in Svelte that puts an await between seed and read"* is false, and that absolute
is why a too-weak conclusion survived four upstream releases. This skill had already scoped
both of its statements to "the default renderer" before the resolution arrived, so neither was
wrong; the guidance is now the measured table.

**Consequence for the recommendation:** row 4 is how almost anyone writes it — `const data =
await something;` then read. A layout seeding in its body plus a page that awaits before
reading *is* row 4. So with this flag on, SvelteKit leaves the "structurally guaranteed"
category and joins Nuxt's: a safe shape exists and the idiomatic one violates it.

**Pin:** `3.6.17` — the upstream caution is now a measurement table rather than a paragraph
of reasoning.

### Provenance: a reasoned claim must not be phrased like a measured one

A distinct failure from the coherence class below, and the one this file is most exposed to.

Upstream, a **reasoned** claim and a **measured** claim sat in the same document for four
releases, *indistinguishable in tone*. The reasoned one silently outranked the measurement
because it was newer and more confident. Nothing in the prose marked which was which.

**Rule: phrase a claim derived from reading source differently from one derived from running
something, and when they conflict the reasoned one is the hypothesis, not the tiebreaker.**

This is the same practice adopted from the `langsys-js-typescript` owner — attribution marked
asymmetrically, so a reader who reproduces and gets a different number knows which half to
distrust — arriving independently from a second direction. It is now load-bearing for this
file, which mixes both kinds of claim throughout.

The conflict above was caught only by noticing the two statements **could not both be true**.
That check — *does this document contradict itself across sources?* — is the one their author
had not run on their own document before publishing it, and it is cheap.

### The edit that fixes a defect is where the next one lands

Two instances in the Svelte package within days, both reported by its owner:

- `3.6.11` shipped a seeding sample referencing `data.catalog` where the step above returned
  `translations`.
- `3.6.15`'s inlined safety block closed with *"Both failures are invisible from a cold
  process"* directly beneath its own bullet stating that a nullish catalog throws *"a 500
  during SSR, and the same throw again at hydration."* The invisibility belongs to the
  **skipped-seed** failure only; generalising it to "both" would lead a reader to conclude
  the null case needs warm-load testing to find, and to deprioritise the `?? {}` guard the
  bullet exists to sell.

Their diagnosis: *"every one of these was in prose I had just written and verified against
source. I checked each claim and never checked the paragraph against itself. The author is
reading for the thing they came to fix."*

**Rule: a correction pass must be re-read for coherence, not only for the defect that
prompted it.** Per-claim verification is necessary and demonstrably not sufficient — it does
not catch two adjacent correct sentences that contradict each other, a fix whose own citations
are dead, or prose that gets more accurate while the code it describes gets less usable. This
applies to this file with particular force: it is almost entirely correction prose.

### Upstream outcome

`langsys-js-typescript` scoped both endorsement sites rather than removing them (commit
`1ecfc60`, comment-only, unpushed at time of writing): the `Translations.markLoaded` JSDoc,
and — found by that owner, not by us — **`iLangsysInitConfig.initialTranslations`**, which
read *"Useful for SSR scenarios to avoid duplicate fetches."* Same steer, in the type
surface integrators actually read rather than in a method comment.

**A practice worth stealing from that fix.** The upstream comment marks its attribution
*asymmetrically*: the concurrency numbers are recorded as reported and **not re-run there**,
while the module-global mechanism is marked **verified in that repo**. So a reader who
reproduces and gets a different number is told which half to distrust. This file should do
the same — the framework measurements below were run by the React and Vue owners in their
own repos, and the tarball/export claims above were verified here.

### Methodology note: three metrics that were right about their case and wrong about scope

This thread produced the same error three times, from three different authors, and it is
worth recording as a class rather than as three incidents.

1. The skill's `curl` advice — true only of the unseeded pattern the skill itself
   documented, and it steered readers off the one check that would have exposed it.
2. A first-run React leak table where every leak sourced from `en-US` — which was the base
   locale with an empty catalog. Re-run with the base locale excluded and all catalogs
   non-empty: same shape, different winner. The original was a fixture artifact.
3. The standard load driver reporting **70/80 bleeds** against App Router. The detector
   classifies "expected `Ciao`, got `Hello`" as a leak sourced from the base locale — but
   nothing propagated between requests at all. A total module-graph disconnect was being
   counted as cross-request contamination. The honest figure is 100% at concurrency 1,
   which is simpler *and* worse.

4. "A total outage looks fine" — true from a cold process, false from a warm one, which is
   every long-lived server.
5. "Pages Router architecturally separates fetching from rendering, and Nuxt cannot" — true
   of the idiom, false of the architecture; Nuxt has the same safe shape and measured 0/80
   in it.
6. **The App Router diagnostic trap.** A contamination-shaped harness — *does response A
   contain response B's content?* — correctly reports **zero** on App Router, because every
   response is uniformly wrong in the same way and there is nothing to contaminate. The
   check meant to catch the bug certifies it. The fix is to compare each response against
   its *expected* content rather than against the other responses.

7. **"Does this document contradict itself?"** — proposed by *this* agent as a check for the
   Vue package after the same defect was found in Svelte's. It came back clean, and the
   reason is the problem: that README's exports table and its SSR section do not disagree
   **because its SSR section never recommends seeding the stores at all.** Svelte's README
   contradicts itself by having one correct half. Vue's is internally consistent and wrong
   throughout. Consistency was the wrong property to test for.

In each case the instrument was correct for the situation it was built for and silent about
having left that situation. Items 4 and 5 came from the same author, who flagged both
unprompted; items 1–3 span three more, and item 7 was this agent's own suggested check.
This is not one person's habit.

**Item 8 is a different class, and it is the one this project is least equipped for.**
Every instance above is a claim that was *right about the thing its author examined and wrong
about its scope*. On 2026-09-01 the core owner found that their board's top-priority item —
build locale-scoping for the persisted catalog — was **already implemented** on a branch
nobody had looked at, by a remote developer, in a broader form than any of us had proposed.
Not a wrong claim. A correct one, made without checking whether it was still needed.

Their formulation, kept: **the mesh made all of us better at verifying claims and none of us
at verifying novelty.**

**Rule: before prioritising work, check whether it already exists.** Not only `main` — that
repo has *six* branches in flight (`838_write_key_gating` and its reland,
`649_icu_pluralization_and_gender`, `671_framework_wrapper_friendly_api`,
`663_unify_cb_dedup_and_fix_id_hash`, `fix/md5-utf8-encoding`). Everything this thread
measured was against published `0.6.5`, which predates all of them. That does not invalidate
the measurements — published is what users install, and verifying against it is this file's
whole premise — but a *roadmap* item derived from a published-artifact defect must be checked
against unmerged work before it is scheduled, or the roadmap prioritises finished work.

**Items 6 and 7 are the same shape, and it is worth naming.** A *differential* check — one
that looks for disagreement between two things — cannot see a failure that affects both
things equally. A contamination harness asks whether response A differs from response B, and
reports zero when every response is uniformly wrong. A self-consistency review asks whether
section A contradicts section B, and reports clean when both sections are uniformly wrong.
**Where a defect is systemic, only a check against an external ground truth can see it** —
compare against what the answer *should* be, not against another instance of the same
possibly-wrong thing. **A measurement inherits the assumptions of the case it was
written against, and does not announce when it has outrun them.** Prefer a metric that fails
loudly outside its scope over one that keeps producing plausible numbers.

**Tested and dismissed:** React StrictMode double-invocation — 80 body invocations for 80
requests, no server-side double-render in production. Recorded so it is not re-litigated.

**Also verified across all three tarballs:** the bare `t` export is `tSignal as t`, i.e. a
`Signal<TFunction>`, in `langsys-js-svelte@3.6.10`, `langsys-js-react@0.6.7` and
`langsys-js-vue@0.2.1` — not a callable. It works in Svelte only because `$t` auto-subscribes.
The skill's tracks use `useT()` / `$t` and never import a bare `t`, so no guidance is affected.

**Second-order lesson, worth more than the fix.** The follow-up defect was worse than the
original: an early return on the miss path reads as a harmless no-op but leaves the
singleton holding the *previous* request's catalog, so a failing locale renders in the
last visitor's language under its own `hreflang` — confidently mislabelled, which a search
engine punishes harder than untranslated. **When a store is process-global, not writing is
a decision, not an abstention.** The same shape as this file's recurring theme: the
no-signal path reads as the safe path.

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
| 9 | ~~`## 0.2.0 - unreleased` shipped in the published Vue tarball~~ (fixed in 0.2.1; `0.1.2` also documented). Not a bad value — a value with a **correctness window**: right when written, wrong the instant it shipped, with nothing watching the boundary | me, reading the tarball; **cause corrected by the Vue agent** — see below |
| 10 | **The SSR tracks promised crawler-visible translated body copy that the SDK cannot produce.** `t()`/`$t`/`<Phrase>`/`<Translate>` render the **base language** during SSR in all three JS frameworks, because `init()` runs in a client-only hook. The docs said the opposite, the claim was checkable only in a browser, and every `curl`-shaped check agreed with the false version | The **SvelteKit reference deployment** (`affsite-platform` — 8 production affiliate sites, ~20 locales, `adapter-node` behind a PHP proxy, PM2 `instances: 2`), **measuring its own production HTML**: 5,031 chars of visible SSR body text, 100% English, on a page serving Italian, with the full Italian catalog in the 133 KB hydration payload. Not a reasoned claim — a byte count from a running site |

Instance 10 is the largest single correction in this file's history, and the one with the most transferable shape. Four documents asserted that SSR puts current translations in crawlable HTML. That is true for **PHP only** — `translatePage()` post-processes finished HTML server-side. In React, Vue and Svelte the catalog lives in module globals that only `init()` writes, and `init()` runs in `useEffect` / `onMounted` / `onMount`, none of which execute during server rendering. The server therefore emits base-language body copy under **both** SSR and prerendering, and the client swaps it after hydration.

The reason it survived so long is the interesting part: **the wrong claim and the right one look identical to every cheap check.** `curl | grep` shows base-language text on a correctly working page *and* on a totally broken one, so the tooling that would normally catch this agrees with the error. Only a browser — or, as here, a measurement of production HTML byte counts — can tell them apart. Filed here rather than as a plain doc bug because the failure is the table's shape, not its wording: it had no row for "checkable only under hydration."

Two corollaries now in the skill:

- **`init()` must not run during SSR, and the usual reason given is wrong.** It is not `document is not defined`. Server-side init *works*, then races: `LangsysApp` is a module singleton, so one process serving concurrent requests lets an in-flight `/de` render observe `/it`'s catalog. A `typeof window` guard does not make it safe. There is no request-scoped translator in the SDK.
- **The catalog is already server-side**, because seeding requires fetching it. Resolving a phrase from it directly is a pure lookup with none of the singleton's hazards, and is the only way to put translated text in server HTML in a JS framework. The skill now prescribes that for head, SEO fields and indexed copy.

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

Re-checked 2026-08-26 against the published artifacts. The **Working tree** column is retired:
every row that read *"fixed, unreleased"* has since shipped, and a column describing someone
else's uncommitted state was unverifiable by construction — it recorded what an agent told me,
not what a user can install.

| # | Status in the published artifact | Note |
|---|---|---|
| A — PHP not on Packagist | **RESOLVED** — `langsys/langsys-php` is live on Packagist, `v1.0.0`–`v1.3.1` (queried 2026-08-26) | The blocker was a **vendor-namespace permission**: `langsys/` was owned by another Packagist account, and the package had been renamed `langsys/php-sdk` → `langsys/langsys-php` to match the repo. Both are settled; the PHP track leads with Composer and `doctor` flipped green with no code change. Unblocks task #29. |
| F — PHP ICU plural paths unverified | **RESOLVED** — verified on CI | Closed. CI ran with `intl 8.4.24` / ICU 74.2 across PHP 7.4–8.4: Russian plurals (incl. 21→`one`, 111→`many`), Arabic's six categories with Arabic-Indic digits, locale number formatting, ICU-vs-simple byte equality, malformed-ICU fallback — **all passing**, and `LANGSYS_REQUIRE_INTL` turns the skip into a hard failure on CI so they cannot pass by omission. Per-language plural correctness is now verified, not assumed. |
| B — Svelte `{n}` example | **RESOLVED in 3.5.0**, still correct in the published `3.6.10` — `README.md:303` reads `Based on %n% <strong>reviews</strong>` | Repo swept for other brace-in-markup examples; this was the only one |
| C — Vue `{n}` example | **RESOLVED in 0.2.0**, confirmed in published `0.2.1` — `dist/index.d.ts:215` reads `Based on %n% <strong>reviews</strong>` | Plus a third site at `README.md:253` and a commented-out `apiUrl` at `README.md:68` that I had not found |
| D — Svelte declaration header | **RESOLVED in 3.5.0**, confirmed in published `3.6.10` — the header bullets list `Translate`, `Phrase` and `DontTranslate` | Now lists all three components; also fixed the layering summary at `README.md:27`, same root cause, which I missed |
| E — React reference wording | correct — n/a | Source for B and C fixes |
| Vue `README.md:95` (`apiUrl`) | **RESOLVED in 0.2.0.** Published `0.2.1` now warns *against* `apiUrl` at `README.md:105`, which is why the guard's `init({…apiUrl` test correctly stays quiet | **Correction to an earlier entry of mine.** I recorded this as a published defect after reading the *local working tree*. The published 0.1.1 README contains no `apiUrl` — verified by drift-guard against the tarball. The underlying API fact (claim 2, `apiUrl` is not a config field) is unaffected and remains verified from `dist/index.d.ts`. |
| Vue `README.md:308` (`detectPreferredLocale`) | **RESOLVED**, published in `0.2.1` — `README.md:337-352` documents both paths, labels the `\|\| 'en-US'` idiom WRONG, and gives the `includes()` guard | Both paths of claim 3 now documented, with the working guard |
| Svelte `README.md:140` ISO 8601 | **RESOLVED in 3.6.3**, and the evidence is now the strong kind — `3.6.10`'s `README.md:144` *states* CLDR medium date style (`Mar 14, 2026` / `14.03.2026`) rather than merely omitting the old claim | Went stale at the 3.2.0 CLDR adoption. Entry J above still describes this as verified by absence; that was true when written and is superseded here |

## Re-verification

Re-run before each release: `node src/bin/drift-guard.mjs`. It checks published artifacts across
**all three doc surfaces** (README, declaration headers, JSDoc), because two of the defects above
lived outside markdown and a README-only audit misses them by construction.

The Svelte 3.4.2 / Vue 0.1.2 confirmations this section used to wait on **all landed** — every
upstream defect tracked here is now resolved in a published artifact.

> **A caveat about how to read the guard's output, learned 2026-08-26.** Its `RESOLVED` lines are
> emitted whenever a defect is absent upstream, with **no awareness of whether this file already
> records it**. All five currently printed are already marked resolved above, so the guard's
> closing advice — *"mark resolved in VERIFIED.md"* — asks for work that is already done, on every
> run, forever. Treat a `RESOLVED` line as a *confirmation*, not a task, and check the tables here
> before acting on one.
>
> That noise has a cost, and it is visible in this file's history: the standing five trained the
> eye past the section, and the **Defect status** table below drifted for weeks — still calling
> PHP unpublished and four Svelte/Vue fixes "unreleased" — while the table above it said
> RESOLVED. Two tables in one file, contradicting each other, is what a permanently-ignored
> signal buys.
>
> The sharper half of the same gap: a defect recorded here as resolved that **came back** upstream
> would print as `still open in <pkg>@<version>` — the wording for a defect that never left, which
> reads as *no news*. So the guard is currently strongest on defects it has always seen and
> weakest on regressions of fixes, which is the inverse of what a drift guard is for.
