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
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..', '..');
const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const START = (v) => `<!-- langsys:skill:start v${v} -->`;
const END = '<!-- langsys:skill:end -->';
const ANY_BLOCK = /<!-- langsys:skill:start v[^>]*-->[\s\S]*?<!-- langsys:skill:end -->\n?/g;

// ── args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2).filter((a) => a !== 'install');
const SHORT = { global: '-g', 'dry-run': '-n' };
const flag = (n) => args.some((a) => a === `--${n}` || (SHORT[n] && a === SHORT[n]));
const value = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];

const isGlobal = flag('global');
const dryRun = flag('dry-run');
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
    const block = `${START(VERSION)}\n${body}\n${END}\n`;
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
    }
    // Report honestly: a re-install that changes nothing should not read as a write.
    const changed = !existsSync(join(payloadDir, 'SKILL.md')) ||
        readFileSync(join(payloadDir, 'SKILL.md'), 'utf8') !== readFileSync(join(src, 'SKILL.md'), 'utf8');
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
const CORE = `## Langsys — critical rules

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
6. Verify with \`${rel}/verify.md\` — including inspecting the registered phrase set`;

// ── shims ────────────────────────────────────────────────────────────────────

const shims = {
    claude() {
        const dir = isGlobal ? join(homedir(), '.claude', 'skills', 'langsys') : join(base, '.claude', 'skills', 'langsys');
        const payload = readFileSync(join(pkgRoot, 'src', 'skill', 'SKILL.md'), 'utf8');
        // Claude supports progressive disclosure, so the shim is the router itself
        // with links resolved to the installed payload.
        write(join(dir, 'SKILL.md'), payload.replace(/\]\(\.\//g, `](${isGlobal ? '~/.langsys/skill' : '../../../.langsys/skill'}/`));
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
if (!dryRun) console.log(`\nNext: node .langsys/bin/doctor.mjs\n`);
