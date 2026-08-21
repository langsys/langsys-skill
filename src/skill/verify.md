# Verification

**The integration is not done until this passes.** Every check here targets a failure that is invisible in the base language.

> ## Verify in a real browser. `curl` cannot do it.
>
> In React, Vue and Svelte the catalog is populated by `init()` in a client-only hook, so **body copy translates after hydration**. `curl | grep` therefore shows the base language on a page that is working perfectly — *and shows exactly the same thing on one that is completely broken*. It cannot distinguish them.
>
> This has cost a production team an afternoon. They shipped nav labels rendered as `{child.label}` instead of `t(child.label, 'Main Menu')`; every `curl` check looked identical to the working case.
>
> A view-source check is valid for exactly two things: the **server-resolved head** (see [core/rendering-mode.md](./core/rendering-mode.md)), and confirming no API key is in the bundle. For everything else, open a browser.
>
> PHP is the exception — `translatePage()` translates server-side, so its output *is* checkable from the response body.

## 1. Static — build and lint

```bash
npx tsc --noEmit           # or the project's typecheck
npm run build
npx ast-grep scan -c .langsys/skill/../lint/sgconfig.yml
```

Lint must be **clean of errors**. Warnings need a human decision — do not suppress them to get green.

## 2. Structural — inspect the diff

- [ ] No `locales/*.json`, `messages/`, or any catalog file was created
- [ ] Every `t()` first argument is a **string literal** — no template literals, concatenation, or `sprintf`
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

Full detail: [troubleshooting.md](./troubleshooting.md).
