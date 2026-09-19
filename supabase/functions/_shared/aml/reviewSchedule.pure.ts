/**
 * How often ongoing CDD comes round — the ONE statement of the review cycle.
 *
 * ── Why this module exists ────────────────────────────────────────────
 * The interval table was written twice inside `aml-monitoring/index.ts`:
 * once as `DEFAULT_REVIEW_INTERVALS` for `schedule_periodic_review` and the
 * daily sweep, and once as an inline `defaults` object inside
 * `complete_review`. Two copies of one policy, thirty lines apart, and only
 * the first was the one anybody edited. A cycle that says one thing when a
 * review is scheduled and another when it is completed is not a cycle.
 *
 * ── The policy ────────────────────────────────────────────────────────
 * **A review is completed at least annually.** That is the reporting
 * entity's own AML/CTF programme decision, recorded here rather than
 * assumed: AUSTRAC requires ongoing customer due diligence proportionate to
 * risk and does not fix an interval, so the interval is a programme
 * parameter and this is where the programme states it.
 *
 * It replaces a default table of `{ high: 12, medium: 24, low: 36 }`, under
 * which a low-risk customer's identity, screening and circumstances went
 * three years without review while their screening refresh fell due at two.
 * Two obligations on one customer, running on different clocks, with the
 * slower one attached to the more searching question.
 *
 * ── Two rules, and they are not the same rule ─────────────────────────
 * **Higher risk reviews MORE often, never less.** `prohibited` stays at
 * three months. A rating may tighten the cycle and may never loosen it.
 *
 * **The annual ceiling binds a configured interval too.** A tenant may set
 * a shorter cycle in `tenant_settings.review_interval_config` and that is
 * honoured exactly; a longer one is clamped, because the ceiling is the
 * programme's stated policy rather than a default somebody forgot to
 * change. `resolveReviewInterval` reports when it clamped, so the caller
 * can record it rather than silently overriding a configured value.
 */

/** The programme's maximum interval between periodic reviews, in months. */
export const MAX_REVIEW_INTERVAL_MONTHS = 12;

/**
 * Interval by internal risk rating, in months. Every value is at or below
 * the annual ceiling; a rating exists here to make the cycle TIGHTER.
 */
export const DEFAULT_REVIEW_INTERVALS: Readonly<Record<string, number>> = Object.freeze({
  prohibited: 3,
  high: 12,
  medium: 12,
  low: 12,
  unrated: 12,
});

export interface ReviewIntervalReading {
  /** Months to the next periodic review. Always ≥ 1 and ≤ the ceiling. */
  months: number;
  /** The rating the interval was resolved for. */
  rating: string;
  /** True when a configured value exceeded the ceiling and was clamped. */
  clamped: boolean;
  /** What the tenant had configured, when it differs from what applies. */
  configuredMonths: number | null;
}

/**
 * Resolve the interval for a case.
 *
 * `config` is `tenant_settings.review_interval_config` — partial, and free
 * to be tighter. An unreadable or absent value falls back to the default
 * table rather than to "no review": ongoing CDD lapsing quietly is the
 * failure this whole area exists to prevent.
 */
export function resolveReviewInterval(
  riskRating: string | null | undefined,
  config?: Record<string, unknown> | null,
): ReviewIntervalReading {
  const rating = String(riskRating ?? "").trim() || "unrated";
  const table = DEFAULT_REVIEW_INTERVALS;

  const rawConfigured = config && typeof config === "object"
    ? (config as Record<string, unknown>)[rating]
    : undefined;
  const configured = Number(rawConfigured);
  const hasConfigured = Number.isFinite(configured) && configured > 0;

  const base = hasConfigured
    ? configured
    : (table[rating] ?? table.unrated ?? MAX_REVIEW_INTERVAL_MONTHS);

  const months = Math.min(
    Math.max(1, Math.floor(base)),
    MAX_REVIEW_INTERVAL_MONTHS,
  );

  return {
    months,
    rating,
    clamped: hasConfigured && configured > MAX_REVIEW_INTERVAL_MONTHS,
    configuredMonths: hasConfigured ? configured : null,
  };
}

/** `n` months after `from`, in UTC. */
export function addMonthsUtc(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * How the cycle reads on screen: "Every 12 months (low risk)".
 *
 * One implementation, so the card and the audit event cannot describe the
 * same cycle differently.
 */
export function reviewCycleLabel(reading: ReviewIntervalReading): string {
  const every = reading.months === 12
    ? "Annually"
    : `Every ${reading.months} month${reading.months === 1 ? "" : "s"}`;
  const rating = reading.rating === "unrated" ? "unrated" : `${reading.rating} risk`;
  return `${every} (${rating})`;
}
