/**
 * The Compliance Passport's acts, explained — what each button DOES, in
 * which order, and why one is unavailable right now.
 *
 * ── The defect this replaces ──────────────────────────────────────────
 * The reliance panel's header was four bare buttons: "Arrangement",
 * "Issue attestation", "Material change", "Grant access". Nothing said
 * what any of them did, nothing said their order, and production held
 * ZERO written arrangements — so "Grant access" answered every click
 * with a refusal toast ("No active CDD arrangement") that read as the
 * button being broken. A blocked act must name its enabler BEFORE the
 * click, the same rule the service gate and the decision already follow.
 *
 * ── What this module is ───────────────────────────────────────────────
 * Presentation arithmetic only. It performs nothing, fetches nothing and
 * decides nothing — the server's `aml-reliance` ops still enforce every
 * rule (MLRO role, active arrangement, attestation existence). The
 * vocabulary here deliberately shares nothing with a clearance: an act
 * being "ready" is availability, never a compliance claim.
 */

import { refreshRemedy } from "@/lib/aml/passport";

export interface PassportActionFacts {
  /** Current (unsuperseded) attestation, or null when none is issued. */
  attestationVersion: number | null;
  issuedAt: string | null;
  /** SERVER-derived passport state code; null = reading unavailable. */
  passportStateCode: string | null;
  /**
   * The server's reason codes for that state.
   *
   * `refresh_required` covers two different owed acts and only the reasons
   * tell them apart — see `refreshRemedy`. Optional so a deployment that
   * predates the reasons behaves exactly as it did.
   */
  passportStateReasons?: readonly string[] | null;
  activeAgreements: number;
  activeGrants: number;
  isMlro: boolean;
  /**
   * Partners who accepted the emailed agreement and hold no live Passport.
   *
   * An acceptance is the moment this act stops being optional and becomes
   * owed — somebody outside the portals has signed, and until the Passport is
   * issued they have an executed arrangement and nothing to open. The row
   * said "No partner has access yet" either way, which reads as an empty
   * state rather than as work.
   */
  awaitingPassportIssue?: number;
  /** Named so the row says WHO is waiting, not just how many. */
  awaitingPassportName?: string | null;
  /**
   * Whether material-change invalidation can run on this deployment (the
   * partner event outbox flag, read from the server's own health op).
   * null = the reading was unavailable, which changes nothing — the
   * server still answers for itself.
   */
  materialChangeAvailable?: boolean | null;
}

export type PassportActionState = "done" | "ready" | "blocked" | "anytime";

export interface PassportActionRow {
  key: "preview" | "issue" | "arrangement" | "grant" | "material";
  label: string;
  /** What the act does — plain words, shown beside the button. */
  meaning: string;
  state: PassportActionState;
  /** The current standing of this act on this case. */
  detail: string;
  /** What enables a blocked act, named before the click. */
  blockedBy: string | null;
}

const MLRO_NEEDED = "Requires the MLRO";

export function passportActions(f: PassportActionFacts): PassportActionRow[] {
  const hasAttestation = f.attestationVersion !== null;
  const cautionary =
    f.passportStateCode === "refresh_required" || f.passportStateCode === "superseded";
  /* ── A remedy that cannot discharge the reason is not a next step ─────
   * The reliance panel opens exactly one act — the first row that is
   * `ready`. On the reported case that was "Issue the attestation", reading
   * "v1 is flagged for refresh — issuing v2 supersedes it", with a "Reissue
   * as v2" button. The flag's only reason was `service_gate_regressed`: the
   * gate was under review. Issuing v2 would have superseded a good v1 and
   * left the state exactly where it was, because v2 is flagged for the same
   * reason. `refreshRemedy` is the one place that knows the difference. */
  const gateOnly = cautionary && refreshRemedy(f.passportStateReasons) === "approve_gate";
  const refreshFlagged = cautionary && !gateOnly;

  const rows: PassportActionRow[] = [];

  /* 1 · Look before anything is issued or shared. */
  rows.push({
    key: "preview",
    label: "Preview the digital Passport",
    meaning:
      "Opens the Passport exactly as the client and partners will see it — assess it visually before issuing a version or sharing anything.",
    state: "anytime",
    detail: hasAttestation
      ? `Shows the issued record (currently v${f.attestationVersion}).`
      : "Shows the derived record before any version has been issued.",
    blockedBy: null,
  });

  /* 2 · Freeze the verified facts as a numbered version. */
  rows.push({
    key: "issue",
    label: "Issue the attestation",
    meaning:
      "Freezes what was performed — identity verification, screening, consents — as a numbered, hash-stamped version. Partners only ever read an issued version; issuing again supersedes the previous one. Nothing is shared by issuing alone.",
    state: !f.isMlro
      ? "blocked"
      : !hasAttestation
        ? "ready"
        : refreshFlagged
          ? "ready"
          : "done",
    detail: !hasAttestation
      ? "No version issued yet — issuing creates v1."
      : refreshFlagged
        ? `v${f.attestationVersion} is flagged for refresh — issuing v${(f.attestationVersion ?? 0) + 1} supersedes it.`
        : gateOnly
          /* Says what is owed and where, and does NOT offer a version as the
             remedy. The act stays available — an MLRO may always reissue —
             it simply is not what this case is waiting for. */
          ? `v${f.attestationVersion} is issued and stays in force. It is held back only by the service gate, which is still awaiting approval on Gate & Passport — a new version would not change that.`
          : `v${f.attestationVersion} is in force${f.issuedAt ? ` (issued ${new Date(f.issuedAt).toLocaleDateString('en-AU')})` : ""}. Reissuing supersedes it.`,
    blockedBy: f.isMlro ? null : MLRO_NEEDED,
  });

  /* 3 · The written arrangement reliance stands on. For portal partners
   *     it is PREBUILT — the Portal Access & AML/CTF Compliance Passport
   *     Agreement their sign-up executes (its mandatory acknowledgement
   *     is the s 37A arrangement statement) — and onboarding records the
   *     register row automatically. The manual act remains for a partner
   *     outside the portals, so this row is an option, never an owed
   *     "next" step in front of the grant. */
  rows.push({
    key: "arrangement",
    label: "Record the written arrangement",
    meaning:
      "For portal partners (finance, builder/developer, solicitors) the arrangement is prebuilt: the Portal Access & AML/CTF Compliance Passport Agreement, recorded automatically during onboarding and acknowledged by the partner at portal sign-up (the s 37A statement is a mandatory part of it). Record one manually only for a partner outside the portals.",
    state: !f.isMlro ? "blocked" : f.activeAgreements > 0 ? "done" : "anytime",
    detail: f.activeAgreements > 0
      ? `${f.activeAgreements} active arrangement${f.activeAgreements === 1 ? "" : "s"} recorded.`
      : "None recorded yet — onboarding a portal partner records the prebuilt arrangement automatically.",
    blockedBy: f.isMlro ? null : MLRO_NEEDED,
  });

  /* 4 · Hand a partner the issued version — the only act that shares.
   *     A missing arrangement no longer blocks it: onboarding a new
   *     partner records the organisation, the written arrangement and
   *     the case link on the way to the grant. */
  rows.push({
    key: "grant",
    label: "Grant partner access",
    meaning:
      "Gives a partner the current attestation under an active arrangement, via a one-time access token their portal redeems — the partner needs no sign-up before the passport reaches them. They see what was performed — never this case's risk assessment.",
    state: !f.isMlro || !hasAttestation ? "blocked" : "ready",
    detail: (f.awaitingPassportIssue ?? 0) > 0
      ? `${
        f.awaitingPassportName
          ? `${f.awaitingPassportName} accepted the agreement`
          : `${f.awaitingPassportIssue} partner${f.awaitingPassportIssue === 1 ? "" : "s"} accepted the agreement`
      } and has no Passport yet — issuing emails them a one-time link.${
        f.activeGrants > 0 ? ` ${f.activeGrants} other grant${f.activeGrants === 1 ? "" : "s"} active.` : ""
      }`
      : f.activeGrants > 0
        ? `${f.activeGrants} active grant${f.activeGrants === 1 ? "" : "s"}.`
        : f.activeAgreements === 0
          ? "No partner has access yet — onboarding records the organisation, the written arrangement and the case link on the way to the grant."
          : "No partner has access yet.",
    blockedBy: !f.isMlro
      ? MLRO_NEEDED
      : !hasAttestation
        ? "Issue the attestation first"
        : null,
  });

  /* 5 · Ongoing honesty: re-check the attested facts against the case.
   *     On a deployment without the partner event outbox the server
   *     refuses every run — so the row says so BEFORE the click, instead
   *     of offering a button that always errors. */
  const outboxOff = f.materialChangeAvailable === false;
  rows.push({
    key: "material",
    label: "Check for material change",
    meaning:
      "Re-checks the attested facts against the case as it stands now. A genuine change flags the attestation and every grant for refresh — partners see safe refresh wording only, never the detail. No change means exactly that, and nothing moves.",
    state: !f.isMlro || !hasAttestation || outboxOff ? "blocked" : "anytime",
    detail: !hasAttestation
      ? "Nothing has been attested yet."
      : outboxOff
        ? "Reissuing the attestation is how a change reaches partners on this deployment."
        : refreshFlagged
          ? "A refresh is already flagged — reissue to resolve it."
          : "Run after anything material changes on the case.",
    blockedBy: !f.isMlro
      ? MLRO_NEEDED
      : !hasAttestation
        ? "Issue the attestation first"
        : outboxOff
          ? "Unavailable on this deployment — it needs the partner event outbox, which is not enabled"
          : null,
  });

  return rows;
}
