import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Calculator, Info, Percent, DollarSign, TrendingUp, ChevronDown, ChevronRight, Home, Banknote, Building, MapPin, Check, Download } from 'lucide-react';
import { formatNumberWithCommas, removeCommas } from '@/hooks/useFormattedNumber';
import { MortgageRepaymentCalculator } from '../MortgageRepaymentCalculator';
import { useToast } from '@/hooks/use-toast';
import { LoanType, RepaymentFrequency } from '@/utils/mortgageCalculations';
import { BuildType } from '@/types/overrideFields';
import { StampDutyCalculatorPanel } from '../StampDutyCalculatorPanel';
import {
  defaultDutiableValue,
  defaultPropertyCategory,
  dutiableValueBases,
} from '../dutiableValueBasis';
import {
  AUSTRALIAN_STATES,
  type AustralianState,
  type PropertyCategory,
  type PurchaseIntent,
} from '@/utils/stampDutyCalculator';

export type StampDutyPropertyType = 'primary_residence' | 'investment';
export type StampDutyPurchaseType = 'established_home' | 'new_home' | 'vacant_land';

/** What the Estimate CGR button answered, as the Financials tab shows it. */
export interface CgrEstimateReading {
  ratePct: number;
  horizonYears: number;
  areaName: string;
  level: string;
  latestPeriod: string | null;
  /** The latest period in the publisher's own words. */
  latestPeriodLabel: string | null;
  /** When the register last took the series from its source. */
  loadedAt: string | null;
  basis: string;
  caveats: string[];
  alternatives: Array<{ areaName: string; horizonYears: number; ratePct: number }>;
}

/** `2026-09-16T00:43:00Z` → `16 September 2026`, in the locale the rest of the product uses. */
function refreshedOn(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface FinancialsTabProps {
  buildType: BuildType;
  purchasePrice: string;
  depositValue: string;
  setDepositValue: (value: string) => void;
  loanToValueRatio: string;
  setLoanToValueRatio: (value: string) => void;
  interestRate: string;
  setInterestRate: (value: string) => void;
  loanTermYears: string;
  setLoanTermYears: (value: string) => void;
  loanType: 'interest_only' | 'principal_interest';
  setLoanType: (value: 'interest_only' | 'principal_interest') => void;
  capitalGrowth: string;
  setCapitalGrowth: (value: string) => void;
  stampDuty: string;
  setStampDuty: (value: string) => void;
  solicitorFees: string;
  setSolicitorFees: (value: string) => void;
  agentFee: string;
  setAgentFee: (value: string) => void;
  isFirstHomeBuyer: boolean;
  setIsFirstHomeBuyer: (value: boolean) => void;
  detectedState: string;
  propertyAddress: string;
  /**
   * Land component of a house-and-land package, when the report has one. Duty
   * on a new build is assessed on the land transfer, so this — not the package
   * price — is what the stamp duty calculator defaults to.
   */
  landPrice?: string;
  disabled?: boolean;
  stampDutyPropertyType?: StampDutyPropertyType;
  setStampDutyPropertyType?: (value: StampDutyPropertyType) => void;
  stampDutyPurchaseType?: StampDutyPurchaseType;
  setStampDutyPurchaseType?: (value: StampDutyPurchaseType) => void;
  loanAmount?: string;
  setLoanAmount?: (value: string) => void;
  interestOnlyPeriodYears?: string;
  setInterestOnlyPeriodYears?: (value: string) => void;
  repaymentFrequency?: 'weekly' | 'fortnightly' | 'monthly';
  setRepaymentFrequency?: (value: 'weekly' | 'fortnightly' | 'monthly') => void;
  extraRepaymentPerMonth?: string;
  setExtraRepaymentPerMonth?: (value: string) => void;
  offsetBalance?: string;
  setOffsetBalance?: (value: string) => void;
  /** Locality-derived growth estimate for smart default */
  localityGrowthEstimate?: { capitalGrowthPercent: number; source: string } | null;
  /** Estimate CGR: reads the open sales register for the typed address and fills Growth. */
  onEstimateCgr?: () => void;
  isEstimatingCgr?: boolean;
  /** The last estimate the register answered for this address, for the line under the field. */
  cgrEstimate?: CgrEstimateReading | null;
}

export function FinancialsTab({
  buildType,
  purchasePrice,
  depositValue,
  setDepositValue,
  loanToValueRatio,
  setLoanToValueRatio,
  interestRate,
  setInterestRate,
  loanTermYears,
  setLoanTermYears,
  loanType,
  setLoanType,
  capitalGrowth,
  setCapitalGrowth,
  stampDuty,
  setStampDuty,
  solicitorFees,
  setSolicitorFees,
  agentFee,
  setAgentFee,
  isFirstHomeBuyer,
  setIsFirstHomeBuyer,
  detectedState,
  propertyAddress,
  landPrice,
  disabled = false,
  stampDutyPropertyType: propStampDutyPropertyType,
  setStampDutyPropertyType: propSetStampDutyPropertyType,
  stampDutyPurchaseType: propStampDutyPurchaseType,
  setStampDutyPurchaseType: propSetStampDutyPurchaseType,
  loanAmount: propLoanAmount,
  setLoanAmount: propSetLoanAmount,
  interestOnlyPeriodYears: propInterestOnlyPeriodYears,
  setInterestOnlyPeriodYears: propSetInterestOnlyPeriodYears,
  repaymentFrequency: propRepaymentFrequency,
  setRepaymentFrequency: propSetRepaymentFrequency,
  extraRepaymentPerMonth: propExtraRepaymentPerMonth,
  setExtraRepaymentPerMonth: propSetExtraRepaymentPerMonth,
  offsetBalance: propOffsetBalance,
  setOffsetBalance: propSetOffsetBalance,
  localityGrowthEstimate,
  onEstimateCgr,
  isEstimatingCgr = false,
  cgrEstimate = null,
}: FinancialsTabProps) {
  const [showStampDutyModal, setShowStampDutyModal] = useState(false);
  const [showMortgageCalculator, setShowMortgageCalculator] = useState(false);
  const [localStampDutyPropertyType, setLocalStampDutyPropertyType] = useState<StampDutyPropertyType>('investment');
  /**
   * Defaulted to match whatever the dutiable value defaults to, so the calculator
   * does not open in a state that contradicts itself. Land-basis assessments are
   * vacant land transfers, and vacant land carries different first-home
   * thresholds from a home — opening on "established home" with a land price in
   * the box would quietly test the wrong ones.
   */
  const [localStampDutyPurchaseType, setLocalStampDutyPurchaseType] = useState<StampDutyPurchaseType>(() => {
    const category = defaultPropertyCategory({
      buildType,
      purchasePrice: parseFloat(purchasePrice) || 0,
      landPrice: parseFloat(landPrice ?? '') || 0,
    });
    return category === 'vacant_land' ? 'vacant_land' : category === 'new' ? 'new_home' : 'established_home';
  });
  const [isForeignBuyer, setIsForeignBuyer] = useState(false);
  const [stampDutyStateOverride, setStampDutyStateOverride] = useState<AustralianState | null>(null);
  const [dutiableValueOverride, setDutiableValueOverride] = useState<number | null>(null);
  const isNewBuild = buildType === 'new_build';
  const { toast } = useToast();

  const stampDutyPropertyType = propStampDutyPropertyType ?? localStampDutyPropertyType;
  const setStampDutyPropertyType = propSetStampDutyPropertyType ?? setLocalStampDutyPropertyType;
  const stampDutyPurchaseType = propStampDutyPurchaseType ?? localStampDutyPurchaseType;
  const setStampDutyPurchaseType = propSetStampDutyPurchaseType ?? setLocalStampDutyPurchaseType;

  // The tab's own vocabulary predates the calculator and is still what the
  // parent report state speaks, so translate at the boundary rather than
  // renaming props across every caller.
  const stampDutyIntent: PurchaseIntent =
    stampDutyPropertyType === 'primary_residence' ? 'owner_occupier' : 'investor';
  const stampDutyCategory: PropertyCategory =
    stampDutyPurchaseType === 'new_home' ? 'new'
      : stampDutyPurchaseType === 'vacant_land' ? 'vacant_land'
        : 'established';

  const handleIntentChange = useCallback((intent: PurchaseIntent) => {
    setStampDutyPropertyType(intent === 'owner_occupier' ? 'primary_residence' : 'investment');
  }, [setStampDutyPropertyType]);

  const handleCategoryChange = useCallback((category: PropertyCategory) => {
    setStampDutyPurchaseType(
      category === 'new' ? 'new_home' : category === 'vacant_land' ? 'vacant_land' : 'established_home',
    );
  }, [setStampDutyPurchaseType]);

  /**
   * The jurisdiction detected from the property address, unless the user has
   * picked a different one. `detectedState` is a free-form string and can be
   * 'All' or empty, so it is narrowed here rather than trusted.
   */
  const stampDutyState: AustralianState = useMemo(() => {
    if (stampDutyStateOverride) return stampDutyStateOverride;
    const candidate = (detectedState || '').toUpperCase();
    return (AUSTRALIAN_STATES as readonly string[]).includes(candidate)
      ? (candidate as AustralianState)
      : 'NSW';
  }, [stampDutyStateOverride, detectedState]);

  const handleCurrencyChange = useCallback((setter: (value: string) => void) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = removeCommas(e.target.value);
      if (rawValue === '' || rawValue === '-' || /^-?\d*\.?\d*$/.test(rawValue)) {
        setter(rawValue);
      }
    };
  }, []);

  const formatForDisplay = useCallback((value: string) => {
    return formatNumberWithCommas(value);
  }, []);

  const price = parseFloat(purchasePrice) || 0;
  const land = parseFloat(landPrice ?? '') || 0;

  /**
   * What duty is assessed on. A new build defaults to the land price because
   * duty on a house-and-land package falls on the land contract — see
   * `dutiableValueBasis.ts`. `dutiableValueOverride` holds an explicit edit and
   * wins from then on, so a re-render or a purchase-price change does not throw
   * away what was typed.
   */
  const dutiableInputs = useMemo(
    () => ({ buildType, purchasePrice: price, landPrice: land }),
    [buildType, price, land],
  );
  const dutiableValue = dutiableValueOverride ?? defaultDutiableValue(dutiableInputs);
  const stampDutyBases = useMemo(() => dutiableValueBases(dutiableInputs), [dutiableInputs]);

  const lvr = parseFloat(loanToValueRatio) || 80;
  const loanAmount = Math.round(price * (lvr / 100));
  const rate = parseFloat(interestRate) || 6.5;
  const monthlyInterest = Math.round((loanAmount * (rate / 100)) / 12);

  // The calculator assesses duty in-process, so applying its figure is a single
  // step. It used to be two — the value had to be scraped out of a third-party
  // iframe before it could be used, and the scrape could silently fail.
  const handleUseValue = useCallback((totalDuty: number) => {
    const value = Math.round(totalDuty).toString();
    setStampDuty(value);
    toast({
      title: 'Stamp duty applied',
      description: `$${formatNumberWithCommas(value)} has been applied to your analysis.`,
    });
    setShowStampDutyModal(false);
  }, [setStampDuty, toast]);

  const totalAcquisitionCosts = 
    (parseFloat(stampDuty) || 0) +
    (parseFloat(solicitorFees) || 0) +
    (!isNewBuild && agentFee ? parseFloat(agentFee) : 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Loan Structure Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Percent className="h-5 w-5 text-primary" />
              Deposit & Loan
            </h3>
            {price > 0 && (
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Loan Amount</p>
                <p className="text-lg font-bold text-primary">${loanAmount.toLocaleString('en-AU')}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="space-y-2">
              <Label htmlFor="depositValue" className="text-sm font-medium flex items-center gap-1">
                Deposit
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Auto-calculated from Purchase Price × (100% - LVR)</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="depositValue"
                  type="text"
                  inputMode="numeric"
                  value={formatForDisplay(depositValue)}
                  onChange={handleCurrencyChange(setDepositValue)}
                  placeholder="Auto-calculated"
                  disabled={disabled}
                  className="pl-7 bg-muted/30"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="loanToValueRatio" className="text-sm font-medium">LVR</Label>
              <div className="relative">
                <Input
                  id="loanToValueRatio"
                  type="number"
                  value={loanToValueRatio}
                  onChange={(e) => setLoanToValueRatio(e.target.value)}
                  placeholder="80"
                  disabled={disabled}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="space-y-2">
              <Label htmlFor="interestRate" className="text-sm font-medium">Interest Rate</Label>
              <div className="relative">
                <Input
                  id="interestRate"
                  type="number"
                  step="0.01"
                  value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)}
                  placeholder="6.5"
                  disabled={disabled}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="loanTermYears" className="text-sm font-medium">Loan Term</Label>
              <div className="relative">
                <Input
                  id="loanTermYears"
                  type="number"
                  value={loanTermYears}
                  onChange={(e) => setLoanTermYears(e.target.value)}
                  placeholder="30"
                  disabled={disabled}
                  className="pr-12"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">yrs</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="capitalGrowth" className="text-sm font-medium flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  Growth
                </Label>
                {onEstimateCgr && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={onEstimateCgr}
                    disabled={disabled || isEstimatingCgr || !propertyAddress}
                    title={propertyAddress ? 'Estimate the capital growth rate from the open sales register for this address' : 'Enter the property address first'}
                    aria-label="Estimate capital growth rate from the open sales register"
                  >
                    {isEstimatingCgr ? 'Estimating…' : 'Estimate CGR'}
                  </Button>
                )}
              </div>
              <div className="relative">
                <Input
                  id="capitalGrowth"
                  type="number"
                  step="0.1"
                  value={capitalGrowth}
                  onChange={(e) => setCapitalGrowth(e.target.value)}
                  placeholder={localityGrowthEstimate ? localityGrowthEstimate.capitalGrowthPercent.toString() : "5"}
                  disabled={disabled}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
              </div>
              {isNewBuild && localityGrowthEstimate && !capitalGrowth && !cgrEstimate && (
                <button 
                  type="button"
                  onClick={() => setCapitalGrowth(localityGrowthEstimate.capitalGrowthPercent.toString())}
                  className="text-xs text-primary hover:underline cursor-pointer"
                  disabled={disabled}
                >
                  Auto-fill {localityGrowthEstimate.capitalGrowthPercent}% ({localityGrowthEstimate.source})
                </button>
              )}
              {cgrEstimate && (
                <div className="text-xs text-muted-foreground space-y-1" data-testid="cgr-estimate-reading">
                  <p>
                    <span className="font-medium text-foreground">{cgrEstimate.ratePct}% a year</span>
                    {' '}— {cgrEstimate.horizonYears}-year compound growth, {cgrEstimate.areaName}
                    {cgrEstimate.latestPeriodLabel ?? cgrEstimate.latestPeriod ? ` (to ${cgrEstimate.latestPeriodLabel ?? cgrEstimate.latestPeriod})` : ''}
                  </p>
                  <p className="leading-snug">{cgrEstimate.basis}</p>
                  {(cgrEstimate.latestPeriodLabel ?? cgrEstimate.latestPeriod) && (
                    <p className="leading-snug" data-testid="cgr-estimate-currency">
                      Series to {cgrEstimate.latestPeriodLabel ?? cgrEstimate.latestPeriod}
                      {refreshedOn(cgrEstimate.loadedAt) ? `; register refreshed ${refreshedOn(cgrEstimate.loadedAt)}` : ''}
                      {' '}— the newest figures the publisher had released when the register was last refreshed.
                    </p>
                  )}
                  {cgrEstimate.caveats.map((c) => (
                    <p key={c} className="leading-snug">{c}</p>
                  ))}
                  {cgrEstimate.alternatives.length > 0 && (
                    <p className="leading-snug">
                      Also measured: {cgrEstimate.alternatives.map((a) => `${a.areaName} ${a.ratePct}% (${a.horizonYears}-year)`).join('; ')}.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Loan Type</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={loanType === 'interest_only' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLoanType('interest_only')}
                disabled={disabled}
                className="flex-1"
              >
                Interest Only
              </Button>
              <Button
                type="button"
                variant={loanType === 'principal_interest' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLoanType('principal_interest')}
                disabled={disabled}
                className="flex-1"
              >
                Principal & Interest
              </Button>
            </div>
          </div>

          {loanAmount > 0 && (
            <div className="mt-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Est. Monthly {loanType === 'interest_only' ? 'Interest' : 'Repayment'}</span>
                <span className="text-xl font-bold text-primary">${monthlyInterest.toLocaleString('en-AU')}/mo</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mortgage Repayment Calculator */}
      <Collapsible open={showMortgageCalculator} onOpenChange={setShowMortgageCalculator}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full justify-between p-4 h-auto border-2 border-dashed border-brand-500/30 hover:border-brand-500/50 hover:bg-brand-500/5 rounded-lg"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-brand-500/10">
                <Banknote className="h-5 w-5 text-brand-600" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-foreground">Mortgage Repayment Calculator</p>
                <p className="text-sm text-muted-foreground">
                  Calculate repayments, view amortisation schedule, and apply to cash flow
                </p>
              </div>
            </div>
            {showMortgageCalculator ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            )}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-4">
            <Separator />
            <MortgageRepaymentCalculator
              initialLoanAmount={loanAmount}
              initialInterestRate={parseFloat(interestRate) || 6.5}
              initialLoanTermYears={parseFloat(loanTermYears) || 30}
              initialLoanType={(loanType || 'principal_interest') as LoanType}
              initialInterestOnlyPeriodYears={parseFloat(propInterestOnlyPeriodYears || '0') || 0}
              initialRepaymentFrequency={(propRepaymentFrequency || 'monthly') as RepaymentFrequency}
              initialExtraRepayment={parseFloat(propExtraRepaymentPerMonth || '0') || 0}
              initialOffsetBalance={parseFloat(propOffsetBalance || '0') || 0}
              onApplyToOverrides={(values) => {
                if (values.loanAmount !== undefined && propSetLoanAmount) {
                  propSetLoanAmount(values.loanAmount.toString());
                }
                if (values.interestRate !== undefined) {
                  setInterestRate(values.interestRate.toString());
                }
                if (values.loanTermYears !== undefined) {
                  setLoanTermYears(values.loanTermYears.toString());
                }
                if (values.loanType !== undefined) {
                  setLoanType(values.loanType as 'interest_only' | 'principal_interest');
                }
                if (values.interestOnlyPeriodYears !== undefined && propSetInterestOnlyPeriodYears) {
                  propSetInterestOnlyPeriodYears(values.interestOnlyPeriodYears.toString());
                }
                if (values.repaymentFrequency !== undefined && propSetRepaymentFrequency) {
                  propSetRepaymentFrequency(values.repaymentFrequency);
                }
                if (values.extraRepaymentPerMonth !== undefined && propSetExtraRepaymentPerMonth) {
                  propSetExtraRepaymentPerMonth(values.extraRepaymentPerMonth.toString());
                }
                if (values.offsetBalance !== undefined && propSetOffsetBalance) {
                  propSetOffsetBalance(values.offsetBalance.toString());
                }
              }}
              onApplyLoanProjection={(projection) => {
                console.log('Loan projection applied:', projection);
              }}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Acquisition Costs Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Acquisition Costs
            </h3>
            {isFirstHomeBuyer && (
              <Badge variant="secondary" className="bg-success/10 text-success">
                First Home Buyer
              </Badge>
            )}
          </div>

          <div className="space-y-4 mb-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="stampDuty" className="text-sm font-medium">Stamp Duty</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowStampDutyModal(true)}
                disabled={disabled}
              >
                <Calculator className="h-4 w-4 mr-1" />
                Calculator
              </Button>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="stampDuty"
                type="text"
                inputMode="numeric"
                value={formatForDisplay(stampDuty)}
                onChange={handleCurrencyChange(setStampDuty)}
                placeholder="Use calculator or enter manually"
                disabled={disabled}
                className="pl-7"
              />
            </div>
            {isFirstHomeBuyer && (
              <p className="text-xs text-success">
                First Home Buyer concessions may apply based on state
              </p>
            )}
          </div>

          {/* Stamp duty is assessed in-process; see StampDutyCalculatorPanel. */}
          <Dialog open={showStampDutyModal} onOpenChange={setShowStampDutyModal}>
            <DialogContent className="flex max-h-[calc(100dvh-4rem)] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-4rem)] sm:overflow-hidden sm:p-0">
              <DialogHeader className="shrink-0 border-b bg-background/95 px-6 pb-4 pt-6 pr-14">
                <DialogTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5 text-primary" />
                  Stamp Duty Calculator
                </DialogTitle>
                <DialogDescription>
                  Calculate stamp duty for {propertyAddress || 'your property'} ({detectedState})
                </DialogDescription>
              </DialogHeader>
              
              <div
                className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-6 py-4 pb-10 [scrollbar-color:rgba(180,180,190,0.28)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/45 [&::-webkit-scrollbar-track]:bg-transparent"
                role="region"
                aria-label="Scrollable stamp duty calculator content"
                tabIndex={0}
              >
                <StampDutyCalculatorPanel
                  dutiableValue={dutiableValue}
                  onDutiableValueChange={setDutiableValueOverride}
                  purchasePrice={price}
                  bases={stampDutyBases}
                  state={stampDutyState}
                  onStateChange={setStampDutyStateOverride}
                  intent={stampDutyIntent}
                  onIntentChange={handleIntentChange}
                  category={stampDutyCategory}
                  onCategoryChange={handleCategoryChange}
                  isFirstHomeBuyer={isFirstHomeBuyer}
                  onFirstHomeBuyerChange={setIsFirstHomeBuyer}
                  isForeignBuyer={isForeignBuyer}
                  onForeignBuyerChange={setIsForeignBuyer}
                  onUseValue={handleUseValue}
                  useValueLabel="Apply to analysis"
                  disabled={disabled}
                />
              </div>
            </DialogContent>
          </Dialog>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="solicitorFees" className="text-sm font-medium">Solicitor / Conveyancing</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="solicitorFees"
                  type="text"
                  inputMode="numeric"
                  value={formatForDisplay(solicitorFees)}
                  onChange={handleCurrencyChange(setSolicitorFees)}
                  placeholder="1,500"
                  disabled={disabled}
                  className="pl-7"
                />
              </div>
            </div>
            {!isNewBuild && (
              <div className="space-y-2">
                <Label htmlFor="agentFee" className="text-sm font-medium">Agent Fee / Commission</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="agentFee"
                    type="text"
                    inputMode="numeric"
                    value={formatForDisplay(agentFee)}
                    onChange={handleCurrencyChange(setAgentFee)}
                    placeholder="15,000"
                    disabled={disabled}
                    className="pl-7"
                  />
                </div>
              </div>
            )}
          </div>

          {totalAcquisitionCosts > 0 && (
            <div className="mt-4 p-4 bg-muted/50 rounded-lg border">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total Upfront Costs</span>
                <span className="text-xl font-bold">${totalAcquisitionCosts.toLocaleString('en-AU')}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}