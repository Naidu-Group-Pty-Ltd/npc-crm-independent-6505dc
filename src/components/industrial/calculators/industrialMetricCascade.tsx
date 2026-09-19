import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CalculatorPrefill } from '@/contexts/CalculatorPrefillContext';

export type IndustrialMetricSource =
  | 'Blank'
  | 'Property Profile'
  | 'Scraped'
  | 'Lease Extracted'
  | 'NOI Tab'
  | 'Cap Rate Tab'
  | 'GST Tab'
  | 'Borrowing Capacity'
  | 'DCF Tab'
  | 'Research Engine'
  | 'AI Estimate'
  | 'Manual'
  | 'User Override'
  | 'Verified';

export interface SourceCandidate {
  value: number | null | undefined;
  source: IndustrialMetricSource;
}

export interface AssumptionHistoryEntry {
  value: string;
  source: IndustrialMetricSource;
  replacedBy: IndustrialMetricSource;
  changedAt: string;
}

interface CascadedFieldState {
  value: string;
  source: IndustrialMetricSource;
  originalValue?: string;
  originalSource?: IndustrialMetricSource;
  pendingSource?: { value: string; source: IndustrialMetricSource };
  history: AssumptionHistoryEntry[];
}

const sourceLabels: Record<IndustrialMetricSource, string> = {
  Blank: 'Blank',
  'Property Profile': 'From Property',
  Scraped: 'Scraped',
  'Lease Extracted': 'From Lease',
  'NOI Tab': 'From NOI',
  'Cap Rate Tab': 'From Cap Rate',
  'GST Tab': 'From GST',
  'Borrowing Capacity': 'From Borrowing',
  'DCF Tab': 'From DCF',
  'Research Engine': 'Research',
  'AI Estimate': 'AI Estimate',
  Manual: 'Manual',
  'User Override': 'Override',
  Verified: 'Verified',
};


export function parseMetricNumber(value: string): number | null {
  const cleaned = value.replace(/[$,%\s]/g, '').replace(/,/g, '');
  if (cleaned === '') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatCurrency(value: number | null, maximumFractionDigits = 2): string {
  if (value === null || !Number.isFinite(value)) return 'Pending';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits }).format(value);
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Pending';
  return `${value.toFixed(2)}%`;
}

function hasNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function pickFirstSource(candidates: SourceCandidate[]): { value: string; source: IndustrialMetricSource } | null {
  const selected = candidates.find((candidate) => hasNumber(candidate.value));
  return selected ? { value: String(selected.value), source: selected.source } : null;
}

export function prefillValue(prefill: CalculatorPrefill | null, key: string): number | null | undefined {
  return prefill ? (prefill as unknown as Record<string, number | null | undefined>)[key] : undefined;
}

export function useCascadedIndustrialField(
  prefill: CalculatorPrefill | null,
  candidates: SourceCandidate[],
) {
  const selectedSource = useMemo(() => pickFirstSource(candidates), [candidates]);
  const [field, setField] = useState<CascadedFieldState>({ value: '', source: 'Blank', history: [] });
  const propertyIdRef = useRef(prefill?.propertyId);

  useEffect(() => {
    if (!prefill) {
      propertyIdRef.current = undefined;
      setField({ value: '', source: 'Blank', history: [] });
      return;
    }

    const propertyChanged = propertyIdRef.current !== undefined && propertyIdRef.current !== prefill.propertyId;
    propertyIdRef.current = prefill.propertyId;

    setField((current) => {
      if (propertyChanged) {
        // `pendingSource` is cleared explicitly rather than dropped with the
        // rest of the old state — every other branch below states it, and a
        // state shape that varies by branch is one `'pendingSource' in field`
        // away from reading a cleared banner as a present one.
        return selectedSource
          ? { value: selectedSource.value, source: selectedSource.source, originalValue: selectedSource.value, originalSource: selectedSource.source, history: [], pendingSource: undefined }
          : { value: '', source: 'Blank', history: [], pendingSource: undefined };
      }

      if (!selectedSource) {
        return current.source === 'User Override' || current.source === 'Verified' ? { ...current, pendingSource: undefined } : { ...current, value: '', source: 'Blank', pendingSource: undefined };
      }

      if (current.source === 'User Override' || current.source === 'Verified') {
        return current.value !== selectedSource.value ? { ...current, pendingSource: selectedSource } : { ...current, pendingSource: undefined };
      }

      return {
        ...current,
        value: selectedSource.value,
        source: selectedSource.source,
        originalValue: selectedSource.value,
        originalSource: selectedSource.source,
        pendingSource: undefined,
      };
    });
  }, [prefill, selectedSource?.value, selectedSource?.source]);

  const setValue = (value: string) => {
    setField((current) => {
      const source: IndustrialMetricSource = current.source === 'Blank' || current.source === 'Manual' ? 'Manual' : 'User Override';
      const shouldCaptureHistory = source === 'User Override' && current.source !== 'User Override' && current.value !== '';
      return {
        ...current,
        value,
        source,
        originalValue: current.originalValue ?? current.value,
        originalSource: current.originalSource ?? current.source,
        history: shouldCaptureHistory
          ? [...current.history, { value: current.value, source: current.source, replacedBy: source, changedAt: new Date().toISOString() }]
          : current.history,
      };
    });
  };

  const keepOverride = () => setField((current) => ({ ...current, pendingSource: undefined }));

  const useSourceValue = () => setField((current) => {
    if (!current.pendingSource) return current;
    return {
      ...current,
      value: current.pendingSource.value,
      source: current.pendingSource.source,
      originalValue: current.pendingSource.value,
      originalSource: current.pendingSource.source,
      history: [...current.history, { value: current.value, source: current.source, replacedBy: current.pendingSource.source, changedAt: new Date().toISOString() }],
      pendingSource: undefined,
    };
  });

  const applySourceValue = (value: string, source: IndustrialMetricSource) => {
    setField((current) => ({
      ...current,
      value,
      source,
      originalValue: value,
      originalSource: source,
      history: current.value !== ''
        ? [...current.history, { value: current.value, source: current.source, replacedBy: source, changedAt: new Date().toISOString() }]
        : current.history,
      pendingSource: undefined,
    }));
  };

  const markVerified = () => setField((current) => ({ ...current, source: 'Verified' }));

  return { ...field, setValue, applySourceValue, keepOverride, useSourceValue, markVerified };
}

export function SourceBadge({ source }: { source: IndustrialMetricSource }) {
  const variant = source === 'User Override' ? 'secondary' : source === 'Verified' ? 'default' : 'outline';
  const toneClass = source === 'Verified'
    ? 'border-success/40 bg-success/15 text-success shadow-success/10'
    : source === 'User Override' || source === 'Manual'
      ? 'border-info/40 bg-info/15 text-info shadow-info/10'
      : source === 'AI Estimate' || source === 'Research Engine'
        ? 'border-accent/40 bg-accent/15 text-accent-foreground shadow-accent/10'
        : source === 'Blank'
          ? 'border-brand-400/40 bg-brand-500/15 text-brand-100 shadow-brand-500/10'
          : 'border-primary/30 bg-primary/10 text-primary shadow-primary/10';
  return <Badge variant={variant} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold leading-5 shadow-sm ${toneClass}`}>Source: {sourceLabels[source]}</Badge>;
}

export function SourceActions({ field }: { field: ReturnType<typeof useCascadedIndustrialField> }) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {field.pendingSource && (
        <div className="rounded-xl border border-info/30 bg-info/10 p-3 shadow-inner">
          <p className="font-medium text-info-foreground">Manual override active — new source value available.</p>
          <p className="mt-0.5">This field currently uses a saved override; compare before replacing it.</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={field.keepOverride}>Keep override</Button>
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={field.useSourceValue}>Use source value</Button><Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => window.alert(`Current override: ${field.value}\nNew source (${field.pendingSource?.source}): ${field.pendingSource?.value}`)}>Compare values</Button>
          </div>
        </div>
      )}
      {field.history.length > 0 && (
        <details className="rounded-lg border border-border/60 bg-background/35 px-3 py-2">
          <summary className="cursor-pointer font-medium text-foreground hover:text-primary">Assumption history</summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {field.history.map((entry, index) => (
              <li key={`${entry.changedAt}-${index}`}>{entry.source} value {entry.value} replaced by {entry.replacedBy}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
