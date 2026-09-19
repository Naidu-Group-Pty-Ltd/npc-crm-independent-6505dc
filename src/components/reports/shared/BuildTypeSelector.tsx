import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Building2, Home, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BuildType } from '@/types/overrideFields';

interface BuildTypeSelectorProps {
  value: BuildType;
  onChange: (value: BuildType) => void;
  disabled?: boolean;
  showCard?: boolean;
  size?: 'sm' | 'default';
  className?: string;
}

export function BuildTypeSelector({
  value,
  onChange,
  disabled = false,
  showCard = true,
  size = 'default',
  className
}: BuildTypeSelectorProps) {
  const content = (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as BuildType)}
      className="reports-overrides-build-grid grid grid-cols-3 gap-4"
      disabled={disabled}
    >
      {/* Existing Property */}
      <Label
        htmlFor="existing_property"
        className={cn(
          "reports-overrides-build-card flex flex-col items-center justify-center border-2 rounded-xl cursor-pointer transition-all",
          size === 'sm' ? 'p-3' : 'p-5',
          value === 'existing_property'
            ? 'reports-overrides-build-card-active border-primary bg-primary/5 shadow-md'
            : 'reports-overrides-build-card-inactive border-border hover:border-primary/50 hover:bg-muted/50',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <RadioGroupItem value="existing_property" id="existing_property" className="sr-only" />
        <Home className={cn(
          value === 'existing_property' ? 'text-primary' : 'text-muted-foreground',
          size === 'sm' ? 'h-7 w-7 mb-1.5' : 'h-9 w-9 mb-2'
        )} />
        <span className={cn(
          "font-semibold text-center",
          size === 'sm' ? 'text-sm' : 'text-base',
          value === 'existing_property' ? 'text-primary' : 'text-foreground'
        )}>
          Existing Property
        </span>
        <span className={cn(
          "text-muted-foreground mt-0.5 text-center",
          size === 'sm' ? 'text-[10px]' : 'text-xs'
        )}>
          Established Home
        </span>
      </Label>

      {/* New Build */}
      <Label
        htmlFor="new_build"
        className={cn(
          "reports-overrides-build-card flex flex-col items-center justify-center border-2 rounded-xl cursor-pointer transition-all",
          size === 'sm' ? 'p-3' : 'p-5',
          value === 'new_build'
            ? 'reports-overrides-build-card-active border-primary bg-primary/5 shadow-md'
            : 'reports-overrides-build-card-inactive border-border hover:border-primary/50 hover:bg-muted/50',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <RadioGroupItem value="new_build" id="new_build" className="sr-only" />
        <Building2 className={cn(
          value === 'new_build' ? 'text-primary' : 'text-muted-foreground',
          size === 'sm' ? 'h-7 w-7 mb-1.5' : 'h-9 w-9 mb-2'
        )} />
        <span className={cn(
          "font-semibold text-center",
          size === 'sm' ? 'text-sm' : 'text-base',
          value === 'new_build' ? 'text-primary' : 'text-foreground'
        )}>
          New Build
        </span>
        <span className={cn(
          "text-muted-foreground mt-0.5 text-center",
          size === 'sm' ? 'text-[10px]' : 'text-xs'
        )}>
          House & Land Package
        </span>
      </Label>

      {/* Land Only */}
      <Label
        htmlFor="land_only"
        className={cn(
          "reports-overrides-build-card flex flex-col items-center justify-center border-2 rounded-xl cursor-pointer transition-all",
          size === 'sm' ? 'p-3' : 'p-5',
          value === 'land_only'
            ? 'reports-overrides-build-card-active border-primary bg-primary/5 shadow-md'
            : 'reports-overrides-build-card-inactive border-border hover:border-primary/50 hover:bg-muted/50',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <RadioGroupItem value="land_only" id="land_only" className="sr-only" />
        <MapPin className={cn(
          value === 'land_only' ? 'text-primary' : 'text-muted-foreground',
          size === 'sm' ? 'h-7 w-7 mb-1.5' : 'h-9 w-9 mb-2'
        )} />
        <span className={cn(
          "font-semibold text-center",
          size === 'sm' ? 'text-sm' : 'text-base',
          value === 'land_only' ? 'text-primary' : 'text-foreground'
        )}>
          Land Only
        </span>
        <span className={cn(
          "text-muted-foreground mt-0.5 text-center",
          size === 'sm' ? 'text-[10px]' : 'text-xs'
        )}>
          Vacant Land
        </span>
      </Label>
    </RadioGroup>
  );

  if (!showCard) {
    return <div className={className}>{content}</div>;
  }

  return (
    <Card className={cn("reports-overrides-build-shell border-2", className)}>
      <CardContent className="reports-overrides-build-content pt-6">
        {content}
      </CardContent>
    </Card>
  );
}
