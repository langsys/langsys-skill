#!/usr/bin/env node
/**
 * Catch invented SDK helpers in the skill's code samples.
 *
 * Three times in three commits a track called a locale-resolution helper that
 * does not exist — `resolveLocale`, then `negotiate`, then `resolveLocale`
 * again. Every one typechecked nowhere, read as plausible, and shipped: an
 * agent following the track writes code that cannot run.
 *
 * A blanket "is this identifier defined" check is far too noisy — illustrative
 * snippets legitimately elide `t`, `useEffect`, destructured setters. So this
 * targets only the class that actually failed: identifiers that LOOK like
 * Langsys locale/translation helpers but are not exported by the SDK.
 *
 * The allowlist is read from the published `dist/index.d.ts` at the pinned
 * version, never written from memory — a list written from the same memory as
 * the docs would inherit their errors (VERIFIED.md, absence-pattern 8). It must
 * include class METHODS as well as the `export { … }` line: `detectPreferredLocale`
 * and `getLocalesFlat` live on LangsysApp, and an allowlist without them reports
 * the SDK's own API as invented.
 *
 * KNOWN BLIND SPOT, stated rather than discovered: the domain filter is what
 * keeps this quiet enough to be worth running, and it is also what limits it.
 * Of the three real phantoms, this catches `resolveLocale` (twice) but NOT
 * `negotiate` — a plausible name with no domain word in it. Widening the filter
 * reproduces the unusably noisy version that flags `t`, `useEffect` and every
 * destructured setter. A guard with a documented gap beats a guard nobody runs;
 * `test/run.mjs` asserts the gap so it cannot quietly become a claimed pass.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DOMAIN = /locale|translat|phrase|catalog|langsys/i;

/** Extra names that are real but not SDK exports: framework and app-level. */
const NON_SDK_REAL = new Set([
    'useLocaleStore', 'setLocale', 'useCurrentLocale', 'useT', 'useTranslation',
    'refToLocaleSource', 'fetchTranslations', 'makeCatalogT', 'isOfferable',
    'seoText', 'dedupeByToken', 'ct',
]);

export function sdkExports(dtsPath) {
    if (!existsSync(dtsPath)) return null;
    const src = readFileSync(dtsPath, 'utf8');
    const line = src.split('\n').reverse().find((l) => l.startsWith('export {'));
    if (!line) return null;

    const names = new Set(
        line
            .replace(/^export\s*\{/, '')
            .replace(/\};?\s*$/, '')
            .split(',')
            .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop())
            .filter(Boolean),
    );

    // Class METHODS are not in the export line. `detectPreferredLocale` and
    // `getLocalesFlat` live on LangsysApp, so an allowlist built only from
    // `export { … }` reports the SDK's own API as invented.
    for (const m of src.matchAll(/^\s{2,}([a-zA-Z_$][\w$]*)\s*(?:<[^>]*>)?\(/gm)) names.add(m[1]);

    return names;
}

/** Comments describe; they do not call. Scanning them produced false hits. */
function stripComments(code) {
    return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function phantomsIn(rawCode, known) {
    const code = stripComments(rawCode);
    const defined = new Set();
    for (const m of code.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
    for (const m of code.matchAll(/import\s+\{([^}]*)\}/g))
        m[1].split(',').forEach((x) => defined.add(x.trim().split(/\s+as\s+/).pop()));

    const out = new Set();
    for (const m of code.matchAll(/(?<![.\w$])([a-z][\w$]*)\s*\(/g)) {
        const name = m[1];
        if (!DOMAIN.test(name)) continue;             // only domain-shaped names
        if (defined.has(name) || known.has(name) || NON_SDK_REAL.has(name)) continue;
        out.add(name);
    }
    return [...out];
}

const walk = (d, out = []) => {
    for (const e of readdirSync(d)) {
        const p = join(d, e);
        statSync(p).isDirectory() ? walk(p, out) : p.endsWith('.md') && out.push(p);
    }
    return out;
};

if (import.meta.url === `file://${process.argv[1]}`) {
    const dts = process.argv[2];
    const known = sdkExports(dts);
    if (!known) {
        // A guard that cannot read its source must SAY so, not pass quietly.
        console.error(`phantom-helpers: cannot read SDK exports from ${dts} — skipping is not a pass`);
        process.exit(2);
    }
    let bad = 0;
    for (const f of walk('src/skill')) {
        const src = readFileSync(f, 'utf8');
        for (const [, , code] of src.matchAll(/```(ts|js|tsx|jsx|svelte|vue)\n([\s\S]*?)```/g)) {
            for (const p of phantomsIn(code, known)) {
                console.error(`${f}: calls '${p}()' — not an SDK export and not defined in the sample`);
                bad++;
            }
        }
    }
    console.log(bad ? `\n${bad} phantom helper(s).` : `Clean — ${known.size} SDK exports known.`);
    process.exit(bad ? 1 : 0);
}
