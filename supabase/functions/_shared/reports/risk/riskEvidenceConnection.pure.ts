/**
 * The connection between retrieved evidence and Risk Model D's answers.
 *
 * ## The defect this closes
 *
 * `scoringV2Production.pure.ts` handed the engine a hardcoded literal:
 *
 * ```ts
 * propertyRisk: { propertyType: …, answers: {}, growth1Year: … }
 * ```
 *
 * Nothing anywhere populated a risk answer, so Property Risk was structurally
 * null on every report this platform has ever produced — regardless of what
 * evidence the record held. That is not a methodology limitation and it was
 * never diagnosed as one: it is an input that was never wired.
 *
 * This module is that wiring. It takes what the planning and hazard registers
 * actually answered FOR THIS ASSESSMENT and produces, per question, either an
 * answer or a named reason there is none.
 *
 * ## What it deliberately does NOT do
 *
 * It does not invent a scale. `site_hazard_exposure` and `planning_constraints`
 * are retrieved at parcel grain and carry no approved conversion into a 0–100
 * risk score, so this module reports them as held-with-no-approved-conversion
 * and contributes NO answer. Turning "Zone R2, no overlay returned at this
 * point" into `78` would be a number nobody can defend, and
 * `PLANNING_CONTROLS_IN_THE_REPORT.md` §9 already forbids rating an absence.
 *
 * A conversion becomes possible here by being APPROVED and VERSIONED, not by
 * being written. `CONVERSIONS` is the single place one would land, and it is
 * deliberately empty: a reader can see at a glance that no scoring judgement is
 * being made, and a spec asserts it.
 *
 * ## Why the connection ships before any conversion does
 *
 * Three reasons, all of them things the previous shape made impossible.
 *
 * 1. **Evidence becomes visible per assessment.** `RiskEvidenceReading` records
 *    what each register answered for THIS subject, with its publisher, licence,
 *    the instrument's own currency date and the retrieval stamp. A capability
 *    of a service is not evidence a report holds, and the two were being
 *    conflated in this programme's own records.
 * 2. **The five absences stop being one absence.** A register asked that found
 *    nothing at the point, a register that is not served in this jurisdiction,
 *    a request that failed and a query never run are four different facts and
 *    were all reaching the schema as `not_held`.
 * 3. **Approval has somewhere to land.** When a method is approved it is one
 *    entry in `CONVERSIONS`; nothing else in the pipeline changes.
 *
 * ## The coverage rule that governs every reading here
 *
 * Every register in this path is queried by point-in-polygon identify at the
 * subject's coordinate with `tolerance: 0`. **A point is not a parcel.** A
 * layer that does not intersect the point may still cover part of the lot, so
 * `answered_no_intersection` is a completed query and never a clearance. That
 * sentence travels on the reading rather than living in a reviewer's head.
 */

import type { ConstraintFamily, ConstraintKind } from '../../planning/planningConstraints.pure.ts';

/** How a register answered for one subject. Five outcomes, never collapsed. */
export type RegisterOutcome =
  /** The register answered and the point falls inside at least one mapped layer. */
  | 'answered_with_intersection'
  /** The register answered and the point intersects no mapped layer of that service. */
  | 'answered_no_intersection'
  /** This jurisdiction publishes no integrated layer this platform can read. */
  | 'not_served'
  /** The request was made and did not complete (transport, HTTP, service error). */
  | 'request_failed'
  /** No query was made for this assessment. */
  | 'not_run';

/** One register's answer for one subject, with everything a reader needs. */
export interface RiskEvidenceReading {
  /** The publisher's own name for the service. */
  readonly register: string;
  readonly jurisdiction: string;
  readonly licence: string | null;
  readonly outcome: RegisterOutcome;
  /** Families this register is capable of answering, whatever it returned. */
  readonly families: readonly ConstraintFamily[];
  /** What intersected the point, empty where nothing did. */
  readonly findings: readonly RiskEvidenceFinding[];
  /** When this platform asked, ISO. Null where it never did. */
  readonly retrievedAt: string | null;
  /** Free text from the transport or the service where it refused. */
  readonly failureDetail?: string | null;
}

export interface RiskEvidenceFinding {
  readonly family: ConstraintFamily;
  readonly kind: ConstraintKind;
  /** The publisher's own label, e.g. `Lower Mary River`. */
  readonly label: string;
  /** The instrument and clause that creates it, where the layer names them. */
  readonly instrument?: string | null;
  readonly clause?: string | null;
  /** The instrument's OWN currency date, never the retrieval date. */
  readonly currencyDate?: string | null;
  /** A measured value with its unit, e.g. `10 m`, `700 m²`. */
  readonly value?: string | null;
}

/** Why a question has no answer, when it has none. */
export type AnswerRefusal =
  /** Evidence was retrieved and no approved conversion turns it into a score. */
  | 'evidence_held_no_approved_conversion'
  /** Every register that could answer it was asked and found nothing at the point. */
  | 'registers_answered_no_intersection'
  /** No register serving this question is integrated for this jurisdiction. */
  | 'not_served_here'
  /** A register that could answer it did not complete. */
  | 'register_unavailable'
  /**
   * Some registers answered and found nothing, and at least one that could
   * inform this question did NOT complete.
   *
   * This exists because `refusalFor` used to collapse the set: one register
   * answering `answered_no_intersection` returned
   * `registers_answered_no_intersection` for the whole question, whatever the
   * others did. A sibling that 503'd or was never run was concealed by a
   * sibling that answered, and "nothing found" was reported as though the
   * question had been covered. On a partial set nothing found is not a
   * finding, and this is the reading that says so.
   */
  | 'registers_incomplete'
  /** No query was run for this assessment. */
  | 'not_acquired'
  /** The question is owned by another dimension and is never Risk's to answer. */
  | 'owned_elsewhere';

/**
 * What was actually covered for one question.
 *
 * Always present, whatever the refusal says, so incompleteness cannot be
 * inferred from a verdict that was chosen for a different reason. **An
 * `answered_*` outcome means the register responded and its answer parsed —
 * HTTP 200 is a successful RESPONSE and never by itself a complete or usable
 * assessment**, which is why `complete` is computed from every consulted
 * register rather than from whether any of them answered.
 */
export interface RiskQuestionCoverage {
  readonly consulted: number;
  readonly answered: number;
  readonly withIntersection: number;
  readonly failed: number;
  readonly notRun: number;
  readonly notServed: number;
  /** True only where every consulted register completed. */
  readonly complete: boolean;
  /** The registers that did not complete, named, so a reader sees which. */
  readonly incomplete: readonly string[];
}

/** One question's outcome: an answer, or a reason there is none. */
export interface RiskQuestionConnection {
  readonly questionId: string;
  /** 0–100, higher is safer. Null wherever no approved conversion applied. */
  readonly answer: number | null;
  readonly refusal: AnswerRefusal | null;
  /** The registers consulted for this question, in the order they were asked. */
  readonly readings: readonly RiskEvidenceReading[];
  /** What was covered, retained whatever the refusal is. */
  readonly coverage: RiskQuestionCoverage;
  /** One sentence a reviewer can act on. */
  readonly statement: string;
}

export interface RiskEvidenceConnection {
  /** Exactly what `scorePropertyRisk` takes. Empty where nothing could answer. */
  readonly answers: Readonly<Record<string, number>>;
  readonly questions: readonly RiskQuestionConnection[];
  /** Every register consulted for this assessment, de-duplicated. */
  readonly registers: readonly RiskEvidenceReading[];
  /** The version of this connection, so a stored assessment names its basis. */
  readonly version: string;
  /**
   * True only where at least one register completed for this subject. An
   * assessment with nothing acquired is a different state from one whose
   * registers all answered and found nothing.
   */
  readonly anyRegisterCompleted: boolean;
}

export const RISK_EVIDENCE_CONNECTION_VERSION = '1.0.0' as const;

/**
 * Which question each retrieved family could inform, if a conversion existed.
 *
 * This is a mapping of SUBJECT MATTER, not of score. A bushfire designation is
 * plainly about site hazard; whether it is worth 40 or 70 is the question this
 * module refuses to answer on its own authority.
 */
export const FAMILY_TO_QUESTION: Readonly<Partial<Record<ConstraintFamily, string>>> = {
  bushfire: 'site_hazard_exposure',
  flood: 'site_hazard_exposure',
  landslide: 'site_hazard_exposure',
  erosion: 'site_hazard_exposure',
  coastal: 'site_hazard_exposure',
  acidSulfateSoils: 'site_hazard_exposure',
  contamination: 'site_hazard_exposure',
  heritage: 'planning_constraints',
  height: 'planning_constraints',
  floorSpaceRatio: 'planning_constraints',
  minimumLotSize: 'planning_constraints',
  dwellingDensity: 'planning_constraints',
  acquisition: 'planning_constraints',
  foreshoreBuildingLine: 'planning_constraints',
  airportNoise: 'planning_constraints',
};

/**
 * Approved conversions from retrieved evidence to a 0–100 answer.
 *
 * **Deliberately empty.** A conversion is a methodology decision with a
 * document behind it and a version on it, and none has been approved. An entry
 * here is what activation looks like; writing one without that approval is the
 * invented scale this module exists to prevent.
 *
 * `riskEvidenceConnection.spec.ts` asserts this stays empty until a named,
 * versioned method is approved, so activation is a visible act rather than a
 * quiet commit.
 */
export const CONVERSIONS: Readonly<Record<string, never>> = Object.freeze({});

const asked = (r: RiskEvidenceReading) =>
  r.outcome === 'answered_with_intersection' || r.outcome === 'answered_no_intersection';

/** Count what each consulted register did, and keep every one of them. */
export function coverageOf(readings: readonly RiskEvidenceReading[]): RiskQuestionCoverage {
  const n = (o: RegisterOutcome) => readings.filter((r) => r.outcome === o).length;
  const failed = n('request_failed');
  const notRun = n('not_run');
  const notServed = n('not_served');
  return {
    consulted: readings.length,
    answered: readings.filter(asked).length,
    withIntersection: n('answered_with_intersection'),
    failed,
    notRun,
    notServed,
    complete: readings.length > 0 && failed === 0 && notRun === 0,
    incomplete: readings
      .filter((r) => r.outcome === 'request_failed' || r.outcome === 'not_run')
      .map((r) => r.register),
  };
}

/**
 * The one place a refusal is chosen, so two surfaces cannot disagree.
 *
 * The precedence corrects an aggregation defect: the first version returned
 * `registers_answered_no_intersection` whenever ANY register answered, so a
 * sibling that failed or was never run was concealed by one that answered, and
 * a partial sweep was reported as a completed one. **Nothing found is a
 * finding only when the sweep was complete**, so an incomplete set now reads
 * `registers_incomplete` instead. `coverage` travels on every question
 * regardless, so incompleteness is never inferred from a verdict chosen for
 * another reason.
 */
function refusalFor(readings: readonly RiskEvidenceReading[]): AnswerRefusal {
  if (readings.length === 0) return 'not_acquired';
  const c = coverageOf(readings);
  // Evidence positively held is the reason there is no ANSWER whatever else
  // happened — the conversion is missing, not the evidence. Coverage still
  // travels, and the statement says when the sweep was partial.
  if (c.withIntersection > 0) return 'evidence_held_no_approved_conversion';
  if (c.answered === 0 && c.failed > 0) return 'register_unavailable';
  if (c.answered === 0 && c.notServed > 0 && c.notRun === 0) return 'not_served_here';
  if (c.answered === 0) return 'not_acquired';
  // Some register answered and found nothing. Whether that is a finding
  // depends entirely on whether the rest of the sweep completed.
  return c.complete ? 'registers_answered_no_intersection' : 'registers_incomplete';
}

const STATEMENTS: Readonly<Record<AnswerRefusal, string>> = {
  evidence_held_no_approved_conversion:
    'Evidence was retrieved at the coordinate and is shown on the report. No approved, versioned '
    + 'conversion turns it into a 0-100 risk score, so it contributes evidence and no points.',
  registers_answered_no_intersection:
    'Every register that could answer this was asked at the coordinate and returned no intersecting '
    + 'layer. That is a completed query about a POINT and is not a clearance for the parcel, so it '
    + 'is recorded as evidence and scored as nothing.',
  not_served_here:
    'No register serving this question is integrated for this jurisdiction, so it was not asked.',
  register_unavailable:
    'A register that could answer this did not complete, so nothing was established either way.',
  registers_incomplete:
    'Some registers answered at the coordinate and found no intersecting layer, and at least one '
    + 'that could inform this question did not complete. A partial sweep cannot establish that '
    + 'nothing is there, so this is recorded as incomplete coverage rather than as a finding.',
  not_acquired:
    'No register was queried for this assessment, so no evidence was acquired.',
  owned_elsewhere:
    'This question belongs to another dimension and is never answered here.',
};

/**
 * Build the answer set and its audit from what the registers answered.
 *
 * `questionIds` is the SCHEMA'S list for the subject's asset class — passed in
 * rather than derived, because the schema owns which questions apply and this
 * module owns only how evidence reaches them.
 */
export function connectRiskEvidence(
  questionIds: readonly string[],
  readings: readonly RiskEvidenceReading[],
): RiskEvidenceConnection {
  const byQuestion = new Map<string, RiskEvidenceReading[]>();
  for (const id of questionIds) byQuestion.set(id, []);

  for (const reading of readings) {
    // A register is consulted FOR a question when it can answer that question's
    // subject matter — whether or not it found anything.
    const touched = new Set<string>();
    for (const family of reading.families) {
      const q = FAMILY_TO_QUESTION[family];
      if (q && byQuestion.has(q)) touched.add(q);
    }
    for (const q of touched) byQuestion.get(q)!.push(reading);
  }

  const answers: Record<string, number> = {};
  const questions: RiskQuestionConnection[] = questionIds.map((questionId) => {
    const qReadings = byQuestion.get(questionId) ?? [];
    // An approved conversion would resolve here. None exists, by design.
    const conversion = (CONVERSIONS as Record<string, unknown>)[questionId];
    if (conversion !== undefined) {
      // Unreachable while CONVERSIONS is empty; kept so activation is a data
      // change rather than a control-flow change.
      throw new Error(
        `A conversion is declared for "${questionId}" but this module has no approved evaluator. `
        + 'Activation must ship its evaluator, its version and its validation together.',
      );
    }
    const refusal = refusalFor(qReadings);
    const coverage = coverageOf(qReadings);
    // The verdict is one sentence; incomplete coverage is a second fact and is
    // appended rather than folded in, so a reader always sees which registers
    // did not complete even when the verdict was chosen for another reason.
    const statement = coverage.consulted > 0 && !coverage.complete
      && refusal !== 'registers_incomplete'
      ? `${STATEMENTS[refusal]} Coverage is incomplete: ${coverage.incomplete.join(', ')} did not `
        + 'complete, so what they would have found is unknown.'
      : refusal === 'registers_incomplete'
        ? `${STATEMENTS[refusal]} The registers that did not complete: ${coverage.incomplete.join(', ')}.`
        : STATEMENTS[refusal];
    return {
      questionId,
      answer: null,
      refusal,
      readings: qReadings,
      coverage,
      statement,
    };
  });

  return {
    answers,
    questions,
    registers: readings,
    version: RISK_EVIDENCE_CONNECTION_VERSION,
    anyRegisterCompleted: readings.some(asked),
  };
}

/**
 * Read the connection back off a stored assessment's evidence block.
 *
 * Kept beside the builder so a stored row and a fresh run are read by one
 * implementation — the rule `captureObjectsFor` and `placesAreComplete` were
 * both written for, after two hand-written copies disagreed.
 */
export function readStoredRiskReadings(stored: unknown): RiskEvidenceReading[] {
  if (!stored || typeof stored !== 'object') return [];
  const list = (stored as { registers?: unknown }).registers;
  if (!Array.isArray(list)) return [];
  const out: RiskEvidenceReading[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const outcome = r.outcome;
    if (typeof outcome !== 'string') continue;
    if (!['answered_with_intersection', 'answered_no_intersection', 'not_served',
      'request_failed', 'not_run'].includes(outcome)) continue;
    out.push({
      register: typeof r.register === 'string' ? r.register : 'unnamed register',
      jurisdiction: typeof r.jurisdiction === 'string' ? r.jurisdiction : '',
      licence: typeof r.licence === 'string' ? r.licence : null,
      outcome: outcome as RegisterOutcome,
      families: Array.isArray(r.families) ? (r.families as ConstraintFamily[]) : [],
      findings: Array.isArray(r.findings) ? (r.findings as RiskEvidenceFinding[]) : [],
      retrievedAt: typeof r.retrievedAt === 'string' ? r.retrievedAt : null,
      failureDetail: typeof r.failureDetail === 'string' ? r.failureDetail : null,
    });
  }
  return out;
}
