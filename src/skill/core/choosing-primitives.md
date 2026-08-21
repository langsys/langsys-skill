# Choosing the right primitive

**Read this before writing any Langsys code.** Picking the wrong primitive is the most common Langsys integration error, and the failures are silent in the base language.

Langsys has three ways to mark content for translation. They answer different questions.

| Content | Primitive | What it does |
|---|---|---|
| Plain string, no markup | `t()` / `$t()` | One phrase. Nothing to decide. |
| A block of markup — article, nav, form, marketing section | `<Translate>` | **Splits.** Tokenizes each text node and translatable attribute as its own phrase, registered together as one content block. |
| One sentence that happens to contain inline markup | `<Phrase>` | **Keeps together.** Encodes the whole run as a single phrase. Does not split at tag boundaries. |

**These are two different pipelines, not two settings on one.** `<Translate>` tokenizes each text
node separately and registers a **content block** with a computed id; `<Phrase>` joins the whole run
into a **single phrase string** and looks it up like any other phrase. It produces no content block
and no id. That is why the choice is not stylistic — the two primitives put different things in
your catalog, and a mistake is not visible in the base language.

The question is **not** "how big is this?" It is:

> **Does this tag boundary belong to the language, or to the layout?**

A `<strong>` inside a sentence belongs to the language — the sentence is one unit of meaning and must be translated as one. A `<p>` between two paragraphs belongs to the layout — they are separate units.

---

## Two decisions, not one

### Decision 1 — per content region (three-way)

Choose `t()`, `<Phrase>`, or `<Translate>` based on the table above.

**Standalone `<Phrase>` is first-class.** It does not need a `<Translate>` parent. A single sentence with inline markup is a `<Phrase>` on its own:

```jsx
<Phrase category="ProductCard" params={{ n: reviewCount }}>
  Based on %n% <strong>reviews</strong>
</Phrase>
```

Wrapping that in a `<Translate>` with no other content is wrong — it manufactures a content block that has no reason to exist.

### Decision 2 — per text run, only inside a block

Having chosen `<Translate>`, protect individual runs with `<Phrase>`. The block tokenizer skips `<Phrase>` subtrees, so they register as their own single phrase:

```svelte
<Translate category="Pricing">
  <h2>Simple pricing</h2>              <!-- split out as its own phrase -->
  <p>Everything you need to ship.</p>   <!-- and this one -->

  <Phrase params={{ n: seats }}>        <!-- but this stays whole -->
    Includes %n% <strong>seats</strong>
  </Phrase>
</Translate>
```

Decision 2 only arises *because* you already chose a block. Do not read the nesting as a requirement.

---

## Why `<Phrase>` exists

Three reasons, in priority order.

### 1. Grammatical agreement — the one that produces broken output

**A count and the noun it inflects must live in one phrase.**

```jsx
// WRONG — splits into "Based on", "5", "reviews"
<Translate category="ProductCard">
  Based on <strong>{n}</strong> reviews
</Translate>
```

Now the count sits in a different catalog entry from the noun it governs, so **no plural rule can reach across the boundary**. In English you get away with it. In Russian (4 plural categories), Arabic (6), or Polish, the noun form changes with the number and the translation is simply wrong — not awkward, wrong.

This is why the rule matters even when the split "looks fine."

### 2. Word order — reordering languages

Inline elements become `{m0o}`…`{m0c}` markup-token pairs. These are ordinary ICU placeholders, so the translator places them around the *translated* word:

```
<span>White</span> House   →   Casa <span>Blanca</span>
```

Split at the tag boundary and this is impossible — the emphasis is stuck on the wrong word.

> **Reordering is about word ORDER. Agreement is about word FORM.** Do not conflate them. A team can live with awkward order; wrong noun forms read as broken.

### 3. Key stability

Your real markup never leaves the SDK. Framework scoped-CSS classes (`svelte-a1b2c3`, Vue hashes) change on every build — if they were part of the phrase, the key would drift and silently re-translate your entire app. The wire form contains only `{m0o}`/`{m0c}`; the real elements are reconstituted around the translated text at render.

---

## `<DontTranslate>`

Marks content that must survive verbatim — brand names, domains, code, SKUs:

```jsx
Built with <DontTranslate>Kangen®</DontTranslate> on <DontTranslate>langsys.dev</DontTranslate>
```

Renders `translate="no"`, which the tokenizer and renderer both honor. Never tokenized, never registered, never replaced.

**Available in all three bindings** — React, Vue, and Svelte — regardless of what their READMEs cover.

---

## Rules for markup children

Both `<Translate>` and `<Phrase>` mount a DOM walker on their host element and mutate the rendered output in place.

- **Keep children static.** Prose, marketing copy, CMS content, form labels. Framework-dynamic children fight reconciliation.
- **Dynamic values go through `params`**, never through interpolated children.
- **Write placeholders as `%name%`**, never `{name}` — see [interpolation.md](./interpolation.md). This one fails silently.

---

## Decision checklist

Ask, in order:

1. **Any markup in this content?** No → `t()`. Done.
2. **Is it one sentence, or several units?** One sentence → `<Phrase>`. Several → `<Translate>`.
3. **If `<Translate>`: does any run inside it contain inline markup?** Yes → wrap that run in `<Phrase>`.
4. **Any brand/code/domain that must not translate?** → `<DontTranslate>`.
5. **Any runtime values?** → `params`, with `%name%` in markup.

## Common mistakes

| Mistake | Why it's wrong |
|---|---|
| `<Translate>` around a sentence with `<strong>` | Shreds it into fragments; breaks pluralization |
| `<Phrase>` around an article | Collapses a whole document into one unmanageable phrase |
| `<Translate>` around a bare string | A slower `t()` with extra registration overhead |
| `<Phrase>` inside `<Translate>` "because it's required" | It isn't — standalone `<Phrase>` is first-class |
| HTML tags inside a `t()` string | Never renders as markup; use `<Phrase>` |
| Assuming Svelte lacks `<Phrase>` / `<DontTranslate>` | It has both — the README just doesn't document them |
