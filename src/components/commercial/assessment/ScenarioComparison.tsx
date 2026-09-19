import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney, formatMultiple, formatRatioPercent, toCents } from '@/lib/ciAssessment/money';
import { DEFAULT_SCENARIO_PARAMETERS, buildScenarioDefinitions, runScenarios, type ScenarioKey } from '@/lib/ciAssessment/scenarios';
import type { AssessmentPayload } from '@/lib/ciAssessment/types';

const DEFAULT_SELECTION: ScenarioKey[] = ['higher_rate', 'lower_rent', 'vacancy', 'valuation_reduction'];

function Delta({ value, format }: { value: number; format: (value: number) => string }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="h-3 w-3" aria-hidden="true" />
        <span className="sr-only">No change</span>
        —
      </span>
    );
  }
  const positive = value > 0;
  return (
    <span className={cn('inline-flex items-center gap-1', positive ? 'ci-delta-up' : 'ci-delta-down')}>
      {positive
        ? <ArrowUp className="h-3 w-3" aria-hidden="true" />
        : <ArrowDown className="h-3 w-3" aria-hidden="true" />}
      <span className="sr-only">{positive ? 'Increase of' : 'Decrease of'}</span>
      {format(Math.abs(value))}
    </span>
  );
}

/**
 * Side-by-side stress testing.
 *
 * Scenarios are derived from the base payload on demand rather than stored as
 * duplicate assessments, which is what lets the table state the single
 * assumption that moved in each column.
 */
export function ScenarioComparison({ payload }: { payload: AssessmentPayload }) {
  const [selected, setSelected] = useState<ScenarioKey[]>(DEFAULT_SELECTION);

  const available = useMemo(
    () => buildScenarioDefinitions(DEFAULT_SCENARIO_PARAMETERS).filter((definition) => definition.key !== 'base'),
    [],
  );

  const outcomes = useMemo(() => runScenarios(payload, selected), [payload, selected]);

  const toggle = (key: ScenarioKey) => {
    setSelected((current) => (
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
    ));
  };

  return (
    <section className="space-y-4" aria-label="Scenario comparison">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Scenarios and stress tests</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each column changes exactly one assumption against the base case.
          </p>
        </div>
        {selected.length ? (
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear all</Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setSelected(DEFAULT_SELECTION)}>Restore defaults</Button>
        )}
      </div>

      <fieldset className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/20 p-3">
        <legend className="sr-only">Scenarios to compare</legend>
        {available.map((definition) => (
          <div key={definition.key} className="flex items-center gap-2">
            <Checkbox
              id={`scenario-${definition.key}`}
              checked={selected.includes(definition.key)}
              onCheckedChange={() => toggle(definition.key)}
            />
            <Label htmlFor={`scenario-${definition.key}`} className="cursor-pointer text-xs font-medium text-foreground">
              {definition.label}
            </Label>
          </div>
        ))}
      </fieldset>

      <div className="ci-table-wrap" tabIndex={0} role="region" aria-label="Scenario results">
        <table className="ci-scenario-table">
          <caption className="sr-only">
            Indicative capacity, coverage and cash flow for the base case and each selected stress scenario.
          </caption>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Assumption changed</th>
              <th scope="col">Max indicative loan</th>
              <th scope="col">vs base</th>
              <th scope="col">LVR</th>
              <th scope="col">DSCR</th>
              <th scope="col">ICR</th>
              <th scope="col">Annual debt service</th>
              <th scope="col">Funding gap</th>
              <th scope="col">Binding constraint</th>
              <th scope="col">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map((outcome) => (
              <tr key={outcome.key} className={outcome.key === 'base' ? 'ci-scenario-base' : undefined}>
                <th scope="row" className="whitespace-nowrap px-3 py-2.5 text-left font-semibold text-foreground">
                  {outcome.label}
                </th>
                <td className="max-w-xs whitespace-normal text-xs text-muted-foreground">
                  {outcome.changedAssumption}
                </td>
                <td className="font-semibold">{formatMoney(toCents(outcome.comparison.maximumIndicativeLoan))}</td>
                <td>
                  {outcome.key === 'base'
                    ? <span className="text-muted-foreground">—</span>
                    : <Delta value={outcome.comparison.deltaMaximumLoan} format={(value) => formatMoney(toCents(value), { compact: true })} />}
                </td>
                <td>{formatRatioPercent(outcome.comparison.lvr)}</td>
                <td>{formatMultiple(outcome.comparison.dscr)}</td>
                <td>{formatMultiple(outcome.comparison.icr)}</td>
                <td>{formatMoney(toCents(outcome.comparison.annualDebtService))}</td>
                <td>{outcome.comparison.fundingGap > 0 ? formatMoney(toCents(outcome.comparison.fundingGap)) : '—'}</td>
                <td className="text-xs">{outcome.comparison.bindingConstraint}</td>
                <td className="whitespace-normal text-xs">{outcome.comparison.outcomeLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {outcomes.some((outcome) => outcome.keyWarnings.length) ? (
        <div className="space-y-2">
          {outcomes
            .filter((outcome) => outcome.key !== 'base' && outcome.keyWarnings.length)
            .map((outcome) => (
              <div key={outcome.key} className="ci-warning-row ci-warning-warning">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{outcome.label}</p>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {outcome.keyWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </div>
              </div>
            ))}
        </div>
      ) : null}
    </section>
  );
}
