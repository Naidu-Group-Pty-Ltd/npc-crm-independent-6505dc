import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DIRECT_TERMS_ACKNOWLEDGEMENTS, PORTAL_TERMS_ACKNOWLEDGEMENTS,
} from "@/lib/portalAgreement";

/**
 * The agreement a partner OUTSIDE the portals is asked to accept.
 *
 * They are never given a portal account — they receive one time-limited link
 * to a Compliance Passport. Pinned here: the text describes that and not a
 * Portal; every AML/CTF provision survives the rewrite intact; the four
 * acknowledgment KEYS are unchanged so no portal and no stored acceptance is
 * touched; and the executed copy prints the words the person actually read.
 */

const migration = readFileSync(
  "supabase/migrations/20261004000000_direct_passport_link_agreement.sql", "utf8");
const body = migration.split("$md$")[1];
const serverAgreement = readFileSync("supabase/functions/_shared/portalAgreement.ts", "utf8");
const records = readFileSync("supabase/functions/partner-agreement-records/index.ts", "utf8");
const page = readFileSync("src/pages/PartnerAcknowledgement.tsx", "utf8");
const consent = readFileSync("src/components/portal/PortalAgreementConsent.tsx", "utf8");

describe("the text describes a link, not a portal", () => {
  it("no clause asks the partner to accept portal obligations", () => {
    // The only permitted mentions are the two that say a portal account is
    // NOT what is being given.
    const mentions = body.match(/[Pp]ortal/g) ?? [];
    expect(mentions.length).toBe(2);
    expect(body).toContain("is not given a portal account");
    expect(body).toContain("rather than a portal account");
  });

  it("it states the 90-day life of the link, and that it is re-issuable", () => {
    expect(body).toMatch(/ordinarily \*\*90 days\*\* from issue/);
    expect(body).toContain("a replacement link supersedes the previous one");
    expect(body).toContain("## 15. Expiry, re-issue and withdrawal of the Link");
  });

  it("it treats the link as the credential, with handling obligations to match", () => {
    expect(body).toContain("the link is itself the access credential");
    expect(body).toContain("treat the link with the same care as a password");
    expect(body).toContain("## 5. Handling the link, and incident management");
  });

  it("expiry of the link and currency of the arrangement are kept separate", () => {
    // Conflating them would let an expired link read as an ended s 37A
    // arrangement, or a live link as a current one. Neither is true.
    expect(body).toContain("The expiry of a Compliance Passport Link does not of itself end the section 37A arrangement");
  });
});

describe("every AML/CTF provision survives the rewrite", () => {
  it("the section 37A / Rule 6-29 conditions are carried across in full", () => {
    expect(body).toContain("section 37A of the Anti-Money Laundering and Counter-Terrorism Financing Act 2006");
    expect(body).toContain("section 6-29 of the Anti-Money Laundering and Counter-Terrorism Financing Rules 2025");
    // All ten reliance conditions.
    const clause = body.slice(body.indexOf("## 7. Binding customer"), body.indexOf("## 8."));
    for (let n = 1; n <= 10; n += 1) expect(clause, `condition ${n}`).toContain(`${n}. `);
  });

  it("the review regime and the section 37B record deadline are unchanged", () => {
    expect(body).toContain("not exceeding two years");
    expect(body).toContain("A written record of an assessment under section 37B must be prepared within 10 business days");
  });

  it("restricted information and tipping-off protections are unchanged", () => {
    expect(body).toContain("## 11. Restricted AML/CTF information");
    expect(body).toContain("unlawful tipping-off risk");
    expect(body).toContain("information revealing that a suspicious matter report has been or may be submitted");
  });

  it("reliance still transfers no responsibility, and independent CDD stays open", () => {
    expect(body).toContain("Reliance does not transfer the Partner Organisation's AML/CTF responsibility");
    expect(body).toMatch(/independent customer due diligence remains available at all times/);
  });

  it("every numbered section of the original survives", () => {
    for (let n = 1; n <= 17; n += 1) {
      expect(body, `section ${n}`).toMatch(new RegExp(`^## ${n}\\. `, "m"));
    }
    expect(body).toContain("## Global Confidentiality and Privacy Acknowledgment");
    expect(body).toContain("## Mandatory acknowledgments");
  });
});

describe("the keys are untouched; only the words change", () => {
  it("the direct statements carry exactly the portal keys, in the same order", () => {
    expect(DIRECT_TERMS_ACKNOWLEDGEMENTS.map((a) => a.key))
      .toEqual(PORTAL_TERMS_ACKNOWLEDGEMENTS.map((a) => a.key));
  });

  it("the first and third statements differ; the other two are identical", () => {
    const byKey = (list: readonly { key: string; statement: string }[], key: string) =>
      list.find((a) => a.key === key)!.statement;
    for (const key of ["global_confidentiality_privacy", "portal_access"]) {
      expect(byKey(DIRECT_TERMS_ACKNOWLEDGEMENTS, key), key)
        .not.toBe(byKey(PORTAL_TERMS_ACKNOWLEDGEMENTS, key));
    }
    for (const key of ["authority_binding_acceptance", "binding_amlctf_arrangement"]) {
      expect(byKey(DIRECT_TERMS_ACKNOWLEDGEMENTS, key), key)
        .toBe(byKey(PORTAL_TERMS_ACKNOWLEDGEMENTS, key));
    }
  });

  it("no direct statement mentions a Portal the partner does not have", () => {
    for (const item of DIRECT_TERMS_ACKNOWLEDGEMENTS) {
      // "portal account" is permitted — it is the denial.
      const stripped = item.statement.replace(/portal account/g, "");
      expect(stripped, item.key).not.toMatch(/[Pp]ortal/);
    }
  });

  it("the browser and server statements agree, statement for statement", () => {
    // The browser renders these and the executed PDF prints them. Drift
    // would mean the copy on file misquotes what the person assented to.
    for (const item of DIRECT_TERMS_ACKNOWLEDGEMENTS) {
      expect(serverAgreement, item.key).toContain(item.statement);
    }
    expect(serverAgreement).toContain("acknowledgementsForChannel");
  });

  it("the required-acknowledgment check is NOT changed by any of this", () => {
    const required = serverAgreement
      .slice(serverAgreement.indexOf("export const REQUIRED_TERMS_ACKNOWLEDGEMENTS"))
      .slice(0, 400);
    for (const item of PORTAL_TERMS_ACKNOWLEDGEMENTS) {
      expect(required, item.key).toContain(`'${item.key}'`);
    }
  });
});

describe("wired, and the portals untouched", () => {
  it("the executed copy prints the channel's own statements", () => {
    expect(records).toContain("acknowledgementsForChannel(String(record.portal))");
  });

  it("the page presents the link statements and the link title", () => {
    expect(page).toContain("DIRECT_TERMS_ACKNOWLEDGEMENTS");
    expect(page).toContain("DIRECT_AGREEMENT_ACCEPTANCE_NOTICE");
    expect(page).toContain("DIRECT_AGREEMENT_TITLE");
  });

  it("the shared component still defaults to the portal wording", () => {
    // All three portals pass nothing, so nothing about them changes.
    expect(consent).toContain("acknowledgements = PORTAL_TERMS_ACKNOWLEDGEMENTS");
    expect(consent).toContain("acceptanceNotice = PORTAL_AGREEMENT_ACCEPTANCE_NOTICE");
  });

  it("the previous direct version is retired, never edited", () => {
    // An executed acceptance must keep pointing at the exact text accepted.
    expect(migration).toContain("SET retired_at = now()");
    expect(migration).not.toMatch(/UPDATE public\.portal_terms_versions\s+SET content_markdown/);
  });

  it("the mark is constrained, so the agreement leads the page", () => {
    expect(page).toContain('logoClassName="h-10 w-auto object-contain sm:h-12"');
    // And the signer is asked where the act happens, not above the document.
    expect(page).toContain("beforeAccept={(");
  });
});
