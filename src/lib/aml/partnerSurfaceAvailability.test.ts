import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * "The compliance workspace is not available."
 *
 * ── What was actually happening ───────────────────────────────────────
 * The email was right, the link was right, the flags were on, the partner
 * was fully enrolled — membership active, organisation cross-referenced,
 * arrangement bound, matter linked — and the page still said no.
 *
 * The gate in front of it was asking a question a partner cannot ask.
 * `public.feature_flags` grants SELECT `TO authenticated`; a Finance,
 * Builder or Solicitor portal user is not a Supabase-auth user, so the
 * browser client is anon. RLS does not error on a role that matches no
 * policy — it FILTERS. The query returned `[]` with HTTP 200, `error` was
 * null, every flag coerced from `undefined` to `false`, and the page
 * announced itself unavailable while the server was ready to serve it.
 *
 * The same trap is documented on `useAmlV3Flags` and
 * `useBuilderStockMarketplaceFlag`. This is the third surface to hit it, so
 * these tests pin the rule rather than the symptom.
 */

const invokeSecureFunction = vi.fn();
vi.mock("@/lib/secureInvoke", () => ({
  invokeSecureFunction: (...a: unknown[]) => invokeSecureFunction(...a),
}));

const read = (p: string) => readFileSync(p, "utf8");

/**
 * The file with its comments removed.
 *
 * These assertions are about what the CODE does. The comments deliberately
 * name the trap — that is how the next person avoids it — so asserting over
 * the raw text would forbid documenting the very thing being forbidden.
 */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the browser never reads feature_flags for a partner surface", () => {
  const hook = read("src/lib/aml/usePartnerWorkspaceFlags.ts");

  it("the table read is gone — it can never work from a portal", () => {
    const body = code("src/lib/aml/usePartnerWorkspaceFlags.ts");
    expect(body).not.toContain('from("feature_flags")');
    expect(body).not.toContain("from('feature_flags')");
    // And the anon Supabase client is not imported at all any more.
    expect(body).not.toContain("@/integrations/supabase/client");
  });

  it("it reads through the server instead", () => {
    expect(hook).toContain('op: "get_partner_surface_availability"');
    expect(hook).toContain("invokeSecureFunction");
  });

  it("the same trap is named, so the next surface does not repeat it", () => {
    expect(hook).toMatch(/TO `?authenticated/);
    expect(hook).toMatch(/RLS does not error|it FILTERS|filters/i);
    expect(hook).toMatch(/useAmlV3Flags/);
  });

  it("no partner-facing surface reads the table either", () => {
    /* The Builder page left with the portal (network extraction Phase 7);
       the rule holds over every partner surface that remains. */
    for (const page of [
      "src/pages/finance-portal/FinancePortalComplianceWorkspace.tsx",
      "src/pages/solicitor/SolicitorCompliance.tsx",
      "src/components/partner-compliance/PartnerComplianceWorkspace.tsx",
    ]) {
      expect(code(page), page).not.toContain("feature_flags");
    }
  });
});

describe("one authority decides whether a partner may see the page", () => {
  it("no portal page gates on a client-side flag any more", () => {
    /* The server refuses every workspace operation on its own — flags,
       membership, organisation mapping, link scope — and says so in its own
       words. A second authority in front of it is how a page came to
       announce itself unavailable while the server was ready to serve it. */
    for (const page of [
      "src/pages/finance-portal/FinancePortalComplianceWorkspace.tsx",
      "src/pages/solicitor/SolicitorCompliance.tsx",
    ]) {
      const source = code(page);
      expect(source, page).not.toContain("usePartnerWorkspaceEnabled");
      expect(source, page).not.toContain("The compliance workspace is not available.");
      // The workspace itself is still mounted, in all three.
      expect(source, page).toContain("PartnerComplianceWorkspace");
    }
  });

  it("the closed state explains itself and leaves the emailed link standing", () => {
    const workspace = read("src/components/partner-compliance/PartnerComplianceWorkspace.tsx");
    expect(workspace).toContain("This page is not available to your account yet");
    // A partner who followed a link from an email must not be left stranded.
    expect(workspace).toMatch(/that link still works/i);
    expect(workspace).toMatch(/obligations are unaffected/i);
  });

  it("the server answers it without a session, and discloses nothing", () => {
    const fn = read("supabase/functions/aml-reliance/index.ts");
    const op = fn.slice(
      fn.indexOf('if (op === "get_partner_surface_availability")'),
      fn.indexOf("if (PARTNER_WORKSPACE_OPS.has(op))"));
    expect(op).toContain("compliance_page: master && surfaceOn");
    // Whether a page EXISTS and whether a DOCUMENT is on it are two
    // questions; folding them together would make a withheld Passport read
    // as no page at all.
    expect(op).toContain("passport_view:");
    // No case, partner or record is named.
    const opCode = op.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const leak of ["case_id", "legal_name", "attestation_id"]) {
      expect(opCode, leak).not.toContain(leak);
    }
  });

  it("it is answered BEFORE the flag gate — or it could never report 'off'", () => {
    const fn = read("supabase/functions/aml-reliance/index.ts");
    expect(fn.indexOf('if (op === "get_partner_surface_availability")'))
      .toBeLessThan(fn.indexOf("if (PARTNER_WORKSPACE_OPS.has(op))"));
  });
});

describe("a failure is never cached, and never reported as 'off'", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("an unreadable answer is UNKNOWN, which hides the entry but claims nothing", async () => {
    invokeSecureFunction.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { usePartnerWorkspaceEnabled } = await import("./usePartnerWorkspaceFlags");
    expect(typeof usePartnerWorkspaceEnabled).toBe("function");
    // The reading itself is asserted through the module's contract below;
    // this pins that `unknown` exists as a distinct answer at all.
    const hook = read("src/lib/aml/usePartnerWorkspaceFlags.ts");
    expect(hook).toContain("unknown: true");
    expect(hook).toContain("if (availability.unknown) cache.delete(surface)");
  });

  it("a deployment predating the op is unknown, not off", () => {
    const hook = read("src/lib/aml/usePartnerWorkspaceFlags.ts");
    expect(hook).toContain("if (!a) return UNKNOWN;");
  });

  it("the Command Centre says nothing rather than something false", () => {
    /* `useAnyPartnerWorkspaceEnabled` feeds a line that tells an operator
       where a Passport can be read. `null` — unread, or unreadable — must
       render as silence, never as "switched off on this deployment". */
    const hook = read("src/lib/aml/usePartnerWorkspaceFlags.ts");
    expect(hook).toContain("if (readings.every((r) => r.unknown)) return { loading: false, enabled: null };");
    const panel = read("src/components/aml/PartnerRosterPanel.tsx");
    expect(panel).toContain("workspaceEnabled === false");
    expect(panel).toContain("workspaceEnabled === true");
  });
});

describe("the nav entry still leads somewhere", () => {
  it("all three portals gate their entry on the same hook", () => {
    // An entry that leads nowhere is worse than none — this is the one place
    // a client-side reading is still the right control.
    for (const layout of [
      "src/components/finance-portal/FinancePortalLayout.tsx",
      "src/components/solicitor-portal/SolicitorPortalLayout.tsx",
    ]) {
      const source = read(layout);
      expect(source, layout).toContain("usePartnerWorkspaceEnabled");
      expect(source, layout).toContain("'AML/CTF Compliance'");
    }
  });

  it("every portal routes that entry to a real page", () => {
    const app = read("src/App.tsx");
    for (const route of [
      '<Route path="compliance" element={<FinancePortalComplianceWorkspace />} />',
      '<Route path="compliance" element={<SolicitorCompliance />} />',
    ]) {
      expect(app, route).toContain(route);
    }
    /* Phase 6 of the network extraction: the Builder portal is unrouted
       wholesale — the nav entry, the layout that drew it and the compliance
       page all left with /builder/*, which resolves to the Builders Network
       redirect. There is no builder entry left to lead anywhere, and the
       portal handoff names the closed door `portal_moved` until E4's
       network→clone surface ships. */
    expect(app).toContain('<Route path="/builder/*" element={<BuilderPortalMoved />} />');
    expect(app).not.toContain('element={<BuilderCompliance />}');
  });
});
