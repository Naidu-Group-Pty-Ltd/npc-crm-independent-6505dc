/**
 * RBA statistical tables — the contracts, pinned against the measured file
 * layouts (all three CSVs downloaded and catalogued 2026-09-06; the module
 * was also executed against the real files before this shipped).
 *
 * The fixtures reproduce the real shape: a UTF-8 BOM, a title line, the
 * metadata rows (Title / Description / Frequency / Type / Units / Source /
 * Publication date / Series ID — titles carrying quoted commas), then
 * DD/MM/YYYY rows. G1's fixture ends with future-dated rows whose value
 * cells are EMPTY, exactly as the real file does (three of them, through
 * 31/03/2027): the parser must read them as absent, never zero.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRbaCsv,
  RBA_MIN_DATA_ROWS,
  RBA_TABLE_TITLES,
  RBA_WANTED_SERIES,
} from '../../../../supabase/functions/_shared/rbaTables.pure';
import {
  buildMacroReading,
  cpiProjectionsFromMeasured,
  lastMoveOf,
  monthLabel,
  quarterLabel,
  type RbaMetaRow,
  type RbaObsRow,
} from '../../../../supabase/functions/_shared/rbaReading.pure';
import { macroEconomicBlock } from '../../../../supabase/functions/_shared/reports/macroPromptBlocks.pure';

// ---------------------------------------------------------------------------
// Fixtures in the real layout
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** A minimal F1.1 in the measured layout: monthly FIRMMCRT from 1969. */
function f11Fixture(opts: { mutate?: (lines: string[]) => void } = {}): string {
  const lines = [
    '\uFEFF' + 'F1.1 INTEREST RATES AND YIELDS – MONEY MARKET',
    'Title,Cash Rate Target,3-month BABs/NCDs',
    'Description,Cash Rate Target; monthly average,Bank Accepted Bills; monthly average',
    'Frequency,Monthly,Monthly',
    'Type,Original,Original',
    'Units,Per cent,Per cent',
    'Source,RBA,RBA',
    'Publication date,01-Sep-2026,01-Sep-2026',
    'Series ID,FIRMMCRT,FIRMMBAB90',
  ];
  for (let y = 1969; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 1969 && m < 6) continue;
      if (y === 2026 && m > 8) break;
      // A rate path with a recent move: 4.31 through May 2026, 4.35 after.
      const rate = y < 2026 ? 4.1 : m <= 5 ? 4.31 : 4.35;
      lines.push(`${pad(28)}/${pad(m)}/${y},${rate},${(rate + 0.16).toFixed(2)}`);
    }
  }
  opts.mutate?.(lines);
  return lines.join('\n');
}

/** A minimal G1: quarterly series with quoted-comma titles and the trailing future-dated empty rows. */
function g1Fixture(opts: { mutate?: (lines: string[]) => void } = {}): string {
  const lines = [
    '\uFEFF' + 'G1 CONSUMER PRICE INFLATION',
    'Title,Consumer price index,Year-ended inflation,"Year-ended trimmed mean inflation – excluding interest charges, tax changes",Quarterly inflation',
    'Description,All groups CPI,Year-ended,Trimmed mean,Seasonally adjusted',
    'Frequency,Quarterly,Quarterly,Quarterly,Quarterly',
    'Type,Original,Original,Original,Seasonally adjusted',
    '"Units","Index, September 2025 month = 100",Per cent,Per cent,Per cent',
    'Source,ABS,ABS,ABS,ABS',
    'Publication date,30-Jul-2026,30-Jul-2026,30-Jul-2026,30-Jul-2026',
    'Series ID,GCPIAG,GCPIAGYP,GCPIOCPMTMYP,GCPIAGSAQP',
  ];
  const quarterEnd: Record<number, string> = { 3: '31/03', 6: '30/06', 9: '30/09', 12: '31/12' };
  for (let y = 1922; y <= 2026; y++) {
    for (const q of [3, 6, 9, 12]) {
      if (y === 2026 && q > 6) break;
      const idx = ((y - 1922) * 0.9 + q / 12).toFixed(2);
      const ye = y === 2026 && q === 6 ? '3.9' : '3.0';
      const tm = y === 2026 && q === 6 ? '3.6' : '2.8';
      const qq = y === 2026 && q === 6 ? '0.6' : '0.7';
      lines.push(`${quarterEnd[q]}/${y},${idx},${ye},${tm},${qq}`);
    }
  }
  // The measured quirk: the RBA pre-prints future ABS reference periods
  // with every value cell empty.
  lines.push('30/09/2026,,,,');
  lines.push('31/12/2026,,,,');
  lines.push('31/03/2027,,,,');
  opts.mutate?.(lines);
  return lines.join('\n');
}

describe('parseRbaCsv', () => {
  it('reads the measured F1.1 layout and dates the observations from the file', () => {
    const parsed = parseRbaCsv(f11Fixture(), 'f1.1');
    expect(parsed.publicationDate).toBe('01-Sep-2026');
    const cash = parsed.series.find((s) => s.id === 'FIRMMCRT')!;
    expect(cash.units).toBe('Per cent');
    expect(cash.description).toContain('monthly average');
    const last = cash.observations[cash.observations.length - 1];
    expect(last).toEqual({ date: '2026-08-28', value: 4.35 });
  });

  it('reads G1 with quoted-comma titles, and the future-dated empty rows are ABSENT, never zero', () => {
    const parsed = parseRbaCsv(g1Fixture(), 'g1');
    const index = parsed.series.find((s) => s.id === 'GCPIAG')!;
    expect(index.units).toBe('Index, September 2025 month = 100');
    for (const s of parsed.series) {
      const last = s.observations[s.observations.length - 1];
      expect(last.date).toBe('2026-06-30');
      expect(s.observations.some((o) => o.value === 0)).toBe(false);
      expect(s.observations.some((o) => o.date > '2026-06-30')).toBe(false);
    }
    const ye = parsed.series.find((s) => s.id === 'GCPIAGYP')!;
    expect(ye.observations[ye.observations.length - 1].value).toBe(3.9);
  });

  it('refuses a file whose title line is not the expected table (an error page, or the wrong table)', () => {
    expect(() => parseRbaCsv('Access Denied', 'f1.1')).toThrow(/mismatch/);
    expect(() => parseRbaCsv(g1Fixture(), 'f1.1')).toThrow(/mismatch/);
  });

  it('refuses when a wanted series is missing — a moved layout must never half-load', () => {
    const broken = f11Fixture({
      mutate: (lines) => {
        const i = lines.findIndex((l) => l.startsWith('Series ID'));
        lines[i] = 'Series ID,FIRMMCRT_RENAMED,FIRMMBAB90';
      },
    });
    expect(() => parseRbaCsv(broken, 'f1.1')).toThrow(/FIRMMCRT/);
  });

  it('refuses a truncated download', () => {
    const cut = f11Fixture().split('\n').slice(0, 200).join('\n');
    expect(() => parseRbaCsv(cut, 'f1.1')).toThrow(/truncated/);
  });

  it('refuses an implausible value instead of loading it', () => {
    const broken = f11Fixture({
      mutate: (lines) => {
        lines[lines.length - 1] = '28/08/2026,435,4.51';
      },
    });
    expect(() => parseRbaCsv(broken, 'f1.1')).toThrow(/implausible/);
  });

  it('refuses units it has no plausibility bound for', () => {
    const broken = f11Fixture({
      mutate: (lines) => {
        const i = lines.findIndex((l) => l.startsWith('Units'));
        lines[i] = 'Units,$ million,Per cent';
      },
    });
    expect(() => parseRbaCsv(broken, 'f1.1')).toThrow(/unrecognised units/);
  });

  it('treats an empty cell mid-series as absent, not zero', () => {
    const parsed = parseRbaCsv(f11Fixture({
      mutate: (lines) => {
        const i = lines.findIndex((l) => l.startsWith('28/06/2000'));
        lines[i] = '28/06/2000,,4.26';
      },
    }), 'f1.1');
    const cash = parsed.series.find((s) => s.id === 'FIRMMCRT')!;
    expect(cash.observations.some((o) => o.date === '2000-06-28')).toBe(false);
    expect(cash.observations.some((o) => o.value === 0)).toBe(false);
  });

  it('keeps the floors below the measured row counts so a real file always clears them', () => {
    // Measured 2026-09-06: F1.1 687 rows, G1 420, F5 811.
    expect(RBA_MIN_DATA_ROWS['f1.1']).toBeLessThan(687);
    expect(RBA_MIN_DATA_ROWS['g1']).toBeLessThan(420);
    expect(RBA_MIN_DATA_ROWS['f5']).toBeLessThan(811);
    expect(Object.keys(RBA_TABLE_TITLES).sort()).toEqual(Object.keys(RBA_WANTED_SERIES).sort());
  });
});

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

function readingFixture(): { meta: RbaMetaRow[]; obs: RbaObsRow[] } {
  const meta: RbaMetaRow[] = [
    { series_id: 'FIRMMCRT', table_code: 'f1.1', title: 'Cash Rate Target', description: 'Cash Rate Target; monthly average', units: 'Per cent', publication_date: '01-Sep-2026' },
    { series_id: 'GCPIAG', table_code: 'g1', title: 'Consumer price index', description: null, units: 'Index, September 2025 month = 100', publication_date: '30-Jul-2026' },
    { series_id: 'GCPIAGYP', table_code: 'g1', title: 'Year-ended inflation', description: null, units: 'Per cent', publication_date: '30-Jul-2026' },
    { series_id: 'GCPIOCPMTMYP', table_code: 'g1', title: 'Trimmed mean', description: null, units: 'Per cent', publication_date: '30-Jul-2026' },
    { series_id: 'FILRHLBVS', table_code: 'f5', title: 'Standard OO', description: null, units: 'Per cent per annum', publication_date: '10-Aug-2026' },
    { series_id: 'FILRHLBVSI', table_code: 'f5', title: 'Standard investor', description: null, units: 'Per cent per annum', publication_date: '10-Aug-2026' },
  ];
  const obs: RbaObsRow[] = [
    { series_id: 'FIRMMCRT', obs_date: '2026-04-30', value: 4.31 },
    { series_id: 'FIRMMCRT', obs_date: '2026-05-31', value: 4.31 },
    { series_id: 'FIRMMCRT', obs_date: '2026-06-30', value: 4.35 },
    { series_id: 'FIRMMCRT', obs_date: '2026-07-31', value: 4.35 },
    { series_id: 'FIRMMCRT', obs_date: '2026-08-31', value: 4.35 },
    { series_id: 'GCPIAG', obs_date: '2026-06-30', value: 102.31 },
    { series_id: 'GCPIAGYP', obs_date: '2026-03-31', value: 4.1 },
    { series_id: 'GCPIAGYP', obs_date: '2026-06-30', value: 3.9 },
    { series_id: 'GCPIOCPMTMYP', obs_date: '2026-06-30', value: 3.6 },
    { series_id: 'FILRHLBVS', obs_date: '2026-07-31', value: 8.77 },
    { series_id: 'FILRHLBVSI', obs_date: '2026-07-31', value: 9.03 },
  ];
  return { meta, obs };
}

describe('buildMacroReading', () => {
  const { meta, obs } = readingFixture();
  const reading = buildMacroReading(meta, obs)!;

  it('serves each figure with its own reference period, named in words', () => {
    expect(reading.cashRate?.current).toEqual({ value: 4.35, period: '2026-08', periodLabel: 'August 2026' });
    expect(reading.cashRate?.basis).toBe('Cash Rate Target; monthly average');
    expect(reading.inflation?.yearEnded?.periodLabel).toBe('June quarter 2026');
    expect(reading.inflation?.trimmedMeanYearEnded?.value).toBe(3.6);
    expect(reading.inflation?.index?.base).toBe('Index, September 2025 month = 100');
    expect(reading.lendingRates?.investor.standardVariable?.value).toBe(9.03);
  });

  it('dates the last cash-rate move by arithmetic on the series, never as a board decision', () => {
    expect(reading.cashRate?.lastMove).toEqual({ periodLabel: 'June 2026', from: 4.31, to: 4.35 });
    expect(lastMoveOf(obs.filter((o) => o.series_id !== 'FIRMMCRT'), 'FIRMMCRT')).toBeNull();
  });

  it('carries the tables\' own publication dates', () => {
    expect(reading.cashRate?.publicationDate).toBe('01-Sep-2026');
    expect(reading.inflation?.publicationDate).toBe('30-Jul-2026');
    expect(reading.lendingRates?.publicationDate).toBe('10-Aug-2026');
  });

  it('has no GDP, unemployment or participation fields at all — these tables do not measure them', () => {
    const flat = JSON.stringify(reading).toLowerCase();
    expect(flat).not.toContain('gdp');
    expect(flat).not.toContain('unemployment');
    expect(flat).not.toContain('participation');
  });

  it('an absent series yields a null component; nothing loaded yields null', () => {
    const partial = buildMacroReading(meta, obs.filter((o) => o.series_id === 'FIRMMCRT'))!;
    expect(partial.cashRate).not.toBeNull();
    expect(partial.inflation).toBeNull();
    expect(partial.lendingRates).toBeNull();
    expect(buildMacroReading([], [])).toBeNull();
  });

  it('labels months and quarters the way the ABS does', () => {
    expect(monthLabel('2026-11-30')).toBe('November 2026');
    expect(quarterLabel('2026-09-30')).toBe('September quarter 2026');
  });
});

describe('cpiProjectionsFromMeasured', () => {
  const measured = { value: 3.9, period: '2026-06', periodLabel: 'June quarter 2026' };

  it('converges from the measured CPI toward the target midpoint over 10 years', () => {
    const path = cpiProjectionsFromMeasured(measured);
    expect(path).toHaveLength(10);
    expect(path[0].cpiPercent).toBeGreaterThan(2.5);
    expect(path[0].cpiPercent).toBeLessThan(3.9);
    // 3.9 + (2.5 − 3.9) × (1 − 0.8^10) = 2.65 → 2.7 at one decimal.
    expect(path[9].cpiPercent).toBe(2.7);
  });

  it('labels every year an Assumption naming the measured reading — never a forecast nobody read', () => {
    for (const year of cpiProjectionsFromMeasured(measured)) {
      expect(year.source).toContain('Assumption');
      expect(year.source).toContain('3.9%');
      expect(year.source).toContain('June quarter 2026');
      expect(year.source).not.toMatch(/SMP|Treasury|forecast/i);
    }
  });

  it('with no measured CPI the path is flat at the target midpoint and says so', () => {
    const path = cpiProjectionsFromMeasured(null);
    expect(path.every((y) => y.cpiPercent === 2.5)).toBe(true);
    expect(path[0].source).toContain('no measured CPI');
    expect(path[0].source).toContain('Assumption');
  });
});

// ---------------------------------------------------------------------------
// Prompt block — measured rows only, no invented macro figures
// ---------------------------------------------------------------------------

describe('macro prompt block', () => {
  const { meta, obs } = readingFixture();
  const economics = buildMacroReading(meta, obs) as unknown as Record<string, unknown>;

  it('renders measured rows with their periods and publication dates', () => {
    const block = macroEconomicBlock({ economics });
    // RF-7.2B.1 renamed this row. `FIRMMCRT` is a MONTHLY AVERAGE, and the
    // label now says so on the row itself rather than only in the value cell,
    // because the row title is what a reader quotes. The in-force target has
    // its own row, from F1, and is asserted separately below.
    expect(block).toContain('| Cash Rate Target — Monthly Average | 4.35% (monthly average, August 2026) |');
    expect(block).not.toContain('| RBA cash rate target |');
    expect(block).toContain('published 01-Sep-2026');
    expect(block).toContain('| Inflation — headline CPI, year-ended | 3.9% (June quarter 2026) |');
    expect(block).toContain('| Standard variable housing rate (investor, banks) | 9.03% (July 2026) |');
  });

  it('never renders a row for anything unmeasured, and forbids inventing them', () => {
    const block = macroEconomicBlock({ economics });
    // No GDP or unemployment ROW exists (the instruction names them only to forbid them).
    expect(block).not.toMatch(/\|\s*GDP/);
    expect(block).not.toMatch(/\|\s*(National )?[Uu]nemployment/);
    expect(block).toContain('Do NOT state GDP growth, unemployment');
    expect(block).toContain('monthly average');
    expect(block).not.toContain('4.10');
  });

  it('with nothing measured it instructs an honest absence', () => {
    const block = macroEconomicBlock({});
    expect(block).toContain('No measured macro-economic reading');
    expect(block).not.toContain('|');
    expect(block).toContain('do NOT state a cash rate');
  });

  it('renders only the components that exist', () => {
    const partial = buildMacroReading(meta, obs.filter((o) => o.series_id === 'FIRMMCRT'));
    const block = macroEconomicBlock({ economics: partial as unknown as Record<string, unknown> });
    expect(block).toContain('Cash Rate Target — Monthly Average');
    expect(block).not.toContain('Inflation');
  });

  // RF-7.2B.1: with F1.1 alone the block must FAIL CLOSED. The monthly
  // average still renders — it is a real figure — but nothing may present it
  // as the rate in force, which is what a silent substitution would do.
  it('fails closed on the current target when only the monthly average is held', () => {
    const partial = buildMacroReading(meta, obs.filter((o) => o.series_id === 'FIRMMCRT'));
    const block = macroEconomicBlock({ economics: partial as unknown as Record<string, unknown> });
    expect(block).toContain('NO CURRENT CASH RATE TARGET IS AVAILABLE');
    expect(block).not.toContain('cash rate target (current)');
    // No row may carry an effective date — the refusal sentence mentions the
    // words 'effective date' to forbid them, so assert on the TABLE.
    const table = block.split('\n').filter((l) => l.startsWith('|'));
    expect(table.some((l) => /effective/i.test(l))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The de-fabricated sources stay de-fabricated
// ---------------------------------------------------------------------------

describe('macro source hygiene', () => {
  const fn = (p: string) => join(__dirname, '../../../../supabase/functions', p);

  it('rba-data-service no longer asks a model for figures or hardcodes a rate', () => {
    const source = readFileSync(fn('rba-data-service/index.ts'), 'utf-8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code.toLowerCase()).not.toContain('perplexity');
    expect(code).not.toContain('llmRouter');
    expect(code).not.toContain("'4.10'");
    expect(code).not.toContain('economic_data_cache');
  });

  it('the generator and regenerator carry no hardcoded macro fallbacks', () => {
    const generator = readFileSync(fn('generate-investment-report/index.ts'), 'utf-8');
    expect(generator).not.toContain("|| '4.10'");
    expect(generator).not.toContain('VERIFIED ECONOMIC DATA');
    const regen = readFileSync(fn('regenerate-report-qualitative/index.ts'), 'utf-8');
    expect(regen).not.toContain("|| '4.35'");
  });
});
