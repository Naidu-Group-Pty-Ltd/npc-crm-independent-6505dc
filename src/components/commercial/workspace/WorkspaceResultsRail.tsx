/**
 * The live outcome rail.
 *
 * One rail, showing both halves of the analysis — what will lend, and what it
 * returns — plus the one thing the old page never stated anywhere: whether
 * what is on screen is the *saved* position or a working one that has moved
 * since. That distinction is the difference between a number you can put in
 * front of a client and a number you are still editing.
 *
 * Deliberately short. Six figures and a state, not every metric the engines
 * produce; the results stage is one click away and is where the whole picture
 * belongs.
 */

import { AlertTriangle, ArrowRight, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatMoney, formatMultiple, formatRatioPercent, toCents } from '@/lib/ciAssessment/money';
import type { AssessmentResult } from '@/lib/ciAssessment/engine';
import type { AnalysisResult } from '@/lib/ciAssessment/analysisEngine';
import type { WorkspaceReadiness } from '@/lib/ciAssessment/workspaceReadiness';

export type CalculationState = 'live' | 'saved' | 'out_of_date';

const STATE_COPY: Record<CalculationState, { label: string; note: string }> = {
  live: {
    label: 'Live working figures',
    note: 'Recomputed as you type. Run the calculation to save them.',
  },
  saved: {
    label: 'Saved calculation',
    note: 'These are the figures the report will state.',
  },
  out_of_date: {
    label: 'Out of date',
    note: 'The inputs have changed since the saved calculation. Run it again.',
  },
};

export function WorkspaceResultsRail({
  result, analysis, readiness, calculationState, onJumpToResults,
}: {
  result: AssessmentResult;
  analysis: AnalysisResult;
  readiness: WorkspaceReadiness;
  calculationState: CalculationState;
  onJumpToResults: () => void;
}) {
  const { summary } = result;
  const critical = result.warnings.filter((warning) => warning.severity === 'critical');
  const state = STATE_COPY[calculationState];

  const tone = result.outcome === 'indicatively_supported' ? 'ci-outcome-good'
    : result.outcome === 'outside_current_assumptions' ? 'ci-outcome-bad'
      : result.outcome === 'insufficient_information' ? 'ci-outcome-neutral'
        : 'ci-outcome-warn';

  return (
    <aside className="ci-workspace-rail" aria-label="Live analysis outcome">
      <section className={cn('ci-outcome', tone)}>
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Live position
        </p>
        <div className="mt-1.5 flex items-start gap-2">
          {result.outcome === 'indicatively_supported'
            ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            : result.outcome === 'outside_current_assumptions'
              ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              : result.outcome === 'requires_specialist_review'
                ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                : <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <p className="text-sm font-semibold leading-5 text-foreground">{result.outcomeLabel}</p>
        </div>
        {/* Which numbers these are. Stated in words rather than by colour. */}
        <p className="mt-2 text-xs font-medium text-foreground">{state.label}</p>
        <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{state.note}</p>
      </section>

      <dl className="space-y-px overflow-hidden rounded-lg border border-border bg-border">
        <div className="bg-card px-3 py-2.5">
          <dt className="ci-result-cell-label">Indicative capacity</dt>
          <dd className="ci-result-cell-value">{formatMoney(toCents(summary.maximumIndicativeLoan))}</dd>
          <p className="mt-0.5 text-xs text-muted-foreground">Bound by {summary.bindingConstraint.toLowerCase()}</p>
        </div>
        <div className="bg-card px-3 py-2.5">
          <dt className="ci-result-cell-label">Requested</dt>
          <dd className="ci-result-cell-value">{formatMoney(toCents(summary.requestedLoan))}</dd>
          <p className={cn('mt-0.5 text-xs', summary.difference >= 0 ? 'text-success' : 'text-destructive')}>
            {summary.difference >= 0 ? 'Headroom ' : 'Shortfall '}
            {formatMoney(toCents(Math.abs(summary.difference)))}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-px bg-border">
          <div className="bg-card px-3 py-2.5">
            <dt className="ci-result-cell-label">LVR</dt>
            <dd className="ci-result-cell-value">{formatRatioPercent(summary.proposedLvr)}</dd>
          </div>
          <div className="bg-card px-3 py-2.5">
            <dt className="ci-result-cell-label">DSCR</dt>
            <dd className="ci-result-cell-value">{formatMultiple(summary.proposedDscr)}</dd>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-border">
          <div className="bg-card px-3 py-2.5">
            <dt className="ci-result-cell-label">Passing yield</dt>
            <dd className="ci-result-cell-value">
              {analysis.valuation?.passingYield != null ? `${analysis.valuation.passingYield.toFixed(2)}%` : '—'}
            </dd>
          </div>
          <div className="bg-card px-3 py-2.5">
            <dt className="ci-result-cell-label">Levered IRR</dt>
            <dd className="ci-result-cell-value">
              {/* Already a percentage from the engine — see ForecastStage. */}
              {analysis.forecast?.leveredIrr != null
                ? `${analysis.forecast.leveredIrr.toFixed(1)}%`
                : '—'}
            </dd>
          </div>
        </div>
      </dl>

      <section
        className={cn(
          'rounded-lg border px-3 py-2.5',
          readiness.canGenerate && !readiness.warnings.length
            ? 'border-success/40 bg-success/5'
            : readiness.canGenerate ? 'border-warning/40 bg-warning/5' : 'border-border bg-card',
        )}
      >
        <p className="ci-result-cell-label">Report readiness</p>
        <p className="mt-0.5 text-sm font-semibold text-foreground">{readiness.headline}</p>
        {critical.length ? (
          <p className="mt-1 text-xs text-destructive">
            {critical.length} critical warning{critical.length === 1 ? '' : 's'} on the position
          </p>
        ) : null}
      </section>

      <Button variant="outline" size="sm" className="w-full" onClick={onJumpToResults}>
        View full results <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </aside>
  );
}
