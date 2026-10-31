# Pinned guides — for SDKs that do not yet ship their own skill

Each Langsys SDK is moving to shipping its own skill inside its own package, written by the
same people who write the code and released with it. Until a given SDK has had such a release,
its guidance lives here instead.

**Every guide in this folder names the single published version it was verified against.** That
is the whole point of the folder: these are not "roughly current" docs, they are docs pinned to
a known artifact.

| Guide | Verified against |
|---|---|
| [react.md](./react.md) | `langsys-js-react@0.6.7` → core 0.6.5 |
| [vue.md](./vue.md) | `langsys-js-vue@0.2.1` → core 0.6.5 |
| [ssr-nextjs.md](./ssr-nextjs.md) | same as react.md |
| [ssr-nuxt.md](./ssr-nuxt.md) | same as vue.md |
| [js-server.md](./js-server.md) | `langsys-js-server@0.1.0` |
| [laravel.md](./laravel.md) | `langsys/langsys-php-laravel@1.0.0` → PHP SDK 1.3.x |
| [core-0.6/invariants.md](./core-0.6/invariants.md) | base SDK `langsys-js-typescript@0.6.5` |
| [migrate/_method.md](./migrate/_method.md) | the codemod route, for core 0.6.x only |

## How to use this folder

1. **Check the installed version** against the table. `doctor` does it for you.
2. **Inside the range** — use the guide.
3. **Outside the range** — **read that package's own README instead**, and tell the user that
   is what you did and why.

Rule 3 is not caution for its own sake. A guide one minor version behind reads as
authoritative and is wrong in exactly the places that fail silently — locale case, who may
register, whether a config field exists. A README that is merely terse is safer than a guide
that is confidently stale.

## Why `core-0.6/` exists separately

The React and Vue bindings install base SDK **0.6.5**, not 0.7, and cannot be moved to 0.7
without a new release of the binding — see [../sdk-versions.md](../sdk-versions.md). So the
core rules they need are the 0.6.x ones, and they live in `core-0.6/`.

**Do not read `core-0.6/` for a Svelte or plain-TypeScript project**, and do not read the
`langsys-typescript` core skill for a React or Vue project. Both substitutions are wrong, and
wrong quietly.

## What left this folder, and where it went

| Was here | Now |
|---|---|
| Svelte, SvelteKit | the `langsys-svelte` skill, in `langsys-js-svelte` ≥ 4.0.2 |
| Plain TypeScript | the `langsys-typescript` skill, in `langsys-js-typescript` ≥ 0.7.1 |
| PHP | the `langsys-php` skill, in `langsys/langsys-php` ≥ 2.0.1 |

All three ship their skill today, so nothing here stands in for them. Below those versions a
package carries no skill and there is no guide for it here either, so its README is the answer.
