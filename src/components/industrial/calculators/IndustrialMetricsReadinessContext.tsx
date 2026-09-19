import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useCalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { assessIndustrialBenchmark, industrialBenchmarkConfig } from './industrialMetricBenchmarks';
import { formatCurrency, formatPercent, parseMetricNumber, type IndustrialMetricSource } from './industrialMetricCascade';

export type IndustrialMetricsReadinessStatus =
  | 'Awaiting Industrial Inputs'
  | 'Preliminary Industrial Metrics'
  | 'Industrial Metrics Ready'
  | 'Benchmark Review Required'
  | 'Report Ready'
  | 'Verified';

type WarningCategory = 'Property Area' | 'Rent' | 'Outgoings' | 'Price' | 'Site Cover' | 'Hardstand' | 'Office Ratio' | 'Benchmark' | 'Data Source' | 'Verification';
type WarningSeverity = 'Critical' | 'Required' | 'Recommended';

interface WarningItem { category: WarningCategory; severity: WarningSeverity; message: string; nextAction: string }
interface FieldState { value: string; source: IndustrialMetricSource; originalValue?: string; originalSource?: IndustrialMetricSource; history?: unknown[] }
type FieldKey = 'baseRent' | 'outgoings' | 'gla' | 'siteArea' | 'hardstand' | 'officePct' | 'price';

interface ContextValue {
  updateField: (key: FieldKey, value: string, source: IndustrialMetricSource, meta?: Partial<FieldState>) => void;
}

const Ctx = createContext<ContextValue | undefined>(undefined);

export function IndustrialMetricsReadinessProvider({ children }: { children: ReactNode }) {
  const [fields, setFields] = useState<Partial<Record<FieldKey, FieldState>>>({});
  const updateField = useCallback((key: FieldKey, value: string, source: IndustrialMetricSource, meta: Partial<FieldState> = {}) => {
    setFields((current) => {
      const previous = current[key];
      const next = { value, source, ...meta };
      if (previous?.value === next.value && previous.source === next.source && previous.originalValue === next.originalValue && previous.originalSource === next.originalSource && previous.history === next.history) return current;
      return { ...current, [key]: next };
    });
  }, []);

  return <Ctx.Provider value={{ updateField }}><IndustrialMetricsReadinessPanel fields={fields} />{children}</Ctx.Provider>;
}

export function useIndustrialMetricsReadiness() {
  const value = useContext(Ctx);
  if (!value) throw new Error('useIndustrialMetricsReadiness must be used inside IndustrialMetricsReadinessProvider');
  return value;
}

function IndustrialMetricsReadinessPanel({ fields }: { fields: Partial<Record<FieldKey, FieldState>> }) {
  const { domain, prefill, property, pushBack } = useCalculatorPrefill();
  const [searchParams] = useSearchParams();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [includeInReport, setIncludeInReport] = useState(true);
  const assessment = useMemo(() => assessReadiness(fields, Boolean(prefill)), [fields, prefill]);
  const saveSnapshot = useMemo(() => buildSaveSnapshot(fields, assessment.status, prefill?.propertyId ?? null, property?.user_id ?? null, searchParams.get('scenarioId')), [assessment.status, fields, prefill?.propertyId, property, searchParams]);
  const canSaveBack = Boolean(prefill) && saveSnapshot.linkedValues > 0;

  const handleSave = async () => {
    if (!prefill) return;
    setSaving(true);
    try {
      const auditPayload = {
        industrialMetrics: saveSnapshot,
        savedAt: saveSnapshot.timestamp,
        calculationVersion: saveSnapshot.calculationVersion,
        reportSync: includeInReport ? {
          overview: saveSnapshot.reportMetrics,
          tenYearCashFlowCommentary: saveSnapshot.reportMetrics,
          clientPdf: saveSnapshot.reportMetrics,
        } : null,
      };
      const patch = domain === 'industrial'
        ? {
          gla_sqm: saveSnapshot.values.gla ?? undefined,
          site_area_sqm: saveSnapshot.values.siteArea ?? undefined,
          hardstand_sqm: saveSnapshot.values.hardstand ?? undefined,
          office_pct: saveSnapshot.values.officePct ?? undefined,
          purchase_price: saveSnapshot.values.price ?? undefined,
          notes: [String((property as any)?.notes ?? '').trim(), `Industrial metrics audit: ${JSON.stringify(auditPayload)}`].filter(Boolean).join('\n\n'),
        }
        : {
          nla_sqm: saveSnapshot.values.gla ?? undefined,
          site_area_sqm: saveSnapshot.values.siteArea ?? undefined,
          purchase_price: saveSnapshot.values.price ?? undefined,
          industrial_specs: { ...(((property as any)?.industrial_specs ?? {}) as Record<string, unknown>), industrial_metrics_audit: auditPayload, hardstand_sqm: saveSnapshot.values.hardstand ?? undefined, office_pct: saveSnapshot.values.officePct ?? undefined, site_cover_pct: saveSnapshot.calculated.siteCover ?? undefined },
        };
      const res = await pushBack(patch);
      if (res.ok) {
        toast.success('Industrial metrics saved to property profile.');
        setDialogOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };
  const visibleWarnings = assessment.warnings.slice(0, 3);

  return (
    <>
      <div className="rounded-2xl border border-primary/20 bg-card/80 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">Data Source &amp; Sync</h3>
              <StatusBadge status={assessment.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{assessment.nextAction}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="bg-background/60">Data: {prefill ? 'Property linked' : 'Manual entry'}</Badge>
            <Badge variant="outline" className="bg-background/60">Physical data: {assessment.requiredComplete ? 'Complete' : 'Pending'}</Badge>
            <Badge variant="outline" className="bg-background/60">Optional gaps: {assessment.recommendedMissing}</Badge>
          </div>
        </div>
      </div>



      <div className="rounded-2xl border border-primary/20 bg-card/80 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">Validate Warnings &amp; Save Metrics</h3>
            <p className="mt-1 text-sm text-muted-foreground">Benchmark notes stay collapsed by default. Check compact warnings, choose report inclusion, then save the linked-property metrics.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2 text-muted-foreground">
              <Switch checked={includeInReport} onCheckedChange={setIncludeInReport} aria-label="Include industrial metrics in report" />
              Include in report
            </label>
            <span title={!canSaveBack ? (!prefill ? 'Select or link a property before saving industrial metrics.' : 'Import or enter at least one metric before saving back.') : 'Save industrial metrics and audit trail to the linked property profile.'}>
              <Button size="sm" variant="outline" disabled={!canSaveBack || saving} onClick={() => setDialogOpen(true)} className="disabled:pointer-events-none">Save Metrics</Button>
            </span>
          </div>
        </div>

        <details className="mt-3 rounded-md border border-border/60 bg-background/30 p-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">Benchmark Notes (collapsed)</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {saveSnapshot.benchmarkNotes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </details>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {visibleWarnings.map((warning) => <WarningCard key={`${warning.category}-${warning.message}`} warning={warning} />)}
          {visibleWarnings.length === 0 && <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success"><CheckCircle2 className="mr-1 inline h-4 w-4" />Industrial metrics are ready for report inclusion.</div>}
        </div>

        {assessment.warnings.length > 3 && (
          <details className="mt-3 rounded-md border border-border/60 bg-background/30 p-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Warnings ({assessment.warnings.length})</summary>
            <div className="mt-2 space-y-2">
              {assessment.warnings.map((warning) => <WarningCard key={`${warning.category}-${warning.severity}-${warning.message}`} warning={warning} />)}
            </div>
          </details>
        )}
        <SaveBackDialog open={dialogOpen} onOpenChange={setDialogOpen} snapshot={saveSnapshot} saving={saving} onConfirm={handleSave} />
      </div>
    </>
  );
}

function buildSaveSnapshot(fields: Partial<Record<FieldKey, FieldState>>, readinessStatus: IndustrialMetricsReadinessStatus, propertyId: string | null, userId: string | null | undefined, scenarioId: string | null) {
  const values = {
    baseRent: parseMetricNumber(fields.baseRent?.value ?? ''),
    outgoings: parseMetricNumber(fields.outgoings?.value ?? ''),
    gla: parseMetricNumber(fields.gla?.value ?? ''),
    siteArea: parseMetricNumber(fields.siteArea?.value ?? ''),
    hardstand: parseMetricNumber(fields.hardstand?.value ?? ''),
    officePct: parseMetricNumber(fields.officePct?.value ?? ''),
    price: parseMetricNumber(fields.price?.value ?? ''),
  };
  const calculated = {
    netRentPerSqm: values.baseRent !== null && values.gla !== null && values.gla > 0 ? values.baseRent / values.gla : null,
    grossRentPerSqm: values.baseRent !== null && values.outgoings !== null && values.gla !== null && values.gla > 0 ? (values.baseRent + values.outgoings) / values.gla : null,
    siteCover: values.gla !== null && values.siteArea !== null && values.siteArea > 0 ? (values.gla / values.siteArea) * 100 : null,
    hardstandRatio: values.hardstand !== null && values.siteArea !== null && values.siteArea > 0 ? (values.hardstand / values.siteArea) * 100 : null,
    officeRatio: values.officePct,
    pricePerSqmGla: values.price !== null && values.gla !== null && values.gla > 0 ? values.price / values.gla : null,
    pricePerSqmSite: values.price !== null && values.siteArea !== null && values.siteArea > 0 ? values.price / values.siteArea : null,
  };
  const benchmark = assessIndustrialBenchmark({ siteCoverPct: calculated.siteCover, hardstandRatioPct: calculated.hardstandRatio, officeRatioPct: calculated.officeRatio, pricePerSqmGla: calculated.pricePerSqmGla, pricePerSqmSite: calculated.pricePerSqmSite, verified: Object.values(fields).some((field) => field?.source === 'Verified') });
  const fieldEntries = Object.entries(fields).filter(([, field]) => parseMetricNumber(field?.value ?? '') !== null);
  const linkedValues = fieldEntries.length;
  const aiEstimates = fieldEntries.filter(([, field]) => field?.source === 'AI Estimate').length;
  const manualOverrides = fieldEntries.filter(([, field]) => field?.source === 'User Override' || field?.source === 'Manual').length;
  const verifiedValues = fieldEntries.filter(([, field]) => field?.source === 'Verified').length;
  const sources = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, { source: field?.source ?? 'Blank', currentValue: field?.value ?? '', originalSource: field?.originalSource, originalValue: field?.originalValue, userOverrideValue: field?.source === 'User Override' ? field.value : null, aiOrResearchEstimateValue: field?.source === 'AI Estimate' || field?.source === 'Research Engine' ? field.value : null, assumptionHistory: field?.history ?? [] }]));
  const reportMetrics = { rentPerSqm: calculated.netRentPerSqm, grossRentPerSqm: calculated.grossRentPerSqm, siteCover: calculated.siteCover, hardstandRatio: calculated.hardstandRatio, officeRatio: calculated.officeRatio, pricePerSqmGla: calculated.pricePerSqmGla, pricePerSqmSite: calculated.pricePerSqmSite, benchmarkStatus: benchmark.status };
  return { values, sources, calculated, benchmarkStatus: benchmark.status, benchmarkNotes: benchmark.notes, readinessStatus, timestamp: new Date().toISOString(), userId: userId ?? null, calculationVersion: 'industrial-metrics-v1', propertyId, scenarioId, linkedValues, aiEstimates, manualOverrides, verifiedValues, reportMetrics };
}

function SaveBackDialog({ open, onOpenChange, snapshot, saving, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; snapshot: ReturnType<typeof buildSaveSnapshot>; saving: boolean; onConfirm: () => void }) {
  const rows = [
    ['Base Rent p.a.', formatCurrency(snapshot.values.baseRent, 0)],
    ['Outgoings p.a.', formatCurrency(snapshot.values.outgoings, 0)],
    ['GLA m²', snapshot.values.gla?.toLocaleString('en-AU') ?? 'Pending'],
    ['Site Area m²', snapshot.values.siteArea?.toLocaleString('en-AU') ?? 'Pending'],
    ['Hardstand m²', snapshot.values.hardstand?.toLocaleString('en-AU') ?? 'Pending'],
    ['Office %', formatPercent(snapshot.values.officePct)],
    ['Price', formatCurrency(snapshot.values.price, 0)],
    ['Net rent / m²', formatCurrency(snapshot.calculated.netRentPerSqm)],
    ['Gross rent / m²', formatCurrency(snapshot.calculated.grossRentPerSqm)],
    ['Site cover', formatPercent(snapshot.calculated.siteCover)],
    ['Hardstand ratio', formatPercent(snapshot.calculated.hardstandRatio)],
    ['Office ratio', formatPercent(snapshot.calculated.officeRatio)],
    ['$ / m² GLA', formatCurrency(snapshot.calculated.pricePerSqmGla, 0)],
    ['$ / m² site', formatCurrency(snapshot.calculated.pricePerSqmSite, 0)],
    ['Coverage band', snapshot.benchmarkStatus],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Save these industrial metrics back to the property profile?</DialogTitle>
          <DialogDescription>This saves Industrial Metrics only and does not overwrite NOI, Cap Rate, GST, Borrowing Capacity or DCF assumptions.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-2 overflow-y-auto text-sm md:grid-cols-2">
          {rows.map(([label, value]) => <div key={label} className="flex justify-between gap-3 rounded-md border border-border/60 p-2"><span className="text-muted-foreground">{label}</span><span className="font-medium text-foreground">{value}</span></div>)}
        </div>
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
          <Badge variant="outline">{snapshot.linkedValues} linked values</Badge>
          <Badge variant="outline">{snapshot.aiEstimates} AI estimates</Badge>
          <Badge variant="outline">{snapshot.manualOverrides} manual overrides</Badge>
          <Badge variant="outline">{snapshot.verifiedValues} verified values</Badge>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={onConfirm} disabled={saving}>{saving ? 'Saving...' : 'Confirm save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function assessReadiness(fields: Partial<Record<FieldKey, FieldState>>, hasLinkedProperty: boolean) {
  const parsed = {
    baseRent: parseMetricNumber(fields.baseRent?.value ?? ''),
    outgoings: parseMetricNumber(fields.outgoings?.value ?? ''),
    gla: parseMetricNumber(fields.gla?.value ?? ''),
    siteArea: parseMetricNumber(fields.siteArea?.value ?? ''),
    hardstand: parseMetricNumber(fields.hardstand?.value ?? ''),
    officePct: parseMetricNumber(fields.officePct?.value ?? ''),
    price: parseMetricNumber(fields.price?.value ?? ''),
  };
  const warnings: WarningItem[] = [];
  const add = (warning: WarningItem) => warnings.push(warning);

  if (!hasLinkedProperty) add({ category: 'Data Source', severity: 'Recommended', message: 'No property is linked.', nextAction: 'Import property area data to calculate rent and site benchmarks.' });
  if (parsed.gla === null) add({ category: 'Property Area', severity: 'Required', message: 'GLA is missing.', nextAction: 'Import property area data to calculate rent and site benchmarks.' });
  if (parsed.siteArea === null) add({ category: 'Property Area', severity: 'Required', message: 'Site area is missing.', nextAction: 'Confirm GLA and site area before relying on site cover.' });
  if (parsed.price === null) add({ category: 'Price', severity: 'Required', message: 'Price is missing.', nextAction: 'Add purchase price to calculate pricing benchmarks.' });
  if (parsed.baseRent === null) add({ category: 'Rent', severity: 'Required', message: 'Base rent is missing.', nextAction: 'Import NOI rent or enter base rent manually.' });
  if (parsed.outgoings === null) add({ category: 'Outgoings', severity: 'Recommended', message: 'Outgoings are missing.', nextAction: 'Import recovered outgoings to calculate gross rent per m².' });
  if (parsed.gla !== null && parsed.siteArea !== null && parsed.gla > parsed.siteArea) add({ category: 'Property Area', severity: 'Critical', message: 'GLA exceeds site area.', nextAction: 'Confirm GLA and site area before relying on site cover.' });
  if (parsed.gla !== null && parsed.siteArea !== null && parsed.siteArea > 0 && (parsed.gla / parsed.siteArea) * 100 > 100) add({ category: 'Site Cover', severity: 'Critical', message: 'Site cover is above 100%.', nextAction: 'Confirm GLA and site area before relying on site cover.' });
  if (parsed.hardstand !== null && parsed.siteArea !== null && parsed.hardstand > parsed.siteArea) add({ category: 'Hardstand', severity: 'Critical', message: 'Hardstand exceeds site area.', nextAction: 'Verify hardstand against plan or inspection.' });
  if (parsed.officePct !== null && parsed.officePct > 100) add({ category: 'Office Ratio', severity: 'Critical', message: 'Office ratio is above 100%.', nextAction: 'Confirm office component percentage before relying on usability benchmarks.' });

  if (parsed.baseRent !== null && parsed.gla !== null && parsed.gla > 0) {
    const rentPerSqm = parsed.baseRent / parsed.gla;
    if (rentPerSqm < industrialBenchmarkConfig.rentPerSqmGla.min || rentPerSqm > industrialBenchmarkConfig.rentPerSqmGla.max) add({ category: 'Benchmark', severity: 'Recommended', message: 'Rent per m² is materially outside benchmark range.', nextAction: 'Review industrial rent comparables.' });
  }
  if (parsed.price !== null && parsed.gla !== null && parsed.gla > 0) {
    const pricePerGla = parsed.price / parsed.gla;
    if (pricePerGla < industrialBenchmarkConfig.pricePerSqmGla.min || pricePerGla > industrialBenchmarkConfig.pricePerSqmGla.max) add({ category: 'Benchmark', severity: 'Recommended', message: 'Price per m² GLA is materially outside benchmark range.', nextAction: 'Price per m² is outside benchmark range. Review comparables.' });
  }
  if (parsed.price !== null && parsed.siteArea !== null && parsed.siteArea > 0) {
    const pricePerSite = parsed.price / parsed.siteArea;
    if (pricePerSite < industrialBenchmarkConfig.pricePerSqmSite.min || pricePerSite > industrialBenchmarkConfig.pricePerSqmSite.max) add({ category: 'Benchmark', severity: 'Recommended', message: 'Price per m² site is materially outside benchmark range.', nextAction: 'Price per m² is outside benchmark range. Review comparables.' });
  }

  Object.entries(fields).forEach(([key, field]) => {
    if (field?.source === 'AI Estimate') add({ category: 'Verification', severity: 'Recommended', message: `${labelForField(key)} is AI-estimated and unverified.`, nextAction: `${labelForField(key)} estimate is AI-generated. Verify against plan or inspection.` });
    if (field?.source === 'User Override') add({ category: 'Data Source', severity: 'Recommended', message: `${labelForField(key)} is manually overridden.`, nextAction: 'Review the override against source documents before report inclusion.' });
  });

  if (![fields.baseRent, fields.outgoings, fields.gla, fields.siteArea, fields.hardstand, fields.officePct, fields.price].some((field) => field?.source === 'Research Engine' || field?.source === 'AI Estimate' || field?.source === 'Verified')) add({ category: 'Benchmark', severity: 'Recommended', message: 'Benchmark source is missing.', nextAction: 'Add research/comparable support for benchmark interpretation.' });

  const preliminary = (parsed.baseRent !== null || parsed.price !== null) && (parsed.gla !== null || parsed.siteArea !== null);
  const requiredComplete = parsed.baseRent !== null && parsed.gla !== null && parsed.siteArea !== null && parsed.price !== null;
  const recommendedMissing = [parsed.outgoings, parsed.hardstand, parsed.officePct].filter((value) => value === null).length;
  const allVerified = requiredComplete && [fields.baseRent, fields.gla, fields.siteArea, fields.price].every((field) => field?.source === 'Verified');
  const hasCritical = warnings.some((warning) => warning.severity === 'Critical');
  const hasBenchmarkReview = warnings.some((warning) => warning.category === 'Benchmark' && warning.message.includes('outside benchmark'));
  const hasRequired = warnings.some((warning) => warning.severity === 'Required');

  let status: IndustrialMetricsReadinessStatus = 'Awaiting Industrial Inputs';
  if (allVerified && !hasCritical) status = 'Verified';
  else if (requiredComplete && !hasCritical && !hasRequired && recommendedMissing === 0 && !hasBenchmarkReview) status = 'Report Ready';
  else if (requiredComplete && hasBenchmarkReview) status = 'Benchmark Review Required';
  else if (requiredComplete) status = 'Industrial Metrics Ready';
  else if (preliminary) status = 'Preliminary Industrial Metrics';

  return {
    status,
    requiredComplete,
    recommendedMissing,
    warnings: orderWarnings(warnings),
    nextAction: nextActionForStatus(status, warnings),
  };
}

function orderWarnings(warnings: WarningItem[]) {
  const severityOrder: Record<WarningSeverity, number> = { Critical: 0, Required: 1, Recommended: 2 };
  return [...warnings].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

function labelForField(key: string) {
  const labels: Record<string, string> = { baseRent: 'Base rent', outgoings: 'Outgoings', gla: 'GLA', siteArea: 'Site area', hardstand: 'Hardstand', officePct: 'Office ratio', price: 'Price' };
  return labels[key] ?? key;
}

function nextActionForStatus(status: IndustrialMetricsReadinessStatus, warnings: WarningItem[]) {
  if (status === 'Report Ready' || status === 'Verified') return 'Industrial metrics are ready for report inclusion.';
  return warnings[0]?.nextAction ?? 'Import property area data to calculate rent and site benchmarks.';
}

function StatusBadge({ status }: { status: IndustrialMetricsReadinessStatus }) {
  const className = status === 'Verified' || status === 'Report Ready'
    ? 'border-success/30 bg-success/10 text-success'
    : status === 'Benchmark Review Required'
      ? 'border-brand-500/30 bg-brand-500/10 text-brand-200'
      : 'border-primary/30 bg-primary/5 text-primary';
  return <Badge variant="outline" className={className}>{status}</Badge>;
}

function WarningCard({ warning }: { warning: WarningItem }) {
  const className = warning.severity === 'Critical'
    ? 'border-destructive/30 bg-destructive/10'
    : warning.severity === 'Required'
      ? 'border-brand-500/30 bg-brand-500/10'
      : 'border-border/60 bg-background/30';
  return (
    <div className={`rounded-lg border p-3 text-sm ${className}`}>
      <div className="flex items-center justify-between gap-2"><span className="font-medium text-foreground"><AlertTriangle className="mr-1 inline h-4 w-4" />{warning.category}</span><Badge variant="outline" className="text-[10px]">{warning.severity}</Badge></div>
      <p className="mt-1 text-muted-foreground">{warning.message}</p>
      <p className="mt-1 text-xs text-muted-foreground">{warning.nextAction}</p>
    </div>
  );
}
