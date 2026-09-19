/**
 * RF-7.1 — the Report Fact Contract for the Investment Property Report.
 *
 * One typed, versioned, deterministic answer to "what does this report
 * actually know, how does it know it, and how much of it is absent?"
 *
 * ## This is an ADAPTER. It owns nothing.
 *
 * Every figure here is produced by a module that already owns it and keeps
 * owning it:
 *
 * | fact family        | canonical owner (unchanged)                        |
 * | ------------------ | -------------------------------------------------- |
 * | observed facts     | `facts/historicalFactAuthority.pure.ts`             |
 * | derived ratios     | `metrics/propertyMetrics.pure.ts`                   |
 * | finance block      | `investment/financialEngine.pure.ts`                |
 * | property specs     | `investment/propertyRecord.pure.ts`                 |
 * | duty & acquisition | `stampDuty/engine.pure.ts` (read, never re-run)     |
 * | geography identity | `report_geography` (the table, via its resolver)    |
 * | scoring state      | the `policy` stamp the scoring run wrote            |
 *
 * Nothing in this file re-implements any of them, and nothing in this file is
 * imported by any of them. The dependency arrow points one way, which is what
 * makes RF-7.1 removable: delete this directory and the platform is exactly
 * what it was.
 *
 * ## Why it exists at all
 *
 * The same fact is read differently by the viewer, the PDF projection, the
 * template adapter, the comparison and the Q&A surface — each with its own
 * `??` chain — so "what is this report's purchase price" has had as many
 * answers as it has readers. This is the one place that answers it, with the
 * path it was read from and the reason it is absent when it is.
 *
 * `historicalFactAuthority` already settled the precedence for eight fields
 * and has **no production consumer** — RF71_CAPABILITY_INVENTORY.md §4.1. This
 * contract adapts it rather than becoming a third implementation of the same
 * ordering, which is the entire point of the strangler.
 *
 * ## Four rules it is built on
 *
 * **Absent is absent.** Never `0`, never `''`, never `false`, never a default
 * house, never a placeholder coordinate. A `Fact` whose `status` is `absent`
 * carries a `reason` sentence and a `null` value, and there is no third state
 * where a reader has to guess.
 *
 * **A trusted metric is not a scored assessment.** `grossYield` is arithmetic
 * on two figures the operator stated; a dimension score is a judgement an
 * engine made. They live in different sections and neither can be read as the
 * other.
 *
 * **Geography identity is not Location scoring.** `report_geography` is a
 * point-in-polygon answer against ABS ASGS boundaries and never consults the
 * free-text address; the Location dimension's walk score, commute and school
 * count are a separate, untrusted thing (audit §69). Putting them in one
 * section is how a suburb name came to be treated as evidence of amenity.
 *
 * **Finance is not property quality.** Leverage and holding cash flow describe
 * the BUYER. They are reported in `finance` and are admitted to no assessment,
 * exactly as the scoring policy requires.
 *
 * ## Purity
 *
 * No database read, no network call, no model call, no clock, no randomness,
 * no write of any kind. It receives already-loaded rows and returns a value.
 * `observedAt` is a parameter, never `new Date()`, so the same input produces
 * a byte-identical contract forever.
 *
 * ## Not a consumer of this, yet
 *
 * RF-7.1 ships this beside the working Reporting Engine and switches nothing.
 * The viewer, the PDF routes, the templates and the generation path all read
 * exactly what they read before. Adoption is a later, controlled stage.
 */

import {
  resolveAllFacts,
  type FactSource,
  type FactProvenanceKind,
  type ResolvedFact,
} from '../facts/historicalFactAuthority.pure.ts';
import {
  grossYield,
  netYield,
  originationLvr,
  currentLvr,
  equity,
  financeIdentityBreaches,
  labelFor,
  type BasedMetric,
  type IdentityBreach,
} from '../metrics/propertyMetrics.pure.ts';
import {
  reconcileStoredFinancials,
  type StoredFinancialsReconciliation,
} from '../investment/financialEngine.pure.ts';
import {
  readPropertyFacts,
  type ResolvedPropertyFacts,
} from '../investment/propertyRecord.pure.ts';

export const REPORT_FACT_CONTRACT_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// The leaf
// ---------------------------------------------------------------------------

/** Where a fact sits in time, which decides whether it may ever be recomputed. */
export type FactTemporality =
  /** Stored on the report when it was produced. Historical; never recomputed. */
  | 'snapshot'
  /** Derived on read from snapshot values by a canonical owner. */
  | 'derived'
  /** Structural metadata about the row itself. */
  | 'record';

export interface FactAbsence {
  /** One sentence a reader can act on. Never empty. */
  readonly reason: string;
  /**
   * True where the platform genuinely never held the fact, false where it
   * holds a value this contract declines to publish. Two different remedies.
   */
  readonly neverCaptured: boolean;
}

/** One fact, with everything needed to defend it or explain its absence. */
export interface Fact<T> {
  readonly status: 'present' | 'absent';
  readonly value: T | null;
  /** Present exactly when `status` is `absent`. */
  readonly absence: FactAbsence | null;
  /** The canonical module that produced it. Never this file. */
  readonly owner: string;
  /** The exact path it was read from, for audit. */
  readonly sourcePath: string | null;
  readonly provenance: FactProvenanceKind;
  readonly temporality: FactTemporality;
  /**
   * What the number is measured ON, where that is a real question — the
   * `BasedMetric` distinction. Null where the fact has no basis to state.
   */
  readonly basis: string | null;
  /** A lower-precedence value that disagreed. Recorded, never erased. */
  readonly supersededValue: T | null;
  readonly supersededSource: FactSource | null;
}

const absent = <T>(
  reason: string,
  owner: string,
  temporality: FactTemporality,
  neverCaptured = true,
): Fact<T> => ({
  status: 'absent',
  value: null,
  absence: { reason, neverCaptured },
  owner,
  sourcePath: null,
  provenance: 'unavailable',
  temporality,
  basis: null,
  supersededValue: null,
  supersededSource: null,
});

const present = <T>(
  value: T,
  owner: string,
  sourcePath: string | null,
  provenance: FactProvenanceKind,
  temporality: FactTemporality,
  basis: string | null = null,
): Fact<T> => ({
  status: 'present',
  value,
  absence: null,
  owner,
  sourcePath,
  provenance,
  temporality,
  basis,
  supersededValue: null,
  supersededSource: null,
});

/** Lift one of the authority's resolutions into a contract fact. */
function fromAuthority<T>(
  resolved: ResolvedFact<unknown>,
  absentReason: string,
): Fact<T> {
  if (resolved.value === null) {
    return absent<T>(absentReason, 'facts/historicalFactAuthority.pure.ts', 'snapshot');
  }
  return {
    status: 'present',
    value: resolved.value as T,
    absence: null,
    owner: 'facts/historicalFactAuthority.pure.ts',
    sourcePath: resolved.sourcePath,
    provenance: resolved.kind,
    temporality: 'snapshot',
    basis: null,
    supersededValue: (resolved.supersededValue ?? null) as T | null,
    supersededSource: resolved.supersededSource,
  };
}

/** Lift a `BasedMetric` into a contract fact, keeping its basis label. */
function fromBasedMetric(
  metric: BasedMetric | null,
  absentReason: string,
  label: 'grossYield' | 'netYield',
): Fact<number> {
  if (metric === null) {
    return absent<number>(absentReason, 'metrics/propertyMetrics.pure.ts', 'derived');
  }
  return present<number>(
    metric.value,
    'metrics/propertyMetrics.pure.ts',
    null,
    'derived',
    'derived',
    labelFor(label, metric.basis),
  );
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Exactly the rows a caller has already loaded. Nothing here is fetched.
 *
 * `unknown` rather than a generated row type on purpose: the contract must
 * tolerate every historical shape the corpus holds without a migration, and a
 * strict type would reject a 2024 row that is perfectly readable.
 */
export interface ReportFactInput {
  /** A row of `public.investment_reports`, in whatever shape it was stored. */
  readonly report: unknown;
  /** The matching `public.report_geography` row, when one exists. */
  readonly geography?: unknown;
  /** When this contract was built. A parameter, so the function stays pure. */
  readonly observedAt: Date;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface RecordIdentity {
  readonly reportId: Fact<string>;
  readonly variant: Fact<string>;
  readonly tier: Fact<string>;
  readonly status: Fact<string>;
  readonly generationEngine: Fact<string>;
  readonly currentVersion: Fact<number>;
  /** The report this was forked from, where it was forked. */
  readonly parentReportId: Fact<string>;
  /** The report this was condensed/derived from, where it was derived. */
  readonly derivedFromReportId: Fact<string>;
  readonly createdAt: Fact<string>;
}

/**
 * Where the property IS. Never where it scores.
 *
 * Sourced from `report_geography` alone — a point-in-polygon answer against
 * ABS ASGS 2021 boundaries. The free-text `property_address` is deliberately
 * not a source here (ADDRESS_COMPOSITION.md records why), and no value in this
 * section comes from `location_intelligence`.
 */
export interface GeographyIdentity {
  readonly suburb: Fact<string>;
  readonly postcode: Fact<string>;
  readonly state: Fact<string>;
  readonly sa2Name: Fact<string>;
  readonly remotenessArea: Fact<string>;
  readonly latitude: Fact<number>;
  readonly longitude: Fact<number>;
  /** `resolved` / `resolved_with_warning` / `requires_review` / `unresolved`. */
  readonly resolutionStatus: Fact<string>;
  /** Flags the resolver raised — a sentinel coordinate names itself here. */
  readonly flags: Fact<readonly string[]>;
}

export interface PropertyIdentity {
  readonly propertyType: Fact<string>;
  readonly bedrooms: Fact<number>;
  readonly bathrooms: Fact<number>;
  readonly carSpaces: Fact<number>;
  readonly landSize: Fact<number>;
  readonly buildingSize: Fact<number>;
  readonly yearBuilt: Fact<number>;
  /**
   * The engine's own vocabulary (`house | unit | townhouse`), or absent.
   *
   * Deliberately separate from `propertyType`, which is what the record SAYS.
   * `readPropertyFacts` leaves it undefined rather than defaulting, because a
   * defaulted house awards a schema to a property nobody classified.
   */
  readonly normalisedType: Fact<string>;
}

/** The buyer's position. Admitted to no assessment, by design. */
export interface FinancePosition {
  readonly purchasePrice: Fact<number>;
  readonly weeklyRent: Fact<number>;
  readonly deposit: Fact<number>;
  readonly loanAmount: Fact<number>;
  readonly lvr: Fact<number>;
  readonly weeklyCashFlow: Fact<number>;
  readonly annualOutgoings: Fact<number>;
  readonly stampDuty: Fact<number>;
  readonly totalUpfront: Fact<number>;
  /**
   * What KIND of rent `weeklyRent` is — RF-7.2B §6.
   *
   * A current lease, an agent's appraisal and a market estimate are three
   * different facts, and every yield in the report is built on whichever it
   * was. The record has never captured which, so this reads a forward-only
   * optional field and reports `unknown` for every historical row rather than
   * inferring one from the value. Inferring would be a guess about evidence,
   * which is the whole class of defect this programme exists to remove.
   */
  readonly rentBasis: Fact<string>;
  /** When that rent was observed, appraised or the lease signed. */
  readonly rentAsOf: Fact<string>;
}

/** Ratios the platform derives. Every one carries the basis it was taken on. */
export interface DerivedMetrics {
  readonly grossYield: Fact<number>;
  readonly netYield: Fact<number>;
  readonly originationLvr: Fact<number>;
  readonly currentLvr: Fact<number>;
  readonly equity: Fact<number>;
}

/**
 * What an engine was AUTHORISED to say, and what it said.
 *
 * `authority` mirrors the stamp the scoring run wrote (audit §69):
 * `legacy_snapshot` for a historical row carrying no stamp, `unavailable`
 * for a new report with no authorised engine, `v2` only once the frozen V2
 * engine is genuinely wired. It is READ here and never decided here.
 */
export interface ScoringState {
  readonly authority: 'legacy_snapshot' | 'unavailable' | 'v2' | 'none';
  readonly gradeIssued: boolean;
  readonly dimensionScoresAuthoritative: boolean;
  readonly grade: Fact<string>;
  readonly composite: Fact<number>;
  readonly measuredDimensions: readonly string[];
  /** Why this reading is what it is, in one sentence a client could read. */
  readonly explanation: string;
}

export interface ProjectionState {
  readonly present: boolean;
  readonly years: Fact<number>;
  readonly owner: string;
  readonly note: string;
}

/** What the record says about itself that a reader should know. */
export interface Integrity {
  /** Identity breaches `propertyMetrics` found in the stored finance block. */
  readonly financeBreaches: readonly IdentityBreach[];
  /** What `reconcileStoredFinancials` healed on READ. Nothing is written. */
  readonly readTimeHealing: {
    readonly healedScenarios: readonly string[];
    readonly sensitivityHealed: boolean;
    readonly metricsReconciled: boolean;
    readonly totalUpfrontDerived: boolean;
    readonly financeIdentityHealed: 'loan' | 'deposit' | null;
  };
  /** Facts the contract could not resolve, by name. */
  readonly absentFacts: readonly string[];
  /** Facts resolved from a lower-precedence source after a disagreement. */
  readonly supersededFacts: readonly string[];
}

export interface ReportFactContract {
  readonly contractVersion: string;
  readonly observedAt: string;
  readonly record: RecordIdentity;
  readonly geography: GeographyIdentity;
  readonly property: PropertyIdentity;
  readonly finance: FinancePosition;
  readonly derived: DerivedMetrics;
  readonly scoring: ScoringState;
  readonly projection: ProjectionState;
  readonly integrity: Integrity;
}

// ---------------------------------------------------------------------------
// Readers — small, total, and tolerant of every historical shape
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const at = (root: unknown, path: readonly string[]): unknown => {
  let cur: unknown = root;
  for (const key of path) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
};

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * A string that carries information.
 *
 * Empty and whitespace-only are ABSENT, not present-and-empty: a blank suburb
 * renders as a blank line, which reads as a broken page rather than as a fact
 * nobody captured.
 */
const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

/** Read a plain column into a `record` fact. */
function column<T>(
  row: unknown,
  key: string,
  read: (v: unknown) => T | null,
  absentReason: string,
): Fact<T> {
  const raw = isRecord(row) ? row[key] : undefined;
  const v = read(raw);
  return v === null
    ? absent<T>(absentReason, 'public.investment_reports', 'record')
    : present<T>(v, 'public.investment_reports', `investment_reports.${key}`, 'observed', 'record');
}

/** Read a `report_geography` column. */
function geoColumn<T>(
  geo: unknown,
  key: string,
  read: (v: unknown) => T | null,
  absentReason: string,
): Fact<T> {
  if (!isRecord(geo)) {
    return absent<T>(
      'No geography has been resolved for this report, so no locality fact is available. '
      + 'The free-text address is never a substitute.',
      'public.report_geography',
      'snapshot',
    );
  }
  const v = read(geo[key]);
  return v === null
    ? absent<T>(absentReason, 'public.report_geography', 'snapshot')
    : present<T>(v, 'public.report_geography', `report_geography.${key}`, 'derived', 'snapshot');
}

// ---------------------------------------------------------------------------
// Scoring state — read the stamp, never re-decide it
// ---------------------------------------------------------------------------

const NO_GRADE_EXPLANATION =
  'An overall investment grade is only issued when sufficient verified property evidence is '
  + 'available. Available measured analysis is shown below.';

function readScoringState(score: unknown): ScoringState {
  if (!isRecord(score)) {
    return {
      authority: 'none',
      gradeIssued: false,
      dimensionScoresAuthoritative: false,
      grade: absent<string>(
        'No scoring run has been recorded against this report.',
        'investment_reports.investment_score',
        'snapshot',
      ),
      composite: absent<number>(
        'No scoring run has been recorded against this report.',
        'investment_reports.investment_score',
        'snapshot',
      ),
      measuredDimensions: [],
      explanation: 'This report carries no scoring record at all.',
    };
  }

  const policy = isRecord(score.policy) ? score.policy : null;

  // An absent stamp is a report scored BEFORE the policy existed. It is a
  // legacy snapshot and renders exactly as it always did — that is how history
  // is preserved, and the reading is asserted rather than assumed.
  const authority: ScoringState['authority'] = policy === null
    ? 'legacy_snapshot'
    : (policy.authority === 'v2' ? 'v2'
      : policy.authority === 'unavailable' ? 'unavailable'
        : 'legacy_snapshot');

  const gradeIssued = policy === null
    ? num(score.totalScore) !== null && str(score.grade) !== null
    : policy.gradeIssued === true;

  const dimensionScoresAuthoritative = policy === null
    ? true
    : policy.dimensionScoresAuthoritative !== false;

  const measured: string[] = policy !== null && Array.isArray(policy.measuredDimensions)
    ? policy.measuredDimensions.filter((d): d is string => typeof d === 'string')
    : [];

  const gradeValue = str(score.grade);
  const grade: Fact<string> = gradeIssued && gradeValue !== null && gradeValue !== 'N/A'
    ? present<string>(
      gradeValue,
      'investment-scoring-service',
      'investment_score.grade',
      'derived',
      'snapshot',
    )
    : absent<string>(
      NO_GRADE_EXPLANATION,
      'investment-scoring-service',
      'snapshot',
      /* neverCaptured */ policy !== null,
    );

  const compositeValue = num(score.totalScore);
  const composite: Fact<number> = gradeIssued && compositeValue !== null
    ? present<number>(
      compositeValue,
      'investment-scoring-service',
      'investment_score.totalScore',
      'derived',
      'snapshot',
    )
    : absent<number>(
      NO_GRADE_EXPLANATION,
      'investment-scoring-service',
      'snapshot',
      /* neverCaptured */ policy !== null,
    );

  const explanation = authority === 'legacy_snapshot'
    ? 'Scored before the current evidence policy. It is a historical snapshot, preserved exactly '
      + 'as issued and never recomputed.'
    : authority === 'unavailable'
      ? NO_GRADE_EXPLANATION
      : authority === 'v2'
        ? 'Scored by the versioned scoring engine under its published output contract.'
        : 'This report carries no scoring record at all.';

  return {
    authority,
    gradeIssued,
    dimensionScoresAuthoritative,
    grade,
    composite,
    measuredDimensions: measured,
    explanation,
  };
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the contract for one report.
 *
 * Deterministic, side-effect free, and total: every historical shape in the
 * corpus produces a contract rather than an exception, because a reader that
 * throws on a 2024 row is worse than one that says the fact is absent.
 */
export function buildReportFactContract(input: ReportFactInput): ReportFactContract {
  const row = isRecord(input.report) ? input.report : {};
  const geo = input.geography;

  // --- the finance block, reconciled on READ by its own owner ---------------
  const reconciliation: StoredFinancialsReconciliation =
    reconcileStoredFinancials(row.financial_calculations);
  const fin = reconciliation.fin;

  // --- the eight authority fields ------------------------------------------
  const facts = resolveAllFacts({
    manual_overrides: row.manual_overrides,
    financial_calculations: fin,
    property_specs: row.property_specs,
    report_geography: geo,
  });

  const purchasePrice = fromAuthority<number>(
    facts.purchasePrice,
    'No purchase price is recorded on this report, in the operator\'s stated parameters or in the '
    + 'calculated finance block.',
  );
  const weeklyRent = fromAuthority<number>(
    facts.weeklyRent,
    'No weekly rent is established for this property, so every figure derived from rent is absent '
    + 'rather than zero.',
  );
  const lvr = fromAuthority<number>(
    facts.lvr,
    'No loan-to-value ratio is recorded for this purchase.',
  );
  const weeklyCashFlow = fromAuthority<number>(
    facts.weeklyCashFlow,
    'No holding cash flow has been calculated for this report.',
  );
  const annualOutgoings = fromAuthority<number>(
    facts.annualOutgoings,
    'No annual outgoings total is recorded on this report.',
  );

  // --- property identity ----------------------------------------------------
  // `readPropertyFacts` is the canonical reader: it takes BOTH stores because
  // the spec column's snake_case and the overrides' camelCase are two
  // spellings of one fact, and reading only one is how 127 land sizes went
  // missing. It also refuses to default the type. Nothing is re-derived here.
  const propertyFacts: ResolvedPropertyFacts = readPropertyFacts(
    row.property_specs,
    row.manual_overrides,
  );

  const propertyType: Fact<string> = propertyFacts.propertyType === null
    ? absent<string>(
      'No property type was captured for this report. It is deliberately not defaulted: a '
      + 'defaulted dwelling type puts the wrong assessment schema on the asset.',
      'investment/propertyRecord.pure.ts',
      'snapshot',
    )
    : present<string>(
      propertyFacts.propertyType,
      'investment/propertyRecord.pure.ts',
      'property_specs.property_type',
      'observed',
      'snapshot',
    );

  // --- derived ratios, each carrying its basis ------------------------------
  const annualRent = weeklyRent.value === null ? null : weeklyRent.value * 52;
  const deposit = num(at(fin, ['initialCosts', 'deposit']));
  const loanAmount = num(at(fin, ['loanDetails', 'loanAmount']))
    ?? num(at(fin, ['initialCosts', 'loanAmount']));
  const stampDutyValue = num(at(fin, ['initialCosts', 'stampDuty']));
  const totalUpfront = num(at(fin, ['initialCosts', 'totalUpfront']));

  const gross = annualRent === null || purchasePrice.value === null
    ? null
    : grossYield({ annualRent, basisAmount: purchasePrice.value, basis: 'purchase' });

  const net = annualRent === null || purchasePrice.value === null || annualOutgoings.value === null
    ? null
    : netYield({
      annualRent,
      annualOperatingCosts: annualOutgoings.value,
      basisAmount: purchasePrice.value,
      basis: 'purchase',
    });

  // The loan is READ, never reconstructed as `price - deposit`: that identity is
  // measured to break on 21 stored reports (MX-D), so synthesising the loan from
  // the deposit would publish a confident LVR on exactly the rows where the two
  // sides disagree. Absent is absent.
  const origination = loanAmount === null || purchasePrice.value === null
    ? null
    : originationLvr({ loanAtSettlement: loanAmount, purchasePrice: purchasePrice.value });

  const derived: DerivedMetrics = {
    grossYield: fromBasedMetric(
      gross,
      weeklyRent.status === 'absent'
        ? 'Gross yield cannot be stated because no rent is established for this property.'
        : 'Gross yield cannot be stated because no purchase price is recorded.',
      'grossYield',
    ),
    netYield: fromBasedMetric(
      net,
      'Net yield cannot be stated: it needs an established rent, a purchase price and an annual '
      + 'outgoings total, and at least one of the three is absent.',
      'netYield',
    ),
    originationLvr: origination === null
      ? absent<number>(
        'Origination LVR cannot be stated without both a deposit and a purchase price.',
        'metrics/propertyMetrics.pure.ts',
        'derived',
      )
      : present<number>(
        origination,
        'metrics/propertyMetrics.pure.ts',
        null,
        'derived',
        'derived',
        'LVR (at settlement, on purchase price)',
      ),
    currentLvr: absent<number>(
      'Current LVR needs a present-day valuation and a remaining loan balance. Neither is stored '
      + 'on an investment report, so the figure is absent rather than approximated from the '
      + 'settlement position — they are different quantities.',
      'metrics/propertyMetrics.pure.ts',
      'derived',
    ),
    equity: (() => {
      const e = equity(purchasePrice.value, loanAmount);
      return e === null
        ? absent<number>(
          'Equity cannot be stated without both a value and a loan balance.',
          'metrics/propertyMetrics.pure.ts',
          'derived',
        )
        : present<number>(
          e,
          'metrics/propertyMetrics.pure.ts',
          null,
          'derived',
          'derived',
          'Equity (at settlement, on purchase price)',
        );
    })(),
  };

  // --- integrity ------------------------------------------------------------
  const breaches = financeIdentityBreaches({
    purchasePrice: purchasePrice.value,
    deposit,
    loanAmount,
    keyMetricsLvr: at(fin, ['keyMetrics', 'lvr']),
    loanDetailsLvr: at(fin, ['loanDetails', 'lvr']),
  });

  const finance: FinancePosition = {
    purchasePrice,
    weeklyRent,
    deposit: deposit === null
      ? absent<number>('No deposit is recorded in the finance block.', 'investment/financialEngine.pure.ts', 'snapshot')
      : present<number>(deposit, 'investment/financialEngine.pure.ts', 'financial_calculations.initialCosts.deposit', 'derived', 'snapshot'),
    loanAmount: loanAmount === null
      ? absent<number>('No loan amount is recorded in the finance block.', 'investment/financialEngine.pure.ts', 'snapshot')
      : present<number>(loanAmount, 'investment/financialEngine.pure.ts', 'financial_calculations.loanDetails.loanAmount', 'derived', 'snapshot'),
    lvr,
    weeklyCashFlow,
    annualOutgoings,
    stampDuty: stampDutyValue === null
      ? absent<number>(
        'No stamp duty figure is stored for this report. It is deliberately NOT recomputed here: '
        + 'duty depends on a purchase intent and a concession status the report does not record, '
        + 'so a recomputed figure would be a new number rather than this report\'s number.',
        'stampDuty/engine.pure.ts',
        'snapshot',
      )
      : present<number>(stampDutyValue, 'stampDuty/engine.pure.ts', 'financial_calculations.initialCosts.stampDuty', 'derived', 'snapshot'),
    rentBasis: (() => {
      // Forward-only and optional: a historical row carries none of these keys
      // and must read `unknown` rather than being given a basis it never had.
      const raw = str(at(row.manual_overrides, ['rentBasis']))
        ?? str(at(fin, ['income', 'rentBasis']));
      const basis = raw === null ? null : normaliseRentBasis(raw);
      return basis === null
        ? absent<string>(
          weeklyRent.status === 'present'
            ? 'The rent on this report was recorded before its basis was captured, so '
              + 'whether it is a current lease, an appraisal or an estimate is unknown.'
            : 'No rent is recorded, so it has no basis.',
          'investment/overrides.pure.ts',
          'snapshot',
          /* neverCaptured */ true,
        )
        : present<string>(basis, 'investment/overrides.pure.ts', 'manual_overrides.rentBasis', 'observed', 'snapshot');
    })(),
    rentAsOf: (() => {
      const raw = str(at(row.manual_overrides, ['rentAsOf']))
        ?? str(at(fin, ['income', 'rentAsOf']));
      return raw === null
        ? absent<string>(
          'No date is recorded for the rent figure.',
          'investment/overrides.pure.ts',
          'snapshot',
        )
        : present<string>(raw, 'investment/overrides.pure.ts', 'manual_overrides.rentAsOf', 'observed', 'snapshot');
    })(),
    totalUpfront: totalUpfront === null
      ? absent<number>('No upfront total is recorded in the finance block.', 'investment/financialEngine.pure.ts', 'snapshot')
      : present<number>(totalUpfront, 'investment/financialEngine.pure.ts', 'financial_calculations.initialCosts.totalUpfront', 'derived', 'snapshot'),
  };

  const projectionRows = at(fin, ['projections']);
  const projectionYears = Array.isArray(projectionRows) ? projectionRows.length : null;

  const contract: ReportFactContract = {
    contractVersion: REPORT_FACT_CONTRACT_VERSION,
    observedAt: input.observedAt.toISOString(),

    record: {
      reportId: column<string>(row, 'id', str, 'This row carries no identifier.'),
      variant: column<string>(row, 'report_variant', str, 'No report variant is recorded.'),
      tier: column<string>(row, 'report_tier', str, 'No report tier is recorded.'),
      status: column<string>(row, 'status', str, 'No generation status is recorded.'),
      generationEngine: column<string>(row, 'generation_engine', str, 'No generation engine is stamped on this report.'),
      currentVersion: column<number>(row, 'current_version', num, 'No version number is recorded.'),
      parentReportId: column<string>(row, 'parent_report_id', str, 'This report was not forked from another.'),
      derivedFromReportId: column<string>(row, 'derived_from_report_id', str, 'This report was not derived from another.'),
      createdAt: column<string>(row, 'created_at', str, 'No creation timestamp is recorded.'),
    },

    geography: {
      suburb: geoColumn<string>(geo, 'suburb', str, 'Geography resolved without a suburb name.'),
      postcode: geoColumn<string>(geo, 'postcode', str, 'Geography resolved without a postcode.'),
      state: geoColumn<string>(geo, 'state', str, 'Geography resolved without a state.'),
      sa2Name: geoColumn<string>(geo, 'sa2_name', str, 'Geography resolved without an SA2.'),
      remotenessArea: geoColumn<string>(geo, 'remoteness_area', str, 'Geography resolved without a remoteness class.'),
      latitude: geoColumn<number>(geo, 'latitude', num, 'No latitude was resolved.'),
      longitude: geoColumn<number>(geo, 'longitude', num, 'No longitude was resolved.'),
      resolutionStatus: geoColumn<string>(geo, 'status', str, 'No resolution status is recorded.'),
      flags: geoColumn<readonly string[]>(
        geo,
        'flags',
        (v) => (Array.isArray(v) ? v.filter((f): f is string => typeof f === 'string') : null),
        'No resolver flags are recorded.',
      ),
    },

    property: {
      propertyType,
      bedrooms: fromResolvedSpec(propertyFacts.beds, 'No bedroom count was captured.'),
      bathrooms: fromResolvedSpec(propertyFacts.baths, 'No bathroom count was captured.'),
      carSpaces: fromResolvedSpec(propertyFacts.carSpaces, 'No car-space count was captured.'),
      landSize: fromResolvedSpec(propertyFacts.landSizeSqm, 'No land size was captured.'),
      buildingSize: fromResolvedSpec(propertyFacts.buildSizeSqm, 'No building size was captured.'),
      yearBuilt: fromResolvedSpec(propertyFacts.yearBuilt, 'No year of construction was captured.'),
      normalisedType: propertyFacts.normalisedType === undefined
        ? absent<string>(
          'The recorded property type does not resolve to one of the engine\'s classes, so no '
          + 'normalised type is published. It is left unresolved rather than defaulted.',
          'investment/propertyRecord.pure.ts',
          'snapshot',
        )
        : present<string>(
          propertyFacts.normalisedType,
          'investment/propertyRecord.pure.ts',
          'property_specs.property_type',
          'derived',
          'derived',
        ),
    },

    finance,
    derived,
    scoring: readScoringState(row.investment_score),

    projection: {
      present: projectionYears !== null && projectionYears > 0,
      years: projectionYears === null || projectionYears === 0
        ? absent<number>(
          'No multi-year projection is stored for this report.',
          'investment/financialEngine.pure.ts',
          'snapshot',
        )
        : present<number>(
          projectionYears,
          'investment/financialEngine.pure.ts',
          'financial_calculations.projections',
          'derived',
          'snapshot',
        ),
      owner: 'investment/financialEngine.pure.ts',
      note: 'The stored series is reported as stored. This contract never regenerates a '
        + 'projection: a regenerated series would answer a different question from the one the '
        + 'client was shown.',
    },

    integrity: {
      financeBreaches: breaches,
      readTimeHealing: {
        healedScenarios: reconciliation.healedScenarios,
        sensitivityHealed: reconciliation.sensitivityHealed,
        metricsReconciled: reconciliation.metricsReconciled,
        totalUpfrontDerived: reconciliation.totalUpfrontDerived,
        financeIdentityHealed: reconciliation.financeIdentityHealed,
      },
      absentFacts: [],
      supersededFacts: [],
    },
  };

  return {
    ...contract,
    integrity: {
      ...contract.integrity,
      absentFacts: namesOf(contract, (f) => f.status === 'absent'),
      supersededFacts: namesOf(contract, (f) => f.supersededValue !== null),
    },
  };
}


/**
 * The rent-basis vocabulary. Anything unrecognised reads as absent rather than
 * being coerced into the nearest-looking value — a wrong basis is worse than no
 * basis, because it makes an estimate look like a signed lease.
 */
export const RENT_BASIS_VALUES: readonly string[] = [
  'current_lease', 'rental_appraisal', 'operator_supplied', 'market_estimate', 'other',
];

/** Normalise a stored basis, or null where it is not one this contract knows. */
export function normaliseRentBasis(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return RENT_BASIS_VALUES.includes(v) ? v : null;
}

/**
 * Lift one of `readPropertyFacts`' already-resolved numbers into a fact.
 *
 * The resolution — which store, which spelling — belongs to the owner. This
 * only records that the owner found nothing, and why that matters.
 */
function fromResolvedSpec(value: number | null, absentReason: string): Fact<number> {
  return value === null
    ? absent<number>(absentReason, 'investment/propertyRecord.pure.ts', 'snapshot')
    : present<number>(
      value,
      'investment/propertyRecord.pure.ts',
      'property_specs',
      'observed',
      'snapshot',
    );
}

/** Walk the contract's fact leaves, naming those a predicate selects. */
function namesOf(
  contract: ReportFactContract,
  predicate: (f: Fact<unknown>) => boolean,
): string[] {
  const out: string[] = [];
  const sections: Array<[string, Record<string, unknown>]> = [
    ['record', contract.record as unknown as Record<string, unknown>],
    ['geography', contract.geography as unknown as Record<string, unknown>],
    ['property', contract.property as unknown as Record<string, unknown>],
    ['finance', contract.finance as unknown as Record<string, unknown>],
    ['derived', contract.derived as unknown as Record<string, unknown>],
  ];
  for (const [section, obj] of sections) {
    for (const [key, value] of Object.entries(obj)) {
      if (isFact(value) && predicate(value)) out.push(`${section}.${key}`);
    }
  }
  for (const [key, value] of Object.entries(contract.scoring as unknown as Record<string, unknown>)) {
    if (isFact(value) && predicate(value)) out.push(`scoring.${key}`);
  }
  return out;
}

const isFact = (v: unknown): v is Fact<unknown> =>
  isRecord(v) && (v.status === 'present' || v.status === 'absent') && 'absence' in v;

/**
 * Every fact leaf, flattened — the parity ledger's reader.
 *
 * Exported because a golden-master comparison has to walk the same leaves the
 * contract publishes, and a second walker is how a ledger comes to check
 * something the contract does not actually say.
 */
export function factLeaves(contract: ReportFactContract): Array<{ name: string; fact: Fact<unknown> }> {
  const out: Array<{ name: string; fact: Fact<unknown> }> = [];
  const sections: Array<[string, unknown]> = [
    ['record', contract.record],
    ['geography', contract.geography],
    ['property', contract.property],
    ['finance', contract.finance],
    ['derived', contract.derived],
    ['scoring', contract.scoring],
    ['projection', contract.projection],
  ];
  for (const [section, obj] of sections) {
    if (!isRecord(obj)) continue;
    for (const [key, value] of Object.entries(obj)) {
      if (isFact(value)) out.push({ name: `${section}.${key}`, fact: value });
    }
  }
  return out;
}
