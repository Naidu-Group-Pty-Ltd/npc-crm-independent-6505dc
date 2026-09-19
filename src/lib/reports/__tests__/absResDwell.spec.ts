/**
 * The ABS state series parser, against lines taken verbatim from the
 * production download (pg_net 245217, 16 Sep 2026) and a synthetic body
 * of the same shape.
 */
import { describe, expect, it } from 'vitest';

import {
  ABS_MEAN_PRICE_MEASURE,
  ABS_PLAUSIBILITY,
  ABS_REGION_CODES,
  ABS_RES_DWELL_URL,
  parseAbsResDwell,
  parseCsvLine,
  parseSdmxCsv,
  quarterPeriod,
} from '@/lib/reports/market/openData/absResDwell.pure';

const HEADER = 'STRUCTURE,STRUCTURE_ID,STRUCTURE_NAME,ACTION,MEASURE,Measure,REGION,Region,FREQ,Frequency,TIME_PERIOD,Time Period,OBS_VALUE,Observation Value,UNIT_MEASURE,Unit of Measure,UNIT_MULT,Unit of Multiplier,OBS_STATUS,Observation Status,OBS_COMMENT,Observation Comment';
const NAME = '"Residential Dwellings: Values, Mean Price and Number by State and Territories"';

/** A real line, as the ABS wrote it. */
const REAL_NSW_2011 = `DATAFLOW,ABS:RES_DWELL_ST(1.0.0),${NAME},I,5,Mean price of residential dwellings,1,New South Wales,Q,Quarterly,2011-Q3,,540.8,,AUD,Australian Dollars,3,Thousands,,,,`;
const REAL_NSW_2026 = `DATAFLOW,ABS:RES_DWELL_ST(1.0.0),${NAME},I,5,Mean price of residential dwellings,1,New South Wales,Q,Quarterly,2026-Q2,,1304.9,,AUD,Australian Dollars,3,Thousands,p,preliminary figure or series subject to revision,,`;
const REAL_STOCK = `DATAFLOW,ABS:RES_DWELL_ST(1.0.0),${NAME},I,2,Value of dwelling stock: Owned by households,4,South Australia,Q,Quarterly,2011-Q3,,253939.4,,AUD,Australian Dollars,6,Millions,,,,`;

const REGIONS: Array<[string, string]> = [
  ['1', 'New South Wales'], ['2', 'Victoria'], ['3', 'Queensland'], ['4', 'South Australia'],
  ['5', 'Western Australia'], ['6', 'Tasmania'], ['7', 'Northern Territory'], ['8', 'Australian Capital Territory'], ['AUS', 'Australia'],
];

function quarters(fromYear: number, fromQ: number, n: number): string[] {
  const out: string[] = [];
  let y = fromYear, q = fromQ;
  for (let i = 0; i < n; i++) { out.push(`${y}-Q${q}`); q++; if (q > 4) { q = 1; y++; } }
  return out;
}

/** A body with every jurisdiction over `n` quarters, prices rising 1% a quarter from a base per region. */
function body(n = 60, opts: { dropRegion?: string; status?: (tp: string) => string } = {}): string {
  const lines = [HEADER, REAL_STOCK];
  const tps = quarters(2011, 3, n);
  REGIONS.forEach(([code, label], i) => {
    if (code === opts.dropRegion) return;
    tps.forEach((tp, k) => {
      const value = (400 + i * 40) * 1.01 ** k;
      const status = opts.status ? opts.status(tp) : (k === tps.length - 1 ? 'p' : k === tps.length - 2 ? 'r' : '');
      lines.push(`DATAFLOW,ABS:RES_DWELL_ST(1.0.0),${NAME},I,5,Mean price of residential dwellings,${code},${label},Q,Quarterly,${tp},,${value.toFixed(1)},,AUD,Australian Dollars,3,Thousands,${status},,,`);
    });
  });
  return lines.join('\r\n') + '\r\n';
}

describe('the SDMX-CSV reader', () => {
  it('honours quotes around a field that holds commas', () => {
    expect(parseCsvLine('a,"b, c",d')).toEqual(['a', 'b, c', 'd']);
    expect(parseCsvLine('a,"say ""hi""",')).toEqual(['a', 'say "hi"', '']);
  });

  it('keys each record by the header names', () => {
    const recs = parseSdmxCsv([HEADER, REAL_NSW_2011].join('\n'));
    expect(recs).toHaveLength(1);
    expect(recs[0].Measure).toBe('Mean price of residential dwellings');
    expect(recs[0].Region).toBe('New South Wales');
    expect(recs[0].STRUCTURE_NAME).toBe('Residential Dwellings: Values, Mean Price and Number by State and Territories');
    expect(recs[0].OBS_VALUE).toBe('540.8');
    expect(recs[0].UNIT_MULT).toBe('3');
  });

  it('reads a quarter and refuses anything else', () => {
    expect(quarterPeriod('2026-Q2')).toBe('2026-06');
    expect(quarterPeriod('2011-Q3')).toBe('2011-09');
    expect(quarterPeriod('2026')).toBeNull();
    expect(quarterPeriod('2026-M06')).toBeNull();
  });
});

describe('parseAbsResDwell', () => {
  it('names the download the inventory measured', () => {
    expect(ABS_RES_DWELL_URL).toContain('data.api.abs.gov.au/rest/data/ABS,RES_DWELL_ST,1.0.0/all');
    expect(ABS_MEAN_PRICE_MEASURE.test('Mean price of residential dwellings')).toBe(true);
    expect(ABS_MEAN_PRICE_MEASURE.test('Number of residential dwellings')).toBe(false);
  });

  it('turns thousands into dollars and files a mean as a mean, for every jurisdiction and Australia', () => {
    const parsed = parseAbsResDwell(body());
    expect(parsed.states).toHaveLength(9);
    expect(parsed.periods).toHaveLength(60);
    expect(parsed.periods[0]).toBe('2011-09');
    expect(parsed.latestPeriod).toBe('2026-06');
    const nsw = parsed.rows.find((r) => r.state === 'NSW' && r.period === '2011-09');
    expect(nsw).toMatchObject({ areaKind: 'state', area: 'New South Wales', dwellingType: 'any', medianPrice: 400_000, salesCount: null, priceMeasure: 'mean', periodSpan: 'quarter', capturedAt: null });
    const aus = parsed.rows.find((r) => r.state === 'AU' && r.period === '2011-09');
    expect(aus).toMatchObject({ areaKind: 'national', area: 'Australia', medianPrice: 720_000 });
    expect(parsed.rows.every((r) => r.priceMeasure === 'mean')).toBe(true);
    // the stock-value row was never a price
    expect(parsed.rows.some((r) => r.medianPrice === 253_939_400_000)).toBe(false);
  });

  it('records which quarters the ABS marks preliminary and revised', () => {
    const parsed = parseAbsResDwell(body());
    expect(parsed.preliminaryPeriods).toEqual(['2026-06']);
    expect(parsed.revisedPeriods).toEqual(['2026-03']);
  });

  it('reads the real lines exactly', () => {
    const recs = parseSdmxCsv([HEADER, REAL_NSW_2011, REAL_NSW_2026].join('\n'));
    expect(recs.map((r) => r.TIME_PERIOD)).toEqual(['2011-Q3', '2026-Q2']);
    expect(ABS_REGION_CODES[recs[0].REGION]).toBe('NSW');
    expect(Math.round(Number(recs[1].OBS_VALUE) * 10 ** Number(recs[1].UNIT_MULT))).toBe(1_304_900);
  });

  it('refuses a download missing a jurisdiction, short of quarters, mis-scaled or reshaped', () => {
    expect(() => parseAbsResDwell(body(60, { dropRegion: '5' }))).toThrow(/8 jurisdictions, fewer than 9/);
    expect(() => parseAbsResDwell(body(12))).toThrow(/12 quarters, fewer than 20/);
    const misScaled = body().replace(/,3,Thousands,/g, ',6,Millions,');
    expect(() => parseAbsResDwell(misScaled)).toThrow(/outside/);
    expect(() => parseAbsResDwell(HEADER.replace('UNIT_MULT,', 'UNIT_X,') + '\n' + REAL_NSW_2011)).toThrow(/no "UNIT_MULT" column/);
    expect(() => parseAbsResDwell('')).toThrow(/empty/);
    expect(ABS_PLAUSIBILITY.minStates).toBe(9);
  });
});
