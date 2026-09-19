import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DollarSign, Landmark, Calculator, RefreshCw, Shield } from 'lucide-react';
import { Deal } from './types';

interface DealFinancialControlsProps {
  deal: Deal;
  onUpdate: (data: Partial<Deal>) => void;
}

export function DealFinancialControls({ deal, onUpdate }: DealFinancialControlsProps) {
  const isHnL = deal.deal_type === 'house_and_land';
  const isRefinance = deal.deal_type === 'refinance';

  const handleNumericBlur = (field: keyof Deal, value: string) => {
    const num = value ? parseFloat(value) : null;
    if (num !== (deal[field] as number | null)) {
      onUpdate({ [field]: num } as Partial<Deal>);
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* Contract & Pricing - shown for non-refinance */}
      {!isRefinance && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              Contract & Pricing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Total Contract Price</Label>
              <Input
                key={deal.id + '-tcp'}
                type="number"
                defaultValue={deal.total_contract_price ?? ''}
                onBlur={(e) => handleNumericBlur('total_contract_price', e.target.value)}
                placeholder="$0"
                className="h-8 text-sm"
              />
            </div>
            {isHnL && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Land Price</Label>
                  <Input
                    key={deal.id + '-lp'}
                    type="number"
                    defaultValue={deal.land_price ?? ''}
                    onBlur={(e) => handleNumericBlur('land_price', e.target.value)}
                    placeholder="$0"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Build Price</Label>
                  <Input
                    key={deal.id + '-bp'}
                    type="number"
                    defaultValue={deal.build_price ?? ''}
                    onBlur={(e) => handleNumericBlur('build_price', e.target.value)}
                    placeholder="$0"
                    className="h-8 text-sm"
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Refinance Loan Details */}
      {isRefinance && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" />
              Refinance Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Existing Loan Amount</Label>
              <Input
                key={deal.id + '-ela'}
                type="number"
                defaultValue={deal.existing_loan_amount ?? ''}
                onBlur={(e) => handleNumericBlur('existing_loan_amount', e.target.value)}
                placeholder="$0"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">New Loan Amount</Label>
              <Input
                key={deal.id + '-nla'}
                type="number"
                defaultValue={deal.new_loan_amount ?? ''}
                onBlur={(e) => handleNumericBlur('new_loan_amount', e.target.value)}
                placeholder="$0"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Equity Released</Label>
              <Input
                key={deal.id + '-er'}
                type="number"
                defaultValue={deal.equity_released ?? ''}
                onBlur={(e) => handleNumericBlur('equity_released', e.target.value)}
                placeholder="$0"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cash-Out Purpose</Label>
              <Textarea
                key={deal.id + '-cop'}
                defaultValue={deal.cash_out_purpose ?? ''}
                onBlur={(e) => {
                  if (e.target.value !== (deal.cash_out_purpose || '')) {
                    onUpdate({ cash_out_purpose: e.target.value });
                  }
                }}
                placeholder="e.g. Investment deposit, debt consolidation..."
                rows={2}
                className="text-sm"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loan Details - shared (non-refinance) */}
      {!isRefinance && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Landmark className="h-4 w-4 text-primary" />
              Loan Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Loan Amount</Label>
              <Input
                key={deal.id + '-la'}
                type="number"
                defaultValue={deal.loan_amount ?? ''}
                onBlur={(e) => handleNumericBlur('loan_amount', e.target.value)}
                placeholder="$0"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Shortfall Required</Label>
              <Input
                key={deal.id + '-sr'}
                type="number"
                defaultValue={deal.shortfall_required ?? ''}
                onBlur={(e) => handleNumericBlur('shortfall_required', e.target.value)}
                placeholder="$0"
                className="h-8 text-sm"
              />
            </div>
            {isHnL && (
              <div className="space-y-1">
                <Label className="text-xs">Construction Loan Type</Label>
                <Select
                  value={deal.construction_loan_type || ''}
                  onValueChange={(v) => onUpdate({ construction_loan_type: v })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="progress">Progress Draw</SelectItem>
                    <SelectItem value="turnkey">Turnkey</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Commission & Clawback — refinance AND existing property. An
          existing-property purchase earns an agent fee too; H&L stays out
          because its commissions are tracked per build progress payment. */}
      {(isRefinance || deal.deal_type === 'existing_property') && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              {isRefinance ? 'Commission & Clawback' : 'Agent Fee / Commission'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{isRefinance ? 'Commission Estimate (Upfront)' : 'Agent Fee / Commission Estimate'}</Label>
              <Input
                key={deal.id + '-ce'}
                type="number"
                defaultValue={deal.commission_estimate ?? ''}
                onBlur={(e) => handleNumericBlur('commission_estimate', e.target.value)}
                placeholder="$0"
                className="h-8 text-sm"
              />
            </div>
            {isRefinance && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Trail Commission (Annual)</Label>
                  <Input
                    key={deal.id + '-tc'}
                    type="number"
                    defaultValue={deal.trail_commission ?? ''}
                    onBlur={(e) => handleNumericBlur('trail_commission', e.target.value)}
                    placeholder="$0"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Clawback Period (Months)</Label>
                  <Input
                    key={deal.id + '-cp'}
                    type="number"
                    defaultValue={deal.clawback_period_months ?? 24}
                    onBlur={(e) => handleNumericBlur('clawback_period_months', e.target.value)}
                    placeholder="24"
                    className="h-8 text-sm"
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Status Flags */}
      <Card className="sm:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            Status Flags
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <Switch
                checked={deal.valuation_completed}
                onCheckedChange={(v) => onUpdate({ valuation_completed: v })}
              />
              <span className="text-xs">Valuation Completed</span>
            </label>
            {!isRefinance && (
              <>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch
                    checked={deal.client_contribution_confirmed}
                    onCheckedChange={(v) => onUpdate({ client_contribution_confirmed: v })}
                  />
                  <span className="text-xs">Client Contribution Confirmed</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch
                    checked={deal.lmi_applied}
                    onCheckedChange={(v) => onUpdate({ lmi_applied: v })}
                  />
                  <span className="text-xs">LMI Applied</span>
                </label>
              </>
            )}
            {isRefinance && (
              <>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch
                    checked={deal.cash_out_verified}
                    onCheckedChange={(v) => onUpdate({ cash_out_verified: v })}
                  />
                  <span className="text-xs">Cash-Out Purpose Verified</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch
                    checked={deal.clawback_risk_active}
                    onCheckedChange={(v) => onUpdate({ clawback_risk_active: v })}
                  />
                  <span className="text-xs">Clawback Risk Active</span>
                </label>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
