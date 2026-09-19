import { useEffect, useMemo } from 'react';
import { AlertTriangle, Info, Lock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useCalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { IndustrialMetricAiWorkflow, type IndustrialMetricAiAction } from './IndustrialMetricAiWorkflow';
import { useIndustrialMetricsReadiness } from './IndustrialMetricsReadinessContext';
import { assessIndustrialBenchmark } from './industrialMetricBenchmarks';
import { formatCurrency, formatPercent, parseMetricNumber, prefillValue, SourceActions, SourceBadge, useCascadedIndustrialField, type IndustrialMetricSource } from './industrialMetricCascade';

type Tone = 'preliminary' | 'verified' | 'critical';

export function SiteCoverCard() {
  const { prefill } = useCalculatorPrefill();
  const { updateField } = useIndustrialMetricsReadiness();

  const gla = useCascadedIndustrialField(prefill, [
    { value: prefill?.glaSqm, source: 'Property Profile' },
    { value: prefillValue(prefill, 'scrapedGlaSqm'), source: 'Scraped' },
    { value: prefillValue(prefill, 'buildingAreaSqm') ?? prefill?.gfaSqm ?? prefill?.nlaSqm, source: 'Property Profile' },
  ]);

  const site = useCascadedIndustrialField(prefill, [
    { value: prefill?.siteAreaSqm, source: 'Property Profile' },
    { value: prefillValue(prefill, 'titleSiteAreaSqm'), source: 'Scraped' },
    { value: prefillValue(prefill, 'scrapedSiteAreaSqm'), source: 'Scraped' },
  ]);

  const hardstand = useCascadedIndustrialField(prefill, [
    { value: prefill?.hardstandSqm, source: 'Property Profile' },
    { value: prefillValue(prefill, 'aiEstimatedHardstandSqm'), source: 'AI Estimate' },
  ]);

  const office = useCascadedIndustrialField(prefill, [
    { value: prefill?.officePct, source: 'Property Profile' },
    { value: prefillValue(prefill, 'aiEstimatedOfficePct'), source: 'AI Estimate' },
  ]);

  const price = useCascadedIndustrialField(prefill, [
    { value: prefill?.purchasePrice, source: 'Property Profile' },
    { value: prefillValue(prefill, 'capRateTabPrice') ?? prefill?.valuation, source: 'Cap Rate Tab' },
    { value: prefillValue(prefill, 'gstTabPurchasePrice'), source: 'GST Tab' },
    { value: prefillValue(prefill, 'borrowingCapacityPurchasePrice'), source: 'Borrowing Capacity' },
    { value: prefillValue(prefill, 'dcfPurchasePrice'), source: 'DCF Tab' },
  ]);


  useEffect(() => {
    updateField('gla', gla.value, gla.source, { originalValue: gla.originalValue, originalSource: gla.originalSource, history: gla.history });
    updateField('siteArea', site.value, site.source, { originalValue: site.originalValue, originalSource: site.originalSource, history: site.history });
    updateField('hardstand', hardstand.value, hardstand.source, { originalValue: hardstand.originalValue, originalSource: hardstand.originalSource, history: hardstand.history });
    updateField('officePct', office.value, office.source, { originalValue: office.originalValue, originalSource: office.originalSource, history: office.history });
    updateField('price', price.value, price.source, { originalValue: price.originalValue, originalSource: price.originalSource, history: price.history });
  }, [gla.value, gla.source, gla.originalValue, gla.originalSource, gla.history, site.value, site.source, site.originalValue, site.originalSource, site.history, hardstand.value, hardstand.source, hardstand.originalValue, hardstand.originalSource, hardstand.history, office.value, office.source, office.originalValue, office.originalSource, office.history, price.value, price.source, price.originalValue, price.originalSource, price.history, updateField]);

  const parsed = useMemo(() => ({
    gla: parseMetricNumber(gla.value),
    site: parseMetricNumber(site.value),
    hardstand: parseMetricNumber(hardstand.value),
    officePct: parseMetricNumber(office.value),
    officeArea: parseMetricNumber(String(prefillValue(prefill, 'officeAreaSqm') ?? '')),
    price: parseMetricNumber(price.value),
  }), [gla.value, site.value, hardstand.value, office.value, price.value, prefill]);

  const hasGlaZero = parsed.gla !== null && parsed.gla <= 0;
  const hasSiteZero = parsed.site !== null && parsed.site <= 0;
  const hasCriticalIssue = hasGlaZero || hasSiteZero;
  const allVerified = [gla.source, site.source, hardstand.source, office.source, price.source].every((source) => source === 'Verified');
  const benchmarkTone: Tone = hasCriticalIssue ? 'critical' : allVerified ? 'verified' : 'preliminary';

  const siteCover = parsed.gla !== null && parsed.site !== null && parsed.site > 0 ? (parsed.gla / parsed.site) * 100 : null;
  const hardstandRatio = parsed.hardstand !== null && parsed.site !== null && parsed.site > 0 ? (parsed.hardstand / parsed.site) * 100 : null;
  const officeRatio = parsed.officeArea !== null && parsed.gla !== null && parsed.gla > 0
    ? (parsed.officeArea / parsed.gla) * 100
    : parsed.officePct;
  const pricePerGla = parsed.price !== null && parsed.gla !== null && parsed.gla > 0 ? parsed.price / parsed.gla : null;
  const pricePerSite = parsed.price !== null && parsed.site !== null && parsed.site > 0 ? parsed.price / parsed.site : null;
  const canCalculateAll = siteCover !== null && hardstandRatio !== null && officeRatio !== null && pricePerGla !== null && pricePerSite !== null;

  const assessment = assessIndustrialBenchmark({
    siteCoverPct: siteCover,
    hardstandRatioPct: hardstandRatio,
    officeRatioPct: officeRatio,
    pricePerSqmGla: pricePerGla,
    pricePerSqmSite: pricePerSite,
    verified: allVerified,
  });
  const coverageBand = canCalculateAll ? assessment.coverageBand : 'Pending';
  const benchmarkStatus = hasCriticalIssue ? 'Critical physical-data issue' : assessment.status;

  const aiActions: IndustrialMetricAiAction[] = [
    {
      id: 'estimate-site-area',
      label: 'Estimate site area from scrape / title',
      buildPreview: () => {
        const candidate = parsed.site ?? prefillValue(prefill, 'titleSiteAreaSqm') ?? prefillValue(prefill, 'scrapedSiteAreaSqm');
        if (!candidate || !prefill) return null;
        return buildPreview('estimate-site-area', 'Estimate site area from scrape / title', String(candidate), `${Math.round(candidate * 0.98).toLocaleString('en-AU')}–${Math.round(candidate * 1.02).toLocaleString('en-AU')} m²`, 'AI Estimate', 'Uses linked title, property profile or scraped site-area references where available.', [`Address ${prefill.address}`, `Site area ${candidate} m²`], ['Current title plan confirmation'], ['Confirm against title, survey or contract before relying on site-based benchmarks.'], site);
      },
    },
    {
      id: 'estimate-hardstand',
      label: 'Estimate hardstand area',
      buildPreview: () => {
        const candidate = parsed.hardstand ?? prefillValue(prefill, 'aiEstimatedHardstandSqm') ?? (parsed.site !== null && parsed.gla !== null ? Number(Math.max(parsed.site - parsed.gla, 0).toFixed(2)) : null);
        if (candidate === null || !prefill) return null;
        return buildPreview('estimate-hardstand', 'Estimate hardstand area', String(candidate), `${Math.round(candidate * 0.8).toLocaleString('en-AU')}–${Math.round(candidate * 1.2).toLocaleString('en-AU')} m²`, 'AI Estimate', 'Uses hardstand profile data, listing/site description or residual site area after building footprint as a preliminary yard proxy.', [`Site area ${parsed.site ?? 'unknown'} m²`, `GLA ${parsed.gla ?? 'unknown'} m²`], ['Measured hardstand plan', 'Hardstand quality and surface condition'], ['Confirm sealed usable yard area and exclude landscaping, easements and unusable circulation.'], hardstand);
      },
    },
    {
      id: 'estimate-office',
      label: 'Estimate office component',
      buildPreview: () => {
        const candidate = parsed.officePct ?? prefillValue(prefill, 'aiEstimatedOfficePct') ?? (parsed.officeArea !== null && parsed.gla !== null && parsed.gla > 0 ? Number(((parsed.officeArea / parsed.gla) * 100).toFixed(2)) : null);
        if (candidate === null || !prefill) return null;
        return buildPreview('estimate-office', 'Estimate office component', String(candidate), `${Math.max(candidate - 2, 0).toFixed(1)}%–${(candidate + 2).toFixed(1)}%`, 'AI Estimate', 'Uses profile office percentage, floor-plan office area or listing/floor-plan context where available.', [`GLA ${parsed.gla ?? 'unknown'} m²`, `Office area ${parsed.officeArea ?? 'unknown'} m²`], ['Measured office area', 'Floor plan split by warehouse and office'], ['Confirm mezzanine and amenities treatment before relying on office ratio.'], office);
      },
    },
    {
      id: 'estimate-price-benchmark',
      label: 'Estimate price per m² benchmark',
      buildPreview: () => {
        if (!prefill || pricePerGla === null || pricePerSite === null) return null;
        return buildPreview('estimate-price-benchmark', 'Estimate price per m² benchmark', `${formatCurrency(pricePerGla, 0)} / m² GLA`, `${formatCurrency(pricePerGla * 0.9, 0)}–${formatCurrency(pricePerGla * 1.1, 0)} / m² GLA`, 'Research Engine', 'Uses purchase price, parsed GLA and site area as a benchmark proxy pending industrial comparable sales evidence.', [`Price ${formatCurrency(parsed.price, 0)}`, `GLA ${parsed.gla} m²`, `Site ${parsed.site} m²`], ['Verified comparable sale set', 'Adjustment for zoning, clearance, access and lease profile'], ['Benchmark should be compared against recent industrial sales evidence before use.']);
      },
    },
    {
      id: 'estimate-site-cover-benchmark',
      label: 'Estimate site cover benchmark',
      buildPreview: () => {
        if (!prefill || siteCover === null) return null;
        return buildPreview('estimate-site-cover-benchmark', 'Estimate site cover benchmark', `${siteCover.toFixed(2)}%`, `${Math.max(siteCover - 5, 0).toFixed(2)}%–${(siteCover + 5).toFixed(2)}%`, 'Research Engine', 'Uses parsed GLA and site area to benchmark site cover against industrial usability expectations.', [`GLA ${parsed.gla} m²`, `Site ${parsed.site} m²`], ['Comparable site cover evidence', 'Truck access and hardstand quality'], ['Review against access, loading, hardstand and zoning before relying on density benchmarks.']);
      },
    },
  ];

  return (
    <Card className="overflow-hidden rounded-3xl border-primary/20 bg-gradient-to-br from-card via-card/95 to-brand-500/5 shadow-lg shadow-primary/5 transition-shadow hover:shadow-xl">
      <CardHeader className="border-b border-border/60 bg-background/30 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Site Cover &amp; $/m²</CardTitle>
            <CardDescription>Enter physical site details and price, then review the locked density and pricing outputs.</CardDescription>
          </div>
          <Badge variant="outline" className="rounded-full border-brand-500/30 bg-brand-500/10 px-3 py-1 text-brand-200 shadow-sm shadow-brand-500/10">Site metrics</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.95fr)] lg:gap-6">
        <div className="space-y-3">
          <IndustrialMetricAiWorkflow actions={aiActions} />
          <div className="rounded-2xl border border-brand-500/20 bg-gradient-to-br from-brand-500/10 to-background/40 p-4 shadow-inner">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-200">Editable inputs</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><CascadedInput label="GLA (m²)" value={gla.value} placeholder="Pulled from property profile or enter manually" source={gla.source} onChange={gla.setValue} onVerify={gla.markVerified} /><SourceActions field={gla} /></div>
            <div><CascadedInput label="Site Area (m²)" value={site.value} placeholder="Pulled from property profile or enter manually" source={site.source} onChange={site.setValue} onVerify={site.markVerified} /><SourceActions field={site} /></div>
            <div><CascadedInput label="Hardstand (m²)" value={hardstand.value} placeholder="Pulled from property profile or enter manually" source={hardstand.source} onChange={hardstand.setValue} onVerify={hardstand.markVerified} /><SourceActions field={hardstand} /></div>
            <div><CascadedInput label="Office (%)" value={office.value} placeholder="Enter office component percentage" source={office.source} onChange={office.setValue} onVerify={office.markVerified} step="0.1" /><SourceActions field={office} /></div>
            <div className="sm:col-span-2"><CascadedInput label="Price ($)" value={price.value} placeholder="Pulled from property profile or enter manually" source={price.source} onChange={price.setValue} onVerify={price.markVerified} /><SourceActions field={price} /></div>
          </div>
          </div>
        </div>
        <div className="space-y-3 rounded-2xl border border-primary/15 bg-gradient-to-br from-background/75 to-primary/5 p-4 shadow-inner">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Locked calculated outputs</p>
          {!canCalculateAll && <EmptyState critical={hasCriticalIssue} />}
          <OutputRow label="Site Cover %" tooltip="GLA m² ÷ site area m²." value={formatPercent(siteCover)} tone={benchmarkTone} bold />
          <div className="flex justify-between items-center gap-4">
            <span className="flex items-center gap-1 text-muted-foreground"><Lock className="h-3 w-3" />Coverage Band<Badge variant="outline" className="ml-1 rounded-full border-primary/20 bg-primary/5 text-[10px]">Calculated</Badge></span>
            {coverageBand === 'Pending' ? <span className="text-muted-foreground text-sm">Pending</span> : <Badge variant="secondary" className="capitalize">{coverageBand}</Badge>}
          </div>
          <OutputRow label="Hardstand Ratio" tooltip="Hardstand m² ÷ site area m²." value={formatPercent(hardstandRatio)} tone={benchmarkTone} muted />
          <OutputRow label="Office %" tooltip="Office area m² ÷ GLA m², or office % where office area is unavailable." value={formatPercent(officeRatio)} tone={benchmarkTone} muted />
          <Separator />
          <OutputRow label="$/m² GLA" tooltip="Purchase price ÷ GLA m²." value={formatCurrency(pricePerGla, 0)} tone={benchmarkTone} />
          <OutputRow label="$/m² Site" tooltip="Purchase price ÷ site area m²." value={formatCurrency(pricePerSite, 0)} tone={benchmarkTone} />
          <OutputRow label="Benchmark status" value={benchmarkStatus} tone={benchmarkTone} muted />
          <OutputRow label="Short explanation" value={canCalculateAll ? assessment.explanation : 'Pending'} tone={benchmarkTone} muted />
          <OutputRow label="Benchmark confidence" value={canCalculateAll ? assessment.confidence : 'Pending'} tone={benchmarkTone} muted />
          <OutputRow label="Verification status" value={canCalculateAll ? assessment.verificationStatus : 'Pending'} tone={benchmarkTone} muted />
          <OutputRow label="Report summary" value={canCalculateAll ? (allVerified ? 'Verified for report output.' : `${assessment.status} — verify inputs before relying on report output.`) : 'Pending'} tone={benchmarkTone} muted />
          {canCalculateAll && <BenchmarkNotes notes={assessment.notes} />}
        </div>
      </CardContent>
    </Card>
  );
}


function buildPreview(actionId: string, label: string, suggestedValue: string, suggestedBenchmarkRange: string, source: 'AI Estimate' | 'Research Engine', sourceBasis: string, dataPointsUsed: string[], missingData: string[], riskNotes: string[], targetField?: ReturnType<typeof useCascadedIndustrialField>) {
  return {
    actionId,
    label,
    suggestedValue,
    suggestedBenchmarkRange,
    confidence: dataPointsUsed.length >= 3 ? 'High' as const : 'Medium' as const,
    source,
    sourceBasis,
    dataPointsUsed: dataPointsUsed.filter(Boolean),
    missingData: missingData.filter(Boolean),
    riskNotes,
    verificationRequirements: ['Verify against property profile, scrape, title/floor plan and relevant industrial comparable evidence before marking as verified.'],
    targetField,
  };
}

function BenchmarkNotes({ notes }: { notes: string[] }) {
  return (
    <details className="rounded-md border border-border/60 bg-background/30 p-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground">View benchmark notes</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        {notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
    </details>
  );
}

function CascadedInput({ label, value, placeholder, source, onChange, onVerify, step }: { label: string; value: string; placeholder: string; source: IndustrialMetricSource; onChange: (value: string) => void; onVerify: () => void; step?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
        <div className="flex items-center gap-1"><SourceBadge source={source} /><button type="button" className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-primary transition hover:bg-primary/10 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={onVerify}>Verify</button></div>
      </div>
      <Input type="text" inputMode="decimal" step={step} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="h-11 rounded-xl border-brand-500/30 bg-background/90 shadow-inner transition-all hover:border-brand-400/60 focus-visible:ring-brand-400" />
    </div>
  );
}

function EmptyState({ critical }: { critical: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 text-sm shadow-inner ${critical ? 'border-destructive/30 bg-destructive/10' : 'border-brand-500/30 bg-brand-500/10'}`}>
      <p className={`flex items-center gap-2 font-semibold ${critical ? 'text-destructive' : 'text-brand-200'}`}><AlertTriangle className="h-4 w-4" />{critical ? 'Check Industrial Inputs' : 'Awaiting Industrial Inputs'}</p>
      <p className="text-muted-foreground">{critical ? 'GLA and site area must be greater than zero before site benchmarks can be calculated.' : 'Import property size, rent, outgoings and price data to calculate industrial benchmarks.'}</p>
    </div>
  );
}

function OutputRow({ label, value, tooltip, tone, bold, muted }: { label: string; value: string; tooltip?: string; tone: Tone; bold?: boolean; muted?: boolean }) {
  const toneClass = tone === 'critical' ? 'text-destructive' : tone === 'verified' ? 'text-success' : 'text-brand-300';
  return (
    <div className={`rounded-xl border border-border/50 bg-card/45 px-3 py-2 transition-colors hover:border-primary/25 hover:bg-card/70 flex justify-between items-center gap-4 ${bold ? 'font-semibold' : ''} ${muted ? 'text-sm' : ''}`}>
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
