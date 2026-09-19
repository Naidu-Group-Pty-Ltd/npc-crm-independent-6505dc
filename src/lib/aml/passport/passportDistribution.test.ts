/**
 * Passport distribution readiness — the s 37A and disclosure battery.
 *
 * These are legal-gating tests, not UI tests. Every one of them asserts a
 * DENIAL that must survive: if a change makes one of these pass where it used
 * to fail, partner reliance has been widened, and that is exactly the class of
 * change that must never happen quietly.
 *
 * Do not weaken an assertion here to make a distribution feature ship. Fix the
 * engine instead.
 */
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_CLASSES,
  NEVER_DISCLOSABLE,
  classifyEvidence,
  distributionStateFor,
  evaluateDistribution,
  evaluateDistributionBatch,
  summariseBatch,
  type DistributionCandidate,
  type DistributionContext,
} from './index';

const NOW = new Date('2026-08-14T10:00:00Z');
const FUTURE = '2027-01-01';
const PAST = '2026-01-01';

const attestation = {
  id: 'att-1', version: 2, payload_sha256: 'f'.repeat(64),
  issued_at: '2026-08-13T10:07:00Z', superseded_at: null, schema_version: 2,
};

function ctx(over: Partial<DistributionContext> = {}): DistributionContext {
  return {
    caseId: 'case-1', caseTenantId: 'default', caseSubjectType: 'individual',
    sharingConsentId: 'consent-1',
    passport: {
      attestation, stateCode: 'issued_current',
      openRefreshObligations: 0, serviceGateStatus: 'approved',
    },
    distributionEnabled: true,
    now: NOW,
    ...over,
  };
}

/** A partner with every s 37A prerequisite satisfied. */
function candidate(over: Partial<DistributionCandidate> = {}): DistributionCandidate {
  return {
    partnerOrgId: 'org-1', partnerOrgName: 'GT Financial Services',
    portalType: 'finance', legalRoute: 'reliance',
    relationshipRole: 'mortgage_broker', purpose: 'Loan application CDD',
    partnerOrg: { id: 'org-1', status: 'active' },
    classificationStatus: 'completed',
    links: [{
      id: 'link-1', case_id: 'case-1', tenant_id: 'default',
      partner_org_id: 'org-1', legal_route: 'reliance', state: 'active',
    }],
    membership: {
      id: 'mem-1', partner_org_id: 'org-1', portal_type: 'finance',
      portal_user_source: 'finance_portal_users', portal_user_id: 'user-1',
      status: 'active',
    },
    arrangement: {
      id: 'agr-1', status: 'active', next_review_due: FUTURE,
      eligibility_classification: 'eligible_reporting_entity',
      scope_procedures: ['customer_identification'],
      scope_customer_types: null,
      effective_from: PAST, expires_on: FUTURE, partner_org_id: 'org-1',
    },
    assessment: { decision: 'suitable', next_due_at: FUTURE, status: 'operative' },
    existingGrant: null,
    manifestPresent: true,
    evidence: {
      identityDocumentsAccepted: 2, verificationPassed: 1,
      addressEvidenceAccepted: 1, entityEvidenceAccepted: 0,
      ownershipRecords: 0, authorityRecords: 0, transactionRecords: 1,
      deliveriesToPartner: 1,
    },
    ...over,
  };
}

const ok = () => evaluateDistribution(ctx(), candidate());

describe('the happy path exists, so the denials below mean something', () => {
  it('a fully-satisfied reliance partner is READY', () => {
    const r = ok();
    expect(r.ready).toBe(true);
    expect(r.state).toBe('READY');
    expect(r.blockers).toEqual([]);
    expect(r.legal_route).toBe('reliance');
    expect(r.next_actions).toContain('share_passport_to_partner');
  });

  it('pins the exact attestation version and hash it was evaluated against', () => {
    // §15: a partner determination must reference the hash it reviewed.
    const r = ok();
    expect(r.passport.attestation_id).toBe('att-1');
    expect(r.passport.version).toBe(2);
    expect(r.passport.payload_sha256).toBe('f'.repeat(64));
  });
});

describe('the Passport itself must be current', () => {
  it('blocks when no attestation has been issued', () => {
    const r = evaluateDistribution(
      ctx({ passport: { attestation: null, stateCode: 'not_issued', openRefreshObligations: 0, serviceGateStatus: 'approved' } }),
      candidate(),
    );
    expect(r.blockers).toContain('PASSPORT_NOT_ISSUED');
    expect(r.ready).toBe(false);
    expect(r.state).toBe('ACTION_REQUIRED');
  });

  it('blocks a refresh-required Passport', () => {
    const r = evaluateDistribution(
      ctx({ passport: { attestation, stateCode: 'issued_current', openRefreshObligations: 1, serviceGateStatus: 'approved' } }),
      candidate(),
    );
    expect(r.blockers).toContain('PASSPORT_REFRESH_REQUIRED');
    expect(r.ready).toBe(false);
  });

  it('blocks a suspended Passport and a terminated service gate', () => {
    for (const p of [
      { stateCode: 'suspended', serviceGateStatus: 'approved' },
      { stateCode: 'issued_current', serviceGateStatus: 'terminated' },
      { stateCode: 'issued_current', serviceGateStatus: 'locked' },
    ]) {
      const r = evaluateDistribution(
        ctx({ passport: { attestation, openRefreshObligations: 0, ...p } }),
        candidate(),
      );
      expect(r.blockers).toContain('PASSPORT_SUSPENDED');
      expect(r.ready).toBe(false);
    }
  });

  it('blocks a superseded attestation', () => {
    const r = evaluateDistribution(
      ctx({ passport: { attestation: { ...attestation, superseded_at: '2026-08-14T00:00:00Z' }, stateCode: 'superseded', openRefreshObligations: 0, serviceGateStatus: 'approved' } }),
      candidate(),
    );
    expect(r.blockers).toContain('PASSPORT_SUPERSEDED');
  });
});

describe('a link or a membership alone discloses nothing', () => {
  it('partner-case link alone does not make a partner ready', () => {
    // Link present, but no membership, no arrangement, no classification.
    const r = evaluateDistribution(ctx(), candidate({
      membership: null, arrangement: null, assessment: null,
      classificationStatus: 'pending',
    }));
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual(expect.arrayContaining([
      'PORTAL_MEMBERSHIP_REQUIRED',
      'PARTNER_CLASSIFICATION_REQUIRED',
      'CDD_ARRANGEMENT_REQUIRED',
    ]));
  });

  it('portal membership alone does not make a partner ready', () => {
    const r = evaluateDistribution(ctx(), candidate({
      links: [], arrangement: null, assessment: null, classificationStatus: null,
    }));
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain('PARTNER_LINK_REQUIRED');
  });

  it('an inactive or mismatched membership blocks', () => {
    for (const m of [
      { status: 'suspended' },
      { portal_user_id: null },
      { partner_org_id: 'org-OTHER' },
    ]) {
      const r = evaluateDistribution(ctx(), candidate({
        membership: { ...candidate().membership!, ...m } as never,
      }));
      expect(r.blockers).toContain('PORTAL_MEMBERSHIP_REQUIRED');
    }
  });
});

describe('s 37A prerequisites each fail closed', () => {
  it('missing classification blocks reliance', () => {
    for (const status of [null, 'pending', 'in_review']) {
      const r = evaluateDistribution(ctx(), candidate({ classificationStatus: status }));
      expect(r.blockers).toContain('PARTNER_CLASSIFICATION_REQUIRED');
      expect(r.ready).toBe(false);
    }
  });

  it('missing CDD arrangement blocks reliance', () => {
    const r = evaluateDistribution(ctx(), candidate({ arrangement: null }));
    expect(r.blockers).toContain('CDD_ARRANGEMENT_REQUIRED');
    expect(r.reliance_code).toBe('agreement_missing');
  });

  it('overdue arrangement review blocks reliance', () => {
    const r = evaluateDistribution(ctx(), candidate({
      arrangement: { ...candidate().arrangement!, next_review_due: PAST },
    }));
    expect(r.blockers).toContain('ARRANGEMENT_REVIEW_OVERDUE');
    expect(r.ready).toBe(false);
  });

  it('missing, unsuitable or overdue assessment blocks reliance', () => {
    expect(evaluateDistribution(ctx(), candidate({ assessment: null })).blockers)
      .toContain('ARRANGEMENT_ASSESSMENT_REQUIRED');
    expect(evaluateDistribution(ctx(), candidate({
      assessment: { decision: 'unsuitable', next_due_at: FUTURE, status: 'operative' },
    })).blockers).toContain('ARRANGEMENT_ASSESSMENT_REQUIRED');
    expect(evaluateDistribution(ctx(), candidate({
      assessment: { decision: 'suitable', next_due_at: PAST, status: 'operative' },
    })).blockers).toContain('ARRANGEMENT_REVIEW_OVERDUE');
  });

  it('missing client sharing consent blocks every route', () => {
    for (const route of ['reliance', 'independent_cdd', 'information_share_only']) {
      const r = evaluateDistribution(
        ctx({ sharingConsentId: null }),
        candidate({ legalRoute: route, links: [{ ...candidate().links[0], legal_route: route }] }),
      );
      expect(r.blockers).toContain('CLIENT_SHARING_CONSENT_REQUIRED');
      expect(r.ready).toBe(false);
    }
  });
});

describe('a legal route is read, never inferred', () => {
  it('an unrecorded route blocks rather than defaulting to anything', () => {
    const r = evaluateDistribution(ctx(), candidate({ legalRoute: null }));
    expect(r.blockers).toContain('LEGAL_ROUTE_NOT_RECORDED');
    expect(r.legal_route).toBeNull();
    expect(r.ready).toBe(false);
  });

  it('a finance portal does NOT imply reliance', () => {
    // Same finance partner, route recorded as information sharing: the s 37A
    // stack is not evaluated and the result never claims reliance.
    const r = evaluateDistribution(ctx(), candidate({
      legalRoute: 'information_share_only',
      links: [{ ...candidate().links[0], legal_route: 'information_share_only' }],
      arrangement: null, assessment: null, classificationStatus: null,
    }));
    expect(r.legal_route).toBe('information_share_only');
    expect(r.blockers).not.toContain('CDD_ARRANGEMENT_REQUIRED');
    expect(r.blockers).not.toContain('PARTNER_CLASSIFICATION_REQUIRED');
    expect(r.ready).toBe(true);
  });

  it('independent CDD needs no arrangement and is never reported as reliance', () => {
    const r = evaluateDistribution(ctx(), candidate({
      legalRoute: 'independent_cdd',
      links: [{ ...candidate().links[0], legal_route: 'independent_cdd' }],
      arrangement: null, assessment: null, classificationStatus: null,
    }));
    expect(r.ready).toBe(true);
    expect(r.legal_route).toBe('independent_cdd');
    expect(r.reliance_code).toBeNull();
  });

  it('reliance is never silently downgraded when its prerequisites fail', () => {
    // The route stays `reliance` and reports blockers. It does not become
    // information sharing because that would have succeeded.
    const r = evaluateDistribution(ctx(), candidate({ arrangement: null }));
    expect(r.legal_route).toBe('reliance');
    expect(r.ready).toBe(false);
  });
});

describe('cross-partner and cross-case isolation', () => {
  it('a link belonging to another case cannot authorise this one', () => {
    const r = evaluateDistribution(ctx(), candidate({
      links: [{ ...candidate().links[0], case_id: 'case-OTHER' }],
    }));
    expect(r.ready).toBe(false);
    expect(r.reliance_code).toBe('partner_link_wrong_case');
  });

  it('a link belonging to another tenant cannot authorise this one', () => {
    const r = evaluateDistribution(ctx(), candidate({
      links: [{ ...candidate().links[0], tenant_id: 'other-tenant' }],
    }));
    expect(r.ready).toBe(false);
    expect(r.reliance_code).toBe('partner_link_wrong_tenant');
  });

  it('another organisation cannot reach this partner’s distribution', () => {
    const r = evaluateDistribution(ctx(), candidate({
      partnerOrg: { id: 'org-INTRUDER', status: 'active' },
    }));
    expect(r.ready).toBe(false);
    expect(r.reliance_code).toBe('partner_link_missing');
  });
});

describe('evidence is classified, never fabricated', () => {
  it('reports only classes a canonical record supports', () => {
    const e = classifyEvidence({
      identityDocumentsAccepted: 1, verificationPassed: 0,
      addressEvidenceAccepted: 0, entityEvidenceAccepted: 0,
      ownershipRecords: 0, authorityRecords: 0, transactionRecords: 0,
      deliveriesToPartner: 0,
    });
    expect(e.available).toEqual(['IDENTITY_KYC_AVAILABLE']);
    expect(e.unavailable).toContain('VERIFICATION_DATA_AVAILABLE');
    expect(e.unavailable).toContain('OWNERSHIP_EVIDENCE_AVAILABLE');
  });

  it('no evidence at all is reported as none, not as available', () => {
    const e = classifyEvidence({
      identityDocumentsAccepted: 0, verificationPassed: 0,
      addressEvidenceAccepted: 0, entityEvidenceAccepted: 0,
      ownershipRecords: 0, authorityRecords: 0, transactionRecords: 0,
      deliveriesToPartner: 0,
    });
    expect(e.available).toEqual([]);
    expect(e.delivery).toBe('none');
  });

  it('an unknown evidence class cannot be produced', () => {
    // The vocabulary is closed, and the restricted list must share no term
    // with it. A future edit that widens the allow-list fails here.
    const all = EVIDENCE_CLASSES.map((c) => c.toLowerCase()).join(' ');
    for (const banned of NEVER_DISCLOSABLE) {
      expect(all).not.toContain(banned);
    }
  });

  it('restricted material never appears anywhere in a readiness result', () => {
    const json = JSON.stringify(ok()).toLowerCase();
    for (const banned of NEVER_DISCLOSABLE) {
      expect(json).not.toContain(banned);
    }
  });
});

describe('distribution is idempotent', () => {
  it('a grant pinned to the current attestation is ALREADY_CURRENT', () => {
    const r = evaluateDistribution(ctx(), candidate({
      existingGrant: {
        id: 'g1', attestation_id: 'att-1', expires_at: '2027-01-01T00:00:00Z',
        revoked_at: null, refresh_required_at: null, partner_org_id: 'org-1',
      },
    }));
    expect(r.state).toBe('ALREADY_CURRENT');
    expect(r.next_actions).not.toContain('share_passport_to_partner');
  });

  it('a grant pinned to a superseded attestation offers the new version', () => {
    const r = evaluateDistribution(ctx(), candidate({
      existingGrant: {
        id: 'g1', attestation_id: 'att-OLD', expires_at: '2027-01-01T00:00:00Z',
        revoked_at: null, refresh_required_at: null, partner_org_id: 'org-1',
      },
    }));
    expect(r.state).toBe('NEW_VERSION_AVAILABLE');
  });

  it('revoked, expired and refresh-required grants each fail closed', () => {
    const base = {
      id: 'g1', attestation_id: 'att-1', expires_at: '2027-01-01T00:00:00Z',
      revoked_at: null as string | null, refresh_required_at: null as string | null,
      partner_org_id: 'org-1',
    };
    expect(distributionStateFor({ ...base, revoked_at: '2026-08-01T00:00:00Z' }, 'att-1', NOW))
      .toBe('GRANT_REVOKED');
    expect(distributionStateFor({ ...base, expires_at: '2026-08-01T00:00:00Z' }, 'att-1', NOW))
      .toBe('GRANT_EXPIRED');
    expect(distributionStateFor({ ...base, refresh_required_at: '2026-08-01T00:00:00Z' }, 'att-1', NOW))
      .toBe('REFRESH_REQUIRED');
  });

  it('a revoked grant on an otherwise-ready partner never reads as current', () => {
    const r = evaluateDistribution(ctx(), candidate({
      existingGrant: {
        id: 'g1', attestation_id: 'att-1', expires_at: '2027-01-01T00:00:00Z',
        revoked_at: '2026-08-01T00:00:00Z', refresh_required_at: null,
        partner_org_id: 'org-1',
      },
    }));
    expect(r.state).toBe('GRANT_REVOKED');
  });
});

describe('bulk distribution', () => {
  it('evaluates each partner independently', () => {
    const results = evaluateDistributionBatch(ctx(), [
      candidate(),
      candidate({ partnerOrgId: 'org-2', partnerOrgName: 'Harlow & Vance', arrangement: null,
        partnerOrg: { id: 'org-2', status: 'active' },
        links: [{ ...candidate().links[0], partner_org_id: 'org-2' }],
        membership: { ...candidate().membership!, partner_org_id: 'org-2' } }),
    ]);
    expect(results[0].ready).toBe(true);
    expect(results[1].ready).toBe(false);
    // The failing partner must not contaminate the passing one.
    expect(results[0].blockers).toEqual([]);
  });

  it('reports partial failure accurately rather than as success', () => {
    const results = evaluateDistributionBatch(ctx(), [
      candidate(),
      candidate({ arrangement: null }),
      candidate({ existingGrant: {
        id: 'g', attestation_id: 'att-1', expires_at: '2027-01-01T00:00:00Z',
        revoked_at: null, refresh_required_at: null, partner_org_id: 'org-1' } }),
    ]);
    expect(summariseBatch(results)).toEqual({
      total: 3, ready: 1, already_current: 1, blocked: 1,
    });
  });
});

describe('the feature flag is server-enforced', () => {
  it('nothing is distributable with the flag off', () => {
    const r = evaluateDistribution(ctx({ distributionEnabled: false }), candidate());
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain('DISTRIBUTION_NOT_ENABLED');
  });
});

describe('readiness is an evaluation, never a mutation', () => {
  it('carries no field that could change AML state', () => {
    // The result is a report. If it ever gained a field that set a case
    // status, a gate or a verification outcome, distribution would be able to
    // move the AML engine — which it must never do.
    const json = JSON.stringify(ok());
    for (const forbidden of [
      'case_status', 'service_gate', 'verification_status', 'risk_rating',
      'set_', 'update_', 'gate_status',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('does not mutate the candidate it was given', () => {
    const c = candidate();
    const snapshot = JSON.stringify(c);
    evaluateDistribution(ctx(), c);
    expect(JSON.stringify(c)).toBe(snapshot);
  });
});
