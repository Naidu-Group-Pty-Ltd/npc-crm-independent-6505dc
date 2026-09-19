import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { 
  Collapsible, 
  CollapsibleContent, 
  CollapsibleTrigger 
} from '@/components/ui/collapsible';
import { ChevronDown, Home, DollarSign, Info, Users, User, Baby, TrendingDown, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { HemBreakdown } from '@/utils/borrowingCapacityCalculations';

interface NegativePropertyCashFlow {
  address: string;
  monthlyCashflow: number;
}

interface ExpensesSectionProps {
  expenseMethod: 'hem' | 'declared' | 'hybrid';
  hemBenchmark: number;
  hemBreakdown?: HemBreakdown;
  declaredExpenses: number;
  baseExpenses: number;
  negativePropertyCashFlows: NegativePropertyCashFlow[];
  totalNegativeCashFlows: number;
  effectiveExpenses: number;
  onMethodChange?: (method: 'hem' | 'declared' | 'hybrid') => void;
  onDeclaredExpensesChange?: (value: number) => void;
}

export function ExpensesSection({
  expenseMethod,
  hemBenchmark,
  hemBreakdown,
  declaredExpenses,
  baseExpenses,
  negativePropertyCashFlows,
  totalNegativeCashFlows,
  effectiveExpenses,
  onMethodChange,
  onDeclaredExpensesChange,
}: ExpensesSectionProps) {
  const [isOpen, setIsOpen] = useState(true);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Home className="h-4 w-4 text-warning" />
                Living Expenses
              </CardTitle>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Monthly</p>
                  <p className="text-sm font-semibold text-warning">{formatCurrency(effectiveExpenses)}</p>
                </div>
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* Method Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium flex items-center gap-2">
                Expense Calculation Method
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>HEM (Household Expenditure Measure) is the industry benchmark. 
                      Lenders typically use the higher of HEM or declared expenses.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <RadioGroup 
                value={expenseMethod} 
                onValueChange={(v) => onMethodChange?.(v as 'hem' | 'declared' | 'hybrid')}
                className="space-y-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="hem" id="hem" />
                  <Label htmlFor="hem" className="font-normal cursor-pointer flex items-center gap-2">
                    HEM Benchmark
                    <Badge variant="outline" className="text-xs">
                      {formatCurrency(hemBenchmark)}/mo
                    </Badge>
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="declared" id="declared" />
                  <Label htmlFor="declared" className="font-normal cursor-pointer">
                    Declared Expenses
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="hybrid" id="hybrid" />
                  <Label htmlFor="hybrid" className="font-normal cursor-pointer flex items-center gap-2">
                    Higher of Both
                    <Badge variant="secondary" className="text-xs">Recommended</Badge>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* HEM Benchmark Display with Breakdown */}
            <div className="p-3 rounded-lg bg-muted/50 border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">HEM Benchmark</p>
                  <p className="text-sm font-medium">{formatCurrency(hemBenchmark)}/month</p>
                </div>
                <Badge variant="outline" className="text-xs">
                  Based on household profile
                </Badge>
              </div>
              
              {/* HEM Breakdown Details */}
              {hemBreakdown && (
                <div className="pt-2 border-t border-border/50">
                  <p className="text-xs text-muted-foreground mb-2 font-medium">HEM Calculation Breakdown:</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      {hemBreakdown.householdType === 'couple' ? (
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className="text-muted-foreground">Household:</span>
                      <span className="font-medium capitalize">{hemBreakdown.householdType}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Baby className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Dependants:</span>
                      <span className="font-medium">{hemBreakdown.dependentsCount}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Base HEM:</span>
                      <span className="font-medium">{formatCurrency(hemBreakdown.baseHem)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Income Tier:</span>
                      <span className="font-medium">{hemBreakdown.incomeTier}</span>
                    </div>
                  </div>
                  {hemBreakdown.multiplier > 1 && (
                    <div className="mt-2 p-2 rounded bg-primary/5 border border-primary/10">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-primary">{hemBreakdown.multiplier}x multiplier</span> applied 
                        for {hemBreakdown.incomeTier} income tier
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatCurrency(hemBreakdown.baseHem)} × {hemBreakdown.multiplier} = {formatCurrency(hemBreakdown.finalHem)}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Declared Expenses Input */}
            {(expenseMethod === 'declared' || expenseMethod === 'hybrid') && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Declared Monthly Expenses</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="number"
                    value={declaredExpenses || ''}
                    onChange={(e) => onDeclaredExpensesChange?.(Number(e.target.value))}
                    className="pl-9"
                    placeholder="0"
                  />
                </div>
              </div>
            )}

            {/* Effective Expenses */}
            <div className="pt-3 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Base Living Expenses</p>
                  <p className="text-xs text-muted-foreground">
                    {expenseMethod === 'hybrid' ? 'Higher of HEM or Declared' : 
                     expenseMethod === 'hem' ? 'HEM Benchmark' : 'Declared'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{formatCurrency(baseExpenses)}</p>
                  <p className="text-xs text-muted-foreground">/month</p>
                </div>
              </div>
            </div>

            {/* Negative Property Cash Flows - Layered on top */}
            {negativePropertyCashFlows.length > 0 && (
              <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20 space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-destructive" />
                  <p className="text-sm font-medium text-destructive">Negative Property Cash Flows</p>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <AlertTriangle className="h-3.5 w-3.5 text-destructive/70" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>Properties with negative cash flow reduce borrowing capacity. 
                        These amounts are added to your total expenses.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                
                <div className="space-y-2">
                  {negativePropertyCashFlows.map((item, index) => (
                    <div key={index} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground truncate max-w-[200px]">{item.address}</span>
                      <span className="font-medium text-destructive">-{formatCurrency(item.monthlyCashflow)}/mo</span>
                    </div>
                  ))}
                </div>
                
                <div className="pt-2 border-t border-destructive/20 flex items-center justify-between">
                  <span className="text-xs font-medium text-destructive">Total Negative Cash Flow</span>
                  <span className="font-semibold text-destructive">-{formatCurrency(totalNegativeCashFlows)}/mo</span>
                </div>
              </div>
            )}

            {/* Total Effective Expenses */}
            <div className="pt-3 border-t border-border bg-muted/30 -mx-6 px-6 py-3 -mb-6 rounded-b-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Total Monthly Expenses</p>
                  <p className="text-xs text-muted-foreground">
                    Base expenses {negativePropertyCashFlows.length > 0 ? '+ negative property cash flows' : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-warning">{formatCurrency(effectiveExpenses)}</p>
                  <p className="text-xs text-muted-foreground">/month</p>
                </div>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
