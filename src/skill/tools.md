# `scan` and `doctor`

Two read-only tools that answer the mechanical questions, so the judgement calls are the only
ones left. Both ship with this skill and need nothing installed in the project.

```bash
node .langsys/bin/scan.mjs .        # how big is this job?
node .langsys/bin/doctor.mjs        # is this setup sound?
```

Pass a path to either to look at a different directory. `scan --json` emits machine-readable
output.

## `scan` — size the job, change nothing

Run it **before** choosing a route. It builds the profile mechanically: framework and version,
bundler, environment-variable prefix, existing i18n library and its catalogs, deployment
posture, and every conversion site split by which primitive it wants and by how much human
judgement it needs.

**Read its NOT EXAMINED section and report it with the numbers.** It lists what it could not
see — generated bundles, unparseable files, dynamic call sites. The totals are only as complete
as that section says they are, and a total quoted without it is a confident wrong number,
which is worse than no number.

`scan` exits 0 when it finds work. A non-zero exit means it could not do its job, not that the
project has problems.

## `doctor` — check the setup, and which guidance applies

Run it in preflight, before relying on anything version-gated, and again when something is
wrong. It reports:

- **Which core each installed binding resolved to**, which is what decides whether a given
  rule applies at all — [sdk-versions.md](./sdk-versions.md)
- **Whether each installed skill matches its package**, as `match`, `stale` or `edited`. A
  stale skill describes a version you do not have; re-run `npx langsys-skill install`
- Installed SDK versions against the ranges this skill was verified against, and peer floors
- The environment-variable prefix against the detected bundler
- The key type, and a write key in a production configuration
- `.env` gitignored, and no key literal in source
- MCP availability, and whether it was registered for this project only

| Finding | What to do |
|---|---|
| `is older than the verified` | Guidance may not apply. Upgrade, or confirm the behaviour first |
| `is newer than the verified` | **Behaviour may have changed since verification.** Re-verify; do not assume newer is safe |
| declared base range caps below the floor | A caret that caps below a fix delivers that fix to nobody. The binding is correct; the **range** is not |
| skill `stale` | Re-run the installer. Until then the skill describes another version |
| skill `edited` | A copy was edited in place. The package's own copy is authoritative |
| env prefix missing or wrong | The key resolves to `undefined` at runtime with no build error |
| write key in production | Registers phrases from live traffic; the pollution is permanent and shared |
| MCP registered for THIS project only | The next project silently lacks it; `--scope=user` is what you want |

## What neither tool can tell you

Say these out loud rather than letting a clean run imply them.

- **Whether the base locale is right.** `en-GB` and `en-US` are different catalogs and the
  choice is not reversible by editing config. Confirm it with the user.
- **Whether the right primitive was chosen.** Neither tool can see a block that should have
  been one kept-whole sentence. Only the registered phrase set shows that — see
  [verify.md](./verify.md).
- **Whether anything is actually registering.** That is the server's per-session decision —
  [projects-and-keys.md](./projects-and-keys.md).
- **Which side owns which content** in a project with two SDKs — [two-languages.md](./two-languages.md).

**A clean `doctor` run is not a verified integration.** It checks configuration, not content.

## Re-running the installer

```bash
npx langsys-skill install              # this project
npx langsys-skill install --global     # every project, into your home directory
npx langsys-skill install --dry-run    # show what would change, write nothing
```

It copies this entry skill plus the skill of every Langsys package the project has installed,
into the skill folders of the agents it detects. Skills are **copied, not linked**, so an SDK
upgrade never silently rewrites one — which is exactly why `doctor` reports a stale copy, and
why re-running the installer is the fix.
