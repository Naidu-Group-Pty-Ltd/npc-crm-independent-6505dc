/**
 * Text cut to fit says it was cut, and is cut between words (Audit 8).
 *
 * Three formats cap text a person reads. The Cash Flow Comparison cut its
 * model prose with a bare `.slice`, so a strength or a weakness could end on a
 * client's page part-way through a word with nothing to say it had been cut.
 */
import { describe, expect, it } from 'vitest';

import { truncateAtWord } from '../../../../supabase/functions/_shared/reports/text.pure';

describe('truncateAtWord', () => {
  it('leaves text within the limit exactly as it was, trimmed', () => {
    expect(truncateAtWord('  Rent compounds.  ', 40)).toBe('Rent compounds.');
    expect(truncateAtWord('Exactly ten', 11)).toBe('Exactly ten');
  });

  it('cuts at a word and closes with an ellipsis', () => {
    const out = truncateAtWord('Strong rental demand from the nearby hospital precinct', 30);
    expect(out).toBe('Strong rental demand from the\u2026');
    expect(out.length).toBeLessThanOrEqual(31);
  });

  it('never ends on half a word', () => {
    const out = truncateAtWord('Interest only for five years, then principal and interest', 33);
    expect(out.endsWith('\u2026')).toBe(true);
    const words = out.slice(0, -1).split(/\s+/);
    for (const w of words) {
      expect('Interest only for five years, then principal and interest').toContain(w);
    }
    expect(out).not.toMatch(/\bprinci\u2026$/);
  });

  it('reads nothing as nothing', () => {
    expect(truncateAtWord('', 10)).toBe('');
    expect(truncateAtWord(undefined as unknown as string, 10)).toBe('');
  });
});
