import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLA_TARGETS,
  PARTNER_QUEUE_DEFS,
  READINESS_STATES,
  REGISTER_DEFS,
  SLA_TARGET_NOTE,
  ageState,
  buildQueueSummary,
  normaliseReadinessItem,
  registerAllowed,
  type OperationsCapabilities,
} from "../../../supabase/functions/_shared/aml/partnerOperations";

/**
 * Behavioural tests for the Phase 8 operations domain: queue catalogue,
 * capability omission, SLA ageing and the readiness vocabulary.
 * All fixtures synthetic.
 */

const NOW = new Date("2026-08-05T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const ALL: OperationsCapabilities = { view: true, investigate: true, mlro: true };
const VIEW_ONLY: OperationsCapabilities = { view: true, investigate: false, mlro: false };

describe("queue catalogue (§8.1, §8.7)", () => {
  it("covers the specified queues for which data exists", () => {
    for (const key of [
      "partner_records_requests_pending", "evidence_delivery_approval",
      "partner_determination_pending", "partner_refresh_required",
      "arrangement_assessment_due", "arrangement_assessment_overdue",
      "partner_classification_pending", "retention_approval", "disposal_failure",
      "outbox_retry", "outbox_failed", "sanctions_freshness",
    ]) {
      expect(PARTNER_QUEUE_DEFS[key], key).toBeTruthy();
    }
  });

  it("every queue deep-links to a register that exists in the register catalogue", () => {
    for (const [key, def] of Object.entries(PARTNER_QUEUE_DEFS)) {
      expect(REGISTER_DEFS[def.register], `${key} → ${def.register}`).toBeTruthy();
    }
  });

  it("partner-owned decisions are never assigned to the originating MLRO", () => {
    expect(PARTNER_QUEUE_DEFS.partner_determination_pending.ownerRole).toBe("partner_organisation");
    expect(PARTNER_QUEUE_DEFS.partner_refresh_required.ownerRole).toBe("partner_organisation");
  });

  it("restricted queues are omitted — not zeroed — for callers without the capability", () => {
    const counts = Object.fromEntries(Object.keys(PARTNER_QUEUE_DEFS)
      .map((k) => [k, { count: 1, oldestAt: hoursAgo(1) }]));
    const full = buildQueueSummary(counts, ALL, DEFAULT_SLA_TARGETS, NOW);
    const limited = buildQueueSummary(counts, VIEW_ONLY, DEFAULT_SLA_TARGETS, NOW);
    const limitedKeys = new Set(limited.map((q) => q.key));
    expect(full.length).toBe(Object.keys(PARTNER_QUEUE_DEFS).length);
    for (const restricted of ["retention_approval", "disposal_failure", "outbox_retry", "outbox_failed"]) {
      expect(limitedKeys.has(restricted), restricted).toBe(false);
    }
    // Nothing appears as a hidden zero either — the entries simply aren't there.
    expect(limited.length).toBe(full.length - 4);
  });
});

describe("SLA ageing (§8.3)", () => {
  it("every queue has a default operational target", () => {
    for (const key of Object.keys(PARTNER_QUEUE_DEFS)) {
      expect(DEFAULT_SLA_TARGETS[key], key).toBeTruthy();
      expect(DEFAULT_SLA_TARGETS[key].escalateHours).toBeGreaterThanOrEqual(DEFAULT_SLA_TARGETS[key].warnHours);
    }
  });

  it("targets are described as operational, never as statutory deadlines", () => {
    expect(SLA_TARGET_NOTE).toContain("Operational targets");
    expect(SLA_TARGET_NOTE).toContain("not statutory deadlines");
  });

  it("age states derive from the recorded target", () => {
    const target = { warnHours: 24, escalateHours: 72 };
    expect(ageState(null, NOW, target)).toBe("ok");
    expect(ageState(hoursAgo(2), NOW, target)).toBe("ok");
    expect(ageState(hoursAgo(30), NOW, target)).toBe("warn");
    expect(ageState(hoursAgo(100), NOW, target)).toBe("escalate");
  });

  it("unassigned/empty queues age as ok and overdue queues escalate in the summary", () => {
    const counts = {
      partner_records_requests_pending: { count: 0, oldestAt: null },
      arrangement_assessment_overdue: { count: 2, oldestAt: hoursAgo(500) },
    };
    const summary = buildQueueSummary(counts, ALL, DEFAULT_SLA_TARGETS, NOW);
    const byKey = new Map(summary.map((q) => [q.key, q]));
    expect(byKey.get("partner_records_requests_pending")!.age).toBe("ok");
    expect(byKey.get("arrangement_assessment_overdue")!.age).toBe("escalate");
  });
});

describe("registers (§8.2)", () => {
  it("legal holds and disposal actions require the MLRO capability", () => {
    expect(REGISTER_DEFS.legal_holds.capability).toBe("mlro");
    expect(REGISTER_DEFS.disposal_actions.capability).toBe("mlro");
    expect(registerAllowed("legal_holds", VIEW_ONLY)).toBe(false);
    expect(registerAllowed("legal_holds", ALL)).toBe(true);
  });

  it("unknown registers are never allowed", () => {
    expect(registerAllowed("cases_raw_table", ALL)).toBe(false);
  });
});

describe("readiness vocabulary (§8.5, §8.6)", () => {
  it("contains the honest states — unknown, missing and operator action required", () => {
    for (const s of ["unknown", "missing", "action_required", "disabled"]) {
      expect(READINESS_STATES[s], s).toBeTruthy();
    }
  });

  it("no state or label can convert source presence into environment truth", () => {
    const FORBIDDEN = /\b(live|deployed|operational|production[- ]ready)\b/i;
    for (const [state, label] of Object.entries(READINESS_STATES)) {
      expect(state).not.toMatch(FORBIDDEN);
      expect(label).not.toMatch(FORBIDDEN);
    }
    expect(READINESS_STATES.unknown).toBe("Unknown — not verified");
  });

  it("an uncatalogued state collapses to unknown instead of becoming a claim", () => {
    const item = normaliseReadinessItem({
      key: "x", label: "X", state: "totally_live" as never, evidence: "probe",
    });
    expect(item.state).toBe("unknown");
    expect(item.evidence).toContain("uncatalogued state");
  });

  it("a catalogued state passes through unchanged", () => {
    const item = normaliseReadinessItem({ key: "x", label: "X", state: "applied", evidence: "probe ok" });
    expect(item).toEqual({ key: "x", label: "X", state: "applied", evidence: "probe ok" });
  });
});
