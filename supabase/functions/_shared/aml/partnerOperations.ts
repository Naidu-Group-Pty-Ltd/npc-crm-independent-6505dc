/**
 * Partner compliance operations, reporting and readiness — the pure domain
 * layer (Phase 8).
 *
 * The edge function counts rows and probes the database; THIS module owns
 * the decisions:
 *
 *  - the queue catalogue: label, responsible role, capability requirement
 *    and the register filter every count deep-links to. Partner-owned work
 *    is owned by 'partner_organisation' — the originating MLRO is never
 *    assigned a partner's own decision;
 *  - capability filtering: a restricted queue or register is OMITTED for a
 *    caller without the capability — never rendered as a zero or a
 *    placeholder;
 *  - SLA ageing: warn/escalate states from recorded operational targets
 *    (never presented as statutory deadlines);
 *  - readiness vocabulary: the CLOSED set of states a readiness item may
 *    report. Source presence is not deployment truth, so the vocabulary
 *    contains "unknown — not verified" and "operator action required" and
 *    structurally cannot say live/deployed/operational/production-ready.
 *
 * Pure module: no Deno APIs, no database access — behaviourally testable
 * from vitest.
 */

/* ── capabilities ──────────────────────────────────────────────────────── */

export interface OperationsCapabilities {
  /** Any AML role (aml.view). */
  view: boolean;
  /** analyst/reviewer/mlro. */
  investigate: boolean;
  /** MLRO only. */
  mlro: boolean;
}

export type QueueCapability = keyof OperationsCapabilities;

/* ── the queue catalogue (§8.1) ────────────────────────────────────────── */

export interface QueueDef {
  label: string;
  /** Who is responsible for clearing the queue. */
  ownerRole: "mlro" | "reviewer" | "analyst" | "partner_organisation";
  /** Minimum capability to SEE the queue — below it, the queue is omitted. */
  capability: QueueCapability;
  /** The register a count deep-links into, with the SAME filter. */
  register: string;
  registerStatus: string | null;
}

export const PARTNER_QUEUE_DEFS: Record<string, QueueDef> = {
  partner_records_requests_pending: {
    label: "Partner records requests awaiting review",
    ownerRole: "mlro", capability: "view",
    register: "records_requests", registerStatus: "pending_review",
  },
  evidence_delivery_approval: {
    label: "Approved requests awaiting delivery recording",
    ownerRole: "mlro", capability: "view",
    register: "records_requests", registerStatus: "awaiting_delivery",
  },
  partner_determination_pending: {
    label: "Partner determinations outstanding",
    ownerRole: "partner_organisation", capability: "view",
    register: "refresh_obligations", registerStatus: "open",
  },
  partner_refresh_required: {
    label: "Open partner refresh obligations",
    ownerRole: "partner_organisation", capability: "view",
    register: "refresh_obligations", registerStatus: "open",
  },
  arrangement_assessment_due: {
    label: "Arrangement reviews due within 30 days",
    ownerRole: "mlro", capability: "view",
    register: "arrangements", registerStatus: "review_due",
  },
  arrangement_assessment_overdue: {
    label: "Arrangement reviews overdue",
    ownerRole: "mlro", capability: "view",
    register: "arrangements", registerStatus: "overdue",
  },
  partner_classification_pending: {
    label: "Partner organisations awaiting classification",
    ownerRole: "mlro", capability: "view",
    register: "partner_organisations", registerStatus: "unclassified",
  },
  retention_approval: {
    label: "Retention scans awaiting MLRO approval",
    ownerRole: "mlro", capability: "mlro",
    register: "disposal_actions", registerStatus: "awaiting_approval",
  },
  disposal_failure: {
    label: "Failed disposal actions",
    ownerRole: "mlro", capability: "mlro",
    register: "disposal_actions", registerStatus: "failed",
  },
  outbox_retry: {
    label: "Partner events retrying",
    ownerRole: "analyst", capability: "investigate",
    register: "integration_events", registerStatus: "retrying",
  },
  outbox_failed: {
    label: "Partner events dead-lettered",
    ownerRole: "analyst", capability: "investigate",
    register: "integration_events", registerStatus: "dead_letter",
  },
  sanctions_freshness: {
    label: "Sanctions list sources stale",
    ownerRole: "mlro", capability: "view",
    register: "sanctions_sources", registerStatus: "stale",
  },
};

/* ── SLA ageing (§8.3) ─────────────────────────────────────────────────── */

export interface SlaTarget { warnHours: number; escalateHours: number }

/** Fallbacks when aml.partner_sla_targets has no row — same shape, same
 * meaning: OPERATIONAL targets, never statutory deadlines. */
export const DEFAULT_SLA_TARGETS: Record<string, SlaTarget> = {
  partner_records_requests_pending: { warnHours: 48, escalateHours: 120 },
  evidence_delivery_approval: { warnHours: 72, escalateHours: 168 },
  partner_determination_pending: { warnHours: 120, escalateHours: 336 },
  partner_refresh_required: { warnHours: 72, escalateHours: 168 },
  arrangement_assessment_due: { warnHours: 336, escalateHours: 720 },
  arrangement_assessment_overdue: { warnHours: 24, escalateHours: 72 },
  partner_classification_pending: { warnHours: 120, escalateHours: 336 },
  retention_approval: { warnHours: 72, escalateHours: 168 },
  disposal_failure: { warnHours: 24, escalateHours: 72 },
  outbox_retry: { warnHours: 12, escalateHours: 48 },
  outbox_failed: { warnHours: 12, escalateHours: 24 },
  sanctions_freshness: { warnHours: 24, escalateHours: 72 },
};

export const SLA_TARGET_NOTE =
  "Operational targets for escalation and ownership. They are not statutory deadlines and are never presented as legal requirements.";

export type AgeState = "ok" | "warn" | "escalate";

export function ageState(oldestIso: string | null, now: Date, target: SlaTarget): AgeState {
  if (!oldestIso) return "ok";
  const hours = (now.getTime() - new Date(oldestIso).getTime()) / 3_600_000;
  if (hours >= target.escalateHours) return "escalate";
  if (hours >= target.warnHours) return "warn";
  return "ok";
}

/* ── queue summary construction (§8.1, §8.7) ───────────────────────────── */

export interface QueueCount { count: number; oldestAt: string | null }

export interface QueueSummaryEntry {
  key: string;
  label: string;
  ownerRole: QueueDef["ownerRole"];
  count: number;
  oldestAt: string | null;
  age: AgeState;
  register: string;
  registerStatus: string | null;
}

/**
 * Build the caller-visible queue list. A queue whose capability the caller
 * lacks is OMITTED entirely — no zero, no placeholder, no hidden count.
 */
export function buildQueueSummary(
  counts: Record<string, QueueCount>,
  capabilities: OperationsCapabilities,
  targets: Record<string, SlaTarget>,
  now: Date,
): QueueSummaryEntry[] {
  const out: QueueSummaryEntry[] = [];
  for (const [key, def] of Object.entries(PARTNER_QUEUE_DEFS)) {
    if (!capabilities[def.capability]) continue;
    const c = counts[key] ?? { count: 0, oldestAt: null };
    const target = targets[key] ?? DEFAULT_SLA_TARGETS[key] ?? { warnHours: 72, escalateHours: 168 };
    out.push({
      key, label: def.label, ownerRole: def.ownerRole,
      count: c.count, oldestAt: c.oldestAt,
      age: ageState(c.oldestAt, now, target),
      register: def.register, registerStatus: def.registerStatus,
    });
  }
  return out;
}

/* ── registers (§8.2) ──────────────────────────────────────────────────── */

export const REGISTER_DEFS: Record<string, { label: string; capability: QueueCapability }> = {
  partner_organisations: { label: "Partner organisations", capability: "view" },
  partner_case_links: { label: "Partner-case links", capability: "view" },
  arrangements: { label: "Arrangements and assessments", capability: "view" },
  attestations: { label: "Attestations and manifests", capability: "view" },
  records_requests: { label: "Records requests", capability: "view" },
  evidence_deliveries: { label: "Evidence deliveries", capability: "view" },
  determinations: { label: "Partner determinations", capability: "view" },
  refresh_obligations: { label: "Refresh obligations", capability: "view" },
  integration_events: { label: "Integration events and delivery attempts", capability: "investigate" },
  retention_candidates: { label: "Retention candidates", capability: "investigate" },
  legal_holds: { label: "Legal holds", capability: "mlro" },
  disposal_actions: { label: "Disposal actions", capability: "mlro" },
  sanctions_sources: { label: "Sanctions list sources", capability: "view" },
};

export function registerAllowed(register: string, capabilities: OperationsCapabilities): boolean {
  const def = REGISTER_DEFS[register];
  if (!def) return false;
  return capabilities[def.capability];
}

/* ── readiness vocabulary (§8.5, §8.6) ─────────────────────────────────── */

/**
 * The CLOSED set of states a readiness item may report, with their display
 * labels. Deliberately absent: any word that converts source presence into
 * environment truth. When evidence cannot be obtained, the state is
 * 'unknown' and the label says so.
 */
export const READINESS_STATES: Record<string, string> = {
  verified: "Verified against the database",
  applied: "Migration structures present",
  enabled: "Flag enabled (recorded configuration)",
  disabled: "Flag disabled (recorded configuration)",
  responding: "Answered this request",
  healthy: "Within threshold",
  attention: "Outside threshold",
  unknown: "Unknown — not verified",
  missing: "Expected structure absent",
  action_required: "Operator action required",
};

export interface ReadinessItem {
  key: string;
  label: string;
  state: keyof typeof READINESS_STATES;
  evidence: string;
}

/** Guard: an item may only carry a catalogued state; anything else becomes
 * 'unknown' rather than an invented claim. */
export function normaliseReadinessItem(item: ReadinessItem): ReadinessItem {
  if (!READINESS_STATES[item.state]) {
    return { ...item, state: "unknown", evidence: `uncatalogued state "${String(item.state)}" — ${item.evidence}` };
  }
  return item;
}
