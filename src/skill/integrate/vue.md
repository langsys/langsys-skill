# Vue integration

`langsys-js-vue@0.1.1` · requires **Vue 3.4+**.

Covers Vue 3, Nuxt, and Vite SPAs. Server-rendering? Also read [ssr/nuxt.md](../ssr/nuxt.md).

> **Two published README instructions are wrong.** Both are corrected below — do not copy from the 0.1.1 README for `apiUrl` or `detectPreferredLocale`.

## 1. Install

```bash
npm install langsys-js-vue
```

## 2. Environment

```bash
# .env  — Vite
VITE_LANGSYS_PROJECT_ID=...
VITE_LANGSYS_API_KEY=...      # write key in dev, read-only in prod
```

Nuxt uses `NUXT_PUBLIC_` via `useRuntimeConfig().public`.

## 3. Initialize

```vue
<!-- src/LangsysGate.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { LangsysApp, useLocaleStore } from 'langsys-js-vue';

const { store } = useLocaleStore('en-US');
const ready = ref(false);
const error = ref<string | null>(null);

onMounted(() => {
    LangsysApp.init({
        projectid: import.meta.env.VITE_LANGSYS_PROJECT_ID,
        key: import.meta.env.VITE_LANGSYS_API_KEY,
        UserLocaleStore: store,
        baseLocale: 'en-US',
        debug: import.meta.env.DEV,
        ssrTokenStrategy: 'client',
    }).then((res) => {
        if (res.status) ready.value = true;
        else error.value = res.errors?.join(', ') ?? 'Init failed';
    });
});
</script>

<template>
    <p v-if="error">Langsys init failed: {{ error }}</p>
    <p v-else-if="!ready">Loading…</p>
    <slot v-else />
</template>
```

Already own the locale in a ref (Pinia, Nuxt `useState`)? Adapt it:

```ts
import { refToLocaleSource } from 'langsys-js-vue';
LangsysApp.init({ UserLocaleStore: refToLocaleSource(myLocaleRef), /* … */ });
```

### ⚠️ `apiUrl` is not a config field

The 0.1.1 README shows `init({ apiUrl })` — including a commented-out line inside the quickstart block. **It does not exist.** The property is dropped and the SDK keeps talking to production.

```ts
import { LangsysApp, LangsysAppAPI } from 'langsys-js-vue';

LangsysAppAPI.setBaseUrl('http://localhost:8000/api');  // MUST precede init()
await LangsysApp.init({ /* … */ });
```

TypeScript flags the bad form as an excess property. **Plain JS gets no signal** — it just silently doesn't work.

## 4. Translate strings — `useT()`

`useT()` returns a **`ShallowRef`**, so the call form differs between template and script:

```vue
<script setup lang="ts">
import { useT } from 'langsys-js-vue';

const t = useT();

// In script — .value
const title = computed(() => t.value('Dashboard', 'Nav'));
</script>

<template>
    <!-- In template — auto-unwrapped -->
    <h1>{{ t('Welcome to my app', 'Home') }}</h1>
    <p>{{ t('Hello, {name}!', 'Home', { name }) }}</p>
</template>
```

Getting this backwards is the most common Vue-specific error: `t(...)` in script throws, `t.value(...)` in template does not re-render correctly.

Note `{name}` inside the `t()` string stays single-brace — Vue only consumes `{{ }}`, and it is a JS string besides.

## 5. Markup — pick the right component

Full decision procedure: [core/choosing-primitives.md](../core/choosing-primitives.md).

### `<Phrase>` — one sentence containing inline markup

```vue
<script setup lang="ts">
import { Phrase } from 'langsys-js-vue';
</script>

<template>
    <Phrase category="ProductCard" :params="{ n: reviewCount }">
        Based on %n% <strong>reviews</strong>
    </Phrase>
</template>
```

### `<Translate>` — a block of markup

```vue
<Translate category="Blog" tag="article">
    <h1 class="title">My article title</h1>
    <p>My content <strong>is the best</strong> when internationalized.</p>
</Translate>

<Translate category="News" tag="div">
    <div v-html="article?.content ?? ''" />
</Translate>
```

### `<DontTranslate>`

```vue
Built with <DontTranslate>Kangen®</DontTranslate>
```

### Placeholders: use `%name%`

```vue
<Translate category="Dashboard" tag="section" :params="{ name: user.name, count: unread }">
    <p>Welcome back, %name%. You have %count% new messages.</p>
</Translate>
```

A single `{name}` *does* survive in Vue templates (Vue consumes only `{{ }}`), but **write `%name%` anyway** — one portable rule across all bindings, and no `{{ }}` collision. To keep a literal `%WORD%` (e.g. `%PATH%` in docs), wrap it in `<DontTranslate>`.

## 6. Switching locale

```vue
<script setup lang="ts">
import { useLocaleStore } from 'langsys-js-vue';
const { locale, setLocale } = useLocaleStore();
</script>

<template>
    <select :value="locale" @change="setLocale($event.target.value)">
        <option value="en-US">English</option>
        <option value="es-ES">Español</option>
    </select>
</template>
```

### ⚠️ `detectPreferredLocale` — the README's fallback idiom is wrong

The 0.1.1 README claims it returns `false` when nothing matches, so `|| 'en-US'` is safe. It is not. **Two failure modes, only one returns `false`:**

| Situation | Returns |
|---|---|
| Nothing detectable (empty header) | `false` — fallback fires |
| Detected but not in `supported` | the user's top preference — **fallback does not fire** |

An unsupported locale passes straight through. This survives testing because with no header the fallback looks perfect. Use:

```ts
const supported = (await LangsysApp.getLocalesFlat()).map((l) => l.code);
const detected = LangsysApp.detectPreferredLocale(header, supported);
const locale = detected && supported.includes(detected) ? detected : 'en-US';
```

## Exports

| Export | Type | Notes |
|---|---|---|
| `useT()` | `Readonly<ShallowRef<TFunction>>` | Template: `t(...)`. Script: `t.value(...)` |
| `useCurrentLocale()` | `Readonly<ShallowRef<string>>` | Lags the selected locale during fetch |
| `useLocaleStore(initial?)` | `{ locale, setLocale, store }` | Pass `store` to `init` |
| `useTranslations()` | `Readonly<ShallowRef<iCategories>>` | Raw catalog |
| `useSignal(signal)` | | Subscribe the current scope to any base-SDK signal |
| `createLocaleStore(initial?)` | | Locale store at module scope |
| `refToLocaleSource(ref)` | | Adapt an existing Vue ref (Pinia, `useState`) |
| `canonicalizeLocale(s)` | | `'en-us'` → `'en-US'` |
| `<Translate>` | | `category?` `custom_id?` `label?` `tag?` `params?` |
| `<Phrase>` | | `category?` `params?` `tag?` |
| `<DontTranslate>` | | `tag?` |

## Checklist

- [ ] Vue 3.4+
- [ ] Env prefix matches bundler
- [ ] Init gated on `res.status`
- [ ] `t(...)` in templates, `t.value(...)` in script
- [ ] `setBaseUrl()` before `init()` — never `init({ apiUrl })`
- [ ] Locale fallback uses the explicit guard, not `|| 'en-US'`
- [ ] `%name%` in markup
- [ ] `<Phrase>` for markup-bearing sentences
- [ ] Read-only key + `debug: false` in production

Then [verify.md](../verify.md).
