<script>
  import { Translate, Phrase, t } from 'langsys-js-svelte';
  let name = $state('Sarah');
  let count = $state(3);
  // NEGATIVE: brace in a comment example — {name} — must not flag
</script>

<!-- POSITIVE: {name} in Translate markup -->
<Translate category="Dashboard" params={{ name, count }}>
  <p>Welcome back, {name}. You have {count} new messages.</p>
</Translate>

<!-- NEGATIVE: correct %name% form -->
<Translate category="Dashboard" params={{ name, count }}>
  <p>Welcome back, %name%. You have %count% new messages.</p>
</Translate>

<!-- NEGATIVE: t() with braces inside markup — CORRECT, must not flag -->
<Translate category="Mixed">
  <p>{$t('Hello, {name}! You have {count} new messages.', 'Greetings', { name, count })}</p>
</Translate>

<!-- POSITIVE: block element inside Phrase -->
<Phrase category="Bad">
  <p>This is a block</p>
</Phrase>

<!-- POSITIVE (error, has params): inline markup + params in Translate -->
<Translate category="Reviews" params={{ n: count }}>
  Based on %n% <strong>reviews</strong>
</Translate>

<!-- NEGATIVE: correct Phrase usage -->
<Phrase category="Reviews" params={{ n: count }}>
  Based on %n% <strong>reviews</strong>
</Phrase>
