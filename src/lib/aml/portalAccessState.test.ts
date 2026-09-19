/**
 * Portal access, read against the states production actually holds.
 *
 * Every fixture below is transcribed from `client_portal_users` and
 * `aml.cases` on the deployment this was built for. That matters: the
 * interesting states here are not hypothetical edge cases, they are the
 * eight rows that exist.
 */
import { describe, expect, it } from "vitest";

import {
  deriveAmlPortalAccess,
  portalAccessIsNextAction,
  type AmlPortalAccessFacts,
} from "./portalAccessState";

const facts = (over: Partial<AmlPortalAccessFacts>): AmlPortalAccessFacts => ({
  exists: true,
  status: "active",
  email: "client@example.test",
  ...over,
});

describe("a read that did not happen is never 'not invited'", () => {
  it("reports unavailable for null facts", () => {
    const r = deriveAmlPortalAccess(null);
    expect(r.code).toBe("unavailable");
    // Offering to issue access on an unknown state is how a second account
    // gets created for a client who already has one.
    expect(r.action).toBe("none");
    expect(r.blocking).toBe(false);
  });

  it("reports unavailable for undefined too", () => {
    expect(deriveAmlPortalAccess(undefined).code).toBe("unavailable");
  });
});

describe("no account yet", () => {
  it("is the blocking state, and offers to issue access", () => {
    // AML-2026-00005: activated, notification written to /client/aml at
    // 15:41, and no `client_portal_users` row at all.
    const r = deriveAmlPortalAccess(facts({ exists: false }));
    expect(r.code).toBe("not_issued");
    expect(r.label).toBe("Not invited");
    expect(r.action).toBe("issue");
    expect(r.blocking).toBe(true);
    expect(r.canSignIn).toBe(false);
    expect(portalAccessIsNextAction(r)).toBe(true);
  });

  it("says so plainly when the client has no email to send to", () => {
    // AML-2026-00001's client has no email on the record. Offering "Issue
    // portal access" there would fail at the point of sending, after the
    // operator had committed to it.
    for (const email of [null, "   "]) {
      const r = deriveAmlPortalAccess(facts({ exists: false, email }));
      expect(r.code).toBe("no_email");
      expect(r.action).toBe("none");
      expect(r.actionLabel).toBeNull();
      // Still blocking — the client cannot get in — but not actionable here.
      expect(r.blocking).toBe(true);
      expect(portalAccessIsNextAction(r)).toBe(false);
      expect(r.detail).toMatch(/add one to the client record/i);
    }
  });

  it("does not claim 'no email' when the email was simply never read", () => {
    // Refusing an invitation that would have worked is worse than offering
    // one the server then declines with a clear message.
    const r = deriveAmlPortalAccess({ exists: false });
    expect(r.code).toBe("not_issued");
    expect(r.action).toBe("issue");
  });
});

describe("invited", () => {
  it("waits on the client rather than blocking", () => {
    const r = deriveAmlPortalAccess(facts({ status: "invited", invitePending: true }));
    expect(r.code).toBe("invited");
    expect(r.label).toBe("Invitation sent");
    // The ball is with the client; chasing them is meaningful, so this is
    // not what stands in the way.
    expect(r.blocking).toBe(false);
    expect(r.action).toBe("resend");
    expect(r.canSignIn).toBe(false);
  });

  it("blocks once the invitation has expired", () => {
    // The one invited row in production expired after two days, in March,
    // and has sat unusable ever since.
    const r = deriveAmlPortalAccess(facts({
      status: "invited", inviteExpired: true,
      inviteExpiresAt: "2026-03-18T02:02:17Z",
    }));
    expect(r.code).toBe("invitation_expired");
    expect(r.blocking).toBe(true);
    expect(r.action).toBe("resend");
    expect(portalAccessIsNextAction(r)).toBe(true);
  });
});

describe("active", () => {
  it("does not mistake 'active' for 'has signed in'", () => {
    // Four production rows are `active` with a null `last_login_at`.
    const r = deriveAmlPortalAccess(facts({ lastLoginAt: null }));
    expect(r.code).toBe("issued_not_signed_in");
    expect(r.label).toBe("Access issued");
    expect(r.canSignIn).toBe(true);
    expect(r.blocking).toBe(false);
  });

  it("never offers a re-issue on a live account, because re-issuing destroys it", () => {
    // `resend_invite` on an ACTIVE account downgrades it to `invited` and
    // resets has_accepted_terms / has_completed_onboarding / terms_accepted_at.
    // That is a deliberate act for the client record's own Portal Access
    // dialog, not a convenience beside a compliance case.
    for (const f of [
      facts({ lastLoginAt: null }),
      facts({ lastLoginAt: "2026-08-15T05:52:39Z", hasAcceptedTerms: false }),
      facts({ lastLoginAt: "2026-08-15T05:52:39Z", hasAcceptedTerms: true }),
    ]) {
      const r = deriveAmlPortalAccess(f);
      expect(r.canSignIn).toBe(true);
      expect(r.action).toBe("none");
    }
  });

  it("separates signed-in-but-unacknowledged from fully active", () => {
    const pending = deriveAmlPortalAccess(facts({
      lastLoginAt: "2026-08-15T05:52:39Z", hasAcceptedTerms: false,
    }));
    expect(pending.code).toBe("signed_in_terms_pending");
    expect(pending.action).toBe("none");
    expect(pending.detail).toMatch(/accepted the portal terms/i);
    expect(pending.canSignIn).toBe(true);

    // AML-2026-00004's client: signed in 15 Aug, terms accepted. The case
    // still reads `client_portal_status = not_started`, and both are true —
    // they answer different questions.
    const active = deriveAmlPortalAccess(facts({
      lastLoginAt: "2026-08-15T05:52:39Z", hasAcceptedTerms: true,
    }));
    expect(active.code).toBe("active");
    expect(active.label).toBe("Portal active");
    expect(active.action).toBe("none");
    expect(active.blocking).toBe(false);
  });
});

describe("disabled", () => {
  it("offers restoration rather than a second account", () => {
    const r = deriveAmlPortalAccess(facts({ status: "disabled" }));
    expect(r.code).toBe("disabled");
    expect(r.action).toBe("resend");
    expect(r.actionLabel).toMatch(/restore/i);
    expect(r.canSignIn).toBe(false);
    expect(r.blocking).toBe(true);
  });
});

describe("every reading is usable by the surface that renders it", () => {
  const cases: Array<AmlPortalAccessFacts | null> = [
    null,
    facts({ exists: false }),
    facts({ exists: false, email: null }),
    facts({ status: "invited", invitePending: true }),
    facts({ status: "invited", inviteExpired: true }),
    facts({ lastLoginAt: null }),
    facts({ lastLoginAt: "2026-08-15T05:52:39Z", hasAcceptedTerms: false }),
    facts({ lastLoginAt: "2026-08-15T05:52:39Z", hasAcceptedTerms: true }),
    facts({ status: "disabled" }),
  ];

  it("always has a label and a sentence, and an action label iff there is an action", () => {
    for (const f of cases) {
      const r = deriveAmlPortalAccess(f);
      expect(r.label).toBeTruthy();
      expect(r.detail).toBeTruthy();
      expect(r.action === "none" ? r.actionLabel === null : Boolean(r.actionLabel)).toBe(true);
    }
  });

  it("never offers an action on a state it could not read", () => {
    expect(deriveAmlPortalAccess(null).action).toBe("none");
  });

  it("only promotes to next action when the client genuinely cannot get in", () => {
    const promoted = cases
      .map((f) => deriveAmlPortalAccess(f))
      .filter(portalAccessIsNextAction)
      .map((r) => r.code);
    expect(promoted.sort()).toEqual(["disabled", "invitation_expired", "not_issued"]);
  });
});
