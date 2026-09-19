/**
 * The evidence-to-answer connection, exercised on what the registers really
 * answered for the two validation properties.
 *
 * Every reading below was retrieved on **18 September 2026** by
 * `scripts/verify/planning-probe/probe.ts`, which builds its URLs from
 * `planningConstraints.pure.ts` — so these are the queries the product makes,
 * not queries invented for a test. All six returned HTTP 200.
 *
 * | subject   | register                          | outcome                    | results |
 * | --------- | --------------------------------- | -------------------------- | ------: |
 * | Annabelle | NSW Principal Planning Layers     | answered_with_intersection |       4 |
 * | Annabelle | NSW Hazard                        | answered_no_intersection   |       0 |
 * | Annabelle | NSW Protection                    | answered_no_intersection   |       0 |
 * | Pallas    | QLD State Planning                | answered_with_intersection |       2 |
 * | Pallas    | QLD FloodCheck                    | answered_with_intersection |       1 |
 * | Pallas    | QLD MSES                          | answered_no_intersection   |       0 |
 *
 * The two subjects are genuinely different, which is the point: Annabelle's
 * hazard registers were asked and found nothing at the point, while Pallas sits
 * inside FloodCheck's `Lower Mary River` rapid hazard assessment. Before this
 * connection existed both reached the engine as the same empty literal.
 */

import { describe, expect, it } from 'vitest';
import {
  connectRiskEvidence,
  readStoredRiskReadings,
  CONVERSIONS,
  RISK_EVIDENCE_CONNECTION_VERSION,
  type RiskEvidenceReading,
} from '../../../../supabase/functions/_shared/reports/risk/riskEvidenceConnection.pure.ts';

/** The questions an established house is asked, from the schema. */
const HOUSE_QUESTIONS = ['site_hazard_exposure', 'planning_constraints', 'condition_and_maintenance'];

const ANNABELLE: RiskEvidenceReading[] = [
  {
    register: 'NSW Planning Portal — Principal Planning Layers',
    jurisdiction: 'NSW',
    licence: 'CC BY 4.0',
    outcome: 'answered_with_intersection',
    families: ['heritage', 'height', 'floorSpaceRatio', 'minimumLotSize', 'dwellingDensity', 'acquisition', 'foreshoreBuildingLine'],
    retrievedAt: '2026-09-18T04:31:10.981Z',
    findings: [
      {
        family: 'height', kind: 'control', label: 'The Hills Local Environmental Plan 2019',
        instrument: 'The Hills Local Environmental Plan 2019', clause: 'Clause 4.3',
        currencyDate: '2026-02-27', value: '10 m',
      },
      {
        family: 'minimumLotSize', kind: 'control', label: 'The Hills Local Environmental Plan 2019',
        instrument: 'The Hills Local Environmental Plan 2019', currencyDate: '2026-08-07', value: '700 m²',
      },
    ],
  },
  {
    register: 'NSW Planning Portal — Hazard',
    jurisdiction: 'NSW',
    licence: 'CC BY 4.0',
    outcome: 'answered_no_intersection',
    families: ['bushfire', 'flood', 'landslide'],
    retrievedAt: '2026-09-18T04:31:12.402Z',
    findings: [],
  },
  {
    register: 'NSW Planning Portal — Protection',
    jurisdiction: 'NSW',
    licence: 'CC BY 4.0',
    outcome: 'answered_no_intersection',
    families: ['acidSulfateSoils', 'airportNoise'],
    retrievedAt: '2026-09-18T04:31:13.510Z',
    findings: [],
  },
];

const PALLAS: RiskEvidenceReading[] = [
  {
    register: 'Queensland FloodCheck — Rapid Hazard Assessment',
    jurisdiction: 'QLD',
    licence: 'CC BY 4.0',
    outcome: 'answered_with_intersection',
    families: ['flood'],
    retrievedAt: '2026-09-18T04:31:17.697Z',
    findings: [{ family: 'flood', kind: 'hazard', label: 'Lower Mary River' }],
  },
  {
    register: 'Queensland Matters of State Environmental Significance',
    jurisdiction: 'QLD',
    licence: 'CC BY 4.0',
    outcome: 'answered_no_intersection',
    families: ['biodiversity', 'wetlands'],
    retrievedAt: '2026-09-18T04:31:19.104Z',
    findings: [],
  },
];

describe('the connection replaces the hardcoded empty answer set', () => {
  it('produces no answer while no conversion is approved, and says so per question', () => {
    const c = connectRiskEvidence(HOUSE_QUESTIONS, ANNABELLE);
    expect(c.answers).toEqual({});
    const hazard = c.questions.find((q) => q.questionId === 'site_hazard_exposure')!;
    // Asked at the point, nothing intersected. That is evidence, not a clearance.
    expect(hazard.refusal).toBe('registers_answered_no_intersection');
    expect(hazard.statement).toContain('not a clearance for the parcel');
  });

  it('separates evidence held from evidence never sought', () => {
    const held = connectRiskEvidence(HOUSE_QUESTIONS, ANNABELLE)
      .questions.find((q) => q.questionId === 'planning_constraints')!;
    // NSW returned a height control and a minimum lot size at this point.
    expect(held.refusal).toBe('evidence_held_no_approved_conversion');

    const nothingRun = connectRiskEvidence(HOUSE_QUESTIONS, [])
      .questions.find((q) => q.questionId === 'planning_constraints')!;
    expect(nothingRun.refusal).toBe('not_acquired');
    expect(held.refusal).not.toBe(nothingRun.refusal);
  });

  it('tells the two subjects apart — Pallas holds a flood finding, Annabelle does not', () => {
    const pallas = connectRiskEvidence(HOUSE_QUESTIONS, PALLAS)
      .questions.find((q) => q.questionId === 'site_hazard_exposure')!;
    const annabelle = connectRiskEvidence(HOUSE_QUESTIONS, ANNABELLE)
      .questions.find((q) => q.questionId === 'site_hazard_exposure')!;

    expect(pallas.refusal).toBe('evidence_held_no_approved_conversion');
    expect(annabelle.refusal).toBe('registers_answered_no_intersection');
    expect(pallas.readings.flatMap((r) => r.findings).map((f) => f.label)).toContain('Lower Mary River');
    expect(annabelle.readings.flatMap((r) => r.findings)).toHaveLength(0);
  });

  it('records a failed register as unavailable, never as nothing found', () => {
    const failed: RiskEvidenceReading[] = [{
      ...ANNABELLE[1], outcome: 'request_failed', retrievedAt: '2026-09-18T04:31:12.402Z',
      failureDetail: 'HTTP 503',
    }];
    const q = connectRiskEvidence(HOUSE_QUESTIONS, failed)
      .questions.find((x) => x.questionId === 'site_hazard_exposure')!;
    expect(q.refusal).toBe('register_unavailable');
    expect(q.statement).toContain('did not complete');
  });

  it('knows whether any register completed at all', () => {
    expect(connectRiskEvidence(HOUSE_QUESTIONS, ANNABELLE).anyRegisterCompleted).toBe(true);
    expect(connectRiskEvidence(HOUSE_QUESTIONS, []).anyRegisterCompleted).toBe(false);
  });

  it('leaves a question no register can inform as not acquired', () => {
    // No register in this path speaks to building condition.
    const q = connectRiskEvidence(HOUSE_QUESTIONS, ANNABELLE)
      .questions.find((x) => x.questionId === 'condition_and_maintenance')!;
    expect(q.refusal).toBe('not_acquired');
    expect(q.readings).toHaveLength(0);
  });
});

describe('activation is a visible act', () => {
  it('declares no approved conversion', () => {
    // A conversion here is a methodology decision with a document behind it.
    // This assertion is what makes adding one impossible to do quietly.
    expect(Object.keys(CONVERSIONS)).toHaveLength(0);
  });

  it('carries a version, so a stored assessment names its basis', () => {
    expect(RISK_EVIDENCE_CONNECTION_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(connectRiskEvidence(HOUSE_QUESTIONS, ANNABELLE).version)
      .toBe(RISK_EVIDENCE_CONNECTION_VERSION);
  });
});

describe('reading a stored evidence block', () => {
  it('round-trips what the probe wrote', () => {
    const stored = { registers: ANNABELLE };
    expect(readStoredRiskReadings(stored)).toHaveLength(3);
    expect(readStoredRiskReadings(stored)[0].register).toContain('Principal Planning');
  });

  it('refuses a row whose outcome is not one of the five', () => {
    const stored = { registers: [{ ...ANNABELLE[0], outcome: 'looks_fine' }] };
    expect(readStoredRiskReadings(stored)).toHaveLength(0);
  });

  it('answers empty for a legacy row that carries none', () => {
    expect(readStoredRiskReadings(null)).toEqual([]);
    expect(readStoredRiskReadings({})).toEqual([]);
  });
});

describe('one answered register must not conceal one that failed', () => {
  // The aggregation defect: `refusalFor` returned
  // `registers_answered_no_intersection` as soon as ANY register answered, so
  // a sibling that 503'd or was never run vanished from the verdict and a
  // partial sweep was reported as a completed one. HTTP 200 establishes that a
  // register RESPONDED; it never establishes that the question was covered.
  const hazardOnly = (outcome: RiskEvidenceReading['outcome'], register: string) => ({
    ...ANNABELLE[1], register, outcome,
  });

  it('reads a partial sweep as incomplete, not as nothing found', () => {
    const q = connectRiskEvidence(HOUSE_QUESTIONS, [
      hazardOnly('answered_no_intersection', 'NSW Hazard'),
      hazardOnly('request_failed', 'NSW Protection'),
    ]).questions.find((x) => x.questionId === 'site_hazard_exposure')!;

    expect(q.refusal).toBe('registers_incomplete');
    expect(q.coverage.complete).toBe(false);
    expect(q.coverage.answered).toBe(1);
    expect(q.coverage.failed).toBe(1);
    expect(q.coverage.incomplete).toEqual(['NSW Protection']);
    expect(q.statement).toContain('NSW Protection');
  });

  it('reads the same two registers as a finding once both complete', () => {
    const q = connectRiskEvidence(HOUSE_QUESTIONS, [
      hazardOnly('answered_no_intersection', 'NSW Hazard'),
      hazardOnly('answered_no_intersection', 'NSW Protection'),
    ]).questions.find((x) => x.questionId === 'site_hazard_exposure')!;

    expect(q.refusal).toBe('registers_answered_no_intersection');
    expect(q.coverage.complete).toBe(true);
    expect(q.coverage.incomplete).toHaveLength(0);
  });

  it('treats a register that was never run the same as one that failed', () => {
    const q = connectRiskEvidence(HOUSE_QUESTIONS, [
      hazardOnly('answered_no_intersection', 'NSW Hazard'),
      hazardOnly('not_run', 'NSW Protection'),
    ]).questions.find((x) => x.questionId === 'site_hazard_exposure')!;
    expect(q.refusal).toBe('registers_incomplete');
    expect(q.coverage.notRun).toBe(1);
  });

  it('keeps coverage beside a verdict chosen for another reason', () => {
    // A positive finding is still why there is no answer — the conversion is
    // missing, not the evidence — and the partial sweep must still be visible.
    const q = connectRiskEvidence(HOUSE_QUESTIONS, [
      { ...ANNABELLE[1], register: 'QLD FloodCheck', outcome: 'answered_with_intersection',
        findings: [{ family: 'flood', kind: 'hazard', label: 'Lower Mary River' }] },
      hazardOnly('request_failed', 'QLD Landslide'),
    ]).questions.find((x) => x.questionId === 'site_hazard_exposure')!;

    expect(q.refusal).toBe('evidence_held_no_approved_conversion');
    expect(q.coverage.complete).toBe(false);
    expect(q.statement).toContain('Coverage is incomplete');
    expect(q.statement).toContain('QLD Landslide');
  });

  it('retains every reading, whatever the verdict', () => {
    const readings = [
      hazardOnly('answered_no_intersection', 'A'),
      hazardOnly('request_failed', 'B'),
      hazardOnly('not_run', 'C'),
    ];
    const q = connectRiskEvidence(HOUSE_QUESTIONS, readings)
      .questions.find((x) => x.questionId === 'site_hazard_exposure')!;
    expect(q.readings).toHaveLength(3);
    expect(q.coverage.consulted).toBe(3);
  });

  it('carries coverage on a question nothing was consulted for', () => {
    const q = connectRiskEvidence(HOUSE_QUESTIONS, [])
      .questions.find((x) => x.questionId === 'site_hazard_exposure')!;
    expect(q.coverage.consulted).toBe(0);
    // Nothing consulted is not a complete sweep of nothing.
    expect(q.coverage.complete).toBe(false);
    expect(q.refusal).toBe('not_acquired');
  });

  it('reads the two real subjects exactly as before — the fix changes no complete sweep', () => {
    const annabelle = connectRiskEvidence(HOUSE_QUESTIONS, ANNABELLE);
    const hazard = annabelle.questions.find((q) => q.questionId === 'site_hazard_exposure')!;
    expect(hazard.refusal).toBe('registers_answered_no_intersection');
    expect(hazard.coverage.complete).toBe(true);

    const pallas = connectRiskEvidence(HOUSE_QUESTIONS, PALLAS);
    expect(pallas.questions.find((q) => q.questionId === 'site_hazard_exposure')!.refusal)
      .toBe('evidence_held_no_approved_conversion');
  });
});
