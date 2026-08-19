# Langsys invariants

Rules that hold across every SDK. Most exist because an i18next/react-intl habit produces broken Langsys code that **looks correct in the base language**.

---

## 0. Never pre-format a phrase

**The only failure here that corrupts shared state.** Every other rule breaks one app; this one writes garbage into the Translation Manager that every SDK and every teammate reads, and it cannot be undone by editing code.

```php
$client->translate(sprintf('Hello, %s!', $name));    // ❌ PHP
```
```ts
t(`Hello, ${name}!`);                                 // ❌ JS
t('Hello, ' + name + '!');                            // ❌ JS
```

Each distinct value registers a **new catalog phrase** — "Hello, Sarah!", "Hello, Ahmed!", one per user — each queued to the API and billed as translatable words.

```php
$client->translate('Hello, {name}!', null, null, null, ['name' => $name]);   // ✅
```
```ts
t('Hello, {name}!', 'Greetings', { name });                                   // ✅
```

**Why it persists:** the SDK cannot detect it. By the time the string arrives, an interpolated value is indistinguishable from an authored one. There is no warning. It is also the natural thing to write in PHP, where until recently there was no `params` argument at all.

**The phrase argument must always be a literal.** If you are building a string before passing it, stop.

---

## 1. The phrase is the key — there are no catalog files

Do not create `locales/en.json`. Do not create a `messages/` directory. Do not invent dot-keys.

```ts
t('Welcome to my app', 'Home');   // ✅ the English IS the key AND the default
t('home.welcome');                 // ❌ registers the literal string "home.welcome"
```

The first render of a phrase registers it (with a write key). Untranslated phrases fall back to the phrase itself, so your base language always renders correctly.

If a project you are migrating has catalog files, they are *inputs* to the migration, not something to recreate — see [migrate/_method.md](../migrate/_method.md).

---

## 2. Argument order: phrase first, category second

```ts
t('Home', 'Main Menu')    // ✅ t(phrase, category?, params?)
t('Main Menu', 'Home')    // ❌ reversed — registers "Main Menu" as the phrase
```

Both orders typecheck when the phrase has no placeholders, so the compiler will not save you. Verified signature (`langsys-js-typescript@0.4.3`):

```ts
interface TFunction {
    <P extends string>(phrase: P, ...args: TArgs<P>): string;
    <P extends string>(phrase: P, category: string, ...args: TArgs<P>): string;
}
```

All four call shapes are valid:

```ts
t('Save');
t('Save', 'UI');
t('Hello, {name}!', { name });
t('Hello, {name}!', 'Greetings', { name });
```

---

## 3. `%name%` in markup, `{name}` in `t()`

See [interpolation.md](./interpolation.md). Summary:

- Inside `<Translate>` / `<Phrase>` **markup** → `%name%`
- Inside a `t()` / `$t()` **string literal** → `{name}`

Writing `{name}` in markup fails silently — the compiler eats it before the SDK sees the text, and the base locale still renders correctly.

---

## 4. Write key in development, read-only key in production

- **Write key** — registers new phrases and content blocks as your app runs. Development only.
- **Read-only key** — fetches translations only.

The SDK detects which it has automatically. Never commit either. Match the env prefix to your bundler — see [secrets.md](./secrets.md).

---

## 5. Initialize once, high in the tree, and gate rendering

`LangsysApp.init()` is async and returns `{ status, errors }`. Call it once, above everything that translates, and do not render translatable content until it resolves.

Check `res.status` — a failed init that is not surfaced looks like "translations just don't work."

---

## 6. Keep `<Translate>` / `<Phrase>` children static

The DOM walker mutates rendered output in place, which conflicts with framework reconciliation. Static prose only; dynamic values go through `params`.

---

## 7. Seed translations during SSR

If the app server-renders, pre-fetch on the server and pass `initialTranslations` + `initialTranslationsLocale`. Without them you get a duplicate fetch on hydration and a flash of untranslated content. See the [ssr/](../ssr/) tracks.

---

## 8. Categorize when a phrase is genuinely ambiguous

```ts
t('Home', 'Main Menu')      // "Inicio"
t('Home', 'Home repairs')   // "Hogar"
```

Same phrase, different meanings, different translations. Category convention: the module or feature the phrase lives in (`Account`, `Errors`, `Checkout`, `UI`).

Langsys's philosophy is *translate once, use everywhere* — do not categorize reflexively, only when the same words legitimately mean different things.

---

## 9. Locale identifiers are canonicalized to BCP 47

`'en-us'` works as input, but `useCurrentLocale()` and `detectPreferredLocale()` always return `'en-US'`. Compare against the canonical form, or normalize with the exported `canonicalizeLocale()`.

---

## 10. `detectPreferredLocale` has two failure modes

```ts
// Nothing detectable at all      → false
// Detected but not in supported  → the user's top preference (NOT false)
```

So `detectPreferredLocale(header, supported) || 'en-US'` **only covers the first case**. An unsupported locale passes straight through. Use:

```ts
const detected = LangsysApp.detectPreferredLocale(header, supported);
const locale = detected && supported.includes(detected) ? detected : 'en-US';
```

This is why the bug survives testing — with no header the fallback works perfectly.

---

## Quick reference

| Do | Don't |
|---|---|
| `t('Hello, {name}!', 'UI', { name })` | `t(\`Hello, ${name}!\`)` |
| Literal phrase strings | `sprintf` / concatenation / template literals |
| `t(phrase, category)` | `t(category, phrase)` |
| `%name%` in markup | `{name}` in markup |
| Read-only key in production | Write key in production |
| Gate render on `init()` | Render before init resolves |
| `<Phrase>` for markup-bearing sentences | `<Translate>` for a single sentence |
