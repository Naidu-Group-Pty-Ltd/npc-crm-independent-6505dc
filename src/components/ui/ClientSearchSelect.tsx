import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { formatFullName } from '@/utils/nameFormatting';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchInput } from '@/components/ui/search-input';
import { Check, ChevronsUpDown, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ClientOption {
  id: string;
  name: string;
}

interface ClientSearchSelectProps {
  value: string | null;
  onValueChange: (value: string | null, name?: string) => void;
  placeholder?: string;
  className?: string;
  allowNone?: boolean;
}

export function ClientSearchSelect({
  value,
  onValueChange,
  placeholder = 'Link to client...',
  className,
  allowNone = true,
}: ClientSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['client-list-for-select'],
    queryFn: async (): Promise<ClientOption[]> => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        mode: 'list',
        listOptions: {
          select: 'id, primary_first_name, primary_surname',
          orderBy: 'primary_first_name',
          orderAsc: true,
        },
      });
      if (error) throw error;
      const records = data?.clients || data?.records || [];
      return records.map((c: any) => {
        const cl = c.client || c;
        return {
          id: c.id || cl.id,
          name: formatFullName(cl.primary_first_name, cl.primary_surname) || 'Unknown',
        };
      });
    },
    staleTime: 5 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.toLowerCase();
    return clients.filter(c => c.name.toLowerCase().includes(q));
  }, [clients, search]);

  const selectedClient = clients.find(c => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between h-10', className)}
        >
          <div className="flex items-center gap-2 min-w-0">
            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className={cn('truncate text-sm', !selectedClient && 'text-muted-foreground')}>
              {selectedClient ? selectedClient.name : (isLoading ? 'Loading...' : placeholder)}
            </span>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <div className="p-2 border-b">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search clients..."
            containerClassName="flex items-center gap-2 px-2"
            className="border-0 h-8 p-0 text-sm focus-visible:ring-0 shadow-none"
            iconClassName="h-3.5 w-3.5"
          />
        </div>
        <ScrollArea className="max-h-[220px]">
          <div className="p-1">
            {allowNone && (
              <button
                onClick={() => { onValueChange(null); setOpen(false); }}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent transition-colors text-left',
                  !value && 'bg-accent'
                )}
              >
                <Check className={cn('h-3.5 w-3.5 shrink-0', !value ? 'opacity-100 text-primary' : 'opacity-0')} />
                <span className="text-muted-foreground">No client (team only)</span>
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {isLoading ? 'Loading...' : 'No clients found'}
              </p>
            ) : (
              filtered.map(client => (
                <button
                  key={client.id}
                  onClick={() => { onValueChange(client.id, client.name); setOpen(false); setSearch(''); }}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent transition-colors text-left',
                    value === client.id && 'bg-accent'
                  )}
                >
                  <Check
                    className={cn('h-3.5 w-3.5 shrink-0', value === client.id ? 'opacity-100 text-primary' : 'opacity-0')}
                  />
                  <span className="truncate">{client.name}</span>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
