import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PORTAL_ROUTES, portalHandoff, returnToPath, safeReturnTo,
} from "./partnerPortalHandoff";

/**
 * "View in your portal" — from an emailed link to the partner's own page.
 *
 * The reported symptom was that the AML/CTF Compliance page could not be
 * found anywhere in the Builder Portal, and that the emailed link offered no
 * way through to it. Both were true, and behind them sat a chain in which
 * every link was individually broken.
 */

const enrolled = { surfaceEnabled: true, hasActiveMembership: true };

describe("which portal, and whether to offer it at all", () => {
  it("the builder door is closed — the portal moved to the Builders Network", () => {
    /* Phase 6 of the extraction: /builder/* redirects off this origin, and
       the network has no in-portal Passport surface until E4's server-side
       call ships. Enrolment and the flag change nothing — a moved portal is
       unavailable whatever this deployment's configuration says. The emailed
       link stays the builder partner's way in. */
    const h = portalHandoff({ partnerOrgType: "builder", partnerCaseLinkId: "L1", ...enrolled });
    expect(h.available).toBe(false);
    expect(h.reason).toBe("portal_moved");
    expect(h.path).toBeNull();
    expect(h.label).toBe("Builder / Developer Portal");
  });

  it("a DEVELOPER organisation is the same closed door — there is no /developer", () => {
    /* One shared portal, one shared fate. The route table still maps both
       onto the Builder page: it is the history and the revival, not the
       offer. */
    const h = portalHandoff({ partnerOrgType: "developer", partnerCaseLinkId: "L1", ...enrolled });
    expect(h.available).toBe(false);
    expect(h.reason).toBe("portal_moved");
    expect(PORTAL_ROUTES.developer.path).toBe(PORTAL_ROUTES.builder.path);
  });

  it("finance and solicitor each reach their own page", () => {
    expect(portalHandoff({ partnerOrgType: "finance", partnerCaseLinkId: "L1", ...enrolled }).path)
      .toBe("/finance/compliance?matter=L1");
    expect(portalHandoff({ partnerOrgType: "solicitor_conveyancer", partnerCaseLinkId: "L1", ...enrolled }).path)
      .toBe("/solicitor/compliance?matter=L1");
  });

  it("a partner OUTSIDE every portal is offered nothing — the link is their route", () => {
    const h = portalHandoff({ partnerOrgType: "other", ...enrolled });
    expect(h.available).toBe(false);
    expect(h.reason).toBe("no_portal");
    expect(h.path).toBeNull();
  });

  it("a door that would refuse is never offered", () => {
    // Enrolment missing: the page exists but answers "not enrolled".
    const notEnrolled = portalHandoff({
      partnerOrgType: "finance", partnerCaseLinkId: "L1",
      surfaceEnabled: true, hasActiveMembership: false,
    });
    expect(notEnrolled.available).toBe(false);
    expect(notEnrolled.reason).toBe("not_enrolled");

    // Surface off: the page does not exist on this deployment.
    const off = portalHandoff({
      partnerOrgType: "finance", partnerCaseLinkId: "L1",
      surfaceEnabled: false, hasActiveMembership: true,
    });
    expect(off.available).toBe(false);
    expect(off.reason).toBe("surface_disabled");
  });

  it("no matter is named rather than a matter being invented", () => {
    const h = portalHandoff({ partnerOrgType: "finance", partnerCaseLinkId: null, ...enrolled });
    expect(h.available).toBe(true);
    expect(h.path).toBe("/finance/compliance");
    expect(h.path).not.toContain("matter=");
  });

  it("an absolute URL is built only when an origin is supplied", () => {
    const withOrigin = portalHandoff(
      { partnerOrgType: "finance", partnerCaseLinkId: "L1", ...enrolled },
      "https://command-centre.npcservices.com.au/",
    );
    expect(withOrigin.url).toBe(
      "https://command-centre.npcservices.com.au/finance/compliance?matter=L1");
    expect(portalHandoff({ partnerOrgType: "finance", partnerCaseLinkId: "L1", ...enrolled }).url)
      .toBeNull();
  });
});

describe("the deep link is a destination, never a credential", () => {
  it("carries a matter identifier and nothing else", () => {
    const h = portalHandoff({ partnerOrgType: "finance", partnerCaseLinkId: "L1", ...enrolled });
    /* A bearer token in a browser address bar survives in history, referrers
       and screenshots. The portal session decides what may be read; the
       matter id grants nothing and resolves to "not found" for a partner it
       does not belong to. */
    for (const forbidden of [/token/i, /access/i, /passport\/[0-9a-f]{8}/i]) {
      expect(h.path ?? "", forbidden.source).not.toMatch(forbidden);
    }
  });

  it("a matter id is URL-encoded rather than concatenated", () => {
    const h = portalHandoff({ partnerOrgType: "finance", partnerCaseLinkId: "a b&c=d", ...enrolled });
    expect(h.path).toBe("/finance/compliance?matter=a%20b%26c%3Dd");
  });
});

describe("coming back after signing in", () => {
  it("the destination keeps the query string — that is where the matter is", () => {
    expect(returnToPath("/builder/compliance", "?matter=L1"))
      .toBe("/builder/compliance?matter=L1");
    expect(returnToPath("/builder/compliance", "")).toBe("/builder/compliance");
  });

  it("only an internal path is honoured — a login page is not an open redirect", () => {
    /* The person who has just typed their password is exactly the person you
       can send anywhere, which is what makes this a phishing primitive
       rather than a convenience bug. */
    for (const hostile of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "/\\evil.example",
      "javascript:alert(1)",
      "  https://evil.example",
      null, undefined, 42, {},
    ]) {
      expect(safeReturnTo(hostile as unknown, "/builder"), String(hostile)).toBe("/builder");
    }
  });

  it("a legitimate deep link survives", () => {
    expect(safeReturnTo("/builder/compliance?matter=L1", "/builder"))
      .toBe("/builder/compliance?matter=L1");
  });

  it("a destination carrying a control character is refused", () => {
    expect(safeReturnTo("/builder\nHost: evil", "/builder")).toBe("/builder");
  });
});

describe("wired at the source", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("both surviving portals record the destination, and both honour it", () => {
    /* Two of the original three lost it: the Builder guard recorded the
       pathname alone and its login ignored the record entirely; the
       Solicitor guard recorded nothing at all. Finance was already correct
       and is the reference. The Builder portal then left this repository
       with the portal (network extraction Phase 7) — its handoff surface
       answers `portal_moved` and there is no builder login to honour a
       destination — so the rule is pinned on the two that remain. */
    const solicitorGuard = read("src/components/solicitor-portal/SolicitorPortalProtectedRoute.tsx");
    const financeGuard = read("src/components/finance-portal/FinancePortalProtectedRoute.tsx");
    expect(solicitorGuard).toContain("returnToPath(location.pathname, location.search)");
    expect(financeGuard).toContain("${location.pathname}${location.search}");

    for (const login of [
      "src/pages/solicitor/SolicitorLogin.tsx",
    ]) {
      const source = read(login);
      expect(source, login).toContain("safeReturnTo(");
      expect(source, login).toContain("navigate(destination, { replace: true })");
    }
  });

  it("the compliance page reads the matter, and checks it against the server's own list", () => {
    const workspace = read("src/components/partner-compliance/PartnerComplianceWorkspace.tsx");
    expect(workspace).toContain('searchParams.get("matter")');
    // Checked against what the server returned — a stale link in an old email
    // must land on the compliance page, not on a failure.
    expect(workspace).toContain("res.data.links.find((l) => l.id === requestedMatter)");
  });

  it("every portal names the page the same thing the email does", () => {
    for (const layout of [
      "src/components/finance-portal/FinancePortalLayout.tsx",
      "src/components/solicitor-portal/SolicitorPortalLayout.tsx",
    ]) {
      expect(read(layout), layout).toContain("'AML/CTF Compliance'");
    }
  });

  it("the emailed link offers the portal, and the page offers it too", () => {
    const fn = read("supabase/functions/aml-reliance/index.ts");
    // In the email, where a recipient decides whether to keep the message.
    expect(fn).toContain("Open it in your ${handoff.label}");
    expect(fn).toContain("handoff.available && handoff.url");
    // And on both redemption responses.
    expect((fn.match(/portal_handoff: await resolvePortalHandoff\(/g) ?? []).length).toBe(2);
    const page = read("src/pages/PublicPassport.tsx");
    expect(page).toContain("data.portal_handoff?.available");
    expect(page).toContain("View in your portal");
  });
});

describe("the pointer that made every grant unreachable from its portal", () => {
  const fn = readFileSync("supabase/functions/aml-reliance/index.ts", "utf8");

  it("an arrangement now carries its canonical organisation", () => {
    /* `grant_access` stamps `partner_org_id` on a grant only when the
       ARRANGEMENT has one, and `create_agreement` never accepted one — so
       every grant the onboarding wizard produced carried NULL, and the
       partner's portal, which looks a grant up BY organisation, reported a
       Passport it held as never shared. */
    const block = fn.slice(fn.indexOf('case "create_agreement"'), fn.indexOf('case "bind_agreement_organisation"'));
    expect(block).toContain("if (boundOrgId) insertRow.partner_org_id = boundOrgId;");
    // Validated, never trusted: existence, status and a matching type.
    expect(block).toContain("organisation_type_mismatch");
    expect(block).toContain("organisation_not_active");
  });

  it("the READ path finds a grant by either explicit route, and never by name", () => {
    const block = fn.slice(
      fn.indexOf("async function loadOrgGrantAndAttestation"),
      fn.indexOf("const __corsWrappedHandler"));
    expect(block).toContain('.eq("partner_org_id", partnerOrgId)');
    expect(block).toContain('.in("agreement_id", agreementIds)');
    // Never a name match, and never a string-composed filter.
    expect(block).not.toMatch(/partner_org_name/);
    expect(block).not.toMatch(/\.or\(/);
  });

  it("binding an existing arrangement never re-points one", () => {
    const block = fn.slice(
      fn.indexOf('case "bind_agreement_organisation"'), fn.indexOf('case "review_agreement"'));
    expect(block).toContain("agreement_org_conflict");
    expect(block).toContain('return jr({ agreement: agreementRow, bound: "already" });');
    // A name is never the key: the operator names both ids explicitly.
    expect(block).not.toMatch(/ilike\(/);
    expect(block).not.toMatch(/\.eq\("(partner_org_name|legal_name)"/);
    expect(block).toContain('.eq("id", agreementId)');
  });

  it("the wizard passes it, and repairs an arrangement that lacks it", () => {
    const wizard = readFileSync("src/components/aml/PartnerOnboardingWizard.tsx", "utf8");
    expect(wizard).toContain("partner_org_id: orgId,");
    expect(wizard).toContain("amlRelianceApi.bindAgreementOrganisation(agreement.id, orgId)");
  });
});

describe("the surface is enabled, and only as far as the Passport", () => {
  const migration = readFileSync(
    "supabase/migrations/20260828140000_aml_enable_partner_passport_surface.sql", "utf8");

  it("enables the page and the document in all three portals", () => {
    for (const key of [
      "aml_partner_compliance_workspace",
      "aml_partner_workspace_finance",
      "aml_partner_workspace_builder",
      "aml_partner_workspace_solicitor",
      "aml_partner_passport_view",
    ]) {
      expect(migration).toContain(`'${key}'`);
    }
  });

  it("leaves the eight-panel workspace OFF, and asserts it rather than assuming", () => {
    // Enabling it here would be a silent rollout of seven unreviewed panels,
    // so the key must not appear in the UPDATE's own key list.
    const updateBlock = migration.slice(
      migration.indexOf("UPDATE public.feature_flags"), migration.indexOf("DO $$"));
    expect(updateBlock).not.toContain("aml_partner_workspace_full");
    expect(migration).toContain("aml_partner_workspace_full is ON");
    expect(migration).toContain("RAISE EXCEPTION");
  });

  it("touches no write flag — a partner reads, and records nothing", () => {
    for (const writeFlag of [
      "aml_partner_records_requests_write",
      "aml_partner_determinations_write",
      "aml_partner_evidence_delivery_write",
    ]) {
      expect(migration).not.toContain(`'${writeFlag}'`);
    }
  });
});
