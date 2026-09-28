/**
 * Property Risk scores in production once it holds both of its categories —
 * and never before.
 *
 * `riskModelD` needs observations spanning two independent categories. On
 * 28 Sep 2026 the platform owner approved both conversions: the SITE category
 * is answered from the planning registers the generator already acquires
 * (`siteConstraintSeverity`), and the BUILDING category from a condition
 * record filed on the report page (`conditionRecord`). What this file pins is
 * the wiring the engine suites cannot see: that `scoreForProduction` reads
 * both from the request the scoring service assembles, that either alone
 * leaves Risk excluded exactly as before, and that the storage path a
 * submission may name is only ever one issued for the same report.
 */
import { describe, expect, it } from 'vitest';

import { scoreForProduction, type ProductionScoringInput } from '../market/scoringV2Production.pure';
import type { EvidencePoint, EvidenceSubject } from '../market/marketEvidence.pure';
import { riskReadingsFromPlanning } from '../../../../supabase/functions/_shared/reports/risk/riskEvidenceConnection.pure.ts';
import type { ConditionRecord } from '../../../../supabase/functions/_shared/reports/risk/conditionRecord.pure.ts';
import {
  bestReadingForSubject,
  conditionDocumentPath,
  isConditionDocumentPathFor,
  parseConditionSubmission,
  rowFromRecord,
  safeConditionFileName,
} from '../../../../supabase/functions/_shared/reports/risk/conditionRecordSubmission.pure.ts';

const NOW = new Date('2026-09-28T10:00:00Z');
const ADDRESS = '18 Annabelle Crescent, Kellyville NSW 2155';
const REPORT = '0b6f6f2e-8f1a-4d7e-9a53-2f1e4c0d9a11';

const subject = (): EvidenceSubject => ({
  suburb: 'Kellyville', postcode: '2155', state: 'NSW', dwellingType: 'house', resolvedFrom: 'coordinate',
});

const pt = (value: number, o: Partial<EvidencePoint> = {}): EvidencePoint => ({
  value, level: 'suburb', areaName: 'Kellyville NSW 2155', dwellingType: 'house',
  dwellingTypeMatched: true, provider: 'domain', asOf: '2026-06-01',
  sampleSize: 140, periodsAvailable: 12, method: 'calculated',
  licensingStatus: 'unverified', acquisition: 'existing_licensed', sourceNote: null, ...o,
});

const base = (over: Partial<ProductionScoringInput> = {}): ProductionScoringInput => ({
  subject: subject(),
  market: {
    points: {
      medianPrice: pt(1_650_000),
      growth1Year: pt(6.7),
      growth3YearCagr: pt(6.3),
      growth5YearCagr: pt(6.1),
      growth10YearCagr: pt(5.8),
    },
    providersConsulted: ['domain'],
    providersUnavailable: [],
  },
  property: { price: 1_650_000, weeklyRent: 1_000, propertyType: 'House' },
  finance: { lvr: 80, weeklyCashFlow: -420 },
  now: NOW,
  ...over,
});

/** `enhancedData.planningData` as planning-data-service stores it. */
const PLANNING = {
  jurisdiction: 'NSW',
  fetchedAt: '2026-09-28T04:31:10.981Z',
  constraintsAsked: ['height', 'minimumLotSize', 'bushfire', 'flood'],
  constraintRegisters: {
    answered: ['NSW Planning Portal — Principal Planning Layers', 'NSW Planning Portal — Hazard'],
    unavailable: [],
  },
  constraints: [
    {
      source: 'NSW Planning Portal — Principal Planning Layers', licence: 'CC BY 4.0',
      family: 'height', kind: 'control', label: 'The Hills Local Environmental Plan 2019',
      clause: 'Clause 4.3', value: '10 m',
    },
    {
      source: 'NSW Planning Portal — Principal Planning Layers', licence: 'CC BY 4.0',
      family: 'minimumLotSize', kind: 'control', label: 'The Hills Local Environmental Plan 2019',
      value: '700 m²',
    },
  ],
};

const inspection = (over: Partial<ConditionRecord> = {}): ConditionRecord => ({
  document: {
    kind: 'building_inspection',
    issuer: 'Hunter Building Consultants',
    issuerLicence: 'NSW 123456C',
    issuedOn: '2026-06-02',
    inspectedOn: '2026-05-29',
  },
  subject: { propertyAddress: ADDRESS, propertyId: null, reportId: REPORT },
  scope: 'Interior, exterior, roof void and subfloor.',
  scopeCoverage: 'whole_dwelling',
  exclusions: [],
  conclusion: 'no_defects_identified',
  findings: [],
  verification: 'document_held',
  ...over,
});

const readingOf = (record: ConditionRecord) =>
  bestReadingForSubject([record], { propertyAddress: ADDRESS, propertyId: null, reportId: REPORT }, NOW.toISOString());

describe('Risk scores only when both of its categories answered', () => {
  it('stays excluded with neither — the record every existing report already carries', () => {
    const record = scoreForProduction(base());
    expect(record.breakdown.riskScore.excluded).toBe(true);
  });

  it('stays excluded on the site alone — planning is one category however well retrieved', () => {
    const record = scoreForProduction(base({ planning: PLANNING }));
    expect(record.breakdown.riskScore.excluded).toBe(true);
  });

  it('stays excluded on the building alone', () => {
    const record = scoreForProduction(base({ condition: readingOf(inspection()) }));
    expect(record.breakdown.riskScore.excluded).toBe(true);
  });

  it('scores with the planning answer and an admissible whole-dwelling inspection', () => {
    const reading = readingOf(inspection());
    expect(reading?.admissible).toBe(true);
    const record = scoreForProduction(base({ planning: PLANNING, condition: reading }));
    expect(record.breakdown.riskScore.excluded).toBe(false);
    expect(record.breakdown.riskScore.hasData).toBe(true);
    expect(record.breakdown.riskScore.score).toBeGreaterThan(0);
    expect(record.gradeGaps.map((g) => g.dimension)).not.toContain('risk');
  });

  it('a transcription alone is evidence, never an observation — Risk stays excluded', () => {
    const reading = readingOf(inspection({ verification: 'transcribed_only' }));
    expect(reading?.admissible).toBe(false);
    const record = scoreForProduction(base({ planning: PLANNING, condition: reading }));
    expect(record.breakdown.riskScore.excluded).toBe(true);
  });

  it('a document identifying a different property never binds', () => {
    const reading = readingOf(inspection({
      subject: { propertyAddress: '9 Hollow Street, Golden Square VIC 3555', propertyId: null, reportId: null },
    }));
    expect(reading).toBeNull();
  });

  it('a major defect lowers the building answer, and so the dimension', () => {
    const clean = scoreForProduction(base({ planning: PLANNING, condition: readingOf(inspection()) }));
    const defective = scoreForProduction(base({
      planning: PLANNING,
      condition: readingOf(inspection({
        conclusion: 'defects_identified',
        findings: [{ element: 'Roof framing', severity: 'major_defect' }],
      })),
    }));
    expect(defective.breakdown.riskScore.excluded).toBe(false);
    expect(defective.breakdown.riskScore.score).toBeLessThan(clean.breakdown.riskScore.score);
  });

  it('the property grade never moves on the buyer\'s leverage, with Risk scored', () => {
    const a = scoreForProduction(base({ planning: PLANNING, condition: readingOf(inspection()), finance: { lvr: 60, weeklyCashFlow: 100 } }));
    const b = scoreForProduction(base({ planning: PLANNING, condition: readingOf(inspection()), finance: { lvr: 95, weeklyCashFlow: -900 } }));
    expect(a.totalScore).toBe(b.totalScore);
    expect(a.grade).toBe(b.grade);
  });
});

describe('planning readings, as the generator stores them', () => {
  it('reads an answered register with its findings', () => {
    const r = riskReadingsFromPlanning(PLANNING);
    const principal = r.find((x) => x.register.includes('Principal'))!;
    expect(principal.outcome).toBe('answered_with_intersection');
    expect(principal.findings.map((f) => f.family)).toEqual(['height', 'minimumLotSize']);
    const hazard = r.find((x) => x.register.includes('Hazard'))!;
    expect(hazard.outcome).toBe('answered_no_intersection');
  });

  it('a register that failed is a failure, never an empty answer', () => {
    const r = riskReadingsFromPlanning({ ...PLANNING, constraintRegisters: { answered: [], unavailable: ['NSW Planning Portal — Hazard'] }, constraints: [] });
    expect(r).toHaveLength(1);
    expect(r[0].outcome).toBe('request_failed');
  });

  it('reads nothing from nothing', () => {
    expect(riskReadingsFromPlanning(null)).toEqual([]);
    expect(riskReadingsFromPlanning('planning')).toEqual([]);
  });
});

describe('the uploaded document is only ever one issued for the same report', () => {
  const OBJECT = '6e1c7a64-3d0f-4b3f-8e1a-1f7d2a9b4c55';

  it('builds a path inside the report\'s own folder, with a safe file name', () => {
    const path = conditionDocumentPath(REPORT, OBJECT, '../../Inspection Report (final).pdf');
    expect(path).toBe(`condition-documents/${REPORT}/${OBJECT}-Inspection-Report-final-.pdf`);
    expect(isConditionDocumentPathFor(path, REPORT)).toBe(true);
    expect(safeConditionFileName('')).toBe('document');
  });

  it('refuses a path under another report, a traversal, a foreign type or a non-id', () => {
    const other = '11111111-2222-4333-8444-555555555555';
    expect(isConditionDocumentPathFor(conditionDocumentPath(other, OBJECT, 'a.pdf'), REPORT)).toBe(false);
    expect(isConditionDocumentPathFor(`condition-documents/${REPORT}/../x/${OBJECT}-a.pdf`, REPORT)).toBe(false);
    expect(isConditionDocumentPathFor(`condition-documents/${REPORT}/${OBJECT}-a.exe`, REPORT)).toBe(false);
    expect(isConditionDocumentPathFor(`report-photographs/${REPORT}/${OBJECT}-a.pdf`, REPORT)).toBe(false);
    expect(conditionDocumentPath('not-an-id', OBJECT, 'a.pdf')).toBeNull();
  });

  it('a held-document claim is satisfied by an uploaded document, and the path reaches the row', () => {
    const path = conditionDocumentPath(REPORT, OBJECT, 'report.pdf')!;
    const parsed = parseConditionSubmission({
      documentKind: 'building_inspection', issuer: 'Hunter Building Consultants', issuedOn: '2026-06-02',
      documentPropertyAddress: ADDRESS, scopeCoverage: 'whole_dwelling', conclusion: 'no_defects_identified',
      verification: 'document_held', documentPath: path,
    }, { reportId: REPORT });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const row = rowFromRecord(parsed.record, { reportId: REPORT, documentPath: path, recordedBy: 'u' });
    expect(row.document_path).toBe(path);
    expect(row.file_id).toBeNull();
  });

  it('refuses a submission naming a document uploaded against another report', () => {
    const other = '11111111-2222-4333-8444-555555555555';
    const parsed = parseConditionSubmission({
      documentKind: 'building_inspection', issuer: 'X', issuedOn: '2026-06-02', documentPropertyAddress: ADDRESS,
      verification: 'document_held', documentPath: conditionDocumentPath(other, OBJECT, 'a.pdf'),
    }, { reportId: REPORT });
    expect(parsed.ok).toBe(false);
  });
});
