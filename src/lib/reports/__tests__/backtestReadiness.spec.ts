/**
 * ME-4 — the ingestion contract, the resolver and the calibration diagnostics.
 *
 * ## THESE ARE NOT MARKET EVIDENCE
 *
 * Every record below is a synthetic fixture constructed to exercise a rule.
 * The diagnostic tests build distributions with a KNOWN defect in order to
 * prove the harness detects it — a fixture that reproduces the §48 shape is a
 * test of the detector, not a finding about any market.
 */
import { describe, expect, it } from 'vitest';

import {
  type EvidenceRecord,
  deliveryUsage,
  ingestEvidenceRecords,
  validateRecord,
} from '../market/evidenceIngestion.pure';
import { resolveBacktestInput, buildReadinessMatrix } from '../market/backtestInput.pure';
import { type BacktestRow, buildDistributions, diagnose } from '../market/backtestHarness.pure';
import type { EvidenceSubject } from '../market/marketEvidence.pure';

const SUBJECT: EvidenceSubject = {
  suburb: 'Fixtureville', postcode: '0000', state: 'NA',
  dwellingType: 'house', resolvedFrom: 'coordinate',
};

const rec = (o: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  provider: 'domain', licensingStatus: 'licensed_for_client_reports', route: 'licensed_csv',
  level: 'suburb', areaName: 'Fixtureville', suburb: 'Fixtureville', postcode: '0000', state: 'NA',
  dwellingType: 'house', asOf: '2026-Q2', measure: 'growth5YearCagr', value: 7.5,
  sampleSize: 60, method: 'observed', sourceNote: null, ...o,
});

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

describe('a delivery is licensed per row, not per file', () => {
  it('accepts a licensed export with no API involved', () => {
    const r = ingestEvidenceRecords(SUBJECT, [
      rec({ measure: 'growth5YearCagr', value: 7.5 }),
      rec({ measure: 'growth3YearCagr', value: 8.1 }),
      rec({ measure: 'vacancyRate', value: 1.2 }),
    ]);
    expect(r.accepted).toBe(3);
    expect(r.rejected).toHaveLength(0);
    expect(r.evidence.growth5YearCagr?.value).toBe(7.5);
    expect(r.routes).toEqual(['licensed_csv']);
    expect(deliveryUsage(r).clientReports).toBe(true);
  });

  it('scores an unverified row and refuses it a client document', () => {
    const r = ingestEvidenceRecords(SUBJECT, [
      rec({ measure: 'growth5YearCagr', licensingStatus: 'open', provider: 'abs_res_dwell' }),
      rec({ measure: 'medianPrice', value: 900_000, licensingStatus: 'unverified', provider: 'cotality' }),
    ]);
    expect(r.accepted).toBe(2);
    expect(r.clientRenderable).toBe(1);
    expect(r.withheldByProvider.cotality).toBe(1);
    const usage = deliveryUsage(r);
    expect(usage.shadowScoring).toBe(true);
    expect(usage.clientReports).toBe(false);
    expect(usage.summary).toMatch(/may NOT appear in a client document/);
  });

  it('rejects a row for the specific column that is wrong', () => {
    const cases: Array<[Partial<EvidenceRecord>, string]> = [
      [{ measure: 'notAMeasure' as never }, 'unknown_measure'],
      [{ level: 'galaxy' as never }, 'unknown_level'],
      [{ value: Number.NaN }, 'non_finite_value'],
      [{ asOf: '' }, 'missing_as_of'],
      [{ areaName: '' }, 'missing_area'],
      [{ level: 'suburb', suburb: null, postcode: null }, 'ambiguous_geography'],
    ];
    for (const [patch, reason] of cases) {
      const failure = validateRecord(rec(patch), 0);
      expect(failure?.reason).toBe(reason);
      expect(failure?.detail.length).toBeGreaterThan(15);
    }
  });

  it('admits a measured zero and refuses a blank', () => {
    expect(validateRecord(rec({ value: 0 }), 0)).toBeNull();
    expect(validateRecord(rec({ value: Number.NaN }), 0)?.reason).toBe('non_finite_value');
  });

  it('never infers a licence from the absence of one', () => {
    const failure = validateRecord(rec({ licensingStatus: undefined as never }), 0);
    expect(failure?.reason).toBe('missing_licence');
  });
});

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

describe('geography is proved, never inferred', () => {
  const coordsOnly = {
    id: 'r1',
    property_address: '12 Example Street, Somewhere NSW 2000',
    location_intelligence: { coordinates: { lat: -33.8, lng: 151.2 }, walkScore: 88 },
  };

  it('refuses to take a suburb from the address label', () => {
    const r = resolveBacktestInput(coordsOnly);
    expect(r.suburb.value).toBeNull();
    expect(r.geography).toBe('coordinates_only');
    expect(r.readiness).toBe('unresolved_geography');
    // The label is carried for a human, and used for nothing.
    expect(r.addressLabel).toContain('Example Street');
  });

  it('resolves geography when the record actually proves it', () => {
    const r = resolveBacktestInput({
      ...coordsOnly,
      location_intelligence: {
        ...coordsOnly.location_intelligence,
        suburb: 'Somewhere', postcode: '2000', state: 'NSW',
      },
    });
    expect(r.geography).toBe('resolved');
    expect(r.suburb.sourcePath).toBe('location_intelligence.suburb');
  });

  it('sums land and build for a house-and-land package, and says it summed', () => {
    const r = resolveBacktestInput({
      id: 'r2',
      financial_calculations: { initialCosts: { landPrice: 320_000, buildPrice: 410_000 } },
    });
    expect(r.purchasePrice.value).toBe(730_000);
    expect(r.purchasePrice.sourcePath).toContain('landPrice + buildPrice');
  });

  it('treats a placeholder dwelling type as absent', () => {
    const r = resolveBacktestInput({ id: 'r3', property_specs: { property_type: 'Residential Property' } });
    expect(r.gaps).toContain('dwelling_type');
  });

  it('reports which path each field came from', () => {
    const m = buildReadinessMatrix([resolveBacktestInput(coordsOnly)]);
    expect(m.total).toBe(1);
    expect(m.byGeography.coordinates_only).toBe(1);
    expect(m.pathsUsed.walkScore['location_intelligence.walkScore']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Calibration diagnostics
// ---------------------------------------------------------------------------

const row = (o: Partial<BacktestRow> = {}): BacktestRow => ({
  reportId: 'x', state: 'NSW', suburb: 's', dwellingType: 'house',
  v1Score: 60, v1Grade: 'B', v2Score: 60, uncappedGrade: 'B', finalGrade: 'B', capReason: [],
  growth: 60, growthConfidence: 80, growthCoverage: 1, demand: 60, demandConfidence: 80,
  location: 60, yieldScore: 60, risk: 60,
  evidenceCoverage: 1, measuredDimensions: 5, providers: ['domain'], ...o,
});

describe('the diagnostics detect the failures this programme has already met', () => {
  it('detects one state dominating the top grades — the §48 shape', () => {
    const rows = [
      ...Array.from({ length: 12 }, () => row({ state: 'WA', v2Score: 88, finalGrade: 'A+' })),
      ...Array.from({ length: 40 }, () => row({ state: 'NSW', v2Score: 55, finalGrade: 'B' })),
    ];
    const d = diagnose(rows);
    const hit = d.find((x) => x.key === 'state_domination');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('serious');
    expect(hit!.measurement).toContain('WA');
  });

  it('detects a high score built by renormalising a minority of the evidence', () => {
    const rows = Array.from({ length: 10 }, () =>
      row({ v2Score: 86, finalGrade: 'A+', evidenceCoverage: 0.35 }));
    expect(diagnose(rows).some((x) => x.key === 'renormalisation_highs')).toBe(true);
  });

  it('detects a top grade awarded on low confidence', () => {
    const rows = [
      ...Array.from({ length: 6 }, () => row({ finalGrade: 'A', v2Score: 78, growthConfidence: 20 })),
      ...Array.from({ length: 20 }, () => row()),
    ];
    expect(diagnose(rows).some((x) => x.key === 'top_grade_low_confidence')).toBe(true);
  });

  it('detects compression and single-grade collapse', () => {
    const rows = Array.from({ length: 30 }, () => row({ v2Score: 61, finalGrade: 'B' }));
    const keys = diagnose(rows).map((x) => x.key);
    expect(keys).toContain('compression');
    expect(keys).toContain('single_grade_collapse');
  });

  it('detects inflation', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row({ v2Score: 74 + (i % 5), finalGrade: i % 2 ? 'A' : 'B+' }));
    expect(diagnose(rows).some((x) => x.key === 'inflation')).toBe(true);
  });

  it('says so plainly when nothing is wrong', () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row({ v2Score: 30 + i, state: ['NSW', 'VIC', 'QLD', 'WA'][i % 4],
            finalGrade: ['F', 'D', 'C', 'B', 'B+', 'A'][i % 6] }));
    const d = diagnose(rows);
    expect(d.some((x) => x.severity === 'serious')).toBe(false);
  });

  it('reports rather than adjusts — no diagnostic changes a score', () => {
    const rows = Array.from({ length: 10 }, () =>
      row({ v2Score: 86, finalGrade: 'A+', evidenceCoverage: 0.3 }));
    const before = rows.map((r) => r.v2Score);
    diagnose(rows);
    expect(rows.map((r) => r.v2Score)).toEqual(before);
  });

  it('refuses to read a distribution it was given nothing for', () => {
    const d = diagnose([]);
    expect(d).toHaveLength(1);
    expect(d[0].key).toBe('no_scored_rows');
  });

  it('builds the distributions the calibration decision needs', () => {
    const rows = [
      row({ state: 'NSW', finalGrade: 'A+', v2Score: 90, dwellingType: 'house' }),
      row({ state: 'VIC', finalGrade: 'B', v2Score: 58, dwellingType: 'unit' }),
      row({ state: 'NSW', finalGrade: 'A', v2Score: 78, dwellingType: 'house' }),
    ];
    const d = buildDistributions(rows);
    expect(d.aPlusCount).toBe(1);
    expect(d.aCount).toBe(1);
    expect(d.topGradesByState.NSW).toBe(2);
    expect(d.dwellingCounts.house).toBe(2);
    expect(d.scoreHistogram['90-99']).toBe(1);
    expect(d.providerCounts.domain).toBe(3);
  });
});
