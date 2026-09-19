import { useState, useRef, useEffect } from 'react';
import { Check, ChevronDown, X, Filter } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FilterOption {
  value: string;
  label: string;
  color?: string;
  count?: number;
}

interface MultiSelectFilterProps {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  icon?: React.ReactNode;
  className?: string;
}

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  icon,
  className,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const allSelected = selected.length === 0 || selected.length === options.length;

  const toggleOption = (value: string) => {
    if (selected.includes(value)) {
      const next = selected.filter(v => v !== value);
      onChange(next);
    } else {
      const next = [...selected, value];
      // If all are now selected, clear to show "All"
      if (next.length === options.length) {
        onChange([]);
      } else {
        onChange(next);
      }
    }
  };

  const selectAll = () => onChange([]);

  const isActive = (value: string) =>
    allSelected || selected.includes(value);

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
        className={cn(
          'gap-1.5 min-h-[36px] text-xs font-medium border-border/60',
          !allSelected && 'border-primary/40 bg-primary/5'
        )}
      >
        {icon || <Filter className="h-3.5 w-3.5" />}
        <span>{label}</span>
        {!allSelected && (
          <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px] font-semibold bg-primary/15 text-primary border-0">
            {selected.length}
          </Badge>
        )}
        <ChevronDown className={cn('h-3 w-3 transition-transform ml-0.5', open && 'rotate-180')} />
      </Button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 min-w-[220px] max-h-[320px] overflow-y-auto rounded-lg border border-border bg-popover shadow-lg animate-in fade-in-0 zoom-in-95 slide-in-from-top-2">
          {/* Select All / Clear */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
            <button
              onClick={selectAll}
              className="text-xs font-medium text-primary hover:underline"
            >
              Select All
            </button>
            {!allSelected && (
              <button
                onClick={() => onChange([])}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>

          {/* Options */}
          <div className="py-1">
            {options.map(opt => {
              const active = isActive(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() => toggleOption(opt.value)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                    'hover:bg-muted/60',
                    active && !allSelected && 'bg-primary/5'
                  )}
                >
                  <div className={cn(
                    'flex items-center justify-center w-4 h-4 rounded border transition-colors shrink-0',
                    active && !allSelected
                      ? 'bg-primary border-primary text-primary-foreground'
                      : allSelected
                        ? 'bg-primary/20 border-primary/40 text-primary'
                        : 'border-border'
                  )}>
                    {(active) && <Check className="h-3 w-3" />}
                  </div>
                  {opt.color && (
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
                  )}
                  <span className="text-foreground flex-1 truncate">{opt.label}</span>
                  {opt.count !== undefined && (
                    <span className="text-[10px] text-muted-foreground font-mono">{opt.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
