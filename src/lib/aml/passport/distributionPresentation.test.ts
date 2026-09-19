/**
 * Partner distribution — presentation contract.
 *
 * The engine's answers are tested in `passportDistribution.test.ts`. These
 * tests cover the translation: that the words an operator reads mean exactly
 * what the server decided, that no compliance claim is invented on the way,
 * and that nothing in the presentation layer can turn a "no" into a "yes".
 *
 * The failure modes here are quiet ones — a route rounded to the nearest
 * plausible value, a withheld record described as absent, a card that offers
 * an action the server would refuse — so most of these assert on the ABSENCE
 * of a claim rather than the presence of one.
 */
import { describe, expect, it } from 'vitest';
import {
  BLOCKER_TITLE,
  EVIDENCE_CATEGORY_LABEL,
  EVIDENCE_CLASS_ORDER,
  MATRIX_CELL_LABEL,
  ROUTE_HEADLINE,
  ROUTE_LABEL,
  buildMatrix,
  canShare,
  distributionSummary,
  evidenceCellState,
  evidenceSummary,
  isAdvisory,
  isRelianceRoute,
  outcomeLabel,
  outcomeTone,
  passportSummary,
  portalLabel,
  primaryActionLabel,
  readinessChecklist,
  routeExplanation,
  routeHeadline,
  routeLabel,
  stateLabel,
  stateTone,
  summaryLine,
  unresolvedPartyNotice,
  type ReadinessView,
} from './distributionPresentation.pure';
import { DISTRIBUTION_BLOCKERS, DISTRIBUTION_STATES, EVIDENCE_CLASSES, NEVER_DISCLOSABLE } from './index';

function readiness(over: Partial<ReadinessView> = {}): ReadinessView {
  return {
    partner: {
      org_id: 'org-1', org_name: 'GT Financial Services', portal_type: 'finance',
      relationship_role: 'finance_broker', purpose: 'mortgage', classification_status: 'classified',
    },
    legal_route: 'reliance',
    passport: {
      attestation_id: 'att-1', version: 4, payload_sha256: 'a'.repeat(64),
      issued_at: '2026-08-01T00:00:00Z', state_code: 'current',
    },
    state: 'READY',
    ready: true,
    blockers: [],
    messages: [],
    reliance_code: null,
    evidence: {
      available: ['IDENTITY_KYC_AVAILABLE', 'VERIFICATION_DATA_AVAILABLE'],
      unavailable: ['OWNERSHIP_EVIDENCE_AVAILABLE'],
      delivery: 'available_now',
    },
    next_actions: [],
    ...over,
  };
}

describe('the legal route is read, never rounded', () => {
  it('names each route exactly, in both operator and partner wording', () => {
    expect(routeLabel('reliance')).toBe('Section 37A reliance');
    expect(routeHeadline('reliance')).toBe('Section 37A reliance available');
    expect(routeLabel('information_share_only')).toBe('Information sharing only');
    expect(routeHeadline('information_share_only')).toBe('Information sharing only');
  });

  it('reports an absent route as unrecorded — never as the nearest route', () => {
    for (const empty of [null, undefined, '']) {
      expect(routeLabel(empty)).toBe('Legal route not recorded');
      expect(routeHeadline(empty)).toBe('Legal basis not recorded');
      // The words that would assert a legal basis must not appear.
      expect(routeLabel(empty)).not.toMatch(/37A|reliance|sharing/i);
      expect(routeHeadline(empty)).not.toMatch(/37A|reliance|sharing/i);
    }
  });

  it('reports an UNRECOGNISED route as unrecorded rather than guessing', () => {
    // A route the server adds later must not silently render as reliance.
    expect(routeLabel('some_future_route')).toBe('Legal route not recorded');
    expect(routeHeadline('some_future_route')).toBe('Legal basis not recorded');
  });

  it('treats only reliance and outsourced CDD as statutory reliance routes', () => {
    expect(isRelianceRoute('reliance')).toBe(true);
    expect(isRelianceRoute('outsourced_cdd')).toBe(true);
    expect(isRelianceRoute('independent_cdd')).toBe(false);
    expect(isRelianceRoute('information_share_only')).toBe(false);
    expect(isRelianceRoute(null)).toBe(false);
  });

  it('never implies a portal type confers a route', () => {
    // Finance ≠ reliance. The card for a finance partner on an
    // information-only link says information only.
    const infoFinance = readiness({ legal_route: 'information_share_only' });
    const rows = readinessChecklist(infoFinance);
    const route = rows.find((r) => r.label === 'Legal route')!;
    expect(route.value).toBe('Information sharing only');
    expect(route.value).not.toMatch(/37A/);
  });

  it('every route explanation states that the partner keeps its own obligations', () => {
    for (const route of ['reliance', 'outsourced_cdd'] as const) {
      expect(routeExplanation(route)).toMatch(/own AML\/CTF obligations/);
    }
    // And a non-reliance route says plainly that no reliance is created.
    expect(routeExplanation('information_share_only')).toMatch(/no statutory reliance/i);
  });
});

describe('the card offers only what the server allows', () => {
  it('a ready partner can be shared with', () => {
    expect(canShare(readiness())).toBe(true);
    expect(primaryActionLabel(readiness())).toBe('Link & Share Passport');
  });

  it('an unready partner cannot be shared with, whatever else is true', () => {
    const blocked = readiness({
      ready: false, state: 'ACTION_REQUIRED', blockers: ['CDD_ARRANGEMENT_REQUIRED'],
    });
    expect(canShare(blocked)).toBe(false);
    expect(primaryActionLabel(blocked)).toBe('Resolve outstanding items');
  });

  it('an already-current partner is not offered a duplicate share', () => {
    const current = readiness({ state: 'ALREADY_CURRENT' });
    // Note: `ready` is still true — the server is saying "nothing to do",
    // not "you may not". The action must still be withheld.
    expect(current.ready).toBe(true);
    expect(canShare(current)).toBe(false);
    expect(primaryActionLabel(current)).toBe('Already shared');
  });

  it('names the action after the route so an information share is not called reliance', () => {
    expect(primaryActionLabel(readiness({ legal_route: 'information_share_only' })))
      .toBe('Share authorised Passport information');
    expect(primaryActionLabel(readiness({ legal_route: 'independent_cdd' })))
      .toBe('Share for independent CDD');
  });
});

describe('the readiness checklist reflects blockers and never re-tests them', () => {
  it('shows a tick for every condition the server did not flag', () => {
    const rows = readinessChecklist(readiness());
    expect(rows.find((r) => r.label === 'Portal connected')!.value).toBe('Connected');
    expect(rows.find((r) => r.label === 'CDD arrangement')!.value).toBe('Active');
    expect(rows.find((r) => r.label === 'Arrangement assessment')!.value).toBe('Current');
  });

  it('shows the outstanding item for every blocker the server DID flag', () => {
    const rows = readinessChecklist(readiness({
      ready: false,
      blockers: ['PORTAL_MEMBERSHIP_REQUIRED', 'ARRANGEMENT_REVIEW_OVERDUE'],
    }));
    expect(rows.find((r) => r.label === 'Portal connected')!.value)
      .toBe(BLOCKER_TITLE.PORTAL_MEMBERSHIP_REQUIRED);
    expect(rows.find((r) => r.label === 'Arrangement review')!.value)
      .toBe(BLOCKER_TITLE.ARRANGEMENT_REVIEW_OVERDUE);
  });

  it('marks arrangement rows "not applicable" off a reliance route, never "failed"', () => {
    // An information-share partner is not failing an arrangement test — it is
    // not taking one. Rendering it as a failure would tell an operator to go
    // and fix something that does not apply.
    const rows = readinessChecklist(readiness({ legal_route: 'information_share_only' }));
    for (const label of ['CDD arrangement', 'Arrangement assessment', 'Arrangement review']) {
      const row = rows.find((r) => r.label === label)!;
      expect(row.value).toBe('Not applicable');
      expect(row.tone).toBe('na');
    }
  });

  it('every row carries a WORD, so status never depends on colour alone', () => {
    for (const r of readinessChecklist(readiness())) {
      expect(r.value.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('passport currency is stated exactly', () => {
  it('reports a current version as current', () => {
    expect(passportSummary(readiness())).toBe('v4 · Current');
  });

  it('never calls a superseded, suspended or refresh-pending Passport current', () => {
    expect(passportSummary(readiness({ blockers: ['PASSPORT_SUPERSEDED'] }))).toBe('v4 · Superseded');
    expect(passportSummary(readiness({ blockers: ['PASSPORT_SUSPENDED'] }))).toBe('v4 · Not current');
    expect(passportSummary(readiness({ blockers: ['PASSPORT_REFRESH_REQUIRED'] })))
      .toBe('v4 · Refresh outstanding');
  });

  it('reports an unissued Passport as not issued', () => {
    expect(passportSummary(readiness({ passport: { ...readiness().passport, version: null } })))
      .toBe('Not issued');
  });
});

describe('evidence is described by authority, never by existence', () => {
  it('classifies each category from the server lists only', () => {
    const r = readiness();
    expect(evidenceCellState(r, 'IDENTITY_KYC_AVAILABLE')).toBe('available');
    expect(evidenceCellState(r, 'OWNERSHIP_EVIDENCE_AVAILABLE')).toBe('unavailable');
    // In neither list — the arrangement's scope does not reach it.
    expect(evidenceCellState(r, 'AUTHORITY_EVIDENCE_AVAILABLE')).toBe('not_authorised');
  });

  it('never says a withheld record does not exist', () => {
    // The whole vocabulary is checked, because one careless label here is a
    // disclosure about what the origin holds.
    for (const label of Object.values(MATRIX_CELL_LABEL)) {
      expect(label).not.toMatch(/no record|does not exist|none held|nothing held|absent/i);
    }
    expect(MATRIX_CELL_LABEL.not_authorised).toBe('Not authorised');
  });

  it('covers every class the engine can emit', () => {
    // A class the engine adds later must not fall through the matrix silently.
    expect([...EVIDENCE_CLASS_ORDER].sort()).toEqual([...EVIDENCE_CLASSES].sort());
    for (const cls of EVIDENCE_CLASSES) {
      expect(EVIDENCE_CATEGORY_LABEL[cls]).toBeTruthy();
    }
  });

  it('summarises an empty package honestly', () => {
    const none = readiness({ evidence: { available: [], unavailable: [], delivery: 'none' } });
    expect(evidenceSummary(none)).toBe('Nothing authorised yet');
  });

  it('says when documents must be requested rather than implying they are attached', () => {
    const req = readiness({
      evidence: { available: ['IDENTITY_KYC_AVAILABLE'], unavailable: [], delivery: 'request_required' },
    });
    expect(evidenceSummary(req)).toMatch(/request required/);
  });
});

describe('the matrix is a view of canonical state', () => {
  const finance = readiness();
  const solicitor = readiness({
    partner: { ...readiness().partner, org_id: 'org-2', org_name: 'ABC Legal', portal_type: 'solicitor' },
  });
  const builder = readiness({
    partner: { ...readiness().partner, org_id: 'org-3', org_name: 'XYZ Developments', portal_type: 'builder' },
    legal_route: 'information_share_only',
    evidence: { available: ['IDENTITY_KYC_AVAILABLE'], unavailable: [], delivery: 'available_now' },
  });

  it('gives one column per partner and one row per fact', () => {
    const rows = buildMatrix([finance, solicitor, builder]);
    for (const row of rows) expect(row.cells).toHaveLength(3);
    expect(rows.map((r) => r.label)).toContain('Legal route');
    for (const cls of EVIDENCE_CLASS_ORDER) {
      expect(rows.map((r) => r.label)).toContain(EVIDENCE_CATEGORY_LABEL[cls]);
    }
  });

  it('shows different routes for different partners without homogenising them', () => {
    const rows = buildMatrix([finance, builder]);
    const route = rows.find((r) => r.label === 'Legal route')!;
    expect(route.cells[0].value).toBe('Section 37A reliance');
    expect(route.cells[1].value).toBe('Information sharing only');
  });

  it('withholds from the builder what the builder is not authorised to see', () => {
    const rows = buildMatrix([finance, builder]);
    const ownership = rows.find((r) => r.label === EVIDENCE_CATEGORY_LABEL.OWNERSHIP_EVIDENCE_AVAILABLE)!;
    expect(ownership.cells[0].value).toBe(MATRIX_CELL_LABEL.unavailable);
    expect(ownership.cells[1].value).toBe(MATRIX_CELL_LABEL.not_authorised);
  });

  it('marks arrangement rows not applicable where no reliance route applies', () => {
    const rows = buildMatrix([builder]);
    expect(rows.find((r) => r.label === 'Arrangement')!.cells[0].value).toBe('Not applicable');
    expect(rows.find((r) => r.label === 'Assessment')!.cells[0].value).toBe('Not applicable');
  });
});

describe('outcomes report every partner individually', () => {
  it('names the route a share happened under', () => {
    expect(outcomeLabel({ partner_org_id: 'a', state: 'CURRENTLY_SHARED', shared: true }, 'reliance'))
      .toBe('Shared — section 37A reliance');
    expect(outcomeLabel({ partner_org_id: 'a', state: 'CURRENTLY_SHARED', shared: true }, 'independent_cdd'))
      .toBe('Shared — independent CDD');
    expect(outcomeLabel({ partner_org_id: 'a', state: 'CURRENTLY_SHARED', shared: true }, 'information_share_only'))
      .toBe('Shared — information only');
  });

  it('distinguishes already-current, action-required and failed', () => {
    expect(outcomeLabel({ partner_org_id: 'a', state: 'ALREADY_CURRENT', shared: false }, 'reliance'))
      .toBe('Already current');
    expect(outcomeLabel({ partner_org_id: 'a', state: 'ACTION_REQUIRED', shared: false }, 'reliance'))
      .toBe('Action required');
    expect(outcomeLabel({ partner_org_id: 'a', state: 'ACTION_REQUIRED', shared: false, code: 'grant_write_failed' }, 'reliance'))
      .toBe('Failed');
  });

  it('never labels an unshared partner as shared', () => {
    for (const state of DISTRIBUTION_STATES) {
      const label = outcomeLabel({ partner_org_id: 'a', state, shared: false }, 'reliance');
      expect(label).not.toMatch(/^Shared/);
    }
  });

  it('tones a failure as a failure', () => {
    expect(outcomeTone({ partner_org_id: 'a', state: 'ACTION_REQUIRED', shared: false, code: 'grant_write_failed' }))
      .toBe('bad');
    expect(outcomeTone({ partner_org_id: 'a', state: 'CURRENTLY_SHARED', shared: true })).toBe('ok');
  });
});

describe('nothing invents a compliance claim', () => {
  it('no label in the module asserts blanket compliance or a guarantee', () => {
    const everyString = [
      ...Object.values(ROUTE_LABEL), ...Object.values(ROUTE_HEADLINE),
      ...Object.values(BLOCKER_TITLE), ...Object.values(MATRIX_CELL_LABEL),
      ...Object.values(EVIDENCE_CATEGORY_LABEL),
      ...DISTRIBUTION_STATES.map(stateLabel),
      ...DISTRIBUTION_BLOCKERS.map((b) => BLOCKER_TITLE[b]),
      primaryActionLabel(readiness()),
      distributionSummary(readiness()),
      evidenceSummary(readiness()),
      passportSummary(readiness()),
    ].join(' | ');

    // §23 — the phrases this product must never print.
    for (const forbidden of [
      /AML compliant for all partners/i,
      /fully approved client/i,
      /guarantees compliance/i,
      /verified by aurixa for all/i,
    ]) {
      expect(everyString).not.toMatch(forbidden);
    }
  });

  it('no restricted AML class name is part of the presentation vocabulary', () => {
    const everyString = JSON.stringify({
      ROUTE_LABEL, ROUTE_HEADLINE, BLOCKER_TITLE, MATRIX_CELL_LABEL, EVIDENCE_CATEGORY_LABEL,
      rows: readinessChecklist(readiness()),
      matrix: buildMatrix([readiness()]),
    }).toLowerCase();
    for (const restricted of NEVER_DISCLOSABLE) {
      expect(everyString).not.toContain(restricted);
    }
  });

  it('translates every blocker the engine can emit — none renders as a raw code', () => {
    for (const b of DISTRIBUTION_BLOCKERS) {
      expect(BLOCKER_TITLE[b]).toBeTruthy();
      expect(BLOCKER_TITLE[b]).not.toMatch(/_/);          // not the enum
      expect(BLOCKER_TITLE[b]).not.toBe(b);
    }
  });

  it('translates every distribution state — none renders as a raw code', () => {
    for (const s of DISTRIBUTION_STATES) {
      expect(stateLabel(s)).toBeTruthy();
      expect(stateLabel(s)).not.toMatch(/_/);
      expect(stateTone(s)).toBeTruthy();
    }
  });

  it('uses no database vocabulary anywhere an operator can read (§8)', () => {
    const operatorFacing = [
      ...Object.values(ROUTE_LABEL), ...Object.values(ROUTE_HEADLINE),
      ...Object.values(ROUTE_EXPLANATION_VALUES()), ...Object.values(BLOCKER_TITLE),
      ...Object.values(MATRIX_CELL_LABEL), ...Object.values(EVIDENCE_CATEGORY_LABEL),
      ...DISTRIBUTION_STATES.map(stateLabel),
      summaryLine({ total: 3, ready: 1, already_current: 1, blocked: 1 }),
      unresolvedPartyNotice(2) ?? '',
    ].join(' | ');
    for (const jargon of [
      'partner_org_id', 'attestation_id', 'grant_id', 'manifest row', 'membership row',
      'disclosure_manifests', 'reliance_grants', 'partner_case_links', 'org_id',
    ]) {
      expect(operatorFacing).not.toContain(jargon);
    }
  });
});

/** Helper kept out of the assertion body for readability. */
function ROUTE_EXPLANATION_VALUES() {
  return {
    a: routeExplanation('reliance'),
    b: routeExplanation('outsourced_cdd'),
    c: routeExplanation('independent_cdd'),
    d: routeExplanation('information_share_only'),
    e: routeExplanation(null),
  };
}

describe('partner discovery is resolved, never invented (§4)', () => {
  it('reports unmatched parties as needing a mapping', () => {
    expect(unresolvedPartyNotice(0)).toBeNull();
    expect(unresolvedPartyNotice(1)).toMatch(/has not been matched/);
    expect(unresolvedPartyNotice(3)).toMatch(/3 parties/);
    // The notice must send the operator to administration, not offer to
    // create an organisation from the name on the transaction.
    expect(unresolvedPartyNotice(1)).toMatch(/partner administration/);
  });

  it('names a portal only from a known portal type', () => {
    expect(portalLabel('finance')).toBe('Finance Portal');
    expect(portalLabel('solicitor')).toBe('Solicitor / Conveyancer Portal');
    expect(portalLabel('builder')).toBe('Builder / Developer Portal');
    expect(portalLabel(null)).toBe('Portal not connected');
  });
});

describe('the summary line counts what the server counted', () => {
  it('reports each bucket', () => {
    expect(summaryLine({ total: 3, ready: 1, already_current: 1, blocked: 1 }))
      .toBe('1 ready to share · 1 already current · 1 needing action');
  });

  it('says plainly when there is nothing linked', () => {
    expect(summaryLine({ total: 0, ready: 0, already_current: 0, blocked: 0 }))
      .toMatch(/No partner organisations are linked/);
  });
});

describe('advisory blockers do not masquerade as hard stops', () => {
  it('marks the two reportable classes as advisory and the rest as not', () => {
    expect(isAdvisory('EVIDENCE_AVAILABILITY_INCOMPLETE')).toBe(true);
    expect(isAdvisory('DISCLOSURE_CONFIGURATION_REQUIRED')).toBe(true);
    expect(isAdvisory('CDD_ARRANGEMENT_REQUIRED')).toBe(false);
    expect(isAdvisory('PASSPORT_NOT_ISSUED')).toBe(false);
  });

  it('readiness still comes from the server even when only advisories are present', () => {
    // The engine, not this file, decides that an advisory does not block. If
    // the server says not ready, the card must not offer to share.
    const advisoryButBlocked = readiness({
      ready: false, state: 'ACTION_REQUIRED', blockers: ['EVIDENCE_AVAILABILITY_INCOMPLETE'],
    });
    expect(canShare(advisoryButBlocked)).toBe(false);
  });
});
