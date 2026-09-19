import { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Shield, AlertTriangle, DollarSign, Percent, Info } from 'lucide-react';
import {
  estimateLMI,
  calculateLVR,
  formatLmiMode,
  type LmiMode,
  type LmiEstimate,
} from '@/utils/lmiCalculations';

interface LmiSectionProps {
  propertyValue: number;
  depositAmount: number;
  loanAmount: number; // proposed or calculated capacity
  lmiMode: LmiMode;
  lmiManualOverride: number | null;
  isFirstHomeBuyer: boolean;
  onPropertyValueChange: (v: number) => void;
  onDepositAmountChange: (v: number) => void;
  onLmiModeChange: (mode: LmiMode) => void;
  onLmiManualOverrideChange: (v: number | null) => void;
  onFirstHomeBuyerChange: (v: boolean) => void;
  onLmiEstimateChange: (estimate: LmiEstimate) => void;
}

export function LmiSection({
  propertyValue,
  depositAmount,
  loanAmount,
  lmiMode,
  lmiManualOverride,
  isFirstHomeBuyer,
  onPropertyValueChange,
  onDepositAmountChange,
  onLmiModeChange,
  onLmiManualOverrideChange,
  onFirstHomeBuyerChange,
  onLmiEstimateChange,
}: LmiSectionProps) {
  const [useManualLmi, setUseManualLmi] = useState(lmiManualOverride != null && lmiManualOverride > 0);

  // Auto-estimate LMI
  const lmiEstimate = useMemo(() => {
    const effectiveLoan = propertyValue > 0 ? propertyValue - depositAmount : loanAmount;
    const estimate = estimateLMI({
      propertyValue: propertyValue || 0,
      depositAmount: depositAmount || 0,
      loanAmount: Math.max(0, effectiveLoan),
      isFirstHomeBuyer,
      lmiManualOverride: useManualLmi ? lmiManualOverride : null,
    });
    return estimate;
  }, [propertyValue, depositAmount, loanAmount, isFirstHomeBuyer, lmiManualOverride, useManualLmi]);

  // Notify parent of estimate changes
  useEffect(() => {
    onLmiEstimateChange(lmiEstimate);
  }, [lmiEstimate, onLmiEstimateChange]);

  const lvr = propertyValue > 0 ? calculateLVR(propertyValue - depositAmount, propertyValue) : 0;

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

  const lvrColor = lvr <= 80 ? 'text-success' : lvr <= 90 ? 'text-warning' : 'text-destructive';

  return (
    <div className="rounded-lg border p-4 bg-card space-y-4">
      <h3 className="font-medium flex items-center gap-2">
        <Shield className="h-4 w-4 text-primary" />
        Lenders Mortgage Insurance (LMI)
      </h3>

      {/* Property Value & Deposit */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Property Value</Label>
          <Input
            type="number"
            value={propertyValue || ''}
            onChange={(e) => onPropertyValueChange(Number(e.target.value) || 0)}
            placeholder="e.g. 800,000"
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Deposit / Equity</Label>
          <Input
            type="number"
            value={depositAmount || ''}
            onChange={(e) => onDepositAmountChange(Number(e.target.value) || 0)}
            placeholder="e.g. 100,000"
            className="h-9"
          />
        </div>
      </div>

      {/* LVR Display */}
      {propertyValue > 0 && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
          <div className="flex items-center gap-2">
            <Percent className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Loan-to-Value Ratio (LVR)</span>
          </div>
          <span className={`text-lg font-bold ${lvrColor}`}>{lvr.toFixed(1)}%</span>
        </div>
      )}

      {/* LMI Mode Selector */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">LMI Application Mode</Label>
        <div className="flex gap-2">
          {(['none', 'display_deduction', 'debt_capitalised'] as LmiMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => onLmiModeChange(mode)}
              className={`flex-1 py-2 px-2 rounded text-xs font-medium transition-colors min-h-[44px] touch-manipulation ${
                lmiMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary hover:bg-secondary/80'
              }`}
            >
              {formatLmiMode(mode)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {lmiMode === 'none' && 'LMI will not be factored into the calculation.'}
          {lmiMode === 'display_deduction' && 'LMI is deducted from usable capacity — serviceability unchanged.'}
          {lmiMode === 'debt_capitalised' && 'LMI is added to total debt — impacts DTI and may reduce capacity.'}
        </p>
      </div>

      {lmiMode !== 'none' && (
        <>
          <Separator />

          {/* First Home Buyer Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">First Home Buyer</Label>
              <p className="text-xs text-muted-foreground">FHB discount (~15%) applied to LMI</p>
            </div>
            <Switch
              checked={isFirstHomeBuyer}
              onCheckedChange={onFirstHomeBuyerChange}
            />
          </div>

          {/* Manual Override Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Manual LMI Amount</Label>
              <p className="text-xs text-muted-foreground">Override the auto-estimated LMI</p>
            </div>
            <Switch
              checked={useManualLmi}
              onCheckedChange={(checked) => {
                setUseManualLmi(checked);
                if (!checked) onLmiManualOverrideChange(null);
              }}
            />
          </div>

          {useManualLmi && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">LMI Amount ($)</Label>
              <Input
                type="number"
                value={lmiManualOverride || ''}
                onChange={(e) => onLmiManualOverrideChange(Number(e.target.value) || 0)}
                placeholder="Enter LMI amount"
                className="h-9"
              />
            </div>
          )}

          {/* LMI Estimate Result */}
          <div className={`p-3 rounded-lg border ${
            lmiEstimate.isLmiRequired 
              ? 'bg-warning/10 border-warning/30' 
              : 'bg-success/10 border-success/30'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {lmiEstimate.isLmiRequired ? (
                  <AlertTriangle className="h-4 w-4 text-warning" />
                ) : (
                  <Shield className="h-4 w-4 text-success" />
                )}
                <span className="text-sm font-medium">
                  {lmiEstimate.isLmiRequired ? 'LMI Required' : 'No LMI Required'}
                </span>
              </div>
              {lmiEstimate.isLmiRequired && (
                <Badge variant="outline" className="text-warning border-warning/50">
                  {lmiEstimate.lvrBand}
                </Badge>
              )}
            </div>

            {lmiEstimate.isLmiRequired && (
              <div className="grid grid-cols-2 gap-3 text-sm mt-2">
                <div>
                  <p className="text-xs text-muted-foreground">Est. LMI Premium</p>
                  <p className="font-bold text-warning">{formatCurrency(lmiEstimate.lmiAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">LMI Rate</p>
                  <p className="font-semibold">{lmiEstimate.estimatedRate.toFixed(2)}%</p>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground mt-2">{lmiEstimate.breakdown}</p>
          </div>

          {/* Mode-specific explanation */}
          <div className="p-2 rounded bg-primary/10 border border-primary/20 text-xs flex items-start gap-2">
            <Info className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <span>
              {lmiMode === 'display_deduction'
                ? `Your max borrowing capacity stays the same, but ${formatCurrency(lmiEstimate.lmiAmount)} of it goes to LMI, leaving less for the property purchase.`
                : `LMI of ${formatCurrency(lmiEstimate.lmiAmount)} is capitalised onto the loan, increasing total debt by the same amount. This may reduce capacity if DTI caps are active.`
              }
            </span>
          </div>
        </>
      )}
    </div>
  );
}
