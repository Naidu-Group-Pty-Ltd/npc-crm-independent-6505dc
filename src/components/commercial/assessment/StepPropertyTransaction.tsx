import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Sparkles, X } from 'lucide-react';
import { PropertyImportPanel, type ImportedPropertyData } from '@/components/property-import/PropertyImportPanel';
import {
  AdvancedSection, DateField, DerivedValue, FieldGroup, FullWidth, MoneyField,
  NumberField, SelectField, SwitchField, TextAreaField, TextField,
} from './AssessmentFields';
import { formatMoney, formatRatioPercent, toCents } from '@/lib/ciAssessment/money';
import { calculateTransaction } from '@/lib/ciAssessment/transaction';
import { assessmentTypeDefinition, type AssessmentPayload, type AustralianState, type FieldProvenance } from '@/lib/ciAssessment/types';
import type { ValidationIssue } from '@/lib/ciAssessment/validation';

const STATES: ReadonlyArray<{ value: AustralianState; label: string }> = [
  { value: 'NSW', label: 'New South Wales' }, { value: 'VIC', label: 'Victoria' },
  { value: 'QLD', label: 'Queensland' }, { value: 'WA', label: 'Western Australia' },
  { value: 'SA', label: 'South Australia' }, { value: 'TAS', label: 'Tasmania' },
  { value: 'ACT', label: 'Australian Capital Territory' }, { value: 'NT', label: 'Northern Territory' },
];

const CLASSIFICATIONS = [
  { value: 'commercial' as const, label: 'Commercial' },
  { value: 'industrial' as const, label: 'Industrial' },
  { value: 'mixed_use' as const, label: 'Mixed use' },
  { value: 'land' as const, label: 'Land' },
  { value: 'specialised' as const, label: 'Specialised' },
];

const ASSET_CLASSES = [
  { value: 'office' as const, label: 'Office' }, { value: 'retail' as const, label: 'Retail' },
  { value: 'warehouse' as const, label: 'Warehouse' }, { value: 'logistics' as const, label: 'Logistics' },
  { value: 'manufacturing' as const, label: 'Manufacturing' }, { value: 'cold_storage' as const, label: 'Cold storage' },
  { value: 'medical' as const, label: 'Medical' }, { value: 'childcare' as const, label: 'Childcare' },
  { value: 'hospitality' as const, label: 'Hospitality' }, { value: 'showroom' as const, label: 'Showroom' },
  { value: 'transport_yard' as const, label: 'Transport yard' }, { value: 'data_centre' as const, label: 'Data centre' },
  { value: 'mixed_use' as const, label: 'Mixed use' }, { value: 'other' as const, label: 'Other' },
];

const GST_TREATMENTS = [
  { value: 'going_concern' as const, label: 'Going concern (GST-free)' },
  { value: 'margin_scheme' as const, label: 'Margin scheme' },
  { value: 'plus_gst' as const, label: 'Plus GST' },
  { value: 'gst_inclusive' as const, label: 'GST inclusive in price' },
  { value: 'input_taxed' as const, label: 'Input taxed' },
  { value: 'unknown' as const, label: 'Not yet determined' },
];

const SECURITY_POSITIONS = [
  { value: 'first_mortgage' as const, label: 'First mortgage' },
  { value: 'second_mortgage' as const, label: 'Second mortgage' },
  { value: 'subsequent' as const, label: 'Subsequent mortgage' },
  { value: 'unsecured' as const, label: 'Unsecured' },
];

const VALUATION_CONFIDENCE = [
  { value: 'high' as const, label: 'High — independent valuation held' },
  { value: 'medium' as const, label: 'Medium — agent appraisal or desktop' },
  { value: 'low' as const, label: 'Low — estimate only' },
];

interface Props {
  payload: AssessmentPayload;
  onChange: (next: AssessmentPayload) => void;
  issues: ValidationIssue[];
  disabled?: boolean;
}

/** Fields the import panel can populate, mapped to their engine field names. */
type ImportField = keyof AssessmentPayload['property'];

/**
 * Step 2 — the property and the transaction.
 *
 * Imported data lands in a *review* state rather than being written straight
 * into the form. Nothing an importer produced becomes authoritative until a
 * human accepts it, and the source stays attached to the field afterwards.
 */
export function StepPropertyTransaction({ payload, onChange, issues, disabled }: Props) {
  const [pendingImport, setPendingImport] = useState<Partial<Record<ImportField, unknown>> | null>(null);
  const [importSource, setImportSource] = useState<string>('');

  const property = payload.property;
  const definition = assessmentTypeDefinition(payload.assessmentType);
  const errorFor = (field: string) => issues.find((issue) => issue.field === field && issue.severity === 'error')?.message;

  const set = <K extends ImportField>(key: K, value: AssessmentPayload['property'][K]) => {
    onChange({ ...payload, property: { ...property, [key]: value } });
  };

  const provenanceFor = (field: string) => {
    const entry = payload.provenance.find((record) => record.field === `property.${field}`);
    if (!entry) return undefined;
    const confidence = entry.confidence != null ? ` ${Math.round(entry.confidence * 100)}%` : '';
    return `${entry.source === 'url_import' ? 'URL' : entry.source === 'document_import' ? 'Doc' : entry.source}${confidence}`;
  };

  const transaction = useMemo(() => calculateTransaction(payload), [payload]);

  /**
   * Stage an import for review. Deliberately does NOT write into the payload —
   * a scrape that silently overwrote a figure the user had already checked
   * would be worse than no import at all.
   */
  const stageImport = (data: ImportedPropertyData) => {
    const staged: Partial<Record<ImportField, unknown>> = {};
    const offer = <K extends ImportField>(key: K, value: unknown) => {
      if (value == null || value === '' || value === 0) return;
      staged[key] = value;
    };
    offer('address', data.address);
    offer('suburb', data.suburb);
    offer('state', data.state?.toUpperCase());
    offer('postcode', data.postcode);
    offer('purchasePrice', data.price);
    offer('currentValuation', data.valuation);
    offer('lettableAreaSqm', data.nlaSqm ?? data.glaSqm ?? data.gfaSqm);
    offer('siteAreaSqm', data.siteAreaSqm);
    setImportSource(data.sourceUrl ?? 'Imported document');
    setPendingImport(Object.keys(staged).length ? staged : null);
  };

  const acceptImport = () => {
    if (!pendingImport) return;
    const now = new Date().toISOString();
    const provenance: FieldProvenance[] = Object.keys(pendingImport).map((field) => ({
      field: `property.${field}`,
      source: importSource.startsWith('http') ? 'url_import' : 'document_import',
      sourceRef: importSource,
      requiresConfirmation: false,
      confirmedAt: now,
      capturedAt: now,
    }));
    onChange({
      ...payload,
      property: { ...property, ...(pendingImport as Partial<AssessmentPayload['property']>) },
      provenance: [
        ...payload.provenance.filter((record) => !provenance.some((entry) => entry.field === record.field)),
        ...provenance,
      ],
    });
    setPendingImport(null);
  };

  return (
    <div className="ci-step-panel space-y-6">
      <div>
        <h2 className="ci-step-heading">Property and transaction</h2>
        <p className="ci-step-description">
          The asset, what it costs to acquire and how much facility is being asked for. Import from a
          listing URL or a document to pre-fill — imported values are shown for review before they
          are applied, and never overwrite something you have already entered.
        </p>
      </div>

      <PropertyImportPanel
        category={definition.segment === 'industrial' ? 'industrial' : 'commercial'}
        onImported={stageImport}
      />

      {pendingImport ? (
        <div className="rounded-lg border border-info/40 bg-info/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 shrink-0 text-info" aria-hidden="true" />
                {Object.keys(pendingImport).length} field(s) ready to apply
              </p>
              <p className="mt-1 break-words text-xs text-muted-foreground">Source: {importSource}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPendingImport(null)}>
                <X className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Discard
              </Button>
              <Button size="sm" onClick={acceptImport} disabled={disabled}>
                <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Apply to form
              </Button>
            </div>
          </div>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(pendingImport).map(([field, value]) => (
              <div key={field} className="rounded-md border border-border bg-card px-3 py-2">
                <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">{field}</dt>
                <dd className="mt-0.5 break-words font-mono text-sm text-foreground">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <FieldGroup title="Location" description="Where the security sits." columns={3}>
        <FullWidth>
          <TextField
            label="Street address" required disabled={disabled}
            value={property.address} onChange={(value) => set('address', value)}
            error={errorFor('property.address')} fieldPath="property.address" provenance={provenanceFor('address')}
            placeholder="45 Industrial Drive"
          />
        </FullWidth>
        <TextField label="Suburb" value={property.suburb} onChange={(value) => set('suburb', value)} disabled={disabled} provenance={provenanceFor('suburb')} />
        <SelectField
          label="State" value={(property.state || 'NSW') as AustralianState}
          onChange={(value) => set('state', value)} options={STATES} disabled={disabled}
          error={errorFor('property.state')} fieldPath="property.state"
        />
        <TextField
          label="Postcode" value={property.postcode} onChange={(value) => set('postcode', value)}
          disabled={disabled} error={errorFor('property.postcode')} fieldPath="property.postcode"
        />
      </FieldGroup>

      <FieldGroup title="Classification" description="Drives the policy profile defaults and the risk overlay." columns={3}>
        <SelectField label="Property classification" value={property.classification} onChange={(value) => set('classification', value)} options={CLASSIFICATIONS} disabled={disabled} />
        <SelectField label="Asset class" value={property.assetClass} onChange={(value) => set('assetClass', value)} options={ASSET_CLASSES} disabled={disabled} />
        <TextField label="Sub-type" value={property.assetSubType} onChange={(value) => set('assetSubType', value)} disabled={disabled} placeholder="e.g. A-grade, big-box, cold-store" />
      </FieldGroup>

      <FieldGroup title="Value and dates" columns={3}>
        <MoneyField
          label="Purchase price" required={!definition.isRefinance} disabled={disabled}
          value={property.purchasePrice} onChange={(value) => set('purchasePrice', value)}
          error={errorFor('property.purchasePrice')} fieldPath="property.purchasePrice" provenance={provenanceFor('purchasePrice')}
          help={definition.isRefinance ? 'Not required for a refinance.' : undefined}
        />
        <MoneyField
          label="Current valuation" disabled={disabled}
          value={property.currentValuation} onChange={(value) => set('currentValuation', value)}
          error={errorFor('property.currentValuation')} fieldPath="property.currentValuation" provenance={provenanceFor('currentValuation')}
          help="LVR is struck against the lower of price and valuation."
        />
        <SelectField label="Valuation confidence" value={property.valuationConfidence} onChange={(value) => set('valuationConfidence', value)} options={VALUATION_CONFIDENCE} disabled={disabled} />
        <DateField label="Valuation date" value={property.valuationDate} onChange={(value) => set('valuationDate', value)} disabled={disabled} error={errorFor('property.valuationDate')} fieldPath="property.valuationDate" />
        <TextField label="Valuation source" value={property.valuationSource} onChange={(value) => set('valuationSource', value)} disabled={disabled} placeholder="Valuer or platform" />
        <DateField label="Contract date" value={property.contractDate} onChange={(value) => set('contractDate', value)} disabled={disabled} />
        <DateField label="Settlement date" value={property.settlementDate} onChange={(value) => set('settlementDate', value)} disabled={disabled} error={errorFor('property.settlementDate')} fieldPath="property.settlementDate" />
        <NumberField label="Lettable area (m²)" value={property.lettableAreaSqm} onChange={(value) => set('lettableAreaSqm', value)} disabled={disabled} provenance={provenanceFor('lettableAreaSqm')} />
        <NumberField label="Site area (m²)" value={property.siteAreaSqm} onChange={(value) => set('siteAreaSqm', value)} disabled={disabled} provenance={provenanceFor('siteAreaSqm')} />
      </FieldGroup>

      <FieldGroup title="GST and possession" columns={3}>
        <SelectField
          label="GST treatment" value={property.gstTreatment} onChange={(value) => set('gstTreatment', value)}
          options={GST_TREATMENTS} disabled={disabled}
          help="An undetermined treatment leaves the result subject to verification."
        />
        <SwitchField label="Sold as a going concern" value={property.goingConcern} onChange={(value) => set('goingConcern', value)} disabled={disabled} />
        <SwitchField label="Vacant possession at settlement" value={property.vacantPossession} onChange={(value) => set('vacantPossession', value)} disabled={disabled} help="Vacant possession removes passing rent from the servicing test." />
      </FieldGroup>

      <FieldGroup title="Acquisition costs" description="Everything payable to complete, on top of the price." columns={3}>
        <MoneyField label="Stamp duty" value={property.stampDuty} onChange={(value) => set('stampDuty', value)} disabled={disabled} />
        <MoneyField label="Legal costs" value={property.legalCosts} onChange={(value) => set('legalCosts', value)} disabled={disabled} />
        <MoneyField label="Valuation costs" value={property.valuationCosts} onChange={(value) => set('valuationCosts', value)} disabled={disabled} />
        <MoneyField label="Lender fees" value={property.lenderFees} onChange={(value) => set('lenderFees', value)} disabled={disabled} />
        <MoneyField label="Other acquisition costs" value={property.otherAcquisitionCosts} onChange={(value) => set('otherAcquisitionCosts', value)} disabled={disabled} />
      </FieldGroup>

      <AdvancedSection title="Works, fit-out and capital expenditure" count={5}>
        <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-3">
          <MoneyField label="Fit-out" value={property.fitOut} onChange={(value) => set('fitOut', value)} disabled={disabled} />
          <MoneyField label="Plant and equipment" value={property.plantAndEquipment} onChange={(value) => set('plantAndEquipment', value)} disabled={disabled} />
          <MoneyField label="Repairs" value={property.repairs} onChange={(value) => set('repairs', value)} disabled={disabled} />
          <MoneyField label="Immediate capital expenditure" value={property.immediateCapex} onChange={(value) => set('immediateCapex', value)} disabled={disabled} />
          <MoneyField label="Contingency" value={property.contingency} onChange={(value) => set('contingency', value)} disabled={disabled} />
        </div>
      </AdvancedSection>

      <FieldGroup title="Funding" description="What is being asked for and what the borrower puts in." columns={3}>
        <MoneyField
          label="Requested loan amount" disabled={disabled}
          value={property.requestedLoanAmount} onChange={(value) => set('requestedLoanAmount', value)}
          help="Refine this in the Loan structure step; both fields stay in step."
        />
        <MoneyField label="Deposit or contribution" value={property.depositOrContribution} onChange={(value) => set('depositOrContribution', value)} disabled={disabled} error={errorFor('property.depositOrContribution')} fieldPath="property.depositOrContribution" />
        {definition.isRefinance ? (
          <MoneyField label="Amount being refinanced" value={property.refinanceAmount} onChange={(value) => set('refinanceAmount', value)} disabled={disabled} />
        ) : null}
        <MoneyField label="Proposed equity release" value={property.proposedEquityRelease} onChange={(value) => set('proposedEquityRelease', value)} disabled={disabled} />
      </FieldGroup>

      <AdvancedSection title="Security and guarantees" count={3}>
        <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-3">
          <SelectField label="Security position" value={property.securityPosition} onChange={(value) => set('securityPosition', value)} options={SECURITY_POSITIONS} disabled={disabled} />
          <TextField label="Additional security" value={property.additionalSecurity} onChange={(value) => set('additionalSecurity', value)} disabled={disabled} />
          <TextAreaField label="Guarantors" value={property.guarantors} onChange={(value) => set('guarantors', value)} disabled={disabled} rows={2} />
        </div>
      </AdvancedSection>

      <dl className="ci-field-grid sm:grid-cols-2 lg:grid-cols-4">
        <DerivedValue label="Total acquisition cost" value={formatMoney(transaction.totalAcquisitionCostCents)} />
        <DerivedValue label="Total project cost" value={formatMoney(transaction.totalProjectCostCents)} />
        <DerivedValue
          label="Proposed LVR"
          value={formatRatioPercent(transaction.proposedLvr)}
          note={transaction.valuationBasis}
          tone={transaction.proposedLvr > 0.75 ? 'warn' : 'neutral'}
        />
        <DerivedValue
          label={transaction.fundingGapCents > 0 ? 'Funding gap' : 'Funding surplus'}
          value={formatMoney(transaction.fundingGapCents > 0 ? transaction.fundingGapCents : transaction.fundingSurplusCents)}
          tone={transaction.fundingGapCents > toCents(0) ? 'bad' : 'good'}
        />
      </dl>
    </div>
  );
}
