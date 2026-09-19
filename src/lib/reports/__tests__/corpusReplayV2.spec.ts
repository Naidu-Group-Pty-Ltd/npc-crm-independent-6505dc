/**
 * The zero-cost real-corpus Scoring V2 replay.
 *
 * READ-ONLY SHADOW ANALYSIS. This spec re-scores the live `investment_reports`
 * corpus through the frozen Scoring V2 engine to measure two things that need
 * no market evidence at all: what the V1 scores a client actually received were
 * built from, and what V2 would honestly say on the same records.
 *
 * ## It skips unless the corpus export is present
 *
 * The corpus contains production client data and is deliberately NOT committed.
 * `scripts/scoring/export-scored-corpus.sql` is the exact query that produces
 * it; point `V2_REPLAY_CORPUS` at the resulting JSON to run the measurement.
 * Without it every check below is skipped, so CI stays green and the analysis
 * stays reproducible by anyone with database access.
 *
 * ## Two judgements, stated rather than buried
 *
 * A stored **0** is not automatically a measurement, and treating it as one
 * would be the same defect this programme exists to remove — in reverse.
 * Measured over the corpus:
 *
 *   * `commuteTimeCBD === 0` is **absent**. A zero-minute commute to the
 *     employment centre is not a property that commutes instantly; it is a
 *     field nobody filled. 64 rows carry it.
 *   * `schoolsNearby === 0` is **measured**. A property genuinely can have no
 *     school within 3 km, and calling that absent would hide a real finding.
 *   * `walkScore === 0` is **absent** on the same reasoning as the commute (1
 *     row); every other walk score is a real published index.
 *
 * Nothing else is interpreted. No value is substituted, defaulted or inferred,
 * and no market evidence is constructed — because the record contains none.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

import { scoreInvestmentV2Shadow, type ShadowScoreResult } from '../market/shadowScorer.pure';
import { buildScoreOutput } from '../market/scoreOutputContract.pure';
import { resolveBacktestInput, type StoredReportRow } from '../market/backtestInput.pure';
import { emptyEvidence, type EvidenceDwellingType } from '../market/marketEvidence.pure';

const CORPUS = process.env.V2_REPLAY_CORPUS ?? '';
const OUT = process.env.V2_REPLAY_OUT ?? '';
const present = CORPUS !== '' && existsSync(CORPUS);

/** Column order of `export-scored-corpus.sql`. */
const C = {
  id: 0, addr: 1, created: 2, state: 3, lat: 4, lng: 5, walk: 6, commute: 7, schools: 8,
  ptype: 9, pval: 10, land: 11, build: 12, rent: 13, lvr: 14, wnet: 15, outgo: 16,
  v1Total: 17, v1Grade: 18,
  gScore: 19, gHas: 20, dScore: 21, dHas: 22, lScore: 23, lHas: 24,
  yScore: 25, yHas: 26, rScore: 27, rHas: 28,
} as const;

type Row = ReadonlyArray<unknown>;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Rebuild the nested shape `FIELD_PATHS` reads, so the real resolver runs. */
function toStoredRow(r: Row): StoredReportRow {
  return {
    id: r[C.id],
    property_address: r[C.addr],
    location_intelligence: {
      coordinates: { lat: r[C.lat], lng: r[C.lng] },
      walkScore: r[C.walk],
      commute: { durationMinutes: r[C.commute] },
      schools: { schoolsWithin3km: r[C.schools] },
    },
    financial_calculations: {
      initialCosts: { propertyValue: r[C.pval], landPrice: r[C.land], buildPrice: r[C.build] },
      income: { weeklyRent: r[C.rent] },
      keyMetrics: { lvr: r[C.lvr], weeklyNet: r[C.wnet] },
      annualCosts: { totalAnnualExcludingLandTax: r[C.outgo] },
    },
    property_specs: { property_type: r[C.ptype] },
    investment_score: { totalScore: r[C.v1Total], grade: r[C.v1Grade] },
  };
}

function dwellingClass(t: string | null): EvidenceDwellingType {
  if (t === null) return 'any';
  const s = t.toLowerCase();
  if (/land/.test(s)) return 'land';
  if (/(apartment|unit|townhouse|villa|duplex|flat)/.test(s)) return 'attached';
  if (/house/.test(s)) return 'house';
  return 'any';
}

const ORDER = ['F', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+'];
const gradeIndex = (g: string | null) => (g === null ? -1 : ORDER.indexOf(g));

interface Replayed {
  id: string; addr: string; created: string; state: string;
  v1Total: number | null; v1Grade: string | null;
  v1: Record<string, { score: number | null; hasData: boolean }>;
  measured: string[]; unavailable: string[]; coverage: number;
  v2Composite: number | null; v2Grade: string | null; v2Reason: string | null;
  dimCount: number;
  result: ShadowScoreResult;
}

const NOW = new Date('2026-09-11T00:00:00Z');

/** The exact input a stored row produces. `stripFinance` blanks ONLY the buyer block. */
function buildInput(r: Row, stripFinance = false) {
  {
    const resolved = resolveBacktestInput(toStoredRow(r));
    const ptype = resolved.dwellingType.value;

    // Absent stays absent: no market evidence exists in the stored record, so
    // Growth and Demand are genuinely unmeasurable here. Nothing is substituted.
    const evidence = emptyEvidence({
      suburb: resolved.suburb.value, postcode: resolved.postcode.value,
      state: resolved.state.value, dwellingType: dwellingClass(ptype),
      resolvedFrom: null,
    });

    const commute = num(r[C.commute]);
    const walk = num(r[C.walk]);
    return {
      evidence,
      yieldInputs: {
        basis: 'purchase' as const,
        basisAmount: resolved.purchasePrice.value,
        weeklyRent: resolved.weeklyRent.value,
        annualOutgoings: resolved.annualOutgoings.value,
        weeklyCashFlow: resolved.weeklyCashFlow.value,
      },
      locationInputs: {
        walkScore: walk !== null && walk > 0 ? walk : null,
        commuteTimeCBD: commute !== null && commute > 0 ? commute : null,
        schoolsNearby: num(r[C.schools]),
      },
      propertyRisk: { propertyType: ptype, answers: {}, growth1Year: null },
      finance: stripFinance ? {} : {
        lvr: resolved.lvr.value,
        weeklyCashFlow: resolved.weeklyCashFlow.value,
        purchasePrice: resolved.purchasePrice.value,
      },
      now: NOW,
    };
  }
}

function replay(rows: Row[]): Replayed[] {
  return rows.map((r) => {
    const result = scoreInvestmentV2Shadow(buildInput(r));
    const has = (i: number) => r[i] === true;
    return {
      id: String(r[C.id]), addr: String(r[C.addr] ?? ''), created: String(r[C.created] ?? ''),
      state: String(r[C.state] ?? '?'),
      v1Total: num(r[C.v1Total]), v1Grade: (r[C.v1Grade] as string) ?? null,
      v1: {
        growth: { score: num(r[C.gScore]), hasData: has(C.gHas) },
        demand: { score: num(r[C.dScore]), hasData: has(C.dHas) },
        location: { score: num(r[C.lScore]), hasData: has(C.lHas) },
        yield: { score: num(r[C.yScore]), hasData: has(C.yHas) },
        risk: { score: num(r[C.rScore]), hasData: has(C.rHas) },
      },
      measured: [...result.measured], unavailable: [...result.unavailable],
      coverage: result.evidenceCoverage,
      v2Composite: result.compositeScore, v2Grade: result.grade,
      v2Reason: result.unavailableReason,
      dimCount: result.measured.length,
      result,
    };
  });
}

describe.skipIf(!present)('Scoring V2 — real corpus replay (read-only shadow)', () => {
  const rows: Row[] = present ? JSON.parse(readFileSync(CORPUS, 'utf8')) : [];
  const out = present ? replay(rows) : [];

  it('replays every stored scored report', () => {
    expect(out.length).toBe(rows.length);
    expect(out.length).toBeGreaterThan(0);
  });

  it('produces no NaN, no Infinity, nothing outside 0-100, and reconciling weights', () => {
    for (const p of out) {
      for (const d of p.result.dimensions) {
        if (d.score !== null) {
          expect(Number.isFinite(d.score), `${p.id}:${d.key}`).toBe(true);
          expect(d.score).toBeGreaterThanOrEqual(0);
          expect(d.score).toBeLessThanOrEqual(100);
        } else {
          expect(d.effectiveWeight, `${p.id}:${d.key} unmeasured weight`).toBe(0);
        }
        expect(d.effectiveWeight).toBeGreaterThanOrEqual(0);
      }
      if (p.v2Composite !== null) {
        expect(Number.isFinite(p.v2Composite)).toBe(true);
        expect(p.v2Composite).toBeGreaterThanOrEqual(0);
        expect(p.v2Composite).toBeLessThanOrEqual(100);
        const eff = p.result.dimensions.reduce((s, d) => s + d.effectiveWeight, 0);
        expect(Math.abs(eff - 1), `${p.id} effective weights`).toBeLessThan(0.01);
        expect(gradeIndex(p.v2Grade)).toBeLessThanOrEqual(gradeIndex(p.result.uncappedGrade));
      } else {
        expect(p.v2Grade, `${p.id} no composite means no grade`).toBeNull();
        expect(p.v2Reason, `${p.id} states why`).toBeTruthy();
      }
      expect(p.coverage).toBeGreaterThanOrEqual(0);
      expect(p.coverage).toBeLessThanOrEqual(1);
    }
  });

  it('never lets an unavailable dimension become a zero, and never grades below the floor', () => {
    for (const p of out) {
      for (const key of p.unavailable) {
        const d = p.result.dimensions.find((x) => x.key === key)!;
        expect(d.score, `${p.id}:${key} unavailable must be null not 0`).toBeNull();
      }
      if (p.dimCount < 3) expect(p.v2Grade, `${p.id} below floor`).toBeNull();
    }
  });

  it('is deterministic: the same stored row replays identically', () => {
    const again = replay(rows.slice(0, 40));
    for (let i = 0; i < again.length; i += 1) {
      expect(JSON.stringify(again[i].result)).toBe(JSON.stringify(out[i].result));
    }
  });

  it('keeps the buyer out of the property score, on every real record', () => {
    // The same stored row, scored with the buyer's block emptied. Everything on
    // the property side must be byte-identical; only the suitability reading moves.
    const propertySide = (r: ShadowScoreResult) => JSON.stringify({
      dimensions: r.dimensions, composite: r.compositeScore, grade: r.grade,
      uncapped: r.uncappedGrade, nominal: r.nominalMeasuredScore,
      coverage: r.evidenceCoverage, capReasons: r.gradeCapReason,
    });
    let withFinance = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const stripped = scoreInvestmentV2Shadow(buildInput(rows[i], true));
      expect(propertySide(stripped), `${out[i].id} buyer changed the property score`)
        .toBe(propertySide(out[i].result));
      if (out[i].result.financeSuitability.band !== null) withFinance += 1;
      expect(stripped.financeSuitability.band).toBeNull();
    }
    expect(withFinance, 'some records must actually state a buyer position').toBeGreaterThan(0);
  });

  it('writes the measurement', () => {
    const agg = {
      measuredAt: new Date().toISOString(),
      corpus: out.length,
      v1: {
        growthConstant50: out.filter((p) => p.v1.growth.score === 50).length,
        growthHasData: out.filter((p) => p.v1.growth.hasData).length,
        demandConstant50: out.filter((p) => p.v1.demand.score === 50).length,
        demandHasData: out.filter((p) => p.v1.demand.hasData).length,
        locationHasData: out.filter((p) => p.v1.location.hasData).length,
        yieldHasData: out.filter((p) => p.v1.yield.hasData).length,
        riskHasData: out.filter((p) => p.v1.risk.hasData).length,
        gradeCounts: tally(out.map((p) => p.v1Grade ?? 'none')),
      },
      v2: {
        dimensionAvailable: {
          growth: out.filter((p) => p.measured.includes('growth')).length,
          location: out.filter((p) => p.measured.includes('location')).length,
          yield: out.filter((p) => p.measured.includes('yield')).length,
          demand: out.filter((p) => p.measured.includes('demand')).length,
          risk: out.filter((p) => p.measured.includes('risk')).length,
        },
        dimensionCountDistribution: tally(out.map((p) => String(p.dimCount))),
        gradeEligible: out.filter((p) => p.v2Grade !== null).length,
        gradeUnavailable: out.filter((p) => p.v2Grade === null).length,
        gradeCounts: tally(out.map((p) => p.v2Grade ?? 'none')),
        noGradeReasons: tally(out.filter((p) => p.v2Grade === null).map((p) => p.v2Reason ?? '')),
        coverageMin: Math.min(...out.map((p) => p.coverage)),
        coverageMax: Math.max(...out.map((p) => p.coverage)),
      },
      blastRadius: {
        v1HadGradeV2Cannot: out.filter((p) => p.v1Grade !== null && p.v2Grade === null).length,
        bothGraded: out.filter((p) => p.v1Grade !== null && p.v2Grade !== null).length,
        neitherGraded: out.filter((p) => p.v1Grade === null && p.v2Grade === null).length,
        sameGrade: out.filter((p) => p.v2Grade !== null && p.v1Grade === p.v2Grade).length,
        movedOneBand: out.filter((p) => p.v2Grade !== null && p.v1Grade !== null
          && Math.abs(gradeIndex(p.v1Grade) - gradeIndex(p.v2Grade)) === 1).length,
        movedTwoPlus: out.filter((p) => p.v2Grade !== null && p.v1Grade !== null
          && Math.abs(gradeIndex(p.v1Grade) - gradeIndex(p.v2Grade)) >= 2).length,
        v2Higher: out.filter((p) => p.v2Grade !== null && p.v1Grade !== null
          && gradeIndex(p.v2Grade) > gradeIndex(p.v1Grade)).length,
        v2Lower: out.filter((p) => p.v2Grade !== null && p.v1Grade !== null
          && gradeIndex(p.v2Grade) < gradeIndex(p.v1Grade)).length,
      },
      byState: Object.fromEntries(
        [...new Set(out.map((p) => p.state))].map((st) => {
          const g = out.filter((p) => p.state === st);
          return [st, {
            reports: g.length,
            v2Graded: g.filter((p) => p.v2Grade !== null).length,
            yieldMeasured: g.filter((p) => p.measured.includes('yield')).length,
            locationMeasured: g.filter((p) => p.measured.includes('location')).length,
          }];
        }),
      ),
      graded: out.filter((p) => p.v2Grade !== null).map((p) => ({
        id: p.id, addr: p.addr, state: p.state, created: p.created,
        v1: p.v1Total, v1Grade: p.v1Grade,
        v2: p.v2Composite, v2Grade: p.v2Grade,
        measured: p.measured, coverage: p.coverage,
        capReasons: p.result.gradeCapReason,
      })),
      sample: out.filter((_, i) => out.length <= 60 || i % 63 === 0).slice(0, 40).map((p) => ({
        id: p.id, addr: p.addr, state: p.state, created: p.created,
        v1Total: p.v1Total, v1Grade: p.v1Grade, v1: p.v1,
        measured: p.measured, unavailable: p.unavailable, coverage: p.coverage,
        v2Composite: p.v2Composite, v2Grade: p.v2Grade, v2Reason: p.v2Reason,
        dims: p.result.dimensions.map((d) => ({
          k: d.key, s: d.score, w: d.effectiveWeight, c: d.coverage,
        })),
        finance: p.result.financeSuitability.band,
      })),
    };
    if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(agg, null, 2)); }
    expect(agg.corpus).toBeGreaterThan(0);
  });
});

function tally(xs: string[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const x of xs) t[x] = (t[x] ?? 0) + 1;
  return Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1]));
}
