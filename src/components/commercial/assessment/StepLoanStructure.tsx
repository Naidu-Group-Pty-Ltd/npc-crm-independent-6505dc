import { useMemo } from 'react';
import { Info } from 'lucide-react';
import {
  AdvancedSection, DerivedValue, FieldGroup, MoneyField,
  NumberField, PercentField, SelectField, SwitchField,
} from './AssessmentFields';
import { PROFILE_LABELS, assessmentRate, resolvePolicy } from '@/lib/ciAssessment/policy';
import { calculateTransaction } from '@/lib/ciAssessment/transaction';
import { formatMoney, formatRatioPercent } from '@/lib/ciAssessment/money';
import type { LenderPolicyProfileKey } from '@/utils/commercial/borrowing/calculatorTypes';
import type { AssessmentPayload, RepaymentType } from '@/lib/ciAssessment/types';
import type { ValidationIssue } from '@/lib/ciAssessment/validation';

const PROFILE_OPTIONS = (Object.keys(PROFILE_LABELS) as LenderPolicyProfileKey[])
  .map((key) => ({ value: key, label: PROFILE_LABELS[key] }));

const REPAYMENT_TYPES: ReadonlyArray<{ value: RepaymentType; label: string }> = [
  { value: 'principalAndInterest', label: 'Principal and interest' },
  { value: 'interestOnly', label: 'Interest only' },
  { value: 'residualTerm', label: 'Residual / balloon' },
];

const FREQUENCY = [
  { value: 'monthly' as const, label: 'Monthly' },
  { value: 'quarterly' as const, label: 'Quarterly' },
  { value: 'annual' as const, label: 'Annual' },
];

interface Props {
  payload: AssessmentPayload;
  onChange: (next: AssessmentPayload) => void;
  issues: ValidationIssue[];
  canOverridePolicy: boolean;
  disabled?: boolean;
}

/**
 * Step 7 — loan structure and policy assumptions.
 *
 * Policy overrides are gated on a capability. Someone who can model a deal is
 * not automatically someone who can move a DSCR hurdle, and an assumption
 * quietly relaxed is the fastest route to a number nobody can defend.
 */
export function StepLoanStructure({ payload, onChange, issues, canOverridePolicy, disabled }: Props) {
  const loan = payload.loan;
  const errorFor = (field: string) => issues.find((issue) => issue.field === field && issue.severity === 'error')?.message;

  const setLoan = (patch: Partial<AssessmentPayload['loan']>) => {
    onChange({ ...payload, loan: { ...loan, ...patch } });
  };

  const setOverride = (patch: Partial<AssessmentPayload['loan']['policyOverrides']>) => {
    setLoan({ policyOverrides: { ...loan.policyOverrides, ...patch } });
  };

  const policy = useMemo(
    () => resolvePolicy({ profileKey: loan.lenderPolicyProfile, overrides: loan.policyOverrides }),
    [loan.lenderPolicyProfile, loan.policyOverrides],
  );

  const rate = useMemo(() => assessmentRate({
    contractRatePct: loan.actualRatePercent,
    policy,
    bufferOverridePct: loan.interestRateBufferPercent,
    rateOverridePct: loan.assessmentRateOverridePercent,
  }), [loan.actualRatePercent, loan.interestRateBufferPercent, loan.assessmentRateOverridePercent, policy]);

  const transaction = useMemo(() => calculateTransaction(payload), [payload]);

  return (
    <div className="ci-step-panel space-y-6">
      <div>
        <h2 className="ci-step-heading">Loan structure and policy assumptions</h2>
        <p className="ci-step-description">
          The facility being sought and the assumptions it is tested against. Every figure here is
          recorded with the result, so a number produced today can be explained a year from now.
        </p>
      </div>

      <FieldGroup title="Facility" columns={3}>
        <MoneyField
          label="Requested loan" value={loan.requestedLoan}
          onChange={(value) => setLoan({ requestedLoan: value })} disabled={disabled}
          error={errorFor('loan.requestedLoan')} fieldPath="loan.requestedLoan"
        />
        <PercentField
          label="Contract interest rate" value={loan.actualRatePercent} max={30}
          onChange={(value) => setLoan({ actualRatePercent: value })} disabled={disabled}
          required error={errorFor('loan.actualRatePercent')} fieldPath="loan.actualRatePercent"
        />
        <SelectField label="Repayment type" value={loan.repaymentType} onChange={(value) => setLoan({ repaymentType: value })} options={REPAYMENT_TYPES} disabled={disabled} />
        <NumberField label="Loan term (years)" value={loan.loanTermYears} onChange={(value) => setLoan({ loanTermYears: value })} disabled={disabled} />
        <NumberField
          label="Amortisation (years)" value={loan.amortisationYears}
          onChange={(value) => setLoan({ amortisationYears: value })} disabled={disabled}
          error={errorFor('loan.amortisationYears')} fieldPath="loan.amortisationYears"
          help="The profile repayments are struck on. May exceed the facility term."
        />
        <NumberField
          label="Interest-only period (years)" value={loan.interestOnlyPeriodYears}
          onChange={(value) => setLoan({ interestOnlyPeriodYears: value })} disabled={disabled}
          error={errorFor('loan.interestOnlyPeriodYears')} fieldPath="loan.interestOnlyPeriodYears"
        />
        <MoneyField
          label="Residual / balloon" value={loan.residualBalloonAmount}
          onChange={(value) => setLoan({ residualBalloonAmount: value })} disabled={disabled}
          error={errorFor('loan.residualBalloonAmount')} fieldPath="loan.residualBalloonAmount"
        />
        <SelectField label="Repayment frequency" value={loan.repaymentFrequency} onChange={(value) => setLoan({ repaymentFrequency: value })} options={FREQUENCY} disabled={disabled} />
        <SwitchField label="Cross-collateralised" value={loan.crossCollateralised} onChange={(value) => setLoan({ crossCollateralised: value })} disabled={disabled} />
      </FieldGroup>

      <FieldGroup title="Policy profile" description="Which lender shape the transaction is tested against. No profile is treated as universal truth." columns={3}>
        <SelectField
          label="Lender policy profile" value={loan.lenderPolicyProfile}
          onChange={(value) => setLoan({ lenderPolicyProfile: value })}
          options={PROFILE_OPTIONS} disabled={disabled}
        />
        <PercentField
          label="Rate buffer" value={loan.interestRateBufferPercent} max={10}
          onChange={(value) => setLoan({ interestRateBufferPercent: value })} disabled={disabled}
          help={`Profile default is ${policy.assessmentBufferPct}%. Leave at zero to use it.`}
        />
        <PercentField
          label="Assessment rate override" value={loan.assessmentRateOverridePercent} max={30}
          onChange={(value) => setLoan({ assessmentRateOverridePercent: value })}
          disabled={disabled || !canOverridePolicy}
          help={canOverridePolicy ? 'Replaces the derived assessment rate entirely.' : 'Requires the override-assumptions permission.'}
        />
      </FieldGroup>

      <AdvancedSection title="Fees" count={5}>
        <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-3">
          <MoneyField label="Establishment fees" value={loan.establishmentFees} onChange={(value) => setLoan({ establishmentFees: value })} disabled={disabled} />
          <MoneyField label="Annual fees" value={loan.annualFees} onChange={(value) => setLoan({ annualFees: value })} disabled={disabled} />
          <PercentField label="Line fee" value={loan.lineFeePercent} max={10} onChange={(value) => setLoan({ lineFeePercent: value })} disabled={disabled} />
          <PercentField label="Unused-limit fee" value={loan.unusedLimitFeePercent} max={10} onChange={(value) => setLoan({ unusedLimitFeePercent: value })} disabled={disabled} />
          <MoneyField label="Risk / LMI fees" value={loan.riskFees} onChange={(value) => setLoan({ riskFees: value })} disabled={disabled} />
          <MoneyField label="Capitalised costs" value={loan.capitalisedCosts} onChange={(value) => setLoan({ capitalisedCosts: value })} disabled={disabled} />
        </div>
      </AdvancedSection>

      <AdvancedSection title="Scenario policy overrides" defaultOpen={false} count={6}>
        {!canOverridePolicy ? (
          <p className="ci-warning-row ci-warning-info">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Overriding policy assumptions requires the override permission. The values below are shown
              read-only so you can see what the transaction is being tested against.
            </span>
          </p>
        ) : (
          <p className="mb-3 text-xs leading-5 text-muted-foreground">
            Overrides apply to this assessment only, are recorded on the calculation snapshot, and are
            named in the report. Leave a field at zero to keep the profile default.
          </p>
        )}
        <div className="mt-3 ci-field-grid sm:grid-cols-2 lg:grid-cols-3">
          <PercentField
            label="Max LVR" value={(loan.policyOverrides.maxLvr ?? 0) * 100}
            onChange={(value) => setOverride({ maxLvr: value > 0 ? value / 100 : undefined })}
            disabled={disabled || !canOverridePolicy}
            help={`Profile: ${(policy.maxLvr * 100).toFixed(1)}%`}
          />
          <NumberField
            label="Minimum DSCR" value={loan.policyOverrides.minDscr ?? 0}
            onChange={(value) => setOverride({ minDscr: value > 0 ? value : undefined })}
            disabled={disabled || !canOverridePolicy}
            help={`Profile: ${policy.minDscr.toFixed(2)}x`}
          />
          <NumberField
            label="Minimum ICR" value={loan.policyOverrides.minIcr ?? 0}
            onChange={(value) => setOverride({ minIcr: value > 0 ? value : undefined })}
            disabled={disabled || !canOverridePolicy}
            help={`Profile: ${policy.minIcr.toFixed(2)}x`}
          />
          <PercentField
            label="Minimum debt yield" value={(loan.policyOverrides.minDebtYield ?? 0) * 100}
            onChange={(value) => setOverride({ minDebtYield: value > 0 ? value / 100 : undefined })}
            disabled={disabled || !canOverridePolicy}
            help={`Profile: ${(policy.minDebtYield * 100).toFixed(2)}%`}
          />
          <PercentField
            label="Rental shading" value={loan.policyOverrides.rentalShadingPercent ?? 0}
            onChange={(value) => setOverride({ rentalShadingPercent: value > 0 ? value : undefined })}
            disabled={disabled || !canOverridePolicy}
            help={`Profile: ${policy.rentalShadingPct}%`}
          />
          <PercentField
            label="Assessment floor rate" value={loan.policyOverrides.assessmentFloorRatePercent ?? 0} max={30}
            onChange={(value) => setOverride({ assessmentFloorRatePercent: value > 0 ? value : undefined })}
            disabled={disabled || !canOverridePolicy}
            help={`Profile: ${policy.assessmentFloorRatePct}%`}
          />
        </div>
      </AdvancedSection>

      <dl className="ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
        <DerivedValue label="Assessment rate" value={`${rate.assessmentRatePct.toFixed(2)}%`} note={rate.basis} />
        <DerivedValue label="Annual debt service" value={formatMoney(transaction.annualDebtServiceCents)} note={`${formatMoney(transaction.monthlyDebtServiceCents)} per month`} />
        <DerivedValue label="Interest-only cost" value={formatMoney(transaction.interestOnlyAnnualCents)} />
        <DerivedValue
          label="Balloon exposure at maturity" value={formatMoney(transaction.balloonExposureCents)}
          tone={transaction.balloonExposureCents > 0 ? 'warn' : 'neutral'}
          note={transaction.balloonExposureCents > 0 ? 'Requires refinance or sale at maturity.' : undefined}
        />
        <DerivedValue label="Proposed LVR" value={formatRatioPercent(transaction.proposedLvr)} note={`Policy ceiling ${(policy.maxLvr * 100).toFixed(1)}%`} tone={transaction.proposedLvr > policy.maxLvr ? 'bad' : 'good'} />
        <DerivedValue label="Proposed LTC" value={formatRatioPercent(transaction.proposedLtc)} note={`Policy ceiling ${(policy.maxLtc * 100).toFixed(1)}%`} tone={transaction.proposedLtc > policy.maxLtc ? 'bad' : 'good'} />
        <DerivedValue label="Annual facility fees" value={formatMoney(transaction.annualFacilityFeesCents)} />
        <DerivedValue label="Policy version" value={policy.policyVersion} note={policy.profileLabel} />
      </dl>
    </div>
  );
}
