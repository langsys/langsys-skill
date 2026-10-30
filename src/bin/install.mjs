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

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, cpSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopePaths as scopePathsFor } from './lib/scope-paths.mjs';
import { discoverSkills, filesUnder } from './lib/discover-skills.mjs';
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

/**
 * Byte-for-byte copy, for files this package did not author.
 *
 * An SDK's `skill/` directory is copied whole, and that is not all markdown: a
 * diagram, an image or any other asset goes with it. Reading those as UTF-8
 * replaces every invalid sequence with U+FFFD, so the copy differs from the
 * source — and since the manifest hashes raw bytes, doctor would then report
 * the file as EDITED, forever, on a copy nobody touched, and advise a
 * re-install that cannot fix it.
 *
 * Comparing buffers also keeps the unchanged-install report honest for those
 * files, which a string comparison of mangled text would not.
 */
function writeBytes(path, bytes) {
    if (existsSync(path) && readFileSync(path).equals(bytes)) {
        skipped.push(path);
        return;
    }
    if (!dryRun) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, bytes);
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

    // Decide "changed" BEFORE writing anything.
    //
    // The previous version compared after cpSync had already run, so it was
    // comparing the file it had just written against the content it had just
    // written it from — always equal. Every install, including the very first
    // into an empty directory, reported the payload as unchanged. The honesty
    // this reporting exists for was therefore absent in exactly the case it
    // matters: an upgrade that rewrote the whole payload looked like a no-op.
    const expect = scopePaths(readFileSync(join(src, 'SKILL.md'), 'utf8'));
    const landed = join(payloadDir, 'SKILL.md');
    const changed = !existsSync(landed) || readFileSync(landed, 'utf8') !== expect;

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
    // Report honestly: a re-install that changes nothing should not read as a
    // write. `expect` is what WOULD be written — the scoped source, not the raw
    // source — because the payload is rewritten for scope after copying, and
    // comparing against the raw file would make every re-run report as changed.
    (changed ? written : skipped).push(`${payloadDir}/ (payload, ${countFiles(src)} files)`);
}

function countFiles(dir) {
    let n = 0;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1;
    }
    return n;
}

// ── per-SDK skills ───────────────────────────────────────────────────────────
//
// Each Langsys SDK ships its own skill in `skill/`, written by the lane that
// writes the code and released with it. This installs the entry skill AND those,
// so an agent reads guidance for the exact version the project has.
//
// COPIED, NEVER LINKED. A symlink would silently re-point when the package
// upgrades, so an agent mid-task could have the document change underneath it,
// and nothing would record which version the work was done against. A copy goes
// stale instead — visibly, because the manifest records what was copied and
// doctor compares it with what is installed now. A stale copy you can see beats
// a live one you cannot pin.

const SKILLS_DIR = () => join(base, '.langsys', 'skills');
const MANIFEST = () => join(base, '.langsys', 'skills.json');
/** Where a named skill lives for Claude Code, in the scope being installed. */
const claudeSkillDir = (n) => (isGlobal
    ? join(homedir(), '.claude', 'skills', n)
    : join(base, '.claude', 'skills', n));

// Discovery runs against the PROJECT, even under --global: skills belong to the
// packages a project installed, and a home directory has no node_modules. The
// payload's scope is a separate question from where the SDKs are.
const discovered = discoverSkills(target);

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16);

/** A line for the managed block, so hosts without a skills folder can still find them. */
function installedSkillsNote() {
    if (discovered.skills.length === 0) return '';
    const lines = discovered.skills
        .map((s) => `- \`${s.name}\` (${s.package ?? s.origin} ${s.declares ?? '?'}) — \`${LS()}/skills/${s.name}/SKILL.md\``)
        .join('\n');
    return `\n\nThe skills of the Langsys packages this project installed are copied beside this payload:\n\n${lines}`;
}

/**
 * Remove the copies of skills that are no longer installed.
 *
 * Without this, uninstalling an SDK leaves its skill behind in BOTH directions
 * of wrong: the agent can still read a document for a package the project does
 * not have, and doctor cannot tell — its orphan check walks the manifest, which
 * no longer lists the skill, so the stale copy is simultaneously live and
 * invisible. That is the exact inverse of the guarantee this design rests on,
 * which is that a copy goes stale VISIBLY.
 *
 * Only directories a previous manifest recorded are removed, never whatever
 * happens to sit under the skills folder. The manifest is the record of what
 * this installer wrote, so it is also the only safe licence to delete: a
 * directory we never claimed might be someone's own skill, and guessing from
 * the name would eventually delete one.
 */
function pruneRemovedSkills(keep) {
    const prev = existsSync(MANIFEST())
        ? (() => { try { return JSON.parse(readFileSync(MANIFEST(), 'utf8')); } catch { return null; } })()
        : null;
    if (!prev?.skills) return [];

    const gone = [];
    for (const rec of prev.skills) {
        if (keep.has(rec.name)) continue;
        for (const dir of [join(SKILLS_DIR(), rec.name), claudeSkillDir(rec.name)]) {
            if (!existsSync(dir)) continue;
            if (!dryRun) rmSync(dir, { recursive: true, force: true });
            gone.push(dir);
        }
    }
    return gone;
}

function installSkills() {
    const manifest = { version: VERSION, installed: new Date().toISOString(), skills: [], conflicts: [] };
    const removed = pruneRemovedSkills(new Set(discovered.skills.map((s) => s.name)));

    for (const s of discovered.skills) {
        const dest = join(SKILLS_DIR(), s.name);
        const files = filesUnder(s.dir);
        for (const f of files) {
            const from = join(s.dir, f);
            // Bytes, not text: `skill/` may hold assets as well as markdown.
            writeBytes(join(dest, f), readFileSync(from));
        }
        manifest.skills.push({
            name: s.name,
            package: s.package ?? s.origin,
            // `declares` is what the SKILL says it describes; `installed` is what
            // is actually in node_modules/vendor. Recording BOTH is the point:
            // doctor cannot tell a stale copy from a skill the SDK shipped out of
            // step with itself unless it can see the two separately.
            declares: s.declares,
            installed: s.installed,
            from: relative(target, s.dir),
            to: relative(base, dest),
            files: Object.fromEntries(files.map((f) => [f, sha(join(s.dir, f))])),
        });
    }

    for (const c of discovered.conflicts) {
        manifest.conflicts.push({
            name: c.name,
            installed: c.installed,
            at: relative(target, c.dir),
            shadowedBy: { installed: c.shadowedBy.installed, at: relative(target, c.shadowedBy.dir) },
        });
    }

    manifest.removed = removed.map((d) => relative(base, d));

    if (!dryRun) {
        mkdirSync(dirname(MANIFEST()), { recursive: true });
        writeFileSync(MANIFEST(), JSON.stringify(manifest, null, 2) + '\n');
    }
    return manifest;
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
const CORE = () => scopePaths(`## Langsys — critical rules

Langsys discovers phrases from your running app. **The source text is the key** — there are no catalog files in the repo. If you know i18next, several instincts are wrong here.

This is the entry skill, step 1 of three. Step 2 is the core skill of the SDK's language (\`langsys-typescript\`, \`langsys-php\`), step 3 the framework's own (\`langsys-svelte\`, \`langsys-laravel\`, …). **Never skip a step** — a framework skill lists only what its framework changes.${installedSkillsNote()}

**1. Never build a phrase string.** Interpolated phrases register a NEW catalog entry per value, permanently polluting shared state. The SDK cannot detect this.
\`\`\`
t(\`Hello, \${name}!\`)                  ❌      t('Hello, {name}!', 'UI', { name })   ✅
translate(sprintf('Hi, %s', $n))     ❌      translate('Hi, {n}', null, null, null, ['n' => $n])  ✅
t(article.title, 'Blog')             ✅      passing content through is not building it
\`\`\`
The test is **cardinality, not syntax**: per-visitor values pollute, a bounded editorial set is the content you meant to translate. Copy from a CMS, a database or a third-party API needs no special handling — the client SDK treats it exactly like copy in the component.

**2. The source text is the key.** No \`locales/en.json\`, no dot-keys. \`t('home.welcome')\` registers the literal string "home.welcome". Laravel is the deliberate exception: there the key resolves to its line in your base-language file, and that sentence is the phrase.

**3. Phrase first, category second** — \`t(phrase, category?, params?)\`. Both orders typecheck; the compiler will not catch a reversal.

**4. \`%name%\` in markup, \`{name}\` in \`t()\` strings.** Framework compilers eat \`{name}\` in markup before the SDK sees it. Silent failure — the base language still looks correct. Inside a \`t()\` string literal \`{name}\` is right, even when that call sits inside markup. (Svelte 4's build transform changes this one; its own skill says so.)

**5. Pick the right primitive**, by asking whether a tag boundary belongs to the language or the layout.
- a plain \`t()\` call — plain string, no markup
- the keep-together primitive — ONE sentence containing inline markup
- the splitting primitive — a BLOCK of markup, tokenized per node

Splitting a sentence that contains \`<strong>\` shreds it and makes the plural unexpressible in Russian, Arabic and Polish, while rendering perfectly in the base language.

**6. The server decides whether a session may register**, not the key's type. An answer without that decision is read-only even for a write key; an \`ip_write\` key writes only from an allow-listed address; an app behind a login needs per-user write grants. A read-only session reports a page's URL and Langsys records it — **recording is not registering**, and nothing reaches the catalog until a write-enabled session renders the page.

**7. Write key in development, read-only or \`ip_write\` in production**, and match the env var prefix to the bundler.

## Procedure

1. Run \`node .langsys/bin/scan.mjs .\` — profile, conversion sites by primitive, effort split. Read its NOT EXAMINED section; the totals are only as complete as that section says. Then \`node .langsys/bin/doctor.mjs\`
2. Read \`${rel}/choosing-sdks.md\`, then \`${rel}/sdk-versions.md\` **before installing anything** — which core a binding brings decides which rules apply
3. Set up the project and keys: \`${rel}/projects-and-keys.md\`. Also the answer to "nothing is registering"
4. Read the step-2 core skill, then step 3. No step-2 skill installed? \`${rel}/sdk-versions.md\` says what to read instead, and \`${rel}/pinned/\` holds the guides that are still here
5. Two renderers, such as a PHP backend and a JS frontend? \`${rel}/two-languages.md\` first
6. Verify with \`${rel}/verify.md\` — including reading the registered phrase set`);

// ── shims ────────────────────────────────────────────────────────────────────

const shims = {
    claude() {
        const dir = isGlobal ? join(homedir(), '.claude', 'skills', 'langsys') : join(base, '.claude', 'skills', 'langsys');
        const payload = readFileSync(join(pkgRoot, 'src', 'skill', 'SKILL.md'), 'utf8');
        // Claude supports progressive disclosure, so the shim is the router itself
        // with links resolved to the installed payload.
        // Two rewrites, because the shim lives at a third location: `./` links
        // point into the payload, and `../VERIFIED.md` points beside it. The
        // payload's own copy stays correct for readers who open it directly.
        const root_ = isGlobal ? '~/.langsys' : '../../../.langsys';
        write(join(dir, 'SKILL.md'), scopePaths(payload
            .replace(/\]\(\.\.\/VERIFIED\.md\)/g, `](${root_}/VERIFIED.md)`)
            .replace(/\]\(\.\//g, `](${root_}/skill/`)));

        // Two standalone entry points, because both answer a question someone
        // asks WITHOUT wanting an integration: "how big is this job?" and "why
        // isn't this working?". Routing those through /langsys means starting a
        // conversion to ask a question about one.
        //
        // They are thin routers over the same payload, never copies of it — a
        // second copy of the guidance is a second thing to go stale, and this
        // project has a whole section on what stranded copies cost.
        const shimDir = claudeSkillDir;
        for (const n of ['scan', 'doctor']) {
            write(join(shimDir(`langsys-${n}`), 'SKILL.md'),
                  scopePaths(readFileSync(join(pkgRoot, 'src', 'shims', `${n}.md`), 'utf8')));
        }

        // Each SDK's own skill becomes a real Claude skill, so progressive
        // disclosure reaches it by name. Copied verbatim: the SDK's lane owns
        // the text, and rewriting it here would make this package the source of
        // a document it does not maintain.
        for (const s of discovered.skills) {
            const dir_ = shimDir(s.name);
            for (const f of filesUnder(s.dir)) {
                writeBytes(join(dir_, f), readFileSync(join(s.dir, f)));
            }
        }
    },
    codex() {
        // Global scope: Codex reads ~/.codex/AGENTS.md. Never drop AGENTS.md in
        // the home directory root — that is the user's filesystem, not a project.
        writeManagedBlock(isGlobal ? join(base, '.codex', 'AGENTS.md') : join(base, 'AGENTS.md'), CORE());
        write(join(base, '.codex', 'prompts', 'langsys.md'),
            `# /langsys\n\nIntegrate or migrate this project onto the Langsys translation SDK.\n\n${CORE()}\n`);
    },
    gemini() {
        // Same reasoning as codex(): global scope belongs under ~/.gemini/.
        writeManagedBlock(isGlobal ? join(base, '.gemini', 'GEMINI.md') : join(base, 'GEMINI.md'), CORE());
        write(join(base, '.gemini', 'commands', 'langsys.toml'),
            `description = "Integrate or migrate this project onto the Langsys translation SDK"\n\nprompt = """\n${CORE().replace(/"""/g, '\\"\\"\\"')}\n"""\n`);
    },
    cursor() {
        write(join(base, '.cursor', 'rules', 'langsys.mdc'),
            `---\ndescription: Langsys translation SDK integration and migration\nglobs: ["**/*.{ts,tsx,js,jsx,vue,svelte,php}"]\nalwaysApply: false\n---\n\n${CORE()}\n`);
    },
    generic() {
        // Same rule as codex() and gemini(), and this is the shim most likely to
        // hit it: `generic` is the fallback when NO host is detected, which is
        // exactly a fresh machine running --global. Writing ~/AGENTS.md there
        // drops a file in the user's home root — their filesystem, not a
        // project. Global scope keeps it beside the payload instead.
        writeManagedBlock(isGlobal ? join(base, '.langsys', 'AGENTS.md') : join(base, 'AGENTS.md'), CORE());
    },
};

// ── run ──────────────────────────────────────────────────────────────────────

installPayload();
const manifest = installSkills();
for (const h of hosts) {
    if (!shims[h]) {
        console.error(`Unknown host "${h}". Known: ${Object.keys(shims).join(', ')}`);
        process.exit(2);
    }
    shims[h]();
}

console.log(`\nlangsys-skill v${VERSION} — ${isGlobal ? 'global' : 'project'} install${dryRun ? ' (dry run)' : ''}`);
console.log(`  base:  ${base}`);
console.log(`  hosts: ${hosts.join(', ')}`);
if (manifest.skills.length) {
    console.log(`  SDK skills: ${manifest.skills.map((s) => `${s.name}@${s.declares ?? '?'}`).join(', ')}`);
} else {
    // Say it plainly. "No SDK skills" and "every SDK skill installed" produce the
    // same quiet success otherwise, and the first one means the agent will be
    // working from this package's pinned guides instead.
    console.log('  SDK skills: none found — no installed Langsys package ships one yet.');
    console.log('              Agents will use the pinned guides in the payload; check');
    console.log('              their versions against what is installed.');
}
console.log();
for (const p of written) console.log(`  + ${p.replace(base + '/', '')}`);
for (const p of manifest.removed ?? []) console.log(`  - ${p} (package no longer installed)`);
for (const p of skipped) console.log(`  = ${p.replace(base + '/', '')} (unchanged)`);
console.log(`\n${written.length} written, ${skipped.length} unchanged.`);

for (const c of manifest.conflicts) {
    console.log(`\n  ! Two versions of ${c.name} are installed: ${c.shadowedBy.installed} at ${c.shadowedBy.at}`);
    console.log(`    and ${c.installed} at ${c.at}. Only the first was copied.`);
    console.log('    This is a hazard in the project, not just here: two copies of one core are');
    console.log('    separate module instances, with separate catalogs and registration queues.');
}

if (!dryRun) console.log(`\nNext: node ${BIN()}/doctor.mjs\n`);
