/**
 * What kind of comparison a `property_comparisons` row is, in words a person
 * reads.
 *
 * The producer (`compare-investment-reports`) refuses a mixed selection and
 * stores the shared report family in `comparison_type` — one of five canonical
 * values. This module maps THOSE stored values onto display identity; it
 * deliberately carries no alias table, because normalisation happens once,
 * server-side, at creation (`normalizeComparableReportType`). A client that
 * re-normalised raw tiers would be a second authority waiting to drift.
 *
 * Rows from before the column existed are `null`. A backfill migration types
 * the ones whose linked reports all still resolve and agree; a row whose
 * evidence is dangling or mixed stays untyped, and this module presents that
 * honestly as a plain "Comparison" rather than guessing — absent evidence
 * never merges.
 *
 * Type identity is carried by the LABEL first; the tint is reinforcement, so
 * nothing here relies on colour alone.
 */

/** The five families the producer can store. Mirrors `ComparableReportType`
 *  in `supabase/functions/compare-investment-reports/index.ts`. */
export type ComparisonTypeKey = 'compass' | 'financial' | 'strategic' | 'snapshot' | 'briefing';

export interface ComparisonTypeDescriptor {
  /** Canonical stored value, or null for an untyped (legacy/mixed) row. */
  key: ComparisonTypeKey | null;
  /** Badge label, e.g. "Compass Comparison". */
  label: string;
  /** One line on what this comparison family compares; badge tooltip. */
  blurb: string;
  /**
   * Semantic-token badge classes (never raw palette classes — the style audit
   * enforces that repo-wide). Follows the tint recipe the card already uses.
   */
  badgeClassName: string;
}

const DESCRIPTORS: Record<ComparisonTypeKey, ComparisonTypeDescriptor> = {
  compass: {
    key: 'compass',
    label: 'Compass Comparison',
    blurb: 'Compares full Investment Compass reports — the complete location and property-fit analysis.',
    badgeClassName: 'bg-brand-500/15 text-brand-600 hover:bg-brand-500/20 dark:bg-brand-500/30 dark:text-brand-300',
  },
  briefing: {
    key: 'briefing',
    label: 'Briefing Comparison',
    blurb: 'Compares Client Briefing reports — the concise, client-facing summaries.',
    badgeClassName: 'bg-info/15 text-info hover:bg-info/20 dark:bg-info/30 dark:text-info',
  },
  snapshot: {
    key: 'snapshot',
    label: 'Snapshot Comparison',
    blurb: 'Compares Quick Snapshot reports — the fast, top-line overviews.',
    badgeClassName: 'bg-warning/15 text-warning hover:bg-warning/20 dark:bg-warning/30 dark:text-warning',
  },
  financial: {
    key: 'financial',
    label: 'Financial Comparison',
    blurb: 'Compares Financial reports — the numbers-first analyses.',
    badgeClassName: 'bg-success/15 text-success hover:bg-success/20 dark:bg-success/30 dark:text-success',
  },
  strategic: {
    key: 'strategic',
    label: 'Strategic Comparison',
    blurb: 'Compares Strategic / due-diligence reports.',
    badgeClassName: 'bg-accent/40 text-accent-foreground hover:bg-accent/50 dark:bg-accent/40 dark:text-accent-foreground',
  },
};

/**
 * An untyped row: created before the producer recorded the family, and not
 * backfillable because its linked reports no longer all resolve — or they
 * genuinely mixed families, which the producer has since forbidden.
 */
const UNTYPED: ComparisonTypeDescriptor = {
  key: null,
  label: 'Comparison',
  blurb: 'Created before comparisons recorded which report family they compare.',
  badgeClassName: 'bg-muted text-muted-foreground hover:bg-muted/80',
};

export function describeComparisonType(value: unknown): ComparisonTypeDescriptor {
  if (typeof value !== 'string') return UNTYPED;
  const key = value.trim().toLowerCase() as ComparisonTypeKey;
  return DESCRIPTORS[key] ?? UNTYPED;
}

/** Every typed descriptor, in the order counts are summarised. */
export const COMPARISON_TYPE_DESCRIPTORS: readonly ComparisonTypeDescriptor[] = [
  DESCRIPTORS.compass,
  DESCRIPTORS.briefing,
  DESCRIPTORS.snapshot,
  DESCRIPTORS.financial,
  DESCRIPTORS.strategic,
];

/**
 * How many of these rows are each type, as `[descriptor, count]` pairs in
 * summary order, typed families first and untyped last. Types with no rows are
 * omitted — a chip saying "0 Strategic" is noise about a family nobody used.
 */
export function countComparisonTypes(
  rows: ReadonlyArray<{ comparison_type?: unknown }>,
): Array<[ComparisonTypeDescriptor, number]> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const d = describeComparisonType(row?.comparison_type);
    const bucket = d.key ?? 'untyped';
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const out: Array<[ComparisonTypeDescriptor, number]> = [];
  for (const d of COMPARISON_TYPE_DESCRIPTORS) {
    const n = counts.get(d.key as string) ?? 0;
    if (n > 0) out.push([d, n]);
  }
  const untyped = counts.get('untyped') ?? 0;
  if (untyped > 0) out.push([UNTYPED, untyped]);
  return out;
}
