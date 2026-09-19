/**
 * The §25 end-to-end scenario, driven through the canonical engine.
 *
 * One client, one AML/CTF process, one Passport, three partners on three
 * different legal footings — then a superseding version, then a revocation.
 * The point of running it as one narrative rather than as isolated units is
 * that the interesting failures are transitions: a v2 that quietly rewrites a
 * v1 decision, a revocation that leaves a stale "shared" state on screen, a
 * builder that inherits finance's evidence because the loop reused a variable.
 *
 * This exercises the same `evaluateDistribution` the edge function calls and
 * the same presentation layer the Command Centre renders, so a divergence
 * between what the server decides and what the operator is told fails here.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateDistribution,
  summariseBatch,
  type DistributionCandidate,
  type DistributionContext,
} from './index';
import {
  buildMatrix,
  canShare,
  evidenceCellState,
  isBulkEligible,
  primaryActionLabel,
  routeHeadline,
  routeLabel,
  stateLabel,
  type ReadinessView,
} from './distributionPresentation.pure';

const NOW = new Date('2026-08-14T00:00:00Z');

/* ── the case: Client A, cleared, Passport v1 issued ─────────────────── */

function contextFor(version: number, over: Partial<DistributionContext> = {}): DistributionContext {
  return {
    caseId: 'case-A',
    caseTenantId: 'tenant-1',
    caseSubjectType: 'individual',
    sharingConsentId: 'consent-1',
    passport: {
      attestation: {
        id: `att-v${version}`,
        version,
        payload_sha256: String(version).repeat(64).slice(0, 64),
        issued_at: '2026-08-10T00:00:00Z',
        superseded_at: null,
        schema_version: 2,
      },
      stateCode: 'current',
      openRefreshObligations: 0,
      serviceGateStatus: 'approved',
    },
    distributionEnabled: true,
    now: NOW,
    ...over,
  };
}

/** A partner with a complete, in-scope, in-date written CDD arrangement. */
function relianceCandidate(
  orgId: string, name: string, portal: string, over: Partial<DistributionCandidate> = {},
): DistributionCandidate {
  return {
    partnerOrgId: orgId,
    partnerOrgName: name,
    portalType: portal,
    legalRoute: 'reliance',
    relationshipRole: portal,
    purpose: 'property_transaction',
    partnerOrg: { id: orgId, status: 'active' },
    classificationStatus: 'completed',
    links: [{
      id: `link-${orgId}`, case_id: 'case-A', tenant_id: 'tenant-1',
      partner_org_id: orgId, legal_route: 'reliance', state: 'active',
    }],
    membership: {
      id: `mem-${orgId}`, partner_org_id: orgId, portal_type: portal,
      portal_user_source: 'finance_portal_users', portal_user_id: 'u1', status: 'active',
    },
    arrangement: {
      id: `agr-${orgId}`, status: 'active', next_review_due: '2027-01-01',
      eligibility_classification: 'eligible_reporting_entity',
      scope_procedures: ['customer_identification', 'beneficial_ownership'],
      scope_customer_types: ['individual', 'entity'],
      effective_from: '2026-01-01', expires_on: '2027-12-31',
      partner_org_id: orgId,
    },
    assessment: {
      id: `asm-${orgId}`, status: 'operative', decision: 'suitable',
      assessed_at: '2026-06-01T00:00:00Z', next_review_due: '2027-01-01',
    } as unknown as DistributionCandidate['assessment'],
    existingGrant: null,
    manifestPresent: true,
    evidence: {
      identityDocumentsAccepted: 2,
      verificationPassed: 3,
      addressEvidenceAccepted: 1,
      entityEvidenceAccepted: 0,
      ownershipRecords: 0,
      authorityRecords: 0,
      transactionRecords: 1,
      deliveriesToPartner: 1,
    },
    ...over,
  };
}

/** Partner C — connected, but on an information-sharing footing only. */
function infoOnlyCandidate(): DistributionCandidate {
  const base = relianceCandidate('org-C', 'XYZ Developments', 'builder');
  return {
    ...base,
    legalRoute: 'information_share_only',
    links: [{ ...base.links[0], legal_route: 'information_share_only' }],
    // No written CDD arrangement — that is the point of the route.
    arrangement: null,
    assessment: null,
    evidence: {
      ...base.evidence,
      // A narrower package: identity confirmed, transaction context, no more.
      addressEvidenceAccepted: 0,
      verificationPassed: 1,
      transactionRecords: 1,
    },
  };
}

const asView = (r: unknown) => r as unknown as ReadinessView;

describe('§25 — one client, three partners, three legal footings', () => {
  const ctx = contextFor(1);
  const finance = evaluateDistribution(ctx, relianceCandidate('org-A', 'Finance Partner A', 'finance'));
  const solicitor = evaluateDistribution(ctx, relianceCandidate('org-B', 'Solicitor Partner B', 'solicitor'));
  const builder = evaluateDistribution(ctx, infoOnlyCandidate());

  it('Partners A and B pass section 37A readiness', () => {
    expect(finance.ready).toBe(true);
    expect(finance.legal_route).toBe('reliance');
    expect(solicitor.ready).toBe(true);
    expect(solicitor.legal_route).toBe('reliance');
  });

  it('Partner C is not eligible for statutory reliance and is not pretended to be', () => {
    expect(builder.legal_route).toBe('information_share_only');
    // Crucially: it is DISTRIBUTABLE — an ineligible reliance partner is not
    // a blocked partner, it is a partner on a different footing.
    expect(builder.ready).toBe(true);
    expect(builder.blockers).not.toContain('CDD_ARRANGEMENT_REQUIRED');
  });

  it('the Command Centre shows the three routes distinctly', () => {
    expect(routeLabel(finance.legal_route)).toBe('Section 37A reliance');
    expect(routeLabel(builder.legal_route)).toBe('Information sharing only');
    expect(routeHeadline(builder.legal_route)).not.toMatch(/37A/);
  });

  it('the action offered differs with the footing', () => {
    expect(primaryActionLabel(asView(finance))).toBe('Link & Share Passport');
    expect(primaryActionLabel(asView(builder))).toBe('Share authorised Passport information');
  });

  it('all three can be shared and the summary counts them', () => {
    const s = summariseBatch([finance, solicitor, builder]);
    expect(s.total).toBe(3);
    expect(s.ready).toBe(3);
    expect(s.blocked).toBe(0);
  });

  it('the builder receives a narrower evidence package than finance', () => {
    const f = asView(finance);
    const b = asView(builder);
    // Address evidence reached finance and did not reach the builder.
    expect(evidenceCellState(f, 'ADDRESS_EVIDENCE_AVAILABLE')).toBe('available');
    expect(evidenceCellState(b, 'ADDRESS_EVIDENCE_AVAILABLE')).not.toBe('available');
    // And no partner is given a class the origin never classified.
    for (const r of [f, b]) {
      expect(evidenceCellState(r, 'OWNERSHIP_EVIDENCE_AVAILABLE')).not.toBe('available');
    }
  });

  it('one partner never inherits another’s package through the matrix', () => {
    const rows = buildMatrix([asView(finance), asView(solicitor), asView(builder)]);
    const address = rows.find((r) => r.label === 'Address')!;
    expect(address.cells[0].value).toBe('Shared');
    expect(address.cells[2].value).not.toBe('Shared');
    const route = rows.find((r) => r.label === 'Legal route')!;
    expect(route.cells[0].value).toBe('Section 37A reliance');
    expect(route.cells[2].value).toBe('Information sharing only');
  });
});

describe('§18/§19 — a new version does not rewrite an old decision', () => {
  it('a partner holding v1 is told v2 exists, and the v1 grant survives', () => {
    const ctxV2 = contextFor(2);
    const holdingV1 = relianceCandidate('org-A', 'Finance Partner A', 'finance', {
      existingGrant: {
        id: 'grant-1', attestation_id: 'att-v1',
        revoked_at: null, refresh_required_at: null, partner_org_id: 'org-A', expires_at: '2027-01-01T00:00:00Z',
      },
    });
    const r = evaluateDistribution(ctxV2, holdingV1);

    expect(r.state).toBe('NEW_VERSION_AVAILABLE');
    expect(stateLabel(r.state)).toBe('New version available');
    // Still shareable — that is how the partner reaches v2.
    expect(canShare(asView(r))).toBe(true);
    // And the engine has not touched the v1 grant: readiness is evaluation.
    expect(holdingV1.existingGrant!.attestation_id).toBe('att-v1');
    expect(holdingV1.existingGrant!.revoked_at).toBeNull();
  });

  it('a partner already holding the current version is a no-op, not a duplicate', () => {
    const ctxV2 = contextFor(2);
    const holdingV2 = relianceCandidate('org-A', 'Finance Partner A', 'finance', {
      existingGrant: {
        id: 'grant-2', attestation_id: 'att-v2',
        revoked_at: null, refresh_required_at: null, partner_org_id: 'org-A', expires_at: '2027-01-01T00:00:00Z',
      },
    });
    const r = evaluateDistribution(ctxV2, holdingV2);
    expect(r.state).toBe('ALREADY_CURRENT');
    expect(canShare(asView(r))).toBe(false);
    expect(primaryActionLabel(asView(r))).toBe('Already shared');
  });

  it('an open refresh obligation stops distribution of the stale record', () => {
    const ctx = contextFor(1, {
      passport: { ...contextFor(1).passport, openRefreshObligations: 1 },
    });
    const r = evaluateDistribution(ctx, relianceCandidate('org-A', 'Finance Partner A', 'finance'));
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain('PASSPORT_REFRESH_REQUIRED');
  });
});

describe('§20 — revocation and suspension fail closed', () => {
  it('a revoked grant is reported as revoked and is never swept up in a bulk share', () => {
    const r = evaluateDistribution(contextFor(1), relianceCandidate('org-A', 'Finance Partner A', 'finance', {
      existingGrant: {
        id: 'grant-1', attestation_id: 'att-v1',
        revoked_at: '2026-08-12T00:00:00Z', refresh_required_at: null, partner_org_id: 'org-A', expires_at: '2027-01-01T00:00:00Z',
      },
    }));
    expect(r.state).toBe('GRANT_REVOKED');
    // Reinstatement remains POSSIBLE — an MLRO withdrew the access and an MLRO
    // may restore it — but only as a deliberate act naming this partner. A
    // "share with all eligible" must never quietly undo a revocation.
    expect(canShare(asView(r))).toBe(true);
    expect(isBulkEligible(asView(r))).toBe(false);
    // And the button says which act it is.
    expect(primaryActionLabel(asView(r))).toBe('Reinstate & share Passport');
  });

  it('an expired grant is reported as expired, not as current', () => {
    const r = evaluateDistribution(contextFor(1), relianceCandidate('org-A', 'Finance Partner A', 'finance', {
      existingGrant: {
        id: 'grant-1', attestation_id: 'att-v1',
        revoked_at: null, refresh_required_at: null, partner_org_id: 'org-A', expires_at: '2026-01-01T00:00:00Z',
      },
    }));
    expect(r.state).toBe('GRANT_EXPIRED');
  });

  it('a suspended Passport blocks every route, reliance or not', () => {
    const suspended = contextFor(1, {
      passport: { ...contextFor(1).passport, stateCode: 'suspended' },
    });
    for (const candidate of [
      relianceCandidate('org-A', 'Finance Partner A', 'finance'),
      infoOnlyCandidate(),
    ]) {
      const r = evaluateDistribution(suspended, candidate);
      expect(r.ready).toBe(false);
      expect(r.blockers).toContain('PASSPORT_SUSPENDED');
    }
  });

  it('no operator-facing wording leaks WHY a Passport is unavailable', () => {
    const suspended = contextFor(1, {
      passport: { ...contextFor(1).passport, stateCode: 'suspended' },
    });
    const r = evaluateDistribution(suspended, relianceCandidate('org-A', 'A', 'finance'));
    // The blocker names the state, never an investigation, a suspicion or a
    // reviewer's reasoning.
    expect(JSON.stringify(r).toLowerCase()).not.toMatch(/suspicion|smr|investigation|mlro_/);
  });
});

describe('§24 — cross-portal isolation holds through the new surface', () => {
  it('a link belonging to another case is not a candidate', () => {
    const wrongCase = relianceCandidate('org-A', 'Finance Partner A', 'finance');
    wrongCase.links = [{ ...wrongCase.links[0], case_id: 'case-B' }];
    const r = evaluateDistribution(contextFor(1), wrongCase);
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain('PARTNER_LINK_REQUIRED');
  });

  it('a link belonging to another tenant is not a candidate', () => {
    const wrongTenant = relianceCandidate('org-A', 'Finance Partner A', 'finance');
    wrongTenant.links = [{ ...wrongTenant.links[0], tenant_id: 'tenant-2' }];
    const r = evaluateDistribution(contextFor(1), wrongTenant);
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain('PARTNER_LINK_REQUIRED');
  });

  it('an arrangement belonging to another organisation does not confer reliance', () => {
    const borrowed = relianceCandidate('org-A', 'Finance Partner A', 'finance');
    borrowed.arrangement = { ...borrowed.arrangement!, partner_org_id: 'org-B' };
    const r = evaluateDistribution(contextFor(1), borrowed);
    expect(r.ready).toBe(false);
  });

  it('a partner with no portal membership cannot receive anything', () => {
    const r = evaluateDistribution(contextFor(1),
      relianceCandidate('org-A', 'Finance Partner A', 'finance', { membership: null }));
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain('PORTAL_MEMBERSHIP_REQUIRED');
  });

  it('missing client sharing consent stops every partner', () => {
    const noConsent = contextFor(1, { sharingConsentId: null });
    for (const candidate of [
      relianceCandidate('org-A', 'A', 'finance'), infoOnlyCandidate(),
    ]) {
      const r = evaluateDistribution(noConsent, candidate);
      expect(r.ready).toBe(false);
      expect(r.blockers).toContain('CLIENT_SHARING_CONSENT_REQUIRED');
    }
  });

  it('with the feature off, nothing is distributable however complete the record', () => {
    const off = contextFor(1, { distributionEnabled: false });
    const r = evaluateDistribution(off, relianceCandidate('org-A', 'A', 'finance'));
    expect(r.ready).toBe(false);
    expect(r.blockers).toContain('DISTRIBUTION_NOT_ENABLED');
    expect(canShare(asView(r))).toBe(false);
  });
});
