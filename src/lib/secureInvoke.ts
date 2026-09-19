/**
 * Secure Edge Function invocation helper
 * Supports HttpOnly cookies for session authentication
 * Includes fallback session token in body for cross-origin cookie issues
 */
import { emitTokensUsed, emitOutOfTokens, isReportGenerator } from "@/lib/tokenEvents";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


// ── Global auth-failure circuit breaker ──
let _globalAuthExhausted = false;
const GLOBAL_AUTH_FAIL_LIMIT = 5;
let _globalAuthFailCount = 0;

/** Fired once when the breaker trips, so auth state can clear and redirect. */
export const AUTH_EXHAUSTED_EVENT = 'npc-auth-exhausted';

export function markAuthFailure(): void {
  _globalAuthFailCount++;
  if (_globalAuthFailCount >= GLOBAL_AUTH_FAIL_LIMIT && !_globalAuthExhausted) {
    _globalAuthExhausted = true;
    console.warn('[secureInvoke] Global auth circuit breaker tripped – all polling stopped until re-login.');
    // Without this, a revoked/expired session left every poller 401-ing behind a
    // blank screen instead of returning the user to the login page.
    try { window.dispatchEvent(new Event(AUTH_EXHAUSTED_EVENT)); } catch { /* non-browser */ }
  }
}


export function resetAuthFailures(): void {
  _globalAuthFailCount = 0;
  _globalAuthExhausted = false;
}

export function isAuthExhausted(): boolean {
  return _globalAuthExhausted;
}

// Matches src/hooks/useAuth.tsx. WP-11B/C cookie-only: the staff session token
// is no longer read from JS storage — the HttpOnly `__Host-session_token` cookie
// is the sole carrier, so only the access-token (RLS/realtime JWT) key remains.
const ACCESS_TOKEN_KEY = 'supabase_access_token';

/**
 * Functions moving from wildcard token-auth CORS to exact-origin cookie CORS.
 *
 * These five used to be called with `credentials: 'omit'`, because they
 * answered every origin `Access-Control-Allow-Origin: *` and a credentialed
 * request may not be combined with a wildcard origin. Omitting credentials
 * stripped the HttpOnly `__Host-session_token` cookie — and WP-11B/C Phase 4
 * had already made that cookie the SOLE session carrier server-side. Their only
 * remaining credential was the HS256 access-token JWT, which the ES256
 * remediation records the browser can no longer obtain. Every PDF template
 * import therefore 401'd "Authentication required", shown to the user as
 * "Your sign-in session has expired" on a session that was perfectly valid.
 *
 * `createTokenAuthCorsHeaders(origin)` now answers an allowlisted origin
 * exactly, with credentials, so the cookie authenticates these calls like it
 * does everywhere else.
 *
 * DEPLOY ORDER: the frontend ships as one bundle; each function is redeployed
 * individually. Against a function still running the old wildcard build, a
 * credentialed request fails its CORS PREFLIGHT — so the real request is never
 * dispatched and nothing happened server-side. That is what makes the one-shot
 * `credentials: 'omit'` retry below safe: it cannot duplicate a side effect,
 * and it keeps imports working in whichever order the two sides deploy.
 */
const COOKIE_CORS_MIGRATING_FUNCTIONS = new Set([
  'template-import-pdf',
  'template-design-agent',
  'render-source',
  'import-from-url',
  'pdf-parse-dispatch',
]);

/**
 * Functions observed this session to still answer a wildcard origin. Remembered
 * so only the FIRST call to each pays for the failed credentialed preflight.
 *
 * Membership is also a DIAGNOSIS: the browser refusing a credentialed preflight
 * proves the deployed function still answers `Access-Control-Allow-Origin: *`,
 * i.e. it is running a build older than this bundle. See
 * `describeStaleDeployment`.
 */
const _uncredentialedUntil = new Map<string, number>();

/**
 * How long to trust that observation before trying the cookie again.
 *
 * Deliberately not forever. The state this memo describes is fixed by a
 * DEPLOY, not by anything happening in this tab, so a permanent memo means an
 * open tab keeps sending uncredentialed requests — and keeps failing — until
 * someone thinks to reload it. Re-testing costs one refused preflight per
 * function per window, which is nothing, and buys a tab that repairs itself
 * minutes after the functions ship.
 */
const UNCREDENTIALED_RECHECK_MS = 5 * 60_000;

/**
 * True when this function has been observed refusing the session cookie — the
 * signature of an edge function that has not been redeployed.
 */
export function isStaleFunctionDeployment(functionName: string): boolean {
  const until = _uncredentialedUntil.get(functionName);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    _uncredentialedUntil.delete(functionName);
    return false;
  }
  return true;
}

/**
 * The message to show when a function rejects us for being unauthenticated AND
 * we already know it refused the session cookie.
 *
 * This exists because the honest answer and the misleading one are the same
 * HTTP response. A function that cannot receive the cookie has no credential to
 * check, so it answers `401 Authentication required` — which reads as "your
 * session expired" and sends the user to sign out and back in, twice, while the
 * session was valid the whole time and the real fault was an undeployed
 * function. Signing in again cannot fix it, so the message must not ask for it.
 */
export function describeStaleDeployment(functionName: string): string {
  return `The ${functionName} service is running an older deployment that cannot `
    + 'accept your sign-in cookie, so it rejected the request as unauthenticated. '
    + 'Your session is fine — signing out will not help. Redeploy the Supabase '
    + `edge functions (supabase functions deploy ${functionName}).`;
}

/** Human-readable guidance for auth failures from secured edge functions. */
export function describeAuthError(message: string | undefined | null): string | null {
  const m = String(message ?? '').toLowerCase();
  if (
    m.includes('authentication required')
    || m.includes('invalid or expired session')
    || m.includes('session not found')
    || m === 'unauthorized'
  ) {
    return 'Your sign-in session has expired. Sign out, sign back in, and try again.';
  }
  return null;
}

/**
 * Does this response mean "we did not believe who you are"?
 *
 * 401 and 403 are unambiguous. The 400 arm exists because several functions
 * answer a missing session with `400 { error: 'Authentication required' }`
 * rather than a 401, and a caller that only looked at the status would show
 * that to a signed-in user as a bad request instead of refreshing their token.
 *
 * Exported so the streaming callers — which cannot go through
 * `invokeSecureFunction`, because it reads the whole body as JSON — apply the
 * same rule rather than inventing a second one.
 */
export function isAuthFailureResponse(status: number, message?: string | null): boolean {
  if (status === 401 || status === 403) return true;
  if (status !== 400) return false;
  const m = String(message ?? '').toLowerCase();
  return m.includes('authentication required')
    || m.includes('auth required')
    || m.includes('invalid session')
    || m.includes('session expired');
}

export interface InvokeResult<T = any> {
  data: T | null;
  error: { message: string; /** The server's `details` — the cause behind a generic message. */ details?: string; status?: number; functionName?: string; network?: boolean; code?:string; stage?:string; correlationId?:string; retryable?:boolean } | null;
}

function getStoredToken(key: string): string | null {
  try {
    return sessionStorage.getItem(key) || localStorage.getItem(key);
  } catch {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

function clearStoredToken(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function getAccessToken(): string | null {
  return getStoredToken(ACCESS_TOKEN_KEY);
}

/**
 * Attempt to refresh the stored Supabase access token by re-verifying the
 * HttpOnly `__Host-session_token` cookie (WP-11B/C cookie-only — no raw session
 * token is read from or written to JS storage). Returns the new access token on
 * success, or null when no refresh is possible (e.g. cookie absent/expired).
 */
async function tryRefreshAccessToken(): Promise<string | null> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/custom-auth-verify-v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      credentials: 'include',
      body: JSON.stringify({}),
    });
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => null) as any;
    if (json?.valid && json?.access_token) {
      try { sessionStorage.setItem(ACCESS_TOKEN_KEY, json.access_token); } catch { /* ignore */ }
      return json.access_token as string;
    }
  } catch (err) {
    console.warn('[secureInvoke] Token refresh failed', err);
  }
  return null;
}

/**
 * Re-mint the access token from the HttpOnly session cookie.
 *
 * Public because the streaming callers need the same one-shot refresh
 * `invokeSecureFunction` performs on an auth failure. Returns the new token, or
 * null when the cookie is gone or no longer valid — i.e. when the person really
 * does have to sign in again.
 */
export async function refreshAccessToken(): Promise<string | null> {
  return tryRefreshAccessToken();
}

/**
 * The Bearer credential for a call to an edge function.
 *
 * Three carriers, in order: the access token this tab mirrored at sign-in, the
 * native supabase-js session (for users who signed in through it), and — only
 * when asked — the HttpOnly `__Host-session_token` cookie, re-minted through
 * `custom-auth-verify-v2`.
 *
 * `refreshIfMissing` is opt-in because for the ordinary JSON path a missing
 * token is cheap to discover: the function answers 401 and
 * `invokeSecureFunction` refreshes and retries. A caller that cannot do that —
 * a streaming request, whose body is consumed once — asks for the refresh up
 * front instead of sending a credential it already knows is absent.
 */
export async function resolveAuthBearer(
  options: { refreshIfMissing?: boolean } = {},
): Promise<{ token: string; authenticated: boolean }> {
  let accessToken = getAccessToken();

  // Native Supabase Auth fallback: users signed in through supabase-js keep
  // their JWT in the client's own storage, not under our custom keys — for
  // them the old code silently sent the ANON key and secured functions 401'd.
  if (!accessToken) {
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      accessToken = (await supabase.auth.getSession()).data.session?.access_token ?? null;
    } catch { /* native session lookup is best-effort */ }
  }

  if (!accessToken && options.refreshIfMissing) {
    accessToken = await tryRefreshAccessToken();
  }

  return { token: accessToken || SUPABASE_ANON_KEY, authenticated: Boolean(accessToken) };
}

/**
 * Invoke an edge function with HttpOnly cookie support
 */
const RENDER_ROUTE_RE = /^render-([a-z-]+)-pdf$/;
const RENDER_ROUTE_FORMAT: Record<string, string> = {
  'borrowing-capacity': 'borrowing_capacity',
  'cash-flow': 'cashflow',
  'cash-flow-comparison': 'cash_flow_comparison',
  'client-details': 'client_details',
  'commercial-capacity': 'commercial_capacity',
  'market-intelligence': 'market_intelligence',
  'portfolio-review': 'portfolio',
  'property-comparison': 'comparison',
  'report-qa': 'qa',
  'investment-report': 'investment',
};

function maybeLogRenderCoverage(functionName: string, body: Record<string, any> | undefined, data: unknown): void {
  try {
    let engine: 'template' | 'design_composer' | 'legacy_server' | null = null;
    let format = '';
    if (functionName === 'render-template-pdf') {
      engine = 'template';
      format = String(body?.reportType ?? body?.format ?? '');
    } else {
      const m = RENDER_ROUTE_RE.exec(functionName);
      if (!m || !(m[1] in RENDER_ROUTE_FORMAT)) return;
      format = RENDER_ROUTE_FORMAT[m[1]];
      engine = functionName === 'render-investment-report-pdf' ? 'legacy_server' : 'design_composer';
    }
    // A route that answered but reported failure is not a produced document.
    if (data && typeof data === 'object' && (data as any).success === false) return;
    const reportId = [body?.reportId, body?.assessmentId, body?.comparisonId, body?.conversationId, body?.clientId]
      .find((v) => typeof v === 'string' && v);
    void import('@/lib/reports/renderEvent').then(({ logReportRenderEvent }) => {
      logReportRenderEvent({
        format: format || 'unknown',
        engine: engine!,
        source: 'engine_auto',
        reportId: (reportId as string | undefined) ?? null,
      });
    }).catch(() => {});
  } catch { /* coverage must never affect the call it observed */ }
}

export async function invokeSecureFunction<T = any>(
  functionName: string,
  body?: Record<string, any>,
  options?: { timeoutMs?: number; _isRetry?: boolean; stepUpCapability?: string; correlationId?:string; signal?: AbortSignal }
): Promise<InvokeResult<T>> {
  const correlationId = options?.correlationId ?? crypto.randomUUID();
  try {
    const { token: bearerToken, authenticated: hasAccessToken } = await resolveAuthBearer();

    // WP-11C: attach a live step-up token when the caller declares a capability.
    let stepUpToken: string | null = null;
    if (options?.stepUpCapability) {
      try {
        const { getStepUpToken } = await import('@/lib/security/stepUp');
        stepUpToken = getStepUpToken(options.stepUpCapability);
      } catch { /* module optional at boot */ }
    }

    // WP-11B/C cookie-only: the staff session travels solely in the HttpOnly
    // `__Host-session_token` cookie (`credentials: 'include'`). No raw session
    // token is read from storage or attached to the body/headers.
    //
    // CORS-SAFE CARRIERS — do not move these into request headers.
    // The frontend deploys as one bundle; the ~300 edge functions each carry
    // their own bundled copy of `_shared/auth.ts` and are redeployed
    // individually. A custom request header therefore only works once EVERY
    // function it can reach has been redeployed with that header in its
    // `Access-Control-Allow-Headers`. Until then the browser fails the
    // preflight and `fetch()` throws `Failed to fetch` — the whole app goes
    // dark. Body fields have no preflight requirement, so they stay correct
    // no matter how far the client runs ahead of the backend.
    // See scripts/security/check-cors-contract.mjs.
    const requestBody = {
      correlation_id: correlationId,
      ...(body ?? {}),
      ...(stepUpToken ? { step_up_token: stepUpToken } : {}),
    };

    const timeoutMs = options?.timeoutMs || 60000;
    const serializedBody = JSON.stringify(requestBody);

    const sendRequest = async (credentials: RequestCredentials): Promise<Response> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      // A caller-supplied signal (the editor cancels a superseded preview
      // render) aborts this request too. Without it, callers that need
      // cancellation had to hand-roll their own fetch — which is how the
      // render calls came to bypass this transport entirely.
      const external = options?.signal;
      const onExternalAbort = () => controller.abort();
      if (external) {
        if (external.aborted) controller.abort();
        else external.addEventListener('abort', onExternalAbort, { once: true });
      }
      try {
        return await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
          method: 'POST',
          // Only CORS-safelisted headers plus the two Supabase auth headers every
          // deployed function already allow-lists. `correlation_id` and
          // `step_up_token` ride in the body (see the note above) — adding either
          // as a header here breaks every page until all functions are redeployed.
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${bearerToken}`,
          },
          credentials,
          body: serializedBody,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
        external?.removeEventListener('abort', onExternalAbort);
      }
    };

    // The HttpOnly session cookie is the app's authoritative credential, so ask
    // for it by default. A function still on the old wildcard-CORS build rejects
    // that at the preflight — before the request is dispatched — so falling back
    // to an uncredentialed retry is side-effect free. See
    // COOKIE_CORS_MIGRATING_FUNCTIONS.
    const preferredCredentials: RequestCredentials =
      isStaleFunctionDeployment(functionName) ? 'omit' : 'include';
    let response: Response;
    try {
      response = await sendRequest(preferredCredentials);
    } catch (err: any) {
      // A timeout is our own abort, not a CORS verdict — never retry it.
      const isAbort = err?.name === 'AbortError';
      if (isAbort || preferredCredentials === 'omit' || !COOKIE_CORS_MIGRATING_FUNCTIONS.has(functionName)) {
        throw err;
      }
      console.warn(
        `[invokeSecureFunction] ${functionName} refused a credentialed request `
        + '(function not yet redeployed with exact-origin CORS); retrying without the session cookie.',
      );
      response = await sendRequest('omit');
      _uncredentialedUntil.set(functionName, Date.now() + UNCREDENTIALED_RECHECK_MS);
    }

    const data = await response.json().catch(() => ({}));
    const responseCorrelationId = response.headers.get('x-correlation-id') || data?.correlationId || data?.correlation_id || correlationId;
    
    if (!response.ok) {
      // Mission Control insufficient_funds → surface global banner.
      if (response.status === 402 && data?.error?.code === 'insufficient_funds') {
        emitOutOfTokens({
          available: Number(data.error.available ?? 0),
          requested: Number(data.error.requested ?? 0),
          functionName,
        });
        return {
          data: data as T,
          error: { message: data.error.message || 'Insufficient tokens', status: response.status, functionName, code:data.error.code, correlationId:responseCorrelationId, retryable:false },
        };
      }

      // 429 is expected back-pressure (callers back off and retry), so it is a
      // warning — logging it as an error surfaces it as an app runtime error.
      const isTransient = response.status === 429 || (response.status >= 500 && response.status < 600);
      const log = isTransient ? console.warn : console.error;
      log('[invokeSecureFunction] Request failed', {
        functionName,
        status: response.status,
        ...(functionName.startsWith('market-updates-') ? { code:data?.code ?? 'unknown', stage:data?.stage ?? 'function', correlationId:responseCorrelationId } : { data }),
        hasAccessToken,
      });

      const message = String(data?.error?.message || data?.error || data?.message || '');
      const isAuthFailure = isAuthFailureResponse(response.status, message);

      // ── A function that refused the cookie cannot judge our session ──
      // We watched this one reject a credentialed preflight, so it never saw a
      // credential and its 401 says nothing about whether the user is signed
      // in. Report the real fault instead of the response's wording, and do NOT
      // trip the global auth breaker — an undeployed function must not clear
      // this tab's token or stop polling everywhere else.
      if (isAuthFailure && isStaleFunctionDeployment(functionName)) {
        const staleMessage = describeStaleDeployment(functionName);
        console.error('[invokeSecureFunction] Stale function deployment', {
          functionName,
          status: response.status,
          serverMessage: message,
          correlationId: responseCorrelationId,
        });
        return {
          data: data as T,
          error: {
            message: staleMessage,
            status: response.status,
            functionName,
            code: 'function_deployment_stale',
            correlationId: responseCorrelationId,
            retryable: false,
          },
        };
      }

      // ── One-shot token refresh + retry on auth failure ──
      if (isAuthFailure && !options?._isRetry && functionName !== 'custom-auth-verify-v2') {
        const refreshed = await tryRefreshAccessToken();
        if (refreshed) {
          console.log('[invokeSecureFunction] Access token refreshed, retrying', functionName);
          return invokeSecureFunction<T>(functionName, body, { ...options, _isRetry: true, correlationId });
        }
      }

      if (isAuthFailure) {
        markAuthFailure();
        if (isAuthExhausted()) {
          console.warn('[secureInvoke] Clearing stale access token after repeated auth failures');
          clearStoredToken(ACCESS_TOKEN_KEY);
        }
      }

      const errorMessage = typeof data?.error === 'object' && data.error?.message
        ? data.error.message
        : data?.error || data?.message || `HTTP ${response.status}`;

      // ── Carry the server's `details` onto the error ──
      // Several functions answer a failure with a generic sentence in `error`
      // and the actual cause in `details` — `manage-client-data` returns
      // `{ error: 'Failed to update record', details: <the database message> }`.
      // Nothing here read `details`, so every caller that reports
      // `error.message` showed six words that name no cause and cannot be
      // acted on. That is how "Failed to update: Failed to update record"
      // came to be all anybody could see when marking a commission received.
      //
      // It is carried rather than concatenated, so a caller decides whether an
      // operator sees it; but it is no longer thrown away before they can.
      const errorDetails = typeof data?.details === 'string' && data.details.trim()
        ? data.details.trim()
        : undefined;

      return { 
        data: data as T, 
        error: { message: String(errorMessage), details: errorDetails, status: response.status, functionName, code:data?.error?.code ?? data?.code, stage:data?.stage, correlationId:responseCorrelationId, retryable:data?.retryable }
      };
    }
    
    resetAuthFailures();

    // Surface token usage for metered generators.
    if (isReportGenerator(functionName)) {
      // Only what was actually charged. The reservation and the pre-flight
      // estimate are metering mechanics — the server still needs both, but
      // nothing in the UI reports on them.
      const headerUsed = Number(response.headers.get('x-tokens-used') || 0);
      const headerDuration = Number(response.headers.get('x-duration-ms') || 0);
      const bodyUsed = Number((data as any)?.tokensUsed || 0);
      const used = bodyUsed > 0 ? bodyUsed : headerUsed;
      if (used > 0) {
        emitTokensUsed({
          tokensUsed: used,
          durationMs: headerDuration || (data as any)?.durationMs,
          functionName,
        });
      }
    }

    // ── Render-coverage telemetry (fire-and-forget) ──────────────────────
    // Every server render route answered here successfully is one produced
    // document, and docs/reports/COVERAGE.md exists because most pathways
    // recorded nothing. Logging at the one place every render invocation
    // already passes through is the meteredFetch pattern: coverage that
    // cannot be forgotten by a new call site. Browser-only generators (no
    // server call) log themselves via `reports/renderEvent.ts`.
    maybeLogRenderCoverage(functionName, body, data);

    return { data: data as T, error: null };
  } catch (error: any) {
    const isTimeout = error.name === 'AbortError';
    const rawMessage = error.message || 'Network error';
    const message = isTimeout
      ? 'Request timed out. Please try again.'
      : rawMessage === 'Failed to fetch'
        ? `Network/CORS error calling ${functionName}. Please check the function deployment and auth/CORS configuration.`
        : rawMessage;
    console.error('[invokeSecureFunction] Network invocation failed', {
      functionName,
      message: rawMessage,
      isTimeout,
      correlationId,
    });
    return {
      data: null,
      error: { message, functionName, network: true, code:isTimeout?'provider_timeout':'network_error', stage:'network', correlationId, retryable:true },
    };
  }
}


/**
 * Best-effort check for an active session. The staff session lives in an
 * HttpOnly cookie that JS cannot read, so this reflects only whether a
 * (tab-scoped) access token is present; the authoritative check is a
 * cookie-authenticated custom-auth-verify-v2 call.
 */
export function hasActiveSession(): boolean {
  return Boolean(getAccessToken());
}

/**
 * Authoritative session check.
 *
 * `hasActiveSession()` only sees the (tab-scoped) access token, so it reports
 * "expired" whenever that token was never mirrored into this tab, was cleared
 * after transient auth failures, or the user signed in through supabase-js.
 * In all three cases the HttpOnly `__Host-session_token` cookie is still valid,
 * so we re-verify against it (and re-seed the access token) before telling the
 * user their session has expired.
 */
export async function ensureActiveSession(): Promise<boolean> {
  if (getAccessToken()) return true;

  try {
    const { supabase } = await import('@/integrations/supabase/client');
    if ((await supabase.auth.getSession()).data.session?.access_token) return true;
  } catch { /* native session lookup is best-effort */ }

  const refreshed = await tryRefreshAccessToken();
  if (refreshed) {
    resetAuthFailures();
    return true;
  }
  return false;
}

