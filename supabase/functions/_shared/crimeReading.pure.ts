/**
 * Compose the crime reading a report receives from the stored reference
 * rows — counts, their arithmetic, and nothing else.
 *
 * What this deliberately does NOT produce, because the fabricated
 * predecessor did: no `safetyScore`, no `overallRating`, no invented
 * year-on-year percentage with no series behind it. A recorded-crime
 * dataset supports counts, windows over counts, and disclosed-denominator
 * rates; adjectives are the reader's to form. A test bans the score
 * vocabulary from ever returning.
 *
 * Denominators are named (the §25 rule): a per-100k rate states whose
 * population it uses and its vintage (2021 Census usual residents), because
 * a rate whose denominator is five years older than its numerator is only
 * honest when it says so.
 */
import type { CrimeSeriesRow } from './crimeIngest.pure.ts';
import { SA_LEVEL1 } from './crimeIngestSaNt.pure.ts';

/**
 * A stored row as the reading layer takes it. `prior12` is nullable because a
 * prior window can be honestly ABSENT — SAPOL reclassified its offence
 * categories in July 2025, so its Level 2 series has no like-for-like year
 * before that and carries null rather than a number computed across the
 * boundary.
 */
export type ReadableRow =
  Omit<CrimeSeriesRow, 'prior12'> & { prior12: number | null; seriesNote?: string | null };

export interface CrimeCategoryReading {
  offence: string;
  last12Months: number;
  /** Null where no comparable prior window exists — see `seriesNote`. */
  previous12Months: number | null;
  /** Exact arithmetic; null when the prior window is zero OR absent. */
  changePct: number | null;
  yearTotals: Record<string, number>;
  /** Why this category has no comparison, in words a reader gets. */
  seriesNote?: string | null;
}

export interface CrimeReading {
  state: 'NSW' | 'QLD' | 'SA' | 'NT';
  /** The reading's geography, NAMED: `postcode`, `local government area`, `reporting region`, `statistical area 2`. */
  areaKind: string;
  area: string;
  source: string;
  /** The data's own months, e.g. `2025-01 to 2025-12`. */
  referencePeriod: string;
  latestMonth: string;
  totalLast12Months: number;
  /** Null where the categories that make the total have no comparable prior. */
  totalPrevious12Months: number | null;
  totalChangePct: number | null;
  categories: CrimeCategoryReading[];
  /**
   * Per-100k rates with the denominator named — present only when a
   * population figure exists for exactly this geography.
   */
  ratePer100k: {
    area: number;
    state: number | null;
    denominator: string;
  } | null;
  /**
   * The state-wide movement over the same window — a count-change
   * comparison, which needs no population and so is offered for every
   * state the register covers.
   */
  stateContext: {
    totalLast12Months: number;
    totalPrevious12Months: number | null;
    totalChangePct: number | null;
  } | null;
  dataQuality: 'recorded';
}

const pct = (now: number, prior: number | null): number | null =>
  prior !== null && prior > 0 ? Math.round(((now - prior) / prior) * 1000) / 10 : null;

const toReading = (r: ReadableRow): CrimeCategoryReading => ({
  offence: r.offence,
  last12Months: r.months12,
  previous12Months: r.prior12,
  changePct: pct(r.months12, r.prior12),
  yearTotals: r.yearTotals,
  seriesNote: r.seriesNote ?? null,
});

/**
 * Sum a set of prior windows, or refuse to.
 *
 * One incomparable part makes the whole incomparable: quietly adding the
 * comparable ones would publish a total covering a different set of
 * categories than the current window does, and the change between them would
 * be arithmetic on two different things.
 */
const sumPrior = (rows: readonly { prior12: number | null }[]): number | null =>
  rows.some((r) => r.prior12 === null) ? null : rows.reduce((s, r) => s + (r.prior12 ?? 0), 0);

export const QLD_DIVISION_ORDER = [
  'Offences Against the Person',
  'Offences Against Property',
  'Other Offences',
] as const;

export const QLD_HEADLINE_CATEGORIES = [
  'Assault', 'Sexual Offences', 'Robbery', 'Unlawful Entry',
  'Unlawful Use of Motor Vehicle', 'Other Theft (excl. Unlawful Entry)',
  'Fraud', 'Drug Offences', 'Good Order Offences',
  'Breach Domestic Violence Protection Order', 'Traffic and Related Offences',
] as const;

/**
 * State-wide totals over the `state_total` rows. NSW sums all 21 categories
 * (BOCSAR's own partition); QLD sums exactly the three division rollups —
 * summing every QLD column would double-count, which is the measured
 * hierarchy rule.
 */
export function stateContextFrom(
  stateRows: readonly ReadableRow[],
  state: 'NSW' | 'QLD' | 'SA' | 'NT',
): CrimeReading['stateContext'] {
  // Each state's own partition, and only its own: QLD sums the three division
  // rollups (summing every column would double-count), SA sums the two stable
  // Level 1 groupings (its Level 2 rows are a different classification and
  // overlap them), NSW and NT sum every category because theirs partition.
  const rows = state === 'QLD'
    ? stateRows.filter((r) => (QLD_DIVISION_ORDER as readonly string[]).includes(r.offence))
    : state === 'SA'
      ? stateRows.filter((r) => (SA_LEVEL1 as readonly string[]).includes(r.offence))
      : stateRows;
  if (rows.length === 0) return null;
  const now = rows.reduce((s, r) => s + r.months12, 0);
  const prior = sumPrior(rows);
  return { totalLast12Months: now, totalPrevious12Months: prior, totalChangePct: pct(now, prior) };
}

function referencePeriod(latestMonth: string): string {
  const [y, m] = latestMonth.split('-').map(Number);
  const from = m === 12 ? `${y}-01` : `${y - 1}-${String(m + 1).padStart(2, '0')}`;
  return `${from} to ${latestMonth}`;
}

/**
 * NSW: all 21 BOCSAR categories for one postcode, totalled by summing the
 * categories — which is safe here because BOCSAR's categories partition
 * (they are the file's own top level, one row each).
 */
export function nswCrimeReading(
  rows: readonly CrimeSeriesRow[],
  postcode: string,
  source: string,
  population: { area: number | null; state: number | null; vintage: string } | null,
  stateTotal12: number | null,
  stateContext: CrimeReading['stateContext'] = null,
): CrimeReading | null {
  if (rows.length === 0) return null;
  const categories = rows.map(toReading).sort((a, b) => b.last12Months - a.last12Months);
  const totalNow = categories.reduce((s, c) => s + c.last12Months, 0);
  const totalPrior = sumPrior(rows);
  const latestMonth = rows[0].latestMonth;

  let ratePer100k: CrimeReading['ratePer100k'] = null;
  if (population?.area && population.area > 0) {
    ratePer100k = {
      area: Math.round((totalNow / population.area) * 100_000),
      state:
        stateTotal12 !== null && population.state && population.state > 0
          ? Math.round((stateTotal12 / population.state) * 100_000)
          : null,
      denominator: population.vintage,
    };
  }

  return {
    state: 'NSW',
    areaKind: 'postcode',
    area: postcode,
    source,
    referencePeriod: referencePeriod(latestMonth),
    latestMonth,
    totalLast12Months: totalNow,
    totalPrevious12Months: totalPrior,
    totalChangePct: pct(totalNow, totalPrior),
    categories,
    ratePer100k,
    stateContext,
    dataQuality: 'recorded',
  };
}


/**
 * QLD: the three division rollups lead (they partition, measured 400/400),
 * with the named headline categories beneath — never summed across levels.
 */


export function qldCrimeReading(
  rows: readonly CrimeSeriesRow[],
  lga: string,
  source: string,
  stateContext: CrimeReading['stateContext'] = null,
): CrimeReading | null {
  if (rows.length === 0) return null;
  const byOffence = new Map(rows.map((r) => [r.offence, r]));
  const divisions = QLD_DIVISION_ORDER
    .map((d) => byOffence.get(d))
    .filter((r): r is CrimeSeriesRow => r !== undefined);
  if (divisions.length !== QLD_DIVISION_ORDER.length) return null;

  const headlines = QLD_HEADLINE_CATEGORIES
    .map((c) => byOffence.get(c))
    .filter((r): r is CrimeSeriesRow => r !== undefined)
    .map(toReading)
    .sort((a, b) => b.last12Months - a.last12Months);

  const totalNow = divisions.reduce((s, r) => s + r.months12, 0);
  const totalPrior = sumPrior(divisions);
  const latestMonth = rows[0].latestMonth;

  return {
    state: 'QLD',
    areaKind: 'local government area',
    area: lga,
    source,
    referencePeriod: referencePeriod(latestMonth),
    latestMonth,
    totalLast12Months: totalNow,
    totalPrevious12Months: totalPrior,
    totalChangePct: pct(totalNow, totalPrior),
    // Divisions first (the partition), then the headline categories.
    categories: [...divisions.map(toReading), ...headlines],
    ratePer100k: null,
    stateContext,
    dataQuality: 'recorded',
  };
}

/**
 * SA: the two stable Level 1 groupings lead, and the current-classification
 * Level 2 categories follow.
 *
 * The order is the point. `OFFENCES AGAINST PROPERTY` and `OFFENCES AGAINST
 * THE PERSON` partition the register and are unchanged across every published
 * year, so they carry the total, the year-on-year change and the six-year
 * history. The Level 2 categories are richer and newer — SAPOL adopted them
 * in July 2025 — so each one arrives with `previous12Months: null` and the
 * note that says why. They are NOT summed into the total: they overlap the
 * Level 1 rows exactly, and adding both would count every offence twice.
 */
export function saCrimeReading(
  rows: readonly ReadableRow[],
  postcode: string,
  source: string,
  population: { area: number | null; state: number | null; vintage: string } | null,
  stateTotal12: number | null,
  stateContext: CrimeReading['stateContext'] = null,
): CrimeReading | null {
  if (rows.length === 0) return null;
  const isLevel1 = (o: string) => (SA_LEVEL1 as readonly string[]).includes(o);
  const level1 = rows.filter((r) => isLevel1(r.offence));
  if (level1.length === 0) return null;
  const level2 = rows.filter((r) => !isLevel1(r.offence));

  const totalNow = level1.reduce((s, r) => s + r.months12, 0);
  const totalPrior = sumPrior(level1);
  const latestMonth = rows[0].latestMonth;

  let ratePer100k: CrimeReading['ratePer100k'] = null;
  if (population?.area && population.area > 0) {
    ratePer100k = {
      area: Math.round((totalNow / population.area) * 100_000),
      state: stateTotal12 !== null && population.state && population.state > 0
        ? Math.round((stateTotal12 / population.state) * 100_000)
        : null,
      denominator: population.vintage,
    };
  }

  return {
    state: 'SA',
    areaKind: 'postcode',
    area: postcode,
    source,
    referencePeriod: referencePeriod(latestMonth),
    latestMonth,
    totalLast12Months: totalNow,
    totalPrevious12Months: totalPrior,
    totalChangePct: pct(totalNow, totalPrior),
    categories: [
      ...level1.map(toReading).sort((a, b) => b.last12Months - a.last12Months),
      ...level2.map(toReading).sort((a, b) => b.last12Months - a.last12Months),
    ],
    ratePer100k,
    stateContext,
    dataQuality: 'recorded',
  };
}

/**
 * NT: nine categories that partition, so the total is their sum.
 *
 * The register publishes no postcode and no population on this geography, so
 * there is no rate — only counts, their change, and the two complete calendar
 * years the 31-month series contains. `areaKind` names which geography
 * answered, because "Darwin" as a reporting region and "Darwin" as a suburb
 * are different claims and the reader is entitled to know which one this is.
 */
export function ntCrimeReading(
  rows: readonly ReadableRow[],
  area: string,
  areaKind: 'reporting region' | 'statistical area 2',
  source: string,
  stateContext: CrimeReading['stateContext'] = null,
): CrimeReading | null {
  if (rows.length === 0) return null;
  const categories = rows.map(toReading).sort((a, b) => b.last12Months - a.last12Months);
  const totalNow = rows.reduce((s, r) => s + r.months12, 0);
  const totalPrior = sumPrior(rows);
  const latestMonth = rows[0].latestMonth;

  return {
    state: 'NT',
    areaKind,
    area,
    source,
    referencePeriod: referencePeriod(latestMonth),
    latestMonth,
    totalLast12Months: totalNow,
    totalPrevious12Months: totalPrior,
    totalChangePct: pct(totalNow, totalPrior),
    categories,
    ratePer100k: null,
    stateContext,
    dataQuality: 'recorded',
  };
}
