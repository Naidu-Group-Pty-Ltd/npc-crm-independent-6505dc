/**
 * Server-side Didit V3 client.
 *
 * The only place in the repository that holds `DIDIT_API_KEY`, and it lives in
 * the Edge Function runtime — never in the browser bundle, never in a database
 * row, never in a response body.
 *
 * Contract read off the live account and the current V3 documentation on
 * 2026-08-08, not from memory:
 *
 *   POST https://verification.didit.me/v3/session/                 → create
 *   GET  https://verification.didit.me/v3/session/{id}/decision/   → decision
 *   auth: `x-api-key: <key>`
 *
 * Two rules this module exists to hold:
 *
 *  1. **Errors never quote the credential or the hosted URL.** A transport
 *     error message embeds the request URL by default, and `failure_reason` is
 *     persisted onto the case record and read by staff. Everything leaving here
 *     goes through `redact()`.
 *  2. **A technical failure is typed, not guessed at by the caller.**
 *     `DiditApiError` carries a category the caller maps to
 *     `provider_error_category`, so an outage can never be mistaken for a
 *     customer who failed verification.
 */

import { meteredFetch } from '../../meteredFetch.ts';

const DIDIT_API_BASE = (Deno.env.get('DIDIT_API_BASE_URL') || 'https://verification.didit.me')
  .replace(/\/+$/, '');

/**
 * Per-call ceiling. Session creation happens while a customer waits on the
 * portal, so it is short; without it a hung provider holds the edge function
 * until the platform kills it and the customer sees nothing at all.
 */
const DIDIT_TIMEOUT_MS = Number(Deno.env.get('DIDIT_API_TIMEOUT_MS') ?? 15_000);

export type DiditErrorCategory =
  | 'provider_not_configured'
  | 'provider_unavailable'
  | 'timeout'
  | 'provider_rejected_request';

export class DiditApiError extends Error {
  readonly category: DiditErrorCategory;
  readonly httpStatus: number | null;
  constructor(category: DiditErrorCategory, message: string, httpStatus: number | null = null) {
    super(message);
    this.category = category;
    this.httpStatus = httpStatus;
    this.name = 'DiditApiError';
  }
}

export interface DiditConfig {
  apiKey: string;
  workflowId: string;
  webhookSecret: string;
}

/** Server-side configuration, read from the function environment only. */
export function readDiditEnvConfig(): {
  apiKey: string | null; workflowId: string | null; webhookSecret: string | null;
} {
  return {
    apiKey: Deno.env.get('DIDIT_API_KEY') || null,
    workflowId: Deno.env.get('DIDIT_WORKFLOW_ID') || null,
    webhookSecret: Deno.env.get('DIDIT_WEBHOOK_SECRET') || null,
  };
}

/**
 * Whether session creation can proceed.
 *
 * The webhook secret is deliberately part of "configured": without it no
 * outcome can ever be received, so creating sessions would charge for
 * verifications whose results NPC could never accept. The workflow id may come
 * from tenant provider config instead of the environment, so it is passed in.
 */
export function diditConfigured(workflowIdFromConfig?: string | null): boolean {
  const env = readDiditEnvConfig();
  return Boolean(env.apiKey) && Boolean(env.webhookSecret)
    && Boolean(workflowIdFromConfig || env.workflowId);
}

/**
 * Strip anything that must not reach a log line, a response or the case record.
 *
 * The API key is the obvious one. The hosted session URL is the subtle one: it
 * embeds the customer's session token, so an error message quoting the request
 * or response would persist a live credential.
 */
function redact(text: string, apiKey: string): string {
  let out = text;
  if (apiKey) out = out.split(apiKey).join('[redacted]');
  return out
    .replace(/https?:\/\/[^\s"')]+/gi, '[didit]')
    .slice(0, 300);
}

async function diditFetch(
  apiKey: string, path: string, init: RequestInit,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    // Metered: a Didit call spends the fleet's forwarded key, and an unmetered
    // vendor call is billed to nobody. The credential is named explicitly
    // because DIDIT_API_BASE_URL can point the client off the default host.
    res = await meteredFetch(`${DIDIT_API_BASE}${path}`, {
      ...init,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(DIDIT_TIMEOUT_MS),
    }, { secretName: 'DIDIT_API_KEY', feature: `aml/idv-hosted${path.split('?')[0]}` });
  } catch (e) {
    const aborted = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
    throw new DiditApiError(
      aborted ? 'timeout' : 'provider_unavailable',
      aborted
        ? `didit ${path} timed out after ${DIDIT_TIMEOUT_MS}ms`
        : `didit ${path} unreachable: ${redact(String((e as Error)?.message ?? e), apiKey)}`,
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // 4xx means we sent something Didit would not accept — our bug or our
    // configuration, never the customer's identity. 5xx is their outage.
    // Both are technical and neither may consume an attempt.
    const category: DiditErrorCategory = res.status === 401 || res.status === 403
      ? 'provider_not_configured'
      : res.status >= 400 && res.status < 500
        ? 'provider_rejected_request'
        : 'provider_unavailable';
    throw new DiditApiError(
      category,
      `didit ${path} returned ${res.status}${detail ? `: ${redact(detail, apiKey)}` : ''}`,
      res.status,
    );
  }

  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new DiditApiError('provider_unavailable', `didit ${path} returned an unparseable body`);
  }
  return body as Record<string, unknown>;
}

export interface CreatedDiditSession {
  sessionId: string;
  /**
   * The hosted verification URL. Handed to the customer's own browser and
   * NEVER persisted: it embeds their session token.
   */
  url: string;
  status: string;
  workflowId: string | null;
  workflowVersion: number | null;
  expiresAt: string | null;
}

export interface CreateSessionArgs {
  apiKey: string;
  workflowId: string;
  /** Opaque `npc:<case>:<party>` correlation handle. Never PII. */
  vendorData: string;
  /** Internal identifiers only — echoed back to us on every webhook. */
  metadata: Record<string, unknown>;
  /** Where the hosted flow returns the customer. Carries no secret. */
  callback?: string | null;
  /**
   * Which device the return redirect applies to.
   *
   * Documented values are `initiator` (the default), `completer` and `both`.
   * NPC sends `both`: the initiator is the window NPC opened, and the completer
   * is a phone the customer handed off to. With the default, that phone
   * finishes on the provider's own end screen — the one place in the journey
   * NPC cannot dress, shown on the device the customer is actually holding.
   */
  callbackMethod?: 'initiator' | 'completer' | 'both' | null;
  /**
   * Session-level restrictions. Server-built only — see
   * `diditExpectedDetails`. Carries a country and a document type and never
   * customer PII.
   */
  expectedDetails?: Record<string, unknown> | null;
  /** Sandbox-only deterministic outcome. Ignored by the live environment. */
  sandboxScenario?: string | null;
}

export async function createDiditSession(args: CreateSessionArgs): Promise<CreatedDiditSession> {
  const body: Record<string, unknown> = {
    workflow_id: args.workflowId,
    vendor_data: args.vendorData,
    metadata: args.metadata,
  };
  if (args.callback) {
    body.callback = args.callback;
    // Only meaningful alongside a callback, and the API rejects unknown
    // values — so it is sent with one and omitted without one.
    if (args.callbackMethod) body.callback_method = args.callbackMethod;
  }
  if (args.expectedDetails && Object.keys(args.expectedDetails).length > 0) {
    body.expected_details = args.expectedDetails;
  }
  if (args.sandboxScenario) body.sandbox_scenario = args.sandboxScenario;

  const json = await diditFetch(args.apiKey, '/v3/session/', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const sessionId = String(json['session_id'] ?? '');
  const url = String(json['url'] ?? '');
  if (!sessionId || !url) {
    throw new DiditApiError('provider_unavailable',
      'didit session response carried no session_id/url');
  }
  return {
    sessionId,
    url,
    status: String(json['status'] ?? 'Not Started'),
    workflowId: typeof json['workflow_id'] === 'string' ? json['workflow_id'] : null,
    workflowVersion: typeof json['workflow_version'] === 'number' ? json['workflow_version'] : null,
    expiresAt: typeof json['expires_at'] === 'string' ? json['expires_at'] : null,
  };
}

/**
 * The authoritative decision, read back from Didit over an authenticated
 * server-to-server call.
 *
 * The webhook body carries a `decision` object, and it is deliberately not
 * trusted: a webhook is an unauthenticated-by-default transport whose only
 * protection is a shared secret, and the identity outcome is too consequential
 * to take from it. The signature proves the event is real; THIS proves what it
 * says.
 */
export async function fetchDiditDecision(
  apiKey: string, sessionId: string,
): Promise<Record<string, unknown>> {
  return await diditFetch(apiKey, `/v3/session/${encodeURIComponent(sessionId)}/decision/`, {
    method: 'GET',
  });
}

/* ────────────────────────── webhook verification ────────────────────────── */
//
// Re-exported from `diditWebhook.pure.ts`. The verification itself lives there
// because it is the authentication boundary for a JWT-less endpoint and has to
// be testable without a Deno runtime — this module reads `Deno.env` at import
// time, which a unit test cannot.

export {
  DIDIT_WEBHOOK_MAX_SKEW_SECONDS,
  timingSafeEqualHex,
  computeDiditSignature,
  verifyDiditWebhook,
  type WebhookRejection,
  type WebhookVerification,
} from './diditWebhook.pure.ts';
