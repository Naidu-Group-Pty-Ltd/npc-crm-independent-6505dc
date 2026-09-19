/**
 * The handover — from "the partner accepted" to "the partner has the Passport".
 *
 * ── The defect this answers ───────────────────────────────────────────
 * A partner outside the portals accepted the AML/CTF Compliance Passport
 * Agreement. Their own page said so plainly. In the Command Centre the same
 * event was:
 *
 *   · a row still reading `viewed`, because the workspace fetches once and
 *     never again — the page had been open since before the acceptance;
 *   · a bell entry among email notifications; and
 *   · nothing at all about what to do next.
 *
 * Everything the acceptance unlocked was true in the database and invisible
 * on the screen. The arrangement existed, the attestation existed, the
 * client's sharing consent existed — the Passport could have been issued
 * with one click, and no surface said so.
 *
 * ── What this module is ───────────────────────────────────────────────
 * Presentation arithmetic. It performs nothing and decides nothing: the
 * server's `grant_access` still re-checks the arrangement, its review date,
 * the client's consent and the attestation, and refuses on its own terms.
 * This decides only what the workspace SAYS, and which act it puts in front
 * of the operator.
 *
 * Two rules it keeps.
 *
 * **An acceptance is not a grant.** The partner has agreed to the terms on
 * which a Passport may be shared; nothing has been shared. `ready_to_issue`
 * is a state about US having work to do, never a statement that the partner
 * holds anything.
 *
 * **A partner is only "done" when a LIVE grant exists.** A grant that was
 * revoked, or that has expired, leaves the partner with an accepted
 * agreement and no access — which is exactly the situation that needs
 * naming, not one to be hidden behind a tick.
 */

export interface HandoverAcknowledgement {
  id: string;
  status: string;
  partner_org_id: string | null;
  recipient_name: string;
  recipient_email: string;
  accepted_at: string | null;
  accepted_by_name: string | null;
  agreement_id: string | null;
  partner_organisations?: { legal_name: string } | null;
}

export interface HandoverAgreement {
  id: string;
  partner_org_name: string;
  status: string;
}

export interface HandoverGrant {
  agreement_id: string;
  expires_at: string;
  revoked_at: string | null;
}

/** One partner who has accepted, and what is owed to them. */
export interface AcceptedPartner {
  acknowledgementId: string;
  agreementId: string | null;
  partnerName: string;
  recipientEmail: string;
  acceptedAt: string | null;
  acceptedByName: string | null;
  /** True once a live (unrevoked, unexpired) grant exists for the agreement. */
  hasLivePassport: boolean;
}

export type HandoverState =
  | "none"            // nothing has been sent to a partner outside the portals
  | "awaiting"        // sent, not yet accepted
  | "ready_to_issue"  // accepted, no live Passport — the act is ours
  | "blocked"         // accepted, but something stops the issue
  | "issued";         // accepted and holding a live Passport

export interface HandoverReading {
  state: HandoverState;
  /** One line naming the situation. Never a compliance claim. */
  headline: string;
  /** What happens next, in the operator's own terms. */
  detail: string;
  /** Partners accepted but without a live Passport, in acceptance order. */
  awaitingIssue: AcceptedPartner[];
  /** Partners accepted and holding a live Passport. */
  issued: AcceptedPartner[];
  /** Named before the click when the act cannot be performed. */
  blockedBy: string | null;
}

export interface HandoverFacts {
  acknowledgements: HandoverAcknowledgement[];
  agreements: HandoverAgreement[];
  grants: HandoverGrant[];
  /** An attestation must exist before anything can be shared. */
  hasAttestation: boolean;
  isMlro: boolean;
  /** Injected so the reading is deterministic under test. */
  now?: Date;
}

function nameOf(ack: HandoverAcknowledgement, agreements: HandoverAgreement[]): string {
  const fromAgreement = ack.agreement_id
    ? agreements.find((a) => a.id === ack.agreement_id)?.partner_org_name
    : undefined;
  return ack.partner_organisations?.legal_name || fromAgreement || ack.recipient_name;
}

export function readHandover(facts: HandoverFacts): HandoverReading {
  const now = (facts.now ?? new Date()).getTime();

  const liveGrantAgreementIds = new Set(
    facts.grants
      .filter((g) => !g.revoked_at && new Date(g.expires_at).getTime() > now)
      .map((g) => g.agreement_id),
  );

  const accepted = facts.acknowledgements
    .filter((a) => a.status === "accepted")
    .map<AcceptedPartner>((a) => ({
      acknowledgementId: a.id,
      agreementId: a.agreement_id,
      partnerName: nameOf(a, facts.agreements),
      recipientEmail: a.recipient_email,
      acceptedAt: a.accepted_at,
      acceptedByName: a.accepted_by_name,
      hasLivePassport: Boolean(a.agreement_id && liveGrantAgreementIds.has(a.agreement_id)),
    }))
    .sort((x, y) => (x.acceptedAt ?? "").localeCompare(y.acceptedAt ?? ""));

  const awaitingIssue = accepted.filter((p) => !p.hasLivePassport);
  const issued = accepted.filter((p) => p.hasLivePassport);
  const outstanding = facts.acknowledgements.filter(
    (a) => a.status === "sent" || a.status === "viewed",
  );

  if (accepted.length === 0) {
    if (outstanding.length === 0) {
      return {
        state: "none",
        headline: "No agreement is out with a partner outside the portals",
        detail:
          "Portal partners acknowledge the arrangement at sign-up. For anyone else, send the agreement by link — their acceptance is what records the arrangement a Passport requires.",
        awaitingIssue: [], issued: [], blockedBy: null,
      };
    }
    return {
      state: "awaiting",
      headline: outstanding.length === 1
        ? "Waiting on the partner to accept"
        : `Waiting on ${outstanding.length} partners to accept`,
      detail:
        "Nothing is owed here until they accept. This updates on its own — you do not need to reload the page, and you will be told the moment it changes.",
      awaitingIssue: [], issued: [], blockedBy: null,
    };
  }

  /* Accepted. The arrangement is recorded; the act is now ours. */

  if (awaitingIssue.length === 0) {
    const names = issued.map((p) => p.partnerName).join(", ");
    return {
      state: "issued",
      headline: issued.length === 1
        ? `${names} holds a live Compliance Passport`
        : `${issued.length} partners hold a live Compliance Passport`,
      detail:
        "They open it from a link, with no portal login. Nothing further is owed — re-issue only if a link lapses or the record is refreshed.",
      awaitingIssue: [], issued, blockedBy: null,
    };
  }

  const blockedBy = !facts.isMlro
    ? "Requires the MLRO"
    : !facts.hasAttestation
      ? "Issue the attestation first — there is no record to share yet"
      : awaitingIssue.every((p) => !p.agreementId)
        ? "The acceptance did not record an arrangement — re-send the agreement"
        : null;

  const lead = awaitingIssue[0];
  const who = awaitingIssue.length === 1
    ? lead.partnerName
    : `${lead.partnerName} and ${awaitingIssue.length - 1} other${awaitingIssue.length === 2 ? "" : "s"}`;

  return {
    state: blockedBy ? "blocked" : "ready_to_issue",
    headline: `${who} accepted the agreement — the Passport has not been issued`,
    detail: blockedBy
      ? "The arrangement is recorded and stands; only the issue is held up."
      : "Issuing emails them a one-time link they open without a portal login. They see what was performed, never this case's risk assessment.",
    awaitingIssue, issued, blockedBy,
  };
}

/**
 * What changed between two readings of the acknowledgement list.
 *
 * The workspace polls, so it can see an acceptance land while the operator is
 * looking at something else on the page. Announcing it is the difference
 * between a live indicator and a row that quietly reads differently the next
 * time somebody scrolls past.
 *
 * Only NEW acceptances are announced. A reading that has not changed says
 * nothing, and the very first reading after mount says nothing either —
 * "accepted last Tuesday" is not news, and a toast on every page load is how
 * an operator learns to dismiss them unread.
 */
export function newlyAccepted(
  previous: HandoverAcknowledgement[] | null,
  current: HandoverAcknowledgement[],
): AcceptedPartner[] {
  if (previous === null) return [];
  const wasAccepted = new Set(
    previous.filter((a) => a.status === "accepted").map((a) => a.id),
  );
  return current
    .filter((a) => a.status === "accepted" && !wasAccepted.has(a.id))
    .map((a) => ({
      acknowledgementId: a.id,
      agreementId: a.agreement_id,
      partnerName: a.partner_organisations?.legal_name || a.recipient_name,
      recipientEmail: a.recipient_email,
      acceptedAt: a.accepted_at,
      acceptedByName: a.accepted_by_name,
      hasLivePassport: false,
    }));
}

/**
 * Whether the workspace should keep watching.
 *
 * Polling costs a request every interval and a partner can take days, so it
 * runs only while something can actually change on its own: a request that is
 * out with a partner. An accepted, issued or declined list is settled, and the
 * workspace stops asking.
 */
export function shouldWatchForAcceptance(
  acknowledgements: Array<{ status: string }>,
): boolean {
  return acknowledgements.some((a) => a.status === "sent" || a.status === "viewed");
}
