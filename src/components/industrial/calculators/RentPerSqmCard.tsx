import { useEffect, useMemo } from 'react';
import { AlertTriangle, Info, Lock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { calcRentPerSqm } from '@/utils/industrial';
import { useCalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { IndustrialMetricAiWorkflow, type IndustrialMetricAiAction } from './IndustrialMetricAiWorkflow';
import { useIndustrialMetricsReadiness } from './IndustrialMetricsReadinessContext';
import { formatCurrency, parseMetricNumber, prefillValue, SourceActions, SourceBadge, useCascadedIndustrialField, type IndustrialMetricSource } from './industrialMetricCascade';

export function RentPerSqmCard() {
  const { prefill } = useCalculatorPrefill();
  const { updateField } = useIndustrialMetricsReadiness();

  const baseRent = useCascadedIndustrialField(prefill, [
    { value: prefill?.grossPassingRentPa, source: 'NOI Tab' },
    { value: prefill?.marketRentPa, source: 'NOI Tab' },
    { value: prefillValue(prefill, 'scrapedRentalPa'), source: 'Scraped' },
    { value: prefillValue(prefill, 'leaseExtractedBaseRentPa'), source: 'Lease Extracted' },
  ]);

  const gla = useCascadedIndustrialField(prefill, [
    { value: prefill?.glaSqm, source: 'Property Profile' },
    { value: prefillValue(prefill, 'scrapedGlaSqm'), source: 'Scraped' },
    { value: prefill?.gfaSqm ?? prefill?.nlaSqm, source: 'Property Profile' },
    { value: prefillValue(prefill, 'buildingAreaSqm'), source: 'Scraped' },
  ]);

  const outgoings = useCascadedIndustrialField(prefill, [
    { value: prefill?.recoveredOutgoingsPa, source: 'NOI Tab' },
    { value: prefillValue(prefill, 'leaseScrapedOutgoingsPa'), source: 'Scraped' },
    { value: prefillValue(prefill, 'outgoingsStatementPa'), source: 'Lease Extracted' },
  ]);


  useEffect(() => {
    updateField('baseRent', baseRent.value, baseRent.source, { originalValue: baseRent.originalValue, originalSource: baseRent.originalSource, history: baseRent.history });
    updateField('gla', gla.value, gla.source, { originalValue: gla.originalValue, originalSource: gla.originalSource, history: gla.history });
    updateField('outgoings', outgoings.value, outgoings.source, { originalValue: outgoings.originalValue, originalSource: outgoings.originalSource, history: outgoings.history });
  }, [baseRent.value, baseRent.source, baseRent.originalValue, baseRent.originalSource, baseRent.history, gla.value, gla.source, gla.originalValue, gla.originalSource, gla.history, outgoings.value, outgoings.source, outgoings.originalValue, outgoings.originalSource, outgoings.history, updateField]);

  const parsed = useMemo(() => ({
    baseRent: parseMetricNumber(baseRent.value),
    gla: parseMetricNumber(gla.value),
    outgoings: parseMetricNumber(outgoings.value),
  }), [baseRent.value, gla.value, outgoings.value]);

  const hasZeroDenominator = parsed.gla !== null && parsed.gla <= 0;
  const canCalculateRent = parsed.baseRent !== null && parsed.outgoings !== null && parsed.gla !== null && parsed.gla > 0;
  const result = useMemo(() => canCalculateRent ? calcRentPerSqm({
    baseRentPa: parsed.baseRent ?? 0,
    glaSqm: parsed.gla ?? 0,
    outgoingsPa: parsed.outgoings ?? 0,
  }) : null, [canCalculateRent, parsed.baseRent, parsed.gla, parsed.outgoings]);

  const allVerified = [baseRent.source, gla.source, outgoings.source].every((source) => source === 'Verified');
  const benchmarkTone = hasZeroDenominator ? 'critical' : allVerified ? 'verified' : 'preliminary';
  const benchmarkStatus = canCalculateRent ? (allVerified ? 'Verified' : 'Preliminary Benchmark') : 'Awaiting Inputs';

  const aiActions: IndustrialMetricAiAction[] = [
    {
      id: 'estimate-gla',
      label: 'Estimate GLA from listing / floor plan',
      buildPreview: () => {
        const candidate = parsed.gla ?? prefillValue(prefill, 'scrapedGlaSqm') ?? prefillValue(prefill, 'buildingAreaSqm') ?? (prefill?.siteAreaSqm ? Number((prefill.siteAreaSqm * 0.4).toFixed(2)) : null);
        if (!candidate || !prefill) return null;
        return {
          actionId: 'estimate-gla',
          label: 'Estimate GLA from listing / floor plan',
          suggestedValue: String(candidate),
          suggestedBenchmarkRange: `${Math.round(candidate * 0.9).toLocaleString('en-AU')}–${Math.round(candidate * 1.1).toLocaleString('en-AU')} m²`,
          confidence: prefill.glaSqm || prefillValue(prefill, 'scrapedGlaSqm') ? 'High' : 'Low',
          source: 'AI Estimate',
          sourceBasis: 'Uses linked property profile, scraped area fields, building description or a site-area-derived industrial footprint estimate where direct GLA is unavailable.',
          dataPointsUsed: [prefill.address, prefill.glaSqm ? `Profile GLA ${prefill.glaSqm} m²` : '', prefill.siteAreaSqm ? `Site area ${prefill.siteAreaSqm} m²` : ''].filter(Boolean),
          missingData: [prefillValue(prefill, 'floorPlanAreaSqm') ? '' : 'Measured floor plan area', prefillValue(prefill, 'buildingDescription') ? '' : 'Detailed building description'].filter(Boolean),
          riskNotes: ['Treat as preliminary unless confirmed against survey, lease plan or agent floor plan.'],
          verificationRequirements: ['Confirm GLA against property profile, lease plan, survey or floor plan before relying on outputs.'],
          targetField: gla,
        };
      },
    },
    {
      id: 'estimate-market-rent',
      label: 'Estimate market rent per m²',
      buildPreview: () => {
        if (!prefill || parsed.baseRent === null || parsed.gla === null || parsed.gla <= 0) return null;
        const value = Number((parsed.baseRent / parsed.gla).toFixed(2));
        return {
          actionId: 'estimate-market-rent',
          label: 'Estimate market rent per m²',
          suggestedValue: `${formatCurrency(value)} / m²`,
          suggestedBenchmarkRange: `${formatCurrency(value * 0.9)}–${formatCurrency(value * 1.1)} / m²`,
          confidence: 'Medium',
          source: 'Research Engine',
          sourceBasis: 'Uses NOI rent and parsed GLA as a benchmark proxy pending comparable industrial rental evidence.',
          dataPointsUsed: [`Base rent ${formatCurrency(parsed.baseRent)}`, `GLA ${parsed.gla} m²`, prefill.address],
          missingData: ['Verified industrial comparable rents', 'Lease incentives and rent basis confirmation'],
          riskNotes: ['Market rent per m² may differ materially by clearance, access, power, office ratio and lease structure.'],
          verificationRequirements: ['Review against comparable leasing evidence before relying on the benchmark.'],
        };
      },
    },
  ];

  return (
    <Card className="overflow-hidden rounded-3xl border-primary/20 bg-gradient-to-br from-card via-card/95 to-brand-500/5 shadow-lg shadow-primary/5 transition-shadow hover:shadow-xl">
      <CardHeader className="border-b border-border/60 bg-background/30 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Rent per m² GLA</CardTitle>
            <CardDescription>Enter rent, area and outgoings, then review the locked $/m² outputs below.</CardDescription>
          </div>
          <Badge variant="outline" className="rounded-full border-brand-500/30 bg-brand-500/10 px-3 py-1 text-brand-200 shadow-sm shadow-brand-500/10">Rent metrics</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.95fr)] lg:gap-6">
        <div className="space-y-3">
          <IndustrialMetricAiWorkflow actions={aiActions} />
          <div className="rounded-2xl border border-brand-500/20 bg-gradient-to-br from-brand-500/10 to-background/40 p-4 shadow-inner">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-200">Editable inputs</p>
          <CascadedInput label="Base Rent p.a. ($)" value={baseRent.value} placeholder="Pulled from NOI tab or enter manually" source={baseRent.source} onChange={baseRent.setValue} onVerify={baseRent.markVerified} />
          <SourceActions field={baseRent} />
          <CascadedInput label="GLA (m²)" value={gla.value} placeholder="Pulled from property profile or enter manually" source={gla.source} onChange={gla.setValue} onVerify={gla.markVerified} />
          <SourceActions field={gla} />
          <CascadedInput label="Outgoings p.a. ($)" value={outgoings.value} placeholder="Pulled from NOI / lease data or enter manually" source={outgoings.source} onChange={outgoings.setValue} onVerify={outgoings.markVerified} />
          <SourceActions field={outgoings} />
          </div>
        </div>
        <div className="space-y-3 rounded-2xl border border-primary/15 bg-gradient-to-br from-background/75 to-primary/5 p-4 shadow-inner">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Locked calculated outputs</p>
          {!canCalculateRent && <EmptyState critical={hasZeroDenominator} />}
          <OutputRow label="Net rent / m² p.a." tooltip="Base rent p.a. ÷ GLA m²." value={result ? formatCurrency(result.netRentPerSqmPa) : 'Pending'} tone={benchmarkTone} bold />
          <OutputRow label="Outgoings / m² p.a." tooltip="Outgoings p.a. ÷ GLA m²." value={result ? formatCurrency(result.outgoingsPerSqmPa) : 'Pending'} tone={benchmarkTone} muted />
          <Separator />
          <OutputRow label="Gross rent / m² p.a." tooltip="Base rent p.a. plus outgoings p.a. ÷ GLA m²." value={result ? formatCurrency(result.grossRentPerSqmPa) : 'Pending'} tone={benchmarkTone} highlight />
          <OutputRow label="Benchmark status" value={benchmarkStatus} tone={benchmarkTone} muted />
          <OutputRow label="Report summary" value={canCalculateRent ? (allVerified ? 'Verified for report output.' : 'Preliminary Benchmark — verify inputs before relying on report output.') : 'Pending'} tone={benchmarkTone} muted />
        </div>
      </CardContent>
    </Card>
  );
}

function CascadedInput({ label, value, placeholder, source, onChange, onVerify }: { label: string; value: string; placeholder: string; source: IndustrialMetricSource; onChange: (value: string) => void; onVerify: () => void }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
        <div className="flex items-center gap-1"><SourceBadge source={source} /><button type="button" className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-primary transition hover:bg-primary/10 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={onVerify}>Verify</button></div>
      </div>
      <Input type="text" inputMode="decimal" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="h-11 rounded-xl border-brand-500/30 bg-background/90 shadow-inner transition-all hover:border-brand-400/60 focus-visible:ring-brand-400" />
    </div>
  );
}

function EmptyState({ critical }: { critical: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 text-sm shadow-inner ${critical ? 'border-destructive/30 bg-destructive/10' : 'border-brand-500/30 bg-brand-500/10'}`}>
      <p className={`flex items-center gap-2 font-semibold ${critical ? 'text-destructive' : 'text-brand-200'}`}><AlertTriangle className="h-4 w-4" />{critical ? 'Check Industrial Inputs' : 'Awaiting Industrial Inputs'}</p>
      <p className="text-muted-foreground">{critical ? 'GLA must be greater than zero before rent benchmarks can be calculated.' : 'Import property size, rent, outgoings and price data to calculate industrial benchmarks.'}</p>
    </div>
  );
}

type Tone = 'preliminary' | 'verified' | 'critical';

function OutputRow({ label, value, tooltip, tone, bold, muted, highlight }: { label: string; value: string; tooltip?: string; tone: Tone; bold?: boolean; muted?: boolean; highlight?: boolean }) {
  const toneClass = tone === 'critical' ? 'text-destructive' : tone === 'verified' ? 'text-success' : 'text-brand-300';
  return (
    <div className={`rounded-xl border border-border/50 bg-card/45 px-3 py-2 transition-colors hover:border-primary/25 hover:bg-card/70 flex justify-between items-center gap-4 ${highlight ? 'text-lg font-bold' : bold ? 'font-semibold' : ''} ${muted ? 'text-sm' : ''}`}>
      <span className="flex items-center gap-1 text-muted-foreground">
        <Lock className="h-3 w-3" />
        {label}
        {tooltip && <FormulaTooltip text={tooltip} />}
        <Badge variant="outline" className="ml-1 rounded-full border-primary/20 bg-primary/5 text-[10px]">Calculated</Badge>
      </span>
      <span className={`text-right ${value === 'Pending' ? 'text-muted-foreground' : toneClass}`}>{value}</span>
    </div>
  );
}

function FormulaTooltip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger type="button" className="text-muted-foreground hover:text-foreground"><Info className="h-3 w-3" /></TooltipTrigger>
        <TooltipContent>{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
