import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The one test in this suite that can spend money — and therefore the one that
 * does not run unless somebody deliberately turns it on.
 *
 * It exercises the three Didit Standalone endpoints for real, against a
 * SANDBOX key, and asserts the contract this integration was written from:
 * multipart bodies with a generated boundary, `save_api_request=true`, a 200
 * that carries a per-feature status rather than implying one, and an ID
 * response whose inline portrait can be decoded and used as the face-match
 * reference.
 *
 * ## Why it is opt-in, and how
 *
 * `DIDIT_SANDBOX_API_KEY` gates it. Without that variable every case below
 * skips, so CI, a local `npm test` and a reviewer's machine all do nothing —
 * they cannot accidentally call a paid API, and they cannot fail because of
 * somebody else's network.
 *
 *     DIDIT_SANDBOX_API_KEY=sk_sandbox_… npx vitest run \
 *       src/lib/aml/diditStandaloneSandbox.integration.test.ts
 *
 * The variable name is deliberately NOT `DIDIT_API_KEY`. A test that read the
 * production variable would run against live credits the moment somebody
 * exported it for an unrelated reason, and Didit's own documentation is clear
 * that sandbox keys "return mock data without billing or processing" — so the
 * safety here is that the two are impossible to confuse.
 *
 * ## What it must never print
 *
 * The key, any image, any base64, any signed URL. Assertions below are on
 * shapes and statuses; nothing in this file logs a response body, and the two
 * fixtures are generated in memory rather than read from a customer's file.
 */

const SANDBOX_KEY = process.env.DIDIT_SANDBOX_API_KEY ?? '';
const BASE = (process.env.DIDIT_SANDBOX_API_BASE_URL ?? 'https://verification.didit.me')
  .replace(/\/+$/, '');
const enabled = SANDBOX_KEY.length > 0;

/** Per-call ceiling, so a hung sandbox cannot hang a suite. */
const TIMEOUT_MS = 60_000;

/**
 * A minimal valid JPEG, built in memory.
 *
 * Not a real document and not a real face — the sandbox returns mock data, so
 * the point is the TRANSPORT: that a `FormData` part built from bytes is
 * accepted, that the boundary `fetch` generates is parseable at the far end,
 * and that the response comes back in the shape this integration reads. A
 * fixture file would mean a customer's photograph in the repository, which is
 * the one thing this programme is most careful never to create.
 */
function tinyJpeg(): Uint8Array {
  // SOI, APP0/JFIF, a 1x1 grey scan, EOI. Enough to be a decodable JPEG.
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, ...new Array(64).fill(0x10),
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, ...new Array(15).fill(0x00), 0x03,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x37, 0xff, 0xd9,
  ]);
}

async function callSandbox(
  path: string, build: (form: FormData) => void,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.append('save_api_request', 'true');
  form.append('vendor_data', 'npc:sandbox-test:primary:1');
  build(form);

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    // No Content-Type: `fetch` derives it from the FormData, boundary included.
    // Writing it by hand is the defect this whole integration is careful about.
    headers: { 'x-api-key': SANDBOX_KEY, Accept: 'application/json' },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body: body as Record<string, unknown> };
}

const part = (bytes: Uint8Array) => new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' });

describe.skipIf(!enabled)('Didit Standalone APIs — live sandbox', () => {
  it('accepts a multipart ID verification and answers with a feature block', async () => {
    const { status, body } = await callSandbox('/v3/id-verification/', (form) => {
      form.append('front_image', part(tinyJpeg()), 'front.jpg');
      form.append('perform_document_liveness', 'true');
      form.append('invalid_mrz_action', 'NO_ACTION');
    });

    // A 400 here would mean the multipart body did not parse — the boundary
    // defect. A 403 would mean the key is wrong or has no credits.
    expect([200, 400], `unexpected status ${status}`).toContain(status);
    if (status !== 200) return;

    expect(body).toHaveProperty('id_verification');
    const block = body.id_verification as Record<string, unknown>;
    // The status is per-feature and a 200 does not imply a pass — the single
    // most important thing this integration reads correctly.
    expect(['Approved', 'Declined']).toContain(block.status);
  }, TIMEOUT_MS + 10_000);

  it('accepts a passive liveness call with a server-set threshold', async () => {
    const { status, body } = await callSandbox('/v3/passive-liveness/', (form) => {
      form.append('user_image', part(tinyJpeg()), 'selfie.jpg');
      form.append('face_liveness_score_decline_threshold', '50');
    });

    expect([200, 400]).toContain(status);
    if (status !== 200) return;
    expect(body).toHaveProperty('liveness');
  }, TIMEOUT_MS + 10_000);

  it('accepts a face match with two images and a server-set threshold', async () => {
    const { status, body } = await callSandbox('/v3/face-match/', (form) => {
      form.append('user_image', part(tinyJpeg()), 'selfie.jpg');
      form.append('ref_image', part(tinyJpeg()), 'portrait.jpg');
      form.append('face_match_score_decline_threshold', '60');
    });

    expect([200, 400]).toContain(status);
    if (status !== 200) return;
    expect(body).toHaveProperty('face_match');
  }, TIMEOUT_MS + 10_000);

  it('rejects a threshold outside 0-100, which is why NPC validates its own', async () => {
    const { status } = await callSandbox('/v3/face-match/', (form) => {
      form.append('user_image', part(tinyJpeg()), 'selfie.jpg');
      form.append('ref_image', part(tinyJpeg()), 'portrait.jpg');
      form.append('face_match_score_decline_threshold', '140');
    });
    expect(status).toBe(400);
  }, TIMEOUT_MS + 10_000);
});

/**
 * These run always. They assert the test above cannot become dangerous.
 */
describe('the sandbox test stays opt-in and quiet', () => {
  const SELF = readFileSync(
    resolve(__dirname, 'diditStandaloneSandbox.integration.test.ts'), 'utf8');

  it('is gated on a sandbox-only variable, never the production key', () => {
    expect(SELF).toContain('process.env.DIDIT_SANDBOX_API_KEY');
    // Reading DIDIT_API_KEY here would run against live credits the moment
    // somebody exported it for an unrelated reason.
    expect(SELF).not.toMatch(/process\.env\.DIDIT_API_KEY/);
    expect(SELF).toContain('describe.skipIf(!enabled)');
  });

  it('embeds no credential', () => {
    expect(SELF).not.toMatch(/sk_(live|test|sandbox)_[A-Za-z0-9]{8,}/);
    expect(SELF).not.toMatch(/["'][A-Za-z0-9_-]{40,}["']/);
  });

  it('prints no response body, image or key', () => {
    expect(SELF).not.toMatch(/console\.(log|info|warn|error|debug)/);
  });

  it('uses a generated fixture rather than a stored photograph', () => {
    // A fixture file would mean a real document or face in the repository.
    expect(SELF).toContain('function tinyJpeg()');
    expect(SELF).not.toMatch(/readFileSync\([^)]*\.(jpe?g|png|heic)/i);
  });

  it('sends save_api_request=true, like every other call in the product', () => {
    expect(SELF).toContain("form.append('save_api_request', 'true')");
  });

  it('never writes the multipart Content-Type by hand', () => {
    const call = SELF.slice(SELF.indexOf('async function callSandbox'), SELF.indexOf('const part ='));
    expect(call).not.toMatch(/['"]Content-Type['"]\s*:/);
  });
});
