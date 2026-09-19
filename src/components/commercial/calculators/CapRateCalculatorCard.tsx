import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, BarChart3, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { calculateYields, calculateCapRateEngine, parseCapRateNumber } from '@/utils/commercial';
import { useCalculatorPrefill, type CalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useCommercialDealState } from '@/utils/commercial/commercialDealState';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);

const PENDING = 'Pending';
const num = (v: string) => parseCapRateNumber(v);
const positiveNum = (v: string) => { const n = parseCapRateNumber(v); return n !== null && n > 0 ? n : null; };
const hasPositiveNumber = (v: string) => positiveNum(v) !== null;
const pct = (n: number | null) => n !== null && Number.isFinite(n) ? `${n.toFixed(2).replace(/\.00$/, '')}%` : PENDING;
const pctRatio = (n: number | null) => n !== null && Number.isFinite(n) ? `${(n * 100).toFixed(2).replace(/\.00$/, '')}%` : PENDING;
const displayPct = (n: number | null, ready: boolean) => ready && n !== null && Number.isFinite(n) ? pct(n) : PENDING;
const displayMoney = (n: number | null, ready: boolean) => ready && n !== null && Number.isFinite(n) ? fmt(n) : PENDING;

type FieldSource = 'Blank' | 'Scraped' | 'NOI Tab' | 'Property Profile' | 'AI Benchmark' | 'Manual' | 'User Override' | 'Verified';
type CapField = 'passingNoi' | 'marketNoi' | 'price' | 'targetCap';
type CapRateReadinessStatus = 'Awaiting Cap Rate Inputs' | 'Preliminary Yield Estimate' | 'Cap Rate Assessment Ready' | 'Specialist Review Recommended' | 'Verified Benchmark';
type WarningCategory = 'NOI' | 'Valuation' | 'Benchmark' | 'Lease' | 'Data Source' | 'Property Record' | 'Verification';
type WarningSeverity = 'Critical' | 'Required' | 'Recommended';
interface CapRateWarning { category: WarningCategory; severity: WarningSeverity; message: string }

interface CapRateAiEstimate {
  propertyId: string;
  dealId: string;
  estimateType: 'CAP_RATE_RANGE';
  summary: string;
  capRateRange: { low: number | null; mid: number | null; high: number | null };
  recommendedTargetCapRate: number | null;
  confidence: 'High' | 'Medium' | 'Low';
  benchmarkBasis: string;
  suggestedValuationRange: { low: number | null; midpoint: number | null; high: number | null };
  supportingInputsUsed: string[];
  missingInputs: string[];
  reasoningSummary: string;
  warnings: string[];
  requiredDocuments: string[];
  requiresValuerConfirmation: boolean;
  estimatedFields: Array<{ field: string; currentValue: number | null; estimatedValue: number | null; unit: '%'; confidence: 'High' | 'Medium' | 'Low'; sourceStatusBefore: string; sourceStatusAfter: 'AI Estimate'; reasoningSummary: string; requiresSpecialistReview: boolean; requiredDocument: string; shouldOverwrite: boolean }>;
  recommendedNextAction: string;
}

interface SourceCandidate { value: number; source: FieldSource; sourceDetail: string }
interface PendingSource extends SourceCandidate { noticedAt: string }
interface FieldState { value: string; source: FieldSource; dirty: boolean; originalValue?: string; originalSource?: FieldSource; sourceDetail?: string; pendingSource?: PendingSource }
const field = (value: string, source: FieldSource = value ? 'Manual' : 'Blank', sourceDetail?: string): FieldState => ({ value, source, sourceDetail, dirty: false });
const sourceBadge = (source: FieldSource) => ({ Blank: 'Blank', Scraped: 'Scraped', 'NOI Tab': 'From NOI', 'Property Profile': 'From Property', 'AI Benchmark': 'AI Benchmark', Manual: 'Manual', 'User Override': 'Override', Verified: 'Verified' }[source]);
const severityRank: Record<WarningSeverity, number> = { Critical: 0, Required: 1, Recommended: 2 };
const warningKey = (warning: CapRateWarning) => `${warning.category}:${warning.severity}:${warning.message}`;

function firstNumber(...values: unknown[]) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

const valueAtCap = (noi: number | null | undefined, capRatePct: number | null | undefined) =>
  noi && capRatePct && capRatePct > 0 ? noi / (capRatePct / 100) : null;

function normaliseEstimate(raw: any, snapshot: any, sourceBefore: string): CapRateAiEstimate {
  const low = firstNumber(raw?.capRateRange?.low, raw?.capRateLowPct) ?? null;
  const mid = firstNumber(raw?.capRateRange?.mid, raw?.capRateMidPct) ?? null;
  const high = firstNumber(raw?.capRateRange?.high, raw?.capRateHighPct) ?? null;
  const rec = firstNumber(raw?.recommendedTargetCapRate, raw?.targetCapRatePct, mid) ?? null;
  const confidence = String(raw?.confidence ?? 'Low').toLowerCase();
  const confidenceTitle = confidence === 'high' ? 'High' : confidence === 'medium' ? 'Medium' : 'Low';
  const missingInputs = raw?.missingInputs ?? snapshot.missingInputs ?? [];
  const selectedNoi = firstNumber(snapshot.marketNoi, snapshot.passingNoi, snapshot.actualNoi, snapshot.stabilisedNoi, snapshot.lenderAdjustedNoi);
  const valuationLow = firstNumber(raw?.suggestedValuationRange?.low, raw?.valuationRange?.low) ?? valueAtCap(selectedNoi, high);
  const valuationMidpoint = firstNumber(raw?.suggestedValuationRange?.midpoint, raw?.suggestedValuationRange?.mid, raw?.valuationRange?.midpoint, raw?.valuationRange?.mid) ?? valueAtCap(selectedNoi, rec);
  const valuationHigh = firstNumber(raw?.suggestedValuationRange?.high, raw?.valuationRange?.high) ?? valueAtCap(selectedNoi, low);
  const warnings = [...(raw?.warnings ?? []), ...(missingInputs.length ? ['AI cap rate estimate accuracy is limited because key property details are missing.'] : [])];
  return {
    propertyId: snapshot.propertyId ?? '',
    dealId: snapshot.dealId ?? snapshot.propertyId ?? '',
    estimateType: 'CAP_RATE_RANGE',
    summary: raw?.summary ?? raw?.evidenceBasis ?? 'Property-specific cap-rate benchmark estimate.',
    capRateRange: { low, mid, high },
    recommendedTargetCapRate: rec,
    confidence: confidenceTitle,
    benchmarkBasis: raw?.benchmarkBasis ?? raw?.basis ?? 'Indicative market benchmark based on property type, location, income, lease profile and supplied value context.',
    suggestedValuationRange: { low: valuationLow, midpoint: valuationMidpoint, high: valuationHigh },
    supportingInputsUsed: raw?.supportingInputsUsed ?? snapshot.supportingInputsUsed ?? [],
    missingInputs,
    reasoningSummary: raw?.reasoningSummary ?? raw?.reasoning ?? 'Estimate generated from supplied property, NOI, value, lease and asset-quality context.',
    warnings,
    requiredDocuments: raw?.requiredDocuments ?? ['Independent valuation or valuer confirmation'],
    requiresValuerConfirmation: true,
    estimatedFields: [{ field: 'targetCapRatePct', currentValue: snapshot.current?.targetCapRatePct ?? null, estimatedValue: rec, unit: '%', confidence: confidenceTitle, sourceStatusBefore: sourceBefore, sourceStatusAfter: 'AI Estimate', reasoningSummary: raw?.reasoningSummary ?? raw?.reasoning ?? '', requiresSpecialistReview: confidenceTitle === 'Low', requiredDocument: 'Independent valuation or valuer confirmation', shouldOverwrite: false }],
    recommendedNextAction: raw?.recommendedNextAction ?? 'Review the benchmark estimate, then accept a selected cap rate or keep the current manual value.',
  };
}

export function CapRateCalculatorCard() {
  const { prefill, property, pushBack } = useCalculatorPrefill();
  const { profile, updateGlobal, setSourceMode, appendAiAudit } = useCommercialDealState();
  const [fields, setFields] = useState<Record<CapField, FieldState>>({ passingNoi: field(''), marketNoi: field(''), price: field(''), targetCap: field('') });
  const [estimating, setEstimating] = useState(false);
  const [aiEstimate, setAiEstimate] = useState<CapRateAiEstimate | null>(null);
  const [proposedCap, setProposedCap] = useState('');
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showSensitivity, setShowSensitivity] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [savingBack, setSavingBack] = useState(false);

  const audit = (action: string, fieldName: string, previousValue: unknown, newValue: unknown, source: string) => appendAiAudit({ action, fieldKey: fieldName, previousValue, newValue, source, timestamp: new Date().toISOString(), user: 'current-user', propertyId: prefill?.propertyId, dealId: prefill?.propertyId } as any);

  const resolveCascade = (p: CalculatorPrefill): Record<CapField, SourceCandidate | undefined> => {
    const rawProperty = (property ?? {}) as Record<string, any>;
    const actualNoi = firstNumber((profile.noiOutputs as any)?.actualNoi, (profile.noiOutputs as any)?.actualNOI, (profile.noiOutputs as any)?.noi);
    const stabilisedNoi = firstNumber((profile.noiOutputs as any)?.stabilisedNoi, (profile.noiOutputs as any)?.stabilisedNOI);
    const lenderAdjustedNoi = firstNumber((profile.noiOutputs as any)?.lenderAdjustedNoi, (profile.noiOutputs as any)?.lenderAdjustedNOI);
    const profilePassingNoi = firstNumber(p.passingNoi);
    const scrapedPassingNoi = firstNumber(rawProperty.scraped_passing_noi, rawProperty.extracted_passing_noi_pa, rawProperty.extractedPassingNoiPa, rawProperty.passing_noi_pa, rawProperty.noi, p.grossPassingRentPa);
    const profileMarketNoi = firstNumber(p.marketNoi, (profile.leaseIncome as any)?.marketRent);
    const scrapedMarketNoi = firstNumber(rawProperty.scraped_market_noi, rawProperty.extracted_market_noi_pa, rawProperty.extractedMarketNoiPa, rawProperty.market_noi_pa, rawProperty.market_rent_pa, p.marketRentPa);
    const purchasePrice = firstNumber(p.purchasePrice, profile.propertyValuation.purchasePrice);
    const estimatedValue = firstNumber(p.valuation, profile.propertyValuation.estimatedMarketValue);
    const bankValue = firstNumber(profile.propertyValuation.bankValuation, rawProperty.bank_valuation, rawProperty.bankValuation);
    const scrapedPrice = firstNumber(rawProperty.scraped_asking_price, rawProperty.asking_price, rawProperty.guide_price, rawProperty.price_guide, rawProperty.extracted_price, rawProperty.extractedAskingPrice);
    const acceptedAiCap = fields.targetCap.source === 'AI Benchmark' ? firstNumber(fields.targetCap.value) : undefined;
    const verifiedValuerCap = firstNumber(rawProperty.verified_cap_rate, rawProperty.verifiedCapRate, rawProperty.valuer_cap_rate, rawProperty.valuerCapRate, rawProperty.valuation_cap_rate, rawProperty.valuationCapRate);
    const savedBenchmark = firstNumber((profile.capRateOutputs as any)?.targetCapRatePct, (profile.capRateOutputs as any)?.capitalisationRate, profile.propertyValuation.estimatedCapRate, rawProperty.benchmark_cap_rate, rawProperty.cap_rate);

    const pick = (...items: Array<SourceCandidate | undefined>) => items.find(item => item && item.value > 0);
    return {
      passingNoi: pick(actualNoi ? { value: actualNoi, source: 'NOI Tab', sourceDetail: 'NOI tab Actual NOI' } : undefined, profilePassingNoi ? { value: profilePassingNoi, source: 'Property Profile', sourceDetail: 'Property profile Passing NOI' } : undefined, scrapedPassingNoi ? { value: scrapedPassingNoi, source: 'Scraped', sourceDetail: 'Scraped rental / income data' } : undefined),
      marketNoi: pick(stabilisedNoi ? { value: stabilisedNoi, source: 'NOI Tab', sourceDetail: 'NOI tab Stabilised NOI' } : undefined, lenderAdjustedNoi ? { value: lenderAdjustedNoi, source: 'NOI Tab', sourceDetail: 'NOI tab Lender-Adjusted NOI' } : undefined, profileMarketNoi ? { value: profileMarketNoi, source: 'Property Profile', sourceDetail: 'Property profile market rent / stabilised NOI' } : undefined, scrapedMarketNoi ? { value: scrapedMarketNoi, source: 'Scraped', sourceDetail: 'Scraped market rental / income data' } : undefined),
      price: pick(purchasePrice ? { value: purchasePrice, source: 'Property Profile', sourceDetail: 'Property profile purchase price' } : undefined, estimatedValue ? { value: estimatedValue, source: 'Property Profile', sourceDetail: 'Estimated market value' } : undefined, bankValue ? { value: bankValue, source: 'Property Profile', sourceDetail: 'Bank valuation' } : undefined, scrapedPrice ? { value: scrapedPrice, source: 'Scraped', sourceDetail: 'Scraped asking price / guide price' } : undefined),
      targetCap: pick(verifiedValuerCap ? { value: verifiedValuerCap, source: 'Verified', sourceDetail: 'Verified valuer cap rate' } : undefined, acceptedAiCap ? { value: acceptedAiCap, source: 'AI Benchmark', sourceDetail: 'Accepted AI benchmark cap rate' } : undefined, savedBenchmark ? { value: savedBenchmark, source: savedBenchmark === (profile.capRateOutputs as any)?.targetCapRatePct ? 'AI Benchmark' : 'Property Profile', sourceDetail: 'Saved property benchmark cap rate' } : undefined),
    };
  };

  const applyCascade = (p: CalculatorPrefill, explicit = false) => {
    const candidates = resolveCascade(p);
    setFields(current => {
      const next = { ...current };
      (Object.keys(candidates) as CapField[]).forEach(k => {
        const candidate = candidates[k];
        if (!candidate) return;
        const candidateValue = String(candidate.value);
        const existing = current[k];
        if (existing.source === 'User Override' && !explicit) {
          if (existing.value !== candidateValue) next[k] = { ...existing, pendingSource: { ...candidate, noticedAt: new Date().toISOString() } };
          return;
        }
        if (existing.source === 'Verified' && !explicit) return;
        if (!existing.dirty || existing.source === 'Blank' || explicit) next[k] = { value: candidateValue, source: candidate.source, sourceDetail: candidate.sourceDetail, dirty: false, originalValue: existing.originalValue, originalSource: existing.originalSource };
      });
      return next;
    });
    audit('cap rate editable data cascade applied', 'capRate', null, candidates, 'Global Input Sync');
  };

  useEffect(() => {
    if (prefill) applyCascade(prefill, false);
    else setFields(current => Object.fromEntries(Object.entries(current).map(([k, v]) => [k, v.source === 'User Override' ? v : field('')])) as Record<CapField, FieldState>);
    setAiEstimate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.propertyId, profile.noiOutputs, profile.propertyValuation, profile.capRateOutputs, property]);

  const setManual = (key: CapField, value: string) => setFields(prev => {
    const previous = prev[key];
    const nextSource: FieldSource = previous.source === 'Blank' || previous.source === 'Manual' ? 'Manual' : 'User Override';
    audit('manual cap rate/yield field edit', key, { value: previous.value, source: previous.source }, { value, source: nextSource, originalValue: previous.originalValue ?? previous.value, originalSource: previous.originalSource ?? previous.source }, nextSource);
    return { ...prev, [key]: { ...previous, value, source: nextSource, dirty: true, originalValue: previous.originalValue ?? previous.value, originalSource: previous.originalSource ?? previous.source, pendingSource: undefined } };
  });

  const useSourceValue = (key: CapField) => setFields(prev => {
    const pending = prev[key].pendingSource;
    if (!pending) return prev;
    audit('cap rate source value accepted over override', key, { value: prev[key].value, source: prev[key].source }, pending, pending.source);
    return { ...prev, [key]: { value: String(pending.value), source: pending.source, sourceDetail: pending.sourceDetail, dirty: false, originalValue: prev[key].originalValue, originalSource: prev[key].originalSource } };
  });

  const keepOverride = (key: CapField) => setFields(prev => {
    const pending = prev[key].pendingSource;
    if (pending) audit('cap rate source value declined; override kept', key, pending, { value: prev[key].value, source: prev[key].source }, 'User Override');
    return { ...prev, [key]: { ...prev[key], pendingSource: undefined } };
  });

  const passingNoi = fields.passingNoi.value, marketNoi = fields.marketNoi.value, price = fields.price.value, targetCap = fields.targetCap.value;
  const hasPassingNoi = hasPositiveNumber(passingNoi);
  const hasMarketNoi = hasPositiveNumber(marketNoi);
  const hasPrice = hasPositiveNumber(price);
  const hasTargetCap = hasPositiveNumber(targetCap);
  const hasSelectedNoi = hasPassingNoi || hasMarketNoi;
  const hasYieldInputs = hasPrice && hasSelectedNoi;
  const hasImpliedValueInputs = hasSelectedNoi && hasTargetCap;
  const hasValuationGapInputs = hasImpliedValueInputs && hasPrice;
  const benchmarkContext = useMemo(() => {
    const rawProperty = (property ?? {}) as Record<string, any>;
    const location = (prefill as any)?.suburb || prefill?.address || rawProperty.suburb || rawProperty.location || rawProperty.address;
    const items = {
      assetCategory: prefill?.assetCategory,
      assetSubtype: prefill?.assetSubtype,
      state: prefill?.state,
      location,
      leaseStatus: rawProperty.lease_status || rawProperty.leaseStatus || (profile.leaseIncome as any)?.leaseStatus,
      leaseType: profile.leaseIncome?.leaseType || rawProperty.lease_type || rawProperty.leaseType,
      income: hasSelectedNoi ? 'NOI supplied' : undefined,
      priceValue: hasPrice ? 'Value supplied' : undefined,
    };
    const missing = Object.entries(items).filter(([, value]) => !value || value === 'unknown').map(([key]) => key);
    const optionalMissing = [
      !firstNumber(rawProperty.tenant_strength, rawProperty.tenantStrength, rawProperty.tenant_quality, rawProperty.tenantQuality) && !(rawProperty.tenant_covenant || rawProperty.tenantCovenant) ? 'Tenant covenant / strength' : undefined,
      !firstNumber(prefill?.walesYears, rawProperty.wale, rawProperty.waleYears) ? 'WALE' : undefined,
    ].filter(Boolean) as string[];
    return { ready: missing.length === 0, missing, optionalMissing, location };
  }, [hasPrice, hasSelectedNoi, prefill, profile.leaseIncome, property]);
  const canEstimateCapRate = Boolean(prefill && benchmarkContext.ready);
  const sensitivityRates = useMemo(() => {
    const target = positiveNum(targetCap);
    return target > 0 ? [target - 1, target - 0.5, target, target + 0.5, target + 1].filter(r => r > 0).map(r => Number(r.toFixed(2))) : [5.5, 6, 6.5, 7, 7.5];
  }, [targetCap]);
  const yields = useMemo(() => calculateYields({ passingNoi, marketNoi, price }), [passingNoi, marketNoi, price]);
  const capAssessment = useMemo(() => calculateCapRateEngine({ passingNoi, marketNoi, selectedNoi: marketNoi || passingNoi, stabilisedNoi: (profile.noiOutputs as any)?.stabilisedNoi ?? (profile.noiOutputs as any)?.stabilisedNOI, lenderAdjustedNoi: (profile.noiOutputs as any)?.lenderAdjustedNoi ?? (profile.noiOutputs as any)?.lenderAdjustedNOI, price, targetCapRatePct: targetCap, valuationBasis: 'market', sensitivityCapRatesPct: sensitivityRates, aiBenchmark: fields.targetCap.source === 'AI Benchmark' }), [passingNoi, marketNoi, profile.noiOutputs, price, targetCap, sensitivityRates, fields.targetCap.source]);
  const reversionarySpread = yields.reversionaryYield !== null && yields.passingYield !== null ? Number((yields.reversionaryYield - yields.passingYield).toFixed(2)) : null;

  const anyCapRateDataEntered = [passingNoi, marketNoi, price, targetCap].some(value => parseCapRateNumber(value) !== null) || Boolean(prefill) || Boolean(aiEstimate);
  const capWarnings = useMemo<CapRateWarning[]>(() => {
    if (!anyCapRateDataEntered) return [];
    const rawProperty = (property ?? {}) as Record<string, any>;
    const list: CapRateWarning[] = [];
    const add = (warning: CapRateWarning) => list.push(warning);
    const parsedPassingNoi = num(passingNoi);
    const parsedMarketNoi = num(marketNoi);
    const parsedPrice = num(price);
    const parsedTargetCap = num(targetCap);
    const hasNoi = parsedPassingNoi !== null || parsedMarketNoi !== null;
    const materiallyDifferentNoi = parsedPassingNoi !== null && parsedMarketNoi !== null && Math.abs(parsedMarketNoi - parsedPassingNoi) / Math.max(Math.abs(parsedPassingNoi), 1) > 0.2;
    const marketNoiAbovePassing = parsedPassingNoi !== null && parsedMarketNoi !== null && parsedMarketNoi > parsedPassingNoi * 1.15;
    const valuationGapMaterial = capAssessment.valuationGapPct !== null && Math.abs(capAssessment.valuationGapPct) >= 0.1;
    const expectedLow = firstNumber(aiEstimate?.capRateRange.low, (profile.capRateOutputs as any)?.benchmarkLowPct, rawProperty.benchmark_cap_rate_low, rawProperty.cap_rate_low);
    const expectedHigh = firstNumber(aiEstimate?.capRateRange.high, (profile.capRateOutputs as any)?.benchmarkHighPct, rawProperty.benchmark_cap_rate_high, rawProperty.cap_rate_high);
    const targetOutsideBenchmark = parsedTargetCap !== null && expectedLow && expectedHigh && (parsedTargetCap < expectedLow || parsedTargetCap > expectedHigh);
    const leaseStatus = rawProperty.lease_status || rawProperty.leaseStatus || (profile.leaseIncome as any)?.leaseStatus;
    const propertyRisk = String(rawProperty.risk_rating || rawProperty.riskRating || rawProperty.property_risk || rawProperty.propertyRisk || '').toLowerCase();

    if (!prefill && parsedPrice !== null && fields.price.source === 'Manual') add({ category: 'Data Source', severity: 'Required', message: 'Price / value is manually entered and not linked to property profile.' });
    if (hasNoi && parsedPrice === null) add({ category: 'Valuation', severity: 'Critical', message: 'Price / value is missing while NOI is available.' });
    if (!hasNoi && parsedPrice !== null) add({ category: 'NOI', severity: 'Critical', message: 'NOI is missing while price / value is available.' });
    if (fields.targetCap.source === 'AI Benchmark') add({ category: 'Benchmark', severity: 'Required', message: 'Benchmark cap rate is AI-estimated and requires valuer confirmation.' });
    if (fields.targetCap.source !== 'Verified' && parsedTargetCap !== null) add({ category: 'Verification', severity: 'Required', message: 'No valuer confirmation has been provided.' });
    if (fields.passingNoi.source === 'User Override' || fields.marketNoi.source === 'User Override') add({ category: 'NOI', severity: 'Recommended', message: 'NOI source has been overridden. Review assumption history.' });
    if (materiallyDifferentNoi) add({ category: 'NOI', severity: 'Recommended', message: 'Passing NOI and Market NOI materially differ. Review income assumptions.' });
    if (marketNoiAbovePassing) add({ category: 'NOI', severity: 'Required', message: 'Market NOI is higher than passing NOI. Review reversionary assumptions.' });
    if (targetOutsideBenchmark) add({ category: 'Benchmark', severity: 'Required', message: 'Target Cap Rate is materially outside the expected benchmark range.' });
    if (!leaseStatus || leaseStatus === 'unknown') add({ category: 'Lease', severity: 'Required', message: 'Lease status is unknown.' });
    if (propertyRisk.includes('high') || propertyRisk.includes('red')) add({ category: 'Property Record', severity: 'Required', message: 'Property record risk is high. Specialist review recommended.' });
    if (valuationGapMaterial) add({ category: 'Valuation', severity: 'Required', message: 'Valuation gap is material. Confirm evidence before reporting.' });
    capAssessment.warnings.forEach(message => {
      const lower = message.toLowerCase();
      const severity: WarningSeverity = lower.includes('target cap rate is missing') ? 'Recommended' : lower.includes('missing') || lower.includes('invalid') ? 'Critical' : 'Recommended';
      add({ category: 'Valuation', severity, message });
    });

    return Array.from(new Map(list.map(w => [warningKey(w), w])).values()).sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  }, [aiEstimate, anyCapRateDataEntered, capAssessment, fields, marketNoi, passingNoi, prefill, price, profile.capRateOutputs, profile.leaseIncome, property, targetCap]);
  const warnings = capWarnings.map(w => w.message);

  const readinessStatus = useMemo<CapRateReadinessStatus>(() => {
    const sourceValuesConfirmed = Object.values(fields).some(field => field.source === 'Verified' || field.source === 'NOI Tab' || field.source === 'Property Profile' || field.source === 'Scraped');
    if (!anyCapRateDataEntered || (!hasSelectedNoi && !hasPrice)) return 'Awaiting Cap Rate Inputs';
    if (hasSelectedNoi && hasPrice && hasTargetCap && fields.targetCap.source === 'Verified' && Boolean(prefill) && sourceValuesConfirmed) return 'Verified Benchmark';
    if (capWarnings.some(w => w.severity === 'Critical' || w.severity === 'Required')) return 'Specialist Review Recommended';
    if (hasSelectedNoi && hasPrice && hasTargetCap) return 'Cap Rate Assessment Ready';
    if (hasSelectedNoi && hasPrice) return 'Preliminary Yield Estimate';
    return 'Awaiting Cap Rate Inputs';
  }, [anyCapRateDataEntered, capWarnings, fields, hasPrice, hasSelectedNoi, hasTargetCap, prefill]);

  const priorityWarnings = capWarnings.slice(0, 3);

  const benchmarkStatus = fields.targetCap.source === 'AI Benchmark'
    ? 'AI benchmark applied'
    : fields.targetCap.source === 'Verified'
      ? 'Market benchmark verified'
      : hasTargetCap
        ? fields.targetCap.source === 'Manual' || fields.targetCap.source === 'User Override'
          ? 'Manual benchmark'
          : 'Valuer confirmation required'
        : 'Benchmark pending';
  const sourceSummary = prefill ? `Linked property: ${prefill.address || prefill.propertyId || 'property record'}` : 'Manual entry / no property linked';
  const syncStatus = prefill ? 'Global input sync on' : 'Manual entry only';
  const assumptionStatus = readinessStatus;
  const hasSensitivity = capAssessment.selectedNoi !== null && capAssessment.valueSensitivity.length > 0;
  const hasSaveableCapRateValue = hasPassingNoi || hasMarketNoi || hasPrice || hasTargetCap;
  const statusToneClass = readinessStatus === 'Verified Benchmark' ? 'border-success/30 bg-success/10 text-success' : readinessStatus === 'Specialist Review Recommended' ? 'border-brand-500/30 bg-brand-500/10 text-brand-200' : readinessStatus === 'Awaiting Cap Rate Inputs' ? 'border-muted-foreground/20 bg-muted/20 text-muted-foreground' : 'border-primary/25 bg-primary/10 text-primary';
  const benchmarkToneClass = fields.targetCap.source === 'Verified' ? 'border-success/30 bg-success/10 text-success' : fields.targetCap.source === 'AI Benchmark' || benchmarkStatus === 'Valuer confirmation required' ? 'border-brand-500/30 bg-brand-500/10 text-brand-200' : benchmarkStatus === 'Benchmark pending' ? 'border-muted-foreground/20 bg-muted/20 text-muted-foreground' : 'border-primary/25 bg-primary/10 text-primary';
  const saveBackTooltip = !prefill ? 'Select or link a property before saving cap rate assumptions.' : !hasSaveableCapRateValue ? 'Enter at least one cap rate assumption before saving.' : 'Save cap rate assumptions back to the linked property profile.';

  const confidenceLabel = readinessStatus === 'Verified Benchmark' ? 'High' : readinessStatus === 'Cap Rate Assessment Ready' ? 'Medium' : readinessStatus === 'Preliminary Yield Estimate' ? 'Indicative' : readinessStatus === 'Specialist Review Recommended' ? 'Review required' : 'Pending';
  const confidenceToneClass = readinessStatus === 'Verified Benchmark' ? 'from-success/25 to-success/5 border-success/30 text-success' : readinessStatus === 'Specialist Review Recommended' ? 'from-brand-500/25 to-brand-500/5 border-brand-500/30 text-brand-100' : readinessStatus === 'Awaiting Cap Rate Inputs' ? 'from-muted/40 to-muted/10 border-muted-foreground/20 text-muted-foreground' : 'from-primary/20 to-primary/5 border-primary/25 text-primary';

  const sourceCounts = useMemo(() => ({
    userOverrides: Object.values(fields).filter(f => f.source === 'User Override').length,
    aiBenchmarks: Object.values(fields).filter(f => f.source === 'AI Benchmark').length,
    propertyProfileValues: Object.values(fields).filter(f => f.source === 'Property Profile').length,
  }), [fields]);
  const assumptionStatuses = useMemo(() => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.source])), [fields]);
  const originalSourceValues = useMemo(() => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v.originalValue ?? v.value, source: v.originalSource ?? v.source, sourceDetail: v.sourceDetail }])), [fields]);
  const userOverrideValues = useMemo(() => Object.fromEntries(Object.entries(fields).filter(([, v]) => v.source === 'User Override').map(([k, v]) => [k, v.value])), [fields]);
  const finalInputValues = useMemo(() => ({ passingNoi: num(passingNoi), marketNoi: num(marketNoi), price: num(price), targetCapRatePct: num(targetCap) }), [marketNoi, passingNoi, price, targetCap]);
  const capRateOutputPayload = useMemo(() => ({
    ...capAssessment,
    passingYield: yields.passingYield,
    reversionaryYield: yields.reversionaryYield,
    blendedYield: yields.blendedYield,
    simpleAverageYield: yields.simpleAverageYield,
    reversionSpread: reversionarySpread,
    targetCapRatePct: num(targetCap),
    benchmarkStatus,
    readinessStatus,
    assumptionStatuses,
    finalInputValues,
    sourceCounts,
    downstreamSync: {
      borrowingCapacity: 'valuationSensitivityOnly',
      noi: 'readOnlySourceToCapRate',
      dcf: 'terminalCapOptInOnly',
      reportOverview: 'yieldImpliedValueValuationGapBenchmarkStatus',
      scenarioComparison: 'savedCapRateAssumptions',
    },
  }), [assumptionStatuses, benchmarkStatus, capAssessment, finalInputValues, readinessStatus, reversionarySpread, sourceCounts, targetCap, yields]);
  const saveBackRecord = useMemo(() => ({
    finalInputValues,
    sourceState: assumptionStatuses,
    originalSourceValues,
    userOverrideValues,
    aiBenchmarkRange: aiEstimate?.capRateRange ?? (fields.targetCap.source === 'AI Benchmark' ? (profile.capRateOutputs as any)?.benchmarkRange : undefined),
    acceptedBenchmarkValue: fields.targetCap.source === 'AI Benchmark' ? num(targetCap) : undefined,
    timestamp: new Date().toISOString(),
    userId: (property as any)?.user_id ?? 'current-user',
    calculationVersion: 'cap-rate-v2-readiness-sync',
    propertyId: prefill?.propertyId ?? null,
    scenarioId: (profile as any)?.scenarioId ?? (property as any)?.scenario_id ?? undefined,
    outputs: capRateOutputPayload,
  }), [aiEstimate, assumptionStatuses, capRateOutputPayload, fields.targetCap.source, finalInputValues, originalSourceValues, prefill?.propertyId, profile, property, targetCap, userOverrideValues]);

  const requestSaveBack = () => {
    if (!prefill || !hasSaveableCapRateValue) return;
    setSaveDialogOpen(true);
  };

  const confirmSaveBack = async () => {
    if (!prefill) return;
    setSavingBack(true);
    try {
      updateGlobal('capRateOutputs', capRateOutputPayload as any);
      audit('cap rate assumptions saved back to property', 'capRate', null, saveBackRecord, 'Save back to property');
      const existingNotes = typeof (property as any)?.notes === 'string' ? (property as any).notes : '';
      const capRateNote = `Cap rate assumptions saved ${saveBackRecord.timestamp}: ${JSON.stringify(saveBackRecord)}`;
      const patch = prefill.domain === 'industrial'
        ? { purchase_price: hasPrice ? num(price) : undefined, current_valuation: capAssessment.impliedValue || undefined, notes: [existingNotes, capRateNote].filter(Boolean).join('\n') }
        : { purchase_price: hasPrice ? num(price) : undefined, valuation: capAssessment.impliedValue || undefined, notes: [existingNotes, capRateNote].filter(Boolean).join('\n') };
      const result = await pushBack(patch);
      if (result.ok) {
        setSaveDialogOpen(false);
        toast.success('Cap rate assumptions saved to property profile.');
      }
    } finally {
      setSavingBack(false);
    }
  };


  const buildSnapshot = () => {
    const missingInputs = ['address', 'assetSubtype', 'state', 'glaSqm', 'siteAreaSqm', 'walesYears', 'passingNoi', 'marketNoi', 'price'].filter(k => !({ ...prefill, price: num(price), passingNoi: num(passingNoi), marketNoi: num(marketNoi) } as any)?.[k]);
    const supportingInputsUsed = Object.entries({ address: prefill?.address, state: prefill?.state, assetSubtype: prefill?.assetSubtype, glaSqm: prefill?.glaSqm, siteAreaSqm: prefill?.siteAreaSqm, hardstandSqm: prefill?.hardstandSqm, walesYears: prefill?.walesYears, passingNoi: num(passingNoi), marketNoi: num(marketNoi), price: num(price) }).filter(([, v]) => v != null && v !== '' && v !== 0).map(([k]) => k);
    return { propertyId: prefill?.propertyId, dealId: prefill?.propertyId, address: prefill?.address, state: prefill?.state, location: benchmarkContext.location, propertyType: prefill?.assetCategory, assetSubtype: prefill?.assetSubtype, glaSqm: prefill?.glaSqm, siteAreaSqm: prefill?.siteAreaSqm, siteCoverPct: prefill?.siteCoverPct, hardstandSqm: prefill?.hardstandSqm, tenant: (property as any)?.tenant, tenantQuality: (property as any)?.tenant_quality, leaseStatus: (property as any)?.lease_status, leaseType: profile.leaseIncome.leaseType, wale: prefill?.walesYears ?? (property as any)?.wale, leaseExpiry: (property as any)?.lease_expiry, currentRent: prefill?.grossPassingRentPa, marketRent: prefill?.marketRentPa, passingNoi: num(passingNoi), marketNoi: num(marketNoi), actualNoi: (profile.noiOutputs as any)?.actualNoi, stabilisedNoi: (profile.noiOutputs as any)?.stabilisedNoi, lenderAdjustedNoi: (profile.noiOutputs as any)?.lenderAdjustedNoi, vacancyAllowance: profile.leaseIncome.vacancyAllowancePct, outgoingsRecovery: prefill?.recoveredOutgoingsPa, currentPriceValue: num(price), purchasePrice: prefill?.purchasePrice, ownershipEntity: (property as any)?.ownership_entity, current: { passingNoi: num(passingNoi), marketNoi: num(marketNoi), price: num(price), targetCapRatePct: num(targetCap), statuses: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.source])) }, riskWarnings: warnings, supportingInputsUsed, missingInputs: [...missingInputs, ...benchmarkContext.optionalMissing] };
  };

  const requestEstimate = async () => {
    if (!prefill) { toast.error('More property information is required before a cap rate benchmark can be estimated.'); return; }
    if (!canEstimateCapRate) { toast.error('More property information is required before a cap rate benchmark can be estimated.'); return; }
    setEstimating(true); audit('AI cap rate estimate requested', 'targetCapRatePct', num(targetCap), null, 'AI Estimate');
    try {
      const snapshot = buildSnapshot();
      const { data, error } = await invokeSecureFunction<{ success: boolean; estimate?: any; error?: string }>('estimate-commercial-caprate', { snapshot });
      if (error || !data?.success || !data.estimate) { toast.error(data?.error || error?.message || 'Failed to generate cap-rate estimate'); return; }
      const estimate = normaliseEstimate(data.estimate, snapshot, fields.targetCap.source);
      setAiEstimate(estimate); setProposedCap(String(estimate.recommendedTargetCapRate ?? ''));
      setSourceMode('capRate', 'aiPending'); audit('AI cap rate estimate generated', 'targetCapRatePct', num(targetCap), estimate.recommendedTargetCapRate, 'AI Estimate');
      toast.success(`AI cap-rate range ready (${estimate.confidence} confidence).`);
    } catch (err: any) { toast.error(err?.message || 'AI estimate failed'); } finally { setEstimating(false); }
  };

  const acceptEstimate = (value?: number | null) => {
    if (!canEstimateCapRate) { toast.error('Add property details, NOI and price/value before accepting an AI benchmark.'); return; }
    const accepted = value ?? positiveNum(proposedCap);
    if (!accepted) { toast.error('Enter a cap rate to apply.'); return; }
    setFields(prev => ({ ...prev, targetCap: { value: String(accepted), source: 'AI Benchmark', sourceDetail: 'Accepted AI benchmark cap rate', dirty: true, originalValue: prev.targetCap.originalValue ?? prev.targetCap.value, originalSource: prev.targetCap.originalSource ?? prev.targetCap.source } }));
    updateGlobal('capRateOutputs', { ...capAssessment, impliedValue: ((positiveNum(marketNoi) ?? positiveNum(passingNoi)) ?? 0) / (accepted / 100), benchmarkLabel: 'Benchmark only — valuer confirmation required.' } as any);
    updateGlobal('assumptions', { 'capRate.targetCapRatePct': { fieldKey: 'capRate.targetCapRatePct', label: 'Target Cap Rate %', confidenceTag: 'AI Estimate', source: 'ai', sourceDetail: aiEstimate?.reasoningSummary, verificationRequired: true, requiredDocuments: aiEstimate?.requiredDocuments, benchmarkRange: aiEstimate?.capRateRange, selectedRate: accepted, suggestedValuationRange: aiEstimate?.suggestedValuationRange, benchmarkBasis: aiEstimate?.benchmarkBasis, updatedAt: new Date().toISOString() } } as any);
    audit('AI cap rate estimate accepted', 'targetCapRatePct', { previousValue: targetCap, benchmarkRange: aiEstimate?.capRateRange, suggestedValuationRange: aiEstimate?.suggestedValuationRange }, { selectedRate: accepted, source: 'AI Benchmark' }, 'AI Estimate');
    toast.success('AI benchmark cap rate applied. Valuer confirmation still required.');
  };
  const rejectEstimate = () => { audit('AI cap rate estimate rejected', 'targetCapRatePct', aiEstimate?.recommendedTargetCapRate, targetCap, 'AI Estimate'); setAiEstimate(null); toast.info('AI cap-rate estimate rejected; current value kept.'); };



  return (
    <Card className="border-primary/10 bg-background/95 shadow-xl">
      <CardHeader className="space-y-4">
        <div>
          <CardTitle>Capitalisation Rate</CardTitle>
          <CardDescription>Yield, cap rate, implied value, valuation gap and benchmark sensitivity.</CardDescription>
        </div>

        <div className="rounded-lg border border-primary/15 bg-muted/30 p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Data Source & Sync</div>
          <div className="grid gap-2 text-xs md:grid-cols-4">
            <StatusPill label="Calculator data source" value={sourceSummary} />
            <StatusPill label="Global input sync status" value={syncStatus} />
            <StatusPill label="Assumption status" value={assumptionStatus} />
            <div className="flex items-end md:justify-end">
              <Button size="sm" variant="outline" title={saveBackTooltip} disabled={!prefill || !hasSaveableCapRateValue || savingBack} onClick={requestSaveBack} className="disabled:cursor-not-allowed disabled:opacity-50">{savingBack ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}Save back to property</Button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary"><BarChart3 className="h-4 w-4" /> Cap rate outputs</div>
                <h3 className="mt-1 text-lg font-semibold text-foreground">Valuation and yield dashboard</h3>
                <p className="text-xs text-muted-foreground">Key outputs remain calculated from the same NOI, value and target cap-rate inputs.</p>
              </div>
              <Badge variant="outline" className={statusToneClass}>{readinessStatus}</Badge>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <HighlightMetric label="Market Cap Rate" value={displayPct(yields.reversionaryYield, hasMarketNoi && hasPrice)} />
              <HighlightMetric label="Implied Cap Rate" value={displayPct(yields.passingYield, hasPassingNoi && hasPrice)} />
              <HighlightMetric label="Implied Value" value={displayMoney(capAssessment.impliedValue, hasImpliedValueInputs)} />
              <HighlightMetric label="Valuation Gap" value={displayMoney(capAssessment.valuationGap, hasValuationGapInputs)} tone={capAssessment.valuationGap !== null && capAssessment.valuationGap < 0 ? 'negative' : 'primary'} />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <MetricTile label="Purchase Price / Valuation" value={displayMoney(num(price), hasPrice)} />
              <MetricTile label="Blended Yield" value={displayPct(yields.blendedYield, hasPassingNoi && hasMarketNoi && hasPrice)} />
              <MetricTile label="Valuation Gap %" value={hasValuationGapInputs ? pctRatio(capAssessment.valuationGapPct) : PENDING} />
            </div>
          </div>

          <div className={`rounded-2xl border bg-gradient-to-br p-5 shadow-sm ${confidenceToneClass}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em]">Valuation confidence</div>
                <div className="mt-2 text-3xl font-bold">{confidenceLabel}</div>
                <p className="mt-2 text-xs opacity-90">Confidence display mirrors the existing readiness and warning state without changing confidence calculations.</p>
              </div>
              {readinessStatus === 'Verified Benchmark' ? <CheckCircle2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <MetricRow label="Benchmark source" value={benchmarkStatus} emphasis />
              <MetricRow label="Warning count" value={String(capWarnings.length)} />
              <MetricRow label="AI / manual state" value={fields.targetCap.source} />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-primary/10 bg-muted/10 p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Valuation inputs</h3>
              <p className="text-xs text-muted-foreground">Market value, purchase price / valuation and target cap-rate assumptions used by the existing formulas.</p>
            </div>
            <Button size="sm" variant="outline" className="border-primary/40 text-primary disabled:text-muted-foreground" onClick={() => prefill && applyCascade(prefill, true)} disabled={!prefill}>Global Input Sync: On</Button>
          </div>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <InputBlock label="Actual NOI" state={fields.passingNoi} onChange={v => setManual('passingNoi', v)} onKeepOverride={() => keepOverride('passingNoi')} onUseSource={() => useSourceValue('passingNoi')} placeholder="Pulled from NOI tab or enter manually" />
            <InputBlock label="Stabilised NOI" state={fields.marketNoi} onChange={v => setManual('marketNoi', v)} onKeepOverride={() => keepOverride('marketNoi')} onUseSource={() => useSourceValue('marketNoi')} placeholder="Pulled from stabilised NOI or enter manually" />
            <InputBlock label="Market Value / Purchase Price" state={fields.price} onChange={v => setManual('price', v)} onKeepOverride={() => keepOverride('price')} onUseSource={() => useSourceValue('price')} placeholder="Pulled from property profile or enter manually" />
            <InputBlock label="Market Cap Rate %" state={fields.targetCap} onChange={v => setManual('targetCap', v)} onKeepOverride={() => keepOverride('targetCap')} onUseSource={() => useSourceValue('targetCap')} step="0.1" placeholder="Enter target cap rate" />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-primary/10 bg-muted/10 p-5">
            <h3 className="text-sm font-semibold text-foreground">NOI source selection</h3>
            <p className="mb-3 text-xs text-muted-foreground">Source badges identify whether each NOI input is synced, manual, AI-estimated or overridden.</p>
            <div className="space-y-2">
              <MetricRow label="Selected NOI for valuation" value={displayMoney(capAssessment.selectedNoi, capAssessment.selectedNoi !== null)} emphasis />
              <MetricRow label="Actual NOI source" value={sourceBadge(fields.passingNoi.source)} />
              <MetricRow label="Stabilised NOI source" value={sourceBadge(fields.marketNoi.source)} />
              <MetricRow label="Reversionary spread" value={reversionarySpread !== null ? pct(reversionarySpread) : PENDING} />
            </div>
          </div>

          <div className="rounded-2xl border border-primary/10 bg-muted/10 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Market evidence / benchmark assumptions</h3>
                <p className="text-xs text-muted-foreground">Comparable evidence, AI estimates and valuer-confirmation status.</p>
              </div>
              <Button size="sm" variant="outline" onClick={requestEstimate} disabled={estimating || !canEstimateCapRate} className="disabled:cursor-not-allowed disabled:opacity-50">{estimating ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}Estimate cap rate range</Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2"><Badge variant="outline" className={benchmarkToneClass}>{benchmarkStatus}</Badge><Badge variant="outline" className={statusToneClass}>{readinessStatus}</Badge></div>
            {!canEstimateCapRate && <p className="mt-3 rounded-lg border border-dashed border-muted-foreground/25 bg-background/40 p-3 text-xs text-muted-foreground">Benchmark estimate pending: add required property, location, NOI and valuation context to unlock comparable evidence.</p>}
            {aiEstimate && <div className="mt-4 rounded-xl border border-brand-500/20 bg-brand-500/5 p-3 text-xs text-muted-foreground space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-medium text-brand-200">AI benchmark preview:</span> {pct(aiEstimate.capRateRange.low)} – {pct(aiEstimate.capRateRange.high)} · midpoint <span className="font-semibold text-brand-100">{pct(aiEstimate.capRateRange.mid ?? aiEstimate.recommendedTargetCapRate)}</span></div><Badge variant="outline" className="border-brand-500/30 text-brand-200">{aiEstimate.confidence} confidence</Badge></div><div className="grid gap-2 md:grid-cols-2"><PreviewItem label="Comparable evidence basis" value={aiEstimate.benchmarkBasis} /><PreviewItem label="Valuer confirmation" value={aiEstimate.requiresValuerConfirmation ? 'Benchmark only — valuer confirmation required.' : 'Not flagged by benchmark response'} /><PreviewItem label="Suggested valuation range" value={`${displayMoney(aiEstimate.suggestedValuationRange.low, aiEstimate.suggestedValuationRange.low !== null)} – ${displayMoney(aiEstimate.suggestedValuationRange.high, aiEstimate.suggestedValuationRange.high !== null)}`} /><PreviewItem label="Risk notes / missing evidence" value={aiEstimate.missingInputs.join(', ') || 'None flagged.'} /></div><div className="grid grid-cols-2 gap-2 md:grid-cols-6 md:items-end"><Button size="sm" variant="outline" disabled={!canEstimateCapRate} onClick={() => acceptEstimate(aiEstimate.capRateRange.mid ?? aiEstimate.recommendedTargetCapRate)}>Accept midpoint</Button><Button size="sm" variant="outline" disabled={!canEstimateCapRate} onClick={() => acceptEstimate(aiEstimate.capRateRange.low)}>Accept low end</Button><Button size="sm" variant="outline" disabled={!canEstimateCapRate} onClick={() => acceptEstimate(aiEstimate.capRateRange.high)}>Accept high end</Button><div><Label>Custom rate %</Label><Input type="number" step="0.05" value={proposedCap} onChange={e => setProposedCap(e.target.value)} /></div><Button size="sm" disabled={!canEstimateCapRate} onClick={() => acceptEstimate()}>Apply custom</Button><Button size="sm" variant="secondary" onClick={rejectEstimate}>Reject estimate</Button></div></div>}
          </div>
        </section>

        <Collapsible open={showSensitivity} onOpenChange={setShowSensitivity} className="rounded-2xl border border-primary/10 bg-muted/10 p-5">
          <div className="mb-3"><h3 className="text-sm font-semibold text-foreground">Sensitivity or confidence summary</h3><p className="text-xs text-muted-foreground">Existing valuation sensitivity / benchmark section with clearer comparison rows.</p></div>
          <CollapsibleTrigger asChild><Button type="button" variant="outline" className="w-full justify-between">View value sensitivity <span>{showSensitivity ? '−' : '+'}</span></Button></CollapsibleTrigger>
          <CollapsibleContent className="pt-4">{hasSensitivity ? <div className="overflow-x-auto rounded-xl border border-primary/10"><div className="min-w-[460px]"><div className="grid grid-cols-3 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground"><span>Sensitivity Cap Rate</span><span className="text-right">Sensitivity Value</span><span className="text-right">Versus target</span></div>{capAssessment.valueSensitivity.map(row => <div key={row.capRatePct} className="grid grid-cols-3 px-3 py-2 text-sm odd:bg-background/40"><span>{pct(row.capRatePct)}</span><span className="text-right font-medium">{displayMoney(row.impliedValue, true)}</span><span className="text-right text-muted-foreground">{hasTargetCap ? `${(row.capRatePct - (num(targetCap) ?? row.capRatePct)).toFixed(2)}%` : PENDING}</span></div>)}</div></div> : <p className="rounded-lg border border-dashed border-muted-foreground/25 bg-background/40 p-3 text-xs text-muted-foreground">Sensitivity analysis appears once selected NOI and cap-rate sensitivity values are available.</p>}</CollapsibleContent>
        </Collapsible>

        <section className="rounded-2xl border border-brand-500/20 bg-brand-500/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-foreground">Warnings and report notes</h3><p className="text-xs text-muted-foreground">Risk notes and report warnings are displayed without changing warning logic or report output.</p></div><Button size="sm" variant="secondary" onClick={() => setShowAssumptions(v => !v)}>Assumption Status</Button></div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">{priorityWarnings.length ? priorityWarnings.map(w => <div key={warningKey(w)} className={`rounded-lg border p-3 text-xs ${w.severity === 'Critical' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-brand-500/30 bg-brand-500/5 text-brand-100'}`}><Badge variant="outline" className="mb-2 text-[10px]">{w.severity}</Badge><p>{w.message}</p></div>) : <p className="rounded-lg border border-muted-foreground/20 bg-background/40 p-3 text-xs text-muted-foreground">No priority warnings.</p>}</div>
          {showAssumptions && <div className="mt-3 rounded-xl border border-brand-500/20 bg-background/40 p-3 text-xs text-muted-foreground"><div className="mb-2 font-medium text-foreground">Detailed warning status</div>{capWarnings.length ? capWarnings.map(w => <div key={warningKey(w)} className="py-1"><Badge variant="outline" className={`mr-2 text-[10px] ${w.severity === 'Critical' ? 'border-destructive/30 text-destructive' : 'border-brand-500/30 text-brand-200'}`}>{w.severity}</Badge><span className="text-muted-foreground">{w.category}</span> — {w.message}</div>) : <div>No detailed warnings.</div>}</div>}
        </section>
      </CardContent>
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Save these cap rate assumptions back to the property profile?</DialogTitle>
            <DialogDescription>Review the assumptions and outputs that will be saved for downstream reporting and scenario comparison.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <SaveSummaryRow label="Passing NOI" value={displayMoney(finalInputValues.passingNoi, finalInputValues.passingNoi !== null)} />
            <SaveSummaryRow label="Market NOI" value={displayMoney(finalInputValues.marketNoi, finalInputValues.marketNoi !== null)} />
            <SaveSummaryRow label="Price / Value" value={displayMoney(finalInputValues.price, finalInputValues.price !== null)} />
            <SaveSummaryRow label="Target Cap Rate %" value={pct(finalInputValues.targetCapRatePct)} />
            <SaveSummaryRow label="Passing Yield" value={displayPct(yields.passingYield, hasPassingNoi && hasPrice)} />
            <SaveSummaryRow label="Reversionary Yield" value={displayPct(yields.reversionaryYield, hasMarketNoi && hasPrice)} />
            <SaveSummaryRow label="Blended Yield" value={displayPct(yields.blendedYield, hasPassingNoi && hasMarketNoi && hasPrice)} />
            <SaveSummaryRow label="Implied Value" value={displayMoney(capAssessment.impliedValue, hasImpliedValueInputs)} />
            <SaveSummaryRow label="Valuation Gap" value={displayMoney(capAssessment.valuationGap, hasValuationGapInputs)} />
            <SaveSummaryRow label="Benchmark source" value={fields.targetCap.source} />
            <SaveSummaryRow label="User overrides" value={String(sourceCounts.userOverrides)} />
            <SaveSummaryRow label="AI benchmark values" value={String(sourceCounts.aiBenchmarks)} />
            <SaveSummaryRow label="Property profile values" value={String(sourceCounts.propertyProfileValues)} />
          </div>
          <p className="rounded-md border border-primary/10 bg-muted/30 p-2 text-xs text-muted-foreground">Downstream sync updates Cap Rate outputs for Borrowing Capacity sensitivity, Report Overview and Scenario Comparison. DCF terminal cap rate and lender valuation are not overwritten without separate confirmation.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)} disabled={savingBack}>Cancel</Button>
            <Button onClick={confirmSaveBack} disabled={savingBack}>{savingBack ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}Confirm save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );

}

function InputBlock({ label, state, onChange, onKeepOverride, onUseSource, step, placeholder }: { label: string; state: FieldState; onChange: (v: string) => void; onKeepOverride: () => void; onUseSource: () => void; step?: string; placeholder?: string }) {
  const sourceTone = state.source === 'Verified'
    ? 'border-success/30 bg-success/10 text-success'
    : state.source === 'AI Benchmark'
      ? 'border-brand-500/30 bg-brand-500/10 text-brand-200'
      : state.source === 'Manual' || state.source === 'User Override'
        ? 'border-info/30 bg-info/10 text-info'
        : state.source === 'Blank'
          ? 'border-muted-foreground/20 bg-muted/20 text-muted-foreground'
          : 'border-primary/25 bg-primary/10 text-primary';
  return <div className="rounded-xl border border-primary/10 bg-background/50 p-3 shadow-sm space-y-2"><div className="flex items-center justify-between gap-2"><Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label><Badge variant="outline" className={`rounded-full px-2 py-0.5 text-[10px] ${sourceTone}`} title={state.sourceDetail}>{sourceBadge(state.source)}</Badge></div><Input className="bg-background/80" type="text" inputMode="decimal" step={step} value={state.value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />{!state.value && <p className="text-[11px] text-muted-foreground">Pending source value or manual input.</p>}{state.pendingSource && <div className="rounded-lg border border-brand-500/20 bg-brand-500/10 p-2 text-xs text-brand-100 space-y-2"><p>New source value available. This field currently uses a saved override.</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" onClick={onKeepOverride}>Keep override</Button><Button type="button" size="sm" variant="outline" onClick={onUseSource}>Use source value</Button><Button type="button" size="sm" variant="ghost" onClick={() => window.alert(`Current override: ${state.value}\nNew source (${state.pendingSource?.source}): ${state.pendingSource?.value}`)}>Compare values</Button></div></div>}</div>;
}

function SaveSummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-md border border-primary/10 bg-background/40 px-3 py-2"><span className="text-muted-foreground">{label}</span><span className="font-medium text-foreground">{value}</span></div>;
}

function PreviewItem({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-primary/10 bg-background/40 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 text-foreground">{value}</div></div>;
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-primary/10 bg-background/40 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="mt-1 truncate font-medium text-foreground" title={value}>{value}</div></div>;
}

function MetricRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return <div className={`flex items-center justify-between rounded-md border border-primary/10 bg-background/40 px-3 py-2 ${emphasis ? 'font-semibold' : ''}`}><span className="text-sm text-muted-foreground">{label}</span><span className="text-sm font-medium text-foreground">{value}</span></div>;
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-primary/10 bg-background/50 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-lg font-semibold text-foreground">{value}</div></div>;
}

function HighlightMetric({ label, value, tone = 'primary' }: { label: string; value: string; tone?: 'primary' | 'negative' }) {
  const toneClass = tone === 'negative' ? 'text-destructive' : 'text-primary';
  return <div className="rounded-lg border border-primary/20 bg-background/60 p-3 shadow-sm"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 text-2xl font-bold ${toneClass}`}>{value}</div></div>;
}
