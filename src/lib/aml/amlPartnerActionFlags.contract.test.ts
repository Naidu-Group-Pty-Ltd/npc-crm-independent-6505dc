import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-contract tests for the Phase 9 action-level rollout flags (E2).
 * The controlled documents require a read-only rollout before any partner
 * write capability; each capability therefore has its own default-false
 * flag, enforced SERVER-SIDE. Hidden buttons are not enforcement.
 */

const repo = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

const fn = read("supabase/functions/aml-reliance/index.ts");
const migration = read("supabase/migrations/20260828000100_aml_partner_action_flags.sql");

const between = (start: string, end: string) => fn.slice(fn.indexOf(start), fn.indexOf(end));

describe("every write capability is denied server-side while its flag is false", () => {
  it("grant issuance requires aml_partner_grants_write", () => {
    const op = between('case "grant_access"', 'case "revoke_grant"');
    expect(op).toContain('flagEnabled(admin, "aml_partner_grants_write")');
    expect(op).toContain('"grants_write_disabled"');
  });

  it("revocation is deliberately NOT gated — a safety action always works", () => {
    const op = between('case "revoke_grant"', 'case "list_grants"');
    expect(op).not.toContain("flagEnabled");
  });

  it("records-request submission requires aml_partner_records_requests_write", () => {
    const op = between('op === "request_cdd_records"', 'op === "list_partner_records_requests"');
    expect(op).toContain('flagEnabled(admin, "aml_partner_records_requests_write")');
    expect(op).toContain('"records_requests_write_disabled"');
  });

  it("evidence delivery — staff recording AND partner access — requires aml_partner_evidence_delivery_write", () => {
    const staffOp = between('case "record_partner_evidence_delivery"', "/* ── reliable events");
    expect(staffOp).toContain('flagEnabled(admin, "aml_partner_evidence_delivery_write")');
    expect(staffOp).toContain('"evidence_delivery_write_disabled"');
    const accessOp = between('op === "get_partner_evidence_delivery_access"', 'op === "list_partner_refresh_obligations"');
    expect(accessOp).toContain('flagEnabled(admin, "aml_partner_evidence_delivery_write")');
  });

  it("workspace determinations require aml_partner_determinations_write", () => {
    const op = between('op === "record_partner_determination"', 'op === "list_partner_evidence_deliveries"');
    expect(op).toContain('flagEnabled(admin, "aml_partner_determinations_write")');
    expect(op).toContain('"determinations_write_disabled"');
  });

  it("read paths stay ungated — the read-only rollout keeps working with writes off", () => {
    for (const readOp of [
      'op === "get_partner_compliance_workspace"',
      'op === "list_partner_records_requests"',
      'op === "list_partner_evidence_deliveries"',
      'op === "get_partner_audit_receipt"',
    ]) {
      const start = fn.indexOf(readOp);
      const slice = fn.slice(start, start + 400);
      expect(slice).not.toMatch(/aml_partner_\w+_write/);
    }
  });
});

describe("service/settlement blocking stays structurally disabled", () => {
  it("the flag exists, defaults false, and NO code path enforces blocking on partner state", () => {
    expect(migration).toContain("('aml_partner_service_blocking', 'false'::jsonb");
    // The only mentions anywhere in the function are readiness reporting —
    // never an enforcement branch.
    const enforcementUses = [...fn.matchAll(/aml_partner_service_blocking/g)];
    for (const m of enforcementUses) {
      const around = fn.slice(Math.max(0, m.index! - 300), m.index! + 300);
      expect(around).not.toMatch(/service_gate|block|deny|409|403/i);
    }
  });
});

describe("the flag migration", () => {
  it("seeds all five action flags false with exact rollback", () => {
    for (const key of [
      "aml_partner_grants_write", "aml_partner_records_requests_write",
      "aml_partner_evidence_delivery_write", "aml_partner_determinations_write",
      "aml_partner_service_blocking",
    ]) {
      expect(migration).toMatch(new RegExp(`\\('${key}', 'false'::jsonb`));
    }
    expect(migration).toContain("ROLLBACK:");
    expect(migration).toContain("ON CONFLICT (key) DO NOTHING");
  });
});
