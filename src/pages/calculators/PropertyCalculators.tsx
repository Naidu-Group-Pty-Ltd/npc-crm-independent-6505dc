/**
 * PropertyCalculators
 * -------------------
 * Unified Commercial + Industrial calculator suite. Replaces the split
 * /commercial/calculators and /industrial/calculators pages with a single
 * page that exposes every calculator and lets the user pick the asset
 * domain (commercial or industrial) for property prefill.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle, Calculator, CheckCircle2, ChevronDown, CircleDashed, FileText, Link2, RefreshCw, Save, Sparkles, ListChecks, ShieldCheck, SlidersHorizontal, Wand2 } from 'lucide-react';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { NoiCalculatorCard } from '@/components/commercial/calculators/NoiCalculatorCard';
import { CapRateCalculatorCard } from '@/components/commercial/calculators/CapRateCalculatorCard';
import { IcrDscrCalculatorCard } from '@/components/commercial/calculators/IcrDscrCalculatorCard';
import { GstCalculatorCard } from '@/components/commercial/calculators/GstCalculatorCard';
import { DcfCalculatorCard } from '@/components/commercial/calculators/DcfCalculatorCard';
import { TenYearCashFlowCard } from '@/components/commercial/calculators/TenYearCashFlowCard';
import { CommercialBorrowingCapacityCard } from '@/components/commercial/calculators/CommercialBorrowingCapacityCard';
import { CommercialIndustrialOverviewCard } from '@/components/commercial/calculators/CommercialIndustrialOverviewCard';
import { RentPerSqmCard } from '@/components/industrial/calculators/RentPerSqmCard';
import { SiteCoverCard } from '@/components/industrial/calculators/SiteCoverCard';
import { IndustrialMetricsReadinessProvider } from '@/components/industrial/calculators/IndustrialMetricsReadinessContext';
import {
  CalculatorPrefillProvider,
  type CalculatorDomain,
  useCalculatorPrefill,
} from '@/contexts/CalculatorPrefillContext';
import { CalculatorPropertyBar } from '@/components/commercial/CalculatorPropertyBar';
import { CalculatorGuidancePanel, CalculatorTabShell } from '@/components/commercial/calculators/CalculatorLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useCommercialDealState } from '@/utils/commercial/commercialDealState';


type AssumptionGroup = 'Property' | 'Income / NOI' | 'Valuation / Cap Rate' | 'Lending / Debt' | 'GST / Acquisition' | 'DCF / Forecasting' | '10-Year Cash Flow' | 'Industrial Metrics' | 'Report Outputs';
type AssumptionFilter = 'All' | 'Missing' | 'AI Estimated' | 'Manual Overrides' | 'Specialist Review Required' | 'Verified' | 'Used in Report';
interface GlobalAssumptionRow { group: AssumptionGroup; field: string; value: unknown; source: string; confidence: string; verification: string; aiEstimated: boolean; manuallyOverridden: boolean; requiredForCalculation: boolean; requiredForReportExport: boolean; lastUpdated: string; warningStatus: string; }

const assumptionFilters: AssumptionFilter[] = ['All', 'Missing', 'AI Estimated', 'Manual Overrides', 'Specialist Review Required', 'Verified', 'Used in Report'];
const requiredCalculationHints = ['purchasePrice', 'estimatedMarketValue', 'grossPassingRent', 'marketRent', 'vacancyAllowancePct', 'contractInterestRatePct', 'loanTermYears', 'maxLvr', 'minIcr', 'minDscr', 'treatment', 'initialNoi', 'terminalCapRatePct', 'discountRatePct'];
const requiredReportHints = ['purchasePrice', 'estimatedMarketValue', 'actualNoi', 'stabilisedNoi', 'lenderAdjustedNoi', 'capitalisationRate', 'icr', 'dscr', 'debtYield', 'gstEconomicCost', 'netAcquisitionCost', 'leveredIrr', 'unleveredIrr', 'equityMultiple', 'siteCover', 'rentPerSqm'];

function flattenAssumptionObject(group: AssumptionGroup, label: string, value: unknown, rows: GlobalAssumptionRow[], registry: Record<string, any>) {
  if (value == null) return;
  if (typeof value === 'object' && !Array.isArray(value)) {
    Object.entries(value as Record<string, unknown>).forEach(([key, nestedValue]) => flattenAssumptionObject(group, key, nestedValue, rows, registry));
    return;
  }
  const assumption = registry[label] ?? registry[`${group}.${label}`] ?? Object.values(registry).find((item: any) => item?.fieldKey?.endsWith?.(`.${label}`));
  const source = assumption?.sourceDetail || assumption?.source || (value === '' ? 'Blank' : 'Manual');
  const confidence = assumption?.confidenceTag || (source === 'Blank' ? 'Blank' : 'Manual');
  const verification = assumption?.verificationRequired ? 'Review Required' : confidence === 'Verified' || source === 'Verified' ? 'Verified' : value === '' ? 'Missing' : 'Pending';
  rows.push({
    group,
    field: label,
    value,
    source,
    confidence,
    verification,
    aiEstimated: source === 'ai' || source === 'AI Estimate' || confidence === 'AI Estimate',
    manuallyOverridden: source === 'manual' || source === 'Manual' || source === 'User Override',
    requiredForCalculation: requiredCalculationHints.some((hint) => label.toLowerCase().includes(hint.toLowerCase())),
    requiredForReportExport: requiredReportHints.some((hint) => label.toLowerCase().includes(hint.toLowerCase())),
    lastUpdated: assumption?.updatedAt || 'Pending',
    warningStatus: assumption?.verificationRequired ? 'Review Required' : value === '' ? 'Missing' : 'Clear',
  });
}

function formatAssumptionValue(value: unknown) {
  if (value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value))) return 'Pending';
  if (typeof value === 'number') return Math.abs(value) >= 1000 ? value.toLocaleString('en-AU') : String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? `${value.length} item(s)` : 'Pending';
  return String(value);
}

function buildGlobalAssumptionRows(profile: any): GlobalAssumptionRow[] {
  const rows: GlobalAssumptionRow[] = [];
  const registry = profile.assumptions ?? {};
  const sections: Array<[AssumptionGroup, Record<string, unknown>]> = [
    ['Property', { ...profile.dealProfile, ...profile.propertyValuation, ...profile.purchaserStructure }],
    ['Income / NOI', { ...profile.leaseIncome, ...profile.operatingExpenses, ...profile.noiOutputs }],
    ['Valuation / Cap Rate', { ...profile.capRateOutputs }],
    ['Lending / Debt', { ...profile.debtInputs, ...profile.lendingAssumptions, borrowingCapacity: profile.borrowingOutputs?.finalRiskAdjustedLoan, icr: profile.borrowingOutputs?.icr, dscr: profile.borrowingOutputs?.dscr, debtYield: profile.borrowingOutputs?.debtYield }],
    ['GST / Acquisition', { ...profile.gstInputs, ...profile.acquisitionCosts, ...profile.gstOutputs, ...profile.fundsToComplete }],
    ['DCF / Forecasting', { ...profile.dcfInputs, ...profile.dcfOutputs }],
    ['10-Year Cash Flow', { ...(profile.tenYearCashFlowOutputs?.summary ?? {}) }],
    ['Industrial Metrics', { ...profile.industrialMetrics }],
    ['Report Outputs', { reportPayload: profile.reportPayload ? 'Prepared' : '', ...profile.riskOutputs, clientScenario: profile.clientScenarioOutputs?.scenarioName }],
  ];
  sections.forEach(([group, section]) => {
    if (Object.keys(section).length === 0) rows.push({ group, field: 'No assumptions captured', value: '', source: 'Blank', confidence: 'Blank', verification: 'Missing', aiEstimated: false, manuallyOverridden: false, requiredForCalculation: false, requiredForReportExport: false, lastUpdated: 'Pending', warningStatus: 'Missing' });
    Object.entries(section).forEach(([key, value]) => flattenAssumptionObject(group, key, value, rows, registry));
  });
  return rows;
}


function getSourceBadgeClass(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes('ai')) return 'ci-source-ai';
  if (normalized.includes('manual') || normalized.includes('override')) return 'ci-source-manual';
  if (normalized.includes('scrape') || normalized.includes('research')) return 'ci-source-scraped';
  if (normalized.includes('verified') || normalized.includes('calculated')) return 'ci-source-calculated';
  if (normalized.includes('linked') || normalized.includes('property profile')) return 'ci-source-linked';
  if (normalized.includes('blank') || normalized.includes('unknown') || normalized.includes('pending')) return 'ci-source-pending';
  return 'ci-source-neutral';
}

function SourceBadge({ value }: { value: string }) {
  return <span className={`ci-source-badge ${getSourceBadgeClass(value)}`}>{value}</span>;
}

function MiniProgress({ value, label }: { value: number; label: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground"><span>{label}</span><span>{value}%</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-muted/60"><div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
    </div>
  );
}

function GlobalAssumptionStatusDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const profile = useCommercialDealState(s => s.profile);
  const [filter, setFilter] = useState<AssumptionFilter>('All');
  const rows = useMemo(() => buildGlobalAssumptionRows(profile), [profile]);
  const filteredRows = rows.filter(row => {
    if (filter === 'Missing') return formatAssumptionValue(row.value) === 'Pending' || row.verification === 'Missing';
    if (filter === 'AI Estimated') return row.aiEstimated;
    if (filter === 'Manual Overrides') return row.manuallyOverridden;
    if (filter === 'Specialist Review Required') return row.verification === 'Review Required' || row.warningStatus === 'Review Required';
    if (filter === 'Verified') return row.verification === 'Verified';
    if (filter === 'Used in Report') return row.requiredForReportExport;
    return true;
  });
  const grouped = filteredRows.reduce<Record<string, GlobalAssumptionRow[]>>((acc, row) => ({ ...acc, [row.group]: [...(acc[row.group] ?? []), row] }), {});

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="ci-foundation w-full overflow-y-auto sm:max-w-6xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><ListChecks className="h-5 w-5 text-primary" /> Global Assumption Status</SheetTitle>
          <SheetDescription>Central validation workspace for the full commercial / industrial assessment. Source badges use one visual language for manual, scraped, AI-derived, linked, overridden and calculated assumptions.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex flex-wrap gap-2">
          {assumptionFilters.map(item => <Button key={item} size="sm" variant={filter === item ? 'default' : 'outline'} onClick={() => setFilter(item)}>{item}</Button>)}
        </div>
        <div className="mt-4 space-y-5">
          {Object.entries(grouped).map(([group, groupRows]) => (
            <div key={group} className="ci-card p-3">
              <div className="mb-2 flex items-center justify-between gap-2"><h3 className="font-semibold text-foreground">{group}</h3><Badge variant="outline">{groupRows.length} assumption(s)</Badge></div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-xs">
                  <thead className="text-muted-foreground"><tr>{['Assumption','Value','Source','Confidence','Verification','AI','Override','Calc req.','Report req.','Last updated','Warning'].map(header => <th key={header} className="border-b px-2 py-2 font-medium">{header}</th>)}</tr></thead>
                  <tbody>{groupRows.map((row, index) => <tr key={`${row.group}-${row.field}-${index}`} className="border-b last:border-0 transition-colors hover:bg-primary/5"><td className="px-2 py-2 font-medium text-foreground">{row.field}</td><td className="px-2 py-2">{formatAssumptionValue(row.value)}</td><td className="px-2 py-2"><SourceBadge value={row.source} /></td><td className="px-2 py-2"><SourceBadge value={row.confidence} /></td><td className="px-2 py-2"><SourceBadge value={row.verification} /></td><td className="px-2 py-2">{row.aiEstimated ? 'Yes' : 'No'}</td><td className="px-2 py-2">{row.manuallyOverridden ? 'Yes' : 'No'}</td><td className="px-2 py-2">{row.requiredForCalculation ? 'Yes' : 'No'}</td><td className="px-2 py-2">{row.requiredForReportExport ? 'Yes' : 'No'}</td><td className="px-2 py-2">{row.lastUpdated}</td><td className="px-2 py-2"><SourceBadge value={row.warningStatus} /></td></tr>)}</tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}


function dispatchCalculatorSuiteEvent(name: string, detail: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail: { timestamp: new Date().toISOString(), ...detail } }));
}

function estimateTargetSection(fieldKey: string): any {
  if (fieldKey.includes('noi') || fieldKey.includes('lease') || fieldKey.includes('rent')) return 'leaseIncome';
  if (fieldKey.includes('capRate') || fieldKey.includes('valuation')) return 'propertyValuation';
  if (fieldKey.includes('gst')) return 'gstInputs';
  if (fieldKey.includes('dcf')) return 'dcfInputs';
  if (fieldKey.includes('industrial')) return 'industrialMetrics';
  if (fieldKey.includes('lending') || fieldKey.includes('debt')) return 'lendingAssumptions';
  return 'riskInputs';
}


type ReportReadinessStatus =
  | 'Awaiting Property'
  | 'Missing Critical Inputs'
  | 'AI Estimates Pending Review'
  | 'Calculations Ready'
  | 'Calculations Out of Date'
  | 'Report Review Required'
  | 'PDF Ready'
  | 'Report Generated'
  | 'Verified';
interface ReportReadiness {
  status: ReportReadinessStatus;
  pdfDisabled: boolean;
  allowWithWarning: boolean;
  blockingReasons: string[];
  warningReasons: string[];
  requiredSections: string[];
}
const reportSectionsRequired = [
  'Property summary',
  'Assumption summary',
  'Source and confidence summary',
  'Key warnings',
  'Calculator outputs',
  '10-year cashflow table',
  'Commentary',
  'Scenario notes',
  'Disclaimer / review note',
];

function hasMeaningfulValue(value: unknown) {
  return (
    value !== undefined
    && value !== null
    && value !== ''
    && !(typeof value === 'number' && !Number.isFinite(value))
  );
}

function calculateReportReadiness(
  profile: any,
  propertyLinked: boolean,
  calculationsGenerated: boolean,
  calculationsOutOfDate: boolean,
  reportGenerated: boolean,
  verified: boolean
): ReportReadiness {
  const pendingAi = Object.values(profile.aiEstimateMetadata ?? {}).some((estimate: any) => !estimate?.accepted);
  const aiIncluded = Object.values(profile.aiEstimateMetadata ?? {}).some((estimate: any) => estimate?.accepted);
  const manualOverrides = Object.values(profile.scenarioOverrides ?? {}).some(
    (override: any) => override && Object.keys(override).length > 0
  );
  const specialistGstReview = ['unknown', undefined, null, ''].includes((profile.gstInputs as any)?.treatment)
    || ['unknown', undefined, null, ''].includes((profile.acquisitionCosts as any)?.gstTreatment);
  const externalVerificationIncomplete = Object.values(profile.documentVerificationStatus ?? {}).some(
    status => !['verified', 'reviewed', 'not applicable'].includes(String(status))
  );
  const criticalMissing = [
    ['Property value / purchase price', (profile.propertyValuation as any)?.purchasePrice ?? (profile.propertyValuation as any)?.estimatedMarketValue],
    ['NOI', (profile.noiOutputs as any)?.actualNoi ?? (profile.noiOutputs as any)?.lenderAdjustedNoi ?? (profile.leaseIncome as any)?.grossPassingRent],
    ['Lending assumptions', (profile.lendingAssumptions as any)?.contractInterestRatePct ?? (profile.lendingAssumptions as any)?.maxLvr],
  ].filter(([, value]) => !hasMeaningfulValue(value)).map(([label]) => String(label));
  const tenYearGenerated = Boolean(profile.tenYearCashFlowOutputs?.years?.length || profile.tenYearCashFlowOutputs?.summary);
  const criticalWarnings = [
    ...((profile.borrowingOutputs as any)?.warnings ?? []),
    ...((profile.dcfOutputs as any)?.warnings ?? []),
    ...((profile.gstOutputs as any)?.warnings ?? []),
  ].filter((warning: unknown) => /critical|required|specialist|missing|unresolved/i.test(String(warning)));
  const blockingReasons = [
    !propertyLinked && 'No property is linked',
    ...criticalMissing.map(item => `Missing critical input: ${item}`),
    !calculationsGenerated && 'Calculated outputs have not been generated',
    calculationsOutOfDate && 'Calculations are out of date',
    !tenYearGenerated && '10-Year Cash Flow has not been generated',
    criticalWarnings.length > 0 && 'Critical warnings are unresolved',
  ].filter(Boolean) as string[];
  const warningReasons = [
    aiIncluded && 'AI estimates are included',
    manualOverrides && 'Manual overrides are active',
    specialistGstReview && 'Tax/GST assumptions require specialist review',
    externalVerificationIncomplete && 'External verification has not been completed',
  ].filter(Boolean) as string[];
  const pdfDisabled = blockingReasons.length > 0;
  const allowWithWarning = !pdfDisabled && warningReasons.length > 0;
  const status: ReportReadinessStatus = !propertyLinked
    ? 'Awaiting Property'
    : criticalMissing.length > 0
      ? 'Missing Critical Inputs'
      : pendingAi
        ? 'AI Estimates Pending Review'
        : calculationsOutOfDate
          ? 'Calculations Out of Date'
          : !calculationsGenerated
            ? 'Calculations Ready'
            : pdfDisabled
              ? 'Report Review Required'
              : verified
                ? 'Verified'
                : reportGenerated
                  ? 'Report Generated'
                  : 'PDF Ready';
  return { status, pdfDisabled, allowWithWarning, blockingReasons, warningReasons, requiredSections: reportSectionsRequired };
}

function GlobalGenerationControls({ propertyLinked }: { propertyLinked: boolean }) {
  const profile = useCommercialDealState(s => s.profile);
  const acceptAiEstimateIntoGlobal = useCommercialDealState(s => s.acceptAiEstimateIntoGlobal);
  const [status, setStatus] = useState('Awaiting Inputs');
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [outOfDate, setOutOfDate] = useState(false);
  const [reportGeneratedAt, setReportGeneratedAt] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [signature, setSignature] = useState('');
  const acceptedEstimates = Object.values(profile.aiEstimateMetadata ?? {}).filter((estimate: any) => estimate?.accepted);
  const pendingEstimateCount = Object.values(profile.aiEstimateMetadata ?? {}).filter((estimate: any) => !estimate?.accepted).length;
  const currentSignature = useMemo(
    () => JSON.stringify({ assumptions: profile.assumptions, overrides: profile.scenarioOverrides, ai: profile.aiEstimateMetadata }),
    [profile.assumptions, profile.scenarioOverrides, profile.aiEstimateMetadata]
  );
  const reportReadiness = useMemo(
    () => calculateReportReadiness(profile, propertyLinked, Boolean(lastRunAt), outOfDate, Boolean(reportGeneratedAt), verified),
    [profile, propertyLinked, lastRunAt, outOfDate, reportGeneratedAt, verified]
  );

  useEffect(() => {
    if (!lastRunAt) { setSignature(currentSignature); return; }
    if (signature && signature !== currentSignature) {
      setOutOfDate(true);
      setReportGeneratedAt(null);
      setVerified(false);
      setStatus('Out of Date');
    }
  }, [currentSignature, lastRunAt, signature]);

  const runAiEstimates = () => {
    setStatus('AI Estimate Preview Pending');
    dispatchCalculatorSuiteEvent('commercial-calculators-run-ai-estimates', { propertyLinked });
  };

  const applyAccepted = () => {
    acceptedEstimates.forEach((estimate: any) => acceptAiEstimateIntoGlobal(estimate, estimateTargetSection(estimate.fieldKey), estimate.fieldKey.split('.').pop()));
    setStatus(acceptedEstimates.length ? 'Accepted Assumptions Applied' : 'No Accepted Assumptions');
    setOutOfDate(true);
    dispatchCalculatorSuiteEvent('commercial-calculators-assumptions-applied', { count: acceptedEstimates.length });
  };

  const refreshLinkedTabs = () => {
    setStatus('Linked Tabs Refreshed');
    dispatchCalculatorSuiteEvent('commercial-calculators-refresh-linked-tabs');
  };

  const generateCalculations = () => {
    const timestamp = new Date().toISOString();
    setLastRunAt(timestamp);
    setSignature(currentSignature);
    setOutOfDate(false);
    setStatus('Calculated');
    dispatchCalculatorSuiteEvent('commercial-calculators-generate-calculations');
  };

  const generateTenYear = () => {
    if (outOfDate) { setStatus('Review Required'); return; }
    setStatus('10-Year Cash Flow Requested');
    dispatchCalculatorSuiteEvent('commercial-calculators-generate-ten-year-cash-flow');
  };

  const generateReport = () => {
    if (reportReadiness.pdfDisabled) { setStatus('Report Review Required'); return; }
    const warningText = reportReadiness.allowWithWarning ? `\n\nWarnings:\n- ${reportReadiness.warningReasons.join('\n- ')}` : '';
    if (typeof window !== 'undefined' && !window.confirm(`Generate report using the current calculated outputs?${warningText}`)) return;
    const timestamp = new Date().toISOString();
    setReportGeneratedAt(timestamp);
    setVerified(false);
    setStatus('Report Generated');
    dispatchCalculatorSuiteEvent('commercial-calculators-generate-report', { sections: reportReadiness.requiredSections });
  };

  const markVerified = () => {
    if (!reportGeneratedAt) { setStatus('Report Review Required'); return; }
    setVerified(true);
    setStatus('Verified');
  };

  return (
    <div className={`rounded-2xl border p-4 shadow-sm transition-colors ${outOfDate ? 'border-brand-500/40 bg-brand-500/10' : 'border-primary/20 bg-card/90'}`}>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <SlidersHorizontal className="h-4 w-4" />
              </span>
              <h2 className="text-base font-semibold text-foreground">Global Generation Controls</h2>
            </div>
            <p className="max-w-4xl text-sm leading-6 text-muted-foreground">Run AI estimates as previews, apply accepted assumptions into the Master Property Context, refresh linked tabs, regenerate calculations, then explicitly generate cash flow and report outputs.</p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Badge variant={reportReadiness.pdfDisabled ? 'secondary' : 'default'} className="px-2.5 py-1">{reportReadiness.status}</Badge>
            <Badge variant={outOfDate ? 'secondary' : 'outline'} className="px-2.5 py-1">{status}</Badge>
            {lastRunAt && <Badge variant="outline" className="px-2.5 py-1">Last calculated {new Date(lastRunAt).toLocaleString('en-AU')}</Badge>}
            {reportGeneratedAt && <Badge variant="outline" className="px-2.5 py-1">Report generated {new Date(reportGeneratedAt).toLocaleString('en-AU')}</Badge>}
          </div>
        </div>

        <div className="grid gap-2 rounded-xl border border-border/60 bg-background/45 p-3 text-xs text-muted-foreground md:grid-cols-2">
          <p className="leading-5">Accepted AI estimates: <span className="font-medium text-foreground">{acceptedEstimates.length}</span> · Pending estimate previews: <span className="font-medium text-foreground">{pendingEstimateCount}</span> · {outOfDate ? 'Assumptions changed after calculation — regenerate before PDF/report output.' : 'Report outputs will not update without confirmation.'}</p>
          <p className={`leading-5 ${reportReadiness.pdfDisabled || reportReadiness.allowWithWarning ? 'text-brand-700 dark:text-brand-200' : ''}`}>
            {reportReadiness.pdfDisabled
              ? `PDF disabled: ${reportReadiness.blockingReasons.join('; ')}`
              : reportReadiness.allowWithWarning
                ? `PDF allowed with warning: ${reportReadiness.warningReasons.join('; ')}`
                : 'PDF ready when report content is confirmed.'}
          </p>
          <p className="rounded-lg border border-primary/15 bg-background/70 px-3 py-2 font-medium leading-5 text-foreground shadow-sm md:col-span-2">Report includes: {reportReadiness.requiredSections.join(', ')}.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-border/60 bg-background/55 p-3">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Wand2 className="h-3.5 w-3.5" /> AI / assumption preparation</div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={runAiEstimates}>Run AI Estimates</Button>
              <Button type="button" size="sm" variant="outline" onClick={applyAccepted}>Apply Accepted Assumptions</Button>
              <Button type="button" size="sm" variant="outline" onClick={refreshLinkedTabs}>Refresh All Linked Tabs</Button>
            </div>
          </div>
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><Calculator className="h-3.5 w-3.5" /> Calculation generation</div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" className="min-h-9 rounded-xl shadow-sm" onClick={generateCalculations}>Generate Calculations</Button>
              <Button type="button" size="sm" variant="outline" className="min-h-9 rounded-xl bg-background/80 shadow-sm disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground disabled:opacity-100" disabled={outOfDate} onClick={generateTenYear}>Generate 10-Year Cash Flow</Button>
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/55 p-3">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><FileText className="h-3.5 w-3.5" /> Report generation</div>
            <Button type="button" size="sm" variant={reportReadiness.allowWithWarning ? 'secondary' : 'default'} className="min-h-10 rounded-xl shadow-sm disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground disabled:opacity-100" disabled={reportReadiness.pdfDisabled} onClick={generateReport}>Generate Report</Button>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/55 p-3">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Verification</div>
            <Button type="button" size="sm" variant="outline" className="min-h-10 rounded-xl bg-background/80 shadow-sm disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground disabled:opacity-100" disabled={!reportGeneratedAt} onClick={markVerified}>Mark Verified</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GstTreatmentOverviewPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-primary/20 bg-card/80 p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">GST Treatment Overview</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            A compact check of GST treatment, settlement cashflow, ITC claimability and net acquisition cost for commercial and industrial acquisitions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">Cashflow</Badge>
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">Claimability</Badge>
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">Verification</Badge>
        </div>
      </div>
      <Collapsible open={open} onOpenChange={setOpen} className="mt-3 border-t border-border/60 pt-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-0 text-primary hover:bg-transparent hover:text-primary/80">
            Why this matters
            <ChevronDown className={`ml-1 h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pb-1 text-xs leading-5 text-muted-foreground">
          <p>
            GST may increase settlement cashflow even where it is later claimable. Going concern treatment may remove GST from settlement if conditions are met, but it must be verified. Unknown GST treatment should be treated as a specialist review item.
          </p>
          <div className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
            <p>
              This output is an estimate only and must be confirmed against the contract of sale, tax invoice, GST clauses, purchaser GST registration status and solicitor/accountant advice before being relied upon.
            </p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>GST payable at settlement</li>
              <li>GST potentially claimable as an input tax credit</li>
              <li>GST settlement cashflow impact</li>
              <li>GST economic cost after claimability</li>
              <li>Net acquisition cost used for reporting and scenario modelling</li>
            </ol>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function DcfOverviewPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-primary/20 bg-card/80 p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">Discounted Cash Flow Overview</h2>
          <div className="max-w-4xl space-y-2 text-sm leading-6 text-muted-foreground">
            <p>
              This section forecasts the expected cashflow and exit value of a commercial or industrial property over the selected hold period. It uses rental income, vacancy, capex, acquisition costs, debt assumptions and exit cap rate assumptions to estimate the investment’s return profile.
            </p>
            <p>
              The DCF model helps assess whether the asset produces sufficient cashflow and capital return over time, rather than only looking at the purchase price, yield or borrowing capacity at acquisition.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs md:justify-end">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">Cashflow forecast</Badge>
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">Exit value</Badge>
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">Return profile</Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-border/60 pt-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">This calculator separates:</p>
          <ol className="mt-1 grid list-decimal gap-1 pl-5 text-xs leading-5 sm:grid-cols-2">
            <li>Year-by-year operating cashflow</li>
            <li>Capex and downtime impacts</li>
            <li>Unlevered return before debt</li>
            <li>Levered return after debt</li>
            <li>Terminal value at exit</li>
            <li>Net sale proceeds to equity</li>
            <li>NPV, IRR and equity multiple</li>
            <li>Sensitivity to exit cap rate and key assumptions</li>
          </ol>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          The output is a forecast only and should be reviewed against lease assumptions, market rent growth, vacancy expectations, capex requirements, funding costs and exit yield evidence before being relied upon in a client report.
        </p>
      </div>
      <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-0 text-primary hover:bg-transparent hover:text-primary/80">
            Why this matters
            <ChevronDown className={`ml-1 h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pb-1 text-xs leading-5 text-muted-foreground">
          DCF is important because a commercial or industrial asset may appear attractive on yield alone, but returns can change materially once downtime, capex, debt service, exit cap rate and sale costs are included. This model helps compare base, conservative and upside scenarios before presenting the asset to a client.
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function IndustrialMetricsOverviewPanel() {
  const [open, setOpen] = useState(false);

  const premiumSections = [
    'Asset profile',
    'Physical metrics',
    'Rent and value benchmarks',
    'Site efficiency',
    'Industrial capability indicators',
    'Warnings / missing data',
    'Outputs / report-ready summary',
  ];

  return (
    <div className="overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-card via-card/90 to-primary/5 p-4 shadow-lg shadow-primary/5 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-5xl space-y-2">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Industrial Metrics Overview</h2>
          <div className="space-y-2 text-sm leading-6 text-muted-foreground">
            <p>
              This section reviews the physical efficiency and industrial usability of the asset. It converts rent, building area, site area, hardstand, office component and purchase price into practical industrial benchmarks.
            </p>
            <p>
              These metrics help assess whether the asset is appropriately priced, efficiently improved, suitable for the intended industrial use and comparable against market evidence.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs lg:justify-end">
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">Physical efficiency</Badge>
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">Market benchmarks</Badge>
          <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">Industrial usability</Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-border/60 pt-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">This tab separates:</p>
          <ol className="mt-1 grid list-decimal gap-1 pl-5 text-xs leading-5 sm:grid-cols-2">
            <li>Rent per m² of lettable industrial area</li>
            <li>Gross rent per m² including outgoings</li>
            <li>Site cover and hardstand ratio</li>
            <li>Office component ratio</li>
            <li>Price per m² of building area</li>
            <li>Price per m² of land / site</li>
            <li>Benchmark status and report-ready commentary</li>
          </ol>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          These outputs are physical and market benchmarks only. They should be reviewed against zoning, access, loading, clearance height, power, hardstand quality, lease structure and comparable industrial evidence before being relied upon.
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {premiumSections.map((section) => (
          <div key={section} className="rounded-2xl border border-border/60 bg-background/45 px-3 py-2 text-xs font-semibold text-foreground shadow-inner">
            {section}
          </div>
        ))}
      </div>

      <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-0 text-primary hover:bg-transparent hover:text-primary/80">
            Why this matters
            <ChevronDown className={`ml-1 h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pb-1 text-xs leading-5 text-muted-foreground">
          Industrial assets can look attractive on income alone but may be inefficient if the site cover, hardstand, office ratio or price per m² is outside normal market expectations. These metrics help users quickly understand whether the asset is physically and commercially practical.
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

const calculatorTabs = [
  { value: 'overview', label: 'Overview', subLabel: '(Report)' },
  { value: 'borrowing', label: 'Borrowing Capacity', subLabel: '(Unified)' },
  { value: 'noi', label: 'Net Operating Income', subLabel: '(NOI)' },
  { value: 'cap', label: 'Capitalisation Rate', subLabel: '(Cap Rate)' },
  { value: 'icr', label: 'Interest / Debt Service Coverage', subLabel: '(ICR / DSCR)' },
  { value: 'gst', label: 'Goods & Services Tax', subLabel: '(GST)' },
  { value: 'dcf', label: 'Discounted Cash Flow', subLabel: '(DCF)' },
  { value: 'ten-year', label: '10-Year Cash Flow', subLabel: '(Report)' },
  { value: 'rent', label: 'Industrial Metrics', subLabel: '($/m² + Site Cover)' },
] as const;

const calculatorTabGroups: Array<{ group: string; tabs: Array<(typeof calculatorTabs)[number]['value']> }> = [
  { group: 'Property & Overview', tabs: ['overview', 'rent'] },
  { group: 'Income & Valuation', tabs: ['noi', 'cap'] },
  { group: 'Lending & Tax', tabs: ['borrowing', 'icr', 'gst'] },
  { group: 'Forecasting & Reports', tabs: ['dcf', 'ten-year'] },
];

const tabByValue = Object.fromEntries(calculatorTabs.map(tab => [tab.value, tab])) as Record<(typeof calculatorTabs)[number]['value'], (typeof calculatorTabs)[number]>;

export default function PropertyCalculators() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Domain is sticky via ?domain= so links from detail pages land on the right context.
  const initialDomain: CalculatorDomain = useMemo(() => {
    const q = searchParams.get('domain');
    return q === 'industrial' ? 'industrial' : 'commercial';
  }, []);
  const [domain, setDomain] = useState<CalculatorDomain>(initialDomain);

  useEffect(() => {
    setSearchParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('domain', domain);
        return n;
      },
      { replace: true },
    );
  }, [domain, setSearchParams]);

  return (
    // Re-mount the provider when domain changes so prefill/property reload cleanly.
    <CalculatorPrefillProvider key={domain} domain={domain}>
      <CalculatorSuiteContent domain={domain} setDomain={setDomain} />
    </CalculatorPrefillProvider>
  );
}

function CalculatorSuiteContent({ domain, setDomain }: { domain: CalculatorDomain; setDomain: (domain: CalculatorDomain) => void }) {
  const { prefill } = useCalculatorPrefill();
  const profile = useCommercialDealState(s => s.profile);
  const [activeTab, setActiveTab] = useState<(typeof calculatorTabs)[number]['value']>('overview');
  const [assumptionDrawerOpen, setAssumptionDrawerOpen] = useState(false);
  const assumptionRows = useMemo(() => buildGlobalAssumptionRows(profile), [profile]);
  const missingCount = assumptionRows.filter(row => formatAssumptionValue(row.value) === 'Pending' || row.verification === 'Missing').length;
  const aiPendingCount = Object.values(profile.aiEstimateMetadata ?? {}).filter((estimate: any) => !estimate?.accepted).length;
  const aiAcceptedCount = Object.values(profile.aiEstimateMetadata ?? {}).filter((estimate: any) => estimate?.accepted).length;
  const overrideCount = assumptionRows.filter(row => row.manuallyOverridden).length;
  const readinessPercent = prefill ? Math.max(10, Math.round(((assumptionRows.length - missingCount) / Math.max(assumptionRows.length, 1)) * 100)) : 0;
  const nextBestAction = !prefill ? 'Link a property to prefill every calculator.' : missingCount > 0 ? 'Review incomplete inputs and missing assumptions.' : aiPendingCount > 0 ? 'Accept or reject pending AI estimates.' : overrideCount > 0 ? 'Review manual overrides before reporting.' : 'Generate calculations, then prepare report output.';
  const assumptionStatusAction = <Button type="button" variant="outline" size="sm" className="ci-assumption-status-button" onClick={() => setAssumptionDrawerOpen(true)}><ListChecks className="mr-2 h-4 w-4" />Assumption Status</Button>;
  const visibleTabGroups = calculatorTabGroups.map(group => ({
    ...group,
    tabs: group.tabs.filter(value => domain === 'industrial' || value !== 'rent'),
  }));

  useEffect(() => {
    const handler = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab;
      if (calculatorTabs.some((item) => item.value === tab) && (domain === 'industrial' || tab !== 'rent')) {
        setActiveTab(tab as (typeof calculatorTabs)[number]['value']);
      }
    };
    window.addEventListener('calculator-tab-open', handler);
    return () => window.removeEventListener('calculator-tab-open', handler);
  }, [domain]);

  const blockedTab = (title: string) => (
    <CalculatorTabShell title={title} subtitle="Link a saved commercial or industrial property before reviewing calculated tab outputs." chips={[domain === 'industrial' ? 'Industrial domain' : 'Commercial domain', 'Property required']}>
      <NoLinkedPropertyPanel domain={domain} />
    </CalculatorTabShell>
  );

  return (
      <>
      <GlobalAssumptionStatusDrawer open={assumptionDrawerOpen} onOpenChange={setAssumptionDrawerOpen} />
      <div className="ci-foundation ci-page-shell">
        <div className="mx-auto w-full max-w-7xl space-y-6">
        <div className="ci-hero ci-suite-header">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-4xl space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-primary shadow-sm shadow-primary/10">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Calculator command centre
              </div>
              <div className="space-y-3">
                <h1 className="ci-section-title">
                  <span className="ci-header-icon"><Calculator className="h-7 w-7" /></span>
                  Commercial &amp; Industrial Calculators
                </h1>
                <p className="ci-section-description">
                  Borrowing capacity, NOI, cap rate, ICR/DSCR, GST, DCF, $/m² rent
                  and site cover — one suite for both asset classes. Pick a domain,
                  link a saved property to prefill every tab, then push results
                  back when you&apos;re happy.
                </p>
              </div>
            </div>
            <div className="ci-panel ci-domain-panel w-full shrink-0 lg:w-[22rem]">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Property domain
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">
                    {domain === 'industrial' ? 'Industrial' : 'Commercial'} active
                  </div>
                </div>
                <Badge variant="outline" className="border-primary/35 bg-primary/10 text-primary">
                  {domain === 'industrial' ? 'Industrial' : 'Commercial'}
                </Badge>
              </div>
              <ToggleGroup
                type="single"
                value={domain}
                onValueChange={(v) => {
                  if (!v) return;
                  if (v === 'commercial' && activeTab === 'rent') setActiveTab('overview');
                  setDomain(v as CalculatorDomain);
                }}
                className="ci-domain-toggle"
              >
                <ToggleGroupItem value="commercial" className="ci-domain-toggle-item">
                  Commercial
                </ToggleGroupItem>
                <ToggleGroupItem value="industrial" className="ci-domain-toggle-item">
                  Industrial
                </ToggleGroupItem>
              </ToggleGroup>
              <div className="mt-4">{assumptionStatusAction}</div>
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-1">
          <ActivePropertyHeader />
          <CalculatorPropertyBar />
        </div>

        <GlobalGenerationControls propertyLinked={Boolean(prefill)} />

        <div className="ci-workflow-status-strip" aria-label="Calculator workflow status summary">
          <div className="ci-next-action-card">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-primary">Next best action</div>
            <p className="mt-1 text-sm font-semibold text-foreground">{nextBestAction}</p>
            <p className="mt-1 text-xs text-muted-foreground">Derived only from existing linked-property, missing-input, AI estimate and override state.</p>
          </div>
          <MiniProgress value={readinessPercent} label={prefill ? 'Input completeness' : 'Awaiting property data'} />
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="ci-status-mini"><CircleDashed className="h-3.5 w-3.5" /> Missing inputs <strong>{missingCount}</strong></div>
            <div className="ci-status-mini"><Sparkles className="h-3.5 w-3.5" /> AI pending <strong>{aiPendingCount}</strong></div>
            <div className="ci-status-mini"><CheckCircle2 className="h-3.5 w-3.5" /> AI accepted <strong>{aiAcceptedCount}</strong></div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as (typeof calculatorTabs)[number]['value'])} className="w-full">
          <div className="ci-tab-rail" aria-label="Calculator module navigation">
            <div className="ci-tab-rail-header">
              <div>
                <div className="ci-tab-eyebrow">Guided calculator suite</div>
                <h2 className="ci-tab-title">Choose your next module</h2>
              </div>
              <div className="ci-tab-current" aria-live="polite">
                Current: <span>{tabByValue[activeTab].label}</span>
              </div>
            </div>
            <div className="ci-tab-group-grid" role="tablist" aria-label="Calculator modules">
              {visibleTabGroups.map((group, groupIndex) => (
                <div key={group.group} className="ci-tab-group">
                  <div className="ci-tab-group-heading">
                    <span className="ci-tab-group-index">{String(groupIndex + 1).padStart(2, '0')}</span>
                    <span>{group.group}</span>
                  </div>
                  <div className="grid gap-2.5">
                    {group.tabs.map(value => {
                      const tab = tabByValue[value];
                      const selected = activeTab === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setActiveTab(value)}
                          className={`ci-tab-button ${selected ? 'ci-tab-button-active' : 'ci-tab-button-idle'}`}
                          role="tab"
                          aria-selected={selected}
                          aria-controls={`calculator-panel-${value}`}
                          id={`calculator-tab-${value}`}
                          aria-current={selected ? 'page' : undefined}
                        >
                          <span className="ci-tab-button-copy">
                            <span className="block text-sm font-semibold leading-tight">{tab.label}</span>
                            <span className={`mt-1 block text-[11px] font-medium leading-snug ${selected ? 'text-primary-foreground/90' : 'text-muted-foreground'}`}>{tab.subLabel}</span>
                          </span>
                          <span className={`ci-tab-status-badge ${!prefill ? 'ci-tab-status-pending' : missingCount > 0 ? 'ci-tab-status-warn' : 'ci-tab-status-ready'}`}>
                            {!prefill ? 'Awaiting data' : missingCount > 0 ? 'Incomplete' : 'Ready'}
                          </span>
                          {selected && <span className="ci-tab-active-pill">Active</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <TabsContent value="overview" id="calculator-panel-overview" aria-labelledby="calculator-tab-overview" className="mt-4">{<CalculatorTabShell actions={assumptionStatusAction} title="Overview Report" subtitle="Executive deal summary for linked-property completeness, AI estimate readiness, controlled report actions and client-ready commercial / industrial outputs." chips={[domain === 'industrial' ? 'Industrial domain' : 'Commercial domain', 'Report workflow']}><CommercialIndustrialOverviewCard /></CalculatorTabShell>}</TabsContent>
          <TabsContent value="borrowing" id="calculator-panel-borrowing" aria-labelledby="calculator-tab-borrowing" className="mt-4">{prefill ? <CalculatorTabShell actions={assumptionStatusAction} title="Borrowing Capacity Unified" subtitle="Client profile integration, scenario modelling and risk-adjusted lending outputs are grouped into a guided assessment flow." chips={["Mode + data source", "Scenario modelling", "Required documents"]}><CommercialBorrowingCapacityCard initialAssetCategory={domain} /></CalculatorTabShell> : blockedTab('Borrowing Capacity Unified')}</TabsContent>
          <TabsContent value="noi" id="calculator-panel-noi" aria-labelledby="calculator-tab-noi" className="mt-4">{<CalculatorTabShell actions={assumptionStatusAction} title="Net Operating Income (NOI)" subtitle="Income, vacancy, recoveries and operating expenses feed a clear NOI bridge and warning panel." chips={["Inputs", "Outputs", "Warnings / assumptions"]}><NoiCalculatorCard /></CalculatorTabShell>}</TabsContent>
          <TabsContent value="cap" id="calculator-panel-cap" aria-labelledby="calculator-tab-cap" className="mt-4">{<CalculatorTabShell actions={assumptionStatusAction} title="Capitalisation Rate" subtitle="Supporting data, NOI/value inputs, target yield and sensitivity outputs remain separated." chips={["Inputs", "Outputs", "Warnings / assumptions"]}><CapRateCalculatorCard /></CalculatorTabShell>}</TabsContent>
          <TabsContent value="icr" id="calculator-panel-icr" aria-labelledby="calculator-tab-icr" className="mt-4">{<CalculatorTabShell actions={assumptionStatusAction} title="ICR / DSCR" subtitle="Loan assumptions, interest/debt service and lender threshold comparisons are presented in one flow." chips={["Inputs", "Outputs", "Warnings / assumptions"]}><IcrDscrCalculatorCard /></CalculatorTabShell>}</TabsContent>
          <TabsContent value="gst" id="calculator-panel-gst" aria-labelledby="calculator-tab-gst" className="mt-4">{<CalculatorTabShell actions={assumptionStatusAction} title="Goods & Services Tax" subtitle="Transaction treatment and GST assumptions sit before payable, claimable and specialist review warnings." chips={["Inputs", "Outputs", "Warnings / assumptions"]}><GstTreatmentOverviewPanel /><GstCalculatorCard /></CalculatorTabShell>}</TabsContent>
          <TabsContent value="dcf" id="calculator-panel-dcf" aria-labelledby="calculator-tab-dcf" className="mt-4">{<CalculatorTabShell actions={assumptionStatusAction} title="Discounted Cash Flow" subtitle="Forecast assumptions are separated from cash-flow summary, NPV, IRR and terminal value outputs." chips={["Inputs", "Outputs", "Warnings / assumptions"]}><DcfOverviewPanel /><DcfCalculatorCard /></CalculatorTabShell>}</TabsContent>
          <TabsContent value="ten-year" id="calculator-panel-ten-year" aria-labelledby="calculator-tab-ten-year" className="mt-4">{<CalculatorTabShell actions={assumptionStatusAction} title="10-Year Cash Flow Report" subtitle="Projection assumptions, annual rows and export-ready report outputs are grouped for readability." chips={["Inputs", "Outputs", "Warnings / assumptions"]}><TenYearCashFlowCard /></CalculatorTabShell>}</TabsContent>
          {domain === 'industrial' && <TabsContent value="rent" id="calculator-panel-rent" aria-labelledby="calculator-tab-rent" className="mt-4">{<CalculatorTabShell actions={assumptionStatusAction} title="Industrial Metrics $/m² + Site Cover" subtitle="Review the overview, import or enter physical inputs, validate rent and site outputs, then save report-ready metrics." chips={["Asset profile", "Physical metrics", "Rent + value benchmarks", "Site efficiency"]}><IndustrialMetricsOverviewPanel /><IndustrialMetricsReadinessProvider><CalculatorGuidancePanel items={[{ title: 'Missing physical data', body: 'Import property areas, rent, outgoings and price first; missing values remain Pending until a source or manual entry is added.' }, { title: 'Benchmark notes', body: 'Benchmark notes are collapsed by default. Expand them only when you need the plain-English interpretation and verification context.' }, { title: 'Save-back', body: 'Use the bottom save action after warnings are validated so downstream report sync remains explicit.' }]} /><div className="grid gap-5 xl:grid-cols-2"><RentPerSqmCard /><SiteCoverCard /></div></IndustrialMetricsReadinessProvider></CalculatorTabShell>}</TabsContent>}
        </Tabs>
        </div>
      </div>
      </>
  );
}

function ActivePropertyHeader() {
  const { domain, prefill, property, loading } = useCalculatorPrefill();
  const metrics = buildActivePropertyMetrics(domain, prefill, property);
  const noPropertyMessage = 'No property linked. Add or select a commercial / industrial property to prefill the calculator suite.';
  const profileStatus = prefill ? 'Linked' : 'Not linked';
  const completenessAccent = metrics.completeness >= 80 ? 'good' : metrics.completeness >= 50 ? 'warn' : 'pending';
  const assumptionAccent = metrics.assumptionStatus === 'Report ready' ? 'good' : 'warn';
  const sourceAccent = metrics.dataSource === 'Manual' ? 'manual' : metrics.dataSource === 'Mixed' ? 'mixed' : 'neutral';

  return (
    <div className="ci-active-property-card p-4 md:p-5">
      <div className="flex flex-col gap-5 2xl:flex-row 2xl:items-stretch 2xl:justify-between">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="ci-badge ci-badge-workflow">Active Property Header</Badge>
            <Badge variant="outline" className="ci-badge-soft">Domain: {domain === 'industrial' ? 'Industrial' : 'Commercial'}</Badge>
            <Badge variant="outline" className={`ci-badge-soft ${sourceAccent === 'manual' ? 'ci-badge-manual' : sourceAccent === 'mixed' ? 'ci-badge-mixed' : ''}`}>Data source: {metrics.dataSource}</Badge>
          </div>

          <div className={`ci-linked-state ${prefill ? 'ci-linked-state-linked' : 'ci-linked-state-empty'}`}>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={prefill ? 'ci-badge ci-badge-verified' : 'ci-badge ci-badge-pending'}>{profileStatus}</Badge>
                <span className="text-xs font-medium text-muted-foreground">Calculator context</span>
              </div>
              <h2 className="truncate text-xl font-semibold tracking-tight text-foreground md:text-2xl">{prefill?.address || noPropertyMessage}</h2>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">
                {prefill ? 'Linked property context controls calculator prefill, accepted assumptions, save-back and report generation.' : noPropertyMessage}
              </p>
            </div>
          </div>

          <div className="ci-summary-grid ci-active-property-metrics">
            <HeaderMetric label="Asset type" value={metrics.assetType} />
            <HeaderMetric label="Completeness" value={`${metrics.completeness}%`} accent={completenessAccent} />
            <HeaderMetric label="Assumption status" value={metrics.assumptionStatus} accent={assumptionAccent} />
            <HeaderMetric label="Last updated" value={metrics.lastUpdated} accent={metrics.lastUpdated === 'Pending' ? 'warn' : 'neutral'} />
            <HeaderMetric label="Profile status" value={profileStatus} accent={prefill ? 'good' : 'pending'} />
            <HeaderMetric label="Source mix" value={metrics.dataSource} accent={sourceAccent} />
          </div>
        </div>

        <div className="ci-workflow-actions shrink-0">
          <WorkflowActionGroup title="Property linking">
            <Button size="sm" variant="default" title="Use the selector below to add or link an active property." className="ci-workflow-primary" onClick={() => document.getElementById('calculator-property-selector')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><Link2 className="mr-1 h-4 w-4" />Add / link property</Button>
          </WorkflowActionGroup>
          <WorkflowActionGroup title="Extraction / AI estimates">
            <span title={!prefill ? 'Link a property before re-running extraction.' : 'Re-run extraction for the linked property.'}><Button size="sm" variant="outline" disabled={!prefill || loading} className="ci-workflow-button disabled:pointer-events-none"><RefreshCw className="mr-1 h-4 w-4" />Re-run extraction</Button></span>
            <span title={!prefill ? 'Link a property before running AI estimates.' : 'Run AI estimates using the linked property context.'}><Button size="sm" variant="outline" disabled={!prefill || loading} className="ci-workflow-button disabled:pointer-events-none"><Sparkles className="mr-1 h-4 w-4" />Run AI estimates</Button></span>
          </WorkflowActionGroup>
          <WorkflowActionGroup title="Assumption management">
            <span title={!prefill ? 'Link a property before reviewing assumption status.' : metrics.assumptionStatus}><Button size="sm" variant="outline" disabled={!prefill} className="ci-workflow-button disabled:pointer-events-none"><AlertCircle className="mr-1 h-4 w-4" />Assumption status</Button></span>
            <span title={!prefill ? 'Link a property before saving accepted assumptions.' : 'Save all accepted assumptions to the linked property profile.'}><Button size="sm" variant="outline" disabled={!prefill} className="ci-workflow-button disabled:pointer-events-none"><Save className="mr-1 h-4 w-4" />Save all accepted</Button></span>
          </WorkflowActionGroup>
          <WorkflowActionGroup title="Save / report actions">
            <span title={!prefill ? 'Link a property before generating a report.' : 'Generate the report from linked property assumptions.'}><Button size="sm" variant="outline" disabled={!prefill} className="ci-workflow-button ci-workflow-report disabled:pointer-events-none"><FileText className="mr-1 h-4 w-4" />Generate report</Button></span>
          </WorkflowActionGroup>
        </div>
      </div>
    </div>
  );
}

function WorkflowActionGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ci-workflow-group">
      <div className="ci-workflow-label">{title}</div>
      <div className="ci-workflow-group-actions">{children}</div>
    </div>
  );
}

function HeaderMetric({ label, value, accent = 'neutral' }: { label: string; value: string; accent?: 'neutral' | 'good' | 'warn' | 'pending' | 'manual' | 'mixed' }) {
  const accentClass = accent === 'good' ? 'ci-metric-good' : accent === 'warn' ? 'ci-metric-warn' : accent === 'pending' ? 'ci-metric-pending' : accent === 'manual' ? 'ci-metric-manual' : accent === 'mixed' ? 'ci-metric-mixed' : 'ci-metric-neutral';
  return (
    <div className={`ci-summary-metric ${accentClass}`}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function NoLinkedPropertyPanel({ domain }: { domain: CalculatorDomain }) {
  return (
    <div className="rounded-2xl border border-brand-500/25 bg-brand-500/10 p-5 text-sm text-muted-foreground shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-brand-100">No property linked</h3>
          <p className="mt-1 max-w-3xl">No property linked. Add or select a commercial / industrial property to prefill the calculator suite.</p>
          <p className="mt-2 text-xs">Calculated outputs are hidden until a {domain} property profile is linked, preventing hardcoded or demo values from appearing in calculator tabs.</p>
        </div>
        <Badge variant="outline" className="border-brand-500/30 bg-background/50 text-brand-100">Property required</Badge>
      </div>
    </div>
  );
}

function buildActivePropertyMetrics(domain: CalculatorDomain, prefill: ReturnType<typeof useCalculatorPrefill>['prefill'], property: ReturnType<typeof useCalculatorPrefill>['property']) {
  if (!prefill) {
    return {
      assetType: domain === 'industrial' ? 'Industrial property' : 'Commercial property',
      dataSource: 'Manual',
      completeness: 0,
      assumptionStatus: 'Property required',
      lastUpdated: 'Pending',
    };
  }

  const dataPoints = [
    prefill.address,
    prefill.assetSubtype,
    prefill.purchasePrice ?? prefill.valuation,
    prefill.glaSqm ?? prefill.nlaSqm ?? prefill.gfaSqm,
    prefill.siteAreaSqm,
    prefill.grossPassingRentPa ?? prefill.marketRentPa ?? prefill.passingNoi ?? prefill.marketNoi,
    prefill.gstTreatment,
    prefill.zoning,
    prefill.yearBuilt,
    prefill.conditionRating,
  ];
  const completeness = Math.round((dataPoints.filter((value) => value !== null && value !== undefined && value !== '').length / dataPoints.length) * 100);
  const notes = String((property as any)?.notes ?? '').toLowerCase();
  const specs = JSON.stringify((property as any)?.industrial_specs ?? {}).toLowerCase();
  const sourceHints = [
    'Property Profile',
    notes.includes('scrape') || specs.includes('scrape') ? 'Scrape' : '',
    notes.includes('contract') || specs.includes('contract') ? 'Contract' : '',
    notes.includes('ai') || specs.includes('ai') ? 'AI' : '',
  ].filter(Boolean);
  const dataSource = sourceHints.length > 1 ? 'Mixed' : sourceHints[0] || 'Property Profile';
  const assumptionStatus = completeness >= 85 ? 'Report ready' : completeness >= 55 ? 'Review gaps' : 'Incomplete';
  const lastUpdatedRaw = (property as any)?.updated_at || (property as any)?.created_at;

  return {
    assetType: String(prefill.assetSubtype || prefill.assetCategory || domain).replace(/_/g, ' '),
    dataSource,
    completeness,
    assumptionStatus,
    lastUpdated: lastUpdatedRaw ? new Date(lastUpdatedRaw).toLocaleDateString('en-AU') : 'Pending',
  };
}
