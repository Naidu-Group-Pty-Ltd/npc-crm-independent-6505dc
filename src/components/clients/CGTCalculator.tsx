import { useState, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Calculator,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Info,
  Home,
} from 'lucide-react';
import { calculateCGT, type CGTInputs, type CGTCostBaseItem, type CGTResult } from '@/lib/cgtCalculations';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface CGTCalculatorProps {
  property: {
    id: string;
    address: string;
    value: number | null;
    purchase_price?: number | null;
    purchase_date?: string | null;
    property_type: string;
    ownership_percentage: number | null;
    loan_remaining: number | null;
  };
  clientGrossAnnualIncome: number;
}

const DEFAULT_COST_ITEMS: CGTCostBaseItem[] = [
  { label: 'Stamp Duty', amount: 0 },
  { label: 'Legal / Conveyancing Fees', amount: 0 },
  { label: 'Renovations / Improvements', amount: 0 },
];

const DEFAULT_SELLING_COSTS: CGTCostBaseItem[] = [
  { label: 'Agent Commission', amount: 0 },
  { label: 'Marketing Costs', amount: 0 },
  { label: 'Legal Fees (Sale)', amount: 0 },
];

function formatCurrency(value: number): string {
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(abs);
  return value < 0 ? `-${formatted}` : formatted;
}

export function CGTCalculator({ property, clientGrossAnnualIncome }: CGTCalculatorProps) {
  const [open, setOpen] = useState(false);

  const isOwnerOccupied = property.property_type === 'owner_occupied';

  // Form state
  const [salePrice, setSalePrice] = useState<number>(Number(property.value) || 0);
  const [purchasePrice, setPurchasePrice] = useState<number>(
    Number(property.purchase_price) || Number(property.value) || 0
  );
  const [purchaseDate, setPurchaseDate] = useState<string>(
    property.purchase_date || ''
  );
  const [saleDate, setSaleDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [ownershipPercentage, setOwnershipPercentage] = useState<number>(
    Number(property.ownership_percentage) || 100
  );
  const [grossIncome, setGrossIncome] = useState<number>(clientGrossAnnualIncome);
  const [isMainResidence, setIsMainResidence] = useState<boolean>(isOwnerOccupied);
  const [costBaseItems, setCostBaseItems] = useState<CGTCostBaseItem[]>(DEFAULT_COST_ITEMS);
  const [sellingCosts, setSellingCosts] = useState<CGTCostBaseItem[]>(DEFAULT_SELLING_COSTS);

  const updateCostItem = useCallback((index: number, field: 'label' | 'amount', value: string | number) => {
    setCostBaseItems(prev => prev.map((item, i) =>
      i === index ? { ...item, [field]: field === 'amount' ? Number(value) : value } : item
    ));
  }, []);

  const updateSellingCost = useCallback((index: number, field: 'label' | 'amount', value: string | number) => {
    setSellingCosts(prev => prev.map((item, i) =>
      i === index ? { ...item, [field]: field === 'amount' ? Number(value) : value } : item
    ));
  }, []);

  const addCostItem = useCallback(() => {
    setCostBaseItems(prev => [...prev, { label: '', amount: 0 }]);
  }, []);

  const removeCostItem = useCallback((index: number) => {
    setCostBaseItems(prev => prev.filter((_, i) => i !== index));
  }, []);

  const addSellingCost = useCallback(() => {
    setSellingCosts(prev => [...prev, { label: '', amount: 0 }]);
  }, []);

  const removeSellingCost = useCallback((index: number) => {
    setSellingCosts(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Calculate result
  const result: CGTResult | null = useMemo(() => {
    if (!purchaseDate || !saleDate || salePrice <= 0 || purchasePrice <= 0) return null;
    const inputs: CGTInputs = {
      salePrice,
      purchasePrice,
      purchaseDate,
      saleDate,
      costBaseAdditions: costBaseItems.filter(i => i.amount > 0),
      sellingCosts: sellingCosts.filter(i => i.amount > 0),
      ownershipPercentage,
      grossAnnualIncome: grossIncome,
      isMainResidence,
    };
    return calculateCGT(inputs);
  }, [salePrice, purchasePrice, purchaseDate, saleDate, costBaseItems, sellingCosts, ownershipPercentage, grossIncome, isMainResidence]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
          <Calculator className="h-3.5 w-3.5" />
          CGT
        </Button>
      </DialogTrigger>
      {/*
        The shell owns the bound and the body owns the scrolling.

        It used to state `max-h-[90vh]` on the shell AND `max-h-[calc(90vh-100px)]`
        on the ScrollArea inside it — two independent heights for one box, with
        the header charged at a flat 100px it does not cost. Whenever the header
        wrapped, the two disagreed and the scroller's track was drawn past the
        dialog's own rounded bottom edge, which is the "scroll bar extends beyond
        the window frame" the 19 Sep audit reported. A flex column with
        `min-h-0 flex-1` takes the second height out of the picture entirely: the
        body gets exactly the room the header leaves, whatever the header does.
      */}
      <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-3xl flex-col overflow-hidden p-0 sm:w-auto">
        <DialogHeader className="shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Calculator className="h-5 w-5" />
            Capital Gains Tax Calculator
          </DialogTitle>
          <DialogDescription className="text-xs">
            {property.address}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 px-4 sm:px-6 pb-4 sm:pb-6">
          <div className="space-y-5">
            {/* Main Residence Toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-2">
                <Home className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Main Residence (PPOR)</p>
                  <p className="text-xs text-muted-foreground">Generally exempt from CGT</p>
                </div>
              </div>
              <Switch checked={isMainResidence} onCheckedChange={setIsMainResidence} />
            </div>

            {isMainResidence && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-success/30 bg-success/10 dark:bg-success/20 dark:border-success/30">
                <CheckCircle2 className="h-4 w-4 text-success mt-0.5 flex-shrink-0" />
                <p className="text-xs text-success dark:text-success">
                  As your main residence, this property is generally exempt from CGT. 
                  The calculator below will show $0 CGT. Toggle this off if the property 
                  was ever rented out or used for income-producing purposes (partial exemption may apply).
                </p>
              </div>
            )}

            {/* Sale & Purchase Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium">Estimated Sale Price</Label>
                <CurrencyInput
                  value={salePrice || null}
                  onValueChange={(v) => setSalePrice(v ?? 0)}
                  placeholder="800,000"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label className="text-xs font-medium">Purchase Price</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                      <TooltipContent><p className="text-xs max-w-[200px]">Original purchase price. Override if different from stored value.</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <CurrencyInput
                  value={purchasePrice || null}
                  onValueChange={(v) => setPurchasePrice(v ?? 0)}
                  placeholder="600,000"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Purchase Date</Label>
                <Input
                  type="date"
                  value={purchaseDate}
                  onChange={e => setPurchaseDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Sale Date</Label>
                <Input
                  type="date"
                  value={saleDate}
                  onChange={e => setSaleDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium">Ownership %</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={ownershipPercentage || ''}
                  onChange={e => setOwnershipPercentage(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1">
                  <Label className="text-xs font-medium">Gross Annual Income</Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                      <TooltipContent><p className="text-xs max-w-[200px]">Used to determine marginal tax rate for CGT calculation.</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <CurrencyInput
                  value={grossIncome || null}
                  onValueChange={(v) => setGrossIncome(v ?? 0)}
                />
              </div>
            </div>

            {/* Cost Base Additions */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Cost Base Additions</Label>
                <Button variant="outline" size="sm" onClick={addCostItem} className="h-7 text-xs">
                  <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                Costs incurred when buying or improving the property (increases your cost base, reducing CGT).
              </p>
              <div className="space-y-2">
                {costBaseItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      className="flex-1 h-8 text-xs"
                      value={item.label}
                      onChange={e => updateCostItem(i, 'label', e.target.value)}
                      placeholder="Description"
                    />
                    <CurrencyInput
                      className="w-32 h-8 text-xs"
                      value={item.amount || null}
                      onValueChange={(v) => updateCostItem(i, 'amount', v ?? 0)}
                      placeholder="0"
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => removeCostItem(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Selling Costs */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Selling Costs</Label>
                <Button variant="outline" size="sm" onClick={addSellingCost} className="h-7 text-xs">
                  <Plus className="h-3 w-3 mr-1" /> Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                Costs of selling the property (agent fees, marketing, legal). These reduce your capital gain.
              </p>
              <div className="space-y-2">
                {sellingCosts.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      className="flex-1 h-8 text-xs"
                      value={item.label}
                      onChange={e => updateSellingCost(i, 'label', e.target.value)}
                      placeholder="Description"
                    />
                    <CurrencyInput
                      className="w-32 h-8 text-xs"
                      value={item.amount || null}
                      onValueChange={(v) => updateSellingCost(i, 'amount', v ?? 0)}
                      placeholder="0"
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => removeSellingCost(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Results */}
            {result ? (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  CGT Estimate
                </h3>

                {/* Key metrics row */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Card className="border-0 shadow-none bg-muted/50">
                    <CardContent className="p-3 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Capital Gain</p>
                      <p className={`text-base sm:text-lg font-bold ${result.isCapitalLoss ? 'text-destructive' : 'text-success'}`}>
                        {formatCurrency(result.grossCapitalGain)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-0 shadow-none bg-muted/50">
                    <CardContent className="p-3 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Estimated CGT</p>
                      <p className={`text-base sm:text-lg font-bold ${result.estimatedCGT > 0 ? 'text-warning' : 'text-success'}`}>
                        {formatCurrency(result.estimatedCGT)}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-0 shadow-none bg-muted/50">
                    <CardContent className="p-3 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Net Proceeds</p>
                      <p className="text-base sm:text-lg font-bold">{formatCurrency(result.netProceeds)}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Detailed breakdown */}
                <Card>
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-3 space-y-1.5 text-xs">
                    <div className="flex justify-between gap-3 [&>span:last-child]:whitespace-nowrap [&>span:last-child]:tabular-nums">
                      <span>Estimated Sale Price</span>
                      <span className="font-medium">{formatCurrency(salePrice)}</span>
                    </div>
                    <div className="flex justify-between gap-3 [&>span:last-child]:whitespace-nowrap [&>span:last-child]:tabular-nums">
                      <span>Total Cost Base</span>
                      <span className="font-medium">{formatCurrency(result.totalCostBase)}</span>
                    </div>
                    <Separator className="my-1" />
                    <div className="flex justify-between gap-3 [&>span:last-child]:whitespace-nowrap [&>span:last-child]:tabular-nums">
                      <span>Gross Capital Gain</span>
                      <span className={`font-medium ${result.isCapitalLoss ? 'text-destructive' : 'text-success'}`}>
                        {formatCurrency(result.grossCapitalGain)}
                      </span>
                    </div>
                    {ownershipPercentage < 100 && (
                      <div className="flex justify-between gap-3 [&>span:last-child]:whitespace-nowrap [&>span:last-child]:tabular-nums">
                        <span>Your Share ({ownershipPercentage}%)</span>
                        <span className="font-medium">{formatCurrency(result.yourShareOfGain)}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="flex items-center gap-1">
                        Holding Period
                        {result.eligibleForDiscount && (
                          <Badge variant="secondary" className="text-[10px] h-4 px-1">50% Discount</Badge>
                        )}
                      </span>
                      <span className="font-medium">
                        {Math.floor(result.holdingPeriodMonths / 12)}y {result.holdingPeriodMonths % 12}m
                      </span>
                    </div>
                    {result.eligibleForDiscount && !result.isMainResidence && (
                      <div className="flex justify-between text-success">
                        <span>CGT Discount (50%)</span>
                        <span className="font-medium">-{formatCurrency(result.cgtDiscount)}</span>
                      </div>
                    )}
                    {result.isMainResidence && (
                      <div className="flex justify-between text-success">
                        <span>Main Residence Exemption</span>
                        <span className="font-medium">Full Exemption</span>
                      </div>
                    )}
                    <Separator className="my-1" />
                    <div className="flex justify-between font-semibold">
                      <span>Taxable Capital Gain</span>
                      <span>{formatCurrency(result.taxableCapitalGain)}</span>
                    </div>
                    <div className="flex justify-between gap-3 [&>span:last-child]:whitespace-nowrap [&>span:last-child]:tabular-nums">
                      <span>Marginal Tax Rate (incl. Medicare)</span>
                      <span className="font-medium">{(result.marginalTaxRate * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex justify-between gap-3 [&>span:last-child]:whitespace-nowrap [&>span:last-child]:tabular-nums">
                      <span>Effective CGT Rate on Gain</span>
                      <span className="font-medium">{(result.effectiveCGTRate * 100).toFixed(1)}%</span>
                    </div>
                    <Separator className="my-1" />
                    <div className="flex justify-between gap-3 text-sm font-semibold [&>span:last-child]:whitespace-nowrap [&>span:last-child]:tabular-nums">
                      <span>Estimated CGT Payable</span>
                      <span className={result.estimatedCGT > 0 ? 'text-warning' : 'text-success'}>
                        {formatCurrency(result.estimatedCGT)}
                      </span>
                    </div>
                    {result.totalSellingCosts > 0 && (
                      <div className="flex justify-between gap-3 [&>span:last-child]:whitespace-nowrap [&>span:last-child]:tabular-nums">
                        <span>Total Selling Costs</span>
                        <span className="font-medium">{formatCurrency(result.totalSellingCosts)}</span>
                      </div>
                    )}
                    <div className="flex justify-between gap-3 border-t pt-1 text-sm font-semibold [&>span:last-child]:whitespace-nowrap [&>span:last-child]:tabular-nums">
                      <span>Net Proceeds (After CGT & Costs)</span>
                      <span>{formatCurrency(result.netProceeds)}</span>
                    </div>
                    {property.loan_remaining && Number(property.loan_remaining) > 0 && (
                      <div className="flex justify-between gap-3 text-muted-foreground [&>span:last-child]:whitespace-nowrap [&>span:last-child]:tabular-nums">
                        <span>Less Loan Remaining</span>
                        <span>-{formatCurrency(Number(property.loan_remaining))}</span>
                      </div>
                    )}
                    {property.loan_remaining && Number(property.loan_remaining) > 0 && (
                      <div className="flex justify-between gap-3 text-sm font-semibold [&>span:last-child]:whitespace-nowrap [&>span:last-child]:tabular-nums">
                        <span>Cash in Hand</span>
                        <span>{formatCurrency(result.netProceeds - Number(property.loan_remaining))}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Capital Loss Notice */}
                {result.isCapitalLoss && (
                  <div className="flex items-start gap-2 p-3 rounded-lg border border-brand-200 bg-brand-50 dark:bg-brand-950/20 dark:border-brand-900">
                    <TrendingDown className="h-4 w-4 text-brand-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-brand-800 dark:text-brand-300">
                      This sale would result in a <strong>capital loss</strong> of {formatCurrency(Math.abs(result.grossCapitalGain))}. 
                      Capital losses can be carried forward and offset against future capital gains.
                    </p>
                  </div>
                )}

                {/* Disclaimer */}
                <div className="flex items-start gap-2 p-3 rounded-lg border bg-muted/30">
                  <AlertTriangle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    This is an estimate only based on 2025-26 Australian tax rates. It does not account for 
                    depreciation recapture, partial exemptions, foreign resident withholding, or other complex 
                    CGT scenarios. Always consult a qualified tax accountant before making decisions based on 
                    these figures.
                  </p>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <Calculator className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Enter sale price, purchase price, and dates to calculate CGT</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
