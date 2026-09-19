import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  AlertTriangle, CheckCircle2, ExternalLink, KeyRound, Sparkles, Zap,
  Brain, Image as ImageIcon, Search, RefreshCw, ShieldCheck, Globe,
  Network, Workflow, FlaskConical, ArrowUpCircle, LayoutGrid, Rows3, X
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getRecommendedUpgrade, isModelDeprecated } from '@/lib/agentUpgradeRecommendations';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SearchInput } from '@/components/ui/search-input';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { cn } from '@/lib/utils';
import { useSearchParams } from 'react-router-dom';
import { useDebounce } from '@/hooks/useDebounce';
import { AurixaSectionHeader } from '@/components/agent/AurixaSectionHeader';
import { OpenRouterModelCard } from '@/components/model-hub/OpenRouterModelCard';
import { OpenRouterModelTable } from '@/components/model-hub/OpenRouterModelTable';
import { OpenRouterPager } from '@/components/model-hub/OpenRouterPager';
import { familyFromId, familyTint, SORT_LABELS, extractExtras, type SortKey } from '@/lib/openrouter/format';
import { BrandMark } from '@/components/integrations/BrandMark';
import {
  assertArrayField,
  assertObjectResponse,
  errorMessage,
  responseErrorMessage,
  withTimeout,
} from '@/lib/modelHubData';
import { invokeSecureFunction } from '@/lib/secureInvoke';

type Route = 'gateway' | 'native' | 'openrouter';
type Status = 'available' | 'preview' | 'deprecated' | 'unavailable';

interface CatalogModel {
  provider: string;
  route: Route;
  model_id: string;
  display_name: string;
  status: Status;
  context_window: number | null;
  capabilities: string[];
  pricing_input_per_1m: number | null;
  pricing_output_per_1m: number | null;
  last_probed_at: string;
  probe_error: string | null;
  raw_metadata?: unknown;
}

interface ProviderResult {
  provider: string;
  route: Route;
  ok: boolean;
  keyConfigured: boolean;
  modelCount: number;
  error?: string;
  probedAt: string;
}

interface AvailabilityResponse {
  success: boolean;
  cached: boolean;
  checkedAt: string;
  providers: ProviderResult[];
  models: CatalogModel[];
  nativeKeys: Record<'openai' | 'anthropic' | 'gemini' | 'perplexity', boolean>;
  gatewayKey: boolean;
  openrouterKey?: boolean;
}

interface AgentAssignment {
  id: string;
  agent_key: string;
  agent_label: string;
  agent_category: string;
  agent_description: string | null;
  route: Route;
  model_id: string;
  fallback_chain: Array<{ route: Route; model_id: string }>;
  last_used_at: string | null;
  last_error: string | null;
}

const PROVIDER_BRAND: Record<string, { name: string; color: string; docs: string }> = {
  openai:     { name: 'OpenAI',          color: 'text-success dark:text-success', docs: 'https://platform.openai.com/docs/models' },
  anthropic:  { name: 'Anthropic Claude', color: 'text-warning dark:text-warning', docs: 'https://docs.anthropic.com/en/docs/about-claude/models' },
  gemini:     { name: 'Google Gemini',   color: 'text-info dark:text-info',     docs: 'https://ai.google.dev/gemini-api/docs/models' },
  perplexity: { name: 'Perplexity',      color: 'text-accent dark:text-accent',  docs: 'https://docs.perplexity.ai/guides/model-cards' },
  gateway:    { name: 'Lovable Gateway', color: 'text-primary',     docs: 'https://docs.lovable.dev' },
  openrouter: { name: 'OpenRouter',      color: 'text-accent dark:text-accent',    docs: 'https://openrouter.ai/docs' },
};

const capabilityIcon: Record<string, React.ReactNode> = {
  text: <Sparkles className="h-3 w-3" />,
  vision: <ImageIcon className="h-3 w-3" />,
  reasoning: <Brain className="h-3 w-3" />,
  'image-gen': <ImageIcon className="h-3 w-3" />,
  'image-edit': <ImageIcon className="h-3 w-3" />,
  search: <Search className="h-3 w-3" />,
  citations: <Search className="h-3 w-3" />,
  audio: <Zap className="h-3 w-3" />,
};


function MetricTile({
  label,
  value,
  icon: Icon,
  tone,
  helper,
  loading = false,
}: {
  label: string;
  value: number;
  icon: typeof Sparkles;
  tone: 'primary' | 'info' | 'warning' | 'success';
  helper: string;
  loading?: boolean;
}) {
  const toneClasses = {
    primary: 'border-primary/30 bg-primary/[0.08] text-primary shadow-primary/10',
    info: 'border-info/25 bg-info/[0.08] text-info shadow-info/10 dark:text-info',
    warning: 'border-warning/30 bg-warning/10 text-warning shadow-brand-500/10 dark:text-brand-300',
    success: 'border-success/30 bg-success/10 text-success shadow-success/10 dark:text-success',
  }[tone];

  return (
    <DashboardThemeFrame
      variant="premiumCard"
      className={`relative min-h-[132px] p-4 shadow-lg ${toneClasses}`}
    >
      <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-current/35 to-transparent" />
      <div className="flex h-full items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
          {loading ? <Skeleton className="h-10 w-20 rounded-xl" /> : <p className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{value}</p>}
          <p className="text-xs leading-relaxed text-muted-foreground">{loading ? 'Refreshing live catalogue state…' : helper}</p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-current/20 bg-current/10 shadow-inner">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </DashboardThemeFrame>
  );
}

function statusBadge(status: Status) {
  switch (status) {
    case 'available':   return 'border-success/30 bg-success/10 text-success dark:text-success';
    case 'preview':     return 'border-info/30 bg-info/10 text-info dark:text-info';
    case 'deprecated':  return 'border-warning/35 bg-warning/10 text-warning dark:text-brand-300';
    case 'unavailable': return 'border-destructive/30 bg-destructive/10 text-destructive dark:text-destructive';
  }
}

function ModelCard({ model }: { model: CatalogModel }) {
  const brand = PROVIDER_BRAND[model.provider] ?? PROVIDER_BRAND.gateway;
  return (
    <Card className="group min-w-0 overflow-hidden border-border/60 bg-card/85 shadow-md shadow-sm dark:shadow-black/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-xl hover:shadow-primary/10 dark:border-white/10 dark:bg-background/55 dark:shadow-black/25">
      <CardHeader className="border-b border-border/50 bg-muted/20 pb-3 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/60">
              <BrandMark integrationId={model.provider} size={20} fallback={<Sparkles className="h-4 w-4 text-muted-foreground" />} />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <CardTitle className={`truncate text-sm font-semibold ${brand.color}`} title={model.display_name}>{model.display_name}</CardTitle>
              <CardDescription className="truncate font-mono text-[10px]" title={model.model_id}>{model.model_id}</CardDescription>
            </div>
          </div>
          <Badge variant="outline" className={`${statusBadge(model.status)} shrink-0 rounded-full text-[10px] font-semibold uppercase tracking-[0.12em]`}>{model.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          {(model.capabilities ?? []).slice(0, 5).map((cap) => (
            <Badge key={cap} variant="secondary" className="gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
              {capabilityIcon[cap]} {cap}
            </Badge>
          ))}
        </div>
        <div className="grid gap-2 text-[11px] text-muted-foreground">
          {model.context_window && (
            <p className="rounded-lg border border-border/50 bg-background/55 px-2 py-1">Context: <span className="font-medium text-foreground">{(model.context_window / 1000).toFixed(0)}k tokens</span></p>
          )}
          {(model.pricing_input_per_1m || model.pricing_output_per_1m) && (
            <p className="rounded-lg border border-border/50 bg-background/55 px-2 py-1">
              ${model.pricing_input_per_1m?.toFixed(2) ?? '–'} in / ${model.pricing_output_per_1m?.toFixed(2) ?? '–'} out per 1M
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderHeader({ providerId, route, ok, keyConfigured, modelCount, error }: { providerId: string; route: Route; ok: boolean; keyConfigured: boolean; modelCount: number; error?: string }) {
  const brand = PROVIDER_BRAND[providerId] ?? PROVIDER_BRAND.gateway;
  const statusClass = ok && keyConfigured
    ? 'border-success/30 bg-success/10 text-success dark:text-success'
    : keyConfigured
      ? 'border-warning/30 bg-warning/10 text-warning dark:text-brand-300'
      : 'border-destructive/30 bg-destructive/10 text-destructive dark:text-destructive';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/80 p-4 shadow-sm shadow-sm dark:shadow-black/5 dark:border-white/10 dark:bg-background/50">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
          <BrandMark
            integrationId={providerId}
            size={22}
            fallback={route === 'native' ? <KeyRound className="h-5 w-5" /> : route === 'gateway' ? <Globe className="h-5 w-5" /> : <Network className="h-5 w-5" />}
          />
        </div>
        <div className="min-w-0">
          <h3 className={`truncate text-lg font-semibold ${brand.color}`} title={brand.name}>{brand.name}</h3>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{route} provider route</p>
        </div>
        <Badge variant="outline" className={`${statusClass} rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]`}>
          {ok && keyConfigured ? <><CheckCircle2 className="mr-1 h-3 w-3" /> Live ({modelCount})</> : keyConfigured ? <><AlertTriangle className="mr-1 h-3 w-3" /> Probe failed</> : <><KeyRound className="mr-1 h-3 w-3" /> Key missing</>}
        </Badge>
        {error && <span className="max-w-[360px] truncate rounded-full border border-destructive/20 bg-destructive/10 px-2 py-1 text-xs text-destructive dark:text-destructive" title={error}>{error.slice(0, 60)}</span>}
      </div>
      <Button variant="ghost" size="sm" asChild className="rounded-xl border border-border/60 bg-background/60 hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:ring-ring">
        <a href={brand.docs} target="_blank" rel="noopener noreferrer" aria-label={`Open ${brand.name} documentation`}>Docs <ExternalLink className="ml-1 h-3 w-3" /></a>
      </Button>
    </div>
  );
}

function ProviderModels({ models, providerId, route }: { models: CatalogModel[]; providerId: string; route: Route }) {
  const filtered = models.filter((m) => m.provider === providerId && m.route === route);
  if (filtered.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-muted/25 p-5 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Search className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <p className="font-medium text-foreground">No models available for this provider route</p>
            <p className="text-xs leading-5">Configure the provider key if required, or use the existing Reload / Live re-probe actions to refresh live availability.</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {filtered.map((m) => <ModelCard key={`${m.route}-${m.model_id}`} model={m} />)}
    </div>
  );
}

// ===== Agent bindings tab =====

function AgentBindings({ catalog, onRefresh }: { catalog: CatalogModel[]; onRefresh: () => void }) {
  const [assignments, setAssignments] = useState<AgentAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await withTimeout(
        invokeSecureFunction('manage-agent-models', { action: 'list' }),
      );
      if (error) throw error;
      const response = assertObjectResponse(data, 'Agent assignments');
      if (response.success === false) throw new Error(responseErrorMessage(response, 'Failed to load agent assignments.'));
      setAssignments(assertArrayField(response, 'assignments', 'Agent assignments') as unknown as AgentAssignment[]);
    } catch (e: unknown) {
      const message = errorMessage(e);
      setLoadError(message);
      toast.error('Failed to load agent assignments: ' + message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updateAssignment = async (agent_key: string, route: Route, model_id: string) => {
    setSavingKey(agent_key);
    try {
      const { error } = await invokeSecureFunction('manage-agent-models', { action: 'update', agent_key, route, model_id });
      if (error) throw error;
      toast.success(`Updated ${agent_key} → ${model_id}`);
      await load();
    } catch (e: any) {
      toast.error('Update failed: ' + e.message);
    } finally {
      setSavingKey(null);
    }
  };

  const testAgent = async (agent_key: string) => {
    setTestingKey(agent_key);
    try {
      const { data, error } = await invokeSecureFunction<any>('manage-agent-models', { action: 'test', agent_key });
      if (error) throw error;
      if (data.success) {
        toast.success(`✓ ${agent_key}: ${data.modelUsed} (${data.latencyMs}ms)`);
      } else {
        toast.error(`✗ ${agent_key}: ${data.error}`);
      }
    } catch (e: any) {
      toast.error('Test failed: ' + e.message);
    } finally {
      setTestingKey(null);
    }
  };

  const grouped = useMemo(() => {
    const out: Record<string, AgentAssignment[]> = {};
    for (const a of assignments) {
      if (!out[a.agent_category]) out[a.agent_category] = [];
      out[a.agent_category].push(a);
    }
    return out;
  }, [assignments]);

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Agent bindings could not be loaded</AlertTitle>
        <AlertDescription className="mt-2 flex flex-col items-start gap-3">
          <span>{loadError} Your existing assignments have not been changed.</span>
          <Button variant="outline" size="sm" onClick={load} className="border-destructive/30 bg-background/70">
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry bindings
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (assignments.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-muted/25 p-6 text-sm">
        <p className="font-medium text-foreground">No agent bindings are configured</p>
        <p className="mt-1 text-muted-foreground">Bindings appear after agent assignments are seeded. Refresh the catalogue, then retry this section.</p>
        <Button variant="outline" size="sm" onClick={onRefresh} className="mt-4"><RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh catalogue</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Alert className="relative overflow-hidden border-primary/25 bg-[linear-gradient(135deg,hsl(var(--primary)/0.10),hsl(var(--card)/0.88)_42%,hsl(var(--background)/0.72))] p-5 shadow-lg shadow-primary/5 dark:border-primary/20">
        <div className="absolute inset-y-0 left-0 w-1 bg-primary/70" />
        <Workflow className="h-5 w-5 text-primary" />
        <AlertTitle className="text-base font-semibold text-foreground">Dynamic Agent Routing</AlertTitle>
        <AlertDescription className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
          Each agent reads its model assignment from this table at runtime. Changes apply immediately to the next call — no redeploys needed.
          The fallback chain auto-engages on 404/410/5xx errors.
        </AlertDescription>
      </Alert>

      {Object.entries(grouped).map(([category, agents]) => (
        <Card key={category} className="overflow-hidden border-border/60 bg-card/80 shadow-lg shadow-sm dark:shadow-black/5 dark:border-white/10 dark:bg-background/55 dark:shadow-black/25">
          <CardHeader className="border-b border-border/60 bg-muted/30 pb-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground">{category}</CardTitle>
                <CardDescription className="text-xs">Runtime route and model assignments for this agent group.</CardDescription>
              </div>
              <Badge variant="outline" className="rounded-full border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="w-full overflow-x-auto overscroll-x-contain [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]">
              <Table className="min-w-[960px]">
                <TableHeader className="bg-background/70 dark:bg-black/20">
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead className="w-[280px] py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Agent</TableHead>
                    <TableHead className="w-[150px] py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Route</TableHead>
                    <TableHead className="min-w-[360px] py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Model</TableHead>
                    <TableHead className="w-[150px] py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Last used</TableHead>
                    <TableHead className="w-[110px] py-3 text-right text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.map((a) => {
                    const modelsForRoute = catalog.filter((m) => m.route === a.route);
                    const currentExists = modelsForRoute.some((m) => m.model_id === a.model_id);
                    const catalogEntry = catalog.find((m) => m.route === a.route && m.model_id === a.model_id);
                    const deprecated = isModelDeprecated(a.model_id, catalogEntry?.status);
                    const recommended = getRecommendedUpgrade(a.agent_key, a.agent_category);
                    const isOnRecommended = recommended && recommended.model_id === a.model_id && recommended.route === a.route;
                    const showUpgrade = recommended && !isOnRecommended && (deprecated || !currentExists || catalogEntry?.status === 'preview');
                    return (
                      <TableRow key={a.agent_key} className={`border-border/50 transition-colors hover:bg-primary/5 ${deprecated ? 'bg-warning/10' : 'bg-card/30'}`}>
                        <TableCell className="py-4 align-top">
                          <div className="min-w-0 space-y-1.5">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="truncate text-sm font-semibold text-foreground" title={a.agent_label}>{a.agent_label}</div>
                              {deprecated && (
                                <Badge variant="outline" className="shrink-0 border-warning/40 bg-warning/10 text-[10px] text-warning dark:text-brand-300">
                                  <AlertTriangle className="mr-1 h-2.5 w-2.5" /> deprecated
                                </Badge>
                              )}
                            </div>
                            <div className="truncate font-mono text-[11px] text-muted-foreground" title={a.agent_key}>{a.agent_key}</div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 align-top">
                          <Select value={a.route} onValueChange={(v: Route) => updateAssignment(a.agent_key, v, catalog.find((m) => m.route === v)?.model_id ?? a.model_id)}>
                            <SelectTrigger className="h-9 rounded-xl border-border/70 bg-background/80 text-xs shadow-sm focus:ring-ring" aria-label={`Route for ${a.agent_label}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="gateway">gateway</SelectItem>
                              <SelectItem value="native">native</SelectItem>
                              <SelectItem value="openrouter">openrouter</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="py-4 align-top">
                          <Select value={a.model_id} onValueChange={(v) => updateAssignment(a.agent_key, a.route, v)} disabled={savingKey === a.agent_key}>
                            <SelectTrigger className={`h-9 min-w-0 rounded-xl border-border/70 bg-background/80 font-mono text-xs shadow-sm focus:ring-ring ${deprecated ? 'border-warning/50' : ''}`} aria-label={`Model for ${a.agent_label}`} title={a.model_id}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-[300px]">
                              {!currentExists && <SelectItem value={a.model_id} className="text-warning dark:text-brand-300">{a.model_id} (not in catalog)</SelectItem>}
                              {modelsForRoute.map((m) => (
                                <SelectItem key={m.model_id} value={m.model_id}>
                                  <span className="font-mono text-xs">{m.model_id}</span>
                                  {m.status !== 'available' && <span className="ml-2 text-[10px] text-muted-foreground">[{m.status}]</span>}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {a.last_error && <p className="mt-2 max-w-[340px] truncate rounded-lg border border-destructive/20 bg-destructive/10 px-2 py-1 text-[10px] text-destructive dark:text-destructive" title={a.last_error}>⚠ {a.last_error.slice(0, 80)}</p>}
                          {showUpgrade && recommended && (
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    disabled={savingKey === a.agent_key}
                                    onClick={() => updateAssignment(a.agent_key, recommended.route, recommended.model_id)}
                                    className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-1 text-[10px] font-medium text-success transition hover:bg-success/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 dark:text-success"
                                    aria-label={`Apply recommended model ${recommended.model_id} to ${a.agent_label}`}
                                  >
                                    <ArrowUpCircle className="h-3 w-3" />
                                    Upgrade to <span className="truncate font-mono" title={recommended.model_id}>{recommended.model_id}</span>
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[300px] text-xs">
                                  <div className="font-semibold mb-1">Recommended for this scope</div>
                                  <div className="text-muted-foreground">{recommended.reason}</div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {isOnRecommended && (
                            <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-success dark:text-success">
                              <CheckCircle2 className="h-2.5 w-2.5" /> on recommended model
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="py-4 align-top text-xs text-muted-foreground">
                          <span className="block max-w-[140px] leading-5">{a.last_used_at ? new Date(a.last_used_at).toLocaleString('en-AU') : '—'}</span>
                        </TableCell>
                        <TableCell className="py-4 text-right align-top">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={testingKey === a.agent_key}
                            onClick={() => testAgent(a.agent_key)}
                            aria-label={`Test model route for ${a.agent_label}`}
                            title={`Test model route for ${a.agent_label}`}
                            className="h-9 w-9 rounded-xl border border-border/60 bg-background/70 text-muted-foreground shadow-sm transition hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:ring-ring"
                          >
                            {testingKey === a.agent_key ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ===== OpenRouter tab =====

const MODALITY_OPTS = ['text', 'image', 'audio', 'file'] as const;

function OpenRouterCatalog({ models, lastProbedAt }: { models: CatalogModel[]; lastProbedAt?: string }) {
  const [params, setParams] = useSearchParams();
  const orModels = useMemo(() => models.filter((m) => m.route === 'openrouter'), [models]);

  // URL-synced state
  const search = params.get('or_q') ?? '';
  const family = params.get('or_family') ?? 'all';
  const modalitiesParam = params.get('or_mod') ?? '';
  const modalities = useMemo(() => modalitiesParam ? modalitiesParam.split(',').filter(Boolean) : [], [modalitiesParam]);
  const sort = (params.get('or_sort') as SortKey) || 'popular';
  const view = (params.get('or_view') as 'grid' | 'table') || 'grid';
  const page = Math.max(1, Number(params.get('or_page') ?? '1') || 1);
  const pageSizeRaw = params.get('or_size') ?? '24';
  const pageSize: number | 'all' = pageSizeRaw === 'all' ? 'all' : Math.max(1, Number(pageSizeRaw) || 24);

  const debouncedSearch = useDebounce(search, 200);

  const patch = (updates: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete('or_page');
    setParams(next, { replace: true });
  };

  const families = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of orModels) {
      const f = familyFromId(m.model_id);
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [orModels]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    const arr = orModels.filter((m) => {
      if (family !== 'all' && familyFromId(m.model_id) !== family) return false;
      if (q && !m.model_id.toLowerCase().includes(q) && !m.display_name.toLowerCase().includes(q)) return false;
      if (modalities.length > 0) {
        const ex = extractExtras(m.raw_metadata);
        const all = new Set([...ex.inputModalities, ...ex.outputModalities]);
        if (!modalities.every((mod) => all.has(mod))) return false;
      }
      return true;
    });
    const sorted = [...arr];
    switch (sort) {
      case 'newest':
        sorted.sort((a, b) => {
          const at = extractExtras(a.raw_metadata).releasedAt ?? '';
          const bt = extractExtras(b.raw_metadata).releasedAt ?? '';
          return bt.localeCompare(at);
        });
        break;
      case 'context-desc':
        sorted.sort((a, b) => (b.context_window ?? 0) - (a.context_window ?? 0));
        break;
      case 'price-asc':
        sorted.sort((a, b) => (a.pricing_input_per_1m ?? Infinity) - (b.pricing_input_per_1m ?? Infinity));
        break;
      case 'name-asc':
        sorted.sort((a, b) => a.display_name.localeCompare(b.display_name));
        break;
      // 'popular' = original OpenRouter order
    }
    return sorted;
  }, [orModels, debouncedSearch, family, modalities, sort]);

  const [cheapestInput, priciestInput] = useMemo(() => {
    const prices = filtered.map((m) => m.pricing_input_per_1m).filter((n): n is number => typeof n === 'number' && n > 0);
    if (!prices.length) return [undefined, undefined] as const;
    return [Math.min(...prices), Math.max(...prices)] as const;
  }, [filtered]);

  const total = filtered.length;
  const pageCount = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = pageSize === 'all' ? filtered : filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const maxFamCount = families[0]?.[1] ?? 1;
  const activeFilterCount = (family !== 'all' ? 1 : 0) + modalities.length + (debouncedSearch ? 1 : 0);

  if (orModels.length === 0) {
    return (
      <div className="aurixa-aurora-bg relative overflow-hidden rounded-[24px] p-6">
        <div className="aurixa-glass flex flex-col items-start gap-3 rounded-[20px] p-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-warning/30 bg-warning/10 text-warning">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-heading text-xl font-medium text-foreground">OpenRouter not configured</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Add <code className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-foreground">OPENROUTER_API_KEY</code> in <strong>Integrations → OpenRouter</strong>.
              Once enabled, 300+ models from Anthropic, OpenAI, Meta, Mistral, DeepSeek, Qwen and more will appear here.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild className="rounded-xl border-primary/30 bg-primary/10 text-primary hover:bg-primary/15">
            <a href="/integrations">Open Integrations <ExternalLink className="ml-1 h-3 w-3" /></a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="aurixa-aurora-bg relative overflow-hidden rounded-[24px] p-4 sm:p-6">
      {/* Hero */}
      <div className="mb-5">
        <AurixaSectionHeader
          eyebrow="OpenRouter · unified gateway"
          title="Model Catalog"
          description={<>Browse the full live OpenRouter catalog — filter, sort, and page through every model, with pricing and modalities surfaced inline.</>}
          actions={
            <div className="flex flex-col items-end gap-1 text-right">
              <span className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
                {orModels.length} models · {families.length} providers
              </span>
              {lastProbedAt && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  probed {new Date(lastProbedAt).toLocaleString('en-AU')}
                </span>
              )}
            </div>
          }
        />
        {/* Provider-mix sparkline */}
        <div className="mt-4 flex flex-wrap items-end gap-2">
          {families.slice(0, 8).map(([f, c]) => {
            const tint = familyTint(f);
            const active = family === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => patch({ or_family: active ? null : f })}
                className={cn(
                  'group flex min-w-[64px] flex-col items-start gap-1 rounded-xl border px-2.5 py-1.5 text-left transition-all',
                  active ? 'border-primary/40 bg-primary/10' : 'border-border/40 bg-background/40 hover:border-primary/30'
                )}
              >
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-foreground">
                  <BrandMark integrationId={f} size={12} fallback={<span className={cn('h-1.5 w-1.5 rounded-full', tint.dot)} />} />
                  {f}
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full rounded-full', tint.dot)} style={{ width: `${Math.max(6, (c / maxFamCount) * 100)}%` }} />
                </div>
                <span className="font-mono text-[9px] text-muted-foreground">{c}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Command bar */}
      <div className="aurixa-glass mb-4 flex flex-wrap items-center gap-2 rounded-[18px] p-2.5">
        <SearchInput
          value={search}
          onValueChange={(value) => patch({ or_q: value || null })}
          aria-label="Search OpenRouter models"
          placeholder="Search by name, ID, or provider…"
          containerClassName="flex-1 min-w-[220px]"
          className="h-9 rounded-xl bg-background/60 pr-3 focus-visible:ring-ring"
          iconClassName="h-3.5 w-3.5"
        />
        <Select value={family} onValueChange={(v) => patch({ or_family: v === 'all' ? null : v })}>
          <SelectTrigger aria-label="Filter family" className="h-9 w-[180px] rounded-xl bg-background/60"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {families.map(([f, c]) => <SelectItem key={f} value={f}>{f} · {c}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          {MODALITY_OPTS.map((mod) => {
            const active = modalities.includes(mod);
            return (
              <button
                key={mod}
                type="button"
                onClick={() => {
                  const next = active ? modalities.filter((m) => m !== mod) : [...modalities, mod];
                  patch({ or_mod: next.length ? next.join(',') : null });
                }}
                className={cn(
                  'rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors',
                  active ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border/50 text-muted-foreground hover:border-primary/30 hover:text-primary'
                )}
              >
                {mod}
              </button>
            );
          })}
        </div>
        <Select value={sort} onValueChange={(v) => patch({ or_sort: v === 'popular' ? null : v })}>
          <SelectTrigger aria-label="Sort" className="h-9 w-[180px] rounded-xl bg-background/60"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <SelectItem key={k} value={k}>{SORT_LABELS[k]}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center rounded-xl border border-border/50 bg-background/60 p-0.5">
          <button
            type="button"
            onClick={() => patch({ or_view: null }, false)}
            className={cn('flex h-8 w-8 items-center justify-center rounded-lg', view === 'grid' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
            aria-label="Grid view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => patch({ or_view: 'table' }, false)}
            className={cn('flex h-8 w-8 items-center justify-center rounded-lg', view === 'table' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
            aria-label="Table view"
          >
            <Rows3 className="h-3.5 w-3.5" />
          </button>
        </div>
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 rounded-full text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          >
            <X className="h-3 w-3" /> Clear ({activeFilterCount})
          </Button>
        )}
      </div>

      {/* Results */}
      {total === 0 ? (
        <div className="aurixa-glass flex flex-col items-center gap-3 rounded-[20px] p-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Search className="h-4 w-4" />
          </div>
          <div>
            <p className="font-heading text-base font-medium text-foreground">No models match these filters</p>
            <p className="mt-1 text-xs text-muted-foreground">Try a different provider, clear a modality chip, or reset all filters.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })} className="rounded-full border-primary/30 bg-primary/10 text-primary hover:bg-primary/15">
            Clear all filters
          </Button>
        </div>
      ) : view === 'table' ? (
        <div className="space-y-4">
          <OpenRouterModelTable models={visible} sort={sort} onSort={(k) => patch({ or_sort: k === 'popular' ? null : k })} />
          <OpenRouterPager
            page={safePage}
            pageCount={pageCount}
            total={total}
            pageSize={pageSize}
            onPage={(p) => patch({ or_page: p === 1 ? null : String(p) }, false)}
            onPageSize={(s) => patch({ or_size: s === 24 ? null : String(s) })}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((m) => (
              <OpenRouterModelCard key={m.model_id} model={m} cheapestInput={cheapestInput} priciestInput={priciestInput} />
            ))}
          </div>
          <OpenRouterPager
            page={safePage}
            pageCount={pageCount}
            total={total}
            pageSize={pageSize}
            onPage={(p) => patch({ or_page: p === 1 ? null : String(p) }, false)}
            onPageSize={(s) => patch({ or_size: s === 24 ? null : String(s) })}
          />
        </div>
      )}
    </div>
  );
}


// ===== Page =====

export default function ModelHub() {
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchAll = async (force = false) => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data: res, error } = await withTimeout(
        supabase.functions.invoke('check-model-availability', { body: { force } }),
      );
      if (error) throw error;
      const response = assertObjectResponse(res, 'Model catalogue');
      if (response.success !== true) throw new Error(responseErrorMessage(response, 'The model catalogue could not be loaded.'));
      assertArrayField(response, 'models', 'Model catalogue');
      assertArrayField(response, 'providers', 'Model catalogue');
      setData(response as unknown as AvailabilityResponse);
      if (force) toast.success('Live probe complete — catalog refreshed');
    } catch (e: unknown) {
      const message = errorMessage(e);
      setLoadError(message);
      toast.error('Failed to load: ' + message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(false); }, []);

  const stats = useMemo(() => {
    const models = data?.models ?? [];
    return {
      total: models.length,
      preview: models.filter((m) => m.status === 'preview').length,
      deprecated: models.filter((m) => m.status === 'deprecated').length,
      providers: new Set(models.map((m) => m.provider)).size,
    };
  }, [data]);

  const providersByRoute = (route: Route) => (data?.providers ?? []).filter((p) => p.route === route);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_10%_0%,hsl(var(--primary)/0.14),transparent_30rem),radial-gradient(circle_at_92%_8%,hsl(var(--info)/0.08),transparent_24rem)] p-3 text-foreground sm:p-5 lg:p-6">
      <DashboardThemeFrame variant="page" className="space-y-6 pb-8">
        <DashboardThemeFrame
          as="header"
          variant="hero"
          className="border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.94),hsl(var(--background)/0.86)_50%,hsl(var(--primary)/0.10))] shadow-2xl shadow-sm dark:shadow-black/10 dark:shadow-black/35"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary shadow-sm shadow-primary/10">
                <Network className="h-3.5 w-3.5" />
                LLM operations control centre
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">Model Hub</h1>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Live LLM availability across Gateway, Native, and OpenRouter routes — with dynamic agent binding.
                </p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-3 rounded-2xl border border-border/60 bg-background/55 p-3 shadow-sm backdrop-blur sm:w-auto sm:min-w-[320px] dark:border-white/10 dark:bg-background/40">
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => fetchAll(false)}
                  disabled={loading}
                  className="justify-center border-border/70 bg-card/80 shadow-sm transition-all hover:border-primary/35 hover:bg-primary/5 focus-visible:ring-ring"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Reload
                </Button>
                <Button
                  onClick={() => fetchAll(true)}
                  disabled={loading}
                  className="justify-center bg-primary text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 focus-visible:ring-ring"
                >
                  <Network className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Live re-probe
                </Button>
              </div>
              <p className="text-center text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:text-right">
                {data?.checkedAt ? `${data.cached ? 'Cached' : 'Live'} probe • ${new Date(data.checkedAt).toLocaleString('en-AU')}` : 'Awaiting latest probe metadata'}
              </p>
            </div>
          </div>
        </DashboardThemeFrame>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Model availability summary">
          <MetricTile label="Live models" value={stats.total} icon={Sparkles} tone="primary" helper="Available catalogue entries across active routes." loading={loading} />
          <MetricTile label="Preview" value={stats.preview} icon={Zap} tone="info" helper="Models marked preview by the current catalogue." loading={loading} />
          <MetricTile label="Deprecated" value={stats.deprecated} icon={AlertTriangle} tone="warning" helper="Models flagged for migration or replacement." loading={loading} />
          <MetricTile label="Providers" value={stats.providers} icon={ShieldCheck} tone="success" helper="Distinct providers represented in live data." loading={loading} />
        </section>

        {loadError && (
          <Alert variant="destructive" className="border-destructive/30 bg-destructive/10" role="alert">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Live model data is unavailable</AlertTitle>
            <AlertDescription className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{loadError} Check your connection or session, then retry. No model assignments were changed.</span>
              <Button variant="outline" size="sm" onClick={() => fetchAll(false)} className="shrink-0 border-destructive/30 bg-background/70">
                <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry loading
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="bindings" className="space-y-6">
          <DashboardThemeFrame variant="toolbar" className="p-1.5">
            <TabsList aria-label="Model Hub route sections" className="flex h-auto w-full flex-wrap items-stretch justify-start gap-1 rounded-xl bg-muted/40 p-1">
              <TabsTrigger value="bindings" className="min-w-[145px] flex-1 gap-2 rounded-lg px-3 py-2 text-xs font-semibold focus-visible:ring-ring data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:shadow-primary/20 sm:text-sm"><Workflow className="h-4 w-4" /> Agent Bindings</TabsTrigger>
              <TabsTrigger value="gateway" className="min-w-[125px] flex-1 gap-2 rounded-lg px-3 py-2 text-xs font-semibold focus-visible:ring-ring data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:shadow-primary/20 sm:text-sm"><Globe className="h-4 w-4" /> Gateway</TabsTrigger>
              <TabsTrigger value="native" className="min-w-[115px] flex-1 gap-2 rounded-lg px-3 py-2 text-xs font-semibold focus-visible:ring-ring data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:shadow-primary/20 sm:text-sm"><KeyRound className="h-4 w-4" /> Native</TabsTrigger>
              <TabsTrigger value="openrouter" className="min-w-[145px] flex-1 gap-2 rounded-lg px-3 py-2 text-xs font-semibold focus-visible:ring-ring data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:shadow-primary/20 sm:text-sm"><Network className="h-4 w-4" /> OpenRouter {data?.openrouterKey && <Badge variant="outline" className="ml-1 h-4 border-accent/30 px-1 text-[9px] text-accent dark:text-accent">on</Badge>}</TabsTrigger>
            </TabsList>
          </DashboardThemeFrame>

        <TabsContent value="bindings" className="min-w-0">
          {loading ? <Skeleton className="h-96 w-full" /> : <AgentBindings catalog={data?.models ?? []} onRefresh={() => fetchAll(false)} />}
        </TabsContent>

        <TabsContent value="gateway" className="space-y-6">
          <Alert className="relative overflow-hidden border-success/25 bg-[linear-gradient(135deg,hsl(var(--success)/0.12),hsl(var(--card)/0.90)_46%,hsl(var(--background)/0.75))] p-5 shadow-lg shadow-success/5">
            <div className="absolute inset-y-0 left-0 w-1 bg-success/80" />
            <ShieldCheck className="h-5 w-5 text-success dark:text-success" />
            <AlertTitle className="text-base font-semibold text-foreground">Lovable Gateway</AlertTitle>
            <AlertDescription className="mt-1 text-sm leading-6 text-muted-foreground">
              Billed via workspace credits. No per-provider keys required.
            </AlertDescription>
          </Alert>
          {loading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
          ) : (
            <div className="space-y-6">
              {providersByRoute('gateway').length === 0 ? (
                <ProviderModels models={data?.models ?? []} providerId="gateway" route="gateway" />
              ) : providersByRoute('gateway').map((p) => (
                <DashboardThemeFrame key={`${p.provider}-${p.route}`} variant="section" className="space-y-4 p-4 sm:p-5">
                  <ProviderHeader providerId={p.provider} route={p.route} ok={p.ok} keyConfigured={p.keyConfigured} modelCount={p.modelCount} error={p.error} />
                  <ProviderModels models={data?.models ?? []} providerId={p.provider} route="gateway" />
                </DashboardThemeFrame>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="native" className="space-y-6">
          <Alert className="relative overflow-hidden border-primary/25 bg-[linear-gradient(135deg,hsl(var(--primary)/0.12),hsl(var(--card)/0.90)_46%,hsl(var(--background)/0.75))] p-5 shadow-lg shadow-primary/5">
            <div className="absolute inset-y-0 left-0 w-1 bg-primary/75" />
            <KeyRound className="h-5 w-5 text-primary" />
            <AlertTitle className="text-base font-semibold text-foreground">Direct provider keys</AlertTitle>
            <AlertDescription className="mt-1 text-sm leading-6 text-muted-foreground">
              Configure keys in the <strong>Integrations</strong> page. Missing keys grey out the section.
            </AlertDescription>
          </Alert>
          {loading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
          ) : (
            <div className="space-y-6">
              {(['openai', 'anthropic', 'gemini', 'perplexity'] as const).map((prov) => {
                const p = providersByRoute('native').find((x) => x.provider === prov) ?? { provider: prov, route: 'native' as Route, ok: false, keyConfigured: false, modelCount: 0, probedAt: '' };
                return (
                  <DashboardThemeFrame key={prov} variant="section" className="space-y-4 p-4 sm:p-5">
                    <ProviderHeader providerId={prov} route="native" ok={p.ok} keyConfigured={p.keyConfigured} modelCount={p.modelCount} error={p.error} />
                    <ProviderModels models={data?.models ?? []} providerId={prov} route="native" />
                  </DashboardThemeFrame>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="openrouter" className="min-w-0">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full rounded-2xl" />
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
              </div>
            </div>
          ) : <OpenRouterCatalog models={data?.models ?? []} lastProbedAt={data?.checkedAt} />}
        </TabsContent>
      </Tabs>

      {data?.checkedAt && (
        <p className="text-center text-xs text-muted-foreground">
          {data.cached ? 'Cached' : 'Live'} • Last probe: {new Date(data.checkedAt).toLocaleString('en-AU')}
        </p>
      )}
      </DashboardThemeFrame>
    </main>
  );
}
