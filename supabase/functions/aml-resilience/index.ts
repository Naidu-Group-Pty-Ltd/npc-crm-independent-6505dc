/**
 * Phase 13 — AML Resilience.
 *
 * Log and browse resilience drills (backup/restore, provider-outage, secret-rotation,
 * tabletop). Also serves the runbook markdown catalog inline.
 *
 * POST { op, ...args }
 *   op: 'list'         { kind?, limit? }   -> { drills }
 *   op: 'log'          { kind, title, status, scope, findings, action_items, next_review_at, executed_at? } -> { id }
 *   op: 'update'       { id, ...fields }   -> { ok }
 *   op: 'runbooks'                         -> { runbooks: [{ id, title, body_md }] }
 */
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
const jr = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RUNBOOKS = [
  {
    id: "backup_restore",
    title: "Backup & Restore Drill",
    body_md: `## Backup & Restore Drill

**Cadence:** Quarterly (min). Owner: MLRO.

1. Confirm nightly logical + PITR backups healthy in Supabase Dashboard.
2. Restore latest snapshot into a scratch project.
3. Run \`aml-release-gate\` against the restored project — required: all \`table:*\` checks pass and \`retention_schedules_seeded\` = pass.
4. Sample-verify: pull 3 random cases, 3 random reports, 3 random audit events; confirm hash chain continuity.
5. Log the drill via **Governance → Resilience → Log drill** with the RTO/RPO observed.
6. File action items for any drift; re-run within 30 days if any check failed.`,
  },
  {
    id: "provider_outage",
    title: "Provider Outage Runbook",
    body_md: `## Provider Outage Runbook

**Trigger:** \`provider_health_24h\` warn, provider webhook > 30 min silent, or vendor status page red.

1. Flip the affected provider row in **AML Configuration → Providers** to \`degraded\` and lower its priority.
2. Notify MLRO + Ops via existing on-call channel.
3. Queue impacted verifications / screenings to fallback provider (auto if priority > 0 alt exists).
4. Any cases blocked > 4h → open EDD note explaining the delay to satisfy audit trail.
5. On vendor all-clear, run **Governance → Release Gate → Run** and verify \`provider_health_24h\` = pass before flipping back to primary.
6. Log a drill entry (kind = \`provider_outage\`) with timeline and impacted case count.`,
  },
  {
    id: "secret_rotation",
    title: "Secret Rotation Runbook",
    body_md: `## Secret Rotation Runbook

**Cadence:** Every 90 days per credential, or immediately on suspected compromise.

Rotate in this order to avoid downtime:

1. Provision new key at the vendor console; keep old key active.
2. \`update_secret\` in Lovable Cloud with the new value.
3. Re-deploy dependent AML edge functions (\`aml-verification\`, \`aml-monitoring\`, \`aml-reporting\`, \`aml-provider-webhook\`) — the deploy grid handles this automatically on save.
4. Trigger a smoke check via **AML Configuration → Providers → Test connection**.
5. Revoke the old key at the vendor console.
6. Log a drill entry (kind = \`secret_rotation\`) naming the secret and rotation window.`,
  },
  {
    id: "tabletop_smr",
    title: "SMR Tabletop Exercise",
    body_md: `## SMR Tabletop Exercise

**Cadence:** Semi-annual.

Scenario: analyst flags a suspicious pattern late Friday afternoon.

- Analyst raises alert → EDD case → SMR draft, all inside Investigations tab.
- MLRO reviews, signs off, and lodges via **AUSTRAC Reporting**.
- Verify tipping-off suppression rules block any outbound client comms containing SMR terms.
- Confirm every step landed in \`records_audit_events\` with an unbroken hash chain.
- Time the flow; file action items for any manual step > 5 min.`,
  },
];

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);
    const aml = admin.schema("aml" as any);

    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;
    const userLabel = auth.username ?? null;

    const { data: hasAml } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasAml) return jr({ error: "No AML role" }, 403);
    const { data: isMlro } = await admin.rpc("has_aml_role", { _user_id: userId, _role: "mlro" });

    const op = body?.op as string;

    switch (op) {
      case "runbooks":
        return jr({ runbooks: RUNBOOKS });

      case "list": {
        const limit = Math.min(Number(body.limit ?? 50), 200);
        let q = aml.from("resilience_drills").select("*")
          .order("executed_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false }).limit(limit);
        if (body.kind) q = q.eq("kind", body.kind);
        const { data, error } = await q;
        if (error) return jr({ error: error.message }, 500);
        return jr({ drills: data ?? [] });
      }

      case "log": {
        if (!isMlro) return jr({ error: "Only MLRO can log drills" }, 403);
        const kind = String(body.kind ?? "");
        const title = String(body.title ?? "").trim();
        if (!kind || !title) return jr({ error: "kind and title required" }, 400);
        const { data, error } = await aml.from("resilience_drills").insert({
          kind, title,
          status: body.status ?? "completed",
          scheduled_for: body.scheduled_for ?? null,
          executed_at: body.executed_at ?? new Date().toISOString(),
          executed_by: userId, executed_by_label: userLabel,
          scope: body.scope ?? null,
          findings: body.findings ?? null,
          action_items: body.action_items ?? [],
          next_review_at: body.next_review_at ?? null,
        }).select("id").single();
        if (error) return jr({ error: error.message }, 500);
        return jr({ id: data.id });
      }

      case "update": {
        if (!isMlro) return jr({ error: "Only MLRO can update drills" }, 403);
        const id = String(body.id ?? "");
        if (!id) return jr({ error: "Missing id" }, 400);
        const patch: Record<string, unknown> = {};
        for (const k of ["title","status","scope","findings","action_items","next_review_at","executed_at"]) {
          if (k in body) patch[k] = (body as any)[k];
        }
        const { error } = await aml.from("resilience_drills").update(patch).eq("id", id);
        if (error) return jr({ error: error.message }, 500);
        return jr({ ok: true });
      }

      default:
        return jr({ error: "Unknown op" }, 400);
    }
  } catch (e) {
    return jr({ ...internalError(e, 'aml-resilience') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
