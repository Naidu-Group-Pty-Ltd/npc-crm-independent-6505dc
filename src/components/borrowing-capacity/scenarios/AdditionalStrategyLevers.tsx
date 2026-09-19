import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronDown,
  TrendingUp,
  Wallet,
  Clock,
  ShieldCheck,
  Building,
  Layers,
  Network,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────

/** Phase G1 — per-property valuation override entry. */
export interface ValuationOverride {
  propertyId: string;
  /** New valuation in AUD */
  newValue: number;
  /** Methodology basis — drives PDF audit watermark */
  basis: 'manual' | 'desktop' | 'avm' | 'comparable_sales';
  /** Free-text justification (e.g. agent name, comparable address) */
  source: string;
}

/** Phase G2 — cross-collateralised pool release configuration. */
export interface CrossCollatPoolState {
  enabled: boolean;
  /** Which properties to pool (subset of portfolio) */
  propertyIds: Set<string>;
  /** Target blended LVR across the pool (0–0.95) */
  blendedTargetLVR: number;
  /** Per-security lender ceiling (default 0.95) */
  lenderMaxLVR: number;
  /** Allocation strategy — highest_equity_first cleans up healthiest securities first */
  allocationStrategy: 'highest_equity_first' | 'pro_rata';
}

export interface AdditionalStrategyState {
  incomeGrowthPercent: number;
  expenseReductionPercent: number;
  loanTermAdjustment: number; // years delta from base
  dtiCapEnabled: boolean;
  dtiCapValue: number;
  portfolioSellPropertyIds: Set<string>;
  portfolioSellReinvest: boolean;
  /** Phase G1 — valuation overrides keyed by property id */
  valuationOverrides: Map<string, ValuationOverride>;
  /** Phase G2 — cross-collateralised pool */
  crossCollatPool: CrossCollatPoolState;
}

export const DEFAULT_ADDITIONAL_STRATEGY: AdditionalStrategyState = {
  incomeGrowthPercent: 0,
  expenseReductionPercent: 0,
  loanTermAdjustment: 0,
  dtiCapEnabled: false,
  dtiCapValue: 6,
  portfolioSellPropertyIds: new Set(),
  portfolioSellReinvest: false,
  valuationOverrides: new Map(),
  crossCollatPool: {
    enabled: false,
    propertyIds: new Set(),
    blendedTargetLVR: 0.80,
    lenderMaxLVR: 0.95,
    allocationStrategy: 'highest_equity_first',
  },
};

interface PropertyForSale {
  id: string;
  address: string;
  current_value: number;
  loan_remaining: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ── Component ──────────────────────────────────────────

interface AdditionalStrategyLeversProps {
  strategy: AdditionalStrategyState;
  onStrategyChange: (updates: Partial<AdditionalStrategyState>) => void;
  openSections: Record<string, boolean>;
  onToggleSection: (key: string) => void;
  baseLoanTermYears: number;
  properties: PropertyForSale[];
  baseGrossIncome: number;
}

export function AdditionalStrategyLevers({
  strategy,
  onStrategyChange,
  openSections,
  onToggleSection,
  baseLoanTermYears,
  properties,
  baseGrossIncome,
}: AdditionalStrategyLeversProps) {
  const sellProperties = properties.filter(p => strategy.portfolioSellPropertyIds.has(p.id));
  const totalSellEquityFreed = sellProperties.reduce((sum, p) => 
    sum + Math.max(0, p.current_value - p.loan_remaining), 0);
  const totalSellValue = sellProperties.reduce((sum, p) => sum + p.current_value, 0);

  return (
    <>
      {/* ═══ LEVER 5: Income Growth Modeling ═══ */}
      <Card>
        <Collapsible open={openSections.incomeGrowth} onOpenChange={() => onToggleSection('incomeGrowth')}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Income Growth Modeling
                </CardTitle>
                <div className="flex items-center gap-2">
                  {strategy.incomeGrowthPercent !== 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {strategy.incomeGrowthPercent >= 0 ? '+' : ''}{strategy.incomeGrowthPercent}%
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${openSections.incomeGrowth ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                Model expected income changes — a raise, second income, or new rental stream.
              </p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Income Adjustment</span>
                  <span className={`font-medium ${strategy.incomeGrowthPercent >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {strategy.incomeGrowthPercent >= 0 ? '+' : ''}{strategy.incomeGrowthPercent}%
                    <span className="text-muted-foreground ml-1 text-xs">
                      ({formatCurrency(baseGrossIncome * (1 + strategy.incomeGrowthPercent / 100))}/yr)
                    </span>
                  </span>
                </div>
                <Slider
                  value={[strategy.incomeGrowthPercent]}
                  onValueChange={([val]) => onStrategyChange({ incomeGrowthPercent: val })}
                  min={-30}
                  max={50}
                  step={5}
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>-30%</span>
                  <span>+50%</span>
                </div>
              </div>
              <div className="flex gap-2">
                {[5, 10, 15, 20, 30].map(val => (
                  <button
                    key={val}
                    onClick={() => onStrategyChange({ incomeGrowthPercent: val })}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                      strategy.incomeGrowthPercent === val
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
                    }`}
                  >
                    +{val}%
                  </button>
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ═══ LEVER 6: Expense Reduction ═══ */}
      <Card>
        <Collapsible open={openSections.expenseReduction} onOpenChange={() => onToggleSection('expenseReduction')}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-primary" />
                  Expense Reduction
                </CardTitle>
                <div className="flex items-center gap-2">
                  {strategy.expenseReductionPercent !== 0 && (
                    <Badge variant="secondary" className="text-xs">
                      -{strategy.expenseReductionPercent}%
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${openSections.expenseReduction ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                Model lifestyle changes or reduced spending to improve surplus income.
              </p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Living Expense Reduction</span>
                  <span className={`font-medium ${strategy.expenseReductionPercent > 0 ? 'text-success' : 'text-muted-foreground'}`}>
                    {strategy.expenseReductionPercent > 0 ? `-${strategy.expenseReductionPercent}%` : 'No change'}
                  </span>
                </div>
                <Slider
                  value={[strategy.expenseReductionPercent]}
                  onValueChange={([val]) => onStrategyChange({ expenseReductionPercent: val })}
                  min={0}
                  max={40}
                  step={5}
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0%</span>
                  <span>-40%</span>
                </div>
              </div>
              <div className="flex gap-2">
                {[5, 10, 15, 20, 30].map(val => (
                  <button
                    key={val}
                    onClick={() => onStrategyChange({ expenseReductionPercent: val })}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                      strategy.expenseReductionPercent === val
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
                    }`}
                  >
                    -{val}%
                  </button>
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ═══ LEVER 7: Loan Term Extension/Reduction ═══ */}
      <Card>
        <Collapsible open={openSections.loanTerm} onOpenChange={() => onToggleSection('loanTerm')}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  Loan Term Adjustment
                </CardTitle>
                <div className="flex items-center gap-2">
                  {strategy.loanTermAdjustment !== 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {strategy.loanTermAdjustment > 0 ? '+' : ''}{strategy.loanTermAdjustment} yrs
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${openSections.loanTerm ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                See how extending or shortening the loan term affects capacity. Longer terms reduce monthly repayments but increase total interest.
              </p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Base: {baseLoanTermYears}yr → Scenario: {baseLoanTermYears + strategy.loanTermAdjustment}yr
                  </span>
                  <span className={`font-medium ${strategy.loanTermAdjustment > 0 ? 'text-success' : strategy.loanTermAdjustment < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {strategy.loanTermAdjustment > 0 ? '+' : ''}{strategy.loanTermAdjustment} years
                  </span>
                </div>
                <Slider
                  value={[strategy.loanTermAdjustment]}
                  onValueChange={([val]) => onStrategyChange({ loanTermAdjustment: val })}
                  min={-10}
                  max={10}
                  step={1}
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{baseLoanTermYears - 10}yr</span>
                  <span>{baseLoanTermYears + 10}yr</span>
                </div>
              </div>
              <div className="flex gap-2">
                {[-5, -2, 0, 2, 5].map(delta => (
                  <button
                    key={delta}
                    onClick={() => onStrategyChange({ loanTermAdjustment: delta })}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                      strategy.loanTermAdjustment === delta
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
                    }`}
                  >
                    {delta > 0 ? '+' : ''}{delta}yr
                  </button>
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ═══ LEVER 8: DTI Cap Toggle ═══ */}
      <Card>
        <Collapsible open={openSections.dtiCap} onOpenChange={() => onToggleSection('dtiCap')}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  DTI Cap Override
                </CardTitle>
                <div className="flex items-center gap-2">
                  {strategy.dtiCapEnabled && (
                    <Badge variant="secondary" className="text-xs">
                      {strategy.dtiCapValue}x cap
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${openSections.dtiCap ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                Toggle Debt-to-Income ratio caps to see how regulatory limits affect your maximum borrowing.
              </p>
              <div className="flex items-center justify-between">
                <Label className="text-sm">Apply DTI Cap</Label>
                <Switch
                  checked={strategy.dtiCapEnabled}
                  onCheckedChange={(checked) => onStrategyChange({ dtiCapEnabled: checked })}
                />
              </div>
              {strategy.dtiCapEnabled && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">DTI Ratio Limit</span>
                    <span className="font-medium">{strategy.dtiCapValue}x</span>
                  </div>
                  <Slider
                    value={[strategy.dtiCapValue]}
                    onValueChange={([val]) => onStrategyChange({ dtiCapValue: val })}
                    min={4}
                    max={9}
                    step={0.5}
                    className="py-2"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>4x (strict)</span>
                    <span>9x (relaxed)</span>
                  </div>
                  <div className="flex gap-2">
                    {[5, 6, 7, 8].map(val => (
                      <button
                        key={val}
                        onClick={() => onStrategyChange({ dtiCapValue: val })}
                        className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                          strategy.dtiCapValue === val
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
                        }`}
                      >
                        {val}x
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ═══ LEVER 10: Multi-Property Portfolio Play ═══ */}
      <Card>
        <Collapsible open={openSections.portfolioPlay} onOpenChange={() => onToggleSection('portfolioPlay')}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Building className="h-4 w-4 text-primary" />
                  Portfolio Restructure (Sell to Buy)
                </CardTitle>
                <div className="flex items-center gap-2">
                  {sellProperties.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {sellProperties.length} selected · {formatCurrency(totalSellEquityFreed)} freed
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${openSections.portfolioPlay ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                Model selling properties to fund a new purchase. Select multiple properties to see combined impact.
              </p>
              {properties.filter(p => p.current_value > 0).length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">No properties available.</p>
              ) : (
                <div className="space-y-2">
                  {properties.filter(p => p.current_value > 0).map(prop => {
                    const equity = prop.current_value - prop.loan_remaining;
                    const isSelected = strategy.portfolioSellPropertyIds.has(prop.id);
                    return (
                      <div
                        key={prop.id}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          isSelected ? 'bg-primary/10 border-primary/30' : 'hover:bg-muted/50'
                        }`}
                        onClick={() => {
                          const next = new Set(strategy.portfolioSellPropertyIds);
                          if (next.has(prop.id)) next.delete(prop.id); else next.add(prop.id);
                          onStrategyChange({ portfolioSellPropertyIds: next });
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                const next = new Set(strategy.portfolioSellPropertyIds);
                                if (checked) next.add(prop.id); else next.delete(prop.id);
                                onStrategyChange({ portfolioSellPropertyIds: next });
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div>
                              <p className="text-sm font-medium">{prop.address?.slice(0, 35) || 'Property'}</p>
                              <p className="text-xs text-muted-foreground">
                                Value: {formatCurrency(prop.current_value)} · Loan: {formatCurrency(prop.loan_remaining)}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={`text-sm font-semibold ${equity >= 0 ? 'text-success' : 'text-destructive'}`}>
                              {formatCurrency(equity)}
                            </p>
                            <p className="text-xs text-muted-foreground">equity</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {sellProperties.length > 0 && (
                <div className="p-4 rounded-lg border bg-card space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Combined Sale Impact Summary
                  </p>
                  <div className="space-y-1.5 text-sm">
                    {sellProperties.map(sp => {
                      const eq = sp.current_value - sp.loan_remaining;
                      return (
                        <div key={sp.id} className="flex justify-between text-xs">
                          <span className="text-muted-foreground truncate max-w-[60%]">{sp.address || 'Property'}</span>
                          <span className="text-success">{formatCurrency(eq)} equity</span>
                        </div>
                      );
                    })}
                    <Separator />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Sale Price (est.)</span>
                      <span>{formatCurrency(totalSellValue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Loans Discharged</span>
                      <span className="text-success">-{formatCurrency(sellProperties.reduce((s, p) => s + p.loan_remaining, 0))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Agent Fees (est. 2%)</span>
                      <span>-{formatCurrency(totalSellValue * 0.02)}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between font-semibold text-success">
                      <span>Net Proceeds (est.)</span>
                      <span>{formatCurrency(Math.max(0, totalSellEquityFreed - totalSellValue * 0.02))}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ═══ LEVER 11 (G1): Valuation Uplift Assumptions ═══ */}
      <Card>
        <Collapsible open={openSections.valuationUplift} onOpenChange={() => onToggleSection('valuationUplift')}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  Valuation Uplift Assumptions
                  <Badge variant="outline" className="text-[10px]">G1</Badge>
                </CardTitle>
                <div className="flex items-center gap-2">
                  {strategy.valuationOverrides.size > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {strategy.valuationOverrides.size} override{strategy.valuationOverrides.size === 1 ? '' : 's'}
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${openSections.valuationUplift ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
              <p className="text-xs text-muted-foreground">
                Override stored property valuations using a desktop val, AVM, or comparable sales. Resolved BEFORE equity / pool deltas so downstream math sees the new value. Audit basis is preserved on the PDF.
              </p>
              {properties.filter(p => p.current_value > 0).length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">No properties available.</p>
              ) : (
                <div className="space-y-2">
                  {properties.filter(p => p.current_value > 0).map(prop => {
                    const ov = strategy.valuationOverrides.get(prop.id);
                    const newVal = ov?.newValue ?? prop.current_value;
                    const pct = prop.current_value > 0 ? ((newVal - prop.current_value) / prop.current_value) * 100 : 0;
                    return (
                      <div key={prop.id} className="p-3 rounded-lg border space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium truncate">{prop.address?.slice(0, 40) || 'Property'}</p>
                          <p className="text-xs text-muted-foreground">stored {formatCurrency(prop.current_value)}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <Input
                            type="number"
                            placeholder="New value"
                            value={ov?.newValue ?? ''}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              const next = new Map(strategy.valuationOverrides);
                              if (!v || v <= 0) next.delete(prop.id);
                              else next.set(prop.id, { propertyId: prop.id, newValue: v, basis: ov?.basis ?? 'desktop', source: ov?.source ?? '' });
                              onStrategyChange({ valuationOverrides: next });
                            }}
                            className="text-sm h-9"
                          />
                          <Select
                            value={ov?.basis ?? 'desktop'}
                            onValueChange={(b) => {
                              if (!ov) return;
                              const next = new Map(strategy.valuationOverrides);
                              next.set(prop.id, { ...ov, basis: b as ValuationOverride['basis'] });
                              onStrategyChange({ valuationOverrides: next });
                            }}
                          >
                            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="manual">Manual</SelectItem>
                              <SelectItem value="desktop">Desktop val</SelectItem>
                              <SelectItem value="avm">AVM</SelectItem>
                              <SelectItem value="comparable_sales">Comp sales</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            type="text"
                            placeholder="Source/note"
                            value={ov?.source ?? ''}
                            onChange={(e) => {
                              if (!ov) return;
                              const next = new Map(strategy.valuationOverrides);
                              next.set(prop.id, { ...ov, source: e.target.value });
                              onStrategyChange({ valuationOverrides: next });
                            }}
                            className="text-sm h-9"
                          />
                        </div>
                        {ov && (
                          <p className={`text-xs ${pct >= 0 ? 'text-success' : 'text-destructive'}`}>
                            {pct >= 0 ? '+' : ''}{pct.toFixed(1)}% → {formatCurrency(newVal)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ═══ LEVER 12 (G2): Cross-Collateralised Pool Release ═══ */}
      <Card>
        <Collapsible open={openSections.crossCollatPool} onOpenChange={() => onToggleSection('crossCollatPool')}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Network className="h-4 w-4 text-primary" />
                  Cross-Collateralised Pool Release
                  <Badge variant="outline" className="text-[10px]">G2</Badge>
                </CardTitle>
                <div className="flex items-center gap-2">
                  {strategy.crossCollatPool.enabled && (
                    <Badge variant="secondary" className="text-xs">
                      {strategy.crossCollatPool.propertyIds.size} props · {(strategy.crossCollatPool.blendedTargetLVR * 100).toFixed(0)}% LVR
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${openSections.crossCollatPool ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
              <p className="text-xs text-muted-foreground">
                Pool selected securities and release equity against the BLENDED LVR. Equity-rich properties subsidise over-LVR ones. Per-security LMI is computed for any slice crossing 80% LVR.
              </p>
              <div className="flex items-center justify-between">
                <Label className="text-sm">Enable pool mode</Label>
                <Switch
                  checked={strategy.crossCollatPool.enabled}
                  onCheckedChange={(checked) => onStrategyChange({
                    crossCollatPool: { ...strategy.crossCollatPool, enabled: checked },
                  })}
                />
              </div>
              {strategy.crossCollatPool.enabled && (
                <>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Blended target LVR</span>
                      <span className="font-medium">{(strategy.crossCollatPool.blendedTargetLVR * 100).toFixed(0)}%</span>
                    </div>
                    <Slider
                      value={[strategy.crossCollatPool.blendedTargetLVR * 100]}
                      onValueChange={([v]) => onStrategyChange({
                        crossCollatPool: { ...strategy.crossCollatPool, blendedTargetLVR: v / 100 },
                      })}
                      min={50} max={90} step={1}
                      className="py-2"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Lender max LVR / security</Label>
                      <Input
                        type="number" step="0.01" min="0.5" max="0.99"
                        value={strategy.crossCollatPool.lenderMaxLVR}
                        onChange={(e) => onStrategyChange({
                          crossCollatPool: { ...strategy.crossCollatPool, lenderMaxLVR: Math.max(0.5, Math.min(0.99, Number(e.target.value) || 0.95)) },
                        })}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Allocation</Label>
                      <Select
                        value={strategy.crossCollatPool.allocationStrategy}
                        onValueChange={(v) => onStrategyChange({
                          crossCollatPool: { ...strategy.crossCollatPool, allocationStrategy: v as 'highest_equity_first' | 'pro_rata' },
                        })}
                      >
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="highest_equity_first">Highest equity first</SelectItem>
                          <SelectItem value="pro_rata">Pro-rata</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Separator />
                  <Label className="text-xs text-muted-foreground">Pool members</Label>
                  <div className="space-y-2">
                    {properties.filter(p => p.current_value > 0).map(prop => {
                      const isSelected = strategy.crossCollatPool.propertyIds.has(prop.id);
                      const lvr = prop.current_value > 0 ? (prop.loan_remaining / prop.current_value) * 100 : 0;
                      return (
                        <div
                          key={prop.id}
                          className={`p-2.5 rounded-lg border cursor-pointer transition-colors ${
                            isSelected ? 'bg-primary/10 border-primary/30' : 'hover:bg-muted/50'
                          }`}
                          onClick={() => {
                            const next = new Set(strategy.crossCollatPool.propertyIds);
                            if (next.has(prop.id)) next.delete(prop.id); else next.add(prop.id);
                            onStrategyChange({
                              crossCollatPool: { ...strategy.crossCollatPool, propertyIds: next },
                            });
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Switch checked={isSelected} onClick={(e) => e.stopPropagation()} onCheckedChange={() => {
                                const next = new Set(strategy.crossCollatPool.propertyIds);
                                if (next.has(prop.id)) next.delete(prop.id); else next.add(prop.id);
                                onStrategyChange({ crossCollatPool: { ...strategy.crossCollatPool, propertyIds: next } });
                              }} />
                              <div>
                                <p className="text-xs font-medium truncate max-w-[200px]">{prop.address?.slice(0, 32) || 'Property'}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {formatCurrency(prop.current_value)} · loan {formatCurrency(prop.loan_remaining)} · LVR {lvr.toFixed(0)}%
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </>
  );
}
