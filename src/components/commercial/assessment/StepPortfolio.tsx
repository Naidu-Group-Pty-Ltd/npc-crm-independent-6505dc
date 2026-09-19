import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Info } from 'lucide-react';
import {
  AdvancedSection, DateField, DerivedValue, FieldGroup, MoneyField,
  NumberField, PercentField, SelectField, SwitchField, TextField,
} from './AssessmentFields';
import { calculatePortfolio } from '@/lib/ciAssessment/portfolio';
import { resolvePolicy } from '@/lib/ciAssessment/policy';
import { formatMoney, formatMultiple, formatRatioPercent } from '@/lib/ciAssessment/money';
import type {
  AssessmentPayload, Liability, LiabilityType, PortfolioAsset,
  PortfolioAssetType, RepaymentType,
} from '@/lib/ciAssessment/types';
import type { ValidationIssue } from '@/lib/ciAssessment/validation';

const ASSET_TYPES: ReadonlyArray<{ value: PortfolioAssetType; label: string }> = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'mixed_use', label: 'Mixed use' },
  { value: 'land', label: 'Land' },
  { value: 'development', label: 'Development asset' },
];

const LIABILITY_TYPES: ReadonlyArray<{ value: LiabilityType; label: string }> = [
  { value: 'home_loan', label: 'Home loan' },
  { value: 'investment_loan', label: 'Investment loan' },
  { value: 'commercial_facility', label: 'Commercial facility' },
  { value: 'equipment_finance', label: 'Equipment finance' },
  { value: 'vehicle_finance', label: 'Vehicle finance' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'overdraft', label: 'Overdraft' },
  { value: 'line_of_credit', label: 'Line of credit' },
  { value: 'tax_debt', label: 'Tax debt' },
  { value: 'lease', label: 'Lease' },
  { value: 'guarantee', label: 'Guarantee' },
  { value: 'contingent', label: 'Contingent liability' },
  { value: 'private_debt', label: 'Private debt' },
  { value: 'hecs_help', label: 'HECS / HELP' },
  { value: 'other', label: 'Other' },
];

const REPAYMENT_TYPES: ReadonlyArray<{ value: RepaymentType; label: string }> = [
  { value: 'principalAndInterest', label: 'Principal and interest' },
  { value: 'interestOnly', label: 'Interest only' },
  { value: 'residualTerm', label: 'Residual / balloon' },
];

function newAsset(index: number): PortfolioAsset {
  return {
    id: `asset-${Date.now()}-${index}`,
    address: '', ownershipEntity: '', ownershipPercent: 100, assetType: 'commercial',
    currentValue: 0, valuationDate: '', existingLender: '', currentBalance: 0,
    facilityLimit: 0, interestRate: 0, repaymentType: 'principalAndInterest',
    remainingTermYears: 20, annualRepayments: null, annualRent: 0, leaseExpiry: '',
    vacancyPercent: 0, outgoings: 0, managementCosts: 0, rates: 0, insurance: 0,
    maintenance: 0, capitalExpenditure: 0, crossCollateralised: false, clientPropertyId: null,
  };
}

function newLiability(index: number): Liability {
  return {
    id: `liability-${Date.now()}-${index}`,
    description: '', liabilityType: 'commercial_facility', ownershipEntity: '',
    lender: '', balance: 0, limit: 0, interestRate: 0,
    repaymentType: 'principalAndInterest', remainingTermYears: 5,
    annualRepayments: null, isContingent: false,
    securedAgainstAssetId: null, clientLiabilityId: null,
  };
}

interface Props {
  payload: AssessmentPayload;
  onChange: (next: AssessmentPayload) => void;
  issues: ValidationIssue[];
  disabled?: boolean;
}

/**
 * Step 5 — the borrower's existing portfolio and commitments.
 *
 * This is what turns a standalone deal calculation into a *global* position.
 * Two guards against double-counting live on this screen: a liability can be
 * marked as already secured against one of the assets above it, and debt held
 * across related entities is counted at a configurable share.
 */
export function StepPortfolio({ payload, onChange, issues, disabled }: Props) {
  const portfolio = payload.portfolio;

  const setPortfolio = (patch: Partial<AssessmentPayload['portfolio']>) => {
    onChange({ ...payload, portfolio: { ...portfolio, ...patch } });
  };

  const updateAsset = (id: string, patch: Partial<PortfolioAsset>) => {
    setPortfolio({ assets: portfolio.assets.map((asset) => (asset.id === id ? { ...asset, ...patch } : asset)) });
  };

  const removeAsset = (id: string) => {
    setPortfolio({
      assets: portfolio.assets.filter((asset) => asset.id !== id),
      // Any liability pointing at the removed asset would otherwise stay
      // excluded from servicing forever.
      liabilities: portfolio.liabilities.map((liability) => (
        liability.securedAgainstAssetId === id ? { ...liability, securedAgainstAssetId: null } : liability
      )),
    });
  };

  const updateLiability = (id: string, patch: Partial<Liability>) => {
    setPortfolio({
      liabilities: portfolio.liabilities.map((liability) => (liability.id === id ? { ...liability, ...patch } : liability)),
    });
  };

  const analysis = useMemo(
    () => calculatePortfolio(payload, resolvePolicy({ profileKey: payload.loan.lenderPolicyProfile })),
    [payload],
  );

  const assetOptions = useMemo(() => ([
    { value: '', label: 'Not secured against a listed asset' },
    ...portfolio.assets.map((asset, index) => ({
      value: asset.id,
      label: asset.address || `Asset ${index + 1}`,
    })),
  ]), [portfolio.assets]);

  const warningFor = (field: string) =>
    issues.find((issue) => issue.field === field && issue.severity === 'warning')?.message;
  const errorFor = (field: string) =>
    issues.find((issue) => issue.field === field && issue.severity === 'error')?.message;
  /**
   * Errors win over warnings on the same field — a negative balance matters more
   * than the fact that it also exceeds its limit. Both are surfaced through the
   * one slot so every path validation can report on has somewhere to land when
   * the error summary scrolls to it.
   */
  const messageFor = (field: string) => errorFor(field) ?? warningFor(field);

  return (
    <div className="ci-step-panel space-y-6">
      <div>
        <h2 className="ci-step-heading">Existing portfolio and commitments</h2>
        <p className="ci-step-description">
          Everything the borrower already owns and owes. Without this the result is a standalone deal
          calculation; with it, the engine can show what the transaction does to their global position.
        </p>
      </div>

      <FieldGroup title="Group treatment" columns={2}>
        <PercentField
          label="Related-entity debt counted at" value={portfolio.relatedEntityDebtSharePercent}
          onChange={(value) => setPortfolio({ relatedEntityDebtSharePercent: value })} disabled={disabled}
          help="Set below 100% where a facility is shared with a related entity and would otherwise be counted twice."
        />
      </FieldGroup>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Existing properties</h3>
          <Button
            size="sm" variant="outline" disabled={disabled}
            onClick={() => setPortfolio({ assets: [...portfolio.assets, newAsset(portfolio.assets.length)] })}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add property
          </Button>
        </div>

        {!portfolio.assets.length ? (
          <div className="ci-inline-empty">
            <div className="ci-inline-empty-copy">
              <p className="ci-inline-empty-title">No existing properties recorded</p>
              <p className="ci-inline-empty-body">
                You can proceed without these — the result will be a standalone deal assessment
                rather than a global position.
              </p>
            </div>
            <Button size="sm" disabled={disabled} onClick={() => setPortfolio({ assets: [newAsset(0)] })}>
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add property
            </Button>
          </div>
        ) : (
          <div className="ci-repeater">
            {portfolio.assets.map((asset, index) => (
              <article key={asset.id} className="ci-repeater-item">
                <header className="ci-repeater-header">
                  <h4 className="ci-repeater-title">{asset.address || `Property ${index + 1}`}</h4>
                  <Button
                    size="icon" variant="ghost" disabled={disabled}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeAsset(asset.id)}
                    aria-label={`Remove ${asset.address || `property ${index + 1}`}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </header>

                <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2">
                    <TextField
                      label="Address" value={asset.address}
                      onChange={(value) => updateAsset(asset.id, { address: value })} disabled={disabled}
                      error={messageFor(`portfolio.assets.${index}.address`)}
                      fieldPath={`portfolio.assets.${index}.address`}
                    />
                  </div>
                  <SelectField label="Type" value={asset.assetType} onChange={(value) => updateAsset(asset.id, { assetType: value })} options={ASSET_TYPES} disabled={disabled} />
                  <PercentField label="Ownership" value={asset.ownershipPercent} onChange={(value) => updateAsset(asset.id, { ownershipPercent: value })} disabled={disabled} error={errorFor(`portfolio.assets.${index}.ownershipPercent`)} fieldPath={`portfolio.assets.${index}.ownershipPercent`} />
                  <MoneyField label="Current value" value={asset.currentValue} onChange={(value) => updateAsset(asset.id, { currentValue: value })} disabled={disabled} />
                  <MoneyField label="Loan balance" value={asset.currentBalance} onChange={(value) => updateAsset(asset.id, { currentBalance: value })} disabled={disabled} error={messageFor(`portfolio.assets.${index}.currentBalance`)} fieldPath={`portfolio.assets.${index}.currentBalance`} />
                  <PercentField label="Interest rate" value={asset.interestRate} onChange={(value) => updateAsset(asset.id, { interestRate: value })} disabled={disabled} max={30} />
                  <MoneyField label="Annual rent" value={asset.annualRent} onChange={(value) => updateAsset(asset.id, { annualRent: value })} disabled={disabled} />
                </div>

                <div className="mt-3">
                  <AdvancedSection title="Facility, lease and holding costs" count={13}>
                    <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
                      <TextField label="Ownership entity" value={asset.ownershipEntity} onChange={(value) => updateAsset(asset.id, { ownershipEntity: value })} disabled={disabled} />
                      <DateField label="Valuation date" value={asset.valuationDate} onChange={(value) => updateAsset(asset.id, { valuationDate: value })} disabled={disabled} />
                      <TextField label="Existing lender" value={asset.existingLender} onChange={(value) => updateAsset(asset.id, { existingLender: value })} disabled={disabled} />
                      <MoneyField label="Facility limit" value={asset.facilityLimit} onChange={(value) => updateAsset(asset.id, { facilityLimit: value })} disabled={disabled} />
                      <SelectField label="Repayment type" value={asset.repaymentType} onChange={(value) => updateAsset(asset.id, { repaymentType: value })} options={REPAYMENT_TYPES} disabled={disabled} />
                      <NumberField label="Remaining term (years)" value={asset.remainingTermYears} onChange={(value) => updateAsset(asset.id, { remainingTermYears: value })} disabled={disabled} />
                      <MoneyField
                        label="Annual repayments" value={asset.annualRepayments ?? 0}
                        onChange={(value) => updateAsset(asset.id, { annualRepayments: value === 0 ? null : value })}
                        disabled={disabled}
                        help="Leave blank to derive from balance, rate and term."
                      />
                      <DateField label="Lease expiry" value={asset.leaseExpiry} onChange={(value) => updateAsset(asset.id, { leaseExpiry: value })} disabled={disabled} />
                      <PercentField label="Vacancy" value={asset.vacancyPercent} onChange={(value) => updateAsset(asset.id, { vacancyPercent: value })} disabled={disabled} />
                      <MoneyField label="Outgoings" value={asset.outgoings} onChange={(value) => updateAsset(asset.id, { outgoings: value })} disabled={disabled} />
                      <MoneyField label="Management costs" value={asset.managementCosts} onChange={(value) => updateAsset(asset.id, { managementCosts: value })} disabled={disabled} />
                      <MoneyField label="Rates" value={asset.rates} onChange={(value) => updateAsset(asset.id, { rates: value })} disabled={disabled} />
                      <MoneyField label="Insurance" value={asset.insurance} onChange={(value) => updateAsset(asset.id, { insurance: value })} disabled={disabled} />
                      <MoneyField label="Maintenance" value={asset.maintenance} onChange={(value) => updateAsset(asset.id, { maintenance: value })} disabled={disabled} />
                      <MoneyField label="Capital expenditure" value={asset.capitalExpenditure} onChange={(value) => updateAsset(asset.id, { capitalExpenditure: value })} disabled={disabled} />
                      <SwitchField label="Cross-collateralised" value={asset.crossCollateralised} onChange={(value) => updateAsset(asset.id, { crossCollateralised: value })} disabled={disabled} />
                    </div>
                  </AdvancedSection>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">Other liabilities</h3>
          <Button
            size="sm" variant="outline" disabled={disabled}
            onClick={() => setPortfolio({ liabilities: [...portfolio.liabilities, newLiability(portfolio.liabilities.length)] })}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add liability
          </Button>
        </div>

        {!portfolio.liabilities.length ? (
          <p className="text-sm text-muted-foreground">
            No other liabilities recorded. Cards, overdrafts and equipment finance all reduce servicing capacity.
          </p>
        ) : (
          <div className="ci-repeater">
            {portfolio.liabilities.map((liability, index) => (
              <article key={liability.id} className="ci-repeater-item">
                <header className="ci-repeater-header">
                  <h4 className="ci-repeater-title">{liability.description || `Liability ${index + 1}`}</h4>
                  <Button
                    size="icon" variant="ghost" disabled={disabled}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setPortfolio({ liabilities: portfolio.liabilities.filter((entry) => entry.id !== liability.id) })}
                    aria-label={`Remove ${liability.description || `liability ${index + 1}`}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </header>

                <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
                  <TextField label="Description" value={liability.description} onChange={(value) => updateLiability(liability.id, { description: value })} disabled={disabled} />
                  <SelectField label="Type" value={liability.liabilityType} onChange={(value) => updateLiability(liability.id, { liabilityType: value })} options={LIABILITY_TYPES} disabled={disabled} />
                  <MoneyField label="Balance" value={liability.balance} onChange={(value) => updateLiability(liability.id, { balance: value })} disabled={disabled} error={messageFor(`portfolio.liabilities.${index}.balance`)} fieldPath={`portfolio.liabilities.${index}.balance`} />
                  <MoneyField
                    label="Limit" value={liability.limit}
                    onChange={(value) => updateLiability(liability.id, { limit: value })} disabled={disabled}
                    help="Cards and overdrafts are assessed on their limit."
                  />
                </div>

                <div className="mt-3">
                  <AdvancedSection title="Facility detail and double-count guard" count={6}>
                    <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
                      <TextField label="Lender" value={liability.lender} onChange={(value) => updateLiability(liability.id, { lender: value })} disabled={disabled} />
                      <PercentField label="Interest rate" value={liability.interestRate} onChange={(value) => updateLiability(liability.id, { interestRate: value })} disabled={disabled} max={40} />
                      <SelectField label="Repayment type" value={liability.repaymentType} onChange={(value) => updateLiability(liability.id, { repaymentType: value })} options={REPAYMENT_TYPES} disabled={disabled} />
                      <NumberField label="Remaining term (years)" value={liability.remainingTermYears} onChange={(value) => updateLiability(liability.id, { remainingTermYears: value })} disabled={disabled} />
                      <MoneyField
                        label="Annual repayments" value={liability.annualRepayments ?? 0}
                        onChange={(value) => updateLiability(liability.id, { annualRepayments: value === 0 ? null : value })}
                        disabled={disabled} help="Leave blank to derive."
                      />
                      <SelectField
                        label="Already secured against"
                        value={liability.securedAgainstAssetId ?? ''}
                        onChange={(value) => updateLiability(liability.id, { securedAgainstAssetId: value || null })}
                        options={assetOptions} disabled={disabled}
                        help="Excludes this facility from servicing so the asset's loan is not counted twice."
                      />
                      <SwitchField
                        label="Contingent liability"
                        value={liability.isContingent}
                        onChange={(value) => updateLiability(liability.id, { isContingent: value })}
                        disabled={disabled}
                        help="Disclosed but not serviced — guarantees and contingent exposures."
                      />
                    </div>
                  </AdvancedSection>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {analysis.excludedLiabilities.length ? (
        <div className="ci-warning-row ci-warning-info">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium text-foreground">
              {analysis.excludedLiabilities.length} liability line excluded to prevent double-counting
            </p>
            <ul className="mt-1 space-y-0.5">
              {analysis.excludedLiabilities.map((entry) => (
                <li key={entry.id}>{entry.description} — {entry.reason}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <dl className="ci-field-grid sm:grid-cols-2 lg:grid-cols-5">
        <DerivedValue label="Portfolio value" value={formatMoney(analysis.current.totalValueCents)} />
        <DerivedValue label="Portfolio debt" value={formatMoney(analysis.current.totalDebtCents)} />
        <DerivedValue label="Portfolio LVR" value={formatRatioPercent(analysis.current.lvr)} tone={analysis.current.lvr > 0.7 ? 'warn' : 'neutral'} />
        <DerivedValue label="Existing commitments" value={formatMoney(analysis.existingCommitmentsCents)} note="Annual debt service before the new facility." />
        <DerivedValue label="Portfolio DSCR" value={formatMultiple(analysis.current.dscr)} tone={analysis.current.dscr > 0 && analysis.current.dscr < 1.25 ? 'warn' : 'neutral'} />
      </dl>
    </div>
  );
}
