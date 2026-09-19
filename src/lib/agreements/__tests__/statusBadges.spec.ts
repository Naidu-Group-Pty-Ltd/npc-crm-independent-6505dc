/**
 * The reported case is the first test: a sent agreement drew SENT twice.
 */
import { describe, expect, it } from 'vitest';

import { envelopeBadgeIsRedundant } from '../statusBadges.pure';

describe('envelopeBadgeIsRedundant', () => {
  it('suppresses the envelope badge when it repeats the agreement badge', () => {
    // [✈ SENT] [✉ SENT] — what the audit screenshot shows.
    expect(envelopeBadgeIsRedundant('Sent', 'Sent')).toBe(true);
    expect(envelopeBadgeIsRedundant('Delivered', 'Delivered')).toBe(true);
    expect(envelopeBadgeIsRedundant('Declined', 'Declined')).toBe(true);
  });

  it('compares what a reader sees, not the status code', () => {
    expect(envelopeBadgeIsRedundant('Sent', 'sent')).toBe(true);
    expect(envelopeBadgeIsRedundant('SENT', 'Sent')).toBe(true);
  });

  it('suppresses a badge the agreement label already contains', () => {
    // "Generated · Ready" says everything "Generated" would.
    expect(envelopeBadgeIsRedundant('Generated · Ready', 'Generated')).toBe(true);
  });

  it('keeps a badge that says something different', () => {
    // Our record says signed; the envelope says the whole thing completed.
    // Two facts, and one of them may be the one you need.
    expect(envelopeBadgeIsRedundant('Signed', 'Completed')).toBe(false);
    expect(envelopeBadgeIsRedundant('Sent', 'Bounced')).toBe(false);
    expect(envelopeBadgeIsRedundant('Draft', 'Voided')).toBe(false);
  });

  it('does not suppress the more specific reading', () => {
    // The envelope carries the extra word here, so it is not redundant.
    expect(envelopeBadgeIsRedundant('Generated', 'Generated · Ready')).toBe(false);
  });

  it('treats an absent envelope status as nothing to draw', () => {
    expect(envelopeBadgeIsRedundant('Sent', null)).toBe(true);
    expect(envelopeBadgeIsRedundant('Sent', undefined)).toBe(true);
    expect(envelopeBadgeIsRedundant('Sent', '   ')).toBe(true);
  });

  it('draws the envelope badge when the agreement has no label at all', () => {
    // Nothing on the row can be repeating, so the envelope is all there is.
    expect(envelopeBadgeIsRedundant('', 'Sent')).toBe(false);
    expect(envelopeBadgeIsRedundant(null, 'Sent')).toBe(false);
  });
});
