# Verification

**The integration is not done until this passes.** Every check here targets a failure that is invisible in the base language.

> ## Which check is valid depends on whether you seeded the catalog.
>
> **If the app seeds the store during SSR** (see [core/rendering-mode.md](./core/rendering-mode.md)),
> `t()` body copy is in the served HTML, so **`curl` is not merely valid — it is the check
> that matters**, and it is the only one a crawler's view agrees with. Run
> `ssr-i18n-check` (§1) on at least one non-base locale before every deploy that touches
> i18n. PHP has always been in this category.
>
> **If the app does not seed** — client-only, or SSR without a seed — body copy translates
> after hydration. `curl | grep` then shows the base language on a page working perfectly
> *and* on one completely broken, and cannot distinguish them. This has cost a production
> team an afternoon: nav labels shipped as `{child.label}` instead of
> `t(child.label, 'Main Menu')`, and every `curl` check looked identical to the working
> case. There, open a browser.
>
> **Correction, 2026-08-30.** This section previously said `curl` could never do it. That
> advice was self-confirming: it was true only of the unseeded pattern the skill itself
> documented, and it steered people away from the single check that would have exposed the
> problem. Seven production sites served byte-identical localized routes for months behind
> it.
>
> `<Phrase>` and `<Translate>` are base-locale in server HTML regardless — no check changes
> that, and a residue percentage is the honest measure of it, not a failure.

## 1. Static — build and lint

```bash
npx tsc --noEmit           # or the project's typecheck
npm run build
npx ast-grep scan -c .langsys/skill/../lint/sgconfig.yml
```

Lint must be **clean of errors**. Warnings need a human decision — do not suppress them to get green.

### `ssr-i18n-check` — the one-command SSR test

**Only for an app that seeds during SSR** (see [core/rendering-mode.md](./core/rendering-mode.md)).
Strip scripts, styles and head from two locales of the same route and compare the rendered
text. If the localized page is byte-identical to the base locale, translations are not
reaching the server — every localized URL is a duplicate of the base one, and a search
engine will fold them into a single cluster.

Boolean, no browser needed. Belongs in the deploy checklist for anything touching i18n.

```bash
#!/bin/bash
# ssr-i18n-check https://site.example /about it
BASE=$1; ROUTE=$2; LOC=$3
curl -sL "$BASE$ROUTE"      -o /tmp/a.html
curl -sL "$BASE/$LOC$ROUTE" -o /tmp/b.html
python3 - <<'EOF'
import re, sys
def dom(p):
    h = open(p, encoding='utf-8', errors='replace').read()
    for t in ('script', 'style', 'head'):
        h = re.sub(r'<%s\b.*?</%s>' % (t, t), '', h, flags=re.S | re.I)
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', h)).strip()
a, b = dom('/tmp/a.html'), dom('/tmp/b.html')
if a == b:
    print("FAIL: localized SSR is byte-identical to the base locale"); sys.exit(1)
def s(t): return {x.strip() for x in re.split(r'(?<=[.!?]) ', t) if len(x.strip()) > 35}
left = len(s(a) & s(b)) / max(1, len(s(b)))
print("PASS - untranslated prose remaining: %.0f%%" % (100 * left))
EOF
```

**The percentage is not a failure — it is the `<Phrase>`/`<Translate>` residue**, which no
seeding removes. Record it. It is the honest measure of how much of the page a crawler can
actually read. A production platform measured 4–24% per page after seeding landed.

### Two concurrency tests, if you seed

Seeding writes to a per-process singleton, so both directions need proving:

- **Interleaving.** Fire every locale you support concurrently at the *built production
  server* and assert each response came back in its own language.

  > **Two reproducer traps, both of which produce a confident wrong number.** A
  > `<svelte:boundary>` with a `pending` snippet masks the whole effect — one run reported
  > 4/4 "bleeds" that were all the pending snippet. And a component-body seed left in place
  > while testing a *hook* seed re-seeds synchronously just before render, hiding the hook
  > entirely and reporting 0/80 for a shape that actually bleeds 70/80. Prove a single
  > non-concurrent render returns real post-await content before trusting any number, and
  > run the safe shapes as controls — an unexplained failing number is not a finding.
- **Sequential carry-over — the one that actually ships.** Run a proxy that fails *one*
  locale while another stays warm. Request the warm one, then the failing one, and assert
  the failing one falls back to the **base locale**, not the warm locale's language.
  Confirmed to bite under a *synchronous* renderer, so passing the interleaving test above
  buys no protection from it.

  **Run this test from a cold process, and again from a warm one.** A total outage from
  cold renders untranslated base language and looks completely fine — which is why the bug
  survives a first round of testing. But once *any* locale has succeeded even once, the
  singleton is poisoned, and a subsequent total outage mislabels **every** locale rather
  than none. In a long-lived server process, poisoned is the steady state and cold is the
  exception. Testing only from cold is how you conclude a total outage is harmless.

## 2. Structural — inspect the diff

- [ ] No `locales/*.json`, `messages/`, or any catalog file was created
- [ ] No phrase is **built** at the call site: no template substitution, concatenation, or `sprintf`. Passing a whole string through a variable (from a CMS, say) is fine
- [ ] `t(phrase, category)` order everywhere
- [ ] `%name%` in component markup; `{name}` only inside `t()` strings
- [ ] `<Translate>` / `<Phrase>` children are static
- [ ] No API key literal in source; `.env` gitignored
- [ ] `LangsysApp.init()` called once, high in the tree, `res.status` checked

## 3. Runtime — with a WRITE key and `debug: true`

Both settings matter: the write key registers phrases so you can inspect what was captured, and debug enables the diagnostic that catches the silent interpolation bug.

```ts
await LangsysApp.init({ /* … */ key: WRITE_KEY, debug: true });
```

### 3a. Console is clean

**No unmatched-params warning** (base SDK ≥ 0.4.3):

```
Langsys Warning  <Translate> received params with no matching placeholder…
```

If it appears, you wrote `{name}` in markup — fix to `%name%`.

> **Below 0.4.3 this warning does not exist.** Do not treat a silent console as a pass; rely on the lint rule and step 3c instead. Check with `npm ls langsys-js-typescript`.

Also check for init failures — a rejected key or bad project ID logs here.

### 3b. Switch locale

Change the locale store and confirm text actually changes. If nothing happens:

- `init()` may have failed (check `res.status`)
- The locale may have no translations yet (expected on a fresh project — the base language is the fallback)
- The component may not be subscribed (`useT()` / `$t` / `t.value`)

### 3c. Inspect the registered phrase set — the critical check

Open the Translation Manager and look at what was actually registered. **This is the check that catches primitive-selection errors**, and nothing else does.

| Expect to see | Not |
|---|---|
| `Based on {n} {m0o}reviews{m0c}` — one phrase | `Based on {n}` and `reviews` — two fragments |
| `Hello, {name}!` — with the placeholder intact | `Hello, Sarah!` — a substituted value |
| One `Save` shared across the app | `Save` duplicated per category |

Three failure signatures:

- **Fragments where a sentence should be** → a markup-bearing sentence went through `<Translate>` instead of `<Phrase>` ([choosing-primitives.md](./core/choosing-primitives.md))
- **Real user data in a phrase** → a pre-formatted string ([invariants.md §0](./core/invariants.md)). Fix immediately — every new value adds another entry
- **Substituted values instead of placeholders** → `{name}` in markup

### 3d. Exercise the app

Click through the main flows so phrases register. Anything never rendered never gets registered — the discovery is runtime, not static.

> **A phrase rendered only on the server never registers either — even though it renders on every request.** Harvesting lives inside `t()`; the pure catalog translator prescribed for crawler-visible text deliberately omits it, because a process-global flush queue would reintroduce the cross-request coupling it exists to avoid. So meta descriptions, PDFs, emails and any SSR-only copy must be registered another way: exercise them once client-side in development with a write key, or add them in the Translation Manager by hand. **Check for these explicitly in step 3c** — their absence is silent and the pages look correct.

## 4. Production configuration

- [ ] **Read-only key** in production config
- [ ] `debug: false`
- [ ] SSR seeding in place if the app server-renders (`initialTranslations` + `initialTranslationsLocale` — **both**, or it silently no-ops)
- [ ] No duplicate translation fetch on hydration (check the network tab)
- [ ] `init()` never runs during server rendering — it races module globals across concurrent requests
- [ ] Crawler-visible text resolved from the catalog, not from `t()` / `$t`
- [ ] Offered locales deduplicated by URL token before rendering `hreflang`
- [ ] If the SDK is a `link:`/workspace dependency, the **deploying machine's** build is the one that ships — pin or verify it

## 5. Report

State plainly:

- Which files changed and roughly how many phrases registered
- Anything skipped or quarantined, and why
- Any warnings left unresolved
- **Whether step 3c was actually performed** — it needs the Translation Manager, and if you could not access it, say so rather than implying the integration is verified

---

## Quick triage

| Symptom | Cause |
|---|---|
| Nothing translates | init failed, or no translations exist for that locale yet |
| Base language fine, other locale garbled | `{name}` in markup instead of `%name%` |
| Sentence translated in pieces | `<Translate>` where `<Phrase>` was needed |
| Catalog full of near-duplicates | Pre-formatted phrase strings |
| Text flashes untranslated on load | Missing SSR seeding |
| Phrase registered under the wrong name | Reversed `t()` arguments |
| Every string renders as its category name | Stale SDK build inlined at deploy time |
| Every page blank after adding a locale | Duplicate `hreflang` keys — two locales sharing one URL token |
| Server HTML is base language | Expected in JS frameworks — not a defect. Verify in a browser |
| Server HTML shows a literal `{name}` or raw ICU syntax | A server-side catalog lookup that skipped `interpolate` |
| A phrase renders but never appears in the Translation Manager | It renders only server-side, where nothing harvests it |

Full detail: [troubleshooting.md](./troubleshooting.md).
