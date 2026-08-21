---
name: langsys-scan
description: Size a Langsys translation job. Reports the framework profile, env prefix, existing i18n library, and every conversion site split by primitive and by effort — without starting an integration. Use when asked how big a translation job is, what would need converting, or whether a project is ready for Langsys.
---

# Scope a Langsys job

Read-only. This answers **"how much work is this?"** — it changes nothing and starts no integration.

## Run it

```bash
node .langsys/bin/scan.mjs .
```

Pass a path to scope a different directory. `--json` emits machine-readable output.

## Report what it found

Summarise in this order, and keep it short:

1. **Profile** — framework and version, bundler, env prefix, existing i18n library if any.
2. **Size** — conversion sites split by primitive (`t()` / `<Phrase>` / `<Translate>`) and by effort.
3. **Deployment posture** — whether the site is prerendered, static, or server-rendered.
4. **Content modules** — files holding several user-visible strings, reported as a magnitude.

## Read the NOT EXAMINED section — do not skip it

`scan` prints what it could **not** see: generated bundles, unparseable files, dynamic call sites.
**The totals are only as complete as that section says.** Report it alongside the numbers rather
than after them; a site count presented without its exclusions reads as a survey when it is a
sample.

Four blind spots are printed on every run and are worth repeating to the user if they are large.
The one that most often matters: **bare string literals in `.ts`/`.js` are not counted as sites**,
because nothing reliably separates a user-visible string from a CSS class or an API path. Files
holding several are reported under CONTENT MODULES as a magnitude instead.

## Then stop

Do **not** begin converting. If the user wants the integration, hand off:

> Run `/langsys` to do the integration itself.

If `scan` reports an existing i18n library, say which migration track applies
(`i18next` / `react-intl` / `vue-i18n`) and that `/langsys` will follow it.
