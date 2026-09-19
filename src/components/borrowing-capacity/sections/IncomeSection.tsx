import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Collapsible, 
  CollapsibleContent, 
  CollapsibleTrigger 
} from '@/components/ui/collapsible';
import { ChevronDown, DollarSign, Percent } from 'lucide-react';
import { useState } from 'react';

interface IncomeItem {
  id: string;
  label: string;
  grossAmount: number;
  shadingRate: number;
  shadedAmount: number;
  editable?: boolean;
}

interface IncomeSectionProps {
  incomeBreakdown: IncomeItem[];
  totalGross: number;
  totalShaded: number;
  onIncomeChange?: (id: string, value: number) => void;
}

export function IncomeSection({ 
  incomeBreakdown, 
  totalGross, 
  totalShaded, 
  onIncomeChange 
}: IncomeSectionProps) {
  const [isOpen, setIsOpen] = useState(true);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getShadingColor = (rate: number) => {
    if (rate >= 1) return 'bg-success/10 text-success border-success/20';
    if (rate >= 0.8) return 'bg-warning/10 text-warning border-warning/20';
    return 'bg-muted text-muted-foreground border-border';
  };

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-success" />
                Income
              </CardTitle>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Shaded Annual</p>
                  <p className="text-sm font-semibold text-success">{formatCurrency(totalShaded)}</p>
                </div>
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* Income Items */}
            {incomeBreakdown.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">{item.label}</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="relative flex-1">
                      <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="number"
                        value={item.grossAmount || ''}
                        onChange={(e) => onIncomeChange?.(item.id, Number(e.target.value))}
                        className={`pl-7 h-9 ${item.editable && onIncomeChange ? '' : 'opacity-70'}`}
                        placeholder="0"
                        disabled={!item.editable || !onIncomeChange}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={`text-xs ${getShadingColor(item.shadingRate)}`}>
                    <Percent className="h-3 w-3 mr-1" />
                    {(item.shadingRate * 100).toFixed(0)}%
                  </Badge>
                  <div className="w-24 text-right">
                    <p className="text-xs text-muted-foreground">Shaded</p>
                    <p className="text-sm font-medium">{formatCurrency(item.shadedAmount)}</p>
                  </div>
                </div>
              </div>
            ))}

            {/* Total Summary */}
            <div className="pt-3 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Gross Annual Income</p>
                  <p className="text-sm font-medium">{formatCurrency(totalGross)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Shaded Annual Income</p>
                  <p className="text-lg font-bold text-success">{formatCurrency(totalShaded)}</p>
                </div>
              </div>
            </div>

            {/* Shading Info */}
            <div className="p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
              <p className="font-medium mb-1">Income Shading Applied:</p>
              <ul className="space-y-0.5">
                <li>• Base salary: 100%</li>
                <li>• Bonus/Commission: 80%</li>
                <li>• Positive property cash flow: 80%</li>
                <li>• Non-essential overtime: 50%</li>
              </ul>
              <p className="mt-2 text-xs italic">
                Note: Only properties with positive cash flow contribute to income. 
                Negative cash flow properties are treated as expenses.
              </p>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
