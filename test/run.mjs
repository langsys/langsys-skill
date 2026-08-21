#!/usr/bin/env node
/**
 * Test suite for langsys-skill.
 *
 * The load-bearing assertions are the NEGATIVE ones. A lint rule that only
 * proves it fires is half-tested — the failure mode that actually hurts is a
 * rule that flags correct code, because an agent acting on it rewrites working
 * code into the bug the rule exists to prevent.
 *
 * Run: node test/run.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sg = (paths) => {
    try {
        execFileSync('ast-grep', ['scan', '-c', join(root, 'src/lint/sgconfig.yml'), ...paths],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return '';
    } catch (e) {
        return (e.stdout ?? '') + (e.stderr ?? '');
    }
};
const markup = (paths) => {
    try {
        return execFileSync('node', [join(root, 'src/lint/markup-check.mjs'), ...paths],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        return (e.stdout ?? '') + (e.stderr ?? '');
    }
};

const fixture = (name, content, ext) => {
    const dir = mkdtempSync(join(tmpdir(), 'langsys-test-'));
    const file = join(dir, `${name}${ext}`);
    writeFileSync(file, content);
    return { dir, file };
};

// ── Positives: rules must fire ───────────────────────────────────────────────

test('flags a template-literal phrase', () => {
    const { file } = fixture('a', 'const x = t(`Hello, ${name}!`);\n', '.ts');
    assert.match(sg([file]), /no-template-literal-phrase/);
});

test('flags a concatenated phrase', () => {
    const { file } = fixture('b', "const x = t('Hello, ' + name);\n", '.ts');
    assert.match(sg([file]), /no-concatenated-phrase/);
});

test('flags a dot-key phrase', () => {
    const { file } = fixture('c', "const x = t('home.welcome');\n", '.ts');
    assert.match(sg([file]), /no-dot-key-phrase/);
});

test('flags reversed arguments when the second holds a placeholder', () => {
    const { file } = fixture('d', "const x = t('UI', 'Hello, {name}!');\n", '.ts');
    assert.match(sg([file]), /reversed-t-arguments/);
});

test('flags reversed arguments when the second ends in terminal punctuation', () => {
    // Second tier: categories are labels and do not end in a full stop.
    const { file } = fixture('d2', `
t('UI', 'Save your work.');
t('Errors', 'Something went wrong!');
t('Help', 'Did you mean this?');
`, '.ts');
    const out = sg([file]);
    assert.equal((out.match(/reversed-t-arguments/g) ?? []).length, 3);
});

test('NEGATIVE: reversed-args guardrails hold', () => {
    // Each line here would fire under a looser rule. They are the reason the
    // punctuation tier is TERMINAL-only and excludes ':'.
    const { file } = fixture('d3', `
t('Save', 'UI');
t('Home', 'Main Menu');
t('Home', 'Home repairs');
t('Welcome back. Glad to see you.', 'Home');   // terminal punctuation in arg1 = correct order
t('Are you sure?', 'Dialogs');
t('Upgrade now', 'Release 1.2 notes');          // mid-string period in a category
t('Read more', 'Note:');                        // colon is a plausible label
t('Hello, {name}!', { name });                  // params object, not a category
`, '.ts');
    assert.equal(sg([file]), '');
});

test("NEGATIVE: the skill's own documented t() samples stay clean", () => {
    // The docs contain ~50 t() examples. If a rule starts flagging the very
    // usage the skill teaches, that is a rule bug, and it fails here first.
    // The docs deliberately show anti-patterns, so harvest only the RECOMMENDED
    // form: the right-hand side of a "before → after" arrow, and any line not
    // marked as the bad example.
    //
    // migrate/ is EXCLUDED by design. Those tracks are built from before/after
    // pairs where the marker often sits on the preceding line ("// Before"), and
    // no line-level heuristic classifies that reliably. Rather than ship a
    // fragile filter that would either miss real regressions or fail on correct
    // docs, the invariant is scoped to where it holds cleanly.
    const samples = [];
    const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, e.name);
            if (e.name === 'migrate') continue;
            if (e.isDirectory()) { walk(p); continue; }
            if (!e.name.endsWith('.md')) continue;
            for (const raw of readFileSync(p, 'utf8').split('\n')) {
                const isBad = /❌|\bwrong\b|\/\/ *Before|^\s*\/\/ *v2/i.test(raw);
                // "before → after": keep only what comes after the arrow.
                const line = raw.includes('→') ? raw.slice(raw.indexOf('→') + 1) : raw;
                if (raw.includes('→') ? false : isBad) continue;
                const m = line.match(/^\s*(\$?t\(.*)$/);
                if (m) samples.push(m[1].replace(/\s*(\/\/|<!--).*$/, '').trim());
            }
        }
    };
    walk(join(root, 'src/skill'));
    if (samples.length === 0) return;
    const { file } = fixture('docs', samples.join('\n') + '\n', '.ts');
    assert.equal(sg([file]), '', 'the skill must not flag its own recommended usage');
});

test('flags init({ apiUrl })', () => {
    const { file } = fixture('e', "LangsysApp.init({ projectid: 'p', apiUrl: 'http://x' });\n", '.ts');
    assert.match(sg([file]), /no-init-apiurl/);
});

test('flags HTML markup inside a t() phrase', () => {
    const { file } = fixture('f', "const x = t('Based on <strong>5</strong> reviews');\n", '.ts');
    assert.match(sg([file]), /no-html-in-phrase/);
});

// ── Negatives: rules must NOT fire ───────────────────────────────────────────

test('NEGATIVE: literal phrase with params is clean', () => {
    const { file } = fixture('g', "const x = t('Hello, {name}!', 'Greetings', { name });\n", '.ts');
    assert.equal(sg([file]), '');
});

test('NEGATIVE: the canonical t() nested inside JSX markup is clean', () => {
    // This exact shape ships in all three bindings' examples. A rule that flags
    // it would have an agent rewrite {name} to %name% INSIDE a JS string, where
    // nothing normalizes it — manufacturing the bug the rule exists to prevent.
    const { file } = fixture('h', `
export function C({ name, count }) {
  const t = useT();
  return <p>{t('Hello, {name}! You have {count} new messages.', 'Greetings', { name, count })}</p>;
}
`, '.tsx');
    assert.equal(sg([file]), '');
});

test('NEGATIVE: a template literal outside a t() call is clean', () => {
    const { file } = fixture('i', 'const cls = `row-${n}`;\nconst x = t("Total", "Cart");\n', '.ts');
    assert.equal(sg([file]), '');
});

test('NEGATIVE: correct argument order is clean', () => {
    const { file } = fixture('j', "const x = t('Hello, {name}!', 'UI', { name });\n", '.ts');
    assert.equal(sg([file]), '');
});

test('NEGATIVE: a sentence containing a full stop is not a dot-key', () => {
    const { file } = fixture('k', "const x = t('Welcome back. Glad to see you.');\n", '.ts');
    assert.equal(sg([file]), '');
});

test('NEGATIVE: real SDK example code stays clean', () => {
    const targets = [
        join(root, '../langsys-js-react/example'),
        join(root, '../langsys-js-typescript/example'),
        join(root, '../langsys-js-vue/example'),
    ].filter(existsSync);
    if (targets.length === 0) return;   // siblings absent in CI
    assert.equal(sg(targets), '', 'published SDK examples must not trip any rule');
});

test('flags an object or array as a params value', () => {
    // ParamPrimitive = string | number | Date | boolean. An object renders as
    // "[object Object]" — always broken at runtime, a build error since 0.5.0.
    const { file } = fixture('pv', `
export function C({ user, tags }: any) {
  return <>
    <Phrase params={{ user: { id: 1 } }}>Hi %user%</Phrase>
    <Translate params={{ tags: ['a','b'] }}>Tags %tags%</Translate>
  </>;
}
`, '.tsx');
    assert.equal((sg([file]).match(/no-object-param-value/g) ?? []).length, 2);
});

test('NEGATIVE: primitive params values are clean', () => {
    const { file } = fixture('pv2', `
export function C({ user, name, count, when }: any) {
  return <>
    <Phrase params={{ name, count }}>Hi %name%</Phrase>
    <Translate params={{ name: user.name, when }}>Hi %name%</Translate>
    <Phrase params={{ n: 5, ok: true, s: 'x' }}>%n%</Phrase>
  </>;
}
`, '.tsx');
    assert.equal(sg([file]), '');
});

test('the ruleset loads without ANY ast-grep error', () => {
    // A rule ast-grep refuses makes it abort the WHOLE scan, so one bad rule
    // silently disables every other rule — and the CI lint step (`|| true`)
    // then reports the abort as clean.
    //
    // This guard used to match `Cannot parse rule` alone and therefore missed
    // `Duplicate rule id`, which is the same failure with different wording:
    // ids must be unique ACROSS FILES, and every JS/TS rule is emitted three
    // times. ast-grep <0.40 tolerated it; 0.45 does not. Matching the CLASS
    // rather than one message is the point — the next abort will be worded
    // differently again.
    // The assertion is deliberately not a list of failure messages — enumerating
    // them is what let `Duplicate rule id` through. On a file with NO findings
    // ast-grep prints nothing at all, so any output whatsoever means something
    // went wrong, whatever it decides to call it next release.
    //
    // Note the exit code is useless here: ast-grep exits 0 even when it aborts.
    const { file } = fixture('parse', 'const x = 1;\n', '.ts');
    const out = sg([file]).trim();
    assert.equal(out, '', `expected silence on a clean file, got: ${out.slice(0, 400)}`);
});

test('every rule id is unique across the generated files', () => {
    // Asserted on the FILES, independent of which ast-grep is installed. The
    // duplicate shipped because the only check ran through a CLI old enough to
    // tolerate it — a guard that depends on the tool it is guarding against.
    const dir = join(root, 'src/lint/rules');
    const ids = readdirSync(dir).filter((f) => f.endsWith('.yml')).map((f) => {
        const m = /^id:\s*"?([^"\n]+)"?/m.exec(readFileSync(join(dir, f), 'utf8'));
        assert.ok(m, `${f} has no id`);
        return m[1].trim();
    });
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual([...new Set(dupes)], [],
        'ast-grep requires ids unique across files and aborts the entire scan on a collision');
    assert.ok(ids.length >= 22, `expected the full ruleset, saw ${ids.length}`);
});

// ── PHP catalog pollution ────────────────────────────────────────────────────

test('PHP: flags sprintf/vsprintf, concatenation and interpolation in the phrase', () => {
    const { file } = fixture('php1', `<?php
$client->translate(sprintf('Hello, %s!', $name));
$client->translate(vsprintf('Hi %s from %s', $args));
$client->translate('Hello, ' . $name . '!');
$client->translate("Hello, $name!");
$client->translateContentBlock('<p>Hi ' . $name . '</p>');
`, '.php');
    const out = sg([file]);
    assert.equal((out.match(/^error\[/gm) ?? []).length, 5, 'all five pollution forms must fire');
});

test('PHP: NEGATIVE — dynamic values outside the phrase position are correct', () => {
    // Only argument 1 is the phrase. $locale, $category, $contentBlockId and
    // $params are SUPPOSED to be dynamic — flagging them would fire on correct
    // code, and a rule that does that gets disabled and then catches nothing.
    const { file } = fixture('php2', `<?php
$client->translate('Hello, {name}!', null, null, null, ['name' => $name]);
$client->translate('Home');
$client->translate('Home', 'es-es', 'UI');
$client->translate("Plain double-quoted, no interpolation");
$client->translate('Home', $locale, $category);
$client->translate('Home', $locale, $cat, $blockId, ['n' => $count]);
$client->translate('Total: {n}', null, null, null, ['n' => sprintf('%d', $x)]);
$client->translate('Greeting', $this->getLocale(), "Cat$suffix");
$log = sprintf('user %s did %s', $name, $action);
`, '.php');
    assert.equal(sg([file]), '');
});

test('PHP: catches every interpolation form, including deeply nested ones', () => {
    // stopBy: end is what reaches the variable inside {$o->m()} and {$c::$s}.
    const { file } = fixture('php3', `<?php
$c->translate("Hello, $name!");
$c->translate("obj {$o->p}");
$c->translate("call {$o->m()}");
$c->translate("arr $a[0]");
`, '.php');
    assert.equal((sg([file]).match(/^error\[/gm) ?? []).length, 4);
});

test('PHP: NEGATIVE — an ESCAPED dollar is a static string, not interpolation', () => {
    // \${amount} renders as the literal text ${amount}. This is the one case
    // where text matching and the AST genuinely disagree: the earlier regex
    // flagged it, because \$ followed by { looked like interpolation. A linter
    // that errors on a correct string is one people start bypassing.
    const { file } = fixture('php4', `<?php
$c->translate("Total \\\${amount} due");
$c->translate("plain double quoted");
$c->translate("esc \\n only");
$c->translate("");
$c->translate($phrase);
`, '.php');
    assert.equal(sg([file]), '');
});

test('PHP: NEGATIVE — the real SDK source stays clean', () => {
    const sdk = join(root, '../langsys-php/src');
    if (!existsSync(sdk)) return;
    assert.equal(sg([sdk]), '', 'the PHP SDK source must not trip its own rules');
});

// ── Markup checker ───────────────────────────────────────────────────────────

test('markup: flags {name} inside <Translate>', () => {
    const { file } = fixture('m', `
<Translate category="D" params={{ name }}>
  <p>Welcome, {name}.</p>
</Translate>
`, '.svelte');
    assert.match(markup([file]), /markup-brace-placeholder/);
});

test('markup: NEGATIVE — %name% form is clean', () => {
    const { file } = fixture('n', `
<Translate category="D" params={{ name }}>
  <p>Welcome, %name%.</p>
</Translate>
`, '.svelte');
    assert.doesNotMatch(markup([file]), /markup-brace-placeholder/);
});

test('markup: NEGATIVE — braces inside a $t() string within markup are clean', () => {
    const { file } = fixture('o', `
<Translate category="Mixed">
  <p>{$t('Hello, {name}! You have {count} messages.', 'Greetings', { name, count })}</p>
</Translate>
`, '.svelte');
    assert.doesNotMatch(markup([file]), /markup-brace-placeholder/);
});

test('markup: flags a block element inside <Phrase>', () => {
    const { file } = fixture('p', '<Phrase category="X">\n  <p>Block</p>\n</Phrase>\n', '.svelte');
    assert.match(markup([file]), /phrase-contains-block/);
});

test('markup: errors when a placeholder and inline markup share a run', () => {
    // The precise pluralization break: count and noun land in different entries.
    const { file } = fixture('q', `
<Translate category="R" params={{ n }}>
  Based on %n% <strong>reviews</strong>
</Translate>
`, '.svelte');
    const out = markup([file]);
    assert.match(out, /translate-splits-sentence/);
    assert.match(out, /^error/m, 'placeholder + inline markup must be an error, not a warning');
});

test('markup: only warns for prose with inline markup and no placeholder', () => {
    // <Translate> around genuine prose is its documented purpose — a human decides.
    const { file } = fixture('r', `
<Translate category="Blog">
  <p>My content <strong>is the best</strong> when translated.</p>
</Translate>
`, '.svelte');
    const out = markup([file]);
    assert.match(out, /translate-splits-sentence/);
    assert.equal(/^error/m.test(out), false, 'no placeholder present — must warn, not error');
});

test('markup: NEGATIVE — real SDK examples produce no errors', () => {
    const targets = [
        join(root, '../langsys-js-vue/example'),
        join(root, '../langsys-js-react/example'),
        join(root, '../langsys-js-svelte/src/routes'),
    ].filter(existsSync);
    if (targets.length === 0) return;
    const out = markup(targets);
    assert.match(out, /0 error\(s\)/, 'real SDK example code must produce no markup ERRORS');
});

// ── Installer ────────────────────────────────────────────────────────────────

test('installer is idempotent and preserves user content', () => {
    const dir = mkdtempSync(join(tmpdir(), 'langsys-inst-'));
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, 'AGENTS.md'), '# Mine\n\nUser content.\n');

    const run = () => execFileSync('node',
        [join(root, 'src/bin/install.mjs'), `--dir=${dir}`, '--host=claude,codex'],
        { encoding: 'utf8' });

    run();
    const first = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    const second = run();

    assert.match(first, /User content\./, 'existing content must survive');
    assert.equal((first.match(/langsys:skill:start/g) ?? []).length, 1);
    assert.match(second, /0 written/, 're-running an unchanged install must write nothing');
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), first, 're-run must be byte-identical');

    rmSync(dir, { recursive: true, force: true });
});

test('payload ships every documented track', () => {
    const required = [
        'SKILL.md', 'detect.md', 'verify.md', 'troubleshooting.md',
        'core/choosing-primitives.md', 'core/invariants.md', 'core/interpolation.md',
        'core/init-config.md', 'core/categories.md', 'core/secrets.md',
        'integrate/react.md', 'integrate/vue.md', 'integrate/svelte.md',
        'integrate/vanilla-ts.md', 'integrate/php.md',
        'ssr/nextjs.md', 'ssr/nuxt.md', 'ssr/sveltekit.md', 'ssr/php.md',
        'migrate/_method.md', 'migrate/i18next.md', 'migrate/react-intl.md', 'migrate/vue-i18n.md',
    ];
    for (const f of required) {
        const p = join(root, 'src/skill', f);
        assert.ok(existsSync(p), `missing ${f}`);
        assert.ok(readFileSync(p, 'utf8').length > 400, `${f} looks like a stub`);
    }
});

test('SKILL.md stays inside its size budget', () => {
    // Claude loads this on every trigger; detail belongs in the payload.
    const lines = readFileSync(join(root, 'src/skill/SKILL.md'), 'utf8').split('\n').length;
    assert.ok(lines <= 200, `SKILL.md is ${lines} lines, budget is 200`);
});

test('every mention of apiUrl carries its correction', () => {
    // Guards against reintroducing the upstream README defect. Naming the bad
    // form is REQUIRED here — the tracks exist partly to correct it — so the
    // invariant is that the correction always travels with it, not that the
    // string is absent.
    for (const f of ['integrate/vue.md', 'core/init-config.md']) {
        const txt = readFileSync(join(root, 'src/skill', f), 'utf8');
        if (!/apiUrl/.test(txt)) continue;
        assert.match(txt, /not a (real )?config field|does not exist|is NOT a config field/i,
            `${f} mentions apiUrl without stating it is not a config field`);
        assert.match(txt, /setBaseUrl/,
            `${f} must document setBaseUrl() as the working mechanism`);
    }
});

test('every track documents the two-mode detectPreferredLocale guard', () => {
    // The `|| 'en-US'` idiom is wrong in a way that survives testing, so any
    // track showing locale fallback must show the explicit guard instead.
    for (const f of ['integrate/vue.md', 'core/init-config.md', 'core/invariants.md']) {
        const txt = readFileSync(join(root, 'src/skill', f), 'utf8');
        if (!/detectPreferredLocale/.test(txt)) continue;
        assert.match(txt, /supported\.includes\(detected\)/,
            `${f} must show the explicit guard, not just || 'en-US'`);
    }
});

// ── langsys-scan ─────────────────────────────────────────────────────────────
//
// Scan's contract is the inverse of lint's: it runs on code that predates
// Langsys, so its dangerous failure is not a missed defect but a CONFIDENT
// WRONG NUMBER. Most of what follows is therefore negative — proving it does
// not invent sites — plus the two structural guarantees (no silent caps, and a
// non-zero exit reserved for "could not do the job").

const scan = (target, extra = []) => {
    const out = execFileSync('node', [join(root, 'src/bin/scan.mjs'), target, '--json', ...extra],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(out);
};

/** Build a throwaway project with a package.json plus the given files. */
const project = (pkgDeps, files) => {
    const dir = mkdtempSync(join(tmpdir(), 'langsys-scan-'));
    writeFileSync(join(dir, 'package.json'),
        JSON.stringify({ name: 'fixture', dependencies: pkgDeps }, null, 2));
    for (const [name, content] of Object.entries(files)) {
        const p = join(dir, name);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, content);
    }
    return dir;
};

const kinds = (j) => j.totals.byKind;
const sitesOf = (j, kind) => j.sites.filter((s) => s.kind === kind);

test('scan: a plain markup string is t(), not a component', () => {
    const dir = project({ react: '18.2.0' }, {
        'src/A.tsx': 'export const A = () => <h2>Product details</h2>;\n',
    });
    const j = scan(dir);
    assert.equal(kinds(j)['t()'], 1);
    assert.equal(kinds(j).Phrase, 0);
    assert.equal(sitesOf(j, 't()')[0].sample, 'Product details');
});

test('scan: a sentence carrying inline markup is <Phrase>, never <Translate>', () => {
    // The decision the whole skill exists for. <Translate> here would split the
    // run at the <em> boundary and register three fragments.
    const dir = project({ react: '18.2.0' }, {
        'src/A.tsx': 'export const A = () => <p>Read the <em>full</em> guide</p>;\n',
    });
    const j = scan(dir);
    assert.equal(kinds(j).Phrase, 1);
    assert.equal(kinds(j)['t()'], 0);
    assert.equal(kinds(j).Translate, 0);
    assert.match(sitesOf(j, 'Phrase')[0].sample, /Read the full guide/);
});

test('scan: a placeholder beside inline markup escalates to the human bucket', () => {
    // A count and the noun it inflects in one run. This is the site that breaks
    // Russian/Arabic/Polish, and it must never be filed as mechanical work.
    const dir = project({ react: '18.2.0' }, {
        'src/A.tsx': 'export const A = () => <p>Based on {n} <strong>reviews</strong></p>;\n',
    });
    const j = scan(dir);
    assert.equal(kinds(j).Phrase, 1);
    assert.equal(sitesOf(j, 'Phrase')[0].bucket, 'human');
    assert.ok(j.hazards.some((h) => h.rule === 'brace-placeholder-in-markup'));
});

test('scan: a container of block children is a <Translate> candidate', () => {
    const dir = project({ react: '18.2.0' }, {
        'src/A.tsx': 'export const A = () => <section><p>One thing.</p><p>Another thing.</p></section>;\n',
    });
    const j = scan(dir);
    assert.equal(kinds(j).Translate, 1);
    assert.equal(kinds(j)['t()'], 2, 'the t() sites beneath must still be reported — they overlap, they do not merge');
});

test('NEGATIVE: scan does not read a TypeScript generic as markup', () => {
    // `useQuery<Row>(…)` tokenizes as an open tag that never closes. Before the
    // closed-element gate, everything after it was swallowed into a phantom
    // element and the file's real markup vanished from the totals — a scan that
    // reported ZERO sites for a file full of them.
    const dir = project({ react: '18.2.0' }, {
        'src/A.tsx': `
import { useQuery } from './q';
export function A() {
  const rows = useQuery<Row>('x');
  const m = new Map<string, number>();
  return <p>Visible text here</p>;
}
`,
    });
    const j = scan(dir);
    assert.equal(kinds(j)['t()'], 1);
    assert.equal(j.totals.sites, 1, `phantom sites: ${JSON.stringify(j.sites)}`);
});

test('NEGATIVE: scan does not count code as prose', () => {
    // Imports, type declarations and the function body all sit at the markup
    // root of a .tsx file. Counting root text made an import block a t() site.
    const dir = project({ react: '18.2.0' }, {
        'src/A.ts': `
export const API = "/api/v1/users";
const cls = "flex items-center gap-2";
const msg = "this looks like prose but nothing says it is user-visible";
`,
    });
    const j = scan(dir);
    assert.equal(j.totals.sites, 0);
    assert.ok(j.notExamined.declaredBlindSpots.some((b) => /Bare string literals/.test(b)),
        'the omission must be DECLARED, not silent');
});

test('NEGATIVE: scan does not treat a t() call inside markup as markup text', () => {
    // `{t('Welcome back')}` is already correct. Counting it as a conversion site
    // would send an agent to "fix" working code.
    const dir = project({ 'langsys-js-react': '0.4.3', react: '18.2.0' }, {
        'src/A.tsx': "export const A = () => <span>{t('Welcome back', 'UI')}</span>;\n",
    });
    const j = scan(dir);
    assert.equal(kinds(j)['t()'], 0);
    assert.equal(j.migrated.calls, 1);
    assert.equal(j.hazards.length, 0);
});

test('NEGATIVE: scan does not count a dynamic attribute binding', () => {
    // :placeholder="x" and title={x} are expressions, not literals. Only static
    // values are conversion sites.
    const dir = project({ vue: '3.4.0' }, {
        'src/A.vue': `<template>
  <input :placeholder="ph" title="Filter results" />
</template>
`,
    });
    const j = scan(dir);
    assert.equal(kinds(j).attribute, 1);
    assert.match(sitesOf(j, 'attribute')[0].sample, /Filter results/);
});

test('scan: an already-converted component counts as migrated, not as work', () => {
    const dir = project({ 'langsys-js-svelte': '3.5.0', svelte: '5.0.0' }, {
        'src/A.svelte': `<Phrase category="Cart" params={{ count }}>
  You have %count% <strong>items</strong>
</Phrase>
<h1>Dashboard</h1>
`,
    });
    const j = scan(dir);
    assert.equal(j.migrated.components, 1);
    assert.equal(kinds(j).Phrase, 0, 'a converted <Phrase> is not an outstanding site');
    assert.equal(kinds(j)['t()'], 1);
});

test('scan: a namespaced key is human work, because the source text is elsewhere', () => {
    // Langsys keys on the phrase, so 'home.welcome' cannot be converted without
    // the base-locale catalog. Filing this as mechanical invites an agent to
    // invent the English.
    const dir = project({ i18next: '23.0.0' }, {
        'src/A.ts': "export const x = t('home.welcome');\n",
    });
    const j = scan(dir);
    assert.equal(kinds(j).call, 1);
    assert.equal(j.sites[0].bucket, 'human');
    assert.match(j.sites[0].note, /base-locale catalog/);
});

test('scan: t()-shaped calls with no declared i18n library are unattributed', () => {
    // A bare t( means "migrate this" under i18next, "already done" under
    // Langsys, and nothing knowable under neither. Folding the third case into
    // either count is a confident wrong number.
    const dir = project({ react: '18.2.0' }, {
        'src/A.ts': "export const x = t('Save');\n",
    });
    const j = scan(dir);
    assert.equal(j.totals.byBucket.unattributed, 1);
    assert.equal(j.totals.byBucket.mechanical, 0);
});

test('scan: a pre-formatted phrase is a hazard AND human work', () => {
    const dir = project({ i18next: '23.0.0' }, {
        'src/A.ts': 'export const x = t(`Hello, ${name}!`);\n',
    });
    const j = scan(dir);
    assert.ok(j.hazards.some((h) => h.rule === 'preformatted-phrase'));
    assert.equal(j.sites[0].bucket, 'human');
});

test('scan reports zero as zero, and still declares what it did not examine', () => {
    // The vacuous-pass shape: a clean report is only meaningful alongside the
    // skip list. This is the same guarantee changelog-coverage enforces.
    const dir = project({ react: '18.2.0' }, { 'README.md': '# nothing here\n' });
    const j = scan(dir);
    assert.equal(j.totals.sites, 0);
    assert.ok(j.notExamined.declaredBlindSpots.length >= 4);
    assert.ok('.md' in j.notExamined.byExt, 'unscanned file types must be enumerated');
});

test('scan surfaces an unreadable file instead of dropping it', () => {
    const dir = project({ react: '18.2.0' }, {});
    writeFileSync(join(dir, 'src.js'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
    const j = scan(dir);
    assert.equal(j.notExamined.unreadable.length, 1);
    assert.match(j.notExamined.unreadable[0].reason, /binary/);
});

test('scan exits 0 on findings — it reports scope, not fault', () => {
    // The contract that separates it from lint. A non-zero exit here would fail
    // CI on any project that has not been migrated yet, which is every project
    // scan is for.
    const dir = project({ i18next: '23.0.0' }, {
        'src/A.tsx': 'export const A = () => <p>Based on {n} <strong>reviews</strong></p>;\n',
    });
    const out = execFileSync('node', [join(root, 'src/bin/scan.mjs'), dir],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(out, /NOT EXAMINED/);
    assert.match(out, /HAZARDS/);
});

test('scan resolves the project from an ancestor manifest', () => {
    // Pointed at one file, it must still find the framework and the incumbent.
    // Reporting "route INTEGRATE" for an i18next project is worse than silence.
    const dir = project({ react: '18.2.0', i18next: '23.0.0' }, {
        'src/deep/A.tsx': 'export const A = () => <h2>Product details</h2>;\n',
    });
    const j = scan(join(dir, 'src/deep/A.tsx'));
    assert.equal(j.profile.framework, 'react');
    assert.equal(j.profile.route, 'migrate');
    assert.equal(j.sites[0].file, 'src/deep/A.tsx');
});

test('scan never reports a directory total it silently truncated', () => {
    // --top is a DISPLAY limit. The totals and the JSON must be complete, and
    // the human output must say what it withheld.
    const files = {};
    for (let i = 0; i < 14; i++) files[`src/d${i}/A.tsx`] = `export const A = () => <h2>Heading ${i} text</h2>;\n`;
    const dir = project({ react: '18.2.0' }, files);
    const j = scan(dir);
    assert.equal(j.totals.sites, 14);
    const out = execFileSync('node', [join(root, 'src/bin/scan.mjs'), dir, '--top', '5'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(out, /Showing the top 5 of 14 directories/);
    assert.match(out, /display limit only; nothing was dropped/);
});

test('scan skips generated bundles, and says which ones', () => {
    // Found by running against a real Capacitor app: 259 of 406 sites came from
    // build output, including the SDK's own bundle counted once per platform
    // copy. The job would have read as three times its actual size.
    //
    // The skip must be VISIBLE. A quieter scan that merely reports a smaller
    // number is the same failure wearing better clothes.
    const dir = project({ react: '18.2.0' }, {
        'src/A.tsx': 'export const A = () => <h2>Real source heading</h2>;\n',
        'www/assets/index-a1b2c3.js': `const x=1;${'/*pad*/'.repeat(200)}\n//# sourceMappingURL=index.js.map\n`,
        'www/assets/vendor-d4e5f6.js': `const y=${'"a",'.repeat(400)}0;\n`,
    });
    const j = scan(dir);
    assert.equal(j.totals.sites, 1, 'only hand-written source counts');
    assert.equal(j.notExamined.unreadable.length, 2);
    assert.ok(j.notExamined.unreadable.every((u) => /generated/.test(u.reason)),
        `reasons must be stated: ${JSON.stringify(j.notExamined.unreadable)}`);
});

test('NEGATIVE: a long hand-written line is not mistaken for build output', () => {
    // The detector keys on line length, so its guardrail is that ordinary source
    // — including a genuinely long sentence — stays under the threshold.
    const dir = project({ react: '18.2.0' }, {
        'src/A.tsx': `export const A = () => <p>${'A fairly long sentence that a designer really did write. '.repeat(5)}</p>;\n`,
    });
    const j = scan(dir);
    assert.equal(j.notExamined.unreadable.length, 0);
    assert.equal(j.totals.sites, 1);
});

test('scan: a dynamic t() in a Langsys project is a hazard, not outstanding work', () => {
    // t(someVar) cannot be checked statically, but in a project already on
    // Langsys it is not a MIGRATION site. Counting it as one told an agent to
    // migrate a codebase that was already migrated.
    const dir = project({ 'langsys-js-svelte': '3.5.0', svelte: '5.0.0' }, {
        'src/A.ts': 'export const x = t(label);\n',
    });
    const j = scan(dir);
    assert.equal(j.totals.sites, 0);
    assert.equal(j.migrated.calls, 1);
    assert.ok(j.hazards.some((h) => h.rule === 'dynamic-phrase-argument'),
        'still surfaced — it just is not scope');
});

test('scan: a dynamic t() in an i18next project IS outstanding work', () => {
    // Same call, opposite verdict, decided by the manifest. The pair is the
    // point: attribution is what makes either number meaningful.
    const dir = project({ i18next: '23.0.0' }, {
        'src/A.ts': 'export const x = t(label);\n',
    });
    const j = scan(dir);
    assert.equal(j.totals.sites, 1);
    assert.equal(j.sites[0].bucket, 'judgment');
});

test('scan harvests exactly the SDK\'s translatable attributes', () => {
    // The list is transcribed from TRANSLATABLE_ATTRIBUTES in published
    // langsys-js-typescript@0.6.5. The first version was written from memory: it
    // invented `summary` and omitted nine real entries. Both directions are
    // asserted here, because a list recalled rather than read fails silently.
    const dir = project({ react: '18.2.0' }, {
        'src/A.tsx': `export const A = () => (
  <div>
    <span data-error-message="This field is required" />
    <span data-error="Bad input here" />
    <span aria-roledescription="Slide carousel" aria-valuetext="Seventy percent" />
    <option label="Awaiting review">a</option>
    <table summary="Quarterly totals" />
  </div>
);
`,
    });
    const j = scan(dir);
    const got = j.sites.filter((s) => s.kind === 'attribute').map((s) => s.sample.split('=')[0]).sort();
    assert.deepEqual(got,
        ['aria-roledescription', 'aria-valuetext', 'data-error', 'data-error-message', 'label']);
    assert.ok(!got.includes('summary'), 'summary is NOT in TRANSLATABLE_ATTRIBUTES — the SDK never harvests it');
});

test('scan harvests `value` only where it is a label, not where it is data', () => {
    // `value` is absent from TRANSLATABLE_ATTRIBUTES and handled by a separate
    // rule: <button>, and <input> of type submit or button. A checker keyed on
    // that constant alone drops every submit button in the app; one keyed on the
    // attribute name alone sends an agent to translate an email address.
    const dir = project({ react: '18.2.0' }, {
        'src/A.tsx': `export const A = () => (
  <form>
    <input type="submit" value="Search now" />
    <input type="button" value="Reset form" />
    <button value="Confirm order">Go</button>
    <input type="text" value="user at example dot com" />
    <input type="hidden" value="Do not translate me" />
    <select value="Pending review"><option>a</option></select>
  </form>
);
`,
    });
    const j = scan(dir);
    const values = j.sites.filter((s) => s.kind === 'attribute' && s.sample.startsWith('value='))
        .map((s) => s.sample);
    assert.deepEqual(values.sort(),
        ['value="Confirm order"', 'value="Reset form"', 'value="Search now"']);
});

test('NEGATIVE: scan does not confuse data-error with data-error-message', () => {
    // Alternation order is load-bearing: unsorted, `data-error` matches first and
    // the longer attribute is reported under the wrong name with a truncated value.
    const dir = project({ react: '18.2.0' }, {
        'src/A.tsx': 'export const A = () => <span data-validation-message="Pick a date" />;\n',
    });
    const j = scan(dir);
    assert.equal(j.sites.length, 1);
    assert.equal(j.sites[0].sample, 'data-validation-message="Pick a date"');
});

test('doctor flags a base-SDK caret that caps below the verified version', () => {
    // Vue shipped `^0.4.1`, which capped the base SDK at 0.4.3 and made every
    // fix from 0.5.0 on unreachable for its consumers. Nothing in the binding's
    // own docs or tests could reveal it — the binding was correct; the RANGE was
    // not. A caret is part of the API surface.
    const dir = mkdtempSync(join(tmpdir(), 'langsys-caret-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'f', dependencies: { vue: '3.4.0', 'langsys-js-vue': '0.2.0' },
    }));
    const mod = (name, pkg) => {
        mkdirSync(join(dir, 'node_modules', name), { recursive: true });
        writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify(pkg));
    };
    mod('vue', { name: 'vue', version: '3.4.0' });
    mod('langsys-js-vue', {
        name: 'langsys-js-vue', version: '0.2.0',
        dependencies: { 'langsys-js-typescript': '^0.4.1' },
    });
    let out = '';
    try {
        out = execFileSync('node', [join(root, 'src/bin/doctor.mjs'), dir],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); }
    assert.match(out, /declares langsys-js-typescript \^0\.4\.1, below the verified 0\.6\.5/);
});

test('NEGATIVE: doctor accepts a caret at or above the floor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'langsys-caret-ok-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'f', dependencies: { vue: '3.4.0', 'langsys-js-vue': '0.2.0' },
    }));
    const mod = (name, pkg) => {
        mkdirSync(join(dir, 'node_modules', name), { recursive: true });
        writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify(pkg));
    };
    mod('vue', { name: 'vue', version: '3.4.0' });
    mod('langsys-js-vue', {
        name: 'langsys-js-vue', version: '0.2.0',
        dependencies: { 'langsys-js-typescript': '^0.6.5' },
    });
    let out = '';
    try {
        out = execFileSync('node', [join(root, 'src/bin/doctor.mjs'), dir],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); }
    assert.doesNotMatch(out, /below the verified/);
    assert.match(out, /declares base \^0\.6\.5/);
});

// ── drift-guard: published artifact vs its own changelog ─────────────────────
//
// drift-guard is network-dependent and otherwise untested. This predicate is
// extracted so it CAN be tested, because a check that silently never fires reads
// as a clean bill of health — the exact failure it was written to catch.

const { selfDescribesUnreleased } = await import(
    new URL('../src/bin/lib/changelog-heading.mjs', import.meta.url));

test('detects a published version whose own changelog says unreleased', () => {
    // langsys-js-vue@0.2.0 shipped this while npm served it as `latest`.
    const txt = '# Changelog\n\n## 0.2.0 - unreleased\n\n### Fixed\n- things\n\n## 0.1.1 - 2026-07-09\n';
    assert.equal(selfDescribesUnreleased('0.2.0', txt), '## 0.2.0 - unreleased');
});

test('NEGATIVE: a dated heading for the published version is clean', () => {
    const txt = '## 0.2.0 - 2026-08-18\n\n## 0.1.1 - 2026-07-09\n';
    assert.equal(selfDescribesUnreleased('0.2.0', txt), null);
});

test('NEGATIVE: an unreleased heading for a FUTURE version is correct, not a defect', () => {
    // The whole point: `unreleased` is the RIGHT value until publication. Firing
    // here would push authors toward dating unpublished versions — the opposite
    // error, and the one the Vue agent had deliberately avoided.
    const txt = '## 0.3.0 - unreleased\n\n## 0.2.0 - 2026-08-18\n';
    assert.equal(selfDescribesUnreleased('0.2.0', txt), null);
});

test('NEGATIVE: version matching does not bleed across similar numbers', () => {
    // `0.2.0` must not match a `## 0.2.01` or `## 0.2.0-rc.1` heading, and
    // `0.1.1` must not match `0.1.10`.
    assert.equal(selfDescribesUnreleased('0.2.0', '## 0.2.01 - unreleased\n'), null);
    assert.equal(selfDescribesUnreleased('0.1.1', '## 0.1.10 - unreleased\n'), null);
    assert.equal(selfDescribesUnreleased('0.2.0', '## v0.2.0 — unreleased\n'), '## v0.2.0 — unreleased');
});

test('NEGATIVE: no section for this version is a DIFFERENT defect, not this one', () => {
    // Covered by the released-tags check. Reporting it here too would double-bill
    // one defect as two.
    assert.equal(selfDescribesUnreleased('0.1.2', '## 0.2.0 - 2026-08-18\n## 0.1.1 - 2026-07-09\n'), null);
});

test('global install never writes into the home root', () => {
    // The rule was commented on codex() and gemini() and missing from generic()
    // — which is the shim MOST likely to hit it, because `generic` is the
    // fallback when no host is detected, i.e. a fresh machine running --global.
    // It wrote ~/AGENTS.md: the user's filesystem, not a project.
    const fakeHome = mkdtempSync(join(tmpdir(), 'langsys-home-'));
    const run = (args) => execFileSync('node', [join(root, 'src/bin/install.mjs'), ...args],
        { encoding: 'utf8', env: { ...process.env, HOME: fakeHome }, stdio: ['ignore', 'pipe', 'pipe'] });

    run(['--global', '--host=generic']);
    assert.ok(!existsSync(join(fakeHome, 'AGENTS.md')),
        'global install must not drop AGENTS.md in the home root');
    assert.ok(existsSync(join(fakeHome, '.langsys', 'AGENTS.md')),
        'the generic entry doc belongs beside the payload');

    for (const [host, file] of [['codex', '.codex/AGENTS.md'], ['gemini', '.gemini/GEMINI.md']]) {
        const out = run(['--global', '--dry-run', `--host=${host}`]);
        assert.match(out, new RegExp(file.replace('.', '\\.')), `${host} global path`);
    }
    rmSync(fakeHome, { recursive: true, force: true });
});

test('project install still writes AGENTS.md at the project root', () => {
    // The counterpart. Moving the file in PROJECT scope would be the opposite
    // bug — that is exactly where Codex expects to find it.
    const dir = mkdtempSync(join(tmpdir(), 'langsys-proj-'));
    execFileSync('node', [join(root, 'src/bin/install.mjs'), `--dir=${dir}`, '--host=generic'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.ok(existsSync(join(dir, 'AGENTS.md')), 'project scope keeps AGENTS.md at the project root');
    rmSync(dir, { recursive: true, force: true });
});

test('scan blocks a recommendation the project cannot install', () => {
    // Found by dogfooding on a real Svelte 3 project. scan runs BEFORE doctor and
    // is what produces the recommendation, so it recommended langsys-js-svelte to
    // a project that cannot install it — sending an agent to `npm install` and a
    // failure, with the profile reading as a clean route the whole way.
    const dir = project({ svelte: '^3.55.0' }, {
        'src/A.svelte': '<h1>Dashboard</h1>\n',
    });
    const j = scan(dir);
    assert.ok(j.profile.blocker, 'a Svelte 3 project must be flagged');
    assert.equal(j.profile.blocker.framework, 'svelte');
    assert.equal(j.profile.blocker.floor, '5.0.0');
    assert.equal(j.totals.sites, 1, 'scope is still reported — it just is not actionable yet');
});

test('NEGATIVE: a project meeting the floor is not blocked', () => {
    const dir = project({ svelte: '^5.0.0', vite: '^5.0.0' }, { 'src/A.svelte': '<h1>Dashboard</h1>\n' });
    assert.equal(scan(dir).profile.blocker, null);
});

test('scan does not claim "none required" for a bundler with no env convention', () => {
    // Rollup and webpack inject nothing. Reporting "none required" reads as
    // "process.env just works", and process.env does not exist in a browser
    // bundle — the key silently resolves to undefined with no build error.
    const dir = project({ svelte: '^5.0.0', rollup: '^3.15.0' }, { 'src/A.svelte': '<h1>Hi there</h1>\n' });
    const out = execFileSync('node', [join(root, 'src/bin/scan.mjs'), dir],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(out, /rollup \(no convention\)/);
    assert.match(out, /process\.env does NOT exist/);
    assert.doesNotMatch(out, /none required/);
});

test('doctor checks the DECLARED framework range, not only the installed one', () => {
    // The check used to read node_modules and skip when absent — so on a fresh
    // clone, or any project scoped before install, it silently did nothing and
    // reported zero errors. That is exactly when the answer matters most.
    const dir = mkdtempSync(join(tmpdir(), 'langsys-floor-'));
    writeFileSync(join(dir, 'package.json'),
        JSON.stringify({ name: 'f', dependencies: { svelte: '^3.55.0' } }));
    let out = '';
    try {
        out = execFileSync('node', [join(root, 'src/bin/doctor.mjs'), dir],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); }
    assert.match(out, /declared as \^3\.55\.0, which cannot satisfy the required 5\.0\.0/);
    assert.match(out, /installing will not fix it/i);
    rmSync(dir, { recursive: true, force: true });
});

test('installer accepts -g and -n as well as the long flags', () => {
    // The README used `-g`, which the parser did not handle. Documenting a flag
    // that does nothing is the same class of defect this repo audits others for.
    const fakeHome = mkdtempSync(join(tmpdir(), 'langsys-short-'));
    const out = execFileSync('node', [join(root, 'src/bin/install.mjs'), '-g', '-n', '--host=generic'],
        { encoding: 'utf8', env: { ...process.env, HOME: fakeHome }, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(out, /global install \(dry run\)/);
    assert.ok(!existsSync(join(fakeHome, '.langsys')), '-n must not write');
    rmSync(fakeHome, { recursive: true, force: true });
});

test('scan reports content modules as a magnitude, not as sites', () => {
    // Reported from a real static site: scan counted 71 sites while the largest
    // body of copy — a typed content module of taglines, blurbs and feature
    // bodies — went unmentioned because bare .ts literals are not sites. The
    // blind spot was correctly declared and still understated the job by half.
    //
    // The fix looks, reports magnitude, and refuses precision: these must NEVER
    // be folded into the site totals, because scan cannot tell a tagline from a
    // log line and a wrong total is worse than an honest range.
    const dir = project({ svelte: '^5.0.0' }, {
        'src/lib/products.ts': `export const products = [
  { slug: 'a', tagline: 'Mission control for your worlds.',
    blurb: 'Game server hosting that lives in your pocket.',
    features: [{ title: 'Provisioned with ownership at birth', body: 'Every world is yours from the first boot.' }] },
];
`,
    });
    const j = scan(dir);
    assert.ok(j.contentModules.length >= 1, 'the content module must be surfaced');
    assert.match(j.contentModules[0].file, /products\.ts$/);
    assert.ok(j.contentModules[0].count >= 4);
    assert.equal(j.totals.sites, 0, 'and must NOT inflate the site count');
});

test('NEGATIVE: ordinary code is not reported as a content module', () => {
    // The guardrail. Paths, class lists, identifiers and log lines are not copy.
    const dir = project({ svelte: '^5.0.0' }, {
        'src/api.ts': `const BASE = '/api/v1/users';
const CLS = 'flex items-center gap-2';
const URL2 = 'https://example.com/a/b';
const KEY = 'user_id';
const TPL = \`<div>\${x}</div>\`;
`,
    });
    assert.deepEqual(scan(dir).contentModules, []);
});

test('scan flags a prerendered site before routing it to the SSR track', () => {
    // A fully prerendered SvelteKit site has no server at runtime, so the SSR
    // track's per-request Accept-Language seeding cannot run. scan routes to that
    // track from the meta-framework alone, so without this it sends people to a
    // recipe their deployment cannot execute.
    const dir = project({ svelte: '^5.0.0', '@sveltejs/kit': '^2.0.0', '@sveltejs/adapter-static': '^3.0.0' }, {
        'src/routes/+layout.ts': 'export const prerender = true;\n',
    });
    const j = scan(dir);
    assert.ok(j.profile.prerender, 'prerendered posture must be detected');
    assert.match(j.profile.prerender.staticAdapter, /adapter-static/);
    const out = execFileSync('node', [join(root, 'src/bin/scan.mjs'), dir],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(out, /PRERENDERED \/ STATIC/);
    assert.match(out, /CANNOT run here/);
});

test('NEGATIVE: a server-rendered SvelteKit app is not flagged as prerendered', () => {
    const dir = project({ svelte: '^5.0.0', '@sveltejs/kit': '^2.0.0', '@sveltejs/adapter-node': '^5.0.0' }, {
        'src/routes/+layout.server.ts': 'export async function load() { return {}; }\n',
    });
    assert.equal(scan(dir).profile.prerender, null);
});

test('the rendering-mode decision is routed to before any SSR track', () => {
    // The guidance is about Langsys, not about a framework: only SSR puts
    // CURRENT translations in crawlable HTML, so a realtime translation manager
    // behind a prerendered site is indexed as a build-time snapshot. Living in
    // one framework's track would leave the other three teaching the trap.
    const core = join(root, 'src/skill/core/rendering-mode.md');
    assert.ok(existsSync(core), 'core/rendering-mode.md must exist');
    const txt = readFileSync(core, 'utf8');
    assert.match(txt, /snapshot/i, 'must name the staleness, not just prefer SSR');
    assert.match(txt, /ready gate|loader/i, 'must give apps the client-only answer');

    for (const f of ['ssr/nextjs.md', 'ssr/nuxt.md', 'ssr/php.md', 'ssr/sveltekit.md']) {
        const t = readFileSync(join(root, 'src/skill', f), 'utf8');
        assert.match(t, /rendering-mode\.md/, `${f} must route to the decision first`);
    }
    assert.match(readFileSync(join(root, 'src/skill/SKILL.md'), 'utf8'), /rendering-mode\.md/);
});

test('scan explains WHY prerendering is a trap, not just that it was detected', () => {
    // "No server at runtime" is true and useless on its own — prerendering emits
    // translated HTML, so it passes the obvious check. The failure is that the
    // snapshot goes stale invisibly, because every human sees the corrected page.
    const dir = project({ svelte: '^5.0.0', '@sveltejs/kit': '^2.0.0', '@sveltejs/adapter-static': '^3.0.0' }, {
        'src/routes/+layout.ts': 'export const prerender = true;\n',
    });
    const out = execFileSync('node', [join(root, 'src/bin/scan.mjs'), dir],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(out, /snapshot/i);
    assert.match(out, /nobody reports it/i);
    assert.match(out, /rendering-mode\.md/);
});

// ── Langsys MCP awareness ────────────────────────────────────────────────────

test('the MCP doc states what it unlocks and stays optional', () => {
    // The MCP changes what the skill can DO — create the org, project and keys —
    // so it has to be routed to from preflight. But it must never become a
    // prerequisite: someone who already has a project ID and key needs none of it,
    // and stalling an integration on an optional convenience is worse than the
    // copy-paste it removes.
    const doc = join(root, 'src/skill/core/mcp.md');
    assert.ok(existsSync(doc), 'core/mcp.md must exist');
    const txt = readFileSync(doc, 'utf8');
    assert.match(txt, /--scope=user/, 'must recommend user scope');
    assert.match(txt, /mcp\.langsys\.dev\/mcp/, 'must carry the endpoint');
    assert.match(txt, /two API keys|two keys/i, 'must require a write key AND a read-only key');
    assert.match(txt, /Do not stall/i, 'must state that it is optional');

    const skill = readFileSync(join(root, 'src/skill/SKILL.md'), 'utf8');
    assert.match(skill, /core\/mcp\.md/, 'preflight must route to it');
    assert.match(skill, /--scope=user/, 'the add command must be in the router');
});

test('doctor reports MCP scope from config, distinguishing user from project', () => {
    // Read from config, not `claude mcp list` — that health-checks every server
    // over the network and took 7.3s here. A preflight check costing seven
    // seconds gets skipped, and a skipped check is not a check.
    //
    // Scope is reported rather than a boolean because "registered for THIS
    // project only" is the case worth flagging: the next project silently lacks it.
    const mk = (claudeJson) => {
        const home = mkdtempSync(join(tmpdir(), 'langsys-mcp-'));
        const proj = join(home, 'proj');
        mkdirSync(proj, { recursive: true });
        writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'p', dependencies: {} }));
        if (claudeJson) writeFileSync(join(home, '.claude.json'), JSON.stringify(claudeJson(proj)));
        let out = '';
        try {
            out = execFileSync('node', [join(root, 'src/bin/doctor.mjs'), proj],
                { encoding: 'utf8', env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); }
        rmSync(home, { recursive: true, force: true });
        return out;
    };

    assert.match(mk(() => ({ mcpServers: { langsys: { type: 'http' } } })),
        /registered at user scope/, 'user scope');

    assert.match(mk((proj) => ({ projects: { [proj]: { mcpServers: { langsys: { type: 'http' } } } } })),
        /THIS project only/, 'project scope must be called out, not treated as fine');

    const absent = mk(() => ({ mcpServers: {} }));
    assert.match(absent, /claude mcp add --scope=user/, 'absent must give the command');
    assert.match(absent, /read-only/, 'and must say two keys, not one');
});

test('phantom-helpers: catches invented SDK helpers, stays quiet on real ones', async () => {
    // Three times in three commits a track called a locale helper that does not
    // exist. This guard exists for that; these are the actual regressions.
    const { phantomsIn, sdkExports } = await import('../src/lint/phantom-helpers.mjs');

    const known = new Set(['canonicalizeLocale', 'interpolate', 'detectPreferredLocale', 'getLocalesFlat', 't']);

    // POSITIVE — the three that shipped.
    assert.deepEqual(phantomsIn(`const l = resolveLocale(header);`, known), ['resolveLocale'],
        'resolveLocale shipped twice and must be caught');
    assert.deepEqual(phantomsIn(`const l = negotiate(header, OFFERED);`, known), [],
        'negotiate is not domain-shaped — documents the guard\'s real blind spot');
    assert.deepEqual(phantomsIn(`const x = pickTranslationFor(u);`, known), ['pickTranslationFor'],
        'domain-shaped invented helper');

    // NEGATIVE — the ones that would make the guard worse than useless.
    assert.deepEqual(phantomsIn(`import { canonicalizeLocale } from 'langsys-js-typescript';
canonicalizeLocale('en_us');`, known), [], 'real SDK export must not fire');
    assert.deepEqual(phantomsIn(`LangsysApp.detectPreferredLocale(h, S);`, known), [],
        'method call on an object is not a bare call');
    assert.deepEqual(phantomsIn(`const resolveLocale = (h) => h;\nresolveLocale('x');`, known), [],
        'defined in the same sample is fine');
    assert.deepEqual(phantomsIn(`// do not use getLocalesFlat() here\nconst a = 1;`, known), [],
        'comments describe, they do not call');
    assert.deepEqual(phantomsIn(`/* resolveLocale() is wrong */\nconst a = 1;`, known), [],
        'block comments too');
    assert.deepEqual(phantomsIn(`useEffect(() => {}, []);\nsetReady(true);`, known), [],
        'non-domain identifiers are out of scope by design');

    // The allowlist must come from the artifact, and must include class METHODS.
    const dts = join(root, 'node_modules/langsys-js-typescript/dist/index.d.ts');
    if (existsSync(dts)) {
        const real = sdkExports(dts);
        assert.ok(real.has('detectPreferredLocale'),
            'methods are not in the export line — an allowlist without them flags the real API');
    }
});

test('phantom-helpers: an unreadable allowlist must fail, not pass quietly', async () => {
    const { sdkExports } = await import('../src/lint/phantom-helpers.mjs');
    assert.equal(sdkExports('/nonexistent/index.d.ts'), null,
        'must return null so the caller can exit non-zero rather than report clean');
});

test('phantom-helpers: the allowlist parser must handle every export form', async () => {
    // The Svelte SDK agent hit this and warned me: their guard reported five
    // REAL re-exported types as invented, because their regex matched
    // `export { … }` but not `export type { … }`. Mine had the same bug plus a
    // worse one — it read only the LAST export statement. That is the failure
    // that gets a new checker deleted rather than debugged: a long list of
    // confident findings, all wrong, against the real API.
    const { sdkExports } = await import('../src/lint/phantom-helpers.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'langsys-dts-'));
    const write = (body) => {
        const p = join(dir, `${Math.random().toString(36).slice(2)}.d.ts`);
        writeFileSync(p, body);
        return p;
    };

    // Shape of langsys-js-svelte: many statements, types behind `export type`.
    const multi = sdkExports(write(`
export { currentlyLoadedLocale, sTranslations, tSignal as t, } from 'langsys-js-typescript';
export { canonicalizeLocale } from 'langsys-js-typescript';
export { default as Translate } from './components/Translate.svelte';
export type { iCountryList, iCategories, TFunction, };
export declare const LangsysApp: LangsysAppSvelte;
export type TStore = Readable<TFunction>;
declare class C {
    detectPreferredLocale(h?: string): string | false;
}
`));
    for (const n of ['currentlyLoadedLocale', 'canonicalizeLocale', 'Translate', 't',
                     'iCountryList', 'iCategories', 'LangsysApp', 'TStore', 'detectPreferredLocale']) {
        assert.ok(multi.has(n), `${n} must be recognised — reporting the real API as invented is the worse failure`);
    }
    assert.ok(!multi.has('tSignal'), '`tSignal as t` exports the alias, not the local name');

    // Shape of langsys-js-typescript: one combined statement, inline `type`.
    const single = sdkExports(write(`export { type EncodedRichText, LangsysApp, interpolate, t };`));
    assert.ok(single.has('EncodedRichText') && single.has('interpolate'),
        'inline `type` markers must be stripped');

    // A file with no exports must return null so the caller exits non-zero.
    assert.equal(sdkExports(write('declare const x: number;\n')), null,
        'no exports found must be null, not an empty allowlist that flags everything');

    rmSync(dir, { recursive: true, force: true });
});

test('install: unknown options are rejected, not silently ignored', () => {
    // `--target=claude` looks like a real flag (the real one is `--host=`), and
    // used to install to EVERY detected host while reporting success.
    const run = (extra) => {
        const dir = mkdtempSync(join(tmpdir(), 'langsys-inst-'));
        let out = '', code = 0;
        try {
            out = execFileSync('node', [join(root, 'src/bin/install.mjs'), '-n', '--dir=' + dir, ...extra],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); code = e.status; }
        rmSync(dir, { recursive: true, force: true });
        return { out, code };
    };

    // POSITIVE — the typo that motivated this.
    const bad = run(['--target=claude']);
    assert.equal(bad.code, 2, 'an unknown option must be a non-zero exit, not a wider install');
    assert.match(bad.out, /unknown option --target=claude/);
    assert.match(bad.out, /--host=/, 'must show the flag they probably meant');
    // Match the install SUMMARY ("6 written, 0 unchanged."), not the word
    // "written" — which appears in --dry-run's own help text.
    assert.doesNotMatch(bad.out, /\d+ written/, 'must not report an install it did not scope');
    assert.doesNotMatch(bad.out, /hosts:/, 'must not proceed far enough to resolve hosts');

    assert.equal(run(['--wibble']).code, 2, 'unknown bare flag');
    assert.equal(run(['--no-such=1']).code, 2, 'unknown valued flag');

    // NEGATIVE — every real option must still be accepted.
    for (const ok of [[], ['--host=claude'], ['--host=claude,codex'], ['-g'], ['--global'], ['-n']]) {
        assert.equal(run(ok).code, 0, `real option must be accepted: ${ok.join(' ') || '(none)'}`);
    }
});
