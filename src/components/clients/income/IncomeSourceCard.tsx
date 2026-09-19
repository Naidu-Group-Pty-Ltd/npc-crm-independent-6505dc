import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit, Trash2, DollarSign, Briefcase, Building, Landmark, TrendingUp, HelpCircle, Link } from 'lucide-react';
import {
  IncomeSource,
  SOURCE_CATEGORIES,
  SOURCE_TYPES,
  getEffectiveShading,
  getSourceTotalAnnual,
  formatCurrency,
} from './incomeSourceTypes';

interface IncomeSourceCardProps {
  source: IncomeSource;
  onEdit: () => void;
  onDelete: () => void;
  isLinkedToEmployment?: boolean;
  hideShading?: boolean;
}

const categoryIcons: Record<string, React.ElementType> = {
  employment: Briefcase,
  passive: Building,
  government: Landmark,
  investment: TrendingUp,
  other: HelpCircle,
};

export const IncomeSourceCard = React.memo(function IncomeSourceCard({
  source,
  onEdit,
  onDelete,
  isLinkedToEmployment = false,
  hideShading = false,
}: IncomeSourceCardProps) {
  const totalAnnual = getSourceTotalAnnual(source);
  const shading = getEffectiveShading(source);
  const categoryLabel = SOURCE_CATEGORIES.find(c => c.value === source.source_category)?.label || source.source_category;
  const types = SOURCE_TYPES[source.source_category] || [];
  const typeLabel = types.find(t => t.value === source.source_type)?.label || source.source_type;
  const Icon = categoryIcons[source.source_category] || DollarSign;

  return (
    <Card className={`group ${isLinkedToEmployment ? 'border-muted bg-muted/30' : ''}`}>
      <CardContent className="pt-3 pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5 p-1.5 rounded-md bg-muted">
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-sm truncate">{source.source_name || typeLabel}</p>
                <Badge variant="secondary" className="text-[10px] h-5">{categoryLabel}</Badge>
                {isLinkedToEmployment && (
                  <Badge variant="outline" className="text-[10px] h-5 gap-1">
                    <Link className="h-2.5 w-2.5" />
                    From Employment
                  </Badge>
                )}
                {!hideShading && source.custom_shading_rate !== null && (
                  <Badge variant="outline" className="text-[10px] h-5">Custom {(shading * 100).toFixed(0)}%</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{typeLabel}</p>
              <div className="flex items-center gap-4 mt-1">
                <div>
                  <p className="text-sm font-semibold">{formatCurrency(totalAnnual)}<span className="text-xs font-normal text-muted-foreground">/yr</span></p>
                </div>
                {!hideShading && (
                  <div className="text-xs text-muted-foreground">
                    Shaded: {formatCurrency(totalAnnual * shading)}
                  </div>
                )}
              </div>
            </div>
          </div>
          {!isLinkedToEmployment && (
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
                <Edit className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
});
