#!/usr/bin/env node
/**
 * langsys-skill doctor — preflight/postflight sanity for a Langsys integration.
 *
 * Checks what the SDK cannot check for itself: whether the env var prefix matches
 * the bundler, whether a write key is about to ship to production, whether the
 * installed SDK is new enough for the behavior the skill teaches, and whether the
 * PHP runtime meets a floor that Composer would otherwise enforce.
 *
 * Exit codes: 0 = pass (warnings allowed), 1 = at least one error.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { discoverSkills } from './lib/discover-skills.mjs';
import { homedir } from 'node:os';

const root = resolve(process.argv[2] ?? process.cwd());

/** Minimum base SDK exposing the unmatched-params debug warning. */
const WARN_FLOOR = '0.4.3';   // unmatched-params warning floor (unchanged by 0.5.0)
/**
 * The versions THIS package's own pinned guides were verified against.
 *
 * An exact match, not a floor. These guides exist only for SDKs that do not yet
 * ship a skill of their own, and a guide one minor behind reads as
 * authoritative while being wrong in the places that fail silently — locale
 * case, who may register, whether a config field exists. So "close" is not a
 * pass: outside the pin, the answer is that package's README.
 *
 * Packages absent from this map are expected to carry their own skill. When one
 * does, its skill wins over anything here; when it does not, there is no guide
 * for it and doctor says so rather than substituting a neighbour's.
 */
const PINNED = {
    'langsys-js-react': '0.6.7',
    'langsys-js-vue': '0.2.1',
    'langsys-js-server': '0.1.0',
    'langsys/langsys-php-laravel': '1.0.0',
};

/** Base SDK the pinned React/Vue guides describe. */
const PINNED_CORE = '0.6.5';

/**
 * Minimum base-SDK caret each binding must declare. A binding whose range caps
 * below a fix ships that fix to nobody: Vue's `^0.4.1` capped at 0.4.3, so every
 * base fix from 0.5.0 on was structurally unreachable for its consumers no
 * matter what the docs said. The range is part of the API surface.
 */
const BASE_CARET_FLOOR = {
    'langsys-js-react': '0.6.5',
    'langsys-js-svelte': '0.6.4',
    'langsys-js-vue': '0.6.5',
};

const results = [];
const ok = (m, d) => results.push({ level: 'ok', m, d });
const warn = (m, d) => results.push({ level: 'warn', m, d });
const err = (m, d) => results.push({ level: 'error', m, d });
const info = (m, d) => results.push({ level: 'info', m, d });

const readJson = (p) => {
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
};
const readText = (p) => {
    try { return readFileSync(p, 'utf8'); } catch { return null; }
};

/** Compare dotted numeric versions. Returns -1 | 0 | 1. */
function cmpVersion(a, b) {
    const pa = String(a).replace(/^[^\d]*/, '').split('.').map(Number);
    const pb = String(b).replace(/^[^\d]*/, '').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] ?? 0, y = pb[i] ?? 0;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

// ── Project shape ────────────────────────────────────────────────────────────

const pkg = readJson(join(root, 'package.json'));
const composer = readJson(join(root, 'composer.json'));

if (!pkg && !composer) {
    err('No package.json or composer.json found', `Looked in ${root}`);
    report();
    process.exit(1);
}

const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
const has = (n) => Object.prototype.hasOwnProperty.call(deps, n);

// ── Which binding, and is it the right one? ──────────────────────────────────

const bindings = ['langsys-js-react', 'langsys-js-vue', 'langsys-js-svelte', 'langsys-js-typescript']
    .filter(has);

/**
 * Where this project's guidance for a package comes from, and whether it fits.
 *
 * Three outcomes, and the third is the one that was missing: a package with no
 * pinned guide here used to produce NO output at all, because the only read of
 * `PINNED` sat inside a loop over four hardcoded binding names. So a Laravel or
 * `langsys-js-server` project got no pin check while this package ships guides
 * claiming exact versions for both, and a vanilla-TS project was told nothing
 * about which guidance applies. Silence is what every check in this file exists
 * to prevent; it is also the hardest state to notice, because it looks like a
 * pass.
 */
function reportPin(name, v) {
    const pinned = PINNED[name];
    if (!pinned) {
        info(`${name}@${v}: no pinned guide here — read its own skill`,
             `This package is expected to ship its own skill. If it is not among your skills, ` +
             `read ${name}'s README for ${v} rather than a guide written for another version.`);
        return;
    }
    if (cmpVersion(v, pinned) === 0) {
        ok(`${name}@${v} matches the pinned guide`,
           PINNED_CORE_PACKAGES.has(name) ? `That guide describes base SDK core ${PINNED_CORE}.` : undefined);
    } else {
        warn(`${name}@${v} is outside the pinned guide (${pinned})`,
             `This package's guide for ${name} was verified against ${pinned} only. ` +
             `Read ${name}'s own README instead, and say that is what you used. ` +
             `A guide a version behind is wrong exactly where the failures are silent.`);
    }
}

/** Pinned packages whose guide describes core 0.6.5 rather than their own version. */
const PINNED_CORE_PACKAGES = new Set(['langsys-js-react', 'langsys-js-vue']);

// Pinned packages that are NOT in `bindings`: the Laravel wrapper lives in
// composer, and the server SDK is not a binding over the base SDK at all. Both
// ship guides here claiming an exact version, so both need the check.
{
    const composerDeps = { ...composer?.require, ...composer?.['require-dev'] };
    for (const name of Object.keys(PINNED)) {
        if (bindings.includes(name)) continue;
        if (name.includes('/')) {
            if (!Object.prototype.hasOwnProperty.call(composerDeps, name)) continue;
            const inst = readJson(join(root, 'vendor', name, 'composer.json'));
            // Composer does not record the resolved version in the package's own
            // manifest, so fall back to the lock file, which does.
            const lock = readJson(join(root, 'composer.lock'));
            const v = lock?.packages?.find((p) => p.name === name)?.version?.replace(/^v/, '')
                ?? inst?.version;
            if (v) reportPin(name, v);
            else info(`${name} is required but its resolved version could not be read`,
                      'Run `composer show ' + name + '` and compare it with the pinned guide.');
            continue;
        }
        if (!has(name)) continue;
        const inst = readJson(join(root, 'node_modules', name, 'package.json'));
        if (inst?.version) reportPin(name, inst.version);
    }
}

const framework =
    has('react') ? 'react' : has('vue') ? 'vue' : has('svelte') ? 'svelte' : pkg ? 'vanilla' : null;

const expected = {
    react: 'langsys-js-react',
    vue: 'langsys-js-vue',
    svelte: 'langsys-js-svelte',
    vanilla: 'langsys-js-typescript',
}[framework];

if (bindings.length === 0 && pkg) {
    info('No Langsys SDK installed yet', expected ? `Expected for this project: ${expected}` : '');
} else if (expected && !bindings.includes(expected) && !bindings.includes('langsys-js-typescript')) {
    warn(`Installed binding may not match the framework`, `Found ${bindings.join(', ')}; expected ${expected}`);
} else if (bindings.length) {
    ok(`Binding: ${bindings.join(', ')}`);
}

// ── Installed versions vs verified range ─────────────────────────────────────

for (const name of bindings) {
    const installed = readJson(join(root, 'node_modules', name, 'package.json'));
    if (!installed) {
        warn(`${name} is in package.json but not installed`, 'Run npm install');
        continue;
    }
    const v = installed.version;
    reportPin(name, v);

    // The binding's declared range on the base SDK. A caret that caps below a
    // fix delivers that fix to nobody — and nothing in the binding's own docs or
    // tests can reveal it, because the binding is correct; only the range is not.
    const floor = BASE_CARET_FLOOR[name];
    const declared = installed.dependencies?.['langsys-js-typescript'];
    if (floor && declared) {
        const lower = declared.replace(/^[^\d]*/, '');
        if (cmpVersion(lower, floor) < 0) {
            warn(`${name} declares langsys-js-typescript ${declared}, below the verified ${floor}`,
                 `A caret is part of the API surface: this range caps the base SDK below the version the guidance assumes, ` +
                 `so base fixes above the cap are unreachable for consumers no matter what any document claims. ` +
                 `Vue shipped exactly this — \`^0.4.1\` capped at 0.4.3 and stranded every fix from 0.5.0 on.`);
        } else {
            ok(`${name} declares base ${declared} (≥ ${floor})`);
        }
    }
}

// ── Which core each binding actually resolved to ─────────────────────────────
//
// The question that decides which half of every version-gated rule applies, and
// one a human cannot answer by reading package.json: a binding's own version
// says nothing about the core underneath. `^0.6.5` pins the MINOR on a 0.x
// version, so React and Vue cannot accept 0.7 at all.
//
// Reported per binding, from the layout on disk, because a nested copy is both
// the honest answer and a hazard worth naming.

for (const name of bindings) {
    if (name === 'langsys-js-typescript') continue;
    const nested = readJson(join(root, 'node_modules', name, 'node_modules', 'langsys-js-typescript', 'package.json'));
    const top = readJson(join(root, 'node_modules', 'langsys-js-typescript', 'package.json'));
    const resolved = nested?.version ?? top?.version;
    if (!resolved) continue;

    if (nested && top && nested.version !== top.version) {
        err(`${name} runs on core ${nested.version} while the project also has core ${top.version}`,
            `Two copies of the core are installed, so there are two module instances: two locale ` +
            `subscriptions, two in-memory catalogs and two registration queues over one project, ` +
            `neither aware of the other. Nothing errors and the base language renders correctly. ` +
            `Remove the direct langsys-js-typescript dependency and import only from ${name}; ` +
            `a core 0.7 feature is not reachable from a binding pinned below it.`);
    } else {
        ok(`${name} runs on core ${resolved}`,
           cmpVersion(resolved, '0.7.0') < 0
               ? `Core ${resolved} guidance applies, not core 0.7. Do not read the langsys-typescript skill for this app.`
               : undefined);
    }
}

// ── Installed SDK skills vs the packages they describe ───────────────────────
//
// Skills are COPIED into the agent's folders, never linked, so an SDK upgrade
// leaves the copy behind rather than silently rewriting a document an agent may
// be working from. The cost of that choice is staleness, which is only
// acceptable if it is visible — so this is the check that makes it visible.
//
// Three states, and the useful distinction is between the last two: a stale copy
// is fixed by re-running the installer, an edited one means the copy is no longer
// the SDK's text at all and re-installing would discard someone's changes.

{
    // The manifest follows the INSTALL SCOPE, not the project: `install --global`
    // writes it under the home directory. Reading only the project path made the
    // documented happy path lie — the installer's own closing line runs doctor
    // with no argument, so after a global install it reported "no skill has been
    // installed" and advised re-running the installer that had just succeeded.
    //
    // Checking both, project first, is also the right precedence: a project-scoped
    // install is the more specific answer where both exist.
    const manifestPath = [
        join(root, '.langsys', 'skills.json'),
        join(homedir(), '.langsys', 'skills.json'),
    ].find(existsSync);
    const manifest = manifestPath ? readJson(manifestPath) : null;
    // Copies live beside their manifest, and the manifest records each one's path
    // relative to that base — so resolve through it rather than rebuilding the
    // path from `root`, which is what got this wrong in the first place.
    const copyBase = manifestPath ? dirname(dirname(manifestPath)) : root;
    const { skills, conflicts } = discoverSkills(root);

    if (!manifest) {
        if (skills.length) {
            warn(`${skills.length} installed Langsys package(s) ship a skill, but none has been installed`,
                 `Run \`npx langsys-skill install\` to copy ${skills.map((s) => s.name).join(', ')} ` +
                 `into your agent's skill folder. Until then an agent reads this package's pinned ` +
                 `guides, which may describe a different version.`);
        } else {
            info('No SDK skills installed, and no installed Langsys package ships one yet',
                 'Guidance comes from this package\'s pinned guides. Check each against the installed version.');
        }
    } else {
        for (const rec of manifest.skills ?? []) {
            const live = skills.find((s) => s.name === rec.name);
            if (!live) {
                warn(`skill ${rec.name} is installed but its package is gone`,
                     'The package was removed or moved. Re-run the installer to drop the orphaned copy.');
                continue;
            }
            // Did the copy's own bytes change after it was copied?
            const edited = Object.entries(rec.files ?? {}).filter(([f, want]) => {
                const p = join(copyBase, rec.to ?? join('.langsys', 'skills', rec.name), f);
                if (!existsSync(p)) return true;
                return createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16) !== want;
            });

            if (edited.length) {
                warn(`skill ${rec.name}: ${edited.length} copied file(s) no longer match what was installed`,
                     `Someone edited the copy in place (${edited.slice(0, 3).join(', ')}${edited.length > 3 ? ', …' : ''}). ` +
                     `The SDK's own copy is authoritative; re-running the installer will discard these edits.`);
            } else if (live.installed && rec.installed && live.installed !== rec.installed) {
                warn(`skill ${rec.name} describes ${rec.installed}, but ${rec.package} ${live.installed} is installed`,
                     'Re-run `npx langsys-skill install`. Until then the skill documents a version you do not have.');
            } else if (live.declares && live.installed && cmpVersion(live.declares, live.installed) !== 0) {
                warn(`skill ${rec.name} declares ${live.declares} but ships inside ${rec.package} ${live.installed}`,
                     'The SDK shipped its skill out of step with itself. Trust the package, report the skill.');
            } else {
                ok(`skill ${rec.name}@${rec.declares} matches ${rec.package} ${live.installed}`);
            }
        }
    }

    for (const c of conflicts) {
        warn(`two versions of ${c.name} are installed: ${c.shadowedBy.installed} and ${c.installed}`,
             'Only the shallowest was copied. See the two-cores finding above.');
    }
}

// ── Base SDK floor for the unmatched-params warning ──────────────────────────

const base = readJson(join(root, 'node_modules', 'langsys-js-typescript', 'package.json'));
if (base) {
    if (cmpVersion(base.version, WARN_FLOOR) < 0) {
        warn(`Base SDK ${base.version} < ${WARN_FLOOR}: no unmatched-params debug warning`,
             'verify.md step 3a cannot pass here — a silent console is NOT evidence of correct interpolation. Rely on the ast-grep rule instead, or upgrade.');
    } else {
        ok(`Base SDK ${base.version} emits the unmatched-params warning (debug: true)`);
    }
}

// ── Peer dependency floors ───────────────────────────────────────────────────

const peerFloor = { react: '18.0.0', vue: '3.4.0', svelte: '5.0.0' };
const floorWhy = {
    react: 'langsys-js-react needs useSyncExternalStore (React 18+)',
    svelte: 'langsys-js-svelte@3 requires Svelte 5',
    vue: 'langsys-js-vue requires Vue 3.4+',
};

// The DECLARED range is checked, not only the installed version.
//
// This check used to read node_modules and `continue` when the package was not
// installed — so on a fresh clone, or on any project being scoped BEFORE an
// install, it silently did nothing and the run reported zero errors. That is the
// exact moment the answer matters most: a project on Svelte 3 cannot use this
// binding at all, and the range saying so was sitting in package.json the whole
// time. A check that no-ops on the common case is worse than no check, because
// its silence reads as a pass.
for (const [name, floor] of Object.entries(peerFloor)) {
    if (!has(name)) continue;
    const installed = readJson(join(root, 'node_modules', name, 'package.json'));

    if (installed) {
        if (cmpVersion(installed.version, floor) < 0) {
            err(`${name}@${installed.version} is below the required ${floor}`, floorWhy[name]);
        } else {
            ok(`${name}@${installed.version} meets the ${floor} floor`);
        }
        continue;
    }

    // Not installed — fall back to the declared range. `^3.55.0` cannot ever
    // resolve to 5.x, so this is decidable without a registry lookup.
    const range = deps[name];
    const lower = String(range).replace(/^[^\d]*/, '');
    if (/^\d/.test(lower) && cmpVersion(lower, floor) < 0 && /^[~^]?\d/.test(String(range))) {
        err(`${name} is declared as ${range}, which cannot satisfy the required ${floor}`,
            `${floorWhy[name]} Nothing is installed here, so this comes from package.json — ` +
            `installing will not fix it. The framework itself has to be upgraded first.`);
    } else {
        warn(`${name} ${range} declared but not installed — floor ${floor} not verified`,
             'Run npm install, then re-run doctor to check the resolved version.');
    }
}

// ── Bundler → expected env prefix ────────────────────────────────────────────

const files = existsSync(root) ? readdirSync(root) : [];
const hasFile = (re) => files.some((f) => re.test(f));

// A bundler may expose client env vars under more than one prefix. SvelteKit is
// the important case: it runs on Vite, so VITE_* via import.meta.env works *and*
// PUBLIC_* via $env/static/public works. Accepting only one produces a false
// positive on a correct project — so each entry lists every valid prefix.
let prefixes = null, bundler = null, prefixNote = '';
if (has('@sveltejs/kit')) {
    prefixes = ['PUBLIC_', 'VITE_'];
    bundler = 'SvelteKit';
    prefixNote = 'PUBLIC_ (via $env/static/public) or VITE_ (via import.meta.env) — both valid';
} else if (has('next')) {
    prefixes = ['NEXT_PUBLIC_']; bundler = 'Next.js';
} else if (has('nuxt')) {
    prefixes = ['NUXT_PUBLIC_']; bundler = 'Nuxt';
    prefixNote = 'NUXT_PUBLIC_ for runtimeConfig.public; server-only vars need no prefix';
} else if (has('react-scripts')) {
    prefixes = ['REACT_APP_']; bundler = 'Create React App';
} else if (has('vite') || hasFile(/^vite\.config\./)) {
    prefixes = ['VITE_']; bundler = 'Vite';
} else if (pkg) {
    prefixes = []; bundler = 'Node (no prefix required)';
}

if (bundler) {
    info(`Bundler: ${bundler}`,
         prefixNote || (prefixes?.length ? `Client env vars need the ${prefixes[0]} prefix` : ''));
}
const prefix = prefixes?.[0] ?? '';

// ── .env inspection ──────────────────────────────────────────────────────────

const envFiles = ['.env', '.env.local', '.env.development', '.env.production']
    .filter((f) => existsSync(join(root, f)));

/**
 * Where the Langsys MCP is registered: 'user' | 'project' | 'absent' | 'unknown'.
 *
 * Read from config rather than `claude mcp list`, which health-checks every
 * server over the network and took 7s on the machine this was written on. A
 * preflight check that costs seven seconds gets skipped, and a check that gets
 * skipped is not a check.
 *
 * The scope matters, so this does not return a boolean: registered for THIS
 * project only is the case worth telling someone about, since the next project
 * they open will silently not have it.
 */
function mcpStatus() {
    const cfg = readJson(join(homedir(), '.claude.json'));
    if (!cfg) {
        // Project-scoped, committed form. Absence of ~/.claude.json only means
        // Claude Code is not the host — say nothing rather than guess.
        return readJson(join(root, '.mcp.json'))?.mcpServers?.langsys ? 'project' : 'unknown';
    }
    if (cfg.mcpServers?.langsys) return 'user';
    const perProject = cfg.projects ?? {};
    if (perProject[root]?.mcpServers?.langsys) return 'project';
    if (readJson(join(root, '.mcp.json'))?.mcpServers?.langsys) return 'project';
    return 'absent';
}

if (envFiles.length === 0 && !composer) {
    const mcp = mcpStatus();
    warn('No .env file found', 'Langsys needs a project ID and API key');
    if (mcp === 'user') {
        info('Langsys MCP registered at user scope — the project and keys can be created for you',
             'Ask the agent to set up the project rather than creating it by hand.');
    } else if (mcp === 'project') {
        info('Langsys MCP registered for THIS project only',
             'It will not be there in the next project you open. Re-add with --scope=user to get it everywhere: ' +
             'claude mcp add --scope=user --transport http langsys https://mcp.langsys.dev/mcp');
    } else if (mcp === 'absent') {
        info('Langsys MCP is not registered',
             'claude mcp add --scope=user --transport http langsys https://mcp.langsys.dev/mcp ' +
             '— lets the agent create the org, project and BOTH keys (write for dev, read-only for prod). ' +
             'Optional: paste an existing project ID and key instead.');
    }
} else {
    const merged = envFiles.map((f) => readText(join(root, f)) ?? '').join('\n');
    const keys = [...merged.matchAll(/^\s*([A-Z0-9_]*LANGSYS[A-Z0-9_]*)\s*=(.*)$/gim)]
        .map((m) => ({ name: m[1], value: m[2].trim() }));

    if (keys.length === 0) {
        warn('No LANGSYS_* variables found in .env', `Expected ${prefix}LANGSYS_PROJECT_ID and ${prefix}LANGSYS_API_KEY`);
    } else {
        ok(`Found ${keys.length} Langsys env var(s) in ${envFiles.join(', ')}`);

        if (prefixes && prefixes.length) {
            // Server-only usage legitimately needs no prefix, so an unprefixed var
            // is only an error if nothing else in the project reads it server-side.
            const unprefixed = keys.filter((k) => !prefixes.some((p) => k.name.startsWith(p)));
            if (unprefixed.length) {
                err(`Env var(s) carry no client-visible prefix: ${unprefixed.map((k) => k.name).join(', ')}`,
                    `${bundler} exposes client env vars as ${prefixes.join(' or ')}. Unprefixed vars are server-only — ` +
                    `fine if init() runs on the server, but they resolve to undefined in client code with no build error.`);
            } else {
                ok(`Env var prefixes valid for ${bundler}`);
            }
        }
        const empty = keys.filter((k) => !k.value || /^(your|xxx|changeme|todo)/i.test(k.value));
        if (empty.length) {
            warn(`Placeholder or empty value(s): ${empty.map((k) => k.name).join(', ')}`);
        }
    }
}

// ── .env must be gitignored ──────────────────────────────────────────────────

const gitignore = readText(join(root, '.gitignore'));
if (envFiles.length > 0) {
    if (!gitignore) {
        err('.env exists but there is no .gitignore', 'API keys will be committed');
    } else if (!/^\s*\.env/m.test(gitignore)) {
        err('.env is not gitignored', 'Add .env and .env.local to .gitignore before committing');
    } else {
        ok('.env is gitignored');
    }
}

// ── Key literals in source ───────────────────────────────────────────────────

const srcDir = join(root, 'src');
if (existsSync(srcDir)) {
    const suspicious = [];
    const walk = (dir, depth = 0) => {
        if (depth > 4) return;
        let entries = [];
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            const p = join(dir, e.name);
            if (e.isDirectory()) walk(p, depth + 1);
            else if (/\.(ts|tsx|js|jsx|vue|svelte|php)$/.test(e.name)) {
                const txt = readText(p);
                if (txt && /(projectid|key)\s*:\s*['"][A-Za-z0-9_-]{16,}['"]/i.test(txt)) suspicious.push(p);
            }
        }
    };
    walk(srcDir);
    if (suspicious.length) {
        err(`Possible hardcoded credential in ${suspicious.length} file(s)`,
            suspicious.slice(0, 5).map((p) => p.replace(root + '/', '')).join(', '));
    } else {
        ok('No hardcoded credentials detected in src/');
    }
}

// ── PHP ──────────────────────────────────────────────────────────────────────

if (composer) {
    const phpDeps = { ...composer.require, ...composer['require-dev'] };
    // The manifest name is langsys/langsys-php (renamed from langsys/php-sdk to
    // match the repository). Packagist takes identity from composer.json, not the
    // repo URL, so the old name will never resolve.
    const PHP_PKG = 'langsys/langsys-php';
    const PHP_VENDOR = 'langsys';

    if (phpDeps[PHP_PKG]) {
        ok(`${PHP_PKG} declared in composer.json`);
    } else if (phpDeps['langsys/php-sdk']) {
        err('composer.json requires the OLD package name langsys/php-sdk',
            `Renamed to ${PHP_PKG}. The old name is not registered and never will be — update the requirement.`);
    } else {
        info('Langsys PHP SDK not declared in composer.json');
    }

    // Packagist reachability. Two refinements beyond "does it exist":
    //
    //  1. A stable VERSION must resolve. Packagist derives versions from git
    //     tags, so a submitted package with no tags still fails composer require
    //     for anyone not asking for dev-main.
    //  2. A 404 on the package while the VENDOR owns other packages is a
    //     DISTINGUISHABLE state — a permissions problem, not a missing package.
    //     Packagist only accepts `vendor/anything` from an account already
    //     maintaining something under that vendor, and its refusal wording
    //     conflates "vendor taken" with "repo taken". Naming the real cause
    //     saves the reader from checking sibling packages' maintainer lists.
    const curl = (url) => execSync(`curl -s -m 6 ${url}`,
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

    try {
        let versions = null;
        try {
            versions = JSON.parse(curl(`https://repo.packagist.org/p2/${PHP_PKG}.json`))
                ?.packages?.[PHP_PKG] ?? null;
        } catch { /* a 404 body is not JSON */ }

        if (versions) {
            const stable = versions.filter((v) => !/dev|alpha|beta|RC/i.test(v.version));
            if (stable.length === 0) {
                err(`${PHP_PKG} is on Packagist but has no tagged stable release`,
                    'Packagist derives versions from git tags. Without one, composer require still fails unless the caller asks for dev-main.');
            } else {
                ok(`${PHP_PKG} resolvable on Packagist (latest stable ${stable[0].version})`);
            }
        } else {
            // Distinguish "not submitted" from "vendor namespace not yours".
            let siblings = [];
            try {
                siblings = JSON.parse(curl(`https://packagist.org/packages/list.json?vendor=${PHP_VENDOR}`))
                    ?.packageNames ?? [];
            } catch { /* ignore */ }

            if (siblings.length > 0) {
                err(`${PHP_PKG} is not on Packagist, and the "${PHP_VENDOR}/" vendor is owned by someone else`,
                    `The vendor namespace already has ${siblings.length} package(s) (${siblings.slice(0, 3).join(', ')}…). ` +
                    `Packagist only accepts a new ${PHP_VENDOR}/* submission from an account that already maintains one of those, ` +
                    `and it reports this as though the REPO were claimed. This is a permissions issue, not a naming collision — ` +
                    `renaming the package will not help. Fix: have the vendor owner submit it, or be added as a maintainer on an existing ${PHP_VENDOR}/* package. ` +
                    `Meanwhile use the manual autoload.php install or a VCS repository entry.`);
            } else {
                err(`${PHP_PKG} is not resolvable on Packagist`,
                    '`composer require` will fail. Use the manual autoload.php install, or add a VCS repository entry pointing at github.com/langsys/langsys-php.');
            }
        }
    } catch {
        warn(`Could not reach Packagist to verify ${PHP_PKG}`, 'Offline, or curl unavailable — verify the install path manually');
    }

    // Runtime floor. Composer normally enforces this, but the manual autoload
    // install bypasses Composer entirely — so check it explicitly.
    const phpVersion = (() => {
        try {
            return execSync('php -r "echo PHP_VERSION;"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        } catch { return null; }
    })();

    if (phpVersion) {
        if (cmpVersion(phpVersion, '7.4.0') < 0) {
            err(`PHP ${phpVersion} is below the 7.4 floor`,
                'The current SDK requires PHP >= 7.4. On the manual autoload install there is no Composer gate, so this fails at runtime inside the ICU code with no clear cause.');
        } else {
            ok(`PHP ${phpVersion} meets the 7.4 floor`);
        }
        try {
            const exts = execSync('php -m', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            for (const ext of ['intl', 'curl', 'json']) {
                if (new RegExp(`^${ext}$`, 'im').test(exts)) ok(`PHP ext-${ext} present`);
                else err(`PHP ext-${ext} missing`, ext === 'intl'
                    ? 'Required for ICU plural/select support'
                    : 'Required by the SDK');
            }
        } catch { /* php -m unavailable */ }
    } else {
        warn('Could not determine the PHP version', 'Verify PHP >= 7.4 with ext-intl, ext-curl, ext-json');
    }
}

// ── Production safety ────────────────────────────────────────────────────────

const prodEnv = readText(join(root, '.env.production'));
if (prodEnv && /LANGSYS_API_KEY\s*=\s*\S/.test(prodEnv)) {
    warn('.env.production sets a Langsys API key',
         'Confirm it is the READ-ONLY key. A write key in production registers phrases from live user traffic.');
}

// ── Report ───────────────────────────────────────────────────────────────────

function report() {
    const glyph = { ok: '  ✓', warn: '  !', error: '  ✗', info: '  ·' };
    const order = ['error', 'warn', 'ok', 'info'];
    console.log(`\nlangsys-skill doctor — ${root}\n`);
    for (const level of order) {
        for (const r of results.filter((x) => x.level === level)) {
            console.log(`${glyph[level]} ${r.m}`);
            if (r.d) console.log(`      ${r.d}`);
        }
    }
    const errors = results.filter((r) => r.level === 'error').length;
    const warns = results.filter((r) => r.level === 'warn').length;
    console.log(`\n${errors} error(s), ${warns} warning(s)\n`);
    return errors;
}

process.exit(report() > 0 ? 1 : 0);
