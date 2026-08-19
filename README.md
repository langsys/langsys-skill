# langsys-skill

A portable agent skill for integrating the [Langsys](https://langsys.dev) translation SDKs into any project — and for migrating projects off i18next, react-intl, or vue-i18n.

Works in **Claude Code**, **Codex CLI**, **Gemini CLI**, and **Cursor**.

## Install

```bash
npx langsys-skill install            # this project, auto-detects hosts
npx langsys-skill install --global   # every project on this machine
```

Options: `--host=claude,codex,gemini,cursor` · `--dir=<path>` · `--dry-run`

Re-run to upgrade. Shared files (`AGENTS.md`, `GEMINI.md`) are edited only between managed markers, so your own content is never touched — and an unchanged re-install writes nothing.

## What it installs

```
.langsys/
  skill/      canonical markdown payload — one source of truth
  lint/       ast-grep rules + the markup checker
  bin/        scan, doctor, installer, drift guard
  VERIFIED.md every SDK claim, with the evidence
```

Then per host: `.claude/skills/langsys/SKILL.md` · `AGENTS.md` + `.codex/prompts/langsys.md` · `GEMINI.md` + `.gemini/commands/langsys.toml` · `.cursor/rules/langsys.mdc`

Claude Code gets progressive disclosure into the payload. The others have no equivalent, so their entry docs inline the rules that must not be missed.

## Covers

| SDK | Frameworks |
|---|---|
| `langsys-js-react` | React, Next.js (App + Pages Router), Remix, Vite |
| `langsys-js-vue` | Vue 3, Nuxt, Vite |
| `langsys-js-svelte` | Svelte 5, SvelteKit |
| `langsys-js-typescript` | Vanilla TS/JS, Node, custom bindings |
| `langsys/langsys-php` | PHP 7.4+, server-rendered pages |

Migration tracks: **i18next / react-i18next**, **react-intl / FormatJS**, **vue-i18n**.

## Why this exists

An agent asked to "add translations" arrives with i18next priors. In Langsys most of them are wrong, and the resulting bugs are **invisible in the base language** — they surface only when someone switches locale, or when a translator asks why the catalog has four hundred greetings.

The skill exists to overwrite those priors and then verify it worked:

- **The phrase is the key.** No catalog files, no dot-keys.
- **Never build a phrase string.** `` t(`Hello, ${name}!`) `` registers a new catalog entry per user — permanent pollution of shared state that the SDK cannot detect.
- **`%name%` in markup, `{name}` in `t()` strings.** Framework compilers eat `{name}` in markup before the SDK sees it.
- **Pick the right primitive.** `<Translate>` splits a block into parts; `<Phrase>` keeps one markup-bearing sentence whole. Getting this wrong separates a count from the noun it inflects, which breaks pluralization in Russian, Arabic, and Polish.

## Tools

```bash
npx langsys-scan .                        # inventory and scope, before you start
npx langsys-doctor                        # env, key type, versions, runtime floors
ast-grep scan -c .langsys/lint/sgconfig.yml src/
node .langsys/lint/markup-check.mjs src/  # .svelte/.vue markup rules
node .langsys/bin/drift-guard.mjs         # re-verify claims against published SDKs
```

**`scan`** answers the question that comes first: *how big is this job, and where are the hard parts?* It builds the integration profile mechanically and classifies every conversion site by primitive — `t()` / `<Phrase>` / `<Translate>` — and by effort. The number that predicts the schedule is not the total; it is the count of sites where a placeholder sits next to inline markup, because that is where a count gets separated from the noun it inflects.

`scan` is read-only and exits 0 on findings. On a codebase that predates Langsys a `sprintf()` is not a defect, it is a work item — so it reports **scope, not fault**. That is the whole difference from the linters.

Every run prints a **NOT EXAMINED** section, including when it is empty: files skipped, types not scanned, and four declared blind spots. A scan reporting "312 strings" after silently skipping forty files reads as complete coverage, and that failure mode has bitten this repo three times.

**`doctor`** catches what the SDK cannot: an env prefix that doesn't match the bundler, a write key headed for production, an SDK too old for the behavior the docs assume, a PHP runtime missing `ext-intl`.

**The linters** are split by necessity: ast-grep has no `.svelte`/`.vue` grammar, and that is exactly where the `%name%` rule matters most, so markup checks live in a purpose-built checker.

Rules key on **position, not spelling** — `{name}` is a defect in component markup and *correct* inside a `t()` string literal, including when that call sits inside markup. Every rule ships with paired negative cases; a rule that only proves it fires is half-tested.

## Verified, not assumed

Every claim is checked against the **published npm tarball** at a pinned version — never a local checkout, which can lead the registry by several commits. See [VERIFIED.md](./VERIFIED.md) for claim → version → evidence, plus known upstream doc defects and whether they are fixed yet.

`drift-guard` re-checks all of it across three doc surfaces — README, type-declaration headers, and JSDoc — because defects that live outside markdown are the ones IDE hover shows developers, and a README-only audit misses them by construction.

## Development

```bash
node --test test/run.mjs           # 69 tests
node src/lint/generate-rules.mjs   # regenerate per-language rule files
```

Lint rules are generated from one source of truth in `src/lint/generate-rules.mjs`; ast-grep rules are single-language, so hand-maintaining per-language copies would guarantee drift. CI fails if the generated output differs from what is committed.

## License

MIT
