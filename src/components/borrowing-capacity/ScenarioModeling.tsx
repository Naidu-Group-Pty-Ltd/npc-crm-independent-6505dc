import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FlaskConical,
  TrendingUp,
  TrendingDown,
  Minus,
  RotateCcw,
  Save,
  ArrowRight,
  Plus,
  X,
  Home,
  CreditCard,
  Percent,
  DollarSign,
  ArrowRightLeft,
  Trash2,
} from 'lucide-react';
import {
  formatCapacity,
  getServiceabilityBandColor,
  type BorrowingCapacityInput,
  type BorrowingCapacityResult,
} from '@/utils/borrowingCapacityCalculations';
import {
  runScenario,
  type ScenarioContext,
  type ScenarioProperty,
  type ScenarioLiability,
} from '@/utils/scenarioDeltaEngine';
import type { ScenarioDelta, ScenarioCapacityResult } from '@/utils/borrowingCapacityTypes';

interface ScenarioModelingProps {
  baseInputs: BorrowingCapacityInput;
  baseResult: BorrowingCapacityResult;
  properties?: ScenarioProperty[];
  liabilities?: ScenarioLiability[];
  onSaveScenario?: (name: string, result: ScenarioCapacityResult) => void;
}

const DELTA_TYPE_OPTIONS: { value: ScenarioDelta['type']; label: string; icon: typeof DollarSign }[] = [
  { value: 'income_change', label: 'Income Change', icon: DollarSign },
  { value: 'expense_change', label: 'Expense Change', icon: CreditCard },
  { value: 'rate_change', label: 'Rate Change', icon: Percent },
  { value: 'property_sell', label: 'Sell Property', icon: Home },
  { value: 'property_refinance', label: 'Refinance to IO', icon: ArrowRightLeft },
  { value: 'liability_payoff', label: 'Pay Off Liability', icon: Trash2 },
];

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function ScenarioModeling({
  baseInputs,
  baseResult,
  properties = [],
  liabilities = [],
  onSaveScenario,
}: ScenarioModelingProps) {
  const [deltas, setDeltas] = useState<ScenarioDelta[]>([]);
  const [addingType, setAddingType] = useState<ScenarioDelta['type'] | ''>('');

  const context: ScenarioContext = useMemo(() => ({
    baseInputs,
    baseResult,
    properties,
    liabilities,
  }), [baseInputs, baseResult, properties, liabilities]);

  // Run scenario whenever deltas change
  const scenarioResult = useMemo<ScenarioCapacityResult>(() => {
    if (deltas.length === 0) {
      return {
        scenarioName: 'Current',
        deltas: [],
        borrowingCapacity: baseResult.borrowingCapacity,
        monthlySurplus: baseResult.monthlySurplus,
        serviceabilityBand: baseResult.serviceabilityBand,
        dtiRatio: baseResult.dtiRatio,
        capacityChange: { absolute: 0, percent: 0, direction: 'unchanged' },
      };
    }
    return runScenario('Custom Scenario', deltas, context);
  }, [deltas, context, baseResult]);

  const addDelta = useCallback((delta: ScenarioDelta) => {
    setDeltas(prev => [...prev, delta]);
    setAddingType('');
  }, []);

  const removeDelta = useCallback((index: number) => {
    setDeltas(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleReset = useCallback(() => {
    setDeltas([]);
    setAddingType('');
  }, []);

  const baseBandStyle = getServiceabilityBandColor(baseResult.serviceabilityBand);
  const scenarioBandStyle = getServiceabilityBandColor(scenarioResult.serviceabilityBand);
  const change = scenarioResult.capacityChange;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            What-If Scenario Analysis
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={handleReset} disabled={deltas.length === 0}>
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Active Deltas */}
        {deltas.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active Changes</p>
            {deltas.map((delta, i) => (
              <div key={`${delta.id}-${i}`} className="flex items-center justify-between p-2.5 rounded-lg border bg-card">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {delta.type.replace('_', ' ')}
                  </Badge>
                  <span className="text-sm">{delta.label}</span>
                </div>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => removeDelta(i)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add Delta */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add Change</p>
          
          {!addingType ? (
            <div className="flex flex-wrap gap-2">
              {DELTA_TYPE_OPTIONS.map(opt => (
                <Button
                  key={opt.value}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setAddingType(opt.value)}
                >
                  <opt.icon className="h-3.5 w-3.5 mr-1" />
                  {opt.label}
                </Button>
              ))}
            </div>
          ) : (
            <DeltaForm
              type={addingType}
              properties={properties}
              liabilities={liabilities}
              baseInputs={baseInputs}
              onAdd={addDelta}
              onCancel={() => setAddingType('')}
            />
          )}
        </div>

        {/* Quick Scenario Buttons */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quick Scenarios</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setDeltas([{
                id: 'income-10',
                label: '10% Pay Raise',
                type: 'income_change',
                value: 10,
                unit: 'percent',
              }])}
            >
              10% Raise
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setDeltas([{
                id: 'debt-100',
                label: 'Pay Off All Debt',
                type: 'debt_change',
                value: -100,
                unit: 'percent',
              }])}
            >
              Pay Off All Debt
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setDeltas([{
                id: 'expense-20',
                label: 'Reduce Expenses 20%',
                type: 'expense_change',
                value: -20,
                unit: 'percent',
              }])}
            >
              Budget Tightly
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setDeltas([{
                id: 'rate-2',
                label: 'Rates +2%',
                type: 'rate_change',
                value: 2,
                unit: 'rate_points',
              }])}
            >
              Rates +2%
            </Button>
          </div>
        </div>

        <Separator />

        {/* Comparison View */}
        <div className="grid grid-cols-3 gap-4 items-center">
          <div className="text-center p-4 rounded-lg bg-secondary/30">
            <p className="text-xs text-muted-foreground mb-1">CURRENT</p>
            <p className="text-xl font-bold text-foreground">
              {formatCapacity(baseResult.borrowingCapacity)}
            </p>
            <Badge
              className="mt-2"
              style={{ backgroundColor: baseBandStyle.bg === 'bg-success/10' ? '#10b981' : baseBandStyle.bg === 'bg-brand-500/10' ? '#f59e0b' : '#ef4444', color: 'white' }}
            >
              {baseBandStyle.label}
            </Badge>
          </div>

          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              {change.direction === 'increase' && <TrendingUp className="h-5 w-5 text-success" />}
              {change.direction === 'decrease' && <TrendingDown className="h-5 w-5 text-destructive" />}
              {change.direction === 'unchanged' && <Minus className="h-5 w-5 text-muted-foreground" />}
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className={`text-lg font-bold ${
              change.direction === 'increase' ? 'text-success' :
              change.direction === 'decrease' ? 'text-destructive' :
              'text-muted-foreground'
            }`}>
              {change.direction !== 'unchanged' ? (
                <>{change.direction === 'increase' ? '+' : ''}{formatCapacity(change.absolute)}</>
              ) : 'No Change'}
            </p>
            {change.direction !== 'unchanged' && (
              <p className="text-xs text-muted-foreground">
                ({change.percent >= 0 ? '+' : ''}{change.percent.toFixed(1)}%)
              </p>
            )}
          </div>

          <div className={`text-center p-4 rounded-lg border-2 ${
            change.direction === 'increase' ? 'bg-success/10 border-success/30' :
            change.direction === 'decrease' ? 'bg-destructive/10 border-destructive/30' :
            'bg-secondary/30 border-secondary'
          }`}>
            <p className="text-xs text-muted-foreground mb-1">SCENARIO</p>
            <p className="text-xl font-bold text-foreground">
              {formatCapacity(scenarioResult.borrowingCapacity)}
            </p>
            <Badge
              className="mt-2"
              style={{ backgroundColor: scenarioBandStyle.bg === 'bg-success/10' ? '#10b981' : scenarioBandStyle.bg === 'bg-brand-500/10' ? '#f59e0b' : '#ef4444', color: 'white' }}
            >
              {scenarioBandStyle.label}
            </Badge>
          </div>
        </div>

        {/* Monthly Surplus Comparison */}
        <div className="p-3 rounded-lg bg-secondary/30">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Monthly Surplus Change:</span>
            <span className={`font-medium ${
              scenarioResult.monthlySurplus >= baseResult.monthlySurplus ? 'text-success' : 'text-destructive'
            }`}>
              {formatCurrency(baseResult.monthlySurplus)} → {formatCurrency(scenarioResult.monthlySurplus)}
            </span>
          </div>
        </div>

        {onSaveScenario && deltas.length > 0 && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => onSaveScenario('Custom Scenario', scenarioResult)}
          >
            <Save className="h-4 w-4 mr-2" />
            Save This Scenario
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Delta Form Component ──

interface DeltaFormProps {
  type: ScenarioDelta['type'];
  properties: ScenarioProperty[];
  liabilities: ScenarioLiability[];
  baseInputs: BorrowingCapacityInput;
  onAdd: (delta: ScenarioDelta) => void;
  onCancel: () => void;
}

function DeltaForm({ type, properties, liabilities, baseInputs, onAdd, onCancel }: DeltaFormProps) {
  const [value, setValue] = useState(0);
  const [selectedId, setSelectedId] = useState('');

  const handleSubmit = () => {
    let delta: ScenarioDelta;

    switch (type) {
      case 'income_change':
        delta = {
          id: `income-${value}`,
          label: `Income ${value >= 0 ? '+' : ''}${value}%`,
          type: 'income_change',
          value,
          unit: 'percent',
        };
        break;
      case 'expense_change':
        delta = {
          id: `expense-${value}`,
          label: `Expenses ${value >= 0 ? '+' : ''}${value}%`,
          type: 'expense_change',
          value,
          unit: 'percent',
        };
        break;
      case 'rate_change':
        delta = {
          id: `rate-${value}`,
          label: `Rate ${value >= 0 ? '+' : ''}${value}%`,
          type: 'rate_change',
          value,
          unit: 'rate_points',
        };
        break;
      case 'property_sell': {
        const prop = properties.find(p => p.id === selectedId);
        if (!prop) return;
        delta = {
          id: selectedId,
          label: `Sell ${prop.address?.slice(0, 30) || 'property'}`,
          type: 'property_sell',
          value: prop.currentValue,
          unit: 'absolute',
        };
        break;
      }
      case 'property_refinance': {
        const prop = properties.find(p => p.id === selectedId);
        if (!prop) return;
        delta = {
          id: selectedId,
          label: `Refinance ${prop.address?.slice(0, 25) || 'property'} to IO`,
          type: 'property_refinance',
          value: 0,
          unit: 'absolute',
        };
        break;
      }
      case 'liability_payoff': {
        const liability = liabilities.find(l => l.id === selectedId);
        if (!liability) return;
        delta = {
          id: selectedId,
          label: `Pay off ${liability.label}`,
          type: 'liability_payoff',
          value: liability.balance,
          unit: 'absolute',
        };
        break;
      }
      default:
        return;
    }

    onAdd(delta);
  };

  const renderForm = () => {
    switch (type) {
      case 'income_change':
        return (
          <div className="space-y-2">
            <Label className="text-xs">Income Change (%)</Label>
            <Slider
              value={[value]}
              onValueChange={([v]) => setValue(v)}
              min={-50}
              max={50}
              step={5}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>-50%</span>
              <span className={`font-medium ${value >= 0 ? 'text-success' : 'text-destructive'}`}>
                {value >= 0 ? '+' : ''}{value}%
              </span>
              <span>+50%</span>
            </div>
          </div>
        );
      case 'expense_change':
        return (
          <div className="space-y-2">
            <Label className="text-xs">Expense Change (%)</Label>
            <Slider
              value={[value]}
              onValueChange={([v]) => setValue(v)}
              min={-30}
              max={30}
              step={5}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>-30%</span>
              <span className={`font-medium ${value <= 0 ? 'text-success' : 'text-destructive'}`}>
                {value >= 0 ? '+' : ''}{value}%
              </span>
              <span>+30%</span>
            </div>
          </div>
        );
      case 'rate_change':
        return (
          <div className="space-y-2">
            <Label className="text-xs">Interest Rate Change (percentage points)</Label>
            <Slider
              value={[value]}
              onValueChange={([v]) => setValue(v)}
              min={-2}
              max={3}
              step={0.25}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>-2%</span>
              <span className={`font-medium ${value <= 0 ? 'text-success' : 'text-destructive'}`}>
                {value >= 0 ? '+' : ''}{value.toFixed(2)}%
              </span>
              <span>+3%</span>
            </div>
          </div>
        );
      case 'property_sell':
      case 'property_refinance': {
        const filteredProps = type === 'property_refinance'
          ? properties.filter(p => p.loanRemaining > 0 && p.propertyType !== 'rental' && p.propertyType !== 'owner_occupied')
          : properties.filter(p => p.propertyType !== 'rental');
        return (
          <div className="space-y-2">
            <Label className="text-xs">Select Property</Label>
            {filteredProps.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No eligible properties found.</p>
            ) : (
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Choose property..." />
                </SelectTrigger>
                <SelectContent>
                  {filteredProps.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.address?.slice(0, 40) || 'Property'} ({formatCurrency(p.currentValue)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        );
      }
      case 'liability_payoff':
        return (
          <div className="space-y-2">
            <Label className="text-xs">Select Liability</Label>
            {liabilities.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No liabilities found.</p>
            ) : (
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Choose liability..." />
                </SelectTrigger>
                <SelectContent>
                  {liabilities.map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.label} ({formatCurrency(l.balance)} · {formatCurrency(l.monthlyServicing)}/mo)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  const canSubmit = ['property_sell', 'property_refinance', 'liability_payoff'].includes(type)
    ? selectedId !== ''
    : true;

  return (
    <div className="p-3 rounded-lg border bg-card space-y-3">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="text-xs">
          {DELTA_TYPE_OPTIONS.find(o => o.value === type)?.label || type}
        </Badge>
        <Button variant="ghost" size="sm" className="h-7" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {renderForm()}
      <Button size="sm" className="w-full" onClick={handleSubmit} disabled={!canSubmit}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add to Scenario
      </Button>
    </div>
  );
}
