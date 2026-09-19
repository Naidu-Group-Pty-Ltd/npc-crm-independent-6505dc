import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-contract tests for Phase 8: operations, reporting and readiness.
 * Exit-gate properties: every metric deep-links to its filtered record set;
 * restricted queues/registers are capability-bounded; reporting is
 * tenant-scoped; readiness separates database-verifiable fact from unknown;
 * the preflight is read-only and secret-free; the flag defaults false.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

const migration = read("supabase/migrations/20260805160000_aml_partner_operations_phase8.sql");
const fn = read("supabase/functions/aml-reliance/index.ts");
const pure = read("supabase/functions/_shared/aml/partnerOperations.ts");
const page = read("src/pages/aml/AmlPartnerOperations.tsx");
const strip = read("src/components/aml/PartnerOpsQueueStrip.tsx");
const home = read("src/pages/aml/AmlComplianceHomeV3.tsx");
const app = read("src/App.tsx");
const layout = read("src/components/aml/AmlLayout.tsx");
const api = read("src/lib/aml/amlRelianceApi.ts");

const dashboardOp = fn.slice(
  fn.indexOf('case "get_partner_operations_dashboard"'),
  fn.indexOf('case "list_partner_register"'));
const registerOp = fn.slice(
  fn.indexOf('case "list_partner_register"'),
  fn.indexOf('case "get_partner_management_report"'));
const reportOp = fn.slice(
  fn.indexOf('case "get_partner_management_report"'),
  fn.indexOf('case "get_partner_readiness"'));
const readinessOp = fn.slice(
  fn.indexOf('case "get_partner_readiness"'),
  fn.indexOf("default:", fn.indexOf('case "get_partner_readiness"')));

describe("flag gating (§8.8)", () => {
  it("queues, registers and reporting answer 409 while the flag is off", () => {
    for (const block of [dashboardOp, registerOp, reportOp]) {
      expect(block).toContain('flagEnabled(admin, "aml_partner_operations_reporting")');
      expect(block).toContain('"operations_disabled"');
    }
    expect(migration).toContain("('aml_partner_operations_reporting', 'false'::jsonb");
  });

  it("the readiness/preflight op is deliberately ungated and documents why", () => {
    expect(readinessOp).not.toContain("aml_partner_operations_reporting\")");
    expect(readinessOp).toContain("BEFORE enabling anything");
  });

  it("the Compliance Home strip fails closed — an error renders nothing", () => {
    expect(home).toContain("PartnerOpsQueueStrip");
    expect(strip).toContain(".catch(() => { if (!cancelled) setQueues(null); })");
    expect(strip).toContain("if (!queues || queues.length === 0) return null;");
  });
});

describe("queues deep-link to their record sets (§8.1)", () => {
  it("every server queue carries the register + filter it was counted from", () => {
    expect(dashboardOp).toContain("buildQueueSummary(counts, caps, targets, now)");
    // The pure defs bind each queue to a register + status; the register op
    // applies the same named filters.
    for (const filterPair of [
      ['"pending_review"', 'in("status", ["submitted", "under_review"])'],
      ['"awaiting_delivery"', 'in("status", ["approved", "partly_approved"])'],
    ]) {
      expect(pure + registerOp).toContain(filterPair[0]);
      expect(registerOp).toContain(filterPair[1]);
    }
  });

  it("the page drives the register from URL params, so a deep link reproduces the set", () => {
    expect(page).toContain("useSearchParams");
    expect(page).toContain('searchParams.get("register")');
    expect(page).toContain('searchParams.get("status")');
    expect(page).toContain("listPartnerRegister({");
  });

  it("the home strip links into the operations page with the same register filter", () => {
    expect(strip).toContain("/admin/aml/partner-operations?register=");
    expect(strip).toContain("q.registerStatus");
  });

  it("the operations page sits inside the guarded AML tree with nav entries", () => {
    expect(app).toContain('path="partner-operations"');
    expect(app).toMatch(/AmlGuard capability="aml\.view"><AmlPartnerOperations/);
    const navMatches = layout.match(/Partner Operations/g) ?? [];
    expect(navMatches.length).toBe(2); // legacy nav + V3 nav
  });
});

describe("capability boundaries (§8.2)", () => {
  it("the register op refuses registers beyond the caller's capability", () => {
    expect(registerOp).toContain("registerAllowed(register, caps)");
    expect(registerOp).toContain('"capability_required"');
    expect(registerOp).toContain("Unknown register");
  });

  it("capabilities derive from AML roles resolved server-side, never from the request body", () => {
    for (const block of [dashboardOp, registerOp]) {
      expect(block).toContain("mlro: isMlro");
      expect(block).not.toContain("body.capabilities");
      expect(block).not.toContain("body.role");
    }
  });

  it("no direct table administration is exposed — registers are read-only selects", () => {
    expect(registerOp).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});

describe("management reporting (§8.4)", () => {
  it("is tenant-scoped and date-range aware", () => {
    expect(reportOp).toContain('tenant_id: "default"');
    expect(reportOp).toContain("range: { from, to }");
    expect(reportOp).toMatch(/gte\(col, from\)/);
  });

  it("covers partners, arrangements and records measures", () => {
    for (const key of [
      "links_by_legal_route", "grants_active", "grants_revoked", "grants_expired",
      "records_requests_by_status", "determinations_by_outcome", "refresh_required_open",
      "overdue_reviews", "eligibility_states",
      "operative_triggers", "active_legal_holds", "blocked_disposals",
      "disposal_failures", "disposal_evidence_receipts",
    ]) {
      expect(reportOp).toContain(key);
    }
  });

  it("reads counts and controlled codes only — no free-text or restricted columns", () => {
    for (const restricted of ["decision_notes", "findings", "revoke_reason", "internal_trigger_codes", "classification_notes"]) {
      expect(reportOp).not.toContain(restricted);
    }
  });
});

describe("readiness and preflight (§8.5, §8.6)", () => {
  it("is read-only by construction — no write verb appears in the op", () => {
    expect(readinessOp).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
  });

  it("reveals no secrets — no environment reads inside the op", () => {
    expect(readinessOp).not.toContain("Deno.env");
    expect(readinessOp).not.toMatch(/SERVICE_ROLE|SECRET|API_KEY/);
  });

  it("probes structures, reads recorded flag values and reports the rest as unknown", () => {
    expect(readinessOp).toContain('await probe("phase1_partner_identity"');
    expect(readinessOp).toContain('await probe("phase7_record_catalogue"');
    expect(readinessOp).toContain("aml_partner_event_outbox");
    expect(readinessOp).toContain("configuration, not deployment state");
    expect(readinessOp).toContain('state: "unknown"');
    expect(readinessOp).toContain("source presence is not deployment truth");
  });

  it("every item passes through the closed-state normaliser", () => {
    expect(readinessOp).toContain("normaliseReadinessItem({");
    const pushes = readinessOp.match(/items\.push\(/g) ?? [];
    const normalised = readinessOp.match(/normaliseReadinessItem\(\{/g) ?? [];
    expect(pushes.length).toBeGreaterThan(0);
    expect(normalised.length).toBe(pushes.length);
  });

  it("the panel and page never claim live/deployed/operational/production-ready", () => {
    // Status CLAIMS are forbidden; the words "operations"/"operational
    // targets" describing the page's subject are not claims.
    const FORBIDDEN = /\b(is live|is deployed|is operational|production[- ]ready|now live|fully deployed)\b/i;
    expect(page).not.toMatch(FORBIDDEN);
    expect(readinessOp).not.toMatch(FORBIDDEN);
    expect(page).toContain("unknown");
  });
});

describe("SLA configuration (§8.3)", () => {
  it("targets live in a table the MLRO can tune and are labelled operational, not legal", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS aml.partner_sla_targets");
    expect(migration).toContain("escalate_hours >= warn_hours");
    expect(migration).toContain("not a legal deadline");
    expect(migration).toContain("'partner_organisation'");
    expect(dashboardOp).toContain('from("partner_sla_targets")');
  });

  it("partner-owned queues carry the partner organisation as responsible role in the seed", () => {
    expect(migration).toMatch(/'partner_determination_pending',[^)]*'partner_organisation'/s);
    expect(migration).toMatch(/'partner_refresh_required',[^)]*'partner_organisation'/s);
  });
});

describe("accessibility and layout hygiene (§8.9)", () => {
  it("wide content scrolls inside its own container and tables are labelled", () => {
    const overflow = page.match(/overflow-x-auto/g) ?? [];
    expect(overflow.length).toBeGreaterThanOrEqual(3);
    expect(page).toContain('aria-label="Partner compliance queues"');
    expect(page).toContain('aria-label="Partner domain readiness"');
    expect(page).toMatch(/<th scope="col"/);
  });

  it("interactive elements carry accessible names", () => {
    expect(page).toContain('aria-label="Refresh partner operations"');
    expect(page).toContain("aria-label={`Open the filtered register behind");
    expect(strip).toContain("aria-label={`${q.label}: ${q.count}");
  });
});

describe("typed client", () => {
  it("exposes the four Phase 8 operations", () => {
    for (const m of [
      "getPartnerOperationsDashboard", "listPartnerRegister",
      "getPartnerManagementReport", "getPartnerReadiness",
    ]) {
      expect(api).toContain(m);
    }
  });
});
