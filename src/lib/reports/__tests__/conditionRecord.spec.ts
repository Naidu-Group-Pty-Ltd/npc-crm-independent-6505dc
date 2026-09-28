/**
 * The condition-record validator — what it must refuse before the method can
 * be put up for activation.
 *
 * Each `describe` below corresponds to a case v1.0.0 accepted and should not
 * have. v1 admitted a record on four checks — an admissible `kind`, a
 * non-empty `issuer`, a parseable date and a non-empty `scope` string — and
 * every one of those is satisfiable by a document that establishes nothing
 * about the dwelling, at which point it took the reference score.
 *
 * The rule the whole file is about: **a recorded defect is admissible from any
 * accountable document; a stated absence of defects is a determination, and
 * only a dwelling inspection over a wide enough recorded scope may supply
 * one.** A document TYPE, an issuer NAME and a non-empty scope FIELD do not
 * establish that a qualified person inspected the dwelling.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADMISSIBLE_SOURCES,
  CONDITION_METHOD_ACTIVATION,
  CONDITION_MAX_AGE_MONTHS,
  CONDITION_RECORD_METHOD_VERSION,
  CONDITION_REFERENCE,
  ESTABLISHES,
  FINDING_SEVERITIES,
  INADMISSIBLE_SOURCES,
  MAX_MINOR_DEDUCTION,
  SEVERITY_DEDUCTION,
  assessConditionRecord,
  bestConditionRecord,
  convertFindings,
  isFindingSeverity,
  type ConditionRecord,
} from '../../../../supabase/functions/_shared/reports/risk/conditionRecord.pure.ts';

const ASOF = '2026-09-18T00:00:00.000Z';

const SUBJECT = {
  propertyAddress: '18 Annabelle Crescent, Kellyville NSW 2155',
  propertyId: 'prop-annabelle',
};

/** A record that clears every rule — the control the refusals are measured against. */
const inspection = (over: Partial<ConditionRecord> = {}): ConditionRecord => ({
  document: {
    kind: 'building_inspection',
    issuer: 'Hunter Building Consultants',
    issuerLicence: 'NSW 123456C',
    issuedOn: '2026-06-02',
    inspectedOn: '2026-05-29',
    reference: 'HBC-2026-4417',
  },
  subject: SUBJECT,
  scope: 'Interior, exterior, roof void and subfloor of the dwelling, and the detached garage.',
  scopeCoverage: 'whole_dwelling',
  exclusions: ['Areas concealed by stored goods in the garage.'],
  conclusion: 'no_defects_identified',
  findings: [],
  verification: 'document_held',
  recordedBy: 'operator',
  recordedAt: '2026-06-03',
  ...over,
});

const refusalOf = (r: ConditionRecord | null, over: Parameters<typeof assessConditionRecord>[2] = {}) =>
  assessConditionRecord(r, ASOF, over).refusal;

describe('the control record is admissible, so every refusal below is the rule and not the fixture', () => {
  it('accepts a whole-dwelling inspection that concluded no defects', () => {
    const r = assessConditionRecord(inspection(), ASOF, { expectedSubject: SUBJECT });
    expect(r.refusal).toBeNull();
    expect(r.admissible).toBe(true);
    expect(r.scopeCoverage).toBe('whole_dwelling');
    expect(r.exclusions).toHaveLength(1);
    expect(r.statement).toContain('the whole dwelling');
  });
});

describe('dates must describe one examination that has happened', () => {
  it('refuses a document issued after the assessment', () => {
    expect(refusalOf(inspection({
      document: { ...inspection().document, issuedOn: '2027-06-02', inspectedOn: '2027-05-29' },
    }))).toBe('issued_in_future');
  });

  it('refuses an inspection dated after the assessment, and says which fault it is', () => {
    // Both faults are present here — the inspection is in the future AND after
    // the issue. The future reading is the more specific diagnosis and is
    // checked first, so an operator is sent to the date that cannot be right
    // rather than to the ordering.
    expect(refusalOf(inspection({
      document: { ...inspection().document, issuedOn: '2026-06-02', inspectedOn: '2027-01-04' },
    }))).toBe('inspected_in_future');
  });

  it('refuses an inspection recorded AFTER the report on it', () => {
    // A report cannot describe an examination that had not happened when it
    // was written. This is a transcription error or a document describing
    // something it did not see; either way it is not one examination.
    expect(refusalOf(inspection({
      document: { ...inspection().document, issuedOn: '2026-03-01', inspectedOn: '2026-05-29' },
    }))).toBe('inspected_after_issue');
  });

  it('refuses an unreadable inspection date rather than falling back to the issue date', () => {
    expect(refusalOf(inspection({
      document: { ...inspection().document, inspectedOn: 'last autumn' },
    }))).toBe('undated');
  });

  it('measures age from the EXAMINATION, not the issue', () => {
    const r = assessConditionRecord(inspection({
      document: { ...inspection().document, issuedOn: '2024-01-10', inspectedOn: '2023-06-01' },
    }), ASOF);
    expect(r.refusal).toBe('out_of_currency');
    // 2023-06-01 → 2026-09-18 is over three years; the issue date alone is not.
    expect(r.ageMonths!).toBeGreaterThan(CONDITION_MAX_AGE_MONTHS);
  });
});

describe('an empty findings list is not a conclusion', () => {
  it('refuses a record whose findings are empty because nothing was extracted', () => {
    // The exact shape a failed extraction produces: a real document, a real
    // scope, and an empty array nobody concluded anything from.
    expect(refusalOf(inspection({ conclusion: undefined }))).toBe('conclusion_not_stated');
    expect(refusalOf(inspection({ conclusion: 'not_concluded' }))).toBe('conclusion_not_stated');
  });

  it('accepts findings from a record with no conclusion — a defect is a defect', () => {
    // The asymmetry: the document recorded a problem. Its silence on a
    // conclusion limits what else it can say, not whether the finding is real.
    const r = assessConditionRecord(inspection({
      conclusion: undefined,
      findings: [{ element: 'Subfloor bearer', severity: 'major_defect' }],
    }), ASOF);
    expect(r.refusal).toBeNull();
    expect(r.admissible).toBe(true);
  });

  it('will not read a scope LABEL as a recorded scope', () => {
    for (const scope of ['n/a', 'N/A', '-', 'TBC', 'unknown', 'inspection']) {
      expect(refusalOf(inspection({ scope })), scope).toBe('scope_not_recorded');
    }
  });

  it('refuses a document whose coverage is not recorded at all', () => {
    expect(refusalOf(inspection({ scopeCoverage: undefined }))).toBe('scope_coverage_not_recorded');
  });
});

describe('a document establishes only what its kind and scope can establish', () => {
  it('refuses a clean vendor statement — disclosure is not inspection', () => {
    const r = assessConditionRecord(inspection({
      document: { kind: 'vendor_statement', issuer: 'The vendor', issuedOn: '2026-06-02' },
      scope: 'Matters known to the vendor at the date of this statement.',
      scopeCoverage: 'disclosure_only',
      conclusion: 'no_defects_identified',
      findings: [],
    }), ASOF);
    expect(r.refusal).toBe('scope_too_narrow_for_conclusion');
    expect(r.statement).toContain('what the vendor disclosed');
  });

  it('refuses a clean strata report — the scheme is not the dwelling', () => {
    expect(refusalOf(inspection({
      document: { kind: 'strata_report', issuer: 'Strata Search Co', issuedOn: '2026-06-02' },
      scope: 'Levies, sinking fund, disclosed defects and litigation of the scheme.',
      scopeCoverage: 'common_property',
      conclusion: 'no_defects_identified',
      findings: [],
    }))).toBe('scope_too_narrow_for_conclusion');
  });

  it('refuses a clean building certificate — it certifies the works, not the dwelling', () => {
    expect(refusalOf(inspection({
      document: { kind: 'building_certificate', issuer: 'Council certifier', issuedOn: '2026-06-02' },
      scope: 'The carport erected under the development consent granted in 2025.',
      scopeCoverage: 'specified_works',
      conclusion: 'no_defects_identified',
      findings: [],
    }))).toBe('scope_too_narrow_for_conclusion');
  });

  it('refuses a clean PART-dwelling inspection, and accepts the same document with a finding', () => {
    const partial = inspection({
      scope: 'Interior only. The roof space and subfloor were not accessible.',
      scopeCoverage: 'partial_dwelling',
      exclusions: ['Roof space', 'Subfloor'],
    });
    expect(refusalOf(partial)).toBe('scope_too_narrow_for_conclusion');
    // ...and the same narrow document CAN carry a defect it did find.
    expect(refusalOf({
      ...partial, findings: [{ element: 'Bathroom waterproofing', severity: 'major_defect' }],
    })).toBeNull();
  });

  it('takes those three verdicts from the establishes table rather than a second list', () => {
    for (const kind of ADMISSIBLE_SOURCES) {
      const rule = ESTABLISHES[kind];
      expect(rule.establishes.length).toBeGreaterThan(40);
      if (!rule.supportsNegativeConclusion) expect(rule.coverageForNegative).toHaveLength(0);
    }
    // Exactly one kind can clear a dwelling, and only over the whole of it.
    const clearing = ADMISSIBLE_SOURCES.filter((k) => ESTABLISHES[k].supportsNegativeConclusion);
    expect(clearing).toEqual(['building_inspection']);
    expect(ESTABLISHES.building_inspection.coverageForNegative).toEqual(['whole_dwelling']);
  });
});

describe('a severity this method cannot weigh is never silently dropped', () => {
  it('refuses the record and names the severities', () => {
    const r = assessConditionRecord(inspection({
      conclusion: 'defects_identified',
      findings: [
        { element: 'Render cracking', severity: 'moderate' as never },
        { element: 'Fascia', severity: 'cosmetic' as never },
      ],
    }), ASOF);
    expect(r.refusal).toBe('unrecognised_severity');
    expect(r.unrecognisedSeverities).toEqual(['moderate', 'cosmetic']);
    expect(r.statement).toContain('moderate, cosmetic');
  });

  it('is the defect that mattered: three unweighable findings scored as none', () => {
    // v1 skipped them in `convertFindings` AND omitted them from the sentence,
    // so a document listing three defects read "no defect or hazard over the
    // scope examined" and scored the reference.
    const three = [
      { element: 'a', severity: 'moderate' as never },
      { element: 'b', severity: 'moderate' as never },
      { element: 'c', severity: 'moderate' as never },
    ];
    expect(convertFindings(three)).toBe(CONDITION_REFERENCE);   // the arithmetic still can't see them
    expect(assessConditionRecord(inspection({ findings: three }), ASOF).admissible).toBe(false);
  });

  it('exposes the severity vocabulary so a caller can validate before submitting', () => {
    expect([...FINDING_SEVERITIES].sort())
      .toEqual(['major_defect', 'minor_defect', 'safety_hazard', 'unfunded_liability']);
    expect(isFindingSeverity('moderate')).toBe(false);
    expect(isFindingSeverity('major_defect')).toBe(true);
    for (const s of FINDING_SEVERITIES) expect(SEVERITY_DEDUCTION[s]).toBeGreaterThan(0);
  });
});

describe('the record belongs to a property, and it is checked', () => {
  it('refuses a document filed against another property', () => {
    expect(refusalOf(inspection(), {
      expectedSubject: { propertyAddress: '262 Pallas Street, Maryborough QLD 4650', propertyId: 'prop-pallas' },
    })).toBe('subject_mismatch');
  });

  it('tolerates street-type abbreviation rather than rejecting on punctuation', () => {
    expect(refusalOf(inspection(), {
      expectedSubject: { propertyAddress: '18 Annabelle Cres, Kellyville, NSW 2155' },
    })).toBeNull();
  });

  it('tolerates the abbreviations an operator actually types, in either case', () => {
    for (const written of [
      '18 Annabelle Cres., Kellyville, NSW 2155',
      '18 ANNABELLE CRESCENT KELLYVILLE NSW 2155',
    ]) {
      expect(refusalOf(inspection(), { expectedSubject: { propertyAddress: written } }), written)
        .toBeNull();
    }
  });

  it('never reads two different streets as one property — a road type is normalised, not removed', () => {
    // v2.0.0 DELETED the road type from the comparison key, so a document
    // about 18 Annabelle STREET satisfied the check for 18 Annabelle
    // CRESCENT. Two streets can differ only in their road type.
    expect(refusalOf(inspection({
      subject: { propertyAddress: '18 Annabelle Street, Kellyville NSW 2155' },
    }), { expectedSubject: { propertyAddress: '18 Annabelle Crescent, Kellyville NSW 2155' } }))
      .toBe('subject_mismatch');
  });

  it('does not let expansion itself merge two different roads', () => {
    // `St` expands to `street` and `Rd` to `road` — the tokens survive, so
    // the abbreviated spellings of two different roads stay different.
    expect(refusalOf(inspection({
      subject: { propertyAddress: '18 Annabelle Rd, Kellyville NSW 2155' },
    }), { expectedSubject: { propertyAddress: '18 Annabelle St, Kellyville NSW 2155' } }))
      .toBe('subject_mismatch');
  });

  it('refuses on a wrong street number — a neighbour is a different property', () => {
    expect(refusalOf(inspection({
      subject: { propertyAddress: '20 Annabelle Crescent, Kellyville NSW 2155' },
    }), { expectedSubject: { propertyAddress: '18 Annabelle Crescent, Kellyville NSW 2155' } }))
      .toBe('subject_mismatch');
  });

  it('still refuses when the ids agree and the addresses name different streets', () => {
    // An id is an assertion by whoever filed the record; the document's own
    // address contradicting the assessed property is a conflict, not noise.
    expect(refusalOf(inspection({
      subject: { ...SUBJECT, propertyAddress: '18 Annabelle Street, Kellyville NSW 2155' },
    }), { expectedSubject: SUBJECT })).toBe('subject_mismatch');
  });

  it('refuses when the linked property row disagrees, even where the addresses read the same', () => {
    expect(refusalOf(inspection({
      subject: { ...SUBJECT, propertyId: 'prop-a-different-row' },
    }), { expectedSubject: SUBJECT })).toBe('subject_mismatch');
  });

  it('refuses a record that names no property at all, whoever calls', () => {
    // The v2.0.0 check ran only where BOTH sides were present, so a document
    // bound to nothing passed silently — and a caller that forgot to supply
    // the expected subject admitted it. The record-side requirement does not
    // depend on the caller.
    const unbound = inspection({ subject: { propertyAddress: '  ' } });
    expect(refusalOf(unbound)).toBe('subject_not_recorded');
    expect(refusalOf(unbound, { expectedSubject: SUBJECT })).toBe('subject_not_recorded');
  });

  it('refuses a pair with no comparable field rather than waving it through', () => {
    // The record knows only an internal id; the assessment supplies only an
    // address. Nothing connects them, and "could not check" is not "checked".
    expect(refusalOf(inspection({
      subject: { propertyAddress: '', propertyId: 'prop-somewhere' },
    }), { expectedSubject: { propertyAddress: '18 Annabelle Crescent, Kellyville NSW 2155' } }))
      .toBe('subject_unresolved');
  });

  it('checks nothing beyond the record itself when no subject was supplied — the caller decides', () => {
    expect(refusalOf(inspection())).toBeNull();
  });
});

describe('what has not changed', () => {
  it('still names the absence rather than scoring it', () => {
    const r = assessConditionRecord(null, ASOF);
    expect(r.refusal).toBe('no_record');
    expect(r.statement).toContain('building inspection report');
  });

  it('still refuses an inadmissible source, an unattributed issuer and a transcription', () => {
    expect(refusalOf(inspection({
      document: { kind: 'typed_construction_year' as never, issuer: 'operator', issuedOn: '2026-09-16' },
    }))).toBe('inadmissible_source');
    expect(refusalOf(inspection({
      document: { ...inspection().document, issuer: '  ' },
    }))).toBe('unattributed');
    expect(refusalOf(inspection({ verification: 'transcribed_only' }))).toBe('not_verified');
  });

  it('lists what it refuses, so a reader can see the typed year was considered', () => {
    expect(Object.keys(INADMISSIBLE_SOURCES)).toContain('typed_construction_year');
    for (const k of Object.keys(INADMISSIBLE_SOURCES)) {
      expect(ADMISSIBLE_SOURCES as readonly string[]).not.toContain(k);
    }
  });

  it('only ever deducts, and minor findings cannot exhaust the scale', () => {
    expect(convertFindings([])).toBe(CONDITION_REFERENCE);
    const many = Array.from({ length: 20 }, (_, i) => ({
      element: `e${i}`, severity: 'minor_defect' as const,
    }));
    expect(convertFindings(many)).toBe(CONDITION_REFERENCE - MAX_MINOR_DEDUCTION);
    const wrecked = Array.from({ length: 12 }, (_, i) => ({
      element: `e${i}`, severity: 'safety_hazard' as const,
    }));
    expect(convertFindings(wrecked)).toBe(0);
  });

  it('prefers by scope and recency, never by outcome', () => {
    const wideButWorse = inspection({
      document: { ...inspection().document, inspectedOn: '2026-01-04', issuedOn: '2026-01-05' },
      conclusion: 'defects_identified',
      findings: [{ element: 'Roof', severity: 'major_defect' }],
    });
    const narrowButNewer: ConditionRecord = {
      document: { kind: 'vendor_statement', issuer: 'Vendor', issuedOn: '2026-08-01' },
      subject: SUBJECT,
      scope: 'Matters known to the vendor at the date of this statement.',
      scopeCoverage: 'disclosure_only',
      conclusion: 'no_defects_identified',
      findings: [],
      verification: 'document_held',
    };
    expect(bestConditionRecord([narrowButNewer, wideButWorse])?.document.kind)
      .toBe('building_inspection');
    expect(bestConditionRecord([])).toBeNull();
  });
});

describe('activation is a named decision', () => {
  it('records who activated it, when and against which version (28 Sep 2026)', () => {
    expect(CONDITION_METHOD_ACTIVATION).not.toBeNull();
    expect(CONDITION_METHOD_ACTIVATION!.approved).toBe(true);
    expect(CONDITION_METHOD_ACTIVATION!.approvedOn).toBe('2026-09-28');
    expect(CONDITION_METHOD_ACTIVATION!.decidedBy).toBe('platform owner');
    expect(CONDITION_METHOD_ACTIVATION!.methodVersion).toBe(CONDITION_RECORD_METHOD_VERSION);
  });

  it('publishes the observation only from an admissible record', () => {
    const r = assessConditionRecord(inspection(), ASOF, { expectedSubject: SUBJECT });
    expect(r.admissible).toBe(true);
    expect(r.observation).toBe(CONDITION_REFERENCE);
    expect(r.provisionalObservation).toBe(CONDITION_REFERENCE);
    expect(r.statement).toMatch(/^Assessed from a building inspection report/);
  });

  it('never publishes one from an inadmissible record', () => {
    const r = assessConditionRecord(null, ASOF);
    expect(r.admissible).toBe(false);
    expect(r.observation).toBeNull();
  });

  it('carries the version that names these rules', () => {
    expect(CONDITION_RECORD_METHOD_VERSION).toBe('2.1.0');
    expect(assessConditionRecord(inspection(), ASOF).version)
      .toBe(CONDITION_RECORD_METHOD_VERSION);
  });

  it('states no interval as an industry norm', () => {
    // v1 claimed 36 months was "the ordinary re-inspection interval a lender or
    // an insurer works to". No source was held for it. A parameter may be
    // proposed; it may not be dressed as a fact about somebody else's practice.
    const src = readFileSync(resolve(
      process.cwd(), 'supabase/functions/_shared/reports/risk/conditionRecord.pure.ts'), 'utf8');
    expect(src).not.toMatch(/interval a lender|insurer works to/);
    expect(src).toContain('PROPOSED');
    expect(src).toContain('the claim is withdrawn');
  });
});
