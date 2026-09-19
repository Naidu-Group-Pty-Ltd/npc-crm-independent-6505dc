/**
 * Context — who, what and which kind of transaction.
 *
 * ## What this replaces
 *
 * Four surfaces that each answered part of the same question: a Calculator
 * Command Centre hero, a domain panel with its own toggle, an Active Property
 * Header, and a Calculator Property Bar directly beneath it repeating the same
 * property. The operator had to work out which one was authoritative — and
 * none of them was, because none of them wrote anything down.
 *
 * One stage now: name the analysis, say what kind of transaction it is, link
 * the property, link the client. Each of those is one control, and each writes
 * to the record.
 *
 * ## The prefill rule
 *
 * Linking a property fills blanks and never overwrites. What it filled is
 * listed, and what it deliberately left alone is listed beside it with both
 * values, so a price that differs from the record is a decision rather than a
 * surprise. See `propertyPrefill.ts`.
 */

import { useEffect, useState } from 'react';
import { Building2, Check, Factory, Link2, Loader2, MapPin, Unlink, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { FieldGroup, SelectField, TextField } from '@/components/commercial/assessment/AssessmentFields';
import { commercialApi, type CommercialProperty } from '@/hooks/useCommercialProperties';
import { industrialApi, type IndustrialProperty } from '@/hooks/useIndustrialProperties';
import { useCalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { applyPropertyPrefill, type PrefillChange } from '@/lib/ciAssessment/propertyPrefill';
import {
  ASSESSMENT_TYPE_DEFINITIONS, type AssessmentPayload, type AssessmentType,
} from '@/lib/ciAssessment/types';

interface Props {
  title: string;
  reference: string;
  onTitleChange: (title: string) => void;
  payload: AssessmentPayload;
  onChange: (next: AssessmentPayload) => void;
  disabled?: boolean;
  /** The linked client, when there is one. Linking happens on the report stage. */
  clientName: string | null;
  onOpenClient: (() => void) | null;
  onGoToLinking: () => void;
}

export function ContextStage({
  title, reference, onTitleChange, payload, onChange, disabled,
  clientName, onOpenClient, onGoToLinking,
}: Props) {
  const { domain, property, prefill, loading, selectProperty, clear } = useCalculatorPrefill();
  const [options, setOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [listing, setListing] = useState(true);
  const [outcome, setOutcome] = useState<{ applied: PrefillChange[]; skipped: PrefillChange[] } | null>(null);

  // Local draft of the name, committed on blur — the same pattern the
  // assessment workspace uses, and for the same reason: a title that saves on
  // every keystroke races its own reload.
  const [draftTitle, setDraftTitle] = useState(title);
  useEffect(() => { setDraftTitle(title); }, [title]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setListing(true);
      const result = domain === 'commercial'
        ? await commercialApi.listProperties()
        : await industrialApi.listProperties();
      if (cancelled) return;
      const rows = (result.data ?? []) as Array<CommercialProperty | IndustrialProperty>;
      setOptions(rows.map((row) => {
        const record = row as CommercialProperty & IndustrialProperty;
        const name = record.address || record.property_name || record.street || 'Untitled property';
        return {
          id: record.id,
          label: `${name}${record.suburb ? `, ${record.suburb} ${record.state ?? ''}`.trimEnd() : ''}`,
        };
      }));
      setListing(false);
    })();
    return () => { cancelled = true; };
  }, [domain]);

  /** Apply the linked property's values into the analysis, filling blanks only. */
  const applyPrefill = () => {
    if (!prefill) return;
    const result = applyPropertyPrefill(payload, prefill);
    setOutcome({ applied: result.applied, skipped: result.skipped });
    if (result.applied.length) onChange(result.payload);
  };

  return (
    <div className="ci-step-panel space-y-5">
      <div>
        <h2 className="ci-step-heading">Context</h2>
        <p className="ci-step-description">
          What this analysis is called, which property it concerns and who it is for. Everything after
          this stage reads from here — there is no second place to set a property or a price.
        </p>
      </div>

      <FieldGroup title="This analysis">
        <TextField
          label="Analysis name"
          value={draftTitle}
          onChange={setDraftTitle}
          onBlur={() => { if (draftTitle !== title) onTitleChange(draftTitle); }}
          disabled={disabled}
          placeholder="e.g. 11 Example Street — acquisition"
          help={`Reference ${reference}. The name can be changed at any time.`}
        />
        <SelectField
          label="Transaction type"
          value={payload.assessmentType}
          options={ASSESSMENT_TYPE_DEFINITIONS.map((definition) => ({
            value: definition.key as AssessmentType,
            label: definition.label,
          }))}
          onChange={(value) => onChange({ ...payload, assessmentType: value })}
          disabled={disabled}
          help="Selects which income drives serviceability and which fields are required."
        />
      </FieldGroup>

      {/* ---- Property ----------------------------------------------------- */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Property</h3>

        {property && prefill ? (
          <div className="rounded-lg border border-border bg-muted/25 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {domain === 'industrial'
                    ? <Factory className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    : <Building2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                  {prefill.address || 'Linked property'}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3" aria-hidden="true" />
                  {[prefill.assetSubtype, prefill.state, prefill.zoning].filter(Boolean).join(' · ') || 'No detail recorded'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={applyPrefill} disabled={disabled}>
                  <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Fill from property
                </Button>
                <Button size="sm" variant="ghost" onClick={clear} disabled={disabled}>
                  <Unlink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Unlink
                </Button>
              </div>
            </div>

            {outcome ? (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                {outcome.applied.length ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Filled from the property record
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {outcome.applied.map((change) => (
                        <li key={change.field}>
                          <Badge variant="outline" className="ci-status-badge ci-status-good">
                            {change.label}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nothing was filled — this analysis already has a value for everything the property
                    record carries.
                  </p>
                )}
                {outcome.skipped.length ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Left alone — this analysis already had a different value
                    </p>
                    <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                      {outcome.skipped.map((change) => (
                        <li key={change.field}>
                          <span className="font-medium text-foreground">{change.label}</span>
                          {' — property record '}
                          {typeof change.value === 'number' ? change.value.toLocaleString('en-AU') : change.value}
                          {', this analysis '}
                          {typeof change.existing === 'number'
                            ? change.existing.toLocaleString('en-AU')
                            : change.existing}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-muted/25 p-4">
            <p className="text-sm text-muted-foreground">
              No property linked. Link one to fill the address, areas and value from the record — or work
              from typed figures alone, which is a complete analysis in its own right.
            </p>
            <div className="mt-3 max-w-md">
              <Label htmlFor="workspace-property" className="ci-field-label">Select a property</Label>
              <Select
                disabled={disabled || listing}
                onValueChange={(value) => { void selectProperty(value); }}
              >
                <SelectTrigger id="workspace-property" className="mt-1.5">
                  <SelectValue placeholder={listing ? 'Loading properties…' : 'Search your properties'} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {loading ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Loading the property…
                </p>
              ) : null}
            </div>
          </div>
        )}
      </section>

      {/* ---- Client ------------------------------------------------------- */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Client</h3>
        <div className={cn('rounded-lg border p-4', clientName ? 'border-border bg-muted/25' : 'border-dashed border-border bg-card')}>
          {clientName ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <UserRound className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {clientName}
              </p>
              {onOpenClient ? (
                <Button size="sm" variant="outline" onClick={onOpenClient}>Open client</Button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Not linked to a client. An analysis stands on its own; linking files it — and every report
                produced from it — on the client’s record.
              </p>
              <Button size="sm" variant="outline" onClick={onGoToLinking}>
                <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Link a client
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
