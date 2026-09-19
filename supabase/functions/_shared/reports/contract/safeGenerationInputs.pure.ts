/**
 * RF-7.2B.1 — the point at which the safety architecture becomes the actual
 * forward production path for the Investment Property Report.
 *
 * RF-7.2B built the Client-Safe Gate, the safe fact projection and the safe
 * narrative bundle, and wired NONE of them: a report generated the day that
 * merged received exactly what it had received before. This module is the
 * boundary that changes it, and the reason it is one function rather than a
 * set of call-site edits is structural.
 *
 * `generate-investment-report` builds FOUR base prompts (suburb, postcode,
 * statewide, property), each interpolating `enhancedData` directly, and
 * `regenerate-report-qualitative` builds a FIFTH from its own
 * `buildEnhancedDataContext`. Gating at each of those five is five places to
 * forget. Gating the OBJECT they all read cannot be forgotten: a fact that is
 * not on `enhancedData` cannot reach a prompt that interpolates
 * `enhancedData`, whichever prompt it is and however it is written later.
 *
 * So the contract is: call `activateSafeGenerationInputs` once, after the
 * enhanced-data fan-out has finished and before the first prompt is composed,
 * and use the object it returns from then on.
 *
 * ## What is removed, and on what evidence
 *
 * The four disowned Location fields and the three market facts come from
 * `BLOCKED_FACTS` in the gate, which carries the measurement behind each.
 * Nothing new is decided here.
 *
 * Two deliberate boundaries:
 *
 *  - **Scoring is not re-pointed.** `investmentScoreEngine` reads `walkScore`,
 *    `commute.durationMinutes` and `schools.schoolsWithin3km`, so sanitising
 *    before the score call would silently move every new report's score. That
 *    is a different programme with its own forward-only closeout, so the
 *    activation runs AFTER scoring and before narrative and storage. The
 *    carry-forward is named in the phase document rather than quietly taken.
 *
 *  - **The whole `commute` block goes, not just its duration.** The measured
 *    defect was destination routing, and the live service has since fixed it —
 *    but a resumed run, a stored blob and a fresh call are the same shape, so
 *    nothing at this boundary can tell a repaired value from a legacy one.
 *    Blocking all of them cannot under-block; admitting the shape can. The
 *    cost is that a genuinely measured commute is not narrated, which is a
 *    loss of detail rather than a loss of accuracy.
 *
 * ## What is NOT removed
 *
 * `schools.nearestSchool` and `schools.distanceToSchool` stay: they are named
 * facts that already pass through `reconcileNearestSchool` /
 * `reconcileSchoolDistances` in the generator. Only the COUNT is disowned,
 * because the count is what sits at its ceiling on 851 of 1,114 reports.
 * Removing a working reconciliation would be widening the phase.
 *
 * Pure: no Deno, no network, no clock (the caller passes `capturedAt`), no
 * database. Deliberately total — every branch returns a value, because a
 * throw here would fail a report generation over a data-quality question.
 */

import {
  gateFact,
  isGeneratedSource,
  CLIENT_SAFE_GATE_VERSION,
  type SafeFact,
} from './clientSafeGate.pure.ts';
import {
  safeCashRate,
  safeCashRateTarget,
  cashRateTargetDetailFacts,
  SAFE_MARKET_FACTS_VERSION,
  type RbaCashRateReading,
  type CashRateTargetReading,
} from './safeMarketFacts.pure.ts';
import { isCensusProjectionSource } from '../../absCensusProjection.pure.ts';

export const SAFE_GENERATION_VERSION = '1.0.0';

/** One string naming every version a stored snapshot was produced under. */
export const ASSURANCE_VERSION =
  `gate ${CLIENT_SAFE_GATE_VERSION} / facts ${SAFE_MARKET_FACTS_VERSION} / activation ${SAFE_GENERATION_VERSION}`;

// ---------------------------------------------------------------------------
// What the activation strips
// ---------------------------------------------------------------------------

/**
 * Dotted paths removed from `enhancedData.locationIntelligence`.
 *
 * Named as data so a test can assert the list rather than the behaviour, and
 * so the phase document and the code cannot disagree about which four.
 */
export const DISOWNED_LOCATION_PATHS: readonly string[] = [
  'walkScore',
  'transport.qualityScore',
  'commute',
  'schools.schoolsWithin3km',
];

/** Why each one is disowned — the gate's evidence, restated at the boundary. */
export const DISOWNED_LOCATION_REASONS: Readonly<Record<string, string>> = {
  'walkScore':
    'A bespoke composite over Google Places result counts, published under the '
    + 'name of a third-party product with its own methodology.',
  'transport.qualityScore':
    'An invented score. The transport service deliberately publishes none, '
    + 'because a stops file carries no mode, frequency or rating.',
  'commute':
    'The measured defect was destination routing. Nothing at this boundary can '
    + 'tell a repaired value from a legacy one, so the block is disowned whole.',
  'schools.schoolsWithin3km':
    'A Places result count that sits at its ceiling on most reports, so it '
    + 'distinguishes nothing.',
};

/**
 * The ABS metrics that actually reach the narrative, with the path each sits at
 * in the `censusDemographicsResponse` payload.
 *
 * Transcribed from `censusPromptBlocks` rather than from the table, so the
 * snapshot records what a CLIENT was shown rather than what was fetched. A
 * marker saying demographics were "retrieved" cannot answer "which number did
 * the report quote"; these can.
 */
export const SNAPSHOT_ABS_METRICS: ReadonlyArray<{
  readonly name: string;
  readonly path: readonly string[];
  readonly label: string;
}> = [
  { name: 'abs.population', path: ['population', 'total'], label: 'population count' },
  { name: 'abs.medianAge', path: ['income', 'medianAge'], label: 'median age' },
  { name: 'abs.medianHouseholdIncomeAnnual', path: ['income', 'medianHouseholdIncome'], label: 'annualised median household income' },
  { name: 'abs.medianWeeklyIncome', path: ['income', 'medianWeeklyIncome'], label: 'median weekly household income' },
  { name: 'abs.unemploymentRate', path: ['income', 'unemploymentRate'], label: 'unemployment rate' },
  { name: 'abs.labourForce', path: ['employment', 'laborForce'], label: 'labour force size' },
  { name: 'abs.labourForceParticipation', path: ['employment', 'laborForceParticipation'], label: 'labour-force participation rate' },
  { name: 'abs.employmentRate', path: ['employment', 'employmentRate'], label: 'employment rate' },
];

/** The SEIFA indices `seifaTable` narrates, from a separate payload. */
export const SNAPSHOT_SEIFA_INDICES: readonly string[] = ['irsad', 'irsd', 'ier', 'ieo'];

/**
 * How many industry rows `industryTable` prints. Declared here rather than
 * inferred, so the snapshot records exactly the rows a client is shown: five
 * facts for a five-row table, and none for the sixth industry nobody sees.
 */
export const SNAPSHOT_INDUSTRY_ROWS = 5;

/**
 * RF-7.2B.1 §C5 — the exceptions to "narrated implies snapshotted".
 *
 * The rule: **any market fact admitted to a narrative prompt must have a
 * corresponding snapshot fact**, so a future reader can determine exactly which
 * values a document was written from without re-querying today's tables.
 *
 * `rf72b1SnapshotCoverage.spec.ts` enforces it by measurement rather than by
 * inspection — it stamps every leaf of a production-shaped payload with a
 * unique number, composes the real prompt blocks, and fails on any stamp that
 * reaches the prose without reaching the snapshot. That probe found two real
 * gaps on its first run (the four SEIFA DECILES, and the count of Board
 * decisions held since the last change); both are snapshotted now.
 *
 * This list is the escape hatch, and it is deliberately EMPTY. What would
 * belong here is static copy that merely looks like a fact — a threshold
 * inside an instruction, a radius in a label — never a measured value. Adding
 * an entry is a decision that a figure a client reads need not be recoverable
 * from the record, so it costs a written reason.
 */
export interface NonSnapshottedNarrativePath {
  /** Dotted path on `enhancedData`. */
  readonly path: string;
  /** Why this figure need not be reconstructable from the stored snapshot. */
  readonly reason: string;
}

export const NON_SNAPSHOTTED_NARRATIVE_PATHS: readonly NonSnapshottedNarrativePath[] = [];

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export interface SafeGenerationInput {
  /** The assembled fan-out payload. Not mutated. */
  readonly enhancedData: unknown;
  /**
   * The trusted `report_geography` row for the SUBJECT property.
   *
   * A genuine ABS source is not enough if it describes a different place. The
   * demographics payload names the postal area it came from, and that must be
   * the subject's own postcode: a real POA 3338 retrieval attached to a
   * property in 3024 is authoritative about somebody else's suburb.
   */
  readonly geography?: unknown;
  /** The in-force cash rate target, as `cashRateTargetOf` derived it. */
  readonly cashRateTarget?: CashRateTargetReading | null;
  /** The monthly-average reading, for trend context only. */
  readonly cashRateMonthlyAverage?: RbaCashRateReading | null;
  /**
   * How the caller obtained that geography, for the snapshot's own record.
   *
   * The POA each area fact belongs to is already on the fact. This answers the
   * different question a reader of a stored report cannot otherwise settle:
   * whether the geography was resolved from the verified coordinate DURING this
   * run, or read from a row a later sweep happened to have written. Those two
   * used to produce different documents for the same property.
   */
  readonly geographyProvenance?: GeographyProvenance | null;
  /** ISO timestamp the caller is generating at — passed so this stays pure. */
  readonly capturedAt: string;
}

export interface GeographyProvenance {
  /** `pre_generation` | `stored_row` | `none`. */
  readonly source: string;
  /** The resolver's own status word, or `unresolved`. */
  readonly status: string;
  /** True where the ABS payload was re-fetched on the trusted postal area. */
  readonly absRequeried: boolean;
}

export interface RemovedFact {
  readonly path: string;
  readonly reason: string;
  /** True where the value was actually present — a removal that removed something. */
  readonly hadValue: boolean;
}

/** One fact as the report stores it, so reopening cannot re-read today's tables. */
export interface SnapshotFact {
  readonly name: string;
  readonly status: 'present' | 'absent';
  readonly value: number | string | null;
  readonly source: string | null;
  readonly dataset: string | null;
  readonly grain: string | null;
  readonly geographyId: string | null;
  readonly referencePeriod: string | null;
  readonly asOf: string | null;
  readonly ruling: string;
}

export interface MarketFactSnapshot {
  readonly capturedAt: string;
  readonly assuranceVersion: string;
  /**
   * The postal area every area fact below is keyed on, and how it was reached.
   * Null geography is a real reading: no trusted postcode, area facts withheld.
   */
  readonly geography: {
    readonly postcode: string | null;
    readonly source: string;
    readonly status: string;
    readonly absRequeried: boolean;
  };
  readonly facts: readonly SnapshotFact[];
}

export interface SafeGenerationResult {
  /** Use this from here on. The input object is left untouched. */
  readonly enhancedData: Record<string, unknown>;
  readonly facts: readonly SafeFact<unknown>[];
  readonly removed: readonly RemovedFact[];
  readonly snapshot: MarketFactSnapshot;
  readonly demographicsKept: boolean;
  readonly demographicsRuling: string;
  readonly version: string;
}

// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/**
 * Delete a dotted path from a shallow clone, reporting whether anything was
 * there. Clones only the objects on the path, so unrelated branches keep their
 * identity and nothing else in the payload is disturbed.
 */
function withoutPath(
  source: Record<string, unknown>,
  path: string,
): { next: Record<string, unknown>; hadValue: boolean } {
  const [head, ...rest] = path.split('.');
  if (!(head in source)) return { next: source, hadValue: false };

  if (rest.length === 0) {
    const hadValue = source[head] !== undefined && source[head] !== null;
    const next = { ...source };
    delete next[head];
    return { next, hadValue };
  }

  const child = source[head];
  if (!isRecord(child)) return { next: source, hadValue: false };
  const inner = withoutPath(child, rest.join('.'));
  if (inner.next === child) return { next: source, hadValue: false };
  return { next: { ...source, [head]: inner.next }, hadValue: inner.hadValue };
}

/** Read a dotted path out of a payload, or null. */
export function readPath(source: unknown, path: readonly string[]): number | string | null {
  let cursor: unknown = source;
  for (const key of path) {
    if (!isRecord(cursor)) return null;
    cursor = cursor[key];
  }
  if (typeof cursor === 'number' && Number.isFinite(cursor)) return cursor;
  if (typeof cursor === 'string' && cursor.trim() !== '') return cursor.trim();
  return null;
}

/**
 * The subject property's own postcode, from a TRUSTED `report_geography` row.
 *
 * Untrusted geography yields null, which withholds demographics rather than
 * letting an unconfirmed location vouch for an area's statistics.
 */
export function subjectPostcodeOf(geography: unknown): string | null {
  if (!isRecord(geography)) return null;
  const status = str(geography['status']);
  if (status === null || !['resolved', 'resolved_with_warning'].includes(status)) return null;
  const postcode = str(geography['postcode']) ?? str(geography['poa']);
  return postcode !== null && /^\d{4}$/.test(postcode) ? postcode : null;
}

/**
 * Is this demographics payload a retrieval from the Census table, or a
 * generated block wearing the same label?
 *
 * Asymmetric on purpose: it must be RECOGNISED to be kept. `dataQuality` alone
 * is not enough — the generated corpus set it too — so the source string must
 * also have the exact shape the Census projection emits, and must carry no
 * generated-source marker anywhere in it.
 */
export function demographicsAreRetrieved(demographics: unknown): boolean {
  if (!isRecord(demographics)) return false;
  const source = demographics['dataSource'] ?? demographics['source'];
  if (isGeneratedSource(source)) return false;
  if (!isCensusProjectionSource(source)) return false;
  return str(demographics['dataQuality']) === 'census';
}

/**
 * The postal area out of `ABS Census 2021 (POA 3024)`.
 *
 * Safe to read positionally because `isCensusProjectionSource` has already
 * established the exact shape; a string that did not match never gets here.
 * The geography identifier is carried on the SNAPSHOT rather than added to
 * `FactContext`, which is a shared type several other surfaces already render.
 */
export function poaOfCensusSource(source: unknown): string | null {
  if (typeof source !== 'string') return null;
  const m = /\(POA (\d{4})\)$/.exec(source.trim());
  return m ? m[1] : null;
}

const snapshotFactOf = (
  f: SafeFact<unknown>,
  geographyId: string | null,
): SnapshotFact => ({
  name: f.name,
  status: f.status,
  value: typeof f.value === 'number' || typeof f.value === 'string' ? f.value : null,
  source: f.source,
  dataset: f.context?.dataset ?? null,
  grain: f.context?.grain ?? null,
  geographyId,
  referencePeriod: f.context?.referencePeriod ?? null,
  asOf: f.context?.asOf ?? null,
  ruling: f.ruling,
});

/**
 * Apply the gate to one report's enhanced data.
 *
 * Returns a NEW payload. Callers replace their working object with it, and
 * everything downstream — every prompt branch, the stored blobs, the derived
 * briefing — is then reading gated facts by construction.
 */
export function activateSafeGenerationInputs(
  input: SafeGenerationInput,
): SafeGenerationResult {
  const removed: RemovedFact[] = [];
  const facts: SafeFact<unknown>[] = [];

  let next: Record<string, unknown> = isRecord(input.enhancedData)
    ? { ...input.enhancedData }
    : {};

  // --- Location: disown the four, wherever they sit -------------------------
  const location = next['locationIntelligence'];
  if (isRecord(location)) {
    let loc: Record<string, unknown> = location;
    for (const path of DISOWNED_LOCATION_PATHS) {
      const result = withoutPath(loc, path);
      loc = result.next;
      const reason = DISOWNED_LOCATION_REASONS[path] ?? 'Disowned by the Client-Safe Gate.';
      removed.push({ path: `locationIntelligence.${path}`, reason, hadValue: result.hadValue });
      facts.push(gateFact({
        name: `market.${path.split('.').pop()}`,
        value: null,
        safety: 'not_client_safe',
        source: 'location_intelligence',
      }));
    }
    next['locationIntelligence'] = loc;
  }

  // --- Demographics: a recognised retrieval AND the subject's own POA -------
  const demographics = next['demographics'];
  const demographicsSource = isRecord(demographics)
    ? str(demographics['dataSource'] ?? demographics['source'])
    : null;
  const demographicsPoa = poaOfCensusSource(demographicsSource);
  const subjectPostcode = subjectPostcodeOf(input.geography);
  const retrieved = demographicsAreRetrieved(demographics);
  const poaMatches = demographicsPoa !== null
    && subjectPostcode !== null
    && demographicsPoa === subjectPostcode;
  const demographicsKept = retrieved && poaMatches;
  const demographicsReferencePeriod = isRecord(demographics)
    ? str(demographics['referencePeriod'])
    : null;

  let demographicsRuling: string;
  if (demographics === undefined || demographics === null) {
    demographicsRuling =
      'No demographic payload was supplied for this report, so none is narrated.';
  } else if (!retrieved) {
    demographicsRuling =
      'The demographic payload is not a recognised ABS Census postal-area retrieval, '
      + 'so it is withheld. It is not estimated, synthesised or borrowed from a '
      + 'neighbouring area.';
  } else if (subjectPostcode === null) {
    demographicsRuling =
      'This property has no trusted resolved postcode, so area statistics cannot be '
      + 'confirmed to describe it and are withheld. They are not estimated, synthesised '
      + 'or borrowed from a neighbouring area.';
  } else if (!poaMatches) {
    demographicsRuling =
      `The available ABS Census data is for postal area ${demographicsPoa ?? 'an unnamed area'}, `
      + `but this property resolves to postcode ${subjectPostcode}. Statistics for a different `
      + 'area are withheld rather than attached to it. They are not estimated, synthesised or '
      + 'borrowed from a neighbouring area.';
  } else {
    demographicsRuling =
      `Retrieved from the ABS Census postal-area table (${demographicsSource ?? 'POA'}) and `
      + `confirmed to describe this property's own postcode ${subjectPostcode}.`;
  }

  if (!demographicsKept && demographics !== undefined && demographics !== null) {
    delete next['demographics'];
    removed.push({ path: 'demographics', reason: demographicsRuling, hadValue: true });
  }
  // SEIFA describes the same postal area as the Census figures beside it, so it
  // stands or falls on the same geography question.
  const seifa = next['seifaData'];
  if (!demographicsKept && seifa !== undefined && seifa !== null) {
    delete next['seifaData'];
    removed.push({
      path: 'seifaData',
      reason: 'SEIFA indices describe the same postal area as the Census figures beside '
        + 'them, so they are withheld on the same ground. ' + demographicsRuling,
      hadValue: true,
    });
  }
  // And so does the employment payload — a HOLE this phase's coverage probe
  // found rather than reasoned about. `abs-employment-service` projects the
  // SAME `abs_census_poa` row, keyed on the SAME address-derived postcode, and
  // `industryTable` prints from it INDEPENDENTLY of the population table. So a
  // report whose demographics were withheld because they describe postal area
  // 3338 while the property resolves to 3024 still printed 3338's industry mix
  // as a client-visible table, under its own heading. One rule, three payloads
  // from one table.
  const employmentPayload = next['employmentData'];
  if (!demographicsKept && employmentPayload !== undefined && employmentPayload !== null) {
    delete next['employmentData'];
    removed.push({
      path: 'employmentData',
      reason: 'The employment and industry figures are the same postal-area Census row as '
        + 'the demographics beside them, so they are withheld on the same ground. '
        + demographicsRuling,
      hadValue: true,
    });
  }

  const absContext = {
    grain: 'postcode' as const,
    referencePeriod: demographicsReferencePeriod
      ? `${demographicsReferencePeriod} Census`
      : '2021 Census',
    dataset: 'abs_census_poa',
    asOf: demographicsReferencePeriod,
  };

  if (demographicsKept) {
    // One fact per NARRATED metric, carrying its actual value. This is what
    // lets a future reader say which number the narrative was built on; a
    // roll-up saying "retrieved" cannot answer that.
    for (const metric of SNAPSHOT_ABS_METRICS) {
      facts.push(gateFact({
        name: metric.name,
        value: readPath(demographics, metric.path),
        safety: 'contextual',
        source: 'abs_census_poa',
        context: absContext,
        absenceReason:
          `The ABS Census holds no ${metric.label} for postal area ${subjectPostcode}.`,
      }));
    }
    if (isRecord(seifa)) {
      for (const index of SNAPSHOT_SEIFA_INDICES) {
        if (!isRecord(seifa[index])) continue;
        facts.push(gateFact({
          name: `abs.seifa.${index}`,
          value: readPath(seifa, [index, 'score']),
          safety: 'contextual',
          source: 'abs_seifa_poa',
          context: { ...absContext, dataset: 'abs_seifa_poa' },
          absenceReason:
            `The SEIFA release carries no ${index.toUpperCase()} score for postal area ${subjectPostcode}.`,
        }));
        // `seifaTable` prints BOTH the score and the decile, and the decile is
        // the one a reader acts on ("7/10"). Snapshotting only the score left
        // half of a printed row unaccounted for — found by the §C5 coverage
        // probe. A decile is a separate published figure, not a rounding of
        // the score, so it cannot be re-derived from the fact beside it.
        facts.push(gateFact({
          name: `abs.seifa.${index}Decile`,
          value: readPath(seifa, [index, 'decile']),
          safety: 'contextual',
          source: 'abs_seifa_poa',
          context: { ...absContext, dataset: 'abs_seifa_poa' },
          absenceReason:
            `The SEIFA release carries no ${index.toUpperCase()} decile for postal area ${subjectPostcode}.`,
        }));
      }
    }

    // The industry mix is a client-visible TABLE — up to five named industries
    // with a measured workforce share each — and it printed figures nothing
    // recorded. Third gap found by the §C5 coverage probe. One fact per printed
    // row, named by the industry, because a share means nothing without the
    // industry it belongs to.
    const industries = isRecord(next['employmentData'])
      ? (next['employmentData'] as Record<string, unknown>)['majorIndustries']
      : undefined;
    const fallback = isRecord(demographics) && isRecord(demographics['employment'])
      ? (demographics['employment'] as Record<string, unknown>)['topIndustries']
      : undefined;
    const printed = Array.isArray(industries) ? industries
      : Array.isArray(fallback) ? fallback
      : [];
    for (const row of printed.slice(0, SNAPSHOT_INDUSTRY_ROWS)) {
      if (!isRecord(row)) continue;
      const name = str(row['name']);
      if (name === null) continue;
      facts.push(gateFact({
        name: `abs.industryShare.${name}`,
        value: readPath(row, ['percentage']),
        safety: 'contextual',
        source: 'abs_census_poa',
        context: absContext,
        absenceReason:
          `The Census release carries no workforce share for ${name} in postal area `
          + `${subjectPostcode}.`,
      }));
    }
  }

  // The roll-up stays, because a reader needs to know at a glance whether the
  // block was admitted at all — but it is no longer the only thing recorded.
  facts.push(gateFact({
    name: 'market.demographics',
    value: demographicsKept ? 'retrieved' : null,
    safety: demographicsKept ? 'contextual' : 'not_client_safe',
    source: demographicsKept ? 'abs_census_poa' : 'withheld',
    material: true,
    context: demographicsKept ? absContext : undefined,
    absenceReason: demographicsKept ? undefined : demographicsRuling,
  }));

  // --- The cash rate: the in-force target leads, the average is context -----
  //
  // The gate's verdict has to reach the PROMPT, not just the fact list.
  // `macroEconomicBlock` renders `economics.cashRateTarget` straight off the
  // payload, so a refused target — an LLM-sourced one, a series that is not
  // FIRMMCRTD — would still have printed a "current" row with an effective
  // date while the gate recorded it as absent. Removing the refused value from
  // the object is what makes the refusal structural rather than advisory: the
  // block then fails closed onto the monthly average under its own label,
  // which is exactly what it does when F1 is not loaded at all.
  const targetFact = safeCashRateTarget(input.cashRateTarget ?? null);
  const monthlyFact = safeCashRate(input.cashRateMonthlyAverage ?? null);
  facts.push(targetFact, monthlyFact, ...cashRateTargetDetailFacts(input.cashRateTarget ?? null));

  const economics = next['economics'];
  if (isRecord(economics) && economics['cashRateTarget'] !== undefined) {
    if (targetFact.status !== 'present') {
      const stripped = { ...economics };
      delete stripped['cashRateTarget'];
      next['economics'] = stripped;
      removed.push({
        path: 'economics.cashRateTarget',
        reason:
          targetFact.absence?.reason
          ?? 'The gate did not recognise this as the Reserve Bank cash rate target.',
        hadValue: economics['cashRateTarget'] !== null,
      });
    }
  }

  return {
    enhancedData: next,
    facts,
    removed,
    demographicsKept,
    demographicsRuling,
    snapshot: {
      capturedAt: input.capturedAt,
      assuranceVersion: ASSURANCE_VERSION,
      geography: {
        postcode: subjectPostcode,
        source: input.geographyProvenance?.source ?? 'none',
        status: input.geographyProvenance?.status
          ?? (subjectPostcode === null ? 'unresolved' : 'resolved'),
        absRequeried: input.geographyProvenance?.absRequeried ?? false,
      },
      facts: facts.map((f) =>
        snapshotFactOf(f, f.name.startsWith('abs.') || f.name === 'market.demographics'
          ? (demographicsKept ? subjectPostcode : null)
          : null)),
    },
    version: SAFE_GENERATION_VERSION,
  };
}
