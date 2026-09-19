import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ConfidenceBadgeProps {
  confidence: number;
  className?: string;
}

export function ConfidenceBadge({ confidence, className }: ConfidenceBadgeProps) {
  const getVariant = (confidence: number) => {
    if (confidence >= 0.7) return 'success';
    if (confidence >= 0.5) return 'warning';
    return 'destructive';
  };

  const getLabel = (confidence: number) => {
    if (confidence >= 0.7) return 'High';
    if (confidence >= 0.5) return 'Medium';
    return 'Low';
  };

  const variant = getVariant(confidence);
  const label = getLabel(confidence);

  return (
    <Badge 
      variant={variant as any}
      className={cn("text-xs font-medium", className)}
    >
      {label} ({Math.round(confidence * 100)}%)
    </Badge>
  );
}