import { useState, useRef, useEffect, useMemo, type KeyboardEvent } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  allLabel?: string;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  optionsClassName?: string;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  allLabel = 'All',
  className,
  triggerClassName,
  contentClassName,
  optionsClassName,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setSearch('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  const displayValue = !value || value === 'all' ? placeholder : value;
  const selectableOptions = useMemo(() => [{ value: 'all', label: allLabel }, ...filtered.map((option) => ({ value: option, label: option }))], [allLabel, filtered]);

  useEffect(() => {
    setActiveIndex(0);
  }, [search]);

  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const selectOption = (selectedValue: string) => {
    onValueChange(selectedValue);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open || selectableOptions.length === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, selectableOptions.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case 'PageDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 8, selectableOptions.length - 1));
        break;
      case 'PageUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 8, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(selectableOptions.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        selectOption(selectableOptions[activeIndex].value);
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        break;
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
            'w-full justify-between font-normal',
            (!value || value === 'all') && 'text-muted-foreground',
            triggerClassName
          )}
        >
          <span className="truncate">{displayValue}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-0 w-[var(--radix-popover-trigger-width)]', contentClassName, className)} align="start">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          ref={inputRef}
          placeholder={`Search...`}
          onKeyDown={handleKeyDown}
          aria-activedescendant={selectableOptions[activeIndex] ? `searchable-select-option-${activeIndex}` : undefined}
          containerClassName="flex items-center border-b px-3"
          className="h-9 border-0 shadow-none focus-visible:ring-0 px-0"
          iconClassName="mr-2 opacity-50"
        />
        <div
          ref={optionsRef}
          className={cn(
            'max-h-[200px] overflow-y-auto overflow-x-hidden overscroll-contain p-1 [touch-action:pan-y]',
            optionsClassName
          )}
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          {filtered.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No results found</p>
          )}
          {selectableOptions.map((option, index) => (
            <button
              key={option.value}
              id={`searchable-select-option-${index}`}
              ref={(node) => { optionRefs.current[index] = node; }}
              onClick={() => selectOption(option.value)}
              onMouseMove={() => setActiveIndex(index)}
              className={cn(
                'relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                (value === option.value || (!value && option.value === 'all')) && 'bg-accent',
                activeIndex === index && 'bg-accent text-accent-foreground'
              )}
            >
              <Check className={cn('mr-2 h-4 w-4', (value === option.value || (!value && option.value === 'all')) ? 'opacity-100' : 'opacity-0')} />
              {option.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
