import { Button } from '@/components/ui/button';
import { Plus, Trash2, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  AdvancedSection, FieldGroup, NumberField, PercentField, SelectField,
  SwitchField, TextAreaField, TextField, TriStateField,
} from './AssessmentFields';
import { classifyCompliance } from '@/lib/ciAssessment/compliance';
import type { AssessmentPayload, BorrowerEntity, BorrowerStructure } from '@/lib/ciAssessment/types';
import type { ValidationIssue } from '@/lib/ciAssessment/validation';
import { useMemo } from 'react';

const STRUCTURES: ReadonlyArray<{ value: BorrowerStructure; label: string }> = [
  { value: 'individual', label: 'Individual' },
  { value: 'joint_individuals', label: 'Joint individuals' },
  { value: 'company', label: 'Company' },
  { value: 'trust', label: 'Trust' },
  { value: 'corporate_trustee', label: 'Corporate trustee' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'smsf', label: 'SMSF' },
  { value: 'spv', label: 'Special-purpose vehicle' },
];

const EXPERIENCE = [
  { value: 'first_time' as const, label: 'First-time commercial borrower' },
  { value: 'some' as const, label: 'Some experience' },
  { value: 'experienced' as const, label: 'Experienced' },
  { value: 'institutional' as const, label: 'Institutional' },
];

const RESIDENCY = [
  { value: 'australian' as const, label: 'Australian citizen' },
  { value: 'permanent_resident' as const, label: 'Permanent resident' },
  { value: 'foreign' as const, label: 'Foreign resident' },
];

const TAX_RESIDENCY = [
  { value: 'australian' as const, label: 'Australian tax resident' },
  { value: 'foreign' as const, label: 'Foreign tax resident' },
  { value: 'unknown' as const, label: 'Not yet confirmed' },
];

function newEntity(index: number): BorrowerEntity {
  return {
    id: `entity-${Date.now()}-${index}`,
    entityName: '', structure: 'company', abnAcn: '',
    ownershipPercent: 100, directors: '', trustees: '', beneficiaries: '',
    isGuarantor: false, relatedEntities: '', yearsTrading: 0, industry: '',
    borrowerExperience: 'some', residency: 'australian', taxResidency: 'australian',
    beneficialOwnership: '',
  };
}

interface Props {
  payload: AssessmentPayload;
  onChange: (next: AssessmentPayload) => void;
  issues: ValidationIssue[];
  disabled?: boolean;
}

/**
 * Step 3 — who is borrowing.
 *
 * Note what is absent: there is no client selector here. The assessment stays
 * unlinked until the final step, which is what lets a broker model a deal
 * before deciding whose file it belongs on.
 */
export function StepOwnership({ payload, onChange, issues, disabled }: Props) {
  const ownership = payload.ownership;
  const errorFor = (field: string) => issues.find((issue) => issue.field === field && issue.severity === 'error')?.message;
  const warningFor = (field: string) => issues.find((issue) => issue.field === field && issue.severity === 'warning')?.message;
  /** Errors first; warnings still need a slot so the error summary can scroll to them. */
  const messageFor = (field: string) => errorFor(field) ?? warningFor(field);

  const setOwnership = (patch: Partial<AssessmentPayload['ownership']>) => {
    onChange({ ...payload, ownership: { ...ownership, ...patch } });
  };

  const updateEntity = (id: string, patch: Partial<BorrowerEntity>) => {
    setOwnership({
      entities: ownership.entities.map((entity) => (entity.id === id ? { ...entity, ...patch } : entity)),
    });
  };

  const addEntity = () => {
    const next = newEntity(ownership.entities.length);
    // Split ownership evenly when a second entity joins, so the total stays at
    // 100% rather than immediately failing validation.
    const entities = ownership.entities.length === 0
      ? [next]
      : [...ownership.entities, { ...next, ownershipPercent: 0 }];
    setOwnership({ entities });
  };

  const removeEntity = (id: string) => {
    setOwnership({ entities: ownership.entities.filter((entity) => entity.id !== id) });
  };

  const compliance = useMemo(() => classifyCompliance(payload), [payload]);
  const ownershipTotal = ownership.entities.reduce((sum, entity) => sum + (entity.ownershipPercent || 0), 0);

  return (
    <div className="ci-step-panel space-y-6">
      <div>
        <h2 className="ci-step-heading">Ownership and borrower structure</h2>
        <p className="ci-step-description">
          Who is borrowing, in what structure, and for what purpose. This assessment is not attached
          to a client record yet — you choose that at the end, once the numbers are settled.
        </p>
      </div>

      <FieldGroup title="Borrowing purpose" description="The predominant purpose of the credit governs how it is classified — the asset class does not." columns={1}>
        <TextAreaField
          label="Purpose of the borrowing" required disabled={disabled}
          value={ownership.borrowingPurpose}
          onChange={(value) => setOwnership({ borrowingPurpose: value })}
          rows={2}
          placeholder="e.g. Acquisition of a warehouse for the borrower's logistics business."
          help="Describe what the funds are for in plain terms. This is read by the compliance classification."
        />
        <TriStateField
          label="Is the purpose predominantly for business?"
          value={ownership.purposeIsPredominantlyBusiness}
          onChange={(value) => setOwnership({ purposeIsPredominantlyBusiness: value })}
          help="Answering 'no' or leaving this unknown routes the assessment to specialist review rather than treating it as unregulated."
        />
        <div className="ci-field-grid sm:grid-cols-2">
          <SwitchField
            label="A natural person is borrowing"
            value={ownership.naturalPersonBorrower}
            onChange={(value) => setOwnership({ naturalPersonBorrower: value })}
            disabled={disabled}
          />
          <SwitchField
            label="Residential security is involved"
            value={ownership.residentialSecurityInvolved}
            onChange={(value) => setOwnership({ residentialSecurityInvolved: value })}
            disabled={disabled}
          />
        </div>
      </FieldGroup>

      <div
        className={compliance.requiresComplianceReview ? 'ci-warning-row ci-warning-warning' : 'ci-warning-row ci-warning-info'}
        role="status"
      >
        {compliance.requiresComplianceReview
          ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />}
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{compliance.classificationLabel}</p>
          {compliance.flags.length ? (
            <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
              {compliance.flags.map((flag) => (
                <li key={flag.code}>{flag.message} <span className="text-foreground">{flag.action}</span></li>
              ))}
            </ul>
          ) : (
            <p className="mt-0.5 text-sm text-muted-foreground">
              No compliance flags raised on the information entered so far. This is decision support, not a legal determination.
            </p>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-foreground">Borrowing entities</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ownership currently totals {ownershipTotal.toFixed(1)}% — it must total 100%.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={addEntity} disabled={disabled}>
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add entity
          </Button>
        </div>

        {/*
          Section-level anchor. The ownership total is a property of the set of
          entities, not of any one row, so the error summary lands on the
          statement of the rule rather than picking an arbitrary entity to blame.
        */}
        {errorFor('ownership.entities') ? (
          <p className="ci-field-error" role="alert" data-ci-field="ownership.entities">
            {errorFor('ownership.entities')}
          </p>
        ) : null}

        {!ownership.entities.length ? (
          <div className="ci-inline-empty">
            <div className="ci-inline-empty-copy">
              <p className="ci-inline-empty-title">No borrowing entity recorded</p>
              <p className="ci-inline-empty-body">Add at least one entity so the structure and compliance classification can be assessed.</p>
            </div>
            <Button size="sm" onClick={addEntity} disabled={disabled}>
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add entity
            </Button>
          </div>
        ) : (
          <div className="ci-repeater">
            {ownership.entities.map((entity, index) => (
              <article key={entity.id} className="ci-repeater-item">
                <header className="ci-repeater-header">
                  <h4 className="ci-repeater-title">{entity.entityName || `Entity ${index + 1}`}</h4>
                  <Button
                    size="icon" variant="ghost" disabled={disabled}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeEntity(entity.id)}
                    aria-label={`Remove ${entity.entityName || `entity ${index + 1}`}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </header>

                <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-3">
                  <TextField label="Entity name" value={entity.entityName} onChange={(value) => updateEntity(entity.id, { entityName: value })} disabled={disabled} error={messageFor(`ownership.entities.${index}.entityName`)} fieldPath={`ownership.entities.${index}.entityName`} />
                  <SelectField label="Structure" value={entity.structure} onChange={(value) => updateEntity(entity.id, { structure: value })} options={STRUCTURES} disabled={disabled} fieldPath={`ownership.entities.${index}.structure`} />
                  <TextField label="ABN / ACN" value={entity.abnAcn} onChange={(value) => updateEntity(entity.id, { abnAcn: value })} disabled={disabled} error={messageFor(`ownership.entities.${index}.abnAcn`)} fieldPath={`ownership.entities.${index}.abnAcn`} />
                  <PercentField label="Ownership" value={entity.ownershipPercent} onChange={(value) => updateEntity(entity.id, { ownershipPercent: value })} disabled={disabled} fieldPath={`ownership.entities.${index}.ownershipPercent`} />
                  <NumberField label="Years trading" value={entity.yearsTrading} onChange={(value) => updateEntity(entity.id, { yearsTrading: value })} disabled={disabled} />
                  <TextField label="Industry" value={entity.industry} onChange={(value) => updateEntity(entity.id, { industry: value })} disabled={disabled} />
                </div>

                <div className="mt-3">
                  <AdvancedSection title="Directors, trustees and control" count={7}>
                    <div className="ci-field-grid sm:grid-cols-2 lg:grid-cols-3">
                      <TextField label="Directors" value={entity.directors} onChange={(value) => updateEntity(entity.id, { directors: value })} disabled={disabled} />
                      <TextField label="Trustees" value={entity.trustees} onChange={(value) => updateEntity(entity.id, { trustees: value })} disabled={disabled} />
                      <TextField label="Beneficiaries" value={entity.beneficiaries} onChange={(value) => updateEntity(entity.id, { beneficiaries: value })} disabled={disabled} />
                      <TextField label="Related entities" value={entity.relatedEntities} onChange={(value) => updateEntity(entity.id, { relatedEntities: value })} disabled={disabled} />
                      <SelectField label="Borrower experience" value={entity.borrowerExperience} onChange={(value) => updateEntity(entity.id, { borrowerExperience: value })} options={EXPERIENCE} disabled={disabled} />
                      <SelectField label="Residency" value={entity.residency} onChange={(value) => updateEntity(entity.id, { residency: value })} options={RESIDENCY} disabled={disabled} />
                      <SelectField label="Tax residency" value={entity.taxResidency} onChange={(value) => updateEntity(entity.id, { taxResidency: value })} options={TAX_RESIDENCY} disabled={disabled} />
                      <div className="sm:col-span-2 lg:col-span-3">
                        <TextAreaField
                          label="Beneficial ownership and control"
                          value={entity.beneficialOwnership}
                          onChange={(value) => updateEntity(entity.id, { beneficialOwnership: value })}
                          disabled={disabled} rows={2}
                          help="Recorded here for the assessment only. The authoritative AML/CTF beneficial-ownership record stays in the AML workflow."
                        />
                      </div>
                      <SwitchField label="Provides a guarantee" value={entity.isGuarantor} onChange={(value) => updateEntity(entity.id, { isGuarantor: value })} disabled={disabled} />
                    </div>
                  </AdvancedSection>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
