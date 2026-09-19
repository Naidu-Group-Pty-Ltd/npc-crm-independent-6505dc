/**
 * Passport stamps — earned from records, never authored.
 *
 * Pins: the closed vocabulary; that no stamp exists without an underlying
 * record timestamp; version binding against the attestation register; partner
 * attribution; and the client-safe subset.
 */
import { describe, expect, it } from 'vitest';
import {
  STAMP_VOCABULARY,
  clientSafePending,
  clientSafeStamps,
  derivePassportStamps,
  derivePendingStamps,
  type PassportStampInput,
} from './index';

const empty: PassportStampInput = {
  issuer_org: 'Naidu Property Consulting Services',
  attestations: [],
  consents: [],
  verification_checks: [],
  documents: [],
  screening_subjects: [],
  owners: [],
  source_of_funds: [],
  source_of_wealth: [],
  edd_cases: [],
  grants: [],
  assessments: [],
  refresh_obligations: [],
  transactions: [],
};

describe('derivePassportStamps', () => {
  it('produces nothing from nothing — a stamp requires a record', () => {
    expect(derivePassportStamps(empty)).toEqual([]);
  });

  it('never emits a stamp whose source has no timestamp', () => {
    const stamps = derivePassportStamps({
      ...empty,
      consents: [{ id: 'c1', kind: 'privacy', accepted_at: null }],
      transactions: [{ id: 't1', status: 'settled', settlement_date: null }],
    });
    expect(stamps).toEqual([]);
  });

  it('derives the client journey stamps from their records', () => {
    const stamps = derivePassportStamps({
      ...empty,
      consents: [{ id: 'c1', kind: 'privacy', accepted_at: '2026-08-13T09:13:00Z', actor_label: 'client@example.com' }],
      verification_checks: [
        { id: 'v1', party_label: 'Subject', check_type: 'electronic_idv', status: 'passed', completed_at: '2026-08-13T09:27:00Z' },
      ],
      documents: [
        { status: 'accepted', reviewed_at: '2026-08-13T09:29:00Z' },
        { status: 'superseded', reviewed_at: '2026-08-10T00:00:00Z' }, // superseded rows do not block
      ],
      screening_subjects: [
        { state: 'completed', completed_at: '2026-08-13T09:31:00Z' },
        { state: 'false_positive', completed_at: '2026-08-13T09:32:00Z' },
      ],
      owners: [{ verification_state: 'verified', verified_at: '2026-08-13T09:46:00Z' }],
    });
    const codes = stamps.map((s) => s.code);
    expect(codes).toEqual([
      'client_consent_recorded',
      'identity_verified',
      'documents_verified',
      'screening_completed',
      'ownership_verified',
    ]);
    // Chronological order is the register's order.
    expect(stamps.map((s) => s.at)).toEqual([...stamps.map((s) => s.at)].sort());
    // Attribution comes from the record, not from copy.
    expect(stamps[0].portal).toBe('Client Portal');
    expect(stamps[0].source).toEqual({ kind: 'aml.consents', id: 'c1' });
  });

  it('does not award documents_verified while any live document is unaccepted', () => {
    const stamps = derivePassportStamps({
      ...empty,
      documents: [
        { status: 'accepted', reviewed_at: '2026-08-13T09:00:00Z' },
        { status: 'uploaded', created_at: '2026-08-13T09:10:00Z' },
      ],
    });
    expect(stamps.map((s) => s.code)).not.toContain('documents_verified');
  });

  it('does not award screening_completed while a subject is unresolved', () => {
    const stamps = derivePassportStamps({
      ...empty,
      screening_subjects: [
        { state: 'completed', completed_at: '2026-08-13T09:31:00Z' },
        { state: 'possible_match' },
      ],
    });
    expect(stamps.map((s) => s.code)).not.toContain('screening_completed');
  });

  it('issuance lineage: v1 issues, later versions update, supersession records', () => {
    const stamps = derivePassportStamps({
      ...empty,
      attestations: [
        { version: 1, issued_at: '2026-08-01T10:07:00Z', superseded_at: '2026-08-13T13:20:00Z' },
        { version: 2, issued_at: '2026-08-13T13:21:00Z', superseded_at: null },
      ],
    });
    const codes = stamps.map((s) => s.code);
    expect(codes).toContain('passport_issued');
    expect(codes).toContain('passport_updated');
    expect(codes).toContain('passport_superseded');
    const issued = stamps.find((s) => s.code === 'passport_issued')!;
    expect(issued.version).toBe(1);
    const updated = stamps.find((s) => s.code === 'passport_updated')!;
    expect(updated.version).toBe(2);
  });

  it('binds a stamp to the attestation version current when it was earned', () => {
    const stamps = derivePassportStamps({
      ...empty,
      attestations: [
        { version: 1, issued_at: '2026-08-01T00:00:00Z', superseded_at: '2026-08-10T00:00:00Z' },
        { version: 2, issued_at: '2026-08-10T00:00:00Z', superseded_at: null },
      ],
      consents: [{ id: 'c0', kind: 'privacy', accepted_at: '2026-07-30T00:00:00Z' }],
      transactions: [{ id: 't1', status: 'settled', settlement_date: '2026-08-15T00:00:00Z' }],
    });
    // Earned before any issue → no version claim.
    expect(stamps.find((s) => s.code === 'client_consent_recorded')!.version).toBeNull();
    // Earned under v2.
    expect(stamps.find((s) => s.code === 'transaction_completed')!.version).toBe(2);
  });

  it('partner sharing and decisions attribute the right organisation and portal', () => {
    const stamps = derivePassportStamps({
      ...empty,
      grants: [{
        id: 'g1', created_at: '2026-08-13T10:18:00Z', revoked_at: null,
        partner_org_name: 'GT Financial Services', partner_org_type: 'finance', attestation_version: 1,
      }],
      assessments: [{
        id: 'a1', status: 'satisfied', decided_at: '2026-08-13T10:36:00Z',
        assessor_name: 'G. Turnbull', partner_org_name: 'GT Financial Services', partner_org_type: 'finance',
      }],
    });
    const shared = stamps.find((s) => s.code === 'passport_shared_finance')!;
    expect(shared.portal).toBe('Finance Portal');
    expect(shared.version).toBe(1);
    const reliance = stamps.find((s) => s.code === 'reliance_accepted_finance')!;
    // The partner's stamp speaks for the PARTNER, not the issuer.
    expect(reliance.org).toBe('GT Financial Services');
    expect(reliance.actor).toBe('G. Turnbull');
  });

  it('a non-satisfied partner decision records independent CDD, never an acceptance', () => {
    const stamps = derivePassportStamps({
      ...empty,
      assessments: [{
        id: 'a2', status: 'not_satisfied', decided_at: '2026-08-13T11:00:00Z',
        assessor_name: 'E. Vance', partner_org_name: 'Harlow & Vance Legal', partner_org_type: 'solicitor_conveyancer',
      }],
    });
    expect(stamps.map((s) => s.code)).toEqual(['independent_cdd_recorded']);
  });

  it('revocation stamps from the grant record', () => {
    const stamps = derivePassportStamps({
      ...empty,
      grants: [{
        id: 'g1', created_at: '2026-08-01T00:00:00Z', revoked_at: '2026-08-14T00:00:00Z',
        partner_org_name: 'GT Financial Services', partner_org_type: 'finance', attestation_version: 1,
      }],
    });
    expect(stamps.map((s) => s.code)).toContain('access_revoked');
  });

  it('transaction_completed only from canonical settled status', () => {
    const stamps = derivePassportStamps({
      ...empty,
      transactions: [
        { id: 't1', status: 'under_contract', settlement_date: '2026-10-15T00:00:00Z' },
        { id: 't2', status: 'settled', settlement_date: '2026-10-15T00:00:00Z' },
      ],
    });
    expect(stamps.filter((s) => s.code === 'transaction_completed')).toHaveLength(1);
  });

  it('developer organisations stamp through the builder surface', () => {
    const stamps = derivePassportStamps({
      ...empty,
      grants: [{
        id: 'g2', created_at: '2026-08-13T14:18:00Z', revoked_at: null,
        partner_org_name: 'Coastline Developments', partner_org_type: 'developer', attestation_version: 1,
      }],
    });
    expect(stamps.map((s) => s.code)).toContain('passport_shared_builder');
    expect(stamps[0].portal).toBe('Builder / Developer Portal');
  });
});

describe('vocabulary and client subset', () => {
  it('the vocabulary is closed and every entry is fully specified', () => {
    for (const [code, v] of Object.entries(STAMP_VOCABULARY)) {
      expect(code).toMatch(/^[a-z_]+$/);
      expect(v.title.length).toBeGreaterThan(0);
      expect(['circle', 'rect', 'seal']).toContain(v.shape);
    }
  });

  it('EDD is the one stamp a client must not see', () => {
    const hidden = Object.entries(STAMP_VOCABULARY).filter(([, v]) => !v.client_safe);
    expect(hidden.map(([k]) => k)).toEqual(['edd_completed']);
  });

  it('clientSafeStamps drops non-client-safe stamps and keeps order', () => {
    const stamps = derivePassportStamps({
      ...empty,
      edd_cases: [{ status: 'completed', completed_at: '2026-08-13T10:00:00Z' }],
      consents: [{ id: 'c1', kind: 'privacy', accepted_at: '2026-08-13T09:13:00Z' }],
    });
    expect(stamps).toHaveLength(2);
    const safe = clientSafeStamps(stamps);
    expect(safe.map((s) => s.code)).toEqual(['client_consent_recorded']);
  });
});

/* ── the outstanding half of the register ──────────────────────────────── */

const pendingFor = (
  over: Partial<PassportStampInput> = {},
  facts: Parameters<typeof derivePendingStamps>[2] = {},
) => {
  const input = { ...empty, ...over };
  return derivePendingStamps(input, derivePassportStamps(input), facts);
};

describe('derivePendingStamps', () => {
  it('a pending stamp carries NO record — it cannot be mistaken for an earned one', () => {
    // This is the property the whole feature rests on. An outstanding
    // impression that carried a timestamp, a version or an actor would be
    // asserting a control that was never performed.
    for (const p of pendingFor()) {
      expect(p).not.toHaveProperty('at');
      expect(p).not.toHaveProperty('version');
      expect(p).not.toHaveProperty('actor');
      expect(p).not.toHaveProperty('source');
      expect(p.awaiting.length).toBeGreaterThan(0);
    }
  });

  it('never offers a stamp the case has already earned', () => {
    const input: PassportStampInput = {
      ...empty,
      consents: [{ id: 'c1', kind: 'privacy', accepted_at: '2026-08-01T00:00:00Z' }],
      verification_checks: [
        { id: 'v1', party_label: 'A', check_type: 'electronic_idv', status: 'passed', completed_at: '2026-08-02T00:00:00Z' },
      ],
    };
    const earned = derivePassportStamps(input);
    const pending = derivePendingStamps(input, earned, {});
    const earnedCodes = new Set(earned.map((s) => s.code));
    for (const p of pending) expect(earnedCodes.has(p.code)).toBe(false);
    expect(pending.map((p) => p.code)).toContain('passport_issued');
  });

  it('never draws an EVENT as outstanding', () => {
    // "ACCESS REVOKED" as an empty impression reads as a revocation the
    // system is waiting for. None of these is anything a case works toward.
    const codes = pendingFor().map((p) => p.code);
    for (const never of [
      'access_revoked',
      'passport_superseded',
      'passport_updated',
      'independent_cdd_recorded',
      'passport_refresh_requested',
      'passport_shared_finance',
      'passport_shared_solicitor',
      'passport_shared_builder',
    ]) {
      expect(codes).not.toContain(never);
    }
  });

  it('does not invent a dimension the engagement does not have', () => {
    // An individual has no beneficial owners; a case with no EDD owes no EDD;
    // a case with no transaction owes no settlement. Showing any of these as
    // outstanding would state an obligation that does not exist.
    const codes = pendingFor({}, { subject_type: 'individual' }).map((p) => p.code);
    expect(codes).not.toContain('ownership_verified');
    expect(codes).not.toContain('edd_completed');
    expect(codes).not.toContain('source_of_wealth_reviewed');
    expect(codes).not.toContain('transaction_completed');
    expect(codes).not.toContain('reliance_accepted_finance');

    // …and does show them once the dimension exists.
    expect(pendingFor({}, { subject_type: 'entity' }).map((p) => p.code))
      .toContain('ownership_verified');
    expect(pendingFor({ edd_cases: [{ status: 'open' }] }).map((p) => p.code))
      .toEqual(expect.arrayContaining(['edd_completed', 'source_of_wealth_reviewed']));
  });

  it('carries the settlement date the record already holds', () => {
    // The design's own worked example: TRANSACTION COMPLETED outstanding,
    // with the expected settlement date printed under it.
    const pending = pendingFor({
      transactions: [{ id: 't1', status: 'under_contract', settlement_date: '2026-10-15T00:00:00Z' }],
    });
    const txn = pending.find((p) => p.code === 'transaction_completed');
    expect(txn?.expected_at).toBe('2026-10-15T00:00:00Z');
    expect(txn?.awaiting).toMatch(/settlement/i);

    // A settled transaction earns the stamp instead of owing it.
    expect(
      pendingFor({ transactions: [{ id: 't1', status: 'settled', settlement_date: '2026-10-15T00:00:00Z' }] })
        .map((p) => p.code),
    ).not.toContain('transaction_completed');
  });

  it('waits on the partner only while the partner has not decided', () => {
    const grants = [{
      id: 'g1', created_at: '2026-08-05T00:00:00Z', revoked_at: null,
      partner_org_name: 'Westpac Broking', partner_org_type: 'finance', attestation_version: 1,
    }];
    const awaiting = pendingFor({ grants }).find((p) => p.code === 'reliance_accepted_finance');
    expect(awaiting?.org).toBe('Westpac Broking');

    // Decided — nothing outstanding.
    expect(
      pendingFor({
        grants,
        assessments: [{
          id: 'a1', status: 'satisfied', decided_at: '2026-08-06T00:00:00Z', assessor_name: 'R. Vance',
          partner_org_name: 'Westpac Broking', partner_org_type: 'finance',
        }],
      }).map((p) => p.code),
    ).not.toContain('reliance_accepted_finance');

    // Revoked — we are no longer waiting on them either.
    expect(
      pendingFor({ grants: [{ ...grants[0], revoked_at: '2026-08-07T00:00:00Z' }] }).map((p) => p.code),
    ).not.toContain('reliance_accepted_finance');
  });

  it('a closed case owes nothing', () => {
    // Listing what a finished file will never now earn reads as an open
    // action list on a case nobody is working.
    expect(pendingFor({}, { case_status: 'closed' })).toEqual([]);
  });

  it('the client never sees an outstanding EDD', () => {
    // Same vocabulary flag as the earned stamp. Telling a client that
    // enhanced due diligence is outstanding is the disclosure the flag exists
    // to prevent, and an unearned seal discloses it just as loudly.
    const pending = pendingFor({ edd_cases: [{ status: 'open' }] });
    expect(pending.map((p) => p.code)).toContain('edd_completed');
    expect(clientSafePending(pending).map((p) => p.code)).not.toContain('edd_completed');
  });
});

describe('refresh: the ask and the answer are different facts', () => {
  it('a completed obligation earns PASSPORT REFRESHED as well as the request', () => {
    // It used to earn only the request, so a finished refresh read as an
    // outstanding one for ever.
    const codes = derivePassportStamps({
      ...empty,
      refresh_obligations: [{
        id: 'r1', created_at: '2026-08-10T00:00:00Z', status: 'completed',
        completed_at: '2026-08-13T11:44:00Z',
      }],
    }).map((s) => s.code);
    expect(codes).toEqual(['passport_refresh_requested', 'passport_refresh_completed']);
    expect(STAMP_VOCABULARY.passport_refresh_completed.title).toBe('PASSPORT REFRESHED');
  });

  it('an open obligation is outstanding and carries its due date', () => {
    const pending = pendingFor({
      refresh_obligations: [{
        id: 'r1', created_at: '2026-08-10T00:00:00Z', status: 'open', due_at: '2026-09-10T00:00:00Z',
      }],
    });
    const refresh = pending.find((p) => p.code === 'passport_refresh_completed');
    expect(refresh?.expected_at).toBe('2026-09-10T00:00:00Z');
  });

  it('a cancelled obligation is neither earned nor outstanding', () => {
    const input: PassportStampInput = {
      ...empty,
      refresh_obligations: [{
        id: 'r1', created_at: '2026-08-10T00:00:00Z', status: 'cancelled',
        cancelled_at: '2026-08-11T00:00:00Z',
      }],
    };
    expect(derivePassportStamps(input).map((s) => s.code)).toEqual(['passport_refresh_requested']);
    expect(derivePendingStamps(input, derivePassportStamps(input), {}).map((p) => p.code))
      .not.toContain('passport_refresh_completed');
  });
});

describe('the programme reads the CASE, not only its child rows', () => {
  // Measured against production: both live cases in enhanced CDD carry
  // `status = edd_required` / `case_stage = enhanced_cdd` and ZERO
  // `aml.edd_cases` rows. Deriving applicability from child rows alone left
  // the register silent about the certification those cases most obviously owe.
  it('a case declared edd_required owes EDD even with no EDD record', () => {
    expect(pendingFor({}, { case_status: 'edd_required' }).map((p) => p.code))
      .toContain('edd_completed');
    expect(pendingFor({}, { case_stage: 'enhanced_cdd' }).map((p) => p.code))
      .toContain('edd_completed');
    // …and a case with neither the record nor the declaration still owes nothing.
    expect(pendingFor({}, { case_status: 'kyc_in_progress' }).map((p) => p.code))
      .not.toContain('edd_completed');
  });

  it('the declaration never raises a CLIENT-visible item', () => {
    // Source of wealth is client-safe; enhanced due diligence is not. If the
    // declared EDD state raised the client-visible SoW seal, the client's own
    // Passport would become an inference channel for a Command-only fact.
    // `edd_completed` is the only thing the declaration may raise, and
    // client_safe strips it.
    const declared = pendingFor({}, { case_status: 'edd_required' });
    expect(declared.map((p) => p.code)).not.toContain('source_of_wealth_reviewed');
    expect(clientSafePending(declared).map((p) => p.code)).not.toContain('edd_completed');

    // An actual EDD record does raise it — that is a record, not an inference.
    expect(pendingFor({ edd_cases: [{ status: 'open' }] }).map((p) => p.code))
      .toContain('source_of_wealth_reviewed');
  });

  it('a terminated service gate owes nothing, like a closed case', () => {
    expect(pendingFor({}, { service_gate_status: 'terminated' })).toEqual([]);
    // An active gate mid-CDD is still working.
    expect(pendingFor({}, { service_gate_status: 'information_outstanding' }).length)
      .toBeGreaterThan(0);
  });

  it('reproduces the live cases exactly', () => {
    // AML-2026-00001 `rugesh naidu`: 7 consents, 1 passed electronic_idv,
    // individual, edd_required, no documents/screening/owners/funding/grants.
    const live: PassportStampInput = {
      ...empty,
      consents: [{ id: 'c1', kind: 'privacy_notice', accepted_at: '2026-08-14T08:42:43Z' }],
      verification_checks: [{
        id: 'v1', party_label: null, check_type: 'electronic_idv',
        status: 'passed', completed_at: '2026-08-14T08:51:52Z',
      }],
    };
    const earned = derivePassportStamps(live);
    expect(earned.map((s) => s.code)).toEqual(['client_consent_recorded', 'identity_verified']);

    const pending = derivePendingStamps(live, earned, {
      subject_type: 'individual', case_status: 'edd_required', case_stage: 'enhanced_cdd',
      service_gate_status: 'information_outstanding',
    });
    expect(pending.map((p) => p.code)).toEqual([
      'documents_verified',
      'screening_completed',
      'source_of_funds_reviewed',
      'edd_completed',
      'passport_issued',
    ]);
    // An individual has no beneficial owners and this case has no transaction.
    expect(pending.map((p) => p.code)).not.toContain('ownership_verified');
    expect(pending.map((p) => p.code)).not.toContain('transaction_completed');

    // AML-2026-00002, closed and terminated: a finished file owes nothing.
    expect(derivePendingStamps(empty, [], {
      subject_type: 'individual', case_status: 'closed', service_gate_status: 'terminated',
    })).toEqual([]);
  });
});
