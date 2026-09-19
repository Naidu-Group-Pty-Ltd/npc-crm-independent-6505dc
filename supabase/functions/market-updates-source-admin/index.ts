// Market Updates — Phase 6: Source health admin
// Admin-gated CRUD-ish operations on market_sources and health snapshots.
// Roles allowed: 'admin' | 'superadmin'. Bypass via x-cron-secret for ops.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { classifyMarketError, logMarketEvent, marketCorrelationId } from "../_shared/marketUpdatesObservability.ts";
const jsonWithCors = (cors: Record<string, string>) => (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

const CRON_SECRET = Deno.env.get("MARKET_INGESTION_CRON_SECRET");

async function isAdminOrSuperadmin(sb: any, userId: string): Promise<boolean> {
  if (!userId || userId === "service_role") return true;
  const { data: roleRows } = await sb
    .from("user_roles").select("role").eq("user_id", userId);
  const roles = (roleRows ?? []).map((r: any) => r.role);
  if (roles.includes("admin") || roles.includes("superadmin") || roles.includes("super_admin")) return true;
  const { data: cu } = await sb
    .from("custom_users").select("role, is_active").eq("id", userId).maybeSingle();
  if (cu?.is_active) {
    const r = String(cu.role ?? "").toLowerCase();
    if (r === "super_admin" || r === "superadmin" || r === "admin") return true;
  }
  return false;
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get("origin"));
  let correlationId=marketCorrelationId(req.headers);
  cors['x-correlation-id']=correlationId;
  const json = jsonWithCors(cors);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(cors, __csrf);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cron = req.headers.get("x-cron-secret");
  let authorized = Boolean(cron && CRON_SECRET && cron === CRON_SECRET);
  let actorId: string | null = null;

  if (!authorized) {
    const auth = await verifyAuth(sb, req.headers, {});
    if (auth.error || !auth.userId) return json({ error: "unauthorized" }, 401);
    actorId = auth.userId;
    authorized = await isAdminOrSuperadmin(sb, actorId!);
    if (!authorized) return json({ error: "forbidden" }, 403);
  }

  let body: any = {};
  try { body = req.method === "GET" ? {} : await req.json(); } catch { /* noop */ }
  correlationId=marketCorrelationId(req.headers, body);
  cors['x-correlation-id']=correlationId;
  const action = (body.action ?? new URL(req.url).searchParams.get("action") ?? "list") as string;
  logMarketEvent('info',{function:'market-updates-source-admin',stage:'request',correlation_id:correlationId,status:'started',action});

  try {
    if (action === "list") {
      const { data, error } = await sb
        .from("market_sources")
        .select("*")
        .order("registry_status")
        .order("enabled", { ascending: false })
        .order("name");
      if (error) throw error;
      const { data: reconciliation, error: reconciliationError } = await sb
        .from("market_source_reconciliation_audits")
        .select("*")
        .eq("reconciliation_key", "approved-australian-registry-v2")
        .maybeSingle();
      if (reconciliationError) throw reconciliationError;
      const canonical = (data ?? []).filter((s: any) => s.registry_status === "canonical");
      const legacy = (data ?? []).filter((s: any) => s.registry_status !== "canonical");
      const now = Date.now();
      const alerts = canonical
        .filter((s: any) => s.enabled)
        .map((s: any) => {
          const staleHours = s.last_success_at
            ? (now - new Date(s.last_success_at).getTime()) / 3_600_000
            : Infinity;
          const cadenceMinutes = Math.max(15, Number(s.refresh_frequency_minutes ?? 60));
          const overdue = staleHours * 60 > Math.max(180, cadenceMinutes * 3);
          if (s.last_error) {
            return { source_id: s.id, name: s.name, severity: "error", message: s.last_error };
          }
          if (overdue && Number.isFinite(staleHours)) {
            return {
              source_id: s.id, name: s.name, severity: "warning",
              message: `No successful fetch for ${Math.round(staleHours)}h (target ${cadenceMinutes} minutes).`,
            };
          }
          if (!Number.isFinite(staleHours)) {
            return { source_id: s.id, name: s.name, severity: "info", message: "Never fetched." };
          }
          return null;
        })
        .filter(Boolean);
      return json({
        sources: canonical.map((s: any) => ({ ...s, next_eligible_fetch_at: s.last_fetched_at ? new Date(new Date(s.last_fetched_at).getTime() + Math.max(15, Number(s.refresh_frequency_minutes ?? 60)) * 60_000).toISOString() : new Date().toISOString() })),
        legacy_sources: legacy,
        alerts,
        registry: {
          canonical: canonical.length,
          enabledCanonical: canonical.filter((s: any) => s.enabled).length,
          disabledCanonical: canonical.filter((s: any) => !s.enabled).length,
          archivedLegacy: legacy.filter((s: any) => s.registry_status === "archived_legacy").length,
          unresolvedLegacy: legacy.filter((s: any) => s.registry_status === "unresolved_legacy").length,
          totalRecords: (data ?? []).length,
          matchedLegacy: reconciliation?.matched_legacy_rows ?? 0,
          mergedRows: reconciliation?.merged_rows ?? 0,
          updateReferencesReassigned: reconciliation?.update_references_reassigned ?? 0,
          fetchRunReferencesReassigned: reconciliation?.fetch_run_references_reassigned ?? 0,
          reconciledAt: reconciliation?.completed_at ?? null,
        },
      });
    }

    if (action === "toggle") {
      const id = body.source_id as string;
      const enabled = Boolean(body.enabled);
      if (!id) return json({ error: "source_id required" }, 400);
      const { data, error } = await sb
        .from("market_sources")
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("registry_status", "canonical")
        .select()
        .single();
      if (error) throw error;
      return json({ source: data });
    }

    if (action === "update") {
      const id = body.source_id as string;
      if (!id) return json({ error: "source_id required" }, 400);
      if (body.refresh_frequency_hours !== undefined) return json({ error: "refresh_frequency_hours is deprecated; use refresh_frequency_minutes" }, 400);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.refresh_frequency_minutes !== undefined) {
        if (typeof body.refresh_frequency_minutes !== "number" || !Number.isFinite(body.refresh_frequency_minutes) || body.refresh_frequency_minutes < 15 || body.refresh_frequency_minutes > 10080) {
          return json({ error: "refresh_frequency_minutes must be between 15 and 10080" }, 400);
        }
        patch.refresh_frequency_minutes = Math.round(body.refresh_frequency_minutes);
      }
      if (typeof body.reliability_tier === "string") patch.reliability_tier = body.reliability_tier;
      if (typeof body.description === "string") patch.description = body.description;
      const { data, error } = await sb
        .from("market_sources")
        .update(patch)
        .eq("id", id)
        .eq("registry_status", "canonical")
        .select()
        .single();
      if (error) throw error;
      return json({ source: data });
    }

    if (action === "clear_error") {
      const id = body.source_id as string;
      if (!id) return json({ error: "source_id required" }, 400);
      const { data, error } = await sb
        .from("market_sources")
        .update({ last_error: null, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("registry_status", "canonical")
        .select()
        .single();
      if (error) throw error;
      return json({ source: data });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e: any) {
    const errorClass=classifyMarketError(e);
    logMarketEvent('error',{function:'market-updates-source-admin',stage:'database',correlation_id:correlationId,status:'failed',error_class:errorClass});
    return json({ error:'Market source administration could not complete the operation.', code:errorClass, stage:'database', correlation_id:correlationId, retryable:true }, 500);
  }
});
