import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, TrendingDown, TrendingUp, AlertCircle } from 'lucide-react';
import {
  AdvancedSection, DerivedValue, FieldGroup, MoneyField, SelectField,
  SwitchField, TextAreaField, TextField, DateField,
} from './AssessmentFields';
import { calculateBusinessIncome, isAddbackAssessable } from '@/lib/ciAssessment/businessIncome';
import { resolvePolicy } from '@/lib/ciAssessment/policy';
import { formatMoney, formatRatioPercent } from '@/lib/ciAssessment/money';
import type { Addback, AddbackCategory, AssessmentPayload, IncomePeriod } from '@/lib/ciAssessment/types';
import type { ValidationIssue } from '@/lib/ciAssessment/validation';

const PERIOD_BASIS = [
  { value: 'financial_statements' as const, label: 'Accountant-prepared financial statements' },
  { value: 'tax_return' as const, label: 'Tax return' },
  { value: 'notice_of_assessment' as const, label: 'Notice of assessment' },
  { value: 'management_accounts' as const, label: 'Management accounts' },
  { value: 'ytd' as const, label: 'Year to date' },
  { value: 'projection' as const, label: 'Projection' },
];

const VERIFICATION = [
  { value: 'unverified' as const, label: 'Not verified' },
  { value: 'documents_held' as const, label: 'Documents held, not checked' },
  { value: 'verified' as const, label: 'Verified' },
];

const ADDBACK_CATEGORIES: ReadonlyArray<{ value: AddbackCategory; label: string }> = [
  { value: 'depreciation', label: 'Depreciation' },
  { value: 'interest', label: 'Interest' },
  { value: 'director_remuneration', label: 'Director remuneration' },
  { value: 'one_off', label: 'One-off / non-recurring' },
  { value: 'non_cash', label: 'Non-cash' },
  { value: 'rent_to_related_party', label: 'Rent to a related party' },
  { value: 'superannuation', label: 'Superannuation' },
  { value: 'other', label: 'Other' },
];

const SELECTION_BASIS = [
  { value: 'weighted' as const, label: 'Weighted (3:2:1, most recent highest)' },
  { value: 'latest' as const, label: 'Latest period only' },
  { value: 'lowest' as const, label: 'Lowest period (most conservative)' },
  { value: 'average' as const, label: 'Straight average' },
];

function newPeriod(index: number): IncomePeriod {
  return {
    id: `period-${Date.now()}-${index}`,
    label: `FY${new Date().getFullYear() - index}`,
    periodEnd: '', basis: 'financial_statements', verification: 'unverified',
    salaryWages: 0, businessRevenue: 0, ebitda: 0, ebit: 0, npat: 0,
    depreciation: 0, interestExpense: 0, directorRemuneration: 0,
    distributions: 0, rentReceived: 0, dividends: 0,
    otherRecurringIncome: 0, nonRecurringIncome: 0,
  };
}

function newAddback(periodId: string, index: number): Addback {
  return {
    id: `addback-${Date.now()}-${index}`,
    periodId, category: 'one_off', amount: 0, reason: '', source: '', confirmed: false,
  };
}

interface Props {
  payload: AssessmentPayload;
  onChange: (next: AssessmentPayload) => void;
  issues: ValidationIssue[];
  disabled?: boolean;
}

/**
 * Step 4 — income and business performance.
 *
 * The rule this screen exists to enforce: an add-back is not income until a
 * human has confirmed it *with* an amount, a category, a reason and a source.
 * The UI shows the excluded amount rather than hiding it, so nobody wonders
 * where their number went.
 */
export function StepIncome({ payload, onChange, issues, disabled }: Props) {
  const income = payload.income;
  const errorFor = (field: string) => issues.find((issue) => issue.field === field && issue.severity === 'error')?.message;

  const setIncome = (patch: Partial<AssessmentPayload['income']>) => {
    onChange({ ...payload, income: { ...income, ...patch } });
  };

  const updatePeriod = (id: string, patch: Partial<IncomePeriod>) => {
    setIncome({ periods: income.periods.map((period) => (period.id === id ? { ...period, ...patch } : period)) });
  };

  const removePeriod = (id: string) => {
    // Add-backs are attached to a period; removing the period must take them
    // with it or they become orphans that fail validation.
    setIncome({
      periods: income.periods.filter((period) => period.id !== id),
      addbacks: income.addbacks.filter((addback) => addback.periodId !== id),
    });
  };

  const updateAddback = (id: string, patch: Partial<Addback>) => {
    setIncome({ addbacks: income.addbacks.map((addback) => (addback.id === id ? { ...addback, ...patch } : addback)) });
  };

  const analysis = useMemo(
    () => calculateBusinessIncome(payload, resolvePolicy({ profileKey: payload.loan.lenderPolicyProfile })),
    [payload],
  );

  return (
    <div className="ci-step-panel space-y-6">
      <div>
        <h2 className="ci-step-heading">Income and business performance</h2>
        <p className="ci-step-description">
          Financial periods for the borrower or their business. Where more than one period is
          entered, the engine blends them under the selection rule below and reports the trend.
        </p>
      </div>

      <FieldGroup title="Selection rule" columns={2}>
        <SelectField
          label="Assessable income basis" value={income.assessableIncomeBasis}
          onChange={(value) => setIncome({ assessableIncomeBasis: value })}
          options={SELECTION_BASIS} disabled={disabled}
          help="How multiple periods are combined into the figure used for servicing."
        />
      </FieldGroup>

      <section className="space-y-3">
        {/* Section anchor: duplicate period end dates are a property of the set. */}
        <div className="flex items-center justify-between gap-3" data-ci-field="income.periods">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Financial periods</h3>
          <Button
            size="sm" variant="outline" disabled={disabled}
            onClick={() => setIncome({ periods: [...income.periods, newPeriod(income.periods.length)] })}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add period
          </Button>
        </div>

        {!income.periods.length ? (
          <div className="ci-inline-empty">
            <div className="ci-inline-empty-copy">
              <p className="ci-inline-empty-title">No financial periods entered</p>
              <p className="ci-inline-empty-body">
                An investment deal serviced entirely by lease income can proceed without these.
                Owner-occupied and business-serviced transactions cannot.
              </p>
            </div>
            <Button size="sm" disabled={disabled} onClick={() => setIncome({ periods: [newPeriod(0)] })}>
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add period
            </Button>
          </div>
        ) : (
          <div className="ci-repeater">
            {income.periods.map((period, index) => {
              const periodAddbacks = income.addbacks.filter((addback) => addback.periodId === period.id);
              return (
                <article key={period.id} className="ci-repeater-item">
                  <header className="ci-repeater-header">
                    <h4 className="ci-repeater-title">{period.label || `Period ${index + 1}`}</h4>
                    <Button
                      size="icon" variant="ghost" disabled={disabled}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removePeriod(period.id)}
                      aria-label={`Remove ${period.label || `period ${index + 1}`}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </header>

                  <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
                    <TextField label="Period label" value={period.label} onChange={(value) => updatePeriod(period.id, { label: value })} disabled={disabled} />
                    <DateField label="Period end" value={period.periodEnd} onChange={(value) => updatePeriod(period.id, { periodEnd: value })} disabled={disabled} />
                    <SelectField label="Basis" value={period.basis} onChange={(value) => updatePeriod(period.id, { basis: value })} options={PERIOD_BASIS} disabled={disabled} />
                    <SelectField label="Verification" value={period.verification} onChange={(value) => updatePeriod(period.id, { verification: value })} options={VERIFICATION} disabled={disabled} />
                  </div>

                  <div className="mt-3 ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
                    <MoneyField label="Salary and wages" value={period.salaryWages} onChange={(value) => updatePeriod(period.id, { salaryWages: value })} disabled={disabled} />
                    <MoneyField label="Business revenue" value={period.businessRevenue} onChange={(value) => updatePeriod(period.id, { businessRevenue: value })} disabled={disabled} />
                    <MoneyField label="EBITDA" value={period.ebitda} onChange={(value) => updatePeriod(period.id, { ebitda: value })} disabled={disabled} help="Leave blank to rebuild from NPAT." />
                    <MoneyField label="NPAT" value={period.npat} onChange={(value) => updatePeriod(period.id, { npat: value })} disabled={disabled} />
                  </div>

                  <div className="mt-3">
                    <AdvancedSection title="Further income detail" count={7}>
                      <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
                        <MoneyField label="EBIT" value={period.ebit} onChange={(value) => updatePeriod(period.id, { ebit: value })} disabled={disabled} />
                        <MoneyField label="Depreciation" value={period.depreciation} onChange={(value) => updatePeriod(period.id, { depreciation: value })} disabled={disabled} />
                        <MoneyField label="Interest expense" value={period.interestExpense} onChange={(value) => updatePeriod(period.id, { interestExpense: value })} disabled={disabled} />
                        <MoneyField label="Director remuneration" value={period.directorRemuneration} onChange={(value) => updatePeriod(period.id, { directorRemuneration: value })} disabled={disabled} />
                        <MoneyField label="Distributions" value={period.distributions} onChange={(value) => updatePeriod(period.id, { distributions: value })} disabled={disabled} />
                        <MoneyField label="Dividends" value={period.dividends} onChange={(value) => updatePeriod(period.id, { dividends: value })} disabled={disabled} />
                        <MoneyField label="Rent received" value={period.rentReceived} onChange={(value) => updatePeriod(period.id, { rentReceived: value })} disabled={disabled} />
                        <MoneyField label="Other recurring income" value={period.otherRecurringIncome} onChange={(value) => updatePeriod(period.id, { otherRecurringIncome: value })} disabled={disabled} />
                        <MoneyField
                          label="Non-recurring income" value={period.nonRecurringIncome}
                          onChange={(value) => updatePeriod(period.id, { nonRecurringIncome: value })} disabled={disabled}
                          help="Shaded to nil under default policy."
                        />
                      </div>
                    </AdvancedSection>
                  </div>

                  {/* Add-backs, attached to this period. */}
                  <div className="mt-3 rounded-lg border border-border bg-card p-3.5">
                    <div className="mb-2.5 flex items-center justify-between gap-3">
                      <h5 className="text-sm font-semibold text-foreground">Add-backs</h5>
                      <Button
                        size="sm" variant="ghost" disabled={disabled}
                        onClick={() => setIncome({ addbacks: [...income.addbacks, newAddback(period.id, income.addbacks.length)] })}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add
                      </Button>
                    </div>

                    {!periodAddbacks.length ? (
                      <p className="text-xs text-muted-foreground">
                        No add-backs proposed for this period.
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {periodAddbacks.map((addback, addbackIndex) => {
                          const assessable = isAddbackAssessable(addback);
                          return (
                            <div key={addback.id} className="rounded-md border border-border bg-muted/20 p-3">
                              <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
                                <SelectField label="Category" value={addback.category} onChange={(value) => updateAddback(addback.id, { category: value })} options={ADDBACK_CATEGORIES} disabled={disabled} />
                                <MoneyField
                                  label="Amount" value={addback.amount}
                                  onChange={(value) => updateAddback(addback.id, { amount: value })} disabled={disabled}
                                  error={errorFor(`income.addbacks.${income.addbacks.indexOf(addback)}.amount`)} fieldPath={`income.addbacks.${income.addbacks.indexOf(addback)}.amount`}
                                />
                                <TextField label="Source document" value={addback.source} onChange={(value) => updateAddback(addback.id, { source: value })} disabled={disabled} placeholder="e.g. FY2025 statements, note 7" />
                                <div className="flex items-end pb-1">
                                  <SwitchField
                                    label="Confirmed"
                                    value={addback.confirmed}
                                    onChange={(value) => updateAddback(addback.id, {
                                      confirmed: value,
                                      confirmedAt: value ? new Date().toISOString() : undefined,
                                    })}
                                    disabled={disabled}
                                  />
                                </div>
                                <div className="sm:col-span-2 lg:col-span-4">
                                  <TextAreaField
                                    label="Reason" value={addback.reason}
                                    onChange={(value) => updateAddback(addback.id, { reason: value })}
                                    disabled={disabled} rows={2}
                                    placeholder="Why this expense will not recur, or why it is not a genuine cash cost."
                                    error={errorFor(`income.addbacks.${income.addbacks.indexOf(addback)}.reason`)} fieldPath={`income.addbacks.${income.addbacks.indexOf(addback)}.reason`}
                                  />
                                </div>
                              </div>
                              {!assessable ? (
                                <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-warning">
                                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span>
                                    Excluded from assessable income. An add-back needs an amount above zero, a
                                    category, a reason, a source and confirmation before it counts.
                                  </span>
                                </p>
                              ) : null}
                              <div className="sr-only">Add-back {addbackIndex + 1} of {periodAddbacks.length}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <TextAreaField
        label="Other income notes" value={income.otherIncomeNotes}
        onChange={(value) => setIncome({ otherIncomeNotes: value })} disabled={disabled} rows={2}
      />

      <dl className="ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
        <DerivedValue label="Adjusted EBITDA (latest)" value={formatMoney(analysis.adjustedEbitdaCents)} />
        <DerivedValue label="Assessable income" value={formatMoney(analysis.totalAssessableIncomeCents)} note={analysis.selectionBasis} />
        <DerivedValue
          label="Confirmed add-backs" value={formatMoney(analysis.confirmedAddbacksCents)}
          note={analysis.proposedAddbacksCents > 0 ? `${formatMoney(analysis.proposedAddbacksCents)} excluded pending confirmation` : undefined}
          tone={analysis.proposedAddbacksCents > 0 ? 'warn' : 'neutral'}
        />
        <DerivedValue
          label="Earnings trend"
          value={analysis.periods.length >= 2 ? formatRatioPercent(analysis.earningsTrend) : '—'}
          tone={analysis.decliningIncome ? 'bad' : analysis.earningsTrend > 0 ? 'good' : 'neutral'}
          note={analysis.periods.length >= 2 ? 'Latest period against the prior period.' : 'Add a second period to see the trend.'}
        />
      </dl>

      {analysis.varianceWarnings.length ? (
        <ul className="space-y-2">
          {analysis.varianceWarnings.map((warning) => (
            <li key={warning} className="ci-warning-row ci-warning-warning">
              {analysis.decliningIncome
                ? <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                : <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />}
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
