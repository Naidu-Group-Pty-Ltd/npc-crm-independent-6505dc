import { describe, expect, it } from "vitest";
import {
  LEGAL_ROUTES,
  evaluatePartnerLinkForReliance,
  type PartnerCaseLinkInput,
} from "../../../supabase/functions/_shared/aml/relianceEligibility";

/**
 * Behavioural tests for the Phase 1 reliance eligibility guard — the single
 * server-side decision for whether a canonical partner may receive NEW
 * reliance access on a case. Synthetic identifiers only.
 */

const ORG = { id: "org-aaaa", status: "active" };
const CASE_ID = "case-1111";
const TENANT = "default";

const link = (over: Partial<PartnerCaseLinkInput> = {}): PartnerCaseLinkInput => ({
  id: "link-0001",
  case_id: CASE_ID,
  tenant_id: TENANT,
  partner_org_id: ORG.id,
  legal_route: "reliance",
  state: "active",
  ...over,
});

const ctx = (over: Partial<Parameters<typeof evaluatePartnerLinkForReliance>[0]> = {}) => ({
  caseId: CASE_ID,
  caseTenantId: TENANT,
  partnerOrg: ORG,
  links: [link()],
  ...over,
});

describe("reliance eligibility — canonical partner and case link (Phase 1)", () => {
  it("exposes exactly the four distinct legal routes", () => {
    expect([...LEGAL_ROUTES]).toEqual([
      "reliance", "outsourced_cdd", "independent_cdd", "information_share_only",
    ]);
  });

  it("allows reliance only through an active reliance-route link for the exact case", () => {
    const decision = evaluatePartnerLinkForReliance(ctx());
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.link.id).toBe("link-0001");
  });

  it("denies when the agreement has no canonical partner organisation", () => {
    const decision = evaluatePartnerLinkForReliance(ctx({ partnerOrg: null }));
    expect(decision).toMatchObject({ ok: false, code: "partner_org_unresolved" });
  });

  it("denies when the partner organisation is suspended or ended", () => {
    for (const status of ["suspended", "ended"]) {
      const decision = evaluatePartnerLinkForReliance(
        ctx({ partnerOrg: { id: ORG.id, status } }),
      );
      expect(decision).toMatchObject({ ok: false, code: "partner_org_not_active" });
    }
  });

  it("denies an unlinked partner — an account or an agreement name is not access", () => {
    const decision = evaluatePartnerLinkForReliance(ctx({ links: [] }));
    expect(decision).toMatchObject({ ok: false, code: "partner_link_missing" });
  });

  it("denies when the only links belong to a DIFFERENT organisation", () => {
    const decision = evaluatePartnerLinkForReliance(
      ctx({ links: [link({ partner_org_id: "org-zzzz" })] }),
    );
    expect(decision).toMatchObject({ ok: false, code: "partner_link_missing" });
  });

  it("refuses loudly when a supplied link belongs to another case", () => {
    const decision = evaluatePartnerLinkForReliance(
      ctx({ links: [link({ case_id: "case-9999" })] }),
    );
    expect(decision).toMatchObject({ ok: false, code: "partner_link_wrong_case" });
  });

  it("refuses loudly when a supplied link belongs to another tenant", () => {
    const decision = evaluatePartnerLinkForReliance(
      ctx({ links: [link({ tenant_id: "other-tenant" })] }),
    );
    expect(decision).toMatchObject({ ok: false, code: "partner_link_wrong_tenant" });
  });

  it("never infers reliance from a non-reliance route", () => {
    for (const route of ["outsourced_cdd", "independent_cdd", "information_share_only"]) {
      const decision = evaluatePartnerLinkForReliance(
        ctx({ links: [link({ legal_route: route })] }),
      );
      expect(decision).toMatchObject({ ok: false, code: "partner_link_wrong_route" });
    }
  });

  it("denies suspended and ended links", () => {
    for (const state of ["suspended", "ended"]) {
      const decision = evaluatePartnerLinkForReliance(
        ctx({ links: [link({ state })] }),
      );
      expect(decision).toMatchObject({ ok: false, code: "partner_link_not_active" });
    }
  });

  it("selects the active reliance link when mixed states exist", () => {
    const decision = evaluatePartnerLinkForReliance(ctx({
      links: [
        link({ id: "link-ended", state: "ended" }),
        link({ id: "link-info", legal_route: "information_share_only" }),
        link({ id: "link-live" }),
      ],
    }));
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.link.id).toBe("link-live");
  });

  it("denial messages carry no restricted vocabulary", () => {
    const denials = [
      evaluatePartnerLinkForReliance(ctx({ partnerOrg: null })),
      evaluatePartnerLinkForReliance(ctx({ links: [] })),
      evaluatePartnerLinkForReliance(ctx({ links: [link({ state: "ended" })] })),
      evaluatePartnerLinkForReliance(ctx({ links: [link({ legal_route: "independent_cdd" })] })),
    ];
    for (const d of denials) {
      expect(d.ok).toBe(false);
      if (d.ok === false) {
        expect(d.message).not.toMatch(/risk|screening|match|mlro note|reviewer|suspicious|smr/i);
      }
    }
  });
});
