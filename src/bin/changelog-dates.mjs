#!/usr/bin/env node
/**
 * changelog-dates — check CHANGELOG dates against the registry's publish record.
 *
 * Companion to changelog-coverage.mjs. Coverage asks "is this release documented
 * at all"; this asks "is the date right". Standalone and dependency-free so all
 * repos run ONE implementation — four repos inventing four variants is how a
 * boundary rule gets dropped in one of them.
 *
 * WHY DATES SPECIFICALLY. An audit across three repos found four wrong dates in
 * each. The instructive part: in one repo, two of the four were in entries
 * reconstructed two days earlier, where the CONTENT was taken from commit bodies
 * and verified — and the DATE was inferred from "this probably followed 3.0.0
 * closely". The releases actually shipped three and five weeks later.
 *
 * So the lesson is not "reconstructed entries are unreliable". It is:
 *
 *   VERIFICATION EFFORT TRACKS HOW CONSEQUENTIAL A FIELD FEELS, NOT HOW
 *   CHECKABLE IT IS — and a date loses on both counts.
 *
 * That is an argument for a decidable check rather than for being more careful,
 * and it predicts where to look next: any field that is cheap to verify and
 * boring enough that nobody does. Package names in install snippets, minimum
 * runtime versions, and repository URLs all have that shape.
 *
 * ── DESIGN: RUN THIS ON A SCHEDULE, NOT PER-PUSH ────────────────────────────
 *
 * Two reasons, both raised by repos wiring it up:
 *   1. It needs registry network access in jobs that otherwise need none.
 *   2. Release flows that publish AFTER pushing would fail spuriously on the
 *      just-released version.
 *
 * The defect is silent and slow, so per-push adds a network dependency and a
 * publish race for no detection benefit. Nightly or weekly catches it just as
 * well.
 *
 * Reason 2 is ALSO handled structurally, not just by scheduling: a version with
 * no publish record is SKIPPED rather than failed. So the check stays correct
 * even if someone wires it per-push anyway — which someone eventually will.
 *
 * SCOPE: npm registry only. The PHP SDK is distributed via Packagist and is not
 * covered; that needs a Packagist variant rather than a pretended result here.
 *
 * Usage: node changelog-dates.mjs [repoDir] [--strict] [--package=name]
 * Exit:  0 clean or report-only; 1 mismatches with --strict.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const repo = resolve(args.find((a) => !a.startsWith('--')) ?? process.cwd());
const strict = args.includes('--strict');
const pkgOverride = args.find((a) => a.startsWith('--package='))?.split('=')[1];

/** Publish and changelog dates can straddle midnight in different zones. */
const TOLERANCE_DAYS = 1;

const changelog = ['CHANGELOG.md', 'changelog.md'].map((f) => join(repo, f)).find(existsSync);
if (!changelog) {
    console.log(`changelog-dates: no CHANGELOG in ${repo}`);
    process.exit(0);
}

const pkgJson = join(repo, 'package.json');
const pkgName = pkgOverride
    ?? (existsSync(pkgJson) ? JSON.parse(readFileSync(pkgJson, 'utf8')).name : null);

if (!pkgName) {
    console.log('changelog-dates: no package.json name and no --package= given (PHP/Packagist is out of scope)');
    process.exit(0);
}

let published;
try {
    published = JSON.parse(execFileSync('npm', ['view', pkgName, 'time', '--json'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }));
} catch {
    console.log(`changelog-dates: could not read the publish record for ${pkgName} (offline, or never published)`);
    process.exit(0);
}

// `## 1.2.3 - 2026-06-05`, `## [1.2.3] — 2026-06-05`, `### v1.2.3 (2026-06-05)`
const entries = [...readFileSync(changelog, 'utf8')
    .matchAll(/^#{1,4}\s.*?(\d+\.\d+\.\d+).*?(\d{4}-\d{2}-\d{2})/gm)]
    .map((m) => ({ version: m[1], dated: m[2] }));

if (entries.length === 0) {
    // Distinguish "no releases documented" from "releases documented WITHOUT
    // dates". The second is a finding, not a clean result: an absent date is
    // simply the unverified-field problem one step earlier, and reporting it as
    // "nothing to check" would be its own small vacuous pass.
    const undated = [...readFileSync(changelog, 'utf8')
        .matchAll(/^#{1,4}\s.*?(\d+\.\d+\.\d+)/gm)].map((m) => m[1]);

    if (undated.length > 0) {
        console.log(`\nchangelog-dates: ${pkgName} — ${undated.length} version heading(s), NONE carrying a date\n`);
        console.log('  Not a failure, but nothing here can be verified against the registry.');
        console.log('  Dates are cheap to add and cheap to check; undated entries are the');
        console.log('  same unverified-field problem one step earlier.\n');
        console.log(`  Registry has publish times for: ${Object.keys(published).filter((k) => /^\d+\.\d+\.\d+$/.test(k)).length} version(s).`);
        process.exit(0);
    }

    console.log('changelog-dates: no version headings found — nothing to check');
    process.exit(0);
}

const dayDiff = (a, b) => Math.round(Math.abs(new Date(a) - new Date(b)) / 86400000);

const mismatches = [];
let checked = 0, skipped = 0;

for (const { version, dated } of entries) {
    const record = published[version];
    // No publish record → not released yet. SKIP, never fail: this is what makes
    // the check safe to run immediately after a push but before a publish.
    if (!record) { skipped++; continue; }
    checked++;
    const actual = record.slice(0, 10);
    const off = dayDiff(dated, actual);
    if (off > TOLERANCE_DAYS) mismatches.push({ version, dated, actual, off });
}

console.log(`\nchangelog-dates: ${pkgName} — ${checked} dated entr${checked === 1 ? 'y' : 'ies'} checked` +
            `${skipped ? `, ${skipped} skipped (not published yet)` : ''}\n`);

if (mismatches.length === 0) {
    console.log('  all dates match the registry publish record');
    process.exit(0);
}

for (const m of mismatches) {
    console.log(`  ✗ ${m.version}  changelog says ${m.dated}, npm published ${m.actual}  (${m.off} days off)`);
}
console.log(`
  npm's publish record is the decidable artifact. Commit dates are the tempting
  wrong one — they are what you are already reading while writing the entry.
`);
process.exit(strict ? 1 : 0);
