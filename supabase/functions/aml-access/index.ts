import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const AML_ROLES = new Set(["analyst", "reviewer", "mlro", "auditor"]);

/**
 * The AML V3 rollout flags, answered here with the service role.
 *
 * ── Why they cannot be read from the page ─────────────────────────────
 * `public.feature_flags` grants SELECT `TO authenticated`, and the Command
 * Centre's browser client is anon-only: identity here is the custom HttpOnly
 * cookie session, and `createClient` sets `persistSession: false` precisely
 * so GoTrue never competes with it. The client therefore never holds an
 * `authenticated` role — and RLS does not error on a role that matches no
 * policy, it FILTERS. A `from('feature_flags')` read from the page returned
 * `[]` with HTTP 200 and a null error, which coerced to "every flag is off".
 *
 * So every V3 flag read as off, in every browser, for every user, however the
 * database was set — and `aml_v3_case_workspace` gates the whole staged case
 * workspace, which was unreachable from the day it shipped.
 *
 * The identical trap is documented on `useBuilderStockMarketplaceFlag` for
 * `builder_stock_marketplace`; the rule it states is read through the server,
 * not the table. This endpoint is the natural home: every AML surface already
 * calls it for roles, it already reads `feature_flags` with the service role
 * for `aml_ctf`, and answering the V3 flags here costs no extra round trip.
 *
 * Rollout flags are presentation state, not secrets, and this response is
 * already gated on an authenticated Command Centre session.
 */
const AML_V3_FLAG_KEYS = [
  "aml_v3_nav",
  "aml_v3_start_client_compliance",
  "aml_v3_compliance_home",
  "aml_v3_case_workspace",
  "aml_v3_regulatory_hub",
  "aml_v3_terminology_editor",
  "aml_v3_metrics_relocation",
  "aml_v3_org_settings",
] as const;

/** `true`, `"true"` and `{ enabled: true }` all mean on. Everything else is off. */
function coerceFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  if (value && typeof value === "object") {
    return (value as { enabled?: unknown }).enabled === true;
  }
  return false;
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Server configuration missing" }, 500);

    const body = await req.json().catch(() => ({}));
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const auth = await verifyAuth(admin, req.headers, body);

    if (auth.error || !auth.userId || auth.userId === "service_role") {
      return json({ error: auth.error || "Authentication required" }, 401);
    }

    const [
      { data: flag, error: flagError },
      { data: roleRows, error: roleError },
      { data: v3Rows, error: v3Error },
    ] = await Promise.all([
      admin.from("feature_flags").select("value").eq("key", "aml_ctf").maybeSingle(),
      admin.rpc("get_aml_roles_for_user", { _user_id: auth.userId }),
      admin.from("feature_flags").select("key,value").in("key", [...AML_V3_FLAG_KEYS]),
    ]);

    if (flagError) throw flagError;
    if (roleError) throw roleError;
    // A failed V3 read must not answer "everything off" — that silent
    // equivalence is the whole bug this block exists to end.
    if (v3Error) throw v3Error;

    const v3Map = new Map((v3Rows ?? []).map((row: any) => [String(row.key), row.value]));
    const v3Flags: Record<string, boolean> = {};
    for (const key of AML_V3_FLAG_KEYS) v3Flags[key] = coerceFlag(v3Map.get(key));

    const roles: string[] = (roleRows ?? [])
      .map((row: any) => String(row.role ?? ""))
      .filter((role: string) => AML_ROLES.has(role));
    const uniqueRoles: string[] = Array.from(new Set(roles));
    const flagEnabled = Boolean((flag?.value as { enabled?: boolean } | null | undefined)?.enabled);

    return json({
      flagEnabled,
      roles: uniqueRoles,
      hasAnyRole: uniqueRoles.length > 0,
      canWrite: uniqueRoles.some((role: string) => ["analyst", "reviewer", "mlro"].includes(role)),
      isMlro: uniqueRoles.includes("mlro"),
      userId: auth.userId,
      /**
       * Rollout state for the V3 surfaces, keyed exactly as the table stores
       * it. Its ABSENCE is meaningful: it tells the browser it is talking to a
       * deployment of this function that predates the fix, so the answer is
       * unknown rather than "off".
       */
      v3Flags,
    });
  } catch (error) {
    console.error("[aml-access] failed", error);
    return json({ ...internalError(error, 'aml-access') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
