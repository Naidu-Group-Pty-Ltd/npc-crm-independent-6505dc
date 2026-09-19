/**
 * Phase 11 — AML Records, Privacy, Retention & Tipping-Off.
 *
 * POST { op, ...args }
 * Auth: any AML role reads; analyst/reviewer/mlro can write privacy requests and legal holds;
 * mlro-only for retention_schedules, tipping_off_rules, and scan approve/execute.
 *
 * Ops:
 *   summary
 *   list_schedules | upsert_schedule
 *   list_holds     | create_hold | release_hold
 *   list_privacy_requests | create_privacy_request | update_privacy_request | export_privacy_bundle
 *   list_tipping_off_rules | upsert_tipping_off_rule | delete_tipping_off_rule | evaluate_tipping_off
 *   list_scans | get_scan | dry_run_scan | request_approval | approve_scan | execute_scan | cancel_scan
 *   record_retention_trigger | sync_case_triggers | sync_partner_triggers (Phase 7, flag-gated)
 *   list_retention_records | list_record_classes
 *   audit_timeline
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
import {
  RETENTION_TRIGGER_KIND_LABELS,
  partnerDependencyBlockers,
} from "../_shared/aml/partnerRetention.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jr = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function audit(admin: any, category: string, summary: string, payload: any, actorId: string | null, actorLabel: string | null) {
  const aml = admin.schema("aml");
  const { data: prev } = await aml.from("records_audit_events")
    .select("row_hash").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({ category, summary, payload, actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, created_at: now }));
  await aml.from("records_audit_events").insert({
    category, summary, payload, actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
}

// Dry-run scan: enumerates candidate records per entity_type based on retention_schedules.
// Kept intentionally conservative — records only enumerated from a small allow-list of
// aml.* tables that we know are safe to dispose of.
const SCAN_SOURCES: Record<string, { table: string; timestampCol: string; refCol?: string; caseIdCol?: string }> = {
  case:         { table: "cases",              timestampCol: "closed_at",   refCol: "reference_code" },
  verification: { table: "identity_checks",    timestampCol: "completed_at", caseIdCol: "case_id" },
  screening:    { table: "screening_matches",  timestampCol: "resolved_at", caseIdCol: "case_id" },
  transaction:  { table: "transactions",       timestampCol: "settled_at",  refCol: "reference_code", caseIdCol: "case_id" },
  report:       { table: "reports",            timestampCol: "acknowledged_at", refCol: "reference_code", caseIdCol: "case_id" },
  alert:        { table: "alerts",             timestampCol: "resolved_at", caseIdCol: "case_id" },
  edd:          { table: "edd_cases",          timestampCol: "closed_at", caseIdCol: "case_id" },
  // The retained facial image, not the verification record that references it.
  // Disposal destroys the object in the aml-biometrics bucket and clears the
  // pointer columns; the check itself is a compliance record and survives on
  // its own clock. See disposeBiometric below.
  biometric:    { table: "verification_checks", timestampCol: "completed_at", caseIdCol: "case_id" },
  // Phase 7 — partner/reliance domain. Only classes whose disposal method is
  // actually executable are enumerated with a source: the three soft-delete
  // classes carry updated_at, and partner notifications are hard-deleted
  // fixed-copy rows. Attestations, grants, manifests and evidence-delivery
  // read models are deliberately NOT here — they are evidence, their scan
  // items dispose as recorded_only, and their rows survive with the case
  // file. Triggers for them exist regardless; the clock is never skipped.
  partner_case_link:          { table: "partner_case_links",          timestampCol: "ended_at",    caseIdCol: "case_id" },
  partner_records_request:    { table: "partner_records_requests",    timestampCol: "reviewed_at", caseIdCol: "case_id" },
  partner_refresh_obligation: { table: "partner_refresh_obligations", timestampCol: "completed_at", caseIdCol: "case_id" },
  partner_notification:       { table: "partner_notifications",       timestampCol: "created_at" },
};

/** Phase 7 feature flag — gates ONLY the partner-domain retention
 * extension (partner trigger kinds/entity types, partner dependency
 * blockers, partner metadata in privacy exports). Tolerates both flag value
 * shapes used in this repo. Existing behaviour is unchanged while off. */
async function flagEnabled(admin: any, key: string): Promise<boolean> {
  const { data } = await admin.from("feature_flags")
    .select("value").eq("key", key).maybeSingle();
  const v = data?.value;
  if (v === true || v === "true") return true;
  if (v && typeof v === "object" && (v as any).enabled === true) return true;
  return false;
}

const PARTNER_ENTITY_TYPES = new Set([
  "partner_case_link", "partner_records_request", "partner_evidence_delivery",
  "partner_refresh_obligation", "partner_notification", "attestation",
  "reliance_grant", "disclosure_manifest", "arrangement_assessment",
  "partner_organisation", "raw_id_document_copy",
]);
const PHASE7_TRIGGER_KINDS = new Set([
  "record_created", "client_transaction_record_received", "cdd_arrangement_end",
  "partner_relationship_end", "evidence_delivery_end", "raw_id_copy_necessity_end",
  "biometric_necessity_end", "audit_obligation_end",
]);

/**
 * Destroy a retained biometric.
 *
 * The generic disposal path cannot serve this: a biometric is an object in a
 * storage bucket, and deleting only the database row would leave the image
 * behind with nothing left pointing at it — undiscoverable, undeletable, and
 * still personal information under APP 11.
 *
 * Order matters. The object is removed FIRST and the pointer cleared second,
 * so a failure between the two leaves a row that still knows what it must
 * dispose of. The reverse order loses the path and orphans the image.
 */
async function disposeBiometric(
  admin: any,
  checkId: string,
  ctx: { scanId: string; actorId: string; actorLabel: string | null },
): Promise<{ action: string; detail: string }> {
  const aml = admin.schema("aml");
  const { data: check } = await aml.from("verification_checks")
    .select("id, case_id, party_label, biometric_storage_path")
    .eq("id", checkId).maybeSingle();

  if (!check) {
    return { action: "recorded_only", detail: "Verification check no longer exists" };
  }
  if (!check.biometric_storage_path) {
    return { action: "recorded_only", detail: "No biometric retained on this check — nothing to destroy" };
  }

  const { error: rmErr } = await admin.storage
    .from("aml-biometrics").remove([check.biometric_storage_path]);
  if (rmErr) throw new Error(`biometric object not removed: ${rmErr.message}`);

  const { error: updErr } = await aml.from("verification_checks").update({
    biometric_storage_path: null,
    biometric_kind: null,
    biometric_captured_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", checkId);
  if (updErr) throw updErr;

  // The access log is the APP 11 answer to "what happened to this image".
  // A destruction that is not in the log is indistinguishable from a leak.
  // biometric_consent_id is deliberately left in place: it evidences what
  // authorised the collection and is not itself biometric information.
  await aml.from("biometric_access_log").insert({
    verification_check_id: checkId,
    case_id: check.case_id,
    actor_id: ctx.actorId,
    actor_label: ctx.actorLabel,
    action: "dispose",
    reason: `Retention disposal executed under scan ${ctx.scanId}`,
  });

  return {
    action: "biometric_destroyed",
    detail: `Facial image destroyed from aml-biometrics; the verification record for ${check.party_label} is retained`,
  };
}

// Phase 11 (§18): the retention clock starts at a recorded trigger event, not
// at upload. A record with no operative trigger has not started its clock and
// is never disposal-eligible. Phase 7 widened the kinds (partner-domain and
// necessity-end clocks) via the shared catalogue — a superset of these.
const RETENTION_TRIGGER_KINDS: Record<string, string> = {
  relationship_end: "Business relationship ended",
  occasional_transaction_complete: "Occasional transaction completed",
  transaction_date: "Transaction date",
  program_version_obsolete: "AML program version became obsolete",
  investigation_complete: "Investigation completed",
  report_complete: "Regulatory report completed",
  legal_hold_release: "Legal hold released",
  ...RETENTION_TRIGGER_KIND_LABELS,
};

function addYears(from: Date, years: number): Date {
  const d = new Date(from.getTime());
  // Whole years shift the calendar date; the fractional remainder is applied
  // in days so a 7.5-year schedule lands where an operator expects.
  const whole = Math.trunc(years);
  d.setUTCFullYear(d.getUTCFullYear() + whole);
  const remainderDays = (years - whole) * 365.25;
  if (remainderDays > 0) d.setUTCDate(d.getUTCDate() + Math.round(remainderDays));
  return d;
}

/**
 * §18 dependency check — reasons a record must not be disposed of yet, beyond
 * legal holds. Evaluated at dry run AND re-evaluated at execution, because
 * dependencies can appear between approval and disposal.
 */
async function dependencyBlockersFor(
  admin: any, entityType: string, entityId: string, caseId: string | null,
  partnerChecks = false,
): Promise<string[]> {
  const aml = admin.schema("aml");
  const blockers: string[] = [];

  // Phase 7 (§7.6): live partner-domain facts block disposal. The counting
  // happens here; the DECISION lives in the pure partnerDependencyBlockers
  // so dry run and execution apply identical rules. Gated by the Phase 7
  // flag at the call sites — while off, behaviour is byte-identical.
  if (partnerChecks && caseId) {
    const nowIso = new Date().toISOString();
    const [links, grants, requests, deliveries, obligations] = await Promise.all([
      aml.from("partner_case_links").select("id", { count: "exact", head: true })
        .eq("case_id", caseId).eq("state", "active"),
      aml.from("reliance_grants").select("id", { count: "exact", head: true })
        .eq("case_id", caseId).is("revoked_at", null).gt("expires_at", nowIso),
      aml.from("partner_records_requests").select("id", { count: "exact", head: true })
        .eq("case_id", caseId).in("status", ["submitted", "under_review", "approved", "partly_approved"]),
      aml.from("partner_evidence_deliveries").select("id", { count: "exact", head: true })
        .eq("case_id", caseId).is("revoked_at", null).gt("expires_at", nowIso),
      aml.from("partner_refresh_obligations").select("id", { count: "exact", head: true })
        .eq("case_id", caseId).eq("status", "open"),
    ]);
    blockers.push(...partnerDependencyBlockers({
      activePartnerLinks: links.count ?? 0,
      activeGrants: grants.count ?? 0,
      openRecordsRequests: requests.count ?? 0,
      liveEvidenceDeliveries: deliveries.count ?? 0,
      openRefreshObligations: obligations.count ?? 0,
    }));
  }

  // A record that still supports an unfinished regulatory report cannot go.
  if (caseId) {
    const { count: openReports } = await aml.from("reports")
      .select("id", { count: "exact", head: true })
      .eq("case_id", caseId).not("status", "in", '("acknowledged","withdrawn","rejected")');
    if ((openReports ?? 0) > 0) blockers.push("open_regulatory_report");

    const { count: openObligations } = await aml.from("transaction_obligations")
      .select("id", { count: "exact", head: true })
      .eq("case_id", caseId).in("status", ["pending", "acknowledged"]);
    if ((openObligations ?? 0) > 0) blockers.push("open_reporting_obligation");

    const { count: openEdd } = await aml.from("edd_cases")
      .select("id", { count: "exact", head: true })
      .eq("case_id", caseId).in("status", ["open", "in_progress", "awaiting_client", "awaiting_mlro"]);
    if ((openEdd ?? 0) > 0) blockers.push("open_investigation");

    const { count: openAlerts } = await aml.from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("case_id", caseId).in("status", ["open", "investigating"]);
    if ((openAlerts ?? 0) > 0) blockers.push("open_alert");
  }

  // Still cited as evidence somewhere.
  const { count: evidenceRefs } = await aml.from("evidence_references")
    .select("id", { count: "exact", head: true }).eq("reference_id", entityId);
  if ((evidenceRefs ?? 0) > 0) blockers.push("referenced_as_evidence");

  // An ongoing relationship keeps the whole case alive.
  if (entityType === "case") {
    const { data: caseRow } = await aml.from("cases")
      .select("monitoring_status, status").eq("id", entityId).maybeSingle();
    if (caseRow && caseRow.monitoring_status !== "ended") blockers.push("relationship_not_ended");
  }

  return blockers;
}

async function activeHoldFor(admin: any, entityType: string, entityId: string, caseId: string | null) {
  const { data, error } = await admin.schema("aml").from("legal_holds")
    .select("id").eq("entity_type", entityType).eq("entity_id", entityId).is("released_at", null).limit(1);
  if (error) throw error;
  if (data && data.length > 0) return data[0].id as string;
  if (!caseId) return null;

  const { data: caseHolds, error: caseHoldError } = await admin.schema("aml").from("legal_holds")
    .select("id").eq("case_id", caseId).is("released_at", null).limit(1);
  if (caseHoldError) throw caseHoldError;
  return caseHolds && caseHolds.length > 0 ? caseHolds[0].id as string : null;
}

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
    const aml = admin.schema("aml");

    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;
    const userLabel = auth.username ?? null;

    const { data: hasAny } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasAny) return jr({ error: "AML role required" }, 403);
    const { data: isMlro } = await admin.rpc("has_aml_role", { _user_id: userId, _role: "mlro" });
    const { data: isReviewer } = await admin.rpc("has_aml_role", { _user_id: userId, _role: "reviewer" });
    const { data: isAnalyst } = await admin.rpc("has_aml_role", { _user_id: userId, _role: "analyst" });
    const canInvestigate = !!(isMlro || isReviewer || isAnalyst);

    const op = (body.op ?? "").toString();

    switch (op) {
      case "summary": {
        const [schedules, holds, privacy, scans] = await Promise.all([
          aml.from("retention_schedules").select("id", { count: "exact", head: true }).eq("active", true),
          aml.from("legal_holds").select("id", { count: "exact", head: true }).is("released_at", null),
          aml.from("privacy_requests").select("status"),
          aml.from("retention_scans").select("status,candidates_count,disposed_count").order("created_at", { ascending: false }).limit(25),
        ]);
        const privacyCounts: Record<string, number> = {};
        for (const r of (privacy.data ?? [])) privacyCounts[r.status] = (privacyCounts[r.status] ?? 0) + 1;
        const scansAwaiting = (scans.data ?? []).filter((s: any) => s.status === "awaiting_approval").length;
        const lastCompleted = (scans.data ?? []).find((s: any) => s.status === "completed");
        return jr({
          schedules_active: schedules.count ?? 0,
          holds_active: holds.count ?? 0,
          privacy: privacyCounts,
          scans_awaiting_approval: scansAwaiting,
          last_completed_scan: lastCompleted ?? null,
        });
      }

      // ---------- schedules ----------
      case "list_schedules": {
        const { data, error } = await aml.from("retention_schedules").select("*").order("entity_type");
        if (error) return jr({ error: error.message }, 400);
        return jr({ schedules: data ?? [] });
      }
      case "upsert_schedule": {
        if (!isMlro) return jr({ error: "MLRO required" }, 403);
        const row = body.schedule ?? {};
        if (!row.entity_type) return jr({ error: "entity_type required" }, 400);
        const payload = {
          entity_type: row.entity_type,
          retention_years: Number(row.retention_years ?? 7),
          legal_basis: row.legal_basis ?? "AML/CTF Act 2006 s107",
          disposal_method: row.disposal_method ?? "soft_delete",
          notes: row.notes ?? null,
          active: row.active ?? true,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await aml.from("retention_schedules")
          .upsert({ ...payload, created_by: userId }, { onConflict: "entity_type" })
          .select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "schedule", `Retention schedule upserted for ${payload.entity_type}`, payload, userId, userLabel);
        return jr({ schedule: data });
      }

      // ---------- legal holds ----------
      case "list_holds": {
        const { data, error } = await aml.from("legal_holds").select("*").order("imposed_at", { ascending: false }).limit(200);
        if (error) return jr({ error: error.message }, 400);
        return jr({ holds: data ?? [] });
      }
      case "create_hold": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const h = body.hold ?? {};
        if (!h.entity_type || !h.reason) return jr({ error: "entity_type and reason required" }, 400);
        const { data, error } = await aml.from("legal_holds").insert({
          entity_type: h.entity_type,
          entity_id: h.entity_id ?? null,
          case_id: h.case_id ?? null,
          reason: h.reason,
          imposed_by: userId,
          imposed_by_label: userLabel,
        }).select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "hold", `Legal hold created on ${h.entity_type}`, { hold_id: data.id, entity_type: h.entity_type, entity_id: h.entity_id ?? null, case_id: h.case_id ?? null, reason: h.reason }, userId, userLabel);
        return jr({ hold: data });
      }
      case "release_hold": {
        if (!isMlro) return jr({ error: "MLRO required" }, 403);
        const id = body.id;
        const note = body.release_note ?? null;
        if (!id) return jr({ error: "id required" }, 400);
        const { data, error } = await aml.from("legal_holds").update({
          released_at: new Date().toISOString(),
          released_by: userId,
          release_note: note,
        }).eq("id", id).is("released_at", null).select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "hold", `Legal hold released`, { hold_id: id, note }, userId, userLabel);
        return jr({ hold: data });
      }

      // ---------- privacy requests ----------
      case "list_privacy_requests": {
        const { data, error } = await aml.from("privacy_requests").select("*").order("received_at", { ascending: false }).limit(200);
        if (error) return jr({ error: error.message }, 400);
        return jr({ requests: data ?? [] });
      }
      case "create_privacy_request": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const r = body.request ?? {};
        if (!r.kind) return jr({ error: "kind required" }, 400);
        const receivedAt = r.received_at ? new Date(r.received_at) : new Date();
        const due = new Date(receivedAt.getTime() + 30 * 24 * 3600 * 1000);
        const { data, error } = await aml.from("privacy_requests").insert({
          kind: r.kind,
          subject_client_id: r.subject_client_id ?? null,
          subject_email: r.subject_email ?? null,
          subject_full_name: r.subject_full_name ?? null,
          status: r.status ?? "received",
          received_at: receivedAt.toISOString(),
          due_at: due.toISOString(),
          received_via: r.received_via ?? null,
          request_details: r.request_details ?? null,
          requested_by_label: r.requested_by_label ?? null,
          handled_by: userId,
          handled_by_label: userLabel,
        }).select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "privacy", `Privacy request logged (${r.kind})`, { request_id: data.id }, userId, userLabel);
        return jr({ request: data });
      }
      case "update_privacy_request": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const id = body.id;
        const patch = body.patch ?? {};
        if (!id) return jr({ error: "id required" }, 400);
        const allowed = ["status","response_summary","response_bundle_path","rejection_reason","subject_client_id","subject_email","subject_full_name","request_details","received_via","fulfilled_at"];
        const clean: any = {};
        for (const k of allowed) if (k in patch) clean[k] = patch[k];
        if (patch.status === "fulfilled" || patch.status === "partially_fulfilled") {
          clean.fulfilled_at = clean.fulfilled_at ?? new Date().toISOString();
        }
        if (patch.status === "rejected" && !patch.rejection_reason) {
          return jr({ error: "rejection_reason required when rejecting" }, 400);
        }
        clean.handled_by = userId;
        clean.handled_by_label = userLabel;
        const { data, error } = await aml.from("privacy_requests").update(clean).eq("id", id).select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "privacy", `Privacy request updated`, { request_id: id, patch: clean }, userId, userLabel);
        return jr({ request: data });
      }
      case "export_privacy_bundle": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const id = body.id;
        if (!id) return jr({ error: "id required" }, 400);
        const { data: pr } = await aml.from("privacy_requests").select("*").eq("id", id).maybeSingle();
        if (!pr) return jr({ error: "Not found" }, 404);
        // Collect the subject's records — bundle is a JSON manifest (no auto-file dump).
        const bundle: any = { request: pr, subject: {}, generated_at: new Date().toISOString(), generated_by: userLabel };
        if (pr.subject_client_id) {
          const cases = await aml.from("cases")
            .select("id,reference_code:case_reference,status,created_at,closed_at")
            .eq("client_id", pr.subject_client_id);
          if (cases.error) return jr({ error: cases.error.message }, 400);

          const caseIds = (cases.data ?? []).map((record: any) => record.id);
          const [verifs, screening] = caseIds.length
            ? await Promise.all([
                aml.from("identity_checks").select("id,method,outcome:status,completed_at").in("case_id", caseIds),
                aml.from("screening_matches").select("id,list_source:list_name,match_score:score,status,resolved_at:updated_at").in("case_id", caseIds),
              ])
            : [{ data: [], error: null }, { data: [], error: null }];
          if (verifs.error) return jr({ error: verifs.error.message }, 400);
          if (screening.error) return jr({ error: screening.error.message }, 400);
          bundle.subject = { cases: cases.data ?? [], verifications: verifs.data ?? [], screening: screening.data ?? [] };

          // Phase 7 (§7.10): what was SHARED about the subject under CDD
          // arrangements — links, requests and delivery metadata only.
          // Reviewer/MLRO-restricted classes (P4/P5/P6 in the record-class
          // catalogue) never enter an export bundle.
          if (caseIds.length && await flagEnabled(admin, "aml_partner_records_retention")) {
            const [links, requests, deliveries] = await Promise.all([
              aml.from("partner_case_links")
                .select("id, case_id, portal_type, relationship_role, legal_route, state, linked_at, ended_at, partner_organisations:partner_org_id(legal_name)")
                .in("case_id", caseIds),
              aml.from("partner_records_requests")
                .select("id, case_id, requested_record_codes, status, requested_at, reviewed_at, approved_record_codes, denied_record_codes")
                .in("case_id", caseIds),
              aml.from("partner_evidence_deliveries")
                .select("id, case_id, record_code, safe_label, delivered_at, expires_at, revoked_at")
                .in("case_id", caseIds),
            ]);
            bundle.subject.partner_sharing = {
              note: "Information shared with partner organisations under written CDD arrangements, with the client's sharing consent.",
              links: links.data ?? [],
              records_requests: requests.data ?? [],
              evidence_deliveries: deliveries.data ?? [],
            };
          }
        }
        const hash = await sha256Hex(JSON.stringify(bundle));
        await audit(admin, "privacy", `Privacy bundle exported`, { request_id: id, content_hash: hash }, userId, userLabel);
        return jr({ bundle, content_hash: hash });
      }

      // ---------- tipping-off ----------
      case "list_tipping_off_rules": {
        const { data, error } = await aml.from("tipping_off_rules").select("*").order("surface").order("pattern");
        if (error) return jr({ error: error.message }, 400);
        return jr({ rules: data ?? [] });
      }
      case "upsert_tipping_off_rule": {
        if (!isMlro) return jr({ error: "MLRO required" }, 403);
        const r = body.rule ?? {};
        if (!r.surface || !r.pattern) return jr({ error: "surface + pattern required" }, 400);
        const row = {
          id: r.id ?? undefined,
          surface: r.surface,
          pattern: r.pattern,
          is_regex: !!r.is_regex,
          suppression_mode: r.suppression_mode ?? "block",
          replacement_copy: r.replacement_copy ?? null,
          note: r.note ?? null,
          active: r.active ?? true,
          created_by: userId,
        };
        const q = r.id
          ? aml.from("tipping_off_rules").update(row).eq("id", r.id).select("*").single()
          : aml.from("tipping_off_rules").insert(row).select("*").single();
        const { data, error } = await q;
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "tipping_off", `Tipping-off rule upserted`, { rule_id: data.id, surface: r.surface }, userId, userLabel);
        return jr({ rule: data });
      }
      case "delete_tipping_off_rule": {
        if (!isMlro) return jr({ error: "MLRO required" }, 403);
        const id = body.id;
        if (!id) return jr({ error: "id required" }, 400);
        const { error } = await aml.from("tipping_off_rules").delete().eq("id", id);
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "tipping_off", `Tipping-off rule deleted`, { rule_id: id }, userId, userLabel);
        return jr({ ok: true });
      }
      case "evaluate_tipping_off": {
        const surface = body.surface ?? "notification";
        const text = (body.text ?? "").toString();
        const { data: rules } = await aml.from("tipping_off_rules").select("*").eq("active", true).eq("surface", surface);
        const hits: any[] = [];
        for (const r of (rules ?? [])) {
          let matched = false;
          try {
            matched = r.is_regex
              ? new RegExp(r.pattern, "i").test(text)
              : text.toLowerCase().includes(r.pattern.toLowerCase());
          } catch { matched = false; }
          if (matched) hits.push({ rule_id: r.id, mode: r.suppression_mode, pattern: r.pattern, replacement_copy: r.replacement_copy, note: r.note });
        }
        const blocked = hits.some((h) => h.mode === "block");
        return jr({ blocked, hits });
      }

      // ---------- retention scans ----------
      case "list_scans": {
        const { data, error } = await aml.from("retention_scans").select("*").order("created_at", { ascending: false }).limit(50);
        if (error) return jr({ error: error.message }, 400);
        return jr({ scans: data ?? [] });
      }
      case "get_scan": {
        const id = body.id;
        if (!id) return jr({ error: "id required" }, 400);
        const [{ data: scan }, { data: items }] = await Promise.all([
          aml.from("retention_scans").select("*").eq("id", id).maybeSingle(),
          aml.from("retention_scan_items").select("*").eq("scan_id", id).order("entity_type").limit(2000),
        ]);
        return jr({ scan, items: items ?? [] });
      }
      // ── RETENTION TRIGGERS (Phase 11, §18) ───────────────────
      // Starts the retention clock for a record from a recorded trigger event.
      // Re-recording supersedes the previous trigger rather than editing it,
      // so the basis for every retention decision stays reconstructable.
      case "record_retention_trigger": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const entityType = String(body.entity_type ?? "");
        const entityId = String(body.entity_id ?? "");
        const triggerKind = String(body.trigger_kind ?? "");
        const triggerDate = body.trigger_date ? new Date(String(body.trigger_date)) : new Date();
        if (!entityType || !entityId) return jr({ error: "entity_type and entity_id required" }, 400);
        if (!RETENTION_TRIGGER_KINDS[triggerKind]) return jr({ error: "trigger_kind invalid" }, 400);
        if (Number.isNaN(triggerDate.getTime())) return jr({ error: "trigger_date must be a valid date" }, 400);
        // Phase 7 vocabulary is flag-gated; the pre-existing kinds and
        // entity types behave exactly as before while the flag is off.
        if ((PHASE7_TRIGGER_KINDS.has(triggerKind) || PARTNER_ENTITY_TYPES.has(entityType))
          && !(await flagEnabled(admin, "aml_partner_records_retention"))) {
          return jr({
            error: "Partner-domain retention is not enabled (aml_partner_records_retention).",
            code: "partner_retention_disabled",
          }, 409);
        }

        const { data: sched } = await aml.from("retention_schedules")
          .select("*").eq("entity_type", entityType).eq("active", true).maybeSingle();
        const retentionYears = body.retention_years != null
          ? Number(body.retention_years)
          : Number(sched?.retention_years ?? 7);
        if (!Number.isFinite(retentionYears) || retentionYears < 0) {
          return jr({ error: "retention_years must be a non-negative number" }, 400);
        }
        const legalBasis = String(body.legal_basis ?? sched?.legal_basis ?? "").trim();
        if (!legalBasis) {
          return jr({ error: "legal_basis is required — record the legal or program basis for the retention period" }, 400);
        }

        const caseId = body.case_id ? String(body.case_id)
          : (entityType === "case" ? entityId : null);
        const minimumRetentionDate = addYears(triggerDate, retentionYears).toISOString();

        // Supersede rather than overwrite.
        const { data: prior } = await aml.from("retention_triggers")
          .select("id").eq("entity_type", entityType).eq("entity_id", entityId)
          .is("superseded_at", null).limit(10);

        const { data: trigger, error: tErr } = await aml.from("retention_triggers").insert({
          entity_type: entityType, entity_id: entityId, case_id: caseId,
          record_category: String(body.record_category ?? entityType),
          trigger_kind: triggerKind, trigger_date: triggerDate.toISOString(),
          legal_basis: legalBasis, retention_years: retentionYears,
          minimum_retention_date: minimumRetentionDate,
          privacy_restricted: Boolean(body.privacy_restricted),
          privacy_restriction_note: body.privacy_restriction_note ? String(body.privacy_restriction_note) : null,
          disposal_method: String(body.disposal_method ?? sched?.disposal_method ?? "soft_delete"),
          source_note: body.source_note ? String(body.source_note) : null,
          recorded_by: userId, recorded_by_label: userLabel,
        }).select("*").single();
        if (tErr) return jr({ error: tErr.message }, 400);

        if ((prior ?? []).length > 0) {
          await aml.from("retention_triggers")
            .update({ superseded_at: new Date().toISOString(), superseded_by: trigger.id })
            .in("id", (prior ?? []).map((p: any) => p.id));
        }

        await audit(admin, "retention",
          `Retention trigger recorded: ${RETENTION_TRIGGER_KINDS[triggerKind]} — minimum retention to ${minimumRetentionDate.slice(0, 10)}`,
          {
            trigger_id: trigger.id, entity_type: entityType, entity_id: entityId,
            trigger_kind: triggerKind, trigger_date: trigger.trigger_date,
            retention_years: retentionYears, minimum_retention_date: minimumRetentionDate,
            superseded: (prior ?? []).length,
          }, userId, userLabel);
        return jr({ trigger, superseded: (prior ?? []).length });
      }

      // Derives retention triggers from case state already recorded elsewhere
      // (Phase 10 relationship end, acknowledged reports, closed EDD), so the
      // clock starts without hand-entry. Idempotent: existing operative
      // triggers are left alone.
      case "sync_case_triggers": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const caseId = String(body.case_id ?? "");
        if (!caseId) return jr({ error: "case_id required" }, 400);
        const { data: caseRow } = await aml.from("cases")
          .select("id, relationship_ended_at, monitoring_status").eq("id", caseId).maybeSingle();
        if (!caseRow) return jr({ error: "Case not found" }, 404);

        const { data: schedules } = await aml.from("retention_schedules").select("*").eq("active", true);
        const schedFor = (t: string) => (schedules ?? []).find((s: any) => s.entity_type === t);
        const created: Array<{ entity_type: string; entity_id: string; trigger_kind: string }> = [];

        const ensure = async (
          entityType: string, entityId: string, kind: string, date: string, category: string,
        ) => {
          const { data: existing } = await aml.from("retention_triggers")
            .select("id").eq("entity_type", entityType).eq("entity_id", entityId)
            .is("superseded_at", null).limit(1).maybeSingle();
          if (existing) return;
          const sched = schedFor(entityType);
          const years = Number(sched?.retention_years ?? 7);
          const basis = String(sched?.legal_basis ?? "AML/CTF Act 2006 s107 — 7 year minimum");
          await aml.from("retention_triggers").insert({
            entity_type: entityType, entity_id: entityId, case_id: caseId,
            record_category: category, trigger_kind: kind, trigger_date: date,
            legal_basis: basis, retention_years: years,
            minimum_retention_date: addYears(new Date(date), years).toISOString(),
            disposal_method: String(sched?.disposal_method ?? "soft_delete"),
            source_note: "Derived from recorded case state",
            recorded_by: userId, recorded_by_label: userLabel,
          });
          created.push({ entity_type: entityType, entity_id: entityId, trigger_kind: kind });
        };

        if (caseRow.relationship_ended_at) {
          await ensure("case", caseId, "relationship_end", caseRow.relationship_ended_at, "AML case file");

          // Every retained facial image gets its own trigger. Without one the
          // biometric has no clock at all: it is never enumerated, never
          // approved, and never destroyed — the image simply stays.
          const { data: bioChecks } = await aml.from("verification_checks")
            .select("id").eq("case_id", caseId)
            .not("biometric_storage_path", "is", null).limit(500);
          for (const b of bioChecks ?? []) {
            await ensure("biometric", b.id, "relationship_end",
              caseRow.relationship_ended_at, "Biometric — retained facial image");
          }
        }
        const { data: doneReports } = await aml.from("reports")
          .select("id, acknowledged_at").eq("case_id", caseId).not("acknowledged_at", "is", null).limit(50);
        for (const r of doneReports ?? []) {
          await ensure("report", r.id, "report_complete", r.acknowledged_at, "Regulatory report");
        }
        const { data: closedEdd } = await aml.from("edd_cases")
          .select("id, completed_at").eq("case_id", caseId).not("completed_at", "is", null).limit(50);
        for (const e of closedEdd ?? []) {
          await ensure("edd", e.id, "investigation_complete", e.completed_at, "Investigation file");
        }

        if (created.length > 0) {
          await audit(admin, "retention", `Retention triggers derived for case (${created.length})`,
            { case_id: caseId, created }, userId, userLabel);
        }
        return jr({ created_count: created.length, created });
      }

      // Phase 7 (§7.5): derive partner-domain retention triggers from state
      // the domain has already recorded — ended links, expired/revoked
      // deliveries, discharged obligations, transient notifications. Same
      // ensure-style idempotency as sync_case_triggers: an operative trigger
      // is never touched, so re-running changes nothing. Every clock starts
      // at the recorded trigger event, never at row creation — the single
      // exception is partner_notification, whose class explicitly uses
      // creation date (record_created).
      case "sync_partner_triggers": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        if (!(await flagEnabled(admin, "aml_partner_records_retention"))) {
          return jr({
            error: "Partner-domain retention is not enabled (aml_partner_records_retention).",
            code: "partner_retention_disabled",
          }, 409);
        }
        const caseId = String(body.case_id ?? "");
        if (!caseId) return jr({ error: "case_id required" }, 400);

        const { data: schedules } = await aml.from("retention_schedules").select("*").eq("active", true);
        const schedFor = (t: string) => (schedules ?? []).find((s: any) => s.entity_type === t);
        const created: Array<{ entity_type: string; entity_id: string; trigger_kind: string }> = [];
        const nowIso = new Date().toISOString();

        const ensure = async (
          entityType: string, entityId: string, kind: string, date: string, category: string,
        ) => {
          const { data: existing } = await aml.from("retention_triggers")
            .select("id").eq("entity_type", entityType).eq("entity_id", entityId)
            .is("superseded_at", null).limit(1).maybeSingle();
          if (existing) return;
          const sched = schedFor(entityType);
          const years = Number(sched?.retention_years ?? 7);
          const basis = String(sched?.legal_basis ?? "AML/CTF Act 2006 s107 — 7 year minimum");
          await aml.from("retention_triggers").insert({
            entity_type: entityType, entity_id: entityId, case_id: caseId,
            record_category: category, trigger_kind: kind, trigger_date: date,
            legal_basis: basis, retention_years: years,
            minimum_retention_date: addYears(new Date(date), years).toISOString(),
            disposal_method: String(sched?.disposal_method ?? "soft_delete"),
            source_note: "Derived from recorded partner-domain state",
            recorded_by: userId, recorded_by_label: userLabel,
          });
          created.push({ entity_type: entityType, entity_id: entityId, trigger_kind: kind });
        };

        const { data: endedLinks } = await aml.from("partner_case_links")
          .select("id, ended_at").eq("case_id", caseId).eq("state", "ended")
          .not("ended_at", "is", null).limit(200);
        for (const l of endedLinks ?? []) {
          await ensure("partner_case_link", l.id, "partner_relationship_end",
            l.ended_at, "Partner-case link and legal route");
        }

        const { data: deadDeliveries } = await aml.from("partner_evidence_deliveries")
          .select("id, expires_at, revoked_at").eq("case_id", caseId)
          .or(`revoked_at.not.is.null,expires_at.lt.${nowIso}`).limit(500);
        for (const d of deadDeliveries ?? []) {
          await ensure("partner_evidence_delivery", d.id, "evidence_delivery_end",
            d.revoked_at ?? d.expires_at, "Evidence delivery read model");
        }

        const { data: reviewedRequests } = await aml.from("partner_records_requests")
          .select("id, reviewed_at").eq("case_id", caseId)
          .not("reviewed_at", "is", null)
          .in("status", ["denied", "delivered", "expired", "cancelled"]).limit(200);
        for (const r of reviewedRequests ?? []) {
          await ensure("partner_records_request", r.id, "evidence_delivery_end",
            r.reviewed_at, "Controlled partner records request");
        }

        const { data: closedObligations } = await aml.from("partner_refresh_obligations")
          .select("id, completed_at, cancelled_at, status").eq("case_id", caseId)
          .in("status", ["completed", "cancelled", "expired"]).limit(200);
        for (const o of closedObligations ?? []) {
          const date = o.completed_at ?? o.cancelled_at;
          if (!date) continue;
          await ensure("partner_refresh_obligation", o.id, "audit_obligation_end",
            date, "Partner refresh obligation");
        }

        // Transient fixed-copy rows — the ONE class whose clock is creation.
        const { data: linkRows } = await aml.from("partner_case_links")
          .select("id").eq("case_id", caseId).limit(200);
        const linkIds = (linkRows ?? []).map((l: any) => l.id);
        if (linkIds.length > 0) {
          const { data: notifications } = await aml.from("partner_notifications")
            .select("id, created_at").in("partner_case_link_id", linkIds).limit(500);
          for (const n of notifications ?? []) {
            await ensure("partner_notification", n.id, "record_created",
              n.created_at, "Partner-safe notification");
          }
        }

        if (created.length > 0) {
          await audit(admin, "retention", `Partner-domain retention triggers derived (${created.length})`,
            { case_id: caseId, created }, userId, userLabel);
        }
        return jr({ created_count: created.length, created });
      }

      // Phase 7 (§7.2/§7.3): the controlled record-class catalogue —
      // family, P1–P6 classification, storage zone, trigger kind, disposal
      // rule and export standing per class. Read-only.
      case "list_record_classes": {
        const { data, error } = await aml.from("record_class_catalogue")
          .select("*").order("family").order("record_code");
        if (error) return jr({ error: error.message }, 400);
        return jr({ record_classes: data ?? [] });
      }

      // §18 display contract for retained records.
      case "list_retention_records": {
        const caseId = body.case_id ? String(body.case_id) : null;
        const nowIso = new Date().toISOString();
        let q = aml.from("retention_triggers").select("*").is("superseded_at", null)
          .order("minimum_retention_date", { ascending: true })
          .limit(Math.min(Number(body.limit ?? 200), 500));
        if (caseId) q = q.eq("case_id", caseId);
        if (body.due_only) q = q.lte("minimum_retention_date", nowIso);
        const { data, error } = await q;
        if (error) return jr({ error: error.message }, 400);

        const records = [];
        for (const t of data ?? []) {
          const holdId = await activeHoldFor(admin, t.entity_type, t.entity_id, t.case_id ?? null);
          records.push({
            trigger_id: t.id,
            entity_type: t.entity_type,
            entity_id: t.entity_id,
            case_id: t.case_id,
            record_category: t.record_category,
            legal_basis: t.legal_basis,
            trigger_kind: t.trigger_kind,
            trigger_label: RETENTION_TRIGGER_KINDS[t.trigger_kind] ?? t.trigger_kind,
            trigger_date: t.trigger_date,
            retention_years: Number(t.retention_years),
            minimum_retention_date: t.minimum_retention_date,
            retention_elapsed: t.minimum_retention_date <= nowIso,
            legal_hold: Boolean(holdId),
            hold_id: holdId,
            privacy_restricted: t.privacy_restricted,
            privacy_restriction_note: t.privacy_restriction_note,
            disposal_method: t.disposal_method,
            recorded_by_label: t.recorded_by_label,
            recorded_at: t.created_at,
          });
        }
        return jr({ records });
      }

      case "dry_run_scan": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const scope = (body.scope ?? "all").toString();
        const partnerChecks = await flagEnabled(admin, "aml_partner_records_retention");
        const { data: scan, error: sErr } = await aml.from("retention_scans").insert({
          scope, status: "dry_run", requested_by: userId, requested_by_label: userLabel,
        }).select("*").single();
        if (sErr) return jr({ error: sErr.message }, 400);

        // §18: candidates come from recorded retention TRIGGERS whose minimum
        // retention date has passed — never from "age since upload". Records
        // with no operative trigger have not started their clock and are not
        // enumerated at all.
        const nowIso = new Date().toISOString();
        let tq = aml.from("retention_triggers").select("*")
          .is("superseded_at", null)
          .lte("minimum_retention_date", nowIso)
          .limit(1000);
        if (scope !== "all") tq = tq.eq("entity_type", scope);
        const { data: dueTriggers, error: tErr } = await tq;
        if (tErr) return jr({ error: tErr.message }, 400);

        const perType: Record<string, number> = {};
        let candidates = 0, held = 0, blocked = 0;
        const items: any[] = [];

        for (const t of dueTriggers ?? []) {
          const src = SCAN_SOURCES[t.entity_type];
          const caseId = t.case_id ?? (t.entity_type === "case" ? t.entity_id : null);

          // Confirm the record still exists before proposing disposal.
          if (src) {
            const { data: row } = await aml.from(src.table)
              .select(`id${src.refCol ? `, ${src.refCol}` : ""}`).eq("id", t.entity_id).maybeSingle();
            if (!row) continue;
            t.__reference_label = src.refCol ? (row as unknown as Record<string, unknown>)[src.refCol] : null;
          }

          candidates++;
          perType[t.entity_type] = (perType[t.entity_type] ?? 0) + 1;

          const holdId = await activeHoldFor(admin, t.entity_type, t.entity_id, caseId);
          const blockers = await dependencyBlockersFor(admin, t.entity_type, t.entity_id, caseId, partnerChecks);
          let disposition = "pending";
          if (holdId) { disposition = "held"; held++; }
          else if (blockers.length > 0) { disposition = "blocked"; blocked++; }

          items.push({
            scan_id: scan.id,
            entity_type: t.entity_type,
            entity_id: t.entity_id,
            reference_label: t.__reference_label ?? null,
            eligible_since: t.minimum_retention_date,
            disposition,
            hold_id: holdId,
            disposal_method: t.disposal_method,
            trigger_id: t.id,
            trigger_kind: t.trigger_kind,
            trigger_date: t.trigger_date,
            minimum_retention_date: t.minimum_retention_date,
            legal_basis: t.legal_basis,
            privacy_restricted: t.privacy_restricted,
            dependency_blockers: blockers,
          });
        }

        if (items.length) {
          const chunks: any[][] = [];
          for (let i = 0; i < items.length; i += 500) chunks.push(items.slice(i, i + 500));
          for (const c of chunks) await aml.from("retention_scan_items").insert(c);
        }
        await aml.from("retention_scans").update({
          candidates_count: candidates, held_count: held,
          summary: { per_entity_type: perType, blocked_count: blocked, basis: "retention_trigger" },
        }).eq("id", scan.id);
        await audit(admin, "scan",
          `Dry-run scan created (${candidates} candidates, ${held} held, ${blocked} dependency-blocked)`,
          { scan_id: scan.id, scope, basis: "retention_trigger" }, userId, userLabel);
        return jr({ scan_id: scan.id, candidates, held, blocked, per_entity_type: perType });
      }
      case "request_approval": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const id = body.id;
        if (!id) return jr({ error: "id required" }, 400);
        const { data, error } = await aml.from("retention_scans")
          .update({ status: "awaiting_approval" }).eq("id", id).eq("status", "dry_run")
          .select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "scan", `Scan submitted for MLRO approval`, { scan_id: id }, userId, userLabel);
        return jr({ scan: data });
      }
      case "approve_scan": {
        if (!isMlro) return jr({ error: "MLRO required" }, 403);
        const id = body.id;
        if (!id) return jr({ error: "id required" }, 400);
        const { data, error } = await aml.from("retention_scans").update({
          status: "approved", approved_by: userId, approved_by_label: userLabel, approved_at: new Date().toISOString(),
        }).eq("id", id).eq("status", "awaiting_approval").select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await aml.from("retention_scan_items").update({ disposition: "approved" }).eq("scan_id", id).eq("disposition", "pending");
        await audit(admin, "scan", `Scan approved for execution`, { scan_id: id }, userId, userLabel);
        return jr({ scan: data });
      }
      case "cancel_scan": {
        if (!canInvestigate) return jr({ error: "Investigator role required" }, 403);
        const id = body.id;
        const { data, error } = await aml.from("retention_scans").update({ status: "cancelled" }).eq("id", id).select("*").single();
        if (error) return jr({ error: error.message }, 400);
        await audit(admin, "scan", `Scan cancelled`, { scan_id: id }, userId, userLabel);
        return jr({ scan: data });
      }
      case "execute_scan": {
        if (!isMlro) return jr({ error: "MLRO required" }, 403);
        const id = body.id;
        const dryRun = !!body.dry_execute; // still logs but doesn't actually mutate source rows
        if (!id) return jr({ error: "id required" }, 400);
        const { data: scan } = await aml.from("retention_scans").select("*").eq("id", id).maybeSingle();
        if (!scan) return jr({ error: "Scan not found" }, 404);
        if (scan.status !== "approved") return jr({ error: "Scan must be approved before execution" }, 400);

        await aml.from("retention_scans").update({ status: "executing" }).eq("id", id);
        const partnerChecksAtExecution = await flagEnabled(admin, "aml_partner_records_retention");
        const { data: items } = await aml.from("retention_scan_items").select("*").eq("scan_id", id).eq("disposition", "approved").limit(2000);
        let disposed = 0, skipped = 0;
        for (const it of (items ?? [])) {
          // Re-check hold at execution time
          const src = SCAN_SOURCES[it.entity_type];
          let caseId = it.entity_type === "case" ? it.entity_id : null;
          if (!caseId && src?.caseIdCol) {
            const { data: sourceRecord, error: sourceRecordError } = await aml.from(src.table)
              .select(src.caseIdCol).eq("id", it.entity_id).maybeSingle();
            if (sourceRecordError) throw sourceRecordError;
            caseId = (sourceRecord as Record<string, unknown> | null)?.[src.caseIdCol] as string | null ?? null;
          }
          const holdId = await activeHoldFor(admin, it.entity_type, it.entity_id, caseId);
          if (holdId) {
            await aml.from("retention_scan_items").update({ disposition: "held", hold_id: holdId, processed_at: new Date().toISOString(), note: "Held at execution" }).eq("id", it.id);
            skipped++;
            continue;
          }

          // §18 dependency check, re-run at execution: dependencies can appear
          // between approval and disposal, and an approved item must not be
          // disposed of once something else relies on it.
          const blockers = await dependencyBlockersFor(admin, it.entity_type, it.entity_id, caseId, partnerChecksAtExecution);
          if (blockers.length > 0) {
            await aml.from("retention_scan_items").update({
              disposition: "blocked", dependency_blockers: blockers,
              processed_at: new Date().toISOString(),
              note: `Dependency check failed at execution: ${blockers.join(", ")}`,
            }).eq("id", it.id);
            skipped++;
            continue;
          }

          // The retention clock is re-verified too — an item approved under a
          // trigger that has since been superseded must not be disposed of.
          if (it.trigger_id) {
            const { data: trig } = await aml.from("retention_triggers")
              .select("id, superseded_at, minimum_retention_date").eq("id", it.trigger_id).maybeSingle();
            if (!trig || trig.superseded_at || trig.minimum_retention_date > new Date().toISOString()) {
              await aml.from("retention_scan_items").update({
                disposition: "blocked",
                dependency_blockers: ["retention_trigger_no_longer_operative"],
                processed_at: new Date().toISOString(),
                note: "Retention trigger superseded or minimum retention date not reached",
              }).eq("id", it.id);
              skipped++;
              continue;
            }
          }

          // Disposal evidence records exactly what was performed — never more
          // than actually happened.
          let action = "recorded_only";
          let actionDetail = "No physical change — disposal recorded against the record only";
          if (!dryRun && src) {
            try {
              if (it.entity_type === "biometric") {
                // Destroys the stored image, not the verification record.
                const outcome = await disposeBiometric(admin, it.entity_id, {
                  scanId: String(id), actorId: userId, actorLabel: userLabel,
                });
                action = outcome.action;
                actionDetail = outcome.detail;
              } else if (it.disposal_method === "hard_delete") {
                const { error: delErr } = await aml.from(src.table).delete().eq("id", it.entity_id);
                if (delErr) throw delErr;
                action = "hard_delete";
                actionDetail = `Row deleted from aml.${src.table}`;
              } else {
                const { error: updErr } = await aml.from(src.table)
                  .update({ updated_at: new Date().toISOString() }).eq("id", it.entity_id);
                if (updErr) throw updErr;
                action = "soft_marked";
                actionDetail = `Row retained in aml.${src.table} and marked; no field-level redaction performed`;
              }
            } catch (e: any) {
              await aml.from("retention_scan_items").update({
                disposition: "failed", processed_at: new Date().toISOString(),
                note: `Disposal failed: ${e?.message ?? String(e)}`,
              }).eq("id", it.id);
              skipped++;
              continue;
            }
          } else if (dryRun) {
            action = "dry_execute";
            actionDetail = "Dry execution — no change attempted";
          }

          const evidence = {
            action,
            detail: actionDetail,
            disposal_method: it.disposal_method,
            source_table: src ? `aml.${src.table}` : null,
            entity_type: it.entity_type,
            entity_id: it.entity_id,
            trigger_id: it.trigger_id ?? null,
            minimum_retention_date: it.minimum_retention_date ?? null,
            legal_basis: it.legal_basis ?? null,
            scan_id: id,
            approved_by: scan.approved_by ?? null,
            executed_by: userId,
            executed_by_label: userLabel,
            executed_at: new Date().toISOString(),
            dependency_check: "passed",
            legal_hold_check: "passed",
          };
          const evidenceHash = await sha256Hex(JSON.stringify(evidence));

          await aml.from("retention_scan_items").update({
            disposition: "disposed", processed_at: new Date().toISOString(),
            disposal_evidence: { ...evidence, evidence_hash: evidenceHash },
            note: dryRun ? "Dry execute — no physical change" : null,
          }).eq("id", it.id);
          disposed++;
        }
        await aml.from("retention_scans").update({
          status: "completed", executed_at: new Date().toISOString(),
          disposed_count: disposed, skipped_count: (skipped ?? 0),
        }).eq("id", id);
        await audit(admin, "scan", `Scan executed (${disposed} disposed, ${skipped} skipped${dryRun ? " – dry" : ""})`, { scan_id: id, dry_execute: dryRun }, userId, userLabel);
        return jr({ scan_id: id, disposed, skipped, dry_execute: dryRun });
      }

      case "audit_timeline": {
        const limit = Math.min(Number(body.limit ?? 100), 500);
        const { data, error } = await aml.from("records_audit_events")
          .select("*").order("created_at", { ascending: false }).limit(limit);
        if (error) return jr({ error: error.message }, 400);
        return jr({ events: data ?? [] });
      }

      // ── AUDIT INTEGRITY + EXPORT (Phase 11, §19) ─────────────
      // Independent-review evidence: recompute every row hash and confirm the
      // prev_hash linkage, so a reviewer can establish that the trail has not
      // been altered rather than taking the stored hashes on trust.
      case "verify_audit_chain": {
        const chain = String(body.chain ?? "case_events");
        if (!["case_events", "records_audit_events"].includes(chain)) {
          return jr({ error: "chain must be case_events or records_audit_events" }, 400);
        }
        const caseId = body.case_id ? String(body.case_id) : null;
        if (chain === "case_events" && !caseId) return jr({ error: "case_id required for case_events" }, 400);

        let q = aml.from(chain).select("*").order("created_at", { ascending: true }).limit(5000);
        if (caseId && chain === "case_events") q = q.eq("case_id", caseId);
        const { data: events, error } = await q;
        if (error) return jr({ error: error.message }, 400);

        let previousHash: string | null = null;
        let verified = 0;
        const breaks: Array<{ id: string; created_at: string; problem: string }> = [];
        for (const ev of events ?? []) {
          const recomputed = chain === "case_events"
            ? await sha256Hex(JSON.stringify({
                case_id: ev.case_id, category: ev.category, summary: ev.summary, payload: ev.payload,
                actor_id: ev.actor_id, actor_label: ev.actor_label,
                prev_hash: ev.prev_hash, created_at: ev.created_at,
              }))
            : await sha256Hex(JSON.stringify({
                category: ev.category, summary: ev.summary, payload: ev.payload,
                actor_id: ev.actor_id, actor_label: ev.actor_label,
                prev_hash: ev.prev_hash, created_at: ev.created_at,
              }));
          if (recomputed !== ev.row_hash) {
            breaks.push({ id: ev.id, created_at: ev.created_at, problem: "row_hash_mismatch" });
          } else if ((ev.prev_hash ?? null) !== previousHash) {
            breaks.push({ id: ev.id, created_at: ev.created_at, problem: "prev_hash_discontinuity" });
          } else {
            verified++;
          }
          previousHash = ev.row_hash ?? null;
        }

        return jr({
          chain, case_id: caseId,
          event_count: (events ?? []).length,
          verified_count: verified,
          intact: breaks.length === 0,
          breaks,
          verified_at: new Date().toISOString(),
        });
      }

      // Signed-by-content export for independent review / regulator request.
      // MLRO-only: an audit export is a disclosure of the full internal trail.
      case "export_audit_bundle": {
        if (!isMlro) return jr({ error: "MLRO required" }, 403);
        const caseId = String(body.case_id ?? "");
        if (!caseId) return jr({ error: "case_id required" }, 400);
        const reason = String(body.reason ?? "").trim();
        if (reason.length < 10) {
          return jr({ error: "reason must be at least 10 characters — record why the audit trail is being exported" }, 400);
        }

        const [{ data: caseRow }, { data: events }, { data: triggers }, { data: holds }] = await Promise.all([
          aml.from("cases").select(
            "id, case_reference, subject_display_name, status, case_stage, service_gate_status, monitoring_status, opened_at, relationship_ended_at",
          ).eq("id", caseId).maybeSingle(),
          aml.from("case_events").select("*").eq("case_id", caseId).order("created_at", { ascending: true }).limit(5000),
          aml.from("retention_triggers").select("*").eq("case_id", caseId).is("superseded_at", null),
          aml.from("legal_holds").select("id, reason, created_at, released_at").eq("case_id", caseId),
        ]);
        if (!caseRow) return jr({ error: "Case not found" }, 404);

        // Re-verify the chain as part of the export so the bundle carries its
        // own integrity statement.
        let previousHash: string | null = null;
        let verified = 0;
        const breaks: Array<{ id: string; problem: string }> = [];
        for (const ev of events ?? []) {
          const recomputed = await sha256Hex(JSON.stringify({
            case_id: ev.case_id, category: ev.category, summary: ev.summary, payload: ev.payload,
            actor_id: ev.actor_id, actor_label: ev.actor_label,
            prev_hash: ev.prev_hash, created_at: ev.created_at,
          }));
          if (recomputed !== ev.row_hash) breaks.push({ id: ev.id, problem: "row_hash_mismatch" });
          else if ((ev.prev_hash ?? null) !== previousHash) breaks.push({ id: ev.id, problem: "prev_hash_discontinuity" });
          else verified++;
          previousHash = ev.row_hash ?? null;
        }

        const bundle = {
          bundle_version: 1,
          generated_at: new Date().toISOString(),
          generated_by: userId,
          generated_by_label: userLabel,
          reason,
          case: caseRow,
          integrity: {
            chain: "aml.case_events",
            event_count: (events ?? []).length,
            verified_count: verified,
            intact: breaks.length === 0,
            breaks,
            final_row_hash: previousHash,
          },
          events: (events ?? []).map((e: any) => ({
            id: e.id, created_at: e.created_at, category: e.category, summary: e.summary,
            actor_id: e.actor_id, actor_label: e.actor_label, payload: e.payload,
            prev_hash: e.prev_hash, row_hash: e.row_hash,
          })),
          retention: (triggers ?? []).map((t: any) => ({
            entity_type: t.entity_type, entity_id: t.entity_id, record_category: t.record_category,
            trigger_kind: t.trigger_kind, trigger_date: t.trigger_date, legal_basis: t.legal_basis,
            retention_years: Number(t.retention_years), minimum_retention_date: t.minimum_retention_date,
            privacy_restricted: t.privacy_restricted, disposal_method: t.disposal_method,
          })),
          legal_holds: holds ?? [],
        };
        const bundleHash = await sha256Hex(JSON.stringify(bundle));

        await audit(admin, "export",
          `Audit bundle exported for case ${caseRow.case_reference}`,
          {
            case_id: caseId, reason, bundle_hash: bundleHash,
            event_count: (events ?? []).length, chain_intact: breaks.length === 0,
          }, userId, userLabel);
        return jr({ bundle: { ...bundle, bundle_hash: bundleHash } });
      }
    }
    return jr({ error: `Unknown op: ${op}` }, 400);
  } catch (e: any) {
    console.error("aml-records error", e);
    return jr({ ...internalError(e, 'aml-records') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
