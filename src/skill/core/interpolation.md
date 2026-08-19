# Interpolation: `{name}` vs `%name%`

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
- **ICU MessageFormat is brace-based by specification.** `{count, plural, one {# item} other {# items}}` cannot use a different delimiter.

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

- **Numbers** → `Intl.NumberFormat` for the active locale (`1234.5` → `1.234,5` in `de-DE`)
- **Dates** → `Intl.DateTimeFormat`, medium style (`Mar 14, 2026` / `14.03.2026`)
- **Strings** → passed through untouched

Formatting uses the **catalog locale**, not the host's default, so server and client render identically. To opt out — IDs, codes, anything that must not get grouping separators — pass the value as a string.

**Unknown keys stay visible** in canonical form (`%missing%` renders as `{missing}`) rather than blanking.

---

## ICU MessageFormat

Translations containing ICU syntax render with full CLDR plural rules for the active locale — Arabic's six categories, Russian's four:

```ts
t('{count, plural, one {# item} other {# items}}', 'Cart', { count });
```

Style-less ICU arguments (`{n, number}`, `{d, date}`, `{t, time}`) also format. Plain `{name}` slots keep working unchanged.

> This is the mechanism [choosing-primitives.md](./choosing-primitives.md) protects: a plural rule can only inflect a noun that is **in the same phrase** as the count. Splitting the sentence puts them in different catalog entries and makes the plural unexpressible.

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
