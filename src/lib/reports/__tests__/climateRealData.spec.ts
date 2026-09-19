/**
 * Climate — the contracts, pinned against SILO's measured response shape.
 *
 * The fixture reproduces the real `format=monthly` layout captured
 * 2026-09-06: commentary lines, a dummy sensing line dated 199705 full of
 * sentinels, the `YYYYMM TMax TMin Rain Evap Rad VP` header with a units
 * line, then monthly rows. The module was also executed against the live
 * service for three coordinates (Brisbane 1,103.8 mm, Parramatta 890.3 mm,
 * Wyndham Vale 458.9 mm — 1991–2020 normals) before this shipped.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSiloMonthlyUrl,
  computeClimateReading,
  NORMAL_FROM,
  NORMAL_TO,
  parseSiloMonthly,
} from '../../../../supabase/functions/_shared/climateReading.pure';
import { climateStatBlocks } from '../../../../supabase/functions/_shared/reports/climatePromptBlocks.pure';

// ---------------------------------------------------------------------------
// Fixture in the real layout
// ---------------------------------------------------------------------------

function siloFixture(opts: { yearsTo?: number; mutate?: (lines: string[]) => void } = {}): string {
  const yearsTo = opts.yearsTo ?? 2026;
  const lines: string[] = [
    '"199705"  -9.9  -9.9 9999.9 999.9  99.9  99.9"',
    '""',
    '" This file is SPACE DELIMITED for easy import into both spreadsheets and programs."',
    '"The first line 199705 contains dummy data and is provided to allow spreadsheets to sense the columns"',
    '" "',
    'YYYYMM TMax  TMin  Rain  Evap   Rad    VP',
    '()     (oC)  (oC)  (mm)  (mm) (MJ/m2) (hPa)',
  ];
  for (let y = NORMAL_FROM; y <= yearsTo; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === yearsTo && m > 8) break; // series ends at the last complete month
      // Seasonal shape: hot wet January, cool dry July.
      const summer = Math.cos(((m - 1) / 12) * 2 * Math.PI); // 1 in Jan, -1 in Jul
      const tMax = (25 + 5 * summer).toFixed(1);
      const tMin = (12 + 6 * summer).toFixed(1);
      const rain = (60 + 40 * summer + (y % 3)).toFixed(1);
      const evap = (120 + 40 * summer).toFixed(1);
      lines.push(`${y}${String(m).padStart(2, '0')}00  ${tMax}  ${tMin}   ${rain} ${evap}  20.0  18.0`);
    }
  }
  opts.mutate?.(lines);
  return lines.join('\n');
}

describe('parseSiloMonthly', () => {
  it('reads the measured layout and skips the dummy sensing line by date', () => {
    const rows = parseSiloMonthly(siloFixture());
    expect(rows[0].month).toBe(`${NORMAL_FROM}-01`);
    expect(rows[rows.length - 1].month).toBe('2026-08');
    // 1997-05 appears once (the real row), not twice.
    expect(rows.filter((r) => r.month === '1997-05')).toHaveLength(1);
  });

  it('refuses a response with no header (an error page)', () => {
    expect(() => parseSiloMonthly('Sorry, the service is temporarily unavailable')).toThrow(/header/);
  });

  it('refuses implausible values instead of averaging a sentinel into a normal', () => {
    expect(() => parseSiloMonthly(siloFixture({
      mutate: (lines) => {
        const i = lines.findIndex((l) => l.startsWith('200003'));
        lines[i] = '20000300  9999.9  -9.9   50.0 120.0  20.0  18.0';
      },
    }))).toThrow(/implausible/);
  });

  it('refuses a truncated series', () => {
    const text = siloFixture().split('\n').slice(0, 20).join('\n');
    expect(() => parseSiloMonthly(text)).toThrow(/truncated/);
  });
});

describe('computeClimateReading', () => {
  const reading = computeClimateReading(parseSiloMonthly(siloFixture()));

  it('names the windows and computes the normal over exactly 1991–2020', () => {
    expect(reading.normalPeriod).toBe(`${NORMAL_FROM}–${NORMAL_TO}`);
    // Monthly rain normal ≈ 60 + 40·cos + year jitter mean (~1) → annual ≈ 732.
    expect(reading.annualRainfallNormalMm).toBeGreaterThan(700);
    expect(reading.annualRainfallNormalMm).toBeLessThan(760);
  });

  it('names the hottest and wettest months from the data, not by assumption', () => {
    expect(reading.hottestMonth.month).toBe('January');
    expect(reading.coldestMonth.month).toBe('July');
    expect(reading.wettestMonth.month).toBe('January');
    expect(reading.driestMonth.month).toBe('July');
  });

  it('compares the recent 12 months like for like — the same calendar months’ normal', () => {
    expect(reading.recent?.period).toBe('2025-09 to 2026-08');
    // Sep–Aug spans a full seasonal cycle, so the same-months normal equals
    // the annual normal within the year-jitter tolerance.
    expect(Math.abs(reading.recent!.sameMonthsNormalMm - reading.annualRainfallNormalMm)).toBeLessThan(20);
  });

  it('refuses to compute a normal over a hole', () => {
    const withHole = parseSiloMonthly(siloFixture()).filter((r) => r.month !== '2005-06');
    expect(() => computeClimateReading(withHole)).toThrow(/missing 2005-06/);
  });

  it('carries the SILO attribution and the interpolated-grid basis', () => {
    expect(reading.source).toContain('SILO');
    expect(reading.source).toContain('CC BY 4.0');
    expect(reading.coordinateBasis).toContain('not a single weather station');
    expect(reading.dataQuality).toBe('interpolated_observations');
  });
});

describe('buildSiloMonthlyUrl', () => {
  it('asks for monthly data from the normal start to the given end', () => {
    const url = buildSiloMonthlyUrl(-27.47, 153.02, '2026-08-31');
    expect(url).toContain('format=monthly');
    expect(url).toContain(`start=${NORMAL_FROM}0101`);
    expect(url).toContain('finish=20260831');
    expect(url).toContain('lat=-27.47');
  });
});

// ---------------------------------------------------------------------------
// Prompt block — measured figures only, no zone naming, no invented hazards
// ---------------------------------------------------------------------------

describe('climate prompt block', () => {
  const reading = computeClimateReading(parseSiloMonthly(siloFixture()));

  it('renders the profile with windows and source, and instructs no zone or unmeasured hazard', () => {
    const block = climateStatBlocks({ climateData: reading as unknown as Record<string, unknown> });
    expect(block).toContain('1991–2020');
    expect(block).toContain('SILO');
    expect(block).toContain('Wettest month');
    expect(block).toContain('Do NOT name a climate zone');
    expect(block).toContain('storms, cyclones and heatwaves are unmeasured');
    // The fabricated template's vocabulary must not return.
    expect(block).not.toContain('Temperate');
    expect(block).not.toContain('Climate Zone');
  });

  it('hazard rows render only real levels — Unknown is not a rating', () => {
    const block = climateStatBlocks({
      climateData: reading as unknown as Record<string, unknown>,
      riskAssessment: {
        floodRisk: { level: 'Low', description: 'AFRIP: no mapped flood extent at the property' },
        bushfireRisk: { level: 'Unknown', description: 'mapping unavailable' },
      },
    });
    expect(block).toContain('| Flooding | Low |');
    expect(block).not.toContain('| Bushfire |');
  });

  it('with nothing measured it instructs an honest absence', () => {
    const block = climateStatBlocks({});
    expect(block).toContain('do NOT print a climate table');
    expect(block).not.toContain('|');
  });
});
