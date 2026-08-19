# Svelte integration

Verified against `langsys-js-svelte@3.6.3`.

> ## Check this first
>
> **This binding requires Svelte 5.** A project on Svelte 3 or 4 cannot use it, and no amount of installing will change that — the framework has to be upgraded first. `scan` reports this as a BLOCKER and `doctor` as an error, both from the declared range in `package.json`, so you do not need `node_modules` present to find out.

Covers Svelte and SvelteKit. Server-rendering? Also read [ssr/sveltekit.md](../ssr/sveltekit.md).

**This binding exports `<Phrase>` and `<DontTranslate>`** alongside `<Translate>` — full parity with React and Vue. The declaration header has listed all three since 3.5.0, with the rationale for `<Phrase>`; below that version the README barely mentioned them, which is why older guidance often omits them.

## 1. Install

```bash
npm install langsys-js-svelte
```

## 2. Environment

The prefix comes from the **bundler**, not from Svelte:

| Build tool | Prefix | Read with |
|---|---|---|
| SvelteKit | `PUBLIC_` | `$env/static/public` |
| SvelteKit | `VITE_` | `import.meta.env` — also valid, SvelteKit runs on Vite |
| Vite (plain Svelte) | `VITE_` | `import.meta.env` |
| **Rollup** | **none** | nothing is injected — see below |
| **webpack** | **none** | nothing is injected — see below |

```bash
# .env
PUBLIC_LANGSYS_PROJECT_ID=...
PUBLIC_LANGSYS_API_KEY=...      # write key in dev, read-only in prod
```

**Rollup and webpack have no convention.** `process.env` does not exist in a browser bundle, so an unprefixed variable is not "server-only" there — it is `undefined`, with no build error. Wire it up explicitly:

```js
// rollup.config.js
import replace from '@rollup/plugin-replace';
import 'dotenv/config';

plugins: [
    replace({
        preventAssignment: true,
        'process.env.LANGSYS_PROJECT_ID': JSON.stringify(process.env.LANGSYS_PROJECT_ID),
        'process.env.LANGSYS_API_KEY': JSON.stringify(process.env.LANGSYS_API_KEY),
    }),
    // …
]
```

webpack: `DefinePlugin` or `EnvironmentPlugin`, same idea.

## 3. Initialize

Two shapes, depending on whether you have SvelteKit. **§3a is SvelteKit; §3b is plain Svelte** (Vite or Rollup) — the difference is where init lives and how the env is read, not what init does.

### 3a. SvelteKit

`UserLocaleStore` here is a **standard Svelte `Writable<string>`** — not a `Signal`. This differs from React and Vue.

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
    import { writable } from 'svelte/store';
    import { onMount } from 'svelte';
    import { LangsysApp, type iLangsysInitConfig } from 'langsys-js-svelte';
    import { PUBLIC_LANGSYS_PROJECT_ID, PUBLIC_LANGSYS_API_KEY } from '$env/static/public';

    let { children } = $props();

    const userLocale = writable('en-US');
    let appReady = $state(false);
    let appInitError = $state<string | null>(null);

    onMount(async () => {
        const config: iLangsysInitConfig = {
            projectid: PUBLIC_LANGSYS_PROJECT_ID,
            key: PUBLIC_LANGSYS_API_KEY,
            UserLocaleStore: userLocale,
            baseLocale: 'en-US',
            debug: import.meta.env.DEV,
            ssrTokenStrategy: 'client',
        };
        const res = await LangsysApp.init(config);
        if (res.status) appReady = true;
        else appInitError = res.errors?.join(', ') ?? 'Init failed';
    });
</script>

{#if appInitError}
    <p>Langsys init failed: {appInitError}</p>
{:else if !appReady}
    <p>Loading…</p>
{:else}
    {@render children()}
{/if}
```

### 3b. Plain Svelte (Vite or Rollup)

No `$env/static/public` and no `+layout.svelte` — init goes in your root component, and the env comes from whatever the bundler injected (§2).

```svelte
<!-- src/App.svelte -->
<script lang="ts">
    import { writable } from 'svelte/store';
    import { onMount } from 'svelte';
    import { LangsysApp, type iLangsysInitConfig } from 'langsys-js-svelte';

    const userLocale = writable('en-US');
    let appReady = $state(false);
    let appInitError = $state<string | null>(null);

    onMount(async () => {
        const res = await LangsysApp.init({
            // Vite:   import.meta.env.VITE_LANGSYS_PROJECT_ID
            // Rollup: process.env.LANGSYS_PROJECT_ID, once @rollup/plugin-replace
            //         substitutes it — see §2. Without that it is undefined.
            projectid: import.meta.env.VITE_LANGSYS_PROJECT_ID,
            key: import.meta.env.VITE_LANGSYS_API_KEY,
            UserLocaleStore: userLocale,
            baseLocale: 'en-US',
            debug: import.meta.env.DEV,
        } satisfies iLangsysInitConfig);
        if (res.status) appReady = true;
        else appInitError = res.errors?.join(', ') ?? 'Init failed';
    });
</script>

{#if appInitError}
    <p>Langsys init failed: {appInitError}</p>
{:else if !appReady}
    <p>Loading…</p>
{:else}
    <Header /> <main>…</main> <Footer />
{/if}
```

`ssrTokenStrategy` is omitted here — there is no server render to reconcile with.

## 4. Translate strings — `$t`

`t` is a **store**. Read it with `$t` — no hook, no per-component setup.

```svelte
<script>
    import { t } from 'langsys-js-svelte';
    let { name } = $props();
</script>

<h1>{$t('Welcome to my app', 'Home')}</h1>
<p>{$t('Hello, {name}!', 'Home', { name })}</p>
```

All four shapes work:

```svelte
{$t('Save')}
{$t('Save', 'UI')}
{$t('Hello, {name}!', { name })}
{$t('Hello, {name}!', 'Greetings', { name })}
```

Note `{name}` inside the `$t()` string stays single-brace — it is a JS string argument, so the Svelte compiler never touches it.

## 5. Markup — pick the right component

Full decision procedure: [core/choosing-primitives.md](../core/choosing-primitives.md).

### `<Phrase>` — one sentence containing inline markup

```svelte
<script>
    import { Phrase } from 'langsys-js-svelte';
    let reviewCount = $state(5);
</script>

<Phrase category="ProductCard" params={{ n: reviewCount }}>
    Based on %n% <strong>reviews</strong>
</Phrase>
```

Registers as **one** phrase, so a plural rule can inflect `reviews` against `{n}`. Splitting it makes that impossible in Russian, Polish, and Arabic.

### `<Translate>` — a block of markup

```svelte
<script>
    import { Translate } from 'langsys-js-svelte';
</script>

<Translate category="Blog" tag="article">
    <h1 class="title">My article title</h1>
    <p>My content <strong>is the best</strong> when internationalized.</p>
</Translate>
```

```svelte
<Translate category="News" tag="div">
    {@html article?.content}
</Translate>
```

### `<DontTranslate>`

```svelte
<script>
    import { DontTranslate } from 'langsys-js-svelte';
</script>

Built with <DontTranslate>Kangen®</DontTranslate>
```

### ⚠️ `%name%`, never `{name}`, in markup

```svelte
<Translate category="Dashboard" params={{ name, count }}>
    <p>Welcome back, %name%. You have %count% new messages.</p>
</Translate>
```

Svelte treats `{name}` in markup as an expression tag and substitutes it **before** Langsys sees the text — silently breaking translation while still looking right in the base locale. The braces on `params={{ … }}` are ordinary Svelte and stay as-is.

Only identifiers match (`%[A-Za-z_][A-Za-z0-9_]*%`), so "50% off" and `width: 100%` are untouched.

## 6. Switching locale

```svelte
<script>
    import { LangsysApp } from 'langsys-js-svelte';
    // the same writable passed to init
    export let userLocale;
</script>

<select bind:value={$userLocale}>
    <option value="en-US">English</option>
    <option value="es-ES">Español</option>
</select>
```

```svelte
$effect(() => {
    LangsysApp.translationsLoadingPromise.then(() => { /* … */ });
});
```

## Exports

| Export | Type | Notes |
|---|---|---|
| `t` | `Readable<TFunction>` | Use as `$t('Phrase', 'Cat', params?)` |
| `currentlyLoadedLocale` | `Readable<string>` | Lags `UserLocaleStore` during fetch |
| `sTranslations` | `Readable<iCategories>` | Raw catalog. Rarely needed |
| `LangsysApp` | | `init` takes a Svelte `Writable<string>` |
| `canonicalizeLocale` | | `'en-us'` → `'en-US'` |
| `<Translate>` | | `category?` `custom_id?` `label?` `tag?` `class?` `params?` |
| `<Phrase>` | | `category?` `params?` `tag?` `class?` |
| `<DontTranslate>` | | `tag?` `class?` |

## Migrating from v2.x

The proxy API was replaced in 3.0.0:

```svelte
<h1>{$_['UI']['Title']}</h1>   <!-- v2.x -->
<h1>{$t('Title', 'UI')}</h1>   <!-- v3.0+ -->
```

Note the inversion: `$_[category][phrase]` → `$t(phrase, category)`. Mechanical and codemod-friendly, but **the order flips** — check every conversion.

## Checklist

- [ ] Svelte 5
- [ ] `PUBLIC_` prefix (SvelteKit) or `VITE_` (plain Vite)
- [ ] `UserLocaleStore` is a Svelte `Writable`, not a `Signal`
- [ ] Init in `+layout.svelte`, gated on `res.status`
- [ ] `%name%` in markup, `{name}` in `$t()` strings
- [ ] `<Phrase>` for markup-bearing sentences
- [ ] No template literals in phrase arguments
- [ ] Read-only key + `debug: false` in production

Then [verify.md](../verify.md).
