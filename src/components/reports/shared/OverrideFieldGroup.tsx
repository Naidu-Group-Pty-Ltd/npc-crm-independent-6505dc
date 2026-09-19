import { Card, CardContent } from '@/components/ui/card';
import { 
  Building2, 
  Percent, 
  TrendingUp, 
  DollarSign, 
  Shield, 
  Wrench, 
  Receipt 
} from 'lucide-react';
import { OverrideFieldConfig, OverrideCategory, CATEGORY_INFO } from '@/types/overrideFields';
import { OverrideInput } from './OverrideInput';
import { cn } from '@/lib/utils';

interface OverrideFieldGroupProps {
  category: OverrideCategory;
  fields: OverrideFieldConfig[];
  values: Record<string, string | number | boolean | undefined>;
  onChange: (key: string, value: string | number | boolean) => void;
  disabled?: boolean;
  columns?: 1 | 2 | 3 | 4;
  showCard?: boolean;
  showHeader?: boolean;
  headerRight?: React.ReactNode;
  size?: 'sm' | 'default';
  className?: string;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Building2,
  Percent,
  TrendingUp,
  DollarSign,
  Shield,
  Wrench,
  Receipt
};

export function OverrideFieldGroup({
  category,
  fields,
  values,
  onChange,
  disabled = false,
  columns = 2,
  showCard = true,
  showHeader = true,
  headerRight,
  size = 'default',
  className
}: OverrideFieldGroupProps) {
  const categoryInfo = CATEGORY_INFO[category];
  const IconComponent = ICON_MAP[categoryInfo.icon] || Building2;

  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4'
  };

  const content = (
    <>
      {showHeader && (
        <div className="flex items-center justify-between mb-4">
          <h3 className={cn(
            "font-semibold flex items-center gap-2",
            size === 'sm' ? 'text-base' : 'text-lg'
          )}>
            <span className="w-2 h-2 bg-primary rounded-full" />
            <IconComponent className={cn(
              "text-primary",
              size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
            )} />
            {categoryInfo.label}
          </h3>
          {headerRight}
        </div>
      )}
      <div className={cn(
        "grid gap-4",
        gridCols[columns],
        className
      )}>
        {fields.map(field => (
          <OverrideInput
            key={field.key}
            config={field}
            value={values[field.key]}
            onChange={(value) => onChange(field.key, value)}
            disabled={disabled}
            size={size}
          />
        ))}
      </div>
    </>
  );

  if (!showCard) {
    return <div className="space-y-4">{content}</div>;
  }

  return (
    <Card className={className}>
      <CardContent className="pt-6">
        {content}
      </CardContent>
    </Card>
  );
}
