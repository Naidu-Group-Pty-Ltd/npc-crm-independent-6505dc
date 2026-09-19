import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table as UITable, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Calculator, ChevronDown, ChevronRight, DollarSign, TrendingDown, Clock, Percent, ArrowRight, Check, Info, BarChart3, Pencil } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  generateAmortisationSchedule, 
  calculatePaymentEquivalents,
  get10YearLoanProjection,
  MortgageInput,
  RepaymentFrequency,
  LoanType,
  MortgageCalculationResult,
  PERIODS_PER_YEAR
} from '@/utils/mortgageCalculations';

// Preset interest rate options grouped by category
const PRESET_INTEREST_RATES = [
  // Owner Occupied - Digi Home Loan
  { value: '5.34', label: '5.34% p.a. Digi Home Loan LVR 60% or below', category: 'Owner Occupied' },
  { value: '5.37', label: '5.37% p.a. Digi Home Loan LVR 60.01% to 70%', category: 'Owner Occupied' },
  { value: '5.39', label: '5.39% p.a. Digi Home Loan LVR 70.01% to 80%', category: 'Owner Occupied' },
  // Owner Occupied - Simple Home Loan Variable
  { value: '5.59', label: '5.59% p.a. Simple Home Loan - Variable Rate LVR 60% or below', category: 'Owner Occupied' },
  { value: '5.64', label: '5.64% p.a. Simple Home Loan - Variable Rate LVR 60.01% to 70%', category: 'Owner Occupied' },
  { value: '5.74', label: '5.74% p.a. Simple Home Loan - Variable Rate LVR 70.01% to 80%', category: 'Owner Occupied' },
  { value: '6.04', label: '6.04% p.a. Simple Home Loan - Variable Rate LVR 80.01% to 90%', category: 'Owner Occupied' },
  { value: '6.99', label: '6.99% p.a. Simple Home Loan - Variable Rate LVR 90.01% to 95%', category: 'Owner Occupied' },
  // Owner Occupied - Standard Variable
  { value: '5.59', label: '5.59% p.a. Standard Variable Rate Home Loan LVR 60% or below', category: 'Owner Occupied' },
  { value: '5.64', label: '5.64% p.a. Standard Variable Rate Home Loan LVR 60.01% to 70%', category: 'Owner Occupied' },
  { value: '5.74', label: '5.74% p.a. Standard Variable Rate Home Loan LVR 70.01% to 80%', category: 'Owner Occupied' },
  { value: '6.04', label: '6.04% p.a. Standard Variable Rate Home Loan LVR 80.01% to 90%', category: 'Owner Occupied' },
  { value: '6.99', label: '6.99% p.a. Standard Variable Rate Home Loan LVR 90.01% to 95%', category: 'Owner Occupied' },
  // Owner Occupied - Fixed Rate
  { value: '5.49', label: '5.49% p.a. 1 Year Fixed Rate Home Loan', category: 'Owner Occupied Fixed' },
  { value: '5.44', label: '5.44% p.a. 2 Year Fixed Rate Home Loan', category: 'Owner Occupied Fixed' },
  { value: '5.34', label: '5.34% p.a. 3 Year Fixed Rate Home Loan', category: 'Owner Occupied Fixed' },
  { value: '5.79', label: '5.79% p.a. 4 Year Fixed Rate Home Loan', category: 'Owner Occupied Fixed' },
  { value: '5.94', label: '5.94% p.a. 5 Year Fixed Rate Home Loan', category: 'Owner Occupied Fixed' },
  // Owner Occupied - Green Loan
  { value: '3.99', label: '3.99% p.a. Green Loan', category: 'Owner Occupied' },
  // Investment - Digi Investment
  { value: '5.44', label: '5.44% p.a. Digi Investment Home Loan LVR 60% or below', category: 'Investment' },
  { value: '5.49', label: '5.49% p.a. Digi Investment Home Loan LVR 60.01% to 70%', category: 'Investment' },
  { value: '5.54', label: '5.54% p.a. Digi Investment Home Loan LVR 70.01% to 80%', category: 'Investment' },
  // Investment - Simple Variable
  { value: '5.79', label: '5.79% p.a. Simple Investment Home Loan - Variable Rate LVR 60% or below', category: 'Investment' },
  { value: '5.84', label: '5.84% p.a. Simple Investment Home Loan - Variable Rate LVR 60.01% to 70%', category: 'Investment' },
  { value: '5.94', label: '5.94% p.a. Simple Investment Home Loan - Variable Rate LVR 70.01% to 80%', category: 'Investment' },
  { value: '6.29', label: '6.29% p.a. Simple Investment Home Loan - Variable Rate LVR 80.01% to 90%', category: 'Investment' },
  { value: '7.09', label: '7.09% p.a. Simple Investment Home Loan - Variable Rate LVR 90.01% to 95%', category: 'Investment' },
  // Investment - Standard Variable
  { value: '5.79', label: '5.79% p.a. Standard Variable Rate Investment Home Loan LVR 60% or below', category: 'Investment' },
  { value: '5.84', label: '5.84% p.a. Standard Variable Rate Investment Home Loan LVR 60.01% to 70%', category: 'Investment' },
  { value: '5.94', label: '5.94% p.a. Standard Variable Rate Investment Home Loan LVR 70.01% to 80%', category: 'Investment' },
  { value: '6.29', label: '6.29% p.a. Standard Variable Rate Investment Home Loan LVR 80.01% to 90%', category: 'Investment' },
  { value: '7.09', label: '7.09% p.a. Standard Variable Rate Investment Home Loan LVR 90.01% to 95%', category: 'Investment' },
  // Investment - Fixed Rate
  { value: '5.64', label: '5.64% p.a. 1 Year Fixed Rate Investment Home Loan', category: 'Investment Fixed' },
  { value: '5.59', label: '5.59% p.a. 2 Year Fixed Rate Investment Home Loan', category: 'Investment Fixed' },
  { value: '5.49', label: '5.49% p.a. 3 Year Fixed Rate Investment Home Loan', category: 'Investment Fixed' },
  { value: '5.94', label: '5.94% p.a. 4 Year Fixed Rate Investment Home Loan', category: 'Investment Fixed' },
  { value: '6.14', label: '6.14% p.a. 5 Year Fixed Rate Investment Home Loan', category: 'Investment Fixed' },
  // Investment - Green Loan
  { value: '3.99', label: '3.99% p.a. Green Investment Loan', category: 'Investment' },
  // Custom option
  { value: 'custom', label: 'Enter custom rate...', category: 'Custom' },
];

interface MortgageRepaymentCalculatorProps {
  // Pre-fill values from report
  initialLoanAmount?: number;
  initialInterestRate?: number;
  initialLoanTermYears?: number;
  initialLoanType?: LoanType;
  initialInterestOnlyPeriodYears?: number;
  initialRepaymentFrequency?: RepaymentFrequency;
  initialExtraRepayment?: number;
  initialOffsetBalance?: number;
  // Callbacks to apply values to parent overrides
  onApplyToOverrides?: (values: {
    loanAmount?: number;
    interestRate?: number;
    loanTermYears?: number;
    loanType?: LoanType;
    interestOnlyPeriodYears?: number;
    repaymentFrequency?: RepaymentFrequency;
    extraRepaymentPerMonth?: number;
    offsetBalance?: number;
  }) => void;
  onApplyLoanProjection?: (projection: ReturnType<typeof get10YearLoanProjection>) => void;
}

export function MortgageRepaymentCalculator({
  initialLoanAmount = 0,
  initialInterestRate = 6.5,
  initialLoanTermYears = 30,
  initialLoanType = 'principal_interest',
  initialInterestOnlyPeriodYears = 0,
  initialRepaymentFrequency = 'monthly',
  initialExtraRepayment = 0,
  initialOffsetBalance = 0,
  onApplyToOverrides,
  onApplyLoanProjection,
}: MortgageRepaymentCalculatorProps) {
  // Calculator inputs
  const [loanAmount, setLoanAmount] = useState<number>(initialLoanAmount);
  const [interestRate, setInterestRate] = useState<number>(initialInterestRate);
  const [loanTermYears, setLoanTermYears] = useState<number>(initialLoanTermYears);
  const [loanType, setLoanType] = useState<LoanType>(initialLoanType);
  const [interestOnlyPeriodYears, setInterestOnlyPeriodYears] = useState<number>(initialInterestOnlyPeriodYears);
  const [repaymentFrequency, setRepaymentFrequency] = useState<RepaymentFrequency>(initialRepaymentFrequency);
  const [extraRepayment, setExtraRepayment] = useState<number>(initialExtraRepayment);
  const [offsetBalance, setOffsetBalance] = useState<number>(initialOffsetBalance);
  
  // UI state
  const [showResults, setShowResults] = useState(false);
  const [showAmortisation, setShowAmortisation] = useState(false);
  const [amortisationView, setAmortisationView] = useState<'yearly' | 'all'>('yearly');
const [rateInputMode, setRateInputMode] = useState<'preset' | 'custom'>('preset');
  const [selectedPresetRate, setSelectedPresetRate] = useState<string>('5.34');
  
  // Sync loan amount dynamically when initial value changes (from purchase price * LVR)
  useEffect(() => {
    if (initialLoanAmount >= 0) {
      setLoanAmount(initialLoanAmount);
    }
  }, [initialLoanAmount]);
  
  // Sync other initial values when they change
  useEffect(() => {
    if (initialInterestRate > 0) {
      setInterestRate(initialInterestRate);
      // Check if it matches a preset, otherwise set to custom
      const matchingPreset = PRESET_INTEREST_RATES.find(r => r.value === String(initialInterestRate));
      if (matchingPreset) {
        setSelectedPresetRate(matchingPreset.value);
        setRateInputMode('preset');
      } else {
        setRateInputMode('custom');
      }
    }
    if (initialLoanTermYears > 0) setLoanTermYears(initialLoanTermYears);
    if (initialLoanType) setLoanType(initialLoanType);
    if (initialInterestOnlyPeriodYears >= 0) setInterestOnlyPeriodYears(initialInterestOnlyPeriodYears);
    if (initialRepaymentFrequency) setRepaymentFrequency(initialRepaymentFrequency);
    if (initialExtraRepayment >= 0) setExtraRepayment(initialExtraRepayment);
    if (initialOffsetBalance >= 0) setOffsetBalance(initialOffsetBalance);
  }, [initialInterestRate, initialLoanTermYears, initialLoanType, initialInterestOnlyPeriodYears, initialRepaymentFrequency, initialExtraRepayment, initialOffsetBalance]);
  
  // Handle preset rate selection
  const handlePresetRateChange = (value: string) => {
    if (value === 'custom') {
      setRateInputMode('custom');
      setSelectedPresetRate('custom');
    } else {
      setRateInputMode('preset');
      setSelectedPresetRate(value);
      // Extract the numeric rate from the combined value (e.g., "5.89|5.89% - CBA Extra...")
      const rateValue = value.split('|')[0];
      setInterestRate(parseFloat(rateValue));
    }
  };
  
  // Calculate results
  const calculationResult = useMemo((): MortgageCalculationResult | null => {
    if (loanAmount <= 0 || interestRate < 0 || loanTermYears <= 0) {
      return null;
    }
    
    const input: MortgageInput = {
      loanAmount,
      annualInterestRate: interestRate,
      loanTermYears,
      repaymentFrequency,
      loanType,
      interestOnlyPeriodYears: loanType === 'interest_only' ? interestOnlyPeriodYears : 0,
      extraRepaymentPerPeriod: extraRepayment,
      offsetBalance,
    };
    
    try {
      return generateAmortisationSchedule(input);
    } catch (error) {
      console.error('Error calculating mortgage:', error);
      return null;
    }
  }, [loanAmount, interestRate, loanTermYears, repaymentFrequency, loanType, interestOnlyPeriodYears, extraRepayment, offsetBalance]);
  
  // Payment equivalents (all frequencies)
  const paymentEquivalents = useMemo(() => {
    if (loanAmount <= 0 || interestRate < 0 || loanTermYears <= 0) {
      return null;
    }
    return calculatePaymentEquivalents(
      loanAmount, 
      interestRate, 
      loanTermYears, 
      loanType, 
      loanType === 'interest_only' ? interestOnlyPeriodYears : 0
    );
  }, [loanAmount, interestRate, loanTermYears, loanType, interestOnlyPeriodYears]);
  
  const handleCalculate = () => {
    setShowResults(true);
  };
  
  const handleApplyToOverrides = () => {
    onApplyToOverrides?.({
      loanAmount,
      interestRate,
      loanTermYears,
      loanType,
      interestOnlyPeriodYears: loanType === 'interest_only' ? interestOnlyPeriodYears : undefined,
      repaymentFrequency,
      extraRepaymentPerMonth: repaymentFrequency === 'monthly' ? extraRepayment : Math.round(extraRepayment * PERIODS_PER_YEAR[repaymentFrequency] / 12),
      offsetBalance,
    });
  };
  
  const handleApplyToCashFlow = () => {
    if (loanAmount <= 0) return;
    
    const input: MortgageInput = {
      loanAmount,
      annualInterestRate: interestRate,
      loanTermYears,
      repaymentFrequency,
      loanType,
      interestOnlyPeriodYears: loanType === 'interest_only' ? interestOnlyPeriodYears : 0,
      extraRepaymentPerPeriod: extraRepayment,
      offsetBalance,
    };
    
    const projection = get10YearLoanProjection(input);
    onApplyLoanProjection?.(projection);
  };
  
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };
  
  const formatCurrencyPrecise = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };
  
  const isValid = loanAmount > 0 && interestRate >= 0 && loanTermYears > 0;
  const hasIOPeriodError = loanType === 'interest_only' && interestOnlyPeriodYears >= loanTermYears;
  
  return (
    <div className="space-y-4">
      {/* Calculator Inputs */}
      <div className="grid gap-4">
        {/* Loan Amount */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Loan Amount</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
            <Input
              type="number"
              value={loanAmount || ''}
              onChange={(e) => setLoanAmount(parseFloat(e.target.value) || 0)}
              className="pl-8"
              placeholder="300,000"
            />
          </div>
        </div>
        
        {/* Term */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Term</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={loanTermYears || ''}
              onChange={(e) => setLoanTermYears(parseInt(e.target.value) || 0)}
              className="w-24"
              min={1}
              max={40}
              placeholder="30"
            />
            <span className="text-sm text-muted-foreground">years</span>
          </div>
        </div>
        
        {/* Repayment Type */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Repayment Type</Label>
          <Select 
            value={loanType} 
            onValueChange={(value: LoanType) => setLoanType(value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="principal_interest">Principal and Interest</SelectItem>
              <SelectItem value="interest_only">Interest Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {/* IO Period (conditional) */}
        {loanType === 'interest_only' && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Interest Only Period</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={interestOnlyPeriodYears || ''}
                onChange={(e) => setInterestOnlyPeriodYears(parseInt(e.target.value) || 0)}
                className={`w-24 ${hasIOPeriodError ? 'border-destructive' : ''}`}
                min={1}
                max={loanTermYears - 1}
                placeholder="5"
              />
              <span className="text-sm text-muted-foreground">years</span>
            </div>
            {hasIOPeriodError && (
              <p className="text-xs text-destructive">IO period must be less than loan term</p>
            )}
          </div>
        )}
        
        {/* Interest Rate */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Interest Rate</Label>
          {rateInputMode === 'preset' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Select 
                  value={selectedPresetRate} 
                  onValueChange={handlePresetRateChange}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select interest rate" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {PRESET_INTEREST_RATES.map((rate) => (
                      <SelectItem key={rate.value + rate.label} value={rate.value === 'custom' ? 'custom' : rate.value + '|' + rate.label}>
                        {rate.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    setRateInputMode('custom');
                    setSelectedPresetRate('custom');
                  }}
                  className="text-xs whitespace-nowrap"
                >
                  <Pencil className="h-3 w-3 mr-1" />
                  Manual
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  value={interestRate || ''}
                  onChange={(e) => setInterestRate(parseFloat(e.target.value) || 0)}
                  className="w-28"
                  placeholder="6.50"
                  autoFocus
                />
                <span className="text-sm text-muted-foreground">% p.a.</span>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => {
                    setRateInputMode('preset');
                    setSelectedPresetRate('5.34');
                    setInterestRate(5.34);
                  }}
                  className="text-xs"
                >
                  Use presets
                </Button>
              </div>
            </div>
          )}
        </div>
        
        {/* Repayment Frequency */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Repayment Frequency</Label>
          <Select 
            value={repaymentFrequency} 
            onValueChange={(value: RepaymentFrequency) => setRepaymentFrequency(value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly (52/year)</SelectItem>
              <SelectItem value="fortnightly">Fortnightly (26/year)</SelectItem>
              <SelectItem value="monthly">Monthly (12/year)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {/* Advanced Options */}
        <Collapsible className="space-y-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between px-0 hover:bg-transparent">
              <span className="text-sm text-muted-foreground">Advanced Options</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-2">
            {/* Extra Repayment */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium">Extra Repayment</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs text-xs">Additional payment per period on top of scheduled repayment</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={extraRepayment || ''}
                  onChange={(e) => setExtraRepayment(parseFloat(e.target.value) || 0)}
                  className="pl-8"
                  placeholder="0"
                />
              </div>
              <p className="text-xs text-muted-foreground">per {repaymentFrequency === 'weekly' ? 'week' : repaymentFrequency === 'fortnightly' ? 'fortnight' : 'month'}</p>
            </div>
            
            {/* Offset Balance */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium">Offset Account Balance</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs text-xs">Reduces the balance used to calculate interest. Simplified model assumes constant offset.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={offsetBalance || ''}
                  onChange={(e) => setOffsetBalance(parseFloat(e.target.value) || 0)}
                  className="pl-8"
                  placeholder="0"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
      
      {/* Calculate Button */}
      <Button 
        onClick={handleCalculate}
        disabled={!isValid || hasIOPeriodError}
        className="w-full bg-brand-500 hover:bg-brand-600 text-black font-semibold"
        size="lg"
      >
        <Calculator className="h-4 w-4 mr-2" />
        Calculate
      </Button>
      
      {/* Results Section */}
      {showResults && calculationResult && (
        <div className="space-y-4 pt-4">
          <Separator />
          
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* Repayment Amount */}
            <div className="p-4 rounded-lg border bg-gradient-to-br from-primary/5 to-primary/10">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">
                  {repaymentFrequency === 'weekly' ? 'Weekly' : repaymentFrequency === 'fortnightly' ? 'Fortnightly' : 'Monthly'} Repayment
                </span>
              </div>
              <p className="text-xl font-bold text-foreground">
                {formatCurrencyPrecise(calculationResult.scheduledPaymentPerPeriod)}
              </p>
              {loanType === 'interest_only' && (
                <p className="text-xs text-muted-foreground mt-1">
                  IO: {formatCurrency(paymentEquivalents?.[`${repaymentFrequency}IO`] || 0)}/period
                </p>
              )}
            </div>
            
            {/* Total Interest */}
            <div className="p-4 rounded-lg border bg-gradient-to-br from-warning/5 to-warning/10">
              <div className="flex items-center gap-2 mb-1">
                <Percent className="h-4 w-4 text-warning" />
                <span className="text-xs font-medium text-muted-foreground">Total Interest</span>
              </div>
              <p className="text-xl font-bold text-foreground">
                {formatCurrency(calculationResult.totalInterestPaid)}
              </p>
            </div>
            
            {/* Total Paid */}
            <div className="p-4 rounded-lg border bg-gradient-to-br from-info/5 to-info/10">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="h-4 w-4 text-info" />
                <span className="text-xs font-medium text-muted-foreground">Total Paid</span>
              </div>
              <p className="text-xl font-bold text-foreground">
                {formatCurrency(calculationResult.totalPaid)}
              </p>
            </div>
            
            {/* Payoff Time */}
            <div className="p-4 rounded-lg border bg-gradient-to-br from-success/5 to-success/10">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-success" />
                <span className="text-xs font-medium text-muted-foreground">Payoff Time</span>
              </div>
              <p className="text-xl font-bold text-foreground">
                {calculationResult.payoffYears}y {calculationResult.payoffMonths}m
              </p>
              {calculationResult.payoffYears < loanTermYears && (
                <Badge variant="secondary" className="text-xs mt-1 bg-success/15 text-success dark:bg-success/30 dark:text-success">
                  Early payoff!
                </Badge>
              )}
            </div>
          </div>
          
          {/* Interest Saved (if applicable) */}
          {calculationResult.interestSavedVsBaseline > 0 && (
            <div className="p-3 rounded-lg bg-success/10 dark:bg-success/30 border border-success/30 dark:border-success/30">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-success" />
                <span className="text-sm font-medium text-success dark:text-success">
                  You save {formatCurrency(calculationResult.interestSavedVsBaseline)} in interest
                </span>
              </div>
              <p className="text-xs text-success dark:text-success mt-1">
                Compared to no extra repayments or offset
              </p>
            </div>
          )}
          
          {/* Payment Equivalents */}
          {paymentEquivalents && (
            <div className="p-3 rounded-lg border bg-muted/30">
              <p className="text-xs font-medium text-muted-foreground mb-2">Payment equivalents (P&I)</p>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Weekly:</span>
                  <span className="font-medium ml-1">{formatCurrencyPrecise(paymentEquivalents.weekly)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Fortnightly:</span>
                  <span className="font-medium ml-1">{formatCurrencyPrecise(paymentEquivalents.fortnightly)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Monthly:</span>
                  <span className="font-medium ml-1">{formatCurrencyPrecise(paymentEquivalents.monthly)}</span>
                </div>
              </div>
            </div>
          )}
          
          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2">
            {onApplyToOverrides && (
              <Button variant="outline" onClick={handleApplyToOverrides} className="gap-2">
                <Check className="h-4 w-4" />
                Apply to Fields
              </Button>
            )}
            {onApplyLoanProjection && (
              <Button onClick={handleApplyToCashFlow} className="gap-2">
                <ArrowRight className="h-4 w-4" />
                Use in Cash Flow
              </Button>
            )}
          </div>
          
          {/* Amortisation Schedule */}
          <Collapsible open={showAmortisation} onOpenChange={setShowAmortisation}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between">
                <span className="font-medium">View Amortisation Schedule</span>
                {showAmortisation ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <Tabs value={amortisationView} onValueChange={(v) => setAmortisationView(v as 'yearly' | 'all')}>
                <TabsList className="grid w-full grid-cols-2 mb-3">
                  <TabsTrigger value="yearly">Yearly Summary</TabsTrigger>
                  <TabsTrigger value="all">All Periods</TabsTrigger>
                </TabsList>
                
                <TabsContent value="yearly" className="mt-0">
                  <div className="rounded-lg border overflow-hidden max-h-[300px] overflow-y-auto">
                    <UITable>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="font-semibold">Year</TableHead>
                          <TableHead className="font-semibold text-right">Interest</TableHead>
                          <TableHead className="font-semibold text-right">Principal</TableHead>
                          <TableHead className="font-semibold text-right">End Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {calculationResult.yearlySummary.slice(0, 10).map((year) => (
                          <TableRow key={year.year}>
                            <TableCell className="font-medium">Year {year.year}</TableCell>
                            <TableCell className="text-right text-warning dark:text-warning">
                              {formatCurrency(year.totalInterest)}
                            </TableCell>
                            <TableCell className="text-right text-success dark:text-success">
                              {formatCurrency(year.totalPrincipal)}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(year.endingBalance)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </UITable>
                  </div>
                </TabsContent>
                
                <TabsContent value="all" className="mt-0">
                  <div className="rounded-lg border overflow-hidden max-h-[300px] overflow-y-auto">
                    <UITable>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="font-semibold">Period</TableHead>
                          <TableHead className="font-semibold text-right">Payment</TableHead>
                          <TableHead className="font-semibold text-right">Interest</TableHead>
                          <TableHead className="font-semibold text-right">Principal</TableHead>
                          <TableHead className="font-semibold text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {calculationResult.schedule.slice(0, 120).map((period) => (
                          <TableRow key={period.period} className={period.isInterestOnly ? 'bg-brand-50/50 dark:bg-brand-950/20' : ''}>
                            <TableCell className="font-medium">
                              {period.period}
                              {period.isInterestOnly && (
                                <Badge variant="outline" className="ml-1 text-[10px] px-1">IO</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrencyPrecise(period.totalPayment)}
                            </TableCell>
                            <TableCell className="text-right text-warning dark:text-warning">
                              {formatCurrencyPrecise(period.interest)}
                            </TableCell>
                            <TableCell className="text-right text-success dark:text-success">
                              {formatCurrencyPrecise(period.principal + period.extraPayment)}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(period.closingBalance)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </UITable>
                  </div>
                  {calculationResult.schedule.length > 120 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Showing first 120 periods of {calculationResult.schedule.length} total
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            </CollapsibleContent>
          </Collapsible>
          
          {/* Assumptions Note */}
          <div className="p-3 rounded-lg bg-muted/30 border">
            <p className="text-xs text-muted-foreground">
              <strong>Note:</strong> This is an estimate calculator using periodic compounding based on selected frequency. 
              Offset is modelled as reducing effective balance for interest. Actual bank calculations may differ.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
