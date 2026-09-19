import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The self-hosted IDV adapter, against the verification service's real
 * responses.
 *
 * Every fixture below was captured from `services/aml-verification-service`
 * running with the genuine Apache-2.0 models — not hand-written from the
 * source. That matters, because the two sides of this contract are written in
 * different languages and the failures it has produced were all interpretation
 * failures rather than transport failures: the adapter read a field the
 * service meant differently.
 *
 * The rule these all serve: a customer's attempt is spent only on an
 * authoritative identity outcome. Anything that is our fault, the network's
 * fault, or a bad photograph must come back as `pending` or throw — never as
 * `failed`.
 */

// The adapter is Deno code. Only `Deno.env.get` is reached at import time or
// inside `runIdv`, so a minimal stub is enough to exercise the real module.
const env: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(env)) delete env[k];
  Object.assign(env, {
    AML_ENVIRONMENT: 'production',
    AML_VERIFICATION_SERVICE_URL: 'https://verify.example.internal',
    AML_VERIFICATION_SERVICE_TOKEN: 'service-token',
  });
  (globalThis as any).Deno = { env: { get: (k: string) => env[k] } };
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).Deno;
});

async function adapter() {
  const { getIdvProvider } = await import(
    '../../../supabase/functions/_shared/aml/providers/index.ts');
  return getIdvProvider({
    resolved: {
      providerKey: 'selfhosted', mode: 'live', configId: null, config: {}, costCents: 0,
    },
  });
}

const IMAGES = { document_image_b64: 'ZG9j', selfie_image_b64: 'c2VsZmll' };
const request = (metadata: Record<string, string> = IMAGES) => ({
  caseId: 'case-1', subjectLabel: 'Test Customer',
  method: 'document_and_liveness' as const, metadata,
});

/** Route each service path to a canned body, as the real service answers it. */
function serviceReturning(bodies: Record<string, unknown>, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
    const path = String(url).replace('https://verify.example.internal', '');
    return new Response(JSON.stringify(bodies[path] ?? {}), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  });
}

// ── fixtures, captured from the running service ──────────────────────────────

/** Both photographs unusable — the service found no face in either. */
const UNUSABLE_COMPARE = {
  verdict: 'unusable', similarity: null,
  problems: ['no_face_in_document', 'no_face_in_selfie'],
  thresholds: { match: 0.363, review: 0.28 }, duration_ms: 40,
};

/** A blurred selfie: the liveness heuristic could not run at all. */
const LIVENESS_NO_FACE = {
  is_real: null, score: null, problems: ['no_face_in_selfie'], confidence: 'none',
  advisory: 'No face detected; ask the customer to retake the photo.', duration_ms: 14,
};

/** An ordinary Australian driver licence: no ICAO machine-readable zone. */
const MRZ_ABSENT = {
  found: false, valid: false, format: null, fields: {}, checks: {}, errors: [], duration_ms: 8,
};

const GOOD_COMPARE = {
  verdict: 'match', similarity: 0.5412,
  thresholds: { match: 0.363, review: 0.28 }, problems: [], duration_ms: 120,
};

describe('self-hosted IDV adapter ↔ verification service', () => {
  it('reports an unusable capture as pending, so no attempt is spent', async () => {
    serviceReturning({
      '/doc/mrz': MRZ_ABSENT,
      '/face/compare': UNUSABLE_COMPARE,
      '/face/liveness': LIVENESS_NO_FACE,
    });
    const result = await (await adapter()).runIdv(request());
    // The worker maps pending → capture_unusable, which consumes no attempt.
    expect(result.status).toBe('pending');
    expect(result.status).not.toBe('failed');
  });

  it('does not fail a customer because their selfie was blurred', async () => {
    // The defect: `is_real` other than true was read as a liveness failure, so
    // a poor photograph became an identity failure with an attempt spent. The
    // service distinguishes quality from fraud in `problems`; the adapter now
    // does too.
    serviceReturning({
      '/doc/mrz': MRZ_ABSENT,
      '/face/compare': GOOD_COMPARE,
      '/face/liveness': {
        ...LIVENESS_NO_FACE, is_real: false, problems: ['image_too_blurred'],
      },
    });
    const result = await (await adapter()).runIdv(request());
    expect(result.status).toBe('pending');
    expect(result.checks.find((c) => c.name === 'liveness')?.status).not.toBe('fail');
  });

  it('still fails a screen-replay signal — that one is not a quality problem', async () => {
    serviceReturning({
      '/doc/mrz': MRZ_ABSENT,
      '/face/compare': GOOD_COMPARE,
      '/face/liveness': {
        ...LIVENESS_NO_FACE, is_real: false, problems: ['possible_screen_replay'],
      },
    });
    const result = await (await adapter()).runIdv(request());
    expect(result.status).toBe('failed');
  });

  it('treats an absent MRZ as a warning, never a failure', async () => {
    // Most Australian driver licences carry no MRZ. Failing on its absence
    // would fail most of the country.
    serviceReturning({
      '/doc/mrz': MRZ_ABSENT,
      '/face/compare': GOOD_COMPARE,
      '/face/liveness': { ...LIVENESS_NO_FACE, is_real: true, problems: [] },
    });
    const result = await (await adapter()).runIdv(request());
    expect(result.checks.find((c) => c.name === 'mrz_check_digits')?.status).toBe('warn');
    expect(result.status).not.toBe('failed');
  });

  it('fails a document whose MRZ check digits do not compute', async () => {
    serviceReturning({
      '/doc/mrz': { ...MRZ_ABSENT, found: true, valid: false, errors: ['document_number'] },
      '/face/compare': GOOD_COMPARE,
      '/face/liveness': { ...LIVENESS_NO_FACE, is_real: true, problems: [] },
    });
    const result = await (await adapter()).runIdv(request());
    expect(result.status).toBe('failed');
  });

  it('never returns verified — a face match is not a genuine document', async () => {
    // Without a check against the issuing authority the strongest honest
    // outcome is a referral. `verified` would auto-clear the service gate.
    serviceReturning({
      '/doc/mrz': { ...MRZ_ABSENT, found: true, valid: true },
      '/face/compare': { ...GOOD_COMPARE, similarity: 0.98 },
      '/face/liveness': { ...LIVENESS_NO_FACE, is_real: true, problems: [] },
    });
    const result = await (await adapter()).runIdv(request());
    expect(result.status).toBe('manual_review');
    expect(result.checks.find((c) => c.name === 'document_authenticity')?.status).toBe('warn');
    expect(result.raw.limitations).toContain('no_issuing_authority_check');
  });

  it('throws rather than returning an outcome when the service errors', async () => {
    // 503 is the service telling us its models are missing. That is our
    // deployment's fault and must reach the worker as a technical failure.
    serviceReturning({ '/doc/mrz': { code: 'model_unavailable' } }, 503);
    await expect((await adapter()).runIdv(request())).rejects.toThrow(/503/);
  });

  it('throws rather than returning an outcome when our own token is rejected', async () => {
    serviceReturning({ '/doc/mrz': { detail: 'Unauthorized' } }, 401);
    await expect((await adapter()).runIdv(request())).rejects.toThrow(/401/);
  });

  it('times out with a message the worker categorises as technical', async () => {
    // A hung service used to hang the worker until the platform killed it,
    // leaving the check claimed as `processing` forever — a permanent dead end
    // for the client. The word "timed out" is what the consumer matches on.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      const err = new Error('The signal has been aborted');
      err.name = 'TimeoutError';
      return Promise.reject(err);
    });
    await expect((await adapter()).runIdv(request())).rejects.toThrow(/timed out/i);
  });

  it('refuses to run at all when the service is not configured', async () => {
    // A missing URL must never look like a customer who failed verification.
    delete env.AML_VERIFICATION_SERVICE_URL;
    await expect(adapter()).rejects.toThrow();
  });

  it('never puts the service URL or token into an error', async () => {
    // This string is persisted to `failure_reason`, read by staff and logged.
    // A transport error quotes the request URL by default, which would put
    // internal configuration into the case record.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('error sending request for url (https://verify.example.internal/doc/mrz): refused'));
    await expect((await adapter()).runIdv(request())).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('verify.example.internal'),
      }));
  });

  it('never echoes a rejected token back in an error', async () => {
    serviceReturning({ '/doc/mrz': { detail: 'bad token service-token' } }, 401);
    const err = await (await adapter()).runIdv(request()).catch((e: Error) => e);
    expect(String((err as Error).message)).not.toContain('service-token');
  });

  it('never puts image bytes into the evidence it returns', async () => {
    // outcome_detail is written straight from `raw`. Nothing image-shaped
    // should be in it even before the consumer's own filter runs.
    serviceReturning({
      '/doc/mrz': MRZ_ABSENT,
      '/face/compare': GOOD_COMPARE,
      '/face/liveness': { ...LIVENESS_NO_FACE, is_real: true, problems: [] },
    });
    const result = await (await adapter()).runIdv(request());
    const serialised = JSON.stringify(result.raw);
    expect(serialised).not.toContain(IMAGES.document_image_b64);
    expect(serialised).not.toContain(IMAGES.selfie_image_b64);
    expect(serialised).not.toMatch(/base64/i);
  });

  it('requires a document image before calling the service', async () => {
    const spy = serviceReturning({});
    await expect((await adapter()).runIdv(request({ selfie_image_b64: 'c2VsZmll' })))
      .rejects.toThrow(/document image/i);
    expect(spy).not.toHaveBeenCalled();
  });
});
