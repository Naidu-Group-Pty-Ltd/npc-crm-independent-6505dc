import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  partnerSurfaceMode, partnerWorkspacePanels, passportDisclosure,
} from "./partnerSurface";

/**
 * The Compliance Passport inside a partner's own portal.
 *
 * The reported need: a partner who already holds a portal account wants to
 * review the Passport there rather than keep an email. The risk in granting
 * it is that the surface which would host the document carries eight other
 * panels chosen by a static adapter, so "show them the Passport" could mean
 * "expose seven features nobody reviewed". These tests pin the narrowing.
 */

describe("turning the Passport on NARROWS the page", () => {
  it("passport on, full off — the Passport and nothing else", () => {
    expect(partnerSurfaceMode({ passportViewEnabled: true, fullWorkspaceEnabled: false }))
      .toBe("passport_only");
  });

  it("BOTH off is today's behaviour, byte for byte", () => {
    // The row that makes this safe to deploy: a deployment that has already
    // enabled the workspace cannot lose panels by installing this change.
    expect(partnerSurfaceMode({ passportViewEnabled: false, fullWorkspaceEnabled: false }))
      .toBe("full");
  });

  it("passport_only is never reachable by omission", () => {
    for (const full of [true, false]) {
      expect(partnerSurfaceMode({ passportViewEnabled: false, fullWorkspaceEnabled: full }))
        .toBe("full");
    }
  });

  it("both on is the eventual end state — everything, Passport included", () => {
    const mode = partnerSurfaceMode({ passportViewEnabled: true, fullWorkspaceEnabled: true });
    expect(mode).toBe("full");
    expect(partnerWorkspacePanels(mode, { procedures: true }).passport).toBe(true);
  });
});

describe("a mode subtracts; it can never add", () => {
  const everything = {
    procedures: true, determination: true, recordsRequests: true,
    deliveries: true, auditReceipt: true, clarification: true,
  };

  it("passport_only hides every reviewable panel", () => {
    const p = partnerWorkspacePanels("passport_only", everything);
    expect(p.passport).toBe(true);
    for (const hidden of [
      p.summary, p.tasks, p.procedures, p.determination,
      p.recordsRequests, p.deliveries, p.auditReceipt, p.clarification,
    ]) {
      expect(hidden).toBe(false);
    }
  });

  it("the credential header and a way to ask a question are never withheld", () => {
    const p = partnerWorkspacePanels("passport_only", {});
    expect(p.passportStrip).toBe(true);
    expect(p.support).toBe(true);
  });

  it("the ADAPTER stays the ceiling — full mode cannot conjure a panel", () => {
    // A portal whose adapter never permitted determinations must not acquire
    // one because a flag turned on somewhere else.
    const p = partnerWorkspacePanels("full", { procedures: true, determination: false });
    expect(p.procedures).toBe(true);
    expect(p.determination).toBe(false);
  });

  it("full mode with an empty adapter shows no optional panel at all", () => {
    const p = partnerWorkspacePanels("full", {});
    for (const hidden of [
      p.procedures, p.determination, p.recordsRequests,
      p.deliveries, p.auditReceipt, p.clarification,
    ]) {
      expect(hidden).toBe(false);
    }
  });
});

describe("whether the DOCUMENT may be disclosed is never the mode's decision", () => {
  const live = { revoked_at: null, expires_at: new Date(Date.now() + 864e5).toISOString() };
  const current = { superseded_at: null, refresh_required_at: null };

  it("a live grant on a current attestation discloses", () => {
    const d = passportDisclosure({ grant: live, attestation: current });
    expect(d.disclosable).toBe(true);
    expect(d.code).toBe("disclosable");
  });

  it("no grant is 'not shared', not 'unavailable'", () => {
    const d = passportDisclosure({ grant: null, attestation: current });
    expect(d.code).toBe("not_shared");
    expect(d.message).toMatch(/has not shared/i);
  });

  it("a withdrawn grant says withdrawn — and never why", () => {
    const d = passportDisclosure({
      grant: { revoked_at: new Date().toISOString(), expires_at: live.expires_at },
      attestation: current,
    });
    expect(d.code).toBe("revoked");
    // The internal revoke_reason is the issuer's, not the partner's.
    expect(d.message).not.toMatch(/reason|terminated|breach/i);
  });

  it("an expired grant points at the remedy", () => {
    const d = passportDisclosure({
      grant: { revoked_at: null, expires_at: new Date(Date.now() - 1000).toISOString() },
      attestation: current,
    });
    expect(d.code).toBe("expired");
    expect(d.message).toMatch(/issue it again/i);
  });

  it("a superseded attestation withholds — a partner must not rely on a stale record", () => {
    const d = passportDisclosure({
      grant: live, attestation: { superseded_at: new Date().toISOString() },
    });
    expect(d.disclosable).toBe(false);
    expect(d.code).toBe("superseded");
  });

  it("a material change in flight withholds it", () => {
    const d = passportDisclosure({
      grant: live, attestation: { refresh_required_at: new Date().toISOString() },
    });
    expect(d.disclosable).toBe(false);
    expect(d.code).toBe("refresh_required");
  });

  it("every refusal carries a partner-safe sentence — never an empty screen", () => {
    const refusals = [
      passportDisclosure({ grant: null, attestation: current }),
      passportDisclosure({ grant: live, attestation: null }),
      passportDisclosure({ grant: live, attestation: { superseded_at: "2026-01-01" } }),
    ];
    for (const r of refusals) {
      expect(r.disclosable).toBe(false);
      expect(r.message.length).toBeGreaterThan(20);
    }
  });
});

describe("wired at the source, and cascaded to every portal", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  const workspace = read("src/components/partner-compliance/PartnerComplianceWorkspace.tsx");
  const fn = read("supabase/functions/aml-reliance/index.ts");

  it("ONE component serves Finance, Builder/Developer and Solicitor", () => {
    // The cascade is structural: there is one workspace, so a change to it
    // reaches all three portals and cannot reach two of them.
    for (const page of [
      "src/pages/finance-portal/FinancePortalComplianceWorkspace.tsx",
      "src/pages/solicitor/SolicitorCompliance.tsx",
    ]) {
      expect(read(page), page).toContain("PartnerComplianceWorkspace");
    }
    expect(workspace).toContain("PartnerPassportPanel");
  });

  it("the browser never derives the mode — it renders the one the server sent", () => {
    // A page that decided its own scope could show a panel the deployment
    // has not enabled. The server sends `surface_mode`; this reads it.
    expect(workspace).toContain("w.data.surface_mode");
    expect(workspace).toContain("partnerWorkspacePanels(surfaceMode, adapter.panels)");
    expect(workspace).not.toMatch(/partnerSurfaceMode\(/);
  });

  it("the in-portal document comes from the SAME assembler as the emailed link", () => {
    /* The standing requirement is one record, and that is a property of
       having one implementation — not of two agreeing. Both the token path
       and the portal path call the same function for the same audience. */
    const calls = fn.match(/buildCasePassportView\(admin, [^,]+, "partner"\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(fn).toContain('passport: passportView');
  });

  it("an in-portal disclosure is logged exactly like a token redemption", () => {
    expect(fn).toContain("passport_disclosed: Boolean(passportView)");
    expect(fn).toContain('via: "partner_workspace"');
  });

  it("the flags default OFF and both are declared", () => {
    const migration = read("supabase/migrations/20260828120000_aml_partner_passport_view_flags.sql");
    expect(migration).toContain("'aml_partner_passport_view'");
    expect(migration).toContain("'aml_partner_workspace_full'");
    expect(migration).not.toMatch(/'true'::jsonb/);
    // Additive only — a flag migration must never alter an existing row.
    expect(migration).toContain("ON CONFLICT (key) DO NOTHING");
    expect(migration).not.toMatch(/\bUPDATE\b|\bDROP\b|\bDELETE\b/);
  });
});
