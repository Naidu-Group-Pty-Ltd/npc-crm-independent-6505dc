/**
 * Who Stage 5 screens, what it screens them for, and what a person still has
 * to do about it. Server-side and authoritative.
 *
 * ── The defect this exists to fix ─────────────────────────────────────
 * `party_screening_subjects` was written in exactly ONE place: when an
 * operator resolved a related-party reconciliation item. Nothing ever
 * enrolled the CASE SUBJECT — the customer the case is about.
 *
 * `partyScreening.pure.ts` states the intent it never implemented:
 *
 *   "The case subject is always assessed; this list covers reconciled
 *    related parties."
 *
 * So a straightforward individual purchase — no co-purchasers, no gift
 * donors, nothing to reconcile — produced zero reconciliation items, zero
 * screening subjects, and a Stage 5 with nothing to run and nothing to
 * press. Measured across production: 0 subjects on all 6 cases, including
 * one with three submitted questionnaires.
 *
 * The operator's reading of that screen — "this client must not need
 * screening" — was reasonable and wrong. Nobody had been enrolled.
 *
 * ── What this module decides, and what it refuses to ──────────────────
 * It decides two things and persists neither (the caller does):
 *
 *   1. WHO must be enrolled. The case subject always; reconciled related
 *      parties in the roles the program identifies.
 *
 *   2. WHICH scopes are proportionate. Adverse media and internal
 *      watchlists are risk-based and may be stood down against a recorded
 *      basis. **Sanctions and PEP never can.** They are mandatory
 *      determinations that get ESTABLISHED, not skipped, and no answer,
 *      rating or profile removes them.
 *
 * It refuses to decide a screening OUTCOME. Nothing here produces "clear",
 * "no match" or a PEP result. Those come from the provider and from a
 * recorded determination, and a fabricated one is the most dangerous thing
 * this platform could emit.
 */

/** Party types the program screens, beyond the case subject itself. */
export const SCREENED_RELATED_ROLES = [
  "co_purchaser", "director", "trustee", "beneficial_owner", "authorised_representative",
] as const;

/** The case subject's own party type. Always enrolled, always required. */
export const PRIMARY_SUBJECT_PARTY_TYPE = "primary_subject";

export type ScreeningScopeKey = "sanctions" | "pep" | "adverse_media" | "watchlist";

/** Never stood down by any input. See the header. */
export const MANDATORY_SCOPES: readonly ScreeningScopeKey[] = ["sanctions", "pep"] as const;
/** The only scopes a risk policy may conclude are not proportionate. */
export const RISK_BASED_SCOPES: readonly ScreeningScopeKey[] = ["adverse_media", "watchlist"] as const;

/** Every scope the programme knows about, in display order. */
export const ALL_SCREENING_SCOPES: readonly ScreeningScopeKey[] =
  ["sanctions", "pep", "adverse_media", "watchlist"] as const;

/**
 * Bump when the rule below changes meaning. It is stamped on every recorded
 * decision so an audit can tell which policy produced which outcome, and so
 * a re-evaluation under a new rule is visibly a new decision rather than a
 * silent overwrite.
 */
export const SCREENING_POLICY_VERSION = "2026.08-1";

export interface ScreeningAnswers {
  pep: "yes" | "no" | null;
  adverse: "yes" | "no" | null;
  thirdParty: "yes" | "no" | null;
  overseasFunding: "yes" | "no" | null;
}

export interface ScreeningPolicyInput {
  answers: ScreeningAnswers | null;
  entityType: string | null;
  riskRating: string | null;
  enhancedDueDiligence: boolean;
  /** Any party on the case already determined to be a PEP. */
  anyPepFinding: boolean;
}

export interface ScreeningPolicyDecision {
  /** Scopes this case must complete. Always contains sanctions and pep. */
  required: ScreeningScopeKey[];
  /** Risk-based scopes the policy concluded are not proportionate. */
  notRequired: Array<{ scope: ScreeningScopeKey; basis: string }>;
  /** Why the risk-based scopes ARE required, when they are. */
  triggers: string[];
  /**
   * Whether the client's declaration is complete enough to support the
   * low-risk PEP determination route. It selects a ROUTE. It is never the
   * determination and never a waiver.
   */
  pepRoute: "declaration_supported" | "manual_review";
  /** The answers this decision was made on, verbatim, for the audit trail. */
  evidence: Record<string, string>;
  policyVersion: string;
  /** One sentence an operator and an auditor can both read. */
  summary: string;
}

const answered = (v: unknown): v is "yes" | "no" => v === "yes" || v === "no";

/** An entity customer is anything that is not a natural person. */
function isIndividual(entityType: string | null): boolean {
  const t = String(entityType ?? "").trim().toLowerCase();
  return t === "individual" || t === "individuals" || t === "sole" || t === "natural_person";
}

/**
 * Risk evidence that makes broader adverse-media research proportionate.
 *
 * The customer's own declaration is ONE input and never the only one — a
 * customer cannot know what has been reported about them, and a customer
 * with something to hide is exactly the one who answers "no".
 */
export function adverseMediaTriggers(input: ScreeningPolicyInput): string[] {
  const out: string[] = [];
  const risk = String(input.riskRating ?? "").trim().toLowerCase();
  if (risk === "high" || risk === "prohibited") out.push(`the case is rated ${risk} risk`);
  if (input.enhancedDueDiligence) out.push("the case is in enhanced due diligence");
  if (input.anyPepFinding) out.push("a party to this case is a politically exposed person");
  if (input.entityType && !isIndividual(input.entityType)) {
    out.push(`the customer is a ${String(input.entityType).toLowerCase()} rather than an individual`);
  }
  if (input.answers?.overseasFunding === "yes") out.push("funds are coming from overseas");
  if (input.answers?.thirdParty === "yes") out.push("a third party is involved in the purchase");
  if (input.answers?.adverse === "yes") out.push("the customer disclosed adverse media");
  return out;
}


/* ══════════════════════ The sanctions perimeter ══════════════════════ */

/**
 * Whether this case is one the sanctions obligation attaches to at all.
 *
 * ── Why the perimeter, and not the risk rating ────────────────────────
 * Targeted financial sanctions under the Charter of the United Nations Act
 * 1945 and the Autonomous Sanctions Act 2011 bind every person and every
 * dealing. They are not a risk-based control, and no rating, profile or
 * questionnaire answer reduces them — which is why this module refused for
 * so long to let anything stand sanctions down, and why "low risk" is the
 * one basis that must never appear here.
 *
 * What CAN be true is that a case is not a dealing at all. A record opened
 * for an enquiry that never became an engagement, an administrative
 * duplicate of the case that actually carries the CDD, a service declined
 * before it commenced — in none of those is NPC providing a designated
 * service, so there is nothing for the obligation to attach to. That is a
 * question of PERIMETER, and it is answerable from stored facts.
 *
 * ── Why it is recorded rather than inferred ───────────────────────────
 * Nothing on the case says today whether a designated service is being
 * provided; the concept exists in the agreements and the consent catalogue
 * and nowhere in the schema. Inferring it from incidental columns — an empty
 * `purchase_file_id`, a terminated service gate — would be guessing about
 * the one fact this whole exemption rests on, and a wrong guess reads as
 * "no sanctions screening required" on a case that needed it.
 *
 * So the perimeter is an explicit classification a reviewer or MLRO records,
 * with a reason code from a fixed list, and the DEFAULT IS ALWAYS INSIDE.
 * An unclassified case is in the perimeter. A case whose classification
 * cannot be read is in the perimeter. There is no input to this module that
 * produces an exemption by accident.
 */
export type PerimeterClassification = "designated_service" | "outside_perimeter";

/**
 * Why a case sits outside the perimeter. A fixed list rather than free text,
 * because an exemption defended by prose nobody can aggregate is not
 * defensible at all.
 */
export const PERIMETER_REASON_CODES = [
  "no_designated_service",
  "enquiry_only",
  "duplicate_record",
  "service_declined_pre_commencement",
] as const;
export type PerimeterReasonCode = (typeof PERIMETER_REASON_CODES)[number];

export const PERIMETER_REASON_TEXT: Record<PerimeterReasonCode, string> = {
  no_designated_service:
    "No designated service is being, or will be, provided to this customer on " +
    "this case.",
  enquiry_only:
    "This record exists for an enquiry or quotation only. The customer " +
    "relationship was never entered into.",
  duplicate_record:
    "This is an administrative duplicate. The customer's identification and " +
    "screening are carried by the case this one duplicates.",
  service_declined_pre_commencement:
    "The service was declined before it commenced, so no designated service " +
    "was provided.",
};

export interface PerimeterRecord {
  classification: PerimeterClassification;
  reasonCode: PerimeterReasonCode | null;
  /**
   * Which obligations the finding removes. Recorded rather than assumed: a
   * perimeter finding is not automatically a finding about every control,
   * and defaulting it to "all of them" would silently stand down PEP on the
   * strength of a sanctions decision.
   */
  scopesExcluded: ScreeningScopeKey[];
  recordedByLabel: string | null;
  recordedAt: string | null;
  /**
   * Whether anybody has actually DECIDED this, as distinct from the default.
   *
   * `classification` cannot carry it: an unclassified case and a case
   * deliberately recorded as inside both read `designated_service`, because
   * the default is inside and must stay inside. They are the same obligation
   * and a different operator situation — one needs a decision, the other has
   * had one — and Stage 5 has to tell them apart to know what to ask for.
   *
   * A malformed or unreadable row counts as UNCLASSIFIED: the sanctions
   * requirement still fails closed, and the operator is still asked to
   * decide rather than being told a decision exists that cannot be read.
   */
  classified: boolean;
}

/**
 * Read a stored perimeter row into a decision this module will act on.
 *
 * Anything malformed, unknown or absent resolves to INSIDE the perimeter.
 * This function has no path that turns bad data into an exemption.
 */
export function readPerimeter(row: unknown): PerimeterRecord {
  const inside: PerimeterRecord = {
    classification: "designated_service", reasonCode: null,
    scopesExcluded: [], recordedByLabel: null, recordedAt: null,
    classified: false,
  };
  if (!row || typeof row !== "object") return inside;
  const r = row as Record<string, unknown>;
  if (r.superseded_at) return inside;
  // An operative row recorded as INSIDE is a decision, and says so.
  if (String(r.classification ?? "") === "designated_service") {
    return {
      ...inside,
      classified: true,
      recordedByLabel: typeof r.recorded_by_label === "string" ? r.recorded_by_label : null,
      recordedAt: typeof r.recorded_at === "string" ? r.recorded_at : null,
    };
  }
  if (String(r.classification ?? "") !== "outside_perimeter") return inside;
  const code = String(r.reason_code ?? "");
  if (!(PERIMETER_REASON_CODES as readonly string[]).includes(code)) return inside;
  const excluded = Array.isArray(r.scopes_excluded)
    ? (r.scopes_excluded as unknown[])
      .map((s) => String(s))
      .filter((s): s is ScreeningScopeKey =>
        (ALL_SCREENING_SCOPES as readonly string[]).includes(s))
    : [];
  // A perimeter finding that excludes nothing is not an exemption.
  if (excluded.length === 0) return inside;
  return {
    classification: "outside_perimeter",
    classified: true,
    reasonCode: code as PerimeterReasonCode,
    scopesExcluded: [...new Set(excluded)],
    recordedByLabel: typeof r.recorded_by_label === "string" ? r.recorded_by_label : null,
    recordedAt: typeof r.recorded_at === "string" ? r.recorded_at : null,
  };
}

/* ══════════════════════ The canonical scope engine ══════════════════════ */

/** One scope's outcome. `required` and `optional` are independent facts. */
export interface ScopeOutcome {
  scope: ScreeningScopeKey;
  required: boolean;
  /**
   * Whether an authorised operator may run this scope voluntarily. A scope
   * that is not required is always optional — never unavailable — because
   * "we did not have to" is not a reason to prevent someone who wants to.
   */
  optional: boolean;
  reasonCode: string;
  reason: string;
}

export interface ScreeningScopeInput extends ScreeningPolicyInput {
  /** The stored perimeter classification for this case, if any. */
  perimeter?: unknown;
}

export interface ScreeningScopeDecision {
  sanctions: ScopeOutcome;
  pep: ScopeOutcome;
  adverse_media: ScopeOutcome;
  watchlist: ScopeOutcome;
  perimeter: PerimeterRecord;
  policyVersion: string;
  /** Verbatim inputs the decision was made on, for reconstruction. */
  evidence: Record<string, string>;
}

/**
 * Every screening scope, decided independently, server-side.
 *
 * The scopes do not travel together. A case can be sanctions `not_required`
 * with PEP still mandatory, or the reverse, and each carries its own reason
 * code — because they answer to different obligations and coupling them
 * would mean one finding silently standing down a control nobody assessed.
 *
 * `not_required` means ONE thing: no obligation to perform this screening
 * arose under the policy in force. It is not "clear", not "no match" and not
 * "screened". Nothing in this module produces a screening outcome.
 */
export function deriveScreeningScope(input: ScreeningScopeInput): ScreeningScopeDecision {
  const perimeter = readPerimeter(input.perimeter);
  const outside = (scope: ScreeningScopeKey) =>
    perimeter.classification === "outside_perimeter" &&
    perimeter.scopesExcluded.includes(scope);

  const excludedOutcome = (scope: ScreeningScopeKey): ScopeOutcome => ({
    scope, required: false, optional: true,
    reasonCode: `perimeter:${perimeter.reasonCode}`,
    reason: `${PERIMETER_REASON_TEXT[perimeter.reasonCode as PerimeterReasonCode]} ` +
      "No screening obligation for this scope arose under AML/CTF policy " +
      `${SCREENING_POLICY_VERSION}. This is not a screening result: nobody has ` +
      "been screened and nobody has been cleared.",
  });

  // ── Sanctions ──────────────────────────────────────────────────────
  // Inside the perimeter this is absolute. It answers to sanctions law,
  // not to the risk-based CDD programme, so no rating, answer or profile
  // reaches it — only the question of whether a dealing exists at all.
  const sanctions: ScopeOutcome = outside("sanctions")
    ? excludedOutcome("sanctions")
    : {
      scope: "sanctions", required: true, optional: false,
      reasonCode: "tfs_obligation",
      reason: "Targeted financial sanctions screening is required for every " +
        "designated service. It is not risk-based and cannot be stood down.",
    };

  // ── PEP ────────────────────────────────────────────────────────────
  const pep: ScopeOutcome = outside("pep")
    ? excludedOutcome("pep")
    : {
      scope: "pep", required: true, optional: false,
      reasonCode: "pep_determination_required",
      reason: "A politically-exposed-person determination must be established " +
        "for every customer. The client's own answer is evidence towards it, " +
        "never a substitute for it.",
    };

  // ── The risk-based two ─────────────────────────────────────────────
  const a = input.answers;
  const answersComplete = Boolean(a) &&
    answered(a?.pep) && answered(a?.adverse) &&
    answered(a?.thirdParty) && answered(a?.overseasFunding);
  const triggers = adverseMediaTriggers(input);

  const riskBased = (scope: ScreeningScopeKey): ScopeOutcome => {
    if (outside(scope)) return excludedOutcome(scope);
    if (!answersComplete) {
      return {
        scope, required: true, optional: false,
        reasonCode: "risk_evidence_incomplete",
        reason: "The client's risk answers are incomplete. Unknown risk " +
          "evidence is not a low-risk profile, so nothing is stood down.",
      };
    }
    if (triggers.length > 0) {
      return {
        scope, required: true, optional: false,
        reasonCode: "risk_triggered",
        reason: `Proportionate because ${triggers.join(", and ")}.`,
      };
    }
    return {
      scope, required: false, optional: true,
      reasonCode: "risk_not_triggered",
      reason: "Not triggered for this profile under AML/CTF policy " +
        `${SCREENING_POLICY_VERSION}: the customer is an individual, the case ` +
        "is not rated high or prohibited risk and is not in enhanced due " +
        "diligence, no PEP finding applies to any party, and the client " +
        "declared no overseas funding, no third-party involvement and no " +
        "adverse media. Nobody has been screened for this scope.",
    };
  };

  const evidence: Record<string, string> = {
    "personal_details.pep": String(a?.pep ?? "not answered"),
    "personal_details.adverse": String(a?.adverse ?? "not answered"),
    "purchase_profile.third_party": String(a?.thirdParty ?? "not answered"),
    "funding.overseas": String(a?.overseasFunding ?? "not answered"),
    "purchasing_structure.entity_type": String(input.entityType ?? "not answered"),
    "case.risk_rating": String(input.riskRating ?? "unrated"),
    "case.enhanced_due_diligence": input.enhancedDueDiligence ? "yes" : "no",
    "case.perimeter": perimeter.classification,
    "case.perimeter_reason": String(perimeter.reasonCode ?? "n/a"),
    "case.perimeter_scopes_excluded": perimeter.scopesExcluded.join(",") || "none",
  };

  return {
    sanctions, pep,
    adverse_media: riskBased("adverse_media"),
    watchlist: riskBased("watchlist"),
    perimeter,
    policyVersion: SCREENING_POLICY_VERSION,
    evidence,
  };
}

/** The scopes a case must complete, derived from the canonical decision. */
export function requiredScopes(d: ScreeningScopeDecision): ScreeningScopeKey[] {
  return ALL_SCREENING_SCOPES.filter((s) => d[s].required);
}

/**
 * Whether provider readiness is relevant at all.
 *
 * Readiness is a property of a SCOPE, not of the stage. A case with no
 * required scope that needs the sanctions provider must not be held up by
 * an unloaded list — that is the whole point of deciding scope first.
 */
export function providerReadinessRelevant(
  d: ScreeningScopeDecision,
  opts: { voluntaryRunRequested?: boolean } = {},
): boolean {
  if (opts.voluntaryRunRequested) return true;
  return d.sanctions.required || d.adverse_media.required || d.watchlist.required;
}

/**
 * The legacy shape, derived from the canonical engine.
 *
 * This used to hold the rule itself, with sanctions and PEP hardcoded into
 * `required`. It is now an ADAPTER over `deriveScreeningScope` so there is
 * exactly one rule in the codebase rather than two that agree until they do
 * not — the failure mode this repository has paid for more than once.
 *
 * `ScreeningPolicyInput` has no perimeter field, so a caller on this path
 * gets the inside-the-perimeter answer: sanctions and PEP required. That is
 * the correct default and the same answer this function always gave.
 */
export function decideScreeningPolicy(input: ScreeningPolicyInput): ScreeningPolicyDecision {
  const scope = deriveScreeningScope(input as ScreeningScopeInput);
  const required = requiredScopes(scope);
  const notRequired = ALL_SCREENING_SCOPES
    .filter((k) => !scope[k].required)
    .map((k) => ({ scope: k, basis: scope[k].reason }));
  const triggers = adverseMediaTriggers(input);

  const a = input.answers;
  const answersComplete = Boolean(a) &&
    answered(a?.pep) && answered(a?.adverse) &&
    answered(a?.thirdParty) && answered(a?.overseasFunding);

  /*
   * The declaration route is available only when the client answered the PEP
   * question "no" AND nothing on the case contradicts a low-risk profile.
   * It selects how the determination may be reached — never whether one is
   * needed.
   */
  const pepRoute: ScreeningPolicyDecision["pepRoute"] =
    answersComplete && a?.pep === "no" && triggers.length === 0
      ? "declaration_supported"
      : "manual_review";

  const sanctionsStoodDown = !scope.sanctions.required;
  return {
    required, notRequired, triggers, pepRoute,
    evidence: scope.evidence,
    policyVersion: scope.policyVersion,
    summary: sanctionsStoodDown
      ? `Outside the sanctions perimeter: ${scope.sanctions.reason}`
      : notRequired.length > 0
        ? "Reduced scope: sanctions and PEP only. Adverse media and internal watchlist " +
          "research are not proportionate for this profile."
        : !answersComplete
          ? "Full scope: the client's risk answers are incomplete, so no control can be stood down."
          : `Full scope: ${triggers.join(", and ")}.`,
  };
}


/**
 * What an exemption (or its withdrawal) means for one already-enrolled
 * subject.
 *
 * Pure, because the interesting part is the decision and not the UPDATE.
 * Four outcomes, and the first two are the ones that matter:
 *
 *   keep_finding      a possible or confirmed match exists. The subject
 *                     stays REQUIRED whatever the perimeter says: once a
 *                     candidate exists you cannot un-know it, and the duty
 *                     to deal with a positive result comes from the sanction
 *                     itself rather than from the screening obligation that
 *                     surfaced it.
 *   keep_in_flight    a VOLUNTARY run is queued or processing. Standing it
 *                     down would cancel work an operator authorised seconds
 *                     ago and leave them looking at "not required" having
 *                     just pressed Run.
 *   release           obligation drops; a completed check keeps its result
 *                     and only the flag moves, an unscreened subject becomes
 *                     not_required.
 *   restore           the exemption is withdrawn: back to unscreened, never
 *                     to an invented result.
 */
export type SubjectScopeAction =
  | "none" | "keep_finding" | "keep_in_flight" | "release" | "restore";

export interface SubjectScopeReconciliation {
  action: SubjectScopeAction;
  /** The columns to write, or null when nothing changes. */
  patch: { required?: boolean; state?: string; error_category?: null } | null;
  /** Whether pending queue entries for this subject must be retired first. */
  retireQueued: boolean;
}

const FINDING_STATES = ["possible_match", "confirmed_match"];
const RESULT_STATES = ["completed", "false_positive"];
const IN_FLIGHT_STATES = ["queued", "processing"];

export function reconcileSubjectToScope(
  subject: { state: string; required: boolean; voluntaryRunAt?: string | null },
  sanctionsRequired: boolean,
): SubjectScopeReconciliation {
  const state = String(subject.state);

  if (!sanctionsRequired) {
    if (FINDING_STATES.includes(state)) {
      return { action: "keep_finding", patch: null, retireQueued: false };
    }
    if (IN_FLIGHT_STATES.includes(state) && subject.voluntaryRunAt) {
      return { action: "keep_in_flight", patch: null, retireQueued: false };
    }
    if (RESULT_STATES.includes(state)) {
      // Evidence survives. Only the obligation moves.
      return subject.required === false
        ? { action: "none", patch: null, retireQueued: false }
        : { action: "release", patch: { required: false }, retireQueued: false };
    }
    if (subject.required === false && state === "not_required") {
      return { action: "none", patch: null, retireQueued: false };
    }
    return {
      action: "release",
      patch: { required: false, state: "not_required", error_category: null },
      retireQueued: true,
    };
  }

  if (subject.required === true && state !== "not_required") {
    return { action: "none", patch: null, retireQueued: false };
  }
  return {
    action: "restore",
    patch: {
      required: true,
      state: state === "not_required" ? "not_started" : state,
    },
    retireQueued: false,
  };
}

/* ─────────────────────────── Enrolment ──────────────────────────────── */

export interface EnrolmentCandidate {
  partyType: string;
  partyId: string | null;
  reconciliationItemId: string | null;
  screenedName: string;
  aliases: string[];
  dateOfBirth: string | null;
  country: string | null;
}

export interface EnrolmentInput {
  subjectDisplayName: string | null;
  /** `personal_details` payload from the latest submission, if any. */
  personalDetails: Record<string, unknown> | null;
  /**
   * Previous names and alternative spellings the client disclosed in the
   * Australian Sanctions & Compliance Screening section.
   *
   * This is the whole point of asking them: an undisclosed former name is a
   * real screening gap, and a list is only as good as the names put to it.
   * They enrich the subject's `aliases`, which the matcher indexes — they do
   * not change WHETHER the subject is screened.
   */
  declaredAliases?: string[] | null;
  /** Resolved reconciliation items that require screening. */
  reconciled: Array<{
    id: string; declaredName: string; declaredRole: string;
    resolvedPartyType: string | null; resolvedPartyId: string | null;
    screeningRequired: boolean; resolutionStatus: string;
    declaredPayload: Record<string, unknown> | null;
  }>;
  /** Subjects that already exist, so this can be run repeatedly. */
  existing: Array<{ partyType: string; partyId: string | null; screenedName: string }>;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** A YYYY-MM-DD date or nothing. A malformed date is worse than none. */
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** Identity keys compare case-insensitively on the pair that must be unique. */
const key = (partyType: string, partyId: string | null, name: string) =>
  `${partyType}::${partyId ?? ""}::${name.trim().toLowerCase()}`;

/**
 * Who should hold a `party_screening_subjects` row for this case.
 *
 * Returns only what is MISSING, so the caller can run it on every read
 * without writing a duplicate. It never returns a subject with no name: a
 * screening subject without an identity cannot be screened, and enrolling an
 * empty name would create a permanently unresolvable row.
 */
export function deriveMissingScreeningSubjects(input: EnrolmentInput): EnrolmentCandidate[] {
  const have = new Set(input.existing.map((e) => key(e.partyType, e.partyId, e.screenedName)));
  const out: EnrolmentCandidate[] = [];
  const add = (c: EnrolmentCandidate) => {
    const k = key(c.partyType, c.partyId, c.screenedName);
    if (have.has(k)) return;
    have.add(k);
    out.push(c);
  };

  /*
   * The case subject. This is the row that was never created, and it is
   * created from the case's own record rather than from the questionnaire,
   * because the customer exists whether or not they have submitted anything.
   * The questionnaire only enriches it — a DOB and citizenship the matcher
   * can use instead of a bare display name.
   */
  const pd = input.personalDetails ?? {};
  const subjectName = str(input.subjectDisplayName) ?? str(pd.full_name);
  if (subjectName) {
    add({
      partyType: PRIMARY_SUBJECT_PARTY_TYPE,
      partyId: null,
      reconciliationItemId: null,
      screenedName: subjectName,
      aliases: [...new Set([
        ...(Array.isArray(pd.aliases)
          ? (pd.aliases as unknown[]).filter((x): x is string => typeof x === "string")
          : []),
        ...(input.declaredAliases ?? []).filter((x) => typeof x === "string" && x.trim()),
      ].map((a) => a.trim()).filter(Boolean))].slice(0, 25),
      dateOfBirth: isoDate(pd.dob) ?? isoDate(pd.date_of_birth),
      country: str(pd.citizenship) ?? str(pd.nationality) ?? str(pd.country),
    });
  }

  /*
   * Reconciled related parties, in the roles the program identifies. This
   * repeats what the reconciliation handler already does on resolution — on
   * purpose, so a case whose parties were resolved before this shipped, or
   * whose insert failed, self-heals rather than staying silently unscreened.
   */
  for (const item of input.reconciled) {
    if (!item.screeningRequired) continue;
    if (!["linked", "created"].includes(item.resolutionStatus)) continue;
    const partyType = str(item.resolvedPartyType) ?? str(item.declaredRole);
    if (!partyType) continue;
    const name = str(item.declaredName);
    if (!name) continue;
    const declared = item.declaredPayload ?? {};
    add({
      partyType,
      partyId: str(item.resolvedPartyId),
      reconciliationItemId: item.id,
      screenedName: name,
      aliases: Array.isArray(declared.aliases)
        ? (declared.aliases as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20)
        : [],
      dateOfBirth: isoDate(declared.date_of_birth) ?? isoDate(declared.dob),
      country: str(declared.country) ?? str(declared.nationality),
    });
  }

  return out;
}

/* ────────────────────── What a person must do next ──────────────────── */

export type ScreeningNextActionKey =
  | "none"
  | "await_submission"
  | "classify_perimeter"
  | "fix_provider"
  | "enrol_subjects"
  | "run_screening"
  | "adjudicate_match"
  | "record_pep"
  | "await_provider_result"
  | "screening_stalled"
  | "escalate"
  /**
   * The case is closed. The AML/CTF journey is not progressing, so the only
   * thing that resumes it is an explicit, reason-bearing reopen — never an
   * ordinary status advance.
   */
  | "reopen_case"
  /**
   * A required screening the provider cannot perform, which the MLRO can.
   *
   * This exists because "provider unavailable" was a dead end: correct, owned
   * by an administrator, and leaving an MLRO who could lawfully complete the
   * check with nothing to press. It is a METHOD, so it appears only where a
   * screening is genuinely required and genuinely blocked.
   */
  | "complete_manually";

/**
 * How long a queued request may sit before "running" stops being true.
 *
 * The worker sweeps every minute and caps each pass at 25 events, so a
 * request that is genuinely in flight clears well inside this. Past it, the
 * honest reading is that nothing picked it up — which is exactly what
 * happened in production for an unbounded time, while the screen said the
 * engine was working.
 */
export const SCREENING_STALL_SECONDS = 300;

export type ScreeningActionOwner =
  "system" | "analyst" | "reviewer" | "administrator" | "client" | "none";

export interface ScreeningNextAction {
  key: ScreeningNextActionKey;
  /** The button an operator presses, or null when there is nothing to press. */
  label: string | null;
  headline: string;
  detail: string;
  owner: ScreeningActionOwner;
  /**
   * A SECOND legitimate route to the same blockage, owned by a different role.
   *
   * One blockage can have two lawful answers — an administrator restores the
   * provider, or the MLRO performs the check by hand — and which is "primary"
   * depends on who is looking. Both routes are decided HERE, so the browser
   * chooses an order rather than inventing a route; and because both are
   * present, neither role is ever left with a status and no next step.
   *
   * Never a way round an obligation: an alternative is a different METHOD of
   * discharging it, and nothing here can make one unnecessary.
   */
  alternative?: {
    key: ScreeningNextActionKey;
    label: string;
    headline: string;
    detail: string;
    owner: ScreeningActionOwner;
  } | null;
}

/**
 * What a technical screening failure means, in words an operator can act on.
 *
 * `error_category` is recorded by the screening consumer when a check cannot
 * complete. Rendering the raw category ("list_data_unavailable") tells nobody
 * anything; naming the cause and the owner is what turns a dead end into a
 * next step.
 */
export const SCREENING_ERROR_DETAIL: Record<string, string> = {
  list_data_unavailable:
    "The sanctions list has never been loaded, or is older than the freshness " +
    "window, so a check would be screening against nothing. Load the DFAT " +
    "Consolidated List in AML › Verification. No client action is required.",
  provider_not_configured:
    "No screening provider is configured for this tenant. An administrator " +
    "must configure one in AML › Configuration › Providers.",
  provider_misconfigured:
    "The screening provider is configured but cannot execute — in production " +
    "that usually means it is still in simulator mode. An administrator must " +
    "finish configuring it as live.",
  timeout:
    "The screening provider did not answer in time. Re-running is safe and " +
    "consumes no attempt.",
  provider_unavailable:
    "The screening provider could not be reached. Re-running is safe and " +
    "consumes no attempt.",
  /*
   * The three below exist because each was previously a SILENT stall.
   *
   * Measured in production: a subject sat `queued` with `error_category` null,
   * no screening check and no case event, while the stage reported "nothing
   * has picked it up". Every one of those paths now names itself.
   */
  screening_claim_failed:
    "The screening request could not be claimed for execution because the " +
    "database rejected the claim. This is a technical fault, not a screening " +
    "outcome — no check was performed. Re-running is safe and consumes no " +
    "attempt.",
  worker_not_invoked:
    "The screening request was queued but the background worker never " +
    "consumed it, and it could not be run directly either. An administrator " +
    "should check that the outbox worker can authenticate — every rejected " +
    "scheduled invocation is recorded in the security event log with its " +
    "reason. No client action is required.",
  invalid_subject:
    "The screening request does not name a subject that still exists, so it " +
    "can never execute. It has been failed rather than left queued. Re-enrol " +
    "the party from the screening stage.",
};

export interface NextActionInput {
  hasSubmission: boolean;
  subjectCount: number;
  providerReady: boolean;
  /** Aggregate over required subjects. */
  anyUnscreened: boolean;
  anyProcessing: boolean;
  anyPossibleMatch: boolean;
  anyConfirmedMatch: boolean;
  anyMissingPep: boolean;
  pepRoute: ScreeningPolicyDecision["pepRoute"];
  /**
   * Whether the sanctions perimeter has been decided for this case.
   *
   * Defaults TRUE so an older caller that does not pass it behaves exactly as
   * before — the classify step is added by supplying the fact, never by
   * assuming its absence.
   */
  perimeterClassified?: boolean;
  /**
   * Whether the CASE is closed, from the canonical lifecycle dimension.
   *
   * Defaults false so an older caller behaves exactly as before. A closed
   * case is a retained record: its evidence stays readable and, where the
   * compliance architecture allows, recordable — but the journey is not
   * progressing, and offering the stage's ordinary next step implies it is.
   */
  caseClosed?: boolean;
  /**
   * Whether a manual MLRO screening could discharge a blocked required
   * screening. Defaults false: the alternative route is offered by supplying
   * the fact, never by assuming it.
   */
  manualAvailable?: boolean;
  /** `error_category` from the most relevant failed subject, if any. */
  errorCategory?: string | null;
  /**
   * Age of the oldest UNPROCESSED queue entry for this case, in seconds.
   * `null` when nothing is queued or the queue could not be read — and an
   * unread queue is never reported as stalled.
   */
  oldestQueuedSeconds?: number | null;
}

/**
 * Exactly one next action, chosen by what actually blocks the stage.
 *
 * The order is the order a case moves through, most-blocking first, so an
 * operator is never shown a step whose prerequisite is unmet — which is what
 * "Run screening" did when there was nobody enrolled to screen.
 */
export function deriveScreeningNextAction(input: NextActionInput): ScreeningNextAction {
  if (input.anyPossibleMatch) {
    return {
      key: "adjudicate_match", label: "Adjudicate matches",
      headline: "A possible match needs adjudication",
      detail: "Screening returned a candidate. Confirm it is the screened person, or " +
        "dismiss it as a false positive with a written rationale.",
      owner: "reviewer",
    };
  }
  if (input.anyConfirmedMatch) {
    return {
      key: "escalate", label: "Open the case record",
      headline: "A confirmed match is recorded",
      detail: "This case must be escalated to the AML/CTF Compliance Officer. It must " +
        "not proceed to service on this stage's completion.",
      owner: "reviewer",
    };
  }
  /*
   * ── A closed case is not a stage in progress ───────────────────────
   *
   * Placed AFTER the two findings deliberately. A possible or confirmed match
   * is a FACT about a customer and does not stop being one because the file
   * was closed; those still lead. Everything below this point is a step in a
   * journey, and a closed case has no journey to step through — offering
   * "Run screening" or "Record PEP determinations" there tells an operator the
   * case is progressing when it is not.
   *
   * The action is an explicit reopen, never an ordinary status advance: the
   * two are different decisions and only one of them carries a reason.
   */
  if (input.caseClosed === true) {
    return {
      key: "reopen_case", label: "Reopen case to resume AML/CTF",
      headline: "This case is closed",
      detail: "The AML/CTF record is retained for compliance purposes and its evidence " +
        "stays readable. The journey is not progressing. If the customer relationship " +
        "is now proceeding, reopen the case — reopening restores the ability to WORK " +
        "the case and never approves the service, revives a terminated gate or restores " +
        "a revoked passport.",
      owner: "reviewer",
    };
  }
  if (input.subjectCount === 0) {
    return input.hasSubmission
      ? {
        key: "enrol_subjects", label: "Prepare screening",
        headline: "Nobody is enrolled for screening yet",
        detail: "The customer and any related parties must be enrolled before the " +
          "checks can run. This is prepared automatically — no client action is required.",
        owner: "system",
      }
      : {
        key: "await_submission", label: null,
        headline: "Waiting on the client's questionnaire",
        detail: "Screening is prepared from the submitted questionnaire. Nothing can be " +
          "enrolled until the client submits it.",
        owner: "client",
      };
  }
  /*
   * ── Ask the question that decides the others ───────────────────────
   *
   * On an unclassified case sanctions defaults to required — correctly, and
   * fail-closed — so an unready provider read as the blocker and the stage
   * told the operator to go and fix the sanctions configuration. That is the
   * wrong order. Nobody has yet decided whether this case needs sanctions
   * screening AT ALL, and an administrator restoring a provider for a case
   * that turns out to be an enquiry has done work nobody needed.
   *
   * So an undecided perimeter outranks a provider fault. It outranks ONLY
   * that: when the provider is healthy the case screens on the default and
   * there is nothing to interrupt, and a match or a confirmed finding still
   * comes first because those are facts rather than questions.
   *
   * The DEFAULT IS UNCHANGED. Sanctions is still required until somebody
   * records otherwise; this decides what to ask for, never what is true.
   */
  const providerFault = !input.providerReady ||
    input.errorCategory === "provider_not_configured" ||
    input.errorCategory === "provider_misconfigured" ||
    input.errorCategory === "list_data_unavailable";
  if (input.perimeterClassified === false && providerFault) {
    return {
      key: "classify_perimeter", label: "Classify sanctions screening requirement",
      headline: "Classify sanctions screening requirement",
      detail: "Confirm whether this case is inside or outside the sanctions screening " +
        "perimeter. Until that is recorded the case is treated as inside, so sanctions " +
        "screening is required — but a case that is an enquiry, a duplicate, or a " +
        "service declined before it commenced may not need it at all.",
      owner: "reviewer",
    };
  }
  if (!input.providerReady && input.anyUnscreened) {
    /*
     * Two lawful routes, and the operator must never be left holding only the
     * one they cannot take. The administrator restores the provider; the MLRO
     * completes the required screening by hand against current published
     * sources. Both are returned, so neither role sees a dead end — and the
     * broken automation stays named rather than being papered over by the
     * existence of a manual route.
     */
    const fixProvider = {
      key: "fix_provider" as const, label: "Open screening configuration",
      headline: "Automated screening cannot run yet",
      detail: "The screening provider and its sanctions data must be restored before " +
        "any automated check can execute. No client action is required.",
      owner: "administrator" as const,
    };
    const manually = {
      key: "complete_manually" as const, label: "Complete sanctions screening manually",
      headline: "Complete the required screening manually",
      detail: "The automated method is unavailable, so the required screening has not " +
        "been performed. The MLRO may carry it out against current published sources " +
        "and record it with the sources checked, the names searched and a rationale. " +
        "Recording it manually discharges the obligation; it never removes it.",
      owner: "reviewer" as const,
    };
    return input.manualAvailable === true
      ? { ...manually, alternative: fixProvider }
      : { ...fixProvider, alternative: null };
  }
  if (input.anyProcessing) {
    const age = input.oldestQueuedSeconds;
    // "Running" is a claim about something happening. Past the stall window
    // it is not true, and saying it anyway is how an operator waits for ever.
    if (typeof age === "number" && age >= SCREENING_STALL_SECONDS) {
      return {
        key: "screening_stalled", label: "Retry screening",
        headline: "Screening has not started",
        detail: `The request has been queued for ${Math.floor(age / 60)} minutes and ` +
          "nothing has picked it up. The screening worker is not consuming the queue. " +
          "Retrying is safe — a request already in flight is refused rather than " +
          "sent twice.",
        owner: "administrator",
      };
    }
    return {
      key: "await_provider_result", label: null,
      headline: "Screening is running",
      detail: "The screening engine is checking the enrolled parties against the " +
        "official lists. Candidates come back for adjudication.",
      owner: "system",
    };
  }
  if (input.errorCategory) {
    // A technical failure leaves the subject outstanding — it never reads as
    // clear — so it is named, owned, and given the step that clears it.
    const detail = SCREENING_ERROR_DETAIL[input.errorCategory]
      ?? "The check could not complete. An error is never a clear result.";
    const configFault = input.errorCategory === "list_data_unavailable"
      || input.errorCategory === "provider_not_configured"
      || input.errorCategory === "provider_misconfigured";
    const technical = {
      key: "fix_provider" as const,
      label: configFault ? "Open screening configuration" : "Retry screening",
      headline: "Automated screening could not complete",
      detail,
      owner: (input.errorCategory === "timeout"
        || input.errorCategory === "provider_unavailable"
        ? "analyst" : "administrator") as ScreeningActionOwner,
    };
    // A failure that a person can complete by hand is not a dead end either.
    // The technical fault stays owned and named as the alternative.
    return input.manualAvailable === true
      ? {
        key: "complete_manually", label: "Complete sanctions screening manually",
        headline: "Complete the required screening manually",
        detail: `${detail} The MLRO may complete the required screening manually against ` +
          "current published sources in the meantime; it is recorded with the sources " +
          "checked, the names searched and a rationale.",
        owner: "reviewer",
        alternative: technical,
      }
      : { ...technical, alternative: null };
  }
  if (input.anyUnscreened) {
    return {
      key: "run_screening", label: "Run screening",
      headline: "Ready to screen",
      detail: "Every enrolled party is checked against the required sanctions lists.",
      owner: "analyst",
    };
  }
  if (input.anyMissingPep) {
    return input.pepRoute === "declaration_supported"
      ? {
        key: "record_pep", label: "Record PEP determinations",
        headline: "PEP determinations outstanding",
        detail: "The client's declaration supports the low-risk determination route, so " +
          "the sources and rationale are prefilled. A determination is still recorded " +
          "against each party — the declaration is evidence, not the determination.",
        owner: "reviewer",
      }
      : {
        key: "record_pep", label: "Record PEP determinations",
        headline: "PEP determinations outstanding",
        detail: "This case does not qualify for the declaration-supported route. Each " +
          "party needs a determination reached on its own evidence.",
        owner: "reviewer",
      };
  }
  return {
    key: "none", label: null,
    headline: "Stage 5 complete",
    detail: "Every required determination is recorded. Completing this stage is not a " +
      "service-gate decision and does not itself approve the case.",
    owner: "none",
  };
}

/* ─────────────────── Self-healing: what may auto-run ─────────────────── */

export interface RecoveryCandidate {
  id: string;
  state: string;
  screeningCheckId: string | null;
  updatedAt: string | null;
  required: boolean;
}

/**
 * Which subjects the stage may run WITHOUT anybody pressing anything.
 *
 * A queued request that nothing consumed used to sit until an operator
 * noticed. Measured on one production case: 130 minutes, and the only way out
 * was a human. That is a dead end dressed as a status.
 *
 * Deliberately bounded to two situations, because "run screening
 * automatically" must never become "run the provider on every page load":
 *
 *   NEVER ATTEMPTED  `not_started` with no check. Nothing has been spent, so
 *                    starting it costs one attempt and removes a click the
 *                    operator should never have needed.
 *
 *   STALLED          queued or processing past the stall window with no
 *                    check. The queue did not consume it, so releasing and
 *                    running it is RECOVERY, not a second attempt.
 *
 * `error` is excluded on purpose. The consumer claims `queued` and `error`
 * alike, so auto-running a failed subject would re-run the provider on every
 * page view — a retry loop, paid for per view. A failure keeps its explicit
 * Retry, which is a person deciding to spend another attempt.
 *
 * A subject that already holds a check is never auto-run: that check is
 * either in flight or finished, and re-running it would duplicate a
 * completed execution.
 */
export function recoverableSubjects(
  subjects: RecoveryCandidate[],
  nowMs: number,
  stallSeconds: number = SCREENING_STALL_SECONDS,
): RecoveryCandidate[] {
  const cutoff = nowMs - stallSeconds * 1000;
  return subjects.filter((s) => {
    if (!s.required) return false;
    if (s.screeningCheckId) return false;
    if (s.state === "not_started") return true;
    if (s.state !== "queued" && s.state !== "processing") return false;
    const at = Date.parse(String(s.updatedAt ?? ""));
    return Number.isFinite(at) && at <= cutoff;
  });
}
