/**
 * Land Tax Calculator Component
 * Allows users to calculate land tax based on state, owner type, and land value
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Calculator, Info, MapPin, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatNumberWithCommas, removeCommas } from '@/hooks/useFormattedNumber';
import { 
  calculateLandTax, 
  LandTaxOwnerType, 
  LandTaxResult,
  OWNER_TYPE_LABELS,
  getOwnerTypesForState,
  detectStateFromAddress,
  isWAMetroPostcode
} from '@/utils/landTaxCalculator';

interface LandTaxCalculatorProps {
  propertyAddress?: string;
  detectedState?: string;
  purchasePrice?: number;
  landValue?: string;
  initialLandTax?: number; // Restore calculated land tax when remounting
  onLandTaxCalculated: (landTax: number) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function LandTaxCalculator({
  propertyAddress = '',
  detectedState: externalState,
  purchasePrice,
  landValue: externalLandValue,
  initialLandTax,
  onLandTaxCalculated,
  disabled = false,
  compact = false,
}: LandTaxCalculatorProps) {
  // State selection
  const [selectedState, setSelectedState] = useState<string>(externalState || '');
  const [ownerType, setOwnerType] = useState<LandTaxOwnerType>('individual');
  const [landValue, setLandValue] = useState<string>(externalLandValue || '');
  const [isWAMetro, setIsWAMetro] = useState<boolean>(true);
  
  // Track if we restored from initialLandTax - skip auto-calculation until user changes something
  const [isRestoredFromInitial, setIsRestoredFromInitial] = useState<boolean>(
    () => initialLandTax !== undefined && initialLandTax > 0
  );
  
  // Calculation state
  const [isCalculating, setIsCalculating] = useState(false);
  const [result, setResult] = useState<LandTaxResult | null>(() => {
    // Initialize with previous calculated value if available
    if (initialLandTax !== undefined && initialLandTax > 0) {
      return {
        annualLandTax: initialLandTax,
        baseTax: 0,
        marginalTax: 0,
        fixedCharge: 0,
        mritAddon: 0,
        effectiveRate: 0,
        bracket: null,
        notes: 'Restored from previous calculation'
      };
    }
    return null;
  });
  const [error, setError] = useState<string | null>(null);

  // Auto-detect state from address
  useEffect(() => {
    if (propertyAddress && !externalState) {
      const detected = detectStateFromAddress(propertyAddress);
      if (detected) {
        setSelectedState(detected);
        
        // Check if WA metro from postcode
        if (detected === 'WA') {
          const postcodeMatch = propertyAddress.match(/\b(\d{4})\b/);
          if (postcodeMatch) {
            setIsWAMetro(isWAMetroPostcode(postcodeMatch[1]));
          }
        }
        
        // When state is auto-detected and we have a land value, clear restored flag to trigger calculation
        if (landValue && parseFloat(removeCommas(landValue)) > 0) {
          setIsRestoredFromInitial(false);
        }
      }
    }
  }, [propertyAddress, externalState]);

  // Use external state if provided
  useEffect(() => {
    if (externalState) {
      setSelectedState(externalState);
    }
  }, [externalState]);

  // Use purchase price as default land value if not set
  useEffect(() => {
    if (purchasePrice && !landValue) {
      // Default estimate: land is ~40-60% of property value
      const estimatedLandValue = Math.round(purchasePrice * 0.5);
      setLandValue(estimatedLandValue.toString());
      
      // If we have a detected state and are setting land value from purchase price,
      // clear the restored flag to allow auto-calculation (fixes PDF upload tab issue)
      if (selectedState && isRestoredFromInitial) {
        setIsRestoredFromInitial(false);
      }
    }
  }, [purchasePrice, landValue, selectedState, isRestoredFromInitial]);

  // Update land value from external
  useEffect(() => {
    if (externalLandValue) {
      setLandValue(externalLandValue);
    }
  }, [externalLandValue]);

  // Available owner types for selected state
  const availableOwnerTypes = getOwnerTypesForState(selectedState);

  // Reset owner type if not available for new state
  useEffect(() => {
    if (selectedState && !availableOwnerTypes.includes(ownerType)) {
      setOwnerType(availableOwnerTypes[0] || 'individual');
    }
  }, [selectedState, availableOwnerTypes, ownerType]);

  const handleCalculate = useCallback(async () => {
    if (!selectedState || !landValue) {
      setError('Please select a state and enter a land value.');
      return;
    }

    const numericLandValue = parseFloat(removeCommas(landValue)) || 0;
    if (numericLandValue <= 0) {
      setError('Land value must be greater than zero.');
      return;
    }

    setIsCalculating(true);
    setError(null);

    try {
      const calcResult = await calculateLandTax({
        state: selectedState,
        ownerType,
        taxableLandValue: numericLandValue,
        isWAMetro: selectedState === 'WA' ? isWAMetro : undefined,
      });

      setResult(calcResult);
      onLandTaxCalculated(calcResult.annualLandTax);
    } catch (err) {
      console.error('Land tax calculation error:', err);
      setError('Failed to calculate land tax. Please try again.');
    } finally {
      setIsCalculating(false);
    }
  }, [selectedState, ownerType, landValue, isWAMetro, onLandTaxCalculated]);

  // Auto-calculate when inputs change (debounced)
  // Skip auto-calculation if we restored from initialLandTax to prevent overwriting
  useEffect(() => {
    // If restored from initial value, skip auto-calculation until user explicitly changes something
    if (isRestoredFromInitial) {
      return;
    }
    
    const numericValue = parseFloat(removeCommas(landValue)) || 0;
    if (selectedState && numericValue > 0) {
      const timer = setTimeout(() => {
        handleCalculate();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [selectedState, ownerType, landValue, isWAMetro, isRestoredFromInitial]);

  const handleLandValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = removeCommas(e.target.value);
    if (rawValue === '' || /^\d*\.?\d*$/.test(rawValue)) {
      setLandValue(rawValue);
      // Clear restored flag when user manually changes land value - allow auto-calculation
      if (isRestoredFromInitial) {
        setIsRestoredFromInitial(false);
      }
    }
  };

  const states = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

  // Handlers that clear restored flag to allow auto-calculation
  const handleStateChange = useCallback((value: string) => {
    setSelectedState(value);
    if (isRestoredFromInitial) setIsRestoredFromInitial(false);
  }, [isRestoredFromInitial]);

  const handleOwnerTypeChange = useCallback((value: LandTaxOwnerType) => {
    setOwnerType(value);
    if (isRestoredFromInitial) setIsRestoredFromInitial(false);
  }, [isRestoredFromInitial]);

  const handleWAMetroChange = useCallback((checked: boolean) => {
    setIsWAMetro(checked);
    if (isRestoredFromInitial) setIsRestoredFromInitial(false);
  }, [isRestoredFromInitial]);

  if (compact) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Land Tax Calculator</span>
          {result && result.annualLandTax > 0 && (
            <Badge variant="secondary" className="ml-auto">
              ${result.annualLandTax.toLocaleString('en-AU')}/yr
            </Badge>
          )}
          {selectedState === 'NT' && (
            <Badge variant="outline" className="ml-auto">No Land Tax</Badge>
          )}
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <Select value={selectedState} onValueChange={handleStateChange} disabled={disabled}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              {states.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={ownerType} onValueChange={(v) => handleOwnerTypeChange(v as LandTaxOwnerType)} disabled={disabled}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Owner Type" />
            </SelectTrigger>
            <SelectContent>
              {availableOwnerTypes.map(type => (
                <SelectItem key={type} value={type}>
                  {type === 'individual' ? 'Individual' : 
                   type === 'company_trust' ? 'Company/Trust' :
                   type === 'trust' ? 'Trust' : 'Absentee'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
          <Input
            type="text"
            inputMode="numeric"
            value={formatNumberWithCommas(landValue)}
            onChange={handleLandValueChange}
            placeholder="Taxable Land Value"
            disabled={disabled}
            className="pl-7 h-8 text-sm"
          />
        </div>

        {selectedState === 'WA' && (
          <div className="flex items-center gap-2">
            <Switch
              checked={isWAMetro}
              onCheckedChange={handleWAMetroChange}
              disabled={disabled}
            />
            <Label className="text-xs text-muted-foreground">Perth Metro (MRIT applies)</Label>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>
    );
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-semibold flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            Land Tax Calculator
          </h4>
          {isCalculating && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {result && !isCalculating && result.annualLandTax > 0 && (
            <CheckCircle2 className="h-4 w-4 text-success" />
          )}
        </div>

        <div className="space-y-4">
          {/* State & Owner Type Row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm flex items-center gap-1">
                State
                {propertyAddress && selectedState && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <MapPin className="h-3 w-3 text-success" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Auto-detected from address</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </Label>
              <Select value={selectedState} onValueChange={handleStateChange} disabled={disabled}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {states.map(s => (
                    <SelectItem key={s} value={s}>
                      {s} {s === 'NT' ? '(No Land Tax)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm flex items-center gap-1">
                Owner Type
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>Different owner types have different thresholds and rates. Trusts and companies often have lower thresholds.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <Select 
                value={ownerType} 
                onValueChange={(v) => handleOwnerTypeChange(v as LandTaxOwnerType)} 
                disabled={disabled || !selectedState}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {availableOwnerTypes.map(type => (
                    <SelectItem key={type} value={type}>
                      {OWNER_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Land Value Input */}
          <div className="space-y-1.5">
            <Label className="text-sm flex items-center gap-1">
              Taxable Land Value
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>The unimproved value of the land (not including buildings). Check your council rates notice or state valuation.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                type="text"
                inputMode="numeric"
                value={formatNumberWithCommas(landValue)}
                onChange={handleLandValueChange}
                placeholder="Enter land value"
                disabled={disabled}
                className="pl-7"
              />
            </div>
            {purchasePrice && !externalLandValue && (
              <p className="text-xs text-muted-foreground">
                Estimated from purchase price (typically 40-60% of property value)
              </p>
            )}
          </div>

          {/* WA Metro Toggle */}
          {selectedState === 'WA' && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Perth Metropolitan Area</Label>
                <p className="text-xs text-muted-foreground">
                  MRIT applies: 0.14¢ per $1 above $300k
                </p>
              </div>
              <Switch
                checked={isWAMetro}
                onCheckedChange={handleWAMetroChange}
                disabled={disabled}
              />
            </div>
          )}

          {/* Calculate Button */}
          <Button 
            onClick={handleCalculate}
            disabled={disabled || isCalculating || !selectedState || !landValue}
            className="w-full gap-2"
            variant="secondary"
          >
            {isCalculating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Calculating...
              </>
            ) : (
              <>
                <Calculator className="h-4 w-4" />
                Calculate Land Tax
              </>
            )}
          </Button>

          {/* Error Display */}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          )}

          {/* Result Display */}
          {result && !error && (
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Annual Land Tax</span>
                <span className="text-lg font-bold text-primary">
                  ${result.annualLandTax.toLocaleString('en-AU')}
                </span>
              </div>
              
              {result.annualLandTax > 0 && (
                <>
                  <div className="text-xs text-muted-foreground space-y-1">
                    {result.baseTax > 0 && (
                      <div className="flex justify-between">
                        <span>Base tax:</span>
                        <span>${result.baseTax.toLocaleString('en-AU')}</span>
                      </div>
                    )}
                    {result.marginalTax > 0 && (
                      <div className="flex justify-between">
                        <span>Marginal tax:</span>
                        <span>${result.marginalTax.toLocaleString('en-AU')}</span>
                      </div>
                    )}
                    {result.fixedCharge > 0 && (
                      <div className="flex justify-between">
                        <span>Fixed charge:</span>
                        <span>${result.fixedCharge.toLocaleString('en-AU')}</span>
                      </div>
                    )}
                    {result.mritAddon > 0 && (
                      <div className="flex justify-between">
                        <span>WA MRIT:</span>
                        <span>${result.mritAddon.toLocaleString('en-AU')}</span>
                      </div>
                    )}
                    <div className="flex justify-between pt-1 border-t">
                      <span>Effective rate:</span>
                      <span>{result.effectiveRate.toFixed(3)}%</span>
                    </div>
                  </div>
                  {result.notes && (
                    <p className="text-xs text-muted-foreground italic mt-2">{result.notes}</p>
                  )}
                </>
              )}
              
              {result.annualLandTax === 0 && selectedState !== 'NT' && (
                <p className="text-xs text-muted-foreground">
                  Land value is below the tax-free threshold for {selectedState}.
                </p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
