# Migrating from i18next / react-i18next

Read [_method.md](./_method.md) first — the six phases matter more than this syntax table.

## Detect

```bash
grep -E '"(i18next|react-i18next|i18next-http-backend|next-i18next)"' package.json
find . -path ./node_modules -prune -o -name "*.json" -path "*locale*" -print
```

Catalogs typically live in `public/locales/{lng}/{ns}.json` or `src/locales/`.

## Syntax mapping

| i18next | Langsys |
|---|---|
| `const { t } = useTranslation()` | `const t = useT()` |
| `useTranslation('checkout')` | `useT()` — namespace becomes the category argument |
| `t('home.welcome')` | `t('Welcome back', 'Home')` |
| `t('greeting', { name })` | `t('Hello, {name}!', 'Greetings', { name })` |
| `{{name}}` | `{name}` |
| `t('key', { defaultValue: 'Text' })` | `t('Text', 'Category')` — the default **is** the phrase |
| `t('item', { count })` + `_one`/`_other` keys | `t('{count, plural, one {# item} other {# items}}', 'Cart', { count })` |
| `<Trans i18nKey="x">…</Trans>` | **`<Phrase>`** — never `<Translate>` |
| `i18n.changeLanguage('es')` | `setLocale('es-ES')` from `useLocaleStore()` |
| `i18n.language` | `useCurrentLocale()` |
| `<I18nextProvider>` | `LangsysGate` calling `LangsysApp.init()` |
| `Suspense` fallback for loading | the init `ready` gate |

## Namespaces → categories

i18next namespaces are **file-scoping**; Langsys categories are **meaning-disambiguation**. They are not the same thing.

```
common.json → "save": "Save"      ┐
forms.json  → "save": "Save"      ├─→  ONE entry: t('Save', 'UI')
billing.json→ "save": "Save"      ┘
```

Mapping namespaces 1:1 gives three catalog entries needing three separate translations. Collapse them. Split only where the same words genuinely mean different things.

## Plurals

i18next uses key suffixes; Langsys uses ICU inside one phrase.

```json
{ "item_one": "{{count}} item", "item_other": "{{count}} items" }
```

```ts
t('{count, plural, one {# item} other {# items}}', 'Cart', { count })
```

Languages with more categories (Russian 4, Arabic 6) are handled by the ICU renderer per locale — you do not enumerate them in source. If the old catalog had `_few` / `_many` variants for a target language, that information lives in the **translation**, not the source phrase.

## `<Trans>` → `<Phrase>`

```tsx
// Before
<Trans i18nKey="reviews" count={n}>
  Based on <strong>{{count}}</strong> reviews
</Trans>

// After
<Phrase category="ProductCard" params={{ count: n }}>
  Based on %count% <strong>reviews</strong>
</Phrase>
```

Three changes at once: component, `{{count}}` → `%count%` (markup, so percent form), and `i18nKey` disappears because the content is the key.

**Never map `<Trans>` to `<Translate>`.** Both libraries have this component for the same reason — a sentence with inline markup must stay one unit. `<Translate>` splits at tag boundaries, which is the opposite.

## Init

```tsx
// Before
i18n.use(initReactI18next).init({
    resources, lng: 'en', fallbackLng: 'en', interpolation: { escapeValue: false },
});

// After — no resources; the catalog is remote
LangsysApp.init({
    projectid: import.meta.env.VITE_LANGSYS_PROJECT_ID,
    key: import.meta.env.VITE_LANGSYS_API_KEY,
    UserLocaleStore: localeStore,
    baseLocale: 'en-US',
});
```

`fallbackLng` → `baseLocale`. Note the BCP 47 form: `'en'` becomes `'en-US'` (or `'en-GB'` — ask, do not assume).

## Traps specific to this migration

**`defaultValue` is already your phrase.** Projects using `t('key', { defaultValue: 'Welcome' })` migrate almost trivially — the default is the source text.

**Keys used as visible fallbacks.** If a key is missing from the catalog, i18next renders the key itself. Users may have been seeing `home.welcome` on screen. Those are quarantine cases, not resolvable keys.

**`returnObjects: true`.** Arrays/objects returned from the catalog have no Langsys equivalent — each item becomes its own phrase, or the structure moves into code. Quarantine.

**Context suffixes** (`friend_male`, `friend_female`) map to ICU `select`:

```ts
t('{gender, select, male {His friend} female {Her friend} other {Their friend}}', 'Social', { gender })
```

**Nesting** (`$t(common:appName)` inside another string) has no equivalent — inline the value, or use a `{param}`.

## Verify

Beyond [verify.md](../verify.md):

- [ ] No `t('dot.key')` survivors — `langsys-no-dot-key-phrase` catches these
- [ ] Every `<Trans>` became `<Phrase>`, none became `<Translate>`
- [ ] No `{{name}}` left in any phrase
- [ ] Plural keys collapsed into ICU phrases; `_one`/`_other` keys gone
- [ ] `i18next` and `react-i18next` removed from `package.json`
- [ ] Quarantine report reviewed and cleared
