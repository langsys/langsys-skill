# Troubleshooting

Symptom → cause → fix. Most Langsys problems look identical in the base language, so start by **switching locale** — that is what exposes them.

---

## An element inside `<Translate>` disappeared — image, input, or button gone

The markup had an `<img>`, an `<input>` or a `<button>` in it. After translation the element is
gone and there is bare text in its place.

**Cause:** the `<Translate>` subtree yielded exactly **one** token, so the SDK took a fast path that
assigns `element.innerText` — replacing every child of the host. The premise is that one token
means one text node, and a translatable **attribute** breaks it: `<img alt="Logo">` produces the
token `["Logo"]` with no text node anywhere, and the write then destroys the element that carried
it.

```jsx
<Translate><img alt="Company logo" /></Translate>   // the <img> is replaced by text
```

Verified against `langsys-js-typescript@0.6.5` (`dist/index.mjs:1408`, `:1427`). It reproduces in
plain DOM — no framework, no SSR — and the write **re-runs on every locale change**, because the
locale guard is only updated on the multi-token path.

**Fix:** do not wrap a single element in `<Translate>`. Translate the attribute where it lives.
`<Translate>` is for a block of markup with several pieces of content in it.

## A `<Translate>` block is stuck on its loading text

The content resolved, the network tab shows the data, and the block still reads `Loading…`.

**Cause:** `<Translate>` wrapping an async boundary — `{#await}` or equivalent. The block is
tokenized **once, at mount**, when the pending branch is what is rendered. On the single-token
path the SDK then assigns `element.innerText`, which replaces every child of the host **including
the anchor nodes the framework uses to find that block**. The framework's later update targets
nodes that are no longer in the document, so the resolved content never appears.

It is not a translation failure and no amount of catalog work fixes it. Two further consequences
worth checking while you are here:

- the **placeholder** is what got registered — look for `Loading…` in your Translation Manager
- **every** such block collapses onto **one** content block, since they all tokenize to the same
  single token

**Fix:** move the async boundary outside the `<Translate>`. Wrap the resolved content, not the
awaiting wrapper:

```svelte
<!-- wrong — the block is tokenized while pending, and frozen by the write -->
<Translate category="Docs">
  {#await load()}Loading…{:then page}{page.body}{/await}
</Translate>

<!-- right — nothing is tokenized until there is real content -->
{#await load()}
  Loading…
{:then page}
  <Translate category="Docs">{page.body}</Translate>
{/await}
```

The second form still needs the content itself to be static prose — see
[invariants.md §6](./core/invariants.md).

## Nothing translates at all

**Check init actually succeeded.** The most common cause, and it is silent unless you look:

```ts
const res = await LangsysApp.init({ /* … */ });
if (!res.status) console.error(res.errors);
```

Then, in order:

| Cause | Check |
|---|---|
| Wrong project ID or key | `res.errors` names it |
| Env var undefined at runtime | Wrong bundler prefix — `console.log` the value; see [core/secrets.md](./core/secrets.md) |
| No translations exist yet | Expected on a new project. The base language **is** the fallback — translate something in the Translation Manager first |
| Component not subscribed | React: `useT()` in that component. Svelte: `$t`. Vue: `t()` in template |
| Init runs after render | Gate rendering on `ready` |

## Base language is fine, other locales are garbled or partly English

Almost always **`{name}` written in markup** instead of `%name%`.

The compiler substituted the value before Langsys captured the text, so the registered phrase contains one specific user's data and never matches a translation.

```jsx
<Translate params={{ name }}>Hello, {name}</Translate>   {/* ❌ */}
<Translate params={{ name }}>Hello, %name%</Translate>   {/* ✅ */}
```

**Confirm it:** run with `debug: true` (base SDK ≥ 0.4.3) and look for the unmatched-params warning. Then check the Translation Manager — if you see `Hello, Sarah` as a phrase, this is it.

Fix the markup, then **delete the polluted phrases** from the Translation Manager.

## A sentence is translated in pieces, word order is wrong

The sentence went through `<Translate>` when it needed `<Phrase>`.

`<Translate>` tokenizes **per text node**, so `<p>Based on <strong>5</strong> reviews</p>` registers three phrases: "Based on", "5", "reviews". No translator can produce correct word order from fragments, and no plural rule can inflect across them.

```jsx
<Phrase category="ProductCard" params={{ n }}>
  Based on %n% <strong>reviews</strong>
</Phrase>
```

See [core/choosing-primitives.md](./core/choosing-primitives.md).

## Plurals are wrong in Russian / Arabic / Polish (fine in English)

Two possible causes:

1. **The count and the noun are in different phrases** — same fix as above, use `<Phrase>`.
2. **PHP only:** `ext-intl` is missing, so plural rules stop applying per language. Check `php -m | grep intl`.

   `ext-intl` is a hard Composer requirement, so this only happens on a manual install or under `--ignore-platform-req`. On **v1.1.0+** the page still reads sensibly — an ICU phrase degrades to the exact `=N` branch, then `one` for a value of 1, then `other`, with `#` substituted. It is not CLDR-correct, which is why the extension is required, but you get prose rather than raw MessageFormat source on the page. On **v1.0.x** the raw `{n, plural, one {# товар} …}` source leaks into the output — if you are seeing that, upgrade.

This is the failure nobody notices until a native speaker complains, because English has only two plural forms and looks fine either way.

## The catalog is full of near-duplicate phrases

"Hello, Sarah!", "Hello, Ahmed!", "Hello, Priya!" …

A **pre-formatted phrase**:

```ts
t(`Hello, ${name}!`)                    // ❌ one entry per user
t('Hello, {name}!', 'UI', { name })     // ✅ one entry
```

Fix the call site, then delete the junk entries. If this ran in production with a write key, expect a lot of them — and switch production to a read-only key.

`langsys-no-template-literal-phrase` and `langsys-no-concatenated-phrase` catch this statically.

## Flash of untranslated content on load

SSR without seeding. Pass **both** `initialTranslations` and `initialTranslationsLocale` — either alone does nothing. See the [ssr/](./ssr/) tracks.

## Two catalog requests per page load

Same cause: the client refetches what the server already had. Seed it.

## Hydration mismatch

Server and client resolved **different locales**. Resolve once on the server and pass the value down — do not re-detect on the client.

Watch for `detectPreferredLocale` here: it returns the user's top preference when nothing matches your supported list, so server and client can disagree if only one of them passes `supported`.

## A phrase registered under the wrong name

Reversed arguments:

```ts
t('UI', 'Home')    // ❌ registers "UI" as the phrase
t('Home', 'UI')    // ✅
```

Both typecheck when the phrase has no placeholders. Delete the wrong entry after fixing.

## `t is not a function` (Vue)

`useT()` returns a `ShallowRef`:

```ts
t.value('Save', 'UI')   // in script
```
```vue
{{ t('Save', 'UI') }}   <!-- in template, auto-unwrapped -->
```

## `document is not defined` during SSR

The SDK touched the DOM on the server. Move `init` into `onMount` / `useEffect` / `onMounted`.

## Works in development, not in production

Development uses a **write key**, so any phrase you hit gets registered on the fly. Production uses a **read-only key** and can only fetch what already exists.

Exercise the flow in development first so the phrases register, then deploy.

## `composer require langsys/langsys-php` fails

It is published (`v1.0.0`–`v1.3.0`). Check in order:

1. **Package name** — it was renamed from `langsys/php-sdk`, which is not registered and never will be.
2. **`ext-intl`** — a hard requirement, so Composer refuses to install without it. That is deliberate; do not reach for `--ignore-platform-req` without reading [integrate/php.md](./integrate/php.md) §0.
3. **PHP ≥ 7.4.**

## Translations stale after updating them in the Translation Manager

```ts
await LangsysApp.refresh();
```

PHP: lower `LANGSYS_CACHE_TTL`, or clear the cache. Check you are not serving a cached page — page caches must be keyed by locale.

## Some strings on a PHP page never translate

- Rendered outside the output buffer (`ob_start()` … `ob_get_clean()`)
- Inside `<script>` or `<style>` — never processed
- Inside an element marked `translate="no"` / `data-notrans`

> **`data-notrans` was inverted below `langsys/langsys-php` v1.2.0** — a bare `data-notrans` caused content to be EXTRACTED into the shared catalog, and `="false"` excluded rather than included. If you used it on ≤1.1.0, audit for catalog entries from regions you meant to protect. `translate="no"` was unaffected.

## Raw ICU markup is showing on the page

Users see something like:

```
{name_gender, select, male {Bienvenido} female {Bienvenida} other {Bienvenide}} Sarah
```

**An ICU argument is missing, and you almost certainly did nothing wrong.** The translation pipeline can *introduce* a `select` argument the source phrase never had: a plain `{name}` becomes `{name_gender, select, …}` in gendered target locales. Your app cannot supply `name_gender` — it does not exist in the phrase you wrote, and nothing announced that the target grew one.

**Every app translating into a gendered locale hits this on affected versions.**

| SDK | Behaviour on a missing argument |
|---|---|
| PHP ≤ 1.3.0 | Sentence destroyed, bare `{name_gender}` shipped |
| **PHP ≥ 1.3.1** | Falls back to the `other` branch → `Bienvenide Sarah` ✅ |
| JS ≤ 0.6.3 | **Entire raw ICU pattern emitted** — verified against published `0.6.3` |
| **JS ≥ 0.6.4** | Matches PHP exactly — independently verified 6/6 against the published tarball ✅ |

### ⚠️ The mixed-version window

**PHP ≥ 1.3.1 with JS ≤ 0.6.3 renders the sentence correctly server-side and dumps raw ICU markup client-side — on the same page.** This is created by the PHP fix landing first, not by either defect alone, and it is routine in any app doing PHP SSR plus JS hydration (the Laravel wrapper's `InertiaSsrProps` makes it the default).

**Upgrade both, or neither.** Upgrading only PHP makes the symptom *more* confusing, because the server output looks right.

### The dangerous one: a `null` count renders as a real zero

The two cases above are *visible* — they produce broken-looking output that generates a support ticket. This third one does not, and it is the reason to upgrade even if you have never seen raw ICU on a page.

Verified against published JS `0.6.3`:

| Input | Output |
|---|---|
| `{ count: 0 }` — a genuinely empty cart | `0 items` |
| `{ count: null }` — **we failed to pass the count** | `0 items` |
| `{}` — argument missing entirely | raw ICU pattern |

**A `null` argument does not throw — it silently coerces to `0`.** So a data-fetch failure, an unset field, or a typo'd property name renders as a confident, plausible, wrong number. Nobody can distinguish "empty" from "broken": not on the page, not in a screenshot, not in a support ticket.

PHP ≥1.3.1 treats `null` as missing (`array_key_exists() || === null`), so it renders `{count} items` — the gap stays visible — while a real `0` still renders `0 items` correctly.

**This is a different code path from the other two.** A missing argument makes `intl-messageformat` throw, which is what the JS recovery catches; `null` never throws, so a fix for the missing-argument case does not automatically cover it. Confirm this case specifically against whatever version you upgrade to rather than assuming it came along.

### `{count}` in output is not always a bug

The two ICU forms recover differently, deliberately:

- **`select`** is genuinely recoverable — `other` is exactly what an unknown gender should render.
- **`plural`** is only made *less bad*. No count can be invented, so the sentence survives with the gap visible: `{count} items`.

Seeing a bare `{count}` means an argument was never supplied. Worth fixing at the call site, but it is the fallback working, not a rendering failure.

## `%PATH%` or `50%` got mangled

Only identifier-shaped `%word%` is treated as a placeholder, so `50% off` is safe. For a literal `%WORD%` — a Windows env var in documentation — wrap it in `<DontTranslate>`.

## `data-ls-phrase` in my HTML does nothing

It depends which SDK you are in — there are **three** answers, and carrying an assumption between them lands wrong:

| Context | `data-ls-phrase` | `data-langsys-phrase` |
|---|---|---|
| React / Vue / Svelte bindings | **Internal.** The component sets it; never write it | honored by the tokenizer (base ≥ 0.6.0) |
| **Vanilla JS/TS** | **Author-facing** — write it when nesting a `Phrase` inside a `Translate` ([integrate/vanilla-ts.md](./integrate/vanilla-ts.md)) | equivalent as of base 0.6.0 |
| PHP | **Not recognised.** Silently ignored — no error, no effect | **the author-facing marker** ([integrate/php.md](./integrate/php.md)) |

**As of base SDK 0.6.0 the JS tokenizer honors both spellings; 0.6.1 fixed how it reads the value.** `PHRASE_MARKER_ATTRS` and `isPhraseMarked()` are exported for wrappers that tokenize through their own templating.

### The marker is not a boolean-presence attribute

Both SDKs agree exactly as of base **0.6.1** — verified across every value case:

| Value | Result |
|---|---|
| bare `data-langsys-phrase` | **enabled** |
| `="true"`, `="1"`, `="yes"`, anything else | **enabled** |
| `="false"`, `="FALSE"`, `="0"` | **disabled** (case-insensitive) |

Presence signals intent; an explicit off value opts out. **Base 0.6.0 matched presence alone**, so a subtree the author had deliberately un-marked with `="false"` was skipped by JS and handled by neither SDK. Require **≥ 0.6.1** if you use the off value.

### Why both spellings matter: the SSR handoff

PHP's `data-langsys-phrase` **survives into `translatePage()` output**. On a server-rendered page picked up by a JS binding, one DOM is walked by both SDKs — and before 0.6.0 the JS tokenizer recursed into subtrees PHP had deliberately kept whole.

The result was not a harmlessly re-registered phrase: it registered **fragments split at tag boundaries** — exactly the failure `<Phrase>` exists to prevent, reintroduced by the handoff itself.

**If you server-render with PHP and hydrate with a JS binding, require base SDK ≥ 0.6.0.** Below that, the marker is invisible to JS and your kept-whole runs are shredded on the client.

---

## Diagnostic order

1. `doctor` — environment, key type, versions, runtime floors
2. `res.status` from `init()`
3. Console with `debug: true`
4. **Switch locale** — most bugs are invisible until you do
5. Inspect the **registered phrase set** in the Translation Manager — this is what catches primitive-selection and pollution errors
6. `ast-grep scan` + `markup-check` for static issues
