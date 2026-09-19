import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Calculator, 
  ChevronDown, 
  ChevronRight, 
  AlertTriangle, 
  Phone, 
  Info, 
  CheckCircle,
  Building2,
  Calendar,
  DollarSign,
  MapPin,
  Sparkles,
  Loader2
} from 'lucide-react';
import { invokeSecureFunction, describeAuthError } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';
import { formatNumberWithCommas, removeCommas } from '@/hooks/useFormattedNumber';
import {
  DepreciationInput,
  DepreciationResult,
  DepreciationComp,
  PurchaseDateCategory,
  PropertyType,
  FinishStandard,
  NearestCity,
  CITY_LABELS,
  PROPERTY_TYPE_LABELS,
  FINISH_STANDARD_LABELS,
  PURCHASE_CATEGORY_LABELS,
} from '@/types/depreciation';
import { calculateDepreciation, formatDepreciationValue, roundToThousand } from '@/utils/depreciationCalculator';

interface DepreciationValueCalculatorProps {
  onApplyYear1?: (value: number) => void;
  onApplySchedule?: (schedule: Record<number, number>, method: 'dv' | 'pc') => void;
  defaultPurchasePrice?: number;
  defaultBuildYear?: number;
  isNewBuild?: boolean;
  className?: string;
}

export function DepreciationValueCalculator({
  onApplyYear1,
  onApplySchedule,
  defaultPurchasePrice,
  defaultBuildYear,
  isNewBuild = false,
  className = '',
}: DepreciationValueCalculatorProps) {
  const { toast } = useToast();
  
  // Form state
  const [purchasePrice, setPurchasePrice] = useState<string>(defaultPurchasePrice?.toString() || '');
  const [purchaseDate, setPurchaseDate] = useState<string>('');
  const [purchaseDateCategory, setPurchaseDateCategory] = useState<PurchaseDateCategory>(
    isNewBuild ? 'post_budget_brand_new' : 'post_budget_second_hand'
  );
  const [buildYear, setBuildYear] = useState<string>(defaultBuildYear?.toString() || new Date().getFullYear().toString());
  const [propertyType, setPropertyType] = useState<PropertyType>('house');
  const [finishStandard, setFinishStandard] = useState<FinishStandard>('medium');
  const [nearestCity, setNearestCity] = useState<NearestCity>('sydney_nsw');
  const [renovated, setRenovated] = useState(false);
  const [fullyFurnished, setFullyFurnished] = useState(false);
  
  // Calculation state
  const [isCalculating, setIsCalculating] = useState(false);
  const [result, setResult] = useState<DepreciationResult | null>(null);
  const [noMatchFound, setNoMatchFound] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  
  // Update defaults when props change
  useEffect(() => {
    if (defaultPurchasePrice) {
      setPurchasePrice(defaultPurchasePrice.toString());
    }
  }, [defaultPurchasePrice]);
  
  useEffect(() => {
    if (defaultBuildYear) {
      setBuildYear(defaultBuildYear.toString());
    }
  }, [defaultBuildYear]);
  
  useEffect(() => {
    if (isNewBuild) {
      setPurchaseDateCategory('post_budget_brand_new');
    }
  }, [isNewBuild]);
  
  // Check if excluded (renovated or fully furnished)
  const isExcluded = renovated || fullyFurnished;
  const isCommercialOrIndustrial = propertyType === 'commercial' || propertyType === 'industrial';
  
  // Validate form
  const isValid = 
    purchasePrice && 
    parseFloat(removeCommas(purchasePrice)) > 0 &&
    buildYear && 
    parseInt(buildYear) > 1900 &&
    parseInt(buildYear) <= new Date().getFullYear() + 5;
  
  // Handle calculation
  const handleCalculate = useCallback(async () => {
    if (!isValid || isExcluded) return;

    setIsCalculating(true);
    setNoMatchFound(false);
    setResult(null);
    
    try {
      console.group('🏠 Depreciation Calculator - Fetch & Calculate');
      // The fetch below goes through `invokeSecureFunction`, which owns auth.
      // This diagnostic used to read the session and access tokens out of
      // storage to log whether they were present — the last reason this file
      // touched either key. Auth state is not this component's to inspect.
      console.log('Fetching comps from database...');

      // IMPORTANT: Query via edge function to respect RLS
      const fetchBucket = async (typeToUse: PropertyType) => {
        return invokeSecureFunction('manage-templates', {
          operation: 'list',
          table: 'depreciation_comps',
          listOptions: {
            select: '*',
            filters: {
              renovated: false,
              fully_furnished: false,
              purchase_date_category: purchaseDateCategory,
              property_type: typeToUse,
              finish_standard: finishStandard,
              nearest_city: nearestCity
            }
          }
        });
      };

      const MIN_MATCHES_FOR_CALC = 5;

      let result = await fetchBucket(propertyType);
      let comps = result.data?.records || [];
      let error = result.error;

      // If townhouse is selected but there is no townhouse dataset, fall back to house bucket.
      if (!error && comps.length < MIN_MATCHES_FOR_CALC && propertyType === 'townhouse') {
        console.log('🔄 Townhouse selected but insufficient townhouse comps; falling back to house bucket query.');
        const fallback = await fetchBucket('house');
        comps = fallback.data?.records || [];
        error = fallback.error;
      }

      console.log('Database query result:', {
        error: error ? error.message : null,
        recordsReturned: comps?.length ?? 0,
      });

      if (error) {
        console.error('❌ Query error:', error);
        const authHint = describeAuthError(error.message);
        if (authHint) {
          console.groupEnd();
          toast({
            title: "Session expired",
            description: authHint,
            variant: "destructive",
          });
          return;
        }
        throw new Error(error.message);
      }
      
      if (!comps || comps.length === 0) {
        console.error('❌ No comps returned from database!');
        console.groupEnd();
        setNoMatchFound(true);
        toast({
          title: "No comps returned",
          description: "The depreciation comps query returned no records. This is usually a session/auth issue — try signing out and back in.",
          variant: "destructive",
        });
        return;
      }
      
      console.log('✅ Comps fetched successfully:', comps.length, 'records');
      console.log('Sample record keys:', Object.keys(comps[0]));
      
      const input: DepreciationInput = {
        purchasePrice: parseFloat(removeCommas(purchasePrice)),
        purchaseDate: purchaseDate ? new Date(purchaseDate) : undefined,
        purchaseDateCategory,
        buildYear: parseInt(buildYear),
        propertyType,
        finishStandard,
        nearestCity,
        renovated: false,
        fullyFurnished: false,
      };
      
      console.log('Calling calculateDepreciation with input:', input);
      
      // Calculate using matching algorithm
      const calcResult = calculateDepreciation(comps as DepreciationComp[] || [], input);
      
      console.log('Calculation result:', calcResult ? 'Success' : 'Failed (null)');
      console.groupEnd();
      
      if (!calcResult) {
        setNoMatchFound(true);
        toast({
          title: "No Similar Properties Found",
          description: "We couldn't find enough comparable properties for your criteria. Contact us for a verbal estimate.",
          variant: "destructive",
        });
      } else {
        setResult(calcResult);
        
        // Log the run via edge function
        await invokeSecureFunction('manage-templates', {
          operation: 'insert',
          table: 'depreciation_estimator_runs',
          data: {
            purchase_price: input.purchasePrice,
            purchase_date: input.purchaseDate?.toISOString().split('T')[0],
            purchase_date_category: input.purchaseDateCategory,
            build_year: input.buildYear,
            property_type: input.propertyType,
            finish_standard: input.finishStandard,
            nearest_city: input.nearestCity,
            renovated: false,
            fully_furnished: false,
            match_count: calcResult.matchCount,
            top_comp_ids: calcResult.topCompIds,
            confidence_score: calcResult.confidenceScore,
            dv_year1: calcResult.dv[0],
            dv_year2: calcResult.dv[1],
            dv_year3: calcResult.dv[2],
            dv_year4: calcResult.dv[3],
            dv_year5: calcResult.dv[4],
            dv_year6: calcResult.dv[5],
            dv_year7: calcResult.dv[6],
            dv_year8: calcResult.dv[7],
            dv_year9: calcResult.dv[8],
            dv_year10: calcResult.dv[9],
            pc_year1: calcResult.pc[0],
            pc_year2: calcResult.pc[1],
            pc_year3: calcResult.pc[2],
            pc_year4: calcResult.pc[3],
            pc_year5: calcResult.pc[4],
            pc_year6: calcResult.pc[5],
            pc_year7: calcResult.pc[6],
            pc_year8: calcResult.pc[7],
            pc_year9: calcResult.pc[8],
            pc_year10: calcResult.pc[9],
            dv_total: calcResult.dvTotal,
            pc_total: calcResult.pcTotal,
          }
        });
        
        toast({
          title: "Calculation Complete",
          description: `Found ${calcResult.matchCount} similar properties with ${calcResult.confidenceScore.toFixed(0)}% confidence.`,
        });
      }
    } catch (error) {
      console.error('Error calculating depreciation:', error);
      toast({
        title: "Calculation Failed",
        description: "An error occurred while calculating depreciation.",
        variant: "destructive",
      });
    } finally {
      setIsCalculating(false);
    }
  }, [isValid, isExcluded, purchasePrice, purchaseDate, purchaseDateCategory, buildYear, propertyType, finishStandard, nearestCity, toast]);
  
  // Handle apply year 1
  const handleApplyYear1 = (method: 'dv' | 'pc') => {
    if (!result || !onApplyYear1) return;
    const value = roundToThousand(method === 'dv' ? result.dv[0] : result.pc[0]);
    onApplyYear1(value);
    toast({
      title: "Year 1 Depreciation Applied",
      description: `${formatDepreciationValue(value)} (${method === 'dv' ? 'Diminishing Value' : 'Prime Cost'}) has been applied.`,
    });
  };
  
  // Handle apply full schedule
  const handleApplySchedule = (method: 'dv' | 'pc') => {
    if (!result || !onApplySchedule) return;
    const values = method === 'dv' ? result.dv : result.pc;
    const schedule: Record<number, number> = {};
    values.forEach((v, i) => {
      schedule[i + 1] = roundToThousand(v);
    });
    onApplySchedule(schedule, method);
    toast({
      title: "10-Year Schedule Applied",
      description: `Full ${method === 'dv' ? 'Diminishing Value' : 'Prime Cost'} schedule has been applied.`,
    });
  };
  
  return (
    <Card className={`border-primary/20 ${className}`}>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Depreciation Value Calculator</CardTitle>
        </div>
        <CardDescription>
          Estimate tax depreciation based on similar properties in our database
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Exclusion Warning */}
        {isExcluded && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Estimator Not Available</AlertTitle>
            <AlertDescription>
              This estimator is not available for renovated or fully furnished properties as it leads to inaccurate results. 
              Please request a full depreciation schedule report.
            </AlertDescription>
          </Alert>
        )}
        
        {/* Commercial/Industrial Note */}
        {isCommercialOrIndustrial && !isExcluded && (
          <Alert>
            <Phone className="h-4 w-4" />
            <AlertTitle>Commercial/Industrial Property</AlertTitle>
            <AlertDescription>
              Commercial and industrial properties can vary significantly. 
              We recommend contacting us for an accurate depreciation schedule.
            </AlertDescription>
          </Alert>
        )}
        
        {/* Form Fields */}
        <div className="grid gap-4">
          {/* Purchase Price */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              Property Purchase Price (AUD)
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                type="text"
                value={formatNumberWithCommas(purchasePrice)}
                onChange={(e) => setPurchasePrice(removeCommas(e.target.value))}
                placeholder="750,000"
                className="pl-7"
              />
            </div>
          </div>
          
          {/* Purchase Date */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              Property Purchase Date
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Please use the Contract Exchange date</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </div>
          
          {/* Purchase Date Category */}
          <div className="space-y-2">
            <Label>Purchase Date Category</Label>
            <RadioGroup
              value={purchaseDateCategory}
              onValueChange={(v) => setPurchaseDateCategory(v as PurchaseDateCategory)}
              className="grid gap-2"
            >
              {Object.entries(PURCHASE_CATEGORY_LABELS).map(([value, label]) => (
                <div key={value} className="flex items-center space-x-2">
                  <RadioGroupItem value={value} id={`pdc-${value}`} />
                  <Label htmlFor={`pdc-${value}`} className="font-normal cursor-pointer">
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          
          {/* Build Year */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Build Year
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Year construction commenced (approx). Council may assist.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Input
              type="number"
              value={buildYear}
              onChange={(e) => setBuildYear(e.target.value)}
              min={1900}
              max={new Date().getFullYear() + 5}
              placeholder="2020"
            />
          </div>
          
          {/* Property Type */}
          <div className="space-y-2">
            <Label>Property Type</Label>
            <RadioGroup
              value={propertyType}
              onValueChange={(v) => setPropertyType(v as PropertyType)}
              className="grid grid-cols-2 gap-2"
            >
              {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => (
                <div key={value} className="flex items-center space-x-2">
                  <RadioGroupItem value={value} id={`pt-${value}`} />
                  <Label htmlFor={`pt-${value}`} className="font-normal cursor-pointer text-sm">
                    {label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          
          {/* Standard of Finish */}
          <div className="space-y-2">
            <Label>Standard of Finish</Label>
            <RadioGroup
              value={finishStandard}
              onValueChange={(v) => setFinishStandard(v as FinishStandard)}
              className="grid grid-cols-3 gap-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="low" id="fs-low" />
                <Label htmlFor="fs-low" className="font-normal cursor-pointer">
                  Low
                  <span className="block text-xs text-muted-foreground">Basic fixtures</span>
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="medium" id="fs-medium" />
                <Label htmlFor="fs-medium" className="font-normal cursor-pointer">
                  Medium
                  <span className="block text-xs text-muted-foreground">Standard quality</span>
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="high" id="fs-high" />
                <Label htmlFor="fs-high" className="font-normal cursor-pointer">
                  High
                  <span className="block text-xs text-muted-foreground">Premium finishes</span>
                </Label>
              </div>
            </RadioGroup>
          </div>
          
          {/* Nearest City */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              Nearest City
            </Label>
            <Select value={nearestCity} onValueChange={(v) => setNearestCity(v as NearestCity)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <Separator />
          
          {/* Exclusion Toggles */}
          <div className="space-y-4">
            <Label className="text-muted-foreground">Exclusion Criteria</Label>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="renovated" className="font-normal cursor-pointer">
                Has this property been renovated?
              </Label>
              <Switch
                id="renovated"
                checked={renovated}
                onCheckedChange={setRenovated}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="furnished" className="font-normal cursor-pointer">
                Is this property fully furnished?
              </Label>
              <Switch
                id="furnished"
                checked={fullyFurnished}
                onCheckedChange={setFullyFurnished}
              />
            </div>
          </div>
        </div>
        
        <Separator />
        
        {/* Calculate Button */}
        <Button 
          onClick={handleCalculate}
          disabled={!isValid || isExcluded || isCalculating}
          className="w-full"
          size="lg"
        >
          {isCalculating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Calculating...
            </>
          ) : (
            <>
              <Calculator className="mr-2 h-4 w-4" />
              Calculate
            </>
          )}
        </Button>
        
        {/* Results Section */}
        {(result || noMatchFound) && (
          <div className="space-y-4 pt-4">
            <Separator />
            
            {noMatchFound ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>No Similar Properties Found</AlertTitle>
                <AlertDescription>
                  We couldn't find enough comparable properties matching your criteria. 
                  Contact us for a verbal estimate or request a full depreciation report.
                </AlertDescription>
              </Alert>
            ) : result && (
            <>
                {/* Property Age Context */}
                {result.propertyAge > 0 && (
                  <Alert className={result.isExtrapolated ? "border-brand-500/50 bg-brand-50/50 dark:bg-brand-950/20" : "border-info/50 bg-info/50 dark:bg-info/20"}>
                    <Info className="h-4 w-4" />
                    <AlertTitle className="text-sm font-medium">
                      {result.isExtrapolated ? 'Extrapolated Projection' : 'Age-Adjusted Projection'}
                    </AlertTitle>
                    <AlertDescription className="text-xs">
                      {result.isExtrapolated ? (
                        <>
                          This property is <strong>{result.propertyAge} years old</strong> (built {parseInt(buildYear)}). 
                          Most plant &amp; equipment has been fully depreciated. 
                          The projection below includes primarily Division 43 building allowance (2.5% p.a.) 
                          with minimal residual plant values.
                        </>
                      ) : (
                        <>
                          This property is <strong>{result.propertyAge} years old</strong> (built {parseInt(buildYear)}). 
                          The projection starts from <strong>Year {result.startingYear}</strong> of the depreciation curve, 
                          reflecting that Years 1-{result.propertyAge} have already been claimed by previous owners.
                        </>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Primary Output */}
                <div className="text-center space-y-2 py-4 bg-primary/5 rounded-lg">
                  <p className="text-sm text-muted-foreground uppercase tracking-wide">
                    {result.propertyAge > 0 
                      ? `Projected Claims ${result.projectionYears[0]}–${result.projectionYears[9]}`
                      : 'First 10 Year Total Claim'
                    }
                  </p>
                  <p className="text-4xl font-bold text-primary">
                    {formatDepreciationValue(result.dvTotal)}
                  </p>
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <Badge variant="secondary">
                      {result.matchCount} properties matched
                    </Badge>
                    <Badge variant="outline">
                      {result.confidenceScore.toFixed(0)}% confidence
                    </Badge>
                    {result.propertyAge > 0 && (
                      <Badge variant={result.isExtrapolated ? "destructive" : "default"} className="text-xs">
                        {result.propertyAge} years old
                      </Badge>
                    )}
                  </div>
                </div>
                
                {/* Show Breakdown Toggle */}
                <Collapsible open={showBreakdown} onOpenChange={setShowBreakdown}>
                  <CollapsibleTrigger asChild>
                    <Button variant="outline" className="w-full">
                      {showBreakdown ? (
                        <ChevronDown className="mr-2 h-4 w-4" />
                      ) : (
                        <ChevronRight className="mr-2 h-4 w-4" />
                      )}
                      Show Full 10 Year Breakdown
                    </Button>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent className="pt-4 space-y-4">
                    {/* Results Table */}
                    <div className="rounded-md border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Year</TableHead>
                            <TableHead className="text-right">Diminishing Value</TableHead>
                            <TableHead className="text-right">Prime Cost</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.dv.map((dv, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">
                                {result.projectionYears[i]}
                                {result.propertyAge > 0 && (
                                  <span className="text-xs text-muted-foreground ml-1">
                                    (Yr {result.startingYear + i})
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">{formatDepreciationValue(dv)}</TableCell>
                              <TableCell className="text-right">{formatDepreciationValue(result.pc[i])}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/50 font-semibold">
                            <TableCell>10 Year Total</TableCell>
                            <TableCell className="text-right text-primary">
                              {formatDepreciationValue(result.dvTotal)}
                            </TableCell>
                            <TableCell className="text-right text-primary">
                              {formatDepreciationValue(result.pcTotal)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                    
                    {/* Apply Buttons */}
                    {(onApplyYear1 || onApplySchedule) && (
                      <div className="grid grid-cols-2 gap-2">
                        {onApplyYear1 && (
                          <>
                            <Button 
                              variant="secondary" 
                              size="sm"
                              onClick={() => handleApplyYear1('dv')}
                            >
                              <CheckCircle className="mr-2 h-4 w-4" />
                              Apply DV Year 1
                            </Button>
                            <Button 
                              variant="secondary" 
                              size="sm"
                              onClick={() => handleApplyYear1('pc')}
                            >
                              <CheckCircle className="mr-2 h-4 w-4" />
                              Apply PC Year 1
                            </Button>
                          </>
                        )}
                        {onApplySchedule && (
                          <>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => handleApplySchedule('dv')}
                            >
                              <Sparkles className="mr-2 h-4 w-4" />
                              Apply DV Schedule
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => handleApplySchedule('pc')}
                            >
                              <Sparkles className="mr-2 h-4 w-4" />
                              Apply PC Schedule
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
                
                {/* DV vs PC Explainer */}
                <div className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-md">
                  <p className="font-medium mb-1">About DV vs Prime Cost:</p>
                  <p>
                    <strong>Diminishing Value (DV)</strong> provides higher deductions in earlier years, 
                    declining over time. <strong>Prime Cost (PC)</strong> spreads deductions evenly across 
                    the asset's effective life.
                  </p>
                </div>
              </>
            )}
            
            {/* Disclaimer */}
            <p className="text-xs text-muted-foreground italic">
              This estimate is for illustrative purposes only and should not be used for tax returns. 
              For compliant tax depreciation claims, a qualified quantity surveyor schedule is required.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
