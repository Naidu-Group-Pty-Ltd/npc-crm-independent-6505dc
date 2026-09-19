import { useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  DollarSign, 
  TrendingUp, 
  Building2, 
  Shield, 
  Wrench, 
  Info, 
  Sparkles, 
  Loader2,
  Calculator
} from 'lucide-react';
import { formatNumberWithCommas, removeCommas } from '@/hooks/useFormattedNumber';
import { LandTaxCalculator } from '../LandTaxCalculator';

interface IncomeExpensesTabProps {
  weeklyRent: string;
  setWeeklyRent: (value: string) => void;
  occupancyRate: string;
  setOccupancyRate: (value: string) => void;
  bodyCorporateFees: string;
  setBodyCorporateFees: (value: string) => void;
  strataAdminFund: string;
  setStrataAdminFund: (value: string) => void;
  strataSinkingFund: string;
  setStrataSinkingFund: (value: string) => void;
  strataSpecialLevies: string;
  setStrataSpecialLevies: (value: string) => void;
  councilRates: string;
  setCouncilRates: (value: string) => void;
  waterRates: string;
  setWaterRates: (value: string) => void;
  landTax: string;
  setLandTax: (value: string) => void;
  buildingLandlordInsurance: string;
  setBuildingLandlordInsurance: (value: string) => void;
  propertyManagementFees: string;
  setPropertyManagementFees: (value: string) => void;
  repairsMaintenance: string;
  setRepairsMaintenance: (value: string) => void;
  lettingFees: string;
  setLettingFees: (value: string) => void;
  isEstimatingExpenses: boolean;
  onEstimateExpenses: () => void;
  disabled?: boolean;
  // Land Tax Calculator props
  propertyAddress?: string;
  detectedState?: string;
  purchasePrice?: number;
  landPrice?: number; // For land tax calculation - taxable land value
}

export function IncomeExpensesTab({
  weeklyRent,
  setWeeklyRent,
  occupancyRate,
  setOccupancyRate,
  bodyCorporateFees,
  setBodyCorporateFees,
  strataAdminFund,
  setStrataAdminFund,
  strataSinkingFund,
  setStrataSinkingFund,
  strataSpecialLevies,
  setStrataSpecialLevies,
  councilRates,
  setCouncilRates,
  waterRates,
  setWaterRates,
  landTax,
  setLandTax,
  buildingLandlordInsurance,
  setBuildingLandlordInsurance,
  propertyManagementFees,
  setPropertyManagementFees,
  repairsMaintenance,
  setRepairsMaintenance,
  lettingFees,
  setLettingFees,
  isEstimatingExpenses,
  onEstimateExpenses,
  disabled = false,
  propertyAddress,
  detectedState,
  purchasePrice,
  landPrice,
}: IncomeExpensesTabProps) {
  
  // Handler for land tax calculator results
  const handleLandTaxCalculated = useCallback((calculatedTax: number) => {
    setLandTax(calculatedTax.toString());
  }, [setLandTax]);
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

  // Calculations
  const annualRent = (parseFloat(weeklyRent) || 0) * (parseFloat(occupancyRate) || 52);
  const pmPercent = parseFloat(propertyManagementFees) || 8;
  const pmDollar = Math.round(annualRent * (pmPercent / 100));
  
  const totalAnnualExpenses = 
    (parseFloat(councilRates) || 0) +
    (parseFloat(waterRates) || 0) +
    (parseFloat(bodyCorporateFees) || 0) +
    (parseFloat(buildingLandlordInsurance) || 0) +
    pmDollar +
    (parseFloat(repairsMaintenance) || 0) +
    (parseFloat(landTax) || 0) +
    (parseFloat(lettingFees) || 0);

  const netAnnualIncome = annualRent - totalAnnualExpenses;
  const grossYield = annualRent > 0 ? ((annualRent / 750000) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* AI Smart Fill Banner */}
      <Card className="border-primary/50 bg-primary/5">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold">Smart Fill with AI</h3>
                <p className="text-sm text-muted-foreground">Auto-estimate expenses based on property details</p>
              </div>
            </div>
            <Button
              onClick={onEstimateExpenses}
              disabled={disabled || isEstimatingExpenses}
              className="gap-2"
            >
              {isEstimatingExpenses ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Estimating...
                </>
              ) : (
                <>
                  <Calculator className="h-4 w-4" />
                  Estimate All
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Rental Income Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Rental Income
            </h3>
            {annualRent > 0 && (
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Annual Income</p>
                <p className="text-lg font-bold text-success">${annualRent.toLocaleString('en-AU')}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="weeklyRent" className="text-sm font-medium">Weekly Rent</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="weeklyRent"
                  type="text"
                  inputMode="numeric"
                  value={formatForDisplay(weeklyRent)}
                  onChange={handleCurrencyChange(setWeeklyRent)}
                  placeholder="550"
                  disabled={disabled}
                  className="pl-7"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="occupancyRate" className="text-sm font-medium flex items-center gap-1">
                Occupancy
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Expected weeks of tenancy per year</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <div className="relative">
                <Input
                  id="occupancyRate"
                  type="number"
                  max="52"
                  value={occupancyRate}
                  onChange={(e) => setOccupancyRate(e.target.value)}
                  placeholder="52"
                  disabled={disabled}
                  className="pr-16"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">weeks</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Annual Expenses - Grouped Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Rates & Taxes */}
        <Card>
          <CardContent className="pt-6">
            <h4 className="font-semibold flex items-center gap-2 mb-4 text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              Rates & Taxes
            </h4>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="councilRates" className="text-sm">Council Rates</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    id="councilRates"
                    type="text"
                    inputMode="numeric"
                    value={formatForDisplay(councilRates)}
                    onChange={handleCurrencyChange(setCouncilRates)}
                    placeholder="2,000"
                    disabled={disabled}
                    className="pl-7 h-9"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="waterRates" className="text-sm">Water Rates</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    id="waterRates"
                    type="text"
                    inputMode="numeric"
                    value={formatForDisplay(waterRates)}
                    onChange={handleCurrencyChange(setWaterRates)}
                    placeholder="1,200"
                    disabled={disabled}
                    className="pl-7 h-9"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="landTax" className="text-sm flex items-center gap-1">
                  Land Tax (Annual)
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Use the calculator below to estimate based on state rates</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    id="landTax"
                    type="text"
                    inputMode="numeric"
                    value={formatForDisplay(landTax)}
                    onChange={handleCurrencyChange(setLandTax)}
                    placeholder="2,500"
                    disabled={disabled}
                    className="pl-7 h-9"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Land Tax Calculator */}
        <LandTaxCalculator
          propertyAddress={propertyAddress}
          detectedState={detectedState}
          purchasePrice={purchasePrice}
          landValue={landPrice ? landPrice.toString() : undefined}
          initialLandTax={parseFloat(landTax) || undefined}
          onLandTaxCalculated={handleLandTaxCalculated}
          disabled={disabled}
        />

        {/* Strata / Body Corp */}
        <Card>
          <CardContent className="pt-6">
            <h4 className="font-semibold flex items-center gap-2 mb-4 text-muted-foreground">
              <Building2 className="h-4 w-4" />
              Strata / Body Corp
            </h4>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="strataAdminFund" className="text-sm">Admin Fund</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    id="strataAdminFund"
                    type="text"
                    inputMode="numeric"
                    value={formatForDisplay(strataAdminFund)}
                    onChange={handleCurrencyChange(setStrataAdminFund)}
                    placeholder="1,800"
                    disabled={disabled}
                    className="pl-7 h-9"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="strataSinkingFund" className="text-sm">Sinking Fund</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    id="strataSinkingFund"
                    type="text"
                    inputMode="numeric"
                    value={formatForDisplay(strataSinkingFund)}
                    onChange={handleCurrencyChange(setStrataSinkingFund)}
                    placeholder="900"
                    disabled={disabled}
                    className="pl-7 h-9"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="strataSpecialLevies" className="text-sm">Special Levies</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    id="strataSpecialLevies"
                    type="text"
                    inputMode="numeric"
                    value={formatForDisplay(strataSpecialLevies)}
                    onChange={handleCurrencyChange(setStrataSpecialLevies)}
                    placeholder="300"
                    disabled={disabled}
                    className="pl-7 h-9"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Insurance */}
        <Card>
          <CardContent className="pt-6">
            <h4 className="font-semibold flex items-center gap-2 mb-4 text-muted-foreground">
              <Shield className="h-4 w-4" />
              Insurance
            </h4>
            <div className="space-y-1">
              <Label htmlFor="buildingLandlordInsurance" className="text-sm">Building & Landlord</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input
                  id="buildingLandlordInsurance"
                  type="text"
                  inputMode="numeric"
                  value={formatForDisplay(buildingLandlordInsurance)}
                  onChange={handleCurrencyChange(setBuildingLandlordInsurance)}
                  placeholder="1,800"
                  disabled={disabled}
                  className="pl-7"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Management */}
        <Card>
          <CardContent className="pt-6">
            <h4 className="font-semibold flex items-center gap-2 mb-4 text-muted-foreground">
              <Wrench className="h-4 w-4" />
              Management
            </h4>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="propertyManagementFees" className="text-sm">PM Fee (%)</Label>
                <div className="relative">
                  <Input
                    id="propertyManagementFees"
                    type="number"
                    step="0.1"
                    value={propertyManagementFees}
                    onChange={(e) => setPropertyManagementFees(e.target.value)}
                    placeholder="8"
                    disabled={disabled}
                    className="pr-8 h-9"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="lettingFees" className="text-sm flex items-center gap-1">
                  Letting Fees
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Usually 1 week's rent</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    id="lettingFees"
                    type="text"
                    inputMode="numeric"
                    value={formatForDisplay(lettingFees)}
                    onChange={handleCurrencyChange(setLettingFees)}
                    placeholder="= Weekly Rent"
                    disabled={disabled}
                    className="pl-7 h-9 bg-muted/30"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="repairsMaintenance" className="text-sm">Repairs & Maintenance</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    id="repairsMaintenance"
                    type="text"
                    inputMode="numeric"
                    value={formatForDisplay(repairsMaintenance)}
                    onChange={handleCurrencyChange(setRepairsMaintenance)}
                    placeholder="2,000"
                    disabled={disabled}
                    className="pl-7 h-9"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Net Position Summary */}
      <Card className={netAnnualIncome >= 0 ? 'border-success/50 bg-success/5' : 'border-destructive/50 bg-destructive/5'}>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Annual Net Position</p>
              <p className="text-xs text-muted-foreground">Income ${annualRent.toLocaleString('en-AU')} - Expenses ${totalAnnualExpenses.toLocaleString('en-AU')}</p>
            </div>
            <div className="text-right">
              <p className={`text-2xl font-bold ${netAnnualIncome >= 0 ? 'text-success' : 'text-destructive'}`}>
                {netAnnualIncome >= 0 ? '+' : ''}${netAnnualIncome.toLocaleString('en-AU')}/yr
              </p>
              <p className="text-sm text-muted-foreground">{grossYield}% gross yield</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
