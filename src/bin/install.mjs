#!/usr/bin/env node
/**
 * langsys-skill installer.
 *
 * Writes ONE canonical markdown payload, then generates thin per-host shims that
 * point into it. Claude Code gets progressive disclosure; Codex/Gemini/Cursor have
 * no equivalent, so their entry docs inline the rules that must not be missed.
 *
 *   npx langsys-skill install                 # project scope, auto-detect hosts
 *   npx langsys-skill install --global        # user scope
 *   npx langsys-skill install --host=claude,codex
 *   npx langsys-skill install --dry-run
 *
 * Re-running is safe: shared files are edited only between managed markers, and
 * an unchanged install rewrites byte-identical content.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopePaths as scopePathsFor } from './lib/scope-paths.mjs';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..', '..');
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const START = (v) => `<!-- langsys:skill:start v${v} -->`;

/**
 * Where the installed tools actually live, for the scope being installed.
 *
 * A global install puts the payload under the HOME directory, so a project-
 * relative `node .langsys/bin/...` resolves to a path that does not exist and
 * the agent's very first instruction fails with "Cannot find module". The
 * markdown LINKS were already rewritten per scope; the COMMANDS were not, so
 * the shim pointed at documentation correctly and at tools incorrectly.
 */
const LS = () => (isGlobal ? '~/.langsys' : '.langsys');
const BIN = () => `${LS()}/bin`;
const scopePaths = (text) => scopePathsFor(text, isGlobal);
const END = '<!-- langsys:skill:end -->';
const ANY_BLOCK = /<!-- langsys:skill:start v[^>]*-->[\s\S]*?<!-- langsys:skill:end -->\n?/g;

// ── args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2).filter((a) => a !== 'install');
const SHORT = { global: '-g', 'dry-run': '-n' };
const flag = (n) => args.some((a) => a === `--${n}` || (SHORT[n] && a === SHORT[n]));
const value = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];

/**
 * Reject unknown options instead of ignoring them.
 *
 * `--target=claude` looks exactly like a flag this tool would have — the real
 * one is `--host=`, and `--dir=` is the one that takes a path — so a typo used
 * to install to EVERY detected host while reporting success. The user believes
 * they scoped the install; they got a wider one, and nothing said otherwise.
 * That is this project's own failure class: no signal reads as a pass.
 */
const KNOWN_FLAGS = ['global', 'dry-run', 'help'];
const KNOWN_VALUES = ['host', 'dir'];
const KNOWN_SHORT = Object.values(SHORT);

const unknown = args.filter((a) => {
    if (!a.startsWith('-')) return false;
    if (KNOWN_SHORT.includes(a)) return false;
    const name = a.replace(/^--?/, '').split('=')[0];
    return !KNOWN_FLAGS.includes(name) && !KNOWN_VALUES.includes(name);
});

if (unknown.length) {
    console.error(`langsys-skill: unknown option${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}\n`);
    console.error('  --host=claude,codex   install for specific hosts (default: auto-detect)');
    console.error('  --dir=<path>          install into <path> (default: cwd)');
    console.error('  --global, -g          install for all projects, into your home directory');
    console.error('  --dry-run, -n         show what would be written, write nothing');
    process.exit(2);
}

const isGlobal = flag('global');
const dryRun = flag('dry-run');
if (isGlobal && value('dir') !== undefined) {
    console.error('langsys-skill: --global and --dir are mutually exclusive.\n');
    console.error('  --global installs into your home directory; --dir would be ignored.');
    console.error('  Drop one. Silently ignoring --dir would leave you believing the install was scoped.');
    process.exit(2);
}
const target = resolve(value('dir') ?? process.cwd());
const base = isGlobal ? homedir() : target;

const written = [];
const skipped = [];

function write(path, content) {
    if (existsSync(path) && readFileSync(path, 'utf8') === content) {
        skipped.push(path);
        return;
    }
    if (!dryRun) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
    }
    written.push(path);
}

/** Replace only the managed block, preserving everything the user wrote. */
function writeManagedBlock(path, body) {
    // scopePaths here rather than at each call site: every host writes CORE,
    // and a host added later would otherwise inherit the project-relative
    // paths silently — correct under a project install, broken under -g.
    const block = `${START(VERSION)}\n${scopePaths(body)}\n${END}\n`;
    let next;
    if (existsSync(path)) {
        const existing = readFileSync(path, 'utf8');
        next = ANY_BLOCK.test(existing)
            ? existing.replace(ANY_BLOCK, block)
            : existing.trimEnd() + '\n\n' + block;
    } else {
        next = block;
    }
    write(path, next);
}

/** Every .md under a directory, recursively. */
function walkMarkdown(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walkMarkdown(p, out);
        else if (e.name.endsWith('.md')) out.push(p);
    }
    return out;
}

// ── payload ──────────────────────────────────────────────────────────────────

const payloadDir = join(base, '.langsys', 'skill');

function installPayload() {
    const src = join(pkgRoot, "src", "skill");
    if (!dryRun) {
        mkdirSync(payloadDir, { recursive: true });
        cpSync(src, payloadDir, { recursive: true });
        cpSync(join(pkgRoot, 'src', 'lint'), join(base, '.langsys', 'lint'), {
            recursive: true,
            filter: (p) => !p.includes('__tests__'),
        });
        cpSync(join(pkgRoot, 'src', 'bin'), join(base, '.langsys', 'bin'), { recursive: true });
        cpSync(join(pkgRoot, 'VERIFIED.md'), join(base, '.langsys', 'VERIFIED.md'));

        // The payload is copied verbatim, so its own embedded commands were
        // never scoped. Under -g that routed the agent to documents whose
        // executable lines pointed at a project path that does not exist —
        // verify.md's ast-grep invocation being the live case, since CORE and
        // SKILL.md both link to it. Rewrite after copying, so the source tree
        // keeps the project-relative form that is correct for it.
        for (const f of walkMarkdown(payloadDir)) {
            const before = readFileSync(f, 'utf8');
            const after = scopePaths(before);
            if (after !== before) writeFileSync(f, after);
        }
    }
    // Report honestly: a re-install that changes nothing should not read as a write.
    // Compare against what WOULD be written — the scoped source — not the raw
    // source. The payload is rewritten for scope after copying, so comparing to
    // the raw file makes every re-run report as changed, and "0 written" stops
    // meaning anything.
    const changed = !existsSync(join(payloadDir, 'SKILL.md')) ||
        readFileSync(join(payloadDir, 'SKILL.md'), 'utf8') !== scopePaths(readFileSync(join(src, 'SKILL.md'), 'utf8'));
    (changed ? written : skipped).push(`${payloadDir}/ (payload, ${countFiles(src)} files)`);
}

function countFiles(dir) {
    let n = 0;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1;
    }
    return n;
}

// ── host detection ───────────────────────────────────────────────────────────

const HOSTS = {
    claude: () => existsSync(join(base, '.claude')) || existsSync(join(homedir(), '.claude')),
    codex: () => existsSync(join(base, '.codex')) || existsSync(join(homedir(), '.codex')) || existsSync(join(base, 'AGENTS.md')),
    gemini: () => existsSync(join(base, '.gemini')) || existsSync(join(homedir(), '.gemini')) || existsSync(join(base, 'GEMINI.md')),
    cursor: () => existsSync(join(base, '.cursor')),
    generic: () => false,
};

const requested = value('host')?.split(',').map((s) => s.trim());
const hosts = requested ?? Object.keys(HOSTS).filter((h) => HOSTS[h]());
if (hosts.length === 0) hosts.push('generic');

// ── shared shim content ──────────────────────────────────────────────────────

const rel = isGlobal ? '~/.langsys/skill' : '.langsys/skill';

/** The rules that must survive even where nothing else is read. */
// Scoped at CONSTRUCTION, not at each write.
//
// The previous version scoped inside writeManagedBlock() and claimed that
// prevented a later host from inheriting project-relative paths. That was
// already false when written: codex(), gemini() and cursor() interpolate CORE
// through a bare write(), so three of five hosts shipped the exact bug the
// change was fixing — in the same file whose doc links two lines above were
// rewritten correctly. Scoping the SOURCE closes it for every consumer,
// however they choose to write it.
const CORE = scopePaths(`## Langsys — critical rules

Langsys discovers phrases from your running app. **The source text is the key** — there are no catalog files in the repo. If you know i18next, several instincts are wrong here.

**1. Never build a phrase string.** Interpolated phrases register a NEW catalog entry per value, permanently polluting shared state. The SDK cannot detect this.
\`\`\`
t(\`Hello, \${name}!\`)                  ❌      t('Hello, {name}!', 'UI', { name })   ✅
translate(sprintf('Hi, %s', $n))     ❌      translate('Hi, {n}', null, null, null, ['n' => $n])  ✅
\`\`\`

**2. The phrase is the key.** No \`locales/en.json\`, no dot-keys. \`t('home.welcome')\` registers the literal string "home.welcome".

**3. Phrase first, category second** — \`t(phrase, category?, params?)\`. Both orders typecheck; the compiler will not catch a reversal.

**4. \`%name%\` in markup, \`{name}\` in \`t()\` strings.** Framework compilers eat \`{name}\` in markup before the SDK sees it. Silent failure — the base language still looks correct. Inside a \`t()\` string literal \`{name}\` is right, even when that call sits inside markup.

**5. Pick the right primitive.**
- \`t()\` — plain string, no markup
- \`<Phrase>\` — ONE sentence containing inline markup; keeps it whole
- \`<Translate>\` — a BLOCK of markup; splits it into per-node phrases

Using \`<Translate>\` on a sentence with \`<strong>\` in it shreds the sentence and breaks pluralization in Russian, Arabic and Polish. All three bindings (React, Vue, Svelte) export \`<Phrase>\` and \`<DontTranslate>\`.

**6. Write key in development, read-only key in production.**

## Procedure

1. Read \`${rel}/core/choosing-primitives.md\` and \`${rel}/core/invariants.md\`
2. Run \`node .langsys/bin/scan.mjs .\` — profile, conversion sites by primitive, effort split. Read its NOT EXAMINED section; the totals are only as complete as that section says. Then \`node .langsys/bin/doctor.mjs\`
3. Follow \`${rel}/detect.md\` to confirm the profile and settle the base locale
4. Route: \`${rel}/integrate/{react,vue,svelte,vanilla-ts,php}.md\` (+ \`${rel}/ssr/*.md\` if server-rendered)
5. Migrating off another i18n library? \`${rel}/migrate/_method.md\` FIRST
6. Verify with \`${rel}/verify.md\` — including inspecting the registered phrase set`);

// ── shims ────────────────────────────────────────────────────────────────────

const shims = {
    claude() {
        const dir = isGlobal ? join(homedir(), '.claude', 'skills', 'langsys') : join(base, '.claude', 'skills', 'langsys');
        const payload = readFileSync(join(pkgRoot, 'src', 'skill', 'SKILL.md'), 'utf8');
        // Claude supports progressive disclosure, so the shim is the router itself
        // with links resolved to the installed payload.
        write(join(dir, 'SKILL.md'), scopePaths(payload.replace(/\]\(\.\//g, `](${isGlobal ? '~/.langsys/skill' : '../../../.langsys/skill'}/`)));

        // Two standalone entry points, because both answer a question someone
        // asks WITHOUT wanting an integration: "how big is this job?" and "why
        // isn't this working?". Routing those through /langsys means starting a
        // conversion to ask a question about one.
        //
        // They are thin routers over the same payload, never copies of it — a
        // second copy of the guidance is a second thing to go stale, and this
        // project has a whole section on what stranded copies cost.
        const shimDir = (n) => (isGlobal
            ? join(homedir(), '.claude', 'skills', n)
            : join(base, '.claude', 'skills', n));
        for (const n of ['scan', 'doctor']) {
            write(join(shimDir(`langsys-${n}`), 'SKILL.md'),
                  scopePaths(readFileSync(join(pkgRoot, 'src', 'shims', `${n}.md`), 'utf8')));
        }
    },
    codex() {
        // Global scope: Codex reads ~/.codex/AGENTS.md. Never drop AGENTS.md in
        // the home directory root — that is the user's filesystem, not a project.
        writeManagedBlock(isGlobal ? join(base, '.codex', 'AGENTS.md') : join(base, 'AGENTS.md'), CORE);
        write(join(base, '.codex', 'prompts', 'langsys.md'),
            `# /langsys\n\nIntegrate or migrate this project onto the Langsys translation SDK.\n\n${CORE}\n`);
    },
    gemini() {
        // Same reasoning as codex(): global scope belongs under ~/.gemini/.
        writeManagedBlock(isGlobal ? join(base, '.gemini', 'GEMINI.md') : join(base, 'GEMINI.md'), CORE);
        write(join(base, '.gemini', 'commands', 'langsys.toml'),
            `description = "Integrate or migrate this project onto the Langsys translation SDK"\n\nprompt = """\n${CORE.replace(/"""/g, '\\"\\"\\"')}\n"""\n`);
    },
    cursor() {
        write(join(base, '.cursor', 'rules', 'langsys.mdc'),
            `---\ndescription: Langsys translation SDK integration and migration\nglobs: ["**/*.{ts,tsx,js,jsx,vue,svelte,php}"]\nalwaysApply: false\n---\n\n${CORE}\n`);
    },
    generic() {
        // Same rule as codex() and gemini(), and this is the shim most likely to
        // hit it: `generic` is the fallback when NO host is detected, which is
        // exactly a fresh machine running --global. Writing ~/AGENTS.md there
        // drops a file in the user's home root — their filesystem, not a
        // project. Global scope keeps it beside the payload instead.
        writeManagedBlock(isGlobal ? join(base, '.langsys', 'AGENTS.md') : join(base, 'AGENTS.md'), CORE);
    },
};

// ── run ──────────────────────────────────────────────────────────────────────

installPayload();
for (const h of hosts) {
    if (!shims[h]) {
        console.error(`Unknown host "${h}". Known: ${Object.keys(shims).join(', ')}`);
        process.exit(2);
    }
    shims[h]();
}

console.log(`\nlangsys-skill v${VERSION} — ${isGlobal ? 'global' : 'project'} install${dryRun ? ' (dry run)' : ''}`);
console.log(`  base:  ${base}`);
console.log(`  hosts: ${hosts.join(', ')}\n`);
for (const p of written) console.log(`  + ${p.replace(base + '/', '')}`);
for (const p of skipped) console.log(`  = ${p.replace(base + '/', '')} (unchanged)`);
console.log(`\n${written.length} written, ${skipped.length} unchanged.`);
if (!dryRun) console.log(`\nNext: node ${BIN()}/doctor.mjs\n`);
