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

## 6. Keep `<Translate>` children static — it is invariant 0 on the block path

This is the same defect as "never build a phrase string", wearing different clothes, and it is
the one most likely to be dismissed as a style note.

**A content block's `custom_id` is a hash of its rendered token text**, and an interpolated value
is *inside* that text. So `<Translate>` wrapping an interpolation mints **a new content block per
distinct value** — permanent, shared catalog growth keyed on user data. Measured on Svelte 5
against the published SDK:

```
<Translate>Hello {name} world, you have {n} items</Translate>

  name='Sarah',    n=3     -> ["Hello Sarah world, you have 3 items"]     id 25364a5d…
  name='Wolfgang', n=1000  -> ["Hello Wolfgang world, you have 1000 items"] id dc441178…
```

Two entries. A thousand users, a thousand entries. Exactly the pollution invariant 0 exists to
prevent — the SDK cannot detect it, and the base language looks perfect throughout.

**And a second failure that has nothing to do with how many users you have.** Whitespace-only text
nodes are dropped, so a run made of interpolations plus spaces produces **no tokens at all** when
those values render empty:

```
<Translate>{a} {b}</Translate>

  a='AA', b='BB'  -> tokens ["AA BB"]   id a32abe23…
  a='',   b=''    -> tokens []          id f396abe8…    <- different block
```

The DOM holds one text node in both cases. The *token* arity changed from 1 to 0.

That fires whenever an interpolated value differs between the server render and the client
render — a store empty during SSR and populated after hydration, data fetched client-side,
anything time- or session-dependent. **The ids quietly never match, the block registers twice,
and nothing errors.**

**And it is not only interpolation.** `{#each}` and `{#if}` change the token array with no
interpolation present at all — `{#if show}yes{/if}` is a static string that appears or does not:

```
{#each items}   3 items -> [alpha,beta,gamma]   2 items -> [alpha,beta]      different id
{#if show}      true    -> [before,yes,after]   false   -> [before,after]    different id
```

A list whose length differs between server and client is not an edge case — it is pagination, a
filter, or a fetch that has not resolved yet.

**Translatable attributes fail the same way, and are the hardest to see.** An empty attribute value
is dropped from the token array, but the attribute itself stays in the DOM:

```
alt=""  ->  outerHTML shows alt=""   hasAttribute('alt') is true   token is GONE
```

Anyone inspecting the element sees `alt` present and concludes the block is intact, while two
tokens have silently left the array.

**The rule:** `<Translate>` is for **static prose** — marketing copy, CMS content, form labels.
Nothing whose token array depends on runtime data: no interpolation, no `{#each}`, no `{#if}`, no
`{#await}`, no interpolated values on translatable attributes. Interpolation belongs in
`t('Hello, {name}!', 'Cat', { name })`, where the placeholder stays literal in the key.

**`{#await}` is the worst case, and it is not a keying bug.** The server renders synchronously and
cannot await, so it emits the **pending branch every time** — even for an already-resolved promise.
The client's first render is pending too. Tokenization happens once, at mount, so:

- the **loading placeholder** is what gets registered; the real content never reaches the catalog
- **every `{#await}` sharing a pending string collapses onto one content block**
- and on the single-token path the SDK writes `innerText`, which replaces the framework's block
  anchors — so the resolved content **never renders at all.** The block reads `loading` forever.

**Never put `{#await}`, or any async boundary, inside `<Translate>`.**

> **Do not verify this by counting text nodes.** Measured: an `{#if}` wrapping an *element*
> branch leaves the direct text-node count **unchanged at 2** while the token array goes from 3
> to 2 — the lost token was inside the element the branch removed. Node counts are the intuitive
> check and they are the one that lies. **Compare token arrays.**

`<Phrase>` is **immune to both**: it encodes to a phrase string with no token array and no
`custom_id`. That is not permission to interpolate into it — `%name%` still belongs in a
`params` object — but it does mean the catalog-fragmentation hazard above is specific to the
block path.

The secondary reason still holds: the DOM walker mutates rendered output in place, which fights
framework reconciliation.

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

**Canonicalizing is not resolving.** `canonicalizeLocale` fixes case and separators only:

```
canonicalizeLocale('en_us')  ->  'en-US'
canonicalizeLocale('zh-tw')  ->  'zh-TW'
canonicalizeLocale('es')     ->  'es'      <- NOT widened to your project's es-CR
```

A bare `es` is a perfectly valid BCP 47 tag that **422s** on a project whose Spanish target is `es-CR`. Only `detectPreferredLocale(header, supported)` performs the language→region resolution. Never hand-widen by string manipulation.

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

**Measured against `langsys-js-typescript@0.6.5`**, by executing it rather than reading it:

```
detectPreferredLocale('es',    ['es-CR','it-IT','fr-FR','en-US'])  ->  'es-CR'
detectPreferredLocale('fr-CA', ['es-CR','it-IT','fr-FR','en-US'])  ->  'fr-FR'
detectPreferredLocale('de',    ['es-CR','it-IT','fr-FR','en-US'])  ->  'de'     <- not yours
detectPreferredLocale('!!!',   ['es-CR','it-IT','fr-FR','en-US'])  ->  '!!!'    <- not a locale
detectPreferredLocale(null,    ['es-CR','it-IT','fr-FR','en-US'])  ->  'en-US'
```

Two things this shows that reading the signature does not:

- **The input is not validated.** Garbage comes straight back out as a "locale".
- **`false` is rare in practice.** A missing, null or empty header still produced a locale here, so code written to lean on `|| BASE` catching the undetectable case is mostly guarding a branch that does not fire — while the branch that *does* fire, an unsupported-but-truthy tag, sails through.

> **`supportedLocales` must be YOUR PROJECT's locales.** Building it from `LangsysApp.getLocalesFlat()` passes the ~573-entry **global CLDR** list, against which nearly any `Accept-Language` "matches" — so the helper returns something like `de-de` with full confidence and every catalog request 422s. This was a live defect in the Svelte SDK's own README.
>
> **Look in the console — the server's exact sentence is already there**, by default, no `debug` needed:
>
> ```
> [Langsys Warning] LangsysAppAPI failed to query
>   { message: 'The locale provided is not a base or target locale for this project',
>     http: { status: 422, data: '{"project_id":"…","locale":"de-de"}' } }
> ```
>
> There are `Langsys Error` lines too — `Logger.error()` is ungated for the same reason `warn()` is. How many of each you see depends on how many fetches the failing path makes, so do not go looking for a specific number.
>
> The labels are generic and name neither the offending locale nor your valid targets, so they are easy to scroll past in a noisy app — but they are not missing. **Search the console for `Langsys` before assuming there is no diagnostic.**


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
