/**
 * The TRUSTED corpus replay — Scoring V2 behind the Trusted Evidence Gate.
 *
 * READ-ONLY SHADOW ANALYSIS. The first replay
 * (`corpusReplayV2.spec.ts`) asked what V2 says on the stored records. This
 * one asks the question in front of it: **which of those inputs may be
 * trusted at all?** — and re-scores using only `trusted` and deterministically
 * `recovered` values, per `trustedInput.pure.ts`.
 *
 * Skips unless both exports are present; they are production client data and
 * are deliberately not committed. `scripts/scoring/export-scored-corpus.sql`
 * and `scripts/scoring/export-trust-map.sql` produce them.
 *
 * ## What the gate changes, and the one rule behind it
 *
 * Location inputs are facts about a COORDINATE. Where `report_geography` could
 * not place that coordinate — a geocoder failure value, or an address that
 * cannot be placed in Australia — the walk score, commute and school count
 * measured there describe somewhere else, and the gate withholds them. That is
 * the whole of the Location movement between the two replays.
 *
 * Yield moves the other way: an operator's entered purchase price and weekly
 * rent are recovered where the stored calculation block carried none, which
 * ADDS records. Both directions are reported, because a gate that only ever
 * subtracts would be a filter rather than a qualification.
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

import { scoreInvestmentV2Shadow, type ShadowScoreResult } from '../market/shadowScorer.pure';
import {
  classifyGeography, classifyOverride, inheritTrust, gated, mayScore, unavailable,
  buildLedger, type GeographyVerdict, type TrustedInput,
} from '../market/trustedInput.pure';
import { emptyEvidence, type EvidenceDwellingType } from '../market/marketEvidence.pure';
import {
  LOCATION_PROVENANCE_MATRIX,
} from '../location/locationProvenanceMatrix.pure';

const CORPUS = process.env.V2_REPLAY_CORPUS ?? '';
const TRUST = process.env.V2_REPLAY_TRUST ?? '';
const OUT = process.env.V2_TRUSTED_OUT ?? '';
const present = CORPUS !== '' && TRUST !== '' && existsSync(CORPUS) && existsSync(TRUST);

const C = {
  id: 0, addr: 1, created: 2, state: 3, lat: 4, lng: 5, walk: 6, commute: 7, schools: 8,
  ptype: 9, pval: 10, land: 11, build: 12, rent: 13, lvr: 14, wnet: 15, outgo: 16,
  v1Total: 17, v1Grade: 18,
} as const;
/** Column order of `export-trust-map.sql`. */
const T = { id: 0, code: 1, suburb: 2, state: 3, postcode: 4, sa2: 5, remote: 6, moPrice: 7, moRent: 8 } as const;

/** Trust codes the export emits, mapped back to the resolver's own vocabulary. */
const VERDICT: Record<number, (r: ReadonlyArray<unknown>) => GeographyVerdict | null> = {
  0: (r) => ({ status: 'resolved', flags: [], suburb: r[T.suburb] as string, state: r[T.state] as string,
               postcode: r[T.postcode] as string, sa2Code: r[T.sa2] as string }),
  1: () => ({ status: 'unresolved', flags: ['geocode_failure_value'], suburb: null, state: null, postcode: null, sa2Code: null }),
  2: () => ({ status: 'unresolved', flags: ['corrupted_unrecoverable'], suburb: null, state: null, postcode: null, sa2Code: null }),
  3: () => null,
  4: () => ({ status: 'unresolved', flags: [], suburb: null, state: null, postcode: null, sa2Code: null }),
};

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function dwellingClass(t: string | null): EvidenceDwellingType {
  if (t === null) return 'any';
  const s = t.toLowerCase();
  if (/land/.test(s)) return 'land';
  if (/(apartment|unit|townhouse|villa|duplex|flat)/.test(s)) return 'attached';
  if (/house/.test(s)) return 'house';
  return 'any';
}

/**
 * A stored Location field, classified by the programme's OWN provenance
 * register rather than by this spec's judgement.
 *
 * `LOCATION_PROVENANCE_MATRIX` (ME-5.1 item 9) classified every field in
 * `location_intelligence` against the live corpus. Exactly one entry is
 * `genuine_measured` — the coordinate. Every scoring input Location reads is
 * marked `admissibleToV2: false`, and the register says why: the walk score is
 * a state template whose formula reproduces the stored value on 1,109 of
 * 1,114 objects and 30 of whose 100 points ARE a per-state transport constant;
 * the commute is either a fabricated straight-line estimate (438 objects, mean
 * 10,125 minutes) or a real query sent to the wrong city (494 non-NSW reports
 * routed to Sydney); and the school count is `min(actual, 10)` off a Places
 * page slice, at the ceiling on 851 of 1,114.
 *
 * So a field is admitted only where the register admits it. That is what makes
 * this a qualification rather than a second opinion.
 */
function fromRegister(
  value: number | null, semantic: string, field: string,
): TrustedInput<number> {
  const row = LOCATION_PROVENANCE_MATRIX.find((r) => r.field === field);
  if (value === null) {
    return unavailable<number>(semantic, `No ${semantic} is recorded for this report.`);
  }
  if (row && row.admissibleToV2) {
    return {
      value, trust: 'trusted', semantic,
      source: 'location_intelligence', provenance: field, asOf: null, level: 'property',
      acquisition: 'open_public',
      verification: `admitted by the Location provenance register as ${row.klass}`,
      reason: row.evidence,
    };
  }
  return {
    value, trust: 'untrusted', semantic,
    source: 'location_intelligence', provenance: field, asOf: null, level: 'property',
    acquisition: 'open_public',
    verification: `refused by the Location provenance register${row ? ` as ${row.klass}` : ' (field not registered)'}`,
    reason: row
      ? row.evidence
      : `${field} is not classified in the Location provenance register, so it cannot be admitted.`,
  };
}

interface Row { corpus: ReadonlyArray<unknown>; trust: ReadonlyArray<unknown> }

function scoreTrusted(row: Row) {
  const { corpus: r, trust: t } = row;
  const code = (t[T.code] as number) ?? 3;
  const geography = classifyGeography(VERDICT[code](t));

  // Location: facts about a coordinate, so they inherit the coordinate's trust.
  // A zero commute is a field nobody filled (a property does not reach the
  // centre instantly); a zero school count is a real measurement.
  const walkRaw = num(r[C.walk]);
  const commuteRaw = num(r[C.commute]);
  const walk = inheritTrust(geography, fromRegister(
    walkRaw !== null && walkRaw > 0 ? walkRaw : null, 'walk score', 'walkScore'));
  const commute = inheritTrust(geography, fromRegister(
    commuteRaw !== null && commuteRaw > 0 ? commuteRaw : null,
    'commute minutes to the nearest employment centre',
    'commute.distanceKm / durationMinutes (mode=estimated)'));
  const schools = inheritTrust(geography, fromRegister(
    num(r[C.schools]), 'schools within 3 km', 'schools.schoolsWithin3km'));

  // Yield: the operator's entry is the scenario's own authority.
  const storedPrice = num(r[C.pval])
    ?? (num(r[C.land]) !== null && num(r[C.build]) !== null ? (r[C.land] as number) + (r[C.build] as number) : null);
  const price = classifyOverride('purchase price', num(t[T.moPrice]), storedPrice);
  const rent = classifyOverride('weekly rent', num(t[T.moRent]), num(r[C.rent]));

  const result = scoreInvestmentV2Shadow({
    // No market evidence exists in the record: Growth and Demand stay absent.
    evidence: emptyEvidence({
      suburb: (t[T.suburb] as string) ?? null, postcode: (t[T.postcode] as string) ?? null,
      state: (t[T.state] as string) ?? null,
      dwellingType: dwellingClass((r[C.ptype] as string) ?? null),
      resolvedFrom: code === 0 ? 'coordinate' : null,
    }),
    yieldInputs: {
      basis: 'purchase',
      basisAmount: gated(price),
      weeklyRent: gated(rent),
      annualOutgoings: num(r[C.outgo]),
      weeklyCashFlow: num(r[C.wnet]),
    },
    locationInputs: {
      walkScore: gated(walk), commuteTimeCBD: gated(commute), schoolsNearby: gated(schools),
    },
    propertyRisk: { propertyType: (r[C.ptype] as string) ?? null, answers: {}, growth1Year: null },
    finance: { lvr: num(r[C.lvr]), weeklyCashFlow: num(r[C.wnet]), purchasePrice: gated(price) },
    now: new Date('2026-09-11T00:00:00Z'),
  });

  return {
    id: String(r[C.id]), addr: String(r[C.addr] ?? ''), state: (t[T.state] as string) ?? String(r[C.state] ?? '?'),
    code, geography, walk, commute, schools, price, rent, result,
    ledger: buildLedger(geography, { walk, commute, schools, price, rent }),
  };
}

describe.skipIf(!present)('Scoring V2 — trusted corpus replay', () => {
  const corpus: ReadonlyArray<unknown>[] = present ? JSON.parse(readFileSync(CORPUS, 'utf8')) : [];
  const trustRows: ReadonlyArray<unknown>[] = present ? JSON.parse(readFileSync(TRUST, 'utf8')) : [];
  const byId = new Map(trustRows.map((t) => [String(t[T.id]), t]));
  const rows: Row[] = corpus
    .filter((c) => byId.has(String(c[C.id])))
    .map((c) => ({ corpus: c, trust: byId.get(String(c[C.id]))! }));
  const out = rows.map(scoreTrusted);

  it('qualifies every report in the corpus', () => {
    expect(out.length).toBe(corpus.length);
    expect(out.length).toBeGreaterThan(0);
  });

  it('never lets an untrusted input reach the engine', () => {
    for (const p of out) {
      for (const i of [p.walk, p.commute, p.schools, p.price, p.rent]) {
        if (i.trust === 'untrusted' || i.trust === 'unavailable') {
          expect(gated(i), `${p.id}:${i.semantic} must be withheld`).toBeNull();
        }
      }
      // A location reading can only exist where the coordinate was placed.
      const loc = p.result.dimensions.find((d) => d.key === 'location')!;
      if (loc.score !== null) {
        expect(mayScore(p.geography), `${p.id} scored Location without trusted geography`).toBe(true);
      }
    }
  });

  it('holds every numeric invariant under the gate', () => {
    for (const p of out) {
      for (const d of p.result.dimensions) {
        if (d.score !== null) {
          expect(Number.isFinite(d.score)).toBe(true);
          expect(d.score).toBeGreaterThanOrEqual(0);
          expect(d.score).toBeLessThanOrEqual(100);
        } else {
          expect(d.effectiveWeight).toBe(0);
        }
      }
      if (p.result.compositeScore !== null) {
        const eff = p.result.dimensions.reduce((s, d) => s + d.effectiveWeight, 0);
        expect(Math.abs(eff - 1)).toBeLessThan(0.01);
      } else {
        expect(p.result.grade).toBeNull();
        expect(p.result.unavailableReason).toBeTruthy();
      }
    }
  });

  it('writes the trusted measurement', () => {
    const tally = (xs: string[]) => {
      const t: Record<string, number> = {};
      for (const x of xs) t[x] = (t[x] ?? 0) + 1;
      return Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1]));
    };
    const dims = (k: string) => out.filter((p) => p.result.measured.includes(k as never)).length;
    const agg = {
      measuredAt: new Date().toISOString(),
      corpus: out.length,
      geography: {
        trusted: out.filter((p) => p.geography.trust === 'trusted').length,
        untrusted: out.filter((p) => p.geography.trust === 'untrusted').length,
        unavailable: out.filter((p) => p.geography.trust === 'unavailable').length,
        byCode: tally(out.map((p) => String(p.code))),
      },
      inputTrust: Object.fromEntries((['walk', 'commute', 'schools', 'price', 'rent'] as const).map((k) => [
        k, tally(out.map((p) => p[k].trust)),
      ])),
      trustedCoverage: {
        growth: dims('growth'), location: dims('location'), yield: dims('yield'),
        demand: dims('demand'), risk: dims('risk'),
      },
      dimensionCountDistribution: tally(out.map((p) => String(p.result.measured.length))),
      gradeEligible: out.filter((p) => p.result.grade !== null).length,
      gradeUnavailable: out.filter((p) => p.result.grade === null).length,
      noGradeReasons: tally(out.filter((p) => p.result.grade === null).map((p) => p.result.unavailableReason ?? '')),
      byState: Object.fromEntries([...new Set(out.map((p) => p.state))].map((st) => {
        const g = out.filter((p) => p.state === st);
        return [st, { reports: g.length, location: g.filter((p) => p.result.measured.includes('location' as never)).length,
                      yield: g.filter((p) => p.result.measured.includes('yield' as never)).length }];
      })),
      sampleLedgers: out.filter((_, i) => i % 97 === 0).slice(0, 12).map((p) => ({
        id: p.id, addr: p.addr, state: p.state,
        geographyTrust: p.geography.trust, geographyReason: p.geography.reason,
        entries: p.ledger.entries,
        measured: p.result.measured, grade: p.result.grade,
      })),
    };
    if (OUT) { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(agg, null, 2)); }
    expect(agg.corpus).toBeGreaterThan(0);
  });
});
