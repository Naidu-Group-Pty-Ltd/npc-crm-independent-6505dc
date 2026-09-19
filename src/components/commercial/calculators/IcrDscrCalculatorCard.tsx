import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, Info, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { annualPI, calculateIcrDscrEngine } from '@/utils/commercial';
import { useCalculatorPrefill, type CalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { commercialApi } from '@/hooks/useCommercialProperties';
import { industrialApi } from '@/hooks/useIndustrialProperties';
import { useCommercialDealState } from '@/utils/commercial/commercialDealState';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);

const PENDING = 'Pending';

const parseNumeric = (value: string): number | null => {
  if (value.trim() === '') return null;
  const normalised = value.replace(/[$,%\s]/g, '').replace(/,/g, '');
  if (normalised === '' || normalised === '-' || normalised === '.') return null;
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
};

const finiteValue = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value : null;

type FieldSource = 'Blank' | 'NOI Tab' | 'Borrowing Capacity' | 'Property Profile' | 'Lender Policy' | 'Scraped' | 'Manual' | 'User Override' | 'Verified';
type IcrField = 'noi' | 'loan' | 'proposedLoan' | 'rate' | 'term' | 'buffer' | 'floorRate' | 'targetIcr' | 'targetDscr' | 'minDebtYield';
type WarningCategory = 'NOI' | 'Loan Amount' | 'Interest Rate' | 'Lender Policy' | 'ICR' | 'DSCR' | 'Debt Yield' | 'Data Source' | 'Verification';
type WarningSeverity = 'Critical' | 'Required' | 'Recommended';
interface CoverageWarning { category: WarningCategory; severity: WarningSeverity; message: string }
interface SourceCandidate { value: number; source: FieldSource; sourceDetail: string }
interface PendingSource extends SourceCandidate { noticedAt: string }
interface FieldState { value: string; source: FieldSource; dirty: boolean; originalValue?: string; originalSource?: FieldSource; sourceDetail?: string; pendingSource?: PendingSource }

const field = (value = '', source: FieldSource = value ? 'Manual' : 'Blank', sourceDetail?: string): FieldState => ({ value, source, sourceDetail, dirty: false });
const sourceBadge = (source: FieldSource) => ({ Blank: 'Blank', 'NOI Tab': 'From NOI', 'Borrowing Capacity': 'From Borrowing', 'Property Profile': 'From Property', 'Lender Policy': 'Lender Policy', Scraped: 'Scraped', Manual: 'Manual', 'User Override': 'Override', Verified: 'Verified' }[source]);

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === '' || value == null) continue;
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

const debtYieldPct = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n <= 1 ? n * 100 : n;
};

export function IcrDscrCalculatorCard() {
  const { prefill, property } = useCalculatorPrefill();
  const { profile, updateGlobal, appendAiAudit } = useCommercialDealState();
  const [fields, setFields] = useState<Record<IcrField, FieldState>>({ noi: field(), loan: field(), proposedLoan: field(), rate: field(), term: field(), buffer: field(), floorRate: field(), targetIcr: field(), targetDscr: field(), minDebtYield: field() });
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [stressOpen, setStressOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [rateShockPct, setRateShockPct] = useState('');
  const [noiReductionPct, setNoiReductionPct] = useState('');
  const [debtIncreasePct, setDebtIncreasePct] = useState('');
  const [conservativeIcrIncrease, setConservativeIcrIncrease] = useState('');
  const [conservativeDscrIncrease, setConservativeDscrIncrease] = useState('');
  const [conservativeDebtYieldIncreasePct, setConservativeDebtYieldIncreasePct] = useState('');

  const audit = (action: string, fieldName: string, previousValue: unknown, newValue: unknown, source: string) => appendAiAudit({ action, fieldKey: `icrDscr.${fieldName}`, previousValue, newValue, source, timestamp: new Date().toISOString(), user: 'current-user', propertyId: prefill?.propertyId, dealId: prefill?.propertyId } as any);

  const resolveCascade = (p: CalculatorPrefill): Record<IcrField, SourceCandidate | undefined> => {
    const rawProperty = (property ?? {}) as Record<string, any>;
    const noiOutputs = (profile.noiOutputs ?? {}) as Record<string, any>;
    const lending = (profile.lendingAssumptions ?? {}) as Record<string, any>;
    const borrowingOutputs = (profile.borrowingOutputs ?? {}) as Record<string, any>;
    const dealProfile = (profile.dealProfile ?? {}) as Record<string, any>;
    const debtInputs = (profile.debtInputs ?? {}) as Record<string, any>;
    const selectedBasis = noiOutputs.selectedBasis ?? noiOutputs.noiBasis ?? (profile.leaseIncome as any)?.noiBasis;
    const selectedNoi = selectedBasis === 'actual'
      ? firstNumber(noiOutputs.actualNoi, noiOutputs.actualNOI)
      : selectedBasis === 'stabilised'
        ? firstNumber(noiOutputs.stabilisedNoi, noiOutputs.stabilisedNOI)
        : selectedBasis === 'lenderAdjusted'
          ? firstNumber(noiOutputs.lenderAdjustedNoi, noiOutputs.lenderAdjustedNOI)
          : firstNumber(noiOutputs.selectedNoi, noiOutputs.actualNoi, noiOutputs.stabilisedNoi, noiOutputs.lenderAdjustedNoi);
    const manualNoi = firstNumber(noiOutputs.manualNoi, noiOutputs.manualNOI, debtInputs.manualNoi);
    const scrapedNoi = firstNumber(rawProperty.scraped_passing_noi, rawProperty.extracted_passing_noi_pa, rawProperty.passing_noi_pa, p.passingNoi, p.grossPassingRentPa);

    const proposedFromBorrowing = firstNumber(debtInputs.proposedLoanAmount, borrowingOutputs.proposedLoanAmount, borrowingOutputs.requestedLoanAmount, borrowingOutputs.maxLoan);
    const proposedFromDeal = firstNumber(dealProfile.proposedLoan, dealProfile.proposedLoanAmount, rawProperty.proposed_loan_amount, rawProperty.proposedLoanAmount);
    const savedLoan = firstNumber(rawProperty.loan_amount, rawProperty.loanAmount, rawProperty.saved_loan_amount, rawProperty.current_loan_amount);
    const hasBorrowingSource = Boolean(profile.borrowingOutputs || debtInputs.proposedLoanAmount || dealProfile.proposedLoan || dealProfile.proposedLoanAmount);
    const lenderProfile = lending.profile ? 'Lender policy profile' : 'Lender policy assumptions';

    const pick = (...items: Array<SourceCandidate | undefined>) => items.find(item => item && item.value > 0);
    const pickFinite = (...items: Array<SourceCandidate | undefined>) => items.find(item => item && item.value >= 0);
    return {
      noi: pick(selectedNoi ? { value: selectedNoi, source: 'NOI Tab', sourceDetail: `NOI tab ${selectedBasis ?? 'selected'} borrowing NOI` } : undefined, manualNoi ? { value: manualNoi, source: 'NOI Tab', sourceDetail: 'NOI tab Manual NOI' } : undefined, scrapedNoi ? { value: scrapedNoi, source: 'Scraped', sourceDetail: 'Scraped or property income NOI' } : undefined),
      loan: pick(proposedFromBorrowing ? { value: proposedFromBorrowing, source: 'Borrowing Capacity', sourceDetail: 'Borrowing Capacity Unified proposed / supportable loan' } : undefined, proposedFromDeal ? { value: proposedFromDeal, source: 'Property Profile', sourceDetail: 'Deal profile proposed loan amount' } : undefined, savedLoan ? { value: savedLoan, source: 'Property Profile', sourceDetail: 'Property profile saved loan amount' } : undefined),
      proposedLoan: pick(proposedFromDeal ? { value: proposedFromDeal, source: 'Property Profile', sourceDetail: 'Deal profile proposed loan amount' } : undefined, proposedFromBorrowing ? { value: proposedFromBorrowing, source: 'Borrowing Capacity', sourceDetail: 'Borrowing Capacity target loan' } : undefined),
      rate: pick(hasBorrowingSource && firstNumber(lending.contractInterestRatePct) ? { value: firstNumber(lending.contractInterestRatePct)!, source: 'Borrowing Capacity', sourceDetail: 'Borrowing Capacity lending assumptions' } : undefined, firstNumber(rawProperty.contract_rate_pct, rawProperty.interest_rate, rawProperty.interestRate) ? { value: firstNumber(rawProperty.contract_rate_pct, rawProperty.interest_rate, rawProperty.interestRate)!, source: 'Lender Policy', sourceDetail: 'Lender policy profile rate' } : undefined),
      term: pickFinite(hasBorrowingSource && firstFiniteNumber(lending.loanTermYears, lending.amortisationYears) != null ? { value: firstFiniteNumber(lending.loanTermYears, lending.amortisationYears)!, source: 'Borrowing Capacity', sourceDetail: 'Borrowing Capacity lending assumptions' } : undefined, firstFiniteNumber(rawProperty.loan_term_years, rawProperty.loanTermYears) != null ? { value: firstFiniteNumber(rawProperty.loan_term_years, rawProperty.loanTermYears)!, source: 'Property Profile', sourceDetail: 'Property profile loan assumptions' } : undefined),
      buffer: pickFinite(hasBorrowingSource && firstFiniteNumber(lending.assessmentBufferPct) != null ? { value: firstFiniteNumber(lending.assessmentBufferPct)!, source: 'Borrowing Capacity', sourceDetail: 'Borrowing Capacity lending assumptions' } : undefined, firstFiniteNumber(rawProperty.assessment_buffer_pct, rawProperty.assessmentBufferPct) != null ? { value: firstFiniteNumber(rawProperty.assessment_buffer_pct, rawProperty.assessmentBufferPct)!, source: 'Lender Policy', sourceDetail: lenderProfile } : undefined),
      floorRate: pickFinite(firstFiniteNumber(rawProperty.assessment_floor_rate_pct, rawProperty.assessmentFloorRatePct) != null ? { value: firstFiniteNumber(rawProperty.assessment_floor_rate_pct, rawProperty.assessmentFloorRatePct)!, source: 'Lender Policy', sourceDetail: lenderProfile } : undefined, hasBorrowingSource && firstFiniteNumber(lending.assessmentFloorRatePct) != null ? { value: firstFiniteNumber(lending.assessmentFloorRatePct)!, source: 'Borrowing Capacity', sourceDetail: 'Borrowing Capacity lending assumptions' } : undefined),
      targetIcr: pick(firstNumber(rawProperty.minimum_icr, rawProperty.minIcr) ? { value: firstNumber(rawProperty.minimum_icr, rawProperty.minIcr)!, source: 'Lender Policy', sourceDetail: lenderProfile } : undefined, hasBorrowingSource && firstNumber(lending.minIcr) ? { value: firstNumber(lending.minIcr)!, source: 'Borrowing Capacity', sourceDetail: 'Borrowing Capacity lending assumptions' } : undefined),
      targetDscr: pick(firstNumber(rawProperty.minimum_dscr, rawProperty.minDscr) ? { value: firstNumber(rawProperty.minimum_dscr, rawProperty.minDscr)!, source: 'Lender Policy', sourceDetail: lenderProfile } : undefined, hasBorrowingSource && firstNumber(lending.minDscr) ? { value: firstNumber(lending.minDscr)!, source: 'Borrowing Capacity', sourceDetail: 'Borrowing Capacity lending assumptions' } : undefined),
      minDebtYield: pick(debtYieldPct(rawProperty.minimum_debt_yield ?? rawProperty.minDebtYield) ? { value: debtYieldPct(rawProperty.minimum_debt_yield ?? rawProperty.minDebtYield)!, source: 'Lender Policy', sourceDetail: lenderProfile } : undefined, hasBorrowingSource && debtYieldPct(lending.minDebtYield) ? { value: debtYieldPct(lending.minDebtYield)!, source: 'Borrowing Capacity', sourceDetail: 'Borrowing Capacity lending assumptions' } : undefined),
    };
  };

  const applyCascade = (p: CalculatorPrefill) => {
    const candidates = resolveCascade(p);
    setFields(current => {
      const next = { ...current };
      (Object.keys(candidates) as IcrField[]).forEach(key => {
        const candidate = candidates[key];
        if (!candidate) return;
        const candidateValue = String(candidate.value);
        const existing = current[key];
        if (existing.source === 'User Override') {
          if (existing.value !== candidateValue) next[key] = { ...existing, pendingSource: { ...candidate, noticedAt: new Date().toISOString() } };
          return;
        }
        if (!existing.dirty || existing.source === 'Blank') next[key] = { value: candidateValue, source: candidate.source, sourceDetail: candidate.sourceDetail, dirty: false, originalValue: existing.originalValue, originalSource: existing.originalSource };
      });
      return next;
    });
    audit('ICR / DSCR editable data cascade applied', 'all', null, candidates, 'Global Input Sync');
  };

  useEffect(() => {
    if (prefill) applyCascade(prefill);
    else setFields(current => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value.source === 'User Override' ? value : field()])) as Record<IcrField, FieldState>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.propertyId, property, profile.noiOutputs, profile.borrowingOutputs, profile.dealProfile, profile.debtInputs, profile.lendingAssumptions]);

  const setManual = (key: IcrField, value: string) => setFields(prev => {
    const previous = prev[key];
    const nextSource: FieldSource = previous.source === 'Blank' || previous.source === 'Manual' ? 'Manual' : 'User Override';
    audit('manual ICR / DSCR field edit', key, { value: previous.value, source: previous.source }, { value, source: nextSource, originalValue: previous.originalValue ?? previous.value, originalSource: previous.originalSource ?? previous.source }, nextSource);
    return { ...prev, [key]: { ...previous, value, source: nextSource, dirty: true, originalValue: previous.originalValue ?? previous.value, originalSource: previous.originalSource ?? previous.source, pendingSource: undefined } };
  });

  const useSourceValue = (key: IcrField) => setFields(prev => {
    const pending = prev[key].pendingSource;
    if (!pending) return prev;
    audit('ICR / DSCR source value accepted over override', key, { value: prev[key].value, source: prev[key].source }, pending, pending.source);
    return { ...prev, [key]: { value: String(pending.value), source: pending.source, sourceDetail: pending.sourceDetail, dirty: false, originalValue: prev[key].originalValue, originalSource: prev[key].originalSource } };
  });

  const keepOverride = (key: IcrField) => setFields(prev => {
    const pending = prev[key].pendingSource;
    if (pending) audit('ICR / DSCR source value declined; override kept', key, pending, { value: prev[key].value, source: prev[key].source }, 'User Override');
    return { ...prev, [key]: { ...prev[key], pendingSource: undefined } };
  });

  const { noi, loan, proposedLoan, rate, term, buffer, floorRate, targetIcr, targetDscr, minDebtYield } = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.value])) as Record<IcrField, string>;

  const parsedInputs = useMemo(() => ({
    noi: parseNumeric(noi),
    loan: parseNumeric(loan),
    proposedLoan: parseNumeric(proposedLoan),
    rate: parseNumeric(rate),
    term: parseNumeric(term),
    buffer: parseNumeric(buffer),
    floorRate: parseNumeric(floorRate),
    targetIcr: parseNumeric(targetIcr),
    targetDscr: parseNumeric(targetDscr),
    minDebtYieldPct: parseNumeric(minDebtYield),
  }), [noi, loan, proposedLoan, rate, term, buffer, floorRate, targetIcr, targetDscr, minDebtYield]);

  const assessmentRateInput = parsedInputs.rate != null && parsedInputs.buffer != null && parsedInputs.floorRate != null
    ? Math.max(parsedInputs.rate + parsedInputs.buffer, parsedInputs.floorRate)
    : null;
  const hasRequiredInputs = parsedInputs.noi != null && parsedInputs.noi > 0
    && parsedInputs.loan != null && parsedInputs.loan > 0
    && parsedInputs.rate != null
    && parsedInputs.term != null && parsedInputs.term >= 0
    && parsedInputs.buffer != null
    && parsedInputs.floorRate != null
    && parsedInputs.targetIcr != null && parsedInputs.targetIcr > 0
    && parsedInputs.targetDscr != null && parsedInputs.targetDscr > 0
    && parsedInputs.minDebtYieldPct != null && parsedInputs.minDebtYieldPct > 0
    && assessmentRateInput != null && assessmentRateInput > 0;

  const preliminaryLoanAmount = parsedInputs.loan ?? parsedInputs.proposedLoan;
  const hasPreliminaryInputs = parsedInputs.noi != null && parsedInputs.noi > 0
    && preliminaryLoanAmount != null && preliminaryLoanAmount > 0
    && parsedInputs.rate != null && parsedInputs.rate > 0
    && parsedInputs.term != null && parsedInputs.term >= 0;

  const preliminaryCoverage = useMemo(() => {
    if (!hasPreliminaryInputs) return null;
    const annualInterest = preliminaryLoanAmount! * (parsedInputs.rate! / 100);
    const annualDebtService = annualPI(preliminaryLoanAmount!, parsedInputs.rate!, parsedInputs.term!);
    return {
      assessmentRateUsedPct: parsedInputs.rate!,
      annualInterest,
      annualDebtService,
      icr: annualInterest > 0 ? Number((parsedInputs.noi! / annualInterest).toFixed(2)) : null,
      dscr: annualDebtService > 0 ? Number((parsedInputs.noi! / annualDebtService).toFixed(2)) : null,
      debtYield: preliminaryLoanAmount! > 0 ? parsedInputs.noi! / preliminaryLoanAmount! : null,
    };
  }, [hasPreliminaryInputs, preliminaryLoanAmount, parsedInputs]);

  const coverage = useMemo(() => hasRequiredInputs ? calculateIcrDscrEngine({
    noi: parsedInputs.noi!,
    loanAmount: preliminaryLoanAmount!,
    proposedLoanAmount: parsedInputs.proposedLoan == null ? undefined : parsedInputs.proposedLoan,
    contractInterestRatePct: parsedInputs.rate!,
    assessmentBufferPct: parsedInputs.buffer!,
    assessmentFloorRatePct: parsedInputs.floorRate!,
    repaymentType: 'principalAndInterest',
    amortisationYears: parsedInputs.term!,
    minimumIcr: parsedInputs.targetIcr!,
    minimumDscr: parsedInputs.targetDscr!,
    minimumDebtYield: parsedInputs.minDebtYieldPct! / 100,
  }) : null, [hasRequiredInputs, preliminaryLoanAmount, parsedInputs]);

  const activeCoverage = coverage ?? preliminaryCoverage;
  const icrStatus = coverage && parsedInputs.targetIcr != null ? coverage.icr >= parsedInputs.targetIcr ? 'pass' : 'fail' : 'pending';
  const dscrStatus = coverage && parsedInputs.targetDscr != null ? coverage.dscr >= parsedInputs.targetDscr ? 'pass' : 'fail' : 'pending';
  const supportableCandidates = coverage ? [{ label: 'ICR', value: coverage.maxLoanByIcr }, { label: 'DSCR', value: coverage.maxLoanByDscr }, { label: 'Debt Yield', value: coverage.maxLoanByDebtYield }].filter(candidate => Number.isFinite(candidate.value)) : [];
  const supportableCaps = supportableCandidates.map(candidate => candidate.value);
  const lowestSupportableLoan = supportableCaps.length ? Math.min(...supportableCaps) : null;
  const bindingConstraint = supportableCandidates.length ? supportableCandidates.reduce((lowest, candidate) => candidate.value < lowest.value ? candidate : lowest).label : PENDING;
  const debtYieldPass = coverage && parsedInputs.minDebtYieldPct != null ? coverage.debtYield >= parsedInputs.minDebtYieldPct / 100 : false;
  const lowHeadroom = Boolean(coverage && coverage.icrHeadroom >= 0 && coverage.dscrHeadroom >= 0 && (coverage.icrHeadroom < 0.15 || coverage.dscrHeadroom < 0.1 || coverage.debtYieldHeadroom < 0.005));
  const hasUserOverrides = Object.values(fields).some(field => field.source === 'User Override');
  const outsideNormalLenderRange = Boolean(parsedInputs.rate != null && parsedInputs.rate > 15) || Boolean(parsedInputs.term != null && parsedInputs.term > 30);
  const linkedOrVerified = (source: FieldSource, allowed: FieldSource[]) => allowed.includes(source) || source === 'Verified';
  const verifiedSources = Boolean(prefill && coverage && (profile.icrDscrOutputs as any)?.savedAt
    && linkedOrVerified(fields.noi.source, ['NOI Tab'])
    && linkedOrVerified(fields.loan.source, ['Borrowing Capacity', 'Property Profile'])
    && linkedOrVerified(fields.rate.source, ['Borrowing Capacity', 'Lender Policy', 'Property Profile'])
    && ['targetIcr', 'targetDscr', 'minDebtYield'].every(key => linkedOrVerified(fields[key as IcrField].source, ['Borrowing Capacity', 'Lender Policy'])));
  const anyFailed = Boolean(coverage && (icrStatus === 'fail' || dscrStatus === 'fail' || !debtYieldPass));
  const hasStarted = Boolean(prefill || Object.values(fields).some(field => field.value.trim() !== '' || field.source !== 'Blank'));
  const coverageWarnings = useMemo<CoverageWarning[]>(() => {
    if (!hasStarted) return [];
    const warnings: CoverageWarning[] = [];
    const add = (category: WarningCategory, severity: WarningSeverity, message: string) => {
      if (!warnings.some(warning => warning.category === category && warning.message === message)) warnings.push({ category, severity, message });
    };
    if (fields.noi.source === 'Manual' || fields.noi.source === 'User Override') add('NOI', 'Required', 'NOI is not linked to the NOI tab. Confirm income source before relying on coverage.');
    if (fields.loan.source === 'Manual' || fields.loan.source === 'User Override') add('Loan Amount', 'Required', 'Loan amount is not linked to Borrowing Capacity or the property profile.');
    if (fields.rate.source === 'User Override') add('Interest Rate', 'Required', 'Contract rate has been manually overridden. Confirm lender rate assumptions.');
    if (fields.rate.source === 'Manual' || fields.buffer.source === 'Manual' || fields.floorRate.source === 'Manual') add('Lender Policy', 'Recommended', 'Assessment rate uses manual assumptions. Confirm lender policy.');
    if (parsedInputs.buffer == null) add('Lender Policy', 'Required', 'Assessment buffer is missing. Coverage result is preliminary only.');
    if (parsedInputs.floorRate == null) add('Lender Policy', 'Required', 'Floor rate is missing. Confirm whether lender policy requires a floor rate.');
    if (parsedInputs.term == null) add('Lender Policy', 'Required', 'Loan term is missing. Debt service cannot be fully assessed.');
    if (parsedInputs.targetIcr == null) add('ICR', 'Required', 'Minimum ICR is missing. Coverage result is preliminary only.');
    if (parsedInputs.targetDscr == null) add('DSCR', 'Required', 'Minimum DSCR is missing. Coverage result is preliminary only.');
    if (parsedInputs.minDebtYieldPct == null) add('Debt Yield', 'Required', 'Minimum debt yield is missing. Coverage result is preliminary only.');
    if (!(profile.lendingAssumptions as any)?.profile) add('Lender Policy', 'Required', 'Lender policy profile is not selected.');
    if (coverage) {
      if (parsedInputs.targetIcr != null && coverage.icr < parsedInputs.targetIcr) add('ICR', 'Critical', 'ICR is below lender threshold under current assumptions.');
      if (parsedInputs.targetDscr != null && coverage.dscr < parsedInputs.targetDscr) add('DSCR', 'Critical', 'DSCR is below lender threshold under current assumptions.');
      if (parsedInputs.minDebtYieldPct != null && coverage.debtYield < parsedInputs.minDebtYieldPct / 100) add('Debt Yield', 'Critical', 'Debt yield is below lender threshold under current assumptions.');
      if (coverage.icrHeadroom < 0) add('ICR', 'Critical', 'ICR headroom is negative.');
      if (coverage.dscrHeadroom < 0) add('DSCR', 'Critical', 'DSCR headroom is negative.');
      if (coverage.icrHeadroom >= 0 && coverage.dscrHeadroom >= 0 && (coverage.icrHeadroom < 0.15 || coverage.dscrHeadroom < 0.1)) add('Verification', 'Recommended', 'Coverage is tight. Review NOI, loan amount or amortisation assumptions.');
      if (parsedInputs.proposedLoan != null && lowestSupportableLoan != null && parsedInputs.proposedLoan > lowestSupportableLoan) add('Loan Amount', 'Critical', 'Proposed loan exceeds the lowest supportable coverage amount.');
    } else if (hasPreliminaryInputs) {
      add('Data Source', 'Required', 'Preliminary output only. Complete lender policy thresholds to run full coverage testing.');
    }
    const severityRank: Record<WarningSeverity, number> = { Critical: 0, Required: 1, Recommended: 2 };
    return warnings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  }, [coverage, fields, hasPreliminaryInputs, hasStarted, lowestSupportableLoan, parsedInputs, profile.lendingAssumptions]);
  const priorityWarnings = coverageWarnings.slice(0, 3);
  const hasSpecialistWarnings = coverageWarnings.some(warning => warning.severity === 'Critical' || warning.severity === 'Required');
  const readinessStatus = !hasPreliminaryInputs
    ? 'Awaiting Coverage Inputs'
    : !hasRequiredInputs
      ? 'Preliminary Coverage Estimate'
      : anyFailed
        ? 'Not Supportable'
        : hasSpecialistWarnings || hasUserOverrides || outsideNormalLenderRange
          ? 'Specialist Review Recommended'
          : verifiedSources
            ? 'Coverage Verified'
            : lowHeadroom
              ? 'Marginal / Tight Coverage'
              : 'Coverage Supportable';
  const coverageStatus = readinessStatus;
  const recommendedAction = readinessStatus === 'Awaiting Coverage Inputs'
    ? 'Inputs are incomplete. Import NOI and confirm lender policy assumptions.'
    : readinessStatus === 'Preliminary Coverage Estimate'
      ? 'Preliminary estimate only. Add lender thresholds, assessment buffer and floor rate to complete coverage testing.'
      : readinessStatus === 'Coverage Supportable' || readinessStatus === 'Coverage Verified'
        ? 'Coverage is supportable under current assumptions.'
        : bindingConstraint === 'ICR'
          ? 'ICR is the binding constraint. Increase NOI, reduce loan amount or review interest rate assumptions.'
          : bindingConstraint === 'DSCR'
            ? 'DSCR is the binding constraint. Review amortisation term, rate assumptions or proposed loan amount.'
            : bindingConstraint === 'Debt Yield'
              ? 'Debt yield is the binding constraint. Reduce debt or increase verified NOI.'
              : 'Review overridden, unverified or out-of-policy assumptions before relying on this coverage result.';
  const dataSourceLabel = prefill ? `Linked property: ${prefill.address || prefill.propertyId}` : 'Manual entry / no property linked';
  const assumptionStatus = readinessStatus;
  const auditHistory = profile.aiEstimateAuditLog.filter(event => event.fieldKey?.startsWith('icrDscr.')).slice(-8);
  const stressRows = coverage ? [0.5, 1].map(rateShock => {
    const shocked = calculateIcrDscrEngine({
      noi: parsedInputs.noi!,
      loanAmount: parsedInputs.loan!,
      proposedLoanAmount: parsedInputs.proposedLoan == null ? undefined : parsedInputs.proposedLoan,
      contractInterestRatePct: parsedInputs.rate! + rateShock,
      assessmentBufferPct: parsedInputs.buffer!,
      assessmentFloorRatePct: parsedInputs.floorRate!,
      repaymentType: 'principalAndInterest',
      amortisationYears: parsedInputs.term!,
      minimumIcr: parsedInputs.targetIcr!,
      minimumDscr: parsedInputs.targetDscr!,
      minimumDebtYield: parsedInputs.minDebtYieldPct! / 100,
    });
    return { label: `+${rateShock.toFixed(2)}% rate shock`, icr: shocked.icr, dscr: shocked.dscr, annualDebtService: shocked.annualDebtService };
  }) : [];

  const getNoiByBasis = (basis: string) => {
    const outputs = (profile.noiOutputs ?? {}) as Record<string, any>;
    if (basis === 'actual') return firstNumber(outputs.actualNoi, outputs.actualNOI);
    if (basis === 'stabilised') return firstNumber(outputs.stabilisedNoi, outputs.stabilisedNOI);
    if (basis === 'lenderAdjusted') return firstNumber(outputs.lenderAdjustedNoi, outputs.lenderAdjustedNOI);
    return firstNumber(outputs.manualNoi, outputs.manualNOI);
  };

  const setNoiSourceBasis = (basis: string) => {
    const nextNoi = getNoiByBasis(basis);
    if (nextNoi == null) return;
    setFields(prev => ({ ...prev, noi: { ...prev.noi, value: String(nextNoi), source: basis === 'manual' ? 'Manual' : 'NOI Tab', sourceDetail: basis === 'manual' ? 'Manual NOI selected' : `NOI tab ${basis} NOI selected`, dirty: false } }));
  };

  const navigateToCalculatorTab = (tabValue: 'noi' | 'borrowing') => {
    const tab = document.querySelector<HTMLButtonElement>(`[role="tab"][value="${tabValue}"]`)
      ?? Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(button => button.textContent?.toLowerCase().includes(tabValue === 'noi' ? 'operating income' : 'borrowing capacity'));
    tab?.click();
  };

  const bindingExplanation = !coverage
    ? 'Complete the required inputs to identify the binding constraint.'
    : bindingConstraint === 'ICR'
      ? 'ICR is the binding constraint. This means the property income is not providing enough interest coverage under the current assessment rate.'
      : bindingConstraint === 'DSCR'
        ? 'DSCR is the binding constraint. This means the property income is not providing enough coverage for total debt service.'
        : bindingConstraint === 'Debt Yield'
          ? 'Debt yield is the binding constraint. This means the lender requires more income relative to the proposed loan size.'
          : 'No single binding constraint is available until full coverage inputs are complete.';
  const resultSummary = readinessStatus === 'Not Supportable'
    ? 'The deal is not supportable under the current lender coverage assumptions.'
    : readinessStatus === 'Marginal / Tight Coverage' || readinessStatus === 'Specialist Review Recommended'
      ? 'The deal is marginal and should be reviewed before it is relied on.'
      : readinessStatus === 'Coverage Supportable' || readinessStatus === 'Coverage Verified'
        ? 'The deal is supportable under the current coverage assumptions.'
        : readinessStatus === 'Preliminary Coverage Estimate'
          ? 'This is a preliminary coverage estimate because lender policy thresholds are incomplete.'
          : 'The calculator is waiting for coverage inputs.';
  const assessmentRateIssue = coverage && (coverage.assessmentRateUsedPct > (parsedInputs.rate ?? 0) || ['Manual', 'User Override'].includes(fields.rate.source) || ['Manual', 'User Override'].includes(fields.buffer.source) || ['Manual', 'User Override'].includes(fields.floorRate.source));
  const noiIssue = fields.noi.source === 'Manual' || fields.noi.source === 'User Override' || bindingConstraint === 'ICR' || bindingConstraint === 'Debt Yield';
  const loanIssue = parsedInputs.proposedLoan != null && lowestSupportableLoan != null && parsedInputs.proposedLoan > lowestSupportableLoan;
  const resultIssueNotes = [
    assessmentRateIssue ? 'The assessment rate is increasing the tested debt cost. Review the contract rate, buffer and floor rate assumptions.' : undefined,
    noiIssue ? 'NOI is the main constraint. Review rent, vacancy, recoveries and lender adjustments in the NOI tab.' : undefined,
    loanIssue ? 'The proposed loan amount is above the supportable level under current coverage assumptions.' : undefined,
  ].filter(Boolean) as string[];
  const fixSuggestions = [
    'Increase verified NOI',
    'Reduce proposed loan amount',
    'Review lender policy profile',
    'Review contract rate and assessment buffer',
    'Extend amortisation term where lender policy allows',
    'Compare interest-only servicing if lender policy allows',
    'Confirm lease documents and recoverable outgoings',
    'Review tenant risk haircut in the NOI tab',
    'Consider alternate lender thresholds',
  ];

  const ioComparisonEnabled = Boolean((profile.lendingAssumptions as any)?.repaymentType === 'interestOnly' || (profile.lendingAssumptions as any)?.assessmentBasis === 'interestOnlyAssessment' || Number((profile.lendingAssumptions as any)?.interestOnlyPeriodYears) > 0);
  const stressScenarios = useMemo(() => {
    if (!coverage) return [];
    const baseNoi = parsedInputs.noi!;
    const baseLoan = preliminaryLoanAmount!;
    const baseRate = parsedInputs.rate!;
    const baseBuffer = parsedInputs.buffer!;
    const baseFloor = parsedInputs.floorRate!;
    const baseTerm = parsedInputs.term!;
    const baseIcr = parsedInputs.targetIcr!;
    const baseDscr = parsedInputs.targetDscr!;
    const baseDebtYield = parsedInputs.minDebtYieldPct! / 100;
    const rateShock = parseNumeric(rateShockPct) ?? 0;
    const noiReduction = (parseNumeric(noiReductionPct) ?? 0) / 100;
    const debtIncrease = (parseNumeric(debtIncreasePct) ?? 0) / 100;
    const conservativeIcr = parseNumeric(conservativeIcrIncrease) ?? 0;
    const conservativeDscr = parseNumeric(conservativeDscrIncrease) ?? 0;
    const conservativeDebtYield = (parseNumeric(conservativeDebtYieldIncreasePct) ?? 0) / 100;
    const run = (label: string, overrides: Partial<{ noi: number; loanAmount: number; assessmentRateOverridePct: number; repaymentType: 'interestOnly' | 'principalAndInterest'; minimumIcr: number; minimumDscr: number; minimumDebtYield: number }>) => {
      const result = calculateIcrDscrEngine({
        noi: overrides.noi ?? baseNoi,
        loanAmount: overrides.loanAmount ?? baseLoan,
        contractInterestRatePct: baseRate,
        assessmentBufferPct: baseBuffer,
        assessmentFloorRatePct: baseFloor,
        assessmentRateOverridePct: overrides.assessmentRateOverridePct,
        repaymentType: overrides.repaymentType ?? 'principalAndInterest',
        amortisationYears: baseTerm,
        minimumIcr: overrides.minimumIcr ?? baseIcr,
        minimumDscr: overrides.minimumDscr ?? baseDscr,
        minimumDebtYield: overrides.minimumDebtYield ?? baseDebtYield,
      });
      const constraintCandidates = [{ label: 'ICR', value: result.maxLoanByIcr }, { label: 'DSCR', value: result.maxLoanByDscr }, { label: 'Debt Yield', value: result.maxLoanByDebtYield }].filter(item => Number.isFinite(item.value));
      const constraint = constraintCandidates.length ? constraintCandidates.reduce((lowest, item) => item.value < lowest.value ? item : lowest).label : PENDING;
      const pass = result.icr >= (overrides.minimumIcr ?? baseIcr) && result.dscr >= (overrides.minimumDscr ?? baseDscr) && result.debtYield >= (overrides.minimumDebtYield ?? baseDebtYield);
      const marginal = pass && (result.icr - (overrides.minimumIcr ?? baseIcr) < 0.15 || result.dscr - (overrides.minimumDscr ?? baseDscr) < 0.1 || result.debtYield - (overrides.minimumDebtYield ?? baseDebtYield) < 0.005);
      return { label, result, constraint, status: pass ? marginal ? 'Marginal' : 'Pass' : 'Fail', noi: overrides.noi ?? baseNoi, loanAmount: overrides.loanAmount ?? baseLoan };
    };
    const scenarios = [
      run('Base Case', {}),
      run('Higher Rate Case', { assessmentRateOverridePct: coverage.assessmentRateUsedPct + rateShock }),
      run('Lower NOI Case', { noi: baseNoi * Math.max(0, 1 - noiReduction) }),
      run('Higher Debt Case', { loanAmount: baseLoan * (1 + debtIncrease) }),
      run('Conservative Lender Case', { minimumIcr: baseIcr + conservativeIcr, minimumDscr: baseDscr + conservativeDscr, minimumDebtYield: baseDebtYield + conservativeDebtYield }),
    ];
    if (ioComparisonEnabled) scenarios.splice(4, 0, run('Interest-Only Comparison', { repaymentType: 'interestOnly' }));
    return scenarios;
  }, [coverage, conservativeDebtYieldIncreasePct, conservativeDscrIncrease, conservativeIcrIncrease, debtIncreasePct, ioComparisonEnabled, noiReductionPct, parsedInputs, preliminaryLoanAmount, rateShockPct]);

  const saveCoverageScenarios = () => {
    if (!coverage || stressScenarios.length === 0) return;
    updateGlobal('icrDscrOutputs', { coverageScenarios: stressScenarios, coverageScenariosSavedAt: new Date().toISOString() });
    toast.success('Coverage stress scenarios saved for comparison and reporting.');
  };

  const linkedSourceCount = Object.values(fields).filter(value => !['Blank', 'Manual', 'User Override'].includes(value.source)).length;
  const manualValueCount = Object.values(fields).filter(value => value.source === 'Manual').length;
  const userOverrideCount = Object.values(fields).filter(value => value.source === 'User Override').length;
  const hasSaveableValue = [parsedInputs.noi, preliminaryLoanAmount, parsedInputs.rate, parsedInputs.term, parsedInputs.targetIcr, parsedInputs.targetDscr, parsedInputs.minDebtYieldPct].some(value => value != null && value > 0);
  const saveBackDisabled = !prefill || !hasSaveableValue || saving;
  const saveBackTooltip = !prefill
    ? 'Select or link a property before saving coverage assumptions.'
    : !hasSaveableValue
      ? 'Enter at least one valid coverage assumption before saving.'
      : undefined;
  const calculationVersion = 'icr-dscr-coverage-v1';
  const scenarioId = (profile as any).scenarioId ?? (profile as any).activeScenarioId ?? (profile as any).clientScenario?.scenarioId;
  const userId = (property as any)?.user_id ?? (profile as any).userId ?? undefined;

  const buildSavePayload = () => ({
    finalInputValues: parsedInputs,
    sourceStates: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.source])),
    originalSourceValues: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value: value.originalValue, source: value.originalSource, sourceDetail: value.sourceDetail }] as const).filter(([, value]) => value.value != null || value.source != null)),
    userOverrideValues: Object.fromEntries(Object.entries(fields).filter(([, value]) => value.source === 'User Override').map(([key, value]) => [key, value.value])),
    calculatedOutputs: coverage ? { ...coverage, lowestSupportableLoan, bindingConstraint } : activeCoverage,
    bindingConstraint,
    readinessStatus,
    timestamp: new Date().toISOString(),
    userId,
    calculationVersion,
    propertyId: prefill?.propertyId,
    scenarioId,
    overrideCount: userOverrideCount,
    linkedSourceCount,
    manualValueCount,
    downstreamRecalculation: {
      borrowingCapacityUnified: true,
      reportOverview: true,
      scenarioComparison: true,
      clientReport: true,
      syncReason: 'icrDscrCoverageAssumptionsSaved',
    },
  });

  const saveBackToProperty = async () => {
    if (!prefill || !hasSaveableValue) return;
    setSaving(true);
    try {
      const payload = buildSavePayload();
      const parsedLoan = parseNumeric(loan);
      const parsedRate = parseNumeric(rate);
      const parsedTerm = parseNumeric(term);
      const financingPatch: Record<string, unknown> = { property_id: prefill.propertyId, repayment_type: 'pi' };
      if (parsedLoan != null) {
        financingPatch.loan_amount = parsedLoan;
        financingPatch.loan_balance = parsedLoan;
      }
      if (parsedRate != null) financingPatch.interest_rate = parsedRate;
      if (parsedTerm != null) financingPatch.loan_term_years = parsedTerm;
      if (Object.keys(financingPatch).length > 2) {
        const api = prefill.domain === 'industrial' ? industrialApi : commercialApi;
        const existing = await api.listFinancing(prefill.propertyId);
        if (existing.error) throw new Error(existing.error.message);
        const current = existing.data?.[0];
        const saved = current ? await api.updateFinancing(current.id, financingPatch as any) : await api.createFinancing(financingPatch as any);
        if (saved.error) throw new Error(saved.error.message);
      }
      updateGlobal('icrDscrOutputs', { ...payload, savedAt: payload.timestamp, saveBackStatus: 'saved' });
      appendAiAudit({ action: 'ICR / DSCR assumptions saved to property profile', fieldKey: 'icrDscr.saveBack', previousValue: undefined, newValue: payload, source: 'ICR / DSCR', timestamp: payload.timestamp, user: userId ?? 'current-user', propertyId: prefill.propertyId, dealId: prefill.propertyId, scenarioId } as any);
      setSaveDialogOpen(false);
      toast.success('Coverage assumptions saved to property profile.');
    } catch (error) {
      toast.error(`Save back failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!coverage || lowestSupportableLoan == null) return;
    updateGlobal('icrDscrOutputs', {
      ...coverage,
      lowestSupportableLoan,
      bindingConstraint,
      sourceStates: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.source])),
      inputValues: parsedInputs,
      savedAt: new Date().toISOString(),
    });
  }, [coverage, lowestSupportableLoan, bindingConstraint, fields, parsedInputs, updateGlobal]);

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="space-y-4">
          <div>
            <CardTitle>ICR / DSCR</CardTitle>
            <CardDescription>Focused lender coverage and debt-serviceability testing for ICR, DSCR and debt yield.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-muted/30 to-background p-3 text-xs shadow-sm">
            <LinkedSourceBadge label={dataSourceLabel} />
            <LinkedSourceBadge label="Global Input Sync: On" />
            <StatusBadge status={assumptionStatus} />
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" variant="outline" onClick={() => setSaveDialogOpen(true)} disabled={saveBackDisabled}>{saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Save Back to Property</Button>
                </span>
              </TooltipTrigger>
              {saveBackTooltip && <TooltipContent><p>{saveBackTooltip}</p></TooltipContent>}
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <section className="order-1 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <Panel title="Debt assumptions" description="Editable loan, rate and principal-and-interest assumptions used for coverage testing." accent>
              <div className="grid gap-3 sm:grid-cols-2">
                <InputBlock label="Loan Amount" state={fields.loan} onChange={v => setManual('loan', v)} onKeepOverride={() => keepOverride('loan')} onUseSource={() => useSourceValue('loan')} placeholder="Pulled from borrowing profile or enter manually" />
                <InputBlock label="Proposed Loan Amount (optional)" state={fields.proposedLoan} onChange={v => setManual('proposedLoan', v)} onKeepOverride={() => keepOverride('proposedLoan')} onUseSource={() => useSourceValue('proposedLoan')} placeholder="Optional target loan amount" />
                <InputBlock label="Contract Rate %" state={fields.rate} onChange={v => setManual('rate', v)} onKeepOverride={() => keepOverride('rate')} onUseSource={() => useSourceValue('rate')} placeholder="Enter contract rate" step="0.05" />
                <InputBlock label="Term" state={fields.term} onChange={v => setManual('term', v)} onKeepOverride={() => keepOverride('term')} onUseSource={() => useSourceValue('term')} placeholder="Enter loan term" />
                <InputBlock label="Assessment Buffer %" state={fields.buffer} onChange={v => setManual('buffer', v)} onKeepOverride={() => keepOverride('buffer')} onUseSource={() => useSourceValue('buffer')} placeholder="Enter assessment buffer" step="0.05" />
                <InputBlock label="Floor Rate %" state={fields.floorRate} onChange={v => setManual('floorRate', v)} onKeepOverride={() => keepOverride('floorRate')} onUseSource={() => useSourceValue('floorRate')} placeholder="Enter floor rate" step="0.05" />
              </div>
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <Row label="Assessment Rate Used" value={activeCoverage && finiteValue(activeCoverage.assessmentRateUsedPct) != null ? `${activeCoverage.assessmentRateUsedPct.toFixed(2)}%` : PENDING} highlight />
                <Row label="Interest Cost p.a." value={activeCoverage && finiteValue(activeCoverage.annualInterest) != null ? fmt(activeCoverage.annualInterest) : PENDING} highlight />
                <Row label="Principal & Interest ADS" value={activeCoverage && finiteValue(activeCoverage.annualDebtService) != null ? fmt(activeCoverage.annualDebtService) : PENDING} />
                <Row label="Repayment assumption" value="Principal & Interest" />
              </div>
            </Panel>

            <Panel title="Income / NOI linkage" description="Linked NOI and borrowing-source controls remain available for upstream data review.">
              <div className="space-y-3">
                <InputBlock label="NOI p.a." state={fields.noi} onChange={v => setManual('noi', v)} onKeepOverride={() => keepOverride('noi')} onUseSource={() => useSourceValue('noi')} placeholder="Pulled from NOI tab or enter manually" />
                <div>
                  <Label>NOI source selector</Label>
                  <Select onValueChange={setNoiSourceBasis} defaultValue="selected">
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Use selected NOI basis" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="selected">NOI tab selected basis</SelectItem>
                      <SelectItem value="actual">Actual NOI</SelectItem>
                      <SelectItem value="stabilised">Stabilised NOI</SelectItem>
                      <SelectItem value="lenderAdjusted">Lender-adjusted NOI</SelectItem>
                      <SelectItem value="manual">Manual NOI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                <Row label="NOI source" value={sourceBadge(fields.noi.source)} />
                <Row label="Debt source" value={sourceBadge(fields.loan.source)} />
                <Row label="Linked source values" value={String(linkedSourceCount)} />
                <Row label="Manual / override values" value={`${manualValueCount} / ${userOverrideCount}`} />
              </div>
            </Panel>
          </section>

          <section className="order-2 grid gap-4 xl:grid-cols-3">
            <Panel title="Interest coverage" description="ICR output against lender minimum interest coverage.">
              <MetricCard label="ICR" value={activeCoverage && finiteValue(activeCoverage.icr) != null ? `${activeCoverage.icr}x` : PENDING} prominent status={icrStatus} />
              <ThresholdRow label="Minimum ICR" actual={activeCoverage && finiteValue(activeCoverage.icr) != null ? `${activeCoverage.icr}x` : PENDING} threshold={parsedInputs.targetIcr != null ? `${parsedInputs.targetIcr.toFixed(2)}x` : PENDING} status={icrStatus} />
              <Row label="Annual Interest" value={activeCoverage && finiteValue(activeCoverage.annualInterest) != null ? fmt(activeCoverage.annualInterest) : PENDING} />
              <Row label="ICR Headroom" value={coverage && finiteValue(coverage.icrHeadroom) != null ? `${coverage.icrHeadroom.toFixed(2)}x` : PENDING} />
            </Panel>

            <Panel title="Debt service coverage" description="DSCR output using the existing debt-service formula and term assumptions.">
              <MetricCard label="DSCR" value={activeCoverage && finiteValue(activeCoverage.dscr) != null ? `${activeCoverage.dscr}x` : PENDING} prominent status={dscrStatus} />
              <ThresholdRow label="Minimum DSCR" actual={activeCoverage && finiteValue(activeCoverage.dscr) != null ? `${activeCoverage.dscr}x` : PENDING} threshold={parsedInputs.targetDscr != null ? `${parsedInputs.targetDscr.toFixed(2)}x` : PENDING} status={dscrStatus} />
              <Row label="Annual Debt Service" value={activeCoverage && finiteValue(activeCoverage.annualDebtService) != null ? fmt(activeCoverage.annualDebtService) : PENDING} />
              <Row label="DSCR Headroom" value={coverage && finiteValue(coverage.dscrHeadroom) != null ? `${coverage.dscrHeadroom.toFixed(2)}x` : PENDING} />
            </Panel>

            <Panel title="Debt yield" description="Debt yield output relative to lender policy minimums.">
              <MetricCard label="Debt Yield" value={activeCoverage && finiteValue(activeCoverage.debtYield) != null ? `${(activeCoverage.debtYield * 100).toFixed(2)}%` : PENDING} prominent status={coverage ? debtYieldPass ? 'pass' : 'fail' : 'pending'} />
              <ThresholdRow label="Minimum Debt Yield" actual={activeCoverage && finiteValue(activeCoverage.debtYield) != null ? `${(activeCoverage.debtYield * 100).toFixed(2)}%` : PENDING} threshold={parsedInputs.minDebtYieldPct != null ? `${parsedInputs.minDebtYieldPct.toFixed(2)}%` : PENDING} status={coverage ? debtYieldPass ? 'pass' : 'fail' : 'pending'} />
              <Row label="Loan Amount" value={preliminaryLoanAmount != null ? fmt(preliminaryLoanAmount) : PENDING} />
              <Row label="Debt Yield Headroom" value={coverage && finiteValue(coverage.debtYieldHeadroom) != null ? `${(coverage.debtYieldHeadroom * 100).toFixed(2)}%` : PENDING} />
            </Panel>
          </section>

          <section className="order-3 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel title="Coverage thresholds" description="Editable lender policy thresholds that drive the existing pass/fail logic.">
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <InputBlock label="Minimum ICR" state={fields.targetIcr} onChange={v => setManual('targetIcr', v)} onKeepOverride={() => keepOverride('targetIcr')} onUseSource={() => useSourceValue('targetIcr')} placeholder="Enter lender ICR threshold" step="0.05" />
                <InputBlock label="Minimum DSCR" state={fields.targetDscr} onChange={v => setManual('targetDscr', v)} onKeepOverride={() => keepOverride('targetDscr')} onUseSource={() => useSourceValue('targetDscr')} placeholder="Enter lender DSCR threshold" step="0.05" />
                <InputBlock label="Minimum Debt Yield %" state={fields.minDebtYield} onChange={v => setManual('minDebtYield', v)} onKeepOverride={() => keepOverride('minDebtYield')} onUseSource={() => useSourceValue('minDebtYield')} placeholder="Enter minimum debt yield" step="0.1" />
              </div>
            </Panel>

            <div className="rounded-2xl border border-primary/20 bg-muted/25 p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-base font-semibold">Threshold comparison</h3>
                  <p className="text-sm text-muted-foreground">Pass, fail and pending states shown separately for each lender coverage test.</p>
                </div>
                <StatusBadge status={coverageStatus} />
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <ThresholdRow label="ICR" actual={activeCoverage && finiteValue(activeCoverage.icr) != null ? `${activeCoverage.icr}x` : PENDING} threshold={parsedInputs.targetIcr != null ? `${parsedInputs.targetIcr.toFixed(2)}x` : PENDING} status={icrStatus} />
                <ThresholdRow label="DSCR" actual={activeCoverage && finiteValue(activeCoverage.dscr) != null ? `${activeCoverage.dscr}x` : PENDING} threshold={parsedInputs.targetDscr != null ? `${parsedInputs.targetDscr.toFixed(2)}x` : PENDING} status={dscrStatus} />
                <ThresholdRow label="Debt Yield" actual={activeCoverage && finiteValue(activeCoverage.debtYield) != null ? `${(activeCoverage.debtYield * 100).toFixed(2)}%` : PENDING} threshold={parsedInputs.minDebtYieldPct != null ? `${parsedInputs.minDebtYieldPct.toFixed(2)}%` : PENDING} status={coverage ? debtYieldPass ? 'pass' : 'fail' : 'pending'} />
              </div>
            </div>
          </section>

          <section className="order-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-sm">
              <h3 className="text-base font-semibold">Maximum Loan Summary</h3>
              <p className="text-sm text-muted-foreground">Compare the maximum supportable loan under ICR, DSCR and debt-yield constraints.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <MetricCard label="Max Loan @ ICR" value={coverage && finiteValue(coverage.maxLoanByIcr) != null ? fmt(coverage.maxLoanByIcr) : PENDING} />
                <MetricCard label="Max Loan @ DSCR" value={coverage && finiteValue(coverage.maxLoanByDscr) != null ? fmt(coverage.maxLoanByDscr) : PENDING} />
                <MetricCard label="Max Loan @ Debt Yield" value={coverage && finiteValue(coverage.maxLoanByDebtYield) != null ? fmt(coverage.maxLoanByDebtYield) : PENDING} />
                <div className="rounded-lg border border-primary/30 bg-background/70 p-3 sm:col-span-2 xl:col-span-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Lowest Supportable Loan</div>
                  <div className="mt-1 text-2xl font-bold text-primary">{lowestSupportableLoan != null ? fmt(lowestSupportableLoan) : PENDING}</div>
                </div>
                <div className="rounded-lg border border-primary/30 bg-background/70 p-3 sm:col-span-2 xl:col-span-1">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Binding Constraint</div>
                  <div className="mt-1 text-2xl font-bold text-primary">{bindingConstraint}</div>
                </div>
              </div>
            </div>
          </section>

          <section className="order-5 rounded-2xl border border-primary/25 bg-background/60 p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-base font-semibold">Recommended Next Action</h3>
                <p className="text-sm text-muted-foreground">Review the binding constraint and suggested next steps to improve supportability.</p>
                <p className="mt-3 text-sm text-foreground">{recommendedAction}</p>
                <p className="mt-2 text-sm text-muted-foreground">{resultSummary}</p>
                <p className="mt-2 text-sm text-foreground">{bindingExplanation}</p>
                {resultIssueNotes.length > 0 && <div className="mt-3 space-y-1 text-sm text-muted-foreground">{resultIssueNotes.map(note => <p key={note}>{note}</p>)}</div>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => navigateToCalculatorTab('noi')}>Open NOI tab</Button>
                <Button size="sm" variant="outline" onClick={() => navigateToCalculatorTab('borrowing')}>Open Borrowing Capacity</Button>
                <Button size="sm" variant="outline" onClick={() => navigateToCalculatorTab('borrowing')}>Compare lender scenario</Button>
                <Button size="sm" variant="outline" onClick={() => setAdvancedOpen(true)}>View formula breakdown</Button>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-sm font-medium">Fix-the-deal guidance</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{fixSuggestions.map(suggestion => <div key={suggestion} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">{suggestion}</div>)}</div>
            </div>
          </section>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <div className="order-4 rounded-xl border border-border/60 bg-muted/20 shadow-sm">
              <CollapsibleTrigger asChild><Button variant="ghost" className="flex w-full justify-between p-4 text-left"><span>View formula and policy breakdown</span><ChevronDown className="h-4 w-4" /></Button></CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 border-t border-border/60 p-4 text-sm">
                <div><h4 className="font-semibold">Formula breakdown</h4><p className="text-muted-foreground">Assessment Rate = max(Contract Rate + Buffer, Floor Rate). Annual Interest = Loan Amount × Assessment Rate. ICR = NOI / Annual Interest. DSCR = NOI / Annual Debt Service. Debt Yield = NOI / Loan Amount.</p></div>
                <div><h4 className="font-semibold">Lender benchmark notes</h4><p className="text-muted-foreground">Typical commercial lender guideposts are ICR ≥ 1.50x, DSCR ≥ 1.25x–1.35x and debt yield per lender policy.</p></div>
                <div><h4 className="font-semibold">Full assumption list</h4><div className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(fields).map(([key, state]) => <Row key={key} label={key} value={`${state.value || PENDING} · ${sourceBadge(state.source)}`} />)}</div></div>
                <div><h4 className="font-semibold">Assumption Status &gt; Coverage Warning Log</h4>{coverageWarnings.length ? <ul className="list-disc pl-5 text-muted-foreground">{coverageWarnings.map((warning, index) => <li key={`${warning.category}-${index}`}><span className="font-medium text-foreground">{warning.severity} · {warning.category}:</span> {warning.message}</li>)}</ul> : <p className="text-muted-foreground">No coverage warnings for the current input state.</p>}</div>
                <div><h4 className="font-semibold">Audit history</h4>{auditHistory.length ? <ul className="space-y-1 text-muted-foreground">{auditHistory.map((event, index) => <li key={`${event.timestamp}-${index}`}>{event.timestamp}: {event.action} ({event.fieldKey})</li>)}</ul> : <p className="text-muted-foreground">No ICR / DSCR audit entries this session.</p>}</div>
                <div><h4 className="font-semibold">Coverage stress tests</h4>{stressRows.length ? <div className="mt-2 space-y-2">{stressRows.map(row => <Row key={row.label} label={row.label} value={`ICR ${row.icr}x · DSCR ${row.dscr}x · ADS ${fmt(row.annualDebtService)}`} />)}</div> : <p className="text-muted-foreground">Stress tests appear once coverage inputs are complete.</p>}</div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          <Collapsible open={stressOpen} onOpenChange={setStressOpen}>
            <div className="order-5 rounded-xl border border-border/60 bg-muted/20 shadow-sm">
              <CollapsibleTrigger asChild><Button variant="ghost" className="flex w-full justify-between p-4 text-left"><span>Coverage Stress Tests</span><ChevronDown className="h-4 w-4" /></Button></CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 border-t border-border/60 p-4">
                <p className="text-sm text-muted-foreground">Coverage-only stress tests. These do not overwrite base assumptions and are not saved unless you use Save as Coverage Scenario.</p>
                <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
                  <StressInput label="Rate increase %" value={rateShockPct} onChange={setRateShockPct} />
                  <StressInput label="NOI reduction %" value={noiReductionPct} onChange={setNoiReductionPct} />
                  <StressInput label="Debt increase %" value={debtIncreasePct} onChange={setDebtIncreasePct} />
                  <StressInput label="ICR uplift" value={conservativeIcrIncrease} onChange={setConservativeIcrIncrease} />
                  <StressInput label="DSCR uplift" value={conservativeDscrIncrease} onChange={setConservativeDscrIncrease} />
                  <StressInput label="Debt yield uplift %" value={conservativeDebtYieldIncreasePct} onChange={setConservativeDebtYieldIncreasePct} />
                </div>
                {!coverage ? <p className="rounded-md border border-brand-500/30 bg-brand-500/10 p-3 text-sm text-brand-100">Stress test results appear once the base coverage calculation is ready.</p> : <div className="grid gap-3 xl:grid-cols-2">{stressScenarios.map(scenario => <StressScenarioCard key={scenario.label} scenario={scenario} />)}</div>}
                <Button size="sm" variant="outline" onClick={saveCoverageScenarios} disabled={!coverage || stressScenarios.length === 0}>Save as Coverage Scenario</Button>
              </CollapsibleContent>
            </div>
          </Collapsible>

          <section className="order-6 rounded-xl border border-border/60 bg-background/40 p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-semibold">Warnings and commentary</h3>
                <p className="text-sm text-muted-foreground">Plain-English lending warnings and assumption commentary appear here once coverage data has been entered or imported.</p>
              </div>
              {coverageWarnings.length > 3 && <Button variant="link" className="h-auto p-0 text-primary underline" onClick={() => setAdvancedOpen(true)}>View all assumptions and warnings</Button>}
            </div>
            {priorityWarnings.length > 0 ? <ul className="mt-3 space-y-2 text-sm text-brand-100">{priorityWarnings.map(warning => <li key={`${warning.category}-${warning.message}`} className="rounded-md border border-brand-500/30 bg-brand-500/10 px-3 py-2"><span className="font-medium">{warning.category}:</span> {warning.message}</li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No warnings to show for the current input state.</p>}
          </section>
        </CardContent>
      </Card>
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Save these ICR / DSCR assumptions back to the property profile?</DialogTitle>
            <DialogDescription>
              This saves coverage assumptions and outputs to the linked property profile and scenario sync state without overwriting unrelated calculator data.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-x-6 gap-y-2 overflow-y-auto text-sm sm:grid-cols-2">
            <Row label="NOI" value={parsedInputs.noi != null ? fmt(parsedInputs.noi) : PENDING} />
            <Row label="NOI source" value={sourceBadge(fields.noi.source)} />
            <Row label="Loan amount" value={preliminaryLoanAmount != null ? fmt(preliminaryLoanAmount) : PENDING} />
            <Row label="Assessment rate used" value={activeCoverage && finiteValue(activeCoverage.assessmentRateUsedPct) != null ? `${activeCoverage.assessmentRateUsedPct.toFixed(2)}%` : PENDING} />
            <Row label="Contract rate" value={parsedInputs.rate != null ? `${parsedInputs.rate.toFixed(2)}%` : PENDING} />
            <Row label="Assessment buffer" value={parsedInputs.buffer != null ? `${parsedInputs.buffer.toFixed(2)}%` : PENDING} />
            <Row label="Floor rate" value={parsedInputs.floorRate != null ? `${parsedInputs.floorRate.toFixed(2)}%` : PENDING} />
            <Row label="Term" value={parsedInputs.term != null ? `${parsedInputs.term} years` : PENDING} />
            <Row label="Minimum ICR" value={parsedInputs.targetIcr != null ? `${parsedInputs.targetIcr.toFixed(2)}x` : PENDING} />
            <Row label="Minimum DSCR" value={parsedInputs.targetDscr != null ? `${parsedInputs.targetDscr.toFixed(2)}x` : PENDING} />
            <Row label="Minimum debt yield" value={parsedInputs.minDebtYieldPct != null ? `${parsedInputs.minDebtYieldPct.toFixed(2)}%` : PENDING} />
            <Row label="ICR" value={activeCoverage && finiteValue(activeCoverage.icr) != null ? `${activeCoverage.icr}x` : PENDING} />
            <Row label="DSCR" value={activeCoverage && finiteValue(activeCoverage.dscr) != null ? `${activeCoverage.dscr}x` : PENDING} />
            <Row label="Debt yield" value={activeCoverage && finiteValue(activeCoverage.debtYield) != null ? `${(activeCoverage.debtYield * 100).toFixed(2)}%` : PENDING} />
            <Row label="Max Loan @ ICR" value={coverage && finiteValue(coverage.maxLoanByIcr) != null ? fmt(coverage.maxLoanByIcr) : PENDING} />
            <Row label="Max Loan @ DSCR" value={coverage && finiteValue(coverage.maxLoanByDscr) != null ? fmt(coverage.maxLoanByDscr) : PENDING} />
            <Row label="Max Loan @ Debt Yield" value={coverage && finiteValue(coverage.maxLoanByDebtYield) != null ? fmt(coverage.maxLoanByDebtYield) : PENDING} />
            <Row label="Lowest Supportable Loan" value={lowestSupportableLoan != null ? fmt(lowestSupportableLoan) : PENDING} />
            <Row label="Binding Constraint" value={bindingConstraint} />
            <Row label="User overrides" value={String(userOverrideCount)} />
            <Row label="Linked source values" value={String(linkedSourceCount)} />
            <Row label="Manual values" value={String(manualValueCount)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveBackToProperty} disabled={saving || !prefill || !hasSaveableValue}>{saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}Confirm Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

function InputBlock({ label, state, onChange, onKeepOverride, onUseSource, placeholder, step }: { label: string; state: FieldState; onChange: (value: string) => void; onKeepOverride: () => void; onUseSource: () => void; placeholder: string; step?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2"><Label>{label}</Label><Tooltip><TooltipTrigger asChild><Badge variant="outline" className="cursor-help gap-1 text-[10px]"><Info className="h-3 w-3" />{sourceBadge(state.source)}</Badge></TooltipTrigger><TooltipContent><p>{state.sourceDetail || `Source: ${state.source}`}</p></TooltipContent></Tooltip></div>
      <Input type="text" inputMode="decimal" step={step} value={state.value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      {state.sourceDetail && <p className="mt-1 text-[11px] text-muted-foreground">{state.sourceDetail}</p>}
      {state.pendingSource && <div className="mt-1 rounded border border-brand-500/30 bg-brand-500/10 p-2 text-xs text-brand-200"><div>New source value available. This field currently uses a saved override.</div><div className="mt-1 flex gap-2"><Button size="sm" variant="outline" onClick={onKeepOverride}>Keep override</Button><Button size="sm" variant="outline" onClick={onUseSource}>Use source value</Button></div></div>}
    </div>
  );
}

function StressInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div><Label className="text-xs text-muted-foreground">{label}</Label><Input type="text" inputMode="decimal" value={value} onChange={event => onChange(event.target.value)} /></div>;
}

function StressScenarioCard({ scenario }: { scenario: { label: string; result: ReturnType<typeof calculateIcrDscrEngine>; constraint: string; status: string; noi: number; loanAmount: number } }) {
  const statusClass = scenario.status === 'Pass' ? 'text-success' : scenario.status === 'Marginal' ? 'text-brand-300' : 'text-destructive';
  return <div className="rounded-lg border border-border/60 bg-background/50 p-3 text-sm"><div className="mb-2 flex items-center justify-between gap-2"><div className="font-semibold">{scenario.label}</div><Badge variant={scenario.status === 'Pass' ? 'default' : scenario.status === 'Marginal' ? 'outline' : 'destructive'}>{scenario.status}</Badge></div><div className="grid gap-x-4 gap-y-1 sm:grid-cols-2"><Row label="Assessment Rate" value={`${scenario.result.assessmentRateUsedPct.toFixed(2)}%`} /><Row label="NOI" value={fmt(scenario.noi)} /><Row label="Loan Amount" value={fmt(scenario.loanAmount)} /><Row label="Annual Interest" value={fmt(scenario.result.annualInterest)} /><Row label="Annual Debt Service" value={fmt(scenario.result.annualDebtService)} /><Row label="ICR" value={`${scenario.result.icr}x`} /><Row label="DSCR" value={`${scenario.result.dscr}x`} /><Row label="Debt Yield" value={`${(scenario.result.debtYield * 100).toFixed(2)}%`} /><Row label="Binding Constraint" value={scenario.constraint} /><div className={`flex justify-between ${statusClass}`}><span>Status</span><span>{scenario.status}</span></div></div></div>;
}

function Panel({ title, description, accent, children }: { title: string; description: string; accent?: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${accent ? 'border-primary/25 bg-primary/5' : 'border-border/60 bg-background/50'}`}>
      <div className="mb-4">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isPass = ['Coverage Supportable', 'Coverage Verified', 'Pass', 'pass'].includes(status);
  const isFail = ['Not Supportable', 'Fail', 'fail'].includes(status);
  const isPending = ['Awaiting Coverage Inputs', 'Preliminary Coverage Estimate', 'pending', PENDING].includes(status);
  const displayStatus = status === 'pass' ? 'Pass' : status === 'fail' ? 'Fail' : status === 'pending' ? PENDING : status;
  const className = isPass
    ? 'border-success/40 bg-success/15 text-success'
    : isFail
      ? 'border-destructive/40 bg-destructive/15 text-destructive'
      : isPending
        ? 'border-info/40 bg-info/15 text-info'
        : 'border-brand-500/40 bg-brand-500/15 text-brand-200';
  return <Badge variant="outline" className={`${className} rounded-full px-2.5 py-1 font-semibold`}>{isPass ? 'Pass' : isFail ? 'Fail' : isPending ? 'Pending' : 'Review'} · {displayStatus}</Badge>;
}

function LinkedSourceBadge({ label }: { label: string }) {
  return <Badge variant="outline" className="rounded-full border-primary/40 bg-background/70 px-2.5 py-1 text-primary shadow-sm">{label}</Badge>;
}

function MetricCard({ label, value, prominent, status }: { label: string; value: string; prominent?: boolean; status?: 'pass' | 'fail' | 'pending' }) {
  const statusClass = status === 'pass'
    ? 'border-success/35 bg-success/10'
    : status === 'fail'
      ? 'border-destructive/35 bg-destructive/10'
      : status === 'pending'
        ? 'border-info/35 bg-info/10'
        : 'border-primary/20 bg-background/60';
  return <div className={`rounded-xl border p-4 ${statusClass} ${prominent ? 'shadow-md' : ''}`}><div className="flex items-center justify-between gap-2"><div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>{status && <StatusBadge status={status} />}</div><div className="mt-2 text-3xl font-bold text-primary sm:text-4xl">{value}</div></div>;
}

function ThresholdRow({ label, actual, threshold, status }: { label: string; actual: string; threshold: string; status: 'pass' | 'fail' | 'pending' }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/70 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold">{label}</span>
        <StatusBadge status={status} />
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
        <div className="rounded-lg bg-muted/30 p-2"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Actual</div><div className="text-lg font-bold text-primary">{actual}</div></div>
        <div className="rounded-lg bg-muted/30 p-2"><div className="text-[11px] uppercase tracking-wide text-muted-foreground">Threshold</div><div className="text-lg font-semibold">{threshold}</div></div>
      </div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return <div className={`flex justify-between items-center ${highlight ? 'text-lg font-bold text-primary' : ''}`}><span>{label}</span><span>{value}</span></div>;
}
