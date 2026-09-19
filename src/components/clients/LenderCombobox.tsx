import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

const AUSTRALIAN_LENDERS = [
  // Big 4
  'Commonwealth Bank (CBA)',
  'Westpac',
  'ANZ',
  'NAB',
  // Major banks
  'Macquarie Bank',
  'Bank of Queensland (BOQ)',
  'Bendigo Bank',
  'Suncorp Bank',
  'ING',
  'HSBC Australia',
  'Citibank',
  'AMP Bank',
  'Bankwest',
  'St. George Bank',
  'Bank of Melbourne',
  'BankSA',
  // Non-bank lenders
  'Pepper Money',
  'Liberty Financial',
  'Resimac',
  'La Trobe Financial',
  'Firstmac',
  'loans.com.au',
  'Athena Home Loans',
  'Nano',
  'Tic:Toc',
  'Ubank',
  'ME Bank',
  'Great Southern Bank',
  'Australian Unity',
  'Teachers Mutual Bank',
  'Heritage Bank',
  'People\'s Choice',
  'Beyond Bank',
  'P&N Bank',
  'Gateway Bank',
  'MyState Bank',
  'Auswide Bank',
  'Defence Bank',
  'Arab Bank Australia',
  'Judo Bank',
  'Alex Bank',
  'Virgin Money',
  '86 400',
  'Up Bank',
  'Volt Bank',
  'Reduce Home Loans',
  'Homestar Finance',
  'Well Home Loans',
  'Australian Military Bank',
  'IMB Bank',
  'Greater Bank',
  'Newcastle Permanent',
  'Community First Credit Union',
  'CUA (now Great Southern Bank)',
  'Qudos Bank',
  'Hume Bank',
  'Bank Australia',
  'Regional Australia Bank',
];

interface LenderComboboxProps {
  value: string;
  onChange: (value: string) => void;
}

export function LenderCombobox({ value, onChange }: LenderComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredLenders = useMemo(() => {
    if (!searchQuery) return AUSTRALIAN_LENDERS;
    const q = searchQuery.toLowerCase();
    return AUSTRALIAN_LENDERS.filter(l => l.toLowerCase().includes(q));
  }, [searchQuery]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-9 text-sm font-normal"
        >
          {value ? (
            <span className="truncate">{value}</span>
          ) : (
            <span className="text-muted-foreground">Select lender...</span>
          )}
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search banks..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>
              {searchQuery ? (
                <button
                  className="w-full px-2 py-3 text-sm text-left hover:bg-accent cursor-pointer"
                  onClick={() => {
                    onChange(searchQuery);
                    setOpen(false);
                    setSearchQuery('');
                  }}
                >
                  Use "<span className="font-medium">{searchQuery}</span>"
                </button>
              ) : (
                'No lenders found.'
              )}
            </CommandEmpty>
            <CommandGroup>
              {filteredLenders.map((lender) => (
                <CommandItem
                  key={lender}
                  value={lender}
                  onSelect={() => {
                    onChange(lender);
                    setOpen(false);
                    setSearchQuery('');
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === lender ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {lender}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
