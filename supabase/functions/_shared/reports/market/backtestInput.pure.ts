/**
 * ME-4 — the Historical Backtest Input Resolver.
 *
 * Turns a stored `investment_reports` row into the inputs
 * {@link scoreInvestmentV2Shadow} needs, **without any provider, credential or
 * network call**. Built now, before the commercial credential lands, so the
 * moment licensed suburb evidence arrives the corpus can be scored rather than
 * prepared.
 *
 * ## The rule that shapes it: geography is proved, never inferred
 *
 * Measured over the 1,204 stored reports on 2026-09-08:
 *
 * | field | present | where |
 * | --- | ---: | --- |
 * | coordinates | 1,112 (92.4%) | `location_intelligence.coordinates` |
 * | suburb | **0** | stored nowhere structurally |
 * | postcode | **0** | stored nowhere structurally |
 * | state | **0** | stored nowhere structurally |
 * | address (free text) | 1,204 (100%) | `property_address` |
 *
 * So the suburb a backtest needs is not in the record, and the only thing that
 * looks like it is a free-text address. **This resolver will not parse it.**
 * `ADDRESS_COMPOSITION.md` records what that costs: Make geocodes
 * `{{address}},{{suburb}}` with no street number, Google answers with a suburb
 * centroid, and a second model call writes eight address columns back over the
 * extraction — so `Full Address` reads `Cobblebank VIC 3338, Australia` on a
 * record that knows `Mortlock Street`. A string that has already been through
 * that loop cannot prove which suburb a property is in.
 *
 * Coordinates can, through a canonical geography mapping. Until that mapping is
 * applied, geography resolves to `coordinates_only` and the row is honestly
 * **not** backtest-ready — which is a smaller loss than a backtest whose
 * suburbs are wrong, because wrong geography would attach real market evidence
 * to the wrong property and every downstream figure would inherit it.
 *
 * ## Multiple stored shapes are a fact, not a defect to hide
 *
 * The corpus spans several eras of the writer, so one figure legitimately lives
 * at different paths on different rows. Each field therefore declares its
 * candidate paths in priority order and the result records **which path
 * actually resolved** ({@link ResolvedField.sourcePath}), so a backtest can be
 * audited back to the byte it read. That is provenance; guessing silently
 * between shapes is what it replaces.
 */

/** How completely a row can be scored. Ordered worst to best. */
export type ReadinessState =
  | 'unresolved_geography'
  | 'missing_dwelling_type'
  | 'missing_financials'
  | 'partial'
  | 'backtest_ready';

export type GeographyResolution =
  | 'none'              // neither coordinates nor a structured location
  | 'coordinates_only'  // coordinates present; suburb not yet mapped
  | 'resolved';         // suburb, postcode and state all proved

/** A value plus where it came from. `null` value means genuinely absent. */
export interface ResolvedField<T> {
  value: T | null;
  /** The JSON path that produced it, or null when nothing did. */
  sourcePath: string | null;
}

export interface HistoricalBacktestInput {
  reportId: string;
  /** Free text, carried for the operator's reference. NEVER parsed for geography. */
  addressLabel: string | null;

  latitude: ResolvedField<number>;
  longitude: ResolvedField<number>;
  suburb: ResolvedField<string>;
  postcode: ResolvedField<string>;
  state: ResolvedField<string>;
  geography: GeographyResolution;

  dwellingType: ResolvedField<string>;
  purchasePrice: ResolvedField<number>;
  weeklyRent: ResolvedField<number>;
  lvr: ResolvedField<number>;
  weeklyCashFlow: ResolvedField<number>;
  annualOutgoings: ResolvedField<number>;

  walkScore: ResolvedField<number>;
  commuteTimeCBD: ResolvedField<number>;
  schoolsNearby: ResolvedField<number>;

  /** The V1 score already stored, for the before/after comparison. */
  existingScore: ResolvedField<number>;
  existingGrade: ResolvedField<string>;

  readiness: ReadinessState;
  /** Every field that could not be resolved, named for the readiness report. */
  gaps: ReadonlyArray<string>;
}

/** The stored row, as loosely as PostgREST hands it over. */
export interface StoredReportRow {
  id?: unknown;
  property_address?: unknown;
  location_intelligence?: unknown;
  financial_calculations?: unknown;
  property_specs?: unknown;
  investment_score?: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Walk a dotted path, returning undefined rather than throwing. */
function at(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * First candidate path that yields a usable value, with the path recorded.
 *
 * A string that parses as a number counts: the corpus stores
 * `unemploymentRate` and several other figures as strings, and refusing them
 * would report evidence as absent that is demonstrably present.
 */
function resolveNumber(root: unknown, paths: ReadonlyArray<string>): ResolvedField<number> {
  for (const p of paths) {
    const raw = at(root, p);
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(n)) return { value: n, sourcePath: p };
  }
  return { value: null, sourcePath: null };
}

function resolveString(root: unknown, paths: ReadonlyArray<string>): ResolvedField<string> {
  for (const p of paths) {
    const raw = at(root, p);
    if (typeof raw === 'string' && raw.trim() !== '') return { value: raw.trim(), sourcePath: p };
  }
  return { value: null, sourcePath: null };
}

/**
 * Candidate paths, in priority order, measured against the live corpus.
 *
 * Exported so the readiness report can state exactly what it looked for, and
 * so adding a path is a visible change rather than an edit inside a function.
 */
export const FIELD_PATHS = {
  latitude: ['location_intelligence.coordinates.lat', 'location_intelligence.coordinates.latitude'],
  longitude: ['location_intelligence.coordinates.lng', 'location_intelligence.coordinates.longitude'],
  // Present on 0 of 1,204 today. Declared so a future writer is picked up
  // automatically rather than needing this module changed.
  suburb: ['location_intelligence.suburb', 'location_intelligence.locality'],
  postcode: ['location_intelligence.postcode'],
  state: ['location_intelligence.state'],
  dwellingType: ['property_specs.property_type', 'financial_calculations.propertySpecs.propertyType'],
  /**
   * The acquisition amount.
   *
   * Measured: neither `purchasePrice` nor `propertyPrice` appears anywhere in
   * `financial_calculations` on any of the 1,204 stored rows. The figure is
   * `initialCosts.propertyValue`, and for builder stock it is split across
   * `landPrice` and `buildPrice` — handled by
   * {@link resolvePurchasePrice} rather than by a path, because a sum is not
   * a lookup and must say so in its provenance.
   */
  purchasePrice: ['financial_calculations.initialCosts.propertyValue'],
  weeklyRent: ['financial_calculations.income.weeklyRent'],
  lvr: ['financial_calculations.keyMetrics.lvr', 'financial_calculations.loanDetails.lvr'],
  weeklyCashFlow: ['financial_calculations.keyMetrics.weeklyNet', 'financial_calculations.cashFlow.weeklyNet'],
  annualOutgoings: ['financial_calculations.annualCosts.totalAnnualExcludingLandTax',
                    'financial_calculations.annualCosts.total'],
  walkScore: ['location_intelligence.walkScore'],
  commuteTimeCBD: ['location_intelligence.commute.durationMinutes'],
  schoolsNearby: ['location_intelligence.schools.schoolsWithin3km'],
  existingScore: ['investment_score.totalScore'],
  existingGrade: ['investment_score.grade'],
} as const;

/**
 * The acquisition amount, from a stored value or from its declared parts.
 *
 * A house-and-land package has no single price in the record: `propertyValue`
 * may be absent while `landPrice` and `buildPrice` are both present, and their
 * sum is what the buyer pays. The sum is labelled as a sum in `sourcePath`,
 * because a derived figure that presents itself as a stored one is exactly the
 * confusion `DERIVED_FIGURES.md` exists to stop.
 */
export function resolvePurchasePrice(row: StoredReportRow): ResolvedField<number> {
  const direct = resolveNumber(row, FIELD_PATHS.purchasePrice);
  if (direct.value !== null && direct.value > 0) return direct;

  const land = resolveNumber(row, ['financial_calculations.initialCosts.landPrice']);
  const build = resolveNumber(row, ['financial_calculations.initialCosts.buildPrice']);
  if (land.value !== null && build.value !== null && land.value + build.value > 0) {
    return {
      value: land.value + build.value,
      sourcePath: 'financial_calculations.initialCosts.(landPrice + buildPrice)',
    };
  }
  return { value: null, sourcePath: null };
}

/**
 * Resolve one stored row.
 *
 * Pure: no database, no network, no clock. Every absence is reported rather
 * than filled, and geography is never inferred from the address label.
 */
export function resolveBacktestInput(row: StoredReportRow): HistoricalBacktestInput {
  const latitude = resolveNumber(row, FIELD_PATHS.latitude);
  const longitude = resolveNumber(row, FIELD_PATHS.longitude);
  const suburb = resolveString(row, FIELD_PATHS.suburb);
  const postcode = resolveString(row, FIELD_PATHS.postcode);
  const state = resolveString(row, FIELD_PATHS.state);

  const geography: GeographyResolution =
    suburb.value !== null && postcode.value !== null && state.value !== null
      ? 'resolved'
      : latitude.value !== null && longitude.value !== null
        ? 'coordinates_only'
        : 'none';

  const dwellingType = resolveString(row, FIELD_PATHS.dwellingType);
  const purchasePrice = resolvePurchasePrice(row);
  const weeklyRent = resolveNumber(row, FIELD_PATHS.weeklyRent);
  const lvr = resolveNumber(row, FIELD_PATHS.lvr);
  const weeklyCashFlow = resolveNumber(row, FIELD_PATHS.weeklyCashFlow);
  const annualOutgoings = resolveNumber(row, FIELD_PATHS.annualOutgoings);

  const gaps: string[] = [];
  if (geography === 'none') gaps.push('coordinates');
  if (geography !== 'resolved') gaps.push('suburb');
  // `Residential Property` and `Other` are placeholders, not dwelling types.
  const typeIsUsable = dwellingType.value !== null
    && !/^(residential property|other|unknown)$/i.test(dwellingType.value);
  if (!typeIsUsable) gaps.push('dwelling_type');
  if (purchasePrice.value === null) gaps.push('purchase_price');
  if (weeklyRent.value === null) gaps.push('weekly_rent');
  if (lvr.value === null) gaps.push('lvr');
  if (weeklyCashFlow.value === null) gaps.push('weekly_cash_flow');

  // Readiness is decided by the FIRST blocker, worst first, so a row is
  // labelled by what actually stops it rather than by a count of absences.
  const readiness: ReadinessState =
    geography !== 'resolved' ? 'unresolved_geography'
      : !typeIsUsable ? 'missing_dwelling_type'
        : purchasePrice.value === null || weeklyRent.value === null ? 'missing_financials'
          : gaps.length > 0 ? 'partial'
            : 'backtest_ready';

  return {
    reportId: typeof row.id === 'string' ? row.id : '',
    addressLabel: typeof row.property_address === 'string' ? row.property_address : null,
    latitude, longitude, suburb, postcode, state, geography,
    dwellingType, purchasePrice, weeklyRent, lvr, weeklyCashFlow, annualOutgoings,
    walkScore: resolveNumber(row, FIELD_PATHS.walkScore),
    commuteTimeCBD: resolveNumber(row, FIELD_PATHS.commuteTimeCBD),
    schoolsNearby: resolveNumber(row, FIELD_PATHS.schoolsNearby),
    existingScore: resolveNumber(row, FIELD_PATHS.existingScore),
    existingGrade: resolveString(row, FIELD_PATHS.existingGrade),
    readiness,
    gaps,
  };
}

export interface ReadinessMatrix {
  total: number;
  byState: Readonly<Record<ReadinessState, number>>;
  byGeography: Readonly<Record<GeographyResolution, number>>;
  /** How often each individual field was missing. */
  gapCounts: Readonly<Record<string, number>>;
  /** Which stored path each field actually resolved from, and how often. */
  pathsUsed: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** Aggregate resolutions into the readiness report the brief asks for. */
export function buildReadinessMatrix(
  inputs: ReadonlyArray<HistoricalBacktestInput>,
): ReadinessMatrix {
  const byState: Record<string, number> = {
    unresolved_geography: 0, missing_dwelling_type: 0, missing_financials: 0,
    partial: 0, backtest_ready: 0,
  };
  const byGeography: Record<string, number> = { none: 0, coordinates_only: 0, resolved: 0 };
  const gapCounts: Record<string, number> = {};
  const pathsUsed: Record<string, Record<string, number>> = {};

  for (const i of inputs) {
    byState[i.readiness] += 1;
    byGeography[i.geography] += 1;
    for (const g of i.gaps) gapCounts[g] = (gapCounts[g] ?? 0) + 1;
    for (const [field, resolved] of Object.entries(i) as Array<[string, unknown]>) {
      if (!isObj(resolved) || !('sourcePath' in resolved)) continue;
      const raw = resolved.sourcePath;
      const p = typeof raw === 'string' ? raw : '(unresolved)';
      pathsUsed[field] = pathsUsed[field] ?? {};
      pathsUsed[field][p] = (pathsUsed[field][p] ?? 0) + 1;
    }
  }

  return {
    total: inputs.length,
    byState: byState as ReadinessMatrix['byState'],
    byGeography: byGeography as ReadinessMatrix['byGeography'],
    gapCounts,
    pathsUsed,
  };
}
