/**
 * ABS estimated resident population → a demand evidence point.
 *
 * `abs_sa2_population` holds the ABS ERP series by SA2 and year — 61,335 rows
 * on 15 Sep 2026 — and `report_geography` names each placed report's SA2. The
 * Demand dimension admits population growth as a demand DRIVER
 * (`SCORING_V2_METHODOLOGY.md` §4.4), and this is the one place it is turned
 * into a point: the compound annual growth over the most recent five years
 * the series holds, or the longest span of at least three years where five
 * are not there.
 *
 * Open data, ABS-licensed, describes the SA2 rather than the property — all
 * of which travels on the point rather than being implied.
 */
import type { EvidencePoint, GeographicLevel } from './marketEvidence.pure.ts';
import { compoundAnnualGrowth } from './domainEvidence.pure.ts';

export const POPULATION_GROWTH_EVIDENCE_VERSION = '1.0.0';

export interface ErpRow {
  year: number;
  erp: number;
}

export interface PopulationArea {
  /** The SA2's name, as the ABS publishes it. */
  name: string;
  level: GeographicLevel;
}

export const PREFERRED_SPAN_YEARS = 5;
export const MINIMUM_SPAN_YEARS = 3;

/**
 * The growth point, or null when the series cannot support one. A zero
 * population, a single year, or a span shorter than three years all answer
 * null — never a rate computed over nothing.
 */
export function populationGrowthPoint(
  rows: ReadonlyArray<ErpRow>,
  area: PopulationArea,
): EvidencePoint | null {
  const clean = rows
    .filter((r) => Number.isFinite(r.year) && Number.isFinite(r.erp) && r.erp > 0)
    .sort((a, b) => a.year - b.year);
  if (clean.length < 2) return null;
  const latest = clean[clean.length - 1];
  const preferred = clean.find((r) => r.year === latest.year - PREFERRED_SPAN_YEARS);
  const base = preferred ?? clean[0];
  const years = latest.year - base.year;
  if (years < MINIMUM_SPAN_YEARS) return null;
  const value = compoundAnnualGrowth(base.erp, latest.erp, years);
  if (value === null) return null;
  return {
    value,
    level: area.level,
    areaName: area.name,
    dwellingType: 'any',
    dwellingTypeMatched: true,
    provider: 'abs_erp',
    asOf: `${latest.year}-06-30`,
    sampleSize: null,
    periodsAvailable: clean.length,
    method: 'calculated',
    licensingStatus: 'open',
    acquisition: 'open_public',
    sourceNote: `ABS estimated resident population, ${area.name}, ${base.year} to ${latest.year} `
      + `(${base.erp.toLocaleString('en-AU')} to ${latest.erp.toLocaleString('en-AU')})`,
  };
}
