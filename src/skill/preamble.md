# The shared opening paragraph — source of truth

Every Langsys core and child skill opens with the block below, so an agent that finds an SDK
before it finds us is sent back up the tree. This file is the **source**; each SDK's repo
carries a copy inside its own `SKILL.md`, between the same two markers.

**Only the text between the markers is canonical.** Everything outside them, including this
heading, is notes for whoever maintains the template and is not copied anywhere.

To adopt or re-sync a copy, replace the marked block in that SDK's `SKILL.md` with the block
below, markers included. `node src/bin/skill-contract.mjs` compares every copy it can find
against this file and names any that differ.

Three properties the text has to keep, because each one is load-bearing:

- **It names the order and says not to skip a step.** An agent that reads only the framework
  skill gets the framework's deltas with none of the rules they modify.
- **It leads with the URL, not the install command.** The URL needs no Node and no install, so
  it is the one route that works for every project including PHP-only ones. The command is the
  fallback for an agent that cannot reach the page.
- **It is generic across languages.** No framework, no package manager, no language-specific
  path. A PHP agent and a Svelte agent read the same paragraph.

<!-- langsys-skill-preamble:start -->
**This skill is one part of the Langsys skill set.** Read the set in this order, and never skip a step:

1. **`langsys`**, the entry skill: what Langsys is, choosing the SDKs, the project, API keys and secrets, and the rules every Langsys SDK shares.
2. **The core skill of the SDK's language**: `langsys-typescript` for JavaScript and TypeScript, `langsys-php` for PHP. It holds what is true for every framework in that language.
3. **The framework's own skill**, such as `langsys-svelte` or `langsys-laravel`. It adds only what its framework changes.

The entry skill isn't installed with any SDK. If `langsys` isn't among your skills, read it at https://docs.langsys.dev/skill/langsys/. If you can't reach that page, tell the user to run `npx langsys-skill install`, which installs it with the skill of every Langsys package in the project.
<!-- langsys-skill-preamble:end -->
