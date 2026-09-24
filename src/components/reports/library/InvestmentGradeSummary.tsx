import { useId } from 'react';
import { Sparkles } from 'lucide-react';
import { getInvestmentGradeTone, getScoreTone, type ResolvedInvestmentGrade } from '@/components/reports/report-view/utils';

interface InvestmentGradeSummaryProps {
  grade: ResolvedInvestmentGrade;
  variant?: 'compact' | 'full';
  /**
   * Set where this summary is shown against a report that did not itself
   * produce the score. The Investment Grade is a judgement about the
   * PROPERTY, so every report for that property shows it — but a Financial
   * or Strategic report must not appear to have been graded when the score
   * came from the Compass assessment beside it.
   */
  sourceLabel?: string | null;
}

const statusContent = (grade: ResolvedInvestmentGrade) => {
  switch (grade.status) {
    case 'pending': return { value: 'Score pending', detail: 'The latest report is still calculating its investment score.', tone: 'text-muted-foreground' };
    // The run decided not to publish a grade — the scoring policy's own
    // reading, said in the same words the report page uses. Never a dash
    // alone: a withheld grade and a report nobody graded are different news.
    case 'withheld': return { value: 'Grade withheld', detail: grade.withheld?.statement || grade.partialLabel || 'The scoring policy withheld an overall grade for this report.', tone: 'text-muted-foreground' };
    case 'insufficient_data': return { value: 'Insufficient data', detail: grade.partialLabel || 'Additional property or market data is required to calculate a numeric score.', tone: 'text-muted-foreground' };
    case 'failed': return { value: 'Unable to calculate', detail: 'The investment score could not be calculated.', tone: 'text-destructive' };
    case 'not_graded': return { value: 'Not graded', detail: 'No investment score is available for this report.', tone: 'text-muted-foreground' };
    default: return null;
  }
};

/** Shared presentation for the persisted Investment Grade shown in report and package cards. */
export function InvestmentGradeSummary({ grade, variant = 'full', sourceLabel = null }: InvestmentGradeSummaryProps) {
  const helpId = useId();
  const status = statusContent(grade);
  const label = `Investment Grade${grade.status === 'calculated' ? ` ${grade.grade || 'available'}${grade.score != null ? `, score ${grade.score} out of 100` : ''}` : ` ${status?.value || 'unavailable'}`}`;
  const recommendation = grade.recommendation || 'Score calculated from market, financial & location data';

  return (
    <section className={`rounded-2xl border border-border/70 bg-gradient-to-br from-background via-muted/25 to-background shadow-inner shadow-sm dark:shadow-black/5 ${variant === 'compact' ? 'mt-3 p-3' : 'p-3'}`} aria-label={label} aria-describedby={helpId}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex shrink-0 items-center justify-center rounded-2xl font-bold shadow-sm ${variant === 'compact' ? 'h-11 w-11 text-base' : 'h-14 w-14 text-xl'} ${getInvestmentGradeTone(grade.status === 'calculated' ? grade.grade : null)}`} aria-hidden="true">
            {grade.status === 'calculated' ? grade.grade || '—' : '—'}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground" title="Investment Grade reflects the latest available property scoring assessment.">
              <Sparkles className="h-3 w-3 text-brand-500" aria-hidden="true" />
              Investment Grade
            </div>
            <p className="mt-1 line-clamp-1 text-sm font-semibold text-foreground">{status ? status.value : recommendation}</p>
            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{status ? status.detail : (grade.partialLabel || 'Latest available property scoring assessment')}</p>
            {/* The letter follows the score (eligibility 5.0.0); what the evidence can carry is said beside it. */}
            {!status && grade.evidenceCaution && (
              <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground" title={grade.evidenceCaution}>{grade.evidenceCaution}</p>
            )}
            {sourceLabel && (
              <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground/80">From the {sourceLabel} assessment for this property</p>
            )}
          </div>
        </div>
        {grade.status === 'calculated' && grade.score != null ? (
          <div className="shrink-0 text-right"><div className={`text-2xl font-bold tracking-tight ${getScoreTone(grade.score)}`}>{grade.score}</div><div className="text-xs text-muted-foreground">/100 score</div></div>
        ) : null}
      </div>
      <span id={helpId} className="sr-only">Investment Grade reflects the latest available property scoring assessment.</span>
    </section>
  );
}
