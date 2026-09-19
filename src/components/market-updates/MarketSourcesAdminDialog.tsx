import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, Copy, HelpCircle, Loader2, Play, RefreshCw, Settings2, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  clearMarketSourceError,
  fetchMarketSourceAdminSnapshot,
  toggleMarketSource,
  updateMarketSourceConfig,
  triggerMarketIngestion,
  type MarketSourceAlert,
} from '@/services/marketUpdatesService';
import type { MarketSource, MarketSourceRegistryStatus, MarketSourceRegistrySummary } from '@/types/marketUpdates';

const SEV_STYLE: Record<MarketSourceAlert['severity'], string> = {
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
  warning: 'border-warning/40 bg-warning/10 text-[hsl(var(--warning))]',
  info: 'border-info/40 bg-info/10 text-[hsl(var(--info))]',
};
const EMPTY_REGISTRY: MarketSourceRegistrySummary = { canonical:0, enabledCanonical:0, disabledCanonical:0, archivedLegacy:0, unresolvedLegacy:0, totalRecords:0, matchedLegacy:0, mergedRows:0, updateReferencesReassigned:0, fetchRunReferencesReassigned:0, reconciledAt:null };
type RegistryView = 'canonical' | 'unresolved_legacy' | 'archived_legacy';

const dateLabel = (v?: string | null) => v ? new Date(v).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
const nextEligibleFetch = (source:MarketSource) => source.next_eligible_fetch_at ?? (source.last_fetched_at
  ? new Date(new Date(source.last_fetched_at).getTime() + source.refresh_frequency_minutes * 60_000).toISOString()
  : new Date().toISOString());
const reasonLabel = (reason?: string | null) => reason ? reason.replace(/_/g, ' ') : 'No reconciliation reason recorded';

export function MarketSourcesAdminDialog({ open, onOpenChange, onChanged }: { open:boolean; onOpenChange:(v:boolean)=>void; onChanged?:()=>void }) {
  const [sources, setSources] = useState<MarketSource[]>([]);
  const [legacySources, setLegacySources] = useState<MarketSource[]>([]);
  const [registry, setRegistry] = useState<MarketSourceRegistrySummary>(EMPTY_REGISTRY);
  const [view, setView] = useState<RegistryView>('canonical');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all'|'enabled'|'disabled'|'failed'>('all');
  const [alerts, setAlerts] = useState<MarketSourceAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [freqDraft, setFreqDraft] = useState<Record<string, number>>({});
  const [mutationResult, setMutationResult] = useState<Record<string, { ok:boolean; message:string }>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const snap = await fetchMarketSourceAdminSnapshot();
      setSources(snap.sources);
      setLegacySources(snap.legacySources);
      setAlerts(snap.alerts);
      setRegistry(snap.registry);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Source registry could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) void load(); }, [open]);

  const mutate = async (sourceId: string, action: () => Promise<MarketSource | null>) => {
    setBusyId(sourceId);
    setMutationResult((previous) => ({ ...previous, [sourceId]: { ok:true, message:'Saving…' } }));
    try {
      const updated = await action();
      if (updated) setSources((previous) => previous.map((source) => source.id === sourceId ? updated : source));
      setMutationResult((previous) => ({ ...previous, [sourceId]: { ok:true, message:'Saved' } }));
      onChanged?.();
    } catch (error) {
      setMutationResult((previous) => ({ ...previous, [sourceId]: { ok:false, message:error instanceof Error ? error.message : 'Change could not be saved.' } }));
    } finally {
      setBusyId(null);
    }
  };
  const onToggle = (source:MarketSource, enabled:boolean) => mutate(source.id, () => toggleMarketSource(source.id, enabled));
  const onSaveFreq = (source:MarketSource) => {
    const value = freqDraft[source.id];
    if (!value || value === source.refresh_frequency_minutes) return Promise.resolve();
    return mutate(source.id, () => updateMarketSourceConfig(source.id, { refresh_frequency_minutes:value }));
  };
  const onClearError = (source:MarketSource) => mutate(source.id, async () => {
    const updated = await clearMarketSourceError(source.id);
    setAlerts((previous) => previous.filter((alert) => alert.source_id !== source.id));
    return updated;
  });
  const runSource = async (source:MarketSource, test=false) => {
    setBusyId(source.id);
    setMutationResult((previous) => ({ ...previous, [source.id]: { ok:true, message:test ? 'Testing…' : 'Running…' } }));
    try {
      await triggerMarketIngestion({ force:true, trigger_type:'manual', sourceIds:[source.id], test });
      await load();
      setMutationResult((previous) => ({ ...previous, [source.id]: { ok:true, message:test ? 'Test completed' : 'Run completed' } }));
      onChanged?.();
    } catch (error) {
      setMutationResult((previous) => ({ ...previous, [source.id]: { ok:false, message:error instanceof Error ? error.message : 'Source run failed.' } }));
    } finally {
      setBusyId(null);
    }
  };
  const copyFeedUrl = () => navigator.clipboard.writeText(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/market-updates-feed`);

  const displayedSources = useMemo(() => (view === 'canonical'
    ? sources
    : legacySources.filter((source) => source.registry_status === view))
    .filter(source => !search.trim() || `${source.name} ${source.url} ${source.source_key ?? ''} ${source.geography ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    .filter(source => statusFilter === 'all' || (statusFilter === 'enabled' ? source.enabled : statusFilter === 'disabled' ? !source.enabled : source.health_status === 'failed')),
  [legacySources, search, sources, statusFilter, view]);

  const viewButton = (target:RegistryView, label:string, count:number) => (
    <Button size="sm" variant={view === target ? 'default' : 'outline'} onClick={() => setView(target)} aria-pressed={view === target}>
      {target === 'archived_legacy' && <Archive className="mr-1.5 h-3.5 w-3.5" />}
      {target === 'unresolved_legacy' && <HelpCircle className="mr-1.5 h-3.5 w-3.5" />}
      {label} <span className="ml-1">{count}</span>
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] min-h-[min(44rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-7xl flex-col overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-7xl">
        <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5 text-primary" />Market Sources — Registry & Health</DialogTitle>
          <p className="text-xs text-muted-foreground">The approved canonical registry is shown by default. Legacy records remain available for traceability and review.</p>
        </DialogHeader>

        <div className="shrink-0 space-y-3 border-b border-border/60 px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {viewButton('canonical', 'Canonical', registry.canonical)}
              {viewButton('unresolved_legacy', 'Needs review', registry.unresolvedLegacy)}
              {viewButton('archived_legacy', 'Archived', registry.archivedLegacy)}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={copyFeedUrl}><Copy className="mr-2 h-3.5 w-3.5" />Copy RSS URL</Button>
              <Button size="sm" variant="outline" onClick={load} disabled={loading}>{loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}Refresh</Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{registry.enabledCanonical} enabled canonical</Badge>
            <Badge variant="outline">{registry.disabledCanonical} disabled canonical</Badge>
            <Badge variant="outline">{registry.totalRecords} total records</Badge>
            {alerts.length ? <Badge variant="outline" className="text-destructive"><AlertTriangle className="mr-1 h-3 w-3" />{alerts.length} canonical alert{alerts.length === 1 ? '' : 's'}</Badge> : <Badge variant="outline" className="text-success"><CheckCircle2 className="mr-1 h-3 w-3" />Canonical sources healthy</Badge>}
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search sources by name, key or URL…" aria-label="Search market sources" />
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)} className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Filter market sources by status"><option value="all">All statuses</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="failed">Failed</option></select>
          </div>
          {registry.reconciledAt && <p className="text-[11px] text-muted-foreground">Last reconciliation: {dateLabel(registry.reconciledAt)} · {registry.mergedRows} legacy matches · {registry.updateReferencesReassigned} update and {registry.fetchRunReferencesReassigned} fetch-run references reassigned.</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-3 pb-8" tabIndex={0} aria-label="Market source registry">
          {loadError && <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"><p className="font-semibold">Source registry requires attention</p><p>{loadError}</p></div>}
          {view === 'unresolved_legacy' && <div className="mb-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"><p className="font-semibold">Manual review required</p><p className="text-muted-foreground">These legacy records had no single deterministic canonical match. They are retained and disabled; review their URLs and reconciliation reason before a future resolution migration.</p></div>}
          {alerts.length > 0 && view === 'canonical' && <div className="mb-3 space-y-2">{alerts.map((alert) => <div key={alert.source_id} className={cn('flex items-start justify-between gap-3 rounded-lg border p-2 text-xs', SEV_STYLE[alert.severity])}><div><p className="font-semibold">{alert.name}</p><p className="opacity-90">{alert.message}</p></div><Badge variant="outline" className="uppercase">{alert.severity}</Badge></div>)}</div>}

          {loading && displayedSources.length === 0 ? <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading sources…</div>
          : displayedSources.length === 0 ? <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No {view === 'canonical' ? 'canonical' : view === 'unresolved_legacy' ? 'unresolved legacy' : 'archived legacy'} sources.</div>
          : <div className="space-y-2">{displayedSources.map((source) => <SourceCard key={source.id} source={source} canonical={view === 'canonical'} busy={busyId === source.id} frequencyDraft={freqDraft[source.id]} mutationResult={mutationResult[source.id]} setFrequency={(value) => setFreqDraft((draft) => ({...draft, [source.id]:value}))} onToggle={onToggle} onSaveFreq={onSaveFreq} onClearError={onClearError} onRun={runSource} />)}</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SourceCard({ source, canonical, busy, frequencyDraft, mutationResult, setFrequency, onToggle, onSaveFreq, onClearError, onRun }: { source:MarketSource; canonical:boolean; busy:boolean; frequencyDraft?:number; mutationResult?:{ok:boolean;message:string}; setFrequency:(value:number)=>void; onToggle:(source:MarketSource, enabled:boolean)=>void; onSaveFreq:(source:MarketSource)=>void; onClearError:(source:MarketSource)=>void; onRun:(source:MarketSource, test?:boolean)=>void }) {
  const hasError = Boolean(source.last_error);
  const status = (source.registry_status ?? 'canonical') as MarketSourceRegistryStatus;
  return <article className={cn('rounded-lg border border-border/60 bg-card p-3', hasError && canonical && 'border-destructive/40')}>
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold break-words">{source.name}</span><Badge variant="outline" className="text-[10px] uppercase">{status.replace('_legacy', '')}</Badge><Badge variant="outline" className="text-[10px] uppercase">{source.source_type}</Badge><Badge variant="outline" className="text-[10px] uppercase">{source.reliability_tier}</Badge></div>
        <p className="mt-1 break-all text-[11px] text-muted-foreground">{source.url}</p>
        <div className="mt-2 grid min-w-0 gap-2 text-[11px] sm:grid-cols-[minmax(12rem,1fr)_minmax(16rem,2fr)]"><div className="min-w-0"><span className="text-muted-foreground">Category</span><p className="mt-0.5 break-words font-medium text-foreground">{reasonLabel(source.category)}</p></div><div className="min-w-0"><span className="text-muted-foreground">Geography</span><p className="mt-0.5 whitespace-normal break-words font-medium text-foreground" title={source.geography}>{source.geography || 'Australia'}</p></div></div>
        {canonical ? <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>Last success: <strong className="text-foreground">{dateLabel(source.last_success_at)}</strong></span><span>Next eligible fetch: <strong className="text-foreground">{dateLabel(nextEligibleFetch(source))}</strong></span><span>Health: <strong className="text-foreground">{source.enabled ? source.health_status ?? 'degraded' : 'disabled'}</strong></span><span>HTTP: <strong className="text-foreground">{source.last_http_status ?? '—'}</strong></span><span>Items: <strong className="text-foreground">{source.last_items_discovered ?? 0} found / {source.last_items_published ?? 0} published</strong></span></div>
        : <div className="mt-2 rounded border border-border/60 bg-muted/30 p-2 text-[11px]"><p><strong>Reconciliation:</strong> {reasonLabel(source.reconciliation_reason)}</p>{source.superseded_by_source_id && <p className="mt-1 break-all text-muted-foreground">Superseded by source ID: {source.superseded_by_source_id}</p>}<p className="mt-1 text-muted-foreground">Historical record retained · ingestion disabled</p></div>}
        {hasError && canonical && <div className="mt-2 flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive"><XCircle className="mt-0.5 h-3 w-3 shrink-0" /><span className="break-words">{source.last_error}</span></div>}
      </div>
      {canonical && <div className="flex max-w-full flex-wrap items-end gap-2 lg:justify-end"><Button size="sm" variant="outline" onClick={() => onRun(source, true)} disabled={busy}>Test</Button><Button size="sm" variant="outline" onClick={() => onRun(source)} disabled={busy}><Play className="mr-1 h-3 w-3" />Run</Button><div><Label htmlFor={`cadence-${source.id}`} className="text-[10px] uppercase tracking-wide text-muted-foreground">Refresh cadence (minutes)</Label><div className="mt-1 flex flex-wrap items-center gap-1"><Input id={`cadence-${source.id}`} type="number" min={15} max={10080} step={15} value={frequencyDraft ?? source.refresh_frequency_minutes} className="h-8 w-24" onChange={(event) => setFrequency(Number(event.target.value))} /><span className="text-[10px] text-muted-foreground">≈ {((frequencyDraft ?? source.refresh_frequency_minutes) / 60).toFixed(1)}h</span>{frequencyDraft !== undefined && frequencyDraft !== source.refresh_frequency_minutes && <Button size="sm" variant="ghost" disabled={busy || frequencyDraft < 15 || frequencyDraft > 10080} onClick={() => onSaveFreq(source)}>Save</Button>}</div>{mutationResult && <p role="status" className={cn('mt-1 max-w-52 text-[10px]', mutationResult.ok ? 'text-success' : 'text-destructive')}>{mutationResult.message}</p>}</div>{hasError && <Button size="sm" variant="outline" onClick={() => onClearError(source)} disabled={busy}>Clear error</Button>}<div className="flex flex-col items-center gap-1"><Switch checked={source.enabled} onCheckedChange={(value) => onToggle(source, value)} disabled={busy} aria-label={`${source.enabled ? 'Disable' : 'Enable'} ${source.name}`} /><span className="text-[10px] text-muted-foreground">{source.enabled ? 'On' : 'Off'}</span></div></div>}
    </div>
  </article>;
}
