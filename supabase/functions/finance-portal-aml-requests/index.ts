/**
 * Finance Portal — AML information requests (Phase 7, directive §15).
 *
 * The broker-facing half of the finance reconciliation loop:
 *   list    — open + recent requests for clients assigned to this partner
 *   submit  — answer a funding-information request; the submission becomes a
 *             canonical aml.finance_comparisons row and runs through the same
 *             discrepancy engine as staff-entered snapshots
 *   respond — answer a clarification / evidence request with text and
 *             evidence descriptions
 *
 * Finance-safe contract (directive §15.1/§15.2): responses carry only the
 * request lifecycle and staff-authored wording. No case identifiers, no risk
 * or screening information, no discrepancy internals — differences detected
 * from a submission surface to the partner only as a later staff-authored
 * clarification request.
 *
 * Auth: finance-portal session token; scoping via
 * finance_portal_client_assignments (matches finance-portal-purchase-files).
 */
import { extractFinanceToken, makeServiceClient, resolveFinancePartner } from "../_shared/finance-portal-session.ts";
import { detectDiscrepancies, type Comparison } from "../_shared/amlFinanceEngine.ts";

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
// Dynamic per-request CORS (frontend uses credentials: 'include').
const ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token";
const EXPOSE_HEADERS = "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms";

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function appendCaseEvent(
  admin: any, caseId: string, category: string, summary: string,
  payload: any, actorLabel: string | null,
) {
  const { data: prev } = await admin.schema("aml").from("case_events")
    .select("row_hash").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({
    case_id: caseId, category, summary, payload, actor_id: null, actor_label: actorLabel, prev_hash: prevHash, created_at: now,
  }));
  await admin.schema("aml").from("case_events").insert({
    case_id: caseId, category, summary, payload, actor_id: null, actor_label: actorLabel,
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
}

/** The only request fields the finance portal ever sees (§15.1). */
function safeRequestProjection(r: any) {
  return {
    id: r.id,
    kind: r.kind,
    subject: r.subject,
    message: r.message,
    status: r.status,
    purchase_file_id: r.purchase_file_id,
    created_at: r.created_at,
    responded_at: r.responded_at,
  };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  const corsHeaders = {
    ...__createCorsHeaders(req.headers.get("origin")),
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Expose-Headers": EXPOSE_HEADERS,
  };
  const jr = (d: unknown, s = 200) =>
    new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = makeServiceClient();
    const body = await req.json().catch(() => ({}));
    const token = extractFinanceToken(req.headers, body);
    const session = await resolveFinancePartner(admin, token);
    if ("error" in session && session.error) return jr({ error: session.error }, session.status ?? 401);
    const portalUser = (session as any).portalUser;

    // Assignment scoping: a null purchase_file_id grants client-wide access;
    // otherwise the assignment is restricted to that exact purchase file.
    // Keep both dimensions here because this service-role-backed handler is
    // the authorization boundary for all request reads and writes.
    const { data: assignments } = await admin
      .from("finance_portal_client_assignments")
      .select("client_id, purchase_file_id")
      .eq("finance_user_id", portalUser.id);
    const allowedClients = new Set((assignments ?? []).map((a: any) => String(a.client_id)));
    if (allowedClients.size === 0) return jr({ requests: [] });

    const isAssignedRequest = (r: any) => Boolean(r.client_id) && (assignments ?? []).some((a: any) =>
      String(a.client_id) === String(r.client_id) &&
      (a.purchase_file_id == null || (
        r.purchase_file_id != null && String(a.purchase_file_id) === String(r.purchase_file_id)
      )),
    );

    const aml = admin.schema("aml");
    const op = String(body?.op ?? "");

    const loadScopedRequest = async (id: string) => {
      const { data: r } = await aml.from("finance_requests").select("*").eq("id", id).maybeSingle();
      if (!r) return null;
      if (!isAssignedRequest(r)) return null;
      return r;
    };

    if (op === "list") {
      const pfId = body.purchase_file_id ? String(body.purchase_file_id) : null;
      let q = aml.from("finance_requests").select("*")
        .in("client_id", Array.from(allowedClients))
        .order("created_at", { ascending: false }).limit(50);
      if (pfId) q = q.eq("purchase_file_id", pfId);
      const { data, error } = await q;
      if (error) return jr({ error: "Unable to load requests" }, 400);
      return jr({ requests: (data ?? []).filter(isAssignedRequest).map(safeRequestProjection) });
    }

    if (op === "submit") {
      const id = String(body.request_id ?? "");
      if (!id) return jr({ error: "request_id required" }, 400);
      const request = await loadScopedRequest(id);
      if (!request) return jr({ error: "Request not found" }, 404);
      if (!["open", "clarification_required"].includes(request.status)) {
        return jr({ error: "This request has already been completed" }, 400);
      }
      if (request.kind !== "funding_information") {
        return jr({ error: "Use respond for this request type" }, 400);
      }

      const f = body.funding ?? {};
      const comparison: Comparison = {
        case_id: request.case_id,
        purchase_file_id: request.purchase_file_id ?? null,
        source: "finance_portal",
        purchase_price: num(f.purchase_price),
        loan_amount: num(f.loan_amount),
        lender: f.lender ? String(f.lender).slice(0, 200) : null,
        lvr: num(f.lvr),
        borrower_contribution: num(f.borrower_contribution),
        refi_equity: num(f.refi_equity),
        gift_amount: num(f.gift_amount),
        gift_source: f.gift_source ? String(f.gift_source).slice(0, 500) : null,
        smsf_lrba: Boolean(f.smsf_lrba),
        smsf_details: f.smsf_details && typeof f.smsf_details === "object" ? f.smsf_details : {},
        loan_purpose: f.loan_purpose ? String(f.loan_purpose).slice(0, 500) : null,
        funding_notes: f.funding_notes ? String(f.funding_notes).slice(0, 2000) : null,
      };
      if (comparison.purchase_price == null && comparison.loan_amount == null) {
        return jr({ error: "Provide at least the purchase price or loan amount" }, 400);
      }

      // Canonical source record + the shared reconciliation engine — a broker
      // submission is compared exactly like a staff snapshot (§15.4 steps 4-6).
      const { data: prevList } = await aml.from("finance_comparisons")
        .select("*").eq("case_id", request.case_id)
        .order("captured_at", { ascending: false }).limit(1);
      let pfRow: any = null;
      if (request.purchase_file_id) {
        const { data } = await admin.from("purchase_files")
          .select("purchase_price, lender").eq("id", request.purchase_file_id).maybeSingle();
        pfRow = data ?? null;
      }
      const { data: created, error: compErr } = await aml.from("finance_comparisons").insert({
        ...comparison,
        raw_payload: { submitted_via: "finance_portal", finance_request_id: request.id, partner_label: portalUser.email ?? null },
      }).select("id").maybeSingle();
      if (compErr) return jr({ error: "Unable to record the submission" }, 400);

      const detected = detectDiscrepancies(comparison, (prevList ?? [])[0] ?? null, pfRow);
      for (const d of detected) {
        await aml.from("finance_discrepancies").insert({
          case_id: request.case_id, comparison_id: created?.id ?? null,
          kind: d.kind, severity: d.severity, summary: d.summary, detail: d.detail ?? null,
          expected_value: d.expected_value ?? null, observed_value: d.observed_value ?? null,
          detected_by: "finance_submission",
        });
      }

      await aml.from("finance_requests").update({
        status: "submitted",
        response_payload: { funding: comparison, note: f.note ? String(f.note).slice(0, 2000) : null },
        responded_at: new Date().toISOString(),
        responded_by_label: portalUser.email ?? portalUser.full_name ?? "finance_partner",
        comparison_id: created?.id ?? null,
      }).eq("id", request.id);
      // Dimension sync (errors surface in the result object, not as throws,
      // so a not-yet-migrated environment degrades gracefully).
      await aml.from("cases").update({ finance_portal_status: "submitted" }).eq("id", request.case_id);
      await appendCaseEvent(admin, request.case_id, "system",
        `Finance partner submitted funding information: ${request.subject}`,
        { finance_request_id: request.id, comparison_id: created?.id ?? null },
        portalUser.email ?? "finance_partner");

      // Finance-safe acknowledgement only: detected differences reach the
      // partner later as staff-authored clarification wording, never raw.
      return jr({ ok: true, status: "submitted" });
    }

    if (op === "respond") {
      const id = String(body.request_id ?? "");
      const message = String(body.message ?? "").trim();
      if (!id) return jr({ error: "request_id required" }, 400);
      const request = await loadScopedRequest(id);
      if (!request) return jr({ error: "Request not found" }, 404);
      if (!["open", "clarification_required"].includes(request.status)) {
        return jr({ error: "This request has already been completed" }, 400);
      }
      if (request.kind === "funding_information") {
        return jr({ error: "Use submit for funding-information requests" }, 400);
      }
      if (!message && !Array.isArray(body.evidence)) {
        return jr({ error: "A response message or evidence is required" }, 400);
      }

      const evidenceIn = Array.isArray(body.evidence) ? body.evidence.slice(0, 10) : [];
      const evidenceOut: Array<{ label: string; detail: string | null }> = [];
      for (const ev of evidenceIn) {
        const label = String(ev?.label ?? "").trim().slice(0, 300);
        if (!label) continue;
        const detail = ev?.detail ? String(ev.detail).slice(0, 1000) : null;
        await aml.from("evidence_references").insert({
          case_id: request.case_id,
          reference_type: "finance_document",
          label, detail,
          metadata: { submitted_via: "finance_portal", finance_request_id: request.id },
        });
        evidenceOut.push({ label, detail });
      }

      await aml.from("finance_requests").update({
        status: "submitted",
        response_payload: { text: message || null, evidence: evidenceOut },
        responded_at: new Date().toISOString(),
        responded_by_label: portalUser.email ?? portalUser.full_name ?? "finance_partner",
      }).eq("id", request.id);
      // Dimension sync (errors surface in the result object, not as throws,
      // so a not-yet-migrated environment degrades gracefully).
      await aml.from("cases").update({ finance_portal_status: "submitted" }).eq("id", request.case_id);
      await appendCaseEvent(admin, request.case_id, "system",
        `Finance partner responded: ${request.subject}`,
        { finance_request_id: request.id, evidence_count: evidenceOut.length },
        portalUser.email ?? "finance_partner");

      return jr({ ok: true, status: "submitted" });
    }

    return jr({ error: `Unknown op: ${op}` }, 400);
  } catch (e) {
    console.error("finance-portal-aml-requests error", e);
    return jr({ error: "Internal error" }, 500);
  }
});
