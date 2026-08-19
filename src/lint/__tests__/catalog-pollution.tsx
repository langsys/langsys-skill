import { useT } from 'langsys-js-react';

export function Bad({ name, count }: { name: string; count: number }) {
  const t = useT();
  return (
    <>
      {/* POSITIVE: template literal phrase */}
      <p>{t(`Hello, ${name}!`)}</p>
      {/* POSITIVE: template literal with category */}
      <p>{t(`You have ${count} messages`, 'Inbox')}</p>
      {/* POSITIVE: concatenation */}
      <p>{t('Hello, ' + name + '!')}</p>
    </>
  );
}

export function Good({ name, count }: { name: string; count: number }) {
  const t = useT();
  return (
    <>
      {/* NEGATIVE: literal phrase with params — MUST NOT FLAG */}
      <p>{t('Hello, {name}!', 'Greetings', { name })}</p>
      {/* NEGATIVE: the canonical nested-in-markup case — MUST NOT FLAG */}
      <p>{t('Hello, {name}! You have {count} new messages.', 'Greetings', { name, count })}</p>
      {/* NEGATIVE: plain literal — MUST NOT FLAG */}
      <p>{t('Save', 'UI')}</p>
      {/* NEGATIVE: template literal NOT in a t() call — MUST NOT FLAG */}
      <p className={`row-${count}`}>{t('Total', 'Cart')}</p>
    </>
  );
}

export function Reversed({ name }: { name: string }) {
  const t = useT();
  return (
    <>
      {/* POSITIVE: reversed — second arg has a placeholder */}
      <p>{t('UI', 'Hello, {name}!')}</p>
      {/* NEGATIVE: correct order — must not flag */}
      <p>{t('Hello, {name}!', 'UI', { name })}</p>
      {/* NEGATIVE: category + plain phrase, no placeholder — not detectable, must not flag */}
      <p>{t('Save', 'UI')}</p>
    </>
  );
}
