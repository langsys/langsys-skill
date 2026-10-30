# Laravel

> **Pinned guide.** Verified against `langsys/langsys-php-laravel@v1.0.0`, which requires
> `langsys/langsys-php: ^1.3` and therefore installs **PHP SDK 1.3.x**.
> A project on another version reads that package's own README instead —
> [why](./README.md).

```bash
composer require langsys/langsys-php-laravel
php artisan vendor:publish --tag=langsys-config
php artisan view:clear   # views compiled before installing print @lang as Laravel's own
```

```dotenv
LANGSYS_API_KEY=your-api-key
LANGSYS_PROJECT_ID=your-project-id
```

Requirements: **PHP 8.1+**, **Laravel 10, 11 or 12**, and **`ext-intl`** — a hard requirement,
and the official `php:8.x-fpm` images do not bundle it (`docker-php-ext-install intl`).

## Laravel stays on PHP SDK 1.x — do not reach for 2.0 features

`langsys-php-laravel@1.0.0` constrains the core to `^1.3`, so a Laravel app is on **PHP SDK
1.3.x**. Everything PHP SDK 2.0 introduced — the per-request write decision, `canWrite()`
asking the API, `require_credentials` on the client, import and sync, migration mode, `Vary`
on locale negotiation, value markers — is **not present** in a Laravel app today, and
`composer require langsys/langsys-php:^2.0` alongside it will not resolve.

So: **do not read the `langsys-php` core skill for a Laravel app.** It describes 2.0. Use this
guide, and the Laravel package's own README for anything it does not cover.

## The one rule that reads backwards here

Everywhere else in Langsys the source text is the key and there are no catalog files. **In
Laravel you keep your lang files and keep writing keys.**

```php
__('messages.welcome')      // ✅ correct in Laravel
```

That is not a contradiction. The key resolves to its line in your **base-language** file, and
**that sentence is the phrase Langsys translates**. The key never reaches Langsys. So:

- Keep `lang/en/*.php` and `lang/en.json`. They are the phrase source, not catalog files to
  delete.
- Delete the *other* languages' files only when you want Langsys to serve them instead; while
  both exist, the catalog answers first and your lang files are the fallback.
- A key with no line in the base-language file has no phrase, so there is nothing to
  translate. That is the one thing to fix rather than work around.

Resolution order for `__()`, `trans()`, `trans_choice()` and `@lang`: the catalog, then your
lang files, then the source. `t()` and `@t` are the same functions under shorter names.

## Registration happens at sync, not on a request

```bash
php artisan langsys:sync      # needs a WRITE key
```

`langsys:sync` registers every phrase your PHP and Blade can show, plus every line of your
base-language files, carrying across the translations your other lang files already have.

**Serving a request registers nothing through `__()`.** This is the opposite of the JavaScript
SDKs, where discovery happens as the app runs, and it is the thing to get right in the plan:

| Want | Do |
|---|---|
| New phrases registered | run `langsys:sync` in development, or in a CI job, with a write key |
| Serving | a read-only key. Lookups only |

Two exceptions register during a request: a sentence built from a declared value that your last
sync did not see, and the opt-in page walk below, which registers what it meets after the
response.

The key type is detected server-side; there is no local toggle. On PHP SDK 1.x the key's type
is the whole decision — the per-session server decision described in
[../projects-and-keys.md](../projects-and-keys.md) arrives with 2.0 and does not apply here.

## What the package adds

| Piece | What it does |
|---|---|
| Service provider | builds the SDK client from `config/langsys.php`, routes catalog caching through **Laravel's cache** (any store) |
| `DetectLocale` middleware | resolves the request locale: query → cookie → session → `Accept-Language`. Add it to the `web` group, or per route via the `langsys.locale` alias |
| `TranslateResponse` middleware | **opt-in**: translates whole rendered HTML responses, for routes that do not translate through `__()` |
| Validation messages | built from the rule that failed, carried beside Laravel's own error body for a client SDK to render |
| `InertiaSsrProps` | seeds the JS SDKs' `initialTranslations` for an Inertia SSR handoff |

```php
// Laravel 11/12: bootstrap/app.php
->withMiddleware(function (Middleware $middleware) {
    $middleware->web(append: [\Langsys\Laravel\Http\Middleware\DetectLocale::class]);
})
```

## Running without credentials

Installing is enough — with nothing in the catalog `__()` returns exactly what Laravel returns
on its own, and it does the same **with no key at all**, so tests, CI and a fresh checkout run
without one.

- `LANGSYS_REQUIRE_CREDENTIALS=true` — the first request that translates anything throws.
  Booting never does, so `config:cache` and an image build without secrets still complete. Use
  it where a missing key is a mistake, such as production.
- `LANGSYS_ENABLED=false` — off entirely: Laravel answers with its own translator and
  validator, and the package's middleware does nothing. Views compiled either side of the
  switch render either way.

## With a JavaScript frontend

A Laravel backend plus a React, Vue or Svelte frontend is two SDKs on one project. Read
[../two-languages.md](../two-languages.md) before wiring it — in particular which side owns
which content, and marking server-translated pages resolved so the browser SDK does not
re-register them.

Mind the version pairing: Laravel is on PHP SDK 1.3.x, which understands only the
`data-langsys-*` marker family, so write that spelling in anything Blade renders.

## Checklist

- [ ] PHP 8.1+, Laravel 10/11/12, `ext-intl` present
- [ ] `php artisan view:clear` after installing
- [ ] `DetectLocale` in the `web` group, or the route alias
- [ ] Base-language lang files kept — they are the phrase source
- [ ] `langsys:sync` with a write key in development or CI; read-only key for serving
- [ ] `LANGSYS_REQUIRE_CREDENTIALS=true` in production
- [ ] `data-langsys-*` markers, not `data-ls-*`, in Blade
