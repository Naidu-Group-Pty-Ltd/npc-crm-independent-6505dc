/**
 * Whether the client can actually get into their portal — and what to do next.
 *
 * ── The gap this exists to close ──────────────────────────────────────
 * Activating a client writes a `client_portal_notifications` row deep-linking
 * `/client/aml`, and the case's `client_portal_status` starts at
 * `not_started`. Neither of those says whether the client has a LOGIN.
 *
 * Measured on this deployment: AML-2026-00005 was activated, the
 * notification was written at 15:41 — and there is no `client_portal_users`
 * row for that client at all. The notification is sitting in a portal they
 * cannot reach. The workspace said "The client has not started onboarding.
 * Send or chase the onboarding invitation" with no way to send one, and no
 * way to tell that there was nothing to chase.
 *
 * The repo already learned this once, on the other side of the house:
 * `docs/agreements/PARTNER_ACTIVATION.md` records that "a notification raised
 * before the portal user exists has nowhere to live".
 *
 * ── Two different questions, deliberately kept apart ──────────────────
 * `client_portal_status` on the case answers "how far has the client got
 * through their AML journey". THIS answers "can they log in at all". They
 * are not the same, and conflating them is how AML-2026-00004 — a client
 * with an active login who has signed in and accepted the portal terms —
 * reads as `not_started`. Both are true; they are answers to different
 * questions.
 *
 * ── This module decides nothing ───────────────────────────────────────
 * It is a pure reading of facts the SERVER supplies. It never issues access,
 * never infers that an account exists because a notification was written,
 * and returns `unavailable` rather than guessing when the read did not
 * happen. Whether access may be issued is the server's call; this only says
 * what the operator is looking at.
 */

/** The portal-account facts, exactly as the server reports them. */
export interface AmlPortalAccessFacts {
  /** No `client_portal_users` row exists for this client. */
  exists: boolean;
  /** `client_portal_users.status` — 'invited' | 'active' | 'disabled'. */
  status?: string | null;
  /** True when an invitation token is present AND still in date. */
  invitePending?: boolean;
  /** True when an invitation token is present but out of date. */
  inviteExpired?: boolean;
  inviteExpiresAt?: string | null;
  lastLoginAt?: string | null;
  /** Portal terms — NOT the AUSTRAC consent catalogue, which is separate. */
  hasAcceptedTerms?: boolean;
  /**
   * The address an invitation would be sent to.
   *
   * `undefined` means NOT KNOWN — the caller did not read it. `null` or an
   * empty string mean known-absent. The difference matters: one production
   * case (AML-2026-00001) genuinely has no email, and reporting that state
   * for a client whose email simply was not fetched would refuse an
   * invitation that would have worked.
   */
  email?: string | null;
}

export type AmlPortalAccessCode =
  | "unavailable"
  | "no_email"
  | "not_issued"
  | "invited"
  | "invitation_expired"
  | "issued_not_signed_in"
  | "signed_in_terms_pending"
  | "active"
  | "disabled";

/** What the Command Centre may do about it. */
export type AmlPortalAccessAction = "issue" | "resend" | "none";

export interface AmlPortalAccessReading {
  code: AmlPortalAccessCode;
  /** Short label for a badge. */
  label: string;
  /** One sentence an operator can act on. */
  detail: string;
  /** The offered action, or `none` when there is nothing sensible to do. */
  action: AmlPortalAccessAction;
  /** Label for that action's control. */
  actionLabel: string | null;
  /**
   * True when this is the thing standing between the client and their
   * onboarding — i.e. chasing them would be pointless because they cannot
   * get in.
   */
  blocking: boolean;
  /** True when the client holds a usable login right now. */
  canSignIn: boolean;
}

const reading = (r: AmlPortalAccessReading): AmlPortalAccessReading => r;

/**
 * Read the portal-access position.
 *
 * `facts === null` means the read did not happen (not permitted, failed, or
 * an older server). That is reported as `unavailable` and never as
 * "not issued" — offering to issue access on an unknown state is how a
 * second account gets created for a client who already has one.
 */
export function deriveAmlPortalAccess(
  facts: AmlPortalAccessFacts | null | undefined,
): AmlPortalAccessReading {
  if (!facts) {
    return reading({
      code: "unavailable",
      label: "Not available",
      detail: "The client's portal access could not be read.",
      action: "none",
      actionLabel: null,
      blocking: false,
      canSignIn: false,
    });
  }

  if (!facts.exists) {
    // No account. An invitation needs somewhere to go, and one production
    // case (AML-2026-00001) has no email on the client record at all — so
    // this is a real state, not a defensive branch.
    // Only when the caller actually knows there is no address. An unknown
    // email falls through to `not_issued`, and the server answers
    // "Client has no email address" if it turns out there isn't one.
    if (facts.email !== undefined && !facts.email?.trim()) {
      return reading({
        code: "no_email",
        label: "No email address",
        detail:
          "This client has no email address, so portal access cannot be sent. Add one to the client record first.",
        action: "none",
        actionLabel: null,
        blocking: true,
        canSignIn: false,
      });
    }
    return reading({
      code: "not_issued",
      label: "Not invited",
      detail:
        "The client has no portal login yet, so there is nothing for them to sign in to.",
      action: "issue",
      actionLabel: "Issue portal access",
      blocking: true,
      canSignIn: false,
    });
  }

  if (facts.status === "disabled") {
    return reading({
      code: "disabled",
      label: "Access disabled",
      detail:
        "This client's portal access has been disabled. Re-issuing will restore it.",
      action: "resend",
      actionLabel: "Restore portal access",
      blocking: true,
      canSignIn: false,
    });
  }

  if (facts.status === "invited") {
    if (facts.inviteExpired) {
      return reading({
        code: "invitation_expired",
        label: "Invitation expired",
        detail:
          "The invitation has expired and the link no longer works. Send a fresh one.",
        action: "resend",
        actionLabel: "Resend invitation",
        blocking: true,
        canSignIn: false,
      });
    }
    return reading({
      code: "invited",
      label: "Invitation sent",
      detail: facts.inviteExpiresAt
        ? "The invitation is waiting to be accepted."
        : "The invitation is waiting to be accepted.",
      action: "resend",
      actionLabel: "Resend invitation",
      // Not blocking: the ball is with the client, and chasing is meaningful.
      blocking: false,
      canSignIn: false,
    });
  }

  // `status === 'active'` — a usable login. Four production rows are active
  // with no `last_login_at`, so "active" does not mean "has signed in".
  if (!facts.lastLoginAt) {
    return reading({
      code: "issued_not_signed_in",
      label: "Access issued",
      detail:
        "The client has a portal login but has not signed in yet. Chase them rather than re-issuing — re-issuing resets their password and acknowledgements.",
      /*
       * NOT `resend`, deliberately. The server's `resend_invite` on an
       * ACTIVE account downgrades it to `invited`, clears `password_hash`
       * ownership, and resets `has_accepted_terms` /
       * `has_completed_onboarding` / `terms_accepted_at`. That is a
       * legitimate thing to do on purpose, from the client record's own
       * Portal Access dialog, where the consequences are laid out. It is not
       * a thing to offer as a convenience beside a compliance case.
       */
      action: "none",
      actionLabel: null,
      blocking: false,
      canSignIn: true,
    });
  }

  if (!facts.hasAcceptedTerms) {
    return reading({
      code: "signed_in_terms_pending",
      label: "Acknowledgements pending",
      detail:
        "The client has signed in but has not accepted the portal terms yet.",
      action: "none",
      actionLabel: null,
      blocking: false,
      canSignIn: true,
    });
  }

  return reading({
    code: "active",
    label: "Portal active",
    detail: "The client can sign in and has accepted the portal terms.",
    action: "none",
    actionLabel: null,
    blocking: false,
    canSignIn: true,
  });
}

/**
 * Is issuing access the single most useful next move on this case?
 *
 * Used to promote it to the workspace's next action. Deliberately narrow:
 * only when the client genuinely cannot get in. Once they can, chasing their
 * onboarding is the next move and the existing journey already says so.
 */
export function portalAccessIsNextAction(r: AmlPortalAccessReading): boolean {
  return r.blocking && r.action !== "none";
}
