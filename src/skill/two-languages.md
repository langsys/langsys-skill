# One project, two SDKs

Read this when a project translates through more than one Langsys SDK — the common shape being
a PHP or Node backend rendering pages and a React, Vue or Svelte frontend rendering the rest.

**One project means one catalog.** Both SDKs register into it and read from it. That is the
point: a phrase translated once is translated for everyone. It also means the two SDKs have to
agree on the identity of every phrase and every block, or the same content registers twice and
each copy gets translated and billed separately.

They do agree, by design. This page is the list of things that have to stay true, and how to
check each one — because when they diverge the symptom is duplicate catalog entries, which
nobody notices for weeks.

---

## 1. The same text must hash to the same id

A content block's identity is an md5 over its category and its token list. Both SDKs hash
**UTF-8 bytes**, so non-ASCII content lands on one id. Checkable in two commands:

```bash
php -r 'echo md5("Café"), PHP_EOL;'
node -e "import('langsys-js-typescript/pure').then(m=>console.log(m.md5('Café')))"
```

```
4655bd14eebfaf444e5b33d6851dbbd0      # both
```

If those differ, stop and report it — every non-ASCII block in the project is registering
twice. (They differed before base SDK 0.6.0, which packed UTF-16 code units into byte lanes
and so matched a real md5 only for ASCII.)

To derive a block id directly, both SDKs expose the same function over the same inputs:

```js
import { generateCustomId } from 'langsys-js-typescript/pure';
generateCustomId('Pricing', ['Compare every plan', 'Cancel anytime']);
// 65651be2c98d6a129882c57eeb373e80
```

**No category and the literal category `__uncategorized__` are the same thing** — both produce
the id of an uncategorized block. Do not invent a placeholder category to "fill the field";
`__uncategorized__` is not a category name you should ever write.

## 2. The same text must tokenize the same way

The id is over a token list, so the two SDKs must read the same HTML into the same tokens.
Current versions do, and these are the rules both follow:

| Rule | Both SDKs |
|---|---|
| Whitespace | collapsed to single spaces and trimmed, in text and in attribute values |
| Non-breaking space, line/paragraph separators | read as ordinary whitespace |
| C0 control characters | removed |
| `<script>`, `<style>`, `<template>`, `<noscript>`, `<math>` | contents are not part of a block |
| `<svg>` text | translated |
| `translate="no"`, `data-notrans` | skipped, with children; presence is intent, an explicit `false`/`0` opts back out |
| `%name%` in a phrase | stored as `{name}` |

That last row is worth checking against your own expectations:

```js
normalizeMarkupPlaceholders('Based on %n% reviews')   // 'Based on {n} reviews'
```

So `%n%` and `{n}` register the **same** phrase. Translators only ever see `{n}`.

**This alignment is recent on the PHP side.** PHP SDK 2.0 moved its text reading onto these
rules, which is why some PHP content registers under a new id when a project upgrades from
1.x — the old entry keeps its translations, the new one is translated again. That is a
one-time cost per affected block, not a recurring one, and the PHP SDK's own upgrade guide
lists which shapes move.

## 3. The markers mean the same thing in both

Both families are understood by both SDKs on current versions:

| Intent | Canonical | Also accepted |
|---|---|---|
| This run is one phrase, keep it whole | `data-ls-phrase` | `data-langsys-phrase` |
| This element is a content block | `data-ls-contentblock` | `data-langsys-contentblock` |
| Already translated; do not register | `data-ls-resolved` | `data-langsys-resolved` |
| This element wraps a value | `data-ls-param` | — |
| Category for this subtree | — | `data-langsys-category` *(PHP only)* |

Write the canonical `data-ls-*` spelling in new hand-authored HTML. `data-langsys-*` is the
PHP SDK's original author-facing family and stays supported; both resolve to the same marker.

In the JavaScript framework bindings you write `<Phrase>` / `<Translate>` / `<DontTranslate>`
and never the attribute — the components set it. The attributes are for hand-authored HTML and
for server-rendered templates.

> **Older PHP ignored `data-ls-*`.** PHP SDK 1.x understood only `data-langsys-*`, so a
> `data-ls-phrase` written for the JS side was silently inert in a PHP-rendered template — no
> error, the marker simply did not apply. If the project is on PHP 1.x, write
> `data-langsys-*` in anything PHP renders.

## 4. Decide which SDK owns which content

The failure here is not a wrong id — it is both SDKs walking the same DOM. A PHP-rendered page
that a browser SDK then walks gets its already-translated text read as source and registered
in the wrong language.

`data-ls-resolved` is what prevents it. PHP's page translation stamps it on `<html>` when it
renders in a non-base locale, and the browser SDK skips everything inside a resolved element:
nothing is registered, nothing is reported.

So:

- **Server renders the page, client enhances it** — let PHP translate and stamp the page. The
  browser SDK then translates only what the client renders itself.
- **Server renders a shell, client renders the app** — keep the server's markup out of the
  client SDK's reach, or mark it resolved.
- **Both render the same component** — pick one. Two SDKs maintaining one block is the case
  that produces duplicate registrations even when every rule above holds.

Write the decision down in the integration plan. It is not recoverable from the code later:
both arrangements look identical in the base language.

## 5. Both SDKs' write capability is decided separately

Each session gets its own answer, so a project can be write-enabled on one side and read-only
on the other — which is usually what you want. A typical production setup:

| Side | Key | Registers |
|---|---|---|
| PHP backend, on your own servers | `ip_write`, servers allow-listed | yes |
| Public frontend in visitors' browsers | `read` or the same `ip_write` | no |

That arrangement registers server-rendered content from the server and leaves client-only
content to be registered from an allow-listed machine or a grant-carrying session — see
[projects-and-keys.md](./projects-and-keys.md). Content that only ever renders in an anonymous
visitor's browser registers from nowhere, and that is the gap to plan around.

## Checklist

- [ ] The two md5 commands above agree
- [ ] Both SDKs are on versions whose text rules match (PHP 2.0+ with base SDK 0.7+)
- [ ] One owner per piece of content, written down
- [ ] Server-translated pages are stamped resolved before any browser SDK walks them
- [ ] `data-ls-*` in new HTML; `data-langsys-*` if anything is still on PHP 1.x
- [ ] A decided write path on each side
