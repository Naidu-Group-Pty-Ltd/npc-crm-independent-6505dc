/**
 * Project a loaded `abs_census_poa` row into the response shapes the report
 * pipelines consume — the one place the Census vocabulary meets the
 * platform's, shared by `abs-data-service` and `abs-employment-service` and
 * under test.
 *
 * Every figure is the ABS's own or a disclosed derivation of it, and every
 * label says what it actually is:
 *
 *  - **Rates name their denominators.** "Employment rate" here is employed ÷
 *    labour force (the complement of the unemployment rate); the
 *    employment-to-population ratio is published under its own name. The
 *    fabricated predecessor blurred them, and a rate whose denominator is
 *    unstated is a number that cannot be checked.
 *  - **Annual incomes are annualised weekly medians and say so.** The Census
 *    publishes weekly medians; × 52 is a disclosed convention, not a
 *    measurement.
 *  - **Industries are sorted by measured employment**, so `topIndustries[0]`
 *    is genuinely the largest employer. The old prompt hard-coded
 *    "Professional Services" as row one for every suburb in the country.
 *  - **No growth, no outlook, no trend.** One census cannot measure change,
 *    and this module will not invent it. Absent is a field the renderer
 *    omits; it is never a guessed number.
 *  - **The reference period travels with every block.** Census figures are
 *    2021 because they are 2021 — the most current authoritative
 *    postcode-level source until the 2026 Census releases — and a label
 *    claiming otherwise is the fabrication this replaces ("ABS (2025)" on
 *    invented numbers).
 *
 * Pure: no Deno, no network, no I/O.
 */

export interface AbsCensusPoaTableRow {
  poa: string;
  population: number | null;
  median_age: number | null;
  median_rent_weekly: number | null;
  median_hh_income_weekly: number | null;
  median_personal_income_weekly: number | null;
  median_family_income_weekly: number | null;
  median_mortgage_monthly: number | null;
  avg_household_size: number | null;
  owned_outright: number | null;
  owned_mortgage: number | null;
  rented: number | null;
  tenure_total: number | null;
  owner_occupier_rate: number | null;
  renter_rate: number | null;
  employed: number | null;
  unemployed: number | null;
  labour_force: number | null;
  not_in_labour_force: number | null;
  pop_15_plus: number | null;
  unemployment_rate: number | null;
  participation_rate: number | null;
  employment_to_pop_rate: number | null;
  industries: Array<{ name: string; employed: number; percentage: number | null }>;
  occupations: Array<{ name: string; employed: number; percentage: number | null }>;
  reference_period: string;
  source: string;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

const sourceFor = (row: AbsCensusPoaTableRow) => `ABS Census ${row.reference_period} (POA ${row.poa})`;

/**
 * Does this provenance string have the exact shape `sourceFor` produces?
 *
 * Exported beside the producer on purpose. The Client-Safe Gate has to tell a
 * retrieved Census figure from a generated one, and both spell themselves
 * "ABS Census 2021" — the generated corpus wrote `ABS Census 2021 estimates`
 * and several other variants. Only the postal-area form this projection emits
 * is recognised, and recognition is required rather than assumed: a recogniser
 * written separately from its producer is how the two come to disagree.
 */
export const CENSUS_PROJECTION_SOURCE_RE = /^ABS Census \d{4} \(POA \d{4}\)$/;

export function isCensusProjectionSource(source: unknown): boolean {
  return typeof source === 'string' && CENSUS_PROJECTION_SOURCE_RE.test(source.trim());
}

/** Employed ÷ labour force, as a percentage — the rate the label promises. */
export function employmentRateOfLabourForce(row: AbsCensusPoaTableRow): number | null {
  if (row.employed == null || row.labour_force == null || row.labour_force <= 0) return null;
  return round1((row.employed / row.labour_force) * 100);
}

/** Industries by measured employment, largest first. */
export function topIndustries(row: AbsCensusPoaTableRow, n = 5) {
  return [...(row.industries ?? [])]
    .sort((a, b) => b.employed - a.employed)
    .slice(0, n)
    .map(({ name, employed, percentage }) => ({ name, employed, percentage }));
}

/** The demographics response `abs-data-service` serves. */
export function censusDemographicsResponse(row: AbsCensusPoaTableRow) {
  const source = sourceFor(row);
  const professionals = (row.occupations ?? []).find((o) => o.name === 'Professionals');
  const managers = (row.occupations ?? []).find((o) => o.name === 'Managers');
  return {
    population: {
      total: row.population,
      dataQuality: 'census',
      referencePeriod: row.reference_period,
      source,
    },
    income: {
      medianHouseholdIncomeWeekly: row.median_hh_income_weekly,
      // Annualised from the ABS weekly median (× 52) — a disclosed
      // convention; the Census publishes weekly figures.
      medianHouseholdIncome: row.median_hh_income_weekly == null ? null : row.median_hh_income_weekly * 52,
      medianWeeklyIncome: row.median_hh_income_weekly,
      medianPersonalIncomeWeekly: row.median_personal_income_weekly,
      medianAge: row.median_age,
      unemploymentRate: row.unemployment_rate,
      dataQuality: 'census',
      referencePeriod: row.reference_period,
      source,
    },
    housing: {
      ownerOccupierRate: row.owner_occupier_rate,
      renterRate: row.renter_rate,
      medianRent: row.median_rent_weekly,
      medianMortgageMonthly: row.median_mortgage_monthly,
      averageHouseholdSize: row.avg_household_size,
      dataQuality: 'census',
      referencePeriod: row.reference_period,
      source,
    },
    employment: {
      laborForce: row.labour_force,
      laborForceParticipation: row.participation_rate,
      employmentRate: employmentRateOfLabourForce(row),
      employmentToPopulationRate: row.employment_to_pop_rate,
      topIndustries: topIndustries(row),
      professionalOccupations: professionals?.percentage ?? null,
      managerialOccupations: managers?.percentage ?? null,
      dataQuality: 'census',
      referencePeriod: row.reference_period,
      source,
    },
    dataSource: source,
    dataQuality: 'census',
    referencePeriod: row.reference_period,
  };
}

/** The employment response `abs-employment-service` serves. */
export function censusEmploymentResponse(row: AbsCensusPoaTableRow, suburb?: string, state?: string) {
  const source = sourceFor(row);
  return {
    suburb: suburb ?? null,
    state: state ?? null,
    postcode: row.poa,
    employmentRate: employmentRateOfLabourForce(row),
    unemploymentRate: row.unemployment_rate,
    participationRate: row.participation_rate,
    employmentToPopulationRate: row.employment_to_pop_rate,
    laborForceSize: row.labour_force,
    employedPersons: row.employed,
    // Sorted by measured employment — no fixed row order, no growth column:
    // one census cannot measure change, so none is asserted.
    majorIndustries: topIndustries(row).map(({ name, percentage }) => ({ name, percentage })),
    occupationBreakdown: [...(row.occupations ?? [])]
      .sort((a, b) => b.employed - a.employed)
      .map(({ name, percentage }) => ({ category: name, percentage })),
    medianIncome: {
      weekly: row.median_personal_income_weekly,
      // Annualised from the ABS weekly median (× 52) — disclosed convention.
      annual: row.median_personal_income_weekly == null ? null : row.median_personal_income_weekly * 52,
    },
    dataSource: source,
    dataQuality: 'census',
    referencePeriod: row.reference_period,
    note: 'Figures are place-of-usual-residence Census counts for this postal area. Employment rate is employed persons as a share of the labour force; the employment-to-population ratio is reported separately.',
  };
}
