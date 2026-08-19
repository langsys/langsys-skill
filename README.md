# langsys-skill

**Point your coding agent at a project and it adds Langsys translations correctly** — the right SDK for the framework, wired up, with every user-visible string converted using the right primitive.

Works in **Claude Code**, **Codex CLI**, **Gemini CLI**, and **Cursor**.

```bash
npx langsys-skill install       # this project
npx langsys-skill install -g    # every project on this machine
```

Then just ask:

> *"Add Langsys translations to this app"*

## What happens

| | |
|---|---|
| **1. Scope** | `langsys-scan` reads the project: framework, bundler, existing i18n library, base locale — and counts every string to convert, split by how hard each one is. |
| **2. Route** | Picks the matching SDK and the right guide. React app on Next.js? `langsys-js-react` plus the App Router seeding rules. Already on i18next? The migration track instead. |
| **3. Convert** | Wires `init()` once, then converts strings — choosing `t()`, `<Phrase>` or `<Translate>` per site, which is the decision that determines whether translations actually work. |
| **4. Verify** | `langsys-doctor` checks the environment and versions; the linters catch the mistakes that compile fine and break only in other languages. |

It stops and tells you when it can't proceed — a project on Svelte 3 can't use a binding that needs Svelte 5, and you learn that in step 1, not after `npm install` fails.

## Optional: the Langsys MCP

With the [Langsys MCP](https://docs.langsys.dev/guides/mcp/) connected, the skill can create the **organization, project and API keys** for you instead of asking you to paste them.

```bash
claude mcp add --scope=user --transport http langsys https://mcp.langsys.dev/mcp
```

`--scope=user` registers it for your account rather than one project, so it's there in every project you open — which is when you actually need it, since you're usually starting a *new* integration. Auth is browser sign-in on first use; no token in a config file.

Entirely optional. If you already have a project ID and key, the skill never asks for the MCP.

## Supported

| SDK | Frameworks |
|---|---|
| `langsys-js-react` | React 18+, Next.js (App + Pages Router), Remix, Vite |
| `langsys-js-vue` | Vue 3.4+, Nuxt, Vite |
| `langsys-js-svelte` | Svelte 5, SvelteKit |
| `langsys-js-typescript` | Vanilla TS/JS, Node, custom bindings |
| `langsys/langsys-php` | PHP 7.4+, server-rendered pages |

Migrating? Dedicated tracks for **i18next / react-i18next**, **react-intl / FormatJS**, and **vue-i18n**.

## What it gets right

Langsys works differently from i18next, and the differences fail *silently* — your base language keeps rendering perfectly while other locales break. These are the four that cost the most:

**The phrase is the key.** No `locales/en.json`, no dot-keys. `t('home.welcome')` registers the literal string `"home.welcome"` as something to translate.

**Never build a phrase string.** `` t(`Hello, ${name}!`) `` registers a new catalog entry for every user who loads the page — permanent pollution of shared project state that the SDK cannot detect at runtime.

**`%name%` in markup, `{name}` in `t()` strings.** Framework compilers substitute `{name}` before the SDK ever sees the text, so the phrase gets captured with one specific user's data baked in.

**Pick the right primitive.** `<Translate>` splits a block into per-node phrases; `<Phrase>` keeps one markup-bearing sentence whole. Get it wrong and a count lands in a different phrase from the noun it inflects — which breaks pluralization in Russian, Arabic and Polish while looking perfect in English.

## Installed layout

```
.langsys/
  skill/      the guides, one canonical copy
  lint/       ast-grep rules + the markup checker
  bin/        scan, doctor, installer, drift guard
  VERIFIED.md every SDK claim, with the evidence
```

Per host: `.claude/skills/langsys/SKILL.md` · `AGENTS.md` + `.codex/prompts/langsys.md` · `GEMINI.md` + `.gemini/commands/langsys.toml` · `.cursor/rules/langsys.mdc`

Claude Code gets progressive disclosure into the guides; the others inline the rules that must not be missed. Re-run to upgrade — shared files are edited only between managed markers, so your own content is never touched, and an unchanged re-install writes nothing.

Options: `--host=claude,codex,gemini,cursor` · `--dir=<path>` · `--dry-run`

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
node --test test/run.mjs           # 82 tests
node src/lint/generate-rules.mjs   # regenerate per-language rule files
```

Lint rules are generated from one source of truth in `src/lint/generate-rules.mjs`; ast-grep rules are single-language, so hand-maintaining per-language copies would guarantee drift. CI fails if the generated output differs from what is committed.

## License

MIT
