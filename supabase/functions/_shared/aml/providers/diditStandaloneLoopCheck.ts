/**
 * One complete pass of the three verification calls, with a real image.
 *
 * ## What this proves that the probe does not
 *
 * `probeStandaloneRoute` sends an EMPTY multipart form. That proves the route
 * resolves, the credential authenticates, the request arrives and the vendor
 * answers — and it proves nothing at all about whether a FILE part survives
 * the hop. On the brokered route that is the open question: the body leaves
 * the clone, is read whole by Mission Control and re-sent under a different
 * credential, and a multipart boundary that did not survive would look, from
 * the clone, exactly like a vendor rejecting the request.
 *
 * The discriminator is clean. An empty form draws "this field is required".
 * A form carrying an image cannot draw that, so any other answer — a
 * validation refusal, a detection failure, a decision — is proof the file
 * arrived and was read.
 *
 * ## Three rules
 *
 * **It runs the PRODUCTION functions.** `verifyIdentityDocument`,
 * `checkPassiveLiveness` and `compareFaces`, exactly as the verification
 * worker calls them, through the same `postMultipart` and the same route
 * resolution. A test that reimplements the call proves the reimplementation
 * works, which is not the question anybody is asking.
 *
 * **It writes NO compliance record.** No case, no `verification_checks` row,
 * no party, no event. The AML record is a regulated artifact about real
 * customers; putting a synthetic identity in it to prove a network path works
 * would corrupt the thing being protected. What is exercised is the vendor
 * loop, and the report is the evidence.
 *
 * **It spends, and says so.** Unlike the probe, this sends real images and a
 * 2xx from any of the three is a billable unit — at the STANDALONE prices,
 * which carry no free allowance. Measured 8 Sep 2026, the `/v3/` endpoints
 * this client calls meter as `id_verification_api` ($0.20),
 * `passive_liveness_api` ($0.05) and `face_match_api` ($0.05), and not one
 * `_api` counter on the account declares a `free_tier_limit`; the 500-a-month
 * free tier belongs to the hosted SESSION features of the same names, which
 * this deployment does not use. A complete verification is $0.30.
 *
 * The expected cost of THIS check is still nothing, for a different and
 * weaker reason: its calls are refused, and a refused call is not counted
 * (`passive_liveness_api` stood at 2 after the empty-form probe had run
 * against three clones repeatedly). But "probably refused" is not the
 * probe's "cannot succeed", so the report says `spends: true` and the caller
 * has to ask for this by name.
 *
 * ## The image
 *
 * A structurally valid baseline JPEG, padded to a realistic capture size with
 * JPEG COM segments — a standard comment marker, so the file stays a decodable
 * JPEG rather than a blob with a JPEG header. Size matters because an empty
 * form exercises none of what a real capture does: the ceiling Mission Control
 * enforces, the chunking, and the time a multi-hundred-kilobyte body takes
 * against the call timeout.
 *
 * It is deliberately not a photograph of anybody. The expected outcome is a
 * refusal — no document detected, no face detected — and that refusal IS the
 * pass, because it can only be reached by a vendor that received and read the
 * file.
 */

import {
  checkPassiveLiveness,
  compareFaces,
  describeStandaloneRoute,
  DiditStandaloneError,
  readStandaloneEnvConfig,
  verifyIdentityDocument,
} from './diditStandaloneClient.ts';

/** A 1×1 baseline JPEG: SOI, JFIF, quantisation and Huffman tables, SOF0, SOS, EOI. */
const SEED_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA' +
  'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
  'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
  'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
  'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA' +
  'AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx' +
  'BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK' +
  'U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3' +
  'uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii' +
  'gD//2Q==';

/** What a phone capture weighs once the portal has re-encoded it to JPEG. */
const SYNTHETIC_CAPTURE_BYTES = 256 * 1024;

/** A COM segment's payload ceiling: the length field counts itself. */
const MAX_COM_PAYLOAD = 65_533 - 2;

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Grow a JPEG to `target` bytes with COM segments inserted after SOI.
 *
 * A comment marker is skipped by every decoder, so the result decodes to the
 * same image — which is what keeps this a valid capture rather than padding
 * bolted onto a header. Appending after EOI would be simpler and is what a
 * strict validator rejects.
 */
export function syntheticCapture(target = SYNTHETIC_CAPTURE_BYTES): Uint8Array {
  const seed = decodeBase64(SEED_JPEG_BASE64);
  if (target <= seed.length) return seed;

  const parts: Uint8Array[] = [seed.subarray(0, 2)];
  let remaining = target - seed.length;
  while (remaining > 4) {
    const payload = Math.min(MAX_COM_PAYLOAD, remaining - 4);
    const header = new Uint8Array(4);
    header[0] = 0xff;
    header[1] = 0xfe;
    header[2] = ((payload + 2) >> 8) & 0xff;
    header[3] = (payload + 2) & 0xff;
    parts.push(header, new Uint8Array(payload).fill(0x20));
    remaining -= payload + 4;
  }
  parts.push(seed.subarray(2));

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface LoopStep {
  readonly operation: 'id-verification' | 'passive-liveness' | 'face-match';
  /** True when the vendor received the request and answered it. */
  readonly closed: boolean;
  readonly http_status: number | null;
  /** `DiditStandaloneError.category` where it refused, else null. */
  readonly category: string | null;
  /** Whether the call may have been billed despite failing. */
  readonly billing_unknown: boolean;
  readonly bytes_sent: number;
  readonly ms: number;
  /** Redacted, truncated evidence of what came back. */
  readonly answer: string;
}

export interface LoopCheckReport {
  readonly route: 'direct' | 'broker' | 'unconfigured';
  readonly steps: readonly LoopStep[];
  readonly closed: number;
  readonly attempted: number;
  readonly spends: true;
  readonly wrote_compliance_record: false;
}

/**
 * A category that means the vendor answered, as against one that means the
 * request never got there.
 *
 * `provider_unavailable` and `timeout` are the two that do NOT close the
 * loop — the first is a transport failure and the second is a request whose
 * fate is unknown. Everything else is the vendor having read the request and
 * said something about it, which is exactly what is being proven.
 */
const DID_NOT_REACH = new Set(['provider_unavailable', 'timeout', 'provider_not_configured']);

async function runStep(
  operation: LoopStep['operation'],
  bytesSent: number,
  call: () => Promise<{ body: Record<string, unknown>; httpStatus: number }>,
): Promise<LoopStep> {
  const started = Date.now();
  try {
    const res = await call();
    return {
      operation,
      closed: true,
      http_status: res.httpStatus,
      category: null,
      billing_unknown: false,
      bytes_sent: bytesSent,
      ms: Date.now() - started,
      answer: JSON.stringify(res.body).slice(0, 400),
    };
  } catch (e) {
    const err = e as DiditStandaloneError;
    const category = typeof err?.category === 'string' ? err.category : 'unknown';
    return {
      operation,
      // The message is already redacted by the client — it is built there
      // precisely so a credential cannot reach a log line or a response.
      closed: !DID_NOT_REACH.has(category),
      http_status: err?.httpStatus ?? null,
      category,
      billing_unknown: Boolean(err?.billingUnknown),
      bytes_sent: bytesSent,
      ms: Date.now() - started,
      answer: String(err?.message ?? e).slice(0, 400),
    };
  }
}

export async function runStandaloneLoopCheck(): Promise<LoopCheckReport> {
  /*
   * The credential is resolved by the client module, never read here.
   * `diditAmlScope.test.ts` keeps an explicit list of the files permitted to
   * name `DIDIT_API_KEY`, and a diagnostic is exactly the kind of file that
   * should not be joining it — a second reader is a second place a key can be
   * logged, reported or serialised by a later edit. The ROUTE comes from the
   * same module for the same reason: resolved here it would restate the API
   * base and its default, and a drift would report a route the calls did not
   * take.
   */
  const apiKey = readStandaloneEnvConfig().apiKey ?? '';
  const route = describeStandaloneRoute('/v3/id-verification/');

  const image = syntheticCapture();
  // Opaque and person-free, exactly as production requires: the correlation
  // handle is never allowed to carry a name, an email or a document number.
  const vendorData = `npc:loopcheck:${crypto.randomUUID()}:1`;
  const metadata = { purpose: 'transport_loop_check', synthetic: true };

  const steps: LoopStep[] = [];

  steps.push(
    await runStep('id-verification', image.byteLength * 2, () =>
      verifyIdentityDocument({
        apiKey,
        frontImage: image,
        backImage: image,
        vendorData,
        metadata,
      })),
  );

  steps.push(
    await runStep('passive-liveness', image.byteLength, () =>
      checkPassiveLiveness({
        apiKey,
        userImage: image,
        declineThreshold: 50,
        vendorData,
        metadata,
      })),
  );

  /*
   * In production the reference face is the portrait Didit cropped from the
   * document on the ID call. There is no portrait here — the synthetic image
   * carries no face — so the same capture stands in for both sides. That is
   * fine for what this measures: whether two file parts reach the vendor in
   * one request and are read.
   */
  steps.push(
    await runStep('face-match', image.byteLength * 2, () =>
      compareFaces({
        apiKey,
        userImage: image,
        refImage: image,
        declineThreshold: 50,
        vendorData,
        metadata,
      })),
  );

  return {
    route: route.via,
    steps,
    closed: steps.filter((s) => s.closed).length,
    attempted: steps.length,
    spends: true,
    wrote_compliance_record: false,
  };
}
