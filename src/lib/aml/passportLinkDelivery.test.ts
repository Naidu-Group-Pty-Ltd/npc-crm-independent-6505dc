import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { grantStanding } from "./partnerOnboarding.pure";

/**
 * Passport delivery by link, and the 90-day re-issue loop.
 *
 * Pinned here: the token is minted once and never re-read, so a re-issue is
 * a NEW grant that re-runs every precondition; only an EXPIRY may be renewed
 * by the partner themselves; the page discloses exactly what the server
 * disclosed and leads with the responsibility notice; and the independent
 * assessment stays available at the partner's prerogative.
 */

const reliance = readFileSync("supabase/functions/aml-reliance/index.ts", "utf8");
const shared = readFileSync("supabase/functions/_shared/aml/directAcknowledgement.ts", "utf8");
const page = readFileSync("src/pages/PublicPassport.tsx", "utf8");
const panel = readFileSync("src/components/aml/ReliancePassportSection.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20261002000000_reliance_grant_link_delivery.sql", "utf8");

describe("a re-issue is a new grant, never a re-read link", () => {
  it("the link is emailed at MINT TIME, the only moment it exists", () => {
    const grantOp = reliance.slice(reliance.indexOf('case "grant_access"'));
    expect(grantOp).toContain("passportLinkFor(rawToken)");
    expect(grantOp).toContain("deliver_to");
    // Only the hash is ever stored.
    expect(grantOp).toContain("access_token_hash: await sha256Hex(rawToken)");
  });

  it("re-issuing runs the SAME preconditions — it is the same operation", () => {
    // Implemented inside grant_access rather than as a second op, so the
    // arrangement, consent and attestation checks cannot be skipped.
    const grantOp = reliance.slice(reliance.indexOf('case "grant_access"'));
    expect(grantOp).toContain('const reissueOf = String(body.reissue_of ?? "")');
    expect(grantOp).toContain('revoke_reason: "superseded_by_reissue"');
  });

  it("the predecessor is revoked only AFTER the replacement exists", () => {
    const grantOp = reliance.slice(reliance.indexOf('case "grant_access"'));
    const mintIndex = grantOp.indexOf("const rawToken");
    const revokeIndex = grantOp.indexOf('revoke_reason: "superseded_by_reissue"');
    expect(mintIndex).toBeGreaterThan(-1);
    expect(revokeIndex).toBeGreaterThan(mintIndex);
  });

  it("the link comes back even when the email fails, so it is never lost", () => {
    const grantOp = reliance.slice(reliance.indexOf('case "grant_access"'));
    expect(grantOp).toContain("passport_link: passportLink");
    expect(grantOp).toContain("link_email_error: linkEmailError");
    /* And the workspace never loses it to a mail outage: the link goes to
       `PassportIssuedDialog` on EVERY send, delivered or not, and a refused
       email is said out loud rather than left to be inferred from silence. */
    expect(panel).toContain("passportLink: res.passport_link ?? res.access_token");
    expect(panel).toContain("The Passport was issued, but the email did not send");
  });

  it("the workspace has ONE send path, and it carries the link as a value", () => {
    /* There used to be two: `issuePassportTo`, which handed the link to a
       dialog, and `reissueGrant`, which passed it as a prompt field's
       PLACEHOLDER — unselectable, uncopyable and absent from the DOM. The
       placeholder defect was reported and fixed on the first path and
       survived on the second, because there were two. There is now one
       (`sendPassport`), and a re-issue is that same act with `reissue_of`. */
    expect(panel).toContain("const sendPassport = async (row: RecipientRow)");
    expect(panel).not.toContain("const reissueGrant");
    // Never again: a one-time credential shown only as placeholder text.
    expect(panel).not.toMatch(/placeholder:\s*res\.passport_link/);
    expect(panel).not.toMatch(/placeholder:\s*res\.access_token/);
    // Delivery is part of the act rather than an optional extra.
    expect(panel).toContain("deliver_to: deliverTo");
  });

  it("delivery columns are additive — every existing insert keeps working", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS delivered_to_email");
    expect(migration).not.toMatch(/ALTER COLUMN|DROP COLUMN|SET NOT NULL/);
  });
});

describe("only an expiry may be self-renewed", () => {
  it("the server offers a replacement for an expiry and refuses everything else", () => {
    expect(shared).toContain("export function mayRequestReplacementLink");
    // Bounded to the op's OWN block — an unbounded slice would run on into
    // grant_access and see its minting.
    const op = reliance.slice(
      reliance.indexOf('if (op === "request_passport_link")'),
      reliance.indexOf('if (op === "redeem_attestation"'));
    expect(op).toContain("mayRequestReplacementLink(resolved.denied)");
    // Requesting mints nothing — it is a counter and a notification.
    expect(op).not.toContain("mintAckToken");
    expect(op).not.toContain("access_token_hash");
    expect(op).toContain("notifyCommandCentre");
  });

  it("a revoked grant is never offered renewal, on either side", () => {
    // Revocation is a safety action; inviting its subject to undo it would
    // defeat the act it was taken for.
    expect(shared).toMatch(/return denied === "expired";/);
    expect(page).toContain('const expired = error?.code === "expired"');
    expect(page).toContain("{expired && !requested && (");
  });
});

describe("what the workspace says about a grant", () => {
  const at = (days: number) => new Date(Date.now() + days * 864e5).toISOString();

  it("a live grant reads live and stays re-issuable", () => {
    const r = grantStanding({ expiresAt: at(60), revokedAt: null, revokeReason: null });
    expect(r.state).toBe("live");
    expect(r.canReissue).toBe(true);
  });

  it("an approaching expiry warns BEFORE it lapses", () => {
    const r = grantStanding({ expiresAt: at(5), revokedAt: null, revokeReason: null });
    expect(r.state).toBe("expiring");
    expect(r.detail).toMatch(/Expires in 5 days/);
  });

  it("an expired grant names the partner's own request when there is one", () => {
    const plain = grantStanding({ expiresAt: at(-1), revokedAt: null, revokeReason: null });
    expect(plain.state).toBe("expired");
    expect(plain.canReissue).toBe(true);
    const asked = grantStanding({
      expiresAt: at(-1), revokedAt: null, revokeReason: null, linkRequestedAt: at(-0.5),
    });
    expect(asked.detail).toMatch(/asked for a new link/);
  });

  it("a REVOKED grant is not re-issuable from the list", () => {
    const r = grantStanding({
      expiresAt: at(30), revokedAt: at(-1), revokeReason: "partner terminated",
    });
    expect(r.state).toBe("revoked");
    expect(r.canReissue).toBe(false);
    expect(r.detail).toMatch(/fresh decision/);
  });

  it("a grant replaced by a re-issue reads as replaced, not as withdrawn", () => {
    const r = grantStanding({
      expiresAt: at(30), revokedAt: at(-1), revokeReason: "superseded_by_reissue",
    });
    expect(r.state).toBe("reissued");
    expect(r.canReissue).toBe(false);
    expect(r.detail).not.toMatch(/revoked/i);
  });
});

describe("the passport page discloses nothing of its own", () => {
  it("it renders the server's own projection and never filters or relabels it", () => {
    expect(page).toContain("passportPublicApi.redeem(token)");
    // The page used to print the payload. It now renders the DOCUMENT the
    // server built — the same `PassportView` the Command Centre renders,
    // through the same composer — so the boundary is decided by the
    // audience-safe assembler and never by this page.
    expect(page).toContain("buildBooklet(data.passport as PassportView)");
    // It must not carry its own idea of what may be shown.
    expect(page).not.toMatch(/risk_rating|screening_match|reviewer_note/);
  });

  it("the responsibility notice leads, from the SERVER's own wording", () => {
    expect(page).toContain("{data.notice}");
    const redeem = reliance.slice(reliance.indexOf('if (op === "redeem_attestation")'));
    expect(redeem).toMatch(/remains responsible for its own AML\/CTF compliance/);
  });

  it("the independent assessment is offered, and says it moves nothing here", () => {
    expect(page).toContain("recordIndependentAssessment");
    expect(page).toMatch(/never alters the issuing organisation/);
    expect(page).toMatch(/Safe practice is to satisfy yourself independently/);
  });

  it("the route is public and token-addressed", () => {
    expect(app).toContain('path="/passport/:token"');
    expect(shared).toContain("export function passportLinkFor");
  });
});
