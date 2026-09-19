/**
 * Server-side Didit **Standalone API** client.
 *
 * Three authenticated, server-to-server, `multipart/form-data` calls. Nothing
 * in this module can be reached from a browser: it is imported only by the
 * verification orchestrator, which runs in the Edge Function runtime, and it
 * holds `DIDIT_API_KEY` — which never leaves it in a response, a log line, a
 * database row, or a signed URL.
 *
 * Contract read from the current published documentation on 2026-08-11 (not
 * from memory, and not from this repository's hosted-session client, which is a
 * different API):
 *
 *   POST https://verification.didit.me/v3/id-verification/
 *   POST https://verification.didit.me/v3/passive-liveness/
 *   POST https://verification.didit.me/v3/face-match/
 *   auth: `x-api-key: <key>`
 *   body: multipart/form-data
 *
 * ## Three rules this module exists to hold
 *
 *  1. **The multipart boundary is generated, never written.** Setting
 *     `Content-Type: multipart/form-data` by hand omits the boundary parameter,
 *     and the server then cannot split the body — every request fails with a
 *     400 that looks like a malformed image. `FormData` + `fetch` produce the
 *     header together; this module never sets it.
 *  2. **`save_api_request=true` on every call.** Each request is persisted by
 *     Didit as an API-type session and appears in the Business Console under
 *     **Manual Checks**, which is what makes an NPC verification auditable on
 *     the provider's side. It was `false` until 2026-08-14, when that was
 *     reversed: nothing was stored, so a completed check existed nowhere but
 *     in NPC's own database.
 *
 *     Two things follow from the flag, and both are handled rather than
 *     assumed. Didit now RETAINS the customer's document images and selfie —
 *     NPC's private buckets are no longer the only copy — and the image fields
 *     come back as **short-lived media URLs instead of inline base64**, which
 *     is why `resolveReferenceImage` exists. The authenticated response is
 *     still the authoritative result: there is no decision to re-fetch, and
 *     although a persisted session can emit `status.updated`, NPC
 *     acknowledges and ignores those rather than opening a second result path.
 *  3. **A failure is typed, never prose.** Every non-2xx becomes a
 *     `DiditStandaloneError` carrying a `StandaloneErrorCategory`, so an outage,
 *     an empty credit balance and an unreadable photograph can never be
 *     confused with a customer who failed verification.
 *
 * ## The one thing that is deliberately NOT here
 *
 * A retry. These calls are billed per 200 response and Didit publishes no
 * idempotency key — `vendor_data` is documented as an opaque correlation
 * string and explicitly not as one. So a request that was sent but whose
 * response never arrived has an unknown billing state, and repeating it is a
 * decision about somebody's money that this layer is not entitled to make. The
 * orchestrator records `timeout` and stops; a human or a fresh customer
 * submission is the retry.
 */

import { meteredFetch } from '../../meteredFetch.ts';
import { resolveStandaloneRoute } from './diditStandaloneRoute.pure.ts';
import {
  classifyStandaloneHttpError,
  isAllowedMediaUrl,
  DEFAULT_DIDIT_MEDIA_HOSTS,
  type StandaloneErrorCategory,
} from './diditStandalone.pure.ts';

const DIDIT_API_BASE = (Deno.env.get('DIDIT_API_BASE_URL') || 'https://verification.didit.me')
  .replace(/\/+$/, '');

/**
 * Per-call ceiling.
 *
 * Longer than the hosted client's 15s: these calls carry an image and do real
 * work, and the orchestrator runs them in the background rather than while a
 * customer waits on an open request. Short enough that three of them plus the
 * downloads stay inside an edge function's wall clock.
 */
const STANDALONE_TIMEOUT_MS = Number(Deno.env.get('DIDIT_STANDALONE_TIMEOUT_MS') ?? 30_000);

export class DiditStandaloneError extends Error {
  readonly category: StandaloneErrorCategory;
  readonly httpStatus: number | null;
  /**
   * Whether the request may have been PROCESSED AND BILLED despite this error.
   *
   * True only for a timeout or a transport failure after the request left: we
   * know what we sent and not what happened to it. Everything else is either a
   * refusal before processing or a response we actually read.
   */
  readonly billingUnknown: boolean;

  constructor(
    category: StandaloneErrorCategory,
    message: string,
    httpStatus: number | null = null,
    billingUnknown = false,
  ) {
    super(message);
    this.category = category;
    this.httpStatus = httpStatus;
    this.billingUnknown = billingUnknown;
    this.name = 'DiditStandaloneError';
  }
}

/** Server-side configuration. Read from the function environment only. */
export function readStandaloneEnvConfig(): {
  apiKey: string | null;
  livenessThreshold: string | null;
  faceMatchThreshold: string | null;
} {
  return {
    apiKey: Deno.env.get('DIDIT_API_KEY') || null,
    livenessThreshold: Deno.env.get('DIDIT_LIVENESS_THRESHOLD') || null,
    faceMatchThreshold: Deno.env.get('DIDIT_FACE_MATCH_THRESHOLD') || null,
  };
}

/**
 * Remove anything that must not reach a log line, a response or the case
 * record.
 *
 * The key is the obvious one. Absolute URLs are the subtle one: a media host
 * returned in an error body can embed a signed token, and `failure_reason` is
 * persisted onto the check and read by staff.
 */
function redact(text: string, apiKey: string): string {
  let out = String(text ?? '');
  if (apiKey) out = out.split(apiKey).join('[redacted]');
  return out.replace(/https?:\/\/[^\s"')]+/gi, '[didit]').slice(0, 300);
}

export interface StandaloneCallResult {
  body: Record<string, unknown>;
  httpStatus: number;
}

async function postMultipart(
  apiKey: string, path: string, form: FormData,
): Promise<StandaloneCallResult> {
  /*
   * Direct to the vendor where this deployment holds the vendor key, and
   * through Mission Control where it does not — see
   * `diditStandaloneRoute.pure.ts` for why a tenant deliberately holds no
   * Didit credential.
   */
  const route = resolveStandaloneRoute({
    path,
    apiKey,
    apiBase: DIDIT_API_BASE,
    missionControlUrl: Deno.env.get('MISSION_CONTROL_URL'),
    cloneApiKey: Deno.env.get('MISSION_CONTROL_CLONE_API_KEY'),
  });
  if (route.via === 'unconfigured') {
    throw new DiditStandaloneError('provider_not_configured', route.why, null, false);
  }
  // Whatever secret this route carries is the one to keep out of error text.
  const secret = route.secret;

  let res: Response;
  try {
    const init: RequestInit = {
      method: 'POST',
      headers: route.headers,
      // Content-Type is deliberately ABSENT from `route.headers`. `fetch`
      // derives `multipart/form-data; boundary=…` from the FormData body;
      // writing it would drop the boundary and make every request
      // unparseable — and the broker forwards that same header onward, so the
      // rule holds across the hop.
      body: form,
      signal: AbortSignal.timeout(STANDALONE_TIMEOUT_MS),
    };
    /*
     * Metered HERE only on the direct route. A brokered call is metered by
     * Mission Control, which is the side that actually spends the vendor key;
     * doing both bills the tenant twice, which this repository's own rule
     * names as worse than not billing.
     */
    res = route.meter
      ? await meteredFetch(route.url, init, {
        secretName: 'DIDIT_API_KEY',
        feature: `aml/idv-standalone${path.split('?')[0]}`,
      })
      : await fetch(route.url, init);
  } catch (e) {
    const err = e as Error;
    const aborted = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    // Both branches are billing-unknown: the request had already left when it
    // failed, and Didit bills on a 200 we never got to read.
    throw new DiditStandaloneError(
      aborted ? 'timeout' : 'provider_unavailable',
      aborted
        ? `didit ${path} timed out after ${STANDALONE_TIMEOUT_MS}ms`
        : `didit ${path} unreachable: ${redact(String(err?.message ?? e), secret)}`,
      null,
      true,
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const category = classifyStandaloneHttpError(res.status, detail);
    throw new DiditStandaloneError(
      category,
      `didit ${path} returned ${res.status}${detail ? `: ${redact(detail, secret)}` : ''}`,
      res.status,
      // A non-2xx is a decision Didit made and told us about; the documented
      // billing unit is a 200 response.
      false,
    );
  }

  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    // A 200 we cannot read HAS been billed. Say so, so nothing retries it.
    throw new DiditStandaloneError(
      'provider_unavailable', `didit ${path} returned an unparseable body`, res.status, true,
    );
  }
  return { body: body as Record<string, unknown>, httpStatus: res.status };
}

/** Bytes → a multipart part with a filename the API will accept. */
function imagePart(bytes: Uint8Array, filename: string): Blob {
  // `type` is what the receiving end reads; the extension in `filename` is what
  // its extension allow-list reads. Both say JPEG because every capture that
  // reaches here has been re-encoded to JPEG by `captureImage.ts`.
  return new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' });
}

/**
 * Common fields.
 *
 * `save_api_request=true` is set here rather than per call site so no future
 * endpoint can be added without it — the Manual Checks record has to be
 * complete or it is not an audit trail.
 *
 * `vendor_data` is the person-scoped NPC key, which is what groups an
 * applicant's persisted requests together in the console. `metadata` carries
 * internal correlation only and is never given a name, an email or a document
 * number — both fields are stored by Didit now, so putting customer PII in
 * either would export it into a third party's records for no purpose.
 */
function baseForm(vendorData: string, metadata: Record<string, unknown>): FormData {
  const form = new FormData();
  form.append('save_api_request', 'true');
  form.append('vendor_data', vendorData);
  form.append('metadata', JSON.stringify(metadata));
  return form;
}

export interface VerifyIdentityDocumentArgs {
  apiKey: string;
  frontImage: Uint8Array;
  backImage?: Uint8Array | null;
  /** Opaque `npc:<case>:<party>:<sequence>` handle. Never PII. */
  vendorData: string;
  metadata: Record<string, unknown>;
}

export async function verifyIdentityDocument(
  args: VerifyIdentityDocumentArgs,
): Promise<StandaloneCallResult> {
  const form = baseForm(args.vendorData, args.metadata);
  form.append('front_image', imagePart(args.frontImage, 'front.jpg'), 'front.jpg');
  if (args.backImage && args.backImage.byteLength > 0) {
    form.append('back_image', imagePart(args.backImage, 'back.jpg'), 'back.jpg');
  }
  // Screen captures, printed copies and portrait manipulation. This is the
  // document-fraud signal and NPC pays for it deliberately.
  form.append('perform_document_liveness', 'true');
  /**
   * MRZ and data-consistency handling is NPC's, not the provider default.
   *
   * Both default to DECLINE. An Australian driver licence carries no ICAO
   * machine-readable zone at all, so a DECLINE default risks rejecting a valid
   * licence for lacking a feature it was never issued with — and a decline is
   * a consumed attempt and a recorded identity failure. Set to NO_ACTION here
   * and mapped to a REFERRAL in `diditStandalone.pure.ts`, which cannot
   * produce a false pass and cannot spend a customer's allowance on a default
   * nobody chose.
   */
  form.append('invalid_mrz_action', 'NO_ACTION');
  form.append('inconsistent_data_action', 'NO_ACTION');
  form.append('expiration_date_not_detected_action', 'NO_ACTION');
  return await postMultipart(args.apiKey, '/v3/id-verification/', form);
}

export interface PassiveLivenessArgs {
  apiKey: string;
  userImage: Uint8Array;
  /** Server configuration. There is no path by which a browser reaches this. */
  declineThreshold: number;
  vendorData: string;
  metadata: Record<string, unknown>;
}

export async function checkPassiveLiveness(
  args: PassiveLivenessArgs,
): Promise<StandaloneCallResult> {
  const form = baseForm(args.vendorData, args.metadata);
  form.append('user_image', imagePart(args.userImage, 'selfie.jpg'), 'selfie.jpg');
  form.append('face_liveness_score_decline_threshold', String(args.declineThreshold));
  return await postMultipart(args.apiKey, '/v3/passive-liveness/', form);
}

export interface FaceMatchArgs {
  apiKey: string;
  /** The customer's selfie, captured by NPC. */
  userImage: Uint8Array;
  /**
   * The reference face.
   *
   * The portrait Didit cropped from the identity document on the ID call —
   * held in memory for the length of this sequence and never persisted, never
   * logged and never sent to a browser. Using the whole document photograph
   * instead would hand the matcher a page rather than a face.
   */
  refImage: Uint8Array;
  declineThreshold: number;
  vendorData: string;
  metadata: Record<string, unknown>;
}

export async function compareFaces(args: FaceMatchArgs): Promise<StandaloneCallResult> {
  const form = baseForm(args.vendorData, args.metadata);
  form.append('user_image', imagePart(args.userImage, 'selfie.jpg'), 'selfie.jpg');
  form.append('ref_image', imagePart(args.refImage, 'portrait.jpg'), 'portrait.jpg');
  form.append('face_match_score_decline_threshold', String(args.declineThreshold));
  return await postMultipart(args.apiKey, '/v3/face-match/', form);
}

/**
 * Decode an inline portrait into bytes.
 *
 * Returns null rather than throwing on anything unexpected: a portrait we
 * cannot decode means Face Match has no reference image, which is a referral,
 * and it must not be able to take down the whole sequence with an exception.
 * The `data:` prefix is tolerated because the field is documented as "url or
 * base64"; a URL is the `save_api_request=true` shape and is handled by
 * `fetchRemoteImage`, not here.
 */
export function decodeInlineImage(value: string | null): Uint8Array | null {
  if (typeof value !== 'string' || !value) return null;
  if (/^https?:\/\//i.test(value)) return null;
  const comma = value.indexOf(',');
  const payload = value.startsWith('data:') && comma > -1 ? value.slice(comma + 1) : value;
  try {
    const binary = atob(payload.replace(/\s+/g, ''));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out.byteLength > 0 ? out : null;
  } catch {
    return null;
  }
}

/** A reference image may not be larger than this. Portraits are ~10–100 KB. */
const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * The hosts a persisted image may be fetched from.
 *
 * Defaults to the measured provider media hosts. `DIDIT_MEDIA_HOSTS` overrides
 * the list (comma-separated) for a deployment whose media host differs or
 * changes — the value is a list of hostnames, never a pattern, and every entry
 * still passes the IP-literal and internal-name refusals in
 * `isAllowedMediaUrl`.
 */
function allowedMediaHosts(): readonly string[] {
  const configured = (Deno.env.get('DIDIT_MEDIA_HOSTS') ?? '')
    .split(',').map((h) => h.trim().toLowerCase()).filter((h) => h.length > 0);
  return configured.length > 0 ? configured : DEFAULT_DIDIT_MEDIA_HOSTS;
}

/**
 * Fetch the portrait Didit stored, when it answered with a URL instead of bytes.
 *
 * ## Why this exists at all
 *
 * `save_api_request=true` changes the response shape: `portrait_image` becomes
 * a short-lived media URL rather than inline base64. The ID portrait is Face
 * Match's reference image, so without this the third call would simply never
 * run and EVERY attempt would settle as a referral — a silent, total
 * regression, and the reason the flag could not be flipped on its own.
 *
 * ## Why following it is bounded
 *
 * This code previously refused to follow a URL out of a provider response, and
 * that instinct was right: it is server-side egress driven by a third party's
 * payload, which is SSRF by construction unless it is fenced. It is admitted
 * here under conditions that keep it from being a general fetch primitive:
 *
 *   - **The host must be on the allow-list** (`isAllowedMediaUrl`) — an exact
 *     match against the measured provider media hosts, overridable by
 *     `DIDIT_MEDIA_HOSTS`. This is the primary control; everything else is
 *     defence in depth. IP literals, non-443 ports, embedded credentials,
 *     `localhost`, `.local`/`.internal` names and every non-https scheme are
 *     refused before the list is even consulted.
 *   - **The credential is never sent.** The URL is pre-signed and belongs to a
 *     media host, not to the API — attaching `x-api-key` would hand NPC's key
 *     to whatever that payload named.
 *   - **It must answer with an image**, under a size cap and a timeout.
 *   - **Redirects are not followed.** A 3xx is refused rather than chased, so
 *     an allow-listed host cannot bounce the request somewhere else.
 *   - **It cannot throw, and it never returns a partial image.** Anything
 *     unexpected is null, which is the same referral the missing-portrait path
 *     has always produced. Unknown is never passed.
 *
 * The URL is not returned, logged or persisted anywhere: it is a credential
 * for the customer's own photograph, and `stripImagePayloads` plus the
 * by-name sanitiser keep the field out of `outcome_detail` regardless.
 */
export async function fetchRemoteImage(value: string | null): Promise<Uint8Array | null> {
  if (!isAllowedMediaUrl(value, allowedMediaHosts())) return null;
  try {
    const res = await fetch(value, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(STANDALONE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.startsWith('image/')) return null;
    const declared = Number(res.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > MAX_REFERENCE_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) return null;
    return bytes;
  } catch {
    // Timeout, DNS, TLS, a redirect, an unreadable body — all the same answer.
    return null;
  }
}

/**
 * The Face Match reference, whichever shape the provider used.
 *
 * One entry point so the orchestrator does not have to know that the flag
 * decides the shape — and so a future change of flag cannot quietly strand the
 * third call again.
 */
export async function resolveReferenceImage(value: string | null): Promise<Uint8Array | null> {
  return decodeInlineImage(value) ?? await fetchRemoteImage(value);
}

/**
 * Whether identity verification can actually reach the vendor from HERE.
 *
 * ## Why this exists
 *
 * Every readiness reading in this product answers a question about
 * CONFIGURATION — is the key present, is the provider active, are the
 * thresholds parseable — and every one of them was green on three tenants
 * that had never once completed a verification. Configuration is not
 * reachability, and the gap between them is exactly where a brokered call
 * lives: the clone's Mission Control key, its scopes, Mission Control's own
 * Didit credential and the vendor's availability are four things no local
 * flag can see.
 *
 * So this makes ONE real call and reports what came back.
 *
 * ## The four rules
 *
 * **It spends nothing.** The body is deliberately incomplete, so the vendor
 * rejects it at validation — a 4xx that proves the request authenticated,
 * arrived and was answered, without creating a verification anybody is
 * billed for. Being rejected IS the pass.
 *
 * **It is never metered and never recorded.** A probe is not a customer's
 * verification: it writes no check, touches no case, and takes the plain
 * `fetch` on both routes rather than `meteredFetch`, so a diagnostic can
 * never appear on a tenant's invoice.
 *
 * **Who refused is read from a header, never guessed from a body.** Mission
 * Control marks its own refusals (`x-mission-control-refusal`); a relayed
 * vendor answer carries no such header. Both ends can answer 401 with
 * similar JSON, and they send an operator to opposite remedies — "this
 * clone's Mission Control key is wrong or unscoped" versus "the fleet's Didit
 * credential is wrong".
 *
 * **It reports the HOST, never the URL and never a credential.** The path
 * names the operation and the query could carry anything; the host is what an
 * operator needs to know.
 */
export type StandaloneProbeVerdict =
  /** The far end authenticated us and answered. This is the healthy reading. */
  | 'reachable'
  /** The vendor rejected the credential the call was made with. */
  | 'credential_rejected'
  /** Mission Control declined to broker. Its reason is in `detail`. */
  | 'broker_refused'
  /** Nothing answered: DNS, TLS, a timeout, a dropped connection. */
  | 'unreachable'
  /** Neither a vendor key nor a route to the broker. */
  | 'unconfigured';

export interface StandaloneProbe {
  readonly route: 'direct' | 'broker' | 'unconfigured';
  /** Host only. */
  readonly endpoint: string | null;
  readonly status: number | null;
  readonly answered_by: 'vendor' | 'mission_control' | 'none';
  readonly verdict: StandaloneProbeVerdict;
  readonly detail: string;
}

/** Mission Control sets this on its OWN refusals and on nothing it relays. */
const MC_REFUSAL_HEADER = 'x-mission-control-refusal';

/**
 * Which way a standalone call would go from this deployment, without making
 * one.
 *
 * It exists so nothing outside this module has to re-derive it. A caller that
 * resolves the route itself has to restate the API base, its default and its
 * trailing-slash rule, and the moment any of those drifts it reports a route
 * the calls did not take — a diagnostic that lies confidently about the thing
 * it exists to measure. It is also the reason the credential stays here.
 */
export function describeStandaloneRoute(
  path = '/v3/id-verification/',
): { via: 'direct' | 'broker' | 'unconfigured'; host: string | null; why: string } {
  const route = resolveStandaloneRoute({
    path,
    apiKey: Deno.env.get('DIDIT_API_KEY') ?? null,
    apiBase: DIDIT_API_BASE,
    missionControlUrl: Deno.env.get('MISSION_CONTROL_URL'),
    cloneApiKey: Deno.env.get('MISSION_CONTROL_CLONE_API_KEY'),
  });
  if (route.via === 'unconfigured') {
    return { via: 'unconfigured', host: null, why: route.why };
  }
  let host: string | null = null;
  try {
    host = new URL(route.url).host;
  } catch {
    host = null;
  }
  return { via: route.via, host, why: '' };
}

export async function probeStandaloneRoute(): Promise<StandaloneProbe> {
  const path = '/v3/passive-liveness/';
  /*
   * The credential is read HERE and nowhere else. Handing it in from the
   * endpoint would put a raw `Deno.env.get('DIDIT_API_KEY')` in
   * `aml-verification`, where every other read is reduced to a boolean and a
   * contract test enforces exactly that — the rule that keeps a secret VALUE
   * out of the one function a browser can reach.
   */
  const route = resolveStandaloneRoute({
    path,
    apiKey: Deno.env.get('DIDIT_API_KEY') ?? null,
    apiBase: DIDIT_API_BASE,
    missionControlUrl: Deno.env.get('MISSION_CONTROL_URL'),
    cloneApiKey: Deno.env.get('MISSION_CONTROL_CLONE_API_KEY'),
  });
  if (route.via === 'unconfigured') {
    return {
      route: 'unconfigured',
      endpoint: null,
      status: null,
      answered_by: 'none',
      verdict: 'unconfigured',
      detail: route.why,
    };
  }

  let host: string | null = null;
  try {
    host = new URL(route.url).host;
  } catch {
    host = null;
  }

  let res: Response;
  try {
    res = await fetch(route.url, {
      method: 'POST',
      headers: route.headers,
      // Empty on purpose: enough to be a well-formed multipart request and
      // not enough to be a verification. `fetch` writes the boundary.
      body: new FormData(),
      signal: AbortSignal.timeout(STANDALONE_TIMEOUT_MS),
    });
  } catch (e) {
    return {
      route: route.via,
      endpoint: host,
      status: null,
      answered_by: 'none',
      verdict: 'unreachable',
      detail: redact(e instanceof Error ? e.message : String(e), route.secret),
    };
  }

  const refusal = res.headers.get(MC_REFUSAL_HEADER);
  if (refusal) {
    return {
      route: route.via,
      endpoint: host,
      status: res.status,
      answered_by: 'mission_control',
      verdict: 'broker_refused',
      detail: `Mission Control refused to broker the call: ${refusal}`,
    };
  }

  // No refusal header, so this answer came from the vendor — through the
  // broker or directly, which is precisely the thing being proven.
  if (res.status === 401 || res.status === 403) {
    return {
      route: route.via,
      endpoint: host,
      status: res.status,
      answered_by: 'vendor',
      verdict: 'credential_rejected',
      detail:
        route.via === 'broker'
          ? "The vendor rejected Mission Control's Didit credential."
          : 'The vendor rejected this deployment\'s DIDIT_API_KEY.',
    };
  }

  return {
    route: route.via,
    endpoint: host,
    status: res.status,
    answered_by: 'vendor',
    verdict: 'reachable',
    detail:
      `The vendor authenticated the call and answered ${res.status} to a deliberately ` +
      'incomplete request. Verification can run on this route.',
  };
}
