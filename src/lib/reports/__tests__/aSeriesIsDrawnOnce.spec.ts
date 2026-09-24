/**
 * A series is drawn once, whatever each section calls its bars.
 *
 * The 23 Sep 2026 Due Diligence report for 97 Poole Road drew the Kellyville–
 * East population projection three times — the 2021 base to 2041, then the
 * four projected years as "2026 Main series", then all five again as "2026" —
 * and the de-duplicator kept all three, because it compared labels verbatim.
 * See `dedupeChartDirectives`.
 */
import { describe, expect, it } from 'vitest';
import { dedupeChartDirectives } from '../../../../supabase/functions/_shared/reports/investment/blockHygiene.pure';

const FIRST = '{{bars: 2021 estimated base 17767, 2026 Main series 17912, 2031 Main series 17958, 2036 Main series 18018, 2041 Main series 18083 | title=Kellyville–East population projection}}';
const MAIN_SERIES = '{{bars: 2026 17912, 2031 17958, 2036 18018, 2041 18083 | title=Kellyville–East population projection · Main series}}';
const OUTLOOK = '{{bars: 2021 estimated base 17767, 2026 17912, 2031 17958, 2036 18018, 2041 18083 | title=Kellyville–East population outlook}}';

describe('a series redrawn under other labels', () => {
  it('keeps the first drawing and drops the two redraws', () => {
    const doc = [FIRST, 'Demand text.', MAIN_SERIES, 'Transport text.', OUTLOOK].join('\n\n');
    const out = dedupeChartDirectives(doc);
    expect(out.removed).toBe(2);
    expect(out.markdown).toContain(FIRST);
    expect(out.markdown).not.toContain('Main series}}');
    expect(out.markdown).not.toContain('population outlook');
    expect(out.markdown).toContain('Demand text.');
    expect(out.markdown).toContain('Transport text.');
  });

  it('keeps a later chart that adds a point, because dropping it would lose that point', () => {
    const wider = '{{bars: 2016 base 17000, 2021 estimated base 17767, 2026 17912 | title=Longer}}';
    expect(dedupeChartDirectives([MAIN_SERIES, wider].join('\n\n')).removed).toBe(0);
  });

  it('keeps a chart whose values differ anywhere', () => {
    const other = '{{bars: 2026 17912, 2031 17958, 2036 18019 | title=Another area}}';
    expect(dedupeChartDirectives([FIRST, other].join('\n\n')).removed).toBe(0);
  });

  it('compares a label with no year whole, so two categories sharing a value are not merged', () => {
    const a = '{{bars: Houses 22, Units 16, Townhouses 9 | title=A}}';
    const b = '{{bars: Robbery 22, Arson 16, Fraud 9 | title=B}}';
    expect(dedupeChartDirectives([a, b].join('\n\n')).removed).toBe(0);
  });

  it('never treats two points as a series', () => {
    const two = '{{bars: 2026 17912, 2031 17958 | title=Short}}';
    expect(dedupeChartDirectives([FIRST, two].join('\n\n')).removed).toBe(0);
  });

  it('keeps a series drawn against a different maximum', () => {
    const scaled = '{{bars: 2026 17912, 2031 17958, 2036 18018 | max=20000 | title=Scaled}}';
    expect(dedupeChartDirectives([FIRST, scaled].join('\n\n')).removed).toBe(0);
  });
});
