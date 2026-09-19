/**
 * Shared GoHighLevel account credential resolver.
 *
 * Allows edge functions to dynamically choose between the LEGACY GHL account
 * (the long-running production account) and the NEW GHL account being
 * migrated to, without duplicating sync infrastructure.
 *
 * Default = 'legacy' so every existing function keeps its current behaviour
 * unless a caller explicitly opts into the new account.
 */

export type GhlAccount = 'legacy' | 'new';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

export interface GhlCredentials {
  apiKey: string | undefined;
  locationId: string | undefined;
  label: GhlAccount;
}

export interface GhlTokenDiagnostics {
  token_format: 'jwt' | 'opaque' | 'missing';
  token_type_hint: 'sub_account' | 'agency_or_main' | 'unknown';
  has_location_id: boolean;
  location_id_matches_secret: boolean | null;
  has_company_id: boolean;
  expires_at: string | null;
  exchange_attempted?: boolean;
  exchange_succeeded?: boolean;
  exchange_error?: string;
}

export interface GhlResolvedAccessToken {
  accessToken: string;
  diagnostics: GhlTokenDiagnostics;
}

export function getGhlCredentials(account: GhlAccount = 'legacy'): GhlCredentials {
  if (account === 'new') {
    return {
      apiKey: Deno.env.get('GOHIGHLEVEL_API_KEY_NEW'),
      locationId: Deno.env.get('GOHIGHLEVEL_LOCATION_ID_NEW'),
      label: 'new',
    };
  }
  return {
    apiKey: Deno.env.get('GOHIGHLEVEL_API_KEY'),
    locationId: Deno.env.get('GOHIGHLEVEL_LOCATION_ID'),
    label: 'legacy',
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Effective-account resolution (post-cutover aware)
// ─────────────────────────────────────────────────────────────────────────
// Reads `ghl_account_config.default_account` from the database. When the
// legacy GHL account has been decommissioned (legacy_disabled_at IS NOT NULL),
// the default flips to 'new' automatically.
//
// Cached for 60s in-memory (per cold container).
let _accountCache: { value: GhlAccount; legacyDisabled: boolean; until: number } | null = null;
const ACCOUNT_CACHE_MS = 60_000;

export class LegacyAccountDisabledError extends Error {
  constructor(msg = 'Legacy GHL account has been decommissioned. Use account = "new".') {
    super(msg);
    this.name = 'LegacyAccountDisabledError';
  }
}

async function readAccountConfig(supabase: any): Promise<{ default_account: GhlAccount; legacy_disabled: boolean }> {
  if (_accountCache && _accountCache.until > Date.now()) {
    return { default_account: _accountCache.value, legacy_disabled: _accountCache.legacyDisabled };
  }
  try {
    const { data } = await supabase
      .from('ghl_account_config')
      .select('default_account, legacy_disabled_at')
      .eq('id', true)
      .maybeSingle();
    const def = (data?.default_account === 'new' ? 'new' : 'legacy') as GhlAccount;
    const disabled = !!data?.legacy_disabled_at;
    _accountCache = { value: def, legacyDisabled: disabled, until: Date.now() + ACCOUNT_CACHE_MS };
    return { default_account: def, legacy_disabled: disabled };
  } catch (e) {
    console.warn('[ghl-account] readAccountConfig failed, defaulting to legacy:', (e as any)?.message);
    return { default_account: 'legacy', legacy_disabled: false };
  }
}

/**
 * Resolve which GHL account a caller should hit, taking the live cutover
 * config into account. If `requested` is omitted, returns the configured
 * default. If `requested === 'legacy'` AFTER cutover, throws.
 */
export async function resolveGhlAccount(
  supabase: any,
  requested?: GhlAccount,
): Promise<GhlAccount> {
  const cfg = await readAccountConfig(supabase);
  if (cfg.legacy_disabled && requested === 'legacy') {
    throw new LegacyAccountDisabledError();
  }
  if (requested) return requested;
  return cfg.default_account;
}

/** Get creds for the resolved effective account. */
export async function getEffectiveGhlCredentials(
  supabase: any,
  requested?: GhlAccount,
): Promise<GhlCredentials> {
  const account = await resolveGhlAccount(supabase, requested);
  return getGhlCredentials(account);
}

/** Force a refresh of the account-config cache. */
export function invalidateGhlAccountCache(): void {
  _accountCache = null;
}

/**
 * Validates that credentials exist for the chosen account; returns a
 * friendly error message if not, otherwise null.
 */
export function validateGhlCredentials(creds: GhlCredentials): string | null {
  if (!creds.apiKey || !creds.locationId) {
    const missing: string[] = [];
    if (!creds.apiKey) missing.push(`GOHIGHLEVEL_API_KEY${creds.label === 'new' ? '_NEW' : ''}`);
    if (!creds.locationId) missing.push(`GOHIGHLEVEL_LOCATION_ID${creds.label === 'new' ? '_NEW' : ''}`);
    return `Missing GHL ${creds.label} credentials: ${missing.join(', ')}`;
  }
  return null;
}

/**
 * Build standard GHL API request headers.
 */
export function buildGhlHeaders(apiKey: string, version: string = '2021-07-28') {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Version': version,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
}

function decodeJwtPayload(token: string | undefined): Record<string, any> | null {
  if (!token || !token.startsWith('eyJ')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function getGhlTokenDiagnostics(creds: GhlCredentials): GhlTokenDiagnostics {
  if (!creds.apiKey) {
    return {
      token_format: 'missing',
      token_type_hint: 'unknown',
      has_location_id: false,
      location_id_matches_secret: null,
      has_company_id: false,
      expires_at: null,
    };
  }

  const payload = decodeJwtPayload(creds.apiKey);
  if (!payload) {
    return {
      token_format: creds.apiKey.startsWith('eyJ') ? 'jwt' : 'opaque',
      token_type_hint: 'unknown',
      has_location_id: false,
      location_id_matches_secret: null,
      has_company_id: false,
      expires_at: null,
    };
  }

  const tokenLocationId = payload.locationId || payload.location_id || null;
  const tokenCompanyId = payload.companyId || payload.company_id || null;

  return {
    token_format: 'jwt',
    token_type_hint: tokenLocationId ? 'sub_account' : tokenCompanyId ? 'agency_or_main' : 'unknown',
    has_location_id: Boolean(tokenLocationId),
    location_id_matches_secret: tokenLocationId && creds.locationId ? tokenLocationId === creds.locationId : null,
    has_company_id: Boolean(tokenCompanyId),
    expires_at: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
  };
}

/**
 * Contact/opportunity/note writes require a GHL Sub-Account token. If an
 * agency/main OAuth token is supplied and it carries companyId, exchange it
 * for a location token before making write calls.
 */
export async function resolveGhlAccessTokenForLocation(creds: GhlCredentials): Promise<GhlResolvedAccessToken> {
  const diagnostics = getGhlTokenDiagnostics(creds);
  if (!creds.apiKey) throw new Error(`Missing GHL ${creds.label} API key`);

  if (diagnostics.token_type_hint !== 'agency_or_main') {
    return { accessToken: creds.apiKey, diagnostics };
  }

  const payload = decodeJwtPayload(creds.apiKey);
  const companyId = payload?.companyId || payload?.company_id;
  if (!companyId || !creds.locationId) {
    return {
      accessToken: creds.apiKey,
      diagnostics: {
        ...diagnostics,
        exchange_attempted: false,
        exchange_succeeded: false,
        exchange_error: 'Token appears to be agency/main level, but companyId or locationId is unavailable for location-token exchange.',
      },
    };
  }

  const exchangeDiagnostics: GhlTokenDiagnostics = {
    ...diagnostics,
    exchange_attempted: true,
    exchange_succeeded: false,
  };

  try {
    const body = new URLSearchParams({ companyId, locationId: creds.locationId });
    const response = await fetch(`${GHL_API_BASE}/oauth/locationToken`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.apiKey}`,
        'Version': '2021-07-28',
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const text = await response.text();
    if (!response.ok) {
      return {
        accessToken: creds.apiKey,
        diagnostics: {
          ...exchangeDiagnostics,
          exchange_error: `Location token exchange failed: ${response.status} ${text.substring(0, 220)}`,
        },
      };
    }

    const data = JSON.parse(text || '{}');
    if (!data.access_token) {
      return {
        accessToken: creds.apiKey,
        diagnostics: {
          ...exchangeDiagnostics,
          exchange_error: 'Location token exchange succeeded but returned no access_token.',
        },
      };
    }

    return {
      accessToken: data.access_token,
      diagnostics: {
        ...exchangeDiagnostics,
        exchange_succeeded: true,
      },
    };
  } catch (err: any) {
    return {
      accessToken: creds.apiKey,
      diagnostics: {
        ...exchangeDiagnostics,
        exchange_error: `Location token exchange threw: ${err.message || 'Unknown error'}`,
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope probing — verify a token has the scopes required for live migration
// ─────────────────────────────────────────────────────────────────────────────

export type GhlScopeKey =
  | 'contacts.readonly'
  | 'contacts.write'
  | 'opportunities.readonly'
  | 'opportunities.write'
  | 'contacts/notes.write'
  | 'conversations.readonly'
  | 'conversations.write'
  | 'locations.readonly'
  | 'calendars.readonly'
  | 'calendars.write'
  | 'calendars/groups.readonly'
  | 'calendars/groups.write'
  | 'calendars/events.readonly'
  | 'calendars/events.write';

export interface GhlScopeProbeResult {
  scope: GhlScopeKey;
  required_for: string[];           // e.g. ['contacts', 'opportunities']
  ok: boolean;
  http_status: number | null;
  error_code: string | null;        // GHL error code or our parsed token (e.g. GHL_401_SCOPE)
  error_message: string | null;
  endpoint: string;
  method: string;
}

export interface GhlCredentialAudit {
  account: GhlAccount;
  token_format: GhlTokenDiagnostics['token_format'];
  token_type_hint: GhlTokenDiagnostics['token_type_hint'];
  token_kind: 'private_integration_token' | 'oauth_jwt' | 'legacy_api_key' | 'unknown';
  has_location_id: boolean;
  location_id_matches_secret: boolean | null;
  expires_at: string | null;
  exchange_attempted: boolean;
  exchange_succeeded: boolean | null;
  exchange_error: string | null;
  scope_probes: GhlScopeProbeResult[];
  required_scopes_ok: boolean;
  missing_scopes: GhlScopeKey[];
  documentation_url: string;
}

export const GHL_SCOPE_DOCS_URL =
  'https://highlevel.stoplight.io/docs/integrations/ZG9jOjI4MzkxNDg4-authorization';

/**
 * Classify what kind of token this is. PIT and OAuth JWTs both start with eyJ;
 * we use payload presence of `authClass` (PIT) vs `companyId/locationId` (OAuth)
 * heuristically.
 */
function classifyTokenKind(apiKey: string | undefined): GhlCredentialAudit['token_kind'] {
  if (!apiKey) return 'unknown';
  if (!apiKey.startsWith('eyJ')) return 'legacy_api_key';
  const payload = decodeJwtPayload(apiKey);
  if (!payload) return 'unknown';
  // PIT tokens generally embed authClass = 'Location' and an oauthMeta
  if (payload.authClass === 'Location' || payload.tokenType === 'pit' || payload.scopes) {
    return 'private_integration_token';
  }
  if (payload.companyId || payload.locationId || payload.aud === 'gohighlevel') {
    return 'oauth_jwt';
  }
  return 'unknown';
}

/** Map a domain to the scopes a live migration job into that domain requires. */
export function requiredScopesForDomain(domain: string): GhlScopeKey[] {
  switch (domain) {
    case 'contacts':
      return ['locations.readonly', 'contacts.readonly', 'contacts.write'];
    case 'opportunities':
      return ['locations.readonly', 'contacts.readonly', 'opportunities.readonly', 'opportunities.write'];
    case 'notes':
      return ['locations.readonly', 'contacts.readonly', 'contacts/notes.write'];
    case 'conversations':
      return ['locations.readonly', 'conversations.readonly'];
    case 'conversations_replay':
      // Replay needs read on source AND write on target. Probe both reads
      // (cheap) plus the write scope. The orchestrator probes the TARGET
      // account's scopes; the source account is already trusted for reads
      // by the original mirror sync that produced our snapshot.
      return ['locations.readonly', 'conversations.readonly', 'conversations.write'];
    case 'calendar_groups':
      return ['locations.readonly', 'calendars/groups.readonly', 'calendars/groups.write'];
    case 'calendars':
      return ['locations.readonly', 'calendars.readonly', 'calendars.write', 'calendars/groups.readonly'];
    case 'bookings':
      return ['locations.readonly', 'calendars.readonly', 'calendars/events.readonly', 'calendars/events.write'];
    default:
      return ['locations.readonly'];
  }
}

interface ProbeSpec {
  scope: GhlScopeKey;
  required_for: string[];
  method: 'GET' | 'POST';
  buildUrl: (locationId: string) => string;
  body?: Record<string, any> | ((locationId: string) => Record<string, any>);
  /** Status codes that *prove* the scope is granted (even if the entity doesn't exist). */
  okStatuses?: number[];
}

/**
 * Each probe is the cheapest possible call that exercises the scope.
 * We deliberately use endpoints that 4xx (404/422) on missing data but only
 * return 401/403 when the *scope* is missing.
 */
const PROBES: ProbeSpec[] = [
  {
    scope: 'locations.readonly',
    required_for: ['contacts', 'opportunities', 'notes', 'conversations'],
    method: 'GET',
    buildUrl: (loc) => `${GHL_API_BASE}/locations/${loc}`,
  },
  {
    scope: 'contacts.readonly',
    required_for: ['contacts', 'opportunities', 'notes'],
    method: 'GET',
    buildUrl: (loc) => `${GHL_API_BASE}/contacts/?locationId=${loc}&limit=1`,
  },
  {
    scope: 'contacts.write',
    required_for: ['contacts'],
    method: 'POST',
    buildUrl: () => `${GHL_API_BASE}/contacts/upsert`,
    // Deliberately INVALID payload: location-scoped, but with no email/phone.
    // GHL should validate auth/scope first, then return 400/422 without
    // creating a probe contact. A 401/403 still means the write scope is bad.
    body: (loc) => ({ locationId: loc }),
    okStatuses: [400, 422],
  },
  {
    scope: 'opportunities.readonly',
    required_for: ['opportunities'],
    method: 'GET',
    buildUrl: (loc) => `${GHL_API_BASE}/opportunities/search?location_id=${loc}&limit=1`,
  },
  {
    scope: 'opportunities.write',
    required_for: ['opportunities'],
    method: 'POST',
    buildUrl: () => `${GHL_API_BASE}/opportunities/`,
    body: (loc) => ({ locationId: loc /* missing required pipelineId → 422, not 401 */ }),
    okStatuses: [200, 201, 400, 422],
  },
  {
    scope: 'contacts/notes.write',
    required_for: ['notes'],
    method: 'POST',
    // GHL note creation requires a contactId; we use an obviously fake one.
    // Result: 404/422 if scope OK, 401/403 if scope missing.
    buildUrl: () => `${GHL_API_BASE}/contacts/__lovable_probe_invalid__/notes/`,
    body: () => ({ body: 'scope probe' }),
    okStatuses: [200, 201, 400, 404, 422],
  },
  {
    scope: 'conversations.readonly',
    required_for: ['conversations', 'conversations_replay'],
    method: 'GET',
    buildUrl: (loc) => `${GHL_API_BASE}/conversations/search?locationId=${loc}&limit=1`,
  },
  {
    scope: 'conversations.write',
    required_for: ['conversations_replay'],
    method: 'POST',
    // Deliberately invalid: missing required contactId. GHL returns 400/422
    // when scope is OK; 401/403 when it isn't.
    buildUrl: () => `${GHL_API_BASE}/conversations/`,
    body: (loc) => ({ locationId: loc /* missing contactId → 422, not 401 */ }),
    okStatuses: [200, 201, 400, 422],
  },
  {
    scope: 'calendars/groups.readonly',
    required_for: ['calendar_groups', 'calendars'],
    method: 'GET',
    buildUrl: (loc) => `${GHL_API_BASE}/calendars/groups?locationId=${loc}`,
  },
  {
    scope: 'calendars/groups.write',
    required_for: ['calendar_groups'],
    method: 'POST',
    buildUrl: () => `${GHL_API_BASE}/calendars/groups`,
    // Missing required name → 400/422 if scope OK; 401/403 if not.
    body: (loc) => ({ locationId: loc }),
    okStatuses: [200, 201, 400, 422],
  },
  {
    scope: 'calendars.readonly',
    required_for: ['calendars', 'bookings'],
    method: 'GET',
    buildUrl: (loc) => `${GHL_API_BASE}/calendars/?locationId=${loc}`,
  },
  {
    scope: 'calendars.write',
    required_for: ['calendars'],
    method: 'POST',
    buildUrl: () => `${GHL_API_BASE}/calendars/`,
    body: (loc) => ({ locationId: loc /* missing required fields */ }),
    okStatuses: [200, 201, 400, 422],
  },
  {
    scope: 'calendars/events.readonly',
    required_for: ['bookings'],
    method: 'GET',
    // calendarId is required by this endpoint; an obviously-fake one returns
    // 404/422 when scope is OK and 401/403 when it's not.
    buildUrl: (loc) => `${GHL_API_BASE}/calendars/events?locationId=${loc}&calendarId=__lovable_probe_invalid__&startTime=0&endTime=1`,
  },
  {
    scope: 'calendars/events.write',
    required_for: ['bookings'],
    method: 'POST',
    buildUrl: () => `${GHL_API_BASE}/calendars/events/appointments`,
    body: (loc) => ({ locationId: loc /* missing calendarId/contactId → 422 */ }),
    okStatuses: [200, 201, 400, 422],
  },
];

/**
 * Probe each scope. Returns per-scope results plus an aggregate audit object
 * suitable for stamping into migration_jobs.payload.token_audit.
 */
export async function probeGhlCredentialScopes(
  account: GhlAccount,
  options: { domains?: string[] } = {},
): Promise<GhlCredentialAudit> {
  const creds = getGhlCredentials(account);
  const diagnostics = getGhlTokenDiagnostics(creds);
  const tokenKind = classifyTokenKind(creds.apiKey);

  const audit: GhlCredentialAudit = {
    account,
    token_format: diagnostics.token_format,
    token_type_hint: diagnostics.token_type_hint,
    token_kind: tokenKind,
    has_location_id: Boolean(creds.locationId),
    location_id_matches_secret: diagnostics.location_id_matches_secret,
    expires_at: diagnostics.expires_at,
    exchange_attempted: false,
    exchange_succeeded: null,
    exchange_error: null,
    scope_probes: [],
    required_scopes_ok: false,
    missing_scopes: [],
    documentation_url: GHL_SCOPE_DOCS_URL,
  };

  if (!creds.apiKey || !creds.locationId) {
    return audit;
  }

  // For agency/main tokens, attempt token exchange first so probes use the right token.
  let probeToken = creds.apiKey;
  if (diagnostics.token_type_hint === 'agency_or_main') {
    const resolved = await resolveGhlAccessTokenForLocation(creds);
    probeToken = resolved.accessToken;
    audit.exchange_attempted = resolved.diagnostics.exchange_attempted ?? false;
    audit.exchange_succeeded = resolved.diagnostics.exchange_succeeded ?? null;
    audit.exchange_error = resolved.diagnostics.exchange_error ?? null;
  }

  const headers = buildGhlHeaders(probeToken);
  const restrictDomains = options.domains;

  for (const probe of PROBES) {
    if (restrictDomains && !probe.required_for.some((d) => restrictDomains.includes(d))) {
      continue;
    }
    const url = probe.buildUrl(creds.locationId);
    let result: GhlScopeProbeResult = {
      scope: probe.scope,
      required_for: probe.required_for,
      ok: false,
      http_status: null,
      error_code: null,
      error_message: null,
      endpoint: url.replace(GHL_API_BASE, ''),
      method: probe.method,
    };

    try {
      const init: RequestInit = { method: probe.method, headers };
      if (probe.method === 'POST') {
        const bodyObj = typeof probe.body === 'function' ? probe.body(creds.locationId) : probe.body;
        init.body = JSON.stringify(bodyObj ?? {});
      }
      const res = await fetch(url, init);
      const status = res.status;
      const text = await res.text();
      result.http_status = status;

      if (status === 401 || status === 403) {
        const parsed = parseGhlError(text);
        result.ok = false;
        result.error_code = parsed.error_code || `GHL_${status}_SCOPE`;
        result.error_message = parsed.message || text.substring(0, 240);
      } else if (probe.okStatuses && probe.okStatuses.includes(status)) {
        result.ok = true;
      } else if (status >= 200 && status < 300) {
        result.ok = true;
      } else {
        // Non-auth failure (404/422 on read GET we didn't whitelist, 500, etc.)
        // Treat as scope-OK if the response body doesn't mention scope/auth.
        const lower = text.toLowerCase();
        const looksLikeScope = lower.includes('scope') || lower.includes('not authorized');
        result.ok = !looksLikeScope;
        if (!result.ok) {
          const parsed = parseGhlError(text);
          result.error_code = parsed.error_code || `GHL_${status}`;
          result.error_message = parsed.message || text.substring(0, 240);
        }
      }
    } catch (err: any) {
      result.error_code = 'NETWORK_ERROR';
      result.error_message = err.message?.substring(0, 240) || 'Request failed';
    }

    audit.scope_probes.push(result);
  }

  audit.missing_scopes = audit.scope_probes.filter((p) => !p.ok).map((p) => p.scope);
  audit.required_scopes_ok = audit.missing_scopes.length === 0;
  return audit;
}

/**
 * Parse a GHL error response body into a structured code + message.
 * GHL responses are typically: { statusCode, message, error?, code? }
 */
export function parseGhlError(body: string): { error_code: string | null; message: string | null } {
  if (!body) return { error_code: null, message: null };
  try {
    const json = JSON.parse(body);
    const message = json.message || json.error || json.msg || null;
    const explicit = json.code || json.errorCode || null;
    let inferred: string | null = null;
    const lower = (message || '').toLowerCase();
    if (lower.includes('not authorized for this scope')) inferred = 'GHL_SCOPE_FORBIDDEN';
    else if (lower.includes('invalid token') || lower.includes('jwt')) inferred = 'GHL_INVALID_TOKEN';
    else if (lower.includes('location') && lower.includes('not found')) inferred = 'GHL_LOCATION_NOT_FOUND';
    else if (lower.includes('rate limit')) inferred = 'GHL_RATE_LIMIT';
    return { error_code: explicit || inferred, message };
  } catch {
    const lower = body.toLowerCase();
    if (lower.includes('scope')) return { error_code: 'GHL_SCOPE_FORBIDDEN', message: body.substring(0, 240) };
    return { error_code: null, message: body.substring(0, 240) };
  }
}

export function describeGhlWriteAuthFailure(diagnostics: GhlTokenDiagnostics): string {
  if (diagnostics.token_type_hint === 'agency_or_main') {
    const exchange = diagnostics.exchange_attempted
      ? diagnostics.exchange_succeeded
        ? 'Location-token exchange succeeded, but GHL still rejected the write token.'
        : diagnostics.exchange_error || 'Location-token exchange failed.'
      : diagnostics.exchange_error || 'No location-token exchange was possible.';
    return `GHL write rejected. The configured token appears to be an Agency/Main token; contacts/upsert requires a Sub-Account token. ${exchange}`;
  }

  if (diagnostics.token_type_hint === 'sub_account' && diagnostics.location_id_matches_secret === false) {
    return 'GHL write rejected. The token is a Sub-Account token, but its embedded locationId does not match GOHIGHLEVEL_LOCATION_ID_NEW.';
  }

  return 'GHL write rejected. Confirm the token is a Sub-Account Private Integration/OAuth token with contacts.write for the configured location.';
}
