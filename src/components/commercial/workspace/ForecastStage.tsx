/**
 * Forecast — what holding the asset returns.
 *
 * A discounted cash flow over the hold period, run by `dcfEngine` from the
 * canonical payload: the price and acquisition costs from the property stage,
 * the net operating income from the income stage, and the loan, rate and term
 * from the lending stage. The only things typed here are the assumptions that
 * are genuinely assumptions — growth, exit rate, discount rate, capex.
 *
 * The old ten-year card asked for all of those *again*, in its own copy of the
 * deal, which is how a forecast could be run against a loan the assessment did
 * not propose. There is nowhere to type a second loan amount on this stage,
 * deliberately.
 */

import { AlertCircle } from 'lucide-react';
import { FieldGroup, MoneyField, NumberField, PercentField, DerivedValue } from '@/components/commercial/assessment/AssessmentFields';
import { formatMoney, toCents } from '@/lib/ciAssessment/money';
import { analysisOf, withAnalysis } from '@/lib/ciAssessment/analysis';
import type { AnalysisResult } from '@/lib/ciAssessment/analysisEngine';
import type { AssessmentPayload } from '@/lib/ciAssessment/types';

interface Props {
  payload: AssessmentPayload;
  analysis: AnalysisResult;
  onChange: (next: AssessmentPayload) => void;
  disabled?: boolean;
}

/**
 * `dcfEngine` returns internal rates of return already scaled to percent —
 * 15.21 means 15.21%. Multiplying again turned a healthy return into 1521%,
 * which is why this is one function rather than an inline expression per call
 * site.
 */
const formatIrr = (value: number | null | undefined) => (
  value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`
);

export function ForecastStage({ payload, analysis, onChange, disabled }: Props) {
  const assumptions = analysisOf(payload).forecast;
  const set = (patch: Partial<typeof assumptions>) => onChange(withAnalysis(payload, 'forecast', patch));
  const forecast = analysis.forecast;

  return (
    <div className="ci-step-panel">
      <h2 className="ci-step-heading">Forecast</h2>
      <p className="ci-step-description">
        The hold period, modelled year by year. The price, income, loan and rate come from the earlier
        stages — what you set here is what nobody can know: growth, the rate the asset is sold at, and
        the rate future money is discounted at.
      </p>

      {analysis.missing.forecast.length ? (
        <div className="ci-warning-row ci-warning-info" role="status">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold text-foreground">The forecast cannot run yet</p>
            <ul className="mt-1 space-y-0.5 text-sm">
              {analysis.missing.forecast.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      ) : null}

      <FieldGroup title="Hold and growth">
        <NumberField
          label="Hold period (years)"
          value={assumptions.holdPeriodYears}
          onChange={(value) => set({ holdPeriodYears: value })}
          disabled={disabled}
          help="How long the asset is modelled as being held."
        />
        <PercentField
          label="Rental growth per year"
          value={assumptions.rentalGrowthPct}
          onChange={(value) => set({ rentalGrowthPct: value })}
          disabled={disabled}
          help="Compounding. Left at zero the model holds income flat, which is the conservative case."
        />
        <PercentField
          label="Vacancy allowance"
          value={assumptions.vacancyAllowancePct}
          onChange={(value) => set({ vacancyAllowancePct: value })}
          disabled={disabled}
          help="Applied to each year's income as a structural haircut."
        />
        <MoneyField
          label="Capital expenditure per year"
          value={assumptions.annualCapex}
          onChange={(value) => set({ annualCapex: value })}
          disabled={disabled}
          help="Recurring capital works, deducted before cash flow."
        />
      </FieldGroup>

      <FieldGroup title="Exit and discounting">
        <PercentField
          label="Exit capitalisation rate"
          value={assumptions.terminalCapRatePct}
          onChange={(value) => set({ terminalCapRatePct: value })}
          disabled={disabled}
          help="The rate the asset is assumed to sell at. Terminal value is the final year's income at this rate."
        />
        <PercentField
          label="Selling costs"
          value={assumptions.sellingCostsPct}
          onChange={(value) => set({ sellingCostsPct: value })}
          disabled={disabled}
          help="Agent and legal costs, as a percentage of the sale."
        />
        <PercentField
          label="Discount rate"
          value={assumptions.discountRatePct}
          onChange={(value) => set({ discountRatePct: value })}
          disabled={disabled}
          help="Required return. Used for net present value, not for the internal rate of return."
        />
      </FieldGroup>

      <FieldGroup title="Returns" description="Derived from the model. Nothing here is typed.">
        <DerivedValue
          label="Levered IRR"
          value={formatIrr(forecast?.leveredIrr)}
          tone={forecast?.leveredIrr == null ? 'neutral' : forecast.leveredIrr > 0 ? 'good' : 'warn'}
          note="Return on the equity actually invested, after debt."
        />
        <DerivedValue
          label="Unlevered IRR"
          value={formatIrr(forecast?.unleveredIrr)}
          note="Return on the asset, ignoring debt."
        />
        <DerivedValue
          label="Equity multiple"
          value={forecast ? `${forecast.equityMultiple.toFixed(2)}x` : '—'}
          note="Total equity returned over equity invested."
        />
        <DerivedValue
          label="Net present value (levered)"
          value={forecast ? formatMoney(toCents(Math.round(forecast.leveredNpv))) : '—'}
          tone={forecast == null ? 'neutral' : forecast.leveredNpv >= 0 ? 'good' : 'bad'}
          note="At the discount rate above."
        />
        <DerivedValue
          label="Terminal value"
          value={forecast ? formatMoney(toCents(Math.round(forecast.terminalValue))) : '—'}
          note="Final year income at the exit rate."
        />
        <DerivedValue
          label="Net sale proceeds"
          value={forecast ? formatMoney(toCents(Math.round(forecast.netSaleProceeds))) : '—'}
          note="After selling costs and the loan balance at sale."
        />
      </FieldGroup>

      {forecast?.rows?.length ? (
        <section className="mt-4">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Year by year</h3>
          <div className="ci-table-wrap mt-2" role="region" aria-label="Forecast cash flow by year" tabIndex={0}>
            <table className="ci-scenario-table">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col" className="text-right">Net income</th>
                  <th scope="col" className="text-right">Capex</th>
                  <th scope="col" className="text-right">Debt service</th>
                  <th scope="col" className="text-right">Cash flow</th>
                  <th scope="col" className="text-right">Loan balance</th>
                </tr>
              </thead>
              <tbody>
                {forecast.rows.map((row) => (
                  <tr key={row.year}>
                    <th scope="row">{row.year}</th>
                    <td className="text-right font-mono tabular-nums">{formatMoney(toCents(Math.round(row.noi)))}</td>
                    <td className="text-right font-mono tabular-nums">{formatMoney(toCents(Math.round(row.capex)))}</td>
                    <td className="text-right font-mono tabular-nums">{formatMoney(toCents(Math.round(row.debtService)))}</td>
                    <td className="text-right font-mono tabular-nums">{formatMoney(toCents(Math.round(row.leveredCf)))}</td>
                    <td className="text-right font-mono tabular-nums">{formatMoney(toCents(Math.round(row.loanBalance)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
