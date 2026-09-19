import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-contract tests for attestation v2 and disclosure manifests
 * (Phase 3): additive schema, flag-gated v2 writing, gate-anchored
 * issuance, manifest-controlled reading, preserved v1 behaviour, and the
 * security-registry/config entries for aml-reliance. Synthetic data only.
 */

const repo = join(__dirname, "../../..");
const migration = readFileSync(
  join(repo, "supabase/migrations/20260805120000_aml_attestation_v2_manifests_phase3.sql"), "utf8");
const reliance = readFileSync(
  join(repo, "supabase/functions/aml-reliance/index.ts"), "utf8");
const registry = JSON.parse(readFileSync(
  join(repo, "supabase/functions-registry/SECURITY_REGISTRY.json"), "utf8"));
const configToml = readFileSync(join(repo, "supabase/config.toml"), "utf8");

const stripComments = (src: string) =>
  src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join("\n");

const opBlock = (op: string) => {
  const start = reliance.indexOf(`case "${op}"`);
  expect(start).toBeGreaterThan(-1);
  const next = reliance.indexOf('case "', start + 6);
  return reliance.slice(start, next === -1 ? undefined : next);
};

describe("attestation v2 schema (Phase 3 migration)", () => {
  it("extends attestations additively — v1 rows stay valid at schema_version 1", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS material_input_hash");
    expect(migration).toContain("REFERENCES aml.service_gate_decisions(id)");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS superseded_by_id");
    const code = stripComments(migration);
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN|RENAME/);
    expect(code).not.toMatch(/UPDATE aml\.compliance_attestations/);
  });

  it("creates one manifest per grant, service-role-only, with explicit denied classes", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS aml.disclosure_manifests");
    expect(migration).toContain("grant_id uuid NOT NULL UNIQUE REFERENCES aml.reliance_grants(id)");
    expect(migration).toContain("allowed_attribute_codes text[] NOT NULL");
    expect(migration).toContain("denied_classes text[] NOT NULL");
    expect(migration).toContain("manifest_sha256 text NOT NULL");
    expect(migration).toContain("expires_at timestamptz NOT NULL");
    expect(migration).toContain("ALTER TABLE aml.disclosure_manifests ENABLE ROW LEVEL SECURITY");
    expect(stripComments(migration)).not.toMatch(/TO authenticated|TO anon/);
    expect(migration).toMatch(/'aml_attestation_v2', 'false'::jsonb/);
    expect(migration).toContain("-- ROLLBACK:");
  });
});

describe("attestation v2 issuance (aml-reliance)", () => {
  const block = opBlock("issue_attestation");

  it("v2 writing is behind the aml_attestation_v2 flag", () => {
    expect(block).toContain("attestationV2Enabled");
    // The v1 hash path survives verbatim for flag-off parity.
    expect(block).toContain("sha256Hex(JSON.stringify(payloadToStore))");
  });

  it("v2 requires the explicit authorised gate decision, not a status string alone", () => {
    expect(block).toContain("service_gate_not_approved");
    expect(block).toContain("service_gate_decision_missing");
    expect(block).toMatch(/from\("service_gate_decisions"\)[\s\S]{0,200}approved_with_controls/);
    expect(block).toContain("service_gate_decision_id: gateDecision.id");
  });

  it("v2 hashes canonically, records the material-input hash and reason codes, and back-links supersession", () => {
    expect(block).toContain("materialInputHash");
    expect(block).toContain("sha256HexCanonical(payloadToStore)");
    expect(block).toContain("issued_reason_code");
    expect(block).toContain("superseded_reason_code");
    expect(block).toContain("superseded_by_id: att.id");
    // Deterministic default: same material hash → not a material change.
    expect(block).toMatch(/last\.material_input_hash !== materialHash/);
  });

  it("refuses to store a payload that trips the restricted-key tripwire", () => {
    expect(block).toContain("findRestrictedKeys(payloadToStore)");
    expect(block).toContain("restricted_keys_in_payload");
  });
});

describe("manifest-controlled reading (aml-reliance)", () => {
  it("grant_access creates the per-grant manifest for v2 attestations", () => {
    const block = opBlock("grant_access");
    expect(block).toContain('from("disclosure_manifests")');
    expect(block).toContain("DEFAULT_ALLOWED_ATTRIBUTE_CODES");
    expect(block).toContain("DEFAULT_DENIED_CLASSES");
    expect(block).toContain("expires_at: grant.expires_at");
    expect(block).toMatch(/att\.schema_version \?\? 1\) === 2/);
  });

  it("redeem is schema-aware: v2 is manifest-intersected server-side; v1 is untouched", () => {
    const partnerPath = reliance.slice(
      reliance.indexOf('if (op === "redeem_attestation"'),
      reliance.indexOf("record_independent_assessment —"));
    expect(partnerPath).toContain("intersectPayloadWithManifest");
    expect(partnerPath).toContain("evaluateManifestForRead");
    /* Superseded v2 content is never served — the property is unchanged; how
       it is reached is not. Supersession is now settled BEFORE this branch by
       `resolveAttestationForRead`, which serves the case's current version
       rather than the one the grant was pinned to, so issuing v2 no longer
       revokes every partner who already holds the Passport. What reaches here
       is current-or-nothing, and the assertion below is the belt that stays
       on: a non-current document must never be served from this path. */
    expect(partnerPath).toContain("attestationForGrantRead(admin, grant)");
    expect(partnerPath).toContain("attestation.superseded_at || attestation.refresh_required_at");
    expect(partnerPath).toContain("refresh_required");
    // Denied reads are access-logged with a reason code.
    expect(partnerPath).toMatch(/logDenied\("attestation_not_current"\)/);
    expect(partnerPath).toMatch(/logDenied\(manifestDecision\.code\)/);
    expect(partnerPath).toContain('logDenied("integrity_check_failed")');
    // The v1 branch still returns the raw sanitised payload as before.
    expect(partnerPath).toContain("attestation: attestation.payload");
  });

  it("the partner determination path is unchanged by v2 and still cannot move the case", () => {
    const partnerPath = reliance.slice(
      reliance.indexOf('if (op === "redeem_attestation"'),
      reliance.indexOf("/* ── staff ops"));
    expect(partnerPath).not.toMatch(/from\("cases"\)[\s\S]{0,80}\.update/);
    expect(partnerPath).toContain("Does not alter this case's status or service gate.");
  });
});

describe("security registry (Phase 3 §6)", () => {
  it("aml-reliance is registered with verify_jwt false and a valid exposure class", () => {
    const entry = registry.functions["aml-reliance"];
    expect(entry).toBeDefined();
    expect(entry.verify_jwt).toBe(false);
    expect(entry.exposure_class).toBe("public-auth");
    expect(entry.reviewed).toBe(true);
    expect(typeof entry.owner).toBe("string");
    expect(entry.owner.length).toBeGreaterThan(0);
  });

  it("config.toml matches the registry so there is no verify_jwt drift", () => {
    expect(configToml).toMatch(/\[functions\.aml-reliance\]\s*\nverify_jwt = false/);
  });
});
