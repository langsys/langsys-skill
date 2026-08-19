<?php
// ── POSITIVES: dynamic expression in FIRST-argument position ────────────────
$client->translate(sprintf('Hello, %s!', $name));
$client->translate(vsprintf('Hi %s from %s', $args));
$client->translate('Hello, ' . $name . '!');
$client->translate("Hello, $name!");
$client->translateContentBlock('<p>Hi ' . $name . '</p>');

// ── NEGATIVES: correct usage — must NOT flag ───────────────────────────────
$client->translate('Hello, {name}!', null, null, null, ['name' => $name]);
$client->translate('Home');
$client->translate('Home', 'es-es', 'UI');
$client->translate("Plain double-quoted, no interpolation");

// Dynamic values in NON-phrase positions are correct by design.
$client->translate('Home', $locale, $category);
$client->translate('Home', $locale, $cat, $blockId, ['n' => $count]);
$client->translate('Total: {n}', null, null, null, ['n' => sprintf('%d', $x)]);
$client->translate('Greeting', $this->getLocale(), "Cat$suffix");

// sprintf elsewhere in the file is none of our business.
$log = sprintf('user %s did %s', $name, $action);
