/**
 * The chart vocabulary, parsed — against the strings production actually holds.
 *
 * Every fixture below is a verbatim directive lifted from
 * `investment_reports.report_content` in the live database, not an invention.
 * That matters more here than anywhere else in this programme: the whole
 * defect being fixed is that a renderer was tuned to a fixture nobody's
 * generator produces, and 2,601 real directives printed as literal prose in
 * client documents while every test passed.
 */
import { describe, expect, it } from 'vitest';
import {
  VIZ_DIRECTIVE_KINDS,
  directiveOnlyBlock,
  parseVizDirective,
  parseVizDirectives,
  splitTileLabelValue,
  type VizDirective,
} from '../vizDirectives.pure';

/** Verbatim from production. */
const REAL: Record<string, string> = {
  bars: '{{bars: Local town centre access 82, Regional highway connectivity 88, Active transport (walk/cycle) options 60 | title=Connectivity pillars · 16 Queen Street area | max=100 | unit=%}}',
  donut: '{{donut: Detached houses 82, Semi/terrace 8, Units 10 | title=Cooloola Cove dwelling mix | center=82% | centerSub=Detached houses}}',
  gauge: '{{gauge: 72 | Income Stability Score | Service-based roles with regional diversification}}',
  glance: '{{glance: ✓ Strong regional rental demand | ◆ Established 3‑bed House | ⚠ Resources‑linked economy | ★ Suitability: Proceed with caution}}',
  heatmap: '{{heatmap: 7.8,8.2,7.5 / 6.9,7.4,7.0 / 6.2,6.8,6.5 | rows=2019-21,2022-24,2025-27 est. | cols=Central established,Fringe new,Outlying rural | title=Relative demand & absorption strength (0–10 scale)}}',
  margin: '{{margin: Western corridor growth | spark=100,108,115,123,130 | note=Indicative population index for Melbourne’s west over the past decade. | label=Macro demand}}',
  pictograph: '{{pictograph: 7/10 | label=Strategic investors | sub=Most suited to long-term, plan-first investors | icon=person | cols=10}}',
  quadrant: '{{quadrant: 10.2,4 "This property (yield 10.2%)"*, 4.5,4 "NSW median house", 4.2,4 "National median house" | xlabel=Gross yield % | ylabel=Capital growth % | xmax=12 | ymax=8 | q1=High yield & growth | title=Positioning vs broader market}}',
  tiles: '{{tiles: Cooloola Cove Calm & space sub="Quiet cul‑de‑sacs, family yards" int=0.75, Tin Can Bay Coastal leisure sub="Foreshore, boating, cafes" int=0.80 | title=Lifestyle mix across nearby coastal towns | cols=3}}',
  timeline: '{{timeline: Existing "Bruce Highway access via Gympie", 0-2y "Ongoing safety & capacity upgrades", 3-5y "Progressive regional road improvements" | title=Regional road & access pipeline}}',
  waterfall: '{{waterfall: Gross rent +$50,000, Non‑mortgage outgoings -$13,101, Cash available for loan +$36,899 | title=Year‑1 rental cash available for debt service}}',
  wheel: '{{wheel: 80,72,60,55,68 | labels=Tenant fit,Amenity access,Perception,Environmental risk,Future flexibility | max=100 | title=Locality strengths vs watch‑points}}',
};

const parseOne = (raw: string): VizDirective | null => parseVizDirectives(raw)[0] ?? null;

describe('every kind the corpus contains parses', () => {
  it('covers all twelve, with no kind left unhandled', () => {
    expect(Object.keys(REAL).sort()).toEqual([...VIZ_DIRECTIVE_KINDS].sort());
  });

  for (const [kind, raw] of Object.entries(REAL)) {
    it(`parses a real ${kind}`, () => {
      const parsed = parseOne(raw);
      expect(parsed, `${kind} did not parse`).not.toBeNull();
      expect(parsed!.kind).toBe(kind);
    });
  }
});

describe('the details a naive split gets wrong', () => {
  it('keeps a tile whole when its sub= contains a comma', () => {
    // `sub="Quiet cul-de-sacs, family yards"` — splitting on every comma makes
    // `family yards" int=0.75` a tile of its own.
    const d = parseOne(REAL.tiles) as Extract<VizDirective, { kind: 'tiles' }>;
    expect(d.tiles).toHaveLength(2);
    expect(d.tiles[0].label).toBe('Cooloola Cove');
    expect(d.tiles[0].value).toBe('Calm & space');
    expect(d.tiles[0].sub).toBe('Quiet cul‑de‑sacs, family yards');
    expect(d.tiles[0].intensity).toBeCloseTo(0.75);
    expect(d.tiles[1].sub).toBe('Foreshore, boating, cafes');
  });

  describe('a tile carries two lines written as one run', () => {
    // Every string here is verbatim from `investment_reports`.
    const cases: ReadonlyArray<[string, string, string]> = [
      ['Cooloola Cove "Family coastal"', 'Cooloola Cove', 'Family coastal'],
      ['Schools 4', 'Schools', '4'],
      ['Lara 78', 'Lara', '78'],
      ['Early learning family support 1.0', 'Early learning family support', '1.0'],
      ['Hawthorn $1.42M', 'Hawthorn', '$1.42M'],
      ['Economic & Mining Cycle Moderate–High', 'Economic & Mining Cycle', 'Moderate–High'],
      ['Tenant Profile & Demand Moderate', 'Tenant Profile & Demand', 'Moderate'],
      ['Environmental & insurance Moderate', 'Environmental & insurance', 'Moderate'],
      ['Crime & safety Low–Moderate', 'Crime & safety', 'Low–Moderate'],
      ['Cooloola Cove Calm & space', 'Cooloola Cove', 'Calm & space'],
      ['Tin Can Bay Coastal leisure', 'Tin Can Bay', 'Coastal leisure'],
      ['Tin Can Bay GP & clinic access', 'Tin Can Bay', 'GP & clinic access'],
    ];
    for (const [raw, label, value] of cases) {
      it(`splits ${JSON.stringify(raw)}`, () => {
        expect(splitTileLabelValue(raw)).toEqual({ label, value });
      });
    }

    it('leaves the value empty rather than guessing when nothing is capitalised', () => {
      // No signal at all. A wrong break would set an arbitrary word in the
      // largest type on the page; an absent one just omits a line.
      expect(splitTileLabelValue('quiet leafy streets')).toEqual({
        label: 'quiet leafy streets', value: '',
      });
    });
  });

  it('reads gauge label and caption positionally, since neither carries an =', () => {
    const d = parseOne(REAL.gauge) as Extract<VizDirective, { kind: 'gauge' }>;
    expect(d.value).toBe(72);
    expect(d.max).toBe(100);
    expect(d.label).toBe('Income Stability Score');
    expect(d.caption).toBe('Service-based roles with regional diversification');
  });

  it('reads a gauge written as a fraction', () => {
    const d = parseOne('{{gauge: 7/10 | Socio-economic decile | Higher = more advantaged}}') as Extract<VizDirective, { kind: 'gauge' }>;
    expect(d.value).toBe(7);
    expect(d.max).toBe(10);
    // The caption itself contains `=`; it must stay positional, not become an option.
    expect(d.caption).toBe('Higher = more advantaged');
  });

  it('treats every glance segment as an item, symbol and all', () => {
    const d = parseOne(REAL.glance) as Extract<VizDirective, { kind: 'glance' }>;
    expect(d.items).toHaveLength(4);
    expect(d.items[0]).toEqual({ symbol: '✓', text: 'Strong regional rental demand' });
    expect(d.items[3].symbol).toBe('★');
  });

  it('keeps a quadrant label containing a comma-free quoted phrase and its highlight', () => {
    const d = parseOne(REAL.quadrant) as Extract<VizDirective, { kind: 'quadrant' }>;
    expect(d.points).toHaveLength(3);
    expect(d.points[0]).toMatchObject({ x: 10.2, y: 4, label: 'This property (yield 10.2%)', highlight: true });
    expect(d.points[1].highlight).toBe(false);
    expect(d.xMax).toBe(12);
  });

  it('reads bars whose label contains parentheses and a slash', () => {
    const d = parseOne(REAL.bars) as Extract<VizDirective, { kind: 'bars' }>;
    expect(d.items).toHaveLength(3);
    expect(d.items[2]).toMatchObject({ label: 'Active transport (walk/cycle) options', value: 60 });
    expect(d.unit).toBe('%');
  });

  it('scales a waterfall value written with a currency symbol and separators', () => {
    const d = parseOne(REAL.waterfall) as Extract<VizDirective, { kind: 'waterfall' }>;
    expect(d.items.map((i) => i.value)).toEqual([50000, -13101, 36899]);
  });

  it('reads an approximate figure, which is how travel times are written', () => {
    // Verbatim. Without the `~` this whole chart refuses and the page loses the
    // comparison it was making.
    const d = parseOne('{{bars: Tin Can Bay ~15 min, Rainbow Beach ~35 min, Gympie ~45 min | title=Drive times}}') as Extract<VizDirective, { kind: 'bars' }>;
    expect(d.items.map((i) => [i.label, i.value])).toEqual([
      ['Tin Can Bay', 15], ['Rainbow Beach', 35], ['Gympie', 45],
    ]);
  });

  it('refuses a range rather than picking an end of it', () => {
    // `Drive to Melton Station 8–12 min` — 8 is not the figure and 10 is not in
    // the source. Real string; it stays prose-free and undrawn.
    expect(parseOne('{{bars: Drive to Melton Station 8–12 min}}')).toBeNull();
  });

  it('keeps a thousands separator inside a bar value', () => {
    const d = parseOne('{{bars: Median house $1,240,000, Median unit $610,000 | title=Medians}}') as Extract<VizDirective, { kind: 'bars' }>;
    expect(d.items.map((i) => i.value)).toEqual([1240000, 610000]);
  });

  it('splits a heatmap grid on / and its labels on ,', () => {
    const d = parseOne(REAL.heatmap) as Extract<VizDirective, { kind: 'heatmap' }>;
    expect(d.grid).toHaveLength(3);
    expect(d.grid[0]).toEqual([7.8, 8.2, 7.5]);
    expect(d.rowLabels).toEqual(['2019-21', '2022-24', '2025-27 est.']);
  });

  it('reads timeline phases with their quoted labels', () => {
    const d = parseOne(REAL.timeline) as Extract<VizDirective, { kind: 'timeline' }>;
    expect(d.items).toHaveLength(3);
    expect(d.items[0]).toEqual({ phase: 'Existing', label: 'Bruce Highway access via Gympie' });
    expect(d.items[2].phase).toBe('3-5y');
  });
});

describe('what it refuses, silently', () => {
  it('drops an unknown kind rather than printing it', () => {
    expect(parseVizDirective('sunburst', 'a 1, b 2')).toBeNull();
  });

  it('drops a rhetorical waterfall whose values are words', () => {
    // Real: `{{waterfall: Offer accepted +Contract, … Settlement =Risk-managed}}`.
    // There is nothing to plot; a chart primitive would draw a lie.
    expect(parseOne('{{waterfall: Offer accepted +Contract, Settlement =Risk‑managed acquisition}}')).toBeNull();
  });

  it('drops a wheel with fewer than three spokes', () => {
    expect(parseOne('{{wheel: 60,70 | labels=A,B}}')).toBeNull();
  });

  it('drops a ragged heatmap', () => {
    expect(parseOne('{{heatmap: 1,2,3 / 4,5}}')).toBeNull();
  });

  it('drops an oversized payload rather than parsing it', () => {
    expect(parseVizDirective('bars', `x 1,${'y 2,'.repeat(1000)}`)).toBeNull();
  });

  it('never spans lines, so an unclosed brace cannot swallow a chapter', () => {
    const runaway = '{{bars: A 1\n\nA whole paragraph that follows.\n\nAnd another.';
    expect(parseVizDirectives(runaway)).toEqual([]);
  });
});

describe('deciding what is a figure and what is prose', () => {
  it('recognises a block that is nothing but directives', () => {
    expect(directiveOnlyBlock(REAL.bars)).toBe(true);
    expect(directiveOnlyBlock(`${REAL.bars}\n${REAL.gauge}`)).toBe(true);
  });

  it('leaves a directive embedded mid-sentence as prose', () => {
    // Replacing inline would strand the clause around it.
    expect(directiveOnlyBlock(`The score is ${REAL.gauge} which is solid.`)).toBe(false);
  });

  it('is false for ordinary prose', () => {
    expect(directiveOnlyBlock('A paragraph with no directive at all.')).toBe(false);
  });

  it('reads several directives out of one block, in order', () => {
    const all = parseVizDirectives(`${REAL.gauge}\n${REAL.bars}\n${REAL.wheel}`);
    expect(all.map((d) => d.kind)).toEqual(['gauge', 'bars', 'wheel']);
  });
});
