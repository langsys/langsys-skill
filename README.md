# langsys-skill

**Point your coding agent at a project and it adds Langsys translations correctly** — the right SDK for the framework, wired up, with every user-visible string converted using the right primitive.

Works in **Claude Code**, **Codex CLI**, **Gemini CLI**, and **Cursor**.

```bash
npx langsys-skill install       # this project
npx langsys-skill install -g    # every project on this machine
```

Then just ask:

> *"Add Langsys translations to this app"*

## One skill per SDK level

The guidance is a tree that mirrors how the SDKs are built, and each skill ships inside the
package it describes — so an agent reads the guidance for the version actually installed,
not for whatever a separately-released document was last checked against.

```
langsys                    the entry skill — this package
├── langsys-typescript     ships in langsys-js-typescript
│   ├── langsys-svelte     ships in langsys-js-svelte
│   ├── langsys-react      ships in langsys-js-react
│   └── langsys-vue        ships in langsys-js-vue
└── langsys-php            ships in langsys/langsys-php
    └── langsys-laravel    ships in langsys/langsys-php-laravel
```

**This package is the entry skill and the installer.** It holds what is true in every
language — what Langsys is, choosing the SDKs, projects and keys, categories, the MCP, the
tools, and the rules a project rendering through two SDKs needs — and `install` copies the
skill of every Langsys package the project has installed into your agent's skill folder.

Where an SDK has not yet had a release carrying its skill, this package keeps a **pinned
guide** for it, naming the one published version it was verified against. Outside that
version you are sent to the package's own README rather than handed a guide for a version
you do not have.

## What happens

| | |
|---|---|
| **1. Scope** | `langsys-scan` reads the project: framework, bundler, existing i18n library, base locale — and counts every string to convert, split by how hard each one is. |
| **2. Route** | Picks the matching SDK, then the installed skill for it — or the pinned guide, or that package's README if neither fits the installed version. It also checks which **core** the binding resolved to, since React and Vue pin core 0.6.5 and most 0.7 guidance does not apply to them. |
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

| SDK | Frameworks | Guidance from |
|---|---|---|
| `langsys-js-typescript` | Vanilla TS/JS, Node, custom bindings | its own `langsys-typescript` skill |
| `langsys-js-svelte` | Svelte 5, SvelteKit 2.10+ | its own `langsys-svelte` skill |
| `langsys/langsys-php` | PHP 7.4+, server-rendered pages | its own `langsys-php` skill |
| `langsys-js-react` | React 18+, Next.js (App + Pages Router), Remix, Vite | **pinned here** — `0.6.7` |
| `langsys-js-vue` | Vue 3.4+, Nuxt, Vite | **pinned here** — `0.2.1` |
| `langsys/langsys-php-laravel` | Laravel 10–12 | **pinned here** — `1.0.0` |
| `langsys-js-server` | Node / Deno / Bun / Workers — **translated HTML on the server**, for crawler-visible copy | **pinned here** — `0.1.0` |

A skill that ships in its own package always wins over a pinned guide here. Until one ships,
the pinned guide applies at its stated version and nowhere else.

Migrating? Dedicated tracks for **i18next / react-i18next**, **react-intl / FormatJS**, and
**vue-i18n** — the codemod route, for the bindings on core 0.6.x. On core 0.7 the TypeScript
core skill's `legacyKeys` path replaces them.

## What it gets right

Langsys works differently from i18next, and the differences fail *silently* — your base language keeps rendering perfectly while other locales break. These are the four that cost the most:

**The phrase is the key.** No `locales/en.json`, no dot-keys. `t('home.welcome')` registers the literal string `"home.welcome"` as something to translate.

**Never build a phrase string.** `` t(`Hello, ${name}!`) `` registers a new catalog entry for every user who loads the page — permanent pollution of shared project state that the SDK cannot detect at runtime.

**`%name%` in markup, `{name}` in `t()` strings.** Framework compilers substitute `{name}` before the SDK ever sees the text, so the phrase gets captured with one specific user's data baked in.

**Pick the right primitive.** `<Translate>` splits a block into per-node phrases; `<Phrase>` keeps one markup-bearing sentence whole. Get it wrong and a count lands in a different phrase from the noun it inflects — which breaks pluralization in Russian, Arabic and Polish while looking perfect in English.

## Installed layout

```
.langsys/
  skill/        the entry skill, one canonical copy
  skills/       each installed SDK's own skill, copied from its package
  skills.json   what was copied, from which version, with per-file hashes
  lint/         ast-grep rules + the markup checker
  bin/          scan, doctor, installer, drift guard, contract check
  VERIFIED.md   every claim this package makes, with the evidence
```

SDK skills are **copied, never linked.** A symlink would re-point the moment the package
upgraded, so a document an agent is working from could change underneath it with nothing
recording which version the work was done against. A copy goes stale instead — visibly:
`skills.json` records what was copied and `doctor` reports `match`, `stale` or `edited`,
with `edited` warning you before a re-install discards someone's changes.

Per host: `.claude/skills/langsys/SKILL.md` · `AGENTS.md` + `.codex/prompts/langsys.md` · `GEMINI.md` + `.gemini/commands/langsys.toml` · `.cursor/rules/langsys.mdc`

Claude Code also gets two standalone entry points, because both answer a question people ask **without** wanting an integration:

- **`/langsys-scan`** — how big is this job?
- **`/langsys-doctor`** — why isn't this working?

They are thin routers over the same payload, never copies. Same tools are on `PATH` as `npx langsys-scan` / `npx langsys-doctor` for anyone not in Claude Code.

Claude Code gets progressive disclosure into the guides; the others inline the rules that must not be missed. Re-run to upgrade — shared files are edited only between managed markers, so your own content is never touched, and an unchanged re-install writes nothing.

Options: `--host=claude,codex,gemini,cursor` · `--dir=<path>` · `--dry-run`

## Tools

```bash
npx langsys-scan .                        # inventory and scope, before you start
npx langsys-doctor                        # env, key type, versions, runtime floors
ast-grep scan -c .langsys/lint/sgconfig.yml src/
node .langsys/lint/markup-check.mjs src/  # .svelte/.vue markup rules
node .langsys/bin/drift-guard.mjs         # re-verify claims against published SDKs
node .langsys/bin/skill-contract.mjs      # the shared preamble, and links from SDK skills
```

**`scan`** answers the question that comes first: *how big is this job, and where are the hard parts?* It builds the integration profile mechanically and classifies every conversion site by primitive — `t()` / `<Phrase>` / `<Translate>` — and by effort. The number that predicts the schedule is not the total; it is the count of sites where a placeholder sits next to inline markup, because that is where a count gets separated from the noun it inflects.

`scan` is read-only and exits 0 on findings. On a codebase that predates Langsys a `sprintf()` is not a defect, it is a work item — so it reports **scope, not fault**. That is the whole difference from the linters.

Every run prints a **NOT EXAMINED** section, including when it is empty: files skipped, types not scanned, and four declared blind spots. A scan reporting "312 strings" after silently skipping forty files reads as complete coverage, and that failure mode has bitten this repo three times.

**`doctor`** catches what the SDK cannot: an env prefix that doesn't match the bundler, a write key headed for production, an SDK too old for the behavior the docs assume, a PHP runtime missing `ext-intl`.

**The linters** are split by necessity: ast-grep has no `.svelte`/`.vue` grammar, and that is exactly where the `%name%` rule matters most, so markup checks live in a purpose-built checker.

Rules key on **position, not spelling** — `{name}` is a defect in component markup and *correct* inside a `t()` string literal, including when that call sits inside markup. Every rule ships with paired negative cases; a rule that only proves it fires is half-tested.

## Verified, not assumed

Every claim is checked against the **published npm tarball** at a pinned version — never a local checkout, which can lead the registry by several commits. See [VERIFIED.md](./VERIFIED.md) for claim → version → evidence, plus known upstream doc defects and whether they are fixed yet.

`drift-guard` re-checks all of it across three doc surfaces — README, type-declaration
headers, and JSDoc — because defects that live outside markdown are the ones IDE hover shows
developers, and a README-only audit misses them by construction. It resolves a package's type
surface by following its re-exports rather than naming a file, because a bundler moving a type
into a content-hashed chunk is not a change to the type.

`skill-contract` checks the two things that cross a repo boundary: that every SDK skill carries
the current shared opening from `src/skill/preamble.md`, and that every
`docs.langsys.dev/skill/langsys/<path>` link in an SDK skill still resolves in this payload. The
second direction is the urgent one — a published SDK skill cannot be edited, so a rename here
has to be caught before it ships.

## Development

```bash
node --test test/run.mjs           # the full suite
node src/lint/generate-rules.mjs   # regenerate per-language rule files
```

Lint rules are generated from one source of truth in `src/lint/generate-rules.mjs`; ast-grep rules are single-language, so hand-maintaining per-language copies would guarantee drift. CI fails if the generated output differs from what is committed.

## License

MIT
