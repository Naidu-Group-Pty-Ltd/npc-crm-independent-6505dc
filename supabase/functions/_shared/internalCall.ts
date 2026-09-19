/**
 * internalCall — edge-function-to-edge-function invocation without spreading the
 * service-role key (AUTH-002 / Phase 2 / WP-12).
 *
 * WP-12: every internal call is now HMAC-signed (method, path, timestamp,
 * nonce, caller, key id, body hash) via `signInternalRequest`. Receivers verify
 * the signature with `verifyInternal` and enforce a per-target caller
 * allowlist. This helper never transmits a reusable internal secret: receivers
 * authenticate the signed envelope only.
 *
 * The gateway still needs an apikey; the public anon key is used for routing.
 * Under no circumstance is the service-role key placed on an inter-function
 * request.
 */

import { signInternalRequest } from './auth_v2.ts';

export interface InternalCallResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

function functionsBaseUrl(): string {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim().replace(/\/$/, '');
  return `${url}/functions/v1`;
}

/**
 * POST a JSON body to another edge function as an authenticated internal call.
 * @param functionName target function slug (e.g. "ai-dashboard-agent")
 * @param body         JSON-serializable payload
 * @param callerName   this function's name (for audit/traceability headers)
 */
export async function callInternalFunction<T = any>(
  functionName: string,
  body: Record<string, unknown>,
  callerName: string,
  opts?: { timeoutMs?: number },
): Promise<InternalCallResult<T>> {
  const anonKey = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
  const internalSecret = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();
  const internalSecretV2 = (Deno.env.get('INTERNAL_EDGE_SECRET_V2') || '').trim();

  // Fail closed: neither the current nor the previous internal key is configured.
  if (internalSecret.length < 16 && internalSecretV2.length < 16) {
    console.error(`[internalCall] INTERNAL_EDGE_SECRET not configured — refusing internal call to ${functionName}`);
    return { ok: false, status: 0, data: null, error: 'internal auth not configured' };
  }

  const rawBody = JSON.stringify(body);
  const path = `/functions/v1/${functionName}`;

  let signedHeaders: Record<string, string> = {};
  try {
    signedHeaders = await signInternalRequest('POST', path, rawBody, callerName);
  } catch (e) {
    console.error(`[internalCall] failed to sign request to ${functionName}:`, e);
    return { ok: false, status: 0, data: null, error: 'internal signing failed' };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': anonKey,
    'Authorization': `Bearer ${anonKey}`,
    // signInternalRequest provides x-internal-caller and binds it, the path,
    // timestamp, nonce, and body hash into the HMAC signature.
    ...signedHeaders,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 60000);
  try {
    const resp = await fetch(`${functionsBaseUrl()}/${functionName}`, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: controller.signal,
    });
    let data: any = null;
    try { data = await resp.json(); } catch { /* non-JSON */ }
    return {
      ok: resp.ok,
      status: resp.status,
      data,
      error: resp.ok ? null : (data?.error?.message || data?.error || `HTTP ${resp.status}`),
    };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : 'internal call failed' };
  } finally {
    clearTimeout(timeout);
  }
}
