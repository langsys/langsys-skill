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
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const root = resolve(process.argv[2] ?? process.cwd());

/** Minimum base SDK exposing the unmatched-params debug warning. */
const WARN_FLOOR = '0.4.3';   // unmatched-params warning floor (unchanged by 0.5.0)
/** Verified-against versions. Outside this range, guidance may not apply. */
const VERIFIED = {
    'langsys-js-typescript': '0.6.5',
    'langsys-js-react': '0.6.6',
    'langsys-js-svelte': '3.6.3',
    'langsys-js-vue': '0.2.0',
};

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
    const verified = VERIFIED[name];
    if (verified && cmpVersion(v, verified) < 0) {
        warn(`${name}@${v} is older than the verified ${verified}`,
             'Some guidance may not apply. Upgrade, or confirm behavior before relying on it.');
    } else if (verified && cmpVersion(v, verified) > 0) {
        warn(`${name}@${v} is newer than the verified ${verified}`,
             'Behavior may have changed since verification. Re-verify before trusting version-gated guidance.');
    } else {
        ok(`${name}@${v} matches verified`);
    }

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
for (const [name, floor] of Object.entries(peerFloor)) {
    if (!has(name)) continue;
    const installed = readJson(join(root, 'node_modules', name, 'package.json'));
    if (!installed) continue;
    if (cmpVersion(installed.version, floor) < 0) {
        err(`${name}@${installed.version} is below the required ${floor}`,
            name === 'react' ? 'langsys-js-react needs useSyncExternalStore (React 18+)'
            : name === 'svelte' ? 'langsys-js-svelte@3 requires Svelte 5'
            : 'langsys-js-vue requires Vue 3.4+');
    } else {
        ok(`${name}@${installed.version} meets the ${floor} floor`);
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

if (envFiles.length === 0 && !composer) {
    warn('No .env file found', 'Langsys needs a project ID and API key');
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
