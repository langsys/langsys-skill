# Which Langsys SDK does this project need?

One project, one catalog, and one SDK per place content is rendered. Pick by **where the text
reaches the user**, not by what the repository is mostly written in.

## The tree

Every Langsys SDK is a framework layer over a language core, and the skills follow the same
shape:

```
langsys                        this skill — what is true in every language
├── langsys-typescript         core for every JavaScript framework
│   ├── langsys-svelte
│   ├── langsys-react
│   └── langsys-vue
└── langsys-php                core for PHP
    └── langsys-laravel
```

**You install the framework package; it brings the core with it.** You do not install both.
In a React or Vue app, adding the core yourself gives the app two copies of it — see
[sdk-versions.md](./sdk-versions.md), which is the one thing to read before installing
anything.

## Decide

| The text is rendered by | Install | Then read |
|---|---|---|
| React, Next.js, Remix | `langsys-js-react` | [pinned/react.md](./pinned/react.md) |
| Vue, Nuxt | `langsys-js-vue` | [pinned/vue.md](./pinned/vue.md) |
| Svelte, SvelteKit | `langsys-js-svelte` | `langsys-svelte`, over `langsys-typescript` |
| No framework — plain TS/JS, a web component, a Node script | `langsys-js-typescript` | `langsys-typescript` |
| PHP templates, any framework but Laravel | `langsys/langsys-php` | `langsys-php` |
| Laravel | `langsys/langsys-php-laravel` | [pinned/laravel.md](./pinned/laravel.md) |
| A Node server rendering crawler-visible HTML | `langsys-js-server` | [pinned/js-server.md](./pinned/js-server.md) |

If a skill named in the third column is not among your skills, the package has not had a
release carrying it yet. [sdk-versions.md](./sdk-versions.md) says what to do: a pinned guide
if one covers the installed version, otherwise that package's own README.

## Two renderers means two SDKs

A Laravel or PHP backend rendering pages **and** a JavaScript frontend rendering the rest is
the normal case, not an exotic one. Install both, and read
[two-languages.md](./two-languages.md) before wiring either — the agreement between them on
phrase and block identity is checkable, and the thing that goes wrong is content registering
twice.

Do **not** try to serve one from the other. The PHP SDK cannot translate what the browser
renders, and the browser SDK must not re-walk what PHP already translated.

## Before you install anything

Answer these first; each one changes what gets written.

| Question | Why it decides something |
|---|---|
| **Is there an existing i18n library?** | i18next, react-intl, vue-i18n, svelte-i18n, next-intl, Laravel `__()`, gettext — this becomes a migration, not an integration, and the migration has to resolve keys to source text before anything is rewritten |
| **What is the base locale?** | the language your source phrases are written in. Usually `<html lang>`, an existing i18n config, or ask. Guessing it registers your copy under the wrong language |
| **Which bundler?** | decides the environment-variable prefix, the single most common silent misconfiguration — [projects-and-keys.md](./projects-and-keys.md) |
| **Does the app server-render?** | and does it need *crawler-visible* translated body copy, or only a fast first paint? Only the first needs a server-rendering path at all |
| **Is it behind a login?** | decides how anything ever gets registered — a public site can be visited by an allow-listed machine; a login-walled app needs write grants |

`scan` and `doctor` answer the mechanical ones — [tools.md](./tools.md). They do not know the
base locale, and they cannot tell you which side owns which content.

## The rules every SDK shares

Stated here; each core skill gives the API for them and the reasons in full.

1. **Never build a phrase string.** An interpolated phrase registers a new catalog entry per
   value, permanently, in state every SDK on the project shares. No SDK can detect it. Pass
   values as params.
2. **The source text is the key.** No catalog files, no dot-keys — with one deliberate
   exception, Laravel, where your lang files supply the source text and the key resolves to it.
3. **Phrase first, category second.** Both orders typecheck when the phrase has no
   placeholder, so the compiler will not catch a swap.
4. **Choose the primitive by asking whether a tag boundary belongs to the language or to the
   layout.** Plain text is a plain call. One sentence containing inline markup is kept whole.
   A block of separate units is split. Getting this wrong shreds sentences and makes plurals
   unexpressible in Russian, Arabic and Polish, while looking perfect in the base language.
5. **Untranslated text renders as its source.** The base language always looks right, which is
   why most mistakes here are invisible until someone switches locale or reads what was
   registered.
6. **The server decides whether a session may register**, not the key's type —
   [projects-and-keys.md](./projects-and-keys.md).
7. **Categorize only when the same words legitimately mean different things** —
   [categories.md](./categories.md).
