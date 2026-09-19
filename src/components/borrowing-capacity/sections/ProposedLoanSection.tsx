import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Collapsible, 
  CollapsibleContent, 
  CollapsibleTrigger 
} from '@/components/ui/collapsible';
import { ChevronDown, Target, DollarSign, Percent, Calendar, ShieldCheck, Home, Building } from 'lucide-react';
import { useState, useMemo } from 'react';

export interface ProposedRentalIncomeData {
  weeklyRent: number;
  frequency: 'weekly' | 'monthly' | 'annual';
  inputAmount: number;
  shadingRate: number;
  vacancyRate: number;
  interestOnlyOffset: number;
}

interface ProposedLoanSectionProps {
  proposedLoanAmount: number;
  interestRate: number;
  bufferRate: number;
  bufferEnabled: boolean;
  onBufferEnabledChange: (enabled: boolean) => void;
  loanTermYears: number;
  onProposedLoanChange?: (value: number) => void;
  onInterestRateChange?: (value: number) => void;
  onLoanTermChange?: (value: number) => void;
  proposedRentalIncome?: ProposedRentalIncomeData;
  onProposedRentalIncomeChange?: (data: ProposedRentalIncomeData) => void;
}

const DEFAULT_RENTAL: ProposedRentalIncomeData = {
  weeklyRent: 0,
  frequency: 'weekly',
  inputAmount: 0,
  shadingRate: 0.8,
  vacancyRate: 0,
  interestOnlyOffset: 0,
};

function convertRentalToAnnual(amount: number, frequency: string): number {
  switch (frequency) {
    case 'weekly': return amount * 52;
    case 'monthly': return amount * 12;
    default: return amount;
  }
}

export function ProposedLoanSection({
  proposedLoanAmount,
  interestRate,
  bufferRate,
  bufferEnabled,
  onBufferEnabledChange,
  loanTermYears,
  onProposedLoanChange,
  onInterestRateChange,
  onLoanTermChange,
  proposedRentalIncome,
  onProposedRentalIncomeChange,
}: ProposedLoanSectionProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isRentalOpen, setIsRentalOpen] = useState(false);

  const rental = proposedRentalIncome || DEFAULT_RENTAL;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const assessmentRate = interestRate + bufferRate;

  const updateRental = (partial: Partial<ProposedRentalIncomeData>) => {
    const updated = { ...rental, ...partial };
    onProposedRentalIncomeChange?.(updated);
  };

  // Compute the net assessable rental income
  const rentalSummary = useMemo(() => {
    const grossAnnual = convertRentalToAnnual(rental.inputAmount, rental.frequency);
    const afterVacancy = grossAnnual * (1 - rental.vacancyRate / 100);
    const afterShading = afterVacancy * rental.shadingRate;
    const ioOffsetAnnual = rental.interestOnlyOffset * 12;
    const netAssessable = Math.max(0, afterShading - ioOffsetAnnual);
    return { grossAnnual, afterVacancy, afterShading, ioOffsetAnnual, netAssessable };
  }, [rental]);

  return (
    <div className="space-y-3">
      <Card>
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  Proposed Loan
                </CardTitle>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Target</p>
                    <p className="text-sm font-semibold text-primary">{formatCurrency(proposedLoanAmount)}</p>
                  </div>
                  <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-5">
              {/* Proposed Loan Amount */}
              <div className="space-y-3">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Proposed Loan Amount
                </Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    value={proposedLoanAmount || ''}
                    onChange={(e) => onProposedLoanChange?.(Number(e.target.value))}
                    className="pl-9"
                    placeholder="500000"
                  />
                </div>
                <Slider
                  value={[proposedLoanAmount]}
                  onValueChange={([value]) => onProposedLoanChange?.(value)}
                  min={0}
                  max={2000000}
                  step={10000}
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>$0</span>
                  <span>$2M</span>
                </div>
              </div>

              {/* Interest Rate */}
              <div className="space-y-3">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Percent className="h-4 w-4" />
                  Interest Rate
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    value={interestRate || ''}
                    onChange={(e) => onInterestRateChange?.(Number(e.target.value))}
                    className="pr-8"
                    placeholder="6.50"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                </div>
                <Slider
                  value={[interestRate]}
                  onValueChange={([value]) => onInterestRateChange?.(value)}
                  min={4}
                  max={10}
                  step={0.05}
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>4%</span>
                  <span>10%</span>
                </div>
              </div>

              {/* Loan Term */}
              <div className="space-y-3">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Loan Term
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={loanTermYears || ''}
                    onChange={(e) => onLoanTermChange?.(Number(e.target.value))}
                    className="pr-12"
                    placeholder="30"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">years</span>
                </div>
                <Slider
                  value={[loanTermYears]}
                  onValueChange={([value]) => onLoanTermChange?.(value)}
                  min={5}
                  max={30}
                  step={1}
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>5 years</span>
                  <span>30 years</span>
                </div>
              </div>

              {/* APRA Buffer Toggle */}
              <div className="p-4 rounded-lg border bg-card">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="buffer-toggle" className="text-sm font-medium flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      APRA +3% Buffer
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Stress-test at loan rate + 3%
                    </p>
                  </div>
                  <Switch
                    id="buffer-toggle"
                    checked={bufferEnabled}
                    onCheckedChange={onBufferEnabledChange}
                  />
                </div>
              </div>

              {/* Assessment Rate Display */}
              <div className={`p-4 rounded-lg border ${bufferEnabled ? 'bg-primary/10 border-primary/20' : 'bg-muted/50 border-muted'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Assessment Rate</p>
                    <p className="text-xs text-muted-foreground">
                      {bufferEnabled ? `Interest + ${bufferRate}% buffer` : 'Interest rate only (no buffer)'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xl font-bold ${bufferEnabled ? 'text-primary' : 'text-muted-foreground'}`}>
                      {assessmentRate.toFixed(2)}%
                    </p>
                  </div>
                </div>
              </div>

              {/* Buffer Explanation */}
              <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                <p>
                  <strong>APRA Serviceability Buffer:</strong> {bufferEnabled 
                    ? 'Lenders must assess borrowers at the loan rate + 3% buffer to ensure repayment capacity if rates rise.'
                    : 'Buffer disabled — calculating at the nominal interest rate only. This shows theoretical maximum capacity.'}
                </p>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Proposed Rental Income Card */}
      <Card>
        <Collapsible open={isRentalOpen} onOpenChange={setIsRentalOpen}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Home className="h-4 w-4 text-primary" />
                  Proposed Rental Income
                </CardTitle>
                <div className="flex items-center gap-3">
                  {rentalSummary.netAssessable > 0 && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Net Assessable</p>
                      <p className="text-sm font-semibold text-success">
                        +{formatCurrency(rentalSummary.netAssessable)}/yr
                      </p>
                    </div>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${isRentalOpen ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-5">
              <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                <p>
                  <strong>Expected rental income</strong> from the property you're purchasing. 
                  This is shaded and adjusted for vacancy before being added to assessable income.
                </p>
              </div>

              {/* Rental Amount + Frequency */}
              <div className="space-y-3">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  Expected Rental Income
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="number"
                      value={rental.inputAmount || ''}
                      onChange={(e) => updateRental({ inputAmount: Number(e.target.value) })}
                      className="pl-9"
                      placeholder="550"
                    />
                  </div>
                  <Select
                    value={rental.frequency}
                    onValueChange={(v) => updateRental({ frequency: v as 'weekly' | 'monthly' | 'annual' })}
                  >
                    <SelectTrigger className="w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="annual">Annual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {rental.inputAmount > 0 && rental.frequency !== 'annual' && (
                  <p className="text-xs text-muted-foreground">
                    = {formatCurrency(rentalSummary.grossAnnual)}/yr gross
                  </p>
                )}
              </div>

              {/* Shading Rate */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Bank Shading Rate</Label>
                  <span className="text-sm font-semibold">{(rental.shadingRate * 100).toFixed(0)}%</span>
                </div>
                <Slider
                  value={[rental.shadingRate * 100]}
                  onValueChange={([v]) => updateRental({ shadingRate: v / 100 })}
                  min={50}
                  max={100}
                  step={5}
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>

              {/* Vacancy Deduction */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Vacancy Deduction</Label>
                  <span className="text-sm font-semibold">{rental.vacancyRate}%</span>
                </div>
                <Slider
                  value={[rental.vacancyRate]}
                  onValueChange={([v]) => updateRental({ vacancyRate: v })}
                  min={0}
                  max={20}
                  step={1}
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0%</span>
                  <span>20%</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Assumed vacancy periods reducing effective rental income.
                </p>
              </div>

              {/* Interest-Only Offset */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Interest-Only Offset (monthly)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    value={rental.interestOnlyOffset || ''}
                    onChange={(e) => updateRental({ interestOnlyOffset: Number(e.target.value) })}
                    className="pl-9"
                    placeholder="0"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Monthly IO repayment amount to offset against rental income (e.g. IO loan servicing cost on this property).
                </p>
              </div>

              {/* Summary Breakdown */}
              {rental.inputAmount > 0 && (
                <div className="p-4 rounded-lg border bg-card space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rental Income Breakdown</p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Gross Annual</span>
                      <span>{formatCurrency(rentalSummary.grossAnnual)}</span>
                    </div>
                    {rental.vacancyRate > 0 && (
                      <div className="flex justify-between text-warning">
                        <span>Less Vacancy ({rental.vacancyRate}%)</span>
                        <span>-{formatCurrency(rentalSummary.grossAnnual - rentalSummary.afterVacancy)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">After Shading ({(rental.shadingRate * 100).toFixed(0)}%)</span>
                      <span>{formatCurrency(rentalSummary.afterShading)}</span>
                    </div>
                    {rental.interestOnlyOffset > 0 && (
                      <div className="flex justify-between text-warning">
                        <span>Less IO Offset</span>
                        <span>-{formatCurrency(rentalSummary.ioOffsetAnnual)}/yr</span>
                      </div>
                    )}
                    <div className="border-t pt-1.5 flex justify-between font-semibold">
                      <span>Net Assessable Income</span>
                      <span className="text-success">+{formatCurrency(rentalSummary.netAssessable)}/yr</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </div>
  );
}