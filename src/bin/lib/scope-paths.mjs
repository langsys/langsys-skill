/**
 * Rewrite embedded TOOL paths for the scope an install is targeting.
 *
 * A global install puts the payload under `$HOME/.langsys/`, so a project-
 * relative `node .langsys/bin/doctor.mjs` resolves against the project working
 * directory and does not exist. The agent's first instruction then fails with
 * "Cannot find module" while every documentation link beside it resolves
 * correctly — docs right, tools wrong.
 *
 * Covers `bin` AND `lint`: `verify.md` runs ast-grep out of `.langsys/lint/`,
 * and an earlier version matched only `bin`, so a global install routed the
 * agent to a document whose one executable command pointed nowhere.
 *
 * Both spellings are matched: the direct `.langsys/bin/…`, and the
 * `.langsys/skill/../bin/…` form the payload uses to reach a sibling directory.
 *
 * IDEMPOTENT, by the lookbehind. This matters more than it appears: `claude()`
 * rewrites documentation links to `~/.langsys/skill/…` BEFORE calling this, so
 * the moment a payload link points into `bin/`, an unguarded pattern produces
 * `~/~/.langsys/…`. The guard also blocks `../../../` prefixes from being
 * pasted onto an absolute path. Neither form occurs in today's inputs, which is
 * exactly why it needs a unit test rather than an assertion on installed output
 * — nothing observable would change until the day it did.
 *
 * Extracted from install.mjs so the latent cases are testable at all; a script
 * cannot be imported without running it.
 */
const SCOPED_PATH = /(?<![\w~./-])\.langsys\/(?:skill\/\.\.\/)?(bin|lint)\b/g;

export function scopePaths(text, isGlobal) {
    const base = isGlobal ? '~/.langsys' : '.langsys';
    return text.replace(SCOPED_PATH, (_m, dir) => `${base}/${dir}`);
}
