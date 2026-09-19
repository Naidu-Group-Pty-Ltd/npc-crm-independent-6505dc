import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The production failure, as a contract.
 *
 * Nine identity documents were written to the private `aml-documents` bucket
 * and abandoned there. No selfie ever reached `aml-biometrics`, no
 * `aml.verification_checks` row was ever created, and no outbox event was ever
 * emitted — because the submission uploaded the document first and only then
 * asked for the selfie upload grant, which is the request that checks provider
 * readiness and remaining attempts. With no live provider that grant answers
 * 409 `manual_verification_required`, so every attempt cost the customer an
 * upload of their identity document and gave them an error that reads like a
 * dead end.
 *
 * ## How the fix changed shape, and why these tests changed with it
 *
 * The first fix was ordering: ask for BOTH grants before writing either byte.
 * The Standalone capture journey goes further and makes the ordering
 * structural — there is now ONE gated call, `prepare_verification_attempt`,
 * which performs every check (session, case, party, both consents, provider
 * readiness, the attempt ceiling, one-in-flight) and only then mints the
 * signed upload permissions. It is called from the Begin button, before the
 * camera opens.
 *
 * So the property under test is stronger than it was: not merely "no byte
 * before the gate", but "no CAMERA before the gate, and no upload location
 * exists at all until the server has agreed". These tests assert that, and the
 * old ones are gone because the code they described is.
 */

const step = readFileSync('src/components/portal/IdentityVerificationStep.tsx', 'utf8');
const portal = readFileSync('supabase/functions/aml-client-portal/index.ts', 'utf8');

/** The capture journey only — the hosted component sits above it in the file. */
const journey = step.slice(step.indexOf('function SecureCaptureCheck('));

const stripComments = (source: string) => source.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const beginBlock = stripComments(journey.slice(
  journey.indexOf('const begin = useCallback'),
  journey.indexOf('const submit = useCallback')));

const submitBlock = stripComments(journey.slice(
  journey.indexOf('const submit = useCallback'),
  journey.indexOf('useEffect(() => {', journey.indexOf('const submit = useCallback'))));

const prepareOp = portal.slice(
  portal.indexOf("case 'prepare_verification_attempt':"),
  portal.indexOf("case 'submit_verification_attempt':"));

describe('nothing is collected before the gate', () => {
  it('the camera opens only after the server has prepared the attempt', () => {
    // `begin` is the Begin-secure-verification click. It awaits the prepared
    // attempt and only then moves to the first capture stage — so a refusal
    // means the customer never reached a camera at all.
    const prepared = beginBlock.indexOf('prepareVerificationAttempt(caseId');
    const firstCapture = beginBlock.indexOf("setStage('document_front')");
    expect(prepared, 'the attempt must be prepared').toBeGreaterThan(-1);
    expect(firstCapture, 'the first capture stage must be entered').toBeGreaterThan(-1);
    expect(prepared, 'no capture stage before preparation').toBeLessThan(firstCapture);
  });

  it('the upload locations come from the prepared attempt and nowhere else', () => {
    // There is no client-side path construction to get wrong, and no second
    // grant call that could be the gate.
    expect(submitBlock).toContain('prepared.uploads[kind]');
    expect(submitBlock).not.toContain('requestVerificationUpload');
    expect(journey).not.toMatch(/`\$\{caseId\}\//);
  });

  it('no byte is written before every required grant exists', () => {
    // The PUT loop reads a grant per required capture and refuses to proceed
    // without one. A missing grant sends the customer back to that photograph
    // rather than uploading anything.
    const grant = submitBlock.indexOf('const grant = prepared.uploads[kind]');
    const put = submitBlock.indexOf('fetch(grant.upload_url');
    expect(grant).toBeGreaterThan(-1);
    expect(put).toBeGreaterThan(grant);
    expect(submitBlock).toContain('if (!shot || !grant)');
  });

  it('a refusal is handed back to the step instead of retried', () => {
    expect(beginBlock).toContain('UNAVAILABLE_CODES');
    expect(beginBlock).toContain('onExit()');
    expect(submitBlock).toContain('UNAVAILABLE_CODES');
  });
});

describe('the server refuses before it mints anywhere to write', () => {
  it('checks readiness, consent and the attempt ceiling before any signed URL', () => {
    const signedUrl = prepareOp.indexOf('createSignedUploadUrl');
    expect(signedUrl, 'the operation must mint upload grants').toBeGreaterThan(-1);
    for (const gate of [
      "availability !== 'available'",
      'biometric_consent_required',
      'attempts_exhausted',
      'already_processing',
      'consentRequiredResponse',
      'unsupported_document_type',
    ]) {
      const at = prepareOp.indexOf(gate);
      expect(at, `${gate} must be checked`).toBeGreaterThan(-1);
      expect(at, `${gate} must be checked before any upload grant`).toBeLessThan(signedUrl);
    }
  });

  it('grants nothing for a side the chosen document does not have', () => {
    // A passport holder is never handed a place to write a back image, so a
    // stray object cannot exist for one.
    expect(prepareOp).toContain('if (!required[kind]) continue');
  });
});

describe('availability gate before the camera opens', () => {
  it('re-reads status on Start rather than trusting the mount-time value', () => {
    const start = step.slice(step.indexOf('const startCapture'), step.indexOf('if (loadError)'));
    expect(start).toContain('verificationStatus(caseId)');
    expect(start).toContain("!== 'available'");
    expect(start, 'the party must still have an attempt').toContain('can_attempt');
    // The sub-screen opens only after both checks pass.
    expect(start.indexOf('verificationStatus(caseId)'))
      .toBeLessThan(start.indexOf('setChecking(party)'));
  });

  it('opens the check only through the gate', () => {
    // A bare onClick={() => setChecking(party)} would bypass the re-check.
    expect(step).not.toMatch(/onClick=\{\(\)\s*=>\s*setChecking\(party\)\}/);
  });
});

describe('preparing costs the customer nothing', () => {
  it('creates a draft, which the attempt counter cannot see', () => {
    expect(prepareOp).toContain("processing_status: 'draft'");
    expect(prepareOp).toContain('attempt_consumed: false');
  });

  it('resumes an existing draft rather than minting a second one', () => {
    // A refresh, a second tab and a double tap must land on the same attempt
    // and the same three storage paths.
    expect(prepareOp).toContain('draftCaptureAttempt(admin, c.id, partyId)');
    expect(prepareOp).toContain("insert.error.code === '23505'");
  });
});

describe('server refusal codes reach the client', () => {
  it('carries `code` off the error response', () => {
    // Without this the portal could only match on prose, so a readiness
    // refusal looked identical to a failed capture.
    const api = readFileSync('src/lib/aml/amlPortalApi.ts', 'utf8');
    expect(api).toContain('err.code =');
    expect(api).toContain('json.code');
  });
});
