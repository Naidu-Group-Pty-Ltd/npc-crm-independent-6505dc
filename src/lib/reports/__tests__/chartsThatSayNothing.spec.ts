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
import {
  itemUnit,
  labelStatedUnit,
  tabulateMixedUnitCharts,
  tabulatedRow,
  unitOf,
} from '@/lib/reports/investment/chartUnits.pure';

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

/**
 * …and the unit the model put in the LABEL.
 *
 * Page 22 of the 1 Crestview Avenue Compass (20 Sep 2026), read off the
 * delivered PDF's own geometry — three labels right-aligned at x=210, three
 * values right-aligned at x=486, which is `renderBars`' layout and not a
 * table:
 *
 *     R3 Medium Density Residential zone       1
 *     Minimum lot size 450 m²                450
 *     Maximum building height 10 m            10
 *
 * A zone code, a land area and a height on one axis with a maximum of 450: the
 * height drew as a 2% sliver and the zone as a hairline. This module exists
 * for exactly that and walked past it, because `unitOf` reads the display and
 * all three displays were bare integers.
 */
const CRESTVIEW = '{{bars: R3 Medium Density Residential zone 1, '
  + 'Minimum lot size 450 m² 450, Maximum building height 10 m 10 '
  + '| title=Key planning controls · The Hills LEP 2019}}';

describe('a unit stated in the label', () => {
  it('is read only when the label restates the item\'s own value', () => {
    expect(labelStatedUnit('Minimum lot size 450 m²', 450)).toBe('m²');
    expect(labelStatedUnit('Maximum building height 10 m', 10)).toBe('m');
    // …and not when the trailing number is some other number. `Growth 5 yr`
    // beside a value of 6.2 states a PERIOD, not this value's unit.
    expect(labelStatedUnit('Growth 5 yr', 6.2)).toBeNull();
    // …nor when the label states no value at all.
    expect(labelStatedUnit('Schools', 8)).toBeNull();
    expect(labelStatedUnit('Subject house', 700)).toBeNull();
    // …nor when there is a number but no unit beside it.
    expect(labelStatedUnit('Bedrooms 3', 3)).toBeNull();
  });

  it('reads a lone lowercase m as metres and keeps k/M/b as magnitudes', () => {
    /*
     * `unitOf`'s magnitude guard is about a DISPLAY (`$1.2M`, `45k`). Here the
     * number has been proved equal to the item's value, which settles it: a
     * `10 m` beside a value of 10 cannot be ten million, or the value would be
     * 10,000,000.
     */
    expect(labelStatedUnit('Height 10 m', 10)).toBe('m');
    expect(labelStatedUnit('Revenue 1.2 M', 1.2)).toBeNull();
    expect(labelStatedUnit('Sales 45 k', 45)).toBeNull();
  });

  it('never outranks a unit the display already carries', () => {
    expect(itemUnit({ label: 'Growth 5 yr', value: 6.2, display: '6.2%' })).toBe('percent');
    expect(itemUnit({ label: 'Metro 2.1 km', value: 2.1, display: '2.1 km' })).toBe('km');
    expect(itemUnit({ label: 'Schools', value: 8, display: '8' })).toBe('count');
  });

  it('tabulates the Crestview planning chart, which the old rule drew', () => {
    const out = tabulateMixedUnitCharts(CRESTVIEW);
    expect(out.tabulated).toHaveLength(1);
    expect(out.tabulated[0].units).toEqual(['count', 'm²', 'm']);
    expect(out.markdown).not.toContain('{{bars');
  });

  it('moves the unit into the value cell, where a reader looks for it', () => {
    /*
     * Nothing is composed: both halves are the model's own characters, moved.
     * The alternative is a label that says 450 beside a cell that says it
     * again with its unit stripped off.
     */
    expect(tabulatedRow({ label: 'Minimum lot size 450 m²', value: 450, display: '450' }))
      .toEqual({ label: 'Minimum lot size', display: '450 m²' });
    expect(tabulatedRow({ label: 'Maximum building height 10 m', value: 10, display: '10' }))
      .toEqual({ label: 'Maximum building height', display: '10 m' });
    // A label that states no value keeps every character it had.
    expect(tabulatedRow({ label: 'R3 Medium Density Residential zone', value: 1, display: '1' }))
      .toEqual({ label: 'R3 Medium Density Residential zone', display: '1' });

    const rows = tabulateMixedUnitCharts(CRESTVIEW).markdown;
    expect(rows).toContain('| Minimum lot size | 450 m² |');
    expect(rows).toContain('| Maximum building height | 10 m |');
  });

  it('leaves every other chart in the three delivered documents alone', () => {
    // Read off the same three PDFs: the only other bar charts are a growth
    // comparison in one unit and two amenity counts in none.
    for (const src of [
      '{{bars: Postcode 2155 · 1-yr 6.3%, NSW houses · 1-yr 11.0%, '
        + 'Postcode 2155 · 5-yr 6.2%, NSW houses · 5-yr 7.6% | title=House price growth}}',
      '{{bars: Growth 1 yr 6.3, Growth 3 yr 4.4, Growth 5 yr 6.2 | title=CAGR}}',
      '{{bars: Schools 8, Transport 4 | title=Amenity}}',
      '{{bars: Bedrooms 3 3, Bathrooms 2 2 | title=Configuration}}',
    ]) {
      expect(tabulateMixedUnitCharts(src), src).toEqual({ markdown: src, tabulated: [] });
    }
  });
});
