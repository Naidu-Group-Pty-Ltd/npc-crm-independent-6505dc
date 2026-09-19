/**
 * Domain Suburb Performance → market evidence.
 *
 * ## What this replaces
 *
 * `domain-data-service` has never once succeeded. It requested
 * `/v1/suburbPerformanceStatistics/{state}/{suburb}` — a route Domain has
 * deprecated, and one that omits the `{postcode}` segment the endpoint
 * requires — so every call answered 404 and the log line said
 * `lastSuccess: "Never"`. The extraction it would have run on a success read
 * fields the response does not carry (`medianSoldPricePercentChange`,
 * `auctionClearanceRate`, `numberListedForRent`) and reduced twelve periods to
 * the latest one, discarding the series that a capital-growth reading is made
 * of.
 *
 * This module is the extraction, written against Domain's documented v2 shape
 * and nothing else: `series.seriesInfo[]`, one entry per period, each with a
 * `year`, a `month` and a `values` object. It turns that into the evidence
 * points the Scoring V2 engine reads (`marketEvidence.pure.ts`): the price
 * series, the growth figures computed FROM the series, and the demand readings
 * of the latest period. Absent is absent — a period without a median sold
 * price contributes nothing, and a growth horizon the series does not span is
 * not computed.
 *
 * ## Licensing is declared, never assumed
 *
 * Domain's terms for redistributing these figures in a client document are
 * the subject of `docs/integrations/DOMAIN_ACTIVATION_REQUEST.md` and are not
 * settled here. Every point carries the licensing status the caller declares;
 * the default is `unverified`, which the evidence statement withholds from a
 * client audience while the engine still scores on it (`mayReachClientReport`
 * versus `mayEnterProductionEvidence`). Declaring it licensed is a decision
 * with a document behind it, not a default.
 *
 * Pure: no clock (`asOf` is the period the source describes), no network.
 */
import type {
  EvidenceDwellingType,
  EvidenceKey,
  EvidencePoint,
  EvidenceSubject,
  LicensingStatus,
  MarketEvidence,
} from './marketEvidence.pure.ts';

export const DOMAIN_EVIDENCE_VERSION = '1.0.0';

/**
 * The licensing status every Domain suburb-performance point carries.
 *
 * `unverified` until Domain answers the rights follow-up in
 * `docs/integrations/DOMAIN_ACTIVATION_REQUEST.md` (caching, persistence,
 * display in a client document, attribution). Under `unverified` the engine
 * SCORES on the points and the client-facing evidence statement WITHHOLDS
 * their provenance (`mayReachClientReport`); `renderRestricted` on the Growth
 * and Demand results says so to every renderer. Changing this line is a
 * licensing decision and needs the document behind it — never a default.
 */
export const DOMAIN_SUBURB_PERFORMANCE_LICENSING: LicensingStatus = 'unverified';

/** Domain segments suburb performance by these two categories. */
export type DomainPropertyCategory = 'house' | 'unit';

export interface DomainSeriesEntry {
  year: number;
  /** 1-12, or null when the source states a year only. */
  month: number | null;
  values: Record<string, number | null>;
}

export interface DomainSuburbSeries {
  /** Oldest first. */
  entries: DomainSeriesEntry[];
  propertyCategory: DomainPropertyCategory;
}

const NUMERIC_VALUE_KEYS = [
  'medianSoldPrice', 'numberSold', 'highestSoldPrice', 'lowestSoldPrice',
  'medianSaleListingPrice', 'numberSaleListing',
  'auctionNumberAuctioned', 'auctionNumberSold', 'auctionNumberWithdrawn',
  'numberRentListing', 'medianRentListingPrice',
  'daysOnMarket', 'discountPercentage',
] as const;

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Domain's response, read into a series. Null when the payload is not the
 * documented shape — a truncated body, an error object, a different product.
 * Tolerant of the two spellings of the period fields Domain has used.
 */
export function parseDomainSuburbPerformance(
  payload: unknown,
  propertyCategory: DomainPropertyCategory,
): DomainSuburbSeries | null {
  if (!payload || typeof payload !== 'object') return null;
  const series = (payload as { series?: unknown }).series;
  const info = series && typeof series === 'object' ? (series as { seriesInfo?: unknown }).seriesInfo : undefined;
  if (!Array.isArray(info)) return null;
  const entries: DomainSeriesEntry[] = [];
  for (const raw of info) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const year = num(r.year);
    if (year === null || year < 1900 || year > 2200) continue;
    const monthRaw = num(r.month);
    const month = monthRaw !== null && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : null;
    const valuesRaw = r.values && typeof r.values === 'object' ? (r.values as Record<string, unknown>) : {};
    const values: Record<string, number | null> = {};
    for (const key of NUMERIC_VALUE_KEYS) values[key] = num(valuesRaw[key]);
    entries.push({ year, month, values });
  }
  entries.sort((a, b) => a.year - b.year || (a.month ?? 0) - (b.month ?? 0));
  return { entries, propertyCategory };
}

/** The engine's dwelling vocabulary for a Domain category. */
export function dwellingTypeOfCategory(category: DomainPropertyCategory): EvidenceDwellingType {
  return category === 'unit' ? 'attached' : 'house';
}

/** Which Domain category to ask for a property type, and whether that is a match. */
export function domainCategoryFor(propertyType: string | null | undefined): DomainPropertyCategory {
  const t = String(propertyType ?? '').toLowerCase();
  return /unit|apartment|flat|studio/.test(t) ? 'unit' : 'house';
}

/**
 * The engine's dwelling vocabulary for a stored property type. Land is its
 * own answer — no house or unit series describes a vacant lot — and
 * everything strata-titled is `attached`, as `marketEvidence.pure.ts` says.
 */
export function dwellingTypeFor(propertyType: string | null | undefined): EvidenceDwellingType {
  const t = String(propertyType ?? '').toLowerCase();
  if (/\b(land|lot|vacant)\b/.test(t)) return 'land';
  return dwellingTypeOfCategory(domainCategoryFor(propertyType));
}

function periodLabel(e: DomainSeriesEntry): string {
  return e.month === null ? String(e.year) : `${e.year}-${String(e.month).padStart(2, '0')}`;
}

/** The period the source describes, as a date the freshness reading can parse. */
function asOfLabel(e: DomainSeriesEntry): string {
  return e.month === null ? `${e.year}-12-31` : `${e.year}-${String(e.month).padStart(2, '0')}-01`;
}

/** Compound annual growth from `first` to `last` over `years`, in per cent per annum. */
export function compoundAnnualGrowth(first: number, last: number, years: number): number | null {
  if (!(first > 0) || !(last > 0) || !(years > 0)) return null;
  return Number(((Math.pow(last / first, 1 / years) - 1) * 100).toFixed(2));
}

export interface DomainEvidenceInput {
  subject: EvidenceSubject;
  series: DomainSuburbSeries;
  /** The engine's own reading of the property, for `dwellingTypeMatched`. */
  askedDwelling: EvidenceDwellingType;
  licensingStatus?: LicensingStatus;
}

export type DomainEvidencePoints = Partial<Pick<MarketEvidence, EvidenceKey>>;

export interface DomainEvidenceResult {
  points: DomainEvidencePoints;
  /** What was NOT extracted, and why — one line each, for the log and the audit. */
  notes: string[];
  /** Periods that carried a median sold price. */
  pricedPeriods: number;
}

/**
 * Evidence points from one Domain series.
 *
 * Growth is computed from the series, never read from a growth field: a
 * source's own percentage change is a different claim (its base period, its
 * rounding) from the compound rate the engine is calibrated on. The demand
 * readings are the LATEST period's, because they describe a market's state
 * rather than its history.
 */
export function domainEvidencePoints(input: DomainEvidenceInput): DomainEvidenceResult {
  const { subject, series, askedDwelling } = input;
  const notes: string[] = [];
  const points: DomainEvidencePoints = {};
  const dwellingType = dwellingTypeOfCategory(series.propertyCategory);
  const dwellingTypeMatched = dwellingType === askedDwelling;
  const areaName = [subject.suburb, subject.state, subject.postcode].filter(Boolean).join(' ') || 'the suburb';
  const licensingStatus: LicensingStatus = input.licensingStatus ?? 'unverified';

  const priced = series.entries.filter((e) => (e.values.medianSoldPrice ?? 0) > 0);
  if (!priced.length) {
    notes.push('No period in the series carries a median sold price; nothing extracted.');
    return { points, notes, pricedPeriods: 0 };
  }
  const latest = priced[priced.length - 1];

  const point = <T>(value: T, method: 'observed' | 'calculated', sourceNote: string, sampleSize: number | null): EvidencePoint<T> => ({
    value,
    level: 'suburb',
    areaName,
    dwellingType,
    dwellingTypeMatched,
    provider: 'domain',
    asOf: asOfLabel(latest),
    sampleSize,
    periodsAvailable: priced.length,
    method,
    licensingStatus,
    acquisition: 'existing_licensed',
    sourceNote,
  });

  const sold = latest.values.numberSold ?? null;
  points.medianPrice = point(latest.values.medianSoldPrice as number, 'observed',
    `Domain suburb performance, median sold price, ${series.propertyCategory}, period ending ${periodLabel(latest)}`, sold);

  if (priced.length >= 2) {
    points.priceSeries = point(
      priced.map((e) => ({ period: periodLabel(e), value: e.values.medianSoldPrice as number })),
      'observed',
      `Domain suburb performance, median sold price by period, ${series.propertyCategory}`,
      sold,
    );
  } else {
    notes.push('One priced period only; no series and no growth.');
  }

  // Growth over n years needs a period exactly n years earlier in the series.
  const priorByYears = (years: number): DomainSeriesEntry | null => {
    const want = latest.year - years;
    const hit = priced.find((e) => e.year === want && e.month === latest.month);
    return hit ?? null;
  };
  const growthPoint = (years: number, key: EvidenceKey): void => {
    const prior = priorByYears(years);
    if (!prior) { notes.push(`No period ${years} year${years === 1 ? '' : 's'} before ${periodLabel(latest)}; ${key} not computed.`); return; }
    const value = compoundAnnualGrowth(prior.values.medianSoldPrice as number, latest.values.medianSoldPrice as number, years);
    if (value === null) return;
    points[key] = point(value, 'calculated',
      `Compound annual growth of the median sold price, ${periodLabel(prior)} to ${periodLabel(latest)}`, sold) as never;
  };
  growthPoint(1, 'growth1Year');
  growthPoint(3, 'growth3YearCagr');
  growthPoint(5, 'growth5YearCagr');
  growthPoint(10, 'growth10YearCagr');

  if (sold !== null) {
    points.salesCount = point(sold, 'observed', `Domain suburb performance, sales in the period ending ${periodLabel(latest)}`, sold);
  }
  const dom = latest.values.daysOnMarket;
  if (dom !== null && dom > 0) {
    points.daysOnMarket = point(dom, 'observed', `Domain suburb performance, median days on market, period ending ${periodLabel(latest)}`, sold);
  }
  const discount = latest.values.discountPercentage;
  if (discount !== null) {
    points.vendorDiscount = point(Math.abs(discount), 'observed',
      `Domain suburb performance, vendor discount from first listing price, period ending ${periodLabel(latest)}`, sold);
  }
  const auctioned = latest.values.auctionNumberAuctioned;
  const auctionSold = latest.values.auctionNumberSold;
  if (auctioned !== null && auctionSold !== null && auctioned >= 10) {
    points.auctionClearanceRate = point(Number(((auctionSold / auctioned) * 100).toFixed(1)), 'calculated',
      `Auctions sold over auctions held (${auctionSold} of ${auctioned}), period ending ${periodLabel(latest)}`, auctioned);
  } else if (auctioned !== null && auctioned < 10) {
    notes.push(`Only ${auctioned} auctions in the period; clearance not computed.`);
  }
  const listings = latest.values.numberSaleListing;
  if (listings !== null) {
    points.listingActivity = point(listings, 'observed', `Domain suburb performance, properties listed for sale, period ending ${periodLabel(latest)}`, listings);
  }
  const rent = latest.values.medianRentListingPrice;
  if (rent !== null && rent > 0) {
    points.medianRent = point(rent, 'observed', `Domain suburb performance, median advertised weekly rent, period ending ${periodLabel(latest)}`,
      latest.values.numberRentListing ?? null);
  }
  return { points, notes, pricedPeriods: priced.length };
}

// ---------------------------------------------------------------------------
// The request — composed once, so the route and the postcode rule live here
// ---------------------------------------------------------------------------

/** Domain's v2 suburb-performance route. `/v1/…` is deprecated and never answered. */
export const DOMAIN_SUBURB_PERFORMANCE_BASE = 'https://api.domain.com.au/v2/suburbPerformanceStatistics';

/**
 * Twelve annual periods, latest first: enough for the ten-year horizon plus
 * the period it is measured against. `chronologicalSpan=12` is a calendar
 * year per period, which is the grain the growth horizons are defined on.
 */
export const DOMAIN_SERIES_QUERY = 'chronologicalSpan=12&tPlusFrom=1&tPlusTo=12';

const STATE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  'NEW SOUTH WALES': 'NSW',
  'VICTORIA': 'VIC',
  'QUEENSLAND': 'QLD',
  'WESTERN AUSTRALIA': 'WA',
  'SOUTH AUSTRALIA': 'SA',
  'TASMANIA': 'TAS',
  'NORTHERN TERRITORY': 'NT',
  'AUSTRALIAN CAPITAL TERRITORY': 'ACT',
};
const STATE_CODES = new Set(Object.values(STATE_ABBREVIATIONS));

/** `New South Wales` → `NSW`; `nsw` → `NSW`; anything else → null. */
export function abbreviateState(state: string | null | undefined): string | null {
  const t = String(state ?? '').trim().toUpperCase();
  if (!t) return null;
  if (STATE_CODES.has(t)) return t;
  return STATE_ABBREVIATIONS[t] ?? null;
}

/** The suburb as Domain's route spells it: single spaces, no hyphens, no stray case. */
export function normaliseDomainSuburb(suburb: string | null | undefined): string | null {
  const t = String(suburb ?? '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t : null;
}

export interface DomainRequestParts {
  state: string | null | undefined;
  suburb: string | null | undefined;
  postcode: string | number | null | undefined;
  propertyCategory: DomainPropertyCategory;
}

export type DomainRequestComposition =
  | { ok: true; url: string; state: string; suburb: string; postcode: string; propertyCategory: DomainPropertyCategory }
  | { ok: false; reason: string };

/**
 * The URL for one suburb-performance request, or the reason none can be made.
 *
 * The postcode is REQUIRED: it is a path segment on the v2 route, and the
 * caller must hold one it trusts — the generator passes the postal area
 * resolved from the verified coordinate and nothing weaker
 * (`crimePostcodeAuthority.pure.ts` records why a parsed one may not select
 * evidence). Refusing here is what stops a lot number becoming a suburb.
 */
export function domainSuburbPerformanceUrl(parts: DomainRequestParts): DomainRequestComposition {
  const state = abbreviateState(parts.state);
  if (!state) return { ok: false, reason: `state "${parts.state ?? ''}" is not an Australian state or territory code` };
  const suburb = normaliseDomainSuburb(parts.suburb);
  if (!suburb) return { ok: false, reason: 'suburb is required' };
  const postcode = String(parts.postcode ?? '').trim();
  if (!/^\d{4}$/.test(postcode)) {
    return { ok: false, reason: 'a trusted four-digit postcode is required — the v2 route takes it as a path segment' };
  }
  const category: DomainPropertyCategory = parts.propertyCategory === 'unit' ? 'unit' : 'house';
  const url = `${DOMAIN_SUBURB_PERFORMANCE_BASE}/${state}/${encodeURIComponent(suburb)}/${postcode}`
    + `?propertyCategory=${category}&${DOMAIN_SERIES_QUERY}`;
  return { ok: true, url, state, suburb, postcode, propertyCategory: category };
}

export interface DomainRefusal {
  kind: 'unauthenticated' | 'package_not_attached' | 'forbidden' | 'not_found' | 'rate_limited' | 'server_error' | 'other';
  /** One sentence for the log and the evidence gap. Quotes Domain's own reason where it gave one. */
  summary: string;
}

/**
 * Domain's problem-details body, where the answer carried one. Only the two
 * diagnostic fields are read (`title`, `detail`); nothing else in a body is
 * relayed, and a body that is not JSON reads as none.
 */
export function readDomainProblem(bodyText: string | null | undefined): { title: string | null; detail: string | null } {
  if (!bodyText) return { title: null, detail: null };
  try {
    const parsed = JSON.parse(bodyText) as { title?: unknown; detail?: unknown };
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
    return { title: str(parsed?.title), detail: str(parsed?.detail) };
  } catch {
    return { title: null, detail: null };
  }
}

/**
 * The detail Domain answers with when the PROJECT the key belongs to has no
 * API package attached. Measured from the production egress on 15 Sep 2026:
 * both the Properties & Locations route and the Address Suggestion route
 * answered 403 with exactly this body and no `X-Domain-Security-Reason`
 * header — so the key is recognised (an unrecognised key answers 401), the
 * project simply permits nothing. The remedy is the Domain Developer Portal
 * (Projects → the project → API Access → add the package → Save), not a
 * message asking Domain what the restriction is.
 */
export const DOMAIN_PACKAGE_NOT_ATTACHED_DETAIL = 'Operation not permitted on project';

/**
 * What a non-2xx answer means, read from the status, Domain's own
 * `X-Domain-Security-Reason` header where it was sent, and the `detail` of
 * its problem-details body where it carried one. A 403 with neither is the
 * ambiguous case `DOMAIN_ACTIVATION_REQUEST.md` records (8 Sep 2026) and is
 * stated as ambiguous rather than guessed at; a 403 whose body names the
 * project is the package finding above, and is stated as that.
 */
export function describeDomainRefusal(
  status: number,
  securityReason: string | null | undefined,
  bodyDetail: string | null | undefined = null,
): DomainRefusal {
  const reason = securityReason && securityReason.trim() ? securityReason.trim() : null;
  const detail = bodyDetail && bodyDetail.trim() ? bodyDetail.trim() : null;
  switch (status) {
    case 401:
      return { kind: 'unauthenticated', summary: 'HTTP 401 — the API key was not accepted (invalid or expired)' };
    case 403:
      if (detail && detail.toLowerCase() === DOMAIN_PACKAGE_NOT_ATTACHED_DETAIL.toLowerCase()) {
        return {
          kind: 'package_not_attached',
          summary: `HTTP 403 — Domain says "${detail}": the Properties & Locations API package is not attached to the project this key belongs to; attach it under API Access in the Domain Developer Portal`,
        };
      }
      return {
        kind: 'forbidden',
        summary: reason
          ? `HTTP 403 — Domain refused the request (X-Domain-Security-Reason: ${reason})`
          : detail
            ? `HTTP 403 — Domain refused the request ("${detail}", no X-Domain-Security-Reason header)`
            : 'HTTP 403 with no X-Domain-Security-Reason header — a scope, plan, environment or key restriction that Domain must identify (docs/integrations/DOMAIN_ACTIVATION_REQUEST.md)',
      };
    case 404:
      return { kind: 'not_found', summary: 'HTTP 404 — no suburb-performance series for that state, suburb and postcode' };
    case 429:
      return { kind: 'rate_limited', summary: 'HTTP 429 — Domain rate limit exceeded' };
    default:
      return status >= 500
        ? { kind: 'server_error', summary: `HTTP ${status} — Domain server error` }
        : { kind: 'other', summary: `HTTP ${status} — unexpected answer from Domain` };
  }
}
