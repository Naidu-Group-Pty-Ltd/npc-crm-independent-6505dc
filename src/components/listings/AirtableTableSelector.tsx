import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { airtableService, type AirtableTableInfo } from '@/lib/airtable';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Database, Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const STORAGE_KEY = 'airtableSelectedTable';

export function getSelectedAirtableTable(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

interface AirtableTableSelectorProps {
  value: string | null;
  onChange: (tableName: string | null) => void;
}

export function AirtableTableSelector({ value, onChange }: AirtableTableSelectorProps) {
  const { toast } = useToast();
  const [defaultTableName, setDefaultTableName] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['airtable', 'tables'],
    queryFn: async () => {
      const res = await airtableService.listTables();
      return res;
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (data?.defaultTableName) setDefaultTableName(data.defaultTableName);
  }, [data?.defaultTableName]);

  const tables: AirtableTableInfo[] = data?.tables || [];

  // defaultTableName from env may be a table id (tblXXXX) or a name. Resolve to a name.
  const resolvedDefaultName =
    tables.find((t) => t.id === defaultTableName || t.name === defaultTableName)?.name ?? null;

  const effectiveValue = value ?? resolvedDefaultName ?? '';

  const handleChange = (next: string) => {
    if (!next) return;
    const isDefault = resolvedDefaultName != null && next === resolvedDefaultName;
    try {
      if (isDefault) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch { /* ignore */ }
    onChange(isDefault ? null : next);
    toast({ title: 'Airtable table changed', description: `Now pulling from "${next}"` });
  };

  return (
    <div className="flex min-w-[220px] items-center gap-2 rounded-full border border-border/55 bg-card/75 px-2.5 py-1 shadow-sm transition-all duration-200 hover:border-primary/30 hover:bg-primary/5 dark:border-white/10 dark:bg-background/45 md:min-w-[260px]">
      <Database className="h-4 w-4 text-primary shrink-0" />
      <Select
        value={effectiveValue}
        onValueChange={handleChange}
        disabled={isLoading || isError || tables.length === 0}
      >
        <SelectTrigger className="h-8 w-[180px] rounded-full border-0 bg-transparent px-1 text-sm font-semibold shadow-none transition-colors hover:text-primary focus:ring-0 focus:ring-offset-0 md:w-[220px]" aria-label="Select Airtable table">
          {isLoading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading tables…
            </span>
          ) : isError ? (
            <span className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              Unable to load tables
            </span>
          ) : (
            <SelectValue placeholder="Select table" />
          )}
        </SelectTrigger>
        <SelectContent>
          {tables.map((t) => (
            <SelectItem key={t.id} value={t.name}>
              {t.name}
              {resolvedDefaultName === t.name ? ' (default)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
