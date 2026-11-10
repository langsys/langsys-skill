# Interpolation: `{name}` vs `%name%`

> **Pinned guide.** Base SDK `langsys-js-typescript@0.6.5` — the core the React and Vue bindings install. **Not** core 0.7; for that read the `langsys-typescript` skill.
> A project on another version reads that package's own README instead —
> [why](../README.md).

Langsys uses two placeholder spellings. Using the wrong one **fails silently** — the base language renders correctly, so it passes review and breaks only when a user switches locale.

## The rule keys on position, not spelling

| Position | Spelling | Why |
|---|---|---|
| Inside `<Translate>` / `<Phrase>` **markup** | `%name%` | The framework compiler eats `{name}` before the SDK sees it |
| Inside a `t()` / `$t()` **string literal** | `{name}` | A JS string — no compiler touches it |

**Both are correct. Neither is a fallback for the other.**

```jsx
// Markup child of a component → %name%
<Translate category="Dashboard" params={{ name, count }}>
  <p>Welcome back, %name%. You have %count% new messages.</p>
</Translate>

// String literal argument → {name}
<p>{t('Welcome back, {name}!', 'Dashboard', { name })}</p>
```

Note the second example: the `t()` call is **lexically inside markup**, and `{name}` is still correct — it lives in a string literal, which no compiler rewrites. This is the case people get wrong when "fixing" braces by search-and-replace.

---

## Why the split is permanent

It is not an inconsistency waiting to be cleaned up:

- **`t()` phrases are JS strings.** No compiler stands between them and the SDK, so `{name}` arrives intact.
- **The translations Langsys sends are ICU MessageFormat**, which is brace-based by specification, so the placeholder a translation fills is `{name}` and cannot use a different delimiter.

So "one syntax everywhere" is unreachable. Markup is the exception because markup is compiled.

---

## What goes wrong with `{name}` in markup

```svelte
<!-- ❌ Svelte compiles {name} to an expression before Langsys sees the text -->
<Translate params={{ name }}>
  <p>Welcome back, {name}.</p>
</Translate>
```

Svelte substitutes the value, so the SDK captures `Welcome back, Sarah.` and registers **that** as the phrase. In the base locale it looks perfect. Switch to Spanish and there is no matching translation — the phrase registered was one specific user's greeting.

JSX behaves the same way. Vue is the exception (it consumes only `{{ }}`, so a single `{name}` survives) — but **write `%name%` in Vue anyway**: one portable rule beats three per-framework rules, and it avoids the `{{ }}` collision entirely.

---

## How `%name%` works

The base SDK normalizes `%name%` → `{name}` at capture time. So:

- **Translators only ever see `{name}`** — the canonical form
- Both spellings register the **same** content block
- Existing plain-HTML content using `{name}` keeps working

Only identifiers match: `%[A-Za-z_][A-Za-z0-9_]*%`. Literal percent signs in prose — "50% off", "width: 100%" — are never touched.

To keep a literal `%WORD%` (e.g. a Windows env var like `%PATH%` in documentation), wrap it in `<DontTranslate>`.

---

## Value formatting

Allowed types: `string | number | Date | boolean`.

- **Numbers** → `Intl.NumberFormat` for the catalog locale (`1234.5` → `1.234,5` in `de-DE`), but only in a sentence without plural or gender forms. Inside one, a number other than the count renders unformatted (`1234.5`). The server decides per language which sentences get those forms, so pass every number but the count as a string you formatted.
- **Dates** → `Intl.DateTimeFormat`, medium style (`Mar 14, 2026` / `14.03.2026`), **date only**, and again only outside plural and gender forms. Inside them a `Date` does not render as text: `t()` returns an array holding the raw `Date`, which React refuses as a child and Vue prints as JSON. So on this core **always pass a date as a string you formatted**. No form shows a time of day either, and `{d, time}` is ICU written by hand. Format in the catalog locale and the user's time zone. The catalog locale starts empty, so give it a fallback: `new Intl.DateTimeFormat(currentlyLoadedLocale.get() || 'en', { timeStyle: 'short', timeZone }).format(d)`. In a React or Vue component, read the locale with `useCurrentLocale()` instead, with the same fallback, so the text updates when the locale changes.
- **Strings** → passed through untouched

Formatting uses the **catalog locale**, not the host's default, so server and client render identically. To opt out — IDs, codes, anything that must not get grouping separators — pass the value as a string.

**Unknown keys stay visible** in canonical form (`%missing%` renders as `{missing}`) rather than blanking.

---

## Plurals and gender: write the sentence flat

**Never write ICU.** Write the sentence flat, with the count as a placeholder, and Langsys makes each language's plural forms, the base language included:

```ts
t('You have {count} new messages', 'Inbox', { count });
```

The core asks the API for those forms on every request (`X-Langsys-Capabilities: icu`) and `t()` renders them with full CLDR plural rules for the loaded catalog's locale, Arabic's six categories and Russian's four. That locale lags a locale change until just after the new catalog arrives. Until a phrase's base-language check has run, the base language shows the sentence as written. A sentence that says something different at zero is its own phrase, chosen in code.

> This is the mechanism [choosing-primitives.md](./choosing-primitives.md) protects: a plural rule can only inflect a noun that is **in the same phrase** as the count. Splitting the sentence puts them in different catalog entries and makes the plural unexpressible.

**Gender needs `name_gender` passed.** In a language with grammatical gender, Langsys can turn `{name}` into `{name_gender, select, …}` in the translation. Without `name_gender` the `select` takes its `other` branch and renders the neutral form, which is a correct sentence but not a gendered one. Core 0.6 types `t()`'s params from the phrase as written, so an object literal carrying `name_gender` is a type error, but the runtime uses it all the same. Pass it in the `<Phrase>` / `<Translate>` `params` prop, which is typed loosely, or in a params object built before the call: `const params = { name, name_gender: 'female' }; t('{name} has been invited', 'Team', params)`. In debug mode `<Phrase>` and `<Translate>` warn that `name_gender` matches no placeholder, and suggest writing `%name_gender%`. Ignore that advice, which would print the gender into the sentence. Do not work around it with ICU.

---

## Runtime safety net (base SDK ≥ 0.4.3)

With `debug: true`, the SDK detects this mistake. Passing `params` whose keys have **no matching placeholder** in the captured content is an unmistakable fingerprint of braces the compiler already ate:

```
Langsys Warning  <Translate> received params with no matching placeholder in its
content: %count%. If you wrote {count} or {{ count }} in markup, your framework's
template compiler substituted it before Langsys saw the text — write %count% instead.
```

- Fires for both `<Translate>` and `<Phrase>`
- Treats ICU slots as legitimate
- Re-warns only when the params **key set** changes, so a ticking counter won't spam
- Silent in production

**It is a net, not a detector.** It cannot observe the original braces — they are already gone — so it infers from unmatched params. Write `%name%` correctly in the first place; use the warning to verify.

**Below 0.4.3 this warning does not exist.** Check your installed version before relying on it.

---

## Verification

1. Run with `debug: true` and a write key
2. Confirm no unmatched-params warning in the console
3. Switch locale and confirm text actually changes
4. Confirm the registered phrases contain `{name}` placeholders, not substituted values
