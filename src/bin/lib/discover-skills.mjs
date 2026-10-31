/**
 * Find the skills that ship inside the Langsys packages a project installed.
 *
 * Each SDK carries its own skill in `skill/`, declaring in frontmatter which
 * package and version it describes. The installer copies those; doctor compares
 * each copy against what is installed now. Both need the same discovery, so it
 * lives here rather than in either.
 *
 * Two properties are deliberate:
 *
 * 1. NESTED COPIES ARE REPORTED, NOT HIDDEN. npm satisfies a binding's own
 *    dependency range with a nested copy, so a project can hold two versions of
 *    one core — React pins `^0.6.5` and cannot accept 0.7. If both ship a skill,
 *    the shallowest wins and the other is returned as a conflict, because that
 *    situation is a real hazard in the project and not a quirk of this tool:
 *    the two copies are separate module instances with separate catalogs.
 *
 * 2. DISCOVERY IS BY LAYOUT, NOT BY A HARDCODED LIST. A new binding ships a
 *    skill without this file changing. The cost is that anything named
 *    `langsys*` with a `skill/SKILL.md` is picked up, which is the right trade:
 *    a missing skill is silent, an unexpected one is visible.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Minimal frontmatter read: the four keys a skill is required to declare. */
export function readSkillHead(text) {
    if (!text.startsWith('---')) return null;
    const end = text.indexOf('\n---', 3);
    if (end === -1) return null;
    const head = text.slice(3, end);
    const one = (re) => head.match(re)?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? null;
    return {
        name: one(/^name:\s*(.+)$/m),
        package: one(/^\s{2,}package:\s*(.+)$/m),
        version: one(/^\s{2,}version:\s*(.+)$/m),
    };
}

/**
 * What Composer actually installed, keyed by package name.
 *
 * A Composer package in `vendor/` has NO `version` in its own composer.json —
 * declaring one there is discouraged, and langsys/langsys-php does not. Composer
 * resolves the version at install time and records it in
 * `vendor/composer/installed.json`, so that file is the only place the installed
 * version exists. Without reading it there is nothing to compare a copied skill
 * against, and doctor cannot tell a stale PHP skill from a current one — which
 * is the single thing it is there for.
 *
 * Two shapes are read because a project's Composer era is not ours to choose:
 * Composer 2 writes `{ packages: [...] }`, Composer 1 wrote a bare array.
 *
 * The recorded version is the git TAG, so it arrives with Composer's `v` prefix
 * (`v2.0.1`) while a skill's frontmatter declares bare semver (`2.0.1`). Strip
 * it here: every version doctor prints is bare, and an operator comparing the
 * two by eye is the actual consumer of this string.
 */
export function composerInstalledVersions(projectRoot) {
    const out = new Map();
    const p = join(projectRoot, 'vendor', 'composer', 'installed.json');
    if (!existsSync(p)) return out;
    let parsed;
    try { parsed = JSON.parse(readFileSync(p, 'utf8')); } catch { return out; }
    const packages = Array.isArray(parsed) ? parsed : parsed?.packages;
    if (!Array.isArray(packages)) return out;
    for (const entry of packages) {
        if (typeof entry?.name !== 'string' || typeof entry?.version !== 'string') continue;
        out.set(entry.name.toLowerCase(), entry.version.replace(/^v(?=\d)/, ''));
    }
    return out;
}

function readOne(dir, origin, recordedVersion = null) {
    const entry = join(dir, 'skill', 'SKILL.md');
    if (!existsSync(entry)) return null;
    let head;
    try { head = readSkillHead(readFileSync(entry, 'utf8')); } catch { return null; }
    if (!head?.name) return null;
    // A version Composer recorded wins over anything the package declares about
    // itself: it is what resolution settled on, and a package that declares its
    // own version can disagree with what is on disk.
    let installed = recordedVersion;
    if (!installed) {
        for (const manifest of ['package.json', 'composer.json']) {
            const p = join(dir, manifest);
            if (!existsSync(p)) continue;
            try { installed = JSON.parse(readFileSync(p, 'utf8')).version ?? null; } catch { /* unreadable */ }
            if (installed) break;
        }
    }
    return {
        name: head.name,
        package: head.package,
        declares: head.version,     // the version the SKILL says it describes
        installed,                  // the version actually present, where the manifest says
        dir: join(dir, 'skill'),
        origin,
    };
}

/**
 * Walk node_modules for `langsys*` and `@langsys/*`, following nested
 * node_modules. Depth is bounded: a nested chain deeper than this is not a
 * layout npm produces for these packages, and an unbounded walk of a large
 * node_modules is slow enough to matter in an installer.
 */
function walkNodeModules(nm, out, depth = 0) {
    if (depth > 3 || !existsSync(nm)) return;
    let entries;
    try { entries = readdirSync(nm, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (!e.isDirectory() && !e.isSymbolicLink()) continue;
        if (e.name === '.bin') continue;
        const p = join(nm, e.name);
        if (e.name === '@langsys') {
            let scoped;
            try { scoped = readdirSync(p, { withFileTypes: true }); } catch { continue; }
            for (const s of scoped) {
                const sp = join(p, s.name);
                const found = readOne(sp, `@langsys/${s.name}`);
                if (found) out.push({ ...found, depth });
                walkNodeModules(join(sp, 'node_modules'), out, depth + 1);
            }
            continue;
        }
        if (!/^langsys/.test(e.name)) continue;
        const found = readOne(p, e.name);
        if (found) out.push({ ...found, depth });
        walkNodeModules(join(p, 'node_modules'), out, depth + 1);
    }
}

/**
 * @returns {{ skills: object[], conflicts: object[] }}
 *   skills    one per skill name, the shallowest copy of each
 *   conflicts deeper copies of a name already chosen — a second version present
 */
export function discoverSkills(projectRoot) {
    const all = [];

    walkNodeModules(join(projectRoot, 'node_modules'), all);

    const vendor = join(projectRoot, 'vendor', 'langsys');
    if (existsSync(vendor)) {
        const recorded = composerInstalledVersions(projectRoot);
        let entries = [];
        try { entries = readdirSync(vendor, { withFileTypes: true }); } catch { /* unreadable */ }
        for (const e of entries) {
            if (!e.isDirectory() && !e.isSymbolicLink()) continue;
            const name = `langsys/${e.name}`;
            const found = readOne(join(vendor, e.name), name, recorded.get(name.toLowerCase()) ?? null);
            if (found) all.push({ ...found, depth: 0 });
        }
    }

    all.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

    const skills = [];
    const conflicts = [];
    const seen = new Map();
    for (const s of all) {
        if (seen.has(s.name)) {
            const chosen = seen.get(s.name);
            // Same version nested under its own parent is just npm's layout; a
            // DIFFERENT version is the hazard worth naming.
            if (s.installed !== chosen.installed) conflicts.push({ ...s, shadowedBy: chosen });
            continue;
        }
        seen.set(s.name, s);
        skills.push(s);
    }
    return { skills, conflicts };
}

/** Every file under a directory, as paths relative to it. */
export function filesUnder(dir, base = dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) filesUnder(p, base, out);
        else if (statSync(p).isFile()) out.push(p.slice(base.length + 1));
    }
    return out;
}
