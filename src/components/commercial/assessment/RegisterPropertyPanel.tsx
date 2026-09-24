/**
 * Which building in the property register this assessment concerns.
 *
 * Sits above the Property & transaction step. It is the analysis workspace's
 * "link a property" brought into the assessment, with one difference that
 * matters: that link lived in the page's URL and was lost the moment the
 * analysis was reopened from a list. This one is saved on the record, so the
 * property's own page can list the assessments made of it.
 *
 * The prefill rule is the platform's: blanks are filled, nothing typed is ever
 * overwritten, and whatever was left alone is shown with both values so a
 * difference is a decision rather than a surprise.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, ExternalLink, Factory, Link2, Loader2, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { applyPropertyPrefill, type PrefillChange } from '@/lib/ciAssessment/propertyPrefill';
import {
  applyRegisterProperty, registerLinkOf, registerPropertyPath, withRegisterLink, type RegisterDomain,
} from '@/lib/ciAssessment/registerProperty';
import type { AssessmentPayload } from '@/lib/ciAssessment/types';
import { optionKey, useRegisterProperties } from './useRegisterProperties';

interface Props {
  payload: AssessmentPayload;
  onChange: (next: AssessmentPayload) => void;
  disabled?: boolean;
}

function formatChange(value: number | string | undefined): string {
  if (value == null) return '—';
  return typeof value === 'number' ? value.toLocaleString('en-AU') : value;
}

export function RegisterPropertyPanel({ payload, onChange, disabled }: Props) {
  const navigate = useNavigate();
  const link = registerLinkOf(payload);
  const [choosing, setChoosing] = useState(false);
  const { options, loading, error, resolve } = useRegisterProperties(choosing || Boolean(link));
  const [outcome, setOutcome] = useState<{ applied: PrefillChange[]; skipped: PrefillChange[] } | null>(null);

  const linkProperty = (key: string) => {
    const [domain, propertyId] = key.split(':') as [RegisterDomain, string];
    const resolved = resolve(domain, propertyId);
    if (!resolved) return;
    const result = applyRegisterProperty(payload, resolved.prefill, resolved.link);
    onChange(result.payload);
    setOutcome({ applied: result.applied, skipped: result.skipped });
    setChoosing(false);
  };

  const refill = () => {
    if (!link) return;
    const resolved = resolve(link.domain, link.propertyId);
    if (!resolved) {
      toast({
        title: 'That property is no longer in your register',
        description: 'The figures already in this assessment are unaffected. Unlink it, or link another property.',
        variant: 'destructive',
      });
      return;
    }
    const result = applyPropertyPrefill(payload, resolved.prefill);
    if (result.applied.length) onChange(result.payload);
    setOutcome({ applied: result.applied, skipped: result.skipped });
  };

  const unlink = () => {
    onChange(withRegisterLink(payload, null));
    setOutcome(null);
  };

  const Icon = link?.domain === 'industrial' ? Factory : Building2;

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-labelledby="register-property-heading">
      {link ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p id="register-property-heading" className="ci-field-label">From your property register</p>
            <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="truncate">{link.label || 'Linked property'}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              This assessment is listed on the property’s page. Its figures are its own — change them here freely.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(registerPropertyPath(link))}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Open property
            </Button>
            <Button size="sm" variant="outline" onClick={refill} disabled={disabled || loading}>
              {loading
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              Fill blanks from the register
            </Button>
            <Button size="sm" variant="ghost" onClick={unlink} disabled={disabled}>
              <Unlink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Unlink
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 max-w-xl">
            <p id="register-property-heading" className="text-sm font-semibold text-foreground">Is this a property in your register?</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              Link it to fill its address, value, areas and outgoings, and to list this assessment on the
              property’s page. Typed figures are never overwritten.
            </p>
          </div>
          {choosing ? (
            <div className="w-full max-w-md">
              <Label htmlFor="register-property-select" className="sr-only">Choose a property from your register</Label>
              <Select onValueChange={linkProperty} disabled={disabled || loading}>
                <SelectTrigger id="register-property-select">
                  <SelectValue placeholder={loading ? 'Loading your property register…' : 'Choose a property'} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={optionKey(option)} value={optionKey(option)}>
                      {option.label}{option.detail ? ` — ${option.detail}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loading && !options.length ? (
                <p className="mt-1.5 text-xs text-muted-foreground">Your property register is empty.</p>
              ) : null}
              {error ? <p className="mt-1.5 text-xs text-destructive">{error}</p> : null}
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setChoosing(true)} disabled={disabled}>
              <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Link a register property
            </Button>
          )}
        </div>
      )}

      {outcome ? (
        <div className="mt-3 space-y-2 border-t border-border pt-3" aria-live="polite">
          {outcome.applied.length ? (
            <div>
              <p className="ci-field-label">Filled from the register</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {outcome.applied.map((change) => (
                  <li key={change.field}>
                    <Badge variant="outline" className="ci-status-badge ci-status-good">{change.label}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nothing was filled — this assessment already has a figure for everything the register holds.
            </p>
          )}
          {outcome.skipped.length ? (
            <div>
              <p className="ci-field-label">Left alone — this assessment already had a different figure</p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {outcome.skipped.map((change) => (
                  <li key={change.field}>
                    <span className="font-medium text-foreground">{change.label}</span>
                    {' — register '}{formatChange(change.value)}{', this assessment '}{formatChange(change.existing)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
