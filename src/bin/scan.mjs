#!/usr/bin/env node
/**
 * langsys-scan — inventory and scope a project BEFORE putting Langsys into it.
 *
 * WHY THIS EXISTS SEPARATELY FROM `doctor`: doctor answers "is this configured
 * correctly?" and assumes Langsys is already present. Nothing answered the
 * question that comes first — "how big is this job, and where are the hard
 * parts?" — so the agent answered it by guessing, at the moment it knew least
 * about the codebase.
 *
 * THE CONTRACT IS DIFFERENT FROM LINT. Lint asserts violations and exits
 * non-zero. Scan runs on a codebase that has never heard of Langsys, where a
 * `sprintf()` is not a defect — it is a work item. So scan is read-only,
 * reports scope rather than fault, and exits 0 on findings. It exits non-zero
 * only when it could not do its job.
 *
 * NO SILENT CAPS. Every run prints a NOT EXAMINED section, including when it is
 * empty. A scan reporting "312 strings" after skipping forty unparseable files
 * reads as complete coverage, and that failure has bitten this repo three times
 * (the vacuous changelog pass, the aborted ast-grep scan, the <select> fixtures
 * green on synthetic input). Absence of a skip list is not absence of skips.
 *
 * Usage: node scan.mjs [path] [--json] [--top N]
 * Exit:  0 always, except 2 for a usage/IO failure.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, resolve, dirname } from 'node:path';

// ── CLI ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, dflt) => {
    const i = argv.indexOf(name);
    return i === -1 ? dflt : argv[i + 1];
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--top'));
const root = resolve(positional[0] ?? process.cwd());
const asJson = flag('--json');
const TOP = Number(value('--top', 10)) || 10;

if (!existsSync(root)) {
    console.error(`langsys-scan: no such path: ${root}`);
    process.exit(2);
}

// The scan TARGET may be a single file; the PROJECT is what the manifests and
// catalogs are read from. Keeping them separate lets `scan src/App.tsx` still
// report the right framework and the right migration track.
const targetIsFile = statSync(root).isFile();

/**
 * Nearest ancestor holding a manifest. Without this, scanning a single file or a
 * subdirectory reports "no i18n library, route INTEGRATE" for a project that is
 * plainly on i18next — a wrong route stated with full confidence, which is worse
 * than no route at all.
 */
function findProjectRoot(start) {
    let dir = start;
    for (;;) {
        if (existsSync(join(dir, 'package.json')) || existsSync(join(dir, 'composer.json'))) return dir;
        const up = dirname(dir);
        if (up === dir) return start;
        dir = up;
    }
}
const projectRoot = findProjectRoot(targetIsFile ? dirname(root) : root);

// ── Constants ────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor',
    '.svelte-kit', '.next', '.nuxt', '.output', '.turbo', '.cache',
    'storybook-static', '__snapshots__',
]);

/** Files whose markup we walk with the tag-stack parser. */
const MARKUP_EXT = new Set(['.jsx', '.tsx', '.vue', '.svelte', '.html', '.htm', '.php', '.blade.php']);
/** Files we read for call sites only — no markup. */
const CODE_EXT = new Set(['.ts', '.js', '.mjs', '.cjs']);

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img',
    'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Inline tags: their presence in a run is what makes it a <Phrase>. */
const INLINE_TAGS = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'del',
    'em', 'i', 'ins', 'kbd', 'mark', 'q', 's', 'small', 'span', 'strong', 'sub',
    'sup', 'time', 'u', 'var']);

/** Subtrees that never contain translatable prose. */
const OPAQUE_TAGS = new Set(['script', 'style', 'svg', 'path', 'noscript', 'template#raw']);

/** Elements Langsys already owns. */
const LANGSYS_TAGS = new Set(['translate', 'phrase', 'donttranslate']);

/**
 * Verbatim from `TRANSLATABLE_ATTRIBUTES` in langsys-js-typescript@0.6.5
 * (dist/index.js:1140). Transcribed from the published artifact, not recalled:
 * the first version of this list invented `summary`, which the SDK never
 * harvests, and omitted nine real entries — so scan flagged work that did not
 * exist while missing work that did.
 */
const TRANSLATABLE_ATTRS = [
    'placeholder', 'alt', 'title', 'label',
    'aria-label', 'aria-placeholder', 'aria-description',
    'aria-valuetext', 'aria-roledescription',
    'data-error', 'data-error-message', 'data-validation-message',
    'data-invalid-message', 'data-required-message', 'data-pattern-message',
];

/**
 * `value` is NOT in that constant — it is harvested by a separate rule, because
 * it is a label on some elements and data on others. A checker keyed on
 * TRANSLATABLE_ATTRIBUTES alone concludes `value` is never translated, and
 * silently drops every submit button in the app.
 */
const VALUE_TRANSLATABLE_ELEMENTS = new Set(['button']);
const VALUE_TRANSLATABLE_INPUT_TYPES = new Set(['submit', 'button']);

// Longest alternative first: `data-error-message` must win over `data-error`.
// The lookbehind rejects `:title` / `v-bind:title` (dynamic) and stops `label`
// matching inside `aria-label`.
const ATTR_RE = new RegExp(
    `(?<![:\\-\\w.])(${[...TRANSLATABLE_ATTRS].sort((a, b) => b.length - a.length).join('|')})` +
    `\\s*=\\s*(["'])([^"']*)\\2`, 'gi');

const VALUE_ATTR_RE = /(?<![:\-\w.])value\s*=\s*(["'])([^"']*)\1/i;
const TYPE_ATTR_RE = /(?<![:\-\w.])type\s*=\s*(["'])([^"']*)\1/i;

// ── Accumulators ─────────────────────────────────────────────────────────────

const sites = [];           // { kind, bucket, file, line, sample, note }
const hazards = [];         // { rule, file, line, sample, note }
const migrated = { components: 0, calls: 0, files: new Set() };
const notExamined = {
    byExt: new Map(),       // ext → count
    unreadable: [],         // { file, reason }
    dirsSkipped: new Set(),
};
const filesScanned = { markup: 0, code: 0 };
const dirTally = new Map();

const bump = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);
const rel = (p) => relative(projectRoot, p) || '.';
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

function addSite(kind, bucket, file, line, sample, note) {
    sites.push({ kind, bucket, file: rel(file), line, sample: trim(sample), note });
    bump(dirTally, dirname(rel(file)));
}
function addHazard(rule, file, line, sample, note) {
    hazards.push({ rule, file: rel(file), line, sample: trim(sample), note });
}
const trim = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

// ── Text classification ──────────────────────────────────────────────────────

/**
 * Strip framework interpolation, entities and directives to see what prose
 * remains. Brace removal iterates to a fixed point: a single pass leaves the
 * outer braces of `{t(`Hello, ${name}!`)}` behind, and the residue reads as
 * prose to any later test.
 */
function prose(text) {
    let s = text.replace(/<%[\s\S]*?%>/g, ' ');
    let prev;
    do { prev = s; s = s.replace(/\{[^{}]*\}/g, ' '); } while (s !== prev);
    return s
        .replace(/&[a-zA-Z]+;|&#\d+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** A text run is worth converting only if prose survives and it reads as words. */
function isTranslatable(text) {
    const p = prose(text);
    if (!p) return false;
    if (!/[A-Za-z]{2}/.test(p)) return false;              // needs real letters
    if (/^[\d\s.,:;!?%$€£+*/#|()\[\]{}<>_-]+$/.test(p)) return false;
    return true;
}

const hasBracePlaceholder = (text) => /\{\s*[A-Za-z_$][\w.$]*\s*\}/.test(text);
const hasMustache = (text) => /\{\{\s*[A-Za-z_$][\w.$]*\s*\}\}/.test(text);
const hasCall = (text) => /(^|[^\w$.])\$?t\s*\(/.test(text);

// ── Markup tokenizer ─────────────────────────────────────────────────────────

/**
 * Find the `>` that closes the tag opening at `start`, respecting quotes and
 * brace-delimited attribute expressions. `title={a > b}` and `alt="a > b"` both
 * contain a `>` that does NOT end the tag.
 */
function findTagEnd(src, start) {
    let quote = null, depth = 0;
    for (let i = start + 1; i < src.length; i++) {
        const c = src[i];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === '{') { depth++; continue; }
        if (c === '}') { if (depth > 0) depth--; continue; }
        if (c === '>' && depth === 0) return i;
    }
    return -1;
}

/**
 * Blank the ARGUMENTS of t()/$t() calls, balancing parentheses and respecting
 * strings. Same masking markup-check.mjs performs, for the same reason: a call
 * sitting lexically inside markup is not markup text, and counting it produces
 * both a phantom conversion site and a phantom `{name}` hazard for a call that
 * is already correct.
 */
function maskCalls(src) {
    const chars = [...src];
    const re = /(^|[^A-Za-z0-9_$.])(\$?t)\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const open = m.index + m[0].length - 1;
        let depth = 0, quote = null, i = open;
        for (; i < src.length; i++) {
            const c = src[i], prev = src[i - 1];
            if (quote) { if (c === quote && prev !== '\\') quote = null; continue; }
            if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
            if (c === '(') depth++;
            else if (c === ')') { depth--; if (depth === 0) { i++; break; } }
        }
        for (let j = open; j < i && j < chars.length; j++) {
            if (chars[j] !== '\n') chars[j] = ' ';
        }
    }
    return chars.join('');
}

function tokenize(src) {
    const toks = [];
    let i = 0, textStart = 0;
    while (i < src.length) {
        const lt = src.indexOf('<', i);
        if (lt === -1) break;
        if (!/^<\/?[A-Za-z]/.test(src.slice(lt, lt + 3))) { i = lt + 1; continue; }
        const end = findTagEnd(src, lt);
        if (end === -1) { i = lt + 1; continue; }
        if (lt > textStart) toks.push({ type: 'text', value: src.slice(textStart, lt), start: textStart });
        const raw = src.slice(lt, end + 1);
        const nm = /^<(\/?)([A-Za-z][\w.:-]*)/.exec(raw);
        toks.push({
            type: nm[1] ? 'close' : 'open',
            tag: nm[2],
            selfClose: /\/\s*>$/.test(raw),
            raw,
            start: lt,
        });
        i = end + 1;
        textStart = i;
    }
    if (textStart < src.length) toks.push({ type: 'text', value: src.slice(textStart), start: textStart });
    return toks;
}

/**
 * Build an element tree.
 *
 * `closed` is load-bearing, not bookkeeping. In .tsx a generic call like
 * `useQuery<Row>(x)` tokenizes as an open tag named `Row` that is never closed.
 * Only classifying CLOSED elements is what keeps TypeScript generics out of the
 * string inventory without needing a real TS parser.
 */
function buildTree(toks) {
    const rootNode = { tag: '#root', children: [], closed: true, start: 0 };
    const stack = [rootNode];
    for (const t of toks) {
        const top = stack[stack.length - 1];
        if (t.type === 'text') {
            top.children.push({ text: true, value: t.value, start: t.start });
        } else if (t.type === 'open') {
            const node = { tag: t.tag, raw: t.raw, children: [], closed: false, start: t.start };
            top.children.push(node);
            const lower = t.tag.toLowerCase();
            if (!t.selfClose && !VOID_TAGS.has(lower)) stack.push(node);
            else node.closed = true;
        } else {
            for (let i = stack.length - 1; i > 0; i--) {
                if (stack[i].tag.toLowerCase() === t.tag.toLowerCase()) {
                    stack[i].closed = true;
                    stack.length = i;
                    break;
                }
            }
        }
    }
    return rootNode;
}

const elementChildren = (node) => node.children.filter((c) => !c.text);
const directTexts = (node) => node.children.filter((c) => c.text);

/** Full text of a subtree — a <Phrase> sample is unreadable without its inline children. */
function subtreeText(node) {
    let out = '';
    for (const c of node.children) {
        if (c.text) { out += c.value; continue; }
        if (OPAQUE_TAGS.has(c.tag.toLowerCase())) continue;
        out += ' ' + subtreeText(c);
    }
    return out;
}

function subtreeHasText(node) {
    for (const c of node.children) {
        if (c.text) { if (isTranslatable(c.value)) return true; continue; }
        if (OPAQUE_TAGS.has(c.tag.toLowerCase())) continue;
        if (subtreeHasText(c)) return true;
    }
    return false;
}

// ── Per-element classification ───────────────────────────────────────────────

/**
 * Classify a text-bearing element into ONE primitive.
 *
 * Descent stops at <Phrase>: everything under a phrase is part of that phrase,
 * so descending would count the same words twice. Descent CONTINUES through a
 * <Translate> candidate, because a Translate and the t() sites beneath it are
 * genuinely alternative treatments of the same markup — which is why they are
 * reported as overlapping rather than summed.
 */
function classify(node, src, file, depth, inLangsys) {
    const lower = node.tag.toLowerCase();
    if (OPAQUE_TAGS.has(lower)) return;

    if (LANGSYS_TAGS.has(lower)) {
        migrated.components++;
        migrated.files.add(rel(file));
        return;                                    // already converted; not scope
    }

    // An unclosed element is not markup we can trust. In .tsx a generic call
    // like `useQuery<Row>(x)` tokenizes as an open tag named `Row` that never
    // closes, and everything after it lands inside that phantom element. So it
    // is skipped as a site — but its CHILDREN are still descended into, because
    // the real markup of the component sits underneath the phantom.
    const trusted = node.closed;

    // Translatable static attributes — an attribute can never hold markup, so it
    // is always a t() call regardless of what wraps it.
    if (trusted && node.raw) {
        ATTR_RE.lastIndex = 0;
        let a;
        while ((a = ATTR_RE.exec(node.raw)) !== null) {
            if (!isTranslatable(a[3])) continue;
            addSite('attribute', 'mechanical', file, lineOf(src, node.start), `${a[1]}="${a[3]}"`,
                'Attributes cannot carry markup — always t(), never <Phrase>.');
        }

        // `value`, but only where it is a label rather than data.
        const inputType = (TYPE_ATTR_RE.exec(node.raw)?.[2] ?? '').toLowerCase();
        const valueIsLabel = VALUE_TRANSLATABLE_ELEMENTS.has(lower)
            || (lower === 'input' && VALUE_TRANSLATABLE_INPUT_TYPES.has(inputType));
        if (valueIsLabel) {
            const v = VALUE_ATTR_RE.exec(node.raw);
            if (v && isTranslatable(v[2])) {
                addSite('attribute', 'mechanical', file, lineOf(src, node.start), `value="${v[2]}"`,
                    `Harvested because this is <${lower}${inputType ? ` type="${inputType}"` : ''}>. On any other element \`value\` is data and is left alone.`);
            }
        }
    }

    const texts = directTexts(node);
    const rawText = texts.map((t) => t.value).join(' ');

    // Text at the ROOT of a .tsx/.svelte/.vue file is source code, not markup —
    // imports, type declarations, the body of the component function. Only text
    // with a real element parent is prose.
    const ownText = trusted && node.tag !== '#root' && texts.some((t) => isTranslatable(t.value));

    const kids = elementChildren(node).filter((c) => !OPAQUE_TAGS.has(c.tag.toLowerCase()));
    const textKids = kids.filter((c) => subtreeHasText(c));
    const inlineKids = textKids.filter((c) => INLINE_TAGS.has(c.tag.toLowerCase()));
    const blockKids = textKids.filter((c) => !INLINE_TAGS.has(c.tag.toLowerCase()));

    const line = lineOf(src, node.start);
    const placeholder = hasBracePlaceholder(rawText) || hasMustache(rawText);

    if (ownText && inlineKids.length > 0) {
        // One sentence whose run is broken by inline markup.
        const bucket = placeholder ? 'human' : 'judgment';
        const run = prose(subtreeText(node));
        addSite('Phrase', bucket, file, line, run,
            placeholder
                ? 'Placeholder AND inline markup in one run — the value and the word it governs must stay in the SAME phrase or no plural rule can inflect the noun (Russian 4 categories, Arabic 6, Polish 4).'
                : 'Inline markup inside one sentence. <Translate> would split it at the tag boundary.');
        if (placeholder) {
            addHazard('brace-placeholder-in-markup', file, line, run,
                'Written as {name} today. Inside <Phrase>/<Translate> markup it must become %name% — the framework compiler substitutes {name} before Langsys sees the text.');
        }
        return;                                     // do NOT descend
    }

    if (ownText) {
        addSite('t()', 'mechanical', file, line, prose(rawText),
            'Plain string, no inline markup — neither component applies.');
        if (placeholder) {
            addHazard('brace-placeholder-in-markup', file, line, prose(rawText),
                'If this string later moves into <Phrase>/<Translate> markup, {name} must become %name%.');
        }
        // Fall through: a node can hold both its own text and block children.
    }

    if (trusted && node.tag !== '#root' && !ownText &&
        (blockKids.length >= 2 || (blockKids.length >= 1 && inlineKids.length >= 1))) {
        addSite('Translate', 'judgment', file, line, `<${node.tag}> with ${textKids.length} text-bearing children`,
            'Container: <Translate> tokenizes per text node. Adopting it here replaces the individual t() sites beneath — the counts overlap, they do not add.');
    }

    for (const c of kids) classify(c, src, file, depth + 1, inLangsys);
}

// ── Call-site scanning ───────────────────────────────────────────────────────

const CALL_RE = /(^|[^\w$.>])(\$?t|__|_e|trans|gettext|dgettext|formatMessage|\$tc|tc)\s*\(/g;

/** Read the first argument of a call whose `(` sits at `open`. */
function firstArg(src, open) {
    let depth = 0, quote = null, out = '';
    for (let i = open; i < src.length; i++) {
        const c = src[i], prev = src[i - 1];
        if (quote) {
            if (c === quote && prev !== '\\') quote = null;
            out += c;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
        if (c === '(') { depth++; if (depth === 1) continue; }
        if (c === ')') { depth--; if (depth === 0) break; }
        if (c === ',' && depth === 1) break;
        out += c;
    }
    return out.trim();
}

/**
 * Existing i18n call sites.
 *
 * Attribution matters: a bare `t(` means "migrate this" in an i18next project,
 * "already done" in a Langsys project, and NOTHING KNOWABLE in a project with
 * neither. The third case is reported as unattributed rather than folded into
 * either count.
 */
function scanCalls(src, file, incumbent, hasLangsys) {
    CALL_RE.lastIndex = 0;
    let m;
    while ((m = CALL_RE.exec(src)) !== null) {
        const open = m.index + m[0].length - 1;
        const fn = m[2];
        const arg = firstArg(src, open);
        const line = lineOf(src, m.index);

        if (!arg) continue;

        // react-intl shape: formatMessage({ id: 'x' })
        const idMatch = /\bid\s*:\s*(['"])(.*?)\1/.exec(arg);
        const literal = idMatch ? idMatch[2] : /^(['"])([\s\S]*)\1$/.exec(arg)?.[2] ?? null;

        if (/^`/.test(arg) && /\$\{/.test(arg)) {
            addHazard('preformatted-phrase', file, line, arg,
                'Template literal as the phrase. Every distinct value registers a SEPARATE catalog entry into shared project state — the one failure the SDK cannot detect at runtime.');
            addSite('call', 'human', file, line, arg,
                'Must be restructured to t(\'… {name}\', category, { name }) before conversion.');
            continue;
        }
        if (literal === null && /['"]\s*[+.]|[+.]\s*['"]/.test(arg)) {
            addHazard('preformatted-phrase', file, line, arg,
                'Concatenated phrase — same catalog pollution as a template literal, and it also hides word order from the translator.');
            addSite('call', 'human', file, line, arg,
                'Restructure to a single phrase with a placeholder.');
            continue;
        }
        if (/\bsprintf\s*\(|\bvsprintf\s*\(/.test(arg)) {
            addHazard('preformatted-phrase', file, line, arg,
                'sprintf() formats before translation, so the formatted result becomes the key.');
            addSite('call', 'human', file, line, arg, 'Restructure so the phrase reaches Langsys unformatted.');
            continue;
        }

        // printf-style placeholders survive translation but carry no name, so a
        // translator sees `%s` with no way to know what it holds and no way to
        // reorder it — and reordering is exactly what many target languages need.
        if (literal !== null && /%\d+\$[sd]|%[sd]\b/.test(literal)) {
            addHazard('positional-placeholder', file, line, literal,
                'printf-style placeholder. Langsys placeholders are NAMED: {name} in a t() string literal, %name% in markup. A bare %s tells the translator nothing and cannot be reordered.');
        }

        // An already-Langsys call is not outstanding work, INCLUDING when its
        // argument is dynamic. A dynamic phrase is still worth surfacing — it
        // cannot be verified statically — but as a hazard, not as a conversion
        // site. Filing it as work told an agent to migrate a codebase that was
        // already migrated.
        if (hasLangsys && !incumbent) {
            migrated.calls++;
            migrated.files.add(rel(file));
            if (literal === null) {
                addHazard('dynamic-phrase-argument', file, line, arg,
                    'The phrase is computed, so no static check can confirm it is a literal. If the value is built by interpolation at the call site, this is catalog pollution the SDK cannot detect.');
            }
            continue;
        }

        if (literal === null) {
            addSite('call', 'judgment', file, line, arg,
                'Dynamic first argument — the phrase is not statically knowable. Inspect by hand.');
            continue;
        }

        if (/^[A-Za-z0-9_$]+(\.[A-Za-z0-9_$]+)+$/.test(literal) && !/\s/.test(literal)) {
            addSite('call', 'human', file, line, literal,
                'Namespaced key. Langsys uses the PHRASE as the key, so the base-locale catalog is a required input — the source text must be recovered from it, not invented.');
            continue;
        }

        if (!incumbent && !hasLangsys) {
            addSite('call', 'unattributed', file, line, literal,
                `${fn}() with no i18n library declared in the manifest. Cannot be attributed to migration or to Langsys — inspect before counting.`);
            continue;
        }

        addSite('call', 'mechanical', file, line, literal,
            'Static key that is already prose — converts directly.');
    }
}

// ── Project profile ──────────────────────────────────────────────────────────

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

const pkg = readJson(join(projectRoot, 'package.json'));
const composer = readJson(join(projectRoot, 'composer.json'));
const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
const phpDeps = composer ? { ...composer.require, ...composer['require-dev'] } : {};
const has = (n) => Object.prototype.hasOwnProperty.call(deps, n);

const framework =
    has('react') ? 'react' : has('vue') ? 'vue' : has('svelte') ? 'svelte' : pkg ? 'vanilla' : null;

const metaFramework =
    has('next') ? { name: 'Next.js', track: 'ssr/nextjs.md' }
    : has('nuxt') ? { name: 'Nuxt', track: 'ssr/nuxt.md' }
    : has('@sveltejs/kit') ? { name: 'SvelteKit', track: 'ssr/sveltekit.md' }
    : Object.keys(deps).some((d) => d.startsWith('@remix-run/')) ? { name: 'Remix', track: 'ssr/nextjs.md' }
    : composer ? { name: 'PHP (server-rendered by default)', track: 'ssr/php.md' }
    : null;

const prefixes =
    has('@sveltejs/kit') ? ['PUBLIC_', 'VITE_']
    : has('next') ? ['NEXT_PUBLIC_']
    : has('nuxt') ? ['NUXT_PUBLIC_']
    : has('react-scripts') ? ['REACT_APP_']
    : (has('vite') || existsSync(join(projectRoot, 'vite.config.ts')) || existsSync(join(projectRoot, 'vite.config.js'))) ? ['VITE_']
    : pkg ? [] : null;

const INCUMBENTS = [
    { dep: 'i18next', name: 'i18next', track: 'migrate/i18next.md' },
    { dep: 'react-i18next', name: 'react-i18next', track: 'migrate/i18next.md' },
    { dep: 'react-intl', name: 'react-intl', track: 'migrate/react-intl.md' },
    { dep: 'vue-i18n', name: 'vue-i18n', track: 'migrate/vue-i18n.md' },
    { dep: 'next-intl', name: 'next-intl', track: 'migrate/_method.md' },
    { dep: 'svelte-i18n', name: 'svelte-i18n', track: 'migrate/_method.md' },
    { dep: '@inlang/paraglide-js', name: 'Paraglide', track: 'migrate/_method.md' },
];
const incumbents = INCUMBENTS.filter((i) => has(i.dep));
for (const d of Object.keys(deps)) {
    if (d.startsWith('@formatjs/') && !incumbents.some((i) => i.name === 'react-intl')) {
        incumbents.push({ dep: d, name: '@formatjs/*', track: 'migrate/react-intl.md' });
        break;
    }
}
if (phpDeps['laravel/framework'] || existsSync(join(projectRoot, 'resources/lang')) || existsSync(join(projectRoot, 'lang'))) {
    incumbents.push({ dep: 'laravel', name: 'Laravel translation files', track: 'migrate/_method.md' });
}

const LANGSYS_PKGS = ['langsys-js-typescript', 'langsys-js-react', 'langsys-js-vue', 'langsys-js-svelte'];
const langsysInstalled = LANGSYS_PKGS.filter(has);
const langsysPhp = Boolean(phpDeps['langsys/langsys-php']);
const hasLangsys = langsysInstalled.length > 0 || langsysPhp;

const recommended =
    framework === 'react' ? 'langsys-js-react'
    : framework === 'vue' ? 'langsys-js-vue'
    : framework === 'svelte' ? 'langsys-js-svelte'
    : framework === 'vanilla' ? 'langsys-js-typescript'
    : null;

// Catalog inventory — locale count and key count are the migration's real input.
const CATALOG_DIRS = ['locales', 'public/locales', 'src/locales', 'messages', 'lang',
    'resources/lang', 'src/i18n', 'i18n', 'translations', 'src/translations'];
const catalogs = [];
for (const d of CATALOG_DIRS) {
    const p = join(projectRoot, d);
    if (!existsSync(p)) continue;
    let keys = 0, locales = new Set(), files = 0;
    const walkCat = (dir, depth = 0) => {
        if (depth > 3) return;
        let entries = [];
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const fp = join(dir, e.name);
            if (e.isDirectory()) {
                if (/^[a-z]{2}([_-][A-Za-z]{2,4})?$/.test(e.name)) locales.add(e.name);
                walkCat(fp, depth + 1);
            } else if (/\.(json|ya?ml|php)$/.test(e.name)) {
                files++;
                const base = e.name.replace(/\.(json|ya?ml|php)$/, '');
                if (/^[a-z]{2}([_-][A-Za-z]{2,4})?$/.test(base)) locales.add(base);
                if (e.name.endsWith('.json')) {
                    const j = readJson(fp);
                    if (j) keys += countLeaves(j);
                }
            }
        }
    };
    walkCat(p);
    catalogs.push({ dir: d, files, locales: [...locales].sort(), keys });
}
function countLeaves(o) {
    if (o === null || typeof o !== 'object') return 1;
    return Object.values(o).reduce((n, v) => n + countLeaves(v), 0);
}

// Base locale hints — never assume. en-GB and en-US are different catalogs.
const baseLocaleHints = [];
for (const f of ['i18n.js', 'i18n.ts', 'src/i18n.ts', 'src/i18n.js', 'next.config.js', 'nuxt.config.ts']) {
    const t = readText(join(projectRoot, f));
    if (!t) continue;
    const m = /(fallbackLng|defaultLocale|defaultLanguage|fallbackLocale|locale)\s*:\s*['"]([\w-]+)['"]/.exec(t);
    if (m) baseLocaleHints.push({ from: f, key: m[1], value: m[2] });
}
for (const f of ['index.html', 'public/index.html', 'src/app.html']) {
    const t = readText(join(projectRoot, f));
    const m = t && /<html[^>]*\blang\s*=\s*["']([\w-]+)["']/i.exec(t);
    if (m) baseLocaleHints.push({ from: f, key: 'html lang', value: m[1] });
}

// ── Walk ─────────────────────────────────────────────────────────────────────

/** Longest line no hand-written source realistically reaches. */
const MINIFIED_LINE = 500;

/** Returns a stated reason if the content looks generated, else null. */
function generatedMarker(src) {
    if (/^\s*\/\/# sourceMappingURL=/m.test(src)) return 'generated: carries a sourceMappingURL footer';
    let longest = 0, start = 0;
    for (let i = 0; i <= src.length; i++) {
        if (i === src.length || src[i] === '\n') {
            if (i - start > longest) longest = i - start;
            start = i + 1;
        }
    }
    if (longest > MINIFIED_LINE) return `generated: longest line is ${longest} chars (> ${MINIFIED_LINE})`;
    return null;
}

function blankRegions(src, ...regexes) {
    let out = src;
    for (const re of regexes) out = out.replace(re, (m) => m.replace(/[^\n]/g, ' '));
    return out;
}

function scanFile(file) {
    let src;
    try { src = readFileSync(file, 'utf8'); }
    catch (e) { notExamined.unreadable.push({ file: rel(file), reason: e.code ?? 'read error' }); return; }
    if (src.includes('\u0000')) {
        notExamined.unreadable.push({ file: rel(file), reason: 'binary content' });
        return;
    }

    // Build output. Scanning it is not merely wasted work — it inflates every
    // total with the app's own compiled source, and with the SDK's own bundle,
    // counted once per platform copy. On a real Capacitor project this was 259
    // of 406 sites: the job would have read as three times its actual size.
    //
    // Detected by SHAPE, not by directory name. A maximum line length no
    // hand-written source reaches, or a source-map footer, is evidence.
    // Guessing at names ("www", "public", "ios") would skip real source in the
    // projects that keep it there.
    const generated = generatedMarker(src);
    if (generated) {
        notExamined.unreadable.push({ file: rel(file), reason: generated });
        return;
    }

    const ext = extname(file);
    const incumbent = incumbents.length > 0;

    if (MARKUP_EXT.has(ext)) {
        filesScanned.markup++;
        // <?php … ?> is code, not markup, and its contents can contain any
        // character sequence — blank it before the tag scanner ever sees it.
        let markupSrc = blankRegions(src,
            /<\?(?:php|=)[\s\S]*?(?:\?>|$)/g,
            /<script\b[^>]*>[\s\S]*?<\/script>/gi,
            /<style\b[^>]*>[\s\S]*?<\/style>/gi,
            /<!--[\s\S]*?-->/g,
        );
        markupSrc = maskCalls(markupSrc);
        try {
            classify(buildTree(tokenize(markupSrc)), markupSrc, file, 0, false);
        } catch (e) {
            notExamined.unreadable.push({ file: rel(file), reason: `markup parse failed: ${e.message}` });
        }
        scanCalls(src, file, incumbent, hasLangsys);
        return;
    }

    filesScanned.code++;
    const code = blankRegions(src, /\/\*[\s\S]*?\*\//g, /(^|[^:'"\\])\/\/[^\n]*/g);
    scanCalls(code, file, incumbent, hasLangsys);
}

function walk(dir, depth = 0) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch (e) { notExamined.unreadable.push({ file: rel(dir), reason: e.code ?? 'readdir error' }); return; }

    for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.')) {
                notExamined.dirsSkipped.add(e.name);
                continue;
            }
            walk(p, depth + 1);
            continue;
        }
        if (!e.isFile()) continue;
        const ext = extname(e.name);
        if (MARKUP_EXT.has(ext) || CODE_EXT.has(ext)) scanFile(p);
        else bump(notExamined.byExt, ext || '(no extension)');
    }
}

if (targetIsFile) scanFile(root); else walk(root);

// ── Aggregate ────────────────────────────────────────────────────────────────

const count = (pred) => sites.filter(pred).length;
const byKind = {
    't()': count((s) => s.kind === 't()'),
    attribute: count((s) => s.kind === 'attribute'),
    Phrase: count((s) => s.kind === 'Phrase'),
    Translate: count((s) => s.kind === 'Translate'),
    call: count((s) => s.kind === 'call'),
};
const byBucket = {
    mechanical: count((s) => s.bucket === 'mechanical'),
    judgment: count((s) => s.bucket === 'judgment'),
    human: count((s) => s.bucket === 'human'),
    unattributed: count((s) => s.bucket === 'unattributed'),
};
const hazardsByRule = new Map();
for (const h of hazards) bump(hazardsByRule, h.rule);

const tracks = [];
if (recommended) tracks.push(`integrate/${framework === 'vanilla' ? 'vanilla-ts' : framework}.md`);
if (composer) tracks.push('integrate/php.md');
if (metaFramework?.track) tracks.push(metaFramework.track);
for (const i of incumbents) if (!tracks.includes(i.track)) tracks.push(i.track);

const profile = {
    root,
    projectRoot,
    framework,
    metaFramework: metaFramework?.name ?? null,
    envPrefixes: prefixes,
    incumbents: incumbents.map((i) => i.name),
    langsys: { js: langsysInstalled, php: langsysPhp },
    recommendedPackage: composer && !recommended ? 'langsys/langsys-php' : recommended,
    baseLocaleHints,
    catalogs,
    tracks,
    route: incumbents.length ? 'migrate' : 'integrate',
};

// ── Report ───────────────────────────────────────────────────────────────────

/**
 * Stated blind spots. These are not oversights; they are refusals to guess, and
 * they ship in BOTH output modes — a JSON consumer that cannot see them would
 * read the totals as complete coverage, which is the exact failure this section
 * exists to prevent.
 */
const BLIND_SPOTS = [
    'Bare string literals in .ts/.js are NOT counted. Nothing reliably separates a user-visible string from a CSS class, an API path, or a log line, and a fabricated number here would be worse than no number.',
    'Text assembled at runtime, or supplied by a server or CMS, is invisible to a static scan.',
    'Site counts are an upper bound on WORK, not an estimate of translation cost. Cost is the deduplicated phrase count, and dedup happens at registration.',
    'The primitive shown is the FIRST decision only. Whether a <Phrase> should nest inside a <Translate> is a separate decision this tool does not make (see core/choosing-primitives.md).',
];

if (asJson) {
    console.log(JSON.stringify({
        profile,
        totals: { sites: sites.length, byKind, byBucket, hazards: hazards.length },
        sites,
        hazards,
        migrated: { ...migrated, files: [...migrated.files] },
        notExamined: {
            byExt: Object.fromEntries(notExamined.byExt),
            unreadable: notExamined.unreadable,
            dirsSkipped: [...notExamined.dirsSkipped],
            filesScanned,
            declaredBlindSpots: BLIND_SPOTS,
        },
    }, null, 2));
    process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (n, w = 5) => String(n).padStart(w);
const H = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);

console.log(`\nlangsys-scan — ${root}`);

H('PROFILE');
const row = (k, v) => console.log(`  ${pad(k + ':', 20)}${v}`);
row('Framework', framework ? framework : composer ? 'PHP' : 'unknown');
row('Meta-framework', metaFramework?.name ?? 'none — client-only');
row('Env prefix', prefixes === null ? 'n/a (no package.json)' : prefixes.length ? prefixes.join(' or ') : 'none required');
row('Existing i18n', incumbents.length ? incumbents.map((i) => i.name).join(', ') : 'none');
row('Langsys present', hasLangsys ? [...langsysInstalled, langsysPhp ? 'langsys/langsys-php' : null].filter(Boolean).join(', ') : 'no');
row('Recommended pkg', profile.recommendedPackage ?? 'undetermined');
row('Route', profile.route.toUpperCase());
row('Tracks', tracks.length ? tracks.join(' + ') : 'undetermined');

if (baseLocaleHints.length) {
    row('Base locale hint', baseLocaleHints.map((h) => `${h.value} (${h.from} → ${h.key})`).join(', '));
} else {
    row('Base locale', 'NOT FOUND — ask. Do not assume en-US; en-GB is a different catalog.');
}

if (catalogs.length) {
    H('EXISTING CATALOGS');
    for (const c of catalogs) {
        console.log(`  ${pad(c.dir, 24)}${num(c.files)} file(s)  ${num(c.keys)} key(s)  locales: ${c.locales.join(', ') || 'undetermined'}`);
    }
    console.log(`\n  The base-locale catalog is a REQUIRED INPUT, not a reference. Langsys uses the`);
    console.log(`  phrase as the key, so every namespaced key must be resolved to its source text.`);
}

H(`CONVERSION SITES  (${sites.length})`);
console.log(`  ${pad('t()', 14)}${num(byKind['t()'])}   plain string in markup — neither component applies`);
console.log(`  ${pad('attribute', 14)}${num(byKind.attribute)}   ${TRANSLATABLE_ATTRS.length} harvested attrs + value on buttons — always t()`);
console.log(`  ${pad('<Phrase>', 14)}${num(byKind.Phrase)}   one sentence carrying inline markup — keep whole`);
console.log(`  ${pad('<Translate>', 14)}${num(byKind.Translate)}   container — see overlap note below`);
console.log(`  ${pad('existing call', 14)}${num(byKind.call)}   already routed through an i18n function`);

if (byKind.Translate > 0) {
    console.log(`\n  OVERLAP: <Translate> counts do not ADD to the others. Adopting <Translate> on a`);
    console.log(`  container replaces the individual t() sites beneath it — the two rows are`);
    console.log(`  alternative treatments of the same markup, and which one is right is a judgement.`);
}

H('BY EFFORT');
console.log(`  ${pad('mechanical', 14)}${num(byBucket.mechanical)}   direct swap`);
console.log(`  ${pad('judgment', 14)}${num(byBucket.judgment)}   the phrase boundary is a real choice`);
console.log(`  ${pad('human', 14)}${num(byBucket.human)}   agreement risk, pre-formatting, or missing source text`);
if (byBucket.unattributed) {
    console.log(`  ${pad('unattributed', 14)}${num(byBucket.unattributed)}   t()-shaped calls with no i18n library declared — inspect`);
}

if (hazards.length) {
    H(`HAZARDS  (${hazards.length})`);
    console.log(`  Scope, not violations. This code predates Langsys, so none of it is a defect`);
    console.log(`  today — each becomes one the moment the phrase reaches the SDK.\n`);
    for (const [rule, n] of [...hazardsByRule].sort((a, b) => b[1] - a[1])) {
        const first = hazards.find((h) => h.rule === rule);
        console.log(`  ${pad(rule, 30)}${num(n)}`);
        console.log(`      ${first.note}`);
        const shown = hazards.filter((h) => h.rule === rule).slice(0, 3);
        for (const h of shown) console.log(`      · ${h.file}:${h.line}  ${h.sample}`);
        if (n > shown.length) console.log(`      … and ${n - shown.length} more (--json for all)`);
        console.log();
    }
}

if (migrated.components || migrated.calls) {
    H('ALREADY LANGSYS');
    console.log(`  ${pad('components', 14)}${num(migrated.components)}   <Translate>/<Phrase>/<DontTranslate>`);
    console.log(`  ${pad('t() calls', 14)}${num(migrated.calls)}`);
    console.log(`  ${pad('files', 14)}${num(migrated.files.size)}`);
    console.log(`\n  Partially migrated. Converted sites are excluded from the counts above.`);
}

if (dirTally.size) {
    H('WHERE THE WORK IS');
    const dirs = [...dirTally].sort((a, b) => b[1] - a[1]);
    for (const [d, n] of dirs.slice(0, TOP)) console.log(`  ${num(n)}  ${d}`);
    if (dirs.length > TOP) {
        console.log(`\n  Showing the top ${TOP} of ${dirs.length} directories — the remaining ${dirs.length - TOP}`);
        console.log(`  hold ${dirs.slice(TOP).reduce((a, [, n]) => a + n, 0)} site(s). This is a display limit only; nothing was dropped from the totals.`);
    }
}

// ── NOT EXAMINED — printed unconditionally, including when empty ─────────────

H('NOT EXAMINED');
console.log(`  Scanned: ${filesScanned.markup} markup file(s), ${filesScanned.code} code file(s).`);

if (notExamined.unreadable.length) {
    console.log(`\n  Failed to read or parse (${notExamined.unreadable.length}):`);
    for (const u of notExamined.unreadable) console.log(`    · ${u.file} — ${u.reason}`);
} else {
    console.log(`  Failed to read or parse: 0`);
}

if (notExamined.byExt.size) {
    const exts = [...notExamined.byExt].sort((a, b) => b[1] - a[1]);
    console.log(`\n  File types not scanned:`);
    for (const [e, n] of exts) console.log(`    ${num(n)}  ${e}`);
} else {
    console.log(`  File types not scanned: none`);
}

if (notExamined.dirsSkipped.size) {
    console.log(`\n  Directories skipped: ${[...notExamined.dirsSkipped].sort().join(', ')}`);
}

console.log(`\n  Declared blind spots:`);
for (const b of BLIND_SPOTS) {
    const wrapped = b.match(/.{1,86}(\s|$)/g) ?? [b];
    console.log(`    · ${wrapped[0].trim()}`);
    for (const w of wrapped.slice(1)) console.log(`      ${w.trim()}`);
}

H('NEXT');
console.log(`  1. Run doctor to check env, key type and SDK versions:`);
console.log(`       npx langsys-doctor`);
console.log(`  2. Read core/choosing-primitives.md before converting anything — the`);
console.log(`     ${byKind.Phrase + byKind.Translate} judgement site(s) above are where integrations go wrong.`);
console.log(`  3. Follow: ${tracks.length ? tracks.join(' + ') : 'detect.md (route undetermined)'}`);
console.log(`  4. Verify with verify.md — inspect the REGISTERED PHRASE SET, not just the page.\n`);

process.exit(0);
