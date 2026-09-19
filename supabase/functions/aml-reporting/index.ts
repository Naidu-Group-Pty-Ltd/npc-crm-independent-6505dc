/**
 * Phase 10 — AUSTRAC Reporting & Submissions Hub.
 *
 * POST { op, ...args }
 * Reads: any AML role. Draft writes: analyst/reviewer/mlro. Sign-off/submission/receipt: mlro only.
 *
 * Ops:
 *   list_reports, get_report, upsert_report, delete_report,
 *   list_versions, create_version,
 *   submit_start (mlro), submit_record (mlro), record_receipt (mlro),
 *   mlro_signoff, mlro_reject, withdraw_report,
 *   archive_report, restore_report,
 *   export_bundle, summary
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { requireStepUpSession } from "../_shared/aml/step-up.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { archiveBlockReason } from "../_shared/aml/austracArchive.pure.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jr = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DRAFT_REPORT_STATUSES = new Set(["draft", "in_review", "awaiting_mlro"]);
const TERMINAL_REPORT_STATUSES = new Set(["approved", "submitted", "acknowledged", "rejected", "withdrawn"]);

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function appendCaseEvent(
  admin: any, caseId: string | null, category: string, summary: string,
  payload: any, actorId: string | null, actorLabel: string | null,
) {
  if (!caseId) return;
  const { data: prev } = await admin.schema("aml").from("case_events")
    .select("row_hash").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({ case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, created_at: now }));
  await admin.schema("aml").from("case_events").insert({
    case_id: caseId, category, summary, payload,
    actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
}

async function appendVersion(admin: any, reportId: string, snapshot: any, narrative: string | null, note: string | null, actorId: string | null, actorLabel: string | null) {
  const aml = admin.schema("aml");
  const { data: latest } = await aml.from("report_versions")
    .select("version, content_hash").eq("report_id", reportId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;
  const prevHash = latest?.content_hash ?? null;
  const contentHash = await sha256Hex(JSON.stringify({ reportId, nextVersion, snapshot, narrative, prevHash }));
  const { data, error } = await aml.from("report_versions").insert({
    report_id: reportId, version: nextVersion, snapshot, narrative, change_note: note,
    author_id: actorId, author_label: actorLabel, content_hash: contentHash, prev_hash: prevHash,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
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
    const { data: roleRows } = await aml.from("role_assignments").select("role").eq("user_id", userId).is("revoked_at", null);
    const roles = new Set<string>((roleRows ?? []).map((r: any) => r.role));
    const canWrite = roles.has("analyst") || roles.has("reviewer") || roles.has("mlro");
    const isMlro = roles.has("mlro");
    const isAuditorOnly = roles.has("auditor") && !roles.has("analyst") && !roles.has("reviewer") && !roles.has("mlro");
    const requireWrite = () => { if (!canWrite) throw new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); };
    const requireMlro = () => { if (!isMlro) throw new Response(JSON.stringify({ error: "MLRO role required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }); };

    // Tipping-off redaction: audit-only viewers may see SMR metadata but never narrative or payload contents.
    const redactSmr = <T extends { kind?: string; narrative?: any; payload?: any } | null | undefined>(row: T): T => {
      if (!row || !isAuditorOnly) return row;
      if (row.kind !== "smr") return row;
      return { ...row, narrative: null, payload: { redacted: true, reason: "tipping-off protection" } } as T;
    };

    const op = String(body?.op ?? "");

    // ── LIST / GET ────────────────────────────────
    if (op === "list_reports") {
      let q = aml.from("reports").select("*").order("created_at", { ascending: false }).limit(Number(body.limit ?? 200));
      /*
        Archived rows are RETAINED and hidden, never deleted. The register
        asks for the working list by default and for the archive explicitly,
        so a report can never be lost by being put away — and `archived:
        "all"` exists because an auditor asking "every report we have ever
        made" is a real question with one answer.
      */
      const archived = String(body.archived ?? "live");
      if (archived === "live") q = q.is("archived_at", null);
      else if (archived === "archived") q = q.not("archived_at", "is", null);
      if (body.status) q = q.eq("status", String(body.status));
      if (body.kind) q = q.eq("kind", String(body.kind));
      if (body.case_id) q = q.eq("case_id", String(body.case_id));
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      const rows = (data ?? []).map((r: any) => redactSmr(r));
      return jr({ reports: rows });
    }
    if (op === "get_report") {
      const id = String(body.id ?? "");
      const [{ data: report }, { data: versions }, { data: submissions }] = await Promise.all([
        aml.from("reports").select("*").eq("id", id).maybeSingle(),
        aml.from("report_versions").select("*").eq("report_id", id).order("version", { ascending: false }),
        aml.from("report_submissions").select("*, receipts:report_receipts(*)").eq("report_id", id).order("submitted_at", { ascending: false }),
      ]);
      const safeReport = redactSmr(report as any);
      const safeVersions = (versions ?? []).map((v: any) => (report?.kind === "smr" && isAuditorOnly) ? { ...v, narrative: null, snapshot: { redacted: true } } : v);
      return jr({ report: safeReport, versions: safeVersions, submissions: submissions ?? [] });
    }

    // ── DRAFT WRITES ─────────────────────────────
    if (op === "upsert_report") {
      requireWrite();
      const r = body.report ?? {};
      if (!r.kind || !r.title) return jr({ error: "kind and title required" }, 400);
      const row: any = {
        ...r,
        drafted_by: r.id ? r.drafted_by : userId,
      };
      // Never allow client to short-circuit MLRO fields or terminal lifecycle state on upsert.
      delete row.mlro_signed_by; delete row.mlro_signed_at;
      delete row.submitted_at; delete row.submitted_by; delete row.acknowledged_at;
      /*
        Nor the archive stamp. `upsert_report` spreads the caller's object, so
        without this a client could archive a report by SAVING it — straight
        past `archiveBlockReason`, which is the one guard that stops an
        approved-but-unlodged report being hidden while its deadline runs.
        Archiving has its own op precisely so it has its own rule.
      */
      delete row.archived_at; delete row.archived_by;
      if (typeof row.status === "string" && !DRAFT_REPORT_STATUSES.has(row.status)) {
        return jr({ error: "Report status changes to approved, submitted, acknowledged, rejected, or withdrawn must use the MLRO workflow" }, 403);
      }
      if (r.id) {
        const { data: existing } = await aml.from("reports").select("status").eq("id", String(r.id)).maybeSingle();
        if (!existing) return jr({ error: "Report not found" }, 404);
        if (!DRAFT_REPORT_STATUSES.has(existing.status)) {
          return jr({ error: "Approved, submitted, acknowledged, rejected, or withdrawn reports cannot be changed via draft upsert" }, 403);
        }
      }
      const q = r.id
        ? aml.from("reports").update(row).eq("id", r.id).select("*").single()
        : aml.from("reports").insert(row).select("*").single();
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      await appendVersion(admin, data.id, { title: data.title, narrative: data.narrative, payload: data.payload, kind: data.kind, reporting_period_start: data.reporting_period_start, reporting_period_end: data.reporting_period_end }, data.narrative ?? null, body.change_note ?? (r.id ? "Draft updated" : "Draft created"), userId, userLabel);
      await appendCaseEvent(admin, data.case_id, "system", `AUSTRAC ${data.kind.toUpperCase()} ${r.id ? "updated" : "drafted"}: ${data.title}`, { report_id: data.id }, userId, userLabel);
      return jr({ report: data });
    }

    if (op === "delete_report") {
      requireWrite();
      const { data: existing } = await aml.from("reports").select("id, status, case_id, kind, title").eq("id", String(body.id)).maybeSingle();
      if (!existing) return jr({ error: "Not found" }, 404);
      if (TERMINAL_REPORT_STATUSES.has(existing.status)) return jr({ error: "Cannot delete an approved, submitted, acknowledged, rejected, or withdrawn report" }, 400);
      const { error } = await aml.from("reports").delete().eq("id", existing.id);
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, existing.case_id, "system", `AUSTRAC ${existing.kind.toUpperCase()} draft deleted: ${existing.title}`, { report_id: existing.id }, userId, userLabel);
      return jr({ ok: true });
    }

    // ── VERSIONS ─────────────────────────────────
    if (op === "list_versions") {
      const { data, error } = await aml.from("report_versions").select("*").eq("report_id", String(body.report_id)).order("version", { ascending: false });
      if (error) return jr({ error: error.message }, 400);
      return jr({ versions: data ?? [] });
    }
    if (op === "create_version") {
      requireWrite();
      const { data: report } = await aml.from("reports").select("*").eq("id", String(body.report_id)).maybeSingle();
      if (!report) return jr({ error: "Report not found" }, 404);
      const v = await appendVersion(admin, report.id, body.snapshot ?? { title: report.title, narrative: report.narrative, payload: report.payload }, body.narrative ?? report.narrative ?? null, body.change_note ?? null, userId, userLabel);
      return jr({ version: v });
    }

    // ── MLRO SIGN-OFF ────────────────────────────
    if (op === "mlro_signoff") {
      requireMlro();
      const { data: report } = await aml.from("reports").select("*").eq("id", String(body.id)).maybeSingle();
      if (!report) return jr({ error: "Report not found" }, 404);
      if (!["draft", "in_review", "awaiting_mlro"].includes(report.status)) return jr({ error: `Cannot sign off from ${report.status}` }, 400);
      const { data, error } = await aml.from("reports").update({
        status: "approved",
        mlro_signed_by: userId,
        mlro_signed_at: new Date().toISOString(),
      }).eq("id", report.id).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      await appendVersion(admin, data.id, { snapshot: "mlro_signoff", title: data.title, narrative: data.narrative, payload: data.payload }, data.narrative ?? null, body.note ?? "MLRO sign-off", userId, userLabel);
      await appendCaseEvent(admin, data.case_id, "mlro_decision", `MLRO signed off ${data.kind.toUpperCase()} report`, { report_id: data.id }, userId, userLabel);
      return jr({ report: data });
    }
    if (op === "mlro_reject") {
      requireMlro();
      const { data, error } = await aml.from("reports").update({
        status: "draft",
        mlro_signed_by: null,
        mlro_signed_at: null,
        metadata: { last_reject_reason: body.reason ?? null, last_reject_at: new Date().toISOString() },
      }).eq("id", String(body.id)).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, data.case_id, "mlro_decision", `MLRO rejected ${data.kind.toUpperCase()} report`, { report_id: data.id, reason: body.reason ?? null }, userId, userLabel);
      return jr({ report: data });
    }
    if (op === "withdraw_report") {
      requireMlro();
      const { data, error } = await aml.from("reports").update({ status: "withdrawn" }).eq("id", String(body.id)).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, data.case_id, "system", `AUSTRAC ${data.kind.toUpperCase()} withdrawn`, { report_id: data.id, reason: body.reason ?? null }, userId, userLabel);
      return jr({ report: data });
    }

    // ── SUBMISSIONS ──────────────────────────────
    if (op === "submit_record") {
      requireMlro();
      const stepUpErr = await requireStepUpSession({
        admin, userId, capability: "aml.report",
        token: body.step_up_session_token, headers: req.headers,
      });
      if (stepUpErr) return stepUpErr;
      const { data: report } = await aml.from("reports").select("*").eq("id", String(body.report_id)).maybeSingle();
      if (!report) return jr({ error: "Report not found" }, 404);
      if (report.status !== "approved") return jr({ error: "Report must be MLRO-approved before recording a submission" }, 400);

      // ── Phase 11 gate: cannot mark submitted without evidence ──
      const extRef = String(body.external_reference ?? "").trim();
      const bundlePath = String(body.export_bundle_path ?? "").trim();
      const responseHasEvidence = body.response_payload && typeof body.response_payload === "object" &&
        (body.response_payload.evidence || body.response_payload.attachment_url || body.response_payload.lodgement_id);
      if (!extRef && !bundlePath && !responseHasEvidence) {
        return jr({ error: "Submission evidence required: provide AUSTRAC external reference, an export bundle path, or attach evidence in response_payload." }, 400);
      }
      if (report.kind === "smr" && !extRef) {
        return jr({ error: "SMR submissions require the AUSTRAC lodgement reference (external_reference)." }, 400);
      }
      if (body.attest_no_tipping_off !== true) {
        return jr({ error: "MLRO must attest to no tipping-off breach (attest_no_tipping_off=true)." }, 400);
      }

      const { data: latestVersion } = await aml.from("report_versions").select("version, content_hash").eq("report_id", report.id).order("version", { ascending: false }).limit(1).maybeSingle();
      const now = new Date().toISOString();
      const attestation = {
        attested_by: userId, attested_label: userLabel, attested_at: now,
        no_tipping_off: true, evidence_source: extRef ? "external_reference" : bundlePath ? "export_bundle" : "response_payload",
      };
      const submissionInsert = {
        report_id: report.id,
        version: latestVersion?.version ?? 1,
        channel: body.channel ?? "austrac_online",
        status: body.status ?? "submitted",
        external_reference: extRef || null,
        submitted_by: userId,
        submitted_at: now,
        response_payload: { ...(body.response_payload ?? {}), attestation },
        export_bundle_path: bundlePath || null,
        content_hash: latestVersion?.content_hash ?? null,
        notes: body.notes ?? null,
      };
      const { data: submission, error: subErr } = await aml.from("report_submissions").insert(submissionInsert).select("*").single();
      if (subErr) return jr({ error: subErr.message }, 400);
      await aml.from("reports").update({
        status: "submitted",
        submitted_at: now,
        submitted_by: userId,
        metadata: { ...(report.metadata ?? {}), last_submission_attestation: attestation },
      }).eq("id", report.id);
      // Case-event payload is marked restricted for SMR to keep it out of finance/portal renderers.
      const eventPayload: any = { report_id: report.id, submission_id: submission.id, external_reference: submission.external_reference };
      if (report.kind === "smr") eventPayload.restricted = true;
      await appendCaseEvent(admin, report.case_id, "system", `AUSTRAC ${report.kind.toUpperCase()} submitted via ${submission.channel}`, eventPayload, userId, userLabel);
      return jr({ submission });
    }


    if (op === "record_receipt") {
      requireMlro();
      const { data: submission } = await aml.from("report_submissions").select("*, report:reports(id, case_id, kind, title)").eq("id", String(body.submission_id)).maybeSingle();
      if (!submission) return jr({ error: "Submission not found" }, 404);
      if (!body.receipt_reference) return jr({ error: "receipt_reference required" }, 400);
      const now = new Date().toISOString();
      const { data: receipt, error: rErr } = await aml.from("report_receipts").insert({
        submission_id: submission.id,
        receipt_reference: String(body.receipt_reference),
        received_at: body.received_at ?? now,
        status: body.status ?? "acknowledged",
        receipt_payload: body.receipt_payload ?? {},
        captured_by: userId,
        notes: body.notes ?? null,
      }).select("*").single();
      if (rErr) return jr({ error: rErr.message }, 400);
      const newSubStatus = body.status === "rejected" ? "rejected" : "acknowledged";
      await aml.from("report_submissions").update({ status: newSubStatus }).eq("id", submission.id);
      const newReportStatus = body.status === "rejected" ? "rejected" : "acknowledged";
      const updates: any = { status: newReportStatus };
      if (newReportStatus === "acknowledged") updates.acknowledged_at = now;
      await aml.from("reports").update(updates).eq("id", submission.report_id);
      const rep = (submission as any).report;
      await appendCaseEvent(admin, rep?.case_id ?? null, "system", `AUSTRAC ${rep?.kind?.toUpperCase() ?? ""} receipt captured: ${receipt.receipt_reference}`, { submission_id: submission.id, status: newSubStatus }, userId, userLabel);
      return jr({ receipt });
    }

    // ── ARCHIVE ──────────────────────────────────
    /*
      Archiving is not deleting. `delete_report` refuses anything past the
      draft statuses because a lodged report is a retained record kept for
      seven years with the evidence behind it — so this stamps the row and
      keeps every byte of it: the row, its versions, its submissions, its
      receipts and its case events. It is reversible, and both directions are
      written to the customer's case timeline.

      The rule it enforces is `archiveBlockReason`, which the register renders
      from as well: a report may be archived only once NOTHING IS OWED TO
      AUSTRAC. An archive that can hide an approved-but-unlodged suspicious
      matter report is not a tidy-up feature, it is a way to lose a statutory
      deadline.
    */
    if (op === "archive_report") {
      requireWrite();
      const { data: existing } = await aml.from("reports")
        .select("id, status, case_id, kind, title, archived_at").eq("id", String(body.id)).maybeSingle();
      if (!existing) return jr({ error: "Report not found" }, 404);
      if (existing.archived_at) return jr({ report: existing });
      const blocked = archiveBlockReason(existing.status);
      if (blocked) return jr({ error: blocked }, 400);
      const { data, error } = await aml.from("reports").update({
        archived_at: new Date().toISOString(), archived_by: userId,
      }).eq("id", existing.id).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, data.case_id, "system",
        `AUSTRAC ${data.kind.toUpperCase()} report archived: ${data.title}`,
        { report_id: data.id, status: data.status }, userId, userLabel);
      return jr({ report: redactSmr(data) });
    }

    if (op === "restore_report") {
      requireWrite();
      const { data: existing } = await aml.from("reports")
        .select("id, case_id, kind, title, archived_at").eq("id", String(body.id)).maybeSingle();
      if (!existing) return jr({ error: "Report not found" }, 404);
      if (!existing.archived_at) return jr({ report: existing });
      const { data, error } = await aml.from("reports").update({
        archived_at: null, archived_by: null,
      }).eq("id", existing.id).select("*").single();
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, data.case_id, "system",
        `AUSTRAC ${data.kind.toUpperCase()} report restored to the register: ${data.title}`,
        { report_id: data.id, status: data.status }, userId, userLabel);
      return jr({ report: redactSmr(data) });
    }

    // ── EXPORT ───────────────────────────────────
    if (op === "export_bundle") {
      // Read-only: returns a signed JSON bundle suitable for archiving alongside the AUSTRAC submission.
      const { data: report } = await aml.from("reports").select("*").eq("id", String(body.id)).maybeSingle();
      if (!report) return jr({ error: "Report not found" }, 404);
      const { data: versions } = await aml.from("report_versions").select("*").eq("report_id", report.id).order("version");
      const { data: submissions } = await aml.from("report_submissions").select("*, receipts:report_receipts(*)").eq("report_id", report.id).order("submitted_at");
      const bundle = {
        report, versions: versions ?? [], submissions: submissions ?? [],
        exported_at: new Date().toISOString(), exported_by: userLabel ?? userId,
      };
      const contentHash = await sha256Hex(JSON.stringify(bundle));
      return jr({ bundle, content_hash: contentHash });
    }

    // ── SUMMARY ──────────────────────────────────
    if (op === "summary") {
      // The tiles count the WORKING register. An archived report is a
      // retained record rather than an outstanding one, and counting it
      // would put a number beside a row nobody can see.
      const live = () => aml.from("reports").select("id", { count: "exact", head: true }).is("archived_at", null);
      const [draft, awaiting, approved, submitted, ackd, rejected, archivedCount] = await Promise.all([
        live().eq("status", "draft"),
        live().in("status", ["in_review", "awaiting_mlro"]),
        live().eq("status", "approved"),
        live().eq("status", "submitted"),
        live().eq("status", "acknowledged"),
        live().eq("status", "rejected"),
        aml.from("reports").select("id", { count: "exact", head: true }).not("archived_at", "is", null),
      ]);
      return jr({
        draft: draft.count ?? 0,
        awaiting_mlro: awaiting.count ?? 0,
        approved: approved.count ?? 0,
        submitted: submitted.count ?? 0,
        acknowledged: ackd.count ?? 0,
        rejected: rejected.count ?? 0,
        archived: archivedCount.count ?? 0,
      });
    }

    return jr({ error: `Unknown op: ${op}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("aml-reporting error", e);
    return jr({ ...internalError(e, 'aml-reporting') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
