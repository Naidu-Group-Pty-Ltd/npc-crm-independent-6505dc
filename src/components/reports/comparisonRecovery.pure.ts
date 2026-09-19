/**
 * Reading a stored `property_comparisons` row back into the modal.
 *
 * Exists because of what a timed-out comparison request actually is: the
 * browser aborts at 150s, but the abort never reaches the edge function, which
 * keeps generating, stores the row and charges for it. On 2026-08-26 the row
 * landed 19 seconds after the client gave up, and the person who asked was
 * told "Request timed out" about an analysis that existed. The modal now polls
 * for that row before reporting failure, and these helpers are the one reading
 * of a stored row it shares with the History loader — two readers of the same
 * row disagreeing is how 30 damaged rows once rendered as raw JSON on screen
 * (see docs/reports/COMPARISON.md §12).
 *
 * Pure on purpose: no imports, no client, testable without the component tree.
 */

/** The modal's analysis shape, rebuilt from a stored row's columns. */
export interface RecoveredComparisonAnalysis {
  executiveSummary: string;
  rankings: unknown[];
  financialComparison: Record<string, unknown>;
  locationComparison: Record<string, unknown>;
  riskComparison: Record<string, unknown>;
  investorMatches: unknown[];
  competitiveAdvantages: unknown[];
  redFlags: unknown[];
  finalRecommendation: Record<string, unknown>;
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Shape whatever the producer returned into the one form the results view may
 * assume.
 *
 * Two facts of production make this necessary. The response schema names the
 * verdict section `recommendations` while this UI reads `finalRecommendation`
 * — the model can answer under either name, so both are accepted here and the
 * UI reads exactly one. And a section the model had nothing to say about is
 * simply ABSENT: on 2026-08-26 three of five stored analyses carried no
 * `recommendations`, no `redFlags` and no `investorMatches`, and one held a
 * `financialComparison` with a single axis in it. Dereferencing those as
 * though complete is what unmounted the whole Generated Reports page behind a
 * "Comparison Complete" toast. Every section therefore defaults to its empty
 * shape; what a section holds INSIDE is still the renderer's to guard.
 */
export function normaliseComparisonAnalysis(raw: unknown): RecoveredComparisonAnalysis {
  const a = asObject(raw);
  const direct = asObject(a.finalRecommendation);
  const finalRecommendation = Object.keys(direct).length > 0 ? direct : asObject(a.recommendations);
  return {
    executiveSummary: typeof a.executiveSummary === 'string' ? a.executiveSummary : '',
    rankings: asArray(a.rankings),
    financialComparison: asObject(a.financialComparison),
    locationComparison: asObject(a.locationComparison),
    riskComparison: asObject(a.riskComparison),
    investorMatches: asArray(a.investorMatches),
    competitiveAdvantages: asArray(a.competitiveAdvantages),
    redFlags: asArray(a.redFlags),
    finalRecommendation,
  };
}

/**
 * Rebuild the analysis object the modal renders from a stored row. One
 * mapping, shared by the History loader and the post-timeout recovery, so the
 * two cannot disagree about what a stored row means.
 */
export function analysisFromComparisonRow(row: Record<string, any>): RecoveredComparisonAnalysis {
  return normaliseComparisonAnalysis({
    executiveSummary: row.executive_summary,
    rankings: row.rankings,
    financialComparison: row.financial_comparison,
    locationComparison: row.location_comparison,
    riskComparison: row.risk_comparison,
    investorMatches: row.investor_matches,
    // Not stored separately; a stored row has no competitiveAdvantages column.
    redFlags: row.red_flags,
    finalRecommendation: row.recommendations,
  });
}

/**
 * The sections the results view presents, with the names a person reads.
 * Ordered as the tabs present them.
 */
export const COMPARISON_SECTION_LABELS: ReadonlyArray<
  readonly [keyof RecoveredComparisonAnalysis, string]
> = [
  ['executiveSummary', 'Executive summary'],
  ['rankings', 'Rankings'],
  ['financialComparison', 'Financial comparison'],
  ['locationComparison', 'Location comparison'],
  ['riskComparison', 'Risk assessment'],
  ['investorMatches', 'Investor matching'],
  ['redFlags', 'Red flags'],
  ['finalRecommendation', 'Final recommendation'],
] as const;

/**
 * Which sections this analysis simply does not carry, by their display names.
 *
 * Rendered as a notice rather than silently dropping the tab content: a ranked
 * comparison that omits *which one should I buy* without saying so reads as a
 * finished document that forgot to answer its own question — the same rule the
 * PDF path applies (docs/reports/COMPARISON.md §3).
 */
export function absentComparisonSections(analysis: RecoveredComparisonAnalysis): string[] {
  return COMPARISON_SECTION_LABELS
    .filter(([key]) => {
      const v = analysis[key];
      if (typeof v === 'string') return v.trim() === '';
      if (Array.isArray(v)) return v.length === 0;
      return Object.keys(v as Record<string, unknown>).length === 0;
    })
    .map(([, label]) => label);
}

/**
 * A stored row this modal can display inline: the structured columns are
 * populated with a ranking of at least two properties — the same "a ranking is
 * what makes it a comparison" rule the producer enforces. A raw-blob row (the
 * columns NULL, the model's text kept whole for salvage) is real but belongs
 * to the viewer, which knows how to read it back.
 */
export function isDisplayableComparisonRow(row: Record<string, any> | null | undefined): boolean {
  return Array.isArray(row?.rankings) && row.rankings.length >= 2;
}

/**
 * Does a stored row's `report_ids` name exactly the reports selected here?
 * Order-insensitive, because the producer stores them in request order and the
 * matcher must not care which card was ticked first.
 */
export function matchesSelectedReportIds(
  rowReportIds: unknown,
  selectedReportIds: readonly string[],
): boolean {
  if (!Array.isArray(rowReportIds)) return false;
  if (rowReportIds.length !== selectedReportIds.length) return false;
  const sortedRow = [...rowReportIds].sort();
  const sortedSelected = [...selectedReportIds].sort();
  return sortedRow.every((id, index) => id === sortedSelected[index]);
}

/**
 * Should the modal ask the database whether the analysis actually completed?
 *
 * Yes for every failure where NO response arrived, and only those. `network` is
 * set solely on the transport's own failure path, so a server-side failure that
 * merely mentions a timeout — a 502 naming a provider timeout — is excluded: it
 * carries a response, and a response is an answer.
 *
 * This used to additionally require `provider_timeout`, i.e. our own 150s
 * abort. That excluded the case it most needed to catch. A request the gateway
 * cuts short reports `network_error`, and `compare-investment-reports` declared
 * `request_timeout = 120` against its own ceiling of 125s (`ANALYSIS_BUDGET_MS`
 * + `RESPONSE_RESERVE_MS`) — so the gateway was always the one to cut, the
 * recovery never ran, and a run that had finished and stored its analysis was
 * reported to the person who asked as a failure. The browser renders a severed
 * request as `Failed to fetch`, which the transport labels a CORS problem,
 * which is why this presented as a configuration fault for so long.
 *
 * Both cases share the only property that matters here: nobody knows whether
 * the server finished, so the row is the authority rather than the error.
 */
export function shouldAttemptRecovery(
  error: { network?: boolean } | null | undefined,
): boolean {
  return !!error && error.network === true;
}
