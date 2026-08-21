# SSR — PHP

PHP renders on the server by definition, so there is no hydration problem to solve. The concerns here are **latency**, **caching**, and **flush timing**.

Read [integrate/php.md](../integrate/php.md) first.

> **Decide the rendering mode first: [core/rendering-mode.md](../core/rendering-mode.md).**
> Public site → SSR; app behind a login → client-only with a ready gate, and skip this track.
>
> **PHP is the one SDK where SSR genuinely emits translated body copy.** `translatePage()`
> post-processes finished HTML on the server, so there is no hydration swap and no
> base-language server render. The caveats in `core/rendering-mode.md` about JS frameworks
> do not apply here — but the caching section below governs how *current* that text is.

## The shape

```php
<?php
ob_start();
// … application renders the page …
$html = ob_get_clean();

$client = new Client();
echo $client->setLocale($locale)->translatePage($html, 'homepage');
```

Every request pays a translation pass. The cache is what makes that acceptable.

## 1. Cache — not optional

```bash
LANGSYS_CACHE_DRIVER=redis     # file | redis | none
LANGSYS_CACHE_TTL=3600
```

| Driver | Use when |
|---|---|
| `file` | Single host. Default. Fine for small deployments |
| `redis` | Multiple hosts, or you want one warm cache across them |
| `none` | Debugging only — every request round-trips to the API |

Without a cache the catalog is fetched per request and page latency tracks API latency.

## 2. Locale resolution

```php
$locale = $client->getLocale();       // auto-detect from HTTP_ACCEPT_LANGUAGE
$client->setLocale('es-es');          // or explicit
```

Prefer an explicit order: **URL segment or cookie → `Accept-Language` → project base locale.** Auto-detection alone makes pages uncacheable per-URL and surprises users who chose a language.

```php
$locale = $_GET['lang']
    ?? $_COOKIE['locale']
    ?? $client->getLocale();
$client->setLocale($locale);
```

## 3. Flush timing

New phrases queue during the request and flush on shutdown. On long-running workers (Swoole, RoadRunner, queue consumers) the shutdown handler may not fire when you expect:

```php
$client->translatePage($html);
$client->flushPendingRegistrations();   // flush explicitly per request/job
```

Read-only keys queue and silently skip — harmless in production.

## 4. Page caching

If you cache rendered pages (Varnish, a CDN, the filesystem), **cache the translated output per locale** and include the locale in the key:

```php
$cacheKey = "page:{$path}:{$locale}";
```

Caching pre-translation output means paying the translation pass on every hit — the expensive half — while caching post-translation output without a locale key serves the wrong language.

Also send `Vary: Accept-Language` when the locale is header-derived.

## 5. Categories per section

```html
<nav data-langsys-category="Navigation"> … </nav>
<footer data-langsys-category="Footer"> … </footer>
```

Or map by selector in one place — cleaner for a template-driven site:

```php
$client->translatePage($html, 'homepage', [
    'nav'       => 'Navigation',
    '.hero'     => 'Marketing',
    'footer'    => 'Footer',
]);
```

## 6. What does not translate

- `<script>` and `<style>` content — never processed
- Elements with `translate="no"` or `data-notrans`, including their children — **`data-notrans` requires PHP SDK ≥ v1.2.0; below that it was inverted and extracted the content instead** (see [integrate/php.md](../integrate/php.md))
- Anything rendered after the output buffer closes

## Common failures

| Symptom | Cause |
|---|---|
| Every page slow | No cache driver, or TTL too short |
| Phrases never register | Read-only key, or flush not reached on a long-running worker |
| Wrong language served from cache | Locale missing from the page cache key |
| Some strings never translate | Rendered outside the buffered region, or inside `<script>` |
| Plurals wrong in Russian/Arabic | `ext-intl` missing (silent degradation) — check `php -m` |

## Checklist

- [ ] `ext-intl` present
- [ ] Cache driver configured, TTL sensible
- [ ] Locale resolution order explicit
- [ ] Page cache keyed by locale; `Vary: Accept-Language` if header-derived
- [ ] Explicit `flushPendingRegistrations()` on long-running workers
- [ ] Read-only key in production
