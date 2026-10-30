# Verify — what "done" means, in any language

Each core skill has the console messages and commands for its own SDK. This page is the
acceptance criteria, which are the same everywhere, and the one check that cannot be skipped.

**It is not done until step 3 passes.** Steps 1 and 2 pass on an integration that is quietly
wrong.

## 1. It builds, and the lint is clean

```bash
# typecheck / build with the project's own command, then:
ast-grep scan -c .langsys/lint/sgconfig.yml
```

The ruleset catches the failures no runtime can: a phrase built by interpolation, a dot-key, a
reversed argument order, markup in a plain call, a placeholder the framework's compiler will
eat. These are structural, so they are decidable without running anything.

## 2. It renders, in a second locale

Switch locale and confirm the text changes. Necessary, and nowhere near sufficient: it proves
the catalog arrived, and says nothing about what was registered.

**Do not verify with `curl` and a grep for translated text.** Client-side translation happens
after hydration, so the served HTML is base language by design on most setups. The exception
is a deliberately server-rendered path, where counting bytes in the served HTML *is* the
property under test.

## 3. Read the registered phrase set — the only check that catches a wrong primitive

Open the project in the Translation Manager and look at what was registered. Not that
*something* was, but **what**.

| What you should see | What a mistake looks like |
|---|---|
| A sentence with inline markup as **one** phrase, with markup tokens in it | the same sentence as three fragments — `"Based on"`, `"5"`, `"reviews"` |
| A block as several phrases, registered together | one enormous phrase holding a whole article |
| Placeholders intact: `Hello {name}` | one phrase per user: `Hello Ana`, `Hello Luis` |
| One entry per piece of content | two entries for the same content — two SDKs disagreeing, or a block that re-registered |

Every one of these renders correctly in the base language. That is why this step exists and
why no amount of looking at the page replaces it.

> **Fragments are the expensive mistake.** A shredded sentence cannot be reordered by a
> translator and cannot take a plural, so it produces confidently wrong grammar in Russian,
> Arabic and Polish — and it surfaces as a translator's complaint weeks later, not as an error.

## 4. Nothing registered that should not have

- **No per-visitor values.** Search the catalog for a user's name, an email address, an id. One
  hit means a phrase is being built somewhere; find it before it grows.
- **No duplicate entries** for content two SDKs both render — [two-languages.md](./two-languages.md).
- **Nothing from a production read.** If a production key is registering, that is the key type
  or the write decision, not the code.

## 5. Production configuration

- [ ] Read-only or allow-listed key, never a plain write key
- [ ] Debug diagnostics off
- [ ] No key literal in source; `.env` gitignored
- [ ] Base locale confirmed with the user, not guessed

## If nothing registered at all

That is usually not a code fault. Work the symptom tree in
[projects-and-keys.md](./projects-and-keys.md) before changing anything — on current SDKs the
commonest answer is that the session was never write-enabled, and the second commonest is a
framework build step that was not installed.

## Report it honestly

Say which of these steps you actually ran. "Builds and renders in Spanish" is a true and
useful statement; it is not "verified". If step 3 was not possible — no Translation Manager
access, for instance — say that step 3 is outstanding rather than reporting the integration
complete.
