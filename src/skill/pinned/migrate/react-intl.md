# Migrating from react-intl / FormatJS

> **Pinned guide.** The codemod route, for base SDK core **0.6.x** only. On core 0.7 the `langsys-typescript` skill's `legacyKeys` path replaces this.
> A project on another version reads that package's own README instead —
> [why](../README.md).

Read [_method.md](./_method.md) first.

## Detect

```bash
grep -E '"(react-intl|@formatjs/[a-z-]+)"' package.json
find . -name "*.json" -path "*lang*" -not -path "./node_modules/*"
```

## ICU messages become flat sentences

react-intl messages are ICU MessageFormat. Langsys makes the plural and gender forms itself, the base language's included, so a plural message becomes the flat sentence it describes, with the count as a placeholder. Never carry ICU across.

```ts
// react-intl
formatMessage({ id: 'cart.items' }, { count })
// with en.json: { "cart.items": "{count, plural, one {# item} other {# items}}" }

// Langsys — the flat sentence
t('{count} items', 'Cart', { count })
```

A `select` whose branches say different things in the source language (`{platform, select, ios {…} android {…}}`) becomes one phrase per branch, chosen in code, and so does an `=0` branch.

## Syntax mapping

| react-intl | Langsys |
|---|---|
| `const intl = useIntl()` | `const t = useT()` |
| `intl.formatMessage({ id: 'x' })` | `t('The source text', 'Category')` |
| `intl.formatMessage({ id: 'x' }, values)` | `t('Text with {v}', 'Category', values)` |
| `<FormattedMessage id="x" />` | `{t('The source text', 'Category')}` |
| `<FormattedMessage id="x" values={{ b: … }} />` with markup | **`<Phrase>`** |
| `defineMessages({ … })` | delete — phrases live at the call site |
| `<IntlProvider locale messages>` | `LangsysGate` calling `LangsysApp.init()` |
| `intl.locale` | `useCurrentLocale()` |
| `<FormattedNumber value={n} />` | keep `Intl.NumberFormat` directly; in a sentence, pass it as a param (`t('Total: {n}', 'Cat', { n })`), which formats it for the locale |
| `<FormattedDate value={d} />` | keep `Intl.DateTimeFormat` directly; in a sentence, pass it as a param (`t('Sent on {d}', 'Cat', { d })`) |

## `defineMessages` is your resolution table

Projects using `defineMessages` have the source text **next to the id**, which makes phase 2 nearly mechanical:

```ts
const messages = defineMessages({
    welcome: { id: 'home.welcome', defaultMessage: 'Welcome back' },
});
intl.formatMessage(messages.welcome)
```

→

```ts
t('Welcome back', 'Home')
```

`defaultMessage` **is** the phrase. Delete the `defineMessages` block afterwards — keeping it recreates the indirection Langsys removes.

Projects **without** `defaultMessage` (ids only, text in JSON) need the catalog lookup from phase 2.

## Rich text: `<FormattedMessage>` with tag values → `<Phrase>`

react-intl passes rich-text elements as values:

```tsx
// Before
<FormattedMessage
  id="reviews"
  defaultMessage="Based on <b>{count}</b> reviews"
  values={{ count, b: (chunks) => <strong>{chunks}</strong> }}
/>

// After
<Phrase category="ProductCard" params={{ count }}>
  Based on %count% <strong>reviews</strong>
</Phrase>
```

The tag-function pattern disappears entirely — `<Phrase>` captures the real elements from your markup and reconstitutes them around the translation.

**Never map these to `<Translate>`.** A rich-text `<FormattedMessage>` is by definition one sentence containing markup — exactly the `<Phrase>` case. `<Translate>` would split it.

## Init

```tsx
// Before
<IntlProvider locale={locale} messages={messages[locale]} defaultLocale="en">

// After
LangsysApp.init({
    projectid, key,
    UserLocaleStore: localeStore,
    baseLocale: 'en-US',   // was defaultLocale
});
```

## Traps specific to this migration

**`id` collisions across files.** react-intl ids are global; two files may share one. In Langsys the phrase text is the key, so identical text merges automatically — usually correct, but check that the two sites really do mean the same thing. If not, that is what categories are for.

**Extracted-message build steps.** `formatjs extract` / `babel-plugin-formatjs` and any `lang/*.json` generation should be removed in phase 5 — Langsys discovers phrases at runtime, so extraction is dead infrastructure.

**`intl.formatMessage` outside components.** Non-component call sites move to the imported `t` from `langsys-js-typescript`, or take `t` as an argument. Do not reach for a global.

## Verify

Beyond [verify.md](../core-0.6/verify.md):

- [ ] No `formatMessage` or `<FormattedMessage>` remaining
- [ ] `defineMessages` blocks deleted
- [ ] Rich-text messages became `<Phrase>`, none became `<Translate>`
- [ ] ICU plural and select messages rewritten as flat sentences; none carried across
- [ ] Extraction build step removed
- [ ] `react-intl` / `@formatjs/*` removed from `package.json`
- [ ] Quarantine report reviewed and cleared
