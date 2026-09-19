import type { InvestmentReport, OverriddenField } from './types';
import { getReportVariantLabel as getCanonicalReportVariantLabel } from '@/lib/reports/reportVariants';

export function getReportScore(report: InvestmentReport | null) {
  const score = report?.investment_score;
  if (!score) return null;
  if (typeof score === 'number' || typeof score === 'string') return score;
  return score.overall_score ?? score.score ?? score.totalScore ?? score.rating ?? null;
}

export function getReportTierLabel(report: InvestmentReport | null) {
  return getCanonicalReportVariantLabel(report);
}

export function getReportVariantLabel(report: InvestmentReport | null) {
  return getCanonicalReportVariantLabel(report);
}

export function getReportStatusLabel(report: InvestmentReport | null) {
  return report?.status ? report.status.replace(/_/g, ' ') : 'Draft';
}

export function getHasOverrides(report: InvestmentReport | null) {
  return !!(report?.manual_overrides && Object.keys(report.manual_overrides).length > 0);
}

/** Why a score's own run withheld the overall grade, in the stamp's words. */
export type GradeWithheldReason = 'no_authorised_scoring_system' | 'insufficient_verified_evidence';

export interface GradePolicyReading {
  /** The run wrote a policy stamp — every score since 11 Sep 2026. */
  stamped: boolean;
  /** The run published an overall grade. True for every unstamped, historical score. */
  issued: boolean;
  reason: GradeWithheldReason | null;
  /** The dimensions the run measured, in the stamp's own vocabulary. */
  measured: string[];
  /**
   * The named gaps that withheld the grade, as the run recorded them
   * (`gradeGaps` — Scoring V2 runs, 15 Sep 2026 onward): "growth: No suburb
   * capital-growth series for Kellyville NSW 2155 (domain: HTTP 403 …)".
   * Empty on a legacy stamp, which recorded no gaps.
   */
  gaps: string[];
}

/**
 * What a stored score says about whether its grade was published.
 *
 * Read from the stamp the scoring run wrote (`policy.gradeIssued`) and never
 * re-derived — "was a grade published" is a fact about that run, and
 * re-deriving it later is how two surfaces come to disagree. A score with no
 * stamp predates the policy and reads as issued, exactly as it always did.
 */
export function readGradePolicy(investmentScore: unknown): GradePolicyReading {
  const policy = (investmentScore as { policy?: unknown } | null | undefined)?.policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return { stamped: false, issued: true, reason: null, measured: [], gaps: [] };
  }
  const p = policy as Record<string, unknown>;
  const issued = p.gradeIssued !== false;
  const measured = Array.isArray(p.measuredDimensions)
    ? p.measuredDimensions.filter((d): d is string => typeof d === 'string')
    : [];
  const rawGaps = (investmentScore as { gradeGaps?: unknown }).gradeGaps;
  const gaps = Array.isArray(rawGaps)
    ? rawGaps.flatMap((g) => {
        if (!g || typeof g !== 'object') return [];
        const gap = g as Record<string, unknown>;
        if (gap.withholdsGrade !== true) return [];
        const dimension = typeof gap.dimension === 'string' ? gap.dimension : null;
        const detail = typeof gap.detail === 'string' ? gap.detail.trim() : '';
        return dimension && detail ? [`${dimension}: ${detail}`] : [];
      })
    : [];
  return {
    stamped: true,
    issued,
    reason: issued
      ? null
      : p.eligibility === 'insufficient_verified_evidence'
        ? 'insufficient_verified_evidence'
        : 'no_authorised_scoring_system',
    measured,
    gaps,
  };
}

/**
 * The operator's sentence for a withheld grade — the card and the page say
 * the same thing because they compose it here.
 *
 * It names the CAUSE, which the client-facing sentence on the record
 * deliberately does not ("An overall investment grade is only issued when
 * sufficient verified property evidence is available"): an operator asking
 * why the grade is missing needs to know that it is the scoring policy, not
 * a failed calculation, and what would change it.
 */
export function gradeWithheldStatement(
  reading: GradePolicyReading,
  coverage?: { dimensionsScored?: unknown; totalDimensions?: unknown } | null,
): string {
  const cause = reading.reason === 'insufficient_verified_evidence'
    ? 'insufficient verified property evidence'
    : 'no scoring system is currently authorised to issue an overall grade for new reports';
  const scored = typeof coverage?.dimensionsScored === 'number' ? coverage.dimensionsScored : null;
  const total = typeof coverage?.totalDimensions === 'number' ? coverage.totalDimensions : null;
  const measured = scored !== null && total !== null
    ? ` ${scored} of ${total} dimensions measured${reading.measured.length ? ` (${reading.measured.join(', ')})` : ''}.`
    : reading.measured.length ? ` Measured: ${reading.measured.join(', ')}.` : '';
  // The run's own named gaps, where it recorded them — what would change it.
  const gaps = reading.gaps.length ? ` Not measured — ${reading.gaps.join(' ')}` : '';
  return `Withheld by the scoring policy: ${cause}.${measured}${gaps}`;
}

export interface WithheldGrade {
  reason: GradeWithheldReason;
  /** `gradeWithheldStatement`, for the surface to draw. */
  statement: string;
  measured: string[];
}

export function getInvestmentScoreSummary(report: InvestmentReport | null) {
  const investmentScore = report?.investment_score;
  const score = getReportScore(report);
  const numericScore = typeof score === 'number' ? score : typeof score === 'string' && /^\d+(\.\d+)?$/.test(score) ? Number(score) : null;

  // A run that WITHHELD its grade has no grade and no score to show, whatever
  // the row carries beside the stamp — and the literal `N/A` the scoring
  // service writes into `grade` is a placeholder, never a grade to draw.
  // (15 Sep 2026: the page header read "Investment Grade N/A".)
  const policy = readGradePolicy(investmentScore);
  const withheld = policy.stamped && !policy.issued;
  const insufficient = !investmentScore || withheld || investmentScore.coverage?.dataInsufficient || numericScore == null;

  const rawGrade = typeof investmentScore?.grade === 'string' ? investmentScore.grade.trim() : '';
  const grade = !withheld && rawGrade && rawGrade.toUpperCase() !== 'N/A' ? rawGrade : null;
  const recommendation = typeof investmentScore?.recommendation === 'string' ? investmentScore.recommendation : null;
  const partialLabel = typeof investmentScore?.coverage?.partialLabel === 'string' ? investmentScore.coverage.partialLabel : null;

  return {
    grade,
    recommendation: recommendation || null,
    score: withheld ? null : numericScore,
    insufficient,
    partialLabel: partialLabel || (insufficient ? 'Qualitative review only' : null),
    withheld: withheld && policy.reason
      ? {
          reason: policy.reason,
          statement: gradeWithheldStatement(policy, investmentScore?.coverage ?? null),
          measured: policy.measured,
        } satisfies WithheldGrade
      : null,
  };
}

export type InvestmentGradeStatus = 'calculated' | 'withheld' | 'pending' | 'insufficient_data' | 'failed' | 'not_graded';

export interface ResolvedInvestmentGrade {
  grade: string | null;
  recommendation: string | null;
  score: number | null;
  partialLabel: string | null;
  status: InvestmentGradeStatus;
  sourceReportId: string | null;
  /** Set with status `withheld`: the run's own reason, for the surface to say. */
  withheld: WithheldGrade | null;
}

type GradeReport = Pick<InvestmentReport, 'id' | 'created_at' | 'status' | 'investment_score'>;

const reportTimestamp = (report: Pick<InvestmentReport, 'created_at'>) => {
  const timestamp = Date.parse(report.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

/**
 * Resolves the persisted score already used by report cards. It deliberately does
 * not calculate a score or grade in the client; it only selects the newest usable
 * score snapshot from reports that are already present in the list response.
 */
/**
 * A Financial or Due Diligence variant's score is a reading of one aspect —
 * the buyer's position, the site — produced by the fork, never the
 * property's grade. See `variantScorePolicy.pure.ts`.
 */
const isVariantScore = (score: unknown): boolean => {
  const variant = (score as { variant?: unknown } | null | undefined)?.variant;
  return variant === 'financial' || variant === 'due_diligence';
};

export function resolveInvestmentGrade(reports: readonly GradeReport[]): ResolvedInvestmentGrade {
  const ordered = [...reports].sort((a, b) => reportTimestamp(b) - reportTimestamp(a));
  const toResolved = (report: GradeReport, status: InvestmentGradeStatus): ResolvedInvestmentGrade => {
    const summary = getInvestmentScoreSummary(report as InvestmentReport);
    return {
      grade: summary.grade,
      recommendation: summary.recommendation,
      score: summary.score,
      partialLabel: summary.partialLabel,
      status,
      sourceReportId: report.id,
      withheld: summary.withheld,
    };
  };

  /*
   * The property's grade is read from a COMPOSITE score. A variant score
   * never stands for the property while a composite exists — on 15 Sep 2026
   * a Financial fork's D · CAUTION · 39/100 stood above five chips on the
   * package card while the Compass page beside it, whose run had withheld the
   * grade under the scoring policy, read "N/A". Only where no report carries
   * a composite score at all does a variant's own score stand, as it did.
   */
  const composites = ordered.filter((r) => r.investment_score && !isVariantScore(r.investment_score));
  const candidates = composites.length ? composites : ordered;

  // A run that WITHHELD the grade is a decision about the property, and the
  // newest decision wins: a withholding after a calculated score outranks
  // it, and a calculated score after a withholding is the newer reading.
  const withheldNewest = candidates.find((report) => (
    report.status !== 'failed' && getInvestmentScoreSummary(report as InvestmentReport).withheld !== null
  ));
  // A completed, numeric score is authoritative even when a newer regeneration is pending.
  const calculated = candidates.find((report) => {
    const summary = getInvestmentScoreSummary(report as InvestmentReport);
    return report.status !== 'failed' && summary.score != null;
  });
  if (withheldNewest && (!calculated || reportTimestamp(withheldNewest) >= reportTimestamp(calculated))) {
    return toResolved(withheldNewest, 'withheld');
  }
  if (calculated) return toResolved(calculated, 'calculated');

  const latest = ordered[0];
  if (!latest) return { grade: null, recommendation: null, score: null, partialLabel: null, status: 'not_graded', sourceReportId: null, withheld: null };
  if (latest.status === 'pending' || latest.status === 'processing') return toResolved(latest, 'pending');
  if (latest.status === 'failed') return toResolved(latest, 'failed');

  /*
   * "We assessed and lacked data" and "there is no assessment" are different
   * things to tell a client.
   *
   * This read `latest.investment_score || summary.insufficient`, and
   * `summary.insufficient` is `!investmentScore || …` — true whenever the
   * column is absent. So the second operand subsumed the first, every report
   * without a score resolved to `insufficient_data` ("Qualitative review
   * only"), and the `not_graded` branch below was unreachable for any report
   * that exists. 199 of the 1,187 stored reports carry no `investment_score`
   * at all and were being described as an assessment that ran short of data.
   *
   * `insufficient_data` now requires a score object that is insufficient. No
   * score object at all is `not_graded`, which is the state the enum has always
   * had a name for.
   */
  if (latest.investment_score) return toResolved(latest, 'insufficient_data');
  return toResolved(latest, 'not_graded');
}

/** What a report card should draw for the Investment Grade. */
export interface CardInvestmentGrade {
  grade: ResolvedInvestmentGrade;
  /** Whether the card draws the grade block at all. */
  show: boolean;
  /**
   * The sibling report that produced the score, when it was not this one.
   *
   * Non-null means the grade is BORROWED, and the card must say so: a
   * Financial report has not been graded, the property has.
   */
  borrowedFromReportId: string | null;
}

/**
 * The Investment Grade a report card shows, and whether it shows one.
 *
 * ## Why this is one function
 *
 * The grade is a judgement about the PROPERTY. A card resolved it from its own
 * report and then gated the render on its own `investment_score` column — two
 * separate expressions of the same idea, in different places. Only the Compass,
 * Snapshot and Briefing reports write that column, so on a property with all
 * five report types the Financial and Strategic cards showed nothing while the
 * three beside them showed a grade, which reads as two reports that failed.
 *
 * Fixing the resolution alone changes nothing, because the render gate still
 * asks the column. So resolution and the decision to draw are one answer here.
 *
 * ## The rules
 *
 * - A report with its own score always shows it.
 * - A report with none borrows the property's grade only when a sibling
 *   actually CALCULATED one — or WITHHELD one under the scoring policy, which
 *   is a decision about the property just as a grade is. A sibling that is
 *   pending, failed or ungraded is that sibling's news; repeating it on this
 *   card would report a state this report is not in.
 * - An **area-scope** report never borrows. It is about a suburb, a postcode or
 *   a state, and a property's grade is not a fact about an area.
 * - A borrowed grade is always attributable, so the card can name where it came
 *   from rather than implying this document was graded.
 */
export function resolveCardInvestmentGrade(
  // `report_scope` is declared inline rather than Pick'd from
  // `InvestmentReport`, which has never carried that field — the card reads it
  // off a row whose shape is wider than this module's type. `Pick` of an
  // absent key is a type error, and it reached main because CI builds with
  // vite (which transpiles without checking types) and runs no `tsc` step.
  report: GradeReport & { report_scope?: string | null },
  siblings?: readonly GradeReport[] | null,
): CardInvestmentGrade {
  const pool = siblings && siblings.length > 0 ? siblings : [report];
  const grade = resolveInvestmentGrade(pool);
  const ownScore = Boolean(report.investment_score);
  const isAreaScope = ['suburb', 'zipcode', 'state'].includes(report.report_scope || '');

  const borrowedFromReportId =
    grade.sourceReportId && grade.sourceReportId !== report.id ? grade.sourceReportId : null;

  return {
    grade,
    show: ownScore || ((grade.status === 'calculated' || grade.status === 'withheld') && !isAreaScope),
    borrowedFromReportId,
  };
}

export function getInvestmentGradeTone(grade?: string | null) {
  const normalizedGrade = typeof grade === 'string' ? grade.toUpperCase() : null;
  if (normalizedGrade === 'A+' || normalizedGrade === 'A') return 'bg-success text-success-foreground';
  if (normalizedGrade === 'B+' || normalizedGrade === 'B') return 'bg-warning text-warning-foreground';
  if (normalizedGrade === 'C+' || normalizedGrade === 'C') return 'bg-chart-6 text-foreground';
  if (normalizedGrade) return 'bg-destructive text-destructive-foreground';
  return 'bg-muted text-muted-foreground';
}

export function getScoreTone(score: number | null) {
  if (score == null) return 'text-muted-foreground';
  if (score >= 75) return 'text-success';
  if (score >= 55) return 'text-warning';
  return 'text-destructive';
}

export function getOverriddenFields(report: InvestmentReport | null): OverriddenField[] {
  if (!getHasOverrides(report) || !report) return [];
  const fieldMappings: Record<string, string> = {
    purchasePrice: 'Purchase Price',
    landPrice: 'Land Price',
    buildPrice: 'Build Price',
    depositValue: 'Deposit Value',
    loanToValueRatio: 'Loan to Value Ratio',
    interestRate: 'Interest Rate',
    capitalGrowth: 'Capital Growth',
    weeklyRent: 'Weekly Rent',
    stampDuty: 'Stamp Duty',
    bodyCorporateFees: 'Body Corporate/Strata Fees',
    councilRates: 'Council Rates',
    waterRates: 'Water Rates',
    solicitorFees: 'Solicitor Fees',
    buildingLandlordInsurance: 'Building & Landlord Insurance',
    propertyManagementFees: 'Property Management',
    repairsMaintenance: 'Repairs & Maintenance',
    lettingFees: 'Letting Fees',
  };
  return Object.keys(report.manual_overrides).map((key) => ({
    key,
    displayName: fieldMappings[key] || key.replace(/([A-Z])/g, ' $1').trim(),
    value: report.manual_overrides[key],
  }));
}
