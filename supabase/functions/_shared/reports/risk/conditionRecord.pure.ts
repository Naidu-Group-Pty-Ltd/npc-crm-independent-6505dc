/**
 * The recommended Property Risk `building` method: a **recorded condition
 * record**, and what a document has to establish before it counts as one.
 *
 * ## The arithmetic that decides this, before any preference
 *
 * `riskModelD.pure.ts` requires observations spanning at least
 * `MINIMUM_INDEPENDENT_CATEGORIES` (2) before they may compose a Risk score.
 * `propertyRiskSchema.pure.ts` gives an established house exactly three of its
 * own questions, in two categories:
 *
 * | question                   | category   |
 * | -------------------------- | ---------- |
 * | `site_hazard_exposure`     | `site`     |
 * | `planning_constraints`     | `site`     |
 * | `condition_and_maintenance`| `building` |
 *
 * So hazard and planning together are ONE category however well they are
 * retrieved, and **Risk cannot score for a house without a `building`
 * observation.** This module is that observation. It is **not** sufficient on
 * its own: the `site` half needs its own defensible, implemented conversion,
 * and until both exist Risk stays null. Nothing here may be read as completing
 * Risk.
 *
 * ## v2.0.0 — what the first version accepted that it should not have
 *
 * v1.0.0 admitted a record on four checks: an admissible `kind`, a non-empty
 * `issuer`, a parseable date and a non-empty `scope` string. Every one of
 * those is satisfiable by a record that establishes nothing about the
 * dwelling, and the reference score would have been awarded to all of them:
 *
 * | accepted by v1 | why it cannot support a condition observation |
 * | --- | --- |
 * | `issuedOn: '2027-06-01'` | a document issued in the future |
 * | `inspectedOn` after `issuedOn` | a report issued before the inspection it reports |
 * | `findings: []` from a failed extraction | an empty array is not a conclusion |
 * | `scope: 'n/a'` | a non-empty string is not a recorded scope |
 * | a vendor's statement with no findings | disclosure is not inspection |
 * | a strata report with no findings | the scheme is not the dwelling |
 * | `severity: 'moderate'` | silently dropped from the arithmetic |
 *
 * The last one is the worst of them, because it was silent in both
 * directions: `convertFindings` skipped an unrecognised severity with
 * `continue`, so a document recording three moderate defects scored exactly
 * as one recording none, and `describeFindings` omitted it from the sentence
 * as well. A reader saw "no defect or hazard over the scope examined" on a
 * record that listed three.
 *
 * ## v2.1.0 — the binding correction
 *
 * Two defects in how v2.0.0 bound a document to a property:
 *
 *   * **The address key DELETED road types.** `18 Annabelle Street` and
 *     `18 Annabelle Crescent` reduced to one key, so a document about a
 *     different street in the same suburb passed the subject check. The key
 *     now EXPANDS a recognised abbreviation to its one canonical word
 *     ({@link ROAD_TYPE_CANONICAL}) and compares every token, so `Cres`
 *     still matches `Crescent` while a different road type stays a
 *     different street.
 *   * **A record with no subject passed the check silently.** The comparison
 *     ran only where both the expectation and the record's subject were
 *     present, so a document bound to nothing was admissible. The record
 *     must now name its property (`subject_not_recorded`, refused whoever
 *     calls), and where the assessment's subject is supplied the two must
 *     share a comparable field (`subject_unresolved`) and agree on it
 *     (`subject_mismatch`) — three refusals, because each sends an operator
 *     to a different fix.
 *
 * ## The rule that carries this module
 *
 * **A positive finding and a negative conclusion are not the same evidence.**
 *
 *   * A **recorded defect** is admissible from any document whose issuer is
 *     accountable for it. Somebody competent wrote down a problem; the
 *     document's scope limits what else it can say, not whether that finding
 *     is real.
 *   * A **negative** — "no defects identified", which is what earns the
 *     reference score — is a determination, and only a document that
 *     positively concludes it, over a recorded scope wide enough to support
 *     it, made by somebody who inspected the dwelling, may supply one.
 *
 * That asymmetry is `assessPepEvidence`'s and the register's, applied here:
 * a HIT is a signal from anywhere, a MISS is a finding only from something
 * that actually looked. It is also why {@link ESTABLISHES} exists — a
 * document TYPE, an issuer NAME and a non-empty scope FIELD do not establish
 * that a qualified person inspected the dwelling, and v1 treated them as
 * though they did.
 *
 * ## Why not a construction year — measured, not assumed
 *
 * See `constructionAgeCandidate.pure.ts`. Over all 1,230 stored reports on
 * 18 September 2026, `property_specs` carries a construction year on **0**
 * (`year_built` is present as an explicit JSON null on 1,102 rows and holds a
 * value on none). Every construction year the platform holds is an
 * operator-typed `manual_overrides.constructionYear`: **32 rows, 19
 * properties, zero carrying any source or reason field.** 31 of the 32 are
 * `2025`, `2026` or `2031` — a completion expectation for a new build, one of
 * them in the future — and the single historical value, `1941`, is on
 * **262 Pallas Street and on nothing else in the corpus.**
 *
 * ## Every parameter below is PROPOSED
 *
 * {@link CONDITION_REFERENCE}, {@link SEVERITY_DEDUCTION},
 * {@link MAX_MINOR_DEDUCTION} and {@link CONDITION_MAX_AGE_MONTHS} are
 * proposals awaiting substantiation and review, not settled policy.
 * {@link CONDITION_METHOD_ACTIVATION} is `null`, a test asserts it, and
 * nothing here contributes to any score until it names a decision.
 *
 * One claim was removed rather than softened: v1 justified the 36-month window
 * by attributing it to ordinary lender and insurer practice. **No
 * authoritative source was held for that attribution**, and an unsourced
 * industry norm stated as fact is the class of claim this programme keeps
 * correcting. The window is now declared as what it is — a proposal, with the
 * question it turns on written down.
 */

/** Bump on any change to the admissibility rules or the conversion basis. */
export const CONDITION_RECORD_METHOD_VERSION = '2.1.0';

/**
 * Document kinds whose contents may bear on `condition_and_maintenance`.
 *
 * Admissibility here means "the issuer is accountable for what it says", not
 * "this settles the dwelling's condition". {@link ESTABLISHES} decides the
 * second question, and the two are deliberately separate: a vendor's statement
 * is an admissible document and a hopeless basis for a clean bill of health.
 */
export const ADMISSIBLE_SOURCES = [
  'building_inspection',
  'strata_report',
  'building_certificate',
  'vendor_statement',
] as const;

export type ConditionSourceKind = typeof ADMISSIBLE_SOURCES[number];

/**
 * Named inadmissible sources.
 *
 * Present rather than absent, for the reason `WITHHELD_CAPTURE_KEYS` is:
 * a reader can see that the typed year was considered and refused, instead of
 * wondering whether anybody thought about it.
 */
export const INADMISSIBLE_SOURCES: Readonly<Record<string, string>> = Object.freeze({
  typed_construction_year:
    'An operator-typed year with no document. Measured over the whole corpus: 32 rows, none '
    + 'carrying a source or a reason, 31 of them a completion expectation rather than an '
    + 'observed build date.',
  listing_description:
    'An agent\'s marketing copy. It describes the property to sell it and nobody is accountable '
    + 'for a condition statement in it.',
  model_inference:
    'A model reading a photograph or a description. It produces a confident number from no '
    + 'observation, which is the failure this platform has already had once.',
  area_statistic:
    'A suburb or postcode figure. It is not about this dwelling, and Location already owns '
    + 'area characteristics.',
});

/** What a document's recorded scope actually covered. */
export type ScopeCoverage =
  /** Interior, exterior, roof space and subfloor of the dwelling — AS 4349.1's scope. */
  | 'whole_dwelling'
  /** The dwelling, with areas excluded or inaccessible, or specific areas only. */
  | 'partial_dwelling'
  /** A strata scheme's common property. Not the lot's interior. */
  | 'common_property'
  /** The works a certificate certified, and nothing else. */
  | 'specified_works'
  /** What the issuer chose to disclose. Not a survey of anything. */
  | 'disclosure_only';

/**
 * What each document kind is capable of establishing.
 *
 * `supportsNegativeConclusion` is the load-bearing field: it says whether a
 * "no defects identified" from this kind of document may become the reference
 * observation. Only a dwelling inspection can, and only over a scope wide
 * enough — both conditions, not either.
 */
export const ESTABLISHES: Readonly<Record<ConditionSourceKind, {
  readonly supportsNegativeConclusion: boolean;
  readonly coverageForNegative: readonly ScopeCoverage[];
  readonly establishes: string;
}>> = Object.freeze({
  building_inspection: {
    supportsNegativeConclusion: true,
    coverageForNegative: ['whole_dwelling'],
    establishes:
      'the condition of the dwelling as examined, by a person accountable for the examination. '
      + 'Over a whole-dwelling scope its stated absence of major defects is a determination.',
  },
  strata_report: {
    supportsNegativeConclusion: false,
    coverageForNegative: [],
    establishes:
      'the scheme\'s funding, levies, disclosed defects and litigation. It describes COMMON '
      + 'PROPERTY and the owners corporation, so it can raise a liability against the lot and '
      + 'can never clear the lot\'s own interior.',
  },
  building_certificate: {
    supportsNegativeConclusion: false,
    coverageForNegative: [],
    establishes:
      'that the specified works satisfied the certifier at the time certified. It says nothing '
      + 'about anything outside those works, and nothing about condition since.',
  },
  vendor_statement: {
    supportsNegativeConclusion: false,
    coverageForNegative: [],
    establishes:
      'what the vendor disclosed. A disclosure with nothing in it is a statement about the '
      + 'vendor\'s disclosure, not about the dwelling.',
  },
});

/** How far the record has been checked. Evidence and observation are different bars. */
export type ConditionVerification =
  /** The document itself is held, and its issuer has been checked against a register. */
  | 'issuer_verified'
  /** The document itself is held and read; the issuer has not been checked. */
  | 'document_held'
  /** Somebody recorded the findings without the document. Evidence, never an observation. */
  | 'transcribed_only';

/** The severities an AS 4349.1 report uses, plus the one a strata report adds. */
export const FINDING_SEVERITIES = [
  'safety_hazard',
  'major_defect',
  'minor_defect',
  'unfunded_liability',
] as const;

export type FindingSeverity = typeof FINDING_SEVERITIES[number];

export function isFindingSeverity(v: unknown): v is FindingSeverity {
  return typeof v === 'string' && (FINDING_SEVERITIES as readonly string[]).includes(v);
}

export interface ConditionFinding {
  /** The building element or scheme matter the finding is about. */
  element: string;
  severity: FindingSeverity;
  /** The inspector's or issuer's own words, kept rather than summarised. */
  note?: string;
}

export interface ConditionDocument {
  kind: ConditionSourceKind;
  /** The firm or person who issued it. Required — an unattributed document is a claim. */
  issuer: string;
  /** Licence or registration number where the kind carries one. */
  issuerLicence?: string;
  /** ISO date the document was issued. */
  issuedOn: string;
  /** ISO date the dwelling was actually examined, where that differs from issue. */
  inspectedOn?: string;
  /** The issuer's own reference, so the record points back at the paper. */
  reference?: string;
}

/**
 * The document's own conclusion, as the document states it.
 *
 * `not_concluded` is the honest default and the one v1 lacked: a record built
 * by extraction that found no findings list has not established that there
 * were none. An empty `findings` array and a stated "no defects identified"
 * are different facts and this is where they stop being conflated.
 */
export type ConditionConclusion =
  | 'no_defects_identified'
  | 'defects_identified'
  | 'not_concluded';

/** Which property and which assessment this record belongs to. */
export interface ConditionSubject {
  /** The property the document is about, as the document identifies it. */
  readonly propertyAddress: string;
  /** The stored property row, where one is linked. */
  readonly propertyId?: string | null;
  /** The assessment this record was attached to. */
  readonly reportId?: string | null;
}

export interface ConditionRecord {
  document: ConditionDocument;
  /** Whose property this is. Checked against the subject being assessed. */
  subject: ConditionSubject;
  /** What the document covered, in the issuer's own terms. */
  scope?: string;
  /** How wide that scope was. Required — a scope SENTENCE is not a coverage. */
  scopeCoverage?: ScopeCoverage;
  /** What the document says it did NOT reach, in the issuer's own terms. */
  exclusions?: readonly string[];
  /** The document's own conclusion. */
  conclusion?: ConditionConclusion;
  findings: readonly ConditionFinding[];
  verification: ConditionVerification;
  /** Who entered it, and when. Provenance of the RECORD, not of the document. */
  recordedBy?: string;
  recordedAt?: string;
}

/** Why a record cannot become an observation. Each is a different remedy. */
export type ConditionRefusal =
  | 'no_record'
  | 'inadmissible_source'
  | 'unattributed'
  | 'undated'
  | 'issued_in_future'
  | 'inspected_in_future'
  | 'inspected_after_issue'
  /** The record names no property, so it cannot be bound to any assessment. */
  | 'subject_not_recorded'
  /** Record and assessment identify their property with no field in common. */
  | 'subject_unresolved'
  | 'subject_mismatch'
  | 'scope_not_recorded'
  | 'scope_coverage_not_recorded'
  | 'unrecognised_severity'
  | 'conclusion_not_stated'
  | 'scope_too_narrow_for_conclusion'
  | 'not_verified'
  | 'out_of_currency';

/**
 * How long a condition document is treated as describing the dwelling.
 *
 * **A proposal, not a settled interval.** The v1 note justified this figure by
 * attributing it to ordinary lender and insurer practice. No authoritative
 * source was held for that attribution, so the claim is withdrawn rather than
 * re-worded — and it is not restated here even as a quotation, because a guard
 * that has to tell a claim from a quotation of it is not a guard.
 *
 * The question it turns on, for the review: over what period does a dwelling's
 * condition change enough that a report stops describing it? That is an
 * empirical question this deployment holds no data on, so 36 months is a
 * starting figure to be argued with, and the reading discloses the document's
 * age either way so a reviewer always sees what the window did.
 */
export const CONDITION_MAX_AGE_MONTHS = 36;

export interface ConditionReading {
  version: string;
  /** May this record contribute a `building` observation? */
  admissible: boolean;
  refusal: ConditionRefusal | null;
  /** The document, echoed so a reader can see what was judged. */
  document: ConditionDocument | null;
  findings: readonly ConditionFinding[];
  /** Severities the record carried that this module does not recognise. */
  unrecognisedSeverities: readonly string[];
  /** Months between the examination and the assessment date. Negative where dated ahead. */
  ageMonths: number | null;
  /** What the document covered, carried onto the reading for the audit trail. */
  scopeCoverage: ScopeCoverage | null;
  exclusions: readonly string[];
  conclusion: ConditionConclusion | null;
  /**
   * The observation, 0-100 where higher is safer — **null unless the method is
   * activated**, whatever the record's admissibility. Admissibility and
   * authorisation are different questions and collapsing them is how an
   * uncalibrated scale reaches a client document.
   */
  observation: number | null;
  /** What the observation would be were the method activated. Never published. */
  provisionalObservation: number | null;
  /** One sentence a report may print. */
  statement: string;
}

/**
 * The conversion basis. Declared, reasoned, versioned — and uncalibrated.
 *
 * A document that positively concludes no defects, over a scope wide enough to
 * support that conclusion, takes the reference. Each recorded finding then
 * DEDUCTS. The direction is the only part of this that is certain: a recorded
 * defect is evidence of exposure, and nothing here ever adds points for
 * something nobody found.
 *
 * The magnitudes are the uncalibrated part and are the specific thing approval
 * is sought for. They are ordered by what the finding OBLIGES — a safety
 * hazard obliges immediate work, a major defect obliges capital, a minor
 * defect obliges maintenance — rather than by any observed cost, because this
 * deployment holds no maintenance-cost data to observe.
 */
export const CONDITION_REFERENCE = 85;

export const SEVERITY_DEDUCTION: Readonly<Record<FindingSeverity, number>> = Object.freeze({
  safety_hazard: 20,
  major_defect: 15,
  unfunded_liability: 12,
  minor_defect: 4,
});

/** A single record may not exhaust the scale on minor findings alone. */
export const MAX_MINOR_DEDUCTION = 16;

/**
 * The activation decision.
 *
 * `null` was the shipped state from 18 Sep 2026 (the building half was
 * deferred from that release). The platform owner activated it on
 * 28 Sep 2026, with the site conversion beside it, so that a property whose
 * condition document is recorded can be assessed on all five dimensions.
 * The magnitudes above stay `provisional / uncalibrated`
 * (`RISK_METHODOLOGY_STATUS`) — activation authorises them, it does not
 * calibrate them. `conditionRecord.spec.ts` pins the decision.
 */
export const CONDITION_METHOD_ACTIVATION: {
  approved: boolean;
  approvedOn: string;
  reference: string;
  decidedBy: string;
  methodVersion: string;
} | null = Object.freeze({
  approved: true,
  approvedOn: '2026-09-28',
  reference: 'docs/reports/RISK_METHOD_RECOMMENDATION.md §7 (Approvals A and B)',
  decidedBy: 'platform owner',
  methodVersion: CONDITION_RECORD_METHOD_VERSION,
});

const MS_PER_MONTH = 30.436875 * 24 * 60 * 60 * 1000;

function monthsBetween(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / MS_PER_MONTH;
}

/** A scope field has to describe something. `n/a` and `-` are not scopes. */
const NON_SCOPES = new Set(['n/a', 'na', 'none', '-', '—', 'unknown', 'tbc', 'tba', 'nil']);

function scopeIsRecorded(scope: string | undefined): boolean {
  const s = scope?.trim().toLowerCase();
  if (!s) return false;
  if (NON_SCOPES.has(s)) return false;
  // A scope is a description; a single token is a label.
  return s.split(/\s+/).length >= 3;
}

/**
 * Road-type abbreviations, each expanded to its one canonical word.
 *
 * Expansion, never deletion. v2.0.0 DELETED the road type from the key, which
 * read `18 Annabelle Street` and `18 Annabelle Crescent` as one property —
 * two streets can share a number and a name and differ only in the road
 * type, and removing the token removed the distinction. An abbreviation here
 * maps onto exactly one canonical word; a token that could stand for two
 * (`cr` is a crescent in one register and a circuit in another) is
 * deliberately absent, because expanding a guess merges streets exactly the
 * way deletion did. A token the map does not know compares as written, so
 * ambiguity resolves toward a refusal a person reviews, never toward a merge
 * nobody sees.
 */
const ROAD_TYPE_CANONICAL: Readonly<Record<string, string>> = Object.freeze({
  st: 'street',
  rd: 'road',
  ave: 'avenue',
  av: 'avenue',
  cres: 'crescent',
  dr: 'drive',
  ct: 'court',
  pl: 'place',
  pde: 'parade',
  blvd: 'boulevard',
  bvd: 'boulevard',
  tce: 'terrace',
  hwy: 'highway',
  cct: 'circuit',
  cl: 'close',
  ln: 'lane',
  esp: 'esplanade',
  gdns: 'gardens',
  sq: 'square',
});

/**
 * Normalise the subject for comparison.
 *
 * Deliberately loose on punctuation and case and strict on the tokens
 * themselves: the point is to catch a record filed against the wrong
 * property, not to reject `Cres` against `Crescent` — and never the reverse.
 * Every token survives; recognised abbreviations are spelled out and the
 * whole address must agree.
 */
function addressKey(a: string): string {
  return a.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => ROAD_TYPE_CANONICAL[t] ?? t)
    .join(' ');
}

export interface AssessOptions {
  /** The property being assessed. A record filed against another is refused. */
  readonly expectedSubject?: ConditionSubject;
}

/**
 * Judge one record, and say which refusal it is.
 *
 * `asOf` is a parameter rather than a read of the clock, so a stored reading
 * can be re-derived identically, and so a test is not a race.
 */
export function assessConditionRecord(
  record: ConditionRecord | null | undefined,
  asOf: string,
  opts: AssessOptions = {},
): ConditionReading {
  const unrecognisedSeverities = (record?.findings ?? [])
    .map((f) => (f as { severity?: unknown }).severity)
    .filter((s) => !isFindingSeverity(s))
    .map((s) => String(s));

  const base = {
    version: CONDITION_RECORD_METHOD_VERSION,
    document: record?.document ?? null,
    findings: record?.findings ?? [],
    unrecognisedSeverities,
    scopeCoverage: record?.scopeCoverage ?? null,
    exclusions: record?.exclusions ?? [],
    conclusion: record?.conclusion ?? null,
    observation: null,
    provisionalObservation: null,
  };

  const refuse = (refusal: ConditionRefusal, statement: string, ageMonths: number | null = null)
    : ConditionReading => ({ ...base, admissible: false, refusal, ageMonths, statement });

  if (!record) {
    return refuse(
      'no_record',
      'No condition record has been submitted for this property, so the dwelling\'s condition and '
      + 'deferred-maintenance exposure is not assessed. A building inspection report over the whole '
      + 'dwelling would answer it.',
    );
  }

  const doc = record.document;
  if (!doc || !(ADMISSIBLE_SOURCES as readonly string[]).includes(doc.kind)) {
    return refuse(
      'inadmissible_source',
      'The condition evidence on file is not a document an issuer is accountable for, so it is '
      + 'recorded and not scored.',
    );
  }
  if (!doc.issuer?.trim()) {
    return refuse(
      'unattributed',
      'The condition document names no issuer. An unattributed document is a claim rather than a '
      + 'record, so it is not scored.',
    );
  }

  // --- dates, and the order they have to be in ---------------------------
  const issuedAge = monthsBetween(doc.issuedOn, asOf);
  if (issuedAge === null) {
    return refuse(
      'undated',
      'The condition document carries no usable issue date, so how far it still describes the '
      + 'dwelling cannot be established and it is not scored.',
    );
  }
  if (issuedAge < 0) {
    return refuse(
      'issued_in_future',
      `The condition document is dated ${doc.issuedOn}, which is after the date of this `
      + 'assessment. A document cannot describe a dwelling before it exists, so it is not scored.',
      issuedAge,
    );
  }
  let examinedAge = issuedAge;
  if (doc.inspectedOn) {
    const a = monthsBetween(doc.inspectedOn, asOf);
    if (a === null) {
      return refuse(
        'undated',
        'The condition document records an inspection date that cannot be read, so it is not scored.',
        issuedAge,
      );
    }
    if (a < 0) {
      return refuse(
        'inspected_in_future',
        `The inspection is dated ${doc.inspectedOn}, which is after the date of this assessment, so `
        + 'it is not scored.',
        a,
      );
    }
    // An inspection happens before the report on it. The other order is a
    // transcription error or a document describing something it did not see.
    if (Date.parse(doc.inspectedOn) > Date.parse(doc.issuedOn)) {
      return refuse(
        'inspected_after_issue',
        `The document is dated ${doc.issuedOn} and records an inspection on ${doc.inspectedOn}, `
        + 'which is after it. The dates do not describe one examination, so it is not scored.',
        a,
      );
    }
    examinedAge = a;
  }

  // --- whose property is this ------------------------------------------
  // The identity contract: the record must name its property, and where the
  // assessment's subject is supplied the two must share a comparable field
  // and agree on it. Three failures, three refusals, because each sends an
  // operator to a different fix: record the subject, record a comparable
  // identifier, or take the document off the wrong property's file.
  const subject = record.subject as ConditionSubject | undefined;
  const subjectAddress = subject?.propertyAddress?.trim() ?? '';
  const subjectId = subject?.propertyId ?? null;
  if (!subjectAddress && !subjectId) {
    return refuse(
      'subject_not_recorded',
      'The condition record does not name the property its document is about, so it cannot be '
      + 'bound to the dwelling being assessed and is not read as evidence about it.',
      examinedAge,
    );
  }
  const expected = opts.expectedSubject;
  if (expected) {
    const expectedAddress = expected.propertyAddress?.trim() ?? '';
    const expectedId = expected.propertyId ?? null;
    const idsComparable = Boolean(expectedId && subjectId);
    const addressesComparable = Boolean(expectedAddress && subjectAddress);
    if (!idsComparable && !addressesComparable) {
      return refuse(
        'subject_unresolved',
        'The condition record and this assessment identify their property in ways that cannot be '
        + 'compared, so whether the document describes the dwelling being assessed cannot be '
        + 'established. It is not read as evidence about this dwelling.',
        examinedAge,
      );
    }
    const idsDisagree = idsComparable && expectedId !== subjectId;
    const addressesDisagree = addressesComparable
      && addressKey(expectedAddress) !== addressKey(subjectAddress);
    if (idsDisagree || addressesDisagree) {
      return refuse(
        'subject_mismatch',
        'The condition document on file identifies a different property from the one being '
        + 'assessed, so it is not read as evidence about this dwelling.',
        examinedAge,
      );
    }
  }

  // --- a severity nobody recognises is never silently dropped -----------
  if (unrecognisedSeverities.length > 0) {
    return refuse(
      'unrecognised_severity',
      `The record carries ${unrecognisedSeverities.length} finding(s) whose severity this method `
      + `does not recognise (${[...new Set(unrecognisedSeverities)].join(', ')}). They are shown as `
      + 'recorded and the record is not scored, because a finding this method cannot weigh must not '
      + 'be left out of the arithmetic without saying so.',
      examinedAge,
    );
  }

  // --- what was actually examined --------------------------------------
  if (!scopeIsRecorded(record.scope)) {
    return refuse(
      'scope_not_recorded',
      'The condition document does not record what was examined, so what it found and what it did '
      + 'not reach cannot be told apart. It is recorded as evidence.',
      examinedAge,
    );
  }
  if (!record.scopeCoverage) {
    return refuse(
      'scope_coverage_not_recorded',
      'How much of the dwelling the document covered is not recorded, so the weight its findings '
      + 'carry cannot be established. It is recorded as evidence.',
      examinedAge,
    );
  }

  if (record.verification === 'transcribed_only') {
    return refuse(
      'not_verified',
      'The condition findings were transcribed without the document itself, so they are shown as '
      + 'evidence and do not contribute to the assessment.',
      examinedAge,
    );
  }
  if (examinedAge > CONDITION_MAX_AGE_MONTHS) {
    return refuse(
      'out_of_currency',
      `The condition document describes an examination ${Math.round(examinedAge / 12)} years ago. `
      + 'Condition is the property of a dwelling that changes, so it is shown with its date and '
      + 'does not contribute to the assessment.',
      examinedAge,
    );
  }

  // --- the asymmetry: a finding is evidence, a clean bill is a claim ----
  const conclusion = record.conclusion ?? 'not_concluded';
  const hasFindings = record.findings.length > 0;

  if (!hasFindings) {
    const rule = ESTABLISHES[doc.kind];
    if (conclusion !== 'no_defects_identified') {
      return refuse(
        'conclusion_not_stated',
        'The record lists no findings and the document states no conclusion, so it has not '
        + 'established that there were none. An empty list is a gap in the record rather than a '
        + 'clean dwelling, and it is not scored.',
        examinedAge,
      );
    }
    if (!rule.supportsNegativeConclusion
      || !rule.coverageForNegative.includes(record.scopeCoverage)) {
      return refuse(
        'scope_too_narrow_for_conclusion',
        `A ${labelFor(doc.kind)} establishes ${rule.establishes} On this record that is not wide `
        + 'enough to support an absence of defects across the dwelling, so the document is shown '
        + 'as evidence and is not scored.',
        examinedAge,
      );
    }
  }

  const provisional = convertFindings(record.findings);
  const activated = CONDITION_METHOD_ACTIVATION?.approved === true;

  return {
    ...base,
    admissible: true,
    refusal: null,
    ageMonths: examinedAge,
    observation: activated ? provisional : null,
    provisionalObservation: provisional,
    statement: activated
      ? `Assessed from a ${labelFor(doc.kind)} issued by ${doc.issuer} on ${doc.issuedOn}, over `
        + `${coverageLabel(record.scopeCoverage)}, recording ${describeFindings(record.findings)}.`
      : `A ${labelFor(doc.kind)} issued by ${doc.issuer} on ${doc.issuedOn}, over `
        + `${coverageLabel(record.scopeCoverage)}, records ${describeFindings(record.findings)}. It `
        + 'is shown as evidence; no condition scale is authorised for this deployment yet, so it '
        + 'contributes no points.',
  };
}

/**
 * The conversion itself, separated so it can be reviewed on its own.
 *
 * Unrecognised severities are refused upstream rather than skipped here, but
 * this stays defensive: it counts what it recognises and a caller that skipped
 * the check gets a number it can compare against the finding count.
 */
export function convertFindings(findings: readonly ConditionFinding[]): number {
  let minor = 0;
  let other = 0;
  for (const f of findings) {
    if (!isFindingSeverity(f.severity)) continue;
    const d = SEVERITY_DEDUCTION[f.severity];
    if (f.severity === 'minor_defect') minor += d;
    else other += d;
  }
  const deduction = Math.min(minor, MAX_MINOR_DEDUCTION) + other;
  return Math.max(0, Math.min(100, CONDITION_REFERENCE - deduction));
}

/**
 * Pick the record a reading should be built from, where several exist.
 *
 * Preference order is {@link ADMISSIBLE_SOURCES}, then the most recent
 * examination. Deliberately not "the best score": choosing by outcome is how a
 * record becomes an argument.
 */
export function bestConditionRecord(
  records: readonly ConditionRecord[],
): ConditionRecord | null {
  const rank = (k: ConditionSourceKind) => ADMISSIBLE_SOURCES.indexOf(k);
  const usable = records.filter((r) =>
    r.document && (ADMISSIBLE_SOURCES as readonly string[]).includes(r.document.kind));
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => {
    const byKind = rank(a.document.kind) - rank(b.document.kind);
    if (byKind !== 0) return byKind;
    const da = Date.parse(a.document.inspectedOn ?? a.document.issuedOn) || 0;
    const db = Date.parse(b.document.inspectedOn ?? b.document.issuedOn) || 0;
    return db - da;
  })[0];
}

function labelFor(kind: ConditionSourceKind): string {
  switch (kind) {
    case 'building_inspection': return 'building inspection report';
    case 'strata_report': return 'strata report';
    case 'building_certificate': return 'building certificate';
    case 'vendor_statement': return 'vendor\'s statement';
  }
}

function coverageLabel(c: ScopeCoverage): string {
  switch (c) {
    case 'whole_dwelling': return 'the whole dwelling';
    case 'partial_dwelling': return 'part of the dwelling';
    case 'common_property': return 'the scheme\'s common property';
    case 'specified_works': return 'the works certified';
    case 'disclosure_only': return 'what the issuer disclosed';
  }
}

const SEVERITY_WORDS: Readonly<Record<FindingSeverity, readonly [string, string]>> = Object.freeze({
  safety_hazard: ['safety hazard', 'safety hazards'],
  major_defect: ['major defect', 'major defects'],
  unfunded_liability: ['unfunded liability', 'unfunded liabilities'],
  minor_defect: ['minor defect', 'minor defects'],
});

function describeFindings(findings: readonly ConditionFinding[]): string {
  if (findings.length === 0) return 'no defect or hazard over the scope examined';
  const counts = new Map<FindingSeverity, number>();
  for (const f of findings) {
    if (!isFindingSeverity(f.severity)) continue;
    counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const s of FINDING_SEVERITIES) {
    const n = counts.get(s);
    if (n) parts.push(`${n} ${SEVERITY_WORDS[s][n === 1 ? 0 : 1]}`);
  }
  // Findings were listed and none could be counted — say so rather than
  // printing the sentence for an empty document.
  if (parts.length === 0) return `${findings.length} finding(s) this method does not recognise`;
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : parts[0];
}
