import type { AmlScreeningReadinessReading } from "./screeningReadiness";

/**
 * What Stage 5 requires of a case — and, separately, whether it can proceed.
 *
 * ── The correction this module carries ────────────────────────────────
 * An earlier revision modelled `pep` as a WAIVABLE scope: the client answered
 * "no" to the politically-exposed-person question and PEP screening was
 * marked waived. That was wrong, and it conflicted with infrastructure this
 * repository already has.
 *
 * `_shared/aml/partyScreening.pure.ts` already models PEP as a
 * DETERMINATION, not a check that may be skipped:
 *
 *   pepDeterminationCurrent(determination, now)   supersession + review_due_at
 *   PEP_DETERMINATION_REQUIRED_ROLES              co-purchaser, director,
 *                                                 trustee, beneficial owner,
 *                                                 authorised representative
 *   pepControlsSatisfied(...)                     determination → EDD → SoF → SoW
 *
 * A customer's own answer is EVIDENCE that may support a determination. It
 * is not the determination, and it is certainly not an exemption from making
 * one. So the vocabulary here is:
 *
 *   MANDATORY DETERMINATIONS   sanctions (TFS), pep
 *     — always required, never waivable, established rather than skipped.
 *
 *   RISK-BASED CONTROLS        adverse_media, watchlist
 *     — proportionate, driven by a policy assessment of the case's own risk
 *       evidence, with the customer's declaration as ONE input among many.
 *
 * `WAIVABLE_SCREENING_SCOPES` therefore contains neither `sanctions` nor
 * `pep`, and a test sweeps the input space to prove it.
 *
 * ── Executing is not completing ───────────────────────────────────────
 * The second correction. A live provider with a current list answers ONE
 * question: can the check run? It says nothing about whether the required
 * determinations have actually been made. Those are `canExecute` and
 * `canAdvance`, they are never aliases, and a case with a perfectly healthy
 * provider and no screening result yet has `canExecute === true` and
 * `canAdvance === false`.
 *
 * ── What this module is not ───────────────────────────────────────────
 * It decides nothing that binds. It reads canonical facts the server
 * supplies and reports what Stage 5 needs, what is outstanding and whose
 * move it is. Stage 5 completion is derived from evidence; it is not a flag
 * the browser sets, and completing it is not service-gate approval.
 */

export type AmlScreeningScope = "pep" | "sanctions" | "adverse_media" | "watchlist";

/**
 * Determinations that must be ESTABLISHED for every customer.
 *
 * `sanctions` because targeted financial sanctions are not risk-based.
 * `pep` because a PEP determination is an outcome to be reached, and the
 * repository already models it that way.
 */
export const MANDATORY_DETERMINATIONS: readonly AmlScreeningScope[] = [
  "sanctions", "pep",
] as const;

/**
 * The only scopes a risk policy may conclude are not proportionate.
 * Deliberately contains neither `sanctions` nor `pep`.
 */
export const WAIVABLE_SCREENING_SCOPES: readonly AmlScreeningScope[] = [
  "adverse_media", "watchlist",
] as const;

/** How a PEP determination was, or may be, reached. */
export type AmlPepDeterminationMethod =
  | "onboarding_declaration_supported"
  | "specialist_provider"
  | "open_source"
  | "manual_review"
  | "existing_verified_evidence";

export type AmlPepResult = "not_pep" | "pep" | "unresolved";

/** A determination as the canonical `aml.pep_determinations` row expresses it. */
export interface AmlPepDeterminationFacts {
  result: AmlPepResult;
  method?: AmlPepDeterminationMethod | string | null;
  determinedAt?: string | null;
  reviewDueAt?: string | null;
  supersededAt?: string | null;
}

/** The client's declarations. Evidence — never a conclusion. */
export interface AmlScreeningAnswers {
  pep?: "yes" | "no" | null;
  adverse?: "yes" | "no" | null;
  thirdParty?: "yes" | "no" | null;
  overseasFunding?: "yes" | "no" | null;
}

export interface AmlScreeningScopeFacts {
  answers: AmlScreeningAnswers | null;
  entityType?: string | null;
  subjectType?: string | null;
  riskRating?: string | null;
  enhancedDueDiligence?: boolean;
  /** The current PEP determination, if one has been recorded. */
  pepDetermination?: AmlPepDeterminationFacts | null;
  /** Sanctions screening outcome, from canonical party-screening state. */
  sanctionsState?: AmlCheckState | string | null;
  /**
   * Adverse-media outcome, from the same canonical state. Only consulted when
   * the risk policy has concluded the control IS proportionate — a control
   * the policy stood down is not waiting on a result.
   */
  adverseMediaState?: AmlCheckState | string | null;
  /**
   * A confirmed sanctions match exists SOMEWHERE on the case, even if the
   * aggregate state reports a different party's outstanding work. Escalation
   * must not be lost behind another party's unfinished check.
   */
  confirmedSanctionsMatch?: boolean;
  /** Likewise: some party is determined to be a PEP. */
  pepFinding?: boolean;
  /** Clock injection keeps this pure. */
  now?: string;
}

/** The canonical `aml.screening_checks.status` vocabulary. */
export type AmlCheckState =
  | "not_started" | "processing" | "clear"
  | "possible_match" | "confirmed_match" | "error";

/**
 * A check is resolved when it produced a real outcome. `error` is not one:
 * a failed check is not a clear result, and never advances a stage.
 */
function checkResolved(state: string): boolean {
  return state === "clear" || state === "confirmed_match";
}

/** The sentence a check state deserves, in an operator's words. */
function checkDetail(state: string, subject: string): string {
  switch (state) {
    case "clear": return `No ${subject} match was found.`;
    case "confirmed_match":
      return `A confirmed ${subject} match was recorded — downstream controls apply.`;
    case "possible_match": return `A possible ${subject} match needs adjudication.`;
    case "processing": return "The check is running.";
    case "error":
      return "The check could not complete. An error is never a clear result.";
    default: return "Not yet checked.";
  }
}

/** What to do next about an unresolved check. */
function checkOutstanding(state: string, subject: string): string {
  switch (state) {
    case "possible_match": return `Adjudicate the possible ${subject} match.`;
    case "error": return `The ${subject} check failed and must be re-run.`;
    case "processing": return `The ${subject} check is still running.`;
    default: return `Run the ${subject} check.`;
  }
}

export interface AmlDeterminationReading {
  scope: AmlScreeningScope;
  /**
   * Whether the OBLIGATION exists, as the server decided it. Not a statement
   * about whether anything was screened.
   */
  required: boolean;
  /**
   * True when the server recorded this scope as `not_required`. Kept separate
   * from `resolved` on purpose: a scope nobody had to screen is satisfied for
   * the stage and is NOT a result. Rendering it as "clear" would claim a
   * customer was screened and found nothing, which nobody did.
   */
  notRequired?: boolean;
  /** The server's reason code for a not-required scope. */
  reasonCode?: string;
  /** Resolved = this determination no longer holds Stage 5 open. */
  resolved: boolean;
  label: string;
  detail: string;
  /** Recorded basis, for the audit trail. */
  basis?: string;
}

/**
 * The server's per-scope decision, verbatim from `sync_screening_stage`.
 *
 * When this is present it is the AUTHORITY on what is required. The browser
 * still reads the evidence — whether a required check produced a result —
 * because that is a different question, but it no longer decides scope. A
 * compliance scope decided in a tab is not a decision anyone can audit, and
 * two derivations of one rule is how they drift.
 */
export interface AmlServerScopeDecision {
  scope: AmlScreeningScope;
  required: boolean;
  optional: boolean;
  state: "required" | "not_required";
  reason_code: string;
  reason: string;
}

export interface AmlScreeningScopeDecision {
  determinations: AmlDeterminationReading[];
  /** Risk controls the policy concluded are not proportionate, with a basis. */
  notRequiredByPolicy: Array<{ scope: AmlScreeningScope; basis: string }>;
  /**
   * Whether the required checks CAN be executed. Provider health only.
   * Never a statement about completion.
   */
  canExecute: boolean;
  /**
   * Whether Stage 5's evidence has actually resolved. The only thing that
   * may unlock Stage 6.
   */
  canAdvance: boolean;
  /** What is still outstanding, in words an operator can act on. */
  outstanding: string[];
  /**
   * A determination that RESOLVED but whose outcome demands escalation — a
   * confirmed sanctions match, or a PEP finding. Resolving a determination is
   * not the same as clearing a customer, and the most serious outcomes this
   * stage can produce are resolutions rather than blockers.
   */
  escalation: string | null;
  /** Whose move it is. */
  owner: "system" | "analyst" | "reviewer" | "administrator" | "none";
  summary: string;
}

const answered = (v: unknown): v is "yes" | "no" => v === "yes" || v === "no";

/**
 * Risk evidence that makes broader adverse-media research proportionate.
 * The customer's own declaration is one input and never the only one — a
 * customer cannot know what has been reported about them.
 */
function adverseMediaTriggers(f: AmlScreeningScopeFacts): string[] {
  const out: string[] = [];
  const risk = String(f.riskRating ?? "").toLowerCase();
  if (risk === "high" || risk === "prohibited") out.push(`the case is rated ${risk} risk`);
  if (f.enhancedDueDiligence) out.push("the case is in enhanced due diligence");
  if (f.pepDetermination?.result === "pep" || f.pepFinding) {
    out.push("a party to this case is a politically exposed person");
  }
  const entity = String(f.entityType ?? f.subjectType ?? "").toLowerCase();
  if (entity && entity !== "individual" && entity !== "individuals") {
    out.push(`the customer is a ${entity} rather than an individual`);
  }
  if (f.answers?.overseasFunding === "yes") out.push("funds are coming from overseas");
  if (f.answers?.thirdParty === "yes") out.push("a third party is involved in the purchase");
  if (f.answers?.adverse === "yes") out.push("the customer disclosed adverse media");
  return out;
}

/** Is the recorded determination usable right now? Mirrors the server rule. */
function determinationCurrent(
  d: AmlPepDeterminationFacts | null | undefined, nowIso: string,
): boolean {
  if (!d || d.supersededAt) return false;
  if (d.reviewDueAt && d.reviewDueAt < nowIso) return false;
  return d.result === "not_pep" || d.result === "pep";
}

export function deriveAmlScreeningScope(
  facts: AmlScreeningScopeFacts | null | undefined,
  readiness?: AmlScreeningReadinessReading | null,
  serverScopes?: AmlServerScopeDecision[] | null,
): AmlScreeningScopeDecision {
  const f: AmlScreeningScopeFacts = facts ?? { answers: null };
  const nowIso = f.now ?? new Date().toISOString();
  const determinations: AmlDeterminationReading[] = [];
  const outstanding: string[] = [];

  /*
   * The server's decision, when there is one. Absent it, everything is
   * required — the same answer this module always gave, and the safe one.
   *
   * ── When the server sends TWO decisions for one scope ─────────────────
   * This was `new Map(serverScopes.map((x) => [x.scope, x]))`: last wins,
   * and the order is whatever the read returned. No case in production holds
   * duplicate live scope rows today, and the recorder has been hardened so a
   * concurrent sync cannot leave a pair behind — but this is the layer that
   * DECIDES, and it should not be the layer that assumes.
   *
   * A contradiction resolves toward the OBLIGATION. Sanctions bind every
   * dealing under the Charter of the UN Act 1945 and the Autonomous
   * Sanctions Act 2011; they are the one control risk cannot stand down, and
   * a disagreement must never read as an exemption. Being wrong this way
   * costs a screening nobody strictly owed. Being wrong the other way is a
   * dealing that was never screened.
   */
  const byScope = new Map<string, AmlServerScopeDecision>();
  for (const decision of serverScopes ?? []) {
    const key = String(decision.scope);
    const held = byScope.get(key);
    if (!held || (!held.required && decision.required)) byScope.set(key, decision);
  }
  const serverSays = (scope: AmlScreeningScope) => byScope.get(scope) ?? null;
  const isRequired = (scope: AmlScreeningScope, fallback: boolean) => {
    const d = serverSays(scope);
    return d ? d.required : fallback;
  };
  /**
   * A scope the policy did not require is SATISFIED for the stage and is not
   * a result. Both facts are said in one place so no caller can take the
   * first and quietly imply the second.
   */
  const notRequiredReading = (
    scope: AmlScreeningScope, label: string,
  ): AmlDeterminationReading => {
    const d = serverSays(scope)!;
    return {
      scope, required: false, notRequired: true, resolved: true,
      reasonCode: d.reason_code,
      label,
      detail: `Not required under AML/CTF policy. ${d.reason}`,
      basis: d.reason,
    };
  };

  /* ── Targeted financial sanctions ────────────────────────────────── */
  const s = String(f.sanctionsState ?? "not_started");
  const sanctionsRequired = isRequired("sanctions", true);
  const sanctionsResolved = checkResolved(s);
  if (!sanctionsRequired) {
    determinations.push(notRequiredReading("sanctions", "Targeted financial sanctions"));
  } else {
    determinations.push({
      scope: "sanctions",
      required: true,
      resolved: sanctionsResolved,
      label: "Targeted financial sanctions",
      detail: checkDetail(s, "sanctions"),
    });
    if (!sanctionsResolved) outstanding.push(checkOutstanding(s, "sanctions"));
  }

  /* ── PEP — a determination to be REACHED, never waived ───────────── */
  const d = f.pepDetermination;
  const pepRequired = isRequired("pep", true);
  const pepResolved = determinationCurrent(d, nowIso);
  const declaration = f.answers?.pep;

  if (!pepRequired) {
    determinations.push(notRequiredReading("pep", "Politically exposed person"));
  } else {
  determinations.push({
    scope: "pep",
    required: true,
    resolved: pepResolved,
    label: "Politically exposed person",
    detail: pepResolved
      ? d!.result === "pep"
        ? "Determined — politically exposed person. The applicable controls apply."
        : "Determined — not a politically exposed person."
      : d?.supersededAt
        ? "The previous determination was superseded and must be made again."
        : d && d.reviewDueAt && d.reviewDueAt < nowIso
          ? "The determination is past its review date and must be reassessed."
          : d?.result === "unresolved"
            ? "The determination could not be reached and needs review."
            : "No determination has been recorded yet.",
    basis: pepResolved && d?.method ? `Method: ${String(d.method)}` : undefined,
  });
  if (!pepResolved) {
    // The declaration selects a ROUTE. It never substitutes for the outcome.
    outstanding.push(
      answered(declaration) && declaration === "no"
        ? "Record the PEP determination. The customer's declaration supports the " +
          "low-risk determination route but is not itself the determination."
        : "Record the PEP determination.",
    );
  }
  }

  /* ── Adverse media — risk-based, policy-driven ───────────────────── */
  const notRequiredByPolicy: AmlScreeningScopeDecision["notRequiredByPolicy"] = [];
  const triggers = adverseMediaTriggers(f);
  const answersRead = Boolean(f.answers) && answered(f.answers?.adverse);
  const adverseServer = serverSays("adverse_media");
  if (adverseServer && !adverseServer.required) {
    determinations.push(notRequiredReading("adverse_media", "Adverse media"));
    notRequiredByPolicy.push({ scope: "adverse_media", basis: adverseServer.reason });
  } else if (adverseServer?.required || triggers.length > 0) {
    const a = String(f.adverseMediaState ?? "not_started");
    const adverseResolved = checkResolved(a);
    determinations.push({
      scope: "adverse_media", required: true, resolved: adverseResolved,
      label: "Adverse media",
      detail: adverseResolved
        ? checkDetail(a, "adverse media")
        : `Additional research is proportionate because ${triggers.join(", and ")}.`,
      basis: `Required by risk policy: ${triggers.join("; ")}.`,
    });
    if (!adverseResolved) outstanding.push(checkOutstanding(a, "adverse media"));
  } else if (!answersRead) {
    // Unknown risk evidence is not a low-risk profile.
    determinations.push({
      scope: "adverse_media", required: true, resolved: false,
      label: "Adverse media",
      detail: "The case's risk evidence has not been read, so the control cannot be stood down.",
    });
    outstanding.push("Read the case's risk evidence before standing adverse media down.");
  } else {
    notRequiredByPolicy.push({
      scope: "adverse_media",
      basis:
        "Additional adverse-media research is not triggered for this profile under the " +
        "current AML/CTF policy: the customer is an individual, the case is not high risk " +
        "or in enhanced due diligence, no PEP finding applies, and there is no overseas " +
        "funding or third-party involvement.",
    });
  }

  /* ── Executing is not completing ─────────────────────────────────── */
  const canExecute = readiness ? readiness.canRun : false;
  const canAdvance = determinations.every((x) => x.resolved);

  const escalation =
    s === "confirmed_match" || f.confirmedSanctionsMatch
      ? "A confirmed targeted financial sanctions match is recorded. This case must " +
        "be escalated to the AML/CTF Compliance Officer immediately, and completing " +
        "this stage does not permit the case to proceed to service."
      : (pepResolved && d?.result === "pep") || f.pepFinding
        ? "A party to this case is determined to be a politically exposed person. " +
          "Enhanced due diligence, source of funds and source of wealth controls apply " +
          "before the case may proceed to service."
        : null;

  const owner: AmlScreeningScopeDecision["owner"] =
    escalation ? "reviewer"
      : canAdvance ? "none"
        : readiness && !readiness.canRun ? "administrator"
          : s === "possible_match" ? "analyst"
            : s === "processing" ? "system"
              : "analyst";

  return {
    determinations,
    notRequiredByPolicy,
    canExecute,
    canAdvance,
    outstanding,
    escalation,
    owner,
    summary: canAdvance
      ? "All required Stage 5 determinations are resolved."
      : outstanding.length === 1
        ? outstanding[0]
        : `${outstanding.length} determinations are still outstanding.`,
  };
}

/* ───────────────────── Who gets screened, and where they are ─────────────
 *
 * The subject list is NOT maintained here. It is read from
 * `aml.party_screening_subjects` via `list_party_screening`, which the server
 * derives from the reconciled parties — co-purchasers, directors, trustees,
 * beneficial owners and authorised representatives included. This function
 * only READS those canonical rows and reports the case-level position they
 * add up to, so that a case is never reported as settled while one party's
 * work is outstanding.
 */

/** One canonical `aml.party_screening_subjects` row, as facts. */
export interface AmlScreeningSubjectFacts {
  id: string;
  name: string;
  partyType: string;
  /** The server's own judgement of whether this party must be screened. */
  required: boolean;
  /** The canonical subject state, verbatim. */
  state: string;
  pepDetermination?: AmlPepDeterminationFacts | null;
}

export interface AmlScreeningSubjectReading extends AmlScreeningSubjectFacts {
  sanctions: { state: AmlCheckState; resolved: boolean; detail: string };
  pep: { resolved: boolean; detail: string };
  outstanding: string[];
}

export interface AmlCaseScreeningPosition {
  subjects: AmlScreeningSubjectReading[];
  /** Facts to hand to `deriveAmlScreeningScope`. Never invented. */
  facts: Pick<AmlScreeningScopeFacts,
    "sanctionsState" | "pepDetermination" | "confirmedSanctionsMatch" | "pepFinding">;
  /** False when the subject list has not been read — which is not "nobody". */
  read: boolean;
}

/** Canonical subject state → the check vocabulary. Unknown fails closed. */
function subjectCheckState(state: string): AmlCheckState {
  switch (state) {
    case "completed": case "false_positive": return "clear";
    case "confirmed_match": return "confirmed_match";
    case "possible_match": return "possible_match";
    case "error": return "error";
    case "queued": case "processing": return "processing";
    default: return "not_started";
  }
}

/** Most-blocking first. The case reports the state that still needs someone. */
const STATE_PRECEDENCE: AmlCheckState[] = [
  "possible_match", "error", "not_started", "processing", "confirmed_match", "clear",
];

export function readCaseScreeningPosition(
  subjects: AmlScreeningSubjectFacts[] | null | undefined,
  nowIso: string,
): AmlCaseScreeningPosition {
  if (!subjects) {
    // An unread list is not an empty one, and an empty one is not "clear".
    return { subjects: [], facts: { sanctionsState: "not_started" }, read: false };
  }
  const required = subjects.filter((s) => s.required);

  const readings: AmlScreeningSubjectReading[] = subjects.map((s) => {
    const state = subjectCheckState(s.state);
    const resolved = checkResolved(state);
    const pepResolved = determinationCurrent(s.pepDetermination, nowIso);
    const outstanding: string[] = [];
    if (s.required && !resolved) outstanding.push(checkOutstanding(state, "sanctions"));
    if (s.required && !pepResolved) outstanding.push("Record the PEP determination.");
    return {
      ...s,
      sanctions: { state, resolved, detail: checkDetail(state, "sanctions") },
      pep: {
        resolved: pepResolved,
        detail: pepResolved
          ? s.pepDetermination!.result === "pep"
            ? "Determined — politically exposed person."
            : "Determined — not a politically exposed person."
          : "No current determination.",
      },
      outstanding,
    };
  });

  const requiredReadings = readings.filter((r) => r.required);
  const sanctionsState = required.length === 0
    // No party requires screening yet — reconciliation has not produced one.
    // That is "nothing has been checked", never "everything is clear".
    ? "not_started"
    : STATE_PRECEDENCE.find(
      (p) => requiredReadings.some((r) => r.sanctions.state === p)) ?? "not_started";

  // The weakest PEP position carries the case: one party without a current
  // determination holds Stage 5 open however many others have one.
  const unresolved = requiredReadings.find((r) => !r.pep.resolved);
  const pepDetermination = required.length === 0
    ? null
    : unresolved
      ? unresolved.pepDetermination ?? null
      : requiredReadings[0]?.pepDetermination ?? null;

  return {
    subjects: readings,
    facts: {
      sanctionsState,
      pepDetermination,
      confirmedSanctionsMatch: requiredReadings.some(
        (r) => r.sanctions.state === "confirmed_match"),
      pepFinding: requiredReadings.some(
        (r) => r.pep.resolved && r.pepDetermination?.result === "pep"),
    },
    read: true,
  };
}

/**
 * What Stage 5 should say, combining WHAT is required with WHETHER it can run.
 *
 * The pairing exists because the two fail independently: a case whose
 * determinations are all resolved is complete even if nobody looks at it,
 * and a case with a healthy provider and no results is not.
 */
/**
 * Scopes the sanctions PROVIDER actually serves.
 *
 * PEP is not among them: a PEP determination is reached and recorded, not
 * fetched from `local_lists`. That is why a case whose only outstanding work
 * is PEP must never be told the provider is broken.
 */
const PROVIDER_BACKED_SCOPES: readonly AmlScreeningScope[] =
  ["sanctions", "adverse_media", "watchlist"] as const;

export function describeScreeningStage(
  scope: AmlScreeningScopeDecision,
  readiness: AmlScreeningReadinessReading | null,
  /**
   * Whether provider readiness bears on this case at all — the server's
   * `provider_relevant`. Omitted, it is derived from the scope decision, so
   * an older server degrades to the same answer rather than to a wrong one.
   */
  providerRelevant?: boolean,
): { headline: string; canProceed: boolean; detail: string; whatHappensNext: string } {
  /*
   * ── Readiness is only a blocker for a scope that needs it ──────────
   *
   * This used to short-circuit on `readiness.canRun` alone. So a case whose
   * sanctions scope had been stood down, with only a PEP determination left,
   * was headlined "Screening cannot run yet — an administrator must restore
   * the screening provider and sanctions data": a blocker about a provider
   * the case does not use, hiding the one piece of work that was actually
   * outstanding.
   */
  const relevant = providerRelevant ?? scope.determinations.some(
    (d) => d.required && PROVIDER_BACKED_SCOPES.includes(d.scope));
  if (scope.canAdvance) {
    return {
      headline: scope.escalation ? "Stage 5 complete — escalation required" : "Stage 5 complete",
      canProceed: true,
      detail: scope.escalation ?? scope.summary,
      whatHappensNext:
        (scope.escalation ? `${scope.escalation} ` : "") +
        "Stage 5 is complete. Continue to Stage 6 — Funding & transaction. " +
        "Completing this stage is not a service-gate decision and does not itself " +
        "approve the case or issue an Aurixa Compliance Passport.",
    };
  }
  if (relevant && readiness && !readiness.canRun) {
    return {
      headline: "Screening cannot run yet",
      canProceed: false,
      // Never "not required": the mandatory determinations are outstanding.
      detail: "The required checks cannot execute until the screening configuration is fixed.",
      whatHappensNext:
        "An administrator must restore the screening provider and sanctions data. " +
        "No client action is required.",
    };
  }
  return {
    headline: "Action required",
    canProceed: false,
    detail: scope.summary,
    whatHappensNext:
      `${scope.outstanding[0] ?? "Resolve the outstanding determinations."} ` +
      "Stage 6 becomes available once Stage 5's determinations resolve.",
  };
}
