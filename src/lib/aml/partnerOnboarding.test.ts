import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  LEGAL_ROUTE_CHOICES, PARTNER_PORTAL_CHOICES, PREBUILT_AGREEMENT_TITLE,
  BUILDER_ORG_KINDS, amlOrgTypeForKind, builderOrgType, defaultPurpose, defaultReviewDate,
  grantReadiness, isValidEmail, isoDate, portalAsksOrgKind,
  portalHasPrebuiltAgreement, prebuiltArrangementDraft,
} from "./partnerOnboarding.pure";

/**
 * Partner onboarding — one guided pass from "does not exist" to "holds a
 * grant". Pinned: the catalogues carry meanings, not bare enum values;
 * the grant readiness never treats an UNKNOWN consent reading as a pass;
 * the defaults satisfy the server's own validation; and the wizard is
 * wired into the reliance panel with the token shown exactly once.
 */

describe("the catalogues explain, and cover the server's vocabulary", () => {
  it("one card per PORTAL — builder and developer share one, and it says so", () => {
    // Builder and developer partners sign into the SAME portal, so two
    // cards described a split that does not exist. The card values stay
    // in the AML server's vocabulary.
    expect(PARTNER_PORTAL_CHOICES.map((p) => p.value)).toEqual([
      "finance", "builder", "solicitor_conveyancer", "other",
    ]);
    const shared = PARTNER_PORTAL_CHOICES.find((p) => p.value === "builder")!;
    expect(shared.label).toBe("Builder / Developer portal");
    expect(shared.meaning).toMatch(/one shared portal/i);
    for (const p of PARTNER_PORTAL_CHOICES) {
      expect(p.meaning.length, p.value).toBeGreaterThan(20);
      expect(p.role.length, p.value).toBeGreaterThan(0);
    }
  });

  it("the shared card asks which organisation it is, and maps to both vocabularies", () => {
    // The kind is written to three records, so it is asked rather than
    // guessed — and AML has no combined value, so a builder-developer is
    // a builder there while the portal keeps the fuller shape.
    expect(portalAsksOrgKind("builder")).toBe(true);
    expect(portalAsksOrgKind("developer")).toBe(true);
    expect(portalAsksOrgKind("finance")).toBe(false);
    expect(portalAsksOrgKind("solicitor_conveyancer")).toBe(false);

    expect(BUILDER_ORG_KINDS.map((k) => k.value)).toEqual([
      "builder", "developer", "builder_developer",
    ]);
    for (const k of BUILDER_ORG_KINDS) {
      expect(k.meaning.length, k.value).toBeGreaterThan(20);
      // Every kind resolves to a type the AML server accepts.
      expect(["builder", "developer"]).toContain(amlOrgTypeForKind(k.value));
    }
    expect(amlOrgTypeForKind("builder_developer")).toBe("builder");
    expect(builderOrgType("builder_developer")).toBe("builder_developer");
  });

  it("every legal route is offered and explained — reliance leads, because a grant is a reliance disclosure", () => {
    expect(LEGAL_ROUTE_CHOICES[0].value).toBe("reliance");
    expect(LEGAL_ROUTE_CHOICES.map((r) => r.value).sort()).toEqual([
      "independent_cdd", "information_share_only", "outsourced_cdd", "reliance",
    ]);
    for (const r of LEGAL_ROUTE_CHOICES) expect(r.meaning.length, r.value).toBeGreaterThan(20);
  });
});

describe("the prebuilt arrangement — portal sign-up carries it, so nobody types it", () => {
  it("every portal partner has the prebuilt agreement; a partner outside the portals does not", () => {
    for (const p of ["finance", "builder", "developer", "solicitor_conveyancer"]) {
      expect(portalHasPrebuiltAgreement(p), p).toBe(true);
    }
    expect(portalHasPrebuiltAgreement("other")).toBe(false);
  });

  it("the register row names the instrument and where its acknowledgement happens", () => {
    const draft = prebuiltArrangementDraft(new Date(2026, 7, 27));
    expect(draft.agreement_reference).toContain(PREBUILT_AGREEMENT_TITLE);
    expect(draft.agreement_reference).toContain("acknowledged at portal sign-up");
    // The server caps agreement_reference at 200 characters.
    expect(draft.agreement_reference.length).toBeLessThanOrEqual(200);
    expect(draft.executed_on).toBe("2026-08-27");
    expect(draft.next_review_due).toBe("2027-08-27");
  });

  it("the claim is CROSS-REFERENCED to the module sign-up enforces, not asserted here", () => {
    // The prebuilt agreement's mandatory acknowledgement IS the s 37A
    // arrangement statement, and portal sign-up refuses acceptance
    // without it — that is what lets onboarding skip the manual step.
    const signup = readFileSync("supabase/functions/_shared/portalAgreement.ts", "utf8");
    expect(signup).toContain("'binding_amlctf_arrangement'");
    expect(signup).toContain("section 37A of the AML/CTF Act");
    expect(signup).toContain("REQUIRED_TERMS_ACKNOWLEDGEMENTS");
  });
});

describe("the defaults satisfy the server's own validation", () => {
  it("dates are plain YYYY-MM-DD and the review default is a year out, not 'sometime'", () => {
    expect(isoDate(new Date(2026, 7, 27))).toBe("2026-08-27");
    expect(defaultReviewDate(new Date(2026, 7, 27))).toBe("2027-08-27");
  });

  it("the suggested purpose clears the server's 10-character floor for every portal", () => {
    for (const p of PARTNER_PORTAL_CHOICES) {
      expect(defaultPurpose(p.label, p.role).length).toBeGreaterThanOrEqual(10);
    }
  });

  it("the invite email is validated before anything sends", () => {
    expect(isValidEmail("jordan@partner.com.au")).toBe(true);
    expect(isValidEmail("  jordan@partner.com.au  ")).toBe(true);
    for (const bad of ["", "jordan", "jordan@", "@partner.com", "a b@c.d"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it("the portal's own org vocabulary follows the chosen kind", () => {
    expect(builderOrgType("developer")).toBe("developer");
    expect(builderOrgType("builder")).toBe("builder");
    expect(builderOrgType("builder_developer")).toBe("builder_developer");
  });
});

describe("grant readiness — blockers named, unknown never a pass", () => {
  it("no attestation blocks, and says why", () => {
    const r = grantReadiness({ attestationVersion: null, sharingConsent: true });
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toContain("Issue the attestation first");
  });

  it("a known-missing sharing consent blocks with the client's own step named", () => {
    const r = grantReadiness({ attestationVersion: 1, sharingConsent: false });
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toContain("sharing consent");
  });

  it("an UNKNOWN consent reading is a caution — never treated as accepted", () => {
    const r = grantReadiness({ attestationVersion: 1, sharingConsent: null });
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.cautions.join(" ")).toContain("could not be read");
    expect(r.cautions.join(" ")).toContain("server will still enforce");
  });

  it("everything present: ready with nothing to say", () => {
    const r = grantReadiness({ attestationVersion: 2, sharingConsent: true });
    expect(r).toEqual({ ready: true, blockers: [], cautions: [] });
  });
});

describe("wired at the source", () => {
  const wizard = readFileSync("src/components/aml/PartnerOnboardingWizard.tsx", "utf8");
  const section = readFileSync("src/components/aml/ReliancePassportSection.tsx", "utf8");

  it("the reliance panel mounts the wizard as the grant row's paved road", () => {
    expect(section).toContain("PartnerOnboardingWizard");
    expect(section).toContain("Onboard partner");
  });

  it("NOBODY types an arrangement any more — the step is gone from the wizard", () => {
    // A portal partner's arrangement is the prebuilt agreement their sign-up
    // executes; a partner outside the portals accepts the same agreement by
    // email, and that acceptance records it. Neither asks the operator to
    // type an instrument on the partner's behalf.
    expect(wizard).toContain('const stepOrder: WizardStep[] = ["partner", "link", "grant"]');
    expect(wizard).toContain("portalHasPrebuiltAgreement(portal)");
    expect(wizard).toContain("prebuiltArrangementDraft(");
    expect(wizard).toContain("if (!agreement && !directAck)");
    // The manual arrangement fields no longer exist anywhere in the wizard.
    expect(wizard).not.toContain("Written agreement reference");
    expect(wizard).not.toContain("existingAgreementId");
  });

  it("the wizard chains the four EXISTING server acts — it invents no operation", () => {
    for (const call of [
      "amlRelianceApi.upsertPartnerOrganisation(",
      "amlRelianceApi.createAgreement(",
      "amlRelianceApi.linkPartnerToCase(",
      "amlRelianceApi.grantAccess(",
    ]) {
      expect(wizard).toContain(call);
    }
  });

  it("a retry resumes instead of duplicating — created records are cached per step", () => {
    expect(wizard).toContain("setCreatedOrgId");
    expect(wizard).toContain("setCreatedAgreement");
    expect(wizard).toContain("setLinkRecorded");
    // An already-existing link is accepted, not treated as a failure.
    expect(wizard).toMatch(/already exists/i);
  });

  it("the grant is DELIVERED — the omitted argument that emailed nobody", () => {
    /* `grant_access` emails the link only when it is given a `deliver_to`,
       and the wizard called it without one. Nothing failed: the grant was
       minted, the register was correct, `delivered_to_email` was null, and
       the partner was told nothing at all. The address is the one the portal
       invite went to, so the Passport and the account it is read alongside
       reach the same person. */
    expect(wizard).toContain("deliver_to: deliverTo");
    expect(wizard).toContain("const deliverTo = (chosenContact?.email ?? contactEmail)");
    expect(wizard).not.toMatch(/grantAccess\(caseId, agreement\.id\)/);
    // Delivery is stated before the click, and reported after it.
    expect(wizard).toContain("Passport link:");
    expect(wizard).toContain("link_email_sent");
  });

  it("the LINK is the only credential handed over — the raw token is GONE", () => {
    // The link, as a real value in a read-only field — not a placeholder.
    expect(wizard).toContain("id=\"pow-passport-link\"");
    expect(wizard).toContain("value={grantResult.link}");
    expect(wizard).toMatch(/shown once/i);
    /* The token and the `/passport/<token>` link are ONE credential — the
       link is that token with a URL around it — and the only consumer in
       this platform is the public page, which reads it back out of the URL.
       Showing it a second time doubled the places a live credential was
       copied and invited an operator to send "the code" instead of the link,
       which is a defect this product has already had. */
    expect(wizard).not.toMatch(/access token/i);
    expect(wizard).not.toContain("grantResult.token");
    expect(wizard).not.toContain("copyToken");
    expect(wizard).toMatch(/no prior\s+sign-up is needed/i);
    // What the partner receives is procedures, never the risk assessment.
    expect(wizard).toMatch(/never this case(?:'|&apos;)s risk assessment/);
  });

  it("the wizard ENROLS the partner for their own portal's compliance page", () => {
    /* `portal session → membership → canonical organisation` was broken at
       both ends in production: zero membership rows, and the organisation
       cross-reference columns written by nothing, ever. One operation does
       both, because fixing either alone turns one refusal into another. */
    expect(wizard).toContain("amlRelianceApi.enrolPartnerPortalAccess(");
    expect(wizard).toContain("PORTAL_USER_SOURCE[portal]");
    // Active immediately — an `invited` state nothing promotes is one more
    // way to be silently locked out of the page.
    expect(wizard).toMatch(/status:\s*"active"/);
    // And it never blocks the grant: enrolment is awaited before the grant
    // but swallows its own failure into a reported outcome.
    expect(wizard).toContain("setPortalAccess({ state: \"failed\"");
  });

  it("every registry is read SERVER-side — a browser read of finance contacts returns nothing", () => {
    // `finance_agent_contacts` grants no privilege to anon/authenticated,
    // so the browser read returned a permission error that the old
    // `.catch(() => [])` rendered as an empty list: five active finance
    // contacts existed and none was ever offered. Every portal now reads
    // through its own admin function (service role).
    expect(wizard).toContain('"finance-portal-admin", { operation: "list_users" }');
    expect(wizard).toContain('"solicitor-portal-admin", { operation: "list_users" }');
    expect(wizard).toContain('"builder-portal-admin", { operation: "list_users" }');
    expect(wizard).not.toMatch(/supabase\s*\n?\s*\.from\(/);
    expect(wizard).not.toContain('@/integrations/supabase/client');
    // Someone who already holds access is reported, never re-invited.
    expect(wizard).toContain('{ state: "already", email }');
  });

  it("a failed registry read is never rendered as 'no partners'", () => {
    expect(wizard).toContain("setContactsError(");
    expect(wizard).toContain("Existing partners could not be read");
    // And an empty registry says what to do next rather than nothing.
    expect(wizard).toMatch(/has been recorded yet — enter the contact below/);
  });

  it("the dialog owns its own scrolling, so the footer is reachable at any height", () => {
    // The shared dialog turns overflow VISIBLE at ≥sm; a tall pass ran
    // off the bottom with the Continue button at the very edge.
    expect(wizard).toContain("sm:overflow-hidden");
    expect(wizard).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(wizard).toMatch(/DialogFooter className="shrink-0/);
  });

  it("the invite goes through each portal's existing pipeline — no parallel email path", () => {
    expect(wizard).toContain('"finance-portal-invite"');
    expect(wizard).toContain('"builder-portal-invite"');
    expect(wizard).toContain('"solicitor-portal-invite"');
    // Builder provisioning is the full chain the portal requires: an
    // organisation, its activation, the user and a membership — the invite
    // function refuses a user with no membership.
    for (const op of ['"upsert_organisation"', '"set_organisation_status"', '"create_user"', '"upsert_membership"']
      .map((s) => `operation: ${s}`)) {
      expect(wizard).toContain(op);
    }
  });

  it("a failed invite never blocks the grant, and only the invite is retried", () => {
    // The one-time token must not be lost to a bounced email — the grant
    // proceeds, the outcome is reported, and the retry re-runs the invite
    // alone (the grant is done and stays done).
    expect(wizard).toMatch(/failure never blocks the\s+\* grant|failure is reported and retryable, never fatal/);
    expect(wizard).toContain("The grant succeeded, but the portal invite");
    expect(wizard).toContain("Retry portal invite");
    expect(wizard).toContain("const retryInvite");
  });

  it("a portal partner needs a deliverable contact — validated before the pass starts", () => {
    expect(wizard).toContain("isValidEmail(contactEmail)");
    expect(wizard).toContain("Who receives portal access?");
  });

  it("consent is read from the case's own record and an unreadable answer stays unknown", () => {
    expect(wizard).toContain("amlCasesApi.consentStatus(");
    expect(wizard).toContain('d.code === "compliance_sharing"');
    expect(wizard).toMatch(/setSharingConsent\(null\)/);
  });
});
