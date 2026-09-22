/**
 * A chart is a measurement, or it is not drawn as one.
 *
 * Every directive below is verbatim from `investment_reports.report_content`
 * for the Investment Compass delivered for 9 Hollow Street, Golden Square on
 * 21 Sep 2026 — the twelve quantitative directives in that document, driven
 * through the real parser rather than read by eye.
 */
import { describe, expect, it } from 'vitest';
import {
  cutSentenceRow,
  enforceChartQuantity,
  isFlagSeries,
  labelIsACutSentence,
  namesARetrievalState,
  nonMeasurementUnit,
} from '../investment/chartQuantity.pure';

/* ── The five that plot nothing but flags ───────────────────────────────── */

const ZONE_CODE =
  '{{bars: General Residential Zone (GRZ) 1 | title=Planning framework context | unit=Zone code}}';

const LAYER_GRID =
  '{{heatmap: 1,0 / 1,0 | rows=Zone,Overlays | cols=Checked,Not in layer | title=Planning layer retrieval snapshot}}';

const PLANNING_INDEX =
  '{{bars: GRZ zoning verified 1, Overlays mapped 0, Overlays checked list 1 | title=Planning controls evidence snapshot | unit=index}}';

const TRANSPORT_INDEX =
  '{{bars: Nearest stop Central Deborah Gold Mine 1, Rail/Bus network coverage unmeasured 0, Car reliance assessment 1 | title=Transport evidence snapshot | unit=index}}';

/** Three items, every one of them 1 — three identical full-length bars. */
const ALL_ONES =
  '{{bars: Zone GRZ (General Residential Zone) 1, Overlays checked & none mapped at coordinate 1, Land use table & certificate not yet read 1 | title=Planning evidence snapshot | unit=index}}';

/** No number anywhere in it, so the parser reads no series at all. */
const DESCRIPTOR =
  '{{bars: Central Deborah Gold Mine stop "Nearest recorded public transport access point" | title=Local movement anchor | unit=Descriptor}}';

const FLAGS = [ZONE_CODE, LAYER_GRID, PLANNING_INDEX, TRANSPORT_INDEX, ALL_ONES, DESCRIPTOR];

/* ── The two whose values were cut out of a sentence ────────────────────── */

const AMENITY =
  '{{bars: Healthcare 10 within 5 km, Shopping centres 10 within 5 km, Parks & recreation 9 within 5 km, Restaurants & cafés 10 within 5 km | title=Local amenity counts within 5 km | unit=facilities}}';

const CLIMATE =
  '{{bars: Annual rainfall vs local normal 683.1mm vs 511.3mm, Mean max temperature vs normal 21.5C vs 20.7C | title=Recent climate vs long-run normal | unit=mm/C}}';

/* ── The four that measure something ────────────────────────────────────── */

const PRICE =
  '{{bars: Subject house $387,500, Golden Square house median $567,500 | title=Subject price versus local house median (Golden Square, 2025) | unit=$}}';

const PRICE_REVERSED =
  '{{bars: Golden Square house median $567,500, Subject price $387,500 | title=Recorded price vs suburb median | unit=$}}';

const GROWTH =
  '{{heatmap: 8.6,5.6 / 1.5,1.9 / 8.5,3.8 | rows=1-year,3-year,5-year | cols=Golden Square,Victoria | title=House price growth}}';

const GROWTH_WIDE =
  '{{heatmap: 8.6,1.5,8.5,6.4 / 5.6,1.9,3.8,0 | rows=Golden Square houses,Victoria all dwellings | cols=1y growth,3y CAGR,5y CAGR,10y CAGR | title=Recorded price growth vs state benchmark}}';

const MEASURED = [PRICE, PRICE_REVERSED, GROWTH, GROWTH_WIDE];

describe('a flag set is not a quantity', () => {
  it.each(FLAGS)('withholds %#', (d) => {
    const r = enforceChartQuantity(d);
    expect(r.withheld).toHaveLength(1);
    expect(r.markdown.trim()).toBe('');
  });

  it('names why, so a render can be audited', () => {
    expect(enforceChartQuantity(PLANNING_INDEX).withheld[0].reason).toBe('non_unit');
    expect(enforceChartQuantity(ZONE_CODE).withheld[0].reason).toBe('non_unit');
    // The grid declares no unit at all; its axis is what confesses.
    expect(enforceChartQuantity(LAYER_GRID).withheld[0].reason).toBe('retrieval_state');
  });

  it('words nothing in its place', () => {
    // `withholdRatedAbsenceCharts`' rule: an absence is omitted, never
    // explained. A withheld drawing leaves no caption and no placeholder.
    const doc = `### Planning\n\nThe zone is GRZ.\n\n${PLANNING_INDEX}\n\nOverlays were checked.`;
    const out = enforceChartQuantity(doc).markdown;
    expect(out).toBe('### Planning\n\nThe zone is GRZ.\n\nOverlays were checked.');
  });

  it('reads the two halves of the confession separately', () => {
    expect(nonMeasurementUnit('index')).toBe(true);
    expect(nonMeasurementUnit('Zone code')).toBe(true);
    expect(nonMeasurementUnit('Descriptor')).toBe(true);
    expect(nonMeasurementUnit('facilities')).toBe(false);
    expect(nonMeasurementUnit('$')).toBe(false);
    expect(nonMeasurementUnit('mm/C')).toBe(false);
    expect(nonMeasurementUnit(undefined)).toBe(false);

    expect(namesARetrievalState(['Zone', 'Overlays', 'Checked', 'Not in layer'])).toBe(true);
    expect(namesARetrievalState(['1-year', '3-year', 'Golden Square', 'Victoria'])).toBe(false);

    expect(isFlagSeries([1, 0, 1])).toBe(true);
    expect(isFlagSeries([1, 1, 1])).toBe(true);
    expect(isFlagSeries([])).toBe(true);
    expect(isFlagSeries([8.6, 5.6])).toBe(false);
    expect(isFlagSeries([3.8, 0])).toBe(false);
  });

  it('needs BOTH halves — a real count that reads 1 and 0 is drawn', () => {
    const real = '{{bars: Hospitals 1, Universities 0 | title=Institutions within 5 km | unit=facilities}}';
    expect(enforceChartQuantity(real).markdown).toBe(real);
    expect(enforceChartQuantity(real).withheld).toEqual([]);
  });
});

describe('a value cut out of a sentence is not this item’s value', () => {
  it('sets the amenity chart as the reading the drawing destroyed', () => {
    /*
     * The parser takes the last number, so every one of these four items
     * plotted `5` — the RADIUS — and the page drew four identical bars under
     * a title promising amenity counts, on a record whose enrichment measured
     * 10, 10, 9 and 10.
     */
    const r = enforceChartQuantity(AMENITY);
    expect(r.tabulated).toHaveLength(1);
    expect(r.tabulated[0].cut).toHaveLength(4);
    expect(r.markdown).toContain('| Healthcare | 10 within 5 km |');
    expect(r.markdown).toContain('| Parks & recreation | 9 within 5 km |');
    // Every count the drawing threw away is on the page.
    for (const n of ['10', '9']) expect(r.markdown).toContain(n);
    expect(r.markdown).not.toContain('{{');
  });

  it('keeps the climate reading the title is about', () => {
    // It plotted 511.3 and 20.7 — the long-run NORMALS — and discarded the
    // 683.1 mm and 21.5 C the chart exists to compare them against.
    const r = enforceChartQuantity(CLIMATE);
    expect(r.markdown).toContain('| Annual rainfall vs local normal | 683.1mm vs 511.3mm |');
    expect(r.markdown).toContain('| Mean max temperature vs normal | 21.5C vs 20.7C |');
  });

  it('keeps the title as a bold line, never a heading', () => {
    // A heading would enter the document's outline and change its contents
    // page; this is a presentation repair, not a restructuring.
    expect(enforceChartQuantity(AMENITY).markdown)
      .toContain('**Local amenity counts within 5 km**');
    expect(enforceChartQuantity(AMENITY).markdown).not.toMatch(/^#/m);
  });

  it('needs the connective AND the lost figure', () => {
    expect(labelIsACutSentence('Healthcare 10 within')).toBe(true);
    expect(labelIsACutSentence('Annual rainfall vs local normal 683.1mm vs')).toBe(true);
    // A label that merely ends in a connective lost no figure.
    expect(labelIsACutSentence('Growth to')).toBe(false);
    // …and an ordinary label carrying a number is an ordinary label.
    expect(labelIsACutSentence('3-bedroom houses')).toBe(false);
    expect(labelIsACutSentence('Minimum lot size 450 m²')).toBe(false);
    expect(labelIsACutSentence('Subject house')).toBe(false);
  });

  it('moves the model’s own characters and composes none', () => {
    expect(cutSentenceRow({ label: 'Healthcare 10 within', value: 5, display: '5 km' }))
      .toEqual({ label: 'Healthcare', display: '10 within 5 km' });
    // Nothing before the first number: the phrase stays whole rather than
    // being rearranged into a row that reads backwards.
    expect(cutSentenceRow({ label: '450 m² minimum', value: 450, display: '450' }).label)
      .toContain('450 m² minimum');
  });

  it('does not take a chart whose labels are labels', () => {
    const bedrooms = '{{bars: 3-bedroom houses 620000, 4-bedroom houses 780000 | unit=$}}';
    expect(enforceChartQuantity(bedrooms).markdown).toBe(bedrooms);
  });
});

describe('what it must not touch', () => {
  it.each(MEASURED)('leaves a chart that measures something alone: %#', (d) => {
    expect(enforceChartQuantity(d).markdown).toBe(d);
  });

  it('is byte-identical on a document whose charts all measure something', () => {
    const doc = `# Report\n\nProse.\n\n${PRICE}\n\nMore prose.\n\n${GROWTH}\n\nClosing.`;
    expect(enforceChartQuantity(doc).markdown).toBe(doc);
    expect(enforceChartQuantity(doc).withheld).toEqual([]);
    expect(enforceChartQuantity(doc).tabulated).toEqual([]);
  });

  it('leaves a fence, a table and a template binding alone', () => {
    const doc = '::: stat label="Median" unit="$"\n\n567500\n\n:::\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nRent is {{financials.weeklyRent}}.';
    expect(enforceChartQuantity(doc).markdown).toBe(doc);
  });

  it('is idempotent', () => {
    const doc = `${AMENITY}\n\n${PLANNING_INDEX}\n\n${PRICE}`;
    const once = enforceChartQuantity(doc).markdown;
    expect(enforceChartQuantity(once).markdown).toBe(once);
  });
});

describe('the whole document, as delivered', () => {
  const ALL = [...MEASURED, ...FLAGS, AMENITY, CLIMATE];

  it('withholds six, tabulates two and draws four', () => {
    const r = enforceChartQuantity(ALL.join('\n\n'));
    expect(r.withheld).toHaveLength(6);
    expect(r.tabulated).toHaveLength(2);
    // Every chart that measures something survives to be drawn.
    for (const d of MEASURED) expect(r.markdown).toContain(d);
  });

  it('leaves no hole where a drawing stood', () => {
    const r = enforceChartQuantity(`Before.\n\n${PLANNING_INDEX}\n\nAfter.`);
    expect(r.markdown).toBe('Before.\n\nAfter.');
  });
});

describe('the read path carries it', () => {
  it('presentStoredMarkdown withholds the flags and tabulates the cut', async () => {
    const { presentStoredMarkdown } = await import('../investment/derivedHygiene.pure');
    const doc = `## Planning\n\n${PLANNING_INDEX}\n\n## Amenity\n\n${AMENITY}\n\n## Market\n\n${PRICE}`;
    const out = presentStoredMarkdown(doc);
    expect(out).not.toContain('unit=index');
    expect(out).toContain('| Healthcare | 10 within 5 km |');
    expect(out).toContain('{{bars: Subject house $387,500');
  });
});

describe('a sparkline is the same defect at the smallest size drawn', () => {
  /** Page 17 of the same document, verbatim. */
  const SPARK = '{{margin: Overlay check basis | spark=1,0}}';

  /** …and the form it was actually written in, with its note. */
  const SPARK_WITH_NOTE = '{{margin: Overlay check basis | note=Vicmap Planning overlays were asked '
    + 'and answered with no mapped control at this coordinate. | spark=1,0}}';

  it('withholds a two-point line drawn between two states', () => {
    const r = enforceChartQuantity(SPARK);
    expect(r.withheld).toHaveLength(1);
    expect(r.withheld[0].reason).toBe('retrieval_state');
    expect(r.markdown.trim()).toBe('');
  });

  it('takes the LINE and keeps the note, which exists nowhere else', () => {
    /*
     * That sparkline ran down a fifth of page 17. The line is the defect; the
     * note is a sourced retrieval finding, and deleting it to remove a
     * decoration would take a fact off the page. A bars or heatmap directive
     * carries no prose of its own, so those go whole.
     */
    const r = enforceChartQuantity(SPARK_WITH_NOTE);
    expect(r.withheld).toHaveLength(1);
    expect(r.markdown).not.toContain('spark=');
    expect(r.markdown).toContain('Overlay check basis');
    expect(r.markdown).toContain('Vicmap Planning overlays were asked and answered with no mapped control');
    // …and what is left is still a directive the renderer draws.
    expect(r.markdown.startsWith('{{margin:')).toBe(true);
    expect(r.markdown.endsWith('}}')).toBe(true);
  });

  it('leaves a marginal note that carries no sparkline alone', () => {
    // A `{{margin:}}` with nothing to plot draws no line, so there is no
    // false drawing to withhold — only a note, which is prose.
    const note = '{{margin: Method | note=Figures are the publisher’s own}}';
    expect(enforceChartQuantity(note).markdown).toBe(note);
  });

  it('leaves a sparkline that measures something alone', () => {
    const real = '{{margin: Median trend | spark=520,535,548,567}}';
    expect(enforceChartQuantity(real).markdown).toBe(real);
  });
});
