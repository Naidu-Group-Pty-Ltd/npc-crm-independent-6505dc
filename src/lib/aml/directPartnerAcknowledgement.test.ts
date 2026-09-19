import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { describeAcknowledgement } from "./partnerOnboarding.pure";
import { PORTAL_TERMS_ACKNOWLEDGEMENTS } from "@/lib/portalAgreement";

/**
 * The DIRECT partner acknowledgement — a partner outside the portals accepts
 * the AML/CTF Compliance Passport Agreement through a one-time emailed link.
 *
 * Pinned here: the acceptance is what creates the arrangement (so the passport
 * gate is an existing rule, not a new one); a link is answered once; the
 * agreement text and its mandatory acknowledgements are the SAME ones the
 * portals use; and a lapsed link is re-issuable to any address.
 */

const relianceFn = readFileSync("supabase/functions/aml-reliance/index.ts", "utf8");
const shared = readFileSync("supabase/functions/_shared/aml/directAcknowledgement.ts", "utf8");
const serverAgreement = readFileSync("supabase/functions/_shared/portalAgreement.ts", "utf8");
const page = readFileSync("src/pages/PartnerAcknowledgement.tsx", "utf8");
const wizard = readFileSync("src/components/aml/PartnerOnboardingWizard.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20261001000000_aml_direct_partner_acknowledgements.sql", "utf8");

describe("the acceptance IS the arrangement", () => {
  it("accepting writes the reliance_agreements row the passport already requires", () => {
    // `grant_access` refuses without an active arrangement whose review is
    // current. Creating that row only on acceptance is what makes "no
    // acknowledgement, no passport" true without a second rule to keep in step.
    const accept = relianceFn.slice(relianceFn.indexOf('/* ── acceptance ─'));
    expect(accept).toContain('.from("reliance_agreements").insert(');
    expect(accept).toContain("arrangementDraftFromAcceptance");
    expect(accept).toContain("agreement_id: agreement.id");
  });

  it("the arrangement is executed on the day the PARTNER accepted", () => {
    // Not the day an operator set the request up — that is not when the
    // instrument was entered into.
    expect(shared).toContain("export function arrangementDraftFromAcceptance");
    expect(shared).toMatch(/acknowledged directly by the partner/);
  });

  it("the wizard records no arrangement for a direct partner — it only sends", () => {
    expect(wizard).toContain("if (!agreement && !directAck)");
    expect(wizard).toContain("amlRelianceApi.sendPartnerAcknowledgement(");
    // The pass ends at sending; the passport is granted later.
    expect(wizard).toContain('setStep("ack_sent")');
  });
});

describe("a link is answered once, and only while it is live", () => {
  it("every terminal state refuses a second outcome", () => {
    const guard = relianceFn.slice(relianceFn.indexOf('if (op === "ack_view"'));
    expect(guard).toContain("if (!isAckLive(status, ack.expires_at))");
    expect(guard).toContain("This agreement has already been accepted.");
  });

  it("a lapsed link is STAMPED expired when read, not left looking outstanding", () => {
    const guard = relianceFn.slice(relianceFn.indexOf('if (op === "ack_view"'));
    expect(guard).toMatch(/status: "expired"/);
  });

  it("the token never rests in plaintext", () => {
    expect(shared).toContain("crypto.subtle.digest(\"SHA-256\"");
    expect(relianceFn).toContain("token_hash: await hashAckToken(token)");
    // The staff listing cannot reconstruct a link.
    const listing = relianceFn.slice(relianceFn.indexOf('case "list_partner_acknowledgements"'));
    expect(listing.slice(0, 800)).not.toContain("token_hash");
  });

  it("only one request per partner per case can be live", () => {
    expect(migration).toContain("dpa_one_live_request");
    expect(migration).toMatch(/WHERE status IN \('sent','viewed'\)/);
  });
});

describe("re-issue: the partner is never stranded", () => {
  it("re-sending supersedes the live request, so the old link stops working", () => {
    const send = relianceFn.slice(relianceFn.indexOf('case "send_partner_acknowledgement"'));
    expect(send).toContain('status: "superseded"');
    expect(send).toContain("superseded_by_id: created.id");
    expect(send).toContain("resend_count");
  });

  it("the predecessor is stood down BEFORE the replacement is written", () => {
    // `dpa_one_live_request` permits one live request per partner per case.
    // Inserting first collided with it, so every re-send against a live
    // request answered 23505 — surfaced to the operator as "Internal error".
    // The order here is the opposite of the grant re-issue's, and
    // deliberately so: the index forbids the overlap.
    const send = relianceFn.slice(
      relianceFn.indexOf('case "send_partner_acknowledgement"'),
      relianceFn.indexOf('case "list_partner_case_links"'));
    const standDown = send.indexOf('status: "superseded"');
    const insert = send.indexOf('.from("direct_partner_acknowledgements").insert(');
    expect(standDown).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(standDown).toBeLessThan(insert);
  });

  it("a failed replacement restores the predecessor, never stranding the partner", () => {
    const send = relianceFn.slice(
      relianceFn.indexOf('case "send_partner_acknowledgement"'),
      relianceFn.indexOf('case "list_partner_case_links"'));
    expect(send).toContain("if (insertError) {");
    expect(send).toContain("status: live.status");
    // And a genuine collision is a conflict, not an internal error.
    expect(send).toContain('code: "concurrent_request"');
    expect(send).toMatch(/23505/);
  });

  it("expired and declined are re-sendable; superseded and accepted are not", () => {
    const future = new Date(Date.now() + 864e5).toISOString();
    const past = new Date(Date.now() - 864e5).toISOString();
    expect(describeAcknowledgement("sent", past).canResend).toBe(true);
    expect(describeAcknowledgement("declined", future).canResend).toBe(true);
    expect(describeAcknowledgement("accepted", future).canResend).toBe(false);
    expect(describeAcknowledgement("superseded", future).canResend).toBe(false);
  });

  it("only an ACCEPTED acknowledgement opens the passport gate", () => {
    const future = new Date(Date.now() + 864e5).toISOString();
    for (const state of ["sent", "viewed", "declined", "expired", "superseded"]) {
      expect(describeAcknowledgement(state, future).gateOpen, state).toBe(false);
    }
    expect(describeAcknowledgement("accepted", future).gateOpen).toBe(true);
  });

  it("a live link that has passed its expiry reads as expired, never as outstanding", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(describeAcknowledgement("sent", past).state).toBe("expired");
    expect(describeAcknowledgement("viewed", null).state).toBe("expired");
  });

  it("a failed email returns the link so it can be delivered by hand", () => {
    const send = relianceFn.slice(relianceFn.indexOf('case "send_partner_acknowledgement"'));
    expect(send).toContain("email_error: emailError");
    expect(send).toContain("link,");
  });
});

describe("one instrument, presented one way", () => {
  it("the public page mounts the SAME consent component the portals use", () => {
    expect(page).toContain("PortalAgreementConsent");
    // It must not restate the agreement or the acknowledgements itself.
    expect(page).not.toContain("section 37A");
  });

  it("the server enforces the SAME mandatory acknowledgements as portal sign-up", () => {
    const accept = relianceFn.slice(relianceFn.indexOf('/* ── acceptance ─'));
    expect(accept).toContain("readAcknowledgements(");
    expect(accept).toContain("ACKNOWLEDGEMENTS_INCOMPLETE_ERROR");
    expect(serverAgreement).toContain("'binding_amlctf_arrangement'");
  });

  it("the two sides of the acknowledgement list agree, key for key", () => {
    // The browser renders this list and the server requires it. This feature
    // makes that parity load-bearing for a legal instrument, so it is pinned:
    // a key added on one side only would take an acceptance that asserts
    // something the other side never asked for.
    const required = serverAgreement
      .slice(serverAgreement.indexOf("export const REQUIRED_TERMS_ACKNOWLEDGEMENTS"))
      .slice(0, 400);
    for (const item of PORTAL_TERMS_ACKNOWLEDGEMENTS) {
      expect(required, item.key).toContain(`'${item.key}'`);
    }
    expect(PORTAL_TERMS_ACKNOWLEDGEMENTS).toHaveLength(4);
  });

  it("the customer is never shown — the partner has been granted nothing yet", () => {
    const publicOps = relianceFn.slice(
      relianceFn.indexOf('if (op === "ack_view"'),
      relianceFn.indexOf("/* ── partner ops: bearer token"));
    for (const leak of ["subject_display_name", "case_reference", "risk_rating", "client_id"]) {
      expect(publicOps, leak).not.toContain(leak);
    }
  });
});

describe("wired, and gated", () => {
  it("the public route exists and is token-addressed", () => {
    expect(app).toContain('path="/partner-acknowledgement/:token"');
    expect(relianceFn).toContain('acknowledgementLinkFor');
  });

  it("sending an agreement for execution is MLRO-only", () => {
    const send = relianceFn.slice(relianceFn.indexOf('case "send_partner_acknowledgement"'));
    expect(send.slice(0, 400)).toContain("if (!isMlro)");
  });

  it("the acceptance evidence is required by the COLUMN, not only by code", () => {
    expect(migration).toContain("dpa_accepted_is_evidenced");
    expect(migration).toMatch(/accepted_by_name IS NOT NULL/);
    expect(migration).toMatch(/jsonb_array_length\(acknowledgements\) > 0/);
  });

  it("the portal acceptance store is untouched — no DDL, no writes", () => {
    // `portal_terms_acceptances` cannot take a non-portal party without
    // altering three constraints that guard every executed portal agreement.
    // That is exactly why this table exists instead. The migration NAMES it
    // (in the comment explaining why), but must never act on it.
    expect(migration).toContain("aml.direct_partner_acknowledgements");
    expect(migration).not.toMatch(/ALTER TABLE\s+(public\.)?portal_terms_acceptances/i);
    expect(migration).not.toMatch(/INSERT INTO\s+(public\.)?portal_terms_acceptances/i);
    expect(migration).not.toMatch(/DROP\s+CONSTRAINT[\s\S]{0,80}portal_terms_acceptances/i);
  });

  it("the direct terms row is a WIDENING, and copies the text rather than retyping it", () => {
    // Every reader of portal_terms_versions filters by its own portal or
    // reads by id, so adding 'direct' is invisible to them — and the content
    // is copied so the direct partner provably reads the same words.
    const termsMigration = readFileSync(
      "supabase/migrations/20261001000100_portal_terms_direct_channel.sql", "utf8");
    expect(termsMigration).toMatch(/'solicitor'::text, 'builder'::text, 'finance'::text, 'direct'::text/);
    expect(termsMigration).toContain("SELECT");
    expect(termsMigration).toContain("src.content_markdown");
    // It names the acceptance store only to say it stays as it is.
    expect(termsMigration).not.toMatch(/ALTER TABLE\s+(public\.)?portal_terms_acceptances/i);
    expect(termsMigration).toMatch(/portal_terms_acceptances`? is untouched/i);
  });
});
