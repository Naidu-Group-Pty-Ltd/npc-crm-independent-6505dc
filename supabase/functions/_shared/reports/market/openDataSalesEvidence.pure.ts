/**
 * The open-data sales register → market-evidence points.
 *
 * `market_sales_medians` holds a price series per area and dwelling type,
 * loaded from five open publishers (`openData/qgsoRldaSales`,
 * `openData/nswDcjSales`, `openData/vicVpsrSuburb`, `openData/saLsgStats`,
 * `openData/absResDwell`). This is the one place a series becomes the
 * points the Growth scorer reads — `medianPrice`, `priceSeries`,
 * `growth1Year`, `growth3YearCagr`, `growth5YearCagr`, `growth10YearCagr`,
 * `salesCount` and the wider-market `benchmark*` counterparts — under the
 * same arithmetic the Domain adapter uses (`compoundAnnualGrowth`, a horizon
 * computed only where the same period exists that many years earlier,
 * never a nearer period called a five-year figure).
 *
 * What travels on every point, so a reader can defend it: the publisher's
 * grain (`level: 'suburb'` for Victoria and South Australia, `'lga'` for
 * Queensland, `'postcode'` for New South Wales, `'state'` for the ABS floor
 * — the scorer's confidence ladder prices each), the area under the
 * publisher's own label, whether the dwelling type matched the property
 * (a house scored on all-dwellings data is a weaker claim and is stamped
 * so), the period the sales settled in as `asOf`, the sales behind the
 * median as `sampleSize`, `licensingStatus: 'open'` and
 * `acquisition: 'open_public'` — the footing that makes a figure both
 * production evidence and printable to a client, which Domain's
 * `unverified` series is not.
 *
 * Three rules from the second reading (me9.sales.2). **A mean is never
 * offered as a median**: the ABS series prices the dwelling STOCK, so it
 * yields growth and a series and no `medianPrice` or `salesCount` point.
 * **One span at a time**: where a suburb carries both a calendar-year
 * series and the latest quarters, the longest series that is as current as
 * any is read, and a horizon it cannot reach is taken from the other with
 * a note. **The finest grain that answers is the reading**: the register
 * is asked suburb, then council or postcode, then state, and the state
 * floor is read only where nothing finer answered.
 */
import type {
  EvidenceDwellingType,
  EvidenceKey,
  EvidencePoint,
  EvidenceProvider,
  EvidenceSubject,
  GeographicLevel,
  MarketEvidence,
} from './marketEvidence.pure.ts';
import { compoundAnnualGrowth } from './domainEvidence.pure.ts';
import {
  type SalesDwellingType,
  type SalesMedianRow,
  type SalesPeriodSpan,
  type SalesRegisterState,
  SALES_STATE_LABELS,
  comparePeriods,
  dwellingWords,
  periodEndDate,
  periodLabelFor,
  periodSpanOf,
  periodYearsBefore,
  priceMeasureOf,
} from './openData/salesRegister.pure.ts';
import { QGSO_RLDA_LICENCE, QGSO_RLDA_PAGE_URL, QGSO_RLDA_SOURCE_LABEL } from './openData/qgsoRldaSales.pure.ts';
import { NSW_DCJ_LICENCE, NSW_DCJ_PAGE_URL, NSW_DCJ_SOURCE_LABEL } from './openData/nswDcjSales.pure.ts';
import { VIC_VPSR_LICENCE, VIC_VPSR_PAGE_URL, VIC_VPSR_SOURCE_LABEL } from './openData/vicVpsrSuburb.pure.ts';
import { SA_LSG_LICENCE, SA_LSG_PAGE_URL, SA_LSG_SOURCE_LABEL } from './openData/saLsgStats.pure.ts';
import { ABS_RES_DWELL_LICENCE, ABS_RES_DWELL_PAGE_URL, ABS_RES_DWELL_SOURCE_LABEL } from './openData/absResDwell.pure.ts';

export const OPEN_DATA_SALES_EVIDENCE_VERSION = '2.0.0';

export type SalesRegisterAreaKind = 'suburb' | 'lga' | 'postcode' | 'state';

export interface SalesRegisterSource {
  provider: EvidenceProvider;
  label: string;
  url: string;
  licence: string;
  /** The grain the publisher keys the register on. */
  areaKind: SalesRegisterAreaKind;
  /** How the file reaches the loader: from the publisher, or through the Internet Archive. */
  route: 'publisher' | 'archive';
}

export const QLD_REGISTER_SOURCE: SalesRegisterSource =
  { provider: 'qld_qgso_rlda', label: QGSO_RLDA_SOURCE_LABEL, url: QGSO_RLDA_PAGE_URL, licence: QGSO_RLDA_LICENCE, areaKind: 'lga', route: 'publisher' };
export const NSW_REGISTER_SOURCE: SalesRegisterSource =
  { provider: 'nsw_dcj_rent_sales', label: NSW_DCJ_SOURCE_LABEL, url: NSW_DCJ_PAGE_URL, licence: NSW_DCJ_LICENCE, areaKind: 'postcode', route: 'publisher' };
export const VIC_REGISTER_SOURCE: SalesRegisterSource =
  { provider: 'vic_vpsr_suburb', label: VIC_VPSR_SOURCE_LABEL, url: VIC_VPSR_PAGE_URL, licence: VIC_VPSR_LICENCE, areaKind: 'suburb', route: 'archive' };
export const SA_REGISTER_SOURCE: SalesRegisterSource =
  { provider: 'sa_lsg_suburb', label: SA_LSG_SOURCE_LABEL, url: SA_LSG_PAGE_URL, licence: SA_LSG_LICENCE, areaKind: 'suburb', route: 'archive' };
/** The floor under every jurisdiction and the benchmark above every finer reading. */
export const ABS_STATE_SOURCE: SalesRegisterSource =
  { provider: 'abs_res_dwell', label: ABS_RES_DWELL_SOURCE_LABEL, url: ABS_RES_DWELL_PAGE_URL, licence: ABS_RES_DWELL_LICENCE, areaKind: 'state', route: 'publisher' };

/** The sources per state, finest grain first; the ABS floor closes every list. */
export const SALES_REGISTER_SOURCES: Record<SalesRegisterState, readonly SalesRegisterSource[]> = {
  QLD: [QLD_REGISTER_SOURCE, ABS_STATE_SOURCE],
  NSW: [NSW_REGISTER_SOURCE, ABS_STATE_SOURCE],
  VIC: [VIC_REGISTER_SOURCE, ABS_STATE_SOURCE],
  SA: [SA_REGISTER_SOURCE, ABS_STATE_SOURCE],
  WA: [ABS_STATE_SOURCE],
  TAS: [ABS_STATE_SOURCE],
  NT: [ABS_STATE_SOURCE],
  ACT: [ABS_STATE_SOURCE],
  AU: [ABS_STATE_SOURCE],
};

export function isSalesRegisterState(state: string | null | undefined): state is SalesRegisterState {
  return typeof state === 'string' && Object.prototype.hasOwnProperty.call(SALES_REGISTER_SOURCES, state);
}

/** Every source for a state, finest first — the generator asks in this order. */
export function salesRegisterSourcesFor(state: string | null | undefined): readonly SalesRegisterSource[] {
  return isSalesRegisterState(state) ? SALES_REGISTER_SOURCES[state] : [];
}

/** The finest PUBLISHER source for a state (never the ABS floor), or null. */
export function salesRegisterSourceFor(state: string | null | undefined): SalesRegisterSource | null {
  const finest = salesRegisterSourcesFor(state)[0];
  return finest && finest.areaKind !== 'state' ? finest : null;
}

export interface OpenDataSalesInput {
  subject: EvidenceSubject;
  /** The engine's reading of the property's dwelling type. */
  askedDwelling: EvidenceDwellingType;
  areaKind: SalesRegisterAreaKind;
  /** The publisher's own label for the area the rows describe. */
  area: string;
  /** Every row the register holds for that area, any dwelling type, span or order. */
  rows: ReadonlyArray<SalesMedianRow>;
  /** The state-wide rows (the publisher's own or the ABS state series), for the benchmark points. Optional. */
  benchmarkRows?: ReadonlyArray<SalesMedianRow>;
  /** The ABS national rows — the benchmark for a state-level reading. Optional. */
  nationalRows?: ReadonlyArray<SalesMedianRow>;
  source: SalesRegisterSource;
}

export type OpenDataSalesPoints = Partial<Pick<MarketEvidence, EvidenceKey>>;

export interface OpenDataSalesResult {
  points: OpenDataSalesPoints;
  notes: string[];
  /** The dwelling series the points were drawn from, or null where none priced. */
  dwellingType: SalesDwellingType | null;
  dwellingTypeMatched: boolean;
  latestPeriod: string | null;
  pricedPeriods: number;
  /** The span the reading came from, or null where none priced. */
  span: SalesPeriodSpan | null;
}

/** The order of dwelling series to try for what the engine asked. */
export function dwellingPreference(asked: EvidenceDwellingType): SalesDwellingType[] {
  switch (asked) {
    case 'house': return ['house', 'any'];
    case 'attached': return ['attached', 'any'];
    case 'any': return ['any', 'house', 'attached'];
    case 'land': return [];
  }
}

function pricedSeries(rows: ReadonlyArray<SalesMedianRow>, dwellingType: SalesDwellingType, span?: SalesPeriodSpan): SalesMedianRow[] {
  return rows
    .filter((r) => r.dwellingType === dwellingType && r.medianPrice !== null && r.medianPrice > 0 && (span === undefined || periodSpanOf(r) === span))
    .sort((a, b) => comparePeriods(a.period, b.period));
}

const titleCase = (s: string): string =>
  s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());

export function areaNameFor(areaKind: SalesRegisterAreaKind, area: string, state: string | null): string {
  const st = state ? `, ${state}` : '';
  switch (areaKind) {
    case 'postcode': return `postcode ${area}${st}`;
    case 'lga': return `${area} local government area${st}`;
    case 'suburb': return `${/^[A-Z0-9 '().-]+$/.test(area) ? titleCase(area) : area}${st}`;
    case 'state': return SALES_STATE_LABELS[(state ?? '') as SalesRegisterState] ?? area;
  }
}

const LEVEL_OF: Record<SalesRegisterAreaKind, GeographicLevel> = { suburb: 'suburb', lga: 'lga', postcode: 'postcode', state: 'state' };

/**
 * Which span to read where a series carries both: the one that reaches the
 * newest period; on a tie the one with more priced periods (a calendar-year
 * series over eleven years beats five quarters ending the same December).
 */
export function chooseSpan(series: ReadonlyArray<SalesMedianRow>): SalesPeriodSpan | null {
  const spans: SalesPeriodSpan[] = ['quarter', 'year'];
  let best: { span: SalesPeriodSpan; latest: string; n: number } | null = null;
  for (const span of spans) {
    const rows = series.filter((r) => periodSpanOf(r) === span && r.medianPrice !== null);
    if (!rows.length) continue;
    const latest = rows.reduce((a, b) => (comparePeriods(a.period, b.period) >= 0 ? a : b)).period;
    if (!best || latest > best.latest || (latest === best.latest && rows.length > best.n)) best = { span, latest, n: rows.length };
  }
  return best?.span ?? null;
}

const measureWords = (measure: 'median' | 'mean', dwelling: SalesDwellingType): string =>
  measure === 'mean' ? `mean price of the residential dwelling stock` : `median sale price of ${dwellingWords(dwelling)}`;

/**
 * Turn a register series into evidence points. Never throws: an area with
 * nothing priced answers empty points and a note, which the generator
 * records as the provider being unavailable for a stated reason.
 */
export function openDataSalesPoints(input: OpenDataSalesInput): OpenDataSalesResult {
  const notes: string[] = [];
  const points: OpenDataSalesPoints = {};
  const empty = (dwellingType: SalesDwellingType | null): OpenDataSalesResult =>
    ({ points, notes, dwellingType, dwellingTypeMatched: false, latestPeriod: null, pricedPeriods: 0, span: null });

  if (input.askedDwelling === 'land') {
    notes.push('The register holds dwelling sales; land is not a dwelling.');
    return empty(null);
  }
  let chosen: SalesDwellingType | null = null;
  let all: SalesMedianRow[] = [];
  for (const candidate of dwellingPreference(input.askedDwelling)) {
    const s = pricedSeries(input.rows, candidate);
    if (s.length) { chosen = candidate; all = s; break; }
  }
  if (!chosen) {
    notes.push(`No priced period for ${input.area} in the register (every figure suppressed or absent).`);
    return empty(null);
  }
  const matched = chosen === input.askedDwelling;
  if (!matched) notes.push(`${dwellingWords(input.askedDwelling)} not priced for ${input.area}; ${dwellingWords(chosen)} used instead.`);

  const span = chooseSpan(all) ?? 'quarter';
  const series = pricedSeries(input.rows, chosen, span);
  const other = pricedSeries(input.rows, chosen, span === 'year' ? 'quarter' : 'year');
  const measure = priceMeasureOf(series[series.length - 1]);
  const level = LEVEL_OF[input.areaKind];
  const areaName = areaNameFor(input.areaKind, input.area, input.subject.state);
  const latest = series[series.length - 1];
  const sample = measure === 'mean' ? null : latest.salesCount;
  const label = (p: string, s: SalesPeriodSpan = span) => periodLabelFor(p, s);

  const point = <T>(value: T, method: 'observed' | 'calculated', sourceNote: string, sampleSize: number | null, asOf = periodEndDate(latest.period)): EvidencePoint<T> => ({
    value,
    level,
    areaName,
    dwellingType: chosen as EvidenceDwellingType,
    dwellingTypeMatched: matched,
    provider: input.source.provider,
    asOf,
    sampleSize,
    periodsAvailable: series.length,
    method,
    licensingStatus: 'open',
    acquisition: 'open_public',
    sourceNote,
  });
  const archived = latest.capturedAt ? `; as the Internet Archive captured it on ${latest.capturedAt.slice(0, 10)}` : '';

  if (measure === 'median') {
    points.medianPrice = point(latest.medianPrice as number, 'observed',
      `${input.source.label}; ${measureWords(measure, chosen)}, ${areaName}, ${label(latest.period)}${archived}`, sample);
  } else {
    notes.push(`${areaName}: the series is the mean price of the dwelling stock, so no median sale price is offered.`);
  }

  if (series.length >= 2) {
    points.priceSeries = point(
      series.map((r) => ({ period: r.period, value: r.medianPrice as number })),
      'observed',
      `${input.source.label}; ${measureWords(measure, chosen)} by ${span === 'year' ? 'calendar year' : 'quarter'}, ${areaName}${archived}`,
      sample,
    );
  } else {
    notes.push('One priced period only; no series and no growth.');
  }

  const growth = (years: number, key: EvidenceKey): void => {
    const want = periodYearsBefore(latest.period, years);
    let prior = series.find((r) => r.period === want);
    let fromSpan = span;
    let base = latest;
    if (!prior && other.length) {
      // The other span may reach further back (the calendar-year series) or
      // be as current: take the horizon from it, from ITS latest period.
      const otherLatest = other[other.length - 1];
      const otherPrior = other.find((r) => r.period === periodYearsBefore(otherLatest.period, years));
      if (otherPrior) { prior = otherPrior; base = otherLatest; fromSpan = span === 'year' ? 'quarter' : 'year'; }
    }
    if (!prior) { notes.push(`No priced period ${years} year${years === 1 ? '' : 's'} before ${label(latest.period)}; ${key} not computed.`); return; }
    const value = compoundAnnualGrowth(prior.medianPrice as number, base.medianPrice as number, years);
    if (value === null) return;
    (points as Record<string, unknown>)[key] = point(value, 'calculated',
      `Compound annual growth of the ${measureWords(measure, chosen)}, ${areaName}, ${label(prior.period, fromSpan)} to ${label(base.period, fromSpan)} (${input.source.label})${archived}`,
      sample, periodEndDate(base.period));
  };
  growth(1, 'growth1Year');
  growth(3, 'growth3YearCagr');
  growth(5, 'growth5YearCagr');
  growth(10, 'growth10YearCagr');

  if (sample !== null && measure === 'median') {
    points.salesCount = point(sample, 'observed',
      `${input.source.label}; ${dwellingWords(chosen)} sold in ${areaName}, ${label(latest.period)}${archived}`, sample);
  }

  /*
   * The volume series — the counts this register prints beside every median
   * it prints, and which only the LATEST row of was ever read.
   *
   * It went into `point(…, sample)` as a sample size, which is a statement
   * about how much to trust the price, and nowhere else. How much stock is
   * changing hands, and whether that is more or less than this market's own
   * recent normal, is a measurement of demand — see `scoreTransactionVolume`.
   *
   * Two periods is the floor for a series to exist at all; the scorer sets
   * its own, higher floor for a baseline it will believe.
   */
  const volume = series
    .filter((r) => typeof r.salesCount === 'number' && (r.salesCount as number) >= 0)
    .map((r) => ({ period: r.period, value: r.salesCount as number }));
  if (volume.length >= 2) {
    points.salesVolumeSeries = point(
      volume,
      'observed',
      `${input.source.label}; ${dwellingWords(chosen)} sold in ${areaName} by `
      + `${span === 'year' ? 'calendar year' : 'quarter'}, ${label(volume[0].period)} to `
      + `${label(volume[volume.length - 1].period)}${archived}`,
      sample,
    );
  }

  // ---- Benchmarks: the wider market, coarser by construction. A state-level
  // reading is benchmarked against the nation; everything else against the
  // state (the publisher's own total where it has one, else the ABS series).
  const benchRows = input.areaKind === 'state' ? input.nationalRows : input.benchmarkRows;
  if (benchRows?.length) {
    const benchDwelling = pricedSeries(benchRows, chosen).length ? chosen : 'any';
    const bench = pricedSeries(benchRows, benchDwelling, 'quarter').length
      ? pricedSeries(benchRows, benchDwelling, 'quarter')
      : pricedSeries(benchRows, benchDwelling);
    const benchLatest = bench.find((r) => r.period === latest.period) ?? (bench.length ? bench[bench.length - 1] : null);
    if (benchLatest) {
      const benchMeasure = priceMeasureOf(benchLatest);
      const benchLevel: GeographicLevel = input.areaKind === 'state' ? 'national' : 'state';
      const benchName = input.areaKind === 'state'
        ? 'Australia'
        : benchMeasure === 'mean'
          ? SALES_STATE_LABELS[(input.subject.state ?? '') as SalesRegisterState] ?? (input.subject.state ?? 'the state')
          : `${input.subject.state ?? 'the state'} (all areas the publisher monitors)`;
      const benchSpan = periodSpanOf(benchLatest);
      const benchPoint = (value: number, method: 'observed' | 'calculated', sourceNote: string): EvidencePoint => ({
        value,
        level: benchLevel,
        areaName: benchName,
        dwellingType: benchDwelling as EvidenceDwellingType,
        dwellingTypeMatched: benchDwelling === input.askedDwelling,
        provider: benchMeasure === 'mean' ? ABS_STATE_SOURCE.provider : input.source.provider,
        asOf: periodEndDate(benchLatest.period),
        sampleSize: benchMeasure === 'mean' ? null : benchLatest.salesCount,
        periodsAvailable: bench.length,
        method,
        licensingStatus: 'open',
        acquisition: 'open_public',
        sourceNote,
      });
      const benchLabel = benchMeasure === 'mean' ? ABS_RES_DWELL_SOURCE_LABEL : input.source.label;
      if (benchMeasure === 'median') {
        points.benchmarkMedianPrice = benchPoint(benchLatest.medianPrice as number, 'observed',
          `${benchLabel}; ${measureWords(benchMeasure, benchDwelling)}, ${benchName}, ${periodLabelFor(benchLatest.period, benchSpan)}`);
      }
      const benchGrowth = (years: number, key: 'benchmarkGrowth1Year' | 'benchmarkGrowth3YearCagr' | 'benchmarkGrowth5YearCagr'): void => {
        const prior = bench.find((r) => r.period === periodYearsBefore(benchLatest.period, years));
        if (!prior) return;
        const value = compoundAnnualGrowth(prior.medianPrice as number, benchLatest.medianPrice as number, years);
        if (value === null) return;
        points[key] = benchPoint(value, 'calculated',
          `Compound annual growth of the ${measureWords(benchMeasure, benchDwelling)}, ${benchName}, ${periodLabelFor(prior.period, benchSpan)} to ${periodLabelFor(benchLatest.period, benchSpan)} (${benchLabel})`);
      };
      benchGrowth(1, 'benchmarkGrowth1Year');
      benchGrowth(3, 'benchmarkGrowth3YearCagr');
      benchGrowth(5, 'benchmarkGrowth5YearCagr');
    } else {
      notes.push(`No wider-market figure for ${label(latest.period)}; no benchmark.`);
    }
  }

  return { points, notes, dwellingType: chosen, dwellingTypeMatched: matched, latestPeriod: latest.period, pricedPeriods: series.length, span };
}
