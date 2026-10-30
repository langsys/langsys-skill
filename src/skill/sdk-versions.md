# Versions: which core your binding brings, and which skill describes it

Two version questions decide whether the guidance you are about to follow is true for the
project in front of you. Both are answered mechanically — `doctor` prints them — and both are
wrong often enough to check every time.

1. **Which core SDK does this binding actually install?** A framework package is a thin layer
   over a language core, and the core's version is what decides behavior.
2. **Does the skill you are reading describe the version installed here?** Each SDK's skill
   declares the package and version it was written against, in its frontmatter.

---

## 1. The core a binding brings

Measured by installing each published binding into an empty project and reading the resolved
`langsys-js-typescript/package.json`:

| You install | Published | Declares | **Resolves core** |
|---|---|---|---|
| `langsys-js-typescript` | 0.7.0 | — | **0.7.0** |
| `langsys-js-svelte` | 4.0.0 | `^0.7.0` | **0.7.x** |
| `langsys-js-react` | 0.6.7 | `^0.6.5` | **0.6.5** |
| `langsys-js-vue` | 0.2.1 | `^0.6.5` | **0.6.5** |
| `langsys-js-svelte` 3.x | 3.6.17 | `^0.6.4` | **0.6.5** |

**`^0.6.5` does not admit 0.7.0.** A caret on a `0.x` version pins the minor — `^0.6.5` means
`>=0.6.5 <0.7.0`. So a React or Vue app is on core **0.6.5** today, and `npm update` will not
move it. Only a new release of the binding can.

**Do not read a binding's own version as a core version.** `langsys-js-react@0.6.7` and
`langsys-js-svelte@4.0.0` tell you nothing about the core underneath. Only the resolved
dependency does:

```bash
npm ls langsys-js-typescript         # the resolved core, and where each copy came from
composer show langsys/langsys-php    # the resolved PHP SDK
```

### In a React or Vue app, never install `langsys-js-typescript` yourself

**Use only the core the binding brings.** Adding the core as a direct dependency to reach a
0.7 feature does not upgrade the binding — it gives the app **two cores**. Measured:

```
npm i langsys-js-react@0.6.7 langsys-js-typescript@0.7.0

node_modules/langsys-js-typescript                           -> 0.7.0   your imports
node_modules/langsys-js-react/node_modules/
                            langsys-js-typescript            -> 0.6.5   the binding's
```

npm satisfies the binding's own `^0.6.5` with a nested copy, so both versions are present and
loaded. They are separate module instances: two locale subscriptions, two in-memory catalogs
and two registration queues over one project, with neither aware of the other. `useT()` and
`<Translate>` run on 0.6.5 while anything you import directly runs on 0.7.0. **Nothing
errors**, and the base language renders correctly throughout.

So: in a React or Vue app, import only from `langsys-js-react` / `langsys-js-vue`. If a
feature you want is core 0.7 only, it is not available in that app — wait for the binding to
raise its range. Removing a direct core dependency someone already added is a fix, not a
regression.

### Never route a React or Vue app to `langsys-typescript`

The `langsys-typescript` core skill describes core **0.7**. A React or Vue app is on core
0.6.5, so that skill's rules are wrong for it in ways that fail silently — locale case, the
no-match answer from `detectPreferredLocale`, who decides registration, whether `apiUrl`
exists. Those apps are served by this package's pinned guides instead:

| App | Read |
|---|---|
| React (any meta-framework) | [pinned/react.md](./pinned/react.md) |
| Vue / Nuxt | [pinned/vue.md](./pinned/vue.md) |
| Svelte, or plain TypeScript | `langsys-typescript`, then `langsys-svelte` if present |
| PHP | `langsys-php`, then `langsys-laravel` if present |

---

## 2. Does this skill describe what is installed?

Every core and child skill carries its package and version in frontmatter:

```yaml
metadata:
  package: langsys-js-typescript
  version: 0.7.0
```

**Compare that against the installed package before relying on the skill.** They can differ
for two ordinary reasons: the project upgraded the SDK without re-running the installer, or
the skill was copied from a different project.

```bash
node .langsys/bin/doctor.mjs      # compares every installed skill against its package
```

`doctor` reports three states, and the middle one is the one to act on:

| State | Meaning |
|---|---|
| **match** | The skill describes the installed version. Proceed |
| **stale** | The versions differ. Re-run `npx langsys-skill install`, and until then treat the skill as a guide to a version you do not have |
| **edited** | A copied skill's contents no longer match the package's own. Someone edited the copy; the SDK's own copy is authoritative |

A skill is **copied, not linked**, so an upgrade never silently rewrites it — which is why the
stale state exists at all, and why re-running the installer is the fix.

### If a package ships no skill

Not every SDK has had a release carrying one yet. Two cases, and only one of them is safe:

- **The installed version is inside a pinned guide's range** — use that guide, in
  [pinned/](./pinned/). Each one names the single published version it was verified against.
- **It is outside that range** — **read that package's own README instead**, and tell the user
  which you used and why. Do not use a guide verified against a different version. A guide
  that is one minor behind looks authoritative and is wrong in exactly the places that fail
  silently.

Today that second case is `langsys-js-svelte@4.0.0` and `langsys/langsys-php@2.0.0`: this
package's older guides for them were written against 3.6.x and 1.x, so they are gone rather
than left to mislead. Their READMEs are accurate and are the right place to look until their
own skills ship.
