#!/usr/bin/env node
/**
 * Markup checks for Langsys component content.
 *
 * WHY THIS EXISTS SEPARATELY FROM ast-grep: ast-grep has no `.svelte` or `.vue`
 * grammar, and those are precisely the files where the `{name}` vs `%name%`
 * distinction bites hardest. So markup rules live here; everything expressible
 * as an AST query stays in src/lint/rules/*.yml.
 *
 * THE RULE IS POSITIONAL, NOT TEXTUAL. `{name}` is a defect inside <Translate>
 * / <Phrase> markup and is CORRECT inside a t()/$t() string literal — including
 * when that call sits lexically inside component markup. Flagging by spelling
 * alone rewrites working code into the very bug the rule exists to prevent, so
 * every t()/$t() call is masked out before markup is examined.
 *
 * Usage: node markup-check.mjs <path> [...]
 * Exit: 0 clean, 1 findings.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const EXTS = new Set(['.svelte', '.vue', '.tsx', '.jsx', '.html']);
const findings = [];

/** Replace a span with same-length spaces, preserving newlines and offsets. */
const blank = (s) => s.replace(/[^\n]/g, ' ');

/**
 * Mask regions where `{ident}` is legitimate, so later scans cannot see them:
 *   - t(...) / $t(...) call arguments  (JS strings — braces are correct there)
 *   - <script> blocks                  (not markup)
 *   - comments
 *   - params={{ ... }} / :params="..."  (the prop itself, ordinary framework syntax)
 */
function maskLegitimate(src) {
  let out = src;

  // <script> … </script>
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => blank(m));
  // <style> … </style>
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (m) => blank(m));
  // Comments
  out = out.replace(/<!--[\s\S]*?-->/g, (m) => blank(m));
  out = out.replace(/\/\*[\s\S]*?\*\//g, (m) => blank(m));
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)));

  // t( … ) and $t( … ) — mask the whole call including nested parens.
  out = maskCalls(out);

  // params={{ … }} (JSX/Svelte) and :params="…" (Vue) — the prop, not the content.
  out = out.replace(/:?params\s*=\s*\{\{[\s\S]*?\}\}/g, (m) => blank(m));
  out = out.replace(/:params\s*=\s*"[^"]*"/g, (m) => blank(m));

  return out;
}

/** Mask t(...) / $t(...) calls, balancing parentheses. */
function maskCalls(src) {
  const chars = [...src];
  const re = /(^|[^A-Za-z0-9_$.])(\$?t)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length - 1; // at '('
    let depth = 0;
    let inStr = null;
    for (; i < src.length; i++) {
      const c = src[i];
      const prev = src[i - 1];
      if (inStr) {
        if (c === inStr && prev !== '\\') inStr = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { i++; break; } }
    }
    for (let j = m.index + m[0].length - 1; j < i && j < chars.length; j++) {
      if (chars[j] !== '\n') chars[j] = ' ';
    }
  }
  return chars.join('');
}

/** Find <Translate>/<Phrase> element spans in the masked source. */
function componentSpans(masked) {
  const spans = [];
  const re = /<(Translate|Phrase)\b[^>]*>/g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const tag = m[1];
    const close = masked.indexOf(`</${tag}>`, re.lastIndex);
    spans.push({
      tag,
      start: re.lastIndex,
      end: close === -1 ? masked.length : close,
      openLine: masked.slice(0, m.index).split('\n').length,
    });
  }
  return spans;
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

function checkFile(path) {
  const src = readFileSync(path, 'utf8');
  const masked = maskLegitimate(src);
  const isVue = extname(path) === '.vue';

  for (const span of componentSpans(masked)) {
    const body = masked.slice(span.start, span.end);

    // RULE 1 — {ident} in component markup.
    // Vue templates consume only {{ }}, so a single {name} survives there; it is
    // still discouraged for portability, hence warn rather than error in .vue.
    const braceRe = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g;
    let b;
    while ((b = braceRe.exec(body)) !== null) {
      const abs = span.start + b.index;
      findings.push({
        path,
        line: lineOf(src, abs),
        level: isVue ? 'warn' : 'error',
        rule: 'markup-brace-placeholder',
        msg: `{${b[1]}} inside <${span.tag}> markup — write %${b[1]}% instead`,
        note: isVue
          ? 'Vue consumes only {{ }}, so this happens to work — but %name% is the portable form every binding accepts.'
          : 'The framework compiler substitutes {name} before Langsys sees the text. Silent failure: the base language still renders correctly, and it breaks only on locale switch.',
      });
    }

    // RULE 2 — {{ ident }} in Vue component markup: actively broken.
    if (isVue) {
      const mustacheRe = /\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g;
      let mm;
      while ((mm = mustacheRe.exec(body)) !== null) {
        findings.push({
          path,
          line: lineOf(src, span.start + mm.index),
          level: 'error',
          rule: 'markup-mustache-placeholder',
          msg: `{{ ${mm[1]} }} inside <${span.tag}> markup — write %${mm[1].split('.').pop()}% and pass it via params`,
          note: 'Vue interpolates {{ }} before Langsys captures the text, so the registered phrase contains one specific value.',
        });
      }
    }

    // RULE 3 — block element inside <Phrase>: a block collapsed into one phrase.
    if (span.tag === 'Phrase') {
      const blockRe = /<\s*(p|div|section|article|ul|ol|li|h[1-6]|table|form)\b/gi;
      let blk;
      while ((blk = blockRe.exec(body)) !== null) {
        findings.push({
          path,
          line: lineOf(src, span.start + blk.index),
          level: 'error',
          rule: 'phrase-contains-block',
          msg: `<${blk[1]}> inside <Phrase> — a block element belongs in <Translate>`,
          note: '<Phrase> collapses its whole subtree into ONE translatable phrase. Use it for a single sentence containing inline markup; use <Translate> for a block.',
        });
      }
    }

    // RULE 4 — inline markup inside <Translate>: the run is split at tag boundaries.
    //
    // Verified behaviour, not a guess: Translate recurses and tokenizes per TEXT
    // NODE (translate.ts), so `<p>A <strong>B</strong> C</p>` registers three
    // phrases — "A", "B", "C".
    //
    // Severity is decided by ONE precise condition, not a heuristic about params:
    // a placeholder AND inline markup inside the SAME text run means the value and
    // the word it governs are about to land in different catalog entries. That is
    // the pluralization break. Everything else is a judgement call for a human,
    // because prose legitimately containing <em> is exactly what Translate is for.
    if (span.tag === 'Translate') {
      const inlineRe = /<\s*(strong|em|b|i|a|span|code|mark)\b/gi;

      // Split the block into text runs at block-element boundaries, so
      // "same run" means what it means to the tokenizer.
      const runs = body.split(/<\s*\/?(?:p|div|section|article|ul|ol|li|h[1-6]|table|form|br)\b[^>]*>/i);
      let cursor = 0;
      for (const run of runs) {
        const runStart = body.indexOf(run, cursor);
        cursor = runStart + run.length;
        if (!run.trim()) continue;

        const hasInline = /<\s*(strong|em|b|i|a|span|code|mark)\b/i.test(run);
        if (!hasInline) continue;
        const hasPlaceholder = /%[A-Za-z_][A-Za-z0-9_]*%|\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}/.test(run);

        inlineRe.lastIndex = 0;
        const first = inlineRe.exec(run);
        findings.push({
          path,
          line: lineOf(src, span.start + runStart + (first?.index ?? 0)),
          level: hasPlaceholder ? 'error' : 'warn',
          rule: 'translate-splits-sentence',
          msg: `<${first?.[1]}> inside <Translate> — this run is split at the tag boundary`,
          note: hasPlaceholder
            ? 'This run contains BOTH a placeholder and inline markup, so the value and the word it governs land in different catalog entries. No plural rule can then inflect the noun against the count — broken in Russian (4 categories), Arabic (6), Polish. Use <Phrase> to keep the run whole.'
            : 'Registers as separate phrases ("My content", "is the best", "when translated"). If this is ONE sentence, use <Phrase>. If these are separate units of prose, <Translate> is correct — review and decide.',
        });
      }
    }
  }
}

function walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    if (/node_modules|\.git|dist|build|\.svelte-kit|\.next|\.nuxt/.test(p)) return;
    for (const e of readdirSync(p)) walk(join(p, e));
  } else if (EXTS.has(extname(p))) {
    checkFile(p);
  }
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('usage: markup-check.mjs <path> [...]');
  process.exit(2);
}
for (const t of targets) walk(t);

const errors = findings.filter((f) => f.level === 'error');
const warns = findings.filter((f) => f.level === 'warn');

for (const f of [...errors, ...warns]) {
  const tag = f.level === 'error' ? 'error' : 'warn ';
  console.log(`${tag} [${f.rule}] ${f.path}:${f.line}`);
  console.log(`      ${f.msg}`);
  if (f.note) console.log(`      ${f.note}`);
  console.log();
}
console.log(`${errors.length} error(s), ${warns.length} warning(s)`);
process.exit(errors.length > 0 ? 1 : 0);
