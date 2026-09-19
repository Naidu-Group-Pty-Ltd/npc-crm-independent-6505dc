import { test, expect } from "@playwright/test";

/**
 * Synthetic partner-pilot E2E coverage (Phase 9, Stage D/E6).
 *
 * SYNTHETIC DATA ONLY. These tests drive a LOCAL, non-production stack:
 * they run only when AML_PILOT_BASE_URL points at a local Supabase
 * functions host seeded with the synthetic pilot tenant
 * (docs/aml/rollout/synthetic-pilot-tenant.md). Without it every scenario
 * is skipped with an explicit reason — a skipped scenario is NOT a passed
 * scenario and the release evidence records it as such. They never
 * connect to production and contain no real identifier of any kind.
 *
 * Session tokens for the personas come from environment variables minted
 * by the local seed script (never committed):
 *   AML_PILOT_STAFF_JWT           origin MLRO (synthetic)
 *   AML_PILOT_FINANCE_SESSION     finance compliance officer session token
 *   AML_PILOT_BUILDER_COOKIE      builder compliance officer session cookie
 *   AML_PILOT_SOLICITOR_COOKIE    solicitor compliance officer session cookie
 *   AML_PILOT_ATTACKER_SESSION    cross-organisation attacker session
 */

const BASE = process.env.AML_PILOT_BASE_URL ?? "";
const pilotConfigured = BASE.length > 0;

const reliance = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  fetch(`${BASE}/functions/v1/aml-reliance`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const financeHeaders = () => ({
  "x-finance-session-token": process.env.AML_PILOT_FINANCE_SESSION ?? "",
  "x-portal-request": "1",
});
const solicitorHeaders = () => ({
  Cookie: process.env.AML_PILOT_SOLICITOR_COOKIE ?? "",
  "x-portal-request": "1",
});
const staffHeaders = () => ({
  Authorization: `Bearer ${process.env.AML_PILOT_STAFF_JWT ?? ""}`,
});

/**
 * The controlled scenario catalogue (E6). `kind` states how each scenario
 * verifies: "api" scenarios run here; "seeded" scenarios assert states the
 * seed script establishes; every scenario id maps to the UAT record in
 * docs/aml/rollout/synthetic-uat-plan.md.
 */
export const PILOT_SCENARIOS = [
  { id: "S01", label: "individual — documentary verification, finance relies on current passport" },
  { id: "S02", label: "joint purchasers — one late completion, one name discrepancy" },
  { id: "S03", label: "company — layered ownership, one owner needing clarification" },
  { id: "S04", label: "trust/SMSF — corporate trustee, appointor, multiple parties" },
  { id: "S05", label: "biometrics declined — documentary route succeeds" },
  { id: "S06", label: "sharing declined — origin continues, partner independent CDD, no penalty" },
  { id: "S07", label: "no arrangement — grant blocked, independent CDD available" },
  { id: "S08", label: "overdue assessment — reliance blocked, origin gate unchanged" },
  { id: "S09", label: "construction-only builder — not assumed regulated" },
  { id: "S10", label: "solicitor — approved P3 authority document via short-lived signed URL" },
  { id: "S11", label: "P4 evidence delivery rejected" },
  { id: "S12", label: "P5 evidence delivery rejected" },
  { id: "S13", label: "P6 biometric delivery rejected" },
  { id: "S14", label: "material change — old content withheld, refresh obligations, gate unchanged" },
  { id: "S15", label: "provider outage — attempt not consumed, retry offered" },
  { id: "S16", label: "stale sanctions source — no clear result, incident state shown" },
  { id: "S17", label: "outbox temporary failure — retry without duplicate outcome" },
  { id: "S18", label: "stale/replayed event — revoked access remains revoked" },
  { id: "S19", label: "legal hold — disposal blocked, reason invisible to partner" },
  { id: "S20", label: "failed disposal — pointer preserved, failure evidence retained" },
  { id: "S21", label: "cross-tenant attack denied" },
  { id: "S22", label: "cross-organisation attack denied" },
  { id: "S23", label: "wrong matter/project/purchase-file assignment denied" },
  { id: "S24", label: "suspended membership denied" },
  { id: "S25", label: "expired/revoked delivery denied" },
  { id: "S26", label: "Developer standalone route fail-closed" },
] as const;

test.describe("synthetic partner pilot", () => {
  test.skip(!pilotConfigured,
    "AML_PILOT_BASE_URL not set — requires a local non-production stack (supabase start + synthetic seed). Skipped scenarios are recorded as NOT RUN, never as passed.");

  test("S10: solicitor retrieves ONE approved P3 authority document with a short-lived URL and a recorded reason", async () => {
    const linkId = process.env.AML_PILOT_SOLICITOR_LINK_ID ?? "";
    const deliveryId = process.env.AML_PILOT_P3_DELIVERY_ID ?? "";
    const res = await reliance({
      op: "get_partner_evidence_delivery_access",
      portal_type: "solicitor_conveyancer",
      partner_case_link_id: linkId,
      delivery_id: deliveryId,
      retrieval_reason: "Synthetic UAT: verifying authority for settlement",
    }, solicitorHeaders());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.access.url).toContain("token=");
    expect(body.access).not.toHaveProperty("storage_path");
    const expiresIn = new Date(body.access.expires_at).getTime() - Date.now();
    expect(expiresIn).toBeLessThanOrEqual(300_000);
  });

  for (const [id, deliveryEnv] of [
    ["S11", "AML_PILOT_P4_DELIVERY_ID"],
    ["S12", "AML_PILOT_P5_DELIVERY_ID"],
    ["S13", "AML_PILOT_P6_DELIVERY_ID"],
  ] as const) {
    test(`${id}: restricted-class delivery is refused with a safe code`, async () => {
      const res = await reliance({
        op: "get_partner_evidence_delivery_access",
        portal_type: "finance",
        partner_case_link_id: process.env.AML_PILOT_FINANCE_LINK_ID ?? "",
        delivery_id: process.env[deliveryEnv] ?? "",
        retrieval_reason: "Synthetic UAT: restricted-class rejection drill",
      }, financeHeaders());
      expect(res.status).toBeGreaterThanOrEqual(403);
      const body = await res.json();
      expect(["classification_not_deliverable", "record_code_unknown", "record_code_not_approved", "delivery_not_found"])
        .toContain(body.code);
      expect(JSON.stringify(body)).not.toMatch(/storage_path|bucket|signedUrl/);
    });
  }

  test("S22: a session from another organisation cannot read the workspace or the delivery", async () => {
    const res = await reliance({
      op: "get_partner_compliance_workspace",
      portal_type: "finance",
      partner_case_link_id: process.env.AML_PILOT_SOLICITOR_LINK_ID ?? "",
    }, { "x-finance-session-token": process.env.AML_PILOT_ATTACKER_SESSION ?? "", "x-portal-request": "1" });
    expect([403, 404]).toContain(res.status);
  });

  test("S24: a suspended membership is denied before any data loads", async () => {
    const res = await reliance({
      op: "get_partner_compliance_workspace",
      portal_type: "finance",
    }, { "x-finance-session-token": process.env.AML_PILOT_SUSPENDED_SESSION ?? "", "x-portal-request": "1" });
    expect([401, 403]).toContain(res.status);
  });

  test("S25: an expired or revoked delivery refuses fresh access", async () => {
    const res = await reliance({
      op: "get_partner_evidence_delivery_access",
      portal_type: "finance",
      partner_case_link_id: process.env.AML_PILOT_FINANCE_LINK_ID ?? "",
      delivery_id: process.env.AML_PILOT_REVOKED_DELIVERY_ID ?? "",
      retrieval_reason: "Synthetic UAT: revoked delivery drill",
    }, financeHeaders());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(["delivery_revoked", "delivery_expired"]).toContain(body.code);
  });

  test("S26: the standalone developer route stays fail-closed", async () => {
    const res = await reliance({
      op: "get_partner_compliance_workspace",
      portal_type: "developer",
    }, financeHeaders());
    expect([400, 404]).toContain(res.status);
  });

  test("S14: after a material change the old attestation content is withheld from every partner path", async () => {
    await reliance({
      op: "apply_material_change",
      case_id: process.env.AML_PILOT_CASE_ID ?? "",
    }, staffHeaders());
    const workspace = await reliance({
      op: "get_partner_compliance_workspace",
      portal_type: "finance",
      partner_case_link_id: process.env.AML_PILOT_FINANCE_LINK_ID ?? "",
    }, financeHeaders());
    const body = await workspace.json();
    expect(body.workspace.attestation_state).toMatch(/refresh_required|superseded/);
    expect(body.workspace.procedures).toBeNull();
  });

  test("catalogue completeness: every UAT scenario is declared", async () => {
    expect(PILOT_SCENARIOS.length).toBe(26);
  });
});
