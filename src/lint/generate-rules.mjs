#!/usr/bin/env node
/**
 * Generates per-language ast-grep rule files from one source of truth.
 *
 * ast-grep rules are single-language, so a rule that should apply to .ts, .tsx
 * and .js needs three near-identical files. Hand-maintaining them guarantees
 * drift, so they are generated instead — edit RULES here, run this, commit.
 */

import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'rules');

/** ast-grep language ids → file extensions they own. */
const LANGS = ['TypeScript', 'Tsx', 'JavaScript'];

const RULES = [
  {
    id: 'no-template-literal-phrase',
    severity: 'error',
    message: 'Template literal as a Langsys phrase — registers a new catalog entry per value',
    note: `Each distinct interpolated value registers a SEPARATE phrase in the shared
Translation Manager — "Hello, Sarah!", "Hello, Ahmed!", one per user. Unbounded
catalog pollution, billed as translatable words, and it cannot be undone by
changing code. The SDK cannot detect this: once the string arrives, an
interpolated value is indistinguishable from an authored one.

  t(\`Hello, \${name}!\`)                       // wrong
  t('Hello, {name}!', 'Greetings', { name })  // right`,
    rule: {
      any: [
        { pattern: 't(`$$$A`)' },
        { pattern: 't(`$$$A`, $$$REST)' },
        { pattern: '$t(`$$$A`)' },
        { pattern: '$t(`$$$A`, $$$REST)' },
      ],
      has: { kind: 'template_substitution', stopBy: 'end' },
    },
  },
  {
    id: 'no-concatenated-phrase',
    severity: 'error',
    message: 'Concatenated string as a Langsys phrase — registers a new catalog entry per value',
    note: `Same failure mode as a template literal: every distinct runtime value becomes
its own catalog phrase in shared state.

  t('Hello, ' + name + '!')                   // wrong
  t('Hello, {name}!', 'Greetings', { name })  // right`,
    rule: {
      any: [
        { pattern: 't($A + $B)' },
        { pattern: 't($A + $B, $$$REST)' },
        { pattern: '$t($A + $B)' },
        { pattern: '$t($A + $B, $$$REST)' },
      ],
    },
  },
  {
    id: 'no-dot-key-phrase',
    severity: 'error',
    message: 'Dot-separated key passed to t() — Langsys uses the phrase itself as the key',
    note: `This is an i18next habit. Langsys has no catalog files: the source text IS the
key AND the base-language default. A dot-key registers the literal string
"home.welcome" as a translatable phrase.

  t('home.welcome')            // wrong — registers "home.welcome"
  t('Welcome back', 'Home')    // right`,
    rule: {
      any: [
        { pattern: "t('$KEY')" },
        { pattern: "t('$KEY', $$$REST)" },
        { pattern: "$t('$KEY')" },
        { pattern: "$t('$KEY', $$$REST)" },
      ],
    },
    constraints: {
      // Lowercase dotted identifiers only: "home.welcome", "errors.auth.failed".
      // Sentences containing a full stop are not identifier-shaped and won't match.
      KEY: { regex: '^[a-z][a-zA-Z0-9_]*(\\.[a-z][a-zA-Z0-9_]*)+$' },
    },
  },
  {
    id: 'no-html-in-phrase',
    severity: 'error',
    message: 'HTML markup inside a t() phrase — it will never render as markup',
    note: `A t() phrase is rendered as text. Tags inside it are escaped or shown literally.
For a sentence that contains inline markup, use <Phrase>, which keeps the run as
one translatable phrase and reconstitutes the real elements around the
translation.

  t('Based on <strong>5</strong> reviews')                  // wrong
  <Phrase params={{ n }}>Based on %n% <strong>reviews</strong></Phrase>  // right`,
    rule: {
      any: [
        { pattern: "t('$P')" },
        { pattern: "t('$P', $$$REST)" },
        { pattern: '$t("$P")' },
        { pattern: '$t("$P", $$$REST)' },
      ],
    },
    constraints: {
      P: { regex: '<\\s*/?\\s*[a-zA-Z][a-zA-Z0-9]*(\\s[^>]*)?>' },
    },
  },
  {
    id: 'reversed-t-arguments',
    severity: 'error',
    message: 'Reversed t() arguments — the phrase comes first, the category second',
    note: `The signature is t(phrase, category?, params?). Both orders typecheck when the
phrase has no placeholders, so the compiler will not catch a reversal — which is
why this survives review.

This rule fires only where the second argument is unambiguously a PHRASE, using
two asymmetries between phrases and categories:

  1. It contains a {…} placeholder. Categories never do; phrases often do.
  2. It ends in terminal sentence punctuation (. ! ? …). Categories are labels
     — "Main Menu", "Home repairs", "ProductCard" — and labels do not end in a
     full stop. Only a TERMINAL mark counts, so a versioned label like
     "Release 1.2 notes" is safe, and ':' is excluded because "Note:" is a
     plausible label.

  t('UI', 'Hello, {name}!')             // wrong — registers "UI" as the phrase
  t('UI', 'Save your work.')            // wrong — same, caught by rule 2
  t('Hello, {name}!', 'UI', { name })   // right
  t('Save', 'UI')                       // correct but UNDETECTABLE — left alone

A reversal whose phrase is short and unpunctuated cannot be distinguished from a
correct call, so it is deliberately not flagged. Coverage is traded away to keep
false positives at zero: a rule that fires on correct code gets disabled, and
then catches nothing at all.`,
    rule: {
      any: [
        { pattern: "t($CAT, '$PHRASE')" },
        { pattern: "t($CAT, '$PHRASE', $$$REST)" },
        { pattern: "$t($CAT, '$PHRASE')" },
        { pattern: "$t($CAT, '$PHRASE', $$$REST)" },
      ],
    },
    constraints: {
      // Tier 1: contains a placeholder. Tier 2: ends in terminal sentence
      // punctuation (not ':' — "Note:" is a plausible category label).
      PHRASE: { regex: '\\{\\s*[A-Za-z_][A-Za-z0-9_]*\\s*\\}|[.!?…]$' },
      CAT: { kind: 'string' },
    },
  },
  {
    id: 'no-object-param-value',
    severity: 'error',
    message: 'Object or array as a params value — only string | number | Date | boolean are allowed',
    note: `Param values must be ParamPrimitive (string | number | Date | boolean). An
object or array renders as "[object Object]" — it has always been broken at
runtime, and base SDK 0.5.0 narrowed the type so it is now a build error too.

  <Phrase params={{ user: someUserObject }}>   // wrong — renders [object Object]
  <Phrase params={{ name: user.name }}>        // right — pass the primitive

Declare wrapper prop types as Record<string, ParamPrimitive>, never
Record<string, unknown>. The narrower type compiles against both 0.4.x and 0.5.0.`,
    // Tsx ONLY. These patterns contain JSX, which the plain TypeScript and
    // JavaScript grammars cannot parse — emitting them for those languages
    // produces rule files ast-grep rejects outright, taking the whole scan
    // down with it rather than just skipping the rule.
    langs: ['Tsx'],
    // Patterns need JSX ELEMENT context. A bare `params={{ … }}` parses as an
    // assignment expression in isolation, so the attribute never matches.
    rule: {
      any: [
        { pattern: '<$C params={{ $KEY: { $$$OBJ } }}>$$$CH</$C>' },
        { pattern: '<$C params={{ $KEY: [ $$$ARR ] }}>$$$CH</$C>' },
        { pattern: '<$C params={{ $KEY: { $$$OBJ } }} />' },
        { pattern: '<$C params={{ $KEY: [ $$$ARR ] }} />' },
      ],
    },
  },
  {
    id: 'no-init-apiurl',
    severity: 'error',
    message: '`apiUrl` is not a field on iLangsysInitConfig — it is silently dropped',
    note: `Verified absent from langsys-js-typescript@0.4.3. TypeScript reports an excess
property; plain JS gets no signal at all and keeps talking to production.

  LangsysApp.init({ apiUrl: '...' })            // wrong
  LangsysAppAPI.setBaseUrl('...'); await LangsysApp.init({ ... })  // right (before init)`,
    rule: {
      pattern: 'LangsysApp.init($CONF)',
      has: { kind: 'pair', has: { field: 'key', regex: '^apiUrl$' }, stopBy: 'end' },
    },
  },
];

/**
 * PHP rules, kept separate because the grammar and the API shape differ.
 *
 * CRITICAL SCOPING: only the FIRST argument of translate() is the phrase.
 * $locale (2nd), $category (3rd), $contentBlockId (4th) and $params (5th) are
 * SUPPOSED to hold dynamic expressions — flagging those would fire on correct
 * code, which is how a rule gets disabled and then catches nothing.
 */
const PHP_RULES = [
  {
    id: 'php-no-sprintf-phrase',
    severity: 'error',
    message: 'sprintf() as a Langsys phrase — registers a new catalog entry per value',
    note: `Every distinct value produces a SEPARATE catalog phrase — "Hello, Sarah!",
"Hello, Ahmed!", one per user — billed as translatable words and readable by
every other Langsys SDK. It cannot be undone by fixing the code afterwards.

The SDK cannot detect this at runtime: once the string arrives, an interpolated
value is indistinguishable from an authored one. Static detection is the only
defense that fires before the catalog is polluted.

  \\$client->translate(sprintf('Hello, %s!', \\$name));                        // wrong
  \\$client->translate('Hello, {name}!', null, null, null, ['name' => \\$name]); // right

Only the FIRST argument is the phrase. \\$locale, \\$category and \\$params are
expected to be dynamic and are not flagged.`,
    rule: {
      any: [
        { pattern: '$C->translate(sprintf($$$A))' },
        { pattern: '$C->translate(sprintf($$$A), $$$R)' },
        { pattern: '$C->translate(vsprintf($$$A))' },
        { pattern: '$C->translate(vsprintf($$$A), $$$R)' },
        { pattern: '$C->translateContentBlock(sprintf($$$A))' },
        { pattern: '$C->translateContentBlock(sprintf($$$A), $$$R)' },
      ],
    },
  },
  {
    id: 'php-no-concatenated-phrase',
    severity: 'error',
    message: 'Concatenated string as a Langsys phrase — registers a new catalog entry per value',
    note: `In PHP this is the most common form of the mistake — more likely than
sprintf(), because '.' concatenation is the reflex.

  \\$client->translate('Hello, ' . \\$name . '!');                              // wrong
  \\$client->translate('Hello, {name}!', null, null, null, ['name' => \\$name]); // right`,
    rule: {
      any: [
        { pattern: '$C->translate($A . $B)' },
        { pattern: '$C->translate($A . $B, $$$R)' },
        { pattern: '$C->translateContentBlock($A . $B)' },
        { pattern: '$C->translateContentBlock($A . $B, $$$R)' },
      ],
    },
  },
  {
    id: 'php-no-interpolated-phrase',
    severity: 'error',
    message: 'Interpolated double-quoted string as a Langsys phrase — registers a new catalog entry per value',
    note: `PHP's "$name" interpolation is the direct analogue of a JS template literal
and fails identically — the variable is substituted before the SDK ever sees the
string, so each distinct value becomes its own catalog phrase.

  \\$client->translate("Hello, \\$name!");                                      // wrong
  \\$client->translate('Hello, {name}!', null, null, null, ['name' => \\$name]); // right

A double-quoted string with NO interpolation is fine and is not flagged.`,
    rule: {
      any: [
        { pattern: '$C->translate($ARG)' },
        { pattern: '$C->translate($ARG, $$$R)' },
        { pattern: '$C->translateContentBlock($ARG)' },
        { pattern: '$C->translateContentBlock($ARG, $$$R)' },
      ],
    },
    constraints: {
      // Pure AST, no text matching. Three things make this work, and each was
      // non-obvious:
      //
      //  1. $ARG binds to the `argument` node that WRAPS the string, not to the
      //     string itself — which is why constraining on `encapsed_string`
      //     directly matched nothing.
      //  2. `encapsed_string` is NOT a discriminator on its own: this grammar
      //     assigns it to every double-quoted string, `"plain"` included. It is
      //     used here purely as an anchor.
      //  3. The real discriminator is a `variable_name` DESCENDANT. Every PHP
      //     interpolation form must reference a variable, so this is complete
      //     and minimal. `stopBy: end` is required — without it `"{$o->m()}"`
      //     and `"{$c::$s}"` are missed, since the variable sits deeper.
      //
      // Keep the encapsed_string anchor. Matching `variable_name` anywhere under
      // ARG would also flag `translate($phrase)` — a bare variable holding a
      // legitimate constant phrase.
      ARG: {
        kind: 'argument',
        has: {
          kind: 'encapsed_string',
          has: { stopBy: 'end', kind: 'variable_name' },
        },
      },
    },
  },
];

// ast-grep requires rule ids to be unique ACROSS FILES, not per language. A rule
// emitted for three grammars therefore needs three distinct ids — ast-grep 0.45
// rejects the duplicate set outright and aborts the entire scan, which the CI
// lint step (`|| true`) would then report as clean. Older versions tolerated it,
// so this surfaced only on a clean checkout with a current CLI.
const ruleId = (rule, lang) => `langsys-${rule.id}-${lang.toLowerCase()}`;

function toYaml(rule, lang) {
  const body = {
    id: ruleId(rule, lang),
    language: lang,
    severity: rule.severity,
    message: rule.message,
    ...(rule.note ? { note: rule.note } : {}),
    rule: rule.rule,
    ...(rule.constraints ? { constraints: rule.constraints } : {}),
  };
  return serialize(body, 0);
}

/** Minimal YAML emitter — enough for these rule shapes, no dependency. */
function serialize(value, indent) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    return value.map((v) => {
      const inner = serialize(v, indent + 1).replace(/^\s+/, '');
      return `${pad}- ${inner}`;
    }).join('\n');
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([k, v]) => {
      if (v && typeof v === 'object') {
        return `${pad}${k}:\n${serialize(v, indent + 1)}`;
      }
      return `${pad}${k}: ${scalar(v, indent)}`;
    }).join('\n');
  }
  return `${pad}${scalar(value, indent)}`;
}

function scalar(v, indent) {
  if (typeof v !== 'string') return String(v);
  if (v.includes('\n')) {
    const pad = '  '.repeat(indent + 1);
    return `|\n${v.split('\n').map((l) => (l ? pad + l : '')).join('\n')}`;
  }
  // Quote anything YAML could misread.
  if (/[:#\-{}[\]&*!|>'"%@`]|^\s|\s$/.test(v)) return JSON.stringify(v);
  return v;
}

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.endsWith('.yml')) unlinkSync(join(outDir, f));

let n = 0;
for (const rule of RULES) {
  // A rule may restrict itself (e.g. JSX patterns are Tsx-only). Emitting a rule
  // for a grammar that cannot parse its patterns makes ast-grep reject the file
  // and abort the entire scan, not just skip that rule.
  for (const lang of rule.langs ?? LANGS) {
    const file = join(outDir, `${rule.id}.${lang.toLowerCase()}.yml`);
    writeFileSync(file, toYaml(rule, lang) + '\n');
    n++;
  }
}
for (const rule of PHP_RULES) {
  writeFileSync(join(outDir, `${rule.id}.php.yml`), toYaml(rule, 'Php') + '\n');
  n++;
}
console.log(`Generated ${n} rule files (${RULES.length} JS/TS rules × ${LANGS.length} languages, ${PHP_RULES.length} PHP rules) in ${outDir}`);
