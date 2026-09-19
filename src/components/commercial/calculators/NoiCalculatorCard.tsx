import { useMemo, useState } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, Info, Loader2, PencilLine, Save, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { calculateNoi, calculateNoiEngine, type LeaseType, type NoiBasis, type OutgoingsBreakdown } from '@/utils/commercial';
import { useApplyPrefill, useCalculatorPrefill, type CalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { invokeSecureFunction } from '@/lib/secureInvoke';

type SourceState = 'Blank' | 'Scraped' | 'AI Estimate' | 'Manual' | 'User Override' | 'Saved Property Value' | 'Verified';
type NoiFieldKey = 'grossRent' | 'recovered' | 'other' | 'vacancy' | 'leaseType' | 'noiBasis' | 'marketRent' | 'incentiveAdjustment' | 'tenantRiskHaircut' | 'totalOperatingExpenses' | keyof OutgoingsBreakdown;
type Confidence = 'High' | 'Medium' | 'Low';
type NoiReadinessStatus = 'Awaiting NOI Inputs' | 'Preliminary NOI Estimate' | 'NOI Assessment Ready' | 'Specialist Review Recommended' | 'Verified NOI';
type NoiWarningCategory = 'Income' | 'Lease' | 'Expenses' | 'Vacancy' | 'Lender Adjustment' | 'Data Source' | 'Documents';
type NoiWarningSeverity = 'Critical' | 'Required' | 'Recommended';
interface NoiReadinessWarning { category: NoiWarningCategory; severity: NoiWarningSeverity; message: string; detail: string; priority: number; }
interface NoiAiEstimateField { field: NoiFieldKey; currentValue: number | string | null; estimatedValue: number | string | null; unit: string; confidence: Confidence; sourceStatusBefore: SourceState; sourceStatusAfter: 'AI Estimate'; reasoningSummary: string; requiresSpecialistReview: boolean; requiredDocument: string; shouldOverwrite: boolean; accepted?: boolean; }
interface StructuredNoiAiEstimate { propertyId: string; dealId: string; estimateType: 'NOI'; summary: string; estimatedFields: NoiAiEstimateField[]; calculatedOutputs: { potentialGrossIncome: number | null; vacancyLoss: number | null; recoveredOutgoings: number | null; effectiveGrossIncome: number | null; totalOutgoings: number | null; ownerBorneOutgoings: number | null; actualNOI: number | null; stabilisedNOI: number | null; lenderAdjustedNOI: number | null; }; warnings: string[]; requiredDocuments: string[]; recommendedNextAction: string; }
interface LegacyNoiAiEstimate { marketRentPa?: number; grossPassingRentPa?: number; otherIncomePa?: number; recoveredOutgoingsPa?: number; vacancyAllowancePct?: number; incentiveAdjustment?: number; tenantRiskHaircut?: number; leaseTypeAssumed?: LeaseType | 'unknown'; outgoings?: Partial<Record<keyof OutgoingsBreakdown, number>>; ratePerSqm?: number; confidence?: 'high' | 'medium' | 'low'; reasoning?: string; }

const fmt = (n: number) => Number.isFinite(n) ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n) : pending;
const pending = 'Pending';
const parseNumericInput = (v: string, { allowNegative = false }: { allowNegative?: boolean } = {}) => {
  if (v === '' || v == null) return null;
  const parsed = Number(String(v).replace(/[$,\s%]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return !allowNegative && parsed < 0 ? null : parsed;
};
const num = (v: string, opts?: { allowNegative?: boolean }) => parseNumericInput(v, opts) ?? 0;
const valueOrNull = (v: string, opts?: { allowNegative?: boolean }) => parseNumericInput(v, opts);
const hasValue = (v: unknown) => v !== undefined && v !== null && v !== '' && (typeof v !== 'number' || Number.isFinite(v));
const isMissing = (v: string) => v === '' || v == null;
const isBlank = (v: string) => v === '' || Number(v) === 0 || v === 'unknown';
const protectedSources: SourceState[] = ['Verified', 'Saved Property Value', 'User Override'];
const verifiedSources: SourceState[] = ['Verified', 'Saved Property Value'];
const MATERIAL_VACANCY_REVIEW_PCT = 10;
const MATERIAL_RENT_DIFF_PCT = 10;

const OUTGOING_KEYS: Array<keyof OutgoingsBreakdown> = ['council', 'water', 'land_tax', 'insurance', 'management', 'repairs_maintenance', 'utilities', 'cleaning', 'security', 'other'];
const labelMap: Record<keyof OutgoingsBreakdown, string> = { council: 'Council Rates', water: 'Water', land_tax: 'Land Tax', insurance: 'Insurance', management: 'Management', repairs_maintenance: 'Repairs & Maint.', utilities: 'Utilities', cleaning: 'Cleaning', security: 'Security', other: 'Other' };
const placeholderMap: Record<NoiFieldKey, string> = { grossRent: 'Enter annual rent', recovered: 'Enter recovered outgoings', vacancy: 'Enter vacancy allowance', leaseType: '', noiBasis: '', marketRent: 'Enter market rent', incentiveAdjustment: 'Enter adjustment', tenantRiskHaircut: 'Enter haircut', totalOperatingExpenses: 'Enter simple total expenses', council: 'Enter council rates', water: 'Enter water charges', land_tax: 'Enter land tax', insurance: 'Enter insurance', management: 'Enter management fees', repairs_maintenance: 'Enter repairs', utilities: 'Enter utilities', cleaning: 'Enter cleaning', security: 'Enter security', other: 'Enter other income' };
const outgoingPlaceholderMap: Record<keyof OutgoingsBreakdown, string> = { ...placeholderMap, other: 'Enter other expenses' };
const fieldLabels: Record<string, string> = { grossRent: 'Gross Rental Income (PA)', recovered: 'Recovered Outgoings', other: 'Other Income', vacancy: 'Vacancy Allowance %', leaseType: 'Lease Type', noiBasis: 'NOI Basis', marketRent: 'Market Rent', incentiveAdjustment: 'Tenant incentive adjustment', tenantRiskHaircut: 'Tenant risk haircut', totalOperatingExpenses: 'Simple Total Operating Expenses', ...labelMap };
const badgeLabel: Record<SourceState, string> = { Blank: 'Blank', Scraped: 'Scraped', 'AI Estimate': 'AI Estimate', Manual: 'Manual', 'User Override': 'Override', 'Saved Property Value': 'Saved', Verified: 'Verified' };

function readPath(obj: any, keys: string[]): unknown {
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => acc?.[part], obj);
    if (hasValue(value)) return value;
  }
  return undefined;
}

function parseMoneyFromNotes(notes: string | null | undefined, labels: string[]): number | undefined {
  if (!notes) return undefined;
  for (const label of labels) {
    const match = notes.match(new RegExp(`${label}[^$\\d-]*\\$?([\\d,]+(?:\\.\\d+)?)`, 'i'));
    if (match) return Number(match[1].replace(/,/g, ''));
  }
  return undefined;
}

function normaliseLeaseType(value: unknown): LeaseType | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.toLowerCase().replace(/[\s_-]+/g, '');
  if (v.includes('triplenet')) return 'tripleNet';
  if (v.includes('semigross')) return 'semiGross';
  if (v.includes('net')) return 'net';
  if (v.includes('gross')) return 'gross';
  return undefined;
}

function buildScrapeValues(prefill: CalculatorPrefill | null, property: any): Partial<Record<NoiFieldKey, string>> {
  const specs = property?.industrial_specs ?? {};
  const scrape = specs.noi_scrape ?? specs.scraped_noi ?? specs.scrapeData ?? specs.scrapedData ?? specs.imported_noi ?? {};
  const notes = property?.notes ?? '';
  const values: Partial<Record<NoiFieldKey, string>> = {};
  const set = (field: NoiFieldKey, value: unknown) => { if (hasValue(value)) values[field] = String(value); };

  set('grossRent', prefill?.grossPassingRentPa ?? readPath(scrape, ['grossRent', 'grossPassingRentPa', 'vendorAdvisedRentPa', 'vendorRentPa']) ?? parseMoneyFromNotes(notes, ['Vendor advised rent', 'Gross rental income', 'Passing rent']));
  set('recovered', prefill?.recoveredOutgoingsPa ?? readPath(scrape, ['recovered', 'recoveredOutgoingsPa', 'outgoingsRecoverablePa']));
  set('other', readPath(scrape, ['other', 'otherIncomePa', 'otherIncome']));
  set('vacancy', readPath(scrape, ['vacancy', 'vacancyAllowancePct', 'vacancyPct']));
  set('marketRent', prefill?.marketRentPa ?? readPath(scrape, ['marketRent', 'marketRentPa']));
  set('incentiveAdjustment', readPath(scrape, ['incentiveAdjustment', 'tenantIncentiveAdjustment', 'incentiveAdjustmentPa']));
  set('tenantRiskHaircut', readPath(scrape, ['tenantRiskHaircut', 'tenantRiskHaircutPa']));
  set('leaseType', normaliseLeaseType(readPath(scrape, ['leaseType', 'leaseTypeAssumed']) ?? notes.match(/Lease type:\s*([^\n]+)/i)?.[1]));
  set('noiBasis', readPath(scrape, ['noiBasis']));
  OUTGOING_KEYS.forEach(k => set(k, prefill?.outgoings?.[k] ?? readPath(scrape, [`outgoings.${k}`, `expenses.${k}`, k])));
  return values;
}

export function NoiCalculatorCard() {
  const [grossRent, setGrossRent] = useState('');
  const [recovered, setRecovered] = useState('');
  const [other, setOther] = useState('');
  const [vacancy, setVacancy] = useState('');
  const [leaseType, setLeaseType] = useState<LeaseType>('unknown');
  const [noiBasis, setNoiBasis] = useState<NoiBasis>('lenderAdjusted');
  const [marketRent, setMarketRent] = useState('');
  const [incentiveAdjustment, setIncentiveAdjustment] = useState('');
  const [tenantRiskHaircut, setTenantRiskHaircut] = useState('');
  const [totalOperatingExpenses, setTotalOperatingExpenses] = useState('');
  const [outgoings, setOutgoings] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, SourceState>>({ leaseType: 'Blank', noiBasis: 'Manual' });
  const [originalScrapedValues, setOriginalScrapedValues] = useState<Record<string, string>>({});
  const [scrapeConflicts, setScrapeConflicts] = useState<Record<string, string>>({});
  const [aiEstimate, setAiEstimate] = useState<StructuredNoiAiEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [syncOn, setSyncOn] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [expensesOpen, setExpensesOpen] = useState(false);
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const { domain, prefill, property, pushBack } = useCalculatorPrefill();
  const canSaveBack = domain === 'commercial';
  const audit = (action: string, field: string, previousValue: unknown, newValue: unknown, source = 'NOI Calculator') => console.info('NOI audit', { action, field, previousValue, newValue, source, originalScrapedValue: originalScrapedValues[field], timestamp: new Date().toISOString(), user: (property as any)?.user_id ?? 'current-user', propertyId: prefill?.propertyId ?? '', dealId: prefill?.propertyId ?? '', scenarioId: undefined });

  const setters: Record<string, (v: string) => void> = { grossRent: setGrossRent, recovered: setRecovered, other: setOther, vacancy: setVacancy, marketRent: setMarketRent, incentiveAdjustment: setIncentiveAdjustment, tenantRiskHaircut: setTenantRiskHaircut, totalOperatingExpenses: setTotalOperatingExpenses, leaseType: v => setLeaseType(v as LeaseType), noiBasis: v => setNoiBasis(v as NoiBasis) };
  const currentRawValue = (field: NoiFieldKey) => field === 'grossRent' ? grossRent : field === 'recovered' ? recovered : field === 'other' ? other : field === 'vacancy' ? vacancy : field === 'marketRent' ? marketRent : field === 'incentiveAdjustment' ? incentiveAdjustment : field === 'tenantRiskHaircut' ? tenantRiskHaircut : field === 'totalOperatingExpenses' ? totalOperatingExpenses : field === 'leaseType' ? leaseType : field === 'noiBasis' ? noiBasis : outgoings[field] ?? '';
  const setRawValue = (field: NoiFieldKey, value: string) => { if (setters[field]) setters[field](value); else setOutgoings(prev => ({ ...prev, [field]: value })); };
  const setSource = (field: NoiFieldKey, source: SourceState) => setSources(prev => ({ ...prev, [field]: source }));

  const setField = (field: NoiFieldKey, value: string) => {
    const prev = currentRawValue(field);
    const previousSource = sources[field] ?? 'Blank';
    setRawValue(field, value);
    const nextSource: SourceState = value === '' ? 'Blank' : ['Scraped', 'AI Estimate', 'Saved Property Value', 'Verified', 'User Override'].includes(previousSource) ? 'User Override' : 'Manual';
    setSource(field, nextSource);
    audit(nextSource === 'User Override' ? 'NOI field overridden by user' : 'manual NOI field edit', field, prev, value, nextSource);
  };

  useApplyPrefill((p) => {
    if (!syncOn) return;
    const scrapeValues = buildScrapeValues(p, property);
    const savedCascade = ((property as any)?.industrial_specs?.noi_input_cascade ?? {}) as { values?: Record<string, string | number>; sources?: Record<string, SourceState>; originalScrapedValues?: Record<string, string | number> };

    setOriginalScrapedValues(prev => ({ ...Object.fromEntries(Object.entries(savedCascade.originalScrapedValues ?? {}).map(([k, v]) => [k, String(v)])), ...prev }));
    (Object.keys(fieldLabels) as NoiFieldKey[]).forEach(field => {
      const savedValue = savedCascade.values?.[field];
      const savedSource = savedCascade.sources?.[field];
      const scrapedValue = scrapeValues[field];
      const current = currentRawValue(field);

      if (hasValue(savedValue) && (savedSource === 'User Override' || savedSource === 'Verified' || savedSource === 'Saved Property Value')) {
        if (isBlank(current)) { setRawValue(field, String(savedValue)); setSource(field, savedSource); }
        if (hasValue(scrapedValue) && String(scrapedValue) !== String(savedValue) && savedSource === 'User Override') setScrapeConflicts(prev => ({ ...prev, [field]: String(scrapedValue) }));
        return;
      }
      if (hasValue(scrapedValue) && isBlank(current) && !protectedSources.includes(sources[field] ?? 'Blank')) {
        setRawValue(field, String(scrapedValue)); setSource(field, 'Scraped'); setOriginalScrapedValues(prev => ({ ...prev, [field]: String(scrapedValue) })); audit('scraped NOI value applied', field, current, scrapedValue, 'Scraped');
      }
    });
  });

  const minimumNoiInputsReady = parseNumericInput(grossRent) !== null && parseNumericInput(vacancy) !== null;
  const displayValue = (value: number, prefix = '') => minimumNoiInputsReady ? `${prefix}${fmt(value)}` : pending;
  const result = useMemo(() => { const o: OutgoingsBreakdown = {}; if (parseNumericInput(totalOperatingExpenses) !== null) (o as any).other = num(totalOperatingExpenses); else OUTGOING_KEYS.forEach(k => { (o as any)[k] = minimumNoiInputsReady ? num(outgoings[k] ?? '') : 0; }); return calculateNoi({ grossRentalIncome: num(grossRent), recoveredOutgoings: minimumNoiInputsReady ? num(recovered) : 0, otherIncome: minimumNoiInputsReady ? num(other) : 0, vacancyAllowancePct: num(vacancy), outgoings: o }); }, [grossRent, recovered, other, vacancy, outgoings, totalOperatingExpenses, minimumNoiInputsReady]);
  const statusTags = useMemo(() => Object.values(sources).filter((v, i, a) => a.indexOf(v) === i) as any, [sources]);
  const assessment = useMemo(() => calculateNoiEngine({ dataSourceMode: aiEstimate ? 'aiEstimate' : prefill ? 'global' : 'manualOverride', leaseType, grossPassingRent: grossRent, otherIncome: other, marketRent: marketRent, vacancyAllowancePct: vacancy, recoveredOutgoings: recovered, simpleTotalOperatingExpenses: totalOperatingExpenses, outgoings: OUTGOING_KEYS.map(k => ({ name: labelMap[k], amount: outgoings[k] ?? '', recoverablePct: num(recovered) > 0 ? 100 : 0 })), incentiveAdjustment: incentiveAdjustment, tenantRiskHaircut: tenantRiskHaircut, leaseDocsVerified: leaseType !== 'unknown', confidenceTags: statusTags.filter(t => t !== 'Scraped') }, noiBasis), [grossRent, recovered, other, vacancy, outgoings, leaseType, noiBasis, marketRent, incentiveAdjustment, tenantRiskHaircut, totalOperatingExpenses, statusTags, aiEstimate, prefill]);
  const readiness = useMemo(() => {
    const parsed = {
      grossRent: parseNumericInput(grossRent),
      marketRent: parseNumericInput(marketRent),
      recovered: parseNumericInput(recovered),
      vacancy: parseNumericInput(vacancy),
      incentiveAdjustment: parseNumericInput(incentiveAdjustment, { allowNegative: true }),
      tenantRiskHaircut: parseNumericInput(tenantRiskHaircut, { allowNegative: true }),
      totalOperatingExpenses: parseNumericInput(totalOperatingExpenses),
    };
    const itemisedExpenseCount = OUTGOING_KEYS.filter(k => parseNumericInput(outgoings[k] ?? '') !== null).length;
    const hasExpenses = parsed.totalOperatingExpenses !== null || itemisedExpenseCount > 0;
    const hasStarted = Boolean(prefill || aiEstimate || grossRent || marketRent || recovered || other || vacancy || incentiveAdjustment || tenantRiskHaircut || totalOperatingExpenses || itemisedExpenseCount || Object.values(sources).some(s => s === 'Scraped' || s === 'AI Estimate' || s === 'User Override' || s === 'Saved Property Value' || s === 'Verified'));
    const preliminaryReady = (parsed.grossRent !== null || parsed.marketRent !== null) && parsed.vacancy !== null && parsed.recovered !== null && hasExpenses && !!noiBasis;
    const assessmentReady = parsed.grossRent !== null && parsed.marketRent !== null && parsed.vacancy !== null && parsed.recovered !== null && hasExpenses && leaseType !== 'unknown' && !!noiBasis && parsed.incentiveAdjustment !== null && parsed.tenantRiskHaircut !== null;
    const criticalFields: NoiFieldKey[] = ['grossRent', 'marketRent', 'recovered', 'vacancy', 'noiBasis'];
    const warnings: NoiReadinessWarning[] = [];
    const add = (warning: NoiReadinessWarning) => warnings.push(warning);

    if (hasStarted && !prefill) add({ category: 'Data Source', severity: 'Recommended', priority: 90, message: 'No property is linked. Save-back is disabled.', detail: 'Link a property before saving NOI inputs back to a property profile.' });
    if (hasStarted && leaseType === 'unknown') add({ category: 'Lease', severity: 'Critical', priority: 10, message: 'Lease type is unknown. Confirm lease structure before relying on recovered outgoings.', detail: 'Lease structure affects recoveries, owner-borne expenses and whether recovered outgoings can be verified.' });
    if (hasStarted && noiBasis === 'lenderAdjusted' && !verifiedSources.includes(sources.leaseType ?? 'Blank')) add({ category: 'Documents', severity: 'Required', priority: 20, message: 'Lender-adjusted NOI requires verified lease documentation.', detail: 'Verify lease documents before relying on lender-adjusted NOI as the borrowing NOI basis.' });
    if (hasStarted && parsed.vacancy === null) add({ category: 'Vacancy', severity: 'Required', priority: 30, message: 'Vacancy allowance is required before NOI can be relied on.', detail: 'Enter the vacancy allowance as a percentage, for example 5 or 5%.' });
    if (hasStarted && parsed.vacancy !== null && parsed.vacancy > MATERIAL_VACANCY_REVIEW_PCT) add({ category: 'Vacancy', severity: 'Recommended', priority: 45, message: 'Vacancy allowance is above the internal review threshold.', detail: `Vacancy above ${MATERIAL_VACANCY_REVIEW_PCT}% should be checked against leasing assumptions and market evidence.` });
    if (hasStarted && ((parsed.tenantRiskHaircut ?? 0) > 0 || (parsed.incentiveAdjustment ?? 0) > 0)) add({ category: 'Lender Adjustment', severity: 'Required', priority: 35, message: 'Lender-adjusted NOI includes tenant risk or incentive adjustments.', detail: 'Review adjustment support because applied lender haircuts prevent verified status until documented.' });
    if (hasStarted && parsed.grossRent && parsed.marketRent && Math.abs(parsed.marketRent - parsed.grossRent) / Math.max(Math.abs(parsed.grossRent), 1) * 100 >= MATERIAL_RENT_DIFF_PCT) add({ category: 'Income', severity: 'Recommended', priority: 40, message: 'Market rent differs from passing rent. Review stabilised NOI.', detail: `Passing and market rent differ by at least ${MATERIAL_RENT_DIFF_PCT}%, so stabilised NOI should be reviewed before reliance.` });
    if (hasStarted && parsed.recovered !== null && parsed.recovered > 0 && leaseType === 'unknown') add({ category: 'Lease', severity: 'Critical', priority: 12, message: 'Recovered outgoings are entered but lease type is unknown.', detail: 'Confirm gross/net/semi-gross structure to validate recoverability.' });
    if (hasStarted && Object.values(sources).includes('AI Estimate')) add({ category: 'Data Source', severity: 'Required', priority: 25, message: 'Values include AI estimates and require verification.', detail: 'Any AI-estimated assumptions must be verified against source documents before verified status is available.' });
    if (hasStarted && prefill) {
      const missingCritical = criticalFields.filter(field => isBlank(String(currentRawValue(field) ?? '')));
      if (missingCritical.length) add({ category: 'Data Source', severity: 'Required', priority: 28, message: 'A critical scraped or linked NOI value is missing.', detail: `Missing: ${missingCritical.map(f => fieldLabels[f]).join(', ')}.` });
    }
    if (hasStarted && !hasExpenses) add({ category: 'Expenses', severity: 'Required', priority: 32, message: 'Operating expenses are required before NOI can be relied on.', detail: 'Enter a total operating expense assumption or at least one itemised expense.' });
    if (hasStarted && parsed.recovered === null) add({ category: 'Expenses', severity: 'Required', priority: 34, message: 'Confirm recovered outgoings, even if the value is $0.', detail: 'Enter 0 when there are no recovered outgoings so the calculator can distinguish confirmed none from missing.' });

    const blockingWarnings = warnings.filter(w => w.severity === 'Critical' || w.severity === 'Required');
    const allVerified = assessmentReady && (['grossRent', 'marketRent', 'recovered', 'vacancy', 'leaseType', 'noiBasis', 'incentiveAdjustment', 'tenantRiskHaircut'] as NoiFieldKey[]).every(field => verifiedSources.includes(sources[field] ?? 'Blank'));
    const specialist = hasStarted && warnings.some(w => w.severity === 'Critical' || ['Lease', 'Lender Adjustment', 'Documents', 'Data Source'].includes(w.category));
    const status: NoiReadinessStatus = !hasStarted
      ? 'Awaiting NOI Inputs'
      : allVerified && blockingWarnings.length === 0
        ? 'Verified NOI'
        : specialist
          ? 'Specialist Review Recommended'
          : assessmentReady
            ? 'NOI Assessment Ready'
            : preliminaryReady
              ? 'Preliminary NOI Estimate'
              : 'Awaiting NOI Inputs';
    return { status, hasStarted, preliminaryReady, assessmentReady, warnings: warnings.sort((a, b) => a.priority - b.priority), compactWarnings: hasStarted ? warnings.sort((a, b) => a.priority - b.priority).slice(0, 3) : [] };
  }, [grossRent, marketRent, recovered, other, vacancy, incentiveAdjustment, tenantRiskHaircut, totalOperatingExpenses, outgoings, prefill, aiEstimate, sources, noiBasis, leaseType, currentRawValue]);

  const currentValue = (f: NoiFieldKey) => { const raw = currentRawValue(f); return f === 'leaseType' || f === 'noiBasis' ? raw : raw === '' ? null : num(raw); };
  const normaliseEstimate = (estimate: LegacyNoiAiEstimate | StructuredNoiAiEstimate, snapshot: any): StructuredNoiAiEstimate => {
    if ((estimate as StructuredNoiAiEstimate).estimatedFields) { const structured = estimate as StructuredNoiAiEstimate; return { ...structured, estimatedFields: structured.estimatedFields.map(f => ({ ...f, accepted: f.accepted ?? (!protectedSources.includes(f.sourceStatusBefore) && isBlank(String(f.currentValue ?? ''))) })) }; }
    const e = estimate as LegacyNoiAiEstimate; const conf: Confidence = e.confidence === 'high' ? 'High' : e.confidence === 'low' ? 'Low' : 'Medium';
    const pairs: Array<[NoiFieldKey, any, string]> = [['marketRent', e.marketRentPa, 'AUD pa'], ['grossRent', e.grossPassingRentPa, 'AUD pa'], ['other', e.otherIncomePa, 'AUD pa'], ['recovered', e.recoveredOutgoingsPa, 'AUD pa'], ['vacancy', e.vacancyAllowancePct, '%'], ['incentiveAdjustment', e.incentiveAdjustment, 'AUD pa'], ['tenantRiskHaircut', e.tenantRiskHaircut, 'AUD pa'], ['leaseType', e.leaseTypeAssumed, '']];
    const totalEstimatedExpenses = e.outgoings ? Object.values(e.outgoings).reduce((total, value) => total + (Number.isFinite(Number(value)) ? Number(value) : 0), 0) : undefined;
    if (totalEstimatedExpenses) pairs.push(['totalOperatingExpenses', totalEstimatedExpenses, 'AUD pa']);
    OUTGOING_KEYS.forEach(k => pairs.push([k, e.outgoings?.[k], 'AUD pa']));
    const fields = pairs.filter(([, v]) => v != null && v !== 'unknown').map(([field, v, unit]) => ({ field, currentValue: currentValue(field), estimatedValue: typeof v === 'number' ? Math.round(v) : v, unit, confidence: conf, sourceStatusBefore: sources[field] ?? 'Blank', sourceStatusAfter: 'AI Estimate' as const, reasoningSummary: e.reasoning || `Estimated from selected property context (${snapshot.address || snapshot.propertyId || 'manual entry'}).`, requiresSpecialistReview: conf === 'Low', requiredDocument: conf === 'Low' ? 'Current lease, rent roll and outgoings statement' : '', shouldOverwrite: !protectedSources.includes(sources[field]) && isBlank(String(currentValue(field))), accepted: !protectedSources.includes(sources[field]) && isBlank(String(currentValue(field))) }));
    return { propertyId: snapshot.propertyId || '', dealId: snapshot.dealId || snapshot.propertyId || '', estimateType: 'NOI', summary: e.reasoning || 'Property-aware NOI estimate generated for review.', estimatedFields: fields, calculatedOutputs: { potentialGrossIncome: assessment.potentialGrossIncome, vacancyLoss: assessment.vacancyLoss, recoveredOutgoings: assessment.recoveredOutgoings, effectiveGrossIncome: assessment.effectiveGrossIncome, totalOutgoings: assessment.totalOperatingExpenses, ownerBorneOutgoings: assessment.ownerBorneExpenses, actualNOI: assessment.actualNoi, stabilisedNOI: assessment.stabilisedNoi, lenderAdjustedNOI: assessment.lenderAdjustedNoi }, warnings: [], requiredDocuments: conf === 'Low' ? ['Current lease', 'Rent roll', 'Outgoings statement'] : [], recommendedNextAction: 'Review proposed fields, accept selected estimates, then verify against source documents.' };
  };

  const hasEnoughAiContext = Boolean(prefill?.assetCategory && prefill?.assetSubtype && ((property as any)?.suburb || (prefill as any)?.suburb) && (prefill?.nlaSqm || prefill?.glaSqm));

  const requestEstimate = async () => {
    if (!hasEnoughAiContext) {
      toast.error('More property information is required before AI can estimate NOI assumptions.');
      setReviewOpen(true);
      return;
    }
    setEstimating(true); audit('AI estimate requested', 'NOI', null, null, prefill ? 'Selected property' : 'Manual entry / no property linked');
    try {
      const missing = prefill ? ['address', 'assetSubtype', 'glaSqm', 'siteAreaSqm'].filter(k => !(prefill as any)[k]) : ['property link'];
      const snapshot = { propertyId: prefill?.propertyId ?? '', dealId: prefill?.propertyId ?? '', address: prefill?.address ?? '', state: prefill?.state, assetCategory: prefill?.assetCategory, assetSubtype: prefill?.assetSubtype, gstTreatment: prefill?.gstTreatment, purchasePrice: prefill?.purchasePrice, valuation: prefill?.valuation, gfaSqm: prefill?.gfaSqm, nlaSqm: prefill?.nlaSqm, glaSqm: prefill?.glaSqm, siteAreaSqm: prefill?.siteAreaSqm, siteCoverPct: prefill?.siteCoverPct, hardstandSqm: prefill?.hardstandSqm, officePct: prefill?.officePct, parkingBays: prefill?.parkingBays, clearanceMetres: prefill?.clearanceMetres, yearBuilt: prefill?.yearBuilt, zoning: prefill?.zoning, leaseStatus: (property as any)?.lease_status, wale: prefill?.walesYears ?? (property as any)?.wale, leaseExpiry: (property as any)?.lease_expiry, capRate: (property as any)?.cap_rate, currentNoiInputs: { grossRent: num(grossRent), marketRent: num(marketRent), recovered: num(recovered), other: num(other), vacancy: num(vacancy), leaseType, noiBasis, incentiveAdjustment: num(incentiveAdjustment), tenantRiskHaircut: num(tenantRiskHaircut), totalOperatingExpenses: num(totalOperatingExpenses), outgoings: Object.fromEntries(OUTGOING_KEYS.map(k => [k, num(outgoings[k] ?? '0')])) }, missingFields: (Object.keys(fieldLabels) as NoiFieldKey[]).filter(k => isBlank(String(currentValue(k) ?? ''))), verifiedAssumptions: Object.entries(sources).filter(([, v]) => v === 'Verified' || v === 'Saved Property Value') };
      const { data, error } = await invokeSecureFunction<{ success: boolean; estimate?: LegacyNoiAiEstimate | StructuredNoiAiEstimate; error?: string }>('estimate-commercial-noi', { snapshot });
      if (error || !data?.success || !data.estimate) { toast.error(data?.error || error?.message || 'Failed to generate NOI estimate'); return; }
      const structured = normaliseEstimate(data.estimate, snapshot);
      if (missing.length) structured.warnings.unshift('AI estimate accuracy is limited because key property details are missing.');
      setAiEstimate(structured); setReviewOpen(true); audit('AI estimate generated', 'NOI', null, structured, 'AI Estimate');
      toast.success('AI estimate ready for review. Existing NOI inputs were not overwritten.');
    } catch (err: any) { toast.error(err?.message || 'AI estimate failed'); } finally { setEstimating(false); }
  };

  const updateProposal = (idx: number, patch: Partial<NoiAiEstimateField>) => setAiEstimate(e => e ? { ...e, estimatedFields: e.estimatedFields.map((f, i) => i === idx ? { ...f, ...patch } : f) } : e);
  const applyAccepted = () => {
    if (!aiEstimate) { toast.info('Run "Estimate for me" first to generate an AI estimate.'); return; }
    let applied = 0;
    aiEstimate.estimatedFields.filter(f => f.accepted).forEach(f => { if (protectedSources.includes(f.sourceStatusBefore) && !f.shouldOverwrite) return; const v = String(f.estimatedValue ?? ''); const prev = currentValue(f.field); setRawValue(f.field, v); setSource(f.field, 'AI Estimate'); audit('AI estimate accepted', f.field, prev, v, 'AI Estimate'); applied += 1; });
    aiEstimate.estimatedFields.filter(f => !f.accepted).forEach(f => audit('AI estimate rejected', f.field, f.estimatedValue, null, 'AI Estimate'));
    setAiEstimate(null); setReviewOpen(false); toast.success(`${applied} AI NOI estimate${applied === 1 ? '' : 's'} applied and recalculated.`);
  };
  const openSpecialistReview = () => { setReviewOpen(true); toast.info('Specialist review details opened.'); audit('specialist review required flag added/removed', 'NOI', null, assessment.warnings, 'NOI Calculator'); };
  const useScrapedValue = (field: NoiFieldKey) => { const v = scrapeConflicts[field]; if (!hasValue(v)) return; setRawValue(field, v); setSource(field, 'Scraped'); setOriginalScrapedValues(prev => ({ ...prev, [field]: v })); setScrapeConflicts(prev => { const next = { ...prev }; delete next[field]; return next; }); audit('user selected new scraped NOI value', field, currentValue(field), v, 'Scraped'); };
  const keepOverride = (field: NoiFieldKey) => { setScrapeConflicts(prev => { const next = { ...prev }; delete next[field]; return next; }); audit('user kept saved NOI override', field, currentValue(field), scrapeConflicts[field], 'User Override'); };
  const allFields = Object.keys(fieldLabels) as NoiFieldKey[];
  const sourceCounts = allFields.reduce((acc, field) => {
    const source = sources[field] ?? 'Blank';
    if (source === 'User Override') acc.manualOverrides += 1;
    if (source === 'AI Estimate') acc.aiEstimates += 1;
    if (source === 'Scraped') acc.scrapedValues += 1;
    return acc;
  }, { manualOverrides: 0, aiEstimates: 0, scrapedValues: 0 });
  const hasSavableValue = allFields.some(field => {
    const raw = currentRawValue(field);
    return field === 'leaseType' || field === 'noiBasis' ? !isBlank(String(raw)) : parseNumericInput(String(raw)) !== null;
  });
  const userOverrideValues = Object.fromEntries(allFields.filter(field => sources[field] === 'User Override').map(field => [field, currentRawValue(field)]));
  const saveBack = async () => {
    if (!prefill || !canSaveBack) return;
    setSaving(true);
    try {
      const values = Object.fromEntries(allFields.map(field => [field, currentRawValue(field)]));
      const now = new Date().toISOString();
      const existingSpecs = ((property as any)?.industrial_specs ?? {}) as Record<string, unknown>;
      const patch = {
        outgoings_recoverable: Object.fromEntries(OUTGOING_KEYS.filter(k => hasValue(outgoings[k])).map(k => [k, num(outgoings[k])])),
        noi_outputs: { actualNOI: assessment.actualNoi, stabilisedNOI: assessment.stabilisedNoi, lenderAdjustedNOI: assessment.lenderAdjustedNoi, selectedNoi: assessment.selectedNoi, selectedBasis: assessment.selectedBasis, potentialGrossIncome: assessment.potentialGrossIncome, vacancyLoss: assessment.vacancyLoss, recoveredOutgoings: assessment.recoveredOutgoings, effectiveGrossIncome: assessment.effectiveGrossIncome, totalOutgoings: assessment.totalOperatingExpenses, ownerBorneOutgoings: assessment.ownerBorneExpenses, assumptionStatuses: sources, originalScrapedValues, userOverrideValues, savedAt: now, calculationVersion: 'noi-v2-readiness', savedBy: (property as any)?.user_id ?? null },
        gross_passing_rent_pa: valueOrNull(grossRent), market_rent_pa: valueOrNull(marketRent), recovered_outgoings_pa: valueOrNull(recovered), vacancy_allowance_pct: valueOrNull(vacancy),
        industrial_specs: { ...existingSpecs, noi_input_cascade: { values, sources, originalScrapedValues, userOverrideValues, savedAt: now, calculationVersion: 'noi-v2-readiness', savedBy: (property as any)?.user_id ?? null } },
      };
      const res = await pushBack(patch); if (res.ok) { audit('NOI values saved back to property', 'NOI', null, patch, 'Property Record Source'); toast.success('NOI assumptions saved to property profile.'); }
    } finally { setSaving(false); }
  };

  const sourceTone = (source: SourceState) => source === 'User Override' ? 'border-brand-400/50 bg-brand-500/10 text-brand-200' : source === 'AI Estimate' ? 'border-accent/50 bg-accent/10 text-accent' : source === 'Scraped' ? 'border-info/50 bg-info/10 text-info' : verifiedSources.includes(source) ? 'border-success/50 bg-success/10 text-success' : 'border-muted-foreground/30 bg-muted/30 text-muted-foreground';
  const fieldTone = (field: NoiFieldKey) => { const source = sources[field] ?? 'Blank'; return source === 'User Override' ? 'border-brand-400/40 bg-brand-500/5 focus-visible:ring-brand-400/50' : source === 'AI Estimate' ? 'border-accent/40 bg-accent/5 focus-visible:ring-accent/50' : 'bg-background/80'; };
  const SourceBadge = ({ field }: { field: NoiFieldKey }) => {
    const source = sources[field] ?? 'Blank';
    if (source === 'Blank') return <Badge variant="outline" className="w-fit border-muted-foreground/20 bg-muted/20 text-[10px] text-muted-foreground">No source yet</Badge>;
    return <Badge variant="outline" className={`w-fit text-[10px] ${sourceTone(source)}`}>Source · {badgeLabel[source]}</Badge>;
  };
  const FieldShell = ({ field, children, help }: { field: NoiFieldKey; children: React.ReactNode; help?: string }) => <div className={`rounded-lg border p-3 transition ${sources[field] === 'User Override' ? 'border-brand-400/30 bg-brand-500/[0.03]' : sources[field] === 'AI Estimate' ? 'border-accent/30 bg-accent/[0.03]' : 'border-border/60 bg-background/30'}`}><div className="mb-1.5 flex items-center justify-between gap-2"><Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{fieldLabels[field]}</Label>{help && <span title={help} className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/60 text-muted-foreground"><Info className="h-3 w-3" /></span>}</div>{children}<div className="mt-2 flex flex-wrap items-center gap-2"><SourceBadge field={field} />{sources[field] === 'User Override' && <Badge variant="outline" className="border-brand-400/40 bg-brand-500/10 text-[10px] text-brand-200"><PencilLine className="mr-1 h-3 w-3" />Manual override</Badge>}{sources[field] === 'AI Estimate' && <Badge variant="outline" className="border-accent/40 bg-accent/10 text-[10px] text-accent"><Sparkles className="mr-1 h-3 w-3" />AI applied</Badge>}</div>{scrapeConflicts[field] && <div className="mt-2 rounded-lg border border-brand-500/40 bg-brand-500/10 p-3 text-xs text-brand-100 shadow-sm"><div className="font-medium">New source value available while a saved override is active.</div><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => keepOverride(field)}>Keep override</Button><Button size="sm" variant="outline" onClick={() => useScrapedValue(field)}>Use source value</Button><Button size="sm" variant="ghost" onClick={() => window.alert(`Current override: ${currentRawValue(field)}\nNew source (Scraped): ${scrapeConflicts[field]}`)}>Compare values</Button></div></div>}</div>;
  const MoneyField = ({ field, value, help }: { field: NoiFieldKey; value: string; help?: string }) => <FieldShell field={field} help={help}><Input className={`h-11 text-right font-medium ${fieldTone(field)}`} type="number" value={value} placeholder={placeholderMap[field]} onChange={e => setField(field, e.target.value)} /></FieldShell>;
    const warningTone = (severity: NoiWarningSeverity) => severity === 'Critical' ? 'border-destructive/40 bg-destructive/10 text-destructive' : severity === 'Required' ? 'border-brand-500/40 bg-brand-500/10 text-brand-100' : 'border-info/40 bg-info/10 text-info';
  const statusTone = readiness.status === 'Verified NOI' ? 'border-success/40 text-success' : readiness.status === 'Specialist Review Recommended' ? 'border-brand-500/40 text-brand-300' : readiness.status === 'NOI Assessment Ready' ? 'border-primary/40 text-primary' : 'border-muted-foreground/30 text-muted-foreground';
  const assumptionRows = (Object.keys(fieldLabels) as NoiFieldKey[]).map(field => ({ field, label: fieldLabels[field], value: currentRawValue(field) || 'Pending', source: sources[field] ?? 'Blank' }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>NOI Calculator</CardTitle>
        <CardDescription>Effective Gross Income minus operating expenses, with Actual, Stabilised and Lender-Adjusted NOI connected to the global deal profile.</CardDescription>
        <div className="flex flex-wrap gap-2 pt-2 items-center">
          <Button size="sm" variant="outline" className="border-primary/40 text-primary" onClick={() => { setSyncOn(v => !v); toast.info(!syncOn ? 'Global Input Sync: On' : 'Global Input Sync: Off'); }}>Global Input Sync: {syncOn ? 'On' : 'Off'}</Button>
          <Button size="sm" variant="outline" onClick={openSpecialistReview}>Assumption Status</Button>
          <Badge variant="outline" className={statusTone}>{readiness.status}</Badge>
          <Badge variant="secondary">{assessment.confidenceTag}</Badge>
          {prefill ? <Badge variant="outline" className="border-success/40 text-success max-w-[260px] truncate" title={prefill.address}>Anchored: {prefill.address}</Badge> : <Badge variant="outline" className="border-brand-500/40 text-brand-400">No property selected</Badge>}
          <Button size="sm" variant="outline" onClick={requestEstimate} disabled={estimating}>{estimating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}Estimate for me</Button>
          <Button size="sm" variant="outline" onClick={applyAccepted} disabled={!aiEstimate}>Accept AI estimate</Button>
          {canSaveBack && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button size="sm" variant="outline" onClick={() => setSaveConfirmOpen(true)} disabled={!prefill || !hasSavableValue || saving}>{saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Save back to property</Button>
                  </span>
                </TooltipTrigger>
                {!prefill && <TooltipContent>Select or link a property before saving assumptions.</TooltipContent>}
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        {readiness.compactWarnings.length > 0 && (
          <div className="mt-3 rounded-xl border border-brand-500/40 bg-brand-500/10 p-3 text-xs text-brand-100 shadow-sm space-y-2">
            {readiness.compactWarnings.map(w => <div key={`${w.category}-${w.message}`} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{w.message}</span></div>)}
            {readiness.warnings.length > 3 && <button className="text-primary underline" onClick={() => setReviewOpen(true)}>View {readiness.warnings.length - 3} more in Assumption Status</button>}
          </div>
        )}
        {reviewOpen && (
          <div className="mt-2 rounded border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground space-y-3">
            <div className="flex justify-between gap-2">
              <span className="font-medium text-primary">Assumption Status</span>
              <div className="flex gap-2">
                {aiEstimate && <Button size="sm" variant="outline" onClick={() => setAiEstimate(e => e ? { ...e, estimatedFields: e.estimatedFields.map(f => ({ ...f, accepted: true, shouldOverwrite: !protectedSources.includes(f.sourceStatusBefore) || f.shouldOverwrite })) } : e)}>Accept all proposed</Button>}
                {aiEstimate && <Button size="sm" variant="outline" onClick={() => { setAiEstimate(null); toast.info('AI NOI estimate rejected.'); }}>Reject estimate</Button>}
              </div>
            </div>
            <div className="grid md:grid-cols-3 gap-2">
              <div><span className="font-medium text-foreground">Readiness:</span> {readiness.status}</div>
              <div><span className="font-medium text-foreground">Preliminary:</span> {readiness.preliminaryReady ? 'Complete' : 'Incomplete'}</div>
              <div><span className="font-medium text-foreground">Assessment ready:</span> {readiness.assessmentReady ? 'Complete' : 'Incomplete'}</div>
            </div>
            <div>
              <div className="font-medium text-foreground mb-1">Warnings and review items</div>
              {readiness.warnings.length ? readiness.warnings.map(w => <div key={`${w.category}-${w.severity}-${w.message}`} className={`mb-2 rounded-lg border p-3 ${warningTone(w.severity)}`}><div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-3.5 w-3.5" />{w.severity} · {w.category}</div><div className="mt-1">{w.message}</div><div className="mt-1 opacity-80">{w.detail}</div></div>) : <div className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" />No current readiness warnings.</div>}
            </div>
            <div>
              <div className="font-medium text-foreground mb-1">Assumption sources</div>
              <div className="grid md:grid-cols-2 gap-1">
                {assumptionRows.map(row => <div key={row.field} className="flex justify-between gap-2 rounded border border-border/50 px-2 py-1"><span>{row.label}</span><span className="text-right"><span className="text-foreground">{String(row.value)}</span> · {badgeLabel[row.source]}</span></div>)}
              </div>
            </div>
            {aiEstimate ? <div className="space-y-3 rounded-xl border border-accent/30 bg-accent/10 p-3"><div className="flex items-center gap-2 font-medium text-accent-foreground"><Sparkles className="h-4 w-4" />AI estimate preview / apply / edit / reject</div><p>{aiEstimate.summary}</p>{aiEstimate.warnings.map(w => <div key={w} className="rounded border border-brand-500/30 bg-brand-500/10 p-2 text-brand-200">• {w}</div>)}{aiEstimate.estimatedFields.map((f, idx) => <div key={`${f.field}-${idx}`} className={`grid grid-cols-1 gap-2 rounded-lg border p-3 md:grid-cols-6 ${f.accepted ? 'border-accent/50 bg-accent/10' : 'border-border/60 bg-background/40'}`}><div><b>Suggested {fieldLabels[f.field]}</b><div className="mt-1"><Badge variant="outline" className={sourceTone(f.sourceStatusBefore)}>{badgeLabel[f.sourceStatusBefore]}</Badge> <span className="mx-1">→</span> <Badge variant="outline" className="border-accent/50 bg-accent/10 text-accent">AI Estimate</Badge></div></div><div>Current: <span className="text-foreground">{String(f.currentValue ?? '—')}</span></div><div><Input className="h-9 border-accent/30 bg-background/80" value={String(f.estimatedValue ?? '')} onChange={e => updateProposal(idx, { estimatedValue: e.target.value })} /></div><div>Confidence: <span className="text-foreground">{f.confidence}</span></div><div>{f.reasoningSummary}{f.requiredDocument ? <div>Required: {f.requiredDocument}</div> : null}{protectedSources.includes(f.sourceStatusBefore) ? <div className="text-brand-300">Protected source — tick overwrite to apply.</div> : null}</div><div className="flex flex-wrap gap-2"><label className="flex items-center gap-1 rounded border border-accent/30 px-2 py-1"><input type="checkbox" checked={!!f.accepted} onChange={e => updateProposal(idx, { accepted: e.target.checked })} />Apply</label>{protectedSources.includes(f.sourceStatusBefore) && <label className="flex items-center gap-1 rounded border border-brand-400/30 px-2 py-1"><input type="checkbox" checked={!!f.shouldOverwrite} onChange={e => updateProposal(idx, { shouldOverwrite: e.target.checked })} />Override protected</label>}</div></div>)}</div> : null}
          </div>
        )}
        <AlertDialog open={saveConfirmOpen} onOpenChange={setSaveConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Save these NOI assumptions back to the property profile?</AlertDialogTitle>
              <AlertDialogDescription>
                This will save final field values, source states, original scraped values, user overrides, timestamp and calculation version, then refresh connected NOI-dependent modules.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2 text-sm">
              <Row label="Actual NOI" value={fmt(assessment.actualNoi)} />
              <Row label="Stabilised NOI" value={fmt(assessment.stabilisedNoi)} />
              <Row label="Lender-Adjusted NOI" value={fmt(assessment.lenderAdjustedNoi)} />
              <Row label="Selected NOI Basis" value={assessment.selectedBasis === 'actual' ? 'Actual NOI' : assessment.selectedBasis === 'stabilised' ? 'Stabilised NOI' : 'Lender-Adjusted NOI'} />
              <Row label="Manual overrides" value={String(sourceCounts.manualOverrides)} />
              <Row label="AI estimates" value={String(sourceCounts.aiEstimates)} />
              <Row label="Scraped values" value={String(sourceCounts.scrapedValues)} />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setSaveConfirmOpen(false); void saveBack(); }}>Save assumptions</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="order-2 lg:order-1 space-y-5">
          <Section title="Data Source & Sync" helper="Control linked-property sync, AI suggestions and save-back status.">
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span>Global Input Sync: <span className="text-foreground">{syncOn ? 'On' : 'Off'}</span></span>
              <span>·</span>
              <span>{prefill ? `Linked property: ${prefill.address}` : 'No linked property selected'}</span>
              <span>·</span>
              <span>Readiness: <span className="text-foreground">{readiness.status}</span></span>
            </div>
          </Section>

          <Section title="Income inputs" helper="Gross passing income, market income and ancillary income assumptions. Editable inputs use bordered fields; calculated outputs are shown separately.">
            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyField field="grossRent" value={grossRent} help="Gross passing income currently payable under existing leases." />
              <MoneyField field="marketRent" value={marketRent} help="Market income used for stabilised NOI comparison." />
              <MoneyField field="other" value={other} help="Non-rental income included in effective gross income." />
              <MoneyField field="vacancy" value={vacancy} help="Vacancy allowance percentage deducted from potential gross income." />
            </div>
          </Section>

          <Section title="Recoveries" helper="Recoverable outgoings are shown apart from non-recoverable expenses so the tenant recovery assumption is easy to audit.">
            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyField field="recovered" value={recovered} help="Recoverable outgoings charged back to tenants." />
            </div>
          </Section>

          <Section title="Vacancy and leasing assumptions" helper="Lease structure and selected NOI basis drive recoveries, stabilisation and lender presentation.">
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldShell field="leaseType"><select className="w-full rounded-md border bg-background p-2" value={leaseType} onChange={e => setField('leaseType', e.target.value)}><option value="unknown">Unknown</option><option value="gross">Gross</option><option value="net">Net</option><option value="semiGross">Semi-gross</option><option value="tripleNet">Triple net</option></select></FieldShell>
              <FieldShell field="noiBasis"><select className="w-full rounded-md border bg-background p-2" value={noiBasis} onChange={e => setField('noiBasis', e.target.value)}><option value="actual">Actual NOI</option><option value="stabilised">Stabilised NOI</option><option value="lenderAdjusted">Lender-adjusted NOI</option></select></FieldShell>
              <MoneyField field="incentiveAdjustment" value={incentiveAdjustment} />
              <MoneyField field="tenantRiskHaircut" value={tenantRiskHaircut} />
            </div>
          </Section>

          <Section title="Expense assumptions" helper="Non-recoverable expenses, management fees, repairs and maintenance can be entered as a simple total or itemised breakdown.">
            <div className="space-y-3">
              <MoneyField field="totalOperatingExpenses" value={totalOperatingExpenses} />
              <Collapsible open={expensesOpen} onOpenChange={setExpensesOpen}>
                <CollapsibleTrigger asChild><Button type="button" variant="outline" size="sm" className="border-primary/30 text-primary">{expensesOpen ? 'Hide' : 'Show'} itemised expenses</Button></CollapsibleTrigger>
                <CollapsibleContent className="mt-3 grid gap-2 sm:grid-cols-2">
                  {OUTGOING_KEYS.map(k => <div key={k} className="rounded-md border border-border/50 p-2"><Label className="text-xs text-muted-foreground">{labelMap[k]}</Label><Input type="number" value={outgoings[k] ?? ''} placeholder={outgoingPlaceholderMap[k]} onChange={e => setField(k, e.target.value)} /><SourceBadge field={k} />{scrapeConflicts[k] && <div className="mt-1 rounded border border-brand-500/30 bg-brand-500/10 p-2 text-xs text-brand-200"><div>New source value available. This field currently uses a saved override.</div><div className="mt-1 flex gap-2"><Button size="sm" variant="outline" onClick={() => keepOverride(k)}>Keep override</Button><Button size="sm" variant="outline" onClick={() => useScrapedValue(k)}>Use source value</Button><Button size="sm" variant="ghost" onClick={() => window.alert(`Current override: ${currentRawValue(k)}\nNew source (Scraped): ${scrapeConflicts[k]}`)}>Compare values</Button></div></div>}</div>)}
                </CollapsibleContent>
              </Collapsible>
            </div>
          </Section>

          <Section title="Warnings and assumptions" helper="Validation warnings, missing evidence and source quality remain visible before save-back.">
            {readiness.compactWarnings.length ? <div className="space-y-2">{readiness.compactWarnings.map(w => <div key={`${w.category}-${w.message}`} className="rounded-md border border-brand-500/30 bg-brand-500/10 p-3 text-sm text-brand-100"><div className="font-medium">{w.category} · {w.severity}</div><div>{w.message}</div></div>)}</div> : <div className="text-sm text-muted-foreground">No warnings to show yet. Start with core income and expense assumptions.</div>}
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setReviewOpen(true)}>Open Assumption Status</Button>
          </Section>
        </div>

        <div className="order-1 lg:order-2">
          <Section title="NOI outputs" helper="Calculated outputs are read-only and visually separated from editable assumptions." prominent>
            <div className="grid gap-3">
              <MetricCard label="Selected NOI used for borrowing" value={readiness.preliminaryReady ? fmt(assessment.selectedNoi) : pending} accent />
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard label="Actual NOI" value={readiness.preliminaryReady ? fmt(assessment.actualNoi) : pending} />
                <MetricCard label="Stabilised NOI" value={readiness.preliminaryReady ? fmt(assessment.stabilisedNoi) : pending} />
                <MetricCard label="Lender-Adjusted NOI" value={readiness.preliminaryReady ? fmt(assessment.lenderAdjustedNoi) : pending} />
              </div>
              <div className="rounded-lg border border-border/60 bg-background/40 p-3 space-y-2 text-sm">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Calculator className="h-3.5 w-3.5" />Calculated NOI bridge</div>
                <Row label="Potential Gross Income" value={readiness.preliminaryReady ? fmt(assessment.potentialGrossIncome) : pending} />
                <Row label="Vacancy Loss" value={readiness.preliminaryReady ? `- ${fmt(assessment.vacancyLoss)}` : pending} />
                <Row label="Recovered Outgoings" value={readiness.preliminaryReady ? `+ ${fmt(assessment.recoveredOutgoings)}` : pending} />
                <Row label="Effective Gross Income" value={readiness.preliminaryReady ? fmt(assessment.effectiveGrossIncome) : pending} />
                <Row label="Total Operating Expenses" value={readiness.preliminaryReady ? `- ${fmt(assessment.totalOperatingExpenses)}` : pending} />
              </div>
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">Lender-adjusted summary</div>
                <Row label="Actual NOI" value={readiness.preliminaryReady ? fmt(assessment.actualNoi) : pending} />
                <Row label="Stabilised NOI" value={readiness.preliminaryReady ? fmt(assessment.stabilisedNoi) : pending} />
                <Separator className="my-2" />
                <Row label="Lender-Adjusted NOI" value={readiness.preliminaryReady ? fmt(assessment.lenderAdjustedNoi) : pending} bold />
                <Row label="Selected basis" value={assessment.selectedBasis === 'actual' ? 'Actual NOI' : assessment.selectedBasis === 'stabilised' ? 'Stabilised NOI' : 'Lender-adjusted NOI'} muted />
              </div>
              <Collapsible open={bridgeOpen} onOpenChange={setBridgeOpen}>
                <CollapsibleTrigger asChild><Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-primary">{bridgeOpen ? 'Hide' : 'Show'} NOI Bridge</Button></CollapsibleTrigger>
                <CollapsibleContent className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground space-y-1">
                  {readiness.preliminaryReady ? assessment.bridge.map(item => <div key={item.label} className="flex justify-between gap-3"><span>{item.label}</span><span>{fmt(item.amount)}</span></div>) : <div>Pending</div>}
                </CollapsibleContent>
              </Collapsible>
            </div>
          </Section>
        </div>
      </CardContent>
    </Card>
  );
}

function Section({ title, helper, children, prominent }: { title: string; helper: string; children: React.ReactNode; prominent?: boolean }) { return <section className={`rounded-xl border ${prominent ? 'border-primary/30 bg-primary/5' : 'border-border/70 bg-card/60'} p-4 shadow-sm`}><div className="mb-3 border-l-2 border-primary pl-3"><h3 className="text-sm font-semibold text-foreground">{title}</h3><p className="text-xs text-muted-foreground">{helper}</p></div>{children}</section>; }
function MetricCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) { return <div className={`rounded-xl border ${accent ? 'border-primary/40 bg-primary/10' : 'border-border/60 bg-background/50'} p-4`}><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div><div className={`${accent ? 'text-2xl' : 'text-xl'} font-semibold text-foreground mt-1`}>{value}</div></div>; }
function Row({ label, value, bold, muted, highlight }: { label: string; value: string; bold?: boolean; muted?: boolean; highlight?: boolean }) { return <div className={`flex justify-between items-center ${highlight ? 'text-lg font-bold text-primary' : bold ? 'font-semibold' : ''} ${muted ? 'text-muted-foreground text-sm' : ''}`}><span>{label}</span><span>{value}</span></div>; }
