import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Collapsible, 
  CollapsibleContent, 
  CollapsibleTrigger 
} from '@/components/ui/collapsible';
import { ChevronDown, CreditCard, DollarSign, Info } from 'lucide-react';
import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface LiabilityItem {
  id: string;
  type: string;
  label: string;
  balance: number;
  limit?: number;
  monthlyServicing: number;
  calculationNote?: string;
}

interface LiabilitiesSectionProps {
  liabilities: LiabilityItem[];
  totalMonthlyCommitments: number;
  onLiabilityChange?: (id: string, field: 'balance' | 'limit', value: number) => void;
}

export function LiabilitiesSection({
  liabilities,
  totalMonthlyCommitments,
  onLiabilityChange,
}: LiabilitiesSectionProps) {
  const [isOpen, setIsOpen] = useState(true);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getLiabilityIcon = (type: string) => {
    switch (type) {
      case 'credit_card':
        return <CreditCard className="h-4 w-4" />;
      default:
        return <DollarSign className="h-4 w-4" />;
    }
  };

  const getLiabilityTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      home_loan: 'Home Loan',
      investment_loan: 'Investment Loan',
      car_loan: 'Car Loan',
      personal_loan: 'Personal Loan',
      credit_card: 'Credit Card',
      hecs: 'HECS/HELP',
      afterpay_bnpl: 'BNPL',
      other: 'Other',
    };
    return labels[type] || type;
  };

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-destructive" />
                Existing Liabilities
              </CardTitle>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Monthly</p>
                  <p className="text-sm font-semibold text-destructive">{formatCurrency(totalMonthlyCommitments)}</p>
                </div>
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {liabilities.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                <CreditCard className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No existing liabilities</p>
              </div>
            ) : (
              <>
                {/* Liability Items */}
                {liabilities.map((item) => (
                  <div key={item.id} className="p-3 rounded-lg bg-muted/30 border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getLiabilityIcon(item.type)}
                        <span className="text-sm font-medium">{item.label}</span>
                        <Badge variant="outline" className="text-xs">
                          {getLiabilityTypeLabel(item.type)}
                        </Badge>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-destructive">
                          {formatCurrency(item.monthlyServicing)}/mo
                        </p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">Balance</Label>
                        <div className="relative mt-1">
                          <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            type="number"
                            value={item.balance || ''}
                            onChange={(e) => onLiabilityChange?.(item.id, 'balance', Number(e.target.value))}
                            className="pl-7 h-8 text-sm"
                            placeholder="0"
                            disabled={!onLiabilityChange || item.id.startsWith('prop-')}
                          />
                        </div>
                      </div>
                      {item.limit !== undefined && (
                        <div>
                          <Label className="text-xs text-muted-foreground">Limit</Label>
                          <div className="relative mt-1">
                            <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              type="number"
                              value={item.limit || ''}
                              onChange={(e) => onLiabilityChange?.(item.id, 'limit', Number(e.target.value))}
                              className="pl-7 h-8 text-sm"
                              placeholder="0"
                              disabled={!onLiabilityChange || item.id.startsWith('prop-')}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {item.calculationNote && (
                      <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                        <Info className="h-3 w-3" />
                        {item.calculationNote}
                      </p>
                    )}
                  </div>
                ))}

                {/* Total Summary */}
                <div className="pt-3 border-t border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">Total Monthly Commitments</p>
                      <p className="text-xs text-muted-foreground">Existing loan repayments + credit servicing</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-destructive">{formatCurrency(totalMonthlyCommitments)}</p>
                      <p className="text-xs text-muted-foreground">/month</p>
                    </div>
                  </div>
                </div>

                {/* Assessment Note */}
                <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                  <p className="font-medium mb-1">Liability Assessment Rules:</p>
                  <ul className="space-y-0.5">
                    <li>• Credit cards: 3% of credit limit (not balance)</li>
                    <li>• BNPL (Afterpay etc.): 5% of limit/balance</li>
                    <li>• HECS/HELP: ATO repayment brackets based on income</li>
                    <li>• Car loans: Est. P&I @ 8% / 5yr if no repayment entered</li>
                    <li>• Personal loans: Est. P&I @ 10% / 7yr if no repayment entered</li>
                    <li>• Property loans: Stress-tested at P&I @ 9.5%</li>
                  </ul>
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
