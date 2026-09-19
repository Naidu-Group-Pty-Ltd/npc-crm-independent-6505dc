/**
 * ME-4 — provider-neutral evidence ingestion.
 *
 * The backtest must not require a live API. If PropTrack, Cotality, Domain or
 * SQM supplies a licensed **export** before API access is established, that
 * export should be usable immediately — so the ingestion contract is about the
 * shape of a record and its licence, never about how it arrived.
 *
 * Four routes, one contract:
 *
 * | route | when |
 * | --- | --- |
 * | `api_adapter` | a credentialled provider call, mapped to this shape |
 * | `licensed_csv` | a delivered file with a licence we hold |
 * | `licensed_json` | the same, in JSON |
 * | `operator_import` | a scheduled manual acquisition, as the crime, GTFS and ABS loads already work |
 *
 * ## The rule: an unlicensed row may be scored and may never be rendered
 *
 * `licensingStatus` defaults to `unverified` in `MarketEvidence` and is never
 * inferred. This module enforces the same at the boundary: a row whose licence
 * is unverified or internal-only is **accepted for shadow scoring and rejected
 * for client-report use**, and {@link IngestionResult} keeps the two counts
 * apart so an operator can see exactly what a delivery may be used for before
 * anything is persisted.
 *
 * That distinction is why rejection is per-row rather than per-file: a
 * provider may deliver open ABS-derived benchmarks alongside licensed
 * proprietary medians in one export, and refusing the file would discard
 * material we are entitled to use.
 *
 * ## Nothing here writes
 *
 * The module validates and projects. Persisting unverified commercial evidence
 * into production report facts is the failure this exists to prevent, so
 * ingestion produces `MarketEvidence` and a report, and the decision to store
 * anything is the caller's and is gated on the licence.
 */

import {
  type EvidenceDwellingType,
  type EvidenceMethod,
  type EvidencePoint,
  type EvidenceProvider,
  type EvidenceSubject,
  type GeographicLevel,
  type LicensingStatus,
  type MarketEvidence,
  GEOGRAPHIC_LEVELS,
  emptyEvidence,
  mergeEvidence,
} from './marketEvidence.pure.ts';

/** How a delivery reached us. Recorded, never inferred from the content. */
export type IngestionRoute = 'api_adapter' | 'licensed_csv' | 'licensed_json' | 'operator_import';

/** The measures an ingestion may carry, named as `MarketEvidence` names them. */
export const INGESTIBLE_MEASURES = [
  'medianPrice', 'growth1Year', 'growth3YearCagr', 'growth5YearCagr', 'growth10YearCagr',
  'salesCount', 'daysOnMarket', 'vacancyRate', 'listingActivity', 'medianRent',
  'vendorDiscount', 'auctionClearanceRate',
  'benchmarkGrowth1Year', 'benchmarkGrowth3YearCagr', 'benchmarkGrowth5YearCagr',
  'benchmarkMedianPrice', 'populationGrowth',
] as const;

export type IngestibleMeasure = (typeof INGESTIBLE_MEASURES)[number];

/**
 * One delivered observation. Every field is required by the contract because
 * every one is needed to defend the figure to a client — a value with no
 * period, geography or sample count cannot be placed, aged or weighted.
 */
export interface EvidenceRecord {
  provider: EvidenceProvider;
  licensingStatus: LicensingStatus;
  route: IngestionRoute;

  level: GeographicLevel;
  areaName: string;
  suburb: string | null;
  postcode: string | null;
  state: string | null;

  dwellingType: EvidenceDwellingType;
  /** The period the SOURCE describes, never when we fetched it. */
  asOf: string;

  measure: IngestibleMeasure;
  value: number;
  sampleSize: number | null;
  method: EvidenceMethod;
  sourceNote: string | null;
}

export type RejectionReason =
  | 'unknown_measure'
  | 'unknown_level'
  | 'non_finite_value'
  | 'missing_as_of'
  | 'missing_area'
  | 'missing_provider'
  | 'missing_licence'
  | 'ambiguous_geography';

export interface RejectedRecord {
  index: number;
  reason: RejectionReason;
  detail: string;
}

export interface IngestionResult {
  /** Everything that validated, merged per the evidence hierarchy. */
  evidence: MarketEvidence;
  accepted: number;
  rejected: ReadonlyArray<RejectedRecord>;
  /**
   * Of the accepted records, how many may appear in a client document.
   * The rest may be shadow-scored and must not be rendered or persisted as a
   * derived metric.
   */
  clientRenderable: number;
  /** Accepted but not renderable, by provider, so the gap is attributable. */
  withheldByProvider: Readonly<Record<string, number>>;
  routes: ReadonlyArray<IngestionRoute>;
}

const LEVELS = new Set<string>(GEOGRAPHIC_LEVELS);
const MEASURES = new Set<string>(INGESTIBLE_MEASURES);

/**
 * Validate one delivered record.
 *
 * Refusals are specific: an operator fixing an export needs to know which
 * column is wrong, not that "the file failed".
 */
export function validateRecord(r: EvidenceRecord, index: number): RejectedRecord | null {
  const bad = (reason: RejectionReason, detail: string): RejectedRecord => ({ index, reason, detail });

  if (!r.provider) return bad('missing_provider', 'No provider named; evidence with no source cannot be defended.');
  if (!r.licensingStatus) {
    return bad('missing_licence', 'No licensing status. It is never inferred — an unstated licence is not an open one.');
  }
  if (!MEASURES.has(r.measure)) {
    return bad('unknown_measure', `"${r.measure}" is not a measure the evidence contract carries.`);
  }
  if (!LEVELS.has(r.level)) {
    return bad('unknown_level', `"${r.level}" is not a geographic level.`);
  }
  if (typeof r.value !== 'number' || !Number.isFinite(r.value)) {
    return bad('non_finite_value', 'Value is not a finite number. A measured zero is admissible; a blank is not.');
  }
  if (!r.asOf || !r.asOf.trim()) {
    return bad('missing_as_of', 'No observation period. Freshness of a load is not currency of the data.');
  }
  if (!r.areaName || !r.areaName.trim()) {
    return bad('missing_area', 'No area name; the figure cannot be placed or printed.');
  }
  // A suburb-grain figure that does not say WHICH suburb is unusable, and
  // guessing from the area name is the address-parsing trap in another form.
  if (r.level === 'suburb' && !r.suburb && !r.postcode) {
    return bad('ambiguous_geography', 'A suburb-level figure must carry a suburb or a postcode.');
  }
  return null;
}

/** Project a validated record onto an `EvidencePoint`. */
function toPoint(r: EvidenceRecord, subject: EvidenceSubject): EvidencePoint {
  return {
    value: r.value,
    level: r.level,
    areaName: r.areaName,
    dwellingType: r.dwellingType,
    // Matched only when the source split the market the way the caller asked.
    dwellingTypeMatched: r.dwellingType === subject.dwellingType,
    provider: r.provider,
    asOf: r.asOf,
    sampleSize: r.sampleSize,
    periodsAvailable: null,
    method: r.method,
    licensingStatus: r.licensingStatus,
    sourceNote: r.sourceNote,
  };
}

/**
 * Ingest a delivery into canonical `MarketEvidence`.
 *
 * Validates per row, projects what passes, and merges through the existing
 * evidence hierarchy — so a delivery competes with what is already held under
 * the same rules an API answer would, rather than overwriting it because it
 * arrived as a file.
 */
export function ingestEvidenceRecords(
  subject: EvidenceSubject,
  records: ReadonlyArray<EvidenceRecord>,
): IngestionResult {
  const rejected: RejectedRecord[] = [];
  const bundles: MarketEvidence[] = [];
  const withheldByProvider: Record<string, number> = {};
  const routes = new Set<IngestionRoute>();
  let accepted = 0;
  let clientRenderable = 0;

  records.forEach((r, i) => {
    const failure = validateRecord(r, i);
    if (failure) { rejected.push(failure); return; }

    accepted += 1;
    routes.add(r.route);

    const renderable = r.licensingStatus === 'open'
      || r.licensingStatus === 'licensed_for_client_reports';
    if (renderable) clientRenderable += 1;
    else withheldByProvider[r.provider] = (withheldByProvider[r.provider] ?? 0) + 1;

    const bundle = emptyEvidence(subject) as MarketEvidence & Record<string, unknown>;
    bundle[r.measure] = toPoint(r, subject);
    bundle.providersConsulted = [r.provider];
    bundles.push(bundle);
  });

  return {
    evidence: mergeEvidence(subject, bundles),
    accepted,
    rejected,
    clientRenderable,
    withheldByProvider,
    routes: [...routes],
  };
}

/**
 * May this delivery be used in documents a client receives?
 *
 * Answers the operator's actual question — "what can I do with this file?" —
 * in one call, so the judgement is not re-derived at each call site.
 */
export function deliveryUsage(result: IngestionResult): {
  shadowScoring: boolean;
  clientReports: boolean;
  summary: string;
} {
  const shadowScoring = result.accepted > 0;
  const clientReports = result.accepted > 0 && result.clientRenderable === result.accepted;
  const withheld = result.accepted - result.clientRenderable;
  return {
    shadowScoring,
    clientReports,
    summary: !shadowScoring
      ? 'Nothing in this delivery validated; it cannot be used.'
      : clientReports
        ? `All ${result.accepted} observations are licensed for client-facing use.`
        : `${result.accepted} observations accepted for shadow scoring; ${withheld} may NOT appear in a `
          + 'client document or be persisted as a derived metric until their licence is confirmed in writing.',
  };
}
