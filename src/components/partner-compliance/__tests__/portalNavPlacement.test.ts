import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Where the AML/CTF Compliance entry sits in a portal's sidebar.
 *
 * ── The reported problem ──────────────────────────────────────────────
 * "The AML/CTF Compliance tab on the left hand side is located at the bottom
 * of the list; this needs to be allocated at the top of the list under
 * Dashboard."
 *
 * That is not a matter of taste. A partner arrives at this page from an
 * email about a live purchase, reads the customer's completed due diligence,
 * and then has to find it again a week later without the email. At the foot
 * of a twelve-entry sidebar — below Earnings, below Reports & KPIs — it read
 * as an appendix. It is the record a settlement now depends on.
 *
 * ── What is pinned ────────────────────────────────────────────────────
 * POSITION, not the whole list. Every portal keeps its own ordering for
 * everything else; the one rule is that the Dashboard is first and the
 * compliance entry is immediately under it. Asserting the full array would
 * make this test about navigation in general and it would be rewritten,
 * rather than consulted, the next time an entry is added.
 *
 * The Client Portal is included and is deliberately DIFFERENT in one way:
 * its entry is called "Identity & Compliance", because that portal's reader
 * is the customer proving who they are, not a partner relying on somebody
 * else's diligence. Regulator vocabulary on a customer surface is a separate
 * defect, and moving a tab is not the moment to introduce it.
 */

const read = (p: string) => readFileSync(p, "utf8");

/** The `to:` paths of a nav array, in source order. */
function navPaths(source: string, constName: string): string[] {
  const start = source.indexOf(`const ${constName}`);
  expect(start, constName).toBeGreaterThan(-1);
  const end = source.indexOf("\n];", start);
  expect(end, constName).toBeGreaterThan(start);
  const block = source.slice(start, end);
  return [...block.matchAll(/\bto:\s*'([^']+)'/g)].map((m) => m[1]);
}

const PORTALS = [
  {
    name: "Finance",
    file: "src/components/finance-portal/FinancePortalLayout.tsx",
    constName: "NAV_ITEMS",
    dashboard: "/finance",
    compliance: "/finance/compliance",
  },
  {
    name: "Solicitor",
    file: "src/components/solicitor-portal/SolicitorPortalLayout.tsx",
    constName: "NAV_ITEMS",
    dashboard: "/solicitor",
    compliance: "/solicitor/compliance",
  },
  {
    name: "Client",
    file: "src/components/portal/PortalLayout.tsx",
    constName: "portalNavItems",
    dashboard: "/client",
    compliance: "/client/aml",
  },
] as const;

describe("compliance sits directly under the Dashboard, in every portal", () => {
  for (const portal of PORTALS) {
    it(`${portal.name} Portal`, () => {
      const paths = navPaths(read(portal.file), portal.constName);
      expect(paths[0], `${portal.name}: dashboard first`).toBe(portal.dashboard);
      expect(paths[1], `${portal.name}: compliance second`).toBe(portal.compliance);
      // Exactly once — a second entry would be two doors to one page.
      expect(paths.filter((p) => p === portal.compliance)).toHaveLength(1);
    });
  }

  it("the partner portals still name it in the regulator's words", () => {
    // The two surviving partner portals; the Builder portal's nav left with
    // the portal (network extraction Phase 7).
    for (const portal of PORTALS.slice(0, 2)) {
      expect(read(portal.file), portal.name).toContain("'AML/CTF Compliance'");
    }
  });

  it("the Client Portal keeps the customer's words for the customer's page", () => {
    /* `/client/aml` is where a customer verifies their own identity. Calling
       it "AML/CTF Compliance" would put a reporting entity's vocabulary in
       front of the person being verified. */
    const client = read("src/components/portal/PortalLayout.tsx");
    expect(client).toContain("'Identity & Compliance'");
    expect(client).not.toContain("'AML/CTF Compliance'");
  });
});

describe("the standing responsibility banner is gone from the portals", () => {
  /**
   * "I believe this is not required to be included in all portals as the
   * portal partner has already agreed to the terms and conditions coupled
   * with the acknowledgments."
   *
   * Right, and worth recording why it is safe: a partner reaches this page
   * only through a signed written CDD arrangement carrying those
   * acknowledgements. The statement itself is not deleted — it is on the
   * document, and it is still what the server sends — but it is no longer
   * standing page furniture repeated on every state of every visit.
   */
  it("the component is DELETED, not merely unmounted", () => {
    /* A dormant component is one import away from putting the banner back.
       Everything that renders it had to go with it. */
    expect(() => read("src/components/partner-compliance/ResponsibilityNotice.tsx")).toThrow();
    const index = read("src/components/partner-compliance/index.ts");
    expect(index).not.toContain('export { ResponsibilityNotice }');
    const workspace = read("src/components/partner-compliance/PartnerComplianceWorkspace.tsx");
    expect(workspace).not.toContain("ResponsibilityNotice");
  });

  it("the statement survives on the document, which is where it is worth something", () => {
    const panel = read("src/components/partner-compliance/PartnerPassportPanel.tsx");
    expect(panel).toContain('data-testid="partner-reliance-notice"');
    expect(panel).toMatch(/remains responsible\s*\n?\s*for its own AML\/CTF compliance/);
  });

  it("and the acknowledgement is still required before a partner records a decision", () => {
    /* Removing a notice must never remove a control. This one is not a
       notice: it is a checkbox the partner ticks before their own CDD
       determination is written down. */
    const form = read("src/components/partner-compliance/IndependentAssessmentForm.tsx");
    expect(form).toMatch(/remains responsible for its own AML\/CTF/);
  });

  it("the server still sends the fixed wording — this was a chrome change", () => {
    const shared = read("supabase/functions/_shared/aml/partnerWorkspace.ts");
    expect(shared).toContain("RESPONSIBILITY_NOTICE");
    expect(shared).toContain("responsibility_notice");
  });
});
