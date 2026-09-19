import { useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info } from 'lucide-react';
import { formatNumberWithCommas, removeCommas } from '@/hooks/useFormattedNumber';
import { OverrideFieldConfig } from '@/types/overrideFields';
import { cn } from '@/lib/utils';

export interface OverrideInputProps {
  config: OverrideFieldConfig;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'default';
  showLabel?: boolean;
}

export function OverrideInput({
  config,
  value,
  onChange,
  disabled = false,
  className,
  size = 'default',
  showLabel = true
}: OverrideInputProps) {
  const handleCurrencyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = removeCommas(e.target.value);
    if (rawValue === '' || rawValue === '-' || /^-?\d*\.?\d*$/.test(rawValue)) {
      onChange(rawValue);
    }
  }, [onChange]);

  const handleNumberChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  const handleSelectChange = useCallback((newValue: string) => {
    onChange(newValue);
  }, [onChange]);

  const handleToggleChange = useCallback((checked: boolean) => {
    onChange(checked);
  }, [onChange]);

  const formatForDisplay = useCallback((val: string | number | undefined): string => {
    if (val === undefined || val === null || val === '') return '';
    return formatNumberWithCommas(val.toString());
  }, []);

  const inputHeight = size === 'sm' ? 'h-9' : 'h-10';

  const renderLabel = () => {
    if (!showLabel) return null;
    
    return (
      <Label 
        htmlFor={config.key} 
        className={cn(
          "font-medium flex items-center gap-1",
          size === 'sm' ? 'text-sm' : 'text-sm'
        )}
      >
        {config.label}
        {config.tooltip && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">{config.tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </Label>
    );
  };

  // Toggle type
  if (config.type === 'toggle') {
    return (
      <div className={cn("flex items-center justify-between", className)}>
        {renderLabel()}
        <Switch
          id={config.key}
          checked={Boolean(value)}
          onCheckedChange={handleToggleChange}
          disabled={disabled}
        />
      </div>
    );
  }

  // Select type
  if (config.type === 'select') {
    return (
      <div className={cn("space-y-2", className)}>
        {renderLabel()}
        <Select
          value={value?.toString() || config.defaultValue?.toString() || ''}
          onValueChange={handleSelectChange}
          disabled={disabled}
        >
          <SelectTrigger className={inputHeight}>
            <SelectValue placeholder={`Select ${config.label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent className="bg-background z-50">
            {config.options?.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Currency type
  if (config.type === 'currency') {
    return (
      <div className={cn("space-y-2", className)}>
        {renderLabel()}
        <div className="relative">
          {config.prefix && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              {config.prefix}
            </span>
          )}
          <Input
            id={config.key}
            type="text"
            inputMode="numeric"
            value={formatForDisplay(value as string | number)}
            onChange={handleCurrencyChange}
            placeholder={config.placeholder}
            disabled={disabled}
            className={cn(
              inputHeight,
              config.prefix && 'pl-7',
              config.suffix && 'pr-12',
              config.isComputed && 'bg-muted/30'
            )}
          />
          {config.suffix && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
              {config.suffix}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Percentage type
  if (config.type === 'percentage') {
    return (
      <div className={cn("space-y-2", className)}>
        {renderLabel()}
        <div className="relative">
          <Input
            id={config.key}
            type="number"
            step="0.1"
            min={config.min}
            max={config.max}
            value={value?.toString() || ''}
            onChange={handleNumberChange}
            placeholder={config.placeholder}
            disabled={disabled}
            className={cn(inputHeight, 'pr-8')}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
            %
          </span>
        </div>
      </div>
    );
  }

  // Number type (default)
  return (
    <div className={cn("space-y-2", className)}>
      {renderLabel()}
      <div className="relative">
        {config.prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
            {config.prefix}
          </span>
        )}
        <Input
          id={config.key}
          type="number"
          step={config.type === 'number' ? '1' : '0.01'}
          min={config.min}
          max={config.max}
          value={value?.toString() || ''}
          onChange={handleNumberChange}
          placeholder={config.placeholder}
          disabled={disabled}
          className={cn(
            inputHeight,
            config.prefix && 'pl-7',
            config.suffix && 'pr-12'
          )}
        />
        {config.suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
            {config.suffix}
          </span>
        )}
      </div>
    </div>
  );
}
