import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import {
  AdvancedSection, DateField, DerivedValue, FieldGroup, MoneyField,
  NumberField, PercentField, SelectField, TextAreaField, TextField,
} from './AssessmentFields';
import { calculatePropertyIncome } from '@/lib/ciAssessment/propertyIncome';
import { calculateTransaction } from '@/lib/ciAssessment/transaction';
import { formatMoney, formatRatioPercent } from '@/lib/ciAssessment/money';
import type { AssessmentPayload, LeaseTenancy } from '@/lib/ciAssessment/types';
import type { ValidationIssue } from '@/lib/ciAssessment/validation';

const LEASE_BASIS = [
  { value: 'net' as const, label: 'Net — tenant pays outgoings' },
  { value: 'gross' as const, label: 'Gross — landlord pays outgoings' },
  { value: 'semi_gross' as const, label: 'Semi-gross' },
];

const RENT_FREQUENCY = [
  { value: 'annual' as const, label: 'Per annum' },
  { value: 'monthly' as const, label: 'Per month' },
  { value: 'quarterly' as const, label: 'Per quarter' },
  { value: 'weekly' as const, label: 'Per week' },
];

const TENANT_QUALITY = [
  { value: 'government' as const, label: 'Government' },
  { value: 'national' as const, label: 'National tenant' },
  { value: 'listed' as const, label: 'Listed company' },
  { value: 'established_sme' as const, label: 'Established SME' },
  { value: 'new_business' as const, label: 'New business' },
  { value: 'related_party' as const, label: 'Related party' },
  { value: 'unknown' as const, label: 'Not yet known' },
];

const VERIFICATION = [
  { value: 'unverified' as const, label: 'Not verified' },
  { value: 'documents_held' as const, label: 'Lease held, not checked' },
  { value: 'verified' as const, label: 'Verified' },
];

function newTenancy(index: number): LeaseTenancy {
  return {
    id: `tenancy-${Date.now()}-${index}`,
    tenantName: '', areaSqm: 0, annualRent: 0,
    leaseCommencement: '', leaseExpiry: '', optionsYears: 0,
    annualEscalationPercent: 0, tenantQuality: 'unknown', verification: 'unverified',
  };
}

interface Props {
  payload: AssessmentPayload;
  onChange: (next: AssessmentPayload) => void;
  issues: ValidationIssue[];
  disabled?: boolean;
}

/**
 * Step 6 — lease and property income for the proposed asset.
 *
 * The derived strip at the bottom is the point of the screen: a user changing
 * a vacancy allowance sees net operating income, cap rate and debt yield move
 * immediately, rather than discovering the consequence three steps later.
 */
export function StepLeaseIncome({ payload, onChange, issues, disabled }: Props) {
  const lease = payload.lease;
  const errorFor = (field: string) => issues.find((issue) => issue.field === field && issue.severity === 'error')?.message;

  const setLease = (patch: Partial<AssessmentPayload['lease']>) => {
    onChange({ ...payload, lease: { ...lease, ...patch } });
  };

  const updateTenancy = (id: string, patch: Partial<LeaseTenancy>) => {
    setLease({ tenancies: lease.tenancies.map((tenancy) => (tenancy.id === id ? { ...tenancy, ...patch } : tenancy)) });
  };

  const analysis = useMemo(() => {
    const transaction = calculateTransaction(payload);
    return calculatePropertyIncome(payload, transaction.valuationUsedCents, transaction.requestedLoanCents);
  }, [payload]);

  return (
    <div className="ci-step-panel space-y-6">
      <div>
        <h2 className="ci-step-heading">Lease and property income</h2>
        <p className="ci-step-description">
          What the asset earns and what it costs to hold. Net operating income from this step is what
          the coverage tests are struck against.
        </p>
      </div>

      <FieldGroup title="Lease basis" columns={3}>
        <SelectField
          label="Lease basis" value={lease.leaseBasis} onChange={(value) => setLease({ leaseBasis: value })}
          options={LEASE_BASIS} disabled={disabled}
          help="On a gross lease, recoverable outgoings are not added to income."
        />
        <SelectField label="Rent quoted" value={lease.rentFrequency} onChange={(value) => setLease({ rentFrequency: value })} options={RENT_FREQUENCY} disabled={disabled} />
        <MoneyField label="Market rent (annual)" value={lease.marketRentAnnual} onChange={(value) => setLease({ marketRentAnnual: value })} disabled={disabled} help="Used to flag over-market passing rent." />
      </FieldGroup>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Tenancies</h3>
          <Button
            size="sm" variant="outline" disabled={disabled}
            onClick={() => setLease({ tenancies: [...lease.tenancies, newTenancy(lease.tenancies.length)] })}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add tenancy
          </Button>
        </div>

        {!lease.tenancies.length ? (
          <div className="ci-inline-empty">
            <div className="ci-inline-empty-copy">
              <p className="ci-inline-empty-title">No tenancies recorded</p>
              <p className="ci-inline-empty-body">
                Owner-occupied transactions are serviced by business cash flow and can proceed without
                tenancies. An investment deal cannot — there would be no income to test.
              </p>
            </div>
            <Button size="sm" disabled={disabled} onClick={() => setLease({ tenancies: [newTenancy(0)] })}>
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add tenancy
            </Button>
          </div>
        ) : (
          <div className="ci-repeater">
            {lease.tenancies.map((tenancy, index) => (
              <article key={tenancy.id} className="ci-repeater-item">
                <header className="ci-repeater-header">
                  <h4 className="ci-repeater-title">{tenancy.tenantName || `Tenancy ${index + 1}`}</h4>
                  <Button
                    size="icon" variant="ghost" disabled={disabled}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setLease({ tenancies: lease.tenancies.filter((entry) => entry.id !== tenancy.id) })}
                    aria-label={`Remove ${tenancy.tenantName || `tenancy ${index + 1}`}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </header>

                <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
                  <TextField label="Tenant" value={tenancy.tenantName} onChange={(value) => updateTenancy(tenancy.id, { tenantName: value })} disabled={disabled} />
                  <MoneyField
                    label="Rent" value={tenancy.annualRent}
                    onChange={(value) => updateTenancy(tenancy.id, { annualRent: value })} disabled={disabled}
                    error={errorFor(`lease.tenancies.${index}.annualRent`)} fieldPath={`lease.tenancies.${index}.annualRent`}
                  />
                  <DateField label="Lease commencement" value={tenancy.leaseCommencement} onChange={(value) => updateTenancy(tenancy.id, { leaseCommencement: value })} disabled={disabled} />
                  <DateField
                    label="Lease expiry" value={tenancy.leaseExpiry}
                    onChange={(value) => updateTenancy(tenancy.id, { leaseExpiry: value })} disabled={disabled}
                    error={errorFor(`lease.tenancies.${index}.leaseExpiry`)} fieldPath={`lease.tenancies.${index}.leaseExpiry`}
                  />
                </div>

                <div className="mt-3">
                  <AdvancedSection title="Area, options, escalation and covenant" count={5}>
                    <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
                      <NumberField label="Area (m²)" value={tenancy.areaSqm} onChange={(value) => updateTenancy(tenancy.id, { areaSqm: value })} disabled={disabled} />
                      <NumberField label="Options (years)" value={tenancy.optionsYears} onChange={(value) => updateTenancy(tenancy.id, { optionsYears: value })} disabled={disabled} />
                      <PercentField label="Annual escalation" value={tenancy.annualEscalationPercent} onChange={(value) => updateTenancy(tenancy.id, { annualEscalationPercent: value })} disabled={disabled} max={20} />
                      <SelectField label="Tenant quality" value={tenancy.tenantQuality} onChange={(value) => updateTenancy(tenancy.id, { tenantQuality: value })} options={TENANT_QUALITY} disabled={disabled} />
                      <SelectField label="Lease verification" value={tenancy.verification} onChange={(value) => updateTenancy(tenancy.id, { verification: value })} options={VERIFICATION} disabled={disabled} />
                    </div>
                  </AdvancedSection>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <FieldGroup title="Outgoings and allowances" columns={3}>
        <MoneyField label="Recoverable outgoings" value={lease.recoverableOutgoings} onChange={(value) => setLease({ recoverableOutgoings: value })} disabled={disabled} />
        <MoneyField label="Non-recoverable outgoings" value={lease.nonRecoverableOutgoings} onChange={(value) => setLease({ nonRecoverableOutgoings: value })} disabled={disabled} />
        <PercentField
          label="Vacancy allowance" value={lease.vacancyAllowancePercent}
          onChange={(value) => setLease({ vacancyAllowancePercent: value })} disabled={disabled}
          error={errorFor('lease.vacancyAllowancePercent')} fieldPath="lease.vacancyAllowancePercent"
        />
        <PercentField
          label="Management allowance" value={lease.managementAllowancePercent}
          onChange={(value) => setLease({ managementAllowancePercent: value })} disabled={disabled}
          error={errorFor('lease.managementAllowancePercent')} fieldPath="lease.managementAllowancePercent"
        />
        <MoneyField label="Incentive allowance" value={lease.incentiveAllowance} onChange={(value) => setLease({ incentiveAllowance: value })} disabled={disabled} />
        <NumberField
          label="Rent-free months" value={lease.rentFreeMonths}
          onChange={(value) => setLease({ rentFreeMonths: value })} disabled={disabled}
          help="Amortised across year one."
        />
      </FieldGroup>

      <TextAreaField
        label="Tenant quality notes" value={lease.tenantQualityNotes}
        onChange={(value) => setLease({ tenantQualityNotes: value })} disabled={disabled} rows={2}
      />

      <dl className="ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
        <DerivedValue label="Potential gross income" value={formatMoney(analysis.potentialGrossIncomeCents)} />
        <DerivedValue label="Effective gross income" value={formatMoney(analysis.effectiveGrossIncomeCents)} note={`Less ${formatMoney(analysis.vacancyAllowanceCents)} vacancy`} />
        <DerivedValue label="Operating expenses" value={formatMoney(analysis.totalOperatingExpensesCents)} />
        <DerivedValue
          label="Net operating income" value={formatMoney(analysis.netOperatingIncomeCents)}
          tone={analysis.netOperatingIncomeCents < 0 ? 'bad' : 'good'}
        />
        <DerivedValue label="Net yield / cap rate" value={formatRatioPercent(analysis.netYield, 2)} />
        <DerivedValue label="Debt yield" value={formatRatioPercent(analysis.debtYield, 2)} />
        <DerivedValue label="Break-even occupancy" value={formatRatioPercent(analysis.breakEvenOccupancy)} />
        <DerivedValue
          label="WALE"
          value={analysis.wale > 0 ? `${analysis.wale.toFixed(1)} yrs` : '—'}
          note={analysis.leaseExpiryWithin12Months > 0 ? `${formatRatioPercent(analysis.leaseExpiryWithin12Months)} of income expires within 12 months` : undefined}
          tone={analysis.leaseExpiryWithin12Months > 0.3 ? 'warn' : 'neutral'}
        />
      </dl>

      {analysis.notes.length ? (
        <ul className="space-y-2">
          {analysis.notes.map((note) => (
            <li key={note} className="ci-warning-row ci-warning-warning">{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
