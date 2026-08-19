# Categories

```ts
t('Home', 'Main Menu')      // "Inicio"
t('Home', 'Home repairs')   // "Hogar"
```

A category is **disambiguation context**, not a namespace. The same phrase in two categories can have two different translations; the same phrase in one category has exactly one.

## Langsys's philosophy: translate once, use everywhere

This is the opposite of i18next, where every key is scoped by file or namespace by default.

In Langsys, `t('Save')` used in forty components is **one** catalog entry translated once. That is the intended behavior and the main efficiency win — do not fight it by categorizing reflexively.

**Categorize only when the same words legitimately mean different things.**

```ts
// ❌ Same meaning everywhere — the category buys nothing and costs a
//    duplicate translation per category
t('Save', 'UserSettingsForm')
t('Save', 'BillingForm')
t('Save', 'ProfileForm')

// ✅ One entry, translated once, used everywhere
t('Save', 'UI')
```

## Naming convention

The **module or feature** the phrase belongs to:

`Account` · `Auth` · `Checkout` · `Errors` · `Navigation` · `UI` · `Marketing` · `Emails`

Not the component name, not the file path, not a dotted hierarchy. Categories are flat.

| Good | Poor |
|---|---|
| `Checkout` | `src/routes/checkout/+page.svelte` |
| `Errors` | `errors.validation.email` |
| `UI` | `Button` |

## When you genuinely need one

1. **Homographs** — "Home", "Order", "Close", "Match", "Post", "Right"
2. **Register differences** — the same sentence formal in emails, casual in-app
3. **Length constraints** — a nav label that must stay short vs. the same words in prose

## Uncategorized is fine

```ts
t('Welcome back');   // lands in __uncategorized__
```

Perfectly valid. Add a category when ambiguity appears, not preemptively.

## For components

```jsx
<Translate category="Blog">…</Translate>
<Phrase category="ProductCard" params={{ n }}>…</Phrase>
```

Same rules. In PHP, `data-langsys-category` on an element, or selector-based mapping — see [integrate/php.md](../integrate/php.md).

## Migrating from namespaced keys

Do **not** map i18next namespaces 1:1 to categories — that recreates the duplication Langsys exists to remove. Collapse to feature-level categories and let identical phrases share entries. See [migrate/_method.md](../migrate/_method.md) phase 3.
