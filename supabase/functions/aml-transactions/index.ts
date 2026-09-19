/**
 * Phase 8 + 9 — Property Transactions, Counterparty CDD, Obligations & Settlement Gate.
 *
 * Ops:
 *   Transactions:     list_transactions, get_transaction, upsert_transaction, delete_transaction, append_event, list_events
 *   Parties:          list_parties, upsert_party, delete_party
 *   Counterparty:     list_cp_cases, upsert_cp_case, delete_cp_case,
 *                     list_cp_requests, upsert_cp_request, resolve_cp_request,
 *                     list_cp_attempts, add_cp_attempt,
 *                     counterparty_cdd_summary
 *   Obligations:      list_obligations, evaluate_obligations,
 *                     acknowledge_obligation, waive_obligation, link_obligation_report
 *   Gate:             settlement_gate_status (returns { gate_enabled, blocked, reasons[] })
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";
import {
  getCounterpartyRequestScope,
  hasAmlInvestigateCapability,
} from "../_shared/amlTransactionsAuth.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { pickAllowed } from '../_shared/wp09Guards.ts';
import {
  COUNTERPARTY_ATTEMPT_WRITABLE,
  TRANSACTION_PARTY_WRITABLE,
} from '../_shared/amlWritableColumns.ts';
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

async function appendTxEvent(
  aml: any, txId: string, caseId: string, category: string, summary: string,
  payload: any, actorId: string | null, actorLabel: string | null,
) {
  const { data: prev } = await aml.from("transaction_events")
    .select("row_hash").eq("transaction_id", txId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({
    transaction_id: txId, case_id: caseId, category, summary, payload,
    actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, created_at: now,
  }));
  const { error } = await aml.from("transaction_events").insert({
    transaction_id: txId, case_id: caseId, category, summary, payload,
    actor_id: actorId, actor_label: actorLabel, prev_hash: prevHash, row_hash: rowHash, created_at: now,
  });
  if (error) throw new Error(`Unable to append transaction audit event: ${error.message}`);
}

async function evaluateSettlementGate(admin: any, aml: any, pfId: string) {
  // Find AML case for this purchase file.
  const { data: cases } = await aml.from("cases")
    .select("id, status, risk_rating, updated_at")
    .eq("purchase_file_id", pfId).order("updated_at", { ascending: false }).limit(1);
  const c = (cases ?? [])[0] ?? null;

  const { data: flagRow } = await admin.from("feature_flags")
    .select("value").eq("key", "aml_settlement_gate").maybeSingle();
  const enabled = Boolean((flagRow?.value ?? {}).enabled);

  if (!c) {
    return { gate_enabled: enabled, blocked: enabled, reasons: enabled ? ["no_aml_case_linked"] : [], aml_case_id: null };
  }

  const reasons: string[] = [];

  // Blocking statuses
  const blockingStatuses = new Set(["draft", "kyc_in_progress", "edd_required", "under_review", "escalated_mlro", "blocked"]);
  if (blockingStatuses.has(c.status)) reasons.push(`case_status:${c.status}`);
  if (c.risk_rating === "prohibited") reasons.push("risk_rating:prohibited");

  // Open discrepancies
  const { count: discCount } = await aml.from("finance_discrepancies")
    .select("id", { count: "exact", head: true })
    .eq("case_id", c.id).in("status", ["open", "under_review", "escalated"]);
  if ((discCount ?? 0) > 0) reasons.push(`open_finance_discrepancies:${discCount}`);

  // Open counterparty requests past due
  const today = new Date().toISOString().slice(0, 10);
  const { count: reqCount } = await aml.from("counterparty_requests")
    .select("id", { count: "exact", head: true })
    .eq("case_id", c.id).in("status", ["pending", "sent", "awaiting_response"])
    .lte("due_date", today);
  if ((reqCount ?? 0) > 0) reasons.push(`overdue_counterparty_requests:${reqCount}`);

  // Phase 9 — pending / acknowledged reportable obligations must not remain unresolved at settlement.
  const { count: oblCount } = await aml.from("transaction_obligations")
    .select("id", { count: "exact", head: true })
    .eq("case_id", c.id).in("status", ["pending", "acknowledged"]);
  if ((oblCount ?? 0) > 0) reasons.push(`unresolved_reportable_obligations:${oblCount}`);

  return {
    gate_enabled: enabled,
    blocked: enabled && reasons.length > 0,
    reasons,
    aml_case_id: c.id,
    case_status: c.status,
    risk_rating: c.risk_rating,
  };
}


// ─── PHASE 9 — Obligation evaluation (TTR / IFTI / SMR / structuring) ───
// AUSTRAC thresholds:
//   TTR:  physical currency component >= AUD 10,000
//   IFTI: international funds transfer instruction (any amount)
//   SMR:  case rated high/prohibited, manual flag, or structuring pattern
//   Structuring: >= 3 sub-threshold cash tx (>= AUD 9,000 & < 10,000) same case within 24h
const TTR_THRESHOLD = 10000;
const STRUCTURING_LOW = 9000;
const STRUCTURING_WINDOW_HOURS = 24;
const STRUCTURING_MIN_COUNT = 3;

function pickCashAmount(tx: any): number {
  const md = tx?.metadata ?? {};
  const candidates = [
    md.cash_component, md.cash_amount, md.physical_currency_amount,
    md.deposit_method === "cash" ? tx?.deposit_amount : null,
  ].filter((v: any) => typeof v === "number" && isFinite(v));
  return candidates.length ? Math.max(...candidates) : 0;
}

function detectInternational(tx: any): { international: boolean; origin?: string; dest?: string } {
  const md = tx?.metadata ?? {};
  const origin = (md.origin_country || md.source_country || "").toString().toUpperCase();
  const dest = (md.dest_country || md.destination_country || "").toString().toUpperCase();
  if (md.is_international === true || md.ifti === true) return { international: true, origin, dest };
  if ((origin && origin !== "AU") || (dest && dest !== "AU")) return { international: true, origin, dest };
  return { international: false };
}

async function upsertObligation(
  aml: any, caseId: string, transactionId: string, kind: string,
  reason: string, observed: number | null, threshold: number | null, detail: Record<string, any>,
) {
  const { data: existing } = await aml.from("transaction_obligations")
    .select("id, status")
    .eq("transaction_id", transactionId).eq("kind", kind).maybeSingle();
  if (existing) {
    // Never reopen a report_created / waived obligation; refresh pending ones.
    if (existing.status === "pending") {
      await aml.from("transaction_obligations").update({
        trigger_reason: reason, observed_amount: observed, threshold_amount: threshold, detail,
      }).eq("id", existing.id);
    }
    return { created: false, obligation_id: existing.id };
  }
  const { data: inserted } = await aml.from("transaction_obligations").insert({
    case_id: caseId, transaction_id: transactionId, kind,
    trigger_reason: reason, observed_amount: observed, threshold_amount: threshold, detail,
  }).select("id").maybeSingle();
  return { created: true, obligation_id: inserted?.id ?? null };
}

async function evaluateObligations(admin: any, aml: any, tx: any): Promise<{ created: number; obligation_ids: string[] }> {
  const created: string[] = [];
  let createdCount = 0;
  const record = async (kind: string, reason: string, obs: number | null, threshold: number | null, detail: Record<string, any>) => {
    const r = await upsertObligation(aml, tx.case_id, tx.id, kind, reason, obs, threshold, detail);
    if (r.created && r.obligation_id) { createdCount++; created.push(r.obligation_id); }
  };

  const cash = pickCashAmount(tx);
  if (cash >= TTR_THRESHOLD) {
    await record("ttr", `cash_component_${cash}_gte_10000`, cash, TTR_THRESHOLD,
      { currency: tx.currency ?? "AUD", source_field: "metadata.cash_component|deposit(cash)" });
  }

  const intl = detectInternational(tx);
  if (intl.international) {
    await record("ifti", `international_transfer:${intl.origin || "?"}→${intl.dest || "?"}`,
      null, null, { origin_country: intl.origin, dest_country: intl.dest });
  }

  // SMR: case risk_rating or manual flag
  const { data: caseRow } = await aml.from("cases").select("risk_rating, status").eq("id", tx.case_id).maybeSingle();
  const risk = caseRow?.risk_rating ?? null;
  if (risk === "high" || risk === "prohibited" || tx?.metadata?.smr_flag === true) {
    await record("smr_candidate", risk ? `case_risk:${risk}` : "manual_smr_flag",
      null, null, { case_status: caseRow?.status ?? null, risk_rating: risk });
  }

  // Structuring: check other cash tx in same case within window
  if (cash >= STRUCTURING_LOW && cash < TTR_THRESHOLD) {
    const since = new Date(Date.now() - STRUCTURING_WINDOW_HOURS * 3600 * 1000).toISOString();
    const { data: peers } = await aml.from("transactions")
      .select("id, deposit_amount, metadata, created_at")
      .eq("case_id", tx.case_id).gte("created_at", since);
    const hits = (peers ?? []).filter((p: any) => {
      const a = pickCashAmount(p);
      return a >= STRUCTURING_LOW && a < TTR_THRESHOLD;
    });
    if (hits.length >= STRUCTURING_MIN_COUNT) {
      await record("structuring_suspected",
        `structuring_pattern:${hits.length}_sub_threshold_${STRUCTURING_WINDOW_HOURS}h`,
        cash, TTR_THRESHOLD,
        { window_hours: STRUCTURING_WINDOW_HOURS, matched_tx_ids: hits.map((h: any) => h.id) });
    }
  }

  return { created: createdCount, obligation_ids: created };
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
    const op = String(body?.op ?? "");

    const [{ data: canWriteRow }, { data: isSuperadminRow }] = await Promise.all([
      admin.rpc("has_aml_write_role", { _user_id: userId }),
      aml.rpc("is_superadmin", { _user_id: userId }),
    ]);
    const canWrite = Boolean(canWriteRow);
    const isSuperadmin = Boolean(isSuperadminRow);
    if (!hasAmlInvestigateCapability(canWrite, isSuperadmin)) {
      return jr({ error: "aml.investigate capability required" }, 403);
    }

    if (op === "settlement_gate_status") {
      const pfId = String(body.purchase_file_id ?? "");
      if (!pfId) return jr({ error: "purchase_file_id required" }, 400);
      const result = await evaluateSettlementGate(admin, aml, pfId);
      return jr(result);
    }

    const requireWrite = () => {
      if (!canWrite && !isSuperadmin) throw new Response(JSON.stringify({ error: "Insufficient permissions" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    };
    const { data: isMlroRow } = await admin.rpc("has_aml_role", { _user_id: userId, _role: "mlro" });
    const isMlro = Boolean(isMlroRow) || isSuperadmin;
    const requireMlro = () => {
      if (!isMlro) throw new Response(JSON.stringify({ error: "MLRO role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    };

    // ── TRANSACTIONS ──
    if (op === "list_transactions") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const { data, error } = await aml.from("transactions")
        .select("*").eq("case_id", caseId).is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) return jr({ error: error.message }, 400);
      return jr({ transactions: data ?? [] });
    }
    if (op === "get_transaction") {
      const id = String(body.id ?? "");
      const { data, error } = await aml.from("transactions").select("*").eq("id", id).maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ transaction: data });
    }
    if (op === "upsert_transaction") {
      requireWrite();
      const p = body.transaction ?? {};
      if (!p.case_id) return jr({ error: "case_id required" }, 400);
      const transactionInput = { ...p };
      delete transactionInput.archived_at;
      delete transactionInput.archived_by;

      let originalSettlement = p.original_settlement_date ?? null;
      let settlementChanged = false;
      let existing: any = null;
      if (p.id) {
        const { data: ex } = await aml.from("transactions").select("*").eq("id", p.id).maybeSingle();
        existing = ex;
        if (ex) {
          if (ex.archived_at) return jr({ error: "archived transactions cannot be changed" }, 409);
          if (!originalSettlement && ex.original_settlement_date) originalSettlement = ex.original_settlement_date;
          if (!originalSettlement && ex.settlement_date && ex.settlement_date !== p.settlement_date) {
            originalSettlement = ex.settlement_date;
          }
          if (ex.settlement_date && p.settlement_date && ex.settlement_date !== p.settlement_date) {
            settlementChanged = true;
          }
        }
      } else if (p.settlement_date) {
        originalSettlement = originalSettlement ?? p.settlement_date;
      }

      const row = { ...transactionInput, created_by: userId, original_settlement_date: originalSettlement };
      const resp = p.id
        ? await aml.from("transactions").update(row).eq("id", p.id).select("*").maybeSingle()
        : await aml.from("transactions").insert(row).select("*").maybeSingle();
      if (resp.error) return jr({ error: resp.error.message }, 400);

      const tx = resp.data;
      await appendTxEvent(aml, tx.id, tx.case_id,
        p.id ? "updated" : "created",
        p.id ? "Transaction updated" : "Transaction captured",
        { fields: Object.keys(transactionInput), settlement_changed: settlementChanged },
        userId, userLabel);
      if (settlementChanged) {
        await appendTxEvent(aml, tx.id, tx.case_id, "settlement_rescheduled",
          `Settlement date changed from ${existing?.settlement_date} to ${tx.settlement_date}`,
          { from: existing?.settlement_date, to: tx.settlement_date }, userId, userLabel);
      }

      // Phase 9 — automatic obligation evaluation
      let obligationResult = { created: 0, obligation_ids: [] as string[] };
      try {
        obligationResult = await evaluateObligations(admin, aml, tx);
        if (obligationResult.created > 0) {
          await appendTxEvent(aml, tx.id, tx.case_id, "obligation_triggered",
            `${obligationResult.created} new reportable obligation(s) detected`,
            { obligation_ids: obligationResult.obligation_ids }, userId, userLabel);
        }
      } catch (e) {
        // Never block a save because obligation evaluation failed; log to event chain.
        await appendTxEvent(aml, tx.id, tx.case_id, "obligation_eval_error",
          "Obligation evaluation failed", { error: String((e as any)?.message ?? e) }, userId, userLabel);
      }

      return jr({ transaction: tx, obligations_created: obligationResult.created });
    }
    if (op === "delete_transaction") {
      requireMlro();
      const id = String(body.id ?? "");
      if (!id) return jr({ error: "id required" }, 400);
      const { data: tx, error: findError } = await aml.from("transactions")
        .select("id, case_id, archived_at").eq("id", id).maybeSingle();
      if (findError) return jr({ error: findError.message }, 400);
      if (!tx) return jr({ error: "transaction not found" }, 404);
      if (tx.archived_at) return jr({ ok: true });

      await appendTxEvent(aml, tx.id, tx.case_id, "archived",
        "Transaction archived by MLRO",
        { archived_by: userId }, userId, userLabel);
      const { error } = await aml.from("transactions").update({
        archived_at: new Date().toISOString(), archived_by: userId,
      }).eq("id", id).is("archived_at", null);
      if (error) return jr({ error: error.message }, 400);
      return jr({ ok: true });
    }
    if (op === "list_events") {
      const txId = String(body.transaction_id ?? "");
      const { data, error } = await aml.from("transaction_events")
        .select("*").eq("transaction_id", txId).order("created_at", { ascending: false }).limit(200);
      if (error) return jr({ error: error.message }, 400);
      return jr({ events: data ?? [] });
    }
    if (op === "append_event") {
      requireWrite();
      const txId = String(body.transaction_id ?? "");
      const { data: tx } = await aml.from("transactions").select("case_id").eq("id", txId).maybeSingle();
      if (!tx) return jr({ error: "transaction not found" }, 404);
      await appendTxEvent(aml, txId, tx.case_id,
        String(body.category ?? "note"), String(body.summary ?? ""),
        body.payload ?? {}, userId, userLabel);
      return jr({ ok: true });
    }

    // ── PARTIES ──
    if (op === "list_parties") {
      const txId = String(body.transaction_id ?? "");
      const { data, error } = await aml.from("transaction_parties")
        .select("*").eq("transaction_id", txId).order("created_at", { ascending: true });
      if (error) return jr({ error: error.message }, 400);
      return jr({ parties: data ?? [] });
    }
    if (op === "upsert_party") {
      requireWrite();
      const p = body.party ?? {};
      if (!p.transaction_id || !p.case_id || !p.display_name || !p.party_type) {
        return jr({ error: "transaction_id, case_id, display_name, party_type required" }, 400);
      }
      // WP-20: only declared columns; `p` is the caller's object.
      const partyRow = pickAllowed(p, TRANSACTION_PARTY_WRITABLE);
      const resp = p.id
        ? await aml.from("transaction_parties").update(partyRow).eq("id", p.id).select("*").maybeSingle()
        : await aml.from("transaction_parties").insert(partyRow).select("*").maybeSingle();
      if (resp.error) return jr({ error: resp.error.message }, 400);
      await appendTxEvent(aml, p.transaction_id, p.case_id, "party_updated",
        `Party ${p.display_name} (${p.party_type}) ${p.id ? "updated" : "added"}`,
        { party_id: resp.data.id, party_type: p.party_type }, userId, userLabel);
      return jr({ party: resp.data });
    }
    if (op === "delete_party") {
      requireWrite();
      const id = String(body.id ?? "");
      const { error } = await aml.from("transaction_parties").delete().eq("id", id);
      if (error) return jr({ error: error.message }, 400);
      return jr({ ok: true });
    }

    // ── COUNTERPARTY CASES ──
    if (op === "list_cp_cases") {
      const caseId = String(body.case_id ?? "");
      const { data, error } = await aml.from("counterparty_cases")
        .select("*").eq("case_id", caseId).order("created_at", { ascending: false });
      if (error) return jr({ error: error.message }, 400);
      return jr({ counterparty_cases: data ?? [] });
    }
    if (op === "upsert_cp_case") {
      requireWrite();
      const p = { ...(body.counterparty_case ?? {}) };
      // §12.5 controlled fields change only through their dedicated, audited
      // ops (set_delayed_cdd / mark_uncooperative) — never via generic upsert.
      delete p.delayed_cdd_deadline;
      delete p.delayed_cdd_justification;
      delete p.uncooperative;
      delete p.uncooperative_marked_at;
      delete p.uncooperative_reason;
      if (!p.case_id || !p.subject_display_name) return jr({ error: "case_id and subject_display_name required" }, 400);
      const row = { ...p, created_by: userId };
      const resp = p.id
        ? await aml.from("counterparty_cases").update(row).eq("id", p.id).select("*").maybeSingle()
        : await aml.from("counterparty_cases").insert(row).select("*").maybeSingle();
      if (resp.error) return jr({ error: resp.error.message }, 400);
      return jr({ counterparty_case: resp.data });
    }
    if (op === "delete_cp_case") {
      requireWrite();
      const id = String(body.id ?? "");
      const { error } = await aml.from("counterparty_cases").delete().eq("id", id);
      if (error) return jr({ error: error.message }, 400);
      return jr({ ok: true });
    }

    // ── COUNTERPARTY REQUESTS ──
    if (op === "list_cp_requests") {
      const scope = getCounterpartyRequestScope(body);
      if (!scope) return jr({ error: "counterparty_case_id or case_id required" }, 400);
      const q = aml.from("counterparty_requests").select("*")
        .eq(scope.column, scope.value).order("created_at", { ascending: false });
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      return jr({ requests: data ?? [] });
    }
    if (op === "upsert_cp_request") {
      requireWrite();
      const p = body.request ?? {};
      if (!p.counterparty_case_id || !p.case_id || !p.request_type || !p.summary) {
        return jr({ error: "counterparty_case_id, case_id, request_type, summary required" }, 400);
      }
      const row = { ...p, created_by: userId };
      const resp = p.id
        ? await aml.from("counterparty_requests").update(row).eq("id", p.id).select("*").maybeSingle()
        : await aml.from("counterparty_requests").insert(row).select("*").maybeSingle();
      if (resp.error) return jr({ error: resp.error.message }, 400);
      return jr({ request: resp.data });
    }
    if (op === "resolve_cp_request") {
      requireWrite();
      const id = String(body.id ?? "");
      const status = String(body.status ?? "resolved");
      const { data, error } = await aml.from("counterparty_requests")
        .update({ status, metadata: body.metadata ?? undefined }).eq("id", id).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ request: data });
    }

    if (op === "list_cp_attempts") {
      const rid = String(body.request_id ?? "");
      const { data, error } = await aml.from("counterparty_attempts")
        .select("*").eq("request_id", rid).order("attempted_at", { ascending: false });
      if (error) return jr({ error: error.message }, 400);
      return jr({ attempts: data ?? [] });
    }
    if (op === "add_cp_attempt") {
      requireWrite();
      const p = body.attempt ?? {};
      if (!p.request_id || !p.counterparty_case_id || !p.channel) {
        return jr({ error: "request_id, counterparty_case_id, channel required" }, 400);
      }
      const { data, error } = await aml.from("counterparty_attempts")
        .insert({ ...pickAllowed(p, COUNTERPARTY_ATTEMPT_WRITABLE), actor_id: userId })
        .select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ attempt: data });
    }

    // ── PHASE 9 — OBLIGATIONS (TTR / IFTI / SMR / structuring) ──
    if (op === "list_obligations") {
      const caseId = body.case_id ? String(body.case_id) : null;
      const txId = body.transaction_id ? String(body.transaction_id) : null;
      if (!caseId && !txId) return jr({ error: "case_id or transaction_id required" }, 400);
      let q = aml.from("transaction_obligations").select("*").order("created_at", { ascending: false });
      if (txId) q = q.eq("transaction_id", txId); else q = q.eq("case_id", caseId!);
      const { data, error } = await q;
      if (error) return jr({ error: error.message }, 400);
      return jr({ obligations: data ?? [] });
    }

    if (op === "evaluate_obligations") {
      requireWrite();
      const txId = String(body.transaction_id ?? "");
      if (!txId) return jr({ error: "transaction_id required" }, 400);
      const { data: tx } = await aml.from("transactions").select("*").eq("id", txId).maybeSingle();
      if (!tx) return jr({ error: "transaction not found" }, 404);
      const result = await evaluateObligations(admin, aml, tx);
      if (result.created > 0) {
        await appendTxEvent(aml, tx.id, tx.case_id, "obligation_reevaluated",
          `${result.created} obligation(s) detected on re-evaluation`,
          { obligation_ids: result.obligation_ids }, userId, userLabel);
      }
      return jr(result);
    }

    if (op === "acknowledge_obligation") {
      requireWrite();
      const id = String(body.id ?? "");
      const { data, error } = await aml.from("transaction_obligations")
        .update({ status: "acknowledged", acknowledged_by: userId, acknowledged_at: new Date().toISOString() })
        .eq("id", id).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      if (data) await appendTxEvent(aml, data.transaction_id, data.case_id, "obligation_acknowledged",
        `Obligation ${data.kind} acknowledged`, { obligation_id: data.id }, userId, userLabel);
      return jr({ obligation: data });
    }

    if (op === "waive_obligation") {
      requireMlro();
      const id = String(body.id ?? "");
      const reason = String(body.reason ?? "").trim();
      if (!id || !reason) return jr({ error: "id and reason required" }, 400);
      const { data: obligation } = await aml.from("transaction_obligations")
        .select("id, status").eq("id", id).maybeSingle();
      if (!obligation) return jr({ error: "Obligation not found" }, 404);
      if (!["pending", "acknowledged"].includes(obligation.status)) {
        return jr({ error: `Cannot waive an obligation with status ${obligation.status}` }, 400);
      }
      const { data, error } = await aml.from("transaction_obligations")
        .update({ status: "waived", waived_by: userId, waived_at: new Date().toISOString(), waive_reason: reason })
        .eq("id", id).in("status", ["pending", "acknowledged"]).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      if (!data) return jr({ error: "Obligation status changed; retry the request" }, 409);
      if (data) await appendTxEvent(aml, data.transaction_id, data.case_id, "obligation_waived",
        `Obligation ${data.kind} waived: ${reason}`, { obligation_id: data.id, reason }, userId, userLabel);
      return jr({ obligation: data });
    }

    if (op === "link_obligation_report") {
      requireMlro();
      const id = String(body.id ?? "");
      const reportId = String(body.report_id ?? "");
      if (!id || !reportId) return jr({ error: "id and report_id required" }, 400);
      const { data: obligation } = await aml.from("transaction_obligations")
        .select("id, case_id, kind, status").eq("id", id).maybeSingle();
      if (!obligation) return jr({ error: "Obligation not found" }, 404);
      if (!["pending", "acknowledged"].includes(obligation.status)) {
        return jr({ error: `Cannot link a report to an obligation with status ${obligation.status}` }, 400);
      }
      const { data: report } = await aml.from("reports")
        .select("id, case_id, kind, status").eq("id", reportId).maybeSingle();
      if (!report) return jr({ error: "Report not found" }, 404);
      const expectedReportKind = ["smr_candidate", "structuring_suspected"].includes(obligation.kind) ? "smr" : obligation.kind;
      if (report.case_id !== obligation.case_id || report.kind !== expectedReportKind) {
        return jr({ error: "Report must match the obligation case and type" }, 400);
      }
      if (!["submitted", "acknowledged"].includes(report.status)) {
        return jr({ error: "Report must be submitted before it can resolve an obligation" }, 400);
      }
      const { data: submissions } = await aml.from("report_submissions")
        .select("status, external_reference, export_bundle_path, response_payload")
        .eq("report_id", report.id).in("status", ["submitted", "acknowledged"]);
      const hasSubmissionEvidence = (submissions ?? []).some((submission: any) =>
        submission.external_reference || submission.export_bundle_path ||
        submission.response_payload?.evidence || submission.response_payload?.attachment_url || submission.response_payload?.lodgement_id,
      );
      if (!hasSubmissionEvidence) {
        return jr({ error: "A submitted report with submission evidence is required" }, 400);
      }
      const { data, error } = await aml.from("transaction_obligations")
        .update({ status: "report_created", linked_report_id: reportId })
        .eq("id", id).in("status", ["pending", "acknowledged"]).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      if (!data) return jr({ error: "Obligation status changed; retry the request" }, 409);
      if (data) await appendTxEvent(aml, data.transaction_id, data.case_id, "obligation_reported",
        `Obligation ${data.kind} linked to AUSTRAC report`, { obligation_id: data.id, report_id: reportId },
        userId, userLabel);
      return jr({ obligation: data });
    }

    // ── DELAYED CDD + UNCOOPERATIVE COUNTERPARTY (Phase 9, §12.5) ──
    // Case-timeline audit for counterparty actions (hash-chained, same
    // pattern as the other aml-* functions' case events).
    async function appendCpCaseEvent(caseId: string, summary: string, payload: any) {
      const { data: prev } = await aml.from("case_events")
        .select("row_hash").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const prevHash = prev?.row_hash ?? null;
      const now = new Date().toISOString();
      const rowHash = await sha256Hex(JSON.stringify({
        case_id: caseId, category: "system", summary, payload,
        actor_id: userId, actor_label: userLabel, prev_hash: prevHash, created_at: now,
      }));
      await aml.from("case_events").insert({
        case_id: caseId, category: "system", summary, payload,
        actor_id: userId, actor_label: userLabel, prev_hash: prevHash, row_hash: rowHash, created_at: now,
      });
    }

    if (op === "set_delayed_cdd") {
      requireWrite();
      const id = String(body.id ?? "");
      const deadline = String(body.deadline ?? "").trim();
      const justification = String(body.justification ?? "").trim();
      if (!id || !deadline) return jr({ error: "id and deadline required" }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return jr({ error: "deadline must be a YYYY-MM-DD date" }, 400);
      if (justification.length < 10) return jr({ error: "justification must be at least 10 characters" }, 400);
      const { data: cp } = await aml.from("counterparty_cases")
        .select("id, case_id, subject_display_name").eq("id", id).maybeSingle();
      if (!cp) return jr({ error: "Counterparty case not found" }, 404);
      const { data, error } = await aml.from("counterparty_cases")
        .update({ delayed_cdd_deadline: deadline, delayed_cdd_justification: justification })
        .eq("id", id).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      await appendCpCaseEvent(cp.case_id,
        `Delayed CDD recorded for ${cp.subject_display_name} — deadline ${deadline}`,
        { counterparty_case_id: id, deadline, justification });
      return jr({ counterparty_case: data });
    }

    if (op === "mark_uncooperative") {
      requireWrite();
      const id = String(body.id ?? "");
      const reason = String(body.reason ?? "").trim();
      if (!id) return jr({ error: "id required" }, 400);
      if (reason.length < 10) return jr({ error: "reason must be at least 10 characters" }, 400);
      const { data: cp } = await aml.from("counterparty_cases")
        .select("id, case_id, subject_display_name, uncooperative").eq("id", id).maybeSingle();
      if (!cp) return jr({ error: "Counterparty case not found" }, 404);
      if (cp.uncooperative) return jr({ error: "Already marked uncooperative" }, 400);

      // Reasonable-steps evidence (§12.5): at least two recorded contact
      // attempts across this counterparty's information requests.
      const { data: reqRows } = await aml.from("counterparty_requests")
        .select("id").eq("counterparty_case_id", id);
      const requestIds = (reqRows ?? []).map((r: any) => r.id);
      let attemptCount = 0;
      if (requestIds.length > 0) {
        const { count } = await aml.from("counterparty_attempts")
          .select("id", { count: "exact", head: true }).in("request_id", requestIds);
        attemptCount = count ?? 0;
      }
      if (attemptCount < 2) {
        return jr({
          error: "Record at least two contact attempts (reasonable steps) before marking a counterparty uncooperative",
          code: "insufficient_attempts", attempts_recorded: attemptCount,
        }, 409);
      }

      const { data, error } = await aml.from("counterparty_cases")
        .update({
          uncooperative: true,
          uncooperative_marked_at: new Date().toISOString(),
          uncooperative_reason: reason,
          status: "escalated",
        })
        .eq("id", id).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      await appendCpCaseEvent(cp.case_id,
        `Counterparty marked uncooperative: ${cp.subject_display_name}`,
        { counterparty_case_id: id, reason, attempts_recorded: attemptCount });
      return jr({ counterparty_case: data });
    }

    // Counterparty CDD roll-up summary (per case).
    if (op === "counterparty_cdd_summary") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const today = new Date().toISOString().slice(0, 10);
      const [cpAll, cpOpen, reqOpen, reqOverdue] = await Promise.all([
        aml.from("counterparty_cases").select("id", { count: "exact", head: true }).eq("case_id", caseId),
        aml.from("counterparty_cases").select("id", { count: "exact", head: true }).eq("case_id", caseId)
          .in("status", ["open", "in_progress", "awaiting_info", "escalated"]),
        aml.from("counterparty_requests").select("id", { count: "exact", head: true }).eq("case_id", caseId)
          .in("status", ["pending", "sent", "awaiting_response"]),
        aml.from("counterparty_requests").select("id", { count: "exact", head: true }).eq("case_id", caseId)
          .in("status", ["pending", "sent", "awaiting_response"]).lte("due_date", today),
      ]);
      return jr({
        summary: {
          counterparty_cases_total: cpAll.count ?? 0,
          counterparty_cases_open: cpOpen.count ?? 0,
          requests_open: reqOpen.count ?? 0,
          requests_overdue: reqOverdue.count ?? 0,
          all_cleared: (cpOpen.count ?? 0) === 0 && (reqOpen.count ?? 0) === 0,
        },
      });
    }

    return jr({ error: `Unknown op: ${op}` }, 400);
  } catch (e: any) {
    if (e instanceof Response) return e;
    return jr({ ...internalError(e, 'aml-transactions') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
