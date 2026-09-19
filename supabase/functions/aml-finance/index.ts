/**
 * Phase 7 — Finance Portal Loan & Funding Integration.
 *
 * Ops (POST {op, ...args}):
 *   Comparisons:    list_comparisons, get_comparison, upsert_comparison, delete_comparison,
 *                   import_from_purchase_file
 *   Discrepancies:  list_discrepancies, upsert_discrepancy, resolve_discrepancy, delete_discrepancy,
 *                   recompute_discrepancies
 *   Evidence:       list_evidence, add_evidence, delete_evidence
 *   Limited view:   limited_status (returns status pill only for finance-portal panel)
 *
 * Reads: any AML role (limited_status requires AML role and is scoped by purchase_file_id/client_id).
 * Writes: analyst/reviewer/mlro.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token, x-finance-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jr = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function normalizeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function appendCaseEvent(
  admin: any, caseId: string, category: string, summary: string,
  payload: any, actorId: string | null, actorLabel: string | null,
) {
  const { data: prev } = await admin.schema("aml").from("case_events")
    .select("row_hash").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({
    case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, created_at: now,
  }));
  await admin.schema("aml").from("case_events").insert({
    case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
}

// Phase 7: the comparison type + deterministic discrepancy engine moved to
// _shared/amlFinanceEngine.ts so finance-portal submissions run through the
// exact same reconciliation as staff-entered snapshots.
import { detectDiscrepancies, type Comparison } from "../_shared/amlFinanceEngine.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { pickAllowed } from '../_shared/wp09Guards.ts';
import { EVIDENCE_REFERENCE_WRITABLE, FINANCE_COMPARISON_WRITABLE } from '../_shared/amlWritableColumns.ts';

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
    const opPre = String(body?.op ?? "");

    // AML case snapshots are restricted to the Command Centre. Do not mint or
    // redeem finance-portal bearer tokens from this service-role function.
    if (opPre === "create_case_handoff" || opPre === "redeem_case_handoff") {
      return jr({ error: "AML case snapshots are not available in the finance portal" }, 403);
    }

    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;
    const userLabel = auth.username ?? null;
    const op = opPre;

    // Limited status endpoint — AML role required because case state is AML data.
    // Phase 1 finance-safe contract (directive Appendix C.2): returns only the
    // finance-portal dimension and gate-derived readiness. Raw risk_rating,
    // screening and internal case state are excluded from the server response —
    // removed at the contract, not hidden in the UI.
    if (op === "limited_status") {
      const { data: hasAmlRole } = await admin.rpc("has_any_aml_role", { _user_id: userId });
      if (!hasAmlRole) return jr({ error: "AML role required" }, 403);

      const pfId = body.purchase_file_id ? String(body.purchase_file_id) : null;
      const clientId = body.client_id ? String(body.client_id) : null;
      if (!pfId && !clientId) return jr({ error: "purchase_file_id or client_id required" }, 400);

      // select('*') tolerates environments where the Phase 1 dimension
      // migration has not been applied yet; fallbacks below cover both shapes.
      let q = aml.from("cases").select("*");
      if (pfId) q = q.eq("purchase_file_id", pfId);
      else if (clientId) q = q.eq("client_id", clientId);
      const { data: rows } = await q.order("updated_at", { ascending: false }).limit(1);
      const c = (rows ?? [])[0] ?? null;
      if (!c) {
        return jr({
          finance_status: "not_requested",
          service_readiness: "service_not_ready",
          open_finance_discrepancies: 0,
          updated_at: null,
        });
      }

      // Count open discrepancies without leaking detail.
      const { count } = await aml.from("finance_discrepancies")
        .select("id", { count: "exact", head: true })
        .eq("case_id", c.id).in("status", ["open", "under_review", "escalated"]);

      const FINANCE_STATUSES = [
        "not_requested", "information_required", "submitted", "clarification_required",
        "under_review", "accepted", "no_further_action",
      ];
      const GATE_READY = new Set(["approved", "approved_with_controls"]);
      // Legacy fallback: only a cleared case reads as an approved gate.
      const gate = typeof c.service_gate_status === "string" && c.service_gate_status
        ? c.service_gate_status
        : (c.status === "cleared" ? "approved" : "not_activated");
      const financeStatus = FINANCE_STATUSES.includes(c.finance_portal_status)
        ? c.finance_portal_status
        : "not_requested";

      return jr({
        finance_status: financeStatus,
        service_readiness: GATE_READY.has(gate) ? "service_ready" : "service_not_ready",
        open_finance_discrepancies: count ?? 0,
        updated_at: c.updated_at ?? null,
      });
    }



    // duplicate_document_refs: scans evidence_references + finance_comparisons.raw_payload
    //   for identical document reference IDs shared across cases belonging to DIFFERENT clients
    //   and records `duplicate_doc_ref` discrepancies against every affected case.
    if (op === "duplicate_document_refs") {
      // Requires an AML role (analyst/reviewer/mlro). Inline check because this op
      // sits above the general role gate to keep the file's cross-portal ops grouped.
      const { data: hasAmlRole } = await admin.rpc("has_any_aml_role", { _user_id: userId });
      if (!hasAmlRole) return jr({ error: "AML role required" }, 403);
      const { data: rolesRows2 } = await aml.from("role_assignments")
        .select("role").eq("user_id", userId).is("revoked_at", null);
      const rset = new Set<string>((rolesRows2 ?? []).map((r: any) => r.role));
      const dupCanWrite = rset.has("analyst") || rset.has("reviewer") || rset.has("mlro");
      const scopeCase = body.case_id ? String(body.case_id) : null;

      // Pull evidence rows keyed by reference_id
      let q = aml.from("evidence_references")
        .select("case_id, reference_id, reference_type, label")
        .not("reference_id", "is", null);
      if (scopeCase) {
        // include the scoped case AND any other case sharing its refs
        const { data: scopedRefs } = await aml.from("evidence_references")
          .select("reference_id").eq("case_id", scopeCase).not("reference_id", "is", null);
        const refs = Array.from(new Set((scopedRefs ?? []).map((r: any) => r.reference_id).filter(Boolean)));
        if (refs.length === 0) return jr({ duplicates: [], discrepancies_created: 0 });
        q = q.in("reference_id", refs);
      }
      const { data: rows, error } = await q;
      if (error) return jr({ error: error.message }, 400);

      // Group by reference_id
      const byRef = new Map<string, Array<{ case_id: string; reference_type: string; label: string }>>();
      for (const r of rows ?? []) {
        if (!r.reference_id) continue;
        const list = byRef.get(r.reference_id) ?? [];
        list.push({ case_id: r.case_id, reference_type: r.reference_type, label: r.label });
        byRef.set(r.reference_id, list);
      }

      // Resolve client_id per case to detect *cross-client* duplicates
      const allCaseIds = Array.from(new Set((rows ?? []).map((r: any) => r.case_id)));
      const { data: caseMap } = await aml.from("cases")
        .select("id, client_id").in("id", allCaseIds);
      const caseToClient = new Map<string, string>((caseMap ?? []).map((c: any) => [c.id, c.client_id]));

      const duplicates: any[] = [];
      let created = 0;
      const auth2 = dupCanWrite;
      for (const [refId, list] of byRef) {
        if (list.length < 2) continue;
        const distinctClients = new Set(list.map((l) => caseToClient.get(l.case_id) ?? "?"));
        if (distinctClients.size < 2) continue; // only cross-client dupes are risk-relevant

        duplicates.push({
          reference_id: refId,
          reference_type: list[0].reference_type,
          label: list[0].label,
          case_count: list.length,
          client_count: distinctClients.size,
          case_ids: Array.from(new Set(list.map((l) => l.case_id))),
        });

        if (auth2) {
          for (const caseId of new Set(list.map((l) => l.case_id))) {
            // Skip if we already recorded an open duplicate for this ref on this case
            const { data: existing } = await aml.from("finance_discrepancies")
              .select("id").eq("case_id", caseId).eq("kind", "duplicate_doc_ref")
              .contains("observed_value", { reference_id: refId } as any)
              .in("status", ["open", "under_review", "escalated"]).maybeSingle();
            if (existing) continue;

            await aml.from("finance_discrepancies").insert({
              case_id: caseId,
              kind: "duplicate_doc_ref",
              severity: "high",
              summary: `Document reference "${list[0].label}" (${list[0].reference_type}) is attached to ${distinctClients.size} different clients`,
              detail: "Cross-case duplicate of the same document reference across multiple client cases — investigate for identity theft, doc-shopping, or misfiled evidence.",
              observed_value: { reference_id: refId, case_count: list.length, client_count: distinctClients.size },
              detected_by: "system_dup_scan",
            });
            await appendCaseEvent(
              admin, caseId, "edd_note",
              `Duplicate document reference detected across ${distinctClients.size} clients`,
              { reference_id: refId }, userId, userLabel,
            );
            created++;
          }
        }
      }

      return jr({ duplicates, discrepancies_created: created });
    }


    // All other ops require an AML role.
    const { data: hasAny } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasAny) return jr({ error: "AML role required" }, 403);

    const { data: roleRows } = await aml.from("role_assignments")
      .select("role").eq("user_id", userId).is("revoked_at", null);
    const roles = new Set<string>((roleRows ?? []).map((r: any) => r.role));
    const canWrite = roles.has("analyst") || roles.has("reviewer") || roles.has("mlro");
    const requireWrite = () => {
      if (!canWrite) throw new Response(JSON.stringify({ error: "Insufficient permissions" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    };

    // ── COMPARISONS ────────────────────────────────────────
    if (op === "list_comparisons") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const { data, error } = await aml.from("finance_comparisons")
        .select("*").eq("case_id", caseId).order("captured_at", { ascending: false });
      if (error) return jr({ error: error.message }, 400);
      return jr({ comparisons: data ?? [] });
    }

    if (op === "get_comparison") {
      const id = String(body.id ?? "");
      const { data, error } = await aml.from("finance_comparisons").select("*").eq("id", id).maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ comparison: data });
    }

    if (op === "upsert_comparison") {
      requireWrite();
      const payload: Comparison = body.comparison ?? {};
      if (!payload.case_id) return jr({ error: "case_id required" }, 400);

      const { data: prevList } = await aml.from("finance_comparisons")
        .select("*").eq("case_id", payload.case_id).order("captured_at", { ascending: false }).limit(1);
      const previous = (prevList ?? [])[0] ?? null;

      let pfRow: any = null;
      if (payload.purchase_file_id) {
        const { data: pf } = await admin.from("purchase_files")
          .select("id, purchase_price, lender, finance_status, title")
          .eq("id", payload.purchase_file_id).maybeSingle();
        pfRow = pf;
      }

      const row = {
        ...payload,
        captured_by: userId,
        source: payload.source ?? "manual_entry",
        raw_payload: payload.raw_payload ?? {},
        smsf_details: payload.smsf_details ?? {},
      };
      // WP-24: only declared columns. `row` spreads the caller's payload, so
      // without this any column the caller named was written — including
      // `captured_by`, which is stamped just above from the verified session.
      const comparisonRow = { ...pickAllowed(row, FINANCE_COMPARISON_WRITABLE), captured_by: userId };
      const upsertResp = payload.id
        ? await aml.from("finance_comparisons").update(comparisonRow).eq("id", payload.id).select("*").maybeSingle()
        : await aml.from("finance_comparisons").insert(comparisonRow).select("*").maybeSingle();
      if (upsertResp.error) return jr({ error: upsertResp.error.message }, 400);
      const comparison = upsertResp.data;

      // Detect and persist discrepancies.
      const detected = detectDiscrepancies(comparison, previous, pfRow);
      let created = 0;
      for (const d of detected) {
        await aml.from("finance_discrepancies").insert({
          case_id: comparison.case_id, comparison_id: comparison.id,
          kind: d.kind, severity: d.severity, summary: d.summary, detail: d.detail ?? null,
          expected_value: d.expected_value ?? null, observed_value: d.observed_value ?? null,
          detected_by: "system",
        });
        created++;
      }

      await appendCaseEvent(
        admin, comparison.case_id, "system",
        payload.id ? "Finance comparison updated" : "Finance comparison captured",
        { comparison_id: comparison.id, discrepancies_created: created, source: comparison.source },
        userId, userLabel,
      );
      return jr({ comparison, discrepancies_created: created });
    }

    if (op === "delete_comparison") {
      requireWrite();
      const id = String(body.id ?? "");
      const { data: existing } = await aml.from("finance_comparisons").select("case_id").eq("id", id).maybeSingle();
      const { error } = await aml.from("finance_comparisons").delete().eq("id", id);
      if (error) return jr({ error: error.message }, 400);
      if (existing?.case_id) {
        await appendCaseEvent(admin, existing.case_id, "system", "Finance comparison deleted", { id }, userId, userLabel);
      }
      return jr({ ok: true });
    }

    if (op === "import_from_purchase_file") {
      requireWrite();
      const caseId = String(body.case_id ?? "");
      const pfId = String(body.purchase_file_id ?? "");
      if (!caseId || !pfId) return jr({ error: "case_id and purchase_file_id required" }, 400);

      const { data: caseRow, error: caseErr } = await aml.from("cases")
        .select("id, client_id, purchase_file_id")
        .eq("id", caseId).maybeSingle();
      if (caseErr || !caseRow) return jr({ error: "case not found" }, 404);

      const { data: pf, error: pfErr } = await admin.from("purchase_files")
        .select("id, client_id, purchase_price, lender, finance_status, title, max_approved_budget")
        .eq("id", pfId).maybeSingle();
      if (pfErr || !pf) return jr({ error: "purchase file not found" }, 404);
      if (String(caseRow.client_id) !== String(pf.client_id)) {
        return jr({ error: "purchase file is not linked to this AML case client" }, 403);
      }
      if (caseRow.purchase_file_id && String(caseRow.purchase_file_id) !== pfId) {
        return jr({ error: "purchase file is not linked to this AML case" }, 403);
      }

      // Latest lender submission for loan amount / LVR.
      const { data: subs } = await admin.from("lender_submissions")
        .select("loan_amount, lender_name, lvr, submitted_at")
        .eq("purchase_file_id", pfId).order("submitted_at", { ascending: false, nullsFirst: false }).limit(1);
      const sub = (subs ?? [])[0] ?? null;

      const payload: Comparison = {
        case_id: caseId,
        purchase_file_id: pfId,
        source: "finance_portal",
        purchase_price: pf.purchase_price ?? null,
        loan_amount: sub?.loan_amount ?? pf.max_approved_budget ?? null,
        lender: sub?.lender_name ?? pf.lender ?? null,
        lvr: sub?.lvr ?? null,
        raw_payload: { purchase_file: pf, latest_submission: sub },
      };

      // Call our own upsert path via internal call.
      const { data: prevList } = await aml.from("finance_comparisons")
        .select("*").eq("case_id", caseId).order("captured_at", { ascending: false }).limit(1);
      const previous = (prevList ?? [])[0] ?? null;

      const { data: comp, error: cErr } = await aml.from("finance_comparisons")
        .insert({ ...payload, captured_by: userId }).select("*").maybeSingle();
      if (cErr) return jr({ error: cErr.message }, 400);

      const detected = detectDiscrepancies(comp, previous, pf);
      for (const d of detected) {
        await aml.from("finance_discrepancies").insert({
          case_id: caseId, comparison_id: comp.id,
          kind: d.kind, severity: d.severity, summary: d.summary, detail: d.detail ?? null,
          expected_value: d.expected_value ?? null, observed_value: d.observed_value ?? null,
          detected_by: "system",
        });
      }
      await appendCaseEvent(admin, caseId, "system", "Imported finance data from purchase file",
        { purchase_file_id: pfId, comparison_id: comp.id, discrepancies_created: detected.length },
        userId, userLabel);
      return jr({ comparison: comp, discrepancies_created: detected.length });
    }

    // ── DISCREPANCIES ──────────────────────────────────────
    if (op === "list_discrepancies") {
      const caseId = body.case_id ? String(body.case_id) : null;
      const status = body.status ? String(body.status) : null;
      const severity = body.severity ? String(body.severity) : null;
      let q = aml.from("finance_discrepancies").select("*");
      if (caseId) q = q.eq("case_id", caseId);
      if (status) q = q.eq("status", status);
      if (severity) q = q.eq("severity", severity);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(500);
      if (error) return jr({ error: error.message }, 400);
      return jr({ discrepancies: data ?? [] });
    }

    if (op === "upsert_discrepancy") {
      requireWrite();
      const d = body.discrepancy ?? {};
      if (!d.case_id || !d.summary || !d.kind) return jr({ error: "case_id, kind, summary required" }, 400);
      const row = { ...d, detected_by: d.detected_by ?? "manual" };
      const resp = d.id
        ? await aml.from("finance_discrepancies").update(row).eq("id", d.id).select("*").maybeSingle()
        : await aml.from("finance_discrepancies").insert(row).select("*").maybeSingle();
      if (resp.error) return jr({ error: resp.error.message }, 400);
      await appendCaseEvent(admin, d.case_id, "edd_note",
        d.id ? "Discrepancy updated" : "Discrepancy recorded",
        { id: resp.data?.id, kind: d.kind, severity: d.severity }, userId, userLabel);
      return jr({ discrepancy: resp.data });
    }

    if (op === "resolve_discrepancy") {
      requireWrite();
      const id = String(body.id ?? "");
      const status = String(body.status ?? "resolved");
      const note = body.resolution_note ? String(body.resolution_note) : null;
      const { data, error } = await aml.from("finance_discrepancies")
        .update({ status, resolution_note: note, resolved_by: userId, resolved_at: new Date().toISOString() })
        .eq("id", id).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      if (data?.case_id) {
        await appendCaseEvent(admin, data.case_id, "edd_note",
          `Discrepancy ${status}`, { id, kind: data.kind, note }, userId, userLabel);
      }
      return jr({ discrepancy: data });
    }

    if (op === "delete_discrepancy") {
      requireWrite();
      const id = String(body.id ?? "");
      const { data: existing } = await aml.from("finance_discrepancies").select("case_id").eq("id", id).maybeSingle();
      const { error } = await aml.from("finance_discrepancies").delete().eq("id", id);
      if (error) return jr({ error: error.message }, 400);
      if (existing?.case_id) {
        await appendCaseEvent(admin, existing.case_id, "system", "Discrepancy deleted", { id }, userId, userLabel);
      }
      return jr({ ok: true });
    }

    if (op === "recompute_discrepancies") {
      requireWrite();
      const compId = String(body.comparison_id ?? "");
      const { data: comp } = await aml.from("finance_comparisons").select("*").eq("id", compId).maybeSingle();
      if (!comp) return jr({ error: "comparison not found" }, 404);
      const { data: prevList } = await aml.from("finance_comparisons")
        .select("*").eq("case_id", comp.case_id).lt("captured_at", comp.captured_at)
        .order("captured_at", { ascending: false }).limit(1);
      let pfRow: any = null;
      if (comp.purchase_file_id) {
        const { data: pf } = await admin.from("purchase_files")
          .select("id, purchase_price, lender").eq("id", comp.purchase_file_id).maybeSingle();
        pfRow = pf;
      }
      const detected = detectDiscrepancies(comp, (prevList ?? [])[0] ?? null, pfRow);
      for (const d of detected) {
        await aml.from("finance_discrepancies").insert({
          case_id: comp.case_id, comparison_id: comp.id,
          kind: d.kind, severity: d.severity, summary: d.summary, detail: d.detail ?? null,
          expected_value: d.expected_value ?? null, observed_value: d.observed_value ?? null,
          detected_by: "system_recompute",
        });
      }
      return jr({ discrepancies_created: detected.length });
    }

    // ── EVIDENCE ───────────────────────────────────────────
    if (op === "list_evidence") {
      const caseId = String(body.case_id ?? "");
      const { data, error } = await aml.from("evidence_references")
        .select("*").eq("case_id", caseId).order("created_at", { ascending: false });
      if (error) return jr({ error: error.message }, 400);
      return jr({ evidence: data ?? [] });
    }

    if (op === "add_evidence") {
      requireWrite();
      const ev = body.evidence ?? {};
      if (!ev.case_id || !ev.reference_type || !ev.label) {
        return jr({ error: "case_id, reference_type, label required" }, 400);
      }
      const externalUrl = ev.external_url == null || ev.external_url === ""
        ? null
        : normalizeExternalUrl(ev.external_url);
      if (ev.external_url != null && ev.external_url !== "" && !externalUrl) {
        return jr({ error: "external_url must be an absolute HTTP(S) URL" }, 400);
      }
      // WP-24: `external_url` is deliberately outside the allowlist so the
      // VALIDATED absolute URL below is the only one that can be written — an
      // allowlist that admitted the raw value would undo the check above it.
      const { data, error } = await aml.from("evidence_references")
        .insert({ ...pickAllowed(ev, EVIDENCE_REFERENCE_WRITABLE), external_url: externalUrl, added_by: userId })
        .select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, ev.case_id, "document_added",
        `Finance evidence attached: ${ev.label}`, { reference_type: ev.reference_type }, userId, userLabel);
      return jr({ evidence: data });
    }

    if (op === "delete_evidence") {
      requireWrite();
      const id = String(body.id ?? "");
      const { data: existing } = await aml.from("evidence_references").select("case_id, label").eq("id", id).maybeSingle();
      const { error } = await aml.from("evidence_references").delete().eq("id", id);
      if (error) return jr({ error: error.message }, 400);
      if (existing?.case_id) {
        await appendCaseEvent(admin, existing.case_id, "system", "Finance evidence removed", { id, label: existing.label }, userId, userLabel);
      }
      return jr({ ok: true });
    }

    // ── FINANCE REQUESTS (Phase 7, directive §15.4) ────────
    // Staff side of the Command Center ↔ Finance Portal loop. The request
    // message is finance-safe wording authored by staff; linked discrepancy
    // internals never travel with the request. The finance-portal dimension
    // (§15.3) is advanced explicitly at each step.
    const FINANCE_REQUEST_KINDS = new Set(["funding_information", "financial_evidence", "clarification"]);
    const setFinancePortalStatus = async (caseId: string, status: string) => {
      const { error } = await aml.from("cases")
        .update({ finance_portal_status: status }).eq("id", caseId);
      // Tolerate a not-yet-migrated environment (PGRST204 missing column) —
      // the legacy enum remains the compatibility source of truth there.
      if (error && !/finance_portal_status/.test(error.message ?? "")) throw error;
    };

    if (op === "list_finance_requests") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const { data, error } = await aml.from("finance_requests")
        .select("*").eq("case_id", caseId).order("created_at", { ascending: false });
      if (error) return jr({ error: error.message }, 400);
      return jr({ requests: data ?? [] });
    }

    if (op === "create_finance_request") {
      requireWrite();
      const reqBody = body.request ?? {};
      const caseId = String(reqBody.case_id ?? "");
      const kind = String(reqBody.kind ?? "");
      const subject = String(reqBody.subject ?? "").trim();
      const message = String(reqBody.message ?? "").trim();
      if (!caseId) return jr({ error: "request.case_id required" }, 400);
      if (!FINANCE_REQUEST_KINDS.has(kind)) return jr({ error: "request.kind invalid" }, 400);
      if (!subject || !message) return jr({ error: "request.subject and request.message are required" }, 400);

      const { data: caseRow } = await aml.from("cases")
        .select("id, client_id, purchase_file_id").eq("id", caseId).maybeSingle();
      if (!caseRow) return jr({ error: "Case not found" }, 404);
      const purchaseFileId = reqBody.purchase_file_id
        ? String(reqBody.purchase_file_id)
        : (caseRow.purchase_file_id ?? null);

      const { data: created, error: createErr } = await aml.from("finance_requests").insert({
        case_id: caseId,
        client_id: caseRow.client_id ?? null,
        purchase_file_id: purchaseFileId,
        kind, subject, message,
        discrepancy_id: reqBody.discrepancy_id ? String(reqBody.discrepancy_id) : null,
        status: "open",
        created_by: userId,
      }).select("*").maybeSingle();
      if (createErr) return jr({ error: createErr.message }, 400);

      await setFinancePortalStatus(caseId,
        kind === "clarification" ? "clarification_required" : "information_required");
      await appendCaseEvent(admin, caseId, "system",
        `Finance request sent: ${subject}`,
        { finance_request_id: created?.id, kind, purchase_file_id: purchaseFileId }, userId, userLabel);
      return jr({ request: created });
    }

    if (op === "review_finance_request") {
      requireWrite();
      const id = String(body.request_id ?? "");
      const { data: reqRow } = await aml.from("finance_requests")
        .select("id, case_id, status, subject").eq("id", id).maybeSingle();
      if (!reqRow) return jr({ error: "Request not found" }, 404);
      if (reqRow.status !== "submitted") return jr({ error: "Only submitted requests can move to review" }, 400);
      await setFinancePortalStatus(reqRow.case_id, "under_review");
      await appendCaseEvent(admin, reqRow.case_id, "system",
        `Finance submission under review: ${reqRow.subject}`,
        { finance_request_id: id }, userId, userLabel);
      return jr({ ok: true });
    }

    if (op === "resolve_finance_request") {
      requireWrite();
      const id = String(body.request_id ?? "");
      const outcome = String(body.outcome ?? "resolved");
      const financeStatusAfter = body.finance_status_after ? String(body.finance_status_after) : null;
      if (!["resolved", "cancelled"].includes(outcome)) return jr({ error: "outcome must be resolved or cancelled" }, 400);
      if (financeStatusAfter && !["under_review", "accepted", "no_further_action"].includes(financeStatusAfter)) {
        return jr({ error: "finance_status_after invalid" }, 400);
      }
      const { data: reqRow } = await aml.from("finance_requests")
        .select("id, case_id, status, subject").eq("id", id).maybeSingle();
      if (!reqRow) return jr({ error: "Request not found" }, 404);
      if (["resolved", "cancelled"].includes(reqRow.status)) return jr({ error: "Request already closed" }, 400);

      const { data: updated, error: updErr } = await aml.from("finance_requests").update({
        status: outcome,
        resolved_at: new Date().toISOString(),
        resolved_by: userId,
        resolution_note: body.resolution_note ? String(body.resolution_note) : null,
      }).eq("id", id).select("*").maybeSingle();
      if (updErr) return jr({ error: updErr.message }, 400);

      if (financeStatusAfter) await setFinancePortalStatus(reqRow.case_id, financeStatusAfter);
      await appendCaseEvent(admin, reqRow.case_id, "system",
        `Finance request ${outcome}: ${reqRow.subject}`,
        { finance_request_id: id, outcome, finance_status_after: financeStatusAfter }, userId, userLabel);
      return jr({ request: updated });
    }

    return jr({ error: `Unknown op: ${op}` }, 400);
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("aml-finance error", e);
    return jr({ ...internalError(e, 'aml-finance') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
