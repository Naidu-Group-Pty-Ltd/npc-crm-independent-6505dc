import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney, formatMultiple, formatRatioPercent, toCents } from '@/lib/ciAssessment/money';
import type { AssessmentResult } from '@/lib/ciAssessment/engine';

/**
 * The always-visible summary rail.
 *
 * Recomputed live from the working payload, so a user changing a rate on step
 * seven sees capacity and the binding constraint move without leaving the
 * field. Sticky on desktop; a plain block below `lg`, where a pinned column
 * would take a third of the viewport.
 */
export function ResultsRail({
  result, onJumpToResults,
}: {
  result: AssessmentResult;
  onJumpToResults: () => void;
}) {
  const { summary, serviceability } = result;
  const critical = result.warnings.filter((warning) => warning.severity === 'critical');
  const warnings = result.warnings.filter((warning) => warning.severity === 'warning');

  const tone = result.outcome === 'indicatively_supported' ? 'ci-outcome-good'
    : result.outcome === 'outside_current_assumptions' ? 'ci-outcome-bad'
      : result.outcome === 'insufficient_information' ? 'ci-outcome-neutral'
        : 'ci-outcome-warn';

  return (
    <aside className="ci-workspace-rail" aria-label="Live assessment summary">
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
      </section>

      <dl className="space-y-px overflow-hidden rounded-lg border border-border bg-border">
        <div className="bg-card px-3 py-2.5">
          <dt className="ci-result-cell-label">Maximum indicative capacity</dt>
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
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{formatRatioPercent(summary.proposedLvr)}</dd>
          </div>
          <div className="bg-card px-3 py-2.5">
            <dt className="ci-result-cell-label">DSCR</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{formatMultiple(summary.proposedDscr)}</dd>
          </div>
          <div className="bg-card px-3 py-2.5">
            <dt className="ci-result-cell-label">ICR</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{formatMultiple(summary.proposedIcr)}</dd>
          </div>
          <div className="bg-card px-3 py-2.5">
            <dt className="ci-result-cell-label">Debt yield</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums text-foreground">{formatRatioPercent(summary.debtYield, 2)}</dd>
          </div>
        </div>
        <div className="bg-card px-3 py-2.5">
          <dt className="ci-result-cell-label">Surplus after debt service</dt>
          <dd className={cn(
            'mt-0.5 text-base font-semibold tabular-nums',
            serviceability.surplusAfterDebtServiceCents < 0 ? 'text-destructive' : 'text-foreground',
          )}>
            {formatMoney(serviceability.surplusAfterDebtServiceCents)}
          </dd>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Sensitised (+2%): {formatMoney(serviceability.sensitisedSurplusCents)}
          </p>
        </div>
      </dl>

      {critical.length || warnings.length ? (
        <section className="rounded-lg border border-border bg-card p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Attention ({critical.length + warnings.length})
          </h3>
          <ul className="mt-2 space-y-1.5 text-xs leading-5">
            {[...critical, ...warnings].slice(0, 4).map((warning) => (
              <li key={warning.message} className="flex items-start gap-1.5">
                <AlertTriangle
                  className={cn('mt-0.5 h-3 w-3 shrink-0', warning.severity === 'critical' ? 'text-destructive' : 'text-warning')}
                  aria-hidden="true"
                />
                <span className="text-muted-foreground">{warning.message}</span>
              </li>
            ))}
          </ul>
          {critical.length + warnings.length > 4 ? (
            <button
              type="button"
              onClick={onJumpToResults}
              className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View all {critical.length + warnings.length} on the results step
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Next action</h3>
        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{result.nextActions[0]}</p>
      </section>
    </aside>
  );
}
