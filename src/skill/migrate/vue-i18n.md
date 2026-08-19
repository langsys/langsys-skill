# Migrating from vue-i18n

Read [_method.md](./_method.md) first, and [integrate/vue.md](../integrate/vue.md) for the Vue-specific reactivity rules.

## Detect

```bash
grep -E '"(vue-i18n|@intlify/[a-z-]+)"' package.json
find . -name "*.json" -path "*locale*" -not -path "./node_modules/*"
grep -rl "<i18n" --include="*.vue" src/     # SFC-local message blocks
```

## Syntax mapping

| vue-i18n | Langsys |
|---|---|
| `const { t } = useI18n()` | `const t = useT()` |
| `$t('home.welcome')` in template | `t('Welcome back', 'Home')` |
| `t('greeting', { name })` | `t('Hello, {name}!', 'Greetings', { name })` |
| `{name}` named | `{name}` (unchanged) |
| `{0}` positional | **must become named** — `{name}` |
| `@:common.appName` linked messages | inline the text, or pass a `{param}` |
| `$tc('item', count)` | `t('{count, plural, one {# item} other {# items}}', 'Cart', { count })` |
| `locale.value = 'es'` | `setLocale('es-ES')` from `useLocaleStore()` |
| `createI18n({ … })` | `LangsysApp.init({ … })` |
| `<i18n>` SFC blocks | delete — messages move to call sites |

## The two Vue-specific traps

### 1. `useT()` returns a ref

```ts
const { t } = useI18n();   // vue-i18n: a plain function
const t = useT();          // Langsys: a ShallowRef
```

```vue
<template>{{ t('Save', 'UI') }}</template>   <!-- auto-unwrapped -->
```
```ts
const label = computed(() => t.value('Save', 'UI'));   // .value in script
```

This is the most common post-migration error: code moved verbatim from a vue-i18n `setup()` block calls `t(...)` in script and throws.

### 2. Positional placeholders have no equivalent

```json
{ "greeting": "Hello {0}, you have {1} messages" }
```

```ts
t('Hello {name}, you have {count} messages', 'Greetings', { name, count })
```

Positional arguments must be **named**. Translators need the name to know what the value is — `{0}` tells them nothing, and word order changes between languages.

## Pluralization

vue-i18n uses pipe-separated variants; Langsys uses ICU.

```json
{ "car": "no cars | one car | {count} cars" }
```

```ts
t('{count, plural, =0 {no cars} one {one car} other {# cars}}', 'Vehicles', { count })
```

vue-i18n's pipe form is **position-based** and cannot express Russian's four or Arabic's six categories correctly. ICU can, per locale, without enumerating them in source. This is usually an upgrade, not just a port.

## SFC `<i18n>` blocks

```vue
<i18n>
{ "en": { "title": "Product details" } }
</i18n>
```

Component-local messages have no Langsys equivalent — and do not need one. Take the base-locale value, inline it at the call site, delete the block:

```vue
<h1>{{ t('Product details', 'Product') }}</h1>
```

Non-base-locale values in these blocks are **existing translations** — they cannot be imported via the SDK (see [_method.md](./_method.md)). Note them for the Translation Manager before deleting.

## Linked messages

```json
{ "appName": "Acme", "welcome": "Welcome to @:appName" }
```

No equivalent. Either inline:

```ts
t('Welcome to Acme', 'Home')
```

or parameterize, which is better if the brand appears in many phrases and must not be translated:

```ts
t('Welcome to {app}', 'Home', { app: 'Acme' })
```

For brand names inside markup, `<DontTranslate>` is the cleaner tool.

## Init

```ts
// Before
const i18n = createI18n({
    legacy: false, locale: 'en', fallbackLocale: 'en', messages,
});
app.use(i18n);

// After — no messages; the catalog is remote
LangsysApp.init({
    projectid: import.meta.env.VITE_LANGSYS_PROJECT_ID,
    key: import.meta.env.VITE_LANGSYS_API_KEY,
    UserLocaleStore: store,
    baseLocale: 'en-US',   // was fallbackLocale
});
```

Locale in Pinia already? Use `refToLocaleSource(localeRef)` rather than creating a second source of truth.

## Traps specific to this migration

**Legacy mode (`legacy: true`)** exposes `this.$t` in Options API components. Those need converting to Composition API, or accessing the imported `t` signal directly — a bigger change than the string mapping. Scope it before starting.

**`v-t` directive** has no equivalent; convert to an interpolation.

**Number/date formatters** (`$n`, `$d`, with `numberFormats` / `datetimeFormats` config) are not part of Langsys. Either keep `Intl.NumberFormat` / `Intl.DateTimeFormat` directly, or pass values through `params` — Langsys formats `number` and `Date` values per the active locale automatically.

## Verify

Beyond [verify.md](../verify.md):

- [ ] `t.value(...)` in script, `t(...)` in templates — check every migrated `setup()`
- [ ] No positional `{0}` placeholders left
- [ ] Pipe-form plurals converted to ICU
- [ ] `<i18n>` SFC blocks removed; their non-base translations noted
- [ ] Linked messages (`@:`) resolved
- [ ] `vue-i18n` removed from `package.json`
- [ ] Quarantine report reviewed and cleared
