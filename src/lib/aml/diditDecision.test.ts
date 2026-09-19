import { describe, expect, it } from 'vitest';
import {
  mapDiditDecision,
  readFeatureOutcome,
  summariseDiditDecision,
  assertDecisionCorrelates,
  DiditCorrelationError,
  buildVendorData,
  parseVendorData,
  vendorDataMatches,
  scrubDiditPayload,
  isTerminalDiditStatus,
  isClosedWithoutDecision,
  isInFlightDiditStatus,
  REQUIRED_DIDIT_FEATURES,
  DIDIT_REDACTED,
} from '../../../supabase/functions/_shared/aml/providers/didit.pure.ts';
import { canonicalOutcome } from '../../../supabase/functions/_shared/aml/verificationOutcome.pure.ts';

/**
 * The Didit V3 contract, held against the shapes the live account actually
 * returns rather than the ones a V2 memory would suggest.
 *
 * Three of these tests exist because the obvious implementation is wrong:
 * the feature results are ARRAYS, the ID module is called `ID_VERIFICATION` on
 * the session but `OCR` in the workflow, and an `Approved` roll-up can sit on
 * top of evidence that never ran.
 */

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const PARTY_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const WORKFLOW_ID = 'bb4349a9-8793-4e35-b0b8-ee559a19993a';

/** A decision shaped exactly like the live sandbox response. */
function decision(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: SESSION_ID,
    workflow_id: WORKFLOW_ID,
    vendor_data: buildVendorData(CASE_ID, PARTY_ID),
    status: 'Approved',
    environment: 'sandbox',
    features: ['ID_VERIFICATION', 'LIVENESS', 'FACE_MATCH'],
    id_verifications: [{ node_id: 'ocr', status: 'Approved', warnings: [] }],
    liveness_checks: [{ node_id: 'liveness', status: 'Approved', score: 91, warnings: [] }],
    face_matches: [{ node_id: 'face_match', status: 'Approved', score: 88, warnings: [] }],
    ...over,
  };
}

const correlation = {
  expectedWorkflowId: WORKFLOW_ID,
  expectedCaseId: CASE_ID,
  expectedPartyId: PARTY_ID,
  expectedSessionId: SESSION_ID,
};

describe('Didit status vocabulary', () => {
  it('treats only Approved/Declined/In Review as an identity position', () => {
    expect(isTerminalDiditStatus('Approved')).toBe(true);
    expect(isTerminalDiditStatus('Declined')).toBe(true);
    expect(isTerminalDiditStatus('In Review')).toBe(true);
    for (const s of ['Not Started', 'In Progress', 'Awaiting User', 'Expired', 'Abandoned']) {
      expect(isTerminalDiditStatus(s)).toBe(false);
    }
  });

  it('separates "still going" from "ended without a decision"', () => {
    expect(isInFlightDiditStatus('In Progress')).toBe(true);
    expect(isInFlightDiditStatus('Awaiting User')).toBe(true);
    expect(isInFlightDiditStatus('Resubmitted')).toBe(true);
    expect(isClosedWithoutDecision('Expired')).toBe(true);
    expect(isClosedWithoutDecision('Abandoned')).toBe(true);
    expect(isClosedWithoutDecision('Kyc Expired')).toBe(true);
  });
});

describe('required-feature validation', () => {
  it('requires exactly ID verification, passive liveness and face match', () => {
    expect([...REQUIRED_DIDIT_FEATURES]).toEqual(['ID_VERIFICATION', 'LIVENESS', 'FACE_MATCH']);
  });

  it('reads the ID module from `id_verifications`, not a singular object', () => {
    // The V2-shaped payload. Every field a naive mapper would read is absent.
    const v2Shaped = decision({
      id_verifications: undefined,
      kyc: { status: 'Approved' },
    });
    const outcome = readFeatureOutcome(v2Shaped, 'ID_VERIFICATION');
    expect(outcome.executed).toBe(false);
    expect(outcome.status).toBeNull();
    // …and that must not read as a pass.
    expect(mapDiditDecision(v2Shaped).status).toBe('manual_review');
  });

  it('treats a null feature array (never run) as not executed', () => {
    const outcome = readFeatureOutcome(decision({ face_matches: null }), 'FACE_MATCH');
    expect(outcome.executed).toBe(false);
  });

  it('treats a feature the workflow never declared as not executed', () => {
    // Results present, but the session says the module was not part of the run.
    const outcome = readFeatureOutcome(
      decision({ features: ['ID_VERIFICATION', 'LIVENESS'] }), 'FACE_MATCH');
    expect(outcome.executed).toBe(false);
  });

  it('accepts the object form of `features` the session list returns', () => {
    const outcome = readFeatureOutcome(decision({
      features: [
        { feature: 'ID_VERIFICATION', status: 'Approved' },
        { feature: 'LIVENESS', status: 'Approved' },
        { feature: 'FACE_MATCH', status: 'Approved' },
      ],
    }), 'FACE_MATCH');
    expect(outcome.executed).toBe(true);
  });

  it('prefers the last DECISIVE entry when the customer retried in-flow', () => {
    const outcome = readFeatureOutcome(decision({
      face_matches: [
        { status: 'Declined', score: 12 },
        { status: 'Approved', score: 90 },
        // A trailing retry that produced nothing must not erase the result.
        { status: 'Not Finished' },
      ],
    }), 'FACE_MATCH');
    expect(outcome.status).toBe('Approved');
    expect(outcome.score).toBe(90);
  });

  it('does not let an early Approved mask a later Declined', () => {
    const outcome = readFeatureOutcome(decision({
      face_matches: [{ status: 'Approved', score: 90 }, { status: 'Declined', score: 10 }],
    }), 'FACE_MATCH');
    expect(outcome.status).toBe('Declined');
  });
});

describe('decision mapping', () => {
  it('Approved with all three modules Approved → verified', () => {
    const m = mapDiditDecision(decision());
    expect(m.status).toBe('verified');
    expect(m.requiredFeaturesComplete).toBe(true);
    expect(m.terminal).toBe(true);
  });

  it('MUST NOT pass when a required feature is missing, however Approved the session', () => {
    for (const key of ['id_verifications', 'liveness_checks', 'face_matches']) {
      const m = mapDiditDecision(decision({ [key]: null }));
      expect(m.status).not.toBe('verified');
      expect(m.status).toBe('manual_review');
      expect(m.reason).toContain('required_feature_missing');
    }
  });

  it('MUST NOT pass when a required feature is present but Not Finished', () => {
    const m = mapDiditDecision(decision({
      liveness_checks: [{ status: 'Not Finished' }],
    }));
    expect(m.status).toBe('manual_review');
  });

  it('fails on a module that ran and declined, even under an Approved roll-up', () => {
    const m = mapDiditDecision(decision({
      face_matches: [{ status: 'Declined', score: 4 }],
    }));
    expect(m.status).toBe('failed');
    expect(m.reason).toContain('FACE_MATCH');
  });

  it('Declined → failed', () => {
    expect(mapDiditDecision(decision({ status: 'Declined' })).status).toBe('failed');
  });

  it('In Review → manual_review (referred)', () => {
    const m = mapDiditDecision(decision({ status: 'In Review' }));
    expect(m.status).toBe('manual_review');
  });

  it('an Approved session with an In Review module still goes to a human', () => {
    const m = mapDiditDecision(decision({
      liveness_checks: [{ status: 'In Review', score: 55 }],
    }));
    expect(m.status).toBe('manual_review');
    expect(m.reason).toContain('feature_not_approved');
  });

  it('non-final statuses are pending and never terminal', () => {
    for (const s of ['Not Started', 'In Progress', 'Awaiting User', 'Resubmitted']) {
      const m = mapDiditDecision(decision({ status: s }));
      expect(m.status).toBe('pending');
      expect(m.terminal).toBe(false);
    }
  });

  it('abandoned and expired sessions are not a failure', () => {
    for (const s of ['Abandoned', 'Expired', 'Kyc Expired']) {
      const m = mapDiditDecision(decision({ status: s }));
      expect(m.status).toBe('pending');
      expect(m.terminal).toBe(false);
      expect(m.reason).toContain('closed_without_decision');
    }
  });

  it('an unknown status becomes a referral, never a pass', () => {
    const m = mapDiditDecision(decision({ status: 'Something New' }));
    expect(m.status).toBe('manual_review');
    expect(m.reason).toContain('unrecognised_session_status');
  });
});

describe('canonical pipeline integration', () => {
  const at = (attemptsConsumed: number) => ({ attemptsConsumed, maxAttempts: 3 });

  it('verified → passed, one attempt consumed', () => {
    const m = mapDiditDecision(decision());
    const o = canonicalOutcome({ status: m.status, raw: {} }, at(0));
    expect(o).toMatchObject({ status: 'passed', attemptConsumed: true });
  });

  it('failed on the last attempt → exhausted, using the existing rule', () => {
    const m = mapDiditDecision(decision({ status: 'Declined' }));
    expect(canonicalOutcome({ status: m.status, raw: {} }, at(2)).status).toBe('exhausted');
    expect(canonicalOutcome({ status: m.status, raw: {} }, at(1)).status).toBe('failed');
  });

  it('manual_review → referred, attempt consumed', () => {
    const m = mapDiditDecision(decision({ status: 'In Review' }));
    const o = canonicalOutcome({ status: m.status, raw: {} }, at(0));
    expect(o).toMatchObject({ status: 'referred', attemptConsumed: true });
  });

  it('a non-final or abandoned session consumes NO attempt and sets no status', () => {
    for (const s of ['In Progress', 'Abandoned', 'Expired']) {
      const m = mapDiditDecision(decision({ status: s }));
      const o = canonicalOutcome({ status: m.status, raw: {} }, at(0));
      expect(o.attemptConsumed).toBe(false);
      expect(o.status).toBeNull();
    }
  });
});

describe('correlation', () => {
  it('builds an opaque vendor_data carrying no personal data', () => {
    const v = buildVendorData(CASE_ID, PARTY_ID);
    expect(v).toBe(`npc:${CASE_ID}:${PARTY_ID}`);
    expect(parseVendorData(v)).toEqual({ caseId: CASE_ID, partyId: PARTY_ID, attempt: null });
    expect(parseVendorData(buildVendorData(CASE_ID, null))).toEqual({
      caseId: CASE_ID, partyId: null, attempt: null,
    });
  });

  it('scopes vendor_data to the attempt when one is given', () => {
    // `POST /v3/session/` upserts on workflow_id + vendor_data, so this is
    // the difference between asking for a new session and being handed the
    // previous one.
    const v = buildVendorData(CASE_ID, PARTY_ID, 2);
    expect(v).toBe(`npc:${CASE_ID}:${PARTY_ID}:2`);
    expect(parseVendorData(v)).toEqual({ caseId: CASE_ID, partyId: PARTY_ID, attempt: 2 });
    expect(buildVendorData(CASE_ID, null, 3)).toBe(`npc:${CASE_ID}:primary:3`);
    // A different attempt is a different key, which is the whole point.
    expect(buildVendorData(CASE_ID, PARTY_ID, 1))
      .not.toBe(buildVendorData(CASE_ID, PARTY_ID, 2));
  });

  it('still parses the legacy unscoped form, which live sessions carry', () => {
    // Sessions minted before attempt scoping are valid for seven days and
    // must keep correlating, or their decisions are stranded.
    expect(parseVendorData(`npc:${CASE_ID}:primary`)).toEqual({
      caseId: CASE_ID, partyId: null, attempt: null,
    });
    expect(vendorDataMatches(`npc:${CASE_ID}:primary`, CASE_ID, null)).toBe(true);
    // And an expected attempt does not break it — there is nothing to compare.
    expect(vendorDataMatches(`npc:${CASE_ID}:primary`, CASE_ID, null, 1)).toBe(true);
  });

  it('refuses an attempt that is not a positive integer', () => {
    for (const bad of [`npc:${CASE_ID}:primary:0`, `npc:${CASE_ID}:primary:-1`,
      `npc:${CASE_ID}:primary:x`, `npc:${CASE_ID}:primary:1.5`, `npc:${CASE_ID}:primary:`]) {
      expect(parseVendorData(bad), bad).toBeNull();
    }
    // And a fifth segment is not a shape we mint.
    expect(parseVendorData(`npc:${CASE_ID}:primary:1:extra`)).toBeNull();
  });

  it('will not apply one attempt\'s decision to another attempt', () => {
    expect(vendorDataMatches(buildVendorData(CASE_ID, null, 2), CASE_ID, null, 2)).toBe(true);
    expect(vendorDataMatches(buildVendorData(CASE_ID, null, 2), CASE_ID, null, 1)).toBe(false);
  });

  it('never contains a name, email, document number or date of birth', () => {
    for (const v of [buildVendorData(CASE_ID, PARTY_ID), buildVendorData(CASE_ID, PARTY_ID, 4)]) {
      for (const pii of ['@', 'Smith', '1980', 'passport', ' ']) {
        expect(v).not.toContain(pii);
      }
    }
    // The scheme prefix, the two identifiers, and — when scoped — a counter
    // that is a small integer and nothing else.
    expect(buildVendorData(CASE_ID, PARTY_ID).split(':')).toHaveLength(3);
    const scoped = buildVendorData(CASE_ID, PARTY_ID, 4).split(':');
    expect(scoped).toHaveLength(4);
    expect(scoped[3]).toMatch(/^[0-9]+$/);
  });

  it('rejects vendor_data for another case or party', () => {
    expect(vendorDataMatches(buildVendorData(CASE_ID, PARTY_ID), CASE_ID, PARTY_ID)).toBe(true);
    expect(vendorDataMatches(buildVendorData(CASE_ID, PARTY_ID), CASE_ID, null)).toBe(false);
    expect(vendorDataMatches(buildVendorData('other', PARTY_ID), CASE_ID, PARTY_ID)).toBe(false);
    expect(vendorDataMatches('not-ours', CASE_ID, PARTY_ID)).toBe(false);
    expect(vendorDataMatches(undefined, CASE_ID, PARTY_ID)).toBe(false);
  });

  it('accepts a decision that matches session, workflow and party', () => {
    expect(() => assertDecisionCorrelates(decision(), correlation)).not.toThrow();
  });

  it('refuses a decision from a different session', () => {
    expect(() => assertDecisionCorrelates(decision({ session_id: 'other' }), correlation))
      .toThrow(DiditCorrelationError);
  });

  it('refuses a decision from a workflow NPC did not configure', () => {
    // The whole point: another workflow may run AML screening, or omit face
    // match. Its verdict is not the one NPC asked for.
    try {
      assertDecisionCorrelates(decision({ workflow_id: 'someone-elses-workflow' }), correlation);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(DiditCorrelationError);
      expect(e.code).toBe('workflow_mismatch');
    }
  });

  it('refuses a decision whose vendor_data points at another party', () => {
    try {
      assertDecisionCorrelates(
        decision({ vendor_data: buildVendorData(CASE_ID, 'someone-else') }), correlation);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.code).toBe('vendor_data_mismatch');
    }
  });

  it('refuses a decision with no correlation metadata at all', () => {
    expect(() => assertDecisionCorrelates({}, correlation)).toThrow(DiditCorrelationError);
  });
});

describe('what NPC persists', () => {
  /** The fields Didit really returns that must never reach the case record. */
  const dangerous = decision({
    session_url: 'https://verify.didit.me/session/LIVE-TOKEN-HERE',
    id_verifications: [{
      status: 'Approved',
      document_number: 'N1234567',
      date_of_birth: '1984-02-11',
      full_name: 'A Real Person',
      mrz: 'P<AUSPERSON<<A<<<<<<<<',
      parsed_address: '1 Somewhere St',
      front_image: 'https://cdn.didit.me/signed/front.jpg',
      back_image: 'https://cdn.didit.me/signed/back.jpg',
      portrait_image: 'https://cdn.didit.me/signed/portrait.jpg',
      warnings: [],
    }],
    liveness_checks: [{
      status: 'Approved', score: 91,
      reference_image: 'https://cdn.didit.me/signed/selfie.jpg',
      video_url: 'https://cdn.didit.me/signed/liveness.mp4',
      warnings: [],
    }],
    face_matches: [{
      status: 'Approved', score: 88,
      source_image: 'https://cdn.didit.me/signed/a.jpg',
      target_image: 'https://cdn.didit.me/signed/b.jpg',
      warnings: [],
    }],
  });

  const summary = summariseDiditDecision(dangerous, mapDiditDecision(dangerous));
  const serialised = JSON.stringify(summary);

  it('stores the outcome, the scores and the warning categories', () => {
    expect(summary.mapped_status).toBe('verified');
    expect(summary.session_id).toBe(SESSION_ID);
    expect(summary.required_features_complete).toBe(true);
    expect(summary.features.map((f) => f.feature))
      .toEqual(['ID_VERIFICATION', 'LIVENESS', 'FACE_MATCH']);
    expect(summary.features.find((f) => f.feature === 'FACE_MATCH')?.score).toBe(88);
  });

  it('stores NO image reference of any kind', () => {
    for (const key of ['front_image', 'back_image', 'portrait_image',
      'reference_image', 'video_url', 'source_image', 'target_image']) {
      expect(serialised).not.toContain(key);
    }
    expect(serialised).not.toContain('cdn.didit.me');
    expect(serialised).not.toContain('.jpg');
    expect(serialised).not.toContain('.mp4');
  });

  it('stores NO session URL or token — the URL is a live credential', () => {
    expect(serialised).not.toContain('session_url');
    expect(serialised).not.toContain('LIVE-TOKEN-HERE');
    expect(serialised).not.toContain('verify.didit.me');
  });

  it('stores NO document data read off the identity document', () => {
    for (const pii of ['N1234567', '1984-02-11', 'A Real Person',
      'P<AUSPERSON', '1 Somewhere St']) {
      expect(serialised).not.toContain(pii);
    }
  });

  it('is an allow-list: an unknown future field is not carried through', () => {
    const withNewField = decision({
      some_future_biometric_blob: 'data:image/jpeg;base64,AAAA',
      session_url: 'https://verify.didit.me/session/T',
    });
    const s = JSON.stringify(
      summariseDiditDecision(withNewField, mapDiditDecision(withNewField)));
    expect(s).not.toContain('some_future_biometric_blob');
    expect(s).not.toContain('base64');
  });

  it('the defensive scrubber also redacts credentials and document data', () => {
    const scrubbed: any = scrubDiditPayload(dangerous);
    expect(scrubbed.session_url).toBe(DIDIT_REDACTED);
    expect(scrubbed.id_verifications[0].front_image).toBe(DIDIT_REDACTED);
    expect(scrubbed.id_verifications[0].document_number).toBe(DIDIT_REDACTED);
    expect(scrubbed.liveness_checks[0].video_url).toBe(DIDIT_REDACTED);
    // Structure and the operative evidence survive.
    expect(scrubbed.id_verifications[0].status).toBe('Approved');
    expect(scrubbed.liveness_checks[0].score).toBe(91);
  });

  it('keeps warning CATEGORIES but not free text quoted from the document', () => {
    const withWarnings = decision({
      liveness_checks: [{
        status: 'In Review', score: 40,
        warnings: [
          { risk: 'FACE_QUALITY_LOW', additional_data: 'name on card: A Real Person' },
          'SCREEN_REPLAY_SUSPECTED',
        ],
      }],
    });
    const s = summariseDiditDecision(withWarnings, mapDiditDecision(withWarnings));
    const liveness = s.features.find((f) => f.feature === 'LIVENESS');
    expect(liveness?.warnings).toEqual(['FACE_QUALITY_LOW', 'SCREEN_REPLAY_SUSPECTED']);
    expect(JSON.stringify(s)).not.toContain('A Real Person');
  });
});

/* ────────────────── verbatim payloads from the live account ───────────────── */

/**
 * A REAL response from `GET /v3/session/{id}/decision/`, captured on
 * 2026-08-08 from the NPC workflow in the Aurixa Systems sandbox application.
 * Only the session token inside `session_url` is replaced — it is a live
 * credential for that session, and this file is committed.
 *
 * It is here because three of its properties are the ones a remembered V2
 * contract gets wrong, and a fixture taken from the provider is the only thing
 * that keeps the mapper honest about them:
 *
 *   - the feature results are `null` (not `{}`, not absent) before a run;
 *   - they are named `id_verifications` / `liveness_checks` / `face_matches`;
 *   - the ID module is `ID_VERIFICATION` here but `OCR` in the workflow graph.
 */
const REAL_NOT_STARTED_DECISION = {
  session_id: '1392cfc5-f20f-41c0-a0b3-95479591a31b',
  session_kind: 'user',
  shared_from_session: null,
  session_number: 1,
  session_url: 'https://verify.didit.me/session/REDACTED-TOKEN',
  status: 'Not Started',
  workflow_id: 'bb4349a9-8793-4e35-b0b8-ee559a19993a',
  features: ['ID_VERIFICATION', 'LIVENESS', 'FACE_MATCH'],
  vendor_data: 'npc:00000000-0000-4000-8000-000000000001:primary',
  metadata: {
    npc_env: 'test',
    verification_check_id: '00000000-0000-4000-8000-0000000000aa',
  },
  callback: null,
  id_verifications: null,
  nfc_verifications: null,
  nfc_skip_reason: null,
  liveness_checks: null,
  face_matches: null,
  poa_verifications: null,
  phone_verifications: null,
  email_verifications: null,
  aml_screenings: null,
  ip_analyses: null,
  database_validations: null,
  questionnaire_responses: null,
  document_ai_documents: null,
  reviews: [],
  contact_details: null,
  expected_details: null,
  environment: 'sandbox',
  sandbox_scenario: null,
  created_at: '2026-08-08T08:48:18.421786Z',
  expires_at: '2026-08-15T08:48:18.394276Z',
};

describe('against a real Didit decision payload', () => {
  it('reads a fresh session as pending — no outcome, no attempt', () => {
    const m = mapDiditDecision(REAL_NOT_STARTED_DECISION);
    expect(m.status).toBe('pending');
    expect(m.terminal).toBe(false);
    expect(m.requiredFeaturesComplete).toBe(false);
    const o = canonicalOutcome({ status: m.status, raw: {} }, { attemptsConsumed: 0, maxAttempts: 3 });
    expect(o.attemptConsumed).toBe(false);
    expect(o.status).toBeNull();
  });

  it('confirms the workflow really runs exactly the three required modules', () => {
    // The account's other workflows add IP_ANALYSIS, and "KYC + AML" adds the
    // AML module NPC must never enable. This one does not.
    expect(REAL_NOT_STARTED_DECISION.features).toEqual([...REQUIRED_DIDIT_FEATURES]);
    expect(REAL_NOT_STARTED_DECISION.aml_screenings).toBeNull();
    expect(REAL_NOT_STARTED_DECISION.ip_analyses).toBeNull();
  });

  it('correlates on the real vendor_data we minted', () => {
    const parsed = parseVendorData(REAL_NOT_STARTED_DECISION.vendor_data);
    expect(parsed).toEqual({
      caseId: '00000000-0000-4000-8000-000000000001', partyId: null,
      // Captured before attempt scoping — exactly the shape that must keep
      // parsing so a live session's decision is not stranded.
      attempt: null,
    });
  });

  it('the metadata we sent carries internal identifiers only', () => {
    const meta = REAL_NOT_STARTED_DECISION.metadata as Record<string, unknown>;
    expect(Object.keys(meta).sort()).toEqual(['npc_env', 'verification_check_id']);
    expect(JSON.stringify(meta)).not.toMatch(/@|name|dob|passport|licence/i);
  });

  it('summarising it stores no session URL — the URL carries a live token', () => {
    const s = JSON.stringify(
      summariseDiditDecision(REAL_NOT_STARTED_DECISION, mapDiditDecision(REAL_NOT_STARTED_DECISION)));
    expect(s).not.toContain('session_url');
    expect(s).not.toContain('verify.didit.me');
    expect(s).toContain('sandbox');
  });

  it('an Approved status on this payload STILL cannot pass — no evidence ran', () => {
    // The single most important behaviour in the integration, checked against
    // a real payload shape rather than a hand-written one.
    const forced = { ...REAL_NOT_STARTED_DECISION, status: 'Approved' };
    const m = mapDiditDecision(forced);
    expect(m.status).toBe('manual_review');
    expect(m.reason).toContain('required_feature_missing');
    expect(m.status).not.toBe('verified');
  });
});
