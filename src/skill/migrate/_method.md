# Migration methodology

Moving a project from i18next / react-intl / vue-i18n / gettext onto Langsys.

**Read this before any library-specific track.** The phases matter more than the syntax mapping — phase 2 is where naive migrations silently corrupt an application.

## The shape of the change

| Before | After |
|---|---|
| `t('home.welcome')` + `en.json` mapping it to "Welcome back" | `t('Welcome back', 'Home')` |
| Keys are identifiers; catalogs live in the repo | The phrase **is** the key; no catalogs in the repo |
| `{{name}}` (i18next) / `{name}` (ICU) | `{name}` in `t()`, `%name%` in markup |
| `<Trans>` for markup-bearing sentences | `<Phrase>` |
| Namespaces scope keys | Categories disambiguate meaning |

The old catalogs are **inputs** to the migration, not something to recreate.

---

## Phase 1 — Inventory

Count before changing anything.

```bash
# Call sites
ast-grep --lang tsx -p "t($$$ARGS)" src/ | wc -l
ast-grep --lang tsx -p "<Trans $$$>" src/ | wc -l

# Catalogs
find . -path ./node_modules -prune -o -name "*.json" -path "*locale*" -print
```

Record: number of call sites, number of keys in the base catalog, how many keys are unused, and which directories dominate.

**Report this before proceeding.** If the base catalog has 2,000 keys and the code has 300 call sites, most of the catalog is dead and should not be migrated.

## Phase 2 — Resolve keys to source strings

For each call site, look up the key in the **base-locale** catalog and recover the source text.

```
t('home.welcome')  +  en.json { "home": { "welcome": "Welcome back" } }
                   →  t('Welcome back', 'Home')
```

### Runtime-computed keys must be quarantined, never guessed

```ts
t(`errors.${code}`)              // ❌ cannot resolve statically
t(isAdmin ? 'nav.admin' : 'nav.user')
t(item.labelKey)
```

**This is where naive migrations corrupt applications.** A model that guesses which string a dynamic key resolves to will be wrong some of the time, and the failure is invisible — the app still renders, just with the wrong text in some branch.

Write every unresolvable site to `langsys-migration-quarantine.md` with file, line, and the expression. **A human decides each one.** Do not translate them, do not delete them, do not guess.

Typical resolutions a human might choose:

```ts
// Before
t(`errors.${code}`)

// After — explicit mapping, each phrase a literal
const ERROR_PHRASES = {
    not_found: 'We couldn’t find that page',
    forbidden: 'You don’t have access to this',
} as const;
t(ERROR_PHRASES[code], 'Errors');
```

### Also quarantine

- Keys missing from the base catalog (the library was falling back to the key itself)
- Keys whose base value is empty
- Duplicate keys with **different** base values

## Phase 3 — Categorize

Derive a category per call site: key namespace first (`checkout.*` → `Checkout`), file path as fallback.

**Do not map namespaces 1:1.** That recreates the duplication Langsys exists to remove — `Save` in eight namespaces becomes eight catalog entries needing eight translations. Collapse to feature-level categories and let identical phrases share one entry. See [core/categories.md](../core/categories.md).

**Write the mapping table to disk and have it reviewed before any rewrite.**

```md
| Old key prefix | Category | Sites |
|---|---|---|
| checkout.*     | Checkout | 47    |
| common.*       | UI       | 112   |
| errors.*       | Errors   | 31    |
```

## Phase 4 — Rewrite

Mechanical once phases 2–3 are settled.

### Call sites

```ts
t('home.welcome')                          →  t('Welcome back', 'Home')
t('cart.items', { count })                 →  t('You have {count} items', 'Cart', { count })
```

### Interpolation syntax

| Library | Before | After |
|---|---|---|
| i18next | `{{name}}` | `{name}` |
| react-intl / ICU | `{name}` | `{name}` (unchanged) |
| vue-i18n | `{name}` or `{0}` | `{name}` — **named only**; positional args have no Langsys equivalent |

Positional placeholders (`{0}`, `%s`) must become **named** ones. Translators need the name to know what the value is.

### `<Trans>` → `<Phrase>`, never `<Translate>`

**The highest-risk single decision in the whole migration.**

```tsx
// Before
<Trans i18nKey="reviews">Based on <strong>{{count}}</strong> reviews</Trans>

// After
<Phrase category="ProductCard" params={{ count }}>
  Based on %count% <strong>reviews</strong>
</Phrase>
```

`<Trans>` exists in i18next/react-intl for exactly the reason `<Phrase>` exists in Langsys: a sentence containing inline markup must stay **one** translatable unit. Mapping it to `<Translate>` splits it at every tag boundary and shreds every sentence it was protecting — and breaks pluralization in Russian, Arabic, and Polish. See [core/choosing-primitives.md](../core/choosing-primitives.md).

### Plurals

```ts
// i18next — separate _one / _other keys
"item_one": "{{count}} item", "item_other": "{{count}} items"

// Langsys — one ICU phrase
t('{count, plural, one {# item} other {# items}}', 'Cart', { count })
```

### Never pre-format

If the old code built strings, fix it now rather than carrying the habit across:

```ts
t('greeting') + ' ' + name          // ❌
t('Hello, {name}!', 'UI', { name })  // ✅
```

## Phase 5 — Rewire

1. Install the Langsys binding; wire `init()` per the matching integrate track
2. Remove the old provider (`I18nextProvider`, `IntlProvider`, `createI18n`) and its config
3. Delete old catalog files — **only after phase 6 passes**
4. Remove the old dependency from `package.json`

Keeping both libraries briefly is fine and often safer for a large migration; do it feature by feature.

## Phase 6 — Verify

Everything in [verify.md](../verify.md), plus:

- [ ] **Quarantine report reviewed** and every entry resolved by a human
- [ ] Old catalog key count vs. registered phrase count — a large gap needs explaining
- [ ] Spot-check 10 random call sites against the old base catalog for exact text
- [ ] No `t('some.key')` dot-key survivors (`langsys-no-dot-key-phrase` catches these)
- [ ] `<Trans>` sites all became `<Phrase>`, none became `<Translate>`
- [ ] Old dependency removed and the app still builds

## What cannot be migrated automatically

**Existing translations.** The SDK registers *phrases* using the write key, but importing an existing translated catalog's **text** is not exposed through any SDK — it needs user-level authentication.

So: migrate the source strings, then let machine translation and translation memory refill the target languages in the Translation Manager. If preserving human-reviewed translations matters, raise it with the Langsys team before starting — that is a product decision, not something this skill can work around.

**Say this to the user before phase 4**, not after. It changes whether they want to proceed.
