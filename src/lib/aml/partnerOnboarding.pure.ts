/**
 * Partner onboarding — the vocabulary and defaults for taking a partner
 * from "does not exist in the system" to "holds a passport grant" in one
 * guided pass.
 *
 * ── The defect this replaces ──────────────────────────────────────────
 * Granting a partner access required four separate acts spread across
 * three dialogs — record the organisation (free-text type field), record
 * the written arrangement (typing the partner's name again, exactly),
 * link the partner to the case (typing it a third time), then grant —
 * and nothing said the order. Production held zero organisations, zero
 * arrangements and zero links: nobody had ever made it through.
 *
 * ── What this module is ───────────────────────────────────────────────
 * Presentation arithmetic only: the portal and legal-route catalogues
 * with their meanings, the date and wording defaults, and the readiness
 * reading for the grant step. It performs nothing — the `aml-reliance`
 * ops enforce every rule (MLRO role, written arrangement, review
 * currency, client sharing consent, attestation existence), and nothing
 * here can bypass one. A readiness reading of `null` means UNKNOWN and
 * is never treated as satisfied.
 */

export interface PartnerPortalChoice {
  value: "finance" | "builder" | "developer" | "solicitor_conveyancer" | "other";
  label: string;
  /** Default relationship role recorded on the case link. */
  role: string;
  meaning: string;
}

/**
 * The portals a partner can belong to.
 *
 * ── One card per PORTAL, not per organisation type ────────────────────
 * Builder and Developer partners sign into the SAME portal — the
 * Builder/Developer portal — so offering them as two cards described a
 * split that does not exist and made an operator choose between two
 * doors into one room. They are one card now, with the organisation
 * kind asked underneath, because the kind is still a real recorded fact
 * (AML's `organisation_type`, the case link's `portal_type`, and the
 * builder portal's own `org_type` all carry it).
 *
 * The `value` here stays in the AML server's vocabulary
 * (finance | builder | developer | solicitor_conveyancer | other) so
 * nothing downstream has to learn a UI-only word.
 */
export const PARTNER_PORTAL_CHOICES: PartnerPortalChoice[] = [
  {
    value: "finance", label: "Finance portal", role: "lender",
    meaning: "Mortgage brokers and lenders relying on the completed verification for the lending file.",
  },
  {
    value: "builder", label: "Builder / Developer portal", role: "builder",
    meaning: "Builders and developers on the client's construction contract or purchase — one shared portal.",
  },
  {
    value: "solicitor_conveyancer", label: "Solicitors & conveyancers", role: "buyer_solicitor",
    meaning: "The legal practice acting on the client's matter.",
  },
  {
    value: "other", label: "Other", role: "partner",
    meaning: "Any other organisation with a recorded reason to access this matter.",
  },
];

/**
 * Which organisation the Builder/Developer portal card stands for. Asked
 * only when that card is chosen, because the answer is written to three
 * records and guessing it writes the wrong one.
 */
export interface BuilderOrgKindChoice {
  value: "builder" | "developer" | "builder_developer";
  label: string;
  meaning: string;
  /** The AML portal/organisation type — its vocabulary has no combined value. */
  amlType: "builder" | "developer";
  /** Default relationship role on the case link. */
  role: string;
}

export const BUILDER_ORG_KINDS: BuilderOrgKindChoice[] = [
  {
    value: "builder", label: "Builder", amlType: "builder", role: "builder",
    meaning: "Builds under the client's construction contract.",
  },
  {
    value: "developer", label: "Developer", amlType: "developer", role: "developer",
    meaning: "Develops the project the client is purchasing in.",
  },
  {
    value: "builder_developer", label: "Builder & developer", amlType: "builder", role: "builder_developer",
    meaning: "One organisation doing both — recorded as a builder-developer in the portal.",
  },
];

/** True when this portal card asks which kind of organisation it is. */
export function portalAsksOrgKind(portal: string): boolean {
  return portal === "builder" || portal === "developer";
}

export interface LegalRouteChoice {
  value: "reliance" | "independent_cdd" | "outsourced_cdd" | "information_share_only";
  label: string;
  meaning: string;
}

/**
 * The legal route is a RECORDED decision, never inferred from portal
 * type. Reliance is the default here because this flow ends in a
 * passport grant, which is a reliance disclosure.
 */
export const LEGAL_ROUTE_CHOICES: LegalRouteChoice[] = [
  {
    value: "reliance", label: "Reliance (Pt 2 Div 7)",
    meaning: "The partner relies on our customer identification under the written arrangement — the route a passport grant uses.",
  },
  {
    value: "independent_cdd", label: "Independent CDD",
    meaning: "The partner makes its own determination against the same records. Always available; no arrangement needed.",
  },
  {
    value: "outsourced_cdd", label: "Outsourced CDD",
    meaning: "We perform identification as the partner's service provider under an outsourcing arrangement.",
  },
  {
    value: "information_share_only", label: "Information share only",
    meaning: "Named records are shared for a documented purpose — no reliance and no passport follows.",
  },
];

/** YYYY-MM-DD for a date, in local time (the server expects a plain date). */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * s 37A requires the arrangement to be reviewed regularly, and an overdue
 * review blocks new grants — so the default review date is one year out,
 * never "sometime".
 */
export function defaultReviewDate(from: Date): string {
  const d = new Date(from.getTime());
  d.setFullYear(d.getFullYear() + 1);
  return isoDate(d);
}

/** A purpose the operator edits, never an empty box (the server requires ≥ 10 chars). */
export function defaultPurpose(portalLabel: string, role: string): string {
  return `${portalLabel} partner acting as ${role.replace(/_/g, " ")} on this client's matter — access under the recorded arrangement for passport reliance.`;
}

/**
 * ── The prebuilt arrangement ──────────────────────────────────────────
 * Every portal sign-up executes the "Portal Access, Confidentiality,
 * Privacy and AML/CTF Compliance Passport Agreement" — one prebuilt
 * instrument across the Finance, Builder/Developer and Solicitor
 * portals, whose mandatory `binding_amlctf_arrangement` acknowledgement
 * states that it constitutes the s 37A / rule 6-29 CDD arrangement. The
 * acceptance is refused without that acknowledgement
 * (`_shared/portalAgreement.ts`), and the executed copy lands in Partner
 * Agreement Records.
 *
 * So onboarding a PORTAL partner does not ask the operator to type an
 * arrangement: the register row is recorded automatically against the
 * prebuilt instrument, and the partner's binding acknowledgement is
 * captured when they take up portal access. Only a partner outside the
 * portals ("Other") still records a manual arrangement — there is no
 * sign-up to carry one for them.
 */
export const PREBUILT_AGREEMENT_TITLE =
  "Portal Access, Confidentiality, Privacy and AML/CTF Compliance Passport Agreement";

export function portalHasPrebuiltAgreement(portal: string): boolean {
  return portal !== "other";
}

export interface PrebuiltArrangementDraft {
  agreement_reference: string;
  executed_on: string;
  next_review_due: string;
}

/**
 * The register row for the prebuilt instrument. `executed_on` is the
 * onboarding date — the date this register entry is made; the partner's
 * own binding acknowledgement is captured at portal sign-up and lives in
 * Partner Agreement Records, and the reference says so.
 */
export function prebuiltArrangementDraft(today: Date): PrebuiltArrangementDraft {
  return {
    agreement_reference: `${PREBUILT_AGREEMENT_TITLE} — acknowledged at portal sign-up`,
    executed_on: isoDate(today),
    next_review_due: defaultReviewDate(today),
  };
}

/** The invite email is the door into the portal — validated before anything sends. */
export function isValidEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

/**
 * The BUILDER PORTAL's own organisation vocabulary, from the kind the
 * operator chose. One shared portal, three organisation shapes — and
 * `builder_developer` exists there, so a partner that does both is
 * recorded as itself rather than flattened into one half.
 */
export function builderOrgType(
  kind: string,
): "builder" | "developer" | "builder_developer" {
  if (kind === "developer") return "developer";
  if (kind === "builder_developer") return "builder_developer";
  return "builder";
}

/**
 * The AML vocabulary for the same choice. `aml.partner_organisations`
 * and `partner_case_links` have no combined value, so a builder-developer
 * is recorded there as a builder — the portal keeps the fuller shape.
 */
export function amlOrgTypeForKind(kind: string): "builder" | "developer" {
  return BUILDER_ORG_KINDS.find((k) => k.value === kind)?.amlType ?? "builder";
}

export interface GrantReadinessFacts {
  /** Current attestation version, null when none is issued. */
  attestationVersion: number | null;
  /** Client sharing consent: true accepted, false known-missing, null unknown. */
  sharingConsent: boolean | null;
}

export interface GrantReadiness {
  ready: boolean;
  /** Blockers, named before the click — the server enforces the same rules. */
  blockers: string[];
  /** Cautions that do not block (an UNKNOWN reading is a caution, never a pass). */
  cautions: string[];
}

export function grantReadiness(f: GrantReadinessFacts): GrantReadiness {
  const blockers: string[] = [];
  const cautions: string[] = [];
  if (f.attestationVersion === null) {
    blockers.push("Issue the attestation first — a grant hands the partner an issued version, and none exists yet.");
  }
  if (f.sharingConsent === false) {
    blockers.push("The client has not accepted the sharing consent in their portal. Sharing their completed verification without it is refused (APP 6).");
  } else if (f.sharingConsent === null) {
    cautions.push("The client's sharing-consent status could not be read — the server will still enforce it.");
  }
  return { ready: blockers.length === 0, blockers, cautions };
}

/* ── The emailed agreement, as the workspace reads it ──────────────────
 * The browser side of `ackActionFor` in
 * `supabase/functions/_shared/aml/directAcknowledgement.ts`; the two must
 * agree, and a test asserts they carry the same statuses. Presentation
 * only — the server decides what a row's status actually is.
 */

export type DirectAckReading = {
  state: "sent" | "viewed" | "accepted" | "declined" | "expired" | "superseded";
  /** True when the passport may now be granted to this partner. */
  gateOpen: boolean;
  /** True when re-sending is the sensible next act. */
  canResend: boolean;
  detail: string;
};

export function describeAcknowledgement(
  status: string, expiresAt: string | null | undefined,
): DirectAckReading {
  if (status === "accepted") {
    return {
      state: "accepted", gateOpen: true, canResend: false,
      detail: "Acknowledged — the arrangement is recorded and the passport can be issued.",
    };
  }
  if (status === "declined") {
    return {
      state: "declined", gateOpen: false, canResend: true,
      detail: "The partner declined. Nothing is recorded against them; a new request can be sent if the position changes.",
    };
  }
  if (status === "superseded") {
    return {
      state: "superseded", gateOpen: false, canResend: false,
      detail: "Replaced by a newer request.",
    };
  }
  const live = (status === "sent" || status === "viewed")
    && Boolean(expiresAt) && new Date(expiresAt as string).getTime() > Date.now();
  if (!live) {
    return {
      state: "expired", gateOpen: false, canResend: true,
      detail: "The link lapsed before it was accepted. Re-send it to the same address or a different one.",
    };
  }
  return {
    state: status === "viewed" ? "viewed" : "sent",
    gateOpen: false, canResend: true,
    detail: status === "viewed"
      ? "The partner has opened the agreement but not yet accepted it."
      : "Sent — waiting for the partner to review and accept.",
  };
}

/* ── A passport grant's standing ───────────────────────────────────────
 * Presentation only. The server decides whether a token still works; this
 * decides what the workspace SAYS about it, and which act it offers.
 */

export interface GrantStandingFacts {
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  /** The partner asked for a replacement from an expired link. */
  linkRequestedAt?: string | null;
  /** Days out from expiry at which the workspace starts saying so. */
  warnWithinDays?: number;
}

export interface GrantStanding {
  state: "live" | "expiring" | "expired" | "revoked" | "reissued";
  /** True when re-issuing is a sensible act for this row. */
  canReissue: boolean;
  detail: string;
}

export function grantStanding(f: GrantStandingFacts, now: Date = new Date()): GrantStanding {
  const expires = new Date(f.expiresAt).getTime();
  const days = Math.ceil((expires - now.getTime()) / 864e5);
  if (f.revokedAt) {
    // A grant replaced by a re-issue is not a withdrawal of access, and
    // must not read like one.
    if (f.revokeReason === "superseded_by_reissue") {
      return {
        state: "reissued", canReissue: false,
        detail: "Replaced by a newer link.",
      };
    }
    return {
      state: "revoked", canReissue: false,
      detail: "Access was revoked. Re-issuing is deliberately not offered here — grant access again only as a fresh decision.",
    };
  }
  if (days <= 0) {
    return {
      state: "expired", canReissue: true,
      detail: f.linkRequestedAt
        ? "Expired — the partner has asked for a new link."
        : "Expired. Re-issue it to the same address or a different one.",
    };
  }
  if (days <= (f.warnWithinDays ?? 14)) {
    return {
      state: "expiring", canReissue: true,
      detail: `Expires in ${days} day${days === 1 ? "" : "s"} — re-issue before it lapses.`,
    };
  }
  return {
    state: "live", canReissue: true,
    detail: `Active until ${new Date(f.expiresAt).toLocaleDateString('en-AU')}.`,
  };
}
