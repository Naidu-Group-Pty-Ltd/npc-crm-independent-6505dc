import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Library, Loader2, Check, Filter, Clock, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ClientSearchSelect } from '@/components/ui/ClientSearchSelect';
import { SearchInput } from '@/components/ui/search-input';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const RECENT_KEY = 'report-qa::recent-library-ids';
const MAX_RECENT = 12;

export interface PickedReport {
  name: string;
  content: string;
  reportId: string;
  propertyAddress: string;
}

interface LibraryRow {
  id: string;
  property_address: string | null;
  report_content: string | null;
  report_tier: string | null;
  report_scope: string | null;
  created_at: string;
  is_client_report: boolean | null;
  client_property_id: string | null;
  status: string | null;
}

interface Props {
  onAdd: (reports: PickedReport[]) => void;
  existingNames?: string[];
  disabled?: boolean;
  className?: string;
}

function loadRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecentIds(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
  } catch {
    /* ignore */
  }
}

export function ReportLibraryPicker({ onAdd, existingNames = [], disabled, className }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState<string | undefined>(undefined);
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'recent'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [clientPropertyIds, setClientPropertyIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (open) setRecentIds(loadRecentIds());
  }, [open]);

  // Resolve client → property IDs filter
  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      if (!clientId) {
        setClientPropertyIds(null);
        return;
      }
      // Through the server, not the table: `client_properties` grants SELECT
      // to `service_role` alone, so this browser read answered `[]` with HTTP
      // 200 for every user — and the empty list then short-circuits the
      // library to "no reports" whenever the picker is opened for a client.
      // The same trap as the report reads below, one table further back.
      const res = await invokeSecureFunction('get-client-data', {
        clientId,
        listMode: true,
        listOptions: { table: 'client_properties', select: 'id', filters: { client_id: clientId } },
      });
      const error = res.error;
      const data = (res.data?.records ?? null) as Array<{ id: string }> | null;
      if (cancelled) return;
      if (error) {
        console.error('[ReportLibraryPicker] client_properties fetch failed', error);
        setClientPropertyIds([]);
        return;
      }
      setClientPropertyIds((data ?? []).map((r) => r.id));
    }
    resolve();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      if (clientId && clientPropertyIds && clientPropertyIds.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      // Through the server, not the table: `investment_reports`' SELECT
      // policy is `generated_by = auth.uid()`, so a browser read offered a
      // Q&A user only the reports they had generated themselves and called
      // that the library. The list carries the headline columns; the body is
      // fetched per report at pick time, which is also why 200 rows no longer
      // move 200 documents to draw a list.
      const { data, error } = await invokeSecureFunction('get-investment-reports', {
        listMode: true,
        listOptions: {
          isArchived: false,
          status: 'completed',
          pageSize: 200,
          ...(clientPropertyIds && clientPropertyIds.length > 0 ? { clientPropertyIds } : {}),
        },
      });
      if (error) throw error;
      setRows(((data?.reports ?? []) as LibraryRow[]));
    } catch (e) {
      console.error('[ReportLibraryPicker] fetch failed', e);
      toast({
        title: 'Failed to load library',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [clientId, clientPropertyIds, toast]);

  useEffect(() => {
    if (open) fetchRows();
  }, [open, fetchRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (scopeFilter === 'recent') {
      const set = new Set(recentIds);
      list = list.filter((r) => set.has(r.id));
    }
    if (tierFilter !== 'all') {
      list = list.filter((r) => (r.report_tier ?? '').toLowerCase() === tierFilter);
    }
    if (q) {
      list = list.filter((r) =>
        (r.property_address ?? '').toLowerCase().includes(q) ||
        (r.report_tier ?? '').toLowerCase().includes(q) ||
        (r.report_scope ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, search, tierFilter, scopeFilter, recentIds]);

  const tiers = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.report_tier && set.add(r.report_tier.toLowerCase()));
    return Array.from(set).sort();
  }, [rows]);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map((r) => r.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const buildName = (r: LibraryRow) => {
    const addr = (r.property_address ?? 'Untitled Report').replace(/\s+/g, ' ').trim();
    const tier = r.report_tier ? ` [${r.report_tier}]` : '';
    const date = format(new Date(r.created_at), 'yyyy-MM-dd');
    return `${addr}${tier} (${date}).report`;
  };

  const handleAdd = async () => {
    if (selectedIds.size === 0) return;
    setAdding(true);
    try {
      const picks: PickedReport[] = [];
      const unreadable: string[] = [];
      const existing = new Set(existingNames);
      for (const id of selectedIds) {
        const row = rows.find((r) => r.id === id);
        if (!row) continue;
        const name = buildName(row);
        if (existing.has(name)) continue;
        // The body, read for exactly the reports somebody picked.
        const { data, error } = await invokeSecureFunction('get-investment-reports', { reportId: id });
        const content: string | null = error ? null : (data?.report?.report_content ?? null);
        // A report that is complete but carries no body cannot be asked
        // questions about. Say which one, rather than dropping it silently —
        // a pick that vanishes with no reason reads as a broken button.
        if (!content) {
          unreadable.push(row.property_address ?? 'Untitled report');
          continue;
        }
        picks.push({
          name,
          content,
          reportId: row.id,
          propertyAddress: row.property_address ?? 'Unknown',
        });
      }
      if (picks.length === 0) {
        toast({
          title: 'Nothing to add',
          description: unreadable.length
            ? `No readable content: ${unreadable.join(', ')}.`
            : 'Selected reports are already loaded or have no content.',
        });
        setAdding(false);
        return;
      }
      onAdd(picks);
      // Update recents
      const nextRecent = [
        ...picks.map((p) => p.reportId),
        ...recentIds.filter((id) => !picks.some((p) => p.reportId === id)),
      ].slice(0, MAX_RECENT);
      saveRecentIds(nextRecent);
      setRecentIds(nextRecent);
      toast({
        title: `Added ${picks.length} report${picks.length === 1 ? '' : 's'}`,
        description: unreadable.length
          ? `Loaded as conversation context. Skipped (no readable content): ${unreadable.join(', ')}.`
          : 'Loaded from library as conversation context.',
      });
      setSelectedIds(new Set());
      setOpen(false);
    } catch (e) {
      toast({
        title: 'Failed to add reports',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            'gap-1.5 rounded-full border-primary/20 bg-background/80 shadow-sm transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-md',
            className
          )}
        >
          <Library className="h-4 w-4 mr-1.5" />
          Pick from library
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl h-[88vh] flex flex-col overflow-hidden p-0 sm:rounded-2xl">
        <DialogHeader className="border-b bg-gradient-to-br from-primary/10 via-background to-background px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <Library className="h-5 w-5" />
            </span>
            <span>
              Report Library
              <span className="mt-1 block text-xs font-medium text-muted-foreground">
                Trusted report context for this Q&A session
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="pt-2">
            Search and add existing investment reports as conversation context.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 border-b bg-muted/20 px-5 py-4 sm:px-6">
          <div className="flex flex-col sm:flex-row gap-2">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search address, tier, scope…"
              containerClassName="flex-1"
              className="h-10 rounded-xl bg-background shadow-sm"
            />
            <div className="w-full sm:w-64">
              <ClientSearchSelect
                value={clientId ?? null}
                onValueChange={(id) => setClientId(id || undefined)}
                placeholder="All clients"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <button
              type="button"
              onClick={() => setScopeFilter('all')}
              className={cn(
                'rounded-full border px-3 py-1.5 font-medium transition',
                scopeFilter === 'all' ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'border-border bg-background hover:border-primary/30 hover:bg-primary/5'
              )}
            >
              <FolderOpen className="h-3 w-3 inline mr-1" />
              All
            </button>
            <button
              type="button"
              onClick={() => setScopeFilter('recent')}
              className={cn(
                'rounded-full border px-3 py-1.5 font-medium transition',
                scopeFilter === 'recent' ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'border-border bg-background hover:border-primary/30 hover:bg-primary/5'
              )}
            >
              <Clock className="h-3 w-3 inline mr-1" />
              Recently used ({recentIds.length})
            </button>
            <div className="h-4 w-px bg-border mx-1" />
            <button
              type="button"
              onClick={() => setTierFilter('all')}
              className={cn(
                'rounded-full border px-3 py-1.5 font-medium transition',
                tierFilter === 'all' ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'border-border bg-background hover:border-primary/30 hover:bg-primary/5'
              )}
            >
              All tiers
            </button>
            {tiers.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTierFilter(t)}
                className={cn(
                  'rounded-full border px-3 py-1.5 font-medium capitalize transition',
                  tierFilter === t ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'border-border bg-background hover:border-primary/30 hover:bg-primary/5'
                )}
              >
                {t}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-muted-foreground">
                {filtered.length} shown · {selectedIds.size} selected
              </span>
              <Button variant="ghost" size="sm" onClick={selectAllFiltered} disabled={filtered.length === 0}>
                Select all
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection} disabled={selectedIds.size === 0}>
                Clear
              </Button>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-2 px-3 py-3 sm:px-4">
            {loading ? (
              <div className="mx-auto my-10 max-w-sm rounded-2xl border border-brand-500/25 bg-brand-500/10 p-8 text-center shadow-sm">
                <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-500/25 bg-brand-500/15 text-brand-600 shadow-sm dark:text-brand-300">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </span>
                <p className="font-semibold text-foreground">Loading report library…</p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">Fetching available reports without changing your current selection.</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="mx-auto my-10 max-w-sm rounded-2xl border border-dashed bg-muted/20 p-8 text-center">
                <FolderOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                <p className="font-medium text-foreground">No reports match these filters</p>
                <p className="mt-1 text-sm text-muted-foreground">Try broadening your search, client, tier, or recent report filter.</p>
              </div>
            ) : (
              filtered.map((r) => {
                const checked = selectedIds.has(r.id);
                const isExisting = existingNames.includes(buildName(r));
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggle(r.id)}
                    disabled={isExisting}
                    className={cn(
                      'report-qa-library-row w-full text-left rounded-xl border bg-card px-4 py-3.5 shadow-sm flex items-start gap-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      checked ? 'border-primary bg-primary/10 shadow-md ring-1 ring-primary/15' : 'border-border hover:border-primary/30 hover:bg-primary/5 hover:shadow-md',
                      isExisting && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <div
                      className={cn(
                        'mt-0.5 h-5 w-5 rounded-full border flex items-center justify-center shrink-0 transition',
                        checked ? 'bg-primary border-primary text-primary-foreground shadow-sm' : 'border-muted-foreground/40 bg-background'
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm leading-5 text-foreground sm:text-base sm:leading-6">
                        {r.property_address ?? 'Untitled report'}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {r.report_tier && (
                          <Badge variant="secondary" className="capitalize text-[10px] px-1.5 py-0">
                            {r.report_tier}
                          </Badge>
                        )}
                        {r.report_scope && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {r.report_scope}
                          </Badge>
                        )}
                        {r.is_client_report && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            Client
                          </Badge>
                        )}
                        {isExisting && (
                          <Badge className="text-[10px] px-1.5 py-0">Already loaded</Badge>
                        )}
                        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {format(new Date(r.created_at), 'PP')}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-3 border-t">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={adding}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={selectedIds.size === 0 || adding}>
            {adding ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            Add {selectedIds.size > 0 ? `${selectedIds.size} ` : ''}report{selectedIds.size === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ReportLibraryPicker;
