import { describe, expect, it } from 'vitest';
import {
  CITATION_CHARS_PER_LINE,
  fitCitationRows,
} from '../../../../supabase/functions/_shared/marketIntelligenceProjection.pure';

/**
 * RS-5c.5 — the sources table is budgeted in LINES, not rows.
 *
 * The master gives the table twelve rows of one line each and positions the
 * "Further sources" callout at the height they take. Measured 14 Sep 2026 on
 * a stored report: three of the twelve URLs wrapped, and the twelfth row was
 * drawn under the callout.
 */
const short = (i: number) => `www.rba.gov.au/media-releases/2026/mr-26-${String(i).padStart(2, '0')}.html`;
const long = 'www.domain.com.au/news/september-rate-hike-fears-add-to-uncertainty-for-home-buyers-and-sellers-september-interest-rate-rise-risk-increases-after-inflation-surprise/';

describe('fitting sources to the rows the table has', () => {
  it('shows twelve one-line sources in twelve rows', () => {
    const names = Array.from({ length: 20 }, (_, i) => short(i));
    expect(fitCitationRows(names, 12, CITATION_CHARS_PER_LINE)).toHaveLength(12);
  });

  it('charges a wrapping source the lines it needs, and stops before the callout', () => {
    expect(long.length).toBeGreaterThan(CITATION_CHARS_PER_LINE);
    const names = [long, long, long, ...Array.from({ length: 12 }, (_, i) => short(i))];
    const shown = fitCitationRows(names, 12, CITATION_CHARS_PER_LINE);
    const lines = shown.reduce((n, s) => n + Math.max(1, Math.ceil(s.length / CITATION_CHARS_PER_LINE)), 0);
    expect(lines).toBeLessThanOrEqual(12);
    expect(shown.length).toBeLessThan(12);
    // Order is kept: the first sources are the ones shown.
    expect(shown.slice(0, 3)).toEqual([long, long, long]);
  });

  it('never shows nothing when the first source alone is longer than the budget', () => {
    const huge = 'x'.repeat(CITATION_CHARS_PER_LINE * 13);
    expect(fitCitationRows([huge, short(1)], 12, CITATION_CHARS_PER_LINE)).toEqual([]);
    // A source of exactly the budget still fits.
    expect(fitCitationRows(['x'.repeat(CITATION_CHARS_PER_LINE * 12)], 12, CITATION_CHARS_PER_LINE)).toHaveLength(1);
  });
});
