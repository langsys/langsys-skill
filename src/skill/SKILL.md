---
name: langsys
description: The Langsys entry skill. Read this first for any work on Langsys translation — adding translations, internationalization, i18n, l10n, localization or multi-language support — then the core skill of the SDK's language and the framework's own skill. Covers what Langsys is, choosing the SDKs, the project, API keys and secrets, whether a session may register content, categories, the MCP, the scan and doctor tools, and projects that render through two SDKs.
metadata:
  package: langsys-skill
  version: 0.3.3
---

# Langsys

Langsys is a realtime translation manager. **Phrases are discovered from your running app and
the source text is the key** — there are no catalog files in your repository, and no message
ids to invent. Untranslated text renders as its source, so the base language always reads
as written.

That last property is why most Langsys mistakes are invisible. They do not break the page;
they register the wrong thing, and someone finds out weeks later in another language.

## This skill is the first of three

| Step | Skill | Holds |
|---|---|---|
| 1 | **`langsys`** — this one | what is true in every language |
| 2 | the language's core | `langsys-typescript` for JS/TS, `langsys-php` for PHP |
| 3 | the framework's own | `langsys-svelte`, and others as they ship — only what its framework changes |

**Never skip a step.** A framework skill lists deltas; the rules those deltas modify are in
steps 1 and 2.

If a step-2 or step-3 skill is not among your skills, that package has not had a release
carrying one yet — [sdk-versions.md](./sdk-versions.md) says what to read instead, and
[pinned/README.md](./pinned/README.md) holds the guides for the packages that still need them. Do not substitute
a different version's skill; that is the one move guaranteed to be wrong.

## Start here

1. **Size it and check it.** `scan` for the profile and the amount of work, `doctor` for
   whether the setup is sound and which guidance applies — [tools.md](./tools.md).
   ```bash
   node .langsys/bin/scan.mjs .
   node .langsys/bin/doctor.mjs
   ```
2. **Pick the SDK(s)** — [choosing-sdks.md](./choosing-sdks.md). One per place content is
   rendered; a PHP backend plus a JS frontend is two.
3. **Check the versions before installing** — [sdk-versions.md](./sdk-versions.md). Which core
   a binding brings decides which rules apply, and in a React or Vue app you must never add
   the core yourself.
4. **Set up the project and keys** — [projects-and-keys.md](./projects-and-keys.md). Also the
   answer to "why is nothing registering".
5. **Read the step-2 core skill, then step 3**, and only then write code.
6. **Verify** — [verify.md](./verify.md). Not done until the registered phrase set has been
   read.

Is the MCP available in this session? If so you can create the organization, project and keys
directly — [mcp.md](./mcp.md). If not, mention it once and carry on; the skill works fully
without it:

```bash
claude mcp add --scope=user --transport http langsys https://mcp.langsys.dev/mcp
```

## The rules every Langsys SDK shares

Each core skill gives the API and the full reasoning. These are the rules themselves.

**1. Never build a phrase string.** An interpolated phrase registers a brand-new catalog entry
per distinct value — one per user, forever, in state every SDK on the project shares. No SDK
can detect it: by the time the string arrives, an interpolated value is indistinguishable from
an authored one.

```
t(`Hello, ${name}!`)                                   ❌ one phrase per user
t('Hello, {name}!', 'UI', { name })                    ✅
translate(sprintf('Hi, %s', $n))                       ❌
translate('Hi, {n}', null, null, null, ['n' => $n])    ✅
t(article.title, 'Blog')                               ✅ passing content through is not building it
```

The test is **cardinality, not syntax**. A CMS with 400 products registering 400 phrases is
the content you wanted translated; `${name}` registers one per visitor. Content from a CMS, a
database, a PIM feed or a partner API needs no special handling — the app is where content
converges, and that is where translation happens.

**2. Never write a plural or a gender form: Langsys makes them.** Write the sentence flat,
with the count or the name as a `{placeholder}`. Langsys makes each language's plural and
gender forms from it and the SDK renders the one the count selects. That includes your base
language: Langsys runs the same plural check on the base-language text, so English renders
`You have 1 new message` with no ICU in English either. Until a phrase's check has run, the
base language shows the sentence as written. A sentence that says something different at zero,
or that differs in the source language itself (his or her, iOS or Android), is its own phrase,
chosen in code.

```
t('You have {count} new messages', 'Inbox', { count })                                    ✅
translate('You have {count} new messages', null, 'Inbox', null, ['count' => $count])      ✅
t('{count, plural, one {# new message} other {# new messages}}', 'Inbox', { count })       ❌ ICU by hand
```

The skills in `langsys-js-typescript` 0.7.1 (which `langsys-js-svelte` 4.0.2 also reads) and
`langsys/langsys-php` 2.0.1, and the `langsys-php-laravel` 1.0.0 README, show plurals written by
hand in ICU; follow this rule there too. On `langsys/langsys-php` 1.x, which Laravel apps run,
the API flattens each plural to the one form its language uses for several things (`other` in
English, `many` in Russian, `few` in Arabic) and a select to its `other` branch; write the
sentence flat all the same.

The rule leaves two gaps, and each has its own answer:

- **Gender forms need the gender passed.** In a language with grammatical gender, Langsys can
  turn `{name}` into `{name_gender, select, …}` in the translation. Pass `name_gender`
  (`female`, `male`) beside `name`. `langsys-js-typescript` ≥ 0.7 (and so `langsys-js-svelte`
  4.x) and `langsys/langsys-php` 2.x accept it in any call. Core 0.6, which `langsys-js-react`
  0.6.x, `langsys-js-vue` 0.2.x and `langsys-js-svelte` 3.x run on, types `t()`'s params from
  the phrase as written, so an object literal carrying `name_gender` is a type error. Its runtime
  uses the param all the same. Pass it in a `<Phrase>` or `<Translate>` `params` prop, or in a
  params object built before the call, and the gendered form renders. When a component's debug
  warning says `name_gender` matches no placeholder and suggests `%name_gender%`, ignore it:
  writing that would print the gender into the sentence. Without the param a gendered
  translation renders its neutral `other` form, which is a correct sentence but not a gendered
  one. `langsys/langsys-php` 1.x never asks for these forms, so it always renders neutral.
- **Format dates, times and every number but the count yourself, and pass them as strings.**
  The server decides per language which sentences get plural or gender forms, so a call cannot
  know whether its sentence has them, and inside such a sentence two things go wrong:
  - **Numbers** other than the count render unformatted (`1234.5`, not `1.234,5`) in every SDK.
  - **Dates** on core 0.6 do not render as text. `t()` returns an array holding the raw `Date`.
    React throws *Objects are not valid as a React child*. A Vue template prints the array as
    JSON. `<Phrase>`, `<Translate>` and `langsys-js-svelte` 3.x's `$t` print it joined with commas, with the
    `Date` in its raw `toString()` form in the host's time zone.

  No SDK formats a time of day either. A `Date` renders as a date only, in the medium style
  (`Mar 14, 2026`). So format these values in the locale the page renders in and the user's
  time zone. On the server, that is the request's locale. In JavaScript:
  - a date: `new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(d)`
  - a time: `new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(d)`
  - a number: `new Intl.NumberFormat(locale).format(n)`

  In PHP:
  - a date: `(new IntlDateFormatter($locale, IntlDateFormatter::MEDIUM, IntlDateFormatter::NONE, $tz))->format($d)`
  - a time: the same with `NONE, SHORT`
  - a number: `(new NumberFormatter($locale, NumberFormatter::DECIMAL))->format($n)`

  The count stays a number, since it is what selects the plural. Do not write `{d, time}` or
  `{n, number}`.

**3. The source text is the key.** No `locales/en.json`, no `messages/`, no dot-keys.
`t('home.welcome')` registers the literal string `home.welcome`. If a project being migrated
has catalog files, they are *inputs* to the migration, not something to recreate.

> **Laravel is the deliberate exception.** There you keep writing `__('messages.welcome')` and
> keep your lang files: the key resolves to its line in the base-language file, and that
> sentence is the phrase. The key never reaches Langsys —
> [pinned/laravel.md](./pinned/laravel.md).

**4. Phrase first, category second.** `t(phrase, category?, params?)`. With a
placeholder-free phrase **both orders typecheck**, so the compiler will not catch a swap.

**5. Pick the primitive by asking where the phrase boundaries are** — not by how much text
there is. The question is whether a tag boundary belongs to the **language** or to the
**layout**.

| Content | Primitive | What it does |
|---|---|---|
| Plain string, no markup | a plain `t()` call | one phrase |
| One sentence that happens to contain inline markup | the keep-together primitive | encodes the whole run as **one** phrase |
| A block of markup — article, nav, form, marketing section | the splitting primitive | tokenizes each text node as its own phrase |

Using the splitting primitive on a sentence with `<strong>` in it shreds it into fragments no
translator can work with and no language can reorder — and a count separated from the noun it
inflects makes the plural **unexpressible** in Russian, Arabic and Polish. It still renders,
in word-salad, in every locale but yours.

**6. The server decides whether a session may register**, not the key's type. An answer
without that decision is read-only, even for a write key; an `ip_write` key writes only from
an allow-listed address; an app behind a login needs per-user write grants. A read-only
session reports a page's URL so Langsys can record where untranslated content is — **recording
is not registering**, and nothing on that list reaches the catalog until a write-enabled
session renders the page. [projects-and-keys.md](./projects-and-keys.md)

**7. Write key in development, read-only or `ip_write` in production.** And match the
environment-variable prefix to the bundler — the single most common silent misconfiguration.

**8. Categorize only when the same words legitimately mean different things.** `Home` the nav
item and `Home` the noun want different translations; most phrases want none.
[categories.md](./categories.md)

## Reference

[choosing-sdks.md](./choosing-sdks.md) · [sdk-versions.md](./sdk-versions.md) ·
[projects-and-keys.md](./projects-and-keys.md) · [two-languages.md](./two-languages.md) ·
[categories.md](./categories.md) · [mcp.md](./mcp.md) · [tools.md](./tools.md) ·
[verify.md](./verify.md) · [pinned/](./pinned/README.md)

Verified SDK behavior, and the versions each claim was checked against:
[VERIFIED.md](../VERIFIED.md)
