import { useMemo } from 'react';
import { findPlaceholders } from '@/lib/reports/reportQa/documentIdentity.pure';

/** How many slots the line names before it counts the rest. */
const SHOWN = 3;

/**
 * The slots an answer still carries — `[Client Name]`, `[Insert Date]`,
 * `[XX]%` — said beside the export, before the PDF exists.
 *
 * The owner's export of 30 Sep 2026 printed "Prepared for: [Client Name]" and
 * "Date: [Insert Date]" on the cover. A slot in the answer's opening details is
 * now left off the page (`readTitleBlock`), but a slot inside a sentence cannot
 * be taken out without rewording it, so it prints as written — and this is the
 * one place the person can see that before a client does.
 */
export function PlaceholderNotice({ content }: { content: string }) {
  const slots = useMemo(() => findPlaceholders(content), [content]);
  if (!slots.length) return null;
  const more = slots.length > SHOWN ? ` and ${slots.length - SHOWN} more` : '';
  return (
    <span className="text-xs text-warning">
      · {slots.length === 1 ? '1 placeholder' : `${slots.length} placeholders`} to fill in:{' '}
      {slots.slice(0, SHOWN).join(', ')}{more}
    </span>
  );
}
