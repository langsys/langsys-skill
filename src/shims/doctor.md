---
name: langsys-doctor
description: Check a Langsys setup for problems — SDK versions against verified ranges, env prefix, API key type, peer floors, and MCP availability. Use when Langsys is installed but something is wrong, translations are not appearing, or before trusting version-gated guidance.
---

# Check a Langsys setup

Read-only diagnostics. Run this when Langsys is **already installed** and something is off, or as
preflight before relying on version-specific guidance.

## Run it

```bash
node .langsys/bin/doctor.mjs
```

Pass a path to check a different project.

## What the findings mean

| Finding | What to do |
|---|---|
| `is older than the verified` | Guidance may not apply. Upgrade, or confirm the behaviour before relying on it |
| `is newer than the verified` | **Behaviour may have changed since verification.** Re-verify before trusting version-gated guidance — do not assume newer is safe |
| declared base range caps below the floor | A caret that caps below a fix delivers that fix to nobody. The binding is correct; the **range** is not |
| env prefix missing or wrong | The most common silent misconfiguration. The key resolves to `undefined` with no build error |
| write key in production | Registers phrases from live traffic. The catalog pollution is permanent and shared |
| MCP registered for THIS project only | The next project silently lacks it. `--scope=user` is what you want |

## Two things doctor cannot tell you

- **Whether the base locale is right.** `en-GB` and `en-US` are different catalogs and the choice
  is not reversible by editing config. Confirm it with the user.
- **Whether phrases are registering correctly.** That needs the Translation Manager — see
  `verify.md` §3c, which is the only check that catches primitive-selection errors.

## A clean run is not a verified integration

`doctor` checks configuration, not content. It cannot see a `<Translate>` that should have been a
`<Phrase>`, or a phrase string built by interpolation. Say so plainly rather than reporting
"all good".

If the user wants the integration itself, hand off: **run `/langsys`**.
