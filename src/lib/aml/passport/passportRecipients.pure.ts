/**
 * Who holds this Passport, and what it would take to send it to somebody else.
 *
 * ── The defect this answers ───────────────────────────────────────────
 * A Passport was granted to a partner who already had portal access and
 * **nothing was sent to them**. `grant_access` emails the link when it is
 * given a `deliver_to`, and the onboarding wizard called it without one — so
 * a portal partner's grant existed in the register, was correct in every
 * column, and reached the partner by no channel at all. The operator was
 * handed a raw bearer token and told to "deliver it through their usual
 * channel", which is not a channel.
 *
 * The second half of the same defect is that there was no surface for doing
 * it AGAIN. Sending the same client's Passport to a second partner meant
 * re-running the onboarding wizard, and sending it to an existing one meant
 * typing the organisation's name into a free-text box that had to match an
 * agreement exactly — so "distribute to several partners", which is the
 * entire point of a Compliance Passport, had no button anywhere.
 *
 * ── What this is ──────────────────────────────────────────────────────
 * Presentation arithmetic over records the case already holds. It performs
 * nothing and it authorises nothing: `grant_access` still re-checks the
 * arrangement, its review date, the client's sharing consent and the
 * attestation, and refuses on its own terms. This decides what the workspace
 * SAYS about each partner and which single act it offers them.
 *
 * Three rules carry it.
 *
 * **A row is an ARRANGEMENT, not a person.** `grant_access` takes an
 * agreement id and refuses without an active one, so the unit of
 * distribution is the written arrangement — which is also the thing that
 * makes the disclosure lawful under Pt 2 Div 7. A partner with no
 * arrangement is not a row here; they are an onboarding.
 *
 * **Holding a Passport and having been SENT one are different facts.** A
 * grant is access; delivery is an email. They can disagree — that is exactly
 * how this defect read from the register, where every grant was present and
 * none had been delivered — so the reading carries both and `undelivered`
 * is its own state rather than a shade of "live".
 *
 * **Sending again is never the same act as sending first.** A partner who
 * holds a live, delivered link gets a RE-ISSUE, which supersedes the one
 * they have, because the token is stored only as a hash and can never be
 * re-read. Offering "send it again" there would promise a copy of something
 * nobody — including this platform — can produce.
 */

export interface RecipientAgreement {
  id: string;
  partner_org_name: string;
  partner_org_type: string;
  status: string;
  next_review_due: string;
  partner_org_id?: string | null;
}

export interface RecipientGrant {
  id: string;
  agreement_id: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  delivered_to_email?: string | null;
  delivered_at?: string | null;
}

/** An emailed agreement acceptance — the only other place an address lives. */
export interface RecipientAcknowledgement {
  partner_org_id: string | null;
  partner_org_name?: string | null;
  recipient_email: string;
  status: string;
}

export type RecipientState =
  /** A live link, and it was emailed to somebody. */
  | "holds"
  /** A live link that nothing ever delivered — access with no channel. */
  | "undelivered"
  /** Live, but not for much longer. */
  | "expiring"
  /** Held one; it has lapsed. */
  | "lapsed"
  /** Withdrawn deliberately. */
  | "revoked"
  /** Never had one. */
  | "never";

/** Ordered worst-first: what an operator has to deal with comes to the top. */
export const RECIPIENT_STATE_ORDER: RecipientState[] = [
  "undelivered", "never", "lapsed", "expiring", "revoked", "holds",
];

export interface RecipientRow {
  agreementId: string;
  partnerOrgId: string | null;
  partnerName: string;
  partnerType: string;
  state: RecipientState;
  /** One line of standing, in the operator's own terms. */
  detail: string;
  /** Where the link was last emailed, and when. Null when never delivered. */
  lastDeliveredTo: string | null;
  lastDeliveredAt: string | null;
  /** The address to offer first when sending — last used, else an acceptance. */
  suggestedEmail: string | null;
  /** The live grant a re-issue would supersede, or null. */
  reissueOf: string | null;
  /**
   * The live grant that could be WITHDRAWN, or null.
   *
   * Withdrawal is not deletion and the difference is the point: a grant is
   * the record that a disclosure was authorised, so it is revoked and kept,
   * never removed. `revoke_grant` is deliberately ungated where issuing is
   * flag-gated — stopping access is a safety action and must never be the
   * thing a feature flag prevents.
   */
  revokeGrantId: string | null;
  /** False when there is nothing live to withdraw, or the role cannot. */
  canRevoke: boolean;
  /**
   * Which list this row belongs on.
   *
   * `ended` is history — lapsed and withdrawn access — and the panel
   * collapses it. It is not hidden: an operator asking "did we ever share
   * this, and did we stop?" is asking an audit question, and the answer has
   * to be one click away rather than gone.
   */
  group: "active" | "ended";
  /** The act on offer, in words. */
  actionLabel: string;
  /** What that act will actually do, said before the click. */
  actionMeaning: string;
  /** Named before the click when the act cannot be performed at all. */
  blockedBy: string | null;
}

export interface RecipientFacts {
  agreements: RecipientAgreement[];
  grants: RecipientGrant[];
  acknowledgements?: RecipientAcknowledgement[];
  /** Nothing can be shared before an attestation version exists. */
  hasAttestation: boolean;
  isMlro: boolean;
  /** Days from expiry at which the workspace starts saying so. */
  warnWithinDays?: number;
  /** Injected so the reading is deterministic under test. */
  now?: Date;
}

export interface RecipientReading {
  rows: RecipientRow[];
  /** Partners with something live or something owed. The everyday list. */
  active: RecipientRow[];
  /** Lapsed and withdrawn access, kept and collapsed rather than removed. */
  ended: RecipientRow[];
  /** How many partners hold a live Passport they were actually sent. */
  holding: number;
  /** Partners whose access exists but reached them by no channel. */
  undelivered: number;
  /** Partners with an arrangement who have never been sent anything. */
  neverSent: number;
  /** One line for the panel header. Never a compliance claim. */
  headline: string;
}

const MLRO_NEEDED = "Only the MLRO can send a Passport";
const NO_ATTESTATION =
  "Issue the attestation first — there is no version of the record to send yet";
const REVIEW_OVERDUE =
  "This arrangement's review is overdue — review it before sending again";

function fmt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString('en-AU');
}

export function passportRecipients(facts: RecipientFacts): RecipientReading {
  const now = (facts.now ?? new Date()).getTime();
  const warnMs = (facts.warnWithinDays ?? 14) * 864e5;

  /* An acceptance is the one other place a partner's own address is
     recorded, so it seeds the send box for a partner who has never been
     emailed a link. It is a SUGGESTION and never an authority: the operator
     still confirms the address, and the server still decides the grant. */
  const ackByOrg = new Map<string, string>();
  for (const ack of facts.acknowledgements ?? []) {
    if (ack.partner_org_id && ack.recipient_email && !ackByOrg.has(ack.partner_org_id)) {
      ackByOrg.set(ack.partner_org_id, ack.recipient_email);
    }
  }

  const rows = facts.agreements
    .filter((a) => a.status === "active")
    .map<RecipientRow>((agreement) => {
      /* A grant replaced by a re-issue is history rather than a standing —
         the same rule the links list already applies. */
      const mine = facts.grants
        .filter((g) => g.agreement_id === agreement.id
          && g.revoke_reason !== "superseded_by_reissue")
        .sort((a, b) => b.granted_at.localeCompare(a.granted_at));
      const latest = mine[0] ?? null;

      const delivered = mine.find((g) => g.delivered_to_email) ?? null;
      const lastDeliveredTo = delivered?.delivered_to_email ?? null;
      const lastDeliveredAt = delivered?.delivered_at ?? null;

      let state: RecipientState = "never";
      let detail = "Has never been sent this Passport.";
      let reissueOf: string | null = null;

      if (latest) {
        const expiresAt = new Date(latest.expires_at).getTime();
        if (latest.revoked_at) {
          state = "revoked";
          detail = `Access withdrawn ${fmt(latest.revoked_at)}. Sending issues a new link.`;
        } else if (expiresAt <= now) {
          state = "lapsed";
          detail = `Their link expired ${fmt(latest.expires_at)}.`;
        } else {
          reissueOf = latest.id;
          if (!latest.delivered_to_email) {
            /* The defect itself, named on the row that has it: a grant the
               partner was never told about is access nobody can use. */
            state = "undelivered";
            detail =
              "Holds a live grant that was never emailed to anyone — they have no link.";
          } else if (expiresAt - now <= warnMs) {
            state = "expiring";
            detail = `Sent to ${latest.delivered_to_email}; expires ${fmt(latest.expires_at)}.`;
          } else {
            state = "holds";
            detail = `Sent to ${latest.delivered_to_email}; live until ${fmt(latest.expires_at)}.`;
          }
        }
      }

      const reviewOverdue = new Date(agreement.next_review_due).getTime() < now;
      const blockedBy = !facts.isMlro
        ? MLRO_NEEDED
        : !facts.hasAttestation
          ? NO_ATTESTATION
          : reviewOverdue
            ? REVIEW_OVERDUE
            : null;

      /* A live link cannot be re-read — only its hash is stored — so the act
         on offer for a holder is a REPLACEMENT, and it says so before the
         click rather than in a toast afterwards. */
      const actionLabel = reissueOf
        ? (state === "undelivered" ? "Send their link" : "Re-issue and send")
        : state === "never" ? "Send the Passport" : "Send a new link";
      const actionMeaning = reissueOf
        ? (state === "undelivered"
          ? "Their existing grant is replaced with one that is actually emailed."
          : "A new link is emailed and the one they hold stops working.")
        : state === "never"
          ? "A link is emailed. They open the whole Passport without a portal login."
          : "A fresh link is emailed against today's attestation.";

      /* Only a LIVE grant can be withdrawn: a lapsed one has already stopped
         working and a withdrawn one is already withdrawn, so offering the act
         there would be a button that does nothing. */
      const live = latest && !latest.revoked_at
        && new Date(latest.expires_at).getTime() > now
        ? latest : null;

      return {
        agreementId: agreement.id,
        partnerOrgId: agreement.partner_org_id ?? null,
        partnerName: agreement.partner_org_name,
        partnerType: agreement.partner_org_type,
        state,
        detail,
        lastDeliveredTo,
        lastDeliveredAt,
        suggestedEmail: lastDeliveredTo
          ?? (agreement.partner_org_id ? ackByOrg.get(agreement.partner_org_id) ?? null : null),
        reissueOf,
        actionLabel,
        actionMeaning,
        blockedBy,
        revokeGrantId: live ? live.id : null,
        // Withdrawal needs the MLRO and something live. It is deliberately
        // NOT blocked by an overdue review or a missing attestation — those
        // stop new disclosure, and stopping disclosure is what this does.
        canRevoke: Boolean(live) && facts.isMlro,
        group: state === "lapsed" || state === "revoked" ? "ended" : "active",
      };
    })
    .sort((a, b) => {
      const byState = RECIPIENT_STATE_ORDER.indexOf(a.state)
        - RECIPIENT_STATE_ORDER.indexOf(b.state);
      return byState !== 0 ? byState : a.partnerName.localeCompare(b.partnerName);
    });

  const holding = rows.filter((r) => r.state === "holds" || r.state === "expiring").length;
  const undelivered = rows.filter((r) => r.state === "undelivered").length;
  const neverSent = rows.filter((r) => r.state === "never").length;

  /* The headline states counts and nothing else. It is deliberately not a
     readiness verdict: whether a partner MAY receive this record is the
     server's decision, taken again on every send. */
  const parts: string[] = [];
  if (holding > 0) parts.push(`${holding} partner${holding === 1 ? "" : "s"} hold${holding === 1 ? "s" : ""} a live Passport`);
  if (undelivered > 0) parts.push(`${undelivered} granted but never emailed`);
  if (neverSent > 0) parts.push(`${neverSent} not yet sent`);
  const headline = rows.length === 0
    ? "No partner has a written arrangement on this matter yet."
    : parts.length === 0
      ? "No partner currently holds a live Passport."
      : `${parts.join(" · ")}.`;

  return {
    rows,
    active: rows.filter((r) => r.group === "active"),
    ended: rows.filter((r) => r.group === "ended"),
    holding, undelivered, neverSent, headline,
  };
}
