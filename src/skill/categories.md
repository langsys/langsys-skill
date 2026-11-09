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

Same rules. In PHP, `data-langsys-category` on an element, or selector-based mapping — see the `langsys-php` core skill.

## Moving content to another category

**Category is part of a phrase's identity.** Change a call's category without saying where it
came from and Langsys sees new content: it is registered, machine translated and charged again,
and the translations people made under the old category stay behind.

To move it, **name the category it was registered under before**, in the same change. The API
copies the translations to the new item and retires the old one, and nothing is translated or
charged again:

```ts
t('Buy now', inCategory('Checkout', { previousCategory: 'Header' }))                // langsys-js-typescript ≥ 0.7.3
```
```svelte
{$t('Buy now', inCategory('Checkout', { previousCategory: 'Header' }))}    <!-- langsys-js-svelte ≥ 4.1.0 -->
<Translate category="Pricing" previousCategory="Home">…</Translate>
```
```php
$client->translate('Buy now', null, ['category' => 'Checkout', 'previous_category' => 'Header']); // langsys/langsys-php ≥ 2.1.0
```

`''` as the previous category means it had none. Blocks and phrases take the same option: in
Svelte, `<Translate>` and `<Phrase>` take a `previousCategory` prop, and `inCategory` is exported
from `langsys-js-svelte`. Each SDK's own skill has the rest of the forms.

- **Move every use of the text in that category in the same release.** One item stands for every
  call registering that text in that category, so the move retires it for all of them. A call
  left behind is still served, but drops out of the Translation Manager and its stats.
- **Until the catalog has the item under the new category, the old category's translation
  renders,** so the first deploy shows no source text.
- **The option acts once,** when the new code registers the item. It is never part of an id or a
  key. Delete it **once the new category's translation is in the catalog**, not before: it also
  drives the fallback above, so removing it early renders source text in the meantime. After
  that there is no deadline.
- **Old app versions keep working.** A release still registering the old category is served it.
  After 90 days the retired item leaves the catalog, until an old release registers it again.
  That restores it with its translations, at no charge. That release shows source text for the
  item only until its registration lands and the catalog is fetched again.
- **Moving back is a move too.** Name the category the content is in now. A plain revert does
  not bring the old item back. It registers new content.

### When the SDK cannot say it

`langsys-js-react` 0.6.x and `langsys-js-vue` 0.2.x run on core 0.6, and `langsys-php-laravel`
1.0.0 runs on `langsys-php` 1.3.x, so none of them has the option. Neither does
`langsys-js-svelte` before 4.1.0, or a move ahead of any code change. Use the API instead:
`POST /api/translatable-items/recategorize`, or the MCP tool *move translatable items into another category*. It takes the target `category`
plus either item ids (`translatable_item_ids`) or, for standalone phrases only,
`{project_id, phrases: [{phrase, category}]}`. **Name content blocks by item id.** It answers
`409` while any of the items is being machine translated, so try again when that finishes.

**Deploy the code that uses the new category first, then move.** Moving first leaves the live
code registering a retired item until the deploy lands.

**The endpoint is not a full substitute for the option.** Without the option, any write-enabled
run of the new code registers the new-category items as new content, and that includes your own
local run with a write key. Whatever it registers has been machine translated and charged by the
time you move. The move then lands on that item and brings the old translations over, keeping a
person's translation already there. So move **as soon as the new code runs anywhere
write-enabled**, or run it read-only until you have moved.

### Checking that a move worked

Look at the new entry in `GET /translations/data`: it should have its own row with
`memory_translated: false`. Identical text appearing in the new category proves nothing on its
own, because translation memory can fill it in without any move.

## Migrating from namespaced keys

Do **not** map i18next namespaces 1:1 to categories — that recreates the duplication Langsys exists to remove. Collapse to feature-level categories and let identical phrases share entries. See [migrate/_method.md](./pinned/migrate/_method.md) phase 3.
