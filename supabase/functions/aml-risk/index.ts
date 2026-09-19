/**
 * Phase 5 — AML Risk Engine, Mandatory Holds, Decisions & Purchase-Ready Gate.
 *
 * Ops (single POST endpoint, {op, ...args}):
 *   Config:     list_factors, upsert_factor, list_triggers, upsert_trigger
 *   Assess:     evaluate, list_assessments, get_assessment
 *   Overrides:  request_override, resolve_override, list_overrides
 *   Decisions:  decide, list_decisions, latest_decision
 *   Approvals:  list_approvals, resolve_approval
 *   Conditions: list_conditions, upsert_condition, resolve_condition
 *   Gate:       gate_status  (feature-flag-guarded soft check)
 *
 * Read: any AML role. Write assessments/overrides/conditions: analyst/reviewer/mlro.
 * Approvals + decisions: reviewer/mlro. Configuration writes: mlro only.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth } from "../_shared/auth.ts";
// `aml.cases` has no tenant_id column. See `_shared/aml/caseTenant.ts`.
import { tenantForCase } from "../_shared/aml/caseTenant.ts";
import {
  partyScreeningOutstanding,
  pepControlsRequired,
  pepDeterminationCurrent,
  pepEvidenceSatisfied,
} from "../_shared/aml/partyScreening.pure.ts";

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { pickAllowed } from '../_shared/wp09Guards.ts';
import { MANDATORY_TRIGGER_WRITABLE, RISK_FACTOR_WRITABLE } from '../_shared/amlWritableColumns.ts';
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jr = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sha256Hex(input: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function appendCaseEvent(
  admin: any, caseId: string, category: string, summary: string,
  payload: any, actorId: string | null, actorLabel: string | null,
): Promise<string | null> {
  const { data: prev } = await admin.schema("aml").from("case_events")
    .select("row_hash").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevHash = prev?.row_hash ?? null;
  const now = new Date().toISOString();
  const rowHash = await sha256Hex(JSON.stringify({
    case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, created_at: now,
  }));
  const { data: inserted } = await admin.schema("aml").from("case_events").insert({
    case_id: caseId, category, summary, payload, actor_id: actorId, actor_label: actorLabel,
    prev_hash: prevHash, row_hash: rowHash, created_at: now,
  }).select("id").maybeSingle();
  return inserted?.id ?? null;
}

type Factor = { key: string; label: string; category: string; weight: number; scoring: Record<string, number>; active: boolean };
type Trigger = { key: string; label: string; severity: "block" | "hold"; rule: Record<string, any>; active: boolean };

function pickScore(scoring: Record<string, number>, value: unknown): number {
  if (value == null) return 0;
  const key = String(value).toLowerCase();
  if (typeof scoring[key] === "number") return scoring[key];
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function ratingFor(score: number): "low" | "medium" | "high" | "prohibited" {
  if (score >= 80) return "prohibited";
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function evaluateFactors(factors: Factor[], inputs: Record<string, any>) {
  const completion: any[] = []; const verification: any[] = []; const mltf: any[] = [];
  let cW = 0, cS = 0, vW = 0, vS = 0, mW = 0, mS = 0;
  for (const f of factors) {
    if (!f.active) continue;
    const raw = inputs[f.key];
    const score = pickScore(f.scoring, raw);
    const weighted = score * (f.weight || 1);
    const entry = { key: f.key, label: f.label, input: raw ?? null, score, weight: f.weight, weighted };
    if (f.category === "completion") { completion.push(entry); cW += f.weight; cS += weighted; }
    else if (f.category === "verification") { verification.push(entry); vW += f.weight; vS += weighted; }
    else { mltf.push(entry); mW += f.weight; mS += weighted; }
  }
  const norm = (s: number, w: number) => (w > 0 ? Math.min(100, Math.max(0, s / w)) : 0);
  return {
    completion_score: norm(cS, cW),
    verification_score: norm(vS, vW),
    mltf_score: norm(mS, mW),
    factor_breakdown: [...mltf, ...completion, ...verification],
  };
}

function evaluateTriggers(triggers: Trigger[], inputs: Record<string, any>) {
  const holds: any[] = [];
  for (const t of triggers) {
    if (!t.active) continue;
    const rule = t.rule ?? {};
    let match = true;
    for (const [k, expected] of Object.entries(rule)) {
      const actual = inputs[k];
      if (expected && typeof expected === "object" && !Array.isArray(expected)) {
        for (const [sk, sv] of Object.entries(expected as any)) {
          const inner = actual && typeof actual === "object" ? (actual as any)[sk] : undefined;
          if (inner !== sv) { match = false; break; }
        }
      } else if (String(actual ?? "").toLowerCase() !== String(expected).toLowerCase()) {
        match = false;
      }
      if (!match) break;
    }
    if (match) holds.push({ key: t.key, label: t.label, severity: t.severity });
  }
  return holds;
}

async function authoritativeMandatoryInputs(admin: any, caseId: string): Promise<Record<string, any>> {
  // Only authoritative executions may feed the risk model — a simulator
  // 'failed' is not an adverse fact about the customer. The filtered query
  // falls back to the legacy shape while the execution-mode migration is
  // not applied (where every row is treated as authoritative, as before).
  async function failedAuthoritativeIdv() {
    const filtered = await admin.schema("aml").from("identity_checks")
      .select("id, status, completed_at, updated_at")
      .eq("case_id", caseId)
      .eq("status", "failed")
      .eq("authoritative", true)
      .limit(1);
    if (!filtered.error) return filtered;
    return await admin.schema("aml").from("identity_checks")
      .select("id, status, completed_at, updated_at")
      .eq("case_id", caseId)
      .eq("status", "failed")
      .limit(1);
  }
  // Canonical model (Stage 21): an authoritative electronic failure in
  // verification_checks is a mandatory input exactly like a legacy one.
  // Only rows where the provider actually examined the subject count —
  // attempt_consumed + authoritative excludes outages, unusable captures,
  // worker retries and simulations by construction. Legacy fallback keeps
  // the pre-migration shape (status alone) working unchanged.
  async function failedCanonicalIdv() {
    const filtered = await admin.schema("aml").from("verification_checks")
      .select("id, status, completed_at")
      .eq("case_id", caseId)
      .eq("check_type", "electronic_idv")
      .eq("status", "failed")
      .eq("authoritative", true)
      .eq("attempt_consumed", true)
      .is("superseded_at", null)
      .limit(1);
    if (!filtered.error) return filtered;
    return await admin.schema("aml").from("verification_checks")
      .select("id, status, completed_at")
      .eq("case_id", caseId)
      .eq("check_type", "electronic_idv")
      .eq("status", "failed")
      .limit(1);
  }
  const [{ data: failedIdv }, { data: failedCanonical }, { data: confirmedSanctions },
         { data: pepDets }, { data: caseRow }] = await Promise.all([
    failedAuthoritativeIdv(),
    failedCanonicalIdv(),
    admin.schema("aml").from("screening_matches")
      .select("id, match_type, status, updated_at")
      .eq("case_id", caseId)
      .eq("match_type", "sanctions")
      .eq("status", "confirmed")
      .limit(1),
    admin.schema("aml").from("pep_determinations")
      .select("id, result, pep_type, pep_relationship, superseded_at, review_due_at, determined_at")
      .eq("case_id", caseId).is("superseded_at", null),
    admin.schema("aml").from("cases").select("id, risk_rating").eq("id", caseId).maybeSingle(),
  ]);

  const inputs: Record<string, any> = {};
  if ((failedIdv ?? []).length > 0 || (failedCanonical ?? []).length > 0) inputs.idv = "failed";
  if ((confirmedSanctions ?? []).length > 0) inputs.screening = { confirmed_match: true };

  // PEP feeds risk from the recorded determination, never from a caller.
  // A PEP is not a sanctions finding and not criminality — it selects the
  // AUSTRAC-mandated controls (EDD incl. source of funds/wealth, senior
  // manager approval) and the existing pep risk factor / hold triggers.
  const pepFindings = (pepDets ?? []).filter((d: any) => d.result === "pep");
  if (pepFindings.length > 0) {
    inputs.pep = pepFindings.some((d: any) => d.pep_relationship === "self") ? "direct" : "associate";
    const controls = pepFindings
      .map((d: any) => pepControlsRequired(d, caseRow?.risk_rating ?? null))
      .reduce(
        (acc: { eddRequired: boolean; seniorManagerApprovalRequired: boolean },
         c: { eddRequired: boolean; seniorManagerApprovalRequired: boolean }) => ({
          eddRequired: acc.eddRequired || c.eddRequired,
          seniorManagerApprovalRequired: acc.seniorManagerApprovalRequired || c.seniorManagerApprovalRequired,
        }),
        { eddRequired: false, seniorManagerApprovalRequired: false });

    // Evidence must be LINKED to the current determination as one chain:
    // a qualifying EDD case completed AFTER the determination, with verified
    // source-of-funds AND source-of-wealth rows BELONGING to that EDD case
    // (source_of_funds.edd_case_id / source_of_wealth.edd_case_id — the
    // existing relationship). A verified SoF/SoW from an older or unrelated
    // EDD establishes nothing about this finding, and a superseding
    // determination invalidates the previous finding's evidence by moving
    // the reference timestamp forward. Approvals postdate the determination.
    const latestPepDeterminedAt = pepFindings
      .map((d: any) => String(d.determined_at ?? ""))
      .sort()
      .at(-1) ?? "";
    if (controls.eddRequired || controls.seniorManagerApprovalRequired) {
      const [{ data: doneEdd }, { data: sofRows }, { data: sowRows }, { data: granted }] =
        await Promise.all([
          admin.schema("aml").from("edd_cases")
            .select("id, completed_at").eq("case_id", caseId)
            .eq("status", "completed").eq("mlro_decision", "approved")
            .order("completed_at", { ascending: false }).limit(20),
          admin.schema("aml").from("source_of_funds")
            .select("edd_case_id").eq("case_id", caseId).eq("verified", true).limit(200),
          admin.schema("aml").from("source_of_wealth")
            .select("edd_case_id").eq("case_id", caseId).eq("verified", true).limit(200),
          admin.schema("aml").from("approvals")
            .select("id, resolved_at").eq("case_id", caseId)
            .eq("kind", "pep_service_approval").eq("status", "approved")
            .order("resolved_at", { ascending: false }).limit(1),
        ]);
      const evidence = pepEvidenceSatisfied({
        latestPepDeterminedAt,
        completedEddCases: (doneEdd ?? []).map((e: any) => ({
          id: String(e.id), completed_at: e.completed_at ?? null,
        })),
        verifiedSofEddCaseIds: (sofRows ?? []).map((r: any) => r.edd_case_id ?? null),
        verifiedSowEddCaseIds: (sowRows ?? []).map((r: any) => r.edd_case_id ?? null),
        approvalResolvedAt: (granted ?? [])[0]?.resolved_at ?? null,
      });
      if (controls.eddRequired) {
        inputs.pep_edd_required = true;
        inputs.edd_complete = evidence.eddComplete;
      }
      if (controls.seniorManagerApprovalRequired) {
        inputs.pep_approval_required = true;
        inputs.pep_approval_granted = evidence.approvalGranted;
      }
    }
  }
  return inputs;
}

function blockingHolds(assessment: any): any[] {
  return ((assessment?.triggered_holds ?? []) as any[]).filter((h) => h?.severity === "block");
}

/**
 * Screening completeness reasons: required screening work that has not
 * produced a current, adjudicated outcome stands between the case and
 * clearance. Server-side — the UI list in get_submission_review is advisory;
 * this is what `decide`, `gate_status` and `set_service_gate` enforce.
 */
async function screeningCompletenessReasons(admin: any, caseId: string): Promise<string[]> {
  const nowIso = new Date().toISOString();
  const reasons: string[] = [];

  const [{ data: subjects }, { data: openMatches }, { data: caseChecks }, { data: pepDets },
         { data: gateCase }] = await Promise.all([
      admin.schema("aml").from("party_screening_subjects")
        .select("id, required, state, refresh_due_at, party_type")
        .eq("case_id", caseId),
      admin.schema("aml").from("screening_matches")
        .select("id, status").eq("case_id", caseId).in("status", ["open", "escalated"]).limit(1),
      admin.schema("aml").from("screening_checks")
        .select("id, status, completed_at, authoritative")
        .eq("case_id", caseId).not("completed_at", "is", null)
        .order("completed_at", { ascending: false }).limit(5),
      admin.schema("aml").from("pep_determinations")
        .select("id, party_screening_subject_id, result, superseded_at, review_due_at")
        .eq("case_id", caseId).is("superseded_at", null),
      admin.schema("aml").from("cases").select("id, subject_type").eq("id", caseId).maybeSingle(),
    ]);

  // Required party screening: every non-terminal state blocks — queued and
  // processing are work not done, and a technical error is outstanding and
  // retryable, never clear. Stale satisfied screening blocks until refreshed.
  let incomplete = 0, unresolved = 0, stale = 0;
  for (const s of subjects ?? []) {
    const why = partyScreeningOutstanding(s, nowIso);
    if (why === "incomplete") incomplete++;
    else if (why === "unresolved") unresolved++;
    else if (why === "stale") stale++;
    // confirmed_match feeds the sanctions_hit mandatory trigger through the
    // canonical screening_matches rows — no duplicate reason here.
  }
  if (incomplete > 0) reasons.push(`${incomplete}_party_screening_incomplete`);
  if (unresolved > 0) reasons.push(`${unresolved}_party_screening_unresolved`);
  if (stale > 0) reasons.push(`${stale}_party_screening_stale`);

  // Unresolved canonical candidates (case subject or party) must be
  // adjudicated by a human before clearance — a candidate is neither clear
  // nor a finding until someone decides.
  if ((openMatches ?? []).length > 0) reasons.push("unadjudicated_screening_matches");

  // Case-subject screening must exist and be authoritative. Simulator runs
  // (authoritative=false) are not compliance evidence.
  const authoritativeCheck = (caseChecks ?? []).find((c: any) =>
    c.authoritative !== false && ["clear", "review", "matched"].includes(String(c.status)));
  if (!authoritativeCheck) reasons.push("case_screening_missing");

  // Required PEP determinations: the case subject when the customer is an
  // individual; reconciled parties in the program's identification roles
  // always (those roles are individuals by construction — an entity customer
  // is assessed through its beneficial owners and representatives). A lapsed
  // review date makes a determination non-current — it must be reconsidered,
  // not assumed.
  const { pepDeterminationRequiredForRole } = await import("../_shared/aml/partyScreening.pure.ts");
  const current = (pepDets ?? []).filter((d: any) => pepDeterminationCurrent(d, nowIso));
  const subjectIsIndividual = !gateCase?.subject_type || gateCase.subject_type === "individual";
  /*
   * The case subject's determination discharges the case-level requirement
   * WHEREVER it is recorded. Stage 5's determination dialog writes against
   * the primary subject's `party_screening_subjects` row — the same person
   * this rule is about — but this check used to accept only a NULL
   * party_screening_subject_id, so a case whose subject held a current
   * not_pep determination was refused clearance for a "missing" PEP
   * determination it demonstrably had. One person, one requirement: a
   * current determination bound to a primary_subject row is the case-level
   * determination.
   */
  const primarySubjectRowIds = new Set((subjects ?? [])
    .filter((s: any) => String(s.party_type) === "primary_subject")
    .map((s: any) => String(s.id)));
  const caseLevelCurrent = current.some((d: any) =>
    !d.party_screening_subject_id
    || primarySubjectRowIds.has(String(d.party_screening_subject_id)));
  if (subjectIsIndividual && !caseLevelCurrent) reasons.push("pep_determination_outstanding");
  const coveredSubjects = new Set(current
    .filter((d: any) => d.party_screening_subject_id)
    .map((d: any) => String(d.party_screening_subject_id)));
  const missingPartyPep = (subjects ?? []).filter((s: any) =>
    s.required && s.state !== "not_required" &&
    pepDeterminationRequiredForRole(String(s.party_type)) &&
    !coveredSubjects.has(String(s.id))).length;
  if (missingPartyPep > 0) reasons.push(`${missingPartyPep}_party_pep_determination_outstanding`);

  return reasons;
}

async function clearanceBlockReasons(admin: any, caseId: string, assessment: any, openConditions: any[] = []): Promise<string[]> {
  const authoritativeInputs = await authoritativeMandatoryInputs(admin, caseId);
  const { data: triggers } = await admin.schema("aml").from("mandatory_triggers").select("*").eq("active", true);
  const authoritativeHolds = evaluateTriggers((triggers ?? []) as Trigger[], authoritativeInputs);
  const reasons: string[] = [];

  if (!assessment) reasons.push("no_assessment");
  if (openConditions.length > 0) reasons.push(`${openConditions.length}_open_conditions`);

  const assessmentBlocks = blockingHolds(assessment);
  if (assessmentBlocks.length > 0) reasons.push(`${assessmentBlocks.length}_blocking_holds`);

  const authoritativeBlocks = authoritativeHolds.filter((h) => h.severity === "block");
  for (const hold of authoritativeBlocks) reasons.push(`authoritative_${hold.key}`);

  // AUSTRAC's PEP controls gate the SERVICE, not just the score: a foreign
  // PEP (or high-risk domestic/international organisation PEP) cannot be
  // cleared or approved until EDD is complete and a designated senior
  // manager has approved. These are hold-severity in the assessment (a PEP
  // is never an automatic rejection) but explicit blockers here.
  if (authoritativeInputs.pep_edd_required === true && authoritativeInputs.edd_complete !== true) {
    reasons.push("pep_edd_outstanding");
  }
  if (authoritativeInputs.pep_approval_required === true && authoritativeInputs.pep_approval_granted !== true) {
    reasons.push("pep_senior_manager_approval_outstanding");
  }

  reasons.push(...await screeningCompletenessReasons(admin, caseId));

  return Array.from(new Set(reasons));
}

/**
 * Record a service-gate decision — the ONE implementation.
 *
 * ── Why this is a function and not two copies ─────────────────────────
 * The gate is now written from two places: `set_service_gate` (the
 * Decision stage's full card, every status) and `decide` (a CLEARED
 * decision carries its own gate). They must write the same row, with the
 * same provenance, or `gate_contract` starts reporting two different
 * shapes of the same fact.
 *
 * Everything a gate decision is for survives: the row, who approved it,
 * why, against which decision, under which policy version, with the
 * conditions attached, and the audit event stamped back onto the row.
 */
async function recordGateDecision(admin: any, args: {
  caseId: string;
  status: string;
  reason: string;
  decisionId: string | null;
  conditions: Array<{ id: string; label: string; status: string }>;
  policyVersion: string;
  actorId: string;
  actorLabel: string | null;
  previousStatus: string | null;
  effectiveAt?: string;
}): Promise<{ gate: any; error: string | null }> {
  const effectiveAt = args.effectiveAt ?? new Date().toISOString();
  const { data: gateRow, error: gateErr } = await admin.schema("aml")
    .from("service_gate_decisions").insert({
      case_id: args.caseId, status: args.status, effective_at: effectiveAt,
      conditions: args.conditions, decision_id: args.decisionId,
      approved_by: args.actorId, policy_version: args.policyVersion, reason: args.reason,
    }).select("*").maybeSingle();
  if (gateErr) return { gate: null, error: gateErr.message };

  await admin.schema("aml").from("cases").update({
    service_gate_status: args.status,
    service_gate_effective_at: effectiveAt,
    service_gate_policy_version: args.policyVersion,
  }).eq("id", args.caseId);

  const auditEventId = await appendCaseEvent(admin, args.caseId, "mlro_decision",
    `Service-gate change: ${String(args.previousStatus ?? "unset").replace(/_/g, " ")} → ${args.status.replace(/_/g, " ")}`,
    {
      gate_decision_id: gateRow?.id, status: args.status, reason: args.reason,
      decision_id: args.decisionId, policy_version: args.policyVersion,
      conditions: args.conditions,
    }, args.actorId, args.actorLabel);
  if (gateRow?.id && auditEventId) {
    await admin.schema("aml").from("service_gate_decisions")
      .update({ audit_event_id: auditEventId }).eq("id", gateRow.id);
  }
  return { gate: { ...gateRow, audit_event_id: auditEventId }, error: null };
}

/**
 * Gate statuses a decision must never move.
 *
 * A locked or terminated gate is the MLRO's own standing restriction — it
 * is how a live Passport is suspended or revoked — and re-recording a
 * decision must not revive it. This is the same rule `reopen_case` already
 * follows for exactly the same reason.
 */
const GATE_STOPPED_STATUSES = new Set(["locked", "terminated"]);

/**
 * Tenant-scoped authorization for the recommendation and service-gate ops.
 *
 * Restored: commit 1044a4e (a CORS header fix) removed this definition while
 * leaving all four call sites intact, so `recommend`, `list_recommendations`,
 * `set_service_gate` and `gate_contract` threw a ReferenceError instead of
 * authorizing. Roles are matched against the case's own tenant — a role held
 * in one tenant must not authorize a decision in another.
 */
async function tenantCaseAccess(admin: any, userId: string, caseId: string) {
  const { data: caseRow } = await admin.schema("aml").from("cases")
    .select("id, service_gate_status").eq("id", caseId).maybeSingle();
  if (!caseRow) return null;

  const tenantId = tenantForCase(String(caseRow.id));
  const [{ data: roleRows }, { data: isSuperadmin }] = await Promise.all([
    admin.schema("aml").from("role_assignments")
      .select("role").eq("user_id", userId).eq("tenant_id", tenantId).is("revoked_at", null),
    admin.schema("aml").rpc("is_superadmin", { _user_id: userId }),
  ]);
  const roles = new Set<string>((roleRows ?? []).map((r: any) => r.role));
  return {
    caseRow,
    canRead: Boolean(isSuperadmin) || roles.size > 0,
    canWrite: Boolean(isSuperadmin) || roles.has("analyst") || roles.has("reviewer") || roles.has("mlro"),
    canReview: Boolean(isSuperadmin) || roles.has("reviewer") || roles.has("mlro"),
    isMlro: Boolean(isSuperadmin) || roles.has("mlro"),
  };
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
    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === "service_role") return jr({ error: auth.error || "Authentication required" }, 401);
    const userId = auth.userId;
    const userLabel = auth.username ?? null;
    const { data: hasAny } = await admin.rpc("has_any_aml_role", { _user_id: userId });
    if (!hasAny) return jr({ error: "AML role required" }, 403);

    const { data: roleRows } = await admin.schema("aml").from("role_assignments")
      .select("role").eq("user_id", userId).is("revoked_at", null);
    const roles = new Set<string>((roleRows ?? []).map((r: any) => r.role));
    const canWrite = roles.has("analyst") || roles.has("reviewer") || roles.has("mlro");
    const canReview = roles.has("reviewer") || roles.has("mlro");
    const isMlro = roles.has("mlro");

    const op = String(body?.op ?? "");

    // ─── Configuration ─────────────────────────────────────────────
    if (op === "list_factors") {
      const { data } = await admin.schema("aml").from("risk_factors").select("*").order("category").order("label");
      return jr({ factors: data ?? [] });
    }
    if (op === "list_triggers") {
      const { data } = await admin.schema("aml").from("mandatory_triggers").select("*").order("severity").order("label");
      return jr({ triggers: data ?? [] });
    }
    if (op === "upsert_factor") {
      if (!isMlro) return jr({ error: "MLRO required" }, 403);
      const patch = body.factor ?? {};
      // WP-20: only declared columns — an unfiltered spread wrote whatever the
      // caller named onto the risk model MLRO decisions are scored against.
      const { data, error } = await admin.schema("aml").from("risk_factors")
        .upsert({ ...pickAllowed(patch, RISK_FACTOR_WRITABLE), created_by: patch.id ? undefined : userId }, { onConflict: "key" })
        .select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ factor: data });
    }
    if (op === "upsert_trigger") {
      if (!isMlro) return jr({ error: "MLRO required" }, 403);
      const patch = body.trigger ?? {};
      // WP-20: as above, for the mandatory-trigger table.
      const { data, error } = await admin.schema("aml").from("mandatory_triggers")
        .upsert({ ...pickAllowed(patch, MANDATORY_TRIGGER_WRITABLE), created_by: patch.id ? undefined : userId }, { onConflict: "key" })
        .select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ trigger: data });
    }

    // ─── Assessments ───────────────────────────────────────────────
    if (op === "evaluate") {
      if (!canWrite) return jr({ error: "Insufficient permissions" }, 403);
      const caseId = String(body.case_id ?? "");
      const inputs = (body.inputs ?? {}) as Record<string, any>;
      if (!caseId) return jr({ error: "case_id required" }, 400);

      // Resolve tenant policy for this case
      const { data: caseRow } = await admin.schema("aml").from("cases")
        .select("id, status").eq("id", caseId).maybeSingle();
      const tenantId = tenantForCase(caseId);
      const { data: tenant } = await admin.schema("aml").from("tenant_settings")
        .select("risk_program_version, straight_through_config").eq("tenant_id", tenantId).maybeSingle();
      const programVersion = (tenant?.risk_program_version as string) || "v1";
      const stConfig = (tenant?.straight_through_config as any) || { enabled: false };

      const [{ data: fs }, { data: ts }] = await Promise.all([
        admin.schema("aml").from("risk_factors").select("*").eq("active", true),
        admin.schema("aml").from("mandatory_triggers").select("*").eq("active", true),
      ]);

      const authoritativeInputs = await authoritativeMandatoryInputs(admin, caseId);
      const effectiveInputs = { ...inputs, ...authoritativeInputs };
      const scored = evaluateFactors((fs ?? []) as Factor[], effectiveInputs);
      const holds = evaluateTriggers((ts ?? []) as Trigger[], effectiveInputs);
      const blocking = holds.some((h) => h.severity === "block");
      const rating = blocking ? "prohibited" : ratingFor(scored.mltf_score);

      // Explainability: top ± contributors + trigger reasons
      const sortedFactors = [...scored.factor_breakdown].sort((a, b) => Math.abs(b.weighted) - Math.abs(a.weighted));
      const explanation = {
        top_positive: sortedFactors.filter((f) => f.weighted > 0).slice(0, 5),
        top_neutral_missing: sortedFactors.filter((f) => f.input == null).slice(0, 5),
        trigger_reasons: holds.map((h) => ({ key: h.key, label: h.label, severity: h.severity })),
        rating_band: rating,
        thresholds: { medium: 30, high: 60, prohibited: 80 },
      };

      // Policy provenance hash — captures the active factor+trigger set at eval time
      const policySnapshotHash = await sha256Hex(JSON.stringify({
        program_version: programVersion,
        factors: (fs ?? []).map((f: any) => ({ k: f.key, w: f.weight, s: f.scoring, a: f.active })).sort((a, b) => a.k.localeCompare(b.k)),
        triggers: (ts ?? []).map((t: any) => ({ k: t.key, s: t.severity, r: t.rule, a: t.active })).sort((a, b) => a.k.localeCompare(b.k)),
      }));

      // Straight-through eligibility
      const stEnabled = Boolean(stConfig?.enabled);
      const stEligible = canReview
        && stEnabled
        && rating === "low"
        && holds.length === 0
        && scored.mltf_score <= (Number(stConfig?.max_mltf_score) || 25)
        && scored.completion_score <= (Number(stConfig?.require_completion_score) || 70)
        && scored.verification_score <= (Number(stConfig?.require_verification_score) || 70);

      const { data: ass, error } = await admin.schema("aml").from("risk_assessments").insert({
        case_id: caseId,
        completion_score: scored.completion_score,
        verification_score: scored.verification_score,
        mltf_score: scored.mltf_score,
        risk_rating: rating,
        triggered_holds: holds,
        factor_breakdown: scored.factor_breakdown,
        inputs: effectiveInputs,
        computed_by: userId,
        program_version: programVersion,
        policy_snapshot_hash: policySnapshotHash,
        explanation,
        straight_through: stEligible,
      }).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);

      // reflect on case
      await admin.schema("aml").from("cases").update({
        risk_rating: rating,
        risk_score: Math.round(scored.mltf_score),
      }).eq("id", caseId);

      await appendCaseEvent(admin, caseId, "risk_rescored",
        `Risk assessment computed — ${rating.toUpperCase()} (${Math.round(scored.mltf_score)}) [policy ${programVersion}]`,
        { assessment_id: ass?.id, holds, scores: scored, program_version: programVersion, policy_snapshot_hash: policySnapshotHash },
        userId, userLabel);

      // Straight-through auto-decision (low risk, clean, tenant-enabled).
      // The same completeness gate as a human decision: outstanding required
      // screening or PEP work disqualifies auto-clearance rather than being
      // skipped past.
      let auto_decision: any = null;
      const stBlockers = stEligible
        ? (await clearanceBlockReasons(admin, caseId, ass, [])).filter((r) => r !== "no_assessment")
        : [];
      if (stEligible && stBlockers.length === 0) {
        const snapshot = {
          version: 1, decided_at: new Date().toISOString(), decided_by: userId,
          outcome: "cleared", rationale: `Straight-through auto-clearance under policy ${programVersion}`,
          case: caseRow, assessment: ass, open_conditions: [], approved_overrides: [],
          straight_through: true, straight_through_config: stConfig,
        };
        const snapshot_hash = await sha256Hex(JSON.stringify(snapshot));
        const { data: dec } = await admin.schema("aml").from("decisions").insert({
          case_id: caseId, assessment_id: ass?.id ?? null, outcome: "cleared",
          rationale: `Straight-through auto-clearance (policy ${programVersion}) — low MLTF, no holds, thresholds met.`,
          snapshot, snapshot_hash, decided_by: userId,
          program_version: programVersion, is_straight_through: true,
        }).select("*").maybeSingle();
        auto_decision = dec;
        await admin.schema("aml").from("cases").update({ status: "cleared" }).eq("id", caseId);
        await appendCaseEvent(admin, caseId, "mlro_decision",
          `Straight-through auto-cleared (policy ${programVersion})`,
          { decision_id: dec?.id, snapshot_hash, straight_through: true }, userId, userLabel);
      }

      return jr({
        assessment: ass, auto_decision, program_version: programVersion,
        straight_through: stEligible && stBlockers.length === 0,
        ...(stEligible && stBlockers.length > 0 ? { straight_through_blocked_by: stBlockers } : {}),
      });
    }


    if (op === "list_assessments") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const { data } = await admin.schema("aml").from("risk_assessments")
        .select("*").eq("case_id", caseId).order("created_at", { ascending: false }).limit(50);
      return jr({ assessments: data ?? [] });
    }

    if (op === "get_assessment") {
      const id = String(body.assessment_id ?? "");
      const { data } = await admin.schema("aml").from("risk_assessments").select("*").eq("id", id).maybeSingle();
      return jr({ assessment: data });
    }

    // ─── Overrides ─────────────────────────────────────────────────
    // §12.8: no rating override without reason, evidence, decision-maker,
    // policy version and an audit event. Evidence is captured at request
    // time; the policy version is stamped when the reviewer resolves.
    if (op === "request_override") {
      if (!canWrite) return jr({ error: "Insufficient permissions" }, 403);
      const { case_id, assessment_id, requested_reason, requested_rating } = body;
      const evidence = String(body.evidence ?? "").trim();
      if (!case_id || !requested_reason) return jr({ error: "case_id and requested_reason required" }, 400);
      if (String(requested_reason).trim().length < 10) return jr({ error: "requested_reason must be at least 10 characters" }, 400);
      if (evidence.length < 10) {
        return jr({ error: "evidence is required — describe or reference the material supporting the override" }, 400);
      }
      const { data, error } = await admin.schema("aml").from("risk_overrides").insert({
        case_id, assessment_id: assessment_id ?? null, requested_by: userId,
        requested_reason, requested_rating: requested_rating ?? null, status: "pending",
        evidence_note: evidence,
      }).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, case_id, "edd_note", `Risk override requested`,
        { override_id: data?.id, requested_rating, evidence }, userId, userLabel);
      return jr({ override: data });
    }

    if (op === "resolve_override") {
      if (!canReview) return jr({ error: "Reviewer/MLRO required" }, 403);
      const { override_id, status, reviewer_note } = body;
      if (!override_id || !["approved", "rejected"].includes(status)) return jr({ error: "invalid" }, 400);
      const { data: existing } = await admin.schema("aml").from("risk_overrides")
        .select("id, case_id").eq("id", override_id).maybeSingle();
      if (!existing) return jr({ error: "Override not found" }, 404);
      const { data: tenantPolicy } = await admin.schema("aml").from("tenant_settings")
        .select("risk_program_version")
        .eq("tenant_id", tenantForCase(String(existing.case_id))).maybeSingle();
      const overridePolicyVersion = (tenantPolicy?.risk_program_version as string) || "v1";
      const { data, error } = await admin.schema("aml").from("risk_overrides").update({
        status, reviewer_id: userId, reviewer_note: reviewer_note ?? null, decided_at: new Date().toISOString(),
        program_version: overridePolicyVersion,
      }).eq("id", override_id).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      if (data) {
        if (status === "approved" && data.requested_rating) {
          await admin.schema("aml").from("cases").update({ risk_rating: data.requested_rating }).eq("id", data.case_id);
        }
        await appendCaseEvent(admin, data.case_id, "mlro_decision",
          `Risk override ${status} [policy ${overridePolicyVersion}]`,
          { override_id, reviewer_note, program_version: overridePolicyVersion, evidence: data.evidence_note ?? null },
          userId, userLabel);
      }
      return jr({ override: data });
    }

    if (op === "list_overrides") {
      const caseId = body.case_id ? String(body.case_id) : null;
      let q = admin.schema("aml").from("risk_overrides").select("*").order("created_at", { ascending: false }).limit(200);
      if (caseId) q = q.eq("case_id", caseId);
      if (body.status) q = q.eq("status", body.status);
      const { data } = await q;
      return jr({ overrides: data ?? [] });
    }

    // ─── Decisions ─────────────────────────────────────────────────
    if (op === "decide") {
      if (!canReview) return jr({ error: "Reviewer/MLRO required" }, 403);
      const { case_id, assessment_id, outcome, rationale } = body;
      if (!case_id || !outcome) return jr({ error: "case_id and outcome required" }, 400);
      const [{ data: caseRow }, { data: ass }, { data: conds }, { data: overs }] = await Promise.all([
        admin.schema("aml").from("cases").select("*").eq("id", case_id).maybeSingle(),
        assessment_id
          ? admin.schema("aml").from("risk_assessments").select("*").eq("id", assessment_id).maybeSingle()
          : admin.schema("aml").from("risk_assessments").select("*").eq("case_id", case_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        admin.schema("aml").from("case_conditions").select("*").eq("case_id", case_id).eq("status", "open"),
        admin.schema("aml").from("risk_overrides").select("*").eq("case_id", case_id).eq("status", "approved"),
      ]);

      const tenantId = tenantForCase(String(case_id));
      const { data: tenant } = await admin.schema("aml").from("tenant_settings")
        .select("risk_program_version").eq("tenant_id", tenantId).maybeSingle();
      const programVersion = (tenant?.risk_program_version as string) || (ass?.program_version as string) || "v1";

      const clearanceReasons = outcome === "cleared"
        ? await clearanceBlockReasons(admin, case_id, ass, conds ?? [])
        : [];
      if (clearanceReasons.length > 0) {
        return jr({ error: "Cannot clear AML case with unresolved mandatory holds", reasons: clearanceReasons }, 409);
      }

      const snapshot = {
        version: 1, decided_at: new Date().toISOString(), decided_by: userId,
        outcome, rationale: rationale ?? null, program_version: programVersion,
        case: caseRow, assessment: ass, open_conditions: conds ?? [], approved_overrides: overs ?? [],
      };
      const snapshot_hash = await sha256Hex(JSON.stringify(snapshot));

      const { data: dec, error } = await admin.schema("aml").from("decisions").insert({
        case_id, assessment_id: ass?.id ?? null, outcome, rationale: rationale ?? null,
        snapshot, snapshot_hash, decided_by: userId,
        program_version: programVersion, is_straight_through: false,
      }).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);

      /*
       * Reflect the outcome on the case — ALL FOUR dimensions, the way the
       * transition op has always synced them. This wrote only the legacy
       * `status`, leaving the canonical `case_stage` at `staff_review`, so a
       * cleared case's Decision stage never turned green, the live position
       * still said "Staff review", and the client portal never learned the
       * outcome (the same desync reopen_case had; caseStage() prefers the
       * explicit column). Mirrors aml-cases' STATUS_TO_STAGE /
       * STATUS_TO_CLIENT_PORTAL for these three statuses.
       */
      let toStatus: string | null = null;
      if (outcome === "cleared") toStatus = "cleared";
      else if (outcome === "blocked") toStatus = "blocked";
      else if (outcome === "escalated") toStatus = "escalated_mlro";
      if (toStatus) {
        const DECIDE_STATUS_TO_STAGE: Record<string, string> = {
          cleared: "cleared", blocked: "blocked", escalated_mlro: "decision_pending",
        };
        const DECIDE_STATUS_TO_CLIENT_PORTAL: Record<string, string> = {
          cleared: "complete", blocked: "contact_adviser", escalated_mlro: "under_review",
        };
        await admin.schema("aml").from("cases").update({
          status: toStatus,
          case_stage: DECIDE_STATUS_TO_STAGE[toStatus],
          client_portal_status: DECIDE_STATUS_TO_CLIENT_PORTAL[toStatus],
        }).eq("id", case_id);
      }

      /*
       * ── The cleared decision CARRIES the service gate ─────────────────
       *
       * It used to leave the gate alone, so a reviewer who cleared a case
       * still owed a second decision on Stage 9 — and the platform then
       * disagreed with itself, because `aml-cases`' `transition` has always
       * mapped `cleared → approved`. Which one you got depended on which
       * button moved the case, and `AML-2026-00005` ended up `cleared` with
       * a gate reading `under_review`, on a screen that could not explain
       * why. `aml.service_gate_decisions` held ZERO rows across the whole
       * database: the explicit act had never once been performed.
       *
       * The second decision asked no new question. `clearanceBlockReasons`
       * — the SAME function, with the same inputs — has just run above, and
       * run stricter (it includes the open conditions, which the gate op
       * checked separately). Nothing between the two acts could change the
       * answer, so the gate was ceremony rather than a control.
       *
       * Three rules keep it a record rather than a shortcut.
       *
       *   · **Only `cleared` grants.** A blocked or escalated outcome never
       *     moves the gate: a restriction stays an explicit, deliberate act
       *     on the Decision stage, and locking or terminating still requires
       *     the MLRO.
       *   · **A stopped gate is never revived.** Locked and terminated are
       *     the MLRO's standing restriction and the only way a live Passport
       *     is suspended or revoked. Re-recording a decision must not undo
       *     that — the same rule `reopen_case` follows.
       *   · **Open conditions mean `approved_with_controls`**, never plain
       *     `approved`, exactly as `set_service_gate` requires.
       *
       * The row is still written in full — approver, reason, decision id,
       * policy version, conditions, audit event — through the same
       * `recordGateDecision` the explicit op uses. The ceremony goes; the
       * record does not.
       */
      if (outcome === "cleared" && caseRow
        && !GATE_STOPPED_STATUSES.has(String(caseRow.service_gate_status ?? ""))) {
        const openConditions = (conds ?? []).map((c: any) => ({
          id: c.id, label: c.label, status: c.status,
        }));
        const gateStatus = openConditions.length > 0 ? "approved_with_controls" : "approved";
        if (String(caseRow.service_gate_status ?? "") !== gateStatus) {
          const written = await recordGateDecision(admin, {
            caseId: case_id,
            status: gateStatus,
            /* The decision's own rationale is the gate's reason: it is the
               same reasoning, given once. A decision recorded without one
               still records why the gate moved and what moved it. */
            reason: (typeof rationale === "string" && rationale.trim().length >= 10)
              ? rationale.trim()
              : "Granted by the recorded cleared compliance decision on this case.",
            decisionId: dec?.id ?? null,
            conditions: openConditions,
            policyVersion: programVersion,
            actorId: userId, actorLabel: userLabel,
            previousStatus: caseRow.service_gate_status ?? null,
          });
          /* A gate that could not be written must not silently look
             approved: the decision stands, and the Decision stage's full
             gate card remains the way to record it. */
          if (written.error) {
            await appendCaseEvent(admin, case_id, "mlro_decision",
              "Service gate could not be recorded from the cleared decision",
              { error: written.error, decision_id: dec?.id ?? null }, userId, userLabel);
          }
        }
      }

      // Close the recommendation loop (§12.8): the analyst recommendation the
      // reviewer acted on is stamped with this decision, not left dangling.
      if (dec?.id) {
        await admin.schema("aml").from("analyst_recommendations")
          .update({ status: "actioned", actioned_decision_id: dec.id })
          .eq("case_id", case_id).eq("status", "pending");
      }

      await appendCaseEvent(admin, case_id, "mlro_decision",
        `Decision recorded: ${outcome} [policy ${programVersion}]`,
        { decision_id: dec?.id, snapshot_hash, program_version: programVersion }, userId, userLabel);
      return jr({ decision: dec });
    }

    /*
     * What stands between this case and clearance, as a READ — the same
     * `clearanceBlockReasons` the decide and gate ops enforce, exposed so
     * the screen can show the named blockers BEFORE the click instead of
     * a 409 whose reasons the client used to discard. One implementation:
     * this op can never disagree with the refusal.
     */
    if (op === "clearance_readiness") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const access = await tenantCaseAccess(admin, userId, caseId);
      if (!access) return jr({ error: "Case not found" }, 404);
      if (!access.canRead) return jr({ error: "AML role required for case tenant" }, 403);
      const [{ data: ass }, { data: conds }] = await Promise.all([
        admin.schema("aml").from("risk_assessments").select("*").eq("case_id", caseId)
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        admin.schema("aml").from("case_conditions").select("*").eq("case_id", caseId).eq("status", "open"),
      ]);
      const reasons = await clearanceBlockReasons(admin, caseId, ass, conds ?? []);
      return jr({ ready: reasons.length === 0, reasons });
    }

    if (op === "policy_snapshot") {
      const tenantId = String(body.tenant_id ?? "default");
      const [{ data: tenant }, { data: fs }, { data: ts }] = await Promise.all([
        admin.schema("aml").from("tenant_settings")
          .select("risk_program_version, straight_through_config").eq("tenant_id", tenantId).maybeSingle(),
        admin.schema("aml").from("risk_factors").select("*").eq("active", true).order("category").order("label"),
        admin.schema("aml").from("mandatory_triggers").select("*").eq("active", true).order("severity").order("label"),
      ]);
      const programVersion = (tenant?.risk_program_version as string) || "v1";
      const snapshotHash = await sha256Hex(JSON.stringify({
        program_version: programVersion,
        factors: (fs ?? []).map((f: any) => ({ k: f.key, w: f.weight, s: f.scoring, a: f.active })).sort((a, b) => a.k.localeCompare(b.k)),
        triggers: (ts ?? []).map((t: any) => ({ k: t.key, s: t.severity, r: t.rule, a: t.active })).sort((a, b) => a.k.localeCompare(b.k)),
      }));
      return jr({
        program_version: programVersion,
        straight_through_config: tenant?.straight_through_config ?? { enabled: false },
        policy_snapshot_hash: snapshotHash,
        factors: fs ?? [],
        triggers: ts ?? [],
        tenant_id: tenantId,
      });
    }

    if (op === "update_risk_policy") {
      if (!isMlro) return jr({ error: "MLRO required" }, 403);
      const tenantId = String(body.tenant_id ?? "default");
      const patch: Record<string, any> = {};
      if (typeof body.risk_program_version === "string") patch.risk_program_version = body.risk_program_version;
      if (body.straight_through_config && typeof body.straight_through_config === "object") {
        patch.straight_through_config = body.straight_through_config;
      }
      if (Object.keys(patch).length === 0) return jr({ error: "Nothing to update" }, 400);
      const { data, error } = await admin.schema("aml").from("tenant_settings")
        .update(patch).eq("tenant_id", tenantId).select("tenant_id, risk_program_version, straight_through_config").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      return jr({ tenant: data });
    }


    if (op === "list_decisions") {
      const caseId = String(body.case_id ?? "");
      const { data } = await admin.schema("aml").from("decisions")
        .select("*").eq("case_id", caseId).order("decided_at", { ascending: false });
      return jr({ decisions: data ?? [] });
    }

    if (op === "latest_decision") {
      const caseId = String(body.case_id ?? "");
      const { data } = await admin.schema("aml").from("decisions")
        .select("*").eq("case_id", caseId).order("decided_at", { ascending: false }).limit(1).maybeSingle();
      return jr({ decision: data });
    }

    // ─── Approvals (senior authority sign-off queue) ───────────────
    if (op === "list_approvals") {
      let q = admin.schema("aml").from("approvals").select("*").order("requested_at", { ascending: false }).limit(200);
      if (body.case_id) q = q.eq("case_id", body.case_id);
      if (body.status) q = q.eq("status", body.status);
      const { data } = await q;
      return jr({ approvals: data ?? [] });
    }
    if (op === "request_approval") {
      if (!canWrite) return jr({ error: "Insufficient permissions" }, 403);
      const caseId = String(body.case_id ?? "");
      const kind = String(body.kind ?? "");
      const note = String(body.note ?? "").trim();
      // pep_service_approval is the AUSTRAC senior-manager approval to
      // provide (or continue providing) the designated service to a PEP.
      if (!caseId || !["pep_service_approval"].includes(kind)) {
        return jr({ error: "case_id and kind (pep_service_approval) required" }, 400);
      }
      const { data: pending } = await admin.schema("aml").from("approvals")
        .select("id").eq("case_id", caseId).eq("kind", kind).eq("status", "pending").limit(1);
      if ((pending ?? []).length > 0) {
        return jr({ approval: null, skipped: true, code: "already_pending" });
      }
      const { data, error } = await admin.schema("aml").from("approvals").insert({
        case_id: caseId, kind, status: "pending", requested_by: userId, note: note || null,
      }).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, caseId, "edd_note",
        `Senior manager approval requested (${kind.replace(/_/g, " ")})`,
        { approval_id: data?.id, kind }, userId, userLabel);
      return jr({ approval: data });
    }
    if (op === "resolve_approval") {
      if (!canReview) return jr({ error: "Reviewer/MLRO required" }, 403);
      const { approval_id, status, note } = body;
      if (!approval_id || !["approved", "rejected"].includes(status)) return jr({ error: "invalid" }, 400);
      const { data: approval } = await admin.schema("aml").from("approvals")
        .select("id, case_id, kind, status").eq("id", approval_id).maybeSingle();
      if (!approval) return jr({ error: "Approval not found" }, 404);
      // AUSTRAC's senior-manager requirements name a defined role that is NOT
      // automatically the MLRO. A PEP service approval may only be resolved
      // by someone the organisation has explicitly designated a senior
      // manager — holding the mlro or reviewer role is not, on its own, that
      // designation. The approval is also LINKED: it approves the current
      // PEP determinations as they stand, and those ids are recorded so the
      // evidence says exactly what was approved. A later determination
      // postdates the approval and re-opens the requirement (the risk inputs
      // compare resolved_at against determined_at).
      let approvedDeterminationIds: string[] = [];
      if (approval.kind === "pep_service_approval") {
        const { data: designation } = await admin.schema("aml").from("senior_manager_designations")
          .select("id").eq("user_id", userId)
          .eq("tenant_id", tenantForCase(String(approval.case_id)))
          .is("revoked_at", null).limit(1).maybeSingle();
        if (!designation) {
          return jr({
            error: "PEP service approval requires a recorded senior-manager designation. Your account is not designated — an MLRO can record designations under AML Configuration.",
            code: "senior_manager_designation_required",
          }, 403);
        }
        const { data: currentDets } = await admin.schema("aml").from("pep_determinations")
          .select("id, result").eq("case_id", approval.case_id).is("superseded_at", null);
        approvedDeterminationIds = (currentDets ?? [])
          .filter((d: any) => d.result === "pep").map((d: any) => String(d.id));
        if (status === "approved" && approvedDeterminationIds.length === 0) {
          return jr({
            error: "There is no current PEP determination on this case to approve — record the determination first",
            code: "no_current_pep_determination",
          }, 409);
        }
      }
      const { data, error } = await admin.schema("aml").from("approvals").update({
        status, approver_id: userId, note: note ?? null, resolved_at: new Date().toISOString(),
      }).eq("id", approval_id).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      if (data) await appendCaseEvent(admin, data.case_id, "mlro_decision", `Approval ${status} (${data.kind})`, {
        approval_id, note, kind: data.kind,
        ...(approvedDeterminationIds.length > 0 ? { pep_determination_ids: approvedDeterminationIds } : {}),
      }, userId, userLabel);
      return jr({ approval: data });
    }

    // ─── Senior manager designations (governance record) ───────────
    // MLRO-recorded register of who counts as a senior manager for the
    // approvals current AUSTRAC guidance assigns to that role. Recording a
    // designation grants nothing else.
    if (op === "list_senior_managers") {
      const tenantId = String(body.tenant_id ?? "default");
      const { data } = await admin.schema("aml").from("senior_manager_designations")
        .select("*").eq("tenant_id", tenantId).order("designated_at", { ascending: false }).limit(200);
      return jr({ designations: data ?? [] });
    }
    if (op === "designate_senior_manager") {
      if (!isMlro) return jr({ error: "MLRO required" }, 403);
      const targetUserId = String(body.user_id ?? "");
      const note = String(body.note ?? "").trim();
      if (!targetUserId) return jr({ error: "user_id required" }, 400);
      if (note.length < 10) {
        return jr({ error: "A note of at least 10 characters is required — record who this person is and why they qualify as a senior manager" }, 400);
      }
      const tenantId = String(body.tenant_id ?? "default");
      const { data, error } = await admin.schema("aml").from("senior_manager_designations").insert({
        tenant_id: tenantId, user_id: targetUserId,
        designated_by: userId, designated_by_label: userLabel, note,
      }).select("*").maybeSingle();
      if (error) {
        if (String(error.code) === "23505") return jr({ error: "That user already holds an active designation" }, 409);
        return jr({ error: error.message }, 400);
      }
      return jr({ designation: data });
    }
    if (op === "revoke_senior_manager") {
      if (!isMlro) return jr({ error: "MLRO required" }, 403);
      const designationId = String(body.designation_id ?? "");
      if (!designationId) return jr({ error: "designation_id required" }, 400);
      const { data, error } = await admin.schema("aml").from("senior_manager_designations")
        .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
        .eq("id", designationId).is("revoked_at", null).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      if (!data) return jr({ error: "Designation not found or already revoked" }, 404);
      return jr({ designation: data });
    }

    // ─── Conditions ────────────────────────────────────────────────
    if (op === "list_conditions") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const { data } = await admin.schema("aml").from("case_conditions")
        .select("*").eq("case_id", caseId).order("created_at", { ascending: false });
      return jr({ conditions: data ?? [] });
    }
    if (op === "upsert_condition") {
      if (!canWrite) return jr({ error: "Insufficient permissions" }, 403);
      const patch = body.condition ?? {};
      const row = { ...patch, created_by: patch.id ? undefined : userId };
      const { data, error } = await admin.schema("aml").from("case_conditions")
        .upsert(row).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      if (data) await appendCaseEvent(admin, data.case_id, "edd_note",
        `Case condition ${patch.id ? "updated" : "added"}: ${data.label}`, { condition_id: data.id }, userId, userLabel);
      return jr({ condition: data });
    }
    if (op === "resolve_condition") {
      if (!canWrite) return jr({ error: "Insufficient permissions" }, 403);
      const { condition_id, status } = body;
      const { data, error } = await admin.schema("aml").from("case_conditions").update({
        status: status ?? "resolved", resolved_by: userId, resolved_at: new Date().toISOString(),
      }).eq("id", condition_id).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      if (data) await appendCaseEvent(admin, data.case_id, "edd_note", `Condition ${data.status}: ${data.label}`, { condition_id }, userId, userLabel);
      return jr({ condition: data });
    }

    // ─── Purchase-Ready Gate (soft, flag-guarded) ──────────────────
    if (op === "gate_status") {
      const caseId = body.case_id ? String(body.case_id) : null;
      const purchaseFileId = body.purchase_file_id ? String(body.purchase_file_id) : null;
      const { data: flag } = await admin.from("feature_flags").select("value").eq("key", "aml_purchase_ready_gate").maybeSingle();
      const enabled = Boolean((flag?.value as any)?.enabled);

      let effectiveCaseId = caseId;
      if (!effectiveCaseId && purchaseFileId) {
        const { data: c } = await admin.schema("aml").from("cases")
          .select("id").eq("purchase_file_id", purchaseFileId).order("opened_at", { ascending: false }).limit(1).maybeSingle();
        effectiveCaseId = c?.id ?? null;
      }
      if (!effectiveCaseId) return jr({ enabled, gate: "no_case", purchase_ready: !enabled, reasons: enabled ? ["no_aml_case"] : [] });

      const [{ data: dec }, { data: cond }, { data: ass }] = await Promise.all([
        admin.schema("aml").from("decisions").select("*").eq("case_id", effectiveCaseId).order("decided_at", { ascending: false }).limit(1).maybeSingle(),
        admin.schema("aml").from("case_conditions").select("*").eq("case_id", effectiveCaseId).eq("status", "open"),
        admin.schema("aml").from("risk_assessments").select("*").eq("case_id", effectiveCaseId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

      const reasons: string[] = [];
      if (!dec) reasons.push("no_decision");
      else if (dec.outcome !== "cleared") reasons.push(`decision_${dec.outcome}`);
      reasons.push(...await clearanceBlockReasons(admin, effectiveCaseId, ass, cond ?? []));

      const purchase_ready = reasons.length === 0;
      // If gate flag disabled we still return the diagnostic but purchase_ready defaults to true.
      return jr({
        enabled,
        purchase_ready: enabled ? purchase_ready : true,
        diagnostic: { purchase_ready, reasons, latest_decision: dec, open_conditions: cond ?? [], latest_assessment: ass },
      });
    }

    // ─── Analyst recommendations (Phase 8, §12.8) ──────────────────
    // Analysts record a recommended outcome + rationale; reviewers see it
    // when deciding. A new recommendation supersedes the previous pending
    // one; `decide` stamps pending recommendations as actioned.
    if (op === "recommend") {
      const caseId = String(body.case_id ?? "");
      const outcome = String(body.recommended_outcome ?? "");
      const rationale = String(body.rationale ?? "").trim();
      const RECOMMENDED_OUTCOMES = ["cleared", "cleared_with_conditions", "edd_required", "escalated", "blocked"];
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const access = await tenantCaseAccess(admin, userId, caseId);
      if (!access) return jr({ error: "Case not found" }, 404);
      if (!access.canWrite) return jr({ error: "Insufficient permissions" }, 403);
      if (!RECOMMENDED_OUTCOMES.includes(outcome)) return jr({ error: "recommended_outcome invalid" }, 400);
      if (rationale.length < 10) return jr({ error: "rationale must be at least 10 characters" }, 400);

      const { data: latestAss } = await admin.schema("aml").from("risk_assessments")
        .select("id").eq("case_id", caseId).order("created_at", { ascending: false }).limit(1).maybeSingle();

      await admin.schema("aml").from("analyst_recommendations")
        .update({ status: "superseded" }).eq("case_id", caseId).eq("status", "pending");
      const { data, error } = await admin.schema("aml").from("analyst_recommendations").insert({
        case_id: caseId,
        assessment_id: body.assessment_id ? String(body.assessment_id) : (latestAss?.id ?? null),
        recommended_outcome: outcome, rationale, status: "pending", created_by: userId,
      }).select("*").maybeSingle();
      if (error) return jr({ error: error.message }, 400);
      await appendCaseEvent(admin, caseId, "edd_note",
        `Analyst recommendation recorded: ${outcome.replace(/_/g, " ")}`,
        { recommendation_id: data?.id, assessment_id: data?.assessment_id }, userId, userLabel);
      return jr({ recommendation: data });
    }

    if (op === "list_recommendations") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const access = await tenantCaseAccess(admin, userId, caseId);
      if (!access) return jr({ error: "Case not found" }, 404);
      if (!access.canRead) return jr({ error: "AML role required for case tenant" }, 403);
      const { data } = await admin.schema("aml").from("analyst_recommendations")
        .select("*").eq("case_id", caseId).order("created_at", { ascending: false }).limit(50);
      return jr({ recommendations: data ?? [] });
    }

    // ─── Service-gate decisions (Phase 8, §16 + Appendix C.4) ──────
    // The ONLY writer of the service-gate dimension after activation. The
    // gate is never inferred from case stage or risk rating: every change is
    // an explicit, reasoned, audited decision with recorded preconditions.
    if (op === "set_service_gate") {
      const caseId = String(body.case_id ?? "");
      const status = String(body.status ?? "");
      const reason = String(body.reason ?? "").trim();
      const GATE_STATUSES = [
        "cdd_incomplete", "information_outstanding", "under_review",
        "conditions_outstanding", "approved_with_controls", "approved",
        "locked", "terminated",
      ];
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const access = await tenantCaseAccess(admin, userId, caseId);
      if (!access) return jr({ error: "Case not found" }, 404);
      if (!access.canReview) return jr({ error: "Reviewer/MLRO required for case tenant" }, 403);
      if (!GATE_STATUSES.includes(status)) return jr({ error: "status invalid" }, 400);
      if (reason.length < 10) return jr({ error: "reason must be at least 10 characters" }, 400);
      if ((status === "locked" || status === "terminated") && !access.isMlro) {
        return jr({ error: "Locking or terminating the service gate requires the MLRO" }, 403);
      }

      const caseRow = access.caseRow;
      const { data: tenant } = await admin.schema("aml").from("tenant_settings")
        .select("risk_program_version")
        .eq("tenant_id", tenantForCase(String(caseRow.id))).maybeSingle();
      const gatePolicyVersion = (tenant?.risk_program_version as string) || "v1";

      const [{ data: latestDec }, { data: openConds }, { data: latestAss }] = await Promise.all([
        admin.schema("aml").from("decisions").select("*").eq("case_id", caseId)
          .order("decided_at", { ascending: false }).limit(1).maybeSingle(),
        admin.schema("aml").from("case_conditions").select("*").eq("case_id", caseId).eq("status", "open"),
        admin.schema("aml").from("risk_assessments").select("*").eq("case_id", caseId)
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

      // Approval preconditions: a recorded cleared decision, no mandatory
      // blockers, and the conditions state matching the gate being granted.
      if (status === "approved" || status === "approved_with_controls") {
        if (!latestDec || latestDec.outcome !== "cleared") {
          return jr({ error: "Approving the service gate requires a recorded cleared decision", code: "gate_requires_cleared_decision" }, 409);
        }
        const blockers = await clearanceBlockReasons(admin, caseId, latestAss, []);
        const hardBlockers = blockers.filter((r) => r !== "no_assessment");
        if (hardBlockers.length > 0) {
          return jr({ error: "Cannot approve the service gate with unresolved mandatory holds", reasons: hardBlockers }, 409);
        }
        if (status === "approved" && (openConds ?? []).length > 0) {
          return jr({ error: "Open conditions exist — use approved_with_controls or resolve them first", code: "open_conditions" }, 409);
        }
        if (status === "approved_with_controls" && (openConds ?? []).length === 0) {
          return jr({ error: "approved_with_controls requires at least one open condition recording the controls", code: "no_controls" }, 409);
        }
      }

      const gateConditions = (openConds ?? []).map((c: any) => ({ id: c.id, label: c.label, status: c.status }));
      const written = await recordGateDecision(admin, {
        caseId, status, reason,
        decisionId: latestDec?.id ?? null,
        conditions: gateConditions,
        policyVersion: gatePolicyVersion,
        actorId: userId, actorLabel: userLabel,
        previousStatus: caseRow.service_gate_status ?? null,
      });
      if (written.error) return jr({ error: written.error }, 400);
      return jr({ gate: written.gate });
    }

    // Appendix C.4 read contract for the latest gate decision.
    if (op === "gate_contract") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const access = await tenantCaseAccess(admin, userId, caseId);
      if (!access) return jr({ error: "Case not found" }, 404);
      if (!access.canRead) return jr({ error: "AML role required for case tenant" }, 403);
      const [{ data: gateRow }, { data: caseRow }] = await Promise.all([
        admin.schema("aml").from("service_gate_decisions").select("*").eq("case_id", caseId)
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        admin.schema("aml").from("cases")
          .select("service_gate_status, service_gate_effective_at, service_gate_policy_version, status")
          .eq("id", caseId).maybeSingle(),
      ]);
      if (!caseRow) return jr({ error: "Case not found" }, 404);
      if (gateRow) {
        return jr({
          gate: {
            status: gateRow.status, effective_at: gateRow.effective_at,
            conditions: gateRow.conditions ?? [], decision_id: gateRow.decision_id,
            approved_by: gateRow.approved_by, policy_version: gateRow.policy_version,
            audit_event_id: gateRow.audit_event_id, reason: gateRow.reason,
          },
        });
      }
      // No explicit gate decision yet — report the dimension column state
      // (activation sets cdd_incomplete) with no approval provenance.
      return jr({
        gate: {
          status: caseRow.service_gate_status ?? "not_activated",
          effective_at: caseRow.service_gate_effective_at ?? null,
          conditions: [], decision_id: null, approved_by: null,
          policy_version: caseRow.service_gate_policy_version ?? null,
          audit_event_id: null, reason: null,
        },
      });
    }

    // ─── Recalculation triggers (Phase 8, §12.8) ───────────────────
    // Reports whether material inputs changed after the latest assessment,
    // so stale ratings are visibly stale and get recomputed.
    if (op === "recalc_status") {
      const caseId = String(body.case_id ?? "");
      if (!caseId) return jr({ error: "case_id required" }, 400);
      const { data: latestAss } = await admin.schema("aml").from("risk_assessments")
        .select("id, created_at").eq("case_id", caseId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!latestAss) return jr({ recalc: { stale: true, reasons: ["no_assessment"], latest_assessment_at: null } });

      const since = latestAss.created_at;
      const [scr, idv, canonicalIdv, fin, quest, cp, partyScr, pepDet] = await Promise.all([
        admin.schema("aml").from("screening_checks").select("id", { count: "exact", head: true })
          .eq("case_id", caseId).gt("updated_at", since),
        admin.schema("aml").from("identity_checks").select("id", { count: "exact", head: true })
          .eq("case_id", caseId).gt("updated_at", since),
        // Canonical portal/manual verification outcomes also stale the
        // assessment; completed_at bounds it to actual results, not
        // worker-pipeline churn.
        admin.schema("aml").from("verification_checks").select("id", { count: "exact", head: true })
          .eq("case_id", caseId).gt("completed_at", since),
        admin.schema("aml").from("finance_comparisons").select("id", { count: "exact", head: true })
          .eq("case_id", caseId).gt("captured_at", since),
        admin.schema("aml").from("questionnaire_responses").select("id", { count: "exact", head: true })
          .eq("case_id", caseId).gt("updated_at", since),
        admin.schema("aml").from("counterparty_cases").select("id", { count: "exact", head: true })
          .eq("case_id", caseId).gt("updated_at", since),
        admin.schema("aml").from("party_screening_subjects").select("id", { count: "exact", head: true })
          .eq("case_id", caseId).gt("updated_at", since),
        admin.schema("aml").from("pep_determinations").select("id", { count: "exact", head: true })
          .eq("case_id", caseId).gt("determined_at", since),
      ]);
      const reasons: string[] = [];
      if ((scr.count ?? 0) > 0 || (partyScr.count ?? 0) > 0) reasons.push("screening_changed");
      if ((idv.count ?? 0) > 0 || (canonicalIdv.count ?? 0) > 0) reasons.push("verification_changed");
      if ((fin.count ?? 0) > 0) reasons.push("funding_changed");
      if ((quest.count ?? 0) > 0) reasons.push("questionnaire_changed");
      if ((cp.count ?? 0) > 0) reasons.push("counterparty_changed");
      // A PEP finding makes the assessment stale so it is re-run with the
      // authoritative pep inputs — never silently, never moving the gate.
      if ((pepDet.count ?? 0) > 0) reasons.push("pep_changed");
      return jr({ recalc: { stale: reasons.length > 0, reasons, latest_assessment_at: since } });
    }

    return jr({ error: `Unknown op: ${op}` }, 400);
  } catch (e) {
    console.error("aml-risk error", e);
    return jr({ ...internalError(e, 'aml-risk') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
