/**
 * `MarketEvidence` — the one structure the scoring engine is allowed to read.
 *
 * ## Why this exists
 *
 * The scorers currently read a provider's own vocabulary. Every one of them
 * does `demographics.marketData || financials.marketData || {}` and then reaches
 * for `medianPrice`, `priceGrowth1Year`, `vacancyRate` — names that no writer in
 * this repository has ever written (audit §47). Domain's own service returns
 * `medianSoldPrice`; the ABS returns a quarterly index by GCCSA; a state
 * valuer-general returns individual sales. Three shapes, and the engine
 * understood a fourth that did not exist.
 *
 * So the engine stops knowing about providers. An adapter turns a provider's
 * answer into `MarketEvidence`; the engine consumes `MarketEvidence` and nothing
 * else. Adding a provider is then an adapter, never a change to a scorer.
 *
 * ## The rule that shapes it: provenance is per MEASURE, not per envelope
 *
 * The obvious design puts one `source`/`level`/`asOf` on the whole record. It
 * cannot work here, because the evidence hierarchy fills different fields from
 * different levels in the same request: a median from the suburb, a vacancy
 * rate from the postcode, a benchmark from the GCCSA. An envelope-level
 * `level: 'suburb'` would then be a false statement about two thirds of the
 * fields, and the report would print it.
 *
 * Every measure is therefore an {@link EvidencePoint} carrying its own level,
 * area, dwelling-type match, provider, period, sample size and method. That is
 * what lets a document say *"Bowral houses, 62 sales, year to 2026-Q2, Domain"*
 * beside *"benchmark: Rest of NSW, ABS"* without either claim borrowing the
 * other's authority.
 *
 * ## Absent is absent
 *
 * Every field is optional and `null`/absent means **not measured**. There is no
 * zero default, no 50, no placeholder — the rule the 0.00% yield and the
 * placeholder `50` growth score both cost this product once each. A measured
 * zero is a real value and is representable: `{ value: 0, … }` is a
 * transaction count of zero, which is a fact, while an absent point is the
 * absence of one.
 *
 * ## What it deliberately does NOT contain
 *
 * No score, no grade, no weight, no confidence *verdict*. This is evidence;
 * scoring reads it. Mixing the two is how a provider's marketing number
 * ("Domain confidence: high") becomes a grade the business has to defend.
 * `sampleSize`, `periodsAvailable`, `level` and `asOf` are the raw inputs a
 * confidence calculation needs, and they are facts rather than judgements.
 *
 * Pure: no Deno, no imports, so the frontend tests and the Edge Functions
 * share one definition.
 */

/**
 * How precisely a measure is located, finest first.
 *
 * Ordering is meaningful — {@link isFinerThan} and the evidence hierarchy both
 * depend on it — so the array is the single source of that order and the union
 * is derived from it rather than written twice.
 */
export const GEOGRAPHIC_LEVELS = [
  'property',
  'suburb',
  'postcode',
  // ABS Statistical Area Level 2 — the grain the resident-population series
  // is published at (`abs_sa2_population`), and the grain `report_geography`
  // resolves a verified coordinate to. Finer than an LGA, coarser than a
  // postal area on the whole; added 15 Sep 2026 when the population driver
  // began arriving from that series rather than being absent.
  'sa2',
  'lga',
  'sa3',
  'gccsa',
  'state',
  'national',
] as const;

export type GeographicLevel = (typeof GEOGRAPHIC_LEVELS)[number];

/** Rank of a level, 0 = finest. */
export function levelRank(level: GeographicLevel): number {
  return GEOGRAPHIC_LEVELS.indexOf(level);
}

/** True when `a` is a finer geography than `b`. */
export function isFinerThan(a: GeographicLevel, b: GeographicLevel): boolean {
  return levelRank(a) < levelRank(b);
}

/**
 * The dwelling vocabulary of the EVIDENCE, which is not the engine's.
 *
 * Providers cut the market two or three ways and they do not agree: the ABS
 * publishes *established houses* and *attached dwellings*; Domain takes
 * `house` or `unit`. `attached` is the honest name for "unit, townhouse and
 * everything else strata-titled", and `any` means the source does not split at
 * all — which is a real answer and must not be silently read as `house`.
 */
export type EvidenceDwellingType = 'house' | 'attached' | 'land' | 'any';

/** Where a measure came from. Adding a provider adds a member here and an adapter. */
export type EvidenceProvider =
  | 'domain'
  | 'cotality'
  // ME-6: named so a snapshot and a probe reading can identify them. An
  // adapter is written for the ONE provider actually selected, never all four.
  | 'proptrack'
  | 'sqm_research'
  | 'abs_res_dwell'
  | 'abs_census'
  | 'abs_erp'
  | 'nsw_valuer_general'
  | 'vic_property_sales'
  | 'qld_titles'
  | 'sa_land_services'
  // The open-data sales registers (docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md):
  // published medians, CC BY 4.0, loaded by `market-sales-ingest` and read by
  // `openDataSalesEvidence.pure.ts`.
  | 'qld_qgso_rlda'
  | 'nsw_dcj_rent_sales'
  // The archived suburb series (Victoria, South Australia) and the ABS state
  // floor beneath every jurisdiction — me9.sales.2, 16 Sep 2026.
  | 'vic_vpsr_suburb'
  | 'sa_lsg_suburb'
  | 'abs_res_dwell';

/** Whether the number was read from the source or computed from what was read. */
export type EvidenceMethod = 'observed' | 'calculated';

/**
 * Whether this measure may appear in a document a client receives.
 *
 * A production gate, not a development one. A provider can be perfectly
 * reachable, correctly credentialled and returning excellent data, and still
 * be unusable in a client-facing report because redistribution rights are a
 * commercial fact rather than a technical one. Cotality's own scoping
 * document (`docs/integrations/cotality-scoping.md` §4) leaves permitted cache
 * duration, redistribution rights for client-facing PDFs, and the right to
 * persist derived metrics explicitly open.
 *
 * So the default is `unverified` and it is never inferred: a measure whose
 * rights nobody has confirmed may be scored in a shadow backtest and must not
 * be rendered or persisted as a derived metric. `open` is for material whose
 * licence positively permits it — ABS and CC-BY government data.
 */
export type LicensingStatus = 'open' | 'licensed_for_client_reports' | 'internal_only' | 'unverified';

/**
 * One measured quantity and everything needed to defend it.
 *
 * `asOf` is the period the SOURCE describes, never when we fetched it — the
 * distinction the sanctions work settled ("freshness of the load is not
 * currency of the data"), and the reason a five-year-old ABS index uploaded
 * today must not read as current.
 */
export interface EvidencePoint<T = number> {
  /** The measurement. A zero here is a measured zero. */
  value: T;
  /** Geography this measure describes. */
  level: GeographicLevel;
  /** Human name of that geography, as the report should print it. */
  areaName: string;
  /** Dwelling split the source applied. */
  dwellingType: EvidenceDwellingType;
  /**
   * False when the caller asked for one dwelling type and the source could
   * only answer for another (or for `any`). A report may still use the number;
   * it may not claim it is about the asked-for type.
   */
  dwellingTypeMatched: boolean;
  provider: EvidenceProvider;
  /** Period the source describes: `2026-Q2`, `2026-06-30`, `year to 2026-06`. */
  asOf: string;
  /** Transactions/observations behind the value, where the source states it. */
  sampleSize: number | null;
  /** Historical periods available for this series, where applicable. */
  periodsAvailable: number | null;
  method: EvidenceMethod;
  /**
   * Whether this measure may reach a client-facing document.
   *
   * Absent means `unverified` — the conservative reading, because assuming a
   * right nobody has confirmed is how a licence gets breached in a document
   * that has already been emailed.
   */
  licensingStatus?: LicensingStatus;
  /**
   * How the right to hold this measure was obtained. Absent means
   * `licensing_unverified`, which is not production evidence.
   */
  acquisition?: EvidenceAcquisition;
  /** Anything a reader needs in order not to over-read the number. */
  sourceNote: string | null;
}

/** The licensing status of a point, defaulting conservatively. */
export function licensingOf(point: EvidencePoint<unknown>): LicensingStatus {
  return point.licensingStatus ?? 'unverified';
}

/** May this measure be rendered in a document a client receives? */
export function mayReachClientReport(point: EvidencePoint<unknown>): boolean {
  const status = licensingOf(point);
  return status === 'open' || status === 'licensed_for_client_reports';
}

/**
 * ME-6 (zero-cost strategy) — HOW the right to hold this measure was obtained.
 *
 * A second, orthogonal axis to `LicensingStatus`, and the two answer different
 * questions. Licensing asks *may this be printed for a client*. Acquisition
 * asks *on what footing do we hold it at all* — and the footing is what decides
 * whether a number may become production evidence, which is a decision no
 * rendering rule makes.
 *
 * It exists because the zero-cost programme deliberately mixes footings in one
 * pipeline: CC-BY government files, a credential Aurixa already pays for, and
 * an evaluation trial. Those are not interchangeable, and the failure mode is
 * specific and quiet — **a trial measure that silently becomes production
 * evidence**. Nothing about a number's shape reveals which footing produced it;
 * a PropTrack trial median and a licensed one are the same float. So the
 * footing travels on the point.
 *
 * - `open_public` — CC-BY / public-domain government data. No cost, no ceiling.
 * - `existing_licensed` — a credential already held, at no additional charge.
 * - `trial_shadow_only` — an evaluation or trial licence. Internal validation
 *   ONLY: it may be scored in a shadow backtest and may never be rendered,
 *   redistributed, or sealed as production evidence.
 * - `commercial_upgrade_required` — the source exists and would answer, but
 *   only behind a purchase that has not been made. Recorded so the gap is
 *   visible rather than looking like an absent source.
 * - `licensing_unverified` — rights not established. The conservative default.
 */
export type EvidenceAcquisition =
  | 'open_public'
  | 'existing_licensed'
  | 'trial_shadow_only'
  | 'commercial_upgrade_required'
  | 'licensing_unverified';

/** Acquisition footing of a point, defaulting conservatively. */
export function acquisitionOf(point: EvidencePoint<unknown>): EvidenceAcquisition {
  return point.acquisition ?? 'licensing_unverified';
}

/**
 * May this measure be sealed as PRODUCTION evidence?
 *
 * Deliberately not `mayReachClientReport`. That predicate keeps its exact
 * meaning and its existing callers; this is the new, stricter gate the
 * zero-cost stack needs, and it is conservative by default — a point that
 * never declares a footing is not production evidence.
 */
export function mayEnterProductionEvidence(point: EvidencePoint<unknown>): boolean {
  const a = acquisitionOf(point);
  return a === 'open_public' || a === 'existing_licensed';
}

/**
 * May this measure be used in an internal shadow backtest?
 *
 * Everything except a source we do not hold. `licensing_unverified` is
 * admitted here for the same reason `unverified` licensing already is: a
 * shadow score is not a disclosure. `commercial_upgrade_required` is refused
 * because it describes data nobody fetched.
 */
export function mayEnterShadowBacktest(point: EvidencePoint<unknown>): boolean {
  return acquisitionOf(point) !== 'commercial_upgrade_required';
}

/**
 * The one rule that makes the footing bite: a trial measure must never carry
 * client-facing rights, and a source we have not bought must not carry any
 * rights at all. Returns the reason a combination is contradictory, or null.
 *
 * Enforced rather than trusted, because the two fields are set at different
 * places — the adapter sets the footing, the registry sets the licence — and
 * two writers is exactly how a trial number acquires a production licence.
 */
export function acquisitionLicensingConflict(point: EvidencePoint<unknown>): string | null {
  const a = acquisitionOf(point);
  const l = licensingOf(point);
  const clientFacing = l === 'open' || l === 'licensed_for_client_reports';
  if (a === 'trial_shadow_only' && clientFacing) {
    return 'a trial/evaluation measure cannot carry client-facing licensing — '
      + 'trial access is for internal validation and confers no production right';
  }
  if (a === 'commercial_upgrade_required' && l !== 'unverified') {
    return 'a measure behind an unpurchased upgrade cannot carry a licensing status — '
      + 'nothing was licensed because nothing was obtained';
  }
  return null;
}

/**
 * What was asked for, kept beside what was found.
 *
 * Without it a consumer cannot tell a dwelling-type fallback from a match, or
 * know which suburb the request was even about when every point resolved to a
 * coarser level.
 */
export interface EvidenceSubject {
  suburb: string | null;
  postcode: string | null;
  state: string | null;
  /** The engine's dwelling vocabulary, before mapping onto the evidence's. */
  dwellingType: EvidenceDwellingType;
  /** Set when the geography was resolved from a coordinate rather than text. */
  resolvedFrom: 'coordinate' | 'address' | 'suburb_state' | 'postcode' | null;
}

/**
 * The canonical bundle. Every member is optional; absent means not measured.
 *
 * `benchmark*` fields are deliberately separate rather than a coarser copy of
 * the same names. A benchmark is a DIFFERENT claim — "what the wider market
 * did" — and the whole point of measuring relative performance is that it must
 * never be mistaken for the subject's own figure. Audit §48 is what happens
 * when a regional number stands in for a local one.
 */
export interface MarketEvidence {
  subject: EvidenceSubject;

  /** Current typical value for this market and dwelling type. */
  medianPrice?: EvidencePoint;
  /** Capital growth over 12 months, per cent. */
  growth1Year?: EvidencePoint;
  /** Compound annual growth over 3 years, per cent per annum. */
  growth3YearCagr?: EvidencePoint;
  /** Compound annual growth over 5 years, per cent per annum. */
  growth5YearCagr?: EvidencePoint;
  /** Compound annual growth over 10 years, per cent per annum. */
  growth10YearCagr?: EvidencePoint;
  /**
   * The per-period series the growth figures were computed from, oldest first.
   * Carried so consistency can be measured and so a report can show its
   * working rather than assert a CAGR.
   */
  priceSeries?: EvidencePoint<ReadonlyArray<{ period: string; value: number }>>;

  /** Transactions in the most recent comparable period. */
  salesCount?: EvidencePoint;
  /** Median days on market. */
  daysOnMarket?: EvidencePoint;
  /** Rental vacancy rate, per cent. Only where genuinely published. */
  vacancyRate?: EvidencePoint;
  /** Properties advertised for rent or sale in the period. */
  listingActivity?: EvidencePoint;
  /** Median advertised weekly rent. */
  medianRent?: EvidencePoint;
  /** Average discount from first asking price to sale, per cent. */
  vendorDiscount?: EvidencePoint;
  /** Auction clearance rate, per cent. */
  auctionClearanceRate?: EvidencePoint;

  /** The wider market this subject should be judged against. */
  benchmarkGrowth1Year?: EvidencePoint;
  benchmarkGrowth3YearCagr?: EvidencePoint;
  benchmarkGrowth5YearCagr?: EvidencePoint;
  benchmarkMedianPrice?: EvidencePoint;

  /** Resident population growth, per cent per annum. A growth DRIVER, never growth. */
  populationGrowth?: EvidencePoint;

  /** Providers consulted for this subject, whether or not they answered. */
  providersConsulted: ReadonlyArray<EvidenceProvider>;
  /** Providers that were asked and could not answer, with the reason. */
  providersUnavailable: ReadonlyArray<{ provider: EvidenceProvider; reason: string }>;
}

/** Every measure key on {@link MarketEvidence}, for iteration and coverage counting. */
export const EVIDENCE_KEYS = [
  'medianPrice',
  'growth1Year',
  'growth3YearCagr',
  'growth5YearCagr',
  'growth10YearCagr',
  'priceSeries',
  'salesCount',
  'daysOnMarket',
  'vacancyRate',
  'listingActivity',
  'medianRent',
  'vendorDiscount',
  'auctionClearanceRate',
  'benchmarkGrowth1Year',
  'benchmarkGrowth3YearCagr',
  'benchmarkGrowth5YearCagr',
  'benchmarkMedianPrice',
  'populationGrowth',
] as const;

export type EvidenceKey = (typeof EVIDENCE_KEYS)[number];

/** An empty bundle for a subject nothing could be found for. Never null. */
export function emptyEvidence(subject: EvidenceSubject): MarketEvidence {
  return { subject, providersConsulted: [], providersUnavailable: [] };
}

/** The points actually present, in declaration order. */
export function presentPoints(
  ev: MarketEvidence,
): Array<{ key: EvidenceKey; point: EvidencePoint<unknown> }> {
  const out: Array<{ key: EvidenceKey; point: EvidencePoint<unknown> }> = [];
  for (const key of EVIDENCE_KEYS) {
    const point = (ev as unknown as Record<string, unknown>)[key] as EvidencePoint<unknown> | undefined;
    if (point && typeof point === 'object' && 'value' in point) out.push({ key, point });
  }
  return out;
}

/**
 * The finest level any SUBJECT measure was resolved at, or null.
 *
 * Benchmarks are excluded on purpose: a national benchmark beside a suburb
 * median must not make the bundle read as national, and a benchmark is never
 * what makes the subject's evidence precise.
 */
const BENCHMARK_KEYS = new Set<EvidenceKey>([
  'benchmarkGrowth1Year',
  'benchmarkGrowth3YearCagr',
  'benchmarkGrowth5YearCagr',
  'benchmarkMedianPrice',
]);

export function finestSubjectLevel(ev: MarketEvidence): GeographicLevel | null {
  let best: GeographicLevel | null = null;
  for (const { key, point } of presentPoints(ev)) {
    if (BENCHMARK_KEYS.has(key)) continue;
    if (best === null || isFinerThan(point.level, best)) best = point.level;
  }
  return best;
}

/**
 * Merge candidate bundles into one, strongest evidence first.
 *
 * The hierarchy is *suburb + correct dwelling type → postcode + correct
 * dwelling type → coarser market*, and it is resolved **per measure** rather
 * than per bundle: a suburb that publishes a median but no vacancy rate should
 * contribute its median and let the postcode contribute the vacancy, which a
 * whole-bundle choice cannot express.
 *
 * Three rules decide a contest between two points for the same key:
 *
 *  1. **A dwelling-type match outranks a finer geography.** A suburb-level
 *     figure that mixes houses and units is a worse answer for a house than a
 *     postcode-level house figure — the mismatch is a statement about a
 *     different market, while the coarser geography is the same market
 *     measured more broadly.
 *  2. Then the finer geography wins.
 *  3. Then the earlier candidate wins, so caller order is the last tiebreak
 *     and a provider preference is expressible without a special case.
 *
 * **Benchmarks inverted, deliberately.** For the four `benchmark*` keys the
 * COARSER point wins, because a benchmark is the wider market a subject is
 * judged against; filling it with the subject's own suburb figure would make
 * every property exactly average by construction and silently delete the
 * relative-performance signal audit §48 exists to protect.
 */
export function mergeEvidence(
  subject: EvidenceSubject,
  candidates: ReadonlyArray<MarketEvidence>,
): MarketEvidence {
  const merged = emptyEvidence(subject) as MarketEvidence & Record<string, unknown>;
  const consulted: EvidenceProvider[] = [];
  const unavailable: Array<{ provider: EvidenceProvider; reason: string }> = [];

  for (const candidate of candidates) {
    for (const p of candidate.providersConsulted) if (!consulted.includes(p)) consulted.push(p);
    for (const u of candidate.providersUnavailable) {
      if (!unavailable.some((x) => x.provider === u.provider && x.reason === u.reason)) unavailable.push(u);
    }

    for (const key of EVIDENCE_KEYS) {
      const incoming = (candidate as unknown as Record<string, unknown>)[key] as
        | EvidencePoint<unknown>
        | undefined;
      if (!incoming || typeof incoming !== 'object' || !('value' in incoming)) continue;
      const bag = merged as Record<string, unknown>;
      const held = bag[key] as EvidencePoint<unknown> | undefined;
      if (!held) { bag[key] = incoming; continue; }
      if (beats(incoming, held, BENCHMARK_KEYS.has(key))) bag[key] = incoming;
    }
  }

  merged.providersConsulted = consulted;
  merged.providersUnavailable = unavailable;
  return merged as MarketEvidence;
}

/** Does `a` beat the incumbent `b` for this key? See {@link mergeEvidence}. */
function beats(a: EvidencePoint<unknown>, b: EvidencePoint<unknown>, wantCoarser: boolean): boolean {
  if (a.dwellingTypeMatched !== b.dwellingTypeMatched) return a.dwellingTypeMatched;
  const ra = levelRank(a.level);
  const rb = levelRank(b.level);
  if (ra !== rb) return wantCoarser ? ra > rb : ra < rb;
  return false; // equal on both counts — the incumbent (earlier candidate) holds.
}

/**
 * How the report should describe what a measure is about.
 *
 * A grade a client can challenge has to be able to say what its evidence
 * covered, and the honest sentence differs by whether the dwelling type
 * matched — so this is one function rather than a format string at each call
 * site.
 */
export function describePoint(point: EvidencePoint<unknown>): string {
  const dwelling = point.dwellingType === 'any'
    ? 'all dwelling types'
    : point.dwellingType === 'attached'
      ? 'units and townhouses'
      : point.dwellingType === 'land'
        ? 'land'
        : 'houses';
  const sample = point.sampleSize === null ? '' : `, ${point.sampleSize.toLocaleString('en-AU')} sales`;
  const caveat = point.dwellingTypeMatched ? '' : ' (dwelling type not matched)';
  return `${point.areaName} — ${dwelling}${sample}, ${point.asOf}${caveat}`;
}
