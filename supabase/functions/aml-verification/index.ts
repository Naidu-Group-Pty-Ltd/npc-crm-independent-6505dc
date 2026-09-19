/**
 * Phase 4 — AML Identity Verification & Screening edge function.
 *
 * Ops:
 *   IDV:       initiate_idv, get_idv, list_idv, cancel_idv
 *   Screening: run_screening, list_screening, get_screening,
 *              list_matches, resolve_match
 *
 * Every paid provider call is wrapped in Mission Control reserve → commit
 * (or cancel on failure). Reads require any AML role; writes require
 * analyst / reviewer / MLRO. Auditor is read-only.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { recordActivity } from "../_shared/activityAudit.ts";
import { verifyAuth } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  getIdvProvider,
  idvAdapterReadiness,
  isStandaloneIdvProvider,
  standaloneIdvReadiness,
  getScreeningProvider,
  resolveTenantProvider,
  runWithMetrics,
  currentEnvironment,
  checkSelfHostedIdvHealth,
  ProviderResolutionError,
  type ScreeningScope,
} from "../_shared/aml/providers/index.ts";
import { stripImagePayloads } from "../_shared/aml/verificationEvidence.pure.ts";
import { canonicalOutcome } from "../_shared/aml/verificationOutcome.pure.ts";
import { DEFAULT_AML_TENANT, tenantForCase } from "../_shared/aml/caseTenant.ts";
import {
  assessListRecency, decideProviderPromotion, decideSanctionsIngest,
  rowsToDfatEntries, withNormalisedNames,
} from "../_shared/aml/sanctionsIngest.pure.ts";

/*
 * The tenant resolution lives in `_shared/aml/caseTenant.ts` now.
 *
 * This function still issued the failing query on every call — selecting
 * `cases.tenant_id`, getting 42703, and falling through the `||` to the
 * default. It worked only because it degraded; the same select twelve lines
 * away in `hasCaseAccess` denied every caller instead, and the same select
 * in eleven other handlers reported "Case not found" about cases that exist.
 * A query that always fails is not a fallback, it is a fault with a cushion.
 */
const DEFAULT_TENANT = DEFAULT_AML_TENANT;
async function resolveTenantId(_admin: unknown, caseId: string): Promise<string> {
  return tenantForCase(caseId);
}

async function hasCaseAccess(
  admin: any,
  userId: string,
  caseId: string,
  requireWriteRole = false,
): Promise<boolean> {
  // `aml.cases` has no `tenant_id` column — no migration ever added one. This
  // used to `.select("tenant_id")` and `return false` on the resulting
  // PostgREST error, so it denied EVERY caller on EVERY case. That made the
  // documentary route — the primary evidence path when no electronic provider
  // is configured — permanently 403 behind an enabled "Record sighting"
  // button. Found by running the real case workspace against production.
  //
  // The case still resolves its tenant exactly as `resolveTenantId` above
  // does: the recorded value when one exists, otherwise the default tenant.
  // Authorisation itself is unchanged — the tenant-scoped AML role RPCs below
  // remain the only thing that can grant access.
  const tenantId = await resolveTenantId(admin, caseId);
  if (!tenantId) return false;

  const aml = admin.schema("aml");
  if (!requireWriteRole) {
    const { data, error } = await aml.rpc("has_any_tenant_aml_role", {
      _user_id: userId,
      _tenant_id: tenantId,
    });
    return !error && data === true;
  }

  for (const role of ["analyst", "reviewer", "mlro"]) {
    const { data, error } = await aml.rpc("has_tenant_aml_role", {
      _user_id: userId,
      _tenant_id: tenantId,
      _role: role,
    });
    if (!error && data === true) return true;
  }
  return false;
}
import { reserveTokens, commitTokens, cancelTokens } from "../_shared/missionControl.ts";
import {
  VERIFICATION_ATTEMPT_TOKENS, VERIFICATION_METERING_KIND,
  describeVerificationCharge, verificationReserveTokens, verificationTokenCharge,
} from "../_shared/aml/verificationTokenPrice.pure.ts";
import { getCreditCostForKind } from "../_shared/missionControlCatalog.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { probeStandaloneRoute } from '../_shared/aml/providers/diditStandaloneClient.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Owner decision of 2026-07-28: one attempt plus two retries. */
const MAX_VERIFICATION_ATTEMPTS = 3;

/**
 * Attempts this party has actually spent.
 *
 * Never `attempt_number`: that is a capture sequence, and reading it here is
 * what let three unusable captures exhaust a client who had used none.
 */
async function consumedAttempts(
  admin: any, caseId: string, partyId: string | null,
): Promise<number> {
  let q = admin.schema("aml").from("verification_checks")
    .select("id")
    .eq("case_id", caseId)
    .eq("check_type", "electronic_idv")
    .eq("attempt_consumed", true);
  q = partyId ? q.eq("party_id", partyId) : q.is("party_id", null);
  const { data, error } = await q;
  if (error) return 0; // pre-migration: no escalation rather than a wrong one
  return (data ?? []).length;
}

/**
 * What one identity verification costs a workspace, in tokens.
 *
 * Resolved from Mission Control's cost index, never written here. It used to
 * be `400` — against a `tokenEstimator` price list saying 4 — and the
 * standalone path that actually runs in production reserved nothing at all,
 * so the two live verification routes disagreed by two orders of magnitude
 * and one of them charged nobody. The rule is stated once, in
 * `_shared/aml/verificationTokenPrice.pure.ts`: the index carries the ATTEMPT
 * price and a verified identity costs it twice.
 */
async function idvAttemptTokens(): Promise<number> {
  return (await getCreditCostForKind(VERIFICATION_METERING_KIND))
    ?? VERIFICATION_ATTEMPT_TOKENS;
}
const SCREENING_ESTIMATED_TOKENS = 250;

const jr = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function appendCaseEvent(admin: any, caseId: string, category: string, summary: string, payload: any, actorId: string | null, actorLabel: string | null) {
  const { data: prev } = await admin.schema("aml").from("case_events")
    .select("row_hash").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({ case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, created_at: now }));
  await admin.schema("aml").from("case_events").insert({
    case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;
    const userEmail = auth.username ?? null;

    const { data: hasAny } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasAny) return jr({ error: "AML role required" }, 403);

    const { data: roleRows } = await admin.schema("aml").from("role_assignments")
      .select("role").eq("user_id", userId).is("revoked_at", null);
    const roles = new Set<string>((roleRows ?? []).map((r: any) => r.role));
    const canWrite = roles.has("analyst") || roles.has("reviewer") || roles.has("mlro");

    const op = String(body?.op ?? "");
    if (!op) return jr({ error: "op required" }, 400);

    switch (op) {
      // ---------------- IDV ----------------
      case "initiate_idv": {
        if (!canWrite) return jr({ error: "Write role required" }, 403);
        const caseId = String(body.case_id ?? "");
        if (!caseId) return jr({ error: "case_id required" }, 400);

        const { data: caseRow } = await admin.schema("aml").from("cases")
          .select("id, subject_display_name").eq("id", caseId).maybeSingle();
        if (!caseRow) return jr({ error: "Case not found" }, 404);

        const method: "document_and_liveness" | "document_only" | "database_lookup" | "manual" =
          ["document_and_liveness", "document_only", "database_lookup", "manual"].includes(body.method)
            ? body.method : "document_and_liveness";
        const tenantId = await resolveTenantId(admin, caseId);
        const resolved = await resolveTenantProvider(admin, tenantId, "idv");
        // Provider resolution happens BEFORE anything is written: a refusal
        // (production simulator block, missing configuration) must never
        // create an identity_checks row, consume an attempt, or read as a
        // customer failure. It is an operator condition, answered as 409.
        let provider;
        try {
          // No caller-supplied hint. `providers/index.ts` states the rule —
          // "Providers MUST NEVER be selected client-side" — and this was the
          // one place a request body could still influence the choice.
          provider = getIdvProvider({ resolved, admin });
        } catch (resolutionErr: any) {
          if (resolutionErr instanceof ProviderResolutionError) {
            return jr({
              error: resolutionErr.message.replace(/^\[aml\/providers\]\s*/, ""),
              code: resolutionErr.code,
              environment: currentEnvironment(),
            }, 409);
          }
          throw resolutionErr;
        }

        const idempotencyKey = `aml-idv-${caseId}-${Date.now()}`;
        // Read once, before the reserve, and used again at the commit: the
        // catalog is cached for minutes and a reprice between the two would
        // settle a charge at a price the reservation was not taken at.
        const attemptTokens = await idvAttemptTokens();
        let reservation: { jobId: string } | null = null;
        try {
          reservation = await reserveTokens({
            kind: VERIFICATION_METERING_KIND,
            estimatedTokens: verificationReserveTokens(attemptTokens),
            idempotencyKey,
            userId,
            requestPayload: { case_id: caseId, method, provider: provider.name },
          });
        } catch (e: any) {
          console.warn("[aml-verification] IDV token reserve failed", e?.message);
        }

        const baseRow = {
          case_id: caseId,
          subject_label: caseRow.subject_display_name,
          provider: provider.name,
          method,
          status: "in_progress",
          requested_by: userId,
          mc_job_id: reservation?.jobId ?? null,
          // The caller's metadata carries the base64 captures the provider
          // needs. They are passed to the provider below but never stored:
          // persisting them here would put a second, unaudited copy of a
          // customer's face in a database row.
          metadata: stripImagePayloads(body.metadata ?? {}),
        };
        // Stamp the evidential standing at creation: a simulator execution is
        // never authoritative. Retry without the columns while a database has
        // not applied 20260830000000_aml_check_execution_mode.
        let { data: inserted, error: insertErr } = await admin.schema("aml").from("identity_checks").insert({
          ...baseRow,
          execution_mode: provider.mode === "simulator" ? "simulation" : "live",
          authoritative: provider.mode !== "simulator",
          environment: currentEnvironment(),
        }).select().single();
        if (insertErr && /execution_mode|authoritative|environment/i.test(insertErr.message ?? "")) {
          ({ data: inserted, error: insertErr } = await admin.schema("aml")
            .from("identity_checks").insert(baseRow).select().single());
        }
        if (insertErr) throw insertErr;

        try {
          const result = await runWithMetrics(admin, {
            tenantId, capability: "idv", providerKey: provider.name,
            costCents: resolved?.costCents ?? 0, configId: resolved?.configId ?? null,
          }, () => provider.runIdv({
            caseId, subjectLabel: caseRow.subject_display_name, method, metadata: body.metadata,
          }));

          const { data: updated } = await admin.schema("aml").from("identity_checks").update({
            status: result.status,
            overall_score: result.overallScore,
            provider_reference: result.providerReference,
            result_payload: stripImagePayloads(result.raw),
            completed_at: new Date().toISOString(),
            mc_tokens_committed: verificationTokenCharge(
              { attemptConsumed: true, outcome: result.status }, attemptTokens,
            ),
          }).eq("id", inserted.id).select().single();

          /* The provider examined the subject, so the attempt is spent
             whatever it concluded — `verified` earns the success charge on
             top, a decline or a referral costs the attempt alone. Reaching
             here at all is what "attempt consumed" means on this route: the
             catch below is every condition in which nothing was examined. */
          const charge = { attemptConsumed: true, outcome: result.status };
          const chargedTokens = verificationTokenCharge(charge, attemptTokens);
          if (reservation) {
            await commitTokens(reservation.jobId, chargedTokens, {
              provider: provider.name, provider_reference: result.providerReference, status: result.status,
              charge: describeVerificationCharge(charge, attemptTokens),
            });
          }

          await appendCaseEvent(admin, caseId, "idv_result",
            `IDV ${result.status} via ${provider.name} (score ${result.overallScore.toFixed(2)})`,
            { identity_check_id: inserted.id, provider_reference: result.providerReference, checks: result.checks },
            userId, userEmail);

          return jr({ identity_check: updated, result });
        } catch (e: any) {
          if (reservation) await cancelTokens(reservation.jobId, "idv_failed");
          // An infrastructure/provider failure is NOT a verification result.
          // The row records that a request never produced an outcome —
          // "failed" is reserved for a provider that actually examined the
          // subject and said no.
          await admin.schema("aml").from("identity_checks").update({
            status: "pending",
            result_payload: {
              error_category: "provider_unavailable",
              error: String(e?.message ?? "provider_failure").slice(0, 300),
              attempt_not_consumed: true,
            },
            completed_at: new Date().toISOString(),
          }).eq("id", inserted.id);
          return jr({
            error: "The verification provider could not be reached. The request was recorded and no result was produced — try again once Integration Health shows the provider is available.",
            code: "provider_unavailable",
          }, 502);
        }
      }

      case "get_idv": {
        const id = String(body.id ?? "");
        if (!id) return jr({ error: "id required" }, 400);
        const { data: check } = await admin.schema("aml").from("identity_checks").select("*").eq("id", id).maybeSingle();
        if (!check) return jr({ error: "not found" }, 404);
        const { data: docs } = await admin.schema("aml").from("identity_documents").select("*").eq("identity_check_id", id);
        return jr({ identity_check: check, documents: docs ?? [] });
      }

      case "list_idv": {
        const caseId = body.case_id ? String(body.case_id) : null;
        let q = admin.schema("aml").from("identity_checks").select("*").order("requested_at", { ascending: false }).limit(Math.min(Number(body.limit ?? 100), 300));
        if (caseId) q = q.eq("case_id", caseId);
        if (body.status) q = q.eq("status", body.status);
        const { data } = await q;
        return jr({ identity_checks: data ?? [] });
      }

      case "cancel_idv": {
        if (!canWrite) return jr({ error: "Write role required" }, 403);
        const id = String(body.id ?? "");
        const { data: check } = await admin.schema("aml").from("identity_checks").select("*").eq("id", id).maybeSingle();
        if (!check) return jr({ error: "not found" }, 404);
        if (check.mc_job_id) await cancelTokens(check.mc_job_id, "analyst_cancelled");
        const { data: updated } = await admin.schema("aml").from("identity_checks")
          .update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", id).select().single();
        return jr({ identity_check: updated });
      }

      // ---------------- Screening ----------------
      case "run_screening": {
        if (!canWrite) return jr({ error: "Write role required" }, 403);
        const caseId = String(body.case_id ?? "");
        if (!caseId) return jr({ error: "case_id required" }, 400);

        const { data: caseRow } = await admin.schema("aml").from("cases")
          .select("id, subject_display_name, subject_type").eq("id", caseId).maybeSingle();
        if (!caseRow) return jr({ error: "Case not found" }, 404);

        const requestedScope: ScreeningScope[] = Array.isArray(body.scope)
          ? body.scope.filter((s: string) => ["pep", "sanctions", "adverse_media", "watchlist"].includes(s))
          : [];
        const tenantId = await resolveTenantId(admin, caseId);
        const capability = requestedScope.length === 1 && requestedScope[0] === "adverse_media"
          ? "adverse_media" : "pep_sanctions";
        const resolved = await resolveTenantProvider(admin, tenantId, capability);
        let provider;
        try {
          // Server-side selection only: tenant + capability + provider_configs
          // + factory. The request body used to be able to steer this with a
          // provider hint — a browser must never choose the authoritative
          // screening provider, so no hint is passed.
          provider = getScreeningProvider({ resolved, admin });
        } catch (resolutionErr: any) {
          if (resolutionErr instanceof ProviderResolutionError) {
            return jr({
              error: resolutionErr.message.replace(/^\[aml\/providers\]\s*/, ""),
              code: resolutionErr.code,
              environment: currentEnvironment(),
            }, 409);
          }
          throw resolutionErr;
        }

        // Default to what the resolved provider actually covers, never to a
        // wish-list. The old default of pep+sanctions+adverse_media recorded
        // checks nobody performed; a caller may still request wider scopes,
        // and the provider then reports them truthfully as not covered.
        const scope: ScreeningScope[] = requestedScope.length
          ? requestedScope
          : provider.supportedScopes;

        const idempotencyKey = `aml-scr-${caseId}-${Date.now()}`;
        let reservation: { jobId: string } | null = null;
        try {
          reservation = await reserveTokens({
            kind: "aml_screening_check",
            estimatedTokens: SCREENING_ESTIMATED_TOKENS,
            idempotencyKey,
            userId,
            requestPayload: { case_id: caseId, scope, provider: provider.name },
          });
        } catch (e: any) {
          console.warn("[aml-verification] screening reserve failed", e?.message);
        }

        const { data: inserted, error: insertErr } = await admin.schema("aml").from("screening_checks").insert({
          case_id: caseId,
          subject_label: caseRow.subject_display_name,
          subject_type: caseRow.subject_type ?? "individual",
          provider: provider.name,
          scope,
          status: "in_progress",
          requested_by: userId,
          mc_job_id: reservation?.jobId ?? null,
          metadata: body.metadata ?? {},
        }).select().single();
        if (insertErr) throw insertErr;

        try {
          const result = await runWithMetrics(admin, {
            tenantId, capability, providerKey: provider.name,
            costCents: resolved?.costCents ?? 0, configId: resolved?.configId ?? null,
          }, () => provider.runScreening({
            caseId, subjectLabel: caseRow.subject_display_name,
            subjectType: caseRow.subject_type ?? "individual", scope, metadata: body.metadata,
          }));

          const { data: updated } = await admin.schema("aml").from("screening_checks").update({
            status: result.status,
            provider_reference: result.providerReference,
            result_summary: result.summary,
            completed_at: new Date().toISOString(),
            mc_tokens_committed: SCREENING_ESTIMATED_TOKENS,
          }).eq("id", inserted.id).select().single();

          if (result.matches.length > 0) {
            await admin.schema("aml").from("screening_matches").insert(
              result.matches.map((m) => ({
                screening_check_id: inserted.id,
                case_id: caseId,
                match_type: m.matchType,
                list_name: m.listName,
                matched_name: m.matchedName,
                score: m.score,
                jurisdiction: m.jurisdiction,
                details: m.details,
              })),
            );
          }

          if (reservation) {
            await commitTokens(reservation.jobId, SCREENING_ESTIMATED_TOKENS, {
              provider: provider.name, status: result.status, matches: result.matches.length,
            });
          }

          if (result.matches.length > 0) {
            await appendCaseEvent(admin, caseId, "pep_sanctions_hit",
              `${result.matches.length} match(es) found via ${provider.name}`,
              { screening_check_id: inserted.id, summary: result.summary },
              userId, userEmail);
          } else {
            await appendCaseEvent(admin, caseId, "system",
              `Screening clear via ${provider.name}`,
              { screening_check_id: inserted.id }, userId, userEmail);
          }

          return jr({ screening_check: updated, result });
        } catch (e: any) {
          if (reservation) await cancelTokens(reservation.jobId, "screening_failed");
          // Same contract as IDV: an unreachable provider is not a screening
          // outcome and never renders as a failure against the subject. Stale
          // or missing list data is the same shape of condition — screening
          // incomplete, never "clear", never "matched".
          const listDataStale = /sanctions_list_unavailable/.test(String(e?.message ?? ""));
          const errorCategory = listDataStale ? "list_data_unavailable" : "provider_unavailable";
          await admin.schema("aml").from("screening_checks").update({
            status: "pending",
            result_summary: {
              error_category: errorCategory,
              error: String(e?.message ?? "provider_failure").slice(0, 300),
            },
            completed_at: new Date().toISOString(),
          }).eq("id", inserted.id);
          return jr({
            error: listDataStale
              ? "The sanctions list data is missing or stale, so screening cannot produce an authoritative result. No result was recorded — re-run once the sanctions refresh has succeeded."
              : "The screening provider could not be reached. No result was produced — try again once Integration Health shows the provider is available.",
            code: errorCategory,
          }, 502);
        }
      }

      case "list_screening": {
        const caseId = body.case_id ? String(body.case_id) : null;
        let q = admin.schema("aml").from("screening_checks").select("*").order("requested_at", { ascending: false }).limit(Math.min(Number(body.limit ?? 100), 300));
        if (caseId) q = q.eq("case_id", caseId);
        if (body.status) q = q.eq("status", body.status);
        const { data } = await q;
        return jr({ screening_checks: data ?? [] });
      }

      case "get_screening": {
        const id = String(body.id ?? "");
        const { data: check } = await admin.schema("aml").from("screening_checks").select("*").eq("id", id).maybeSingle();
        if (!check) return jr({ error: "not found" }, 404);
        const { data: matches } = await admin.schema("aml").from("screening_matches").select("*").eq("screening_check_id", id).order("score", { ascending: false });
        return jr({ screening_check: check, matches: matches ?? [] });
      }

      case "list_matches": {
        let q = admin.schema("aml").from("screening_matches").select("*").order("created_at", { ascending: false }).limit(Math.min(Number(body.limit ?? 200), 500));
        if (body.case_id) q = q.eq("case_id", body.case_id);
        if (body.status) q = q.eq("status", body.status);
        else q = q.eq("status", "open"); // default queue view
        const { data } = await q;
        return jr({ matches: data ?? [] });
      }

      case "resolve_match": {
        if (!canWrite) return jr({ error: "Write role required" }, 403);
        const matchId = String(body.match_id ?? "");
        const disposition = String(body.disposition ?? "");
        const rationale = String(body.rationale ?? "").trim();
        if (!matchId || !["confirmed", "dismissed", "escalated"].includes(disposition) || rationale.length < 3) {
          return jr({ error: "match_id, disposition (confirmed|dismissed|escalated) and rationale required" }, 400);
        }
        const { data: match } = await admin.schema("aml").from("screening_matches").select("*").eq("id", matchId).maybeSingle();
        if (!match) return jr({ error: "match not found" }, 404);

        const { data: prev } = await admin.schema("aml").from("match_resolutions")
          .select("row_hash").eq("match_id", matchId).order("created_at", { ascending: false }).limit(1).maybeSingle();
        const prevHash = prev?.row_hash ?? null;
        const now = new Date().toISOString();
        const rowHash = await sha256Hex(JSON.stringify({
          match_id: matchId, case_id: match.case_id, disposition, rationale,
          resolved_by: userId, prev_hash: prevHash, created_at: now,
        }));

        const { data: resolution } = await admin.schema("aml").from("match_resolutions").insert({
          match_id: matchId,
          case_id: match.case_id,
          disposition,
          rationale,
          resolved_by: userId,
          resolved_by_label: userEmail,
          prev_hash: prevHash,
          row_hash: rowHash,
          created_at: now,
        }).select().single();

        const nextStatus = disposition === "confirmed" ? "confirmed"
          : disposition === "dismissed" ? "dismissed" : "escalated";
        const { data: updatedMatch } = await admin.schema("aml").from("screening_matches")
          .update({ status: nextStatus }).eq("id", matchId).select().single();

        // Party screening state is a projection of canonical match state:
        // resolving a match here re-derives any party subject that references
        // the same screening check, so the two vocabularies cannot drift.
        const { projectPartyScreeningState } = await import("../_shared/aml/partyScreening.pure.ts");
        const { data: linkedSubjects } = await admin.schema("aml").from("party_screening_subjects")
          .select("id").eq("screening_check_id", match.screening_check_id);
        if ((linkedSubjects ?? []).length > 0) {
          const { data: allMatches } = await admin.schema("aml").from("screening_matches")
            .select("status").eq("screening_check_id", match.screening_check_id);
          const projected = projectPartyScreeningState(
            (allMatches ?? []).map((m: any) => m.status));
          for (const subject of linkedSubjects ?? []) {
            await admin.schema("aml").from("party_screening_subjects").update({
              state: projected,
              adjudicated_by: userId,
              adjudicated_at: now,
              adjudication_note: rationale,
              updated_at: now,
            }).eq("id", subject.id);
          }
        }

        await appendCaseEvent(admin, match.case_id, "mlro_decision",
          `Match ${match.matched_name} ${disposition} (${match.list_name ?? match.match_type})`,
          { match_id: matchId, disposition, rationale, resolution_id: resolution?.id },
          userId, userEmail);

        return jr({ resolution, match: updatedMatch });
      }

      // ---------------- self-hosted verification (zero-cost stack) ----------
      //
      // docs/aml/kyc-zero-cost-solution.md. The portal captures; these ops
      // adjudicate. Nothing here moves the service gate — that stays an
      // explicit, reasoned human decision in aml-risk.

      case "list_verification_checks": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        if (!await hasCaseAccess(admin, userId, String(body.case_id))) {
          return jr({ error: "Tenant AML role required" }, 403);
        }
        const { data, error } = await admin.schema("aml").from("verification_checks")
          .select("*").eq("case_id", body.case_id)
          .order("requested_at", { ascending: false });
        if (error) throw error;
        // Never ship the storage path to the browser: a biometric is fetched
        // only through `get_biometric_url`, which writes the access log.
        const checks = (data ?? []).map((c: any) => {
          const { biometric_storage_path, ...safe } = c;
          return { ...safe, has_biometric: Boolean(biometric_storage_path) };
        });
        return jr({ checks, max_attempts: MAX_VERIFICATION_ATTEMPTS });
      }

      case "run_verification": {
        // Adjudicate a pending portal submission through the self-hosted
        // service. Staff-triggered so that a customer cannot spend compute,
        // and so the result is attributable.
        if (!canWrite) return jr({ error: "Analyst, reviewer or MLRO role required" }, 403);
        const checkId = String(body.check_id ?? "");
        if (!checkId) return jr({ error: "check_id required" }, 400);

        const { data: check } = await admin.schema("aml").from("verification_checks")
          .select("*").eq("id", checkId).maybeSingle();
        if (!check) return jr({ error: "Not found" }, 404);
        if (!await hasCaseAccess(admin, userId, check.case_id, true)) {
          return jr({ error: "Tenant write role required" }, 403);
        }
        if (!["pending", "in_progress"].includes(check.status)) {
          return jr({ error: `Check is already ${check.status}`, code: "not_pending" }, 409);
        }

        const tenantId = await resolveTenantId(admin, check.case_id);
        const resolved = await resolveTenantProvider(admin, tenantId, "idv");
        const provider = getIdvProvider({ resolved, preferred: "selfhosted", admin });

        const download = async (bucket: string, path: string) => {
          const { data, error } = await admin.storage.from(bucket).download(path);
          if (error) throw new Error(`could not read ${bucket}/${path}: ${error.message}`);
          const buf = new Uint8Array(await data.arrayBuffer());
          let binary = "";
          for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
          return btoa(binary);
        };

        await admin.schema("aml").from("verification_checks")
          .update({ status: "in_progress", updated_at: new Date().toISOString() })
          .eq("id", checkId);

        let result;
        try {
          const [documentB64, selfieB64] = await Promise.all([
            check.document_reference ? download("aml-documents", check.document_reference) : Promise.resolve(""),
            check.biometric_storage_path ? download("aml-biometrics", check.biometric_storage_path) : Promise.resolve(""),
          ]);
          result = await runWithMetrics(admin, {
            tenantId, capability: "idv",
            providerKey: resolved?.providerKey ?? "selfhosted",
            costCents: resolved?.costCents ?? 0, configId: resolved?.configId ?? null,
          }, () => provider.runIdv({
            caseId: check.case_id,
            subjectLabel: check.party_label,
            method: "document_and_liveness",
            metadata: { document_image_b64: documentB64, selfie_image_b64: selfieB64 },
          }));
        } catch (e: any) {
          // A service failure is OUR failure. Return the attempt to pending so
          // it does not consume one of the customer's three.
          await admin.schema("aml").from("verification_checks").update({
            status: "pending",
            failure_reason: `service_error: ${String(e?.message ?? e).slice(0, 300)}`,
            updated_at: new Date().toISOString(),
          }).eq("id", checkId);
          // The adapter already redacts its host and token, but the message is
          // still internal diagnostics; it belongs in failure_reason, not in a
          // response body.
          return jr({
            error: "The verification service could not be reached. Nothing was recorded against the customer — try again once Integration Health shows the service is available.",
            code: "service_unavailable",
          }, 503);
        }

        // Exactly the rules the outbox worker applies. This path used to have
        // its own: it read `attempt_number` (a capture sequence) to decide
        // `exhausted`, never set `attempt_consumed` — so an outcome it
        // recorded was invisible to the portal's accounting — and never set
        // `processing_status`, leaving a finished check looking in-flight and
        // blocking the client from submitting again.
        const outcome = canonicalOutcome(result, {
          attemptsConsumed: await consumedAttempts(admin, check.case_id, check.party_id ?? null),
          maxAttempts: MAX_VERIFICATION_ATTEMPTS,
        });
        const unusable = outcome.processingStatus === "capture_unusable";

        const { data: updated, error: upErr } = await admin.schema("aml")
          .from("verification_checks").update({
            // null leaves the identity status untouched: an unusable capture
            // is not a result, and the attempt stays open for a retake.
            ...(outcome.status ? { status: outcome.status } : {}),
            processing_status: outcome.processingStatus,
            provider_error_category: outcome.providerErrorCategory,
            attempt_consumed: outcome.attemptConsumed,
            provider: result.provider,
            provider_reference: result.providerReference,
            outcome_detail: stripImagePayloads({
              ...(check.outcome_detail ?? {}),
              checks: result.checks,
              overall_score: result.overallScore,
              raw: result.raw,
              adjudicated_by: userId,
            }),
            failure_reason: outcome.status === "failed"
              ? result.checks.filter((c: any) => c.status === "fail").map((c: any) => c.name).join(", ")
              : null,
            completed_at: ["passed", "failed", "exhausted"].includes(String(outcome.status))
              ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          }).eq("id", checkId).select("*").single();
        if (upErr) throw upErr;

        // The timeline records consumed attempts, so it agrees with what the
        // client is told. An unusable capture is named as such rather than
        // reported as an identity outcome.
        // Read after the update, so it already includes this one if consumed.
        const consumedNow = await consumedAttempts(admin, check.case_id, check.party_id ?? null);
        await appendCaseEvent(admin, check.case_id, "idv_result",
          unusable
            ? `Identity verification for ${check.party_label}: capture unusable — no attempt consumed (${consumedNow} of ${MAX_VERIFICATION_ATTEMPTS} used)`
            : `Identity verification for ${check.party_label}: ${outcome.status} (attempt ${consumedNow} of ${MAX_VERIFICATION_ATTEMPTS})`,
          {
            verification_check_id: checkId,
            status: outcome.status ?? "pending",
            processing_status: outcome.processingStatus,
            attempt_consumed: outcome.attemptConsumed,
            provider: result.provider, provider_reference: result.providerReference,
            checks: result.checks,
            limitations: (result.raw as any)?.limitations ?? [],
          }, userId, userEmail);

        const { biometric_storage_path: _bp, ...safe } = updated as any;
        return jr({ check: { ...safe, has_biometric: Boolean(_bp) } });
      }

      case "record_document_sighting": {
        // The documentary path — under the zero-cost design this is the
        // primary evidence, not a fallback for edge cases.
        if (!canWrite) return jr({ error: "Analyst, reviewer or MLRO role required" }, 403);
        const caseId = String(body.case_id ?? "");
        const partyLabel = String(body.party_label ?? "").trim();
        const documentType = String(body.document_type ?? "").trim();
        const sightingKind = String(body.sighting_kind ?? "");
        const notes = String(body.notes ?? "").trim();

        if (!caseId || !partyLabel) return jr({ error: "case_id and party_label are required" }, 400);
        if (!documentType) return jr({ error: "document_type is required" }, 400);
        if (!["original", "certified_copy"].includes(sightingKind)) {
          return jr({ error: 'sighting_kind must be "original" or "certified_copy"' }, 400);
        }
        // A certified copy is only evidence if we recorded who certified it.
        const certifierName = String(body.certifier_name ?? "").trim();
        const certifierCapacity = String(body.certifier_capacity ?? "").trim();
        if (sightingKind === "certified_copy" && (!certifierName || !certifierCapacity)) {
          return jr({
            error: "certifier_name and certifier_capacity are required for a certified copy",
          }, 400);
        }
        if (notes.length < 10) {
          return jr({ error: "notes must be at least 10 characters" }, 400);
        }
        if (!await hasCaseAccess(admin, userId, caseId, true)) {
          return jr({ error: "Tenant write role required" }, 403);
        }

        const { data: created, error } = await admin.schema("aml")
          .from("verification_checks").insert({
            case_id: caseId,
            party_id: body.party_id ?? null,
            party_label: partyLabel.slice(0, 200),
            check_type: "document_sighting",
            attempt_number: 1,
            status: "passed",
            provider: "manual",
            verified_by: userId,
            verified_by_type: "staff",
            outcome_detail: {
              document_type: documentType,
              sighting_kind: sightingKind,
              certifier_name: certifierName || null,
              certifier_capacity: certifierCapacity || null,
              notes,
              sighted_by_email: userEmail,
            },
            completed_at: new Date().toISOString(),
          }).select("*").single();
        if (error) {
          if (error.code === "23505") {
            return jr({ error: "A document sighting is already recorded for this party" }, 409);
          }
          throw error;
        }

        await appendCaseEvent(admin, caseId, "idv_result",
          `Document sighting recorded for ${partyLabel} (${sightingKind.replace("_", " ")}, ${documentType})`,
          {
            verification_check_id: created.id, sighting_kind: sightingKind,
            document_type: documentType, certifier_name: certifierName || null,
          }, userId, userEmail);

        return jr({ check: created });
      }

      case "get_biometric_url": {
        // Every read of a retained biometric is logged. That log is the
        // APP 11 answer to "who looked at this, and why".
        if (!canWrite) return jr({ error: "Analyst, reviewer or MLRO role required" }, 403);
        const checkId = String(body.check_id ?? "");
        const reason = String(body.reason ?? "").trim();
        if (!checkId) return jr({ error: "check_id required" }, 400);
        if (reason.length < 10) {
          return jr({ error: "A reason of at least 10 characters is required to view a biometric" }, 400);
        }

        const { data: check } = await admin.schema("aml").from("verification_checks")
          .select("id, case_id, biometric_storage_path, party_label").eq("id", checkId).maybeSingle();
        if (!check) return jr({ error: "No biometric on this check" }, 404);
        if (!await hasCaseAccess(admin, userId, check.case_id, true)) {
          return jr({ error: "Tenant write role required" }, 403);
        }
        if (!check.biometric_storage_path) return jr({ error: "No biometric on this check" }, 404);

        const { data: signed, error } = await admin.storage.from("aml-biometrics")
          .createSignedUrl(check.biometric_storage_path, 120);
        if (error) throw error;

        await admin.schema("aml").from("biometric_access_log").insert({
          verification_check_id: checkId,
          case_id: check.case_id,
          actor_id: userId,
          actor_label: userEmail,
          action: "view",
          reason,
          ip_address: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        });

        await appendCaseEvent(admin, check.case_id, "system",
          `Biometric image viewed for ${check.party_label}`,
          { verification_check_id: checkId, reason }, userId, userEmail);

        // Short expiry on purpose: a long-lived URL is an unlogged copy.
        return jr({ url: signed.signedUrl, expires_in_seconds: 120 });
      }

      case "list_biometric_access": {
        if (!body.case_id) return jr({ error: "case_id required" }, 400);
        if (!await hasCaseAccess(admin, userId, String(body.case_id))) {
          return jr({ error: "Tenant AML role required" }, 403);
        }
        const { data, error } = await admin.schema("aml").from("biometric_access_log")
          .select("*").eq("case_id", body.case_id)
          .order("created_at", { ascending: false }).limit(200);
        if (error) throw error;
        return jr({ access_log: data ?? [] });
      }

      /**
       * Load a sanctions list from a spreadsheet a person downloaded.
       *
       * `aml.sanctions_entries` has been empty since this platform was built,
       * so every screening attempt fails closed. The only loader was a Node
       * script needing the production service-role key on somebody's laptop
       * and a successful download from dfat.gov.au — and DFAT answers HTTP
       * 403 to a scripted request. A person with a browser is blocked by
       * neither, so the browser gets the cells out of the workbook and the
       * mapping and normalisation happen HERE.
       *
       * Normalisation is deliberately server-side: names are indexed with the
       * same function the screening query uses, and a browser that normalised
       * differently would write entries no query can ever match. A sanctions
       * list that silently matches nobody looks exactly like one that works.
       *
       * MLRO only. Loading the register is a compliance act, not an import.
       */
      case "ingest_sanctions_list": {
        if (!roles.has("mlro")) {
          return jr({ error: "MLRO role required to load a sanctions list" }, 403);
        }
        const listCode = String(body?.list_code ?? "dfat").trim().toLowerCase();
        if (listCode !== "dfat") {
          return jr({ error: "Only the DFAT Consolidated List can be loaded this way" }, 400);
        }
        const rows = Array.isArray(body?.rows) ? body.rows as unknown[][] : null;
        if (!rows || rows.length === 0) {
          return jr({ error: "rows required — the spreadsheet produced no cells" }, 400);
        }
        const sourceLabel = String(body?.source_label ?? "operator upload").slice(0, 300);

        let entries: ReturnType<typeof rowsToDfatEntries>;
        try {
          entries = rowsToDfatEntries(rows);
        } catch (e) {
          // A refusal to guess at columns, surfaced as itself. A misread
          // column is a list that matches the wrong people.
          return jr({
            error: e instanceof Error ? e.message : "The spreadsheet could not be mapped",
            code: "unmappable_spreadsheet",
          }, 400);
        }

        /*
         * How current the DATA is, before anything is written.
         *
         * Every other freshness control here measures when we SYNCED — the
         * sync row, the 72-hour provider gate, the 7-day health banner. All
         * of them would report a four-year-old file uploaded today as
         * perfectly fresh, because the load genuinely is.
         *
         * That is not hypothetical. DFAT's own canonical URL currently
         * redirects to `regulation8_consolidated_2.xls`, whose newest Control
         * Date is 2022-01-07: 7,840 rows, structurally perfect, and older
         * than the entire Russia/Ukraine listing expansion. Loading it would
         * have turned every gate green and reported every client clear.
         */
        const recency = assessListRecency(rows, Date.now());
        if (recency.stale && body?.force !== true) {
          return jr({
            error: recency.reason,
            code: "stale_list",
            newest_listing: recency.newestListing,
            age_days: recency.ageDays,
          }, 400);
        }

        const { count: existingCount } = await admin.schema("aml").from("sanctions_entries")
          .select("id", { count: "exact", head: true }).eq("list_code", listCode);
        const decision = decideSanctionsIngest(
          entries.length, existingCount ?? 0, body?.force === true);
        if (!decision.accept) {
          return jr({ error: decision.reason, code: "rejected", entries: entries.length }, 400);
        }

        const startedAt = new Date().toISOString();
        const { data: sync, error: syncError } = await admin.schema("aml")
          .from("sanctions_list_syncs")
          .insert({
            list_code: listCode, source_url: sourceLabel,
            entry_count: 0, status: "running", started_at: startedAt,
          }).select("id").single();
        if (syncError) throw syncError;

        const nowIso = new Date().toISOString();
        const payload = entries.map((e) => withNormalisedNames(e, listCode, sync.id, nowIso));
        // Chunked so one oversized statement cannot fail the whole load.
        let written = 0;
        try {
          for (let i = 0; i < payload.length; i += 500) {
            const { error } = await admin.schema("aml").from("sanctions_entries")
              .upsert(payload.slice(i, i + 500), { onConflict: "list_code,external_id" });
            if (error) throw error;
            written += Math.min(500, payload.length - i);
          }
        } catch (e) {
          // A failed load is recorded as failed. A half-written list reported
          // as succeeded is the one outcome that must never happen.
          await admin.schema("aml").from("sanctions_list_syncs").update({
            status: "failed", entry_count: written,
            error_detail: (e instanceof Error ? e.message : String(e)).slice(0, 2000),
            completed_at: new Date().toISOString(),
          }).eq("id", sync.id);
          return jr({ error: "The list could not be written", code: "write_failed" }, 500);
        }

        // Entries that vanished from the source, only when the size is
        // plausible. A halved list keeps its old entries and says so.
        let pruned = 0;
        if (decision.prune) {
          const { count } = await admin.schema("aml").from("sanctions_entries")
            .delete({ count: "exact" })
            .eq("list_code", listCode).neq("sync_id", sync.id);
          pruned = count ?? 0;
        }

        await admin.schema("aml").from("sanctions_list_syncs").update({
          status: "succeeded", entry_count: written,
          completed_at: new Date().toISOString(),
        }).eq("id", sync.id);

        /*
         * The last mile. Loading the list was necessary to screen anybody and
         * it was never sufficient: production refuses to run a provider left
         * in `simulator` mode, so Stage 5 would still have refused with
         * nothing on the page to press, and the only way to finish the job
         * was an undocumented UPDATE against `provider_configs`.
         *
         * `decideProviderPromotion` holds the rule — DFAT only, entries
         * actually written, out of simulator only, never reactivating a
         * deactivated provider and never demoting. The freshness gate inside
         * the provider remains the authority on whether a result is
         * authoritative; this only decides whether it is allowed to run.
         */
        let screening: { mode: string; changed: boolean; reason: string } = {
          mode: "unknown", changed: false,
          reason: "The screening provider's state could not be read.",
        };
        const { data: providerRow } = await admin.schema("aml").from("provider_configs")
          .select("id, mode, active").eq("capability", "pep_sanctions")
          .eq("provider_key", "local_lists").order("priority", { ascending: true }).limit(1);
        const current = Array.isArray(providerRow) ? providerRow[0] ?? null : null;
        if (current) {
          const promotion = decideProviderPromotion({
            listCode, entriesWritten: written,
            currentMode: current.mode, active: current.active,
          });
          screening = {
            mode: String(current.mode), changed: false, reason: promotion.reason,
          };
          if (promotion.promote) {
            const { error: promoteError } = await admin.schema("aml").from("provider_configs")
              .update({ mode: "live" }).eq("id", current.id).eq("mode", "simulator");
            if (promoteError) {
              screening.reason = "The list loaded, but screening could not be switched to "
                + "live. An administrator must set the pep_sanctions provider to live "
                + "before any check will run.";
            } else {
              screening = { mode: "live", changed: true, reason: promotion.reason };
              // Recorded against the register rather than a case: this is a
              // change to what the platform may do, not to one customer's file.
              // `aml_provider_config` is not an `activity_entity_type`, so this
              // insert was rejected by the enum on every promotion — and the
              // `.then(() => undefined, () => undefined)` discarded the error,
              // which is how it stayed invisible. `system` is the enum's value
              // for a platform-level change, which is exactly what the comment
              // above describes. A failure is now logged rather than swallowed.
              await recordActivity(admin, {
                action_type: "aml_screening_provider_promoted",
                entity_type: "system",
                entity_name: "AML screening provider",
                entity_id: String(current.id),
                metadata: {
                  capability: "pep_sanctions", provider_key: "local_lists",
                  from_mode: "simulator", to_mode: "live",
                  reason: "dfat_list_loaded",
                  list_code: listCode, entries: written, sync_id: sync.id,
                  performed_by: userEmail, performed_at: new Date().toISOString(),
                },
              });
            }
          }
        }

        return jr({
          list_code: listCode, entries: written, pruned,
          pruned_skipped: !decision.prune, reason: decision.reason, sync_id: sync.id,
          screening,
          // Stated on every load, not only on a refusal: an operator reading
          // "7,840 entries" has no way to tell a current register from an
          // archived one, and the newest listing is the fact that separates
          // them.
          newest_listing: recency.newestListing,
          list_age_days: recency.ageDays,
          recency_unknown: recency.unknown,
        });
      }

      case "sanctions_list_status": {
        const { data, error } = await admin.schema("aml").from("sanctions_list_syncs")
          .select("*").order("started_at", { ascending: false }).limit(20);
        if (error) throw error;
        const { count } = await admin.schema("aml").from("sanctions_entries")
          .select("id", { count: "exact", head: true });
        return jr({ syncs: data ?? [], entry_count: count ?? 0 });
      }

      // Stage 9: authorised technical retry for canonical checks. Retries
      // ONLY technical failures and dead-lettered jobs — an authoritative
      // outcome is final here, and a retry never consumes a customer attempt
      // (the worker's attempt accounting decides that on completion).
      case "retry_verification_processing": {
        if (!canWrite) return jr({ error: "Write role required" }, 403);
        const checkId = String(body.verification_check_id ?? "");
        if (!checkId) return jr({ error: "verification_check_id required" }, 400);
        const { data: check } = await admin.schema("aml").from("verification_checks")
          .select("id, case_id, processing_status, status, superseded_at")
          .eq("id", checkId).maybeSingle();
        if (!check) return jr({ error: "not found" }, 404);
        if (check.superseded_at || check.status !== "pending"
            || !["technical_failure", "dead_lettered"].includes(check.processing_status ?? "")) {
          return jr({
            error: "Only a technically-failed or dead-lettered check can be retried. Authoritative results are final; ask the client for a new capture instead.",
            code: "retry_not_eligible",
          }, 409);
        }
        const { error: requeueErr } = await admin.schema("aml").from("verification_checks")
          .update({ processing_status: "queued", provider_error_category: null })
          .eq("id", checkId).eq("processing_status", check.processing_status);
        if (requeueErr) throw requeueErr;
        await admin.from("integration_outbox").insert({
          aggregate_type: "aml_verification_check", aggregate_id: checkId,
          event_type: "aml.verification.requested", event_version: 1,
          payload: { verification_check_id: checkId, case_id: check.case_id, retry: true },
          idempotency_key: `aml-verify-retry-${checkId}-${Date.now()}`,
        });
        await appendCaseEvent(admin, check.case_id, "system",
          "Verification processing retried by staff (technical failure — no customer attempt consumed)",
          { verification_check_id: checkId }, userId, userEmail);
        return jr({ requeued: true, verification_check_id: checkId });
      }

      // Read-only provider readiness: what would actually run if staff asked
      // for a verification right now, and why. Booleans only for secrets —
      // never values. This is the operator preflight for the IDV workflow.
      case "provider_readiness": {
        const environment = currentEnvironment();
        const tenantId = String(body.tenant_id ?? DEFAULT_TENANT);

        async function capabilityReadiness(capability: "idv" | "pep_sanctions") {
          const resolved = await resolveTenantProvider(admin, tenantId, capability);
          const mode = resolved?.mode ??
            ((Deno.env.get("AML_PROVIDER_MODE") || "").toLowerCase() === "live" ? "live" : "simulator");
          const key = (resolved?.providerKey ?? "simulator").toLowerCase();
          // Wiring and configuration come from the provider registry rather
          // than from a second opinion here. `idvAdapterReadiness` knows about
          // BOTH registries — capture (selfhosted) and hosted-session (didit) —
          // so a correctly configured hosted provider no longer reports as
          // misconfigured on the Command Centre card.
          const idvReadiness = capability === "idv"
            ? idvAdapterReadiness(key, resolved) : null;
          // Secret PRESENCE only, and only the ones the active flow actually
          // needs. Never a value.
          const isStandalone = capability === "idv" && isStandaloneIdvProvider(key);
          const secrets = capability !== "idv" ? {}
            : idvReadiness?.flow === "hosted_session" ? {
              DIDIT_API_KEY: Boolean(Deno.env.get("DIDIT_API_KEY")),
              DIDIT_WEBHOOK_SECRET: Boolean(Deno.env.get("DIDIT_WEBHOOK_SECRET")),
            } : isStandalone ? {
              // The Standalone path needs neither the workflow id nor the
              // webhook secret — there is no workflow, and the synchronous
              // response is the authoritative result. A persisted request does
              // emit status.updated, but NPC ignores those rather than opening
              // a second result path. Reporting these would send an operator
              // hunting for a secret that is correctly absent.
              //
              // The credential half is reported by ROUTE, for the same reason.
              // A tenant deliberately holds no Didit key — one would let it
              // list every other tenant's verifications — and reaches the
              // vendor through Mission Control instead. Reporting
              // `DIDIT_API_KEY: false` on such a deployment names a fault that
              // is not one and hides the two names that would actually be
              // missing if it broke.
              ...(Boolean(Deno.env.get("DIDIT_API_KEY"))
                ? { DIDIT_API_KEY: true }
                : {
                  MISSION_CONTROL_URL: Boolean(Deno.env.get("MISSION_CONTROL_URL")),
                  MISSION_CONTROL_CLONE_API_KEY: Boolean(
                    Deno.env.get("MISSION_CONTROL_CLONE_API_KEY"),
                  ),
                }),
              DIDIT_LIVENESS_THRESHOLD: Boolean(Deno.env.get("DIDIT_LIVENESS_THRESHOLD")),
              DIDIT_FACE_MATCH_THRESHOLD: Boolean(Deno.env.get("DIDIT_FACE_MATCH_THRESHOLD")),
            } : {
              AML_VERIFICATION_SERVICE_URL: Boolean(Deno.env.get("AML_VERIFICATION_SERVICE_URL")),
              AML_VERIFICATION_SERVICE_TOKEN: Boolean(Deno.env.get("AML_VERIFICATION_SERVICE_TOKEN")),
            };
          /**
           * The specific fault, for the person who has to fix it.
           *
           * `secrets_present` answers "is it set", which cannot distinguish a
           * threshold nobody set from one set to `0.6` on a 0-100 scale — the
           * two mistakes an operator is most likely to make here, with opposite
           * fixes. Presence and validity only; no value crosses this boundary,
           * and nothing here is ever sent to the client portal.
           */
          const standaloneReadiness = isStandalone ? standaloneIdvReadiness() : null;
          const wired = capability === "idv" ? Boolean(idvReadiness?.wired) : key === "local_lists";
          const configured = capability === "idv" ? Boolean(idvReadiness?.configured) : true;
          const wantsSimulator = mode === "simulator" || key === "simulator";
          let state: string;
          // Live health of the actual service, not an inference from secrets.
          // Two secrets can point at a dead container; reporting `ready_live`
          // for that is what let staff believe the provider was up while every
          // verification would have failed.
          let serviceHealth: Awaited<ReturnType<typeof checkSelfHostedIdvHealth>> | null = null;

          if (wantsSimulator) {
            state = environment === "production" ? "not_configured" : "simulator_non_production";
          } else if (!wired || !configured) {
            state = "misconfigured";
          } else if (resolved && ["failing", "unhealthy"].includes(String((resolved as any).lastHealthStatus ?? ""))) {
            state = "unavailable";
          } else if (capability === "idv" && key === "selfhosted") {
            serviceHealth = await checkSelfHostedIdvHealth();
            state = serviceHealth.reachable && serviceHealth.status === "ok"
              ? "ready_live"
              : "unavailable";
          } else {
            state = "ready_live";
          }
          const { data: cfg } = resolved?.configId
            ? await admin.schema("aml").from("provider_configs")
              .select("last_health_at, last_health_status, last_health_message")
              .eq("id", resolved.configId).maybeSingle()
            : { data: null };
          return {
            capability,
            configured_provider: resolved?.providerKey ?? null,
            // Which experience the client will get. Lets the Command Centre
            // word its client request correctly instead of assuming capture.
            idv_flow: idvReadiness?.flow ?? null,
            mode,
            adapter_wired: wired,
            secrets_present: secrets,
            // Null for every provider except the Standalone one.
            standalone_readiness: standaloneReadiness,
            last_health: cfg ? {
              at: cfg.last_health_at, status: cfg.last_health_status,
              message: cfg.last_health_message,
            } : null,
            // A probe made just now, so `state` is evidence rather than
            // inference. Carries no URL and no token.
            service_health: serviceHealth,
            state,
          };
        }

        return jr({
          environment,
          simulator_blocked: environment === "production",
          note: "Configuration plus a live /healthz probe of the configured service. `ready_live` means the service answered and both models initialised.",
          idv: await capabilityReadiness("idv"),
          screening: await capabilityReadiness("pep_sanctions"),
        });
      }

      /*
       * Does verification actually WORK from this deployment?
       *
       * Every other readiness reading here answers a question about
       * configuration — key present, provider active, thresholds parseable —
       * and all of them were green on three tenants that had never completed
       * a single verification. On the brokered route four things no local
       * flag can see stand between this function and the vendor: the clone's
       * Mission Control key, its scopes, Mission Control's own Didit
       * credential, and the vendor itself.
       *
       * So this makes one real call and reports what came back. It spends
       * nothing (the request is deliberately incomplete, so the vendor
       * rejects it at validation), is never metered, and writes no record —
       * see `probeStandaloneRoute`.
       *
       * Reviewer-or-MLRO, because it names which credential a failure lies
       * with and because it makes an outbound call; an analyst reads
       * `provider_readiness` instead.
       */
      case "verification_selftest": {
        if (!roles.has("reviewer") && !roles.has("mlro")) {
          return jr({ error: "Reviewer or MLRO role required" }, 403);
        }
        const probe = await probeStandaloneRoute();
        return jr({
          probe,
          // Said plainly, because "the vendor rejected our incomplete
          // request" is the PASS here and reads like a failure otherwise.
          reading: probe.verdict === "reachable"
            ? "Verification can reach the provider on this route."
            : "Verification cannot reach the provider on this route.",
          spent: false,
          note:
            "One deliberately incomplete request. Nothing is billed, no verification " +
            "is created, and no record is written.",
        });
      }

      default:
        return jr({ error: `Unknown op: ${op}` }, 400);
    }
  } catch (e: any) {
    console.error("[aml-verification] error", e);
    return jr({ ...internalError(e, 'aml-verification') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
