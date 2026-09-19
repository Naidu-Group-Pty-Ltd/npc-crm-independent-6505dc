import { describe, expect, it } from 'vitest';
import {
  classifyStandaloneHttpError,
  composeStandaloneOutcome,
  documentConsistency,
  isPreProcessingFailure,
  mayProceed,
  parseThreshold,
  readFaceMatch,
  readIdVerification,
  readLiveness,
  readStandaloneThresholds,
  scrubStandalonePayload,
  STANDALONE_REDACTED,
  COULD_NOT_RECOGNIZE_DOCUMENT,
  isAllowedMediaUrl,
  DEFAULT_DIDIT_MEDIA_HOSTS,
} from '../../../supabase/functions/_shared/aml/providers/diditStandalone.pure.ts';
import { canonicalOutcome } from '../../../supabase/functions/_shared/aml/verificationOutcome.pure.ts';
import {
  identityDocumentCapturePlan, requiredCaptureKinds, parseCaptureKind,
  IDENTITY_DOCUMENT_CHOICES,
} from '../../../supabase/functions/_shared/aml/identityDocuments.pure.ts';

/**
 * The Didit **Standalone API** contract, held against what the published
 * documentation actually says rather than against what the hosted-session
 * client would suggest.
 *
 * Several of these exist because the obvious implementation is wrong or
 * dangerous: a 200 is not a pass, an unreadable photograph is not a failed
 * identity, the ID response carries an inline base64 face that must never be
 * persisted, and every threshold default the vendor ships is more permissive
 * than a compliance position anybody chose.
 */

/* ────────────────────────── the capture plan ────────────────────────────── */

describe('identity document capture plan', () => {
  it('asks for a back only for the two card documents', () => {
    expect(identityDocumentCapturePlan('passport').document_back).toBe(false);
    expect(identityDocumentCapturePlan('residence_permit').document_back).toBe(false);
    expect(identityDocumentCapturePlan('driver_licence').document_back).toBe(true);
    expect(identityDocumentCapturePlan('identity_card').document_back).toBe(true);
  });

  it('always requires a front and a selfie, for every accepted document', () => {
    for (const choice of IDENTITY_DOCUMENT_CHOICES) {
      const plan = identityDocumentCapturePlan(choice);
      expect(plan.document_front).toBe(true);
      expect(plan.selfie).toBe(true);
    }
  });

  it('lists required captures in the order they are taken', () => {
    expect(requiredCaptureKinds('passport')).toEqual(['document_front', 'selfie']);
    expect(requiredCaptureKinds('driver_licence'))
      .toEqual(['document_front', 'document_back', 'selfie']);
  });

  it('refuses a capture kind outside the closed list', () => {
    expect(parseCaptureKind('selfie')).toBe('selfie');
    expect(parseCaptureKind('DOCUMENT_FRONT')).toBe('document_front');
    expect(parseCaptureKind('passport_page')).toBeNull();
    expect(parseCaptureKind(null)).toBeNull();
    expect(parseCaptureKind(42)).toBeNull();
  });
});

/* ──────────────────────────── thresholds ───────────────────────────────── */

describe('decline thresholds', () => {
  it('accepts 0 and 100 and refuses everything outside', () => {
    expect(parseThreshold('0')).toBe(0);
    expect(parseThreshold('100')).toBe(100);
    expect(parseThreshold('62.5')).toBe(62.5);
    expect(parseThreshold('-1')).toBeNull();
    expect(parseThreshold('101')).toBeNull();
    expect(parseThreshold('high')).toBeNull();
    expect(parseThreshold('')).toBeNull();
    expect(parseThreshold(undefined)).toBeNull();
  });

  it('is NOT ready when either threshold is absent — no vendor default is inherited', () => {
    const env = (map: Record<string, string>) => (k: string) => map[k];
    expect(readStandaloneThresholds(env({ DIDIT_LIVENESS_THRESHOLD: '50' }))).toBeNull();
    expect(readStandaloneThresholds(env({ DIDIT_FACE_MATCH_THRESHOLD: '60' }))).toBeNull();
    expect(readStandaloneThresholds(env({}))).toBeNull();
  });

  it('is NOT ready when a threshold is present but out of range', () => {
    const thresholds = readStandaloneThresholds((k) => ({
      DIDIT_LIVENESS_THRESHOLD: '50', DIDIT_FACE_MATCH_THRESHOLD: '140',
    }[k]));
    expect(thresholds).toBeNull();
  });

  it('reads both when both are valid', () => {
    expect(readStandaloneThresholds((k) => ({
      DIDIT_LIVENESS_THRESHOLD: '50', DIDIT_FACE_MATCH_THRESHOLD: '60',
    }[k]))).toEqual({ liveness: 50, faceMatch: 60 });
  });
});

/* ─────────────────────── error classification ──────────────────────────── */

describe('provider failure classification', () => {
  it('separates an unreadable document from an integration bug at 400', () => {
    expect(classifyStandaloneHttpError(400, `{"error":"${COULD_NOT_RECOGNIZE_DOCUMENT}"}`))
      .toBe('capture_unreadable');
    expect(classifyStandaloneHttpError(400, '{"front_image":["Unsupported extension"]}'))
      .toBe('provider_rejected_request');
  });

  it('separates an empty credit balance from a bad key at 403', () => {
    expect(classifyStandaloneHttpError(403, `{"error":"You don't have enough credits"}`))
      .toBe('insufficient_credits');
    expect(classifyStandaloneHttpError(403, '{"detail":"You do not have permission"}'))
      .toBe('provider_not_configured');
  });

  it('maps 401, 429 and 5xx to their own categories', () => {
    expect(classifyStandaloneHttpError(401, '')).toBe('provider_not_configured');
    expect(classifyStandaloneHttpError(429, 'rate limit')).toBe('rate_limited');
    expect(classifyStandaloneHttpError(500, '')).toBe('provider_unavailable');
    expect(classifyStandaloneHttpError(503, '')).toBe('provider_unavailable');
  });

  it('knows which failures happened before any paid processing', () => {
    expect(isPreProcessingFailure('insufficient_credits')).toBe(true);
    expect(isPreProcessingFailure('rate_limited')).toBe(true);
    expect(isPreProcessingFailure('provider_not_configured')).toBe(true);
    expect(isPreProcessingFailure('provider_rejected_request')).toBe(true);
    // A timeout is the ambiguous one: the request left and we never learned
    // what happened to it, so it is NOT safe to call pre-processing.
    expect(isPreProcessingFailure('timeout')).toBe(false);
  });
});

/* ──────────────────────────── sanitisation ─────────────────────────────── */

describe('what may be persisted from a Standalone response', () => {
  const idBody = {
    request_id: 'req-1',
    id_verification: {
      status: 'Approved',
      document_type: 'Driver License',
      issuing_state: 'AUS',
      // The three inline images returned when save_api_request=false.
      portrait_image: 'AAAA',
      front_image: 'BBBB',
      back_image: 'CCCC',
      // Extracted personal detail.
      first_name: 'Jane', last_name: 'Citizen', full_name: 'Jane Citizen',
      address: '1 Example Street, Sydney NSW 2000',
      date_of_birth: '1990-01-01',
      document_number: 'D1234567',
      mrz: { mrz_string: 'P<AUS...' },
      warnings: [],
    },
  };

  it('removes every inline image by NAME, however short it is', () => {
    const clean = scrubStandalonePayload(idBody) as any;
    expect(clean.id_verification.portrait_image).toBe(STANDALONE_REDACTED);
    expect(clean.id_verification.front_image).toBe(STANDALONE_REDACTED);
    expect(clean.id_verification.back_image).toBe(STANDALONE_REDACTED);
    // Length-based redaction would have left all three: they are four
    // characters long in this fixture and the size sweep starts at 256.
    expect(JSON.stringify(clean)).not.toContain('AAAA');
  });

  it('removes the extracted name, address, date of birth and MRZ', () => {
    const clean = scrubStandalonePayload(idBody) as any;
    for (const key of ['first_name', 'last_name', 'full_name', 'address',
      'date_of_birth', 'mrz']) {
      expect(clean.id_verification[key]).toBe(STANDALONE_REDACTED);
    }
    const serialised = JSON.stringify(clean);
    expect(serialised).not.toContain('Jane');
    expect(serialised).not.toContain('Example Street');
  });

  it('keeps what an adjudicator needs to judge the CHECK', () => {
    const clean = scrubStandalonePayload(idBody) as any;
    expect(clean.id_verification.status).toBe('Approved');
    expect(clean.id_verification.document_type).toBe('Driver License');
    expect(clean.id_verification.issuing_state).toBe('AUS');
    expect(clean.request_id).toBe('req-1');
  });

  it('marks removals rather than deleting the key', () => {
    // A silently missing key reads as "the provider returned nothing here",
    // which is a different and misleading statement.
    const clean = scrubStandalonePayload(idBody) as any;
    expect('portrait_image' in clean.id_verification).toBe(true);
  });

  it('never lets the portrait out of readIdVerification.sanitised', () => {
    const reading = readIdVerification(idBody);
    // The orchestrator gets the portrait for the Face Match call...
    expect(reading.portraitBase64).toBe('AAAA');
    // ...and what goes to the database does not have it.
    expect(JSON.stringify(reading.sanitised)).not.toContain('AAAA');
  });
});

/* ───────────────────────── reading a response ──────────────────────────── */

const approvedId = {
  request_id: 'id-1',
  id_verification: {
    status: 'Approved', document_type: 'Driver License', issuing_state: 'AUS',
    portrait_image: 'PORTRAIT', warnings: [],
  },
};

describe('reading an ID verification response', () => {
  it('reads Approved as approved', () => {
    expect(readIdVerification(approvedId).verdict).toBe('approved');
  });

  it('reads Declined as declined', () => {
    expect(readIdVerification({
      request_id: 'x',
      id_verification: {
        status: 'Declined',
        warnings: [{ risk: 'SCREEN_CAPTURE_DETECTED', log_type: 'error' }],
      },
    }).verdict).toBe('declined');
  });

  it('reads a document it could not classify as a RETAKE, not a decline', () => {
    // The customer photographed badly. That is not a finding about them and
    // must not spend an attempt.
    expect(readIdVerification({
      request_id: 'x',
      id_verification: {
        status: 'Declined',
        warnings: [{ risk: 'COULD_NOT_DETECT_DOCUMENT_TYPE', log_type: 'error' }],
      },
    }).verdict).toBe('unreadable');
  });

  it('never reads a missing or unparseable block as a pass', () => {
    expect(readIdVerification({}).verdict).toBe('indeterminate');
    expect(readIdVerification(null).verdict).toBe('indeterminate');
    expect(readIdVerification({ id_verification: {} }).verdict).toBe('indeterminate');
    expect(readIdVerification({ id_verification: { status: 'Maybe' } }).verdict)
      .toBe('indeterminate');
  });

  it('refers an Approved that carries an MRZ warning rather than passing it', () => {
    // An Australian driver licence has no MRZ at all, which is why NPC sets
    // invalid_mrz_action=NO_ACTION and decides here instead.
    expect(readIdVerification({
      request_id: 'x',
      id_verification: {
        status: 'Approved',
        warnings: [{ risk: 'MRZ_NOT_DETECTED', log_type: 'warning' }],
      },
    }).verdict).toBe('indeterminate');
  });
});

describe('reading liveness and face match', () => {
  it('reads an approved liveness with its score', () => {
    const reading = readLiveness({
      request_id: 'lv-1',
      liveness: { status: 'Approved', score: 91.4, warnings: [] },
    });
    expect(reading.verdict).toBe('approved');
    expect(reading.score).toBe(91.4);
  });

  it('reads no-face-detected as a retake, not a liveness failure', () => {
    expect(readLiveness({
      liveness: {
        status: 'Declined',
        warnings: [{ risk: 'NO_FACE_DETECTED', log_type: 'error' }],
      },
    }).verdict).toBe('unreadable');
  });

  it('reads a low liveness score as a real decline', () => {
    expect(readLiveness({
      liveness: {
        status: 'Declined', score: 4,
        warnings: [{ risk: 'LOW_LIVENESS_SCORE', log_type: 'error' }],
      },
    }).verdict).toBe('declined');
  });

  it('reads a face match below threshold as a real decline', () => {
    expect(readFaceMatch({
      face_match: {
        status: 'Declined', score: 12,
        warnings: [{ risk: 'LOW_FACE_MATCH_SIMILARITY', log_type: 'error' }],
      },
    }).verdict).toBe('declined');
  });

  it('reads a missing reference image as a retake', () => {
    expect(readFaceMatch({
      face_match: {
        status: 'Declined',
        warnings: [{ risk: 'NO_REFERENCE_IMAGE', log_type: 'error' }],
      },
    }).verdict).toBe('unreadable');
  });
});

/* ────────────────── customer selection vs detection ────────────────────── */

describe('what the customer claimed against what Didit detected', () => {
  it('accepts a matching Australian document', () => {
    expect(documentConsistency('driver_licence', 'Driver License', 'AUS').outcome)
      .toBe('consistent');
    expect(documentConsistency('passport', 'Passport', 'AUS').outcome).toBe('consistent');
    expect(documentConsistency('identity_card', 'Identity Card', 'AUS').outcome)
      .toBe('consistent');
    expect(documentConsistency('residence_permit', 'Residence Permit', 'AUS').outcome)
      .toBe('consistent');
  });

  it('tolerates the punctuation the field actually varies in', () => {
    for (const detected of ["Driver's License", 'Drivers Licence', 'DRIVING_LICENCE']) {
      expect(documentConsistency('driver_licence', detected, 'AUS').outcome)
        .toBe('consistent');
    }
  });

  it('flags a non-Australian document whatever the type says', () => {
    const result = documentConsistency('passport', 'Passport', 'GBR');
    expect(result.outcome).toBe('mismatch');
    expect(result.reason).toBe('country_mismatch');
  });

  it('flags a document that is not the one they selected', () => {
    const result = documentConsistency('driver_licence', 'Passport', 'AUS');
    expect(result.outcome).toBe('mismatch');
    expect(result.reason).toBe('type_mismatch');
  });

  it('flags a document outside NPC’s accepted list', () => {
    expect(documentConsistency('identity_card', 'Medicare Card', 'AUS').outcome)
      .toBe('mismatch');
  });

  it('answers unknown — never consistent — when nothing was classified', () => {
    expect(documentConsistency('passport', null, null).outcome).toBe('unknown');
    expect(documentConsistency('passport', '', 'AUS').outcome).toBe('unknown');
  });
});

/* ─────────────────────────── the roll-up ───────────────────────────────── */

const approved = (over: Record<string, unknown> = {}) => ({
  status: 'Approved', warnings: [], ...over,
});

function compose(over: {
  id?: unknown; liveness?: unknown; faceMatch?: unknown;
  claimed?: 'passport' | 'driver_licence' | 'identity_card' | 'residence_permit';
} = {}) {
  return composeStandaloneOutcome({
    claimed: over.claimed ?? 'driver_licence',
    id: readIdVerification(over.id ?? {
      request_id: 'id-1',
      id_verification: approved({ document_type: 'Driver License', issuing_state: 'AUS' }),
    }),
    liveness: over.liveness === null ? null
      : readLiveness(over.liveness ?? { request_id: 'lv', liveness: approved({ score: 90 }) }),
    faceMatch: over.faceMatch === null ? null
      : readFaceMatch(over.faceMatch ?? { request_id: 'fm', face_match: approved({ score: 88 }) }),
  });
}

describe('one identity position from three provider answers', () => {
  it('verifies only when all three are approved AND the document matches', () => {
    expect(compose().status).toBe('verified');
  });

  it('refers — never verifies — when the detected document disagrees', () => {
    const result = compose({ claimed: 'passport' });
    expect(result.status).toBe('manual_review');
    expect(result.consistency.reason).toBe('type_mismatch');
  });

  it('refers — never verifies — a document from another country', () => {
    expect(compose({
      id: {
        request_id: 'id',
        id_verification: approved({ document_type: 'Passport', issuing_state: 'GBR' }),
      },
      claimed: 'passport',
    }).status).toBe('manual_review');
  });

  it('fails on a declined document', () => {
    expect(compose({
      id: {
        request_id: 'id',
        id_verification: {
          status: 'Declined',
          warnings: [{ risk: 'PORTRAIT_MANIPULATION_DETECTED', log_type: 'error' }],
        },
      },
    }).status).toBe('failed');
  });

  it('fails on a declined liveness', () => {
    expect(compose({
      liveness: {
        request_id: 'lv',
        liveness: {
          status: 'Declined', score: 3,
          warnings: [{ risk: 'LIVENESS_FACE_ATTACK', log_type: 'error' }],
        },
      },
      faceMatch: null,
    }).status).toBe('failed');
  });

  it('fails on a declined face match', () => {
    expect(compose({
      faceMatch: {
        request_id: 'fm',
        face_match: {
          status: 'Declined', score: 11,
          warnings: [{ risk: 'LOW_FACE_MATCH_SIMILARITY', log_type: 'error' }],
        },
      },
    }).status).toBe('failed');
  });

  it('reports an unreadable capture as pending, and unreadable beats declined', () => {
    // A selfie nobody could find a face in is a photography problem. It must
    // not become a liveness failure just because another step also said no.
    const result = compose({
      liveness: {
        request_id: 'lv',
        liveness: {
          status: 'Declined',
          warnings: [{ risk: 'NO_FACE_DETECTED', log_type: 'error' }],
        },
      },
      faceMatch: null,
    });
    expect(result.status).toBe('pending');
  });

  it('refers when a step never ran', () => {
    expect(compose({ liveness: null, faceMatch: null }).status).toBe('manual_review');
    expect(compose({ faceMatch: null }).status).toBe('manual_review');
  });
});

/* ─────────────────────── sequencing and allowance ──────────────────────── */

describe('the fail-fast sequence', () => {
  it('proceeds only on an approved step', () => {
    expect(mayProceed('approved')).toBe(true);
    expect(mayProceed('declined')).toBe(false);
    expect(mayProceed('unreadable')).toBe(false);
    expect(mayProceed('indeterminate')).toBe(false);
  });
});

describe('what a Standalone outcome does to the attempt allowance', () => {
  const settle = (status: string, used = 0) =>
    canonicalOutcome({ status, raw: {} }, { attemptsConsumed: used, maxAttempts: 3 });

  it('spends nothing on an unreadable capture', () => {
    const outcome = settle('pending');
    expect(outcome.attemptConsumed).toBe(false);
    expect(outcome.processingStatus).toBe('capture_unusable');
    expect(outcome.status).toBeNull();
  });

  it('spends an attempt on a real failure, and exhausts on the third', () => {
    expect(settle('failed', 0).attemptConsumed).toBe(true);
    expect(settle('failed', 0).status).toBe('failed');
    expect(settle('failed', 2).status).toBe('exhausted');
  });

  it('records a referral as a referral, not a failure', () => {
    expect(settle('manual_review').status).toBe('referred');
  });

  it('never exhausts on a referral, however many have happened', () => {
    expect(settle('manual_review', 2).status).toBe('referred');
  });
});

/* ─────────────── the media-URL allow-list (SSRF, save_api_request=true) ──── */

/**
 * `save_api_request=true` returns `portrait_image` as a media URL rather than
 * inline base64, so NPC has to fetch it to have a Face Match reference at all.
 * That is server-side egress driven by a third party's payload — SSRF by
 * construction unless it is fenced — and this is the fence.
 *
 * The real host was measured off the live account rather than inferred: a
 * persisted portrait came back from
 * `service-didit-verification-production-a1c5f9b8.s3.amazonaws.com`. Didit's
 * docs write it as a `<media-host>` placeholder, which is exactly why this is
 * an allow-list with a configurable override and not a pattern.
 */
describe('media URL allow-list', () => {
  const ALLOWED = 'https://service-didit-verification-production-a1c5f9b8.s3.amazonaws.com'
    + '/ocr/874516ec-portrait_image-d363733e.jpg?X-Amz-Signature=abc';

  it('admits the measured provider media host, and ONLY that', () => {
    expect(isAllowedMediaUrl(ALLOWED)).toBe(true);
    // Exactly one entry, and it is the host actually observed returning a
    // persisted portrait. An entry nobody has evidence for is widened attack
    // surface; `DIDIT_MEDIA_HOSTS` is the controlled way to add one.
    expect([...DEFAULT_DIDIT_MEDIA_HOSTS])
      .toEqual(['service-didit-verification-production-a1c5f9b8.s3.amazonaws.com']);
    // The API host is NOT a media host and is not listed.
    expect(isAllowedMediaUrl('https://verification.didit.me/ocr/portrait.jpg')).toBe(false);
  });

  it('refuses any other https host, however plausible', () => {
    for (const url of [
      // The attacker-controlled cases: a bucket they can create, a lookalike,
      // and a subdomain of an allowed name.
      'https://evil.s3.amazonaws.com/ocr/portrait.jpg',
      'https://service-didit-verification-production-a1c5f9b8.s3.amazonaws.com.evil.com/x.jpg',
      'https://didit.me.evil.com/portrait.jpg',
      'https://evil.com/ocr/portrait_image.jpg',
      'https://verification.didit.me.attacker.net/x.jpg',
    ]) {
      expect(isAllowedMediaUrl(url), url).toBe(false);
    }
  });

  it('refuses everything that is not https on the default port', () => {
    for (const url of [
      'http://service-didit-verification-production-a1c5f9b8.s3.amazonaws.com/x.jpg',
      'file:///etc/passwd',
      'data:image/jpeg;base64,AAAA',
      'gopher://service-didit-verification-production-a1c5f9b8.s3.amazonaws.com/',
      // A non-443 port is how an internal service is usually addressed.
      'https://service-didit-verification-production-a1c5f9b8.s3.amazonaws.com:8080/x.jpg',
      // Credentials in the URL would be sent to the host.
      'https://user:pw@service-didit-verification-production-a1c5f9b8.s3.amazonaws.com/x.jpg',
    ]) {
      expect(isAllowedMediaUrl(url), url).toBe(false);
    }
  });

  it('refuses loopback, private, link-local and internal names even if allow-listed', () => {
    /*
     * Defence in depth. These are unreachable while the list holds only public
     * provider hosts — the point is that a mis-configured `DIDIT_MEDIA_HOSTS`
     * entry cannot turn this into a request primitive aimed at NPC's own
     * infrastructure or a cloud metadata endpoint.
     */
    const hostile = [
      'https://localhost/x.jpg',
      'https://127.0.0.1/x.jpg',
      'https://10.0.0.5/x.jpg',
      'https://192.168.1.10/x.jpg',
      'https://172.16.0.9/x.jpg',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/x.jpg',
      'https://[fd00::1]/x.jpg',
      'https://kong.internal/x.jpg',
      'https://db.local/x.jpg',
      'https://host.localdomain/x.jpg',
    ];
    for (const url of hostile) {
      expect(isAllowedMediaUrl(url), `default: ${url}`).toBe(false);
      // And still refused when somebody puts the host ON the list.
      const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
      expect(isAllowedMediaUrl(url, [host]), `allow-listed: ${url}`).toBe(false);
    }
  });

  it('refuses anything that is not a parseable URL string', () => {
    for (const value of [null, undefined, '', 'not a url', '/ocr/portrait.jpg', 42, {}, []]) {
      expect(isAllowedMediaUrl(value), String(value)).toBe(false);
    }
  });

  it('honours a configured override, exactly and case-insensitively', () => {
    const custom = 'https://media.example-didit.com/ocr/p.jpg';
    expect(isAllowedMediaUrl(custom)).toBe(false);
    expect(isAllowedMediaUrl(custom, ['media.example-didit.com'])).toBe(true);
    expect(isAllowedMediaUrl(custom, ['MEDIA.EXAMPLE-DIDIT.COM'])).toBe(true);
    // An override does not admit a sibling host.
    expect(isAllowedMediaUrl('https://other.example-didit.com/p.jpg',
      ['media.example-didit.com'])).toBe(false);
  });
});
