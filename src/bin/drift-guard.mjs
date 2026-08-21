#!/usr/bin/env node
/**
 * Drift guard — re-checks the claims in VERIFIED.md against PUBLISHED artifacts.
 *
 * Two lessons are baked into how this works:
 *
 * 1. CHECK ALL THREE DOC SURFACES. Two of the Svelte binding's three known
 *    defects lived outside markdown — a JSDoc block and a type-declaration
 *    header — so a README-only grep would have caught one of three and missed
 *    the two that IDE hover actually shows developers.
 *
 * 2. ENUMERATE EXPORTS FIRST, THEN ASK WHETHER THE DOCS AGREE. Starting from the
 *    docs and asking "do these look complete?" is unfalsifiable by construction.
 *
 * Reports both regressions (a verified claim stopped holding) and resolutions
 * (a recorded defect got fixed), so VERIFIED.md never accumulates stale entries.
 *
 * Usage: node drift-guard.mjs [--offline]
 * Exit: 0 no regressions, 1 regressions found.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { selfDescribesUnreleased } from './lib/changelog-heading.mjs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Classify `Based on {n}` hits into real defects vs. correct mentions.
 *
 * The bare pattern cannot tell three cases apart, and two of them are correct:
 *
 *   1. `<Phrase>Based on {n} <strong>reviews</strong></Phrase>`   THE DEFECT.
 *      `{n}` in SOURCE MARKUP — the compiler substitutes before Langsys sees it.
 *   2. `"Based on {n} {m0o}reviews{m0c}"`                          CORRECT.
 *      An ENCODED PHRASE STRING. `normalizeMarkupPlaceholders` turns `%n%` into
 *      `{n}` on the way in, so `{n}` here is what a RIGHT integration stores.
 *   3. prose warning against writing `{n}`                         CORRECT.
 *
 * Case 2 is why position alone is not enough: an encoded phrase legitimately
 * appears inside a fenced block. The discriminator is the markup token
 * `{m0o}`/`{m0c}`, which exists ONLY in encoded phrases and never in source
 * markup — a property of the SDK's encoder, not a guess about prose style.
 *
 * Then the documented tiering applies: fenced -> defect, prose -> mention.
 * Demote, never drop; a false negative in a drift guard is a green run that
 * checked nothing.
 *
 * Better docs made the old pattern fire: the Svelte SDK's 3.6.6 README discusses
 * `{n}` more than 3.6.3 did, precisely to warn about it, and a resolved defect
 * started reading as reopened. A guard that penalises a doc for explaining the
 * trap gets ignored, and an ignored guard is worse than none.
 */
export function bracePlaceholderHits(surfaces) {
    const out = { defects: [], mentions: [] };
    for (const s of surfaces) {
        let inFence = false;
        s.text.split('\n').forEach((line, i) => {
            if (/^\s*```/.test(line)) { inFence = !inFence; return; }
            if (!/Based on \{n\}/.test(line)) return;
            if (/\{m\d+[oc]\}/.test(line)) return;          // encoded phrase — correct
            (inFence ? out.defects : out.mentions).push(`${s.label}:${i + 1}`);
        });
    }
    return out;
}

// ── Executable body ─────────────────────────────────────────────────────────
//
// Everything below runs only when this file is invoked directly. The helper
// above is pure and exported so the suite can exercise it in both directions.
// Importing a SCRIPT runs it: the first attempt at this silently replaced the
// whole test suite with a single drift-guard run, and the suite still reported
// green. A module that cannot be imported without side effects cannot be
// unit-tested, and an untestable classifier is precisely what this guard exists
// to stop shipping.

if (import.meta.url === `file://${process.argv[1]}`) {

    const PACKAGES = [
        'langsys-js-typescript',
        'langsys-js-react',
        'langsys-js-svelte',
        'langsys-js-vue',
    ];

    const regressions = [];
    const resolutions = [];
    const notes = [];
    // Matches demoted by position rather than dropped — auditable, non-failing.
    const suppressed = [];

    function fetchPackage(name, dir) {
        try {
            const out = execFileSync('npm', ['pack', name, '--silent', '--pack-destination', dir],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop();
            const tgz = join(dir, out);
            const dest = join(dir, name);
            execFileSync('mkdir', ['-p', dest]);
            execFileSync('tar', ['xzf', tgz, '-C', dest]);
            return join(dest, 'package');
        } catch {
            return null;
        }
    }

    /** Read every doc surface a developer might encounter. */
    function docSurfaces(pkgDir) {
        const surfaces = [];
        const add = (label, p) => { if (existsSync(p)) surfaces.push({ label, text: readFileSync(p, 'utf8') }); };

        add('README', join(pkgDir, 'README.md'));
        add('CHANGELOG', join(pkgDir, 'CHANGELOG.md'));

        const distDir = join(pkgDir, 'dist');
        if (existsSync(distDir)) {
            const walk = (d) => {
                for (const e of readdirSync(d, { withFileTypes: true })) {
                    const p = join(d, e.name);
                    if (e.isDirectory()) walk(p);
                    // .d.ts carries declaration headers; component sources carry JSDoc.
                    else if (/\.(d\.ts|svelte|mjs|js)$/.test(e.name)) {
                        add(`dist/${e.name}`, p);
                    }
                }
            };
            walk(distDir);
        }
        return surfaces;
    }

    const dir = mkdtempSync(join(tmpdir(), 'langsys-drift-'));
    const pkgs = {};
    for (const name of PACKAGES) {
        const p = fetchPackage(name, dir);
        if (!p) { notes.push(`could not fetch ${name} — offline?`); continue; }
        pkgs[name] = { dir: p, version: JSON.parse(readFileSync(join(p, 'package.json'), 'utf8')).version };
    }

    if (Object.keys(pkgs).length === 0) {
        console.log('drift-guard: no packages fetched (offline). Skipping.');
        process.exit(0);
    }

    // ── Claim 1: t() argument order ──────────────────────────────────────────────

    {
        const p = pkgs['langsys-js-typescript'];
        if (p) {
            const dts = readFileSync(join(p.dir, 'dist/index.d.ts'), 'utf8');
            if (!/\(phrase: P, \.\.\.args|\(phrase: P, category: string/.test(dts)) {
                regressions.push(`t() signature changed in ${p.version} — VERIFIED.md claim 1 and every track assume t(phrase, category?, params?)`);
            }
        }
    }

    // ── Claim 2: apiUrl is not a config field ────────────────────────────────────

    {
        const p = pkgs['langsys-js-typescript'];
        if (p) {
            const dts = readFileSync(join(p.dir, 'dist/index.d.ts'), 'utf8');
            if (/apiUrl/.test(dts)) {
                resolutions.push(`apiUrl now EXISTS in langsys-js-typescript@${p.version} — update core/init-config.md, integrate/vue.md, and the no-init-apiurl lint rule`);
            }
        }
    }

    // ── Claim 4: unmatched-params warning floor ──────────────────────────────────

    {
        const p = pkgs['langsys-js-typescript'];
        if (p) {
            const mjs = existsSync(join(p.dir, 'dist/index.mjs')) ? readFileSync(join(p.dir, 'dist/index.mjs'), 'utf8') : '';
            if (!/warnUnmatchedParams/.test(mjs)) {
                regressions.push(`warnUnmatchedParams absent from langsys-js-typescript@${p.version} — verify.md step 3a and doctor's >=0.4.3 gate assume it exists`);
            }
        }
    }

    // ── Claim 5: component parity across all three bindings ──────────────────────

    for (const name of ['langsys-js-react', 'langsys-js-svelte', 'langsys-js-vue']) {
        const p = pkgs[name];
        if (!p) continue;
        const dts = existsSync(join(p.dir, 'dist/index.d.ts')) ? readFileSync(join(p.dir, 'dist/index.d.ts'), 'utf8') : '';
        for (const comp of ['Translate', 'Phrase', 'DontTranslate']) {
            if (!new RegExp(`\\b${comp}\\b`).test(dts)) {
                regressions.push(`${name}@${p.version} no longer exports ${comp} — choosing-primitives.md claims full parity`);
            }
        }
    }

    // ── Recorded defects: are they still present? ────────────────────────────────

    const DEFECTS = [
        {
            id: 'B — Svelte <Phrase> doc example uses {n}',
            pkg: 'langsys-js-svelte',
            // Present in a JSDoc block inside a .svelte file: NOT findable in the README.
            classify: bracePlaceholderHits,
        },
        {
            id: 'C — Vue <Phrase> doc example uses {n}',
            pkg: 'langsys-js-vue',
            classify: bracePlaceholderHits,
        },
        {
            id: 'D — Svelte declaration header omits Phrase/DontTranslate',
            pkg: 'langsys-js-svelte',
            test: (surfaces) => {
                const hdr = surfaces.find((s) => s.label === 'dist/index.d.ts');
                if (!hdr) return false;
                const summary = hdr.text.slice(0, hdr.text.indexOf('import'));
                // Match only DOCUMENTED EXPORT BULLETS (` *   - \`Name\``), not any
                // occurrence of the word. The header contains `{$t('Phrase','Cat')}`
                // as an unrelated usage example, and a bare /Phrase/ test matched it
                // — reporting a live defect as fixed, the worst possible failure for
                // a drift guard.
                const bullets = [...summary.matchAll(/^\s*\*\s+-\s+`([A-Za-z]+)`/gm)].map((m) => m[1]);
                return bullets.includes('Translate') && !bullets.includes('Phrase');
            },
        },
        {
            id: 'Vue README documents apiUrl on init()',
            pkg: 'langsys-js-vue',
            test: (surfaces) => surfaces.some((s) => s.label === 'README' && /init\(\{[^}]*apiUrl/s.test(s.text)),
        },
        {
            id: 'Svelte README claims Dates serialize to ISO 8601',
            pkg: 'langsys-js-svelte',
            // "previously ISO 8601" / "was ISO 8601" is CORRECT prose describing the
            // change. Only an unqualified claim is the defect — React's README says
            // the former and a naive /ISO 8601/ test flagged it wrongly.
            test: (surfaces) => surfaces.some((s) =>
                s.label === 'README' &&
                /ISO 8601/.test(s.text) &&
                !/(previously|formerly|was|before \S+)\s+ISO 8601/i.test(s.text)),
        },
    ];

    for (const d of DEFECTS) {
        const p = pkgs[d.pkg];
        if (!p) continue;
        const surfaces = docSurfaces(p.dir);

        if (d.classify) {
            const { defects, mentions } = d.classify(surfaces);
            for (const w of mentions) {
                suppressed.push(`${d.pkg}/${w} mentions \`Based on {n}\` outside a code block — likely a warning ABOUT the trap; confirm it is not an example to copy`);
            }
            if (defects.length) notes.push(`still open in ${d.pkg}@${p.version}: ${d.id} (${defects.join(', ')})`);
            else resolutions.push(`FIXED in ${d.pkg}@${p.version}: ${d.id} — mark resolved in VERIFIED.md`);
            continue;
        }

        const stillThere = d.test(surfaces);
        if (stillThere) {
            notes.push(`still open in ${d.pkg}@${p.version}: ${d.id}`);
        } else {
            resolutions.push(`FIXED in ${d.pkg}@${p.version}: ${d.id} — mark resolved in VERIFIED.md`);
        }
    }

    // ── Agent-facing repo docs — the highest-consequence surface ─────────────────
    //
    // CLAUDE.md / AGENTS.md are not shipped in the tarball, so this checks sibling
    // working trees when they are present. Worth doing despite that, because it is
    // the surface where a wrong claim does the most damage: an agent treats these
    // files as authoritative AND has no user in the loop to sanity-check them, so a
    // stale line converts directly into wrong code with nothing in between.
    //
    // This is exactly how the "Svelte lacks <Phrase>" error entered this project.
    {
        const SIBLINGS = {
            'langsys-js-typescript': '../langsys-js-typescript',
            'langsys-js-react': '../langsys-js-react',
            'langsys-js-svelte': '../langsys-js-svelte',
            'langsys-js-vue': '../langsys-js-vue',
            'langsys-php': '../langsys-php',
        };

        for (const [name, rel] of Object.entries(SIBLINGS)) {
            // DOCUMENT CLASS decides whether a correctness check applies AT ALL.
            //
            // Some documents make PRESENT-TENSE claims — CLAUDE.md, AGENTS.md,
            // READMEs, API reference. Checking those for current correctness is
            // exactly right.
            //
            // Others deliberately PRESERVE SUPERSEDED TRUTH — changelogs, migration
            // guides, ADRs. A changelog entry for v0.1.0 documenting
            // `t(category, phrase)` is CORRECT: 0.1.0 really shipped that. Flagging
            // it is a category error, independent of how the check is implemented,
            // and any changelog covering a breaking API change necessarily contains
            // the superseded form.
            //
            // This is a second axis on top of "heuristics on detection, never on
            // suppression": before asking whether a claim is right, ask whether the
            // document is claiming anything about the present.
            const PRESENT_TENSE_DOCS = ['CLAUDE.md', 'AGENTS.md'];
            for (const docName of PRESENT_TENSE_DOCS) {
                const p = join(process.cwd(), rel, docName);
                if (!existsSync(p)) continue;
                const txt = readFileSync(p, 'utf8');

                // 1. Reversed t() signature — the single most-copied error, and one
                //    the base SDK's own CLAUDE.md carried for a long time.
                //
                // Report EVERY instance with its line number, not just the first.
                // A boolean .test() here missed a second occurrence in an invariants
                // section — the place most likely to be treated as normative, since
                // CLAUDE.md is PRESCRIPTIVE: a wrong signature there doesn't only
                // produce wrong calls, it can get the correct one "fixed" into the
                // wrong one by a future maintainer.
                //
                // The pattern must also match a bare generic signature
                // `<P extends string>(category, phrase: P, …)`, which has no `t(`
                // prefix — the other reason that second instance was invisible.
                // A doc that WARNS against the reversed order must spell it out, so a
                // naive grep flags the sentence that teaches the right thing. Without
                // handling that, the better a doc explains a trap, the more
                // regressions it appears to have — a perverse incentive.
                //
                // The first fix was a negation guard (`don't`/`never`/…) that DROPPED
                // matching lines. That was wrong for the reason this project keeps
                // relearning: it put a TEXT HEURISTIC on the SUPPRESSION side, where
                // failure is silent. Two ways it bit:
                //   - "t(category, phrase, params?) is not deprecated" — a real defect
                //     containing an unrelated negation, silently dropped.
                //   - a warning sentence followed by a fenced block showing the wrong
                //     form: no negation on the MATCHING line, so still a false positive.
                // A false positive costs a reader thirty seconds; a false negative in
                // a drift guard is a green run that checked nothing.
                //
                // So: decide by POSITION, and DEMOTE rather than drop.
                //   - inside a fenced code block  → regression. Code blocks are what
                //     people copy, and prose ABOUT the trap does not live there.
                //   - anywhere else (prose)       → suppressed tier: still reported,
                //     just not failing. Auditable instead of invisible.
                // Same spelling-to-position shift that fixed the `{ident}` rule.
                let inFence = false;
                txt.split('\n').forEach((line, i) => {
                    if (/^\s*```/.test(line)) { inFence = !inFence; return; }
                    if (!/\(\s*category\s*,\s*phrase\b/.test(line)) return;
                    const where = `${name}/${docName}:${i + 1}`;
                    if (inFence) {
                        regressions.push(`${where} shows (category, phrase) in a code block — the real signature is t(phrase, category?, params?)`);
                    } else {
                        suppressed.push(`${where} mentions (category, phrase) in prose — likely a warning ABOUT the reversal; confirm it is not asserting it`);
                    }
                });

                // NOTE: a "lists Translate but not Phrase" heuristic was tried here
                // and REMOVED. It fired on all five repos, and the hits were noise:
                // the PHP SDK has no Phrase component at all, and Svelte's mentions
                // are a filename in a directory tree plus the placeholder word in
                // `$t('Phrase', 'Cat')`. That is the same word-vs-API-listing
                // ambiguity that once made this guard report a live defect as fixed
                // — reintroduced in reverse.
                //
                // Five notes of which ~four are spurious trains a reader to ignore
                // the guard, which is the "a linter that fires on correct code gets
                // bypassed" failure applied to advisory output. Detecting a MISSING
                // mention is not reliably a text problem across differently
                // structured documents; the checks kept here assert the presence of
                // something specific and wrong, which is decidable.

                // 2. Stale exports. contentBlocks was removed after Svelte 3.0.0.
                if (name === 'langsys-js-svelte' && /\bcontentBlocks\b/.test(txt)) {
                    notes.push(`${name}/${docName}: references contentBlocks, removed after 3.0.0`);
                }
            }
        }
    }

    // ── Every released tag has a changelog section ───────────────────────────────
    //
    // The highest-leverage check here, and it exists because of a real incident:
    // langsys-js-typescript v0.2.0 flipped t(category, phrase) → t(phrase, category?)
    // — the most consequential API change in the package's history — and shipped with
    // NO changelog entry. The file jumped 0.1.0 → 0.2.1.
    //
    // The downstream damage is the point: no entry meant no prompt to update
    // CLAUDE.md, no prompt to update the README (not fixed until 0.5.0), and no
    // signal to this guard when it was written. The reversed signature I reported as
    // a defect was never a typo — it was correct when written and then stranded.
    //
    // So: a missing changelog entry is a doc defect that CAUSES other doc defects.
    // This check is fully decidable from `git tag` plus the heading list, and would
    // have caught that one many releases earlier.
    {
        const SIBLINGS = ['langsys-js-typescript', 'langsys-js-react',
                          'langsys-js-svelte', 'langsys-js-vue', 'langsys-php'];

        for (const name of SIBLINGS) {
            const repo = join(process.cwd(), '..', name);
            const changelog = join(repo, 'CHANGELOG.md');
            if (!existsSync(repo) || !existsSync(changelog)) continue;

            let tags = [];
            try {
                tags = execFileSync('git', ['-C', repo, 'tag'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
                    .split('\n').map((t) => t.trim()).filter((t) => /^v?\d+\.\d+\.\d+$/.test(t));
            } catch { continue; }
            if (tags.length === 0) continue;

            const text = readFileSync(changelog, 'utf8');
            // Any heading mentioning the version counts — formats vary across repos
            // (## [1.2.3], ## v1.2.3 — date, ### 1.2.3), so match the number itself.
            const documented = new Set(
                [...text.matchAll(/^#{1,4}\s.*?(\d+\.\d+\.\d+)/gm)].map((m) => m[1]));

            // A changelog may deliberately START at a point in history — Svelte's
            // begins at 1.2.1 while tags go back to 1.0.0. Reporting everything older
            // than the earliest entry is noise, and noise is what trains a reader to
            // ignore the tier. Only gaps INSIDE the covered range are defects, and
            // "newer than the earliest documented version" is decidable.
            const cmp = (a, b) => {
                const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
                for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
                return 0;
            };
            const earliest = [...documented].sort(cmp)[0];

            const missing = tags
                .map((t) => t.replace(/^v/, ''))
                .filter((v) => !documented.has(v))
                .filter((v) => !earliest || cmp(v, earliest) > 0);

            if (missing.length) {
                notes.push(`${name}: ${missing.length} released tag(s) with no CHANGELOG section — ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}. A missing entry is a doc defect that causes others: nothing prompts CLAUDE.md/README updates.`);
            } else {
                notes.push(`${name}: all ${tags.length} released tags have changelog sections`);
            }
        }
    }

    // ── CHANGELOG vs README disagreement (a cheap drift signature) ───────────────

    for (const [name, p] of Object.entries(pkgs)) {
        const surfaces = docSurfaces(p.dir);
        const readme = surfaces.find((s) => s.label === 'README')?.text ?? '';
        const changelog = surfaces.find((s) => s.label === 'CHANGELOG')?.text ?? '';
        const unqualifiedIso = /ISO 8601/.test(readme) && !/(previously|formerly|was|before \S+)\s+ISO 8601/i.test(readme);
        if (unqualifiedIso && /CLDR|Intl\.DateTimeFormat/.test(changelog)) {
            notes.push(`${name}@${p.version}: README says ISO 8601 while CHANGELOG documents CLDR — classic stale-README signature`);
        }
    }

    // ── A published artifact must not describe itself as unreleased ──────────────
    //
    // `langsys-js-vue@0.2.0` shipped `## 0.2.0 - unreleased` in its tarball while npm
    // served it as `latest`. The value was not wrong when written — dating an
    // unpublished version is the opposite error, and the author avoided it
    // deliberately. It became wrong at the instant of publication, with nothing
    // watching the boundary.
    //
    // This check exists because ENFORCEMENT MUST BE PROPORTIONAL TO REACH. Of the
    // four repos, Svelte also warns-and-continues on a missed stamp — and that is
    // correct there, because Svelte publishes only `dist/` and a missed stamp cannot
    // reach anyone. The condition is therefore "ships the file AND the shipped file
    // contradicts the registry", not "the script lacks a guard": keying on the
    // script would fire on Svelte, where there is nothing to fix.

    for (const [name, p] of Object.entries(pkgs)) {
        const changelog = docSurfaces(p.dir).find((s) => s.label === 'CHANGELOG');
        if (!changelog) continue;                       // not shipped → cannot reach a consumer
        const heading = selfDescribesUnreleased(p.version, changelog.text);
        if (heading) {
            regressions.push(
                `${name}@${p.version}: the PUBLISHED CHANGELOG heading reads "${heading}" ` +
                `while npm serves this version as a release. A shipped artifact describing itself as ` +
                `unreleased is a value with a correctness window and nothing watching the boundary — ` +
                `the release step must stamp the date, and must fail rather than warn when it cannot.`);
        }
    }

    rmSync(dir, { recursive: true, force: true });

    // ── Report ───────────────────────────────────────────────────────────────────

    console.log('\ndrift-guard — published artifacts vs VERIFIED.md\n');
    for (const [name, p] of Object.entries(pkgs)) console.log(`  · ${name}@${p.version}`);
    console.log();

    for (const r of regressions) console.log(`  ✗ REGRESSION  ${r}`);
    for (const r of resolutions) console.log(`  ↑ RESOLVED    ${r}`);
    for (const n of notes) console.log(`  · ${n}`);
    for (const s2 of suppressed) console.log(`  ~ SUPPRESSED  ${s2}`);

    console.log(`\n${regressions.length} regression(s), ${resolutions.length} resolution(s), ${suppressed.length} suppressed.`);
    if (suppressed.length) console.log('Suppressed = matched but positioned as prose. Not failures; skim them — a long or surprising list is a signal about the guard, not the docs.');
    if (resolutions.length) console.log('Resolutions are not failures — update VERIFIED.md so fixed items stop reading as open.\n');

    process.exit(regressions.length > 0 ? 1 : 0);
}
