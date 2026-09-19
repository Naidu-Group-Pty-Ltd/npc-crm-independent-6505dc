/**
 * Reopening a closed AML/CTF case.
 *
 * ── Why there was no way back ─────────────────────────────────────────
 * `TRANSITIONS` in `aml-cases` declares `closed: []`. Closed is terminal, so
 * no operation anywhere could move a case out of it. Opening a closed client
 * showed Stage 1, "Case closed", and nothing to press — because there
 * genuinely was nothing.
 *
 * ── What reopening is, and what it is not ─────────────────────────────
 * It is NOT "set the status back to active". Three things were decided when
 * the case closed, and reopening must treat them differently:
 *
 *   THE JOURNEY      is resumed. Documents, verifications, determinations and
 *                    completed stages are evidence — they survive, and the
 *                    client picks up where they left off rather than being
 *                    made to start again.
 *
 *   THE CLIENT LINK  is re-established. Portal access was revoked on close,
 *                    so the invitation has to be reissued or the customer is
 *                    locked out of a journey they are being asked to resume.
 *
 *   THE DECISIONS    are NOT reversed. A terminated service gate and a
 *                    revoked passport were deliberate acts by a person. A
 *                    reopen restores the ABILITY to work the case; it does
 *                    not restore permission to serve. That needs a fresh
 *                    decision, made deliberately, by someone with authority.
 *
 * Collapsing the third into the first is the dangerous version of this
 * feature: a case that was terminated for cause would silently become
 * serviceable again because somebody wanted to correct a mis-click.
 *
 * ── Consents ──────────────────────────────────────────────────────────
 * A consent is given to a VERSION of a document. If the programme version has
 * moved since the client accepted, the old acceptance is evidence of what
 * they agreed to then — not authority for what we do now. Those are listed
 * for re-acceptance; the ones still on the current version are not, because
 * asking a customer to re-tick an unchanged document is friction with no
 * compliance value.
 */

export type ReopenReissue =
  | "portal_access"
  | "consents"
  | "screening_refresh"
  | "risk_reassessment";

export interface CaseReopenFacts {
  caseId: string;
  caseReference: string;
  /** The legacy `cases.status` dimension. */
  status: string;
  /**
   * The CANONICAL `cases.case_stage` dimension.
   *
   * Both are views of one lifecycle and a case is closed if EITHER says so.
   * That is not belt-and-braces, it is the fix for a measured production
   * state: `reopen_case` used to move `status` and leave `case_stage`, so a
   * case could sit at `case_stage='closed'` with `status='kyc_complete'` —
   * and then this refused to reopen it ("not closed, so there is nothing to
   * reopen") while every other surface, correctly, called it closed. The
   * operator was shown the one action that could resolve the case and it was
   * the one action that could not run.
   *
   * Absent means "not supplied", never "not closed".
   */
  caseStage?: string | null;
  serviceGateStatus: string | null;
  /** Consents already accepted, with the version they were accepted against. */
  consents: Array<{ kind: string; version: string | null }>;
  /** The versions currently in force. */
  currentConsentVersions: Record<string, string>;
  /** Whether a portal user record exists for the client at all. */
  hasPortalUser: boolean;
  /** Screening subjects and when each was last screened. */
  screening: Array<{ state: string; lastScreenedAt: string | null }>;
  /** Freshness window for a previous screening result, in days. */
  screeningFreshnessDays?: number;
  roles: string[];
  /** Why the case is being reopened. Recorded, and required. */
  reason: string | null;
  now?: string;
}

export interface CaseReopenPlan {
  allowed: boolean;
  code: "ok" | "not_closed" | "role_required" | "reason_required";
  /** What must be re-established before the journey can continue. */
  reissue: ReopenReissue[];
  /** What survives untouched, stated so nobody fears losing it. */
  preserved: string[];
  /** Consent kinds whose accepted version is no longer current. */
  staleConsents: string[];
  /** Decisions a reopen deliberately does NOT reverse. */
  notRestored: string[];
  summary: string;
}

const REOPEN_ROLES = ["mlro", "admin", "superadmin", "reviewer"];
const DEFAULT_SCREENING_FRESHNESS_DAYS = 90;

export function planCaseReopen(facts: CaseReopenFacts): CaseReopenPlan {
  const preserved = [
    "Every uploaded document and its review outcome.",
    "Identity verification history and its attempts.",
    "Screening subjects, determinations and adjudications.",
    "The questionnaire the client already completed.",
    "The full case event chain, including the closure itself.",
  ];

  const base: CaseReopenPlan = {
    allowed: false, code: "ok", reissue: [], preserved,
    staleConsents: [], notRestored: [], summary: "",
  };

  // Closed on EITHER dimension. Reopening a case that only one of them calls
  // closed is exactly how the two are brought back into agreement, so
  // refusing on a disagreement leaves the record stuck in it for ever.
  const closed = facts.status === "closed" || facts.caseStage === "closed";
  if (!closed) {
    return {
      ...base, code: "not_closed",
      summary: `${facts.caseReference} is not closed, so there is nothing to reopen.`,
    };
  }

  const roles = new Set(facts.roles.map((r) => r.toLowerCase()));
  if (!REOPEN_ROLES.some((r) => roles.has(r))) {
    return {
      ...base, code: "role_required",
      summary: "Reopening a closed case requires a reviewer, the MLRO or an administrator.",
    };
  }

  // A reason is not paperwork. It is the thing an auditor reads to understand
  // why a closed case was worked again.
  if (!facts.reason || facts.reason.trim().length < 10) {
    return {
      ...base, code: "reason_required",
      summary: "Record why this case is being reopened — at least a sentence.",
    };
  }

  /* ── What must be re-established ──────────────────────────────────── */
  const reissue: ReopenReissue[] = [];

  // Portal access is revoked on close, so the customer cannot reach a journey
  // they are being asked to resume.
  reissue.push("portal_access");

  const staleConsents: string[] = [];
  for (const [kind, current] of Object.entries(facts.currentConsentVersions)) {
    const accepted = facts.consents.find((c) => c.kind === kind);
    // Never accepted, or accepted against a superseded version.
    if (!accepted || !accepted.version || accepted.version !== current) {
      staleConsents.push(kind);
    }
  }
  if (staleConsents.length > 0) reissue.push("consents");

  // A screening result ages. Reopening months later and treating the old
  // result as current is how a case proceeds on evidence that has expired.
  const nowMs = Date.parse(facts.now ?? new Date().toISOString());
  const windowMs = (facts.screeningFreshnessDays ?? DEFAULT_SCREENING_FRESHNESS_DAYS)
    * 24 * 60 * 60 * 1000;
  const screeningStale = facts.screening.some((s) => {
    if (!s.lastScreenedAt) return true;
    const at = Date.parse(s.lastScreenedAt);
    return !Number.isFinite(at) || nowMs - at > windowMs;
  });
  if (facts.screening.length > 0 && screeningStale) reissue.push("screening_refresh");

  // Risk was rated against a picture that has since been closed and reopened.
  reissue.push("risk_reassessment");

  /* ── What a reopen deliberately does NOT undo ─────────────────────── */
  const notRestored: string[] = [];
  const gate = String(facts.serviceGateStatus ?? "");
  if (gate === "terminated" || gate === "blocked") {
    notRestored.push(
      `The service gate stays ${gate}. Reopening restores the ability to work the `
      + "case, not permission to serve — that needs a fresh gate decision.",
    );
  }
  notRestored.push(
    "Any issued compliance passport stays as it is. A passport is evidence held "
    + "by a third party and is not re-minted by reopening.",
  );

  return {
    allowed: true, code: "ok", reissue, preserved, staleConsents, notRestored,
    summary:
      `${facts.caseReference} will be reopened and resumed. `
      + `${reissue.length} item(s) are reissued; everything already gathered is kept.`,
  };
}

/**
 * Where the journey picks up.
 *
 * Deliberately derived from the evidence that already exists rather than
 * reset to Stage 1 — the whole point is that the client is not made to start
 * again. The status returned is the earliest state consistent with what has
 * been gathered, so the existing stage derivation lands them at the right
 * place without a second, competing notion of "current stage".
 */
export function resumeStatusFor(facts: {
  hasSubmission: boolean;
  hasCompletedScreening: boolean;
  hasRiskAssessment: boolean;
}): string {
  if (facts.hasCompletedScreening && facts.hasRiskAssessment) return "under_review";
  if (facts.hasSubmission) return "kyc_complete";
  return "kyc_in_progress";
}
