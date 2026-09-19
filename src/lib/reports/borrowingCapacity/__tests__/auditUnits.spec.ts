/**
 * An audit value is not always dollars, and two surfaces said it was.
 *
 * `measure.pure.ts`'s own header names this defect: *"The shipping Snapshot puts
 * every value through one currency formatter, so the audit trail tells a client
 * their assessment rate went from $6 to $9 when it went from 6.15% to 8.65%."*
 * The unit table has been right since it was written (`audit.pure.ts` declares
 * `policy/override_applied` as `percent` on both sides), and the WeasyPrint
 * renderer has honoured it since it was migrated. The **legacy jsPDF generator**
 * and the **web audit panel** did not — both formatted every value as AUD.
 *
 * These tests are on the shared functions those two surfaces now call, so they
 * fail if the unit table and the formatter ever stop agreeing. They are
 * deliberately written as the two shapes that were printed wrongly on a real
 * page, rather than as a sweep of the table.
 */
import { describe, expect, it } from 'vitest';

import { auditDelta, auditMeasures, auditUnits } from '../audit.pure';
import { formatMeasure } from '@/lib/reportDesign/measure.pure';

const entry = (over: Record<string, unknown> = {}) => ({
  seq: 1,
  category: 'policy',
  action: 'override_applied',
  label: 'Interest Rate Override',
  rawValue: 6.5,
  assessedValue: 6.24,
  rule: 'Manual override',
  impact: 'decrease',
  delta: -0.26,
  ...over,
}) as never;

describe('a rate override is a rate', () => {
  it('is declared percent on both sides', () => {
    expect(auditUnits('policy', 'override_applied')).toEqual({ raw: 'percent', assessed: 'percent' });
  });

  it('prints as a percentage, not as dollars', () => {
    const { raw, assessed } = auditMeasures(entry());
    // The legacy generator's currency formatter rounded these to `$7` and `$6`.
    expect(formatMeasure(raw)).toContain('%');
    expect(formatMeasure(assessed)).toContain('%');
    expect(formatMeasure(raw)).not.toContain('$');
  });

  it('prints a fractional movement rather than rounding it to nothing', () => {
    // `-0.26` through a zero-decimal currency formatter is `-$0` — a number
    // that says a change happened and that it was nothing.
    const delta = auditDelta(entry());
    expect(delta).not.toBeNull();
    expect(formatMeasure(delta!)).not.toMatch(/^-?\$0$/);
    expect(formatMeasure(delta!)).toContain('%');
  });
});

describe('a liability row carries two different units', () => {
  const card = entry({
    category: 'liability',
    action: 'credit_card_limit_rate',
    label: 'Credit Card',
    rawValue: 10_000,
    assessedValue: 380,
    delta: -9_620,
  });

  it('reads the balance as a balance and the servicing as monthly', () => {
    expect(auditUnits('liability', 'credit_card_limit_rate'))
      .toEqual({ raw: 'aud', assessed: 'aud/month' });
    expect(formatMeasure(auditMeasures(card).assessed)).toContain('/mo');
  });

  it('refuses a delta, because subtracting the two is not a number', () => {
    // The stored `delta` on this row is -9,620, which is a balance minus a
    // monthly repayment. Printing it is worse than printing nothing.
    expect(auditDelta(card)).toBeNull();
  });
});

describe('an unknown action degrades rather than guessing', () => {
  it('renders as an em dash instead of inventing a unit', () => {
    const unknown = entry({ category: 'policy', action: 'something_new' });
    expect(formatMeasure(auditMeasures(unknown).raw)).toBe('—');
    expect(auditDelta(unknown)).toBeNull();
  });
});
