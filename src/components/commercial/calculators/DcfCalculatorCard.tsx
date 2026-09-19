import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { runDcfAssessment, type DcfAssessmentInputs, type DcfAssessmentResult } from '@/utils/commercial';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getDefaultCommercialIndustrialDealProfile, useCommercialDealState } from '@/utils/commercial/commercialDealState';
import { commercialApi } from '@/hooks/useCommercialProperties';
import { toast } from 'sonner';

const PENDING = 'Pending';
const EMPTY_STATUS = 'Awaiting DCF Inputs';
const EMPTY_HELPER = 'Import property, NOI, cap rate, GST and lending assumptions or enter values manually to generate the cashflow model.';

type DcfFieldKey = 'price' | 'acqCosts' | 'initialNoi' | 'hold' | 'growth' | 'vacancy' | 'termCap' | 'sellingCosts' | 'discount' | 'loan' | 'interest' | 'term' | 'annualCapex' | 'downtimeMonths';
type DcfSourceState = 'Blank' | 'Property Profile' | 'Scraped' | 'NOI Tab' | 'Cap Rate Tab' | 'GST Tab' | 'ICR / DSCR Tab' | 'Borrowing Capacity' | 'Research Engine' | 'AI Estimate' | 'Manual' | 'User Override' | 'Verified';
type Candidate = { value: number; source: DcfSourceState; detail?: string };
type FieldMeta = { source: DcfSourceState; original?: Candidate; pending?: Candidate; history: string[] };
type NoiTreatmentMode = 'adjusted' | 'apply' | 'requires_confirmation';
type GeneratedCashflowRow = { year: number; openingNoi: number; vacancyAdjustment: number; effectiveNoi: number; rentalGrowthApplied: number; capex: number; downtimeAdjustment: number; unleveredCashFlow: number; debtService: number; interestComponent: number; principalComponent: number; leveredCashFlow: number; loanBalance: number; terminalValue?: number; sellingCosts?: number; netSaleProceedsToEquity?: number; finalYearTotalCashFlow?: number };
type EstimateOrigin = 'Research Engine' | 'Previous Tab' | 'AI Estimate';
type EstimateItem = { id: string; field?: DcfFieldKey; noiMode?: NoiTreatmentMode; label: string; value: string; sourceBasis: string; confidence: 'High' | 'Medium' | 'Low'; origin: EstimateOrigin; missingInfo: string; riskNotes: string; recommendedVerification: string; selected: boolean };
type DcfReadinessStatus = 'Awaiting DCF Inputs' | 'Preliminary DCF Estimate' | 'DCF Ready to Generate' | 'Cashflow Generated' | 'Cashflow Out of Date' | 'Specialist Review Recommended' | 'DCF Verified';
type DcfWarning = { message: string; priority: number; group: string; exportBlock?: boolean };

type FieldState = Record<DcfFieldKey, string>;
type MetaState = Record<DcfFieldKey, FieldMeta>;

const fieldKeys: DcfFieldKey[] = ['price', 'acqCosts', 'initialNoi', 'hold', 'growth', 'vacancy', 'termCap', 'sellingCosts', 'discount', 'loan', 'interest', 'term', 'annualCapex', 'downtimeMonths'];
const blankFields = Object.fromEntries(fieldKeys.map((k) => [k, ''])) as FieldState;
const blankMeta = Object.fromEntries(fieldKeys.map((k) => [k, { source: 'Blank', history: [] }])) as MetaState;
const defaultProfile = getDefaultCommercialIndustrialDealProfile();

const placeholders: Record<DcfFieldKey, string> = {
  price: 'Pulled from property profile or enter manually',
  acqCosts: 'Pulled from purchase costs / GST or enter manually',
  initialNoi: 'Pulled from NOI tab or enter manually',
  hold: 'Enter hold period',
  growth: 'Enter annual rent growth',
  vacancy: 'Enter vacancy allowance',
  termCap: 'Pulled from Cap Rate tab or enter manually',
  sellingCosts: 'Enter selling cost allowance',
  discount: 'Enter discount rate',
  loan: 'Pulled from borrowing capacity or enter manually',
  interest: 'Pulled from ICR / DSCR or enter manually',
  term: 'Enter loan term',
  annualCapex: 'Enter annual capex',
  downtimeMonths: 'Enter downtime months',
};

const noiTreatmentLabels: Record<NoiTreatmentMode, string> = {
  adjusted: 'NOI already vacancy-adjusted',
  apply: 'Apply vacancy allowance in DCF',
  requires_confirmation: 'Requires confirmation',
};

const sourceLabels: Record<DcfSourceState, string> = {
  Blank: 'Blank',
  'Property Profile': 'From Property',
  Scraped: 'Scraped',
  'NOI Tab': 'From NOI',
  'Cap Rate Tab': 'From Cap Rate',
  'GST Tab': 'From GST',
  'ICR / DSCR Tab': 'From ICR / DSCR',
  'Borrowing Capacity': 'From Borrowing',
  'Research Engine': 'Research',
  'AI Estimate': 'AI Estimate',
  Manual: 'Manual',
  'User Override': 'Override',
  Verified: 'Verified',
};

const fieldLabels: Record<DcfFieldKey, string> = {
  price: 'Purchase Price', acqCosts: 'Acquisition Costs', initialNoi: 'Base NOI', hold: 'Hold Period', growth: 'Rental Growth', vacancy: 'Vacancy Allowance', termCap: 'Terminal Cap', sellingCosts: 'Selling Costs', discount: 'Discount Rate', loan: 'Loan Amount', interest: 'Interest Rate', term: 'Loan Term', annualCapex: 'Annual Capex', downtimeMonths: 'Downtime Months',
};

const fmt0 = (n: number) => Number.isFinite(n) ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n) : PENDING;
const parseNumber = (value: string): number | null => {
  const stripped = value.replace(/[$,%\s]/g, '').replace(/,/g, '');
  if (stripped === '') return null;
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : null;
};
const num = (v: string) => parseNumber(v) ?? 0;
const hasNumber = (v: string) => parseNumber(v) != null;
const safePct = (n: number | null | undefined) => (n != null && Number.isFinite(n) ? `${n}%` : PENDING);
const asNum = (...values: unknown[]) => values.map(Number).find((v) => Number.isFinite(v) && v !== 0);
const candidate = (value: unknown, source: DcfSourceState, detail?: string): Candidate | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? { value: n, source, detail } : undefined;
};
const changedFromDefault = (value: unknown, defaultValue: unknown) => Number.isFinite(Number(value)) && Number(value) !== 0 && Number(value) !== Number(defaultValue ?? 0);
const DCF_CALCULATION_VERSION = 'DCF v1.1';

const aiIncludesVacancy = (metadata: unknown): boolean | undefined => {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const m = metadata as Record<string, any>;
  const values = [m.vacancyAdjusted, m.includesVacancy, m.vacancyIncluded, m.valueAlreadyVacancyAdjusted, m.metadata?.vacancyAdjusted, m.metadata?.includesVacancy];
  const bool = values.find((v) => typeof v === 'boolean');
  if (typeof bool === 'boolean') return bool;
  const text = [m.reasoningSummary, m.notes, m.sourceDetail].filter(Boolean).join(' ').toLowerCase();
  if (text.includes('vacancy-adjusted') || text.includes('vacancy adjusted') || text.includes('after vacancy') || text.includes('includes vacancy')) return true;
  if (text.includes('before vacancy') || text.includes('pre-vacancy') || text.includes('excludes vacancy')) return false;
  return undefined;
};

export function DcfCalculatorCard() {
  const { prefill, property, pushBack } = useCalculatorPrefill();
  const profile = useCommercialDealState((s) => s.profile);
  const updateGlobal = useCommercialDealState((s) => s.updateGlobal);
  const [fields, setFields] = useState<FieldState>(blankFields);
  const [meta, setMeta] = useState<MetaState>(blankMeta);
  const [noiTreatmentMode, setNoiTreatmentMode] = useState<NoiTreatmentMode>('apply');
  const [noiTreatmentTouched, setNoiTreatmentTouched] = useState(false);
  const [noneConfirmed, setNoneConfirmed] = useState({ acqCosts: false, annualCapex: false, downtimeMonths: false });
  const [generatedResult, setGeneratedResult] = useState<DcfAssessmentResult | null>(null);
  const [generatedRows, setGeneratedRows] = useState<GeneratedCashflowRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [showSensitivity, setShowSensitivity] = useState(false);
  const [showScenarios, setShowScenarios] = useState(false);
  const [includeCommentary, setIncludeCommentary] = useState(false);
  const [dcfCommentary, setDcfCommentary] = useState('');
  const [generatedInputs, setGeneratedInputs] = useState<DcfAssessmentInputs | null>(null);
  const [estimatePanelOpen, setEstimatePanelOpen] = useState(false);
  const [estimateMessage, setEstimateMessage] = useState<string | null>(null);
  const [estimates, setEstimates] = useState<EstimateItem[]>([]);
  const [showWarningLog, setShowWarningLog] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [savingDcf, setSavingDcf] = useState(false);

  const linkedLabel = prefill ? `Linked property: ${prefill.address || prefill.propertyId}` : 'Manual entry / no property linked';

  const cascade = useMemo<Record<DcfFieldKey, Candidate | undefined>>(() => {
    const p = (property ?? {}) as Record<string, any>;
    const scrape = p.scraped_data ?? p.scrape ?? p.property_scrape ?? {};
    const research = p.research_engine ?? p.research ?? p.market_research ?? {};
    const ai = profile.aiEstimateMetadata;
    const aiValue = (key: string) => ai[key]?.estimatedValue ?? ai[`dcfInputs.${key}`]?.estimatedValue;
    const aiInitialNoi = ai.initialNoi ?? ai['dcfInputs.initialNoi'];
    const acqCostTotal = asNum(profile.fundsToComplete?.totalAcquisitionCosts, (profile.gstOutputs?.gstEconomicCost ?? 0) + (profile.acquisitionCosts?.otherAcquisitionCosts ?? 0), profile.acquisitionCosts?.otherAcquisitionCosts);
    const actualNoi = asNum(profile.noiOutputs?.actualNoi, (profile.noiOutputs as any)?.netOperatingIncome, profile.leaseIncome.grossPassingRent);
    const stabilisedNoi = asNum(profile.noiOutputs?.stabilisedNoi, (profile.noiOutputs as any)?.stabilizedNoi, profile.leaseIncome.marketRent);
    const lenderNoi = asNum(profile.noiOutputs?.lenderAdjustedNoi, (profile.noiOutputs as any)?.lenderNoi);
    const selectedNoi = lenderNoi ?? stabilisedNoi ?? actualNoi;
    const purchaseFromGlobal = changedFromDefault(profile.propertyValuation.purchasePrice, defaultProfile.propertyValuation.purchasePrice) ? profile.propertyValuation.purchasePrice : undefined;
    const gstPurchase = changedFromDefault(profile.gstInputs.purchasePrice, defaultProfile.gstInputs.purchasePrice) ? profile.gstInputs.purchasePrice : undefined;
    const borrowingPurchase = changedFromDefault((profile.borrowingOutputs as any)?.inputs?.purchasePrice ?? profile.propertyValuation.estimatedMarketValue, defaultProfile.propertyValuation.estimatedMarketValue) ? ((profile.borrowingOutputs as any)?.inputs?.purchasePrice ?? profile.propertyValuation.estimatedMarketValue) : undefined;

    return {
      price: candidate(prefill?.purchasePrice ?? prefill?.valuation, 'Property Profile') ?? candidate(gstPurchase, 'GST Tab') ?? candidate(borrowingPurchase ?? purchaseFromGlobal, 'Borrowing Capacity') ?? candidate(scrape.purchasePrice ?? scrape.price, 'Scraped'),
      acqCosts: candidate(profile.fundsToComplete?.totalAcquisitionCosts, 'Borrowing Capacity', 'Funds-to-complete') ?? candidate(profile.gstOutputs?.gstEconomicCost, 'GST Tab', 'Net GST economic cost') ?? candidate(acqCostTotal, 'Borrowing Capacity') ?? candidate(aiValue('acquisitionCosts'), 'AI Estimate'),
      initialNoi: candidate(selectedNoi, 'NOI Tab', lenderNoi ? 'Lender-Adjusted NOI' : stabilisedNoi ? 'Stabilised NOI' : actualNoi ? 'Actual NOI' : undefined) ?? candidate(prefill?.passingNoi ?? prefill?.marketNoi, 'Property Profile') ?? candidate(aiValue('initialNoi'), 'AI Estimate', aiIncludesVacancy(aiInitialNoi) === true ? 'Vacancy included' : aiIncludesVacancy(aiInitialNoi) === false ? 'Before vacancy' : undefined),
      hold: changedFromDefault(profile.dcfInputs.holdPeriodYears, defaultProfile.dcfInputs.holdPeriodYears) ? candidate(profile.dcfInputs.holdPeriodYears, 'Manual') : undefined,
      growth: candidate(research.rentalGrowthPct ?? research.marketGrowthPct ?? research.rent_growth_pct, 'Research Engine') ?? candidate(aiValue('rentalGrowthPct'), 'AI Estimate'),
      vacancy: (changedFromDefault(profile.leaseIncome.vacancyAllowancePct, defaultProfile.leaseIncome.vacancyAllowancePct) ? candidate(profile.leaseIncome.vacancyAllowancePct, 'NOI Tab') : undefined) ?? candidate(research.vacancyAllowancePct ?? research.vacancy_pct, 'Research Engine') ?? candidate(aiValue('vacancyAllowancePct'), 'AI Estimate'),
      termCap: candidate((profile.capRateOutputs as any)?.targetCapRatePct ?? (profile.capRateOutputs as any)?.capRatePct, 'Cap Rate Tab') ?? candidate(research.capRatePct ?? research.terminalCapRatePct, 'Research Engine') ?? candidate(aiValue('terminalCapRatePct'), 'AI Estimate'),
      sellingCosts: candidate(p.selling_costs_pct ?? p.transaction_assumptions?.sellingCostsPct, 'Property Profile') ?? candidate(aiValue('sellingCostsPct'), 'AI Estimate'),
      discount: candidate(research.discountRatePct ?? research.riskAdjustedDiscountRatePct, 'Research Engine') ?? candidate(aiValue('discountRatePct'), 'AI Estimate'),
      loan: candidate(profile.borrowingOutputs?.finalRiskAdjustedLoan ?? profile.debtInputs.proposedLoanAmount, 'Borrowing Capacity') ?? candidate((profile.icrDscrOutputs as any)?.loanAmount, 'ICR / DSCR Tab'),
      interest: candidate((profile.icrDscrOutputs as any)?.interestRatePct, 'ICR / DSCR Tab') ?? (changedFromDefault(profile.lendingAssumptions.contractInterestRatePct, defaultProfile.lendingAssumptions.contractInterestRatePct) ? candidate(profile.lendingAssumptions.contractInterestRatePct, 'Borrowing Capacity') : undefined) ?? candidate(profile.lendingAssumptions.assessmentFloorRatePct, 'Borrowing Capacity'),
      term: candidate((profile.icrDscrOutputs as any)?.loanTermYears, 'ICR / DSCR Tab') ?? (changedFromDefault(profile.lendingAssumptions.loanTermYears, defaultProfile.lendingAssumptions.loanTermYears) ? candidate(profile.lendingAssumptions.loanTermYears, 'Borrowing Capacity') : undefined) ?? (changedFromDefault(profile.lendingAssumptions.amortisationYears, defaultProfile.lendingAssumptions.amortisationYears) ? candidate(profile.lendingAssumptions.amortisationYears, 'Borrowing Capacity') : undefined),
      annualCapex: candidate(p.annual_capex ?? p.capex_reserve_pa, 'Property Profile') ?? candidate(research.annualCapex, 'Research Engine') ?? candidate(aiValue('annualCapex'), 'AI Estimate'),
      downtimeMonths: candidate(p.downtime_months ?? p.lease_risk?.downtimeMonths, 'Property Profile') ?? candidate(aiValue('downtimeMonths'), 'AI Estimate'),
    };
  }, [prefill, property, profile]);

  useEffect(() => {
    setFields((current) => {
      let changed = false;
      const next = { ...current };
      setMeta((m) => {
        const nm = { ...m };
        fieldKeys.forEach((key) => {
          const c = cascade[key];
          if (!c) return;
          const currentMeta = nm[key];
          const currentValue = current[key];
          const sameCurrent = Number(currentValue) === c.value;
          if (currentMeta.source === 'User Override') {
            if (!sameCurrent && (!currentMeta.pending || currentMeta.pending.value !== c.value || currentMeta.pending.source !== c.source)) nm[key] = { ...currentMeta, pending: c };
            return;
          }
          if (currentValue === '' || currentMeta.source !== c.source || !sameCurrent) {
            next[key] = String(c.value);
            changed = true;
            nm[key] = { source: c.source, original: c, history: [...currentMeta.history, `${new Date().toISOString()}: ${fieldLabels[key]} set from ${c.source}${c.detail ? ` (${c.detail})` : ''} = ${c.value}`] };
          }
        });
        return nm;
      });
      return changed ? next : current;
    });
  }, [cascade]);

  useEffect(() => {
    if (noiTreatmentTouched) return;
    const noi = meta.initialNoi;
    if (noi.source === 'NOI Tab' && ['Actual NOI', 'Stabilised NOI', 'Lender-Adjusted NOI'].includes(noi.original?.detail ?? '')) {
      setNoiTreatmentMode('adjusted');
      return;
    }
    if (noi.source === 'AI Estimate') {
      if (noi.original?.detail === 'Vacancy included') setNoiTreatmentMode('adjusted');
      else if (noi.original?.detail === 'Before vacancy') setNoiTreatmentMode('apply');
      else setNoiTreatmentMode('requires_confirmation');
      return;
    }
    if (noi.source === 'Manual') setNoiTreatmentMode('requires_confirmation');
  }, [meta.initialNoi, noiTreatmentTouched]);

  const updateField = (key: DcfFieldKey, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    setMeta((current) => {
      const m = current[key];
      const nextSource: DcfSourceState = m.source === 'Blank' || m.source === 'Manual' ? 'Manual' : 'User Override';
      const history = m.source === 'Blank' || m.source === 'Manual'
        ? m.history
        : [...m.history, `${new Date().toISOString()}: User override preserved original ${m.original?.source ?? m.source} value ${m.original?.value ?? 'blank'}.`];
      return { ...current, [key]: { ...m, source: nextSource, history } };
    });
  };

  const usePendingSource = (key: DcfFieldKey) => {
    const pending = meta[key].pending;
    if (!pending) return;
    setFields((current) => ({ ...current, [key]: String(pending.value) }));
    setMeta((current) => ({ ...current, [key]: { source: pending.source, original: pending, pending: undefined, history: [...current[key].history, `${new Date().toISOString()}: Override replaced with new ${pending.source} value ${pending.value}.`] } }));
  };

  const keepOverride = (key: DcfFieldKey) => setMeta((current) => ({ ...current, [key]: { ...current[key], pending: undefined, history: [...current[key].history, `${new Date().toISOString()}: Kept saved override instead of new source value.`] } }));

  const parsed = useMemo(() => {
    const values = Object.fromEntries(fieldKeys.map((key) => [key, parseNumber(fields[key])])) as Record<DcfFieldKey, number | null>;
    const holdInteger = values.hold != null && Number.isInteger(values.hold) && values.hold > 0;
    const leverageEnabled = values.loan != null && values.loan > 0;
    const debtInputsValid = !leverageEnabled || ((values.interest ?? 0) > 0 && (values.term ?? 0) > 0);
    const vacancyReady = noiTreatmentMode === 'adjusted' || values.vacancy != null;
    const acquisitionReady = values.acqCosts != null || noneConfirmed.acqCosts;
    const annualCapexReady = values.annualCapex != null || noneConfirmed.annualCapex;
    const downtimeReady = values.downtimeMonths != null || noneConfirmed.downtimeMonths;
    const requiredReady = values.price != null && values.price > 0
      && acquisitionReady
      && values.initialNoi != null && values.initialNoi > 0
      && holdInteger
      && values.growth != null
      && vacancyReady
      && values.termCap != null && values.termCap > 0
      && values.sellingCosts != null
      && values.discount != null && values.discount > 0
      && annualCapexReady
      && downtimeReady
      && debtInputsValid;
    return { values, holdInteger, leverageEnabled, debtInputsValid, acquisitionReady, annualCapexReady, downtimeReady, requiredReady };
  }, [fields, noiTreatmentMode, noneConfirmed]);

  const noiTreatmentConfirmed = noiTreatmentMode !== 'requires_confirmation';
  const vacancyMayBeDoubleCounted = noiTreatmentMode === 'apply' && (meta.initialNoi.source === 'NOI Tab' || meta.initialNoi.original?.detail === 'Vacancy included');
  const canGenerate = noiTreatmentConfirmed && parsed.requiredReady;
  const coreKey = useMemo(() => JSON.stringify({ values: parsed.values, noiTreatmentMode, noneConfirmed }), [parsed.values, noiTreatmentMode, noneConfirmed]);
  const cashflowOutOfDate = Boolean(generatedResult && generatedKey !== coreKey);
  const cashflowCurrent = Boolean(generatedResult && generatedKey === coreKey);
  const result = generatedResult;

  const buildDcfInputs = (): DcfAssessmentInputs => {
    const v = parsed.values;
    return {
      purchasePrice: v.price!,
      acquisitionCosts: v.acqCosts ?? 0,
      initialNoi: v.initialNoi!,
      holdPeriodYears: v.hold!,
      rentalGrowthPct: v.growth!,
      vacancyAllowancePct: noiTreatmentMode === 'adjusted' ? 0 : v.vacancy!,
      terminalCapRatePct: v.termCap!,
      sellingCostsPct: v.sellingCosts!,
      discountRatePct: v.discount!,
      loanAmount: v.loan ?? 0,
      interestRatePct: v.interest ?? 0,
      loanTermYears: v.term ?? 0,
      annualCapex: v.annualCapex ?? 0,
      downtimeMonths: v.downtimeMonths ?? 0,
      exitCapSensitivityPct: [v.termCap! - 0.5, v.termCap!, v.termCap! + 0.5],
    };
  };

  const buildGeneratedRows = (dcfResult: DcfAssessmentResult, inputs: DcfAssessmentInputs): GeneratedCashflowRow[] => {
    const downtimeAdjustment = inputs.initialNoi * ((inputs.downtimeMonths ?? 0) / 12);
    return dcfResult.rows.map((row, index) => {
      const previousRow = dcfResult.rows[index - 1];
      const openingNoi = index === 0 ? inputs.initialNoi : previousRow.noi;
      const vacancyAdjustment = index === 0 && noiTreatmentMode === 'apply' ? inputs.initialNoi * ((inputs.vacancyAllowancePct ?? 0) / 100) : 0;
      const principalComponent = Math.max(0, (previousRow?.loanBalance ?? inputs.loanAmount ?? 0) - row.loanBalance);
      const interestComponent = Math.max(0, row.debtService - principalComponent);
      const finalYear = index === dcfResult.rows.length - 1;
      const sellingCosts = finalYear ? dcfResult.terminalValue * ((inputs.sellingCostsPct ?? 0) / 100) : undefined;
      const terminalValue = finalYear ? dcfResult.terminalValue : undefined;
      const netSaleProceedsToEquity = finalYear ? dcfResult.netSaleProceeds : undefined;
      return {
        year: row.year,
        openingNoi,
        vacancyAdjustment,
        effectiveNoi: row.noi,
        rentalGrowthApplied: index === 0 ? 0 : Number(inputs.rentalGrowthPct),
        capex: index === 0 ? Math.max(0, row.capex - downtimeAdjustment) : row.capex,
        downtimeAdjustment: index === 0 ? downtimeAdjustment : 0,
        unleveredCashFlow: row.unleveredCf,
        debtService: row.debtService,
        interestComponent,
        principalComponent,
        leveredCashFlow: row.leveredCf,
        loanBalance: row.loanBalance,
        terminalValue,
        sellingCosts,
        netSaleProceedsToEquity,
        finalYearTotalCashFlow: finalYear ? row.leveredCf + dcfResult.netSaleProceeds : undefined,
      };
    });
  };

  const contextAvailable = Boolean(prefill || property || fieldKeys.some((key) => meta[key].source !== 'Blank'));

  const estimateFromCandidate = (field: DcfFieldKey, label: string, c: Candidate | undefined): EstimateItem | undefined => {
    if (!c) return undefined;
    const origin: EstimateOrigin = c.source === 'Research Engine' ? 'Research Engine' : c.source === 'AI Estimate' ? 'AI Estimate' : 'Previous Tab';
    return {
      id: field,
      field,
      label,
      value: String(c.value),
      sourceBasis: c.detail ? `${c.source} — ${c.detail}` : c.source,
      confidence: origin === 'Research Engine' ? 'High' : origin === 'Previous Tab' ? 'Medium' : 'Low',
      origin,
      missingInfo: origin === 'AI Estimate' ? 'Verify against lease evidence, market report and lender assumptions.' : 'None identified from available context.',
      riskNotes: field === 'vacancy' ? 'Vacancy assumptions can materially change Year 1 and downside returns.' : field === 'termCap' || field === 'discount' ? 'Exit yield and discount rate assumptions are market-sensitive.' : 'Review before client-report reliance.',
      recommendedVerification: origin === 'Research Engine' ? 'Confirm against market evidence and source date.' : origin === 'Previous Tab' ? 'Confirm source tab inputs are final.' : 'Treat as unverified AI estimate until independently supported.',
      selected: true,
    };
  };

  const handleEstimateForMe = () => {
    if (!contextAvailable) {
      setEstimatePanelOpen(true);
      setEstimates([]);
      setEstimateMessage('More property, NOI, market and lending information is required before DCF assumptions can be estimated.');
      return;
    }
    const suggested = [
      estimateFromCandidate('growth', 'Rental Growth %', cascade.growth),
      estimateFromCandidate('vacancy', 'Vacancy Allowance %', cascade.vacancy),
      estimateFromCandidate('termCap', 'Terminal Cap %', cascade.termCap),
      estimateFromCandidate('sellingCosts', 'Selling Costs %', cascade.sellingCosts),
      estimateFromCandidate('discount', 'Discount Rate %', cascade.discount),
      estimateFromCandidate('annualCapex', 'Annual Capex', cascade.annualCapex),
      estimateFromCandidate('downtimeMonths', 'Downtime Months', cascade.downtimeMonths),
      estimateFromCandidate('hold', 'Hold Period', cascade.hold),
    ].filter(Boolean) as EstimateItem[];
    if (meta.initialNoi.source === 'NOI Tab' || meta.initialNoi.original?.detail === 'Vacancy included') {
      suggested.push({ id: 'noi-mode', label: 'NOI Treatment Mode', value: noiTreatmentLabels.adjusted, noiMode: 'adjusted', sourceBasis: meta.initialNoi.original?.detail ? `Base NOI — ${meta.initialNoi.original.detail}` : 'Base NOI source indicates vacancy-adjusted NOI', confidence: 'High', origin: 'Previous Tab', missingInfo: 'None identified from available context.', riskNotes: 'Avoid applying vacancy twice when NOI already includes vacancy loss.', recommendedVerification: 'Confirm NOI tab basis before client report.', selected: true });
    }
    suggested.push({ id: 'scenario-conservative', label: 'Conservative scenario assumptions', value: 'Lower growth, higher vacancy, softer exit cap', sourceBasis: 'DCF scenario framework using available assumptions', confidence: 'Low', origin: 'AI Estimate', missingInfo: 'Requires final lease, market and capex evidence.', riskNotes: 'Downside assumptions should be supported before client presentation.', recommendedVerification: 'Review against market evidence and risk appetite.', selected: false });
    suggested.push({ id: 'scenario-optimistic', label: 'Optimistic scenario assumptions', value: 'Higher growth, lower exit cap, stable vacancy', sourceBasis: 'DCF scenario framework using available assumptions', confidence: 'Low', origin: 'AI Estimate', missingInfo: 'Requires market support.', riskNotes: 'Upside case should not be treated as base case.', recommendedVerification: 'Verify against rent growth and exit-yield evidence.', selected: false });
    suggested.push({ id: 'scenario-stress', label: 'Higher vacancy / capex / rate cases', value: 'Stress vacancy, capex and interest rate independently', sourceBasis: 'DCF sensitivity framework', confidence: 'Low', origin: 'AI Estimate', missingInfo: 'Requires sponsor/lender stress parameters.', riskNotes: 'Stress cases may materially reduce levered return.', recommendedVerification: 'Confirm with lender and client risk tolerance.', selected: false });
    setEstimates(suggested);
    setEstimateMessage(suggested.length ? null : 'More property, NOI, market and lending information is required before DCF assumptions can be estimated.');
    setEstimatePanelOpen(true);
  };

  const updateEstimate = (id: string, patch: Partial<EstimateItem>) => setEstimates((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const rejectEstimate = (id: string) => setEstimates((items) => items.filter((item) => item.id !== id));

  const applyEstimates = (selectedOnly: boolean) => {
    const selected = estimates.filter((item) => !selectedOnly || item.selected);
    if (!selected.length) return;
    setFields((current) => {
      const next = { ...current };
      selected.forEach((item) => { if (item.field) next[item.field] = item.value; });
      return next;
    });
    setMeta((current) => {
      const next = { ...current };
      selected.forEach((item) => {
        if (!item.field) return;
        const source: DcfSourceState = item.origin === 'Research Engine' ? 'Research Engine' : 'AI Estimate';
        const estimate = { value: parseNumber(item.value) ?? 0, source, detail: item.sourceBasis };
        next[item.field] = { source, original: estimate, history: [...next[item.field].history, `${new Date().toISOString()}: ${item.label} estimate accepted from ${item.origin}; original estimate ${item.value}.`] };
      });
      return next;
    });
    const mode = selected.find((item) => item.noiMode)?.noiMode;
    if (mode) { setNoiTreatmentMode(mode); setNoiTreatmentTouched(true); }
    setEstimateMessage(`${selected.length} estimate${selected.length === 1 ? '' : 's'} accepted. Accepted AI estimates remain unverified until supporting evidence is reviewed.`);
  };

  const dcfWarnings = useMemo<DcfWarning[]>(() => {
    const warnings: DcfWarning[] = [];
    const add = (message: string, priority: number, group: string, exportBlock = false) => warnings.push({ message, priority, group, exportBlock });
    if (!parsed.requiredReady) add('Core DCF inputs are missing or invalid.', 100, 'Readiness', true);
    if (meta.initialNoi.source !== 'NOI Tab') add('Base NOI is not linked to the NOI tab.', 85, 'NOI');
    if (noiTreatmentMode === 'requires_confirmation') add('NOI Treatment Mode is missing or requires confirmation.', 95, 'NOI', true);
    if (vacancyMayBeDoubleCounted) add('Vacancy may be double-counted.', 90, 'NOI');
    if (meta.termCap.source === 'AI Estimate') add('Terminal cap is AI-estimated and not verified.', 80, 'Exit');
    if (meta.growth.source === 'AI Estimate') add('Rental growth is AI-estimated and not verified.', 75, 'Growth');
    if (meta.discount.source === 'Manual') add('Discount rate is manually entered and not verified.', 70, 'Discount rate');
    if (!fields.hold) add('Hold period is missing.', 88, 'Hold period', true);
    const entryCap = parsed.values.price && parsed.values.initialNoi ? (parsed.values.initialNoi / parsed.values.price) * 100 : undefined;
    if (entryCap && parsed.values.termCap && parsed.values.termCap < entryCap - 0.75) add('Terminal cap is materially lower than entry cap.', 78, 'Exit');
    const sensitivityValues = result?.sensitivityTable.map((r) => r.netSaleProceeds) ?? [];
    if (sensitivityValues.length >= 2) {
      const max = Math.max(...sensitivityValues);
      const min = Math.min(...sensitivityValues);
      if (max > 0 && (max - min) / max > 0.15) add('Exit cap sensitivity shows material valuation risk.', 68, 'Sensitivity');
    }
    if (result && result.totalEquityReturned > 0 && Math.abs(result.netSaleProceeds / result.totalEquityReturned) > 0.7) add('Levered return is materially dependent on terminal value.', 65, 'Returns');
    if (meta.acqCosts.source !== 'GST Tab' && meta.acqCosts.source !== 'Borrowing Capacity' && !noneConfirmed.acqCosts) add('Acquisition costs are missing or not linked to GST / purchase costs.', 82, 'Acquisition costs');
    if (parsed.leverageEnabled && meta.loan.source !== 'Borrowing Capacity') add('Loan amount is manually entered or not linked to Borrowing Capacity.', 72, 'Debt');
    if (cashflowOutOfDate) add('Cashflow table is out of date.', 100, 'Generation', true);
    if (!generatedResult) add('Full hold period schedule has not been generated.', 92, 'Generation', true);
    return warnings.sort((a, b) => b.priority - a.priority);
  }, [parsed, meta, noiTreatmentMode, vacancyMayBeDoubleCounted, fields.hold, result, noneConfirmed.acqCosts, cashflowOutOfDate, generatedResult]);

  const hasUnverifiedSources = fieldKeys.some((key) => ['AI Estimate', 'Manual', 'User Override'].includes(meta[key].source));
  const specialistReviewRecommended = dcfWarnings.some((w) => w.priority >= 80 && !w.exportBlock) || hasUnverifiedSources;
  const dcfVerified = Boolean(cashflowCurrent && !dcfWarnings.length && fieldKeys.every((key) => ['Verified', 'Property Profile', 'NOI Tab', 'Cap Rate Tab', 'GST Tab', 'ICR / DSCR Tab', 'Borrowing Capacity', 'Research Engine', 'Blank'].includes(meta[key].source)));
  const readinessStatus: DcfReadinessStatus = cashflowOutOfDate
    ? 'Cashflow Out of Date'
    : dcfVerified
      ? 'DCF Verified'
      : cashflowCurrent
        ? (specialistReviewRecommended ? 'Specialist Review Recommended' : 'Cashflow Generated')
        : !parsed.requiredReady || !noiTreatmentConfirmed
          ? 'Awaiting DCF Inputs'
          : specialistReviewRecommended
            ? 'Preliminary DCF Estimate'
            : 'DCF Ready to Generate';
  const priorityWarnings = dcfWarnings.slice(0, 3);
  const exportBlocked = !generatedResult || cashflowOutOfDate;
  const exportWarning = !exportBlocked && (readinessStatus === 'Preliminary DCF Estimate' || readinessStatus === 'Specialist Review Recommended') ? 'DCF includes unverified assumptions.' : null;

  const handleGenerateCashflow = () => {
    if (!canGenerate) return;
    const inputs = buildDcfInputs();
    const nextResult = runDcfAssessment(inputs);
    setGeneratedResult(nextResult);
    setGeneratedRows(buildGeneratedRows(nextResult, inputs));
    setGeneratedInputs(inputs);
    setGeneratedAt(new Date().toISOString());
    setGeneratedKey(coreKey);
    setScheduleDialogOpen(false);
  };

  useEffect(() => {
    if (!generatedResult || !cashflowCurrent) return;
    const v = parsed.values;
    updateGlobal('dcfInputs', { purchasePrice: v.price ?? undefined, acquisitionCosts: v.acqCosts ?? undefined, initialNoi: v.initialNoi ?? undefined, holdPeriodYears: v.hold ?? undefined, rentalGrowthPct: v.growth ?? undefined, vacancyAllowancePct: noiTreatmentMode === 'adjusted' ? 0 : v.vacancy ?? undefined, terminalCapRatePct: v.termCap ?? undefined, sellingCostsPct: v.sellingCosts ?? undefined, discountRatePct: v.discount ?? undefined, loanAmount: v.loan ?? undefined, interestRatePct: v.interest ?? undefined, loanTermYears: v.term ?? undefined, annualCapex: v.annualCapex ?? undefined, downtimeMonths: v.downtimeMonths ?? undefined, initialNoiBasis: noiTreatmentMode === 'adjusted' ? 'actual' : undefined });
    updateGlobal('dcfOutputs', generatedResult);
  }, [generatedResult, cashflowCurrent, parsed, noiTreatmentMode, updateGlobal]);

  const sensitivityRows = useMemo(() => {
    if (!generatedResult || !generatedInputs) return [];
    const midpoint = generatedInputs.terminalCapRatePct;
    return [midpoint - 1, midpoint - 0.5, midpoint, midpoint + 0.5, midpoint + 1]
      .filter((cap) => cap > 0)
      .map((cap) => {
        const sensitivity = runDcfAssessment({ ...generatedInputs, terminalCapRatePct: cap, exitCapSensitivityPct: [cap] });
        return {
          exitCapRatePct: cap,
          terminalValue: sensitivity.terminalValue,
          netSaleProceedsToEquity: sensitivity.netSaleProceeds,
          leveredIrrImpact: sensitivity.leveredIrr == null || generatedResult.leveredIrr == null ? null : sensitivity.leveredIrr - generatedResult.leveredIrr,
          leveredNpvImpact: sensitivity.leveredNpv - generatedResult.leveredNpv,
        };
      });
  }, [generatedResult, generatedInputs]);

  const scenarioCards = useMemo(() => {
    if (!generatedResult) return [];
    const copy: Record<string, { driver: string; explanation: string }> = {
      Base: { driver: 'Base assumptions', explanation: 'Reflects the generated DCF inputs without additional stress or upside adjustments.' },
      Conservative: { driver: 'Lower growth, higher vacancy and softer exit', explanation: 'Tests whether the asset remains supportable under weaker leasing and exit conditions.' },
      Optimistic: { driver: 'Stronger growth and firmer exit', explanation: 'Shows upside if rent growth and exit yield evidence support a stronger case.' },
      'Higher vacancy': { driver: 'Vacancy allowance', explanation: 'Isolates the impact of additional vacancy loss on operating cashflow and returns.' },
      'Higher capex': { driver: 'Capital expenditure', explanation: 'Tests higher capital works or make-good requirements during the hold period.' },
      'Softer exit cap': { driver: 'Exit cap rate', explanation: 'Shows return exposure to a softer exit yield at sale.' },
      'Higher interest rate': { driver: 'Debt cost', explanation: 'Tests the impact of a higher interest rate on levered cashflow and equity returns.' },
    };
    return generatedResult.scenarios.map((scenario) => ({ ...scenario, ...(copy[scenario.name] ?? { driver: 'Assumption sensitivity', explanation: 'Alternative DCF case for review.' }) }));
  }, [generatedResult]);

  const generatedCommentary = useMemo(() => {
    if (!generatedResult) return '';
    const exitRisk = sensitivityRows.length ? `Exit cap sensitivity ranges from ${fmt0(Math.min(...sensitivityRows.map((r) => r.netSaleProceedsToEquity)))} to ${fmt0(Math.max(...sensitivityRows.map((r) => r.netSaleProceedsToEquity)))} in net sale proceeds to equity.` : 'Exit cap sensitivity should be reviewed once generated.';
    return [
      `Return summary: The generated DCF indicates a levered IRR of ${safePct(generatedResult.leveredIrr)} and unlevered IRR of ${safePct(generatedResult.unleveredIrr)}, with an equity multiple of ${generatedResult.equityMultiple}x.`,
      `Key assumptions: Purchase price ${fmt0(generatedInputs?.purchasePrice ?? 0)}, Base NOI ${fmt0(generatedInputs?.initialNoi ?? 0)}, rental growth ${generatedInputs?.rentalGrowthPct ?? PENDING}%, terminal cap ${generatedInputs?.terminalCapRatePct ?? PENDING}% and discount rate ${generatedInputs?.discountRatePct ?? PENDING}%.`,
      `Main return driver: Terminal value of ${fmt0(generatedResult.terminalValue)} and net sale proceeds to equity of ${fmt0(generatedResult.netSaleProceeds)} are key drivers of total return.`,
      `Sensitivity to exit cap: ${exitRisk}`,
      `Debt impact: Levered NPV is ${fmt0(generatedResult.leveredNpv)} compared with unlevered NPV of ${fmt0(generatedResult.unleveredNpv)}.`,
      `Cashflow strength: Review annual NOI, capex, downtime and debt service in the generated schedule before relying on client-facing outputs.`,
      `Key risks: Vacancy, capex, exit cap, discount rate and interest rate assumptions should be supported by current evidence.`,
      `Recommended review items: Confirm leases, market rent growth, vacancy expectations, capex allowances, funding costs and exit yield evidence before export.`,
    ].join('\n\n');
  }, [generatedResult, generatedInputs, sensitivityRows]);

  useEffect(() => {
    if (includeCommentary && !dcfCommentary && generatedCommentary) setDcfCommentary(generatedCommentary);
  }, [includeCommentary, dcfCommentary, generatedCommentary]);

  const linkedSourceStates: DcfSourceState[] = ['Property Profile', 'Scraped', 'NOI Tab', 'Cap Rate Tab', 'GST Tab', 'ICR / DSCR Tab', 'Borrowing Capacity'];
  const validAssumptionCount = fieldKeys.filter((key) => hasNumber(fields[key])).length + Object.values(noneConfirmed).filter(Boolean).length;
  const linkedSourceValueCount = fieldKeys.filter((key) => linkedSourceStates.includes(meta[key].source)).length;
  const estimateSourceValueCount = fieldKeys.filter((key) => meta[key].source === 'AI Estimate' || meta[key].source === 'Research Engine').length;
  const userOverrideCount = fieldKeys.filter((key) => meta[key].source === 'User Override').length;
  const canSaveBack = Boolean(prefill && validAssumptionCount > 0);
  const saveBackTooltip = !prefill
    ? 'Select or link a property before saving DCF assumptions.'
    : validAssumptionCount === 0
      ? 'Enter at least one valid DCF assumption before saving.'
      : 'Save DCF assumptions and outputs back to the linked property profile.';

  const sourceSnapshot = () => Object.fromEntries(fieldKeys.map((key) => [key, {
    source: meta[key].source,
    originalSourceValue: meta[key].original ?? null,
    pendingSourceValue: meta[key].pending ?? null,
    userOverrideValue: meta[key].source === 'User Override' ? fields[key] : null,
    acceptedEstimateValue: meta[key].source === 'AI Estimate' || meta[key].source === 'Research Engine' ? fields[key] : null,
    history: meta[key].history,
  }]));

  const buildSavePayload = () => {
    const v = parsed.values;
    const finalInputs = {
      purchasePrice: v.price,
      acquisitionCosts: v.acqCosts ?? (noneConfirmed.acqCosts ? 0 : null),
      baseNoi: v.initialNoi,
      noiTreatmentMode,
      holdPeriodYears: v.hold,
      rentalGrowthPct: v.growth,
      vacancyAllowancePct: noiTreatmentMode === 'adjusted' ? 0 : v.vacancy,
      terminalCapRatePct: v.termCap,
      sellingCostsPct: v.sellingCosts,
      discountRatePct: v.discount,
      loanAmount: v.loan,
      interestRatePct: v.interest,
      loanTermYears: v.term,
      annualCapex: v.annualCapex ?? (noneConfirmed.annualCapex ? 0 : null),
      downtimeMonths: v.downtimeMonths ?? (noneConfirmed.downtimeMonths ? 0 : null),
    };
    return {
      finalInputs,
      sourceStateByField: sourceSnapshot(),
      originalSourceValues: Object.fromEntries(fieldKeys.map((key) => [key, meta[key].original ?? null])),
      userOverrideValues: Object.fromEntries(fieldKeys.filter((key) => meta[key].source === 'User Override').map((key) => [key, fields[key]])),
      aiResearchEstimateValues: Object.fromEntries(fieldKeys.filter((key) => meta[key].source === 'AI Estimate' || meta[key].source === 'Research Engine').map((key) => [key, { value: fields[key], source: meta[key].source, basis: meta[key].original?.detail ?? null }])),
      generatedYearlyCashflowSchedule: generatedRows,
      scenarioOutputs: scenarioCards,
      sensitivityOutputs: sensitivityRows,
      readinessStatus,
      warnings: dcfWarnings,
      generatedAt,
      calculationVersion: DCF_CALCULATION_VERSION,
      cashflowGeneratedStatus: cashflowCurrent ? 'Cashflow Generated' : cashflowOutOfDate ? 'Cashflow Out of Date' : 'Not Generated',
      propertyId: prefill?.propertyId ?? null,
      scenarioId: (profile as any)?.clientScenarioOutputs?.scenarioId ?? (profile as any)?.clientScenarioOutputs?.id ?? null,
      userId: (property as any)?.user_id ?? null,
      commentary: includeCommentary ? dcfCommentary : null,
      counts: { linkedSourceValueCount, estimateSourceValueCount, userOverrideCount },
      downstreamRecalculation: {
        reportOverview: true,
        tenYearCashflowReport: true,
        scenarioComparison: true,
        clientReport: true,
        dcfOnlyWrite: true,
        circularOverwriteProtection: 'DCF save-back writes DCF inputs/outputs only and does not overwrite NOI, Cap Rate, GST, Borrowing Capacity or ICR / DSCR tabs.',
      },
    };
  };

  const handleConfirmSaveBack = async () => {
    if (!prefill) return;
    setSavingDcf(true);
    try {
      const payload = buildSavePayload();
      updateGlobal('dcfInputs', payload.finalInputs);
      updateGlobal('dcfOutputs', {
        result: generatedResult,
        rows: generatedRows as any,
        scenarios: scenarioCards,
        sensitivity: sensitivityRows,
        readinessStatus,
        generatedAt,
        calculationVersion: DCF_CALCULATION_VERSION,
      } as any);
      if (prefill.domain === 'commercial') {
        const res = await commercialApi.createDcfRun({
          property_id: prefill.propertyId,
          scenario_name: String(payload.scenarioId ?? 'base'),
          hold_period_years: payload.finalInputs.holdPeriodYears,
          discount_rate: payload.finalInputs.discountRatePct,
          terminal_cap_rate: payload.finalInputs.terminalCapRatePct,
          rental_growth_assumptions: { value: payload.finalInputs.rentalGrowthPct, source: meta.growth.source },
          vacancy_allowance_pct: payload.finalInputs.vacancyAllowancePct,
          capex_schedule: generatedRows.map((row) => ({ year: row.year, capex: row.capex, downtimeAdjustment: row.downtimeAdjustment })),
          loan_amount: payload.finalInputs.loanAmount,
          interest_rate: payload.finalInputs.interestRatePct,
          loan_term_years: payload.finalInputs.loanTermYears,
          outputs: payload,
          irr: generatedResult?.leveredIrr ?? generatedResult?.unleveredIrr ?? null,
          npv: generatedResult?.leveredNpv ?? generatedResult?.unleveredNpv ?? null,
          equity_multiple: generatedResult?.equityMultiple ?? null,
          peak_equity: generatedResult?.equityInvested ?? null,
        });
        if (res.error) throw new Error(res.error.message);
      } else {
        const existingNotes = typeof (property as any)?.notes === 'string' ? (property as any).notes : '';
        const auditNote = `DCF assumptions saved ${new Date().toISOString()} (${DCF_CALCULATION_VERSION}) · status: ${readinessStatus} · generated: ${payload.cashflowGeneratedStatus}.`;
        await pushBack({ notes: existingNotes ? `${existingNotes}\n\n${auditNote}` : auditNote });
      }
      setSaveDialogOpen(false);
      toast.success('DCF assumptions and cashflow saved to property profile.');
    } catch (error) {
      toast.error('Unable to save DCF assumptions to the property profile.', { description: error instanceof Error ? error.message : 'Please try again.' });
    } finally {
      setSavingDcf(false);
    }
  };

  const modalRows: Array<[string, string]> = [
    ['Purchase Price', parsed.values.price != null ? fmt0(parsed.values.price) : PENDING],
    ['Acquisition Costs', parsed.values.acqCosts != null ? fmt0(parsed.values.acqCosts) : noneConfirmed.acqCosts ? fmt0(0) : PENDING],
    ['Base NOI', parsed.values.initialNoi != null ? fmt0(parsed.values.initialNoi) : PENDING],
    ['NOI Treatment Mode', noiTreatmentLabels[noiTreatmentMode]],
    ['Hold Period', parsed.values.hold != null ? `${parsed.values.hold} years` : PENDING],
    ['Rental Growth', safePct(parsed.values.growth)],
    ['Vacancy Allowance', noiTreatmentMode === 'adjusted' ? '0% (already vacancy-adjusted)' : safePct(parsed.values.vacancy)],
    ['Terminal Cap', safePct(parsed.values.termCap)],
    ['Selling Costs', safePct(parsed.values.sellingCosts)],
    ['Discount Rate', safePct(parsed.values.discount)],
    ['Loan Amount', parsed.values.loan != null ? fmt0(parsed.values.loan) : PENDING],
    ['Interest Rate', safePct(parsed.values.interest)],
    ['Loan Term', parsed.values.term != null ? `${parsed.values.term} years` : PENDING],
    ['Annual Capex', parsed.values.annualCapex != null ? fmt0(parsed.values.annualCapex) : noneConfirmed.annualCapex ? fmt0(0) : PENDING],
    ['Downtime Months', parsed.values.downtimeMonths != null ? `${parsed.values.downtimeMonths} months` : noneConfirmed.downtimeMonths ? '0 months' : PENDING],
    ['Unlevered IRR', safePct(result?.unleveredIrr)],
    ['Levered IRR', safePct(result?.leveredIrr)],
    ['Unlevered NPV', result ? fmt0(result.unleveredNpv) : PENDING],
    ['Levered NPV', result ? fmt0(result.leveredNpv) : PENDING],
    ['Equity Multiple', result ? `${result.equityMultiple}x` : PENDING],
    ['Terminal Value', result ? fmt0(result.terminalValue) : PENDING],
    ['Net Sale Proceeds to Equity', result ? fmt0(result.netSaleProceeds) : PENDING],
    ['Cashflow generated status', cashflowCurrent ? 'Cashflow Generated' : cashflowOutOfDate ? 'Cashflow Out of Date' : 'Not Generated'],
    ['Linked source values', String(linkedSourceValueCount)],
    ['AI / research estimates', String(estimateSourceValueCount)],
    ['User overrides', String(userOverrideCount)],
  ];


  const readinessTone = readinessStatus === 'DCF Verified'
    ? 'border-success/40 bg-success/10 text-success'
    : readinessStatus === 'Cashflow Generated'
      ? 'border-primary/40 bg-primary/10 text-primary'
      : readinessStatus === 'Cashflow Out of Date' || readinessStatus === 'Preliminary DCF Estimate' || readinessStatus === 'Specialist Review Recommended'
        ? 'border-brand-500/40 bg-brand-500/10 text-brand-100'
        : parsed.requiredReady
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-muted/30 text-muted-foreground';
  const criticalWarnings = dcfWarnings.filter((w) => w.exportBlock && (generatedResult || parsed.requiredReady));
  const generateTooltip = !canGenerate ? 'Complete purchase price, Base NOI, hold period, growth, terminal cap and discount rate before generating cashflow.' : cashflowOutOfDate ? 'Regenerate the DCF with the latest assumptions.' : 'Generate the yearly DCF cashflow schedule.';

  return (
    <>
    <Card className="overflow-hidden border-primary/20 bg-card/95 shadow-xl shadow-sm dark:shadow-black/20">
      <CardHeader className="border-b border-border/60 bg-gradient-to-br from-background via-card to-primary/5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle>Discounted Cash Flow (DCF)</CardTitle>
            <CardDescription>Premium DCF workflow with source-aware assumptions, generated cashflow, sensitivity, scenarios and report controls.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Badge variant="outline" className={readinessTone}>{readinessStatus}</Badge>
            {cashflowCurrent && <Badge variant="outline" className="border-success/40 bg-success/10 text-success">Report-ready draft</Badge>}
            {cashflowOutOfDate && <Badge variant="outline" className="border-brand-500/40 bg-brand-500/10 text-brand-100">Regeneration required</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-4 md:p-6">
        <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-sm font-semibold text-primary">Data Source & Sync</Label>
                <Badge variant="outline" className="border-primary/40 text-primary">Global Input Sync: On</Badge>
                <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">{linkedLabel}</Badge>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">DCF consumes upstream profile, NOI, cap rate, GST, borrowing, ICR / DSCR, research and AI values without overwriting those tabs.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={handleEstimateForMe}>Estimate for me</Button>
              <Button size="sm" variant="outline" disabled={!canSaveBack || savingDcf} title={saveBackTooltip} onClick={() => setSaveDialogOpen(true)}>Save Back to Property</Button>
            </div>
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)]">
          <div className="order-2 space-y-4 lg:order-1">
            <section className="rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-muted/20 p-4 shadow-sm">
              <PanelHeading
                kicker="DCF assumptions"
                title="Acquisition basis and hold-period inputs"
                description="Source-aware purchase, cost, NOI and hold-period fields remain editable without changing the DCF formulas."
                badge="Editable sources"
              />
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Purchase Price" v={fields.price} source={meta.price.source} pending={meta.price.pending} set={(v) => updateField('price', v)} onKeep={() => keepOverride('price')} onUseSource={() => usePendingSource('price')} placeholder={placeholders.price} />
                <Field label="Acquisition Costs" v={fields.acqCosts} source={meta.acqCosts.source} pending={meta.acqCosts.pending} set={(v) => updateField('acqCosts', v)} onKeep={() => keepOverride('acqCosts')} onUseSource={() => usePendingSource('acqCosts')} placeholder={placeholders.acqCosts} />
                <Field label="Base NOI" v={fields.initialNoi} source={meta.initialNoi.source} pending={meta.initialNoi.pending} set={(v) => updateField('initialNoi', v)} onKeep={() => keepOverride('initialNoi')} onUseSource={() => usePendingSource('initialNoi')} placeholder={placeholders.initialNoi} />
                <Field label="Hold Period (yrs)" v={fields.hold} source={meta.hold.source} pending={meta.hold.pending} set={(v) => updateField('hold', v)} onKeep={() => keepOverride('hold')} onUseSource={() => usePendingSource('hold')} placeholder={placeholders.hold} />
              </div>
            </section>

            <section className="rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-muted/20 p-4 shadow-sm">
              <PanelHeading
                kicker="Growth assumptions"
                title="Rental growth, vacancy and discount rate"
                description="Model the recurring cashflow growth profile and required return while preserving existing discount-rate logic."
              />
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Rental Growth %" v={fields.growth} source={meta.growth.source} pending={meta.growth.pending} set={(v) => updateField('growth', v)} onKeep={() => keepOverride('growth')} onUseSource={() => usePendingSource('growth')} step="0.1" placeholder={placeholders.growth} />
                <Field label="Vacancy Allowance %" v={fields.vacancy} source={meta.vacancy.source} pending={meta.vacancy.pending} set={(v) => updateField('vacancy', v)} onKeep={() => keepOverride('vacancy')} onUseSource={() => usePendingSource('vacancy')} step="0.1" placeholder={placeholders.vacancy} />
                <Field label="Discount Rate %" v={fields.discount} source={meta.discount.source} pending={meta.discount.pending} set={(v) => updateField('discount', v)} onKeep={() => keepOverride('discount')} onUseSource={() => usePendingSource('discount')} step="0.1" placeholder={placeholders.discount} />
              </div>
            </section>

            <section className="rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-muted/20 p-4 shadow-sm">
              <PanelHeading
                kicker="Exit assumptions"
                title="Terminal value and sale proceeds drivers"
                description="Exit cap rate and sale-cost assumptions feed the existing terminal value and final-year proceeds calculations."
              />
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Terminal Cap %" v={fields.termCap} source={meta.termCap.source} pending={meta.termCap.pending} set={(v) => updateField('termCap', v)} onKeep={() => keepOverride('termCap')} onUseSource={() => usePendingSource('termCap')} step="0.1" placeholder={placeholders.termCap} />
                <Field label="Selling Costs %" v={fields.sellingCosts} source={meta.sellingCosts.source} pending={meta.sellingCosts.pending} set={(v) => updateField('sellingCosts', v)} onKeep={() => keepOverride('sellingCosts')} onUseSource={() => usePendingSource('sellingCosts')} step="0.1" placeholder={placeholders.sellingCosts} />
              </div>
            </section>

            <section className="rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-muted/20 p-4 shadow-sm">
              <PanelHeading
                kicker="Debt assumptions"
                title="Leverage and debt service inputs"
                description="Optional leverage assumptions support levered annual cashflow, NPV, IRR and equity multiple outputs."
              />
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <Field label="Loan Amount" v={fields.loan} source={meta.loan.source} pending={meta.loan.pending} set={(v) => updateField('loan', v)} onKeep={() => keepOverride('loan')} onUseSource={() => usePendingSource('loan')} placeholder={placeholders.loan} />
                <Field label="Interest %" v={fields.interest} source={meta.interest.source} pending={meta.interest.pending} set={(v) => updateField('interest', v)} onKeep={() => keepOverride('interest')} onUseSource={() => usePendingSource('interest')} step="0.05" placeholder={placeholders.interest} />
                <Field label="Loan Term (yrs)" v={fields.term} source={meta.term.source} pending={meta.term.pending} set={(v) => updateField('term', v)} onKeep={() => keepOverride('term')} onUseSource={() => usePendingSource('term')} placeholder={placeholders.term} />
              </div>
            </section>

            <section className="rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-muted/20 p-4 shadow-sm">
              <PanelHeading
                kicker="Annual cashflow assumptions"
                title="Capex, downtime and zero-cost confirmations"
                description="Annual forecast inputs stay separate so manual overrides and zero-cost confirmations are easy to audit."
              />
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Annual Capex" v={fields.annualCapex} source={meta.annualCapex.source} pending={meta.annualCapex.pending} set={(v) => updateField('annualCapex', v)} onKeep={() => keepOverride('annualCapex')} onUseSource={() => usePendingSource('annualCapex')} placeholder={placeholders.annualCapex} />
                <Field label="Downtime Months" v={fields.downtimeMonths} source={meta.downtimeMonths.source} pending={meta.downtimeMonths.pending} set={(v) => updateField('downtimeMonths', v)} onKeep={() => keepOverride('downtimeMonths')} onUseSource={() => usePendingSource('downtimeMonths')} placeholder={placeholders.downtimeMonths} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant={noneConfirmed.acqCosts ? 'secondary' : 'outline'} className="h-7 text-xs" onClick={() => setNoneConfirmed((v) => ({ ...v, acqCosts: !v.acqCosts }))}>Acquisition costs none</Button>
                <Button type="button" size="sm" variant={noneConfirmed.annualCapex ? 'secondary' : 'outline'} className="h-7 text-xs" onClick={() => setNoneConfirmed((v) => ({ ...v, annualCapex: !v.annualCapex }))}>Annual capex none</Button>
                <Button type="button" size="sm" variant={noneConfirmed.downtimeMonths ? 'secondary' : 'outline'} className="h-7 text-xs" onClick={() => setNoneConfirmed((v) => ({ ...v, downtimeMonths: !v.downtimeMonths }))}>Downtime none</Button>
              </div>
            </section>
          </div>

          <aside className="order-1 space-y-4 lg:order-2">
            <section className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-background p-4 shadow-lg shadow-sm dark:shadow-black/20">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label className="text-sm font-semibold text-primary">Cashflow readiness status</Label>
                  <div className="mt-1 text-lg font-bold">{readinessStatus}</div>
                </div>
                <Badge variant="outline" className={readinessTone}>{cashflowCurrent ? 'Generated' : cashflowOutOfDate ? 'Out of date' : 'Pending'}</Badge>
              </div>
              {readinessStatus === 'Awaiting DCF Inputs' && <p className="mt-2 text-xs leading-5 text-muted-foreground">{EMPTY_HELPER}</p>}
              {cashflowCurrent && <p className="mt-2 text-xs text-success">Cashflow generated · {generatedAt ? new Date(generatedAt).toLocaleString('en-AU') : 'Generated'} · {DCF_CALCULATION_VERSION}</p>}
              {cashflowOutOfDate && <p className="mt-2 text-xs text-brand-200">Cashflow out of date · regenerate before export.</p>}
              {!!priorityWarnings.length && <div className="mt-3 space-y-1">{priorityWarnings.map((w) => <p key={w.message} className="text-xs text-brand-100">• {w.message}</p>)}</div>}
            </section>

            <section className="rounded-2xl border bg-muted/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-sm font-semibold">Generate Cashflow</Label>
                <Badge variant="outline" className="border-primary/30 text-primary">{DCF_CALCULATION_VERSION}</Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">Generate deliberately after core assumptions are complete. Changes after generation mark the schedule out of date.</p>
              <Button size="lg" className="mt-4 w-full" onClick={handleGenerateCashflow} disabled={!canGenerate} title={generateTooltip}>{cashflowOutOfDate ? 'Regenerate Cashflow' : 'Generate Cashflow'}</Button>
              {!canGenerate && <p className="mt-2 text-xs text-muted-foreground">{generateTooltip}</p>}
            </section>

            <section className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-lg shadow-primary/5">
              <PanelHeading
                kicker="Valuation outputs"
                title="Investment return summary"
                description="NPV, IRR, terminal value and equity multiple are highlighted from the generated DCF result."
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Metric label="Levered IRR (%)" value={result ? safePct(result.leveredIrr) : PENDING} highlight size="hero" />
                <Metric label="Levered NPV (AUD)" value={result ? fmt0(result.leveredNpv) : PENDING} highlight size="hero" />
                <Metric label="Terminal Value (AUD)" value={result ? fmt0(result.terminalValue) : PENDING} highlight />
                <Metric label="Equity Multiple (x)" value={result ? `${result.equityMultiple}x` : PENDING} highlight />
                <Metric label="Unlevered IRR (%)" value={result ? safePct(result.unleveredIrr) : PENDING} />
                <Metric label="Net Sale Proceeds to Equity (AUD)" value={result ? fmt0(result.netSaleProceeds) : PENDING} highlight />
              </div>
            </section>
          </aside>
        </section>

        {estimatePanelOpen && (
          <section className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-muted/20 to-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><Label>AI / Research Estimate Preview</Label><p className="text-xs text-muted-foreground">Preview, edit, accept or reject suggested DCF assumptions before applying them. Estimates never auto-populate fields.</p></div>
              <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => applyEstimates(false)} disabled={!estimates.length}>Accept all estimates</Button><Button size="sm" onClick={() => applyEstimates(true)} disabled={!estimates.some((e) => e.selected)}>Accept selected estimates</Button><Button size="sm" variant="ghost" onClick={() => setEstimatePanelOpen(false)}>Close</Button></div>
            </div>
            {estimateMessage && <p className="mt-3 rounded border border-brand-500/30 bg-brand-500/10 p-2 text-xs text-brand-100">{estimateMessage}</p>}
            {!!estimates.length && <div className="mt-3 space-y-2">{estimates.map((item) => <div key={item.id} className="rounded-md border bg-background/40 p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={item.selected} onChange={(e) => updateEstimate(item.id, { selected: e.target.checked })} />{item.label}</label><div className="flex flex-wrap gap-1"><Badge variant="outline">{item.origin}</Badge><Badge variant="outline">{item.confidence} confidence</Badge></div></div><div className="mt-2 grid gap-2 md:grid-cols-[220px_1fr]"><div><Label className="text-[11px]">Suggested value</Label><Input className="mt-1 h-8" value={item.value} onChange={(e) => updateEstimate(item.id, { value: e.target.value })} /></div><div className="grid gap-1 text-muted-foreground"><div>Source basis: <span className="text-foreground">{item.sourceBasis}</span></div><div>Missing information: <span className="text-foreground">{item.missingInfo}</span></div><div>Risk notes: <span className="text-foreground">{item.riskNotes}</span></div><div>Recommended verification: <span className="text-foreground">{item.recommendedVerification}</span></div></div></div><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => applyEstimates(true)} disabled={!item.selected}>Apply selected</Button><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => rejectEstimate(item.id)}>Reject estimate</Button></div></div>)}</div>}
          </section>
        )}

        <section className="rounded-2xl border bg-muted/10 p-4">
          <Label className="text-sm font-semibold">NOI Treatment Mode</Label>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(220px,320px)_1fr]">
            <Select value={noiTreatmentMode} onValueChange={(v) => { setNoiTreatmentMode(v as NoiTreatmentMode); setNoiTreatmentTouched(true); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="adjusted">NOI already vacancy-adjusted</SelectItem>
                <SelectItem value="apply">Apply vacancy allowance in DCF</SelectItem>
                <SelectItem value="requires_confirmation">Requires confirmation</SelectItem>
              </SelectContent>
            </Select>
            <div className="space-y-1 text-xs leading-5 text-muted-foreground">
              <p>Current mode: <span className="font-medium text-foreground">{noiTreatmentLabels[noiTreatmentMode]}</span>. This controls whether vacancy is applied in the DCF or already included in Base NOI.</p>
              {noiTreatmentMode === 'requires_confirmation' && <p className="text-brand-200">Requires confirmation before generating cashflow.</p>}
              {vacancyMayBeDoubleCounted && <p className="text-brand-200">Base NOI appears to already include vacancy. Applying vacancy again may double-count vacancy loss.</p>}
              {!!criticalWarnings.length && <p className="text-destructive">Critical issue: {criticalWarnings[0].message}</p>}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-muted/20 p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <Label className="text-sm font-semibold">Annual cashflow forecast</Label>
              {result ? <p className="text-xs text-muted-foreground">Cashflow preview — first 5 years, with final-year terminal value shown when included in the preview.</p> : <p className="text-xs text-muted-foreground">Generate the DCF to unlock the annual forecast table.</p>}
            </div>
            {generatedRows.length > 5 && <Button size="sm" variant="outline" onClick={() => setScheduleDialogOpen(true)}>View full cashflow schedule</Button>}
          </div>
          {!result ? <PendingPanel message="Generate the cashflow to view the yearly schedule." /> : (
            <CashflowScheduleTable rows={generatedRows.slice(0, 5)} />
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-muted/20 p-4 shadow-sm">
          <PanelHeading
            kicker="Sensitivity / risk commentary"
            title="Exit cap sensitivity and DCF scenario risk"
            description="Use generated outputs to review how terminal value, NPV and IRR move under exit-cap and scenario assumptions."
          />
          <div className="rounded-xl border bg-background/40 p-4"><button type="button" className="flex w-full items-center justify-between text-left" onClick={() => result && setShowSensitivity((v) => !v)} disabled={!result} title={!result ? 'Generate base DCF before viewing sensitivity.' : undefined}><Label>Sensitivity / Exit Cap</Label><span className="text-xs text-primary">{!result ? 'Generate first' : showSensitivity ? 'Hide' : 'Show'}</span></button>{result && showSensitivity && <div className="mt-3 overflow-x-auto rounded-lg border"><Table><TableHeader className="bg-muted/40"><TableRow><TableHead>Exit cap rate</TableHead><TableHead className="text-right">Terminal value</TableHead><TableHead className="text-right">Net sale proceeds to equity</TableHead><TableHead className="text-right">Levered IRR impact</TableHead><TableHead className="text-right">Levered NPV impact</TableHead></TableRow></TableHeader><TableBody>{sensitivityRows.map((r) => <TableRow key={r.exitCapRatePct} className="odd:bg-muted/10"><TableCell>{r.exitCapRatePct}%</TableCell><TableCell className="text-right font-medium">{fmt0(r.terminalValue)}</TableCell><TableCell className="text-right">{fmt0(r.netSaleProceedsToEquity)}</TableCell><TableCell className="text-right">{r.leveredIrrImpact == null ? PENDING : `${r.leveredIrrImpact.toFixed(2)}%`}</TableCell><TableCell className="text-right">{fmt0(r.leveredNpvImpact)}</TableCell></TableRow>)}</TableBody></Table></div>}</div>
          <div className="rounded-xl border bg-background/40 p-4"><button type="button" className="flex w-full items-center justify-between text-left" onClick={() => result && setShowScenarios((v) => !v)} disabled={!result} title={!result ? 'Generate base DCF before viewing scenarios.' : undefined}><Label>DCF Scenarios</Label><span className="text-xs text-primary">{!result ? 'Generate first' : showScenarios ? 'Hide' : 'Show'}</span></button>{result && showScenarios && <div className="mt-3 grid gap-3 lg:grid-cols-2">{scenarioCards.map((s) => <div key={s.name} className="rounded-lg border bg-muted/20 p-3 text-sm"><div className="font-semibold text-foreground">{s.name} Case</div><div className="mt-2 grid grid-cols-2 gap-2 text-xs"><div>Levered IRR: <span className="text-foreground">{safePct(s.result.leveredIrr)}</span></div><div>Unlevered IRR: <span className="text-foreground">{safePct(s.result.unleveredIrr)}</span></div><div>Levered NPV: <span className="text-foreground">{fmt0(s.result.leveredNpv)}</span></div><div>Terminal Value: <span className="text-foreground">{fmt0(s.result.terminalValue)}</span></div><div>Equity Multiple: <span className="text-foreground">{s.result.equityMultiple}x</span></div><div>Binding risk driver: <span className="text-foreground">{s.driver}</span></div></div><p className="mt-2 text-xs text-muted-foreground">{s.explanation}</p></div>)}</div>}</div>
        </section>

        <section className="rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card to-muted/20 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><Label className="text-sm font-semibold">Commentary / Report Controls</Label><Button size="sm" variant={includeCommentary ? 'secondary' : 'outline'} onClick={() => setIncludeCommentary((v) => !v)}>Include DCF commentary in report</Button></div>
          <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={exportBlocked} title={exportBlocked ? 'Generate current cashflow before exporting DCF outputs.' : exportWarning ?? undefined}>Include in client report</Button><Button size="sm" variant="outline" disabled={exportBlocked} title={exportBlocked ? 'Generate current cashflow before exporting DCF outputs.' : exportWarning ?? undefined}>Export cashflow schedule</Button><Button size="sm" variant="outline" disabled={!result || cashflowOutOfDate} title={!result || cashflowOutOfDate ? 'Generate current cashflow before saving a scenario.' : undefined}>Save as scenario</Button></div>
          {exportBlocked && <p className="mt-2 text-xs text-brand-200">Generate current cashflow before exporting DCF outputs.</p>}{exportWarning && <p className="mt-2 text-xs text-brand-200">{exportWarning}</p>}
          {includeCommentary && <Textarea className="mt-3 min-h-[220px]" value={dcfCommentary} onChange={(e) => setDcfCommentary(e.target.value)} placeholder="Generate the base DCF first, then edit commentary before export." />}
        </section>

        <section className="rounded-2xl border bg-muted/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><Label className="text-sm font-semibold">Warnings / Assumptions</Label>{!!dcfWarnings.length && <Button size="sm" variant="link" className="h-auto p-0 text-xs text-primary" onClick={() => setShowWarningLog((v) => !v)}>View all assumptions and warnings</Button>}</div>
          <div className="mt-3 space-y-1">{priorityWarnings.length ? priorityWarnings.map((w) => <p key={w.message} className="text-xs text-brand-100">• {w.message}</p>) : <p className="text-xs text-muted-foreground">No priority DCF warnings currently detected.</p>}</div>
          {showWarningLog && <div className="mt-3 space-y-2 text-xs">{dcfWarnings.length ? dcfWarnings.map((w) => <div key={w.message} className="rounded border bg-background/40 p-2"><div className="font-medium text-foreground">{w.message}</div><div className="text-muted-foreground">Group: {w.group} · Priority: {w.priority}{w.exportBlock ? ' · Blocks export' : ''}</div></div>) : <div className="text-muted-foreground">No DCF warnings currently detected.</div>}</div>}
          <Separator className="my-3" />
          <Label className="text-xs">DCF Assumption History</Label>
          <div className="mt-2 grid gap-1 text-xs text-muted-foreground md:grid-cols-2">{fieldKeys.flatMap((key) => meta[key].history.slice(-1).map((h) => <div key={`${key}-${h}`}>{h}</div>))}{!fieldKeys.some((key) => meta[key].history.length) && <div>No cascaded assumptions applied yet.</div>}</div>
        </section>
      </CardContent>
    </Card>
    <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
      <DialogContent className="max-w-[95vw]">
        <DialogHeader>
          <DialogTitle>Full cashflow schedule</DialogTitle>
          <DialogDescription>Complete generated hold-period cashflow schedule. Values are based on the current generated DCF run.</DialogDescription>
        </DialogHeader>
        <CashflowScheduleTable rows={generatedRows} />
      </DialogContent>
    </Dialog>
    <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Save these DCF assumptions and outputs back to the property profile?</DialogTitle>
          <DialogDescription>
            This saves DCF-only assumptions, audit metadata, generated schedule and outputs without overwriting NOI, Cap Rate, GST, Borrowing Capacity or ICR / DSCR source tabs.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="grid gap-2 md:grid-cols-2">
            {modalRows.map(([label, value]) => (
              <div key={label} className="rounded border bg-muted/20 p-2 text-sm">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="font-medium text-foreground">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
            Downstream recalculation will be triggered for Report Overview, 10-Year Cashflow Report, Scenario Comparison and Client report via the DCF input/output sync keys only.
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => setSaveDialogOpen(false)} disabled={savingDcf}>Cancel</Button>
          <Button onClick={handleConfirmSaveBack} disabled={savingDcf}>{savingDcf ? 'Saving…' : 'Save DCF to Property'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function PanelHeading({ kicker, title, description, badge }: { kicker: string; title: string; description?: string; badge?: string }) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{kicker}</div>
        <Label className="mt-1 block text-sm font-semibold">{title}</Label>
        {description && <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
      {badge && <Badge variant="outline" className="w-fit border-brand-500/30 bg-brand-500/10 text-brand-100">{badge}</Badge>}
    </div>
  );
}

function Field({ label, v, set, step, placeholder, source, pending, onKeep, onUseSource }: { label: string; v: string; set: (v: string) => void; step?: string; placeholder: string; source: DcfSourceState; pending?: Candidate; onKeep: () => void; onUseSource: () => void }) {
  return (
    <div className="space-y-1.5 rounded-xl border border-border/60 bg-background/45 p-3">
      <div className="flex items-center justify-between gap-2"><Label className="text-xs">{label}</Label><Badge variant="outline" className="shrink-0 border-primary/30 bg-primary/5 text-[10px] text-primary">{sourceLabels[source]}</Badge></div>
      <Input className="bg-card/80" type="text" inputMode="decimal" step={step} value={v} placeholder={placeholder} onChange={e => set(e.target.value)} />
      {pending && <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 p-2 text-[11px] leading-4 text-brand-100"><p className="font-medium">Manual override active — new source value available.</p><p className="text-muted-foreground">{sourceLabels[pending.source]}: {pending.value}</p><div className="mt-1 flex gap-1"><Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onKeep}>Keep override</Button><Button type="button" size="sm" className="h-6 px-2 text-[11px]" onClick={onUseSource}>Use source value</Button></div></div>}
    </div>
  );
}

function Metric({ label, value, highlight, size = 'standard' }: { label: string; value: string; highlight?: boolean; size?: 'standard' | 'hero' }) {
  return <div className={`rounded-xl border p-3 ${highlight ? 'border-primary/35 bg-primary/10 shadow-sm shadow-primary/10' : 'bg-muted/40'}`}><div className="text-xs text-muted-foreground">{label}</div><div className={`${size === 'hero' ? 'text-2xl md:text-3xl' : 'text-lg'} font-bold tracking-tight ${highlight ? 'text-primary' : ''}`}>{value}</div></div>;
}

function CashflowScheduleTable({ rows }: { rows: GeneratedCashflowRow[] }) {
  return (
    <ScrollArea className="h-[420px] w-full rounded-xl border bg-background/40">
      <div className="min-w-[1500px]">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead className="text-right">Opening NOI</TableHead>
              <TableHead className="text-right">Vacancy / NOI Adjustment</TableHead>
              <TableHead className="text-right">Effective NOI</TableHead>
              <TableHead className="text-right">Rental Growth Applied</TableHead>
              <TableHead className="text-right">Capex</TableHead>
              <TableHead className="text-right">Downtime Adjustment</TableHead>
              <TableHead className="text-right">Unlevered Cash Flow</TableHead>
              <TableHead className="text-right">Debt Service</TableHead>
              <TableHead className="text-right">Interest Component</TableHead>
              <TableHead className="text-right">Principal Component</TableHead>
              <TableHead className="text-right">Levered Cash Flow</TableHead>
              <TableHead className="text-right">Loan Balance</TableHead>
              <TableHead className="text-right">Terminal Value</TableHead>
              <TableHead className="text-right">Selling Costs</TableHead>
              <TableHead className="text-right">Net Sale Proceeds to Equity</TableHead>
              <TableHead className="text-right">Final Year Total Cash Flow</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.year} className="odd:bg-muted/10 hover:bg-primary/5">
                <TableCell className="font-semibold text-primary">{r.year}</TableCell>
                <TableCell className="text-right">{fmt0(r.openingNoi)}</TableCell>
                <TableCell className="text-right">{fmt0(r.vacancyAdjustment)}</TableCell>
                <TableCell className="text-right">{fmt0(r.effectiveNoi)}</TableCell>
                <TableCell className="text-right">{r.rentalGrowthApplied}%</TableCell>
                <TableCell className="text-right">{fmt0(r.capex)}</TableCell>
                <TableCell className="text-right">{fmt0(r.downtimeAdjustment)}</TableCell>
                <TableCell className="text-right">{fmt0(r.unleveredCashFlow)}</TableCell>
                <TableCell className="text-right">{fmt0(r.debtService)}</TableCell>
                <TableCell className="text-right">{fmt0(r.interestComponent)}</TableCell>
                <TableCell className="text-right">{fmt0(r.principalComponent)}</TableCell>
                <TableCell className="text-right font-medium">{fmt0(r.leveredCashFlow)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{fmt0(r.loanBalance)}</TableCell>
                <TableCell className="text-right">{r.terminalValue == null ? PENDING : fmt0(r.terminalValue)}</TableCell>
                <TableCell className="text-right">{r.sellingCosts == null ? PENDING : fmt0(r.sellingCosts)}</TableCell>
                <TableCell className="text-right">{r.netSaleProceedsToEquity == null ? PENDING : fmt0(r.netSaleProceedsToEquity)}</TableCell>
                <TableCell className="text-right">{r.finalYearTotalCashFlow == null ? PENDING : fmt0(r.finalYearTotalCashFlow)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ScrollArea>
  );
}

function PendingPanel({ compact = false, message = PENDING }: { compact?: boolean; message?: string }) {
  return <div className={`rounded-xl border border-dashed border-primary/30 bg-primary/5 text-sm text-muted-foreground ${compact ? 'mt-2 p-2' : 'p-5'}`}><div className="font-medium text-foreground">Pending generated DCF output</div><div className="mt-1 text-xs leading-5">{message}</div></div>;
}
