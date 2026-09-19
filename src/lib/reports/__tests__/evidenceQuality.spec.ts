/**
 * ME-6 — the validator rejects what is not evidence and never rewrites a market.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EXTREME_PERIOD_MOVEMENT_PCT,
  THIN_SAMPLE_THRESHOLD,
  assessEvidenceQuality,
  flags,
  rejections,
  type AnsweredSubject,
  type RequestedSubject,
  type SeriesPoint,
} from '../market/evidenceQuality.pure';

const AT = new Date('2026-09-08T00:00:00Z');
const REQUESTED: RequestedSubject = { suburb: 'Gympie', postcode: '4570', state: 'QLD', dwellingType: 'house' };
const ANSWERED: AnsweredSubject = {
  areaName: 'Gympie', postcode: '4570', state: 'QLD',
  level: 'suburb', dwellingType: 'house', dwellingTypeMatched: true,
};

const clean: SeriesPoint[] = [
  { period: '2025-09-30', value: 500_000, sampleSize: 42 },
  { period: '2025-12-31', value: 510_000, sampleSize: 38 },
  { period: '2026-03-31', value: 522_000, sampleSize: 45 },
  { period: '2026-06-30', value: 531_000, sampleSize: 40 },
];

describe('a clean answer is admissible', () => {
  it('passes and records freshness from the source period', () => {
    const r = assessEvidenceQuality(REQUESTED, ANSWERED, clean, AT);
    expect(r.admissible).toBe(true);
    expect(rejections(r)).toHaveLength(0);
    expect(r.freshnessDays).toBe(70);
    expect(r.sampleSizes).toEqual([42, 38, 45, 40]);
  });
});

describe('geography is matched, never trusted', () => {
  it('rejects a different suburb', () => {
    const r = assessEvidenceQuality(REQUESTED, { ...ANSWERED, areaName: 'Gympie South' }, clean, AT);
    expect(r.admissible).toBe(false);
    expect(rejections(r)[0].code).toBe('geography_mismatch');
    expect(rejections(r)[0].detail).toMatch(/different question/i);
  });

  it('rejects the same suburb name in another state', () => {
    const req = { ...REQUESTED, suburb: 'Richmond', state: 'VIC', postcode: '3121' };
    const ans = { ...ANSWERED, areaName: 'Richmond', state: 'NSW', postcode: '3121' };
    const r = assessEvidenceQuality(req, ans, clean, AT);
    expect(r.admissible).toBe(false);
    expect(rejections(r).some((f) => /repeat across states/i.test(f.detail))).toBe(true);
  });

  it('rejects a coarser level as the subject figure', () => {
    const r = assessEvidenceQuality(REQUESTED, { ...ANSWERED, level: 'lga' }, clean, AT);
    expect(r.admissible).toBe(false);
    expect(rejections(r).some((f) => f.code === 'geography_level_coarser_than_requested')).toBe(true);
  });

  it('tolerates a bracketed state disambiguator in the area name', () => {
    const req = { ...REQUESTED, suburb: 'Araluen (NSW)', state: 'NSW', postcode: '2622' };
    const ans = { ...ANSWERED, areaName: 'Araluen', state: 'NSW', postcode: '2622' };
    expect(assessEvidenceQuality(req, ans, clean, AT).admissible).toBe(true);
  });
});

describe('a dwelling type is never silently substituted', () => {
  it('flags a substitution and says it may not stand as this type’s growth', () => {
    const r = assessEvidenceQuality(
      REQUESTED, { ...ANSWERED, dwellingType: 'any', dwellingTypeMatched: false }, clean, AT,
    );
    // Flagged, not rejected: usable as context.
    expect(r.admissible).toBe(true);
    const f = flags(r).find((x) => x.code === 'dwelling_type_substituted');
    expect(f).toBeTruthy();
    expect(f!.detail).toMatch(/never as this dwelling type/i);
  });
});

describe('malformed series are rejected', () => {
  it('rejects a period in the future', () => {
    const r = assessEvidenceQuality(REQUESTED, ANSWERED, [...clean, { period: '2027-06-30', value: 600_000 }], AT);
    expect(rejections(r).some((f) => f.code === 'period_in_future')).toBe(true);
  });
  it('rejects a duplicated period', () => {
    const r = assessEvidenceQuality(REQUESTED, ANSWERED, [...clean, clean[2]], AT);
    expect(rejections(r).some((f) => f.code === 'duplicate_period')).toBe(true);
  });
  it('rejects a series running backwards', () => {
    const r = assessEvidenceQuality(REQUESTED, ANSWERED, [...clean].reverse(), AT);
    expect(rejections(r).some((f) => f.code === 'series_out_of_order')).toBe(true);
  });
  it('rejects insufficient history', () => {
    const r = assessEvidenceQuality(REQUESTED, ANSWERED, [clean[0]], AT);
    expect(rejections(r).some((f) => f.code === 'insufficient_history')).toBe(true);
  });
  it('rejects an unparseable period', () => {
    const r = assessEvidenceQuality(REQUESTED, ANSWERED, [{ period: 'last quarter', value: 1 }, clean[0]], AT);
    expect(rejections(r).some((f) => f.code === 'period_unparseable')).toBe(true);
  });
});

describe('an extreme move is a market event, not an error', () => {
  const spike: SeriesPoint[] = [
    { period: '2025-09-30', value: 400_000, sampleSize: 12 },
    { period: '2025-12-31', value: 700_000, sampleSize: 8 },
    { period: '2026-03-31', value: 690_000, sampleSize: 11 },
    { period: '2026-06-30', value: 705_000, sampleSize: 14 },
  ];

  it('flags it, keeps it admissible, and passes the value through at full size', () => {
    const r = assessEvidenceQuality(REQUESTED, ANSWERED, spike, AT);
    expect(r.admissible).toBe(true);
    const f = flags(r).find((x) => x.code === 'extreme_period_movement');
    expect(f).toBeTruthy();
    expect(Number(f!.observedValue)).toBeGreaterThanOrEqual(EXTREME_PERIOD_MOVEMENT_PCT);
    expect(f!.detail).toMatch(/full value/i);
  });

  it('no finding may carry a corrected or clipped value', () => {
    const r = assessEvidenceQuality(REQUESTED, ANSWERED, spike, AT);
    for (const f of r.findings) {
      expect(Object.keys(f).sort()).toEqual(['code', 'detail', 'observedValue', 'severity']);
    }
  });

  it('the module contains no clipping vocabulary at all', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/_shared/reports/market/evidenceQuality.pure.ts'),
      'utf8',
    );
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of ['winsor', 'clamp(', 'clip(', '.cap(', 'Math.min(Math.max']) {
      expect(code.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

describe('sample and freshness are recorded, never invented', () => {
  it('flags a thin sample without rejecting it', () => {
    const thin = clean.map((p) => ({ ...p, sampleSize: THIN_SAMPLE_THRESHOLD - 5 }));
    const r = assessEvidenceQuality(REQUESTED, ANSWERED, thin, AT);
    expect(r.admissible).toBe(true);
    expect(flags(r).some((f) => f.code === 'thin_sample')).toBe(true);
  });

  it('flags absent sample information rather than assuming a count', () => {
    const noSample = clean.map(({ period, value }) => ({ period, value }));
    const r = assessEvidenceQuality(REQUESTED, ANSWERED, noSample, AT);
    expect(flags(r).some((f) => f.code === 'sample_size_absent')).toBe(true);
    expect(r.sampleSizes.every((s) => s === null)).toBe(true);
  });

  it('flags stale evidence and still returns it', () => {
    const old = clean.map((p) => ({ ...p, period: p.period.replace('2026', '2023').replace('2025', '2022') }));
    const r = assessEvidenceQuality(REQUESTED, ANSWERED, old, AT);
    expect(r.admissible).toBe(true);
    expect(flags(r).some((f) => f.code === 'stale_evidence')).toBe(true);
    expect(r.freshnessDays).toBeGreaterThan(400);
  });

  it('flags a gap without rejecting the series', () => {
    const gapped: SeriesPoint[] = [
      { period: '2024-06-30', value: 480_000, sampleSize: 30 },
      { period: '2026-06-30', value: 531_000, sampleSize: 40 },
    ];
    const r = assessEvidenceQuality(REQUESTED, ANSWERED, gapped, AT);
    expect(r.admissible).toBe(true);
    expect(flags(r).some((f) => f.code === 'series_gap')).toBe(true);
  });

  it('is reproducible — the same inputs give the same report', () => {
    const a = assessEvidenceQuality(REQUESTED, ANSWERED, clean, AT);
    const b = assessEvidenceQuality(REQUESTED, ANSWERED, clean, AT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
