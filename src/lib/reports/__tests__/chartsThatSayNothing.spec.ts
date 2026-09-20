/**
 * Two ways a bar chart can be drawn correctly and say nothing.
 *
 * Both measured on the Investment Compass issued for 97 Poole Road,
 * Kellyville on 20 Sep 2026.
 *
 * **The same chart, four times, under four titles.** `Other offences 22 |
 * Robbery 16 | Arson 9` was drawn on pages 20, 23, 24 and 25, and
 * `$1,650,000 | $1,808,000 | $1,110,000` on pages 21, 29 and 31. Eight
 * drawings, two datasets. `directiveKey` normalised the WHOLE directive, so a
 * new caption was enough to make a repeat look new to the pass that exists to
 * stop exactly this.
 *
 * **More than one unit on one track.** Page 13 plotted `99.1%`, `100%` and
 * `~2.1 km` together, so the kilometres drew as a 2% sliver; page 28 plotted
 * `241` against `$163,527,942`, so the count drew as a hairline. A bar's
 * length is the only thing a bar chart says.
 */
import { describe, expect, it } from 'vitest';
import { dedupeChartDirectives, directiveKey } from '@/lib/reports/investment/blockHygiene.pure';
import { tabulateMixedUnitCharts, unitOf } from '@/lib/reports/investment/chartUnits.pure';

// The four titles that reached the client, verbatim.
const CRIME = (title: string) =>
  `{{bars: Other offences 22, Robbery 16, Arson 9 | title=${title}}}`;
const CRIME_TITLES = [
  'Recorded offence counts in the latest period (selected categories)',
  'Latest recorded counts by offence category',
  'Recorded offence counts, The Hills Shire',
  'Recorded offence counts · The Hills Shire crime data reference period',
];

describe('the data is the chart, not the caption', () => {
  it('collapses the four crime charts that reached the client', () => {
    const doc = CRIME_TITLES.map((t) => `Some prose.\n\n${CRIME(t)}\n`).join('\n');
    const out = dedupeChartDirectives(doc);
    expect(out.removed).toBe(3);
    expect((out.markdown.match(/\{\{bars:/g) ?? [])).toHaveLength(1);
    // The FIRST placement survives — a report is read forwards.
    expect(out.markdown).toContain(CRIME_TITLES[0]);
  });

  it('gives two retitled copies of one dataset one key', () => {
    expect(directiveKey(CRIME(CRIME_TITLES[0]))).toBe(directiveKey(CRIME(CRIME_TITLES[3])));
  });

  it('keeps a chart whose UNIT differs, because that changes the reading', () => {
    const a = '{{bars: Alpha 22, Beta 16 | unit=%}}';
    const b = '{{bars: Alpha 22, Beta 16 | unit=$}}';
    expect(directiveKey(a)).not.toBe(directiveKey(b));
    expect(dedupeChartDirectives(`${a}\n\n${b}`).removed).toBe(0);
  });

  it('keeps a chart whose MAXIMUM differs', () => {
    expect(directiveKey('{{bars: A 1 | max=3}}')).not.toBe(directiveKey('{{bars: A 1 | max=5}}'));
  });

  it('keeps a chart whose data differs by one digit', () => {
    expect(directiveKey(CRIME(CRIME_TITLES[0])))
      .not.toBe(directiveKey('{{bars: Other offences 23, Robbery 16, Arson 9 | title=x}}'));
  });

  it('is a no-op on a document that draws each chart once', () => {
    const doc = `${CRIME(CRIME_TITLES[0])}\n\n{{bars: A 1, B 2}}`;
    expect(dedupeChartDirectives(doc)).toEqual({ markdown: doc, removed: 0 });
  });
});

describe('the unit a printed value carries', () => {
  it.each([
    ['99.1%', 'percent'], ['100%', 'percent'],
    ['$163,527,942', 'money'], ['$1.2M', 'money'],
    ['~2.1 km', 'km'], ['450 m²', 'm²'], ['35 min', 'min'],
    ['241', 'count'], ['45k', 'count'], ['22', 'count'],
  ])('%s is %s', (display, unit) => {
    expect(unitOf(display)).toBe(unit);
  });

  it('reads a magnitude suffix as part of the number, not as a unit', () => {
    expect(unitOf('1.2M')).toBe('count');
    expect(unitOf('$1.2M')).toBe('money');
  });
});

describe('a chart of more than one unit is set as a table', () => {
  it('tabulates the accessibility snapshot from page 13', () => {
    const src = '{{bars: Walk to school 99.1%, Walk to a park 100%, Metro station ~2.1 km'
      + ' | title=Local accessibility snapshot · Kellyville - East}}';
    const out = tabulateMixedUnitCharts(src);
    expect(out.tabulated).toHaveLength(1);
    expect(out.tabulated[0].units).toEqual(['percent', 'km']);
    expect(out.markdown).not.toContain('{{bars:');
    // Every label, every value, in order.
    expect(out.markdown).toContain('| Walk to school | 99.1% |');
    expect(out.markdown).toContain('| Walk to a park | 100% |');
    expect(out.markdown).toContain('| Metro station | ~2.1 km |');
    // The title survives as a caption rather than a heading, so the document's
    // own outline and contents page are untouched.
    expect(out.markdown).toContain('**Local accessibility snapshot · Kellyville - East**');
    expect(out.markdown).not.toMatch(/^#/m);
  });

  it('tabulates the development pipeline from page 28', () => {
    const src = '{{bars: New dwellings 241, Stated development cost $163,527,942}}';
    const out = tabulateMixedUnitCharts(src);
    expect(out.tabulated[0].units).toEqual(['count', 'money']);
    expect(out.markdown).toContain('| New dwellings | 241 |');
    expect(out.markdown).toContain('| Stated development cost | $163,527,942 |');
  });

  it('leaves a single-unit chart exactly as written', () => {
    for (const src of [
      '{{bars: Other offences 22, Robbery 16, Arson 9}}',
      '{{bars: Subject $1,650,000, Postcode $1,808,000, NSW $1,110,000}}',
      '{{bars: Walk to school 99.1%, Walk to a park 100%}}',
    ]) {
      expect(tabulateMixedUnitCharts(src)).toEqual({ markdown: src, tabulated: [] });
    }
  });

  it('leaves a chart with one item alone — one bar has no axis to lie on', () => {
    const src = '{{bars: Metro station ~2.1 km}}';
    expect(tabulateMixedUnitCharts(src).markdown).toBe(src);
  });

  it('does not touch a kind whose items do not share a track', () => {
    const src = '{{donut: Land 60%, Building 40%}}\n\n{{gauge: 68 | Score}}';
    expect(tabulateMixedUnitCharts(src).markdown).toBe(src);
  });

  it('escapes a value carrying a pipe rather than breaking the table', () => {
    const out = tabulateMixedUnitCharts('{{bars: A|B 4 km, C 50%}}');
    expect(out.markdown).not.toMatch(/\|\s*A\|B\s*\|/);
  });

  it('handles an empty document', () => {
    expect(tabulateMixedUnitCharts('')).toEqual({ markdown: '', tabulated: [] });
  });
});
