/**
 * One partner, one row, one next step.
 *
 * ── The problem this is for ───────────────────────────────────────────
 * The Compliance Passport card listed the same three partners **four
 * times**, in four vocabularies, under four headings:
 *
 *   Who holds this Passport   — the grant
 *   Written arrangements      — the agreement, as `active`,
 *                               `eligibility not recorded`, `no assessment`
 *   Compliance agreement      — the emailed acceptance
 *   Partner links             — the case link, as `builder_developer`,
 *                               `reliance`, `active`, `classification
 *                               incomplete`
 *
 * Every one of those is a fact about the same organisation, and none of them
 * said what to DO. An operator looking at eleven amber badges across two
 * lists cannot tell which one is stopping them, which is a note for later,
 * and which is simply how the record looks when everything is fine.
 *
 * ── What this is ──────────────────────────────────────────────────────
 * Presentation arithmetic that joins those four records into one row per
 * organisation and derives ONE next step. It performs nothing and authorises
 * nothing: every act it names is an existing operation that re-checks its own
 * preconditions server-side and refuses on its own terms.
 *
 * Four rules carry it.
 *
 * **One row per ORGANISATION, keyed by the arrangement.** A partner may hold
 * several case links (a builder that is also on the sale as a developer), and
 * they are one partner. The arrangement is the unit that makes disclosure
 * lawful, so it is the key, and links attach to it.
 *
 * **One next step, chosen by what actually blocks.** The steps are ordered by
 * consequence — no arrangement, then no acceptance, then nothing sent, then
 * sent-but-never-emailed, then lapsed — and the FIRST unmet one is the step.
 * Everything else is detail, and detail is not a step.
 *
 * **A badge must mean something is wrong.** `active`, `reliance` and
 * `builder_developer` are how a healthy record looks: rendering them as
 * warning-coloured chips beside genuine problems is what made eleven badges
 * unreadable. Only unmet conditions surface, and each one says what it stops.
 *
 * **Nothing here is a compliance verdict.** "Eligibility not recorded" is a
 * missing record, not a finding; "no assessment" is work outstanding, not a
 * refusal. The wording states the gap and the consequence, never a judgement
 * about the partner.
 */

export interface RosterAgreement {
  id: string;
  partner_org_id?: string | null;
  partner_org_name: string;
  partner_org_type: string;
  status: string;
  next_review_due: string;
  eligibility_classification?: string | null;
  current_assessment_id?: string | null;
}

export interface RosterLink {
  id: string;
  partner_org_id: string | null;
  relationship_role: string;
  legal_route: string;
  state: string;
  portal_type?: string | null;
  partner_organisations?: { legal_name?: string | null; classification_status?: string | null } | null;
}

export interface RosterAcknowledgement {
  id: string;
  partner_org_id: string | null;
  recipient_name: string;
  recipient_email: string;
  status: string;
  accepted_at?: string | null;
  accepted_by_name?: string | null;
  expires_at: string;
  partner_organisations?: { legal_name?: string | null } | null;
}

export interface RosterGrant {
  id: string;
  agreement_id: string;
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  delivered_to_email?: string | null;
}

/** What the partner is owed, in the order the operator should deal with it. */
export type RosterStepKind =
  /** Nothing is outstanding — they hold a live, delivered Passport. */
  | "settled"
  /** An emailed agreement is out and unaccepted; there is nothing to do. */
  | "awaiting_partner"
  /** They accepted; the Passport has not been issued. */
  | "issue_passport"
  /** No Passport has ever been sent to them. */
  | "send_passport"
  /** A grant exists that nobody was ever emailed. */
  | "deliver_link"
  /** Their link lapsed or was withdrawn. */
  | "reissue"
  /** Nothing can be sent until an attestation exists. */
  | "blocked_no_attestation"
  /** The arrangement's review is overdue. */
  | "blocked_review"
  /** Only the MLRO may act. */
  | "blocked_role";

export interface RosterStep {
  kind: RosterStepKind;
  /** The button's words, or the statement when there is no button. */
  label: string;
  /** One line: what happens, or why nothing can. */
  detail: string;
  /** True when this row is waiting on somebody else, not on us. */
  waiting: boolean;
  /** True when an act is available to take right now. */
  actionable: boolean;
}

/** An unmet condition worth surfacing. Never a healthy value. */
export interface RosterFlag {
  code: "eligibility" | "assessment" | "classification" | "review" | "arrangement";
  label: string;
  /** What it actually stops. Empty when it stops nothing today. */
  consequence: string;
  /** `blocking` stops disclosure now; `record` is an outstanding record. */
  severity: "blocking" | "record";
}

export interface RosterRow {
  key: string;
  agreementId: string | null;
  partnerOrgId: string | null;
  partnerName: string;
  /** "Builder / developer", never `builder_developer`. */
  partnerTypeLabel: string;
  /** "Reliance (Pt 2 Div 7)", never `reliance`. */
  routeLabel: string | null;
  /** Live standing of their Passport, in one word. */
  passport: "live" | "expiring" | "undelivered" | "lapsed" | "withdrawn" | "none";
  passportDetail: string;
  step: RosterStep;
  flags: RosterFlag[];
  /**
   * The live grant that could be withdrawn, or null.
   *
   * Null for anyone but the MLRO. Withdrawal is a server-side MLRO act, so
   * offering it to an analyst would be a menu item that always refuses — and
   * a refusal after the click is how a control teaches somebody the product
   * is broken.
   */
  revokeGrantId: string | null;
  /** Whether this reader may perform the row's acts at all. */
  canAct: boolean;
  /** The emailed agreement, when one is out or was accepted. */
  acknowledgementId: string | null;
  acknowledgementState: string | null;
  /** Where their link last went. */
  lastDeliveredTo: string | null;
  linkIds: string[];
}

export interface RosterFacts {
  agreements: RosterAgreement[];
  links: RosterLink[];
  acknowledgements: RosterAcknowledgement[];
  grants: RosterGrant[];
  hasAttestation: boolean;
  isMlro: boolean;
  warnWithinDays?: number;
  now?: Date;
}

const TYPE_LABEL: Record<string, string> = {
  finance: "Finance",
  builder: "Builder",
  developer: "Developer",
  builder_developer: "Builder / developer",
  solicitor_conveyancer: "Solicitor / conveyancer",
  partner: "Partner",
  other: "Other partner",
  lender: "Lender / broker",
};

const ROUTE_LABEL: Record<string, string> = {
  reliance: "Reliance (Pt 2 Div 7)",
  outsourced_cdd: "Outsourced CDD",
  independent_cdd: "Independent CDD",
  information_share_only: "Information sharing only",
};

export function humanPartnerType(value: string | null | undefined): string {
  if (!value) return "Partner";
  return TYPE_LABEL[value] ?? value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function humanRoute(value: string | null | undefined): string | null {
  if (!value) return null;
  return ROUTE_LABEL[value] ?? value.replace(/_/g, " ");
}

const fmt = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString('en-AU');
};

export function partnerRoster(facts: RosterFacts): {
  rows: RosterRow[];
  /** Rows with an act available now, in order. */
  actionable: RosterRow[];
  /** One line for the panel header. Counts, never a verdict. */
  headline: string;
} {
  const now = (facts.now ?? new Date()).getTime();
  const warnMs = (facts.warnWithinDays ?? 14) * 864e5;

  const ackByOrg = new Map<string, RosterAcknowledgement>();
  for (const a of facts.acknowledgements) {
    if (!a.partner_org_id) continue;
    const held = ackByOrg.get(a.partner_org_id);
    /* An accepted acknowledgement outranks anything still in flight: it is
       the one that RECORDED the arrangement, and a later superseded resend
       must not hide it. */
    if (!held || (a.status === "accepted" && held.status !== "accepted")) {
      ackByOrg.set(a.partner_org_id, a);
    }
  }

  const rows = facts.agreements
    .filter((a) => a.status !== "terminated")
    .map<RosterRow>((agreement) => {
      const orgId = agreement.partner_org_id ?? null;
      const mine = facts.grants
        .filter((g) => g.agreement_id === agreement.id
          && g.revoke_reason !== "superseded_by_reissue")
        .sort((a, b) => b.granted_at.localeCompare(a.granted_at));
      const latest = mine[0] ?? null;
      const delivered = mine.find((g) => g.delivered_to_email) ?? null;
      const orgLinks = orgId ? facts.links.filter((l) => l.partner_org_id === orgId) : [];
      const activeLink = orgLinks.find((l) => l.state === "active") ?? orgLinks[0] ?? null;
      const ack = orgId ? ackByOrg.get(orgId) ?? null : null;

      /* ── the passport standing ─────────────────────────────────────── */
      let passport: RosterRow["passport"] = "none";
      let passportDetail = "No Passport has been sent to them.";
      let revokeGrantId: string | null = null;
      if (latest) {
        const expiresAt = new Date(latest.expires_at).getTime();
        if (latest.revoked_at) {
          passport = "withdrawn";
          passportDetail = `Access withdrawn ${fmt(latest.revoked_at)}.`;
        } else if (expiresAt <= now) {
          passport = "lapsed";
          passportDetail = `Their link expired ${fmt(latest.expires_at)}.`;
        } else if (!latest.delivered_to_email) {
          passport = "undelivered";
          passportDetail = "They hold a grant that was never emailed to anyone.";
          revokeGrantId = latest.id;
        } else if (expiresAt - now <= warnMs) {
          passport = "expiring";
          passportDetail = `Sent to ${latest.delivered_to_email}; expires ${fmt(latest.expires_at)}.`;
          revokeGrantId = latest.id;
        } else {
          passport = "live";
          passportDetail = `Sent to ${latest.delivered_to_email}; live until ${fmt(latest.expires_at)}.`;
          revokeGrantId = latest.id;
        }
      }

      /* ── unmet conditions, and what each actually stops ─────────────
         A healthy value is never a badge. `active`, `reliance` and the
         organisation type are how a correct record looks. */
      const reviewOverdue = new Date(agreement.next_review_due).getTime() < now;
      const flags: RosterFlag[] = [];
      if (agreement.status !== "active") {
        flags.push({
          code: "arrangement", label: `Arrangement ${agreement.status}`,
          consequence: "No new Passport can be sent under it.", severity: "blocking",
        });
      }
      if (reviewOverdue) {
        flags.push({
          code: "review", label: "Review overdue",
          consequence: `Due ${fmt(agreement.next_review_due)}. Blocks sending until it is reviewed.`,
          severity: "blocking",
        });
      }
      if ((agreement.eligibility_classification ?? "unassessed") === "unassessed") {
        flags.push({
          code: "eligibility", label: "Eligibility not recorded",
          consequence: "A record to complete; it does not stop sending today.",
          severity: "record",
        });
      }
      if (!agreement.current_assessment_id) {
        flags.push({
          code: "assessment", label: "No arrangement assessment",
          consequence: "A record to complete; it does not stop sending today.",
          severity: "record",
        });
      }
      if (activeLink?.partner_organisations?.classification_status
        && activeLink.partner_organisations.classification_status !== "classified") {
        flags.push({
          code: "classification", label: "Reporting-entity classification incomplete",
          consequence: "A record to complete; it does not stop sending today.",
          severity: "record",
        });
      }

      /* ── the ONE next step ─────────────────────────────────────────── */
      const step = ((): RosterStep => {
        if (!facts.isMlro) {
          return {
            kind: "blocked_role", label: "Requires the MLRO",
            detail: "Only the MLRO can send or withdraw a Passport.",
            waiting: false, actionable: false,
          };
        }
        if (ack && ["sent", "viewed"].includes(ack.status) && passport === "none") {
          return {
            kind: "awaiting_partner", label: "Waiting on the partner",
            detail: `Sent to ${ack.recipient_email}. Their acceptance records the arrangement.`,
            waiting: true, actionable: false,
          };
        }
        if (agreement.status !== "active") {
          return {
            kind: "blocked_review", label: `Arrangement ${agreement.status}`,
            detail: "Reactivate or replace the written arrangement before sending.",
            waiting: false, actionable: false,
          };
        }
        if (!facts.hasAttestation) {
          return {
            kind: "blocked_no_attestation", label: "Issue the attestation first",
            detail: "There is no version of the record to send yet.",
            waiting: false, actionable: false,
          };
        }
        if (reviewOverdue) {
          return {
            kind: "blocked_review", label: "Review the arrangement",
            detail: `Its review was due ${fmt(agreement.next_review_due)}. Sending is blocked until it is done.`,
            waiting: false, actionable: false,
          };
        }
        if (passport === "undelivered") {
          return {
            kind: "deliver_link", label: "Send their link",
            detail: "Their grant was never emailed. Sending replaces it with one that is delivered.",
            waiting: false, actionable: true,
          };
        }
        if (passport === "none") {
          return ack?.status === "accepted"
            ? {
              kind: "issue_passport", label: "Send the Passport",
              detail: `They accepted on ${fmt(ack.accepted_at)}. Emailing the link is all that is left.`,
              waiting: false, actionable: true,
            }
            : {
              kind: "send_passport", label: "Send the Passport",
              detail: "A link is emailed. They open the whole record without a portal login.",
              waiting: false, actionable: true,
            };
        }
        if (passport === "lapsed" || passport === "withdrawn") {
          return {
            kind: "reissue", label: "Send a new link",
            detail: passport === "withdrawn"
              ? "Access was withdrawn. Sending again is a fresh decision and re-runs every check."
              : "Their link has expired. A new one is emailed against today's record.",
            waiting: false, actionable: true,
          };
        }
        return {
          kind: "settled", label: "Nothing owed",
          detail: passport === "expiring"
            ? "Their link is live but expiring — re-issue when convenient."
            : "They hold a live Passport. Nothing further is owed.",
          waiting: false, actionable: false,
        };
      })();

      return {
        key: agreement.id,
        agreementId: agreement.id,
        partnerOrgId: orgId,
        partnerName: agreement.partner_org_name,
        partnerTypeLabel: humanPartnerType(
          activeLink?.relationship_role ?? agreement.partner_org_type),
        routeLabel: humanRoute(activeLink?.legal_route ?? null),
        passport,
        passportDetail,
        step,
        flags,
        revokeGrantId: facts.isMlro ? revokeGrantId : null,
        canAct: facts.isMlro,
        acknowledgementId: ack?.id ?? null,
        acknowledgementState: ack?.status ?? null,
        lastDeliveredTo: delivered?.delivered_to_email ?? null,
        linkIds: orgLinks.map((l) => l.id),
      };
    })
    /* Whatever needs doing first. Actionable, then waiting, then settled —
       and within each, by name, so the list does not reshuffle itself as
       standings change. */
    .sort((a, b) => {
      const rank = (r: RosterRow) =>
        r.step.actionable ? 0 : r.step.waiting ? 1 : r.step.kind === "settled" ? 3 : 2;
      return rank(a) - rank(b) || a.partnerName.localeCompare(b.partnerName);
    });

  const actionable = rows.filter((r) => r.step.actionable);
  const settled = rows.filter((r) => r.step.kind === "settled").length;

  const headline = rows.length === 0
    ? "No partner has a written arrangement on this matter yet."
    : actionable.length > 0
      ? `${actionable.length} of ${rows.length} need${actionable.length === 1 ? "s" : ""} something from you.`
      : settled === rows.length
        ? `All ${rows.length} partners hold a live Passport.`
        : `Nothing to do right now — ${rows.length} partner${rows.length === 1 ? "" : "s"} on this matter.`;

  return { rows, actionable, headline };
}
