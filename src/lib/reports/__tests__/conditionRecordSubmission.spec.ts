/**
 * The submission contract — the same rule the dialog renders and the edge
 * operation enforces, pinned where both import it from.
 *
 * The load-bearing distinction: ADMISSIBILITY (may this become a scoring
 * observation?) and STORABILITY (may this row be written to the evidence
 * register?) are different questions. A transcribed, out-of-currency or
 * narrow-scope document is evidence the register holds, with the refusal on
 * the reading; what may not be stored is exactly what the table's own
 * constraints would refuse, plus a document identifying a different property
 * — refused with the validator's sentence, never a raw 23514.
 */

import { describe, expect, it } from 'vitest';
import {
  CONDITION_TABLE_MIGRATION,
  STORAGE_BLOCKING_REFUSALS,
  TABLE_NOT_APPLIED,
  decideConditionSubmission,
  isMissingTableError,
  parseConditionSubmission,
  recordFromRow,
  rowFromRecord,
} from '../conditionRecordSubmission.pure';
import { assessConditionRecord } from '../conditionRecord.pure';

const ASOF = '2026-09-18T00:00:00.000Z';
const SUBJECT = { reportId: 'report-1', propertyId: 'prop-annabelle' };
const EXPECTED = {
  propertyAddress: '18 Annabelle Crescent, Kellyville NSW 2155',
  propertyId: 'prop-annabelle',
  reportId: 'report-1',
};

const validPayload = (over: Record<string, unknown> = {}) => ({
  documentKind: 'building_inspection',
  issuer: 'Hunter Building Consultants',
  issuerLicence: 'NSW 123456C',
  issuedOn: '2026-06-02',
  inspectedOn: '2026-05-29',
  documentReference: 'HBC-2026-4417',
  documentPropertyAddress: '18 Annabelle Crescent, Kellyville NSW 2155',
  scope: 'Interior, exterior, roof void and subfloor of the dwelling.',
  scopeCoverage: 'whole_dwelling',
  conclusion: 'no_defects_identified',
  findings: [],
  verification: 'transcribed_only',
  ...over,
});

describe('parseConditionSubmission — the whitelist and its refusals', () => {
  it('builds a record from a valid payload, field by field', () => {
    const parsed = parseConditionSubmission(validPayload(), SUBJECT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.record.document.kind).toBe('building_inspection');
    expect(parsed.record.subject.reportId).toBe('report-1');
    expect(parsed.record.subject.propertyAddress).toBe('18 Annabelle Crescent, Kellyville NSW 2155');
  });

  it('ignores keys it does not name — a payload cannot reach a column it was not offered', () => {
    const parsed = parseConditionSubmission(
      validPayload({ recorded_by: 'attacker', observation: 99, id: 'chosen-id' }) as never,
      SUBJECT,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const row = rowFromRecord(parsed.record, { reportId: 'report-1', recordedBy: 'real-user' });
    expect(row.recorded_by).toBe('real-user');
    expect(row).not.toHaveProperty('observation');
    expect(row).not.toHaveProperty('id');
  });

  it.each([
    ['an unknown kind', { documentKind: 'typed_construction_year' }, 'inadmissible_source'],
    ['no issuer', { issuer: '  ' }, 'unattributed'],
    ['an unreadable issue date', { issuedOn: 'last winter' }, 'undated'],
    ['an unreadable inspection date', { inspectedOn: 'autumn' }, 'undated'],
    ['no document address', { documentPropertyAddress: '' }, 'subject_not_recorded'],
    ['a severity the method cannot weigh', {
      findings: [{ element: 'Render', severity: 'moderate' }],
    }, 'unrecognised_severity'],
    ['a held-document claim with no file', { verification: 'document_held' }, 'not_verified'],
    ['a coverage outside the vocabulary', { scopeCoverage: 'roof_only' }, 'invalid_payload'],
    ['a conclusion outside the vocabulary', { conclusion: 'looks fine' }, 'invalid_payload'],
    ['a finding with no element', { findings: [{ severity: 'minor_defect' }] }, 'invalid_payload'],
  ])('refuses %s', (_name, over, reason) => {
    const parsed = parseConditionSubmission(validPayload(over as never), SUBJECT);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.refusal.reason).toBe(reason);
    expect(parsed.refusal.statement.length).toBeGreaterThan(20);
  });
});

describe('storability is not admissibility', () => {
  const decide = (over: Record<string, unknown> = {}) => {
    const parsed = parseConditionSubmission(validPayload(over), SUBJECT);
    if (!parsed.ok) throw new Error(`fixture refused: ${parsed.refusal.statement}`);
    return decideConditionSubmission(parsed.record, EXPECTED, ASOF);
  };

  it('stores a transcribed record as evidence, refusal riding on the reading', () => {
    const d = decide();
    expect(d.storable).toBe(true);
    expect(d.reading.admissible).toBe(false);
    expect(d.reading.refusal).toBe('not_verified');
  });

  it('stores an out-of-currency document — evidence with its date, never scored', () => {
    // A held document, so the verification rule does not answer first.
    const d = decide({
      issuedOn: '2022-06-02', inspectedOn: '2022-05-29',
      verification: 'document_held', fileId: 'a-client-files-id',
    });
    expect(d.storable).toBe(true);
    expect(d.reading.refusal).toBe('out_of_currency');
  });

  it('refuses to file another property\'s document on this report', () => {
    const d = decide({ documentPropertyAddress: '262 Pallas Street, Maryborough QLD 4650' });
    expect(d.storable).toBe(false);
    expect(d.refusal?.reason).toBe('subject_mismatch');
  });

  it('refuses two different streets, whatever the abbreviation', () => {
    const d = decide({ documentPropertyAddress: '18 Annabelle St, Kellyville NSW 2155' });
    expect(d.storable).toBe(false);
    expect(d.refusal?.reason).toBe('subject_mismatch');
  });

  it('tolerates the abbreviation of the SAME street', () => {
    const d = decide({ documentPropertyAddress: '18 Annabelle Cres, Kellyville, NSW 2155' });
    expect(d.storable).toBe(true);
  });

  it('refuses the dates the table constraints would refuse, with a sentence', () => {
    for (const over of [
      { issuedOn: '2027-06-02', inspectedOn: undefined },
      { issuedOn: '2026-03-01', inspectedOn: '2026-05-29' },
    ]) {
      const d = decide(over as never);
      expect(d.storable).toBe(false);
      expect(d.refusal?.statement).toContain('not scored');
    }
  });

  it('splits the refusal vocabulary exactly along the constraints', () => {
    for (const blocked of ['subject_mismatch', 'subject_not_recorded', 'subject_unresolved',
      'unrecognised_severity', 'issued_in_future', 'inspected_after_issue', 'undated']) {
      expect(STORAGE_BLOCKING_REFUSALS).toContain(blocked);
    }
    for (const evidence of ['not_verified', 'out_of_currency', 'scope_not_recorded',
      'scope_coverage_not_recorded', 'conclusion_not_stated', 'scope_too_narrow_for_conclusion']) {
      expect(STORAGE_BLOCKING_REFUSALS).not.toContain(evidence);
    }
  });
});

describe('a stored row reads back as the record it was', () => {
  it('round-trips through the column names to the same reading', () => {
    const parsed = parseConditionSubmission(validPayload(), SUBJECT);
    if (!parsed.ok) throw new Error('fixture refused');
    const row = rowFromRecord(parsed.record, {
      reportId: 'report-1',
      clientPropertyId: 'prop-annabelle',
      recordedBy: 'user-1',
    });
    const back = recordFromRow(row);
    const before = assessConditionRecord(parsed.record, ASOF, { expectedSubject: EXPECTED });
    const after = assessConditionRecord(back, ASOF, { expectedSubject: EXPECTED });
    expect(after.admissible).toBe(before.admissible);
    expect(after.refusal).toBe(before.refusal);
    expect(after.statement).toBe(before.statement);
  });
});

describe('an unapplied table is a named state', () => {
  it('recognises the missing relation by code and by message', () => {
    expect(isMissingTableError({ code: '42P01', message: 'x' })).toBe(true);
    expect(isMissingTableError({ code: null, message: 'relation "public.property_condition_records" does not exist' })).toBe(true);
    expect(isMissingTableError({ code: '23514', message: 'check violation' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });

  it('names the migration, says nothing was lost, and asserts nothing about the dwelling', () => {
    expect(TABLE_NOT_APPLIED).toContain(CONDITION_TABLE_MIGRATION);
    expect(TABLE_NOT_APPLIED).toContain('not stored');
    expect(TABLE_NOT_APPLIED.toLowerCase()).toContain('nothing here is a statement about the dwelling');
  });
});
