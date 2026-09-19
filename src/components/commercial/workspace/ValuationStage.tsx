/**
 * Valuation — what the asset is worth on the income it produces.
 *
 * The assumptions are four fields; everything else on this stage is derived
 * and read-only, because a yield is not a thing you type. The cap-rate engine
 * that computes it is the same one the standalone card used — what changed is
 * where it reads its inputs from. Net operating income comes from the lending
 * engine's result for this same payload, so the number here and the number in
 * the results rail cannot differ.
 */

import { FieldGroup, PercentField, SelectField, DerivedValue } from '@/components/commercial/assessment/AssessmentFields';
import { formatMoney, formatRatioPercent, toCents } from '@/lib/ciAssessment/money';
import { analysisOf, withAnalysis, type ValuationBasis } from '@/lib/ciAssessment/analysis';
import type { AnalysisResult } from '@/lib/ciAssessment/analysisEngine';
import type { AssessmentPayload } from '@/lib/ciAssessment/types';
import { AlertCircle } from 'lucide-react';

const BASIS_OPTIONS: ReadonlyArray<{ value: ValuationBasis; label: string }> = [
  { value: 'passing', label: 'Passing income' },
  { value: 'market', label: 'Market income' },
  { value: 'stabilised', label: 'Stabilised income' },
  { value: 'lenderAdjusted', label: 'Lender-adjusted income' },
];

interface Props {
  payload: AssessmentPayload;
  analysis: AnalysisResult;
  onChange: (next: AssessmentPayload) => void;
  disabled?: boolean;
}

export function ValuationStage({ payload, analysis, onChange, disabled }: Props) {
  const assumptions = analysisOf(payload).valuation;
  const set = (patch: Partial<typeof assumptions>) => onChange(withAnalysis(payload, 'valuation', patch));
  const valuation = analysis.valuation;

  return (
    <div className="ci-step-panel">
      <h2 className="ci-step-heading">Valuation</h2>
      <p className="ci-step-description">
        The yield the property is being bought on, and what the same income is worth at the rate you
        consider market. Income comes from the lease stage — change it there and every figure here moves.
      </p>

      {analysis.missing.valuation.length ? (
        <div className="ci-warning-row ci-warning-info" role="status">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-semibold text-foreground">This valuation is incomplete</p>
            <ul className="mt-1 space-y-0.5 text-sm">
              {analysis.missing.valuation.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>
      ) : null}

      <FieldGroup title="Rate assumptions" description="What the market is paying for this income.">
        <PercentField
          label="Target capitalisation rate"
          value={assumptions.targetCapRatePct}
          onChange={(value) => set({ targetCapRatePct: value })}
          disabled={disabled}
          help="The rate you consider market for this asset. Used to value the income."
        />
        <SelectField
          label="Valuation basis"
          value={assumptions.valuationBasis}
          options={BASIS_OPTIONS}
          onChange={(value) => set({ valuationBasis: value })}
          disabled={disabled}
          help="Which income the value is struck on."
        />
        <PercentField
          label="Comparable range — low"
          value={assumptions.benchmarkLowPct}
          onChange={(value) => set({ benchmarkLowPct: value })}
          disabled={disabled}
          help="Evidence range. A rate outside it is flagged rather than blocked."
        />
        <PercentField
          label="Comparable range — high"
          value={assumptions.benchmarkHighPct}
          onChange={(value) => set({ benchmarkHighPct: value })}
          disabled={disabled}
        />
      </FieldGroup>

      <FieldGroup title="Derived" description="Computed from this analysis. Nothing here is typed.">
        <DerivedValue
          label="Passing yield"
          value={valuation?.passingYield != null ? `${valuation.passingYield.toFixed(2)}%` : '—'}
          note="Net operating income over the price paid."
        />
        <DerivedValue
          label="Value at target rate"
          value={valuation?.impliedValue != null ? formatMoney(toCents(valuation.impliedValue)) : '—'}
          note="The same income capitalised at the target rate."
        />
        <DerivedValue
          label="Difference to price"
          value={valuation?.valuationGap != null ? formatMoney(toCents(valuation.valuationGap)) : '—'}
          tone={valuation?.valuationGap == null ? 'neutral' : valuation.valuationGap >= 0 ? 'good' : 'warn'}
          // The engine returns this as a ratio, not a percentage — 0.28 means
          // 28%. Printing it directly showed a $1.4m gap on a $5m asset as
          // "0.3% of price".
          note={valuation?.valuationGapPct != null ? `${(valuation.valuationGapPct * 100).toFixed(1)}% of price` : undefined}
        />
        <DerivedValue
          label="Net operating income"
          value={valuation?.selectedNoi != null ? formatMoney(toCents(valuation.selectedNoi)) : '—'}
          note="From the income and lease stage."
        />
      </FieldGroup>

      {valuation?.valueSensitivity?.length ? (
        <section className="mt-4">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Value at other rates</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            The same income, capitalised across the range around your target rate.
          </p>
          <div className="ci-table-wrap mt-2" role="region" aria-label="Valuation sensitivity" tabIndex={0}>
            <table className="ci-scenario-table">
              <thead>
                <tr>
                  <th scope="col">Capitalisation rate</th>
                  <th scope="col" className="text-right">Value</th>
                  <th scope="col" className="text-right">Against price</th>
                </tr>
              </thead>
              <tbody>
                {valuation.valueSensitivity.map((row) => {
                  const price = payload.property.purchasePrice || payload.property.currentValuation;
                  const delta = row.impliedValue != null && price ? row.impliedValue - price : null;
                  return (
                    <tr key={row.capRatePct}>
                      <th scope="row">{row.capRatePct.toFixed(2)}%</th>
                      <td className="text-right font-mono tabular-nums">
                        {row.impliedValue != null ? formatMoney(toCents(row.impliedValue)) : '—'}
                      </td>
                      <td className="text-right font-mono tabular-nums">
                        {delta != null ? formatMoney(toCents(delta)) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {valuation?.warnings?.length ? (
        <div className="ci-warning-row ci-warning-warning mt-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <ul className="space-y-0.5 text-sm">
            {valuation.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      {payload.property.classification === 'industrial' ? (
        <FieldGroup
          title="Site metrics"
          description="What makes this building comparable to another industrial building."
        >
          <DerivedValue
            label="Rent per m²"
            value={analysis.industrial.rentPerSqm != null ? `$${analysis.industrial.rentPerSqm.toLocaleString('en-AU')}` : '—'}
            note="Passing rent over lettable area."
          />
          <DerivedValue
            label="Price per m²"
            value={analysis.industrial.pricePerSqm != null ? `$${analysis.industrial.pricePerSqm.toLocaleString('en-AU')}` : '—'}
          />
          <DerivedValue
            label="Site cover"
            value={analysis.industrial.sitePercentCovered != null ? `${analysis.industrial.sitePercentCovered}%` : '—'}
            note="Building footprint over site area."
          />
          <DerivedValue
            label="Office ratio"
            value={analysis.industrial.officeRatioPct != null ? `${analysis.industrial.officeRatioPct}%` : '—'}
          />
        </FieldGroup>
      ) : null}
    </div>
  );
}
