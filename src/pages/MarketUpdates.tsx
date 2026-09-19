import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Activity, AlertTriangle, Archive, BarChart3, Building2, ExternalLink, Eye, FileText, Globe2, Loader2, Newspaper, Radio, RotateCcw, Search, Settings, ShieldCheck, Sparkles, TrendingUp, Zap, Clock, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { normaliseSegmentBreakdown } from '@/lib/marketDigestSegments';
import { interleaveBySource } from '@/lib/marketFeedOrder';
import { answerMarketUpdateQuestion, archiveMarketUpdate, fetchLatestMarketDigest, fetchMarketSourceHealth, fetchMarketUpdates, generateMarketDigest, publishMarketUpdate, restoreMarketUpdate, streamMarketUpdateQuestion, ensureMarketUpdatesFresh, MarketUpdatesOperationalError } from '@/services/marketUpdatesService';
import type { MarketAudienceTag, MarketDigest24h, MarketDigestPeriod, MarketFreshnessTier, MarketGeography, MarketImpactLevel, MarketIngestionRun, MarketQAMessage, MarketSegment, MarketSourceHealth, MarketUpdate, MarketUpdateCategory, MarketUpdatesOperationalIssue } from '@/types/marketUpdates';
import { MarketSourcesAdminDialog } from '@/components/market-updates/MarketSourcesAdminDialog';
import { MarketQAVoiceButton } from '@/components/market-updates/MarketQAVoiceButton';
import { MarketQAAnswerActions } from '@/components/market-updates/MarketQAAnswerActions';
import { MarketQAAnswer } from '@/components/market-updates/MarketQAAnswer';
import { MarketQAProgress } from '@/components/market-updates/MarketQAProgress';
import { MarketQADepthSelector, type DepthChoice } from '@/components/market-updates/MarketQADepthSelector';
import type { MarketQAImplications, MarketQARetrievedItem, MarketQAStage, MarketQATimelineEntry } from '@/types/marketUpdates';
import { GlassCard, AurixaMark } from '@/components/aurixa';
import { LiveModelBadge } from '@/components/agentModels';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { clearMarketUpdateArticleFilters, DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS, hasClearableMarketUpdateFilters } from '@/lib/marketUpdateFilters';
import { stripTechnicalIdentifiers as clean, stripTechnicalIdentifiersFromList as cleanList } from '@/utils/stripTechnicalIdentifiers';

const PERIODS: Array<{ id: MarketDigestPeriod; label: string; hint: string }> = [
  { id: '24h', label: '24 Hours', hint: 'Last day' },
  { id: 'weekly', label: 'Weekly', hint: 'Past 7 days' },
  { id: 'biweekly', label: 'Bi-weekly', hint: 'Past 14 days' },
  { id: 'monthly', label: 'Monthly', hint: 'Past 30 days' },
  { id: 'quarterly', label: 'Quarterly', hint: 'Past 90 days' },
  { id: 'annual', label: 'Annual', hint: 'Past 12 months' },
];

const SEGMENTS: MarketSegment[] = ['finance','property','construction','political','economic','social','policy_regulation','rental'];
const FRESHNESS: Array<{ id: MarketFreshnessTier | 'all'; label: string; icon: any }> = [
  { id: 'all', label: 'All', icon: Radio },
  { id: 'breaking', label: 'Breaking', icon: Zap },
  { id: 'today', label: 'Today', icon: Clock },
  { id: 'this_week', label: 'This Week', icon: Newspaper },
  { id: 'older', label: 'Older', icon: FileText },
];

const categories: Array<'all' | MarketUpdateCategory> = ['all','finance','property_market','construction','policy_regulation','rental_market','economy','political','planning_supply','other'];
const geographies: Array<'all' | MarketGeography> = ['all','Australia','NSW','VIC','QLD','WA','SA','TAS','ACT','NT','Multi'];
const impacts: Array<'all' | MarketImpactLevel> = ['all','critical','high','medium','low'];
const audiences: Array<'all' | MarketAudienceTag> = ['all','investors','owner_occupiers','first_home_buyers','smsf','developers','buyers_agents','mortgage_brokers','property_managers','builders','finance_brokers'];

const titleCase = (v: string) => v.split('_').map(p => p[0].toUpperCase() + p.slice(1)).join(' ');
const label = (v: string) => v === 'all' ? 'All' : titleCase(v);
const dateLabel = (v?: string | null) => v ? new Date(v).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not available';
/** Relative for recency (brand rule): "42m ago" / "5h ago" today, the date beyond that. */
const relTime = (v?: string | null) => {
  if (!v) return 'Date unknown';
  const then = new Date(v).getTime();
  if (!Number.isFinite(then)) return 'Date unknown';
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  if (mins < 48 * 60) return 'Yesterday';
  return new Date(v).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
};

const FRESHNESS_STYLE: Record<MarketFreshnessTier, string> = {
  breaking: 'bg-destructive/15 text-destructive border-destructive/30',
  today: 'bg-primary/15 text-primary border-primary/30',
  this_week: 'bg-info/15 text-[hsl(var(--info))] border-info/30',
  older: 'bg-muted text-muted-foreground border-border',
};
const IMPACT_STYLE: Record<MarketImpactLevel, string> = {
  critical: 'bg-destructive/20 text-destructive border-destructive/50',
  high: 'bg-destructive/15 text-destructive border-destructive/30',
  medium: 'bg-warning/15 text-[hsl(var(--warning))] border-warning/30',
  low: 'bg-muted text-muted-foreground border-border',
};
/** The left rail on every feed card. The rail IS the impact axis — read the
 *  feed edge top-to-bottom and the day's weight distribution is visible
 *  before a single headline is read. */
const IMPACT_RAIL: Record<MarketImpactLevel, string> = {
  critical: 'bg-destructive/80',
  high: 'bg-destructive/55',
  medium: 'bg-[hsl(var(--warning)/0.55)]',
  low: 'bg-border',
};

function FreshnessBadge({ tier }: { tier: MarketFreshnessTier }) {
  const Icon = tier === 'breaking' ? Zap : tier === 'today' ? Clock : tier === 'this_week' ? Newspaper : FileText;
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', FRESHNESS_STYLE[tier])}><Icon className="h-3 w-3" />{titleCase(tier)}</span>;
}

function SegmentChip({ seg, active, onClick }: { seg: MarketSegment | 'all'; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-[color,background-color,border-color,transform,box-shadow] duration-[var(--motion-fast)] ease-[var(--motion-ease-out)] active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-[var(--elevation-1)]'
          : 'border-[color:var(--glass-hairline)] bg-card/70 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:shadow-[var(--elevation-1)]'
      )}
    >
      {seg === 'all' ? 'All Segments' : titleCase(seg)}
    </button>
  );
}

export default function MarketUpdates() {
  const navigate = useNavigate();
  const { canEdit:canEditMarketUpdates } = useModulePermissions('market_updates');
  const [updates, setUpdates] = useState<MarketUpdate[]>([]);
  const [sourceHealth, setSourceHealth] = useState<MarketSourceHealth>({ totalSources:0, enabledSources:0, healthySources:0, degradedSources:0, failedSources:0 });
  const [loading, setLoading] = useState(true);
  const [digestLoading, setDigestLoading] = useState(false);
  const [period, setPeriod] = useState<MarketDigestPeriod>('24h');
  const [digest, setDigest] = useState<MarketDigest24h | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dataIssue, setDataIssue] = useState<MarketUpdatesOperationalIssue | null>(null);
  const [digestIssue, setDigestIssue] = useState<MarketUpdatesOperationalIssue | null>(null);
  const [actionIssue, setActionIssue] = useState<MarketUpdatesOperationalIssue | null>(null);
  const operationalIssue = actionIssue ?? dataIssue ?? digestIssue;
  const [selectedUpdate, setSelectedUpdate] = useState<MarketUpdate | null>(null);
  const [archivePendingIds,setArchivePendingIds]=useState<Set<string>>(()=>new Set());
  const archivePendingRef=useRef(new Set<string>());
  const [qaUpdate, setQaUpdate] = useState<MarketUpdate | null>(null);
  /** Which update the retained dialog thread belongs to. */
  const [qaThreadUpdateId, setQaThreadUpdateId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [qaMessage, setQaMessage] = useState<MarketQAMessage | null>(null);
  const [qaThread, setQaThread] = useState<Array<{ role: 'user' | 'assistant'; content: string; citations?: string[]; limitations?: string[]; follow_up_questions?: string[]; key_figures?: Array<{ label: string; value: string; source_id?: string }>; time_horizon?: string; sentiment?: string; streaming?: boolean; retrieved?: MarketQARetrievedItem[]; question_id?: string | null; implications?: MarketQAImplications; timeline?: MarketQATimelineEntry[]; watch_items?: string[]; contrarian_view?: string; depth_mode?: string; context_size?: number; retrieval_mode?: string }>>([]);
  /** 'auto' lets the endpoint infer depth from the question. */
  const [qaDepth, setQaDepth] = useState<DepthChoice>('auto');
  /** Live pipeline progress for the turn currently being researched. */
  const [qaStage, setQaStage] = useState<MarketQAStage | null>(null);
  const [asking, setAsking] = useState(false);
  const qaAbortRef = useRef<AbortController | null>(null);
  const qaRequestRef = useRef(0);
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [dialogConversationId, setDialogConversationId] = useState<string>(() => crypto.randomUUID());
  const [search, setSearch] = useState('');
  const [activeSegment, setActiveSegment] = useState<MarketSegment | 'all'>('all');
  const [activeFreshness, setActiveFreshness] = useState<MarketFreshnessTier | 'all'>('all');
  const [filters, setFilters] = useState({...DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS});
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [sourcesAdminOpen, setSourcesAdminOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<'updates' | 'ask-ai'>('updates');
  const [runSummary, setRunSummary] = useState<MarketIngestionRun | null>(null);
  // Shadow counters live on the ingestion response rather than the run row, so the
  // last run's validation result is held alongside it.
  const [runShadow, setRunShadow] = useState<{ sources:number; ingested:number; wouldPublish:number } | null>(null);
  // There is no Held tab any more: every classified item belongs in the one
  // published feed. Anything the classifier held is (a) merged into the feed
  // immediately so the reader never waits, and (b) promoted server-side through
  // the existing audited publish path, so the database matches what is shown.
  const [heldUpdates, setHeldUpdates] = useState<MarketUpdate[]>([]);
  const [promotingHeld, setPromotingHeld] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);


  const issueFrom = (error: unknown): MarketUpdatesOperationalIssue => error instanceof MarketUpdatesOperationalError
    ? error.issue
    : { stage:'database', code:'unknown', message:'Some Market News Feed data could not be refreshed.', remediation:'Previously loaded information remains visible. Retry; if the warning persists, ask an administrator to review the status function.', functionName:'market-updates-status', retryable:true };

  // Published rows plus anything still held, de-duplicated by id and ordered by
  // recency — one list for counts, filters, KPIs and the feed itself.
  const mergeFeed = (published: MarketUpdate[], held: MarketUpdate[]): MarketUpdate[] => {
    const byId = new Map<string, MarketUpdate>();
    for (const item of [...published, ...held]) if (!byId.has(item.id)) byId.set(item.id, item);
    return [...byId.values()].sort((a, b) => {
      const at = new Date(a.source_published_at ?? a.ingested_at).getTime();
      const bt = new Date(b.source_published_at ?? b.ingested_at).getTime();
      return bt - at;
    });
  };

  const loadUpdates = async () => {
    setLoading(true);
    const [updatesResult, healthResult, heldResult] = await Promise.allSettled([
      fetchMarketUpdates({ limit:1000 }),
      fetchMarketSourceHealth(),
      fetchMarketUpdates({ status:'candidate', limit:100 }),
    ]);
    const held = heldResult.status === 'fulfilled' ? heldResult.value : [];
    // Held items are supplementary: a failure there must not blank the feed.
    setHeldUpdates(held);
    if (updatesResult.status === 'fulfilled') setUpdates(mergeFeed(updatesResult.value, held));
    if (healthResult.status === 'fulfilled') setSourceHealth(healthResult.value);
    const failure = [updatesResult, healthResult].find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    setDataIssue(failure ? issueFrom(failure.reason) : null);
    setLoading(false);
    return {
      updates: updatesResult.status === 'fulfilled' ? mergeFeed(updatesResult.value, held) : null,
      health: healthResult.status === 'fulfilled' ? healthResult.value : null,
      held,
    };
  };


  const loadDigest = async (selectedPeriod:MarketDigestPeriod) => {
    try { setDigest(await fetchLatestMarketDigest(selectedPeriod)); setDigestIssue(null); }
    catch (error) { setDigestIssue(issueFrom(error)); }
  };

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      const loaded = await loadUpdates();
      // Held items are already merged into the feed above; promote them server-side
      // so the single Published feed is the truth in the database too.
      if (!cancelled && loaded.held.length) {
        const promoted = await reconcileHeldIntoFeed(loaded.held);
        if (!cancelled && promoted) await loadUpdates();
      }
      if (cancelled || !loaded.updates || !loaded.health) return;
      try {
        setActionIssue(null);
        const result = await ensureMarketUpdatesFresh(loaded.health, loaded.updates.length);
        if (!cancelled && result) {
          setMessage(result.active ? 'Checking for newer market intelligence…' : `Market intelligence refreshed: ${result.ingested} items reviewed, ${result.published} new updates published.`);
          const refreshed = await loadUpdates();
          if (!cancelled && refreshed.held.length) {
            const promoted = await reconcileHeldIntoFeed(refreshed.held);
            if (!cancelled && promoted) await loadUpdates();
          }
        }
      } catch (error) { if (!cancelled) setActionIssue(issueFrom(error)); }
    };
    void start();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { void loadDigest(period); }, [period]);

  // Recency alone let the highest-volume masthead take most of the first screen, so the
  // filtered feed is interleaved across publishers before it renders.
  const filteredUpdates = useMemo(() => interleaveBySource(updates.filter((u) => {
    if (filters.category !== 'all' && u.category !== filters.category) return false;
    if (filters.geography !== 'all' && !u.geography.includes(filters.geography as MarketGeography)) return false;
    if (filters.impact !== 'all' && u.impact_level !== filters.impact) return false;
    if (filters.audience !== 'all' && !u.audience_tags.includes(filters.audience as MarketAudienceTag)) return false;
    if (activeSegment !== 'all' && !u.segments.includes(activeSegment)) return false;
    if (activeFreshness !== 'all' && u.freshness_tier !== activeFreshness) return false;
    if (sourceFilter !== 'all' && u.source_name !== sourceFilter) return false;
    if (search && !`${u.title} ${u.ai_summary ?? ''} ${u.source_name}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), (u) => u.source_name), [updates, filters, activeSegment, activeFreshness, sourceFilter, search]);
  const hasClearableFilters = hasClearableMarketUpdateFilters(search,sourceFilter,filters);
  const hasActiveFilters = hasClearableFilters || activeSegment !== 'all' || activeFreshness !== 'all';
  const clearFilters = () => { const cleared=clearMarketUpdateArticleFilters(); setSearch(cleared.search); setSourceFilter(cleared.source); setFilters(cleared.filters); };

  // Only the publishers actually present in the loaded feed, so the filter can
  // never offer a source that would return nothing.
  const feedSources = useMemo(
    () => [...new Set(updates.map(u => u.source_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [updates],
  );

  const freshnessCounts = useMemo(() => ({
    all: updates.length,
    breaking: updates.filter(u => u.freshness_tier === 'breaking').length,
    today: updates.filter(u => u.freshness_tier === 'today').length,
    this_week: updates.filter(u => u.freshness_tier === 'this_week').length,
    older: updates.filter(u => u.freshness_tier === 'older').length,
  }), [updates]);

  const segmentCounts = useMemo(() => {
    const c: Record<string, number> = { all: updates.length };
    for (const seg of SEGMENTS) c[seg] = updates.filter(u => u.segments.includes(seg)).length;
    return c;
  }, [updates]);

  const kpis = useMemo(() => [
    { label: 'Breaking now', value: freshnessCounts.breaking, icon: Zap, chip: 'border-destructive/30 bg-destructive/10 text-destructive' },
    { label: 'Today', value: freshnessCounts.today, icon: Clock, chip: 'border-primary/30 bg-primary/10 text-primary' },
    { label: 'High impact', value: updates.filter(u => u.impact_level === 'high').length, icon: TrendingUp, chip: 'border-[color:hsl(var(--warning)/0.35)] bg-[color:hsl(var(--warning)/0.12)] text-[hsl(var(--warning))]' },
    { label: 'Finance', value: segmentCounts.finance ?? 0, icon: BarChart3, chip: 'border-primary/30 bg-primary/10 text-primary' },
    { label: 'Property', value: segmentCounts.property ?? 0, icon: Building2, chip: 'border-info/30 bg-info/10 text-[hsl(var(--info))]' },
    { label: 'Policy', value: segmentCounts.policy_regulation ?? 0, icon: ShieldCheck, chip: 'border-success/30 bg-success/10 text-success' },
  ], [freshnessCounts, updates, segmentCounts]);

  const highImpact = updates.filter(u => u.impact_level === 'high').slice(0, 5);
  const feedEmptyState = useMemo(() => {
    if (loading) return null;
    if (updates.length > 0 && filteredUpdates.length === 0 && hasActiveFilters) return { title:'Published updates hidden by filters', description:'Clear the active filters to restore the complete published feed.', kind:'filters' as const };
    if (updates.length > 0) return null;
    if (dataIssue && sourceHealth.totalSources === 0) return { title:'Market News Feed data is unavailable', description:'Previously loaded content is not available in this session. Retry the authoritative status and feed requests.', kind:'failure' as const };
    if (sourceHealth.totalSources === 0) return { title:'No canonical source registry', description:'Apply the canonical registry migration, then open Sources to verify the approved feeds.', kind:'registry' as const };
    if (sourceHealth.enabledSources === 0) return { title:'Sources are configured but none are enabled', description:'Open Sources and enable at least one approved canonical source.', kind:'disabled' as const };
    if (sourceHealth.activeRun) return { title:'Ingestion is running', description:'The active run is discovering and classifying source-backed items. Progress is shown above.', kind:'running' as const };
    if ((sourceHealth.candidates ?? 0) > 0) return { title:'Items are awaiting review', description:`${sourceHealth.candidates} candidate item(s) were discovered but did not meet automatic publication criteria.`, kind:'candidates' as const };
    if (!sourceHealth.latestRun) return { title:'Sources are enabled and ready for their first run', description:'Sync the latest news to retrieve, classify and publish eligible source-backed updates.', kind:'never-run' as const };
    if ((sourceHealth.latestRun.items_discovered ?? 0) > 0 && (sourceHealth.latestRun.items_classified ?? 0) < sourceHealth.latestRun.items_discovered) return { title:'Discovered items are awaiting AI classification', description:'Review the latest run and test the configured Market News Feed classifier route.', kind:'classification' as const };
    return { title:'No published updates yet', description:'The latest run completed without an eligible publication. Review candidates, source health and AI readiness.', kind:'no-published' as const };
  }, [loading, updates.length, filteredUpdates.length, hasActiveFilters, dataIssue, sourceHealth]);

  const handleGenerateDigest = async () => {
    setDigestLoading(true);
    try { setActionIssue(null); const result = await generateMarketDigest(period); setMessage(result.message || null); setDigest(result.digest); }
    catch(error) { setActionIssue(issueFrom(error)); }
    finally { setDigestLoading(false); }
  };


  // legacy helper kept for a graceful transition from the old candidate-review modal

  const publishHeldUpdate = async (update: MarketUpdate) => {
    if (publishingId) return;
    setPublishingId(update.id);
    setActionIssue(null);
    try {
      await publishMarketUpdate(update.id);
      setHeldUpdates(current => current.filter(u => u.id !== update.id));
      toast.success(`Published “${update.title}”.`);
      await loadUpdates();
    } catch (error) {
      setActionIssue(issueFrom(error));
      toast.error(`“${update.title}” could not be published.`, { description:'It remains held for review.' });
    } finally { setPublishingId(null); }
  };

  // Promotes everything still held into the published feed through the same
  // server-authoritative publish path an operator used to click, so the audit
  // trail, publication reason and shadow-mode protections all still apply. It is
  // silent by design: the items are already visible in the feed, and a source
  // the server legitimately refuses (a shadow row) simply stays unpublished
  // without disturbing the reader.
  const reconcileHeldIntoFeed = async (held: MarketUpdate[]) => {
    if (!held.length || promotingHeld) return false;
    setPromotingHeld(true);
    let promoted = 0;
    try {
      const queue = [...held];
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          try { await publishMarketUpdate(next.id); promoted += 1; }
          catch { /* left held server-side; still rendered in the single feed */ }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    } finally { setPromotingHeld(false); }
    return promoted > 0;
  };



  const restoreArchived = async (updateId:string,title:string):Promise<boolean> => {
    if(archivePendingRef.current.has(updateId))return false;
    archivePendingRef.current.add(updateId);
    setArchivePendingIds(current=>new Set(current).add(updateId));
    try {
      setActionIssue(null);
      await restoreMarketUpdate(updateId);
      setSourceHealth(current => ({ ...current, archivedUpdates:Math.max(0,(current.archivedUpdates ?? 1)-1) }));
      await loadUpdates();
      toast.success('News item restored.',{description:`“${title}” is active in the Market News Feed.`});
      return true;
    } catch (error) {
      setActionIssue(issueFrom(error));
      toast.error('Unable to restore this news item. Please try again.',{description:'The active feed was not changed. Retry from Archived News.'});
      return false;
    } finally {
      archivePendingRef.current.delete(updateId);
      setArchivePendingIds(current=>{const next=new Set(current);next.delete(updateId);return next;});
    }
  };

  const archiveUpdate = async (update: MarketUpdate) => {
    if(archivePendingRef.current.has(update.id))return;
    archivePendingRef.current.add(update.id);
    setArchivePendingIds(current=>new Set(current).add(update.id));
    setActionIssue(null);
    try {
      await archiveMarketUpdate(update.id);
      setUpdates(current => current.filter(u => u.id !== update.id));
      setSourceHealth(current => ({ ...current, archivedUpdates:(current.archivedUpdates ?? 0)+1 }));
      toast.success('News item archived.',{
        description:'This update remains available in Archived News until it is restored.',
        action:{label:'Undo',onClick:() => { void restoreArchived(update.id,update.title); }},
      });
    } catch (error) {
      setActionIssue(issueFrom(error));
      toast.error('Unable to archive this news item. Please try again.',{description:'The update remains in the active feed.'});
    }
    finally {
      archivePendingRef.current.delete(update.id);
      setArchivePendingIds(current=>{const next=new Set(current);next.delete(update.id);return next;});
    }
  };

  const handleAsk = async (overrideQuestion?: string) => {
    const q = (overrideQuestion ?? question).trim();
    if (!q || asking) return;
    setAsking(true);
    const priorHistory = qaThread.map((t) => ({ role: t.role, content: t.content }));
    const inDialog = Boolean(qaUpdate);
    const convId = inDialog ? dialogConversationId : conversationId;
    qaAbortRef.current?.abort();
    const controller = new AbortController();
    qaAbortRef.current = controller;
    const requestId = ++qaRequestRef.current;
    setQaThread((t) => [...t, { role: 'user', content: q }, { role: 'assistant', content: '', streaming: true }]);
    setQuestion('');
    setQaStage(null);
    try {
      const seg = activeSegment !== 'all' ? activeSegment : undefined;
      const answer = await streamMarketUpdateQuestion(q, {
        updateIds: qaUpdate ? [qaUpdate.id] : undefined,
        history: priorHistory,
        segment: seg,
        conversation_id: convId,
        depth: qaDepth === 'auto' ? undefined : qaDepth,
        signal: controller.signal,
        onStage: (stage) => {
          if (qaRequestRef.current !== requestId) return;
          setQaStage(stage);
        },
        onDelta: (acc) => {
          if (qaRequestRef.current !== requestId) return;
          setQaThread((t) => {
            const next = [...t];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: acc };
            return next;
          });
        },
      });
      if (qaRequestRef.current !== requestId) return;
      setQaMessage(answer);
      setQaThread((t) => {
        const next = [...t];
        next[next.length - 1] = {
          role: 'assistant',
          content: answer?.content ?? 'No response.',
          citations: answer?.citations ?? [],
          limitations: answer?.limitations ?? [],
          follow_up_questions: answer?.follow_up_questions ?? [],
          key_figures: answer?.key_figures ?? [],
          time_horizon: answer?.time_horizon,
          sentiment: answer?.sentiment,
          retrieved: answer?.retrieved ?? [],
          question_id: answer?.question_id ?? null,
          implications: answer?.implications,
          timeline: answer?.timeline ?? [],
          watch_items: answer?.watch_items ?? [],
          contrarian_view: answer?.contrarian_view,
          depth_mode: answer?.depth_mode,
          context_size: answer?.context_size,
          retrieval_mode: answer?.retrieval_mode,
          streaming: false,
        };
        return next;
      });
    } catch (err) {
      if (qaRequestRef.current !== requestId || (err instanceof DOMException && err.name === 'AbortError')) return;
      setQaThread((t) => {
        const next = [...t];
        next[next.length - 1] = { role: 'assistant', content: err instanceof Error ? err.message : 'Failed to get an answer. Please try again.', streaming: false };
        return next;
      });
    } finally {
      if (qaRequestRef.current === requestId) { setAsking(false); setQaStage(null); qaAbortRef.current = null; }
    }
  };

  const cancelAsk = () => {
    qaRequestRef.current += 1;
    qaAbortRef.current?.abort();
    qaAbortRef.current = null;
    setAsking(false);
    setQaStage(null);
    setQaThread((thread) => thread.filter((turn) => !turn.streaming));
  };


  const handleFollowUp = (q: string) => { setQuestion(q); void handleAsk(q); };

  const handleQuestionKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleAsk();
    }
  };


  const renderAskAIWorkspace = () => (
    <GlassCard elevation={2} flush className="flex min-h-[560px] flex-col">
      <div className="flex-none border-b border-[color:var(--glass-hairline)] px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <AurixaMark size="md" state={asking ? 'thinking' : 'idle'} />
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Source-grounded desk analyst</p>
              <h2 className="text-lg font-semibold tracking-[-0.02em] text-foreground">Ask Aurixa</h2>
            </div>
          </div>
          {qaThread.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => { cancelAsk(); setQaThread([]); setQaMessage(null); setConversationId(crypto.randomUUID()); }}>New thread</Button>
          )}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Streaming answers grounded in published market news. Threaded — follow-ups keep prior context.</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
        <div aria-label="Ask Aurixa conversation" className="min-h-[320px] flex-1 space-y-3 overflow-y-auto overflow-x-hidden rounded-xl border border-border/60 bg-background/40 p-3">
          {qaThread.length === 0 ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
              <AurixaMark size="lg" className="mb-4" />
              <h3 className="text-base font-semibold tracking-[-0.02em]">Ask a source-grounded market question</h3>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">Answers use published market news and may refuse if there are no grounded sources available.</p>
              {!updates.length && <p className="mt-2 text-xs text-muted-foreground">No published updates loaded yet — the AI may refuse if it has no grounded sources.</p>}
            </div>
          ) : qaThread.map((turn, i) => (
            <div key={i} className={cn('rounded-[var(--radius-lg)] p-3.5 text-sm leading-relaxed', turn.role === 'user' ? 'border border-primary/20 bg-primary/10 text-foreground' : 'border border-[color:var(--glass-hairline)] bg-card/80 shadow-[var(--elevation-1)]')}>
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                <span>{turn.role === 'user' ? 'You' : 'AI'}</span>
                {turn.role === 'assistant' && turn.sentiment && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.sentiment}</Badge>}
                {turn.role === 'assistant' && turn.time_horizon && turn.time_horizon !== 'unclear' && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.time_horizon.replace('_',' ')}</Badge>}
                {turn.role === 'assistant' && turn.depth_mode && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.depth_mode === 'deep' ? 'deep dive' : turn.depth_mode}</Badge>}
                {turn.role === 'assistant' && typeof turn.context_size === 'number' && turn.context_size > 0 && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.context_size} sources read</Badge>}
              </div>
              {turn.role === 'assistant' ? (
                <MarketQAAnswer
                  content={turn.content}
                  retrieved={turn.retrieved}
                  keyFigures={turn.key_figures}
                  implications={turn.implications}
                  timeline={turn.timeline}
                  watchItems={turn.watch_items}
                  contrarianView={turn.contrarian_view}
                  streaming={turn.streaming}
                />
              ) : (
                <p className="whitespace-pre-wrap break-words">{turn.content}</p>
              )}
              {turn.citations && turn.citations.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {turn.citations.map((url, j) => (
                    <a key={url + j} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"><ExternalLink className="h-4 w-4" />Open original source</a>
                  ))}
                </div>
              )}
              {turn.follow_up_questions && turn.follow_up_questions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {turn.follow_up_questions.map((fq, j) => (
                    <button key={j} type="button" onClick={() => handleFollowUp(fq)} disabled={asking} className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50">↳ {fq}</button>
                  ))}
                </div>
              )}
              {turn.limitations && turn.limitations.length > 0 && <ul className="mt-3 list-disc pl-4 text-xs text-muted-foreground">{turn.limitations.map((l, j) => <li key={j}>{l}</li>)}</ul>}
              {turn.role === 'assistant' && !turn.streaming && (
                <MarketQAAnswerActions content={turn.content} retrieved={turn.retrieved} questionId={turn.question_id} questionText={qaThread[i-1]?.role === "user" ? qaThread[i-1].content : undefined} />
              )}
            </div>
          ))}
          {asking && <MarketQAProgress stage={qaStage} />}
        </div>
        <div className="flex-none space-y-2" aria-label="Ask Aurixa composer">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleQuestionKeyDown}
            placeholder="Ask anything — e.g. What's the RBA signalling this month?"
            className="min-h-[96px] text-sm"
          />
          <MarketQADepthSelector value={qaDepth} onChange={setQaDepth} disabled={asking} />
          <div className="flex gap-2">
            <MarketQAVoiceButton onTranscript={(t) => setQuestion((q) => (q ? `${q.trim()} ${t}` : t))} disabled={asking} />
            <Button className="flex-1" onClick={() => handleAsk()} disabled={asking || !question.trim()}>
              {asking ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Asking…</> : <><Sparkles className="mr-2 h-4 w-4" />Ask safely</>}
            </Button>
            {asking && <Button variant="outline" onClick={cancelAsk}><XCircle className="mr-2 h-4 w-4" />Cancel</Button>}
          </div>
        </div>
      </div>
    </GlassCard>
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-8">
        {/* Hero — the page's one aurora (the gradient that exclusively means
            Aurixa/AI). Eyebrow-over-tight-title is the NPC signature. */}
        <GlassCard aurora elevation={2} className="px-6 py-6 md:px-8 md:py-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0 space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--glass-hairline)] bg-[color:hsl(var(--aurixa-glass-bg)/0.5)] px-3 py-1">
                <AurixaMark size="xs" aria-label="Aurixa" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Aurixa market intelligence</span>
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground md:text-[2.6rem] md:leading-[1.08]">Market News Feed</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
                  Australian property, lending, economic and regulatory intelligence — sourced, classified and graded as it publishes.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--glass-hairline)] bg-[color:hsl(var(--aurixa-glass-bg)/0.5)] px-2.5 py-1">
                  <span className={cn('relative flex h-2 w-2 shrink-0')} aria-hidden>
                    <span className={cn('absolute inline-flex h-full w-full rounded-full', sourceHealth.automation?.cronStale ? 'bg-destructive/60' : 'animate-ping bg-success/50 motion-reduce:animate-none')} />
                    <span className={cn('relative inline-flex h-2 w-2 rounded-full', sourceHealth.automation?.cronStale ? 'bg-destructive' : 'bg-success')} />
                  </span>
                  {sourceHealth.automation?.cronStale ? 'Automation stale' : 'Live'} · ingested {relTime(sourceHealth.lastSuccessAt)}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => navigate('/market-updates/archived')} aria-label="Open Archived News"><Archive className="mr-2 h-4 w-4" aria-hidden />Archived{typeof sourceHealth.archivedUpdates === 'number' && <Badge variant="secondary" className="ml-2">{sourceHealth.archivedUpdates}</Badge>}</Button>
              <Button variant="ghost" onClick={() => setSourcesAdminOpen(true)}><Settings className="mr-2 h-4 w-4" />Sources</Button>
            </div>
          </div>
        </GlassCard>

        {message && (
          <Card className="border-primary/25 bg-primary/5">
            <CardContent className="flex items-start justify-between gap-4 p-4">
              <p className="text-sm text-foreground">{message}</p>
              <Button size="sm" variant="ghost" onClick={() => setMessage(null)}>Dismiss</Button>
            </CardContent>
          </Card>
        )}

        {operationalIssue && (
          <Card role="alert" className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="font-semibold text-destructive">Market News Feed requires attention</p>
                <p className="text-sm text-foreground">{operationalIssue.message}</p>
                <p className="text-xs text-muted-foreground">Stage: {titleCase(operationalIssue.stage)}{operationalIssue.functionName ? ` · Function: ${operationalIssue.functionName}` : ''}{operationalIssue.httpStatus ? ` · HTTP ${operationalIssue.httpStatus}` : ''}{operationalIssue.correlationId ? ` · Correlation: ${operationalIssue.correlationId}` : ''} · {operationalIssue.retryable ? 'Retryable' : 'Administrator action required'}</p>
                <p className="text-sm text-muted-foreground">{operationalIssue.remediation}</p>
              </div>
              <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={operationalIssue.stage === 'digest' ? handleGenerateDigest : loadUpdates}>{operationalIssue.stage === 'digest' ? 'Retry digest' : 'Retry page data'}</Button><Button size="sm" onClick={() => setSourcesAdminOpen(true)}>Open Sources</Button></div>
            </CardContent>
          </Card>
        )}

        {(runSummary || sourceHealth.activeRun) && (() => { const run = runSummary ?? sourceHealth.activeRun!; return <Card aria-live="polite" className="border-primary/20"><CardContent className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">Ingestion run <span className="font-mono text-xs">{run.id.slice(0,8)}</span></p><p className="text-xs text-muted-foreground">{titleCase(run.status)} · {run.sources_processed}/{run.sources_considered} sources processed</p></div>{['queued','running'].includes(run.status) && <Loader2 className="h-4 w-4 animate-spin text-primary" />}</div><div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-8">{[['Discovered',run.items_discovered],['Deduplicated',run.items_deduplicated ?? 0],['Classified',run.items_classified ?? 0],['Published',run.items_published],['Candidates',run.items_candidate ?? 0],['Ignored',run.items_ignored ?? 0],['Failed items',run.items_failed ?? 0],['Failed sources',run.sources_failed]].map(([label,value]) => <div key={String(label)} className="rounded border border-border/60 p-2"><span className="block text-muted-foreground">{label}</span><strong>{value}</strong></div>)}</div>{runShadow && <p className="text-xs text-muted-foreground">Shadow validation: {runShadow.sources} source(s) sampled {runShadow.ingested} item(s); {runShadow.wouldPublish} would have been published had they been live. None reached the feed.</p>}</CardContent></Card>; })()}

        {/* KPIs — six weighted tiles. The number carries the tile (KPI values
            read at 600 with tabular numerals); each tile filters the feed. */}
        <section aria-label="Feed at a glance">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Feed at a glance</p>
              <p className="mt-1 text-xs text-muted-foreground">Live composition of the published feed — select a tile to filter the updates below.</p>
            </div>
          </div>
          <div className="grid gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            {kpis.map(k => (
              <button
                key={k.label}
                type="button"
                onClick={() => { if(k.label==='Breaking now')setActiveFreshness('breaking'); else if(k.label==='Today')setActiveFreshness('today'); else if(k.label==='High impact')setFilters(f=>({...f,impact:'high'})); else setActiveSegment(k.label==='Policy'?'policy_regulation':k.label.toLowerCase() as MarketSegment); }}
                className="group/tile flex min-w-0 flex-col gap-3 rounded-[var(--radius-xl)] border border-[color:var(--glass-hairline)] p-4 text-left shadow-[var(--elevation-1)] backdrop-blur-md transition-[transform,box-shadow,border-color] duration-[var(--motion-base)] ease-[var(--motion-ease-out)] [background:var(--glass-tint)] hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--elevation-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{k.label}</p>
                  <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border', k.chip)} aria-hidden>
                    <k.icon className="h-4 w-4" />
                  </span>
                </div>
                <p className="text-[1.75rem] font-semibold leading-none tracking-[-0.045em] tabular-nums text-foreground">{k.value}</p>
              </button>
            ))}
          </div>
        </section>


        {/* Period tabs + Digest */}
        <section>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as MarketDigestPeriod)}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <TabsList className="w-full sm:w-auto">
                {PERIODS.map(p => (
                  <TabsTrigger key={p.id} value={p.id} className="text-xs sm:text-sm">{p.label}</TabsTrigger>
                ))}
              </TabsList>
              <p className="text-xs text-muted-foreground">Digest period: <strong className="text-foreground">{PERIODS.find(p => p.id === period)?.hint}</strong></p>
            </div>

            {PERIODS.map(p => (
              <TabsContent key={p.id} value={p.id} className="mt-4">
                <Card className="relative overflow-hidden rounded-[var(--radius-xl)] border-[color:var(--glass-hairline)] shadow-[var(--elevation-1)]">
                  {/* Gold rail — the sanctioned premium-unit accent. The digest is
                      the desk's one distilled product, so it carries the rail. */}
                  <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[hsl(var(--brand)/0.9)] via-[hsl(var(--brand)/0.4)] to-transparent" />
                  <CardHeader className="pb-3 pt-6">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--brand))]">
                          <Sparkles className="h-3.5 w-3.5" aria-hidden />Aurixa digest
                        </p>
                        <CardTitle className="mt-1.5 text-xl tracking-[-0.02em]">{p.label} briefing</CardTitle>
                      </div>
                      {digest && <span className="text-xs text-muted-foreground">Generated {dateLabel(digest.generated_at)}</span>}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!digest ? (
                      <div className="rounded-xl border border-dashed border-border p-5 text-center">
                        <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
                        <p className="text-sm text-muted-foreground">No digest has been generated for this period. The latest published updates are still available in Latest Updates.</p>
                        <Button size="sm" className="mt-4" onClick={handleGenerateDigest} disabled={digestLoading}>
                          {digestLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                          Generate {p.label} Digest
                        </Button>
                      </div>
                    ) : (
                      <>

                        <p className="max-w-4xl text-[0.95rem] leading-7 text-foreground">{clean(digest.executive_summary)}</p>

                        {(() => {
                          const segments = normaliseSegmentBreakdown(digest.segment_breakdown);
                          if (!segments.length) return null;
                          return (
                            <div className="grid gap-3 md:grid-cols-2">
                              {segments.map(({ seg, headline, highlights, implications }) => (
                                <div key={seg} className="rounded-[var(--radius-lg)] border border-[color:var(--glass-hairline)] bg-background/50 p-3.5 transition-[border-color,box-shadow] duration-[var(--motion-base)] ease-[var(--motion-ease-out)] hover:border-primary/35 hover:shadow-[var(--elevation-1)] motion-reduce:transition-none">
                                  <button type="button" onClick={() => setActiveSegment(seg as MarketSegment)} className="mb-1 rounded text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground transition-colors duration-[var(--motion-fast)] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Filter the feed by ${titleCase(seg)}`}>
                                    {titleCase(seg)}
                                  </button>
                                  {headline && <p className="text-sm leading-relaxed">{clean(headline)}</p>}
                                  {highlights.length > 0 && (
                                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                                      {cleanList(highlights).slice(0, 4).map((h, i) => <li key={i}>{h}</li>)}
                                    </ul>
                                  )}
                                  {implications && <p className="mt-2 text-xs italic text-foreground/80">{clean(implications)}</p>}
                                </div>
                              ))}
                            </div>
                          );
                        })()}

                        {digest.client_advisory_implications.length > 0 && (
                          <div className="rounded-[var(--radius-lg)] border border-[color:hsl(var(--brand)/0.35)] bg-[color:hsl(var(--brand)/0.06)] p-4">
                            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--brand))]">Client advisory implications</h4>
                            <ul className="list-disc space-y-1 pl-4 text-sm">
                              {cleanList(digest.client_advisory_implications).map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                          </div>
                        )}

                        {digest.source_urls.length > 0 && (
                          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                            <span className="text-xs font-medium text-muted-foreground">Sources:</span>
                            {digest.source_urls.slice(0, 8).map((url, i) => (
                              <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-primary">
                                <ExternalLink className="h-2.5 w-2.5" />Source {i + 1}
                              </a>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </section>

        {/* Filters: Segment chips + Freshness pills + advanced */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Segments</span>
            <SegmentChip seg="all" active={activeSegment === 'all'} onClick={() => setActiveSegment('all')} />
            {SEGMENTS.map(seg => (
              <SegmentChip key={seg} seg={seg} active={activeSegment === seg} onClick={() => setActiveSegment(seg)} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Freshness</span>
            {FRESHNESS.map(f => {
              const active = activeFreshness === f.id;
              const count = freshnessCounts[f.id as keyof typeof freshnessCounts];
              return (
                <button
                  key={f.id}
                  onClick={() => setActiveFreshness(f.id)}
                  className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-[color,background-color,border-color,transform,box-shadow] duration-[var(--motion-fast)] ease-[var(--motion-ease-out)] active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'border-primary bg-primary text-primary-foreground shadow-[var(--elevation-1)]' : 'border-[color:var(--glass-hairline)] bg-card/70 text-muted-foreground hover:border-primary/40 hover:text-foreground hover:shadow-[var(--elevation-1)]')}
                >
                  <f.icon className="h-3 w-3" />{f.label}
                  <span className={cn('rounded-full px-1.5 py-0 text-[10px]', active ? 'bg-primary-foreground/20' : 'bg-muted')}>{count}</span>
                </button>
              );
            })}
          </div>
          <div className="grid gap-3 rounded-[var(--radius-xl)] border border-[color:var(--glass-hairline)] p-3.5 shadow-[var(--elevation-1)] backdrop-blur-md [background:var(--glass-tint)] md:grid-cols-3 xl:grid-cols-7">
            <div className="space-y-1 md:col-span-1">
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Title, summary, source…" className="pl-8" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Source</Label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  {feedSources.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {([['category', categories],['geography', geographies],['impact', impacts],['audience', audiences]] as const).map(([key, values]) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{titleCase(key)}</Label>
                <Select value={(filters as any)[key]} onValueChange={(v) => setFilters(f => ({ ...f, [key]: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(values as readonly string[]).map(v => <SelectItem key={v} value={v}>{label(v)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
            <div className="flex items-end md:col-span-3 xl:col-span-1">
              <Button type="button" variant="outline" className="w-full" onClick={clearFilters} disabled={!hasClearableFilters} aria-label="Clear all search and article filters">
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden />Clear All
              </Button>
            </div>
          </div>
        </section>

        {/* Feed + Sidebar */}
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Tabs value={workspaceTab} onValueChange={(v) => setWorkspaceTab(v as 'updates' | 'ask-ai')} className="min-w-0 space-y-4">
            <TabsList aria-label="Market updates workspace" className="w-full justify-start sm:w-auto">
              <TabsTrigger value="updates">Latest Updates</TabsTrigger>
              <TabsTrigger value="ask-ai">Ask Aurixa</TabsTrigger>
            </TabsList>
            <TabsContent value="updates" className="mt-0 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">
                  {filteredUpdates.length} {filteredUpdates.length === 1 ? 'update' : 'updates'}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">of {updates.length} published</span>
                </h2>
                {/* One feed, one scope. Anything the classifier held is promoted on load
                    (see reconcileHeldIntoFeed) and shown inline here until the server
                    confirms it, so the reader never sees a second tab. */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="rounded-full">Published{promotingHeld ? ' · syncing' : ''}</Badge>
                </div>
              </div>

              {loading ? (


                <div className="space-y-4">
                  {[1,2,3].map(i => (
                    <div key={i} className="relative overflow-hidden rounded-[var(--radius-xl)] border border-[color:var(--glass-hairline)] bg-card p-5 pl-6 shadow-[var(--elevation-1)]">
                      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-muted" />
                      <div className="flex gap-2"><span className="h-4 w-16 animate-pulse rounded-full bg-muted" /><span className="h-4 w-20 animate-pulse rounded-full bg-muted" /></div>
                      <div className="mt-3 h-6 w-3/4 animate-pulse rounded bg-muted" />
                      <div className="mt-2 h-3.5 w-40 animate-pulse rounded bg-muted" />
                      <div className="mt-4 space-y-2"><div className="h-3.5 w-full animate-pulse rounded bg-muted" /><div className="h-3.5 w-5/6 animate-pulse rounded bg-muted" /></div>
                    </div>
                  ))}
                </div>
              ) : feedEmptyState ? (
                <Card className="border-dashed">
                  <CardContent className="p-10 text-center">
                    <Globe2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                    <h3 className="text-lg font-semibold">{feedEmptyState.title}</h3>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{feedEmptyState.description}</p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {feedEmptyState.kind === 'filters' && <Button size="sm" variant="outline" onClick={clearFilters}>Clear filters</Button>}
                      {['registry','disabled'].includes(feedEmptyState.kind) && <Button size="sm" variant="outline" onClick={() => setSourcesAdminOpen(true)}>Open Sources</Button>}
                      
                      {sourceHealth.latestRun && ['classification','no-published'].includes(feedEmptyState.kind) && <Button size="sm" variant="outline" onClick={() => setRunSummary(sourceHealth.latestRun ?? null)}>View latest run</Button>}
                      {feedEmptyState.kind === 'classification' && <Button size="sm" variant="outline" onClick={() => setWorkspaceTab('ask-ai')}>Test AI route</Button>}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                filteredUpdates.map((update, index) => {
                  // Front-page treatment: only when the top of the feed is genuinely
                  // consequential. Nothing is reordered — if the first card is
                  // routine, there is no lead story today.
                  const isLead = index === 0 && (update.freshness_tier === 'breaking' || update.impact_level === 'critical' || update.impact_level === 'high');
                  return (
                  <article key={update.id} className={cn(
                    'group relative overflow-hidden rounded-[var(--radius-xl)] border border-[color:var(--glass-hairline)] bg-card p-5 pl-6 shadow-[var(--elevation-1)] transition-[transform,box-shadow,border-color] duration-[var(--motion-base)] ease-[var(--motion-ease-out)] hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[var(--elevation-2)] motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                    isLead && 'p-6 pl-7 shadow-[var(--elevation-2)]',
                  )}>
                    {/* Impact rail — the feed's left edge reads as the day's weight. */}
                    <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', IMPACT_RAIL[update.impact_level])} />
                    {/* The gold rail is reserved for the lead story — the one premium
                        accent the brand permits on a hero unit. */}
                    {isLead && <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[hsl(var(--brand)/0.9)] via-[hsl(var(--brand)/0.4)] to-transparent" />}
                    {isLead && (
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--brand))]">Lead story</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <FreshnessBadge tier={update.freshness_tier} />
                      <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', IMPACT_STYLE[update.impact_level])}>
                        {update.impact_level} impact
                      </span>
                      {/* Category is omitted when the segment chips below already carry it,
                          and provenance/legal badges live in the analysis dialog — the card
                          keeps only what a reader scans by. */}
                      {!update.segments.includes(update.category as MarketSegment) && (
                        <Badge variant="outline" className="text-[10px]">{titleCase(update.category)}</Badge>
                      )}
                      {update.geography.slice(0, 2).map(g => <Badge key={g} variant="secondary" className="text-[10px]">{g}</Badge>)}
                    </div>

                    <h3 className={cn('mt-3 font-semibold leading-snug tracking-[-0.02em]', isLead ? 'text-2xl lg:text-[1.85rem] lg:leading-[1.2]' : 'text-xl lg:text-2xl')}>
                      <a
                        href={update.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded text-foreground underline-offset-4 transition-colors duration-[var(--motion-fast)] hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:text-primary"
                      >
                        {update.title}
                        <span className="sr-only"> (opens the original article in a new tab)</span>
                      </a>
                    </h3>
                    {/* The publisher name is the filter: a reader who wants "more like
                        this, from here" should not have to hunt for the source dropdown.
                        The authority tag beside it says what kind of source it is —
                        a regulator and an advocacy body carry very different weight. */}
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => setSourceFilter(update.source_name)}
                        className="rounded font-medium text-foreground/80 underline-offset-2 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Show only updates from ${update.source_name}`}
                      >
                        {update.source_name}
                      </button>
                      {update.source_authority && (
                        <Badge variant="outline" className="h-4 px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide">
                          {titleCase(update.source_authority)}
                        </Badge>
                      )}
                      <span title={dateLabel(update.source_published_at ?? update.ingested_at)}>· {relTime(update.source_published_at ?? update.ingested_at)}</span>
                    </p>

                    {update.ai_summary && <p className="mt-3 text-sm leading-relaxed text-foreground/90">{clean(update.ai_summary)}</p>}

                    {update.why_it_matters && (
                      <div className="mt-3 rounded-lg border-l-2 border-primary/60 bg-primary/5 py-2 pl-3 pr-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Why it matters</p>
                        <p className="mt-0.5 text-sm text-foreground/90">{update.why_it_matters}</p>
                      </div>
                    )}

                    {/* The classifier already writes a property read for every item; it was
                        only visible inside the dialog, so the feed never answered "what does
                        this mean for property?" without a click. */}
                    {update.property_implications && (
                      <div className="mt-2 rounded-lg border-l-2 border-info/60 bg-info/5 py-2 pl-3 pr-2">
                        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-info">
                          <Building2 className="h-3 w-3" />Property impact
                          <span className="rounded-full border border-info/30 px-1.5 py-0 text-[9px] font-medium normal-case tracking-normal">
                            {update.geography.some(g => g === 'Australia') ? 'Macro · national' : `Local · ${update.geography.slice(0, 2).join(', ') || 'regional'}`}
                          </span>
                        </p>
                        <p className="mt-0.5 text-sm text-foreground/90">{update.property_implications}</p>
                      </div>
                    )}

                    {update.segments.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {update.segments.map(s => (
                          <button key={s} onClick={() => setActiveSegment(s)} className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary">
                            {titleCase(s)}
                          </button>
                        ))}
                      </div>
                    )}
                    {Boolean(update.lending_criteria_tags?.length) && <div className="mt-2 flex flex-wrap gap-1" aria-label="Lending criteria topics">{update.lending_criteria_tags!.slice(0,6).map(tag=><Badge key={tag} variant="secondary" className="text-[10px]">{titleCase(tag)}</Badge>)}</div>}
                    {update.effective_date && <p className="mt-2 text-xs text-muted-foreground">Verified effective date: <strong className="text-foreground">{dateLabel(update.effective_date)}</strong></p>}

                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                      <Button size="sm" onClick={() => setSelectedUpdate(update)}>Open Analysis</Button>
                      <Button size="sm" variant="outline" onClick={() => {
                        setQaUpdate(update);
                        setQaMessage(null);
                        setQuestion('');
                        // Retain the prior conversation when re-opening the same
                        // update; only start a fresh thread for a different one.
                        if (qaThreadUpdateId !== update.id) {
                          setQaThread([]);
                          setDialogConversationId(crypto.randomUUID());
                          setQaThreadUpdateId(update.id);
                        }
                      }}><Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden />Ask Aurixa</Button>
                      {canEditMarketUpdates && <Button type="button" size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" disabled={archivePendingIds.has(update.id)||!update.id} onClick={(event:MouseEvent<HTMLButtonElement>)=>{event.preventDefault();event.stopPropagation();void archiveUpdate(update);}} aria-label={`Archive ${update.title}`}>
                        {archivePendingIds.has(update.id) ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden />}{archivePendingIds.has(update.id)?'Archiving…':'Archive'}
                      </Button>}
                      <div className="ml-auto flex flex-wrap items-center gap-1">
                        <a href={update.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/20">
                          <ExternalLink className="h-4 w-4" />Open original source
                        </a>
                      </div>
                    </div>
                  </article>
                  );
                })
              )}
            </TabsContent>
            <TabsContent value="ask-ai" className="mt-0 min-h-0">
              {renderAskAIWorkspace()}
            </TabsContent>
          </Tabs>

          {/* Sidebar */}
          <aside className="space-y-4">
            <Card className="rounded-[var(--radius-xl)] border-[color:var(--glass-hairline)] shadow-[var(--elevation-1)]">
              <CardHeader className="pb-2"><CardTitle className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">High impact watchlist</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {highImpact.length ? highImpact.map(u => (
                  <button key={u.id} onClick={() => setSelectedUpdate(u)} className="relative block w-full overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--glass-hairline)] bg-background/50 p-2.5 pl-3.5 text-left transition-[border-color,box-shadow,transform] duration-[var(--motion-base)] ease-[var(--motion-ease-out)] hover:-translate-y-px hover:border-primary/40 hover:shadow-[var(--elevation-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                    <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', IMPACT_RAIL[u.impact_level])} />
                    <div className="mb-1 flex items-center gap-1.5"><FreshnessBadge tier={u.freshness_tier} /></div>
                    <p className="line-clamp-2 text-xs font-medium leading-snug">{u.title}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{u.source_name} · {relTime(u.source_published_at ?? u.ingested_at)}</p>
                  </button>
                )) : <p className="text-xs text-muted-foreground">No high impact updates yet — the desk is quiet.</p>}
              </CardContent>
            </Card>

            <Card className="rounded-[var(--radius-xl)] border-[color:var(--glass-hairline)] shadow-[var(--elevation-1)]">
              <CardHeader className="pb-2"><CardTitle className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Segment coverage</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {SEGMENTS.map(seg => {
                  const count = segmentCounts[seg] ?? 0;
                  const pct = updates.length ? (count / updates.length) * 100 : 0;
                  return (
                    <div key={seg}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-foreground/80">{titleCase(seg)}</span>
                        <span className="tabular-nums text-muted-foreground">{count}</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary/70 transition-[width] duration-[var(--motion-slow)] ease-[var(--motion-ease-out)] motion-reduce:transition-none" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

          </aside>
        </section>

        <p className="border-t border-[color:var(--glass-hairline)] pb-6 pt-5 text-center text-[11px] tracking-wide text-muted-foreground">General market intelligence only. Review source material and obtain professional advice before acting.</p>

        {/* Analysis Dialog */}
        <Dialog open={Boolean(selectedUpdate)} onOpenChange={(open) => !open && setSelectedUpdate(null)}>
          {/* Fixed header over a scrolling body: at 6xl the prose ran to ~130 characters
              a line and the implications grid was clipped below the fold with the title
              scrolled out of view. 4xl keeps a readable measure on any screen. */}
          <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-[96vw] flex-col overflow-hidden p-0 sm:max-w-2xl lg:max-w-4xl">
            <DialogHeader className="relative shrink-0 space-y-2 overflow-hidden border-b border-[color:var(--glass-hairline)] px-6 pb-4 pt-6 text-left">
              {selectedUpdate && <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', IMPACT_RAIL[selectedUpdate.impact_level])} />}
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Update analysis</p>
              <div className="flex flex-wrap items-center gap-2">
                {selectedUpdate && <FreshnessBadge tier={selectedUpdate.freshness_tier} />}
                {selectedUpdate && <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase', IMPACT_STYLE[selectedUpdate.impact_level])}>{selectedUpdate.impact_level} impact</span>}
              </div>
              <DialogTitle className="pr-8 text-xl leading-snug tracking-[-0.02em] lg:text-2xl">{selectedUpdate?.title}</DialogTitle>
              <p className="text-sm text-muted-foreground">{selectedUpdate?.source_name} · {dateLabel(selectedUpdate?.source_published_at)}</p>
              {selectedUpdate && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {selectedUpdate.segments.map(s => (
                    <button key={s} type="button" onClick={() => { setActiveSegment(s); setSelectedUpdate(null); }} className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {titleCase(s)}
                    </button>
                  ))}
                  {selectedUpdate.source_authority && <Badge variant="outline" className="text-[10px]">{titleCase(selectedUpdate.source_authority)}</Badge>}
                  {selectedUpdate.source_perspective && <Badge variant="secondary" className="text-[10px]">{titleCase(selectedUpdate.source_perspective)}</Badge>}
                  {selectedUpdate.legal_status && selectedUpdate.legal_status !== 'not_applicable' && <Badge variant="outline" className="text-[10px]">{titleCase(selectedUpdate.legal_status)}</Badge>}
                </div>
              )}
            </DialogHeader>
            {selectedUpdate && (
              <div className="flex-1 space-y-5 overflow-y-auto px-6 pb-6 pt-5 text-base leading-relaxed">
                {selectedUpdate.ai_summary && <div><h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">AI summary</h4><p className="mt-2 leading-7">{clean(selectedUpdate.ai_summary)}</p></div>}
                {selectedUpdate.key_points.length > 0 && <div><h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Key points</h4><ul className="mt-2 list-disc space-y-1.5 pl-5">{selectedUpdate.key_points.map((p, i) => <li key={i} className="marker:text-muted-foreground">{p}</li>)}</ul></div>}
                {selectedUpdate.why_it_matters && <div className="rounded-[var(--radius-lg)] border-l-2 border-primary/60 bg-primary/5 py-3 pl-4 pr-3"><h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Why it matters</h4><p className="mt-1.5 leading-7">{selectedUpdate.why_it_matters}</p></div>}
                <div className="grid gap-4 md:grid-cols-3">
                  {selectedUpdate.property_implications && <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--glass-hairline)] p-4"><span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-info/50" /><h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--info))]">Property</h4><p className="mt-1.5 text-sm leading-6">{selectedUpdate.property_implications}</p></div>}
                  {selectedUpdate.finance_implications && <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--glass-hairline)] p-4"><span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-primary/50" /><h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Finance</h4><p className="mt-1.5 text-sm leading-6">{selectedUpdate.finance_implications}</p></div>}
                  {selectedUpdate.policy_implications && <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--glass-hairline)] p-4"><span aria-hidden className="absolute inset-x-0 top-0 h-[2px] bg-success/50" /><h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-success">Policy</h4><p className="mt-1.5 text-sm leading-6">{selectedUpdate.policy_implications}</p></div>}
                </div>
                {selectedUpdate.risk_flags.length > 0 && <div><h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-destructive">Risk flags</h4><div className="mt-2 flex flex-wrap gap-1.5">{selectedUpdate.risk_flags.map(r => <Badge key={r} variant="outline" className="border-destructive/30 text-destructive">{r}</Badge>)}</div></div>}
                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
                  <a href={selectedUpdate.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"><ExternalLink className="h-4 w-4" />Open original source</a>
                  {canEditMarketUpdates && <Button type="button" size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-foreground" disabled={archivePendingIds.has(selectedUpdate.id)||!selectedUpdate.id} onClick={(event:MouseEvent<HTMLButtonElement>) => {event.preventDefault();event.stopPropagation();const target=selectedUpdate;setSelectedUpdate(null);void archiveUpdate(target);}} aria-label={`Archive ${selectedUpdate.title}`}>
                    {archivePendingIds.has(selectedUpdate.id) ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden />}{archivePendingIds.has(selectedUpdate.id)?'Archiving…':'Archive update'}
                  </Button>}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Q&A Dialog */}
        <Dialog open={Boolean(qaUpdate)} onOpenChange={(open) => { if (!open) { cancelAsk(); setQaUpdate(null); setQaMessage(null); } }}>
          <DialogContent className="flex h-[90vh] max-w-4xl flex-col gap-0 p-0 sm:max-w-4xl">
            <DialogHeader className="relative flex-none overflow-hidden border-b border-[color:var(--glass-hairline)] p-5 pb-4">
              <div aria-hidden className="pointer-events-none absolute inset-0 bg-[image:var(--aurora-gradient)] opacity-50" />
              <div className="relative flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <AurixaMark size="md" state={asking ? 'thinking' : 'idle'} className="mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Source-grounded desk analyst</p>
                    <DialogTitle className="text-lg tracking-[-0.02em]">Ask Aurixa about this update</DialogTitle>
                    <p className="mt-1 truncate text-sm text-muted-foreground" title={qaUpdate?.title}>{qaUpdate?.title}</p>
                  </div>
                </div>
                {qaThread.length > 0 && (
                  <Button size="sm" variant="ghost" className="relative" onClick={() => { cancelAsk(); setQaThread([]); setQaMessage(null); setDialogConversationId(crypto.randomUUID()); }}>New thread</Button>
                )}
              </div>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
              {qaThread.length > 0 && (
                <div aria-label="Ask Aurixa conversation" className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-background/40 p-3">

                  {qaThread.map((turn, i) => (
                    <div key={i} className={cn('rounded-[var(--radius-lg)] p-3 text-sm', turn.role === 'user' ? 'border border-primary/20 bg-primary/10' : 'border border-[color:var(--glass-hairline)] bg-card/80 shadow-[var(--elevation-1)]')}>
                      <div className="mb-0.5 flex flex-wrap items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                        <span>{turn.role === 'user' ? 'You' : 'AI'}</span>
                        {turn.role === 'assistant' && turn.sentiment && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.sentiment}</Badge>}
                        {turn.role === 'assistant' && turn.time_horizon && turn.time_horizon !== 'unclear' && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.time_horizon.replace('_',' ')}</Badge>}
                        {turn.role === 'assistant' && turn.depth_mode && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.depth_mode === 'deep' ? 'deep dive' : turn.depth_mode}</Badge>}
                        {turn.role === 'assistant' && typeof turn.context_size === 'number' && turn.context_size > 0 && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.context_size} sources read</Badge>}
                      </div>
                      {turn.role === 'assistant' ? (
                        <MarketQAAnswer
                          content={turn.content}
                          retrieved={turn.retrieved}
                          keyFigures={turn.key_figures}
                          implications={turn.implications}
                          timeline={turn.timeline}
                          watchItems={turn.watch_items}
                          contrarianView={turn.contrarian_view}
                          streaming={turn.streaming}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap">{turn.content}</p>
                      )}
                      {turn.citations && turn.citations.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {turn.citations.map((url, j) => (
                            <a key={url + j} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"><ExternalLink className="h-4 w-4" />Open original source</a>
                          ))}
                        </div>
                      )}
                      {turn.follow_up_questions && turn.follow_up_questions.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {turn.follow_up_questions.map((fq, j) => (
                            <button key={j} type="button" onClick={() => handleFollowUp(fq)} disabled={asking} className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50">↳ {fq}</button>
                          ))}
                        </div>
                      )}
                      {turn.limitations && turn.limitations.length > 0 && <ul className="mt-2 list-disc pl-4 text-[10px] text-muted-foreground">{turn.limitations.map((l, j) => <li key={j}>{l}</li>)}</ul>}
                      {turn.role === 'assistant' && !turn.streaming && (
                        <MarketQAAnswerActions content={turn.content} retrieved={turn.retrieved} questionId={turn.question_id} questionText={qaThread[i-1]?.role === "user" ? qaThread[i-1].content : undefined} />
                      )}
                    </div>
                  ))}
                  {asking && <MarketQAProgress stage={qaStage} />}
                </div>
              )}
              {qaThread.length === 0 && (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-[var(--radius-lg)] border border-[color:var(--glass-hairline)] bg-background/40 p-6 text-center">
                  <AurixaMark size="lg" className="mb-4" />
                  <h3 className="text-base font-semibold tracking-[-0.02em]">Ask a source-grounded question</h3>
                  <p className="mt-2 max-w-md text-sm text-muted-foreground">Aurixa searches this update and the related published market news around it — prior coverage, the policy behind it and corroborating reports — then answers from what it finds. Your questions stay in this thread.</p>
                  {asking && <MarketQAProgress stage={qaStage} className="mt-4 w-full max-w-md text-left" />}
                </div>
              )}
              <Textarea value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={handleQuestionKeyDown} placeholder="Ask a source-grounded question…" className="min-h-[120px] flex-none text-sm" />
              <MarketQADepthSelector value={qaDepth} onChange={setQaDepth} disabled={asking} />
              <div className="flex flex-none gap-2">
                <MarketQAVoiceButton onTranscript={(t) => setQuestion((q) => (q ? `${q.trim()} ${t}` : t))} disabled={asking} />
                <Button onClick={() => handleAsk()} className="flex-1" disabled={asking || !question.trim()}>
                  {asking ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Asking…</> : <><Sparkles className="mr-2 h-4 w-4" />Ask safely</>}
                </Button>
                {asking && <Button variant="outline" onClick={cancelAsk}><XCircle className="mr-2 h-4 w-4" />Cancel</Button>}
              </div>
            </div>
          </DialogContent>
        </Dialog>
        {/* The candidate-review modal was retired: there is no Held chip either.
            Held items are merged into the published feed on load and promoted
            server-side through the audited publish path (reconcileHeldIntoFeed). */}


        <MarketSourcesAdminDialog open={sourcesAdminOpen} onOpenChange={setSourcesAdminOpen} onChanged={loadUpdates} />
      </div>
    </main>
  );
}
