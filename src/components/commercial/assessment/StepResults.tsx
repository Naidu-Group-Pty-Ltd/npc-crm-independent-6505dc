import { AlertTriangle, CheckCircle2, FileText, Info, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatMoney, formatMultiple, formatRatioPercent, toCents } from '@/lib/ciAssessment/money';
import { ReportTemplateSelector } from '@/components/reports/ReportTemplateSelector';
import { CalculationExplainer } from './CalculationExplainer';
import { ScenarioComparison } from './ScenarioComparison';
import type { AssessmentOutcome, AssessmentResult } from '@/lib/ciAssessment/engine';
import type { AssessmentPayload } from '@/lib/ciAssessment/types';

const OUTCOME_TONE: Record<AssessmentOutcome, string> = {
  indicatively_supported: 'ci-outcome-good',
  supported_subject_to_verification: 'ci-outcome-warn',
  outside_current_assumptions: 'ci-outcome-bad',
  requires_specialist_review: 'ci-outcome-warn',
  insufficient_information: 'ci-outcome-neutral',
};

function OutcomeIcon({ outcome }: { outcome: AssessmentOutcome }) {
  if (outcome === 'indicatively_supported') {
    return <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />;
  }
  if (outcome === 'outside_current_assumptions') {
    return <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />;
  }
  if (outcome === 'requires_specialist_review') {
    return <ShieldAlert className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />;
  }
  return <Info className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

function ResultCell({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="ci-result-cell">
      <dt className="ci-result-cell-label">{label}</dt>
      <dd className="ci-result-cell-value">{value}</dd>
      {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

interface Props {
  payload: AssessmentPayload;
  result: AssessmentResult;
  onRecalculate: () => void;
  onGenerateReport: () => void;
  calculating?: boolean;
  canGenerateReport: boolean;
  /** True while the server is rendering the document. */
  generatingReport?: boolean;
  /**
   * Why the report cannot be generated yet, when it cannot.
   *
   * Said in words next to the button rather than left to a disabled state. A
   * greyed-out control with no explanation is the commonest way a user decides
   * a feature is broken — and here the reason is a step they can take.
   */
  reportBlockedReason?: string | null;
}

/**
 * Step 8 — the consolidated result.
 *
 * Language discipline matters here: nothing on this screen says "approved" or
 * "pre-approved", because nothing in this tool is a lender decision. The
 * outcome vocabulary and the disclaimer both come from the engine so the screen
 * and the PDF can never drift apart.
 */
export function StepResults({
  payload, result, onRecalculate, onGenerateReport, calculating, canGenerateReport,
  generatingReport, reportBlockedReason,
}: Props) {
  const { summary, serviceability, portfolioImpact, propertyIncome, businessIncome, compliance } = result;

  const criticalWarnings = result.warnings.filter((warning) => warning.severity === 'critical');
  const otherWarnings = result.warnings.filter((warning) => warning.severity !== 'critical');

  return (
    <div className="space-y-5">
      {/* ---- Headline ------------------------------------------------- */}
      <section className={cn('ci-outcome', OUTCOME_TONE[result.outcome])}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <OutcomeIcon outcome={result.outcome} />
            <div className="min-w-0">
              <h2 className="ci-outcome-label">{result.outcomeLabel}</h2>
              <p className="ci-outcome-reason">{result.outcomeReason}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onRecalculate} disabled={calculating}>
              <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', calculating && 'animate-spin')} aria-hidden="true" />
              {calculating ? 'Recalculating…' : 'Recalculate'}
            </Button>
            <Button
              size="sm"
              onClick={onGenerateReport}
              disabled={!canGenerateReport || generatingReport}
              title={canGenerateReport ? undefined : reportBlockedReason ?? undefined}
            >
              {generatingReport
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              {generatingReport ? 'Generating…' : 'Generate report'}
            </Button>
          </div>
        </div>
        {!canGenerateReport && reportBlockedReason ? (
          <p className="mt-2 text-xs text-muted-foreground">{reportBlockedReason}</p>
        ) : null}
        {/* Beside the button that uses it: this step is where the report is
            actually produced, and the choice was previously answerable only on
            a client-modal tab behind a plan add-on. One row for the step — the
            selection is per format, and Generate report reads it wherever it
            is pressed. */}
        <ReportTemplateSelector
          reportType="commercial_capacity"
          formatLabel="Commercial & Industrial Capacity"
          className="mt-3"
        />
      </section>

      {/* ---- Headline numbers ------------------------------------------ */}
      <dl className="ci-result-grid">
        <ResultCell
          label="Maximum indicative capacity"
          value={formatMoney(toCents(summary.maximumIndicativeLoan))}
          note={`Bound by ${summary.bindingConstraint.toLowerCase()}`}
        />
        <ResultCell label="Requested loan" value={formatMoney(toCents(summary.requestedLoan))} />
        <ResultCell
          label={summary.difference >= 0 ? 'Headroom' : 'Shortfall'}
          value={formatMoney(toCents(Math.abs(summary.difference)))}
          note={summary.difference >= 0 ? 'Capacity above the request' : 'Request exceeds capacity'}
        />
        <ResultCell
          label="Required contribution"
          value={formatMoney(toCents(summary.requiredContribution))}
          note="Total project cost less indicative capacity"
        />
        <ResultCell label="Proposed LVR" value={formatRatioPercent(summary.proposedLvr)} note={`Ceiling ${(result.policy.maxLvr * 100).toFixed(1)}%`} />
        <ResultCell label="Proposed DSCR" value={formatMultiple(summary.proposedDscr)} note={`Minimum ${result.policy.minDscr.toFixed(2)}x`} />
        <ResultCell label="Proposed ICR" value={formatMultiple(summary.proposedIcr)} note={`Minimum ${result.policy.minIcr.toFixed(2)}x`} />
        <ResultCell label="Debt yield" value={formatRatioPercent(summary.debtYield, 2)} note={`Minimum ${(result.policy.minDebtYield * 100).toFixed(2)}%`} />
        <ResultCell label="Post-transaction portfolio LVR" value={formatRatioPercent(summary.postTransactionPortfolioLvr)} note={`${portfolioImpact.deltaLvr >= 0 ? '+' : ''}${(portfolioImpact.deltaLvr * 100).toFixed(2)} pts`} />
        <ResultCell label="Post-transaction portfolio DSCR" value={formatMultiple(summary.postTransactionPortfolioDscr)} />
        <ResultCell label="Monthly debt service" value={formatMoney(toCents(summary.monthlyDebtService))} note={`${formatMoney(toCents(summary.annualDebtService))} per annum`} />
        <ResultCell
          label="Surplus after debt service"
          value={formatMoney(toCents(summary.surplusAfterDebtService))}
          note={`Sensitised (+2%): ${formatMoney(serviceability.sensitisedSurplusCents)}`}
        />
      </dl>

      {/* ---- Warnings --------------------------------------------------- */}
      {criticalWarnings.length || otherWarnings.length ? (
        <section className="space-y-2" aria-label="Warnings and risk indicators">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            Risk indicators ({result.warnings.length})
          </h3>
          {criticalWarnings.map((warning) => (
            <div key={warning.message} className="ci-warning-row ci-warning-critical">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <span><span className="sr-only">Critical: </span>{warning.message}</span>
            </div>
          ))}
          {otherWarnings.map((warning) => (
            <div
              key={warning.message}
              className={cn('ci-warning-row', warning.severity === 'warning' ? 'ci-warning-warning' : 'ci-warning-info')}
            >
              {warning.severity === 'warning'
                ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
              <span>
                <span className="sr-only">{warning.severity === 'warning' ? 'Warning: ' : 'Information: '}</span>
                {warning.message}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {/* ---- Breakdown -------------------------------------------------- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold tracking-tight text-foreground">Transaction breakdown</h3>
          <dl className="space-y-1.5 text-sm">
            {result.transaction.acquisitionCostLines.map((line) => (
              <div key={line.label} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd className="font-mono tabular-nums text-foreground">{formatMoney(line.amountCents)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold">
              <dt className="text-foreground">Total project cost</dt>
              <dd className="font-mono tabular-nums text-foreground">{formatMoney(result.transaction.totalProjectCostCents)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold tracking-tight text-foreground">Servicing breakdown</h3>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Assessable business and personal income</dt>
              <dd className="font-mono tabular-nums text-foreground">{formatMoney(serviceability.assessableBusinessIncomeCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Proposed asset rent (shaded)</dt>
              <dd className="font-mono tabular-nums text-foreground">{formatMoney(serviceability.shadedProposedRentCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Portfolio rent (shaded)</dt>
              <dd className="font-mono tabular-nums text-foreground">{formatMoney(serviceability.shadedPortfolioRentCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Existing commitments</dt>
              <dd className="font-mono tabular-nums text-foreground">−{formatMoney(serviceability.existingDebtCommitmentsCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Proposed facility at assessment rate</dt>
              <dd className="font-mono tabular-nums text-foreground">−{formatMoney(serviceability.proposedDebtCommitmentCents)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold">
              <dt className="text-foreground">Surplus</dt>
              <dd className="font-mono tabular-nums text-foreground">{formatMoney(serviceability.surplusAfterDebtServiceCents)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold tracking-tight text-foreground">Portfolio impact</h3>
          <table className="w-full text-sm">
            <caption className="sr-only">Borrower position before and after the proposed transaction</caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="pb-1.5 font-semibold">Measure</th>
                <th scope="col" className="pb-1.5 text-right font-semibold">Current</th>
                <th scope="col" className="pb-1.5 text-right font-semibold">After</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              <tr className="border-t border-border/60">
                <th scope="row" className="py-1.5 text-left font-sans font-normal text-muted-foreground">Portfolio value</th>
                <td className="py-1.5 text-right">{formatMoney(portfolioImpact.current.totalValueCents)}</td>
                <td className="py-1.5 text-right">{formatMoney(portfolioImpact.proposed.totalValueCents)}</td>
              </tr>
              <tr className="border-t border-border/60">
                <th scope="row" className="py-1.5 text-left font-sans font-normal text-muted-foreground">Total debt</th>
                <td className="py-1.5 text-right">{formatMoney(portfolioImpact.current.totalDebtCents)}</td>
                <td className="py-1.5 text-right">{formatMoney(portfolioImpact.proposed.totalDebtCents)}</td>
              </tr>
              <tr className="border-t border-border/60">
                <th scope="row" className="py-1.5 text-left font-sans font-normal text-muted-foreground">Portfolio LVR</th>
                <td className="py-1.5 text-right">{formatRatioPercent(portfolioImpact.current.lvr)}</td>
                <td className="py-1.5 text-right">{formatRatioPercent(portfolioImpact.proposed.lvr)}</td>
              </tr>
              <tr className="border-t border-border/60">
                <th scope="row" className="py-1.5 text-left font-sans font-normal text-muted-foreground">Annual debt service</th>
                <td className="py-1.5 text-right">{formatMoney(portfolioImpact.current.annualDebtServiceCents)}</td>
                <td className="py-1.5 text-right">{formatMoney(portfolioImpact.proposed.annualDebtServiceCents)}</td>
              </tr>
              <tr className="border-t border-border/60">
                <th scope="row" className="py-1.5 text-left font-sans font-normal text-muted-foreground">Net cash flow</th>
                <td className="py-1.5 text-right">{formatMoney(portfolioImpact.current.netCashFlowCents)}</td>
                <td className="py-1.5 text-right">{formatMoney(portfolioImpact.proposed.netCashFlowCents)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2.5 text-xs leading-5 text-muted-foreground">
            The transaction {portfolioImpact.direction === 'improves' ? 'improves' : portfolioImpact.direction === 'weakens' ? 'weakens' : 'has a mixed effect on'} the
            borrower&apos;s position: annual cash flow changes by {formatMoney(portfolioImpact.deltaAnnualCashFlowCents)} and
            portfolio LVR by {(portfolioImpact.deltaLvr * 100).toFixed(2)} percentage points.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold tracking-tight text-foreground">Property and business income</h3>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Net operating income</dt>
              <dd className="font-mono tabular-nums text-foreground">{formatMoney(propertyIncome.netOperatingIncomeCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Capitalisation rate</dt>
              <dd className="font-mono tabular-nums text-foreground">{formatRatioPercent(propertyIncome.capitalisationRate, 2)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Break-even occupancy</dt>
              <dd className="font-mono tabular-nums text-foreground">{formatRatioPercent(propertyIncome.breakEvenOccupancy)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">WALE</dt>
              <dd className="font-mono tabular-nums text-foreground">{propertyIncome.wale > 0 ? `${propertyIncome.wale.toFixed(1)} yrs` : '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Adjusted EBITDA</dt>
              <dd className="font-mono tabular-nums text-foreground">{formatMoney(businessIncome.adjustedEbitdaCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Debt to EBITDA</dt>
              <dd className="font-mono tabular-nums text-foreground">{result.debtToEbitda != null ? `${result.debtToEbitda.toFixed(2)}x` : '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Income verification</dt>
              <dd className="font-sans text-foreground">{businessIncome.verificationStatus.replace(/_/g, ' ')}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ---- Compliance -------------------------------------------------- */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold tracking-tight text-foreground">Compliance classification</h3>
        <p className="text-sm text-foreground">{compliance.classificationLabel}</p>
        {compliance.flags.length ? (
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {compliance.flags.map((flag) => (
              <li key={flag.code}>
                <span className="font-medium text-foreground">{flag.message}</span> {flag.action}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No compliance flags raised.</p>
        )}
      </section>

      {/* ---- Missing evidence and next actions ---------------------------- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold tracking-tight text-foreground">Outstanding information</h3>
          {result.missing.length ? (
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {result.missing.map((item) => (
                <li key={item.field}>
                  {item.label}
                  {item.blocksCalculation ? <span className="ml-1.5 font-medium text-destructive">(required)</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold tracking-tight text-foreground">Recommended next actions</h3>
          <ol className="space-y-1.5 text-sm text-muted-foreground">
            {result.nextActions.map((action) => <li key={action}>{action}</li>)}
          </ol>
        </div>
      </section>

      <ScenarioComparison payload={payload} />

      <CalculationExplainer result={result} />

      <p className="ci-disclaimer">{result.disclaimer}</p>
    </div>
  );
}
