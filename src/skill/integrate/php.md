# PHP integration

`langsys/langsys-php` · **PHP ≥ 7.4** with `ext-intl`, `ext-curl`, `ext-json`.

## 0. Requirements — check before installing

The current SDK requires **PHP 7.4+** and **`ext-intl`** (which backs ICU plural/select). Verify first:

```bash
php -v
php -m | grep -E '^(intl|curl|json)$'
```

Missing `ext-intl` does **not** break rendering — it degrades to simple `{name}` substitution. That means plurals quietly stop being correct per language, which nobody notices until a Russian or Arabic user complains. Treat a missing `intl` as a real defect, not a warning to skip.

`doctor` checks all of this.

> **ICU plural correctness is verified** as of v1.0.0 — on CI with `intl 8.4.24` / ICU 74.2, across PHP 7.4–8.4. That covers Russian plurals (including the 21→`one` and 111→`many` cases), Arabic's six categories with Arabic-Indic digits, locale number formatting, and malformed-ICU fallback. The suite refuses to skip those tests on CI, so they cannot pass by omission.
>
> This matters locally: `ext-intl` is missing from some current builds — it is absent from Homebrew's PHP 8.5, and the PECL `intl` package no longer compiles against it. **A local box without intl silently produces different plural output than production with intl.** Check `php -m | grep intl` before concluding plurals are broken.

## 1. Install

### Via Composer

```bash
composer require langsys/langsys-php:^1.1
```

The package name is **`langsys/langsys-php`**. It was renamed from `langsys/php-sdk`; Packagist takes identity from `composer.json`, so **the old name is not registered and never will be** — if a project requires it, update the requirement.

**Require `^1.1` or later.** v1.1.0 adds `data-langsys-phrase` (§5), which is the only way to keep a markup-bearing sentence in one phrase. On `^1.0` you are stuck with the workaround.

`ext-intl` is a hard requirement in `composer.json`, so on a host without it Composer refuses to install. That is deliberate — see §0. Do **not** reach for `--ignore-platform-req` to get around it without understanding what degrades.

### Manual install (no Composer)

```bash
git clone https://github.com/langsys/langsys-php.git vendor-langsys/langsys-php
```

```php
require_once __DIR__ . '/vendor-langsys/langsys-php/autoload.php';
use Langsys\SDK\Client;
```

This path **bypasses Composer's platform check entirely**, so nothing enforces PHP 7.4 or `ext-intl`. The SDK compensates: `Client` checks requirements on construction and warns to the SDK logger **and** via `trigger_error(E_USER_WARNING)` — the second channel matters here, because a manual install usually has no `log_path` configured. **If translations behave oddly on a manual install, check the PHP error log, not just the SDK log.**

> **The manual path bypasses Composer's version constraint entirely**, so nothing enforces the PHP 7.4 / `ext-intl` floor at install time. The SDK compensates: `Client` runs a runtime requirements check on construction and warns — to the SDK logger **and** via `trigger_error(E_USER_WARNING)`. The second channel matters here, because a manual install usually has no `log_path` configured. **If translations behave oddly on a manual install, check the PHP error log, not just the SDK log.**

## 2. Configure

```bash
LANGSYS_API_KEY=...            # write key in dev, read-only in prod
LANGSYS_PROJECT_ID=...
LANGSYS_API_URL=https://api.langsys.dev/api
LANGSYS_CACHE_DRIVER=file      # file | redis | none
LANGSYS_CACHE_TTL=3600
LANGSYS_LOG_PATH=/var/log/langsys.log
LANGSYS_LOG_LEVEL=info
```

Or explicitly:

```php
$client = new Client($apiKey, $projectId, [
    'cache_driver' => 'redis',
    'cache_ttl'    => 3600,
    'log_path'     => '/var/log/langsys.log',
]);
```

**Use a cache.** Every uncached request round-trips to the API. `file` is fine for a single host; `redis` for multi-host.

## 3. Translate a whole page

The highest-leverage entry point — one pass over the rendered HTML:

```php
<?php
ob_start();
// … your application renders the page …
$html = ob_get_clean();

require 'vendor-langsys/langsys-php/autoload.php';
use Langsys\SDK\Client;

$client = new Client();
echo $client->setLocale('es-es')->translatePage($html, 'homepage');
```

It sets `<html lang>`, ensures `<meta charset>`, translates `<title>`, meta description, OpenGraph and Twitter tags, translates body content, registers new phrases (write key), and falls back to the original text where no translation exists.

Locale detection:

```php
$client->setLocale('fr-ca');       // explicit
$locale = $client->getLocale();    // or auto-detect from HTTP_ACCEPT_LANGUAGE
```

## 4. Translate individual strings

```php
$client->setLocale('es-es');

$text = $client->translate('Home');                    // current locale
$text = $client->translate('Home', 'es-es', 'UI');     // explicit locale + category
```

### ⚠️ Never pre-format the phrase

```php
$client->translate(sprintf('Hello, %s!', $name));   // ❌
```

Every distinct `$name` registers a **new catalog phrase** — "Hello, Sarah!", "Hello, Ahmed!" — permanently polluting the shared Translation Manager that your JS SDKs also read, and billed as translatable words. The SDK cannot detect this: an interpolated string is indistinguishable from an authored one.

```php
$client->translate('Hello, {name}!', null, null, null, ['name' => $name]);   // ✅
```

`sprintf` is the natural reflex here because until recently there was no `params` argument. It is now the wrong one.

## 5. How `translatePage()` decides phrase vs content block

Verified against `HtmlParser::extractPhrases()`:

```
<p>Based on <strong>5</strong> reviews</p>     => ["Based on", "5", "reviews"]
<p>Based on {n} <strong>reviews</strong></p>   => ["Based on {n}", "reviews"]
<p>Read the <a href="#">docs</a> now</p>       => ["Read the", "docs", "now"]
<p><strong>Hello World</strong></p>            => ["Hello World"]
```

**The rule: a sole child keeps together; mixed content shreds.**

Line 2 is the one to understand. The placeholder `{n}` and the noun `reviews` land in **separate catalog entries**, so no plural rule can inflect the noun against the count — broken in Russian (4 plural categories), Arabic (6), Polish.

### `data-langsys-phrase` — keep a markup-bearing run whole (v1.1.0+)

| Need | Attribute |
|---|---|
| **Keep a markup-bearing run as ONE phrase** | `data-langsys-phrase` |
| Force a content block | `data-langsys-contentblock="true"` |
| Set a category | `data-langsys-category="Checkout"` |
| Never translate | `translate="no"` / `data-notrans` — **requires ≥ v1.2.0, see below** |

```html
<p data-langsys-phrase>Based on {n} <strong>reviews</strong></p>
```

registers **one** entry — `Based on {n} {m0o}reviews{m0c}` — instead of two. With a Russian ICU plural that renders `На основе 1 <strong>отзыва</strong>` / `На основе 3 <strong>отзывов</strong>`: the noun inflecting with the count, which is the whole point of §2.

Same `{m0o}`/`{m0c}` wire format as the JS `<Phrase>`, so a block rendered through either path produces a mutually consumable catalog entry.

**Four things to get right:**

1. **Presence alone enables it.** Bare `data-langsys-phrase` works like any boolean HTML attribute; only `="false"` or `="0"` opts out. **This differs from `data-langsys-contentblock`**, whose truthy rule rejects an empty value — so don't pattern-match from that attribute and write `="true"` thinking the bare form is a no-op.
2. **`translatePage()` only.** Inside a content block, a marked run still splits at tag boundaries — content blocks are applied by a path with no tokenized branch. Do not teach or assume it works everywhere.
3. **It wins over `data-langsys-contentblock`** when both are present.
4. **Reordering is supported.** Translators may move `{m0o}`/`{m0c}`; the markup is rebuilt where the tokens land, and attributes (`class`, `href`) are preserved. A dropped, unbalanced, or unknown-index token renders the text without markup rather than failing.

**`data-langsys-contentblock` does not solve the splitting problem.** It forces a block — the direction PHP already defaults to — which is the opposite of what a split sentence needs.

**Script and style content is never touched.** Opaque subtrees and `translate="no"` regions are preserved verbatim and contribute nothing to the phrase, so a marked ancestor cannot pull inline JS into the shared catalog or let a catalog entry rewrite it back into the page.

#### On `^1.0` only

If you cannot upgrade, the honest options for a sentence where a count governs a noun:

1. **Keep it one text node** — remove the inline markup, or wrap the *entire* run in one inline element so it stays a sole child:
   ```html
   <p>Based on {n} reviews</p>
   <p><strong>Based on {n} reviews</strong></p>   <!-- sole child: survives -->
   ```
2. **Accept the split** and its plural limitation — fine for English-only, not for Russian, Arabic, or Polish.

### ⚠️ Content-block `custom_id` agrees across SDKs for ASCII only

If the same content block is rendered through both the PHP SDK and a JS binding, the generated `custom_id` **matches only when the content is pure ASCII**.

```
["home",["Hello","World"]]      PHP aa542d89…   JS aa542d89…   match
["home",["Café"]]               PHP 08576ee6…   JS eed02f1f…   DIVERGE
["home",["Don’t miss out"]]     PHP 78c84ab8…   JS 1571508b…   DIVERGE
```

**Fixed as of base SDK 0.6.0 — require it if you render through both paths.**

Before 0.6.0 the JS hash used UTF-16 code units rather than UTF-8 bytes, so it was standard MD5 only for ASCII. Any accent, curly apostrophe, or non-Latin script produced **two ids for one block**, every time — so a block rendered server-side by PHP and client-side by a JS binding registered and was translated twice.

`langsys-js-typescript@0.6.0` makes `generateCustomId` a standard MD5 over the canonical JSON, matching this SDK on all 12 reference fixtures with byte-identical canonical JSON.

**Migration is automatic and lookup-only.** `Translate` resolves the corrected id first and falls back to the legacy id when that misses, so existing blocks keep serving their translations. Registration always uses the corrected id, so the legacy population only shrinks. Pure-ASCII ids are byte-identical to before; only non-ASCII blocks rebase. `md5Legacy` / `generateLegacyCustomId` are exported for reconciliation tooling and deprecated on arrival.

### `<select>` blocks: a second rebase, fixed in base 0.6.3

Separately from the hash, the JS tokenizer **harvested every `<option>` twice**, so any content block containing a `<select>` derived a different token list — and therefore a different id — from PHP. Fixed in `langsys-js-typescript@0.6.3`; verified by running the published tarball against this SDK's shared fixtures (html→tokens 17/17, tokens→custom_id 17/17).

Migration is automatic and lookup-only, covering **all three historical id shapes**: corrected tokens + corrected hash, duplicated tokens + corrected hash (0.6.0–0.6.2), duplicated tokens + legacy hash (pre-0.6.0). Registration always writes the corrected id. **Content without a `<select>` does not rebase at all** — its token list is byte-identical either way.

> **Expect blocks to appear to gain translations after upgrading.** A project doing PHP-render + JS-hydrate previously produced **two** catalog entries per select-bearing block. From 0.6.3 the JS side computes PHP's id and resolves the entry PHP already registered — so content that was untranslated on the client suddenly has translations. **That is convergence, not a bug**, but "translations appeared out of nowhere" is alarming enough to be worth expecting.

Also harvested as of 0.6.3: `aria-valuetext`, `aria-description`, `aria-roledescription`, and `label` — so a `<select>`'s `<optgroup label="Size">` is translatable through both SDKs.

**Which side was wrong matters when you clean up.** The natural assumption is that PHP had a parity bug and JS was the reference. It was the reverse: **PHP's ids were correct throughout**, and the JS hash was not merely different but *lossy* — it could assign one id to two distinct blocks, so PHP could never have adopted it.

So in a mixed project, the **PHP-registered entries are the ones that were always right**, and the JS-registered non-ASCII entries are the stragglers to reconcile. The shared contract now lives at `langsys-php/tests/fixtures/custom-id-reference.json` (12 cases) and is asserted by both SDKs.

> **On base SDK < 0.6.0 the old behaviour stands** — pick one owner per content block rather than rendering the same block through both paths.

### ⚠️ Missing ICU argument — require v1.3.1, and check the JS side too

Up to and including **v1.3.0**, a missing ICU argument destroyed the sentence and shipped a bare placeholder to end users:

```
{name_gender, select, male {Bienvenido} female {Bienvenida} other {Bienvenide}} {name}
  with ['name' => 'Sarah']   →   '{name_gender} Sarah'
```

**This is reachable without any caller error.** The translation pipeline can introduce a `select` argument the source phrase never carried — a plain `{name}` becomes `{name_gender, select, …}` in gendered target locales. Your application cannot supply `name_gender`; it does not exist in the phrase you wrote. Every app translating into a gendered locale hits it.

**v1.3.1** falls back to the `other` branch, which every `plural` and `select` must provide → `Bienvenide Sarah`.

The recovery is deliberately asymmetric: `select` is genuinely fixed (`other` is what an unknown gender should render), while `plural` is only made less bad — no count can be invented, so you get `{count} items` with the gap visible rather than a destroyed sentence.

**Do not upgrade PHP alone.** JS ≤ 0.6.3 emits the **entire raw ICU pattern** on the same input — verified against the published tarball — because `intl-messageformat` throws where PHP's `MessageFormatter` echoes. So **PHP ≥1.3.1 + JS ≤0.6.3 renders correctly server-side and dumps raw ICU markup client-side on one page.** The asymmetry is created by the PHP fix landing first. JS 0.6.4 matches PHP's outputs; upgrade both together.

Also fixed in v1.3.1: PHP's intl and no-intl paths previously produced two *different* broken outputs for this input, and now agree.

### SSR handoff: your `data-langsys-phrase` markers reach the browser

`translatePage()` output **retains `data-langsys-phrase`**, so on a server-rendered page hydrated by a JS binding, both SDKs walk one DOM.

Before base 0.6.0 the JS tokenizer did not recognise the attribute and recursed into subtrees you had deliberately kept whole — registering **fragments split at tag boundaries**, precisely the failure the marker exists to prevent. As of 0.6.0 both spellings are honored.

**If you server-render with PHP and hydrate with a JS binding, require base SDK ≥ 0.6.1.**

- **0.6.0** taught the JS tokenizer to honor `data-langsys-phrase` — but matched on *presence alone*.
- **0.6.1** fixed the value semantics to match this SDK's `hasPhraseAttribute()`: presence enables, an explicit `false` / `0` (case-insensitive) disables, anything else enables.

On 0.6.0 exactly, a subtree you deliberately un-marked with `data-langsys-phrase="false"` was skipped by JS and translated by **neither** SDK. Verified across all seven value cases; both SDKs now agree exactly.

This is a routine deployment shape, not an exotic one: the Laravel wrapper ships a `TranslateResponse` middleware that runs `translatePage()` over rendered responses, which makes PHP-SSR-plus-JS-hydration the default for any Laravel app that also uses a JS binding. Check the base SDK version before assuming the markers survive the handoff.

### ⚠️ `data-notrans` was INVERTED below v1.2.0 — check before you trust it

**If you are on `langsys/langsys-php` ≤ 1.1.0, `data-notrans` did the opposite of what it says**, in both directions:

| Written | Actual behaviour on ≤ 1.1.0 |
|---|---|
| `data-notrans` (bare) | content **EXTRACTED** and registered into the shared catalog |
| `data-notrans="true"` | excluded |
| `data-notrans="false"` | excluded — the opt-out value also opted you *in* |

There was no string an author could write to opt back in, and the failure direction was **exposure**: content someone deliberately marked as protected went into the catalog every SDK reads.

**Earlier versions of this track recommended `data-notrans` without that caveat.** If you followed that guidance on ≤1.1.0, audit your catalog for entries from regions you meant to protect — they will not have announced themselves. `translate="no"` was unaffected and is the safe marker on older versions.

Fixed in **v1.2.0**.

### One rule for all three markers (v1.2.0+)

As of v1.2.0 every marker follows the same rule — **presence is intent; only an explicit `"false"` or `"0"` opts out**, trimmed and case-insensitive:

- `data-langsys-phrase`
- `data-notrans`
- `data-langsys-contentblock`

**This is a behaviour change for `data-langsys-contentblock`.** Below v1.2.0 a bare or empty value did nothing; from v1.2.0 it *enables* the marker. If you have `data-langsys-contentblock` sitting bare in existing markup expecting it to be inert, it is now active.

Both exclusion attributes are documented upstream for the first time in v1.2.0, including that they are the supported way to tell `translatePage()` a subtree is **already translated**.

### Note on attribute prefixes

PHP uses `data-langsys-*`. The JS SDKs use `data-ls-phrase` **internally** — authors there write `<Phrase>` components, never the attribute. These are different surfaces, by design, and will not be unified.

**`data-ls-*` in hand-authored HTML is silently ignored by PHP** — no error, it simply has no effect.

## 6. Registration and flushing

**v1.3.0 changed when `translatePage()` registers.** It used to register *inline, mid-render* — one POST for phrases plus **one POST per new content block**, then a cache clear and a refetch. A page with eight new blocks blocked on ten round trips before a byte reached the user, while `translate()` made none.

From v1.3.0 it queues like `translate()` and flushes at end of request, or via a host's post-response hook. Measured upstream on a four-block page: **0 requests during render** (was 5 POSTs + 1 GET), **2 batched POSTs at flush**.

**Behaviour change to know about:** a page no longer picks up translations registered by an *earlier* request within the same response — those appear on the **next** request. If you have seen same-response self-healing, that was ≤v1.2 behaviour and is gone.

This also retires the Laravel wrapper's "automatic mode with a write key is development-only" caveat.

New phrases queue during translation and flush on shutdown:

```php
$client->translate('New phrase');
$client->translateContentBlock('<p>New content</p>');
// flushed automatically at shutdown, or:
$result = $client->flushPendingRegistrations();
// ['phrases' => 5, 'content_blocks' => 2, 'success' => true]
```

Read-only keys queue and silently skip on flush — no errors.

## 7. Key type

```php
if ($client->canWrite()) { /* … */ }
echo $client->getKeyType();   // "read" | "write"
```

Write key in development, **read-only in production**.

## Checklist

- [ ] PHP ≥ 7.4, `ext-intl` present (**check `php -m`**)
- [ ] Install path verified — Composer resolves, or manual autoload in place
- [ ] Cache driver configured
- [ ] `translate()` phrases are **literals** — no `sprintf`, no `.` concatenation
- [ ] Params passed via the `$params` argument
- [ ] Sentences where a count governs a noun avoid mixed content (§5)
- [ ] Read-only key in production
- [ ] PHP error log checked for runtime-requirement warnings on a manual install

Then [verify.md](../verify.md).
