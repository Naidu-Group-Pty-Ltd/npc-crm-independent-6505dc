import { useState, useMemo, useRef, useEffect } from 'react';
import { Check, ChevronDown, X, Filter } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchInput } from '@/components/ui/search-input';
import { cn } from '@/lib/utils';

export interface MSOption {
  value: string;
  label: string;
  group?: string;
}

interface Props {
  label: string;
  options: MSOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  icon?: React.ReactNode;
  className?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  width?: string;
}

export function SearchableMultiSelect({
  label,
  options,
  selected,
  onChange,
  icon,
  className,
  placeholder = 'All',
  searchPlaceholder = 'Search…',
  emptyText = 'No results',
  width = 'w-[260px]',
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40);
    else setSearch('');
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, search]);

  const grouped = useMemo(() => {
    const g = new Map<string, MSOption[]>();
    for (const o of filtered) {
      const key = o.group || '';
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(o);
    }
    return Array.from(g.entries());
  }, [filtered]);

  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter(x => x !== v));
    else onChange([...selected, v]);
  };

  const allShownSelected = filtered.length > 0 && filtered.every(o => selected.includes(o.value));
  const toggleAllShown = () => {
    if (allShownSelected) {
      onChange(selected.filter(v => !filtered.some(o => o.value === v)));
    } else {
      const set = new Set(selected);
      filtered.forEach(o => set.add(o.value));
      onChange(Array.from(set));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'w-full justify-between font-normal h-10',
            selected.length > 0 && 'border-primary/40 bg-primary/5',
            className
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            {icon || <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className={cn('truncate text-sm', selected.length === 0 && 'text-muted-foreground')}>
              {selected.length === 0
                ? placeholder
                : selected.length === 1
                  ? options.find(o => o.value === selected[0])?.label || selected[0]
                  : `${label}`}
            </span>
            {selected.length > 1 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-primary/15 text-primary border-0">
                {selected.length}
              </Badge>
            )}
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 opacity-50 transition-transform', open && 'rotate-180')} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-0', width)} align="start">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          ref={inputRef}
          placeholder={searchPlaceholder}
          containerClassName="flex items-center border-b px-3"
          className="h-9 border-0 shadow-none focus-visible:ring-0 px-0"
          iconClassName="mr-2 opacity-50"
        />

        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 text-xs">
          <button
            onClick={toggleAllShown}
            className="font-medium text-primary hover:underline"
          >
            {allShownSelected ? 'Deselect shown' : 'Select shown'}
          </button>
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <X className="h-3 w-3" /> Clear all
            </button>
          )}
        </div>

        <div className="max-h-[280px] overflow-y-auto p-1">
          {filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
          )}
          {grouped.map(([group, opts]) => (
            <div key={group || '_'}>
              {group && (
                <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
                  {group}
                </div>
              )}
              {opts.map(opt => {
                const active = selected.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggle(opt.value)}
                    className={cn(
                      'w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors',
                      'hover:bg-accent hover:text-accent-foreground',
                      active && 'bg-accent/60'
                    )}
                  >
                    <div className={cn(
                      'flex items-center justify-center w-4 h-4 rounded border shrink-0',
                      active ? 'bg-primary border-primary text-primary-foreground' : 'border-border'
                    )}>
                      {active && <Check className="h-3 w-3" />}
                    </div>
                    <span className="flex-1 truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
