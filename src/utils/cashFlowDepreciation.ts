/**
 * Canonical helpers for the editable 10-Year Cash Flow depreciation schedule.
 *
 * The 10-Year Cash Flow Analysis modal lets a user override the depreciation
 * figure for any of Years 1-10. Those manual edits are persisted inside
 * `manual_overrides.cashFlowYearlyOverrides[year].depreciation` and MUST take
 * priority over the generated `manual_overrides.depreciationSchedule` (which is
 * owned by report generation / the Manual Data Override modal).
 *
 * Canonical data model (matches the existing schema):
 *   - Years are keyed 1..10 (there is no Year 0 or Year 11 in the schedule).
 *   - Depreciation values are plain numbers. Zero is a valid value.
 *   - A missing/undefined/null override means "fall back to the generated
 *     schedule, then the single default value".
 *
 * These helpers are intentionally pure so the persistence + recalculation rules
 * can be unit tested without mounting the (very large) modal component.
 */

/** Number of forward-looking years in the cash-flow depreciation schedule. */
export const DEPRECIATION_YEARS = 10;

/** Per-year override map, keyed by year number (1..10). */
export type YearOverrideMap<T> = { [year: number]: T };

/**
 * Parse a user-entered financial value into a canonical number.
 *
 * Strips currency symbols, thousands separators and stray whitespace before
 * parsing so pasted values like "$16,000" or "16 000" resolve correctly.
 *
 * Returns:
 *   - `null` when the input is empty / whitespace / not a parseable number
 *     (callers treat `null` as "no override / temporarily blank").
 *   - a finite number otherwise. Zero parses to `0`, never `null`.
 */
export function parseFinancialInput(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }

  // Keep digits, a single leading sign, and the decimal point. This removes
  // currency symbols ($), thousands separators (,) and spaces.
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A depreciation override counts as "manual" only when it is a real number (0 included). */
export function hasManualDepreciationOverride(override: number | null | undefined): boolean {
  return override !== null && override !== undefined;
}

/**
 * Resolve the effective depreciation value for a single projection year.
 *
 * Priority (highest first) — this mirrors the priority the modal has always
 * used for the projection table, extracted so it can be reused + tested:
 *   1. Manual per-year override (saved or in-flight draft). Zero is honoured.
 *   2. Generated 10-year schedule value for the year.
 *   3. Single default depreciation figure.
 *
 * Year 0 (the "today" column) never carries depreciation.
 */
export function resolveYearDepreciation(args: {
  year: number;
  override?: number | null;
  scheduleValue?: number | null;
  defaultValue: number;
}): number {
  const { year, override, scheduleValue, defaultValue } = args;
  if (year === 0) return 0;
  if (hasManualDepreciationOverride(override)) return override as number;
  if (scheduleValue !== null && scheduleValue !== undefined) return scheduleValue;
  return defaultValue;
}

/**
 * Deep-clone a per-year overrides map so editing never mutates the loaded query
 * result (which React Query treats as immutable) or shares nested references
 * between the "saved" and "draft" states.
 */
export function cloneYearlyOverrides<T extends object>(
  source: YearOverrideMap<T> | null | undefined,
): YearOverrideMap<T> {
  const cloned: YearOverrideMap<T> = {};
  if (!source) return cloned;
  for (const [key, value] of Object.entries(source)) {
    const year = Number(key);
    if (!Number.isFinite(year)) continue;
    cloned[year] = { ...(value as T) };
  }
  return cloned;
}

/**
 * Hydrate the editable per-year overrides from the persisted record WITHOUT
 * letting the generated depreciation schedule clobber saved manual values.
 *
 * Root-cause fix: the modal previously merged `depreciationSchedule` on top of
 * the saved `cashFlowYearlyOverrides`, so a saved manual depreciation edit was
 * overwritten by the original generated figure on every open/refetch (the value
 * "reverted"). Saved manual overrides are authoritative; years the user has
 * never edited simply carry no depreciation override here and fall back to the
 * generated schedule at projection time.
 */
export function hydrateYearlyOverrides<T extends object>(
  savedOverrides: YearOverrideMap<T> | null | undefined,
): YearOverrideMap<T> {
  return cloneYearlyOverrides(savedOverrides);
}

/**
 * Return the set of years (1..10) whose draft depreciation differs from the
 * saved depreciation. Used to derive an accurate dirty state.
 */
export function getDirtyDepreciationYears(
  draft: YearOverrideMap<{ depreciation?: number | null }>,
  saved: YearOverrideMap<{ depreciation?: number | null }>,
): number[] {
  const dirty: number[] = [];
  for (let year = 1; year <= DEPRECIATION_YEARS; year++) {
    const draftValue = draft?.[year]?.depreciation ?? null;
    const savedValue = saved?.[year]?.depreciation ?? null;
    if (draftValue !== savedValue) dirty.push(year);
  }
  return dirty;
}

/** True when any Year 1-10 draft depreciation differs from the saved schedule. */
export function isDepreciationDirty(
  draft: YearOverrideMap<{ depreciation?: number | null }>,
  saved: YearOverrideMap<{ depreciation?: number | null }>,
): boolean {
  return getDirtyDepreciationYears(draft, saved).length > 0;
}
