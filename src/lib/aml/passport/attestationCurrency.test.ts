import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  grantsNeedingForwardManifest, resolveAttestationForRead,
} from "../../../../supabase/functions/_shared/aml/passport/attestationCurrency.pure";

/**
 * One living record, versioned history.
 *
 * ── The question, and why it was a real defect ────────────────────────
 * "The most recent and updated version should always be there, with the
 * history filed on the Command Centre." That is what the product claimed and
 * the opposite of what it did: a grant pinned `attestation_id`, every read
 * resolved through that pin, and so the moment the MLRO issued v2 every
 * existing partner's read answered 409 `attestation_superseded` — "ask the
 * issuing organisation for current access".
 *
 * Nothing failed. Issuing a new version silently revoked every partner who
 * already held the Passport, and the only repair was to re-send it to each of
 * them by hand.
 */

const att = (over: Record<string, unknown> = {}) => ({
  id: "att-2", version: 2, superseded_at: null, refresh_required_at: null,
  schema_version: 2, ...over,
});
const pinned = att({ id: "att-1", version: 1, superseded_at: "2026-08-28T00:00:00Z" });

describe("a grant authorises a PARTNER to read a CASE, not a frozen version", () => {
  it("a holder pinned to v1 reads the current v2", () => {
    const r = resolveAttestationForRead({ current: att(), pinned });
    expect(r.serve?.id).toBe("att-2");
    expect(r.code).toBe("current");
    expect(r.movedForward).toBe(true);
  });

  it("the version they were issued against is KEPT — it is the audit fact", () => {
    const r = resolveAttestationForRead({ current: att(), pinned });
    expect(r.issuedAgainstVersion).toBe(1);
  });

  it("moving forward is SAID, never hidden", () => {
    /* What a partner may rely on is the record in front of them, not the one
       they remember, so being moved from v1 to v2 has to be visible. */
    const r = resolveAttestationForRead({ current: att(), pinned });
    expect(r.message).toMatch(/updated since your access was issued/i);
    expect(r.message).toMatch(/version 2/);
    expect(r.message).toMatch(/version 1/);
  });

  it("a holder already on the current version is told nothing at all", () => {
    const current = att();
    const r = resolveAttestationForRead({ current, pinned: current });
    expect(r.code).toBe("current_as_issued");
    expect(r.movedForward).toBe(false);
    expect(r.message).toBe("");
  });
});

describe("current means CURRENT — never merely newer", () => {
  it("a version flagged for refresh serves NOTHING", () => {
    /* Known-wrong beats known-old: a material change was recorded and no new
       version exists, so there is nothing correct to serve. This is the one
       hold that survives, and it is not supersession. */
    const r = resolveAttestationForRead({
      current: att({ refresh_required_at: "2026-08-28T00:00:00Z" }), pinned,
    });
    expect(r.serve).toBeNull();
    expect(r.code).toBe("refresh_required");
  });

  it("a refusal promises the partner they need no new link", () => {
    const r = resolveAttestationForRead({
      current: att({ refresh_required_at: "2026-08-28T00:00:00Z" }), pinned,
    });
    expect(r.message).toMatch(/without a new link/i);
    // And it never sends them back to us for "current access".
    expect(r.message).not.toMatch(/ask the issuing organisation/i);
  });

  it("no current version NEVER falls back to the superseded pin", () => {
    /* An attestation the issuer superseded with nothing live behind it is a
       record they stopped standing behind. Serving it would be disclosing
       something withdrawn. */
    const r = resolveAttestationForRead({ current: null, pinned });
    expect(r.serve).toBeNull();
    expect(r.code).toBe("none");
    expect(r.issuedAgainstVersion).toBe(1);
  });
});

describe("issuing a version owes something to the partners who already hold access", () => {
  const grant = (over: Record<string, unknown> = {}) => ({
    id: "gr-1", revoked_at: null,
    expires_at: new Date(Date.now() + 864e5).toISOString(), ...over,
  });

  it("every live v2 grant needs its authorisation carried forward", () => {
    const carry = grantsNeedingForwardManifest(
      [grant(), grant({ id: "gr-2" })], { schemaVersion: 2 });
    expect(carry.map((g) => g.id)).toEqual(["gr-1", "gr-2"]);
  });

  it("a revoked or lapsed grant is carried nowhere", () => {
    const carry = grantsNeedingForwardManifest([
      grant({ id: "revoked", revoked_at: new Date().toISOString() }),
      grant({ id: "lapsed", expires_at: new Date(Date.now() - 1000).toISOString() }),
    ], { schemaVersion: 2 });
    expect(carry).toEqual([]);
  });

  it("v1 has no manifest, so nothing is owed", () => {
    expect(grantsNeedingForwardManifest([grant()], { schemaVersion: 1 })).toEqual([]);
    expect(grantsNeedingForwardManifest([grant()], { schemaVersion: null })).toEqual([]);
  });
});

describe("wired at the source", () => {
  const fn = readFileSync("supabase/functions/aml-reliance/index.ts", "utf8");

  it("BOTH read paths use the one resolver — the link and the portal cannot disagree", () => {
    expect(fn).toContain("async function attestationForGrantRead(");
    // The emailed link.
    expect(fn).toContain("const currency = await attestationForGrantRead(admin, grant);");
    // And the partner's own portal.
    expect(fn).toContain("const portalCurrency = grant");
    expect((fn.match(/attestationForGrantRead\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("the grant's pin is never rewritten — it is history", () => {
    const issue = fn.slice(fn.indexOf('case "issue_attestation"'), fn.indexOf('case "list_attestations"'));
    // Carrying forward writes MANIFESTS, never a new attestation_id on a grant.
    expect(issue).not.toMatch(/from\("reliance_grants"\)[\s\S]{0,200}\.update\(\{[\s\S]{0,120}attestation_id/);
    expect(issue).toContain('from("disclosure_manifests").insert(');
  });

  it("carrying forward WIDENS nothing — the scope is copied from what it succeeds", () => {
    const issue = fn.slice(fn.indexOf('case "issue_attestation"'), fn.indexOf('case "list_attestations"'));
    expect(issue).toContain("allowed_attribute_codes: previous.allowed_attribute_codes ?? []");
    expect(issue).toContain("allowed_record_classes: previous.allowed_record_classes ?? []");
    expect(issue).toContain("denied_classes: previous.denied_classes ?? []");
    expect(issue).toContain("expires_at: previous.expires_at");
    // A grant whose predecessor had no manifest gets none: absence of
    // evidence is not authority, and it fails closed on read.
    expect(issue).toContain("if (!previous) continue;");
  });

  it("a failed carry-forward never fails the ISSUE — the version is the compliance act", () => {
    const issue = fn.slice(fn.indexOf('case "issue_attestation"'), fn.indexOf('case "list_attestations"'));
    expect(issue).toContain("manifest carry-forward skipped");
    expect(issue).toContain("grants_carried_forward: carriedForward");
  });

  it("the manifest lookup is scoped by version, or the second one breaks it", () => {
    // A grant now accumulates one manifest per attestation it is carried
    // onto; an unscoped `.maybeSingle()` would fail outright on the second.
    expect(fn).toContain('.eq("grant_id", grant.id).eq("attestation_id", attestation.id)');
  });

  it("a superseded document is still never served — the belt stays on", () => {
    expect(fn).toContain("attestation.superseded_at || attestation.refresh_required_at");
    expect(fn).toContain('logDenied("attestation_not_current")');
  });
});
