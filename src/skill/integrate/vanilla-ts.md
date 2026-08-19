# Vanilla TypeScript / JavaScript

`langsys-js-typescript@0.4.3` · zero runtime dependencies beyond `intl-messageformat`. Browsers, Node, any bundler.

Use this when there is no framework, or when you need Langsys outside a framework binding (a Node script, a build step, a web component).

## 1. Install

```bash
npm install langsys-js-typescript
```

## 2. Initialize

You supply the locale store. `createSignal` is provided if you have nothing of your own.

```ts
import { LangsysApp, createSignal, t } from 'langsys-js-typescript';

const userLocale = createSignal('en-US');

const res = await LangsysApp.init({
    projectid: process.env.LANGSYS_PROJECT_ID!,
    key: process.env.LANGSYS_API_KEY!,
    UserLocaleStore: userLocale,
    baseLocale: 'en-US',
    debug: process.env.NODE_ENV !== 'production',
});

if (!res.status) console.error('Langsys init failed', res.errors);
```

Any object satisfying `subscribe(run): Unsubscriber; set(v); update(fn); get(): T` works as the store.

## 3. Translate strings

```ts
document.querySelector('h1')!.textContent = t('Welcome to my app', 'Home');
document.querySelector('#greeting')!.textContent =
    t('Hello, {name}!', 'Greetings', { name: 'Sarah' });
```

`t()` is a plain function — no reactivity attached. For a value that must update on locale change, subscribe:

```ts
import { tSignal } from 'langsys-js-typescript';

const unsub = tSignal.subscribe((t) => {
    document.querySelector('h1')!.textContent = t('Welcome', 'Home');
});
```

`tSignal` re-emits a fresh `TFunction` on every translation/locale change. This is the primitive every framework binding is built on — if you are writing your own binding, this is the whole integration.

## 4. Markup

Full decision procedure: [core/choosing-primitives.md](../core/choosing-primitives.md). Here the components are classes you attach to existing DOM elements.

### `Phrase` — one sentence containing inline markup

```ts
import { Phrase } from 'langsys-js-typescript';

const el = document.querySelector<HTMLElement>('#review-count')!;
const handle = new Phrase(el, {
    category: 'ProductCard',
    params: { n: reviewCount },
});

handle.setParams({ n: 6 });   // re-renders
handle.destroy();              // stop listening
```

```html
<span id="review-count">Based on {n} <strong>reviews</strong></span>
```

**In hand-authored HTML, `{n}` is correct** — there is no template compiler to eat it. `%n%` also works and normalizes to the same thing. The `%name%` rule exists for compiled frameworks; here either spelling is fine, and `{name}` is canonical.

#### ⚠️ Nesting a `Phrase` inside a `Translate` — vanilla only

In the framework bindings, `<Phrase>` marks its own host element and a wrapping `<Translate>` skips it automatically. **The vanilla `Phrase` class does not do this** — it exports the marker constant but never sets the attribute.

So if a `Phrase` lives inside an element you also wrap with `Translate`, put the marker in your HTML **yourself**:

```html
<div id="article">
  <p>Some prose the block should tokenize normally.</p>
  <p data-ls-phrase>Based on {n} <strong>reviews</strong></p>
</div>
```

```ts
new Phrase(document.querySelector('#article p[data-ls-phrase]')!, {
    category: 'ProductCard', params: { n: reviewCount },
});
new Translate(document.querySelector('#article')!, { category: 'Blog' });
```

**The requirement is about ordering, not the attribute.** The marker must be present in the DOM *before* the wrapping `Translate` tokenizes. If it isn't, the block walker tokenizes straight through the run and both handlers end up fighting over the same nodes.

Writing it in your HTML guarantees it exists at first render. Do **not** rely on constructing the `Phrase` first — that only works when construction happens to win the race, and it gives false confidence about an ordering you don't actually control.

A **standalone** `Phrase` — one with no `Translate` above it — needs none of this.

This is the one place `data-ls-phrase` is author-facing. In the React/Vue/Svelte bindings it is internal and you never write it; in the PHP SDK the author-facing attributes are the separate `data-langsys-*` family. Three different answers — do not carry an assumption between them.

### `Translate` — a block of markup

```ts
import { Translate } from 'langsys-js-typescript';

const article = document.querySelector<HTMLElement>('#article')!;
const handle = new Translate(article, { category: 'Blog', label: 'Welcome post' });

handle.setParams({ name: 'Sarah', count: 6 });
handle.destroy();
```

Attributes tokenized on contained elements — the exact list, from `TRANSLATABLE_ATTRIBUTES` in base SDK 0.6.5:

`placeholder` · `alt` · `title` · `label` · `aria-label` · `aria-placeholder` · `aria-description` · `aria-valuetext` · `aria-roledescription` · `data-error` · `data-error-message` · `data-validation-message` · `data-invalid-message` · `data-required-message` · `data-pattern-message`

**`value` is not in that list.** It is harvested by a separate rule, on `<button>` and on `<input type="submit">` / `<input type="button">` **only** — because `value` is a label on those and data everywhere else. Reading the constant alone concludes `value` is never translated, and drops every submit button in the app; keying on the attribute name alone sends you to translate an email address.

An attribute can never carry markup, so every one of these is a `t()` call — never `<Phrase>`.

### Never translated

Mark elements with `translate="no"` — the tokenizer and renderer both skip them and their children. This is what `<DontTranslate>` renders in the framework bindings.

## 5. Locale switching

```ts
userLocale.set('es-ES');                        // all subscribers re-translate
await LangsysApp.translationsLoadingPromise;    // wait for the new catalog
```

## The `Signal<T>` primitive

```ts
import { createSignal, getValue, persist } from 'langsys-js-typescript';

const count = createSignal(0);
const unsub = count.subscribe((v) => console.log(v));   // fires immediately
count.set(1);
count.update((n) => n + 1);
getValue(count);   // 2
unsub();

const saved = persist('my-key', 'default');   // localStorage-backed, SSR-safe
```

Contract: `subscribe(run): Unsubscriber; set(v); update(fn); get(): T`, subscribe-fires-immediately. That is Svelte's store contract plus `.get()`, which is why the Svelte binding is nearly trivial.

## Writing your own framework binding

Roughly ten lines:

1. Subscribe to `tSignal` for invalidation
2. Call the current `TFunction` for values
3. Unsubscribe on teardown

```ts
// React, without the dedicated package
import { useSyncExternalStore } from 'react';
import { tSignal, type TFunction } from 'langsys-js-typescript';

export function useT(): TFunction {
    return useSyncExternalStore(
        (notify) => tSignal.subscribe(notify),
        () => tSignal.get(),
        () => tSignal.get(),
    );
}
```

## Exports

`LangsysApp` · `LangsysAppAPI` · `Translate` · `Phrase` · `t` · `tSignal` · `currentlyLoadedLocale` · `sTranslations` · `contentBlocks` · `createSignal` · `getValue` · `persist` · `interpolate` · `canonicalizeLocale` · `Logger` · `logger` · `md5` · `isEmpty`

## Checklist

- [ ] Locale store satisfies the `Signal` contract
- [ ] `res.status` checked
- [ ] `tSignal` subscription for anything that must update on locale change
- [ ] `.destroy()` on `Translate` / `Phrase` handles when elements are removed
- [ ] No template literals in phrase arguments
- [ ] Read-only key + `debug: false` in production

Then [verify.md](../verify.md).
