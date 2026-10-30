#!/usr/bin/env node
/**
 * skill-contract — the two obligations this package owes the SDK skills.
 *
 * The skill set is a tree whose nodes ship in different repos and release on
 * different days. Two things therefore cross a repo boundary and can only be
 * checked from here, because only this package holds the source of both:
 *
 *   1. THE SHARED OPENING. Every core and child skill opens with the block in
 *      src/skill/preamble.md, copied between the markers. A copy that drifts
 *      sends agents up the wrong tree, or nowhere.
 *
 *   2. INBOUND LINKS. An SDK skill links into this payload by URL
 *      (https://docs.langsys.dev/skill/langsys/<path>), which Docs serves from
 *      src/skill/** byte for byte. So a rename HERE breaks a link in a package
 *      that is already PUBLISHED and cannot be edited. The link check has to
 *      run before the rename ships, not after.
 *
 * Direction matters. Check 1 asks whether their copy matches our source; check 2
 * asks whether our tree still satisfies their links. A rename is legal only if
 * no published skill links to the old name.
 *
 * Usage: node skill-contract.mjs [--json]
 * Exit:  0 all satisfied, 1 a violation, 2 nothing to check.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..', '..');
const PAYLOAD = join(pkgRoot, 'src', 'skill');
const MARK_START = '<!-- langsys-skill-preamble:start -->';
const MARK_END = '<!-- langsys-skill-preamble:end -->';
const DOCS_PREFIX = 'https://docs.langsys.dev/skill/langsys/';

/**
 * The canonical block, markers included.
 *
 * Read from the payload rather than inlined here: the source of truth has to be
 * the file Docs serves, or this check would pass while readers saw something
 * else.
 */
export function canonicalPreamble(text) {
    const a = text.indexOf(MARK_START);
    const b = text.indexOf(MARK_END);
    if (a === -1 || b === -1 || b < a) return null;
    return text.slice(a, b + MARK_END.length);
}

/**
 * Pull payload-relative paths out of docs URLs found in arbitrary prose.
 *
 * Trailing punctuation is the whole difficulty. The preamble itself ends a
 * sentence with the bare root URL, so a greedy character class captures
 * ".../langsys/." and the check then looks for a file named ".". Strip the
 * punctuation that cannot begin a path segment, and treat the root as SKILL.md.
 *
 * Markdown link syntax puts the URL in parentheses, so `)` has to go too — and
 * `>` for an autolink. Exported for the suite, which asserts each of these
 * shapes resolves to the same path.
 */
export function docsLinkPaths(text) {
    const out = [];
    const re = new RegExp(DOCS_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^\\s)>\\]"\'`]*)', 'g');
    for (const m of text.matchAll(re)) {
        let p = m[1].replace(/[.,;:!?)>\]]+$/, '');
        out.push(p === '' ? 'SKILL.md' : p);
    }
    return out;
}

/**
 * What a payload-relative path from an SDK skill actually resolves to.
 *
 * `'file'` is the good case. `'dir'` is served — Docs generates an index per
 * directory — but a link should name its page, so it is reported rather than
 * failed. `'missing'` is a violation.
 *
 * Whether `'dir'` fails depends on the MODE, because the mode says whether the
 * link can still be fixed:
 *
 *   --source=<dir>   an SDK lane checking its own skill BEFORE it releases. The
 *                    link is theirs and the release has not happened, so the
 *                    gate should make it: a directory link FAILS.
 *   aggregate        a sweep over packages that are already published and
 *                    cannot be edited. Docs generates a per-directory index, so
 *                    the link resolves; failing here would block a release over
 *                    something already backstopped. REPORTED instead.
 *
 * A missing path is a violation in both modes — nothing backstops that.
 *
 * The payload root is a file case, not a directory one: `.../skill/langsys/` is
 * the entry skill's canonical URL and resolves to its SKILL.md.
 */
function payloadResolves(p) {
    const abs = join(PAYLOAD, p);
    if (!abs.startsWith(PAYLOAD)) return 'missing';      // no escaping the payload
    if (existsSync(abs)) return statSync(abs).isFile() ? 'file' : 'dir';
    return 'missing';
}

/** Every file under a directory, recursively. */
function walk(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

/**
 * Where an SDK's skill can be found.
 *
 * Sibling working trees come first and are the point today: the TypeScript core
 * skill is unreleased, so the only copy that exists is a working tree, and that
 * is exactly when a link check is still cheap to act on. Installed packages are
 * also scanned, so the same command works in a consumer's project after
 * release.
 */
function sources(explicit = []) {
    const found = [];
    const add = (label, dir) => {
        if (existsSync(dir) && statSync(dir).isDirectory() && existsSync(join(dir, 'SKILL.md'))) {
            found.push({ label, dir });
        }
    };

    // `--source=<dir>` checks exactly the directories named and nothing else.
    //
    // Two callers want this. An SDK's own release gate needs to ask "does MY
    // skill satisfy the published entry skill?" without its answer depending on
    // whatever else happens to be checked out next door. And this repo's suite
    // needs the same isolation for the opposite reason: aggregating over sibling
    // working trees makes THIS repo's tests fail for a drift in ANOTHER repo,
    // which is a failure nobody here can act on.
    if (explicit.length) {
        for (const d of explicit) add(`${d} (--source)`, resolve(d));
        return found;
    }

    const siblings = resolve(pkgRoot, '..');
    if (existsSync(siblings)) {
        for (const e of readdirSync(siblings, { withFileTypes: true })) {
            if (!e.isDirectory() || !/^langsys/.test(e.name)) continue;
            if (resolve(siblings, e.name) === pkgRoot) continue;
            add(`${e.name} (working tree)`, join(siblings, e.name, 'skill'));
        }
    }

    const nm = join(pkgRoot, 'node_modules');
    if (existsSync(nm)) {
        for (const e of readdirSync(nm, { withFileTypes: true })) {
            if (e.isDirectory() && /^langsys/.test(e.name)) {
                add(`${e.name} (installed)`, join(nm, e.name, 'skill'));
            }
        }
    }

    const vendor = join(pkgRoot, 'vendor', 'langsys');
    if (existsSync(vendor)) {
        for (const e of readdirSync(vendor, { withFileTypes: true })) {
            if (e.isDirectory()) add(`langsys/${e.name} (installed)`, join(vendor, e.name, 'skill'));
        }
    }

    return found;
}

// ── run ──────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
    const asJson = process.argv.includes('--json');
    const explicit = process.argv.filter((a) => a.startsWith('--source='))
        .map((a) => a.slice('--source='.length));
    const violations = [];
    const notes = [];

    const sourceFile = join(PAYLOAD, 'preamble.md');
    if (!existsSync(sourceFile)) {
        console.error(`skill-contract: ${relative(pkgRoot, sourceFile)} is missing — it is the source of the shared opening.`);
        process.exit(1);
    }
    const canonical = canonicalPreamble(readFileSync(sourceFile, 'utf8'));
    if (!canonical) {
        console.error(`skill-contract: ${relative(pkgRoot, sourceFile)} has no ${MARK_START} … ${MARK_END} block.`);
        process.exit(1);
    }

    const skills = sources(explicit);
    // An explicit --source means a lane is gating its OWN skill before release.
    const preRelease = explicit.length > 0;

    for (const s of skills) {
        // Check 1 — the shared opening.
        const entry = join(s.dir, 'SKILL.md');
        const got = canonicalPreamble(readFileSync(entry, 'utf8'));
        if (got === null) {
            violations.push(`${s.label}: SKILL.md carries no preamble block. Insert the block from src/skill/preamble.md, markers included.`);
        } else if (got !== canonical) {
            violations.push(`${s.label}: the preamble block differs from this package's source. Replace it with the block from src/skill/preamble.md.`);
        } else {
            notes.push(`${s.label}: preamble matches`);
        }

        // Check 2 — inbound links into this payload.
        let links = 0;
        for (const f of walk(s.dir)) {
            let text;
            try { text = readFileSync(f, 'utf8'); } catch { continue; }
            for (const p of docsLinkPaths(text)) {
                links++;
                const kind = payloadResolves(p);
                if (kind === 'missing') {
                    violations.push(`${s.label}: ${relative(s.dir, f)} links to ${DOCS_PREFIX}${p}, which does not exist in src/skill/. Keep that path, or get the link changed before it is published.`);
                } else if (kind === 'dir') {
                    const msg = `${s.label}: ${relative(s.dir, f)} links to ${DOCS_PREFIX}${p}, a DIRECTORY. On disk that lists; over HTTP it dead-ends. Name the page it means.`;
                    if (preRelease) {
                        violations.push(`${msg} This is your own skill and it has not shipped yet, so fix it here.`);
                    } else {
                        notes.push(`${msg} Docs generates an index for it, so it resolves — but worth raising with that lane.`);
                    }
                }
            }
        }
        notes.push(`${s.label}: ${links} link(s) into this payload, all resolving`);
    }

    // "Nothing to check" is decided BEFORE the output format, not inside one
    // branch of it. It used to live only in the human-readable path, so the JSON
    // form exited 0 on zero sources — handing any automation reading it exactly
    // the green-run-that-verified-nothing this check exists to prevent, and
    // contradicting the exit code this file's own header documents.
    const nothingChecked = skills.length === 0;

    if (asJson) {
        console.log(JSON.stringify({
            sources: skills.map((s) => s.label),
            nothingChecked,
            violations,
            notes,
        }, null, 2));
        process.exit(nothingChecked ? 2 : (violations.length > 0 ? 1 : 0));
    } else {
        console.log('\nskill-contract — the shared opening, and links into this payload\n');
        if (nothingChecked) {
            console.log('  No SDK skills found to check.');
            console.log('  Looked in: sibling working trees ../langsys*/skill/, ./node_modules/langsys*/skill/,');
            console.log('             ./vendor/langsys/*/skill/');
            console.log('\n  This is NOT a pass. Nothing was verified, so a rename here could still be');
            console.log('  breaking a link in a published SDK skill. Run it where the skills are.\n');
            process.exit(2);
        }
        for (const s of skills) console.log(`  · ${s.label}`);
        console.log();
        for (const n of notes) console.log(`  ✓ ${n}`);
        for (const v of violations) console.log(`  ✗ ${v}`);
        console.log(`\n${violations.length} violation(s) across ${skills.length} skill(s).`);
        if (violations.length) {
            console.log('\nA link violation is the urgent one: a published SDK skill cannot be edited,');
            console.log('so this package keeps the path.\n');
        }
    }

    process.exit(violations.length > 0 ? 1 : 0);
}
