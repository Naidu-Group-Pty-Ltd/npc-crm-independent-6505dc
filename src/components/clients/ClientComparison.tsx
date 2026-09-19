import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { smartCapitalize } from '@/lib/nameUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { 
  Scale, 
  Building2, 
  DollarSign, 
  TrendingUp,
  Percent,
  Users,
  Search,
  Star,
  Sparkles,
  UserCheck,
  X
} from 'lucide-react';

interface Client {
  id: string;
  primary_first_name: string;
  primary_surname: string;
  primary_email: string | null;
  total_portfolio_value: number;
  total_debt: number;
  net_monthly_cash_flow: number;
  client_properties?: { id: string }[];
  is_favorite?: boolean;
}

interface ClientComparisonProps {
  clients: Client[];
}

export function ClientComparison({ clients }: ClientComparisonProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showActiveOnly, setShowActiveOnly] = useState(false);

  // Filter client list by search + active toggle
  const filteredClients = useMemo(() => {
    let list = clients;
    if (showActiveOnly) {
      list = list.filter(c => c.is_favorite);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => {
        const name = `${c.primary_first_name} ${c.primary_surname}`.toLowerCase();
        const email = c.primary_email?.toLowerCase() || '';
        return name.includes(q) || email.includes(q);
      });
    }
    return list;
  }, [clients, searchQuery, showActiveOnly]);

  const selectedClients = clients.filter(c => selectedIds.includes(c.id));

  const activeClientCount = clients.filter(c => c.is_favorite).length;

  // Fetch scores for selected clients via secure edge function
  const { data: scores = [] } = useQuery({
    queryKey: ['client-scores-comparison', selectedIds],
    queryFn: async () => {
      if (selectedIds.length === 0) return [];
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'client_scores',
          select: '*',
          filters: { client_id: selectedIds },
        }
      });
      if (error) {
        console.warn('[ClientComparison] Failed to fetch scores:', error.message);
        return [];
      }
      return (data?.records || []) as any[];
    },
    enabled: selectedIds.length > 0
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getScoreForClient = (clientId: string) => {
    return scores.find((s: any) => s.client_id === clientId);
  };

  const getHighestValue = (key: keyof Client) => {
    const values = selectedClients.map(c => Number(c[key]) || 0);
    return Math.max(...values);
  };

  const toggleClient = (clientId: string) => {
    setSelectedIds(prev => 
      prev.includes(clientId) 
        ? prev.filter(id => id !== clientId)
        : prev.length < 4 ? [...prev, clientId] : prev
    );
  };

  const clearSelection = () => setSelectedIds([]);

  const metrics = [
    { 
      key: 'total_portfolio_value' as const, 
      label: 'Portfolio Value', 
      icon: DollarSign, 
      format: formatCurrency,
      higherIsBetter: true 
    },
    { 
      key: 'total_debt' as const, 
      label: 'Total Debt', 
      icon: DollarSign, 
      format: formatCurrency,
      higherIsBetter: false 
    },
    { 
      key: 'net_monthly_cash_flow' as const, 
      label: 'Monthly Cash Flow', 
      icon: TrendingUp, 
      format: formatCurrency,
      higherIsBetter: true 
    },
  ];

  return (
    <div className="space-y-6">
      {/* Client Selection */}
      <Card className="relative overflow-hidden rounded-3xl border-brand-400/15 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.13),transparent_32%),linear-gradient(145deg,rgba(24,24,27,0.95),rgba(3,7,18,0.9))] shadow-2xl shadow-[0_16px_44px_rgba(15,23,42,0.10)] dark:shadow-black/25">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
        <CardHeader className="border-b border-border/60 dark:border-white/10 pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-300/20 bg-brand-300/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">
                <Sparkles className="h-3.5 w-3.5" />
                Benchmark workspace
              </div>
              <CardTitle className="flex items-center gap-3 text-xl font-bold tracking-tight text-foreground dark:text-white sm:text-2xl">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-brand-300/25 bg-brand-300/15 text-brand-700 dark:text-brand-100 shadow-lg shadow-brand-950/20">
                  <Users className="h-5 w-5" />
                </span>
                Select Clients to Compare
              </CardTitle>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground dark:text-muted-foreground">
                Search and filter your client list, then choose a focused cohort for side-by-side portfolio benchmarking.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border/60 dark:border-white/10 bg-background/70 dark:bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-muted-foreground dark:text-foreground">
                <span className="h-2 w-2 rounded-full bg-brand-300 shadow-[0_0_12px_rgba(251,191,36,0.65)]" />
                Max 4 clients · {selectedIds.length}/4 selected
              </div>
              {selectedIds.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearSelection} className="h-9 rounded-full border border-border/60 dark:border-white/10 bg-background/55 dark:bg-white/[0.03] px-3 text-xs font-semibold text-muted-foreground dark:text-foreground hover:bg-primary/10 hover:text-foreground dark:hover:bg-white/[0.07] dark:hover:text-white">
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Clear ({selectedIds.length})
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-4 sm:p-5">
          {/* Search and Active filter */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <SearchInput
              value={searchQuery}
              onValueChange={setSearchQuery}
              placeholder="Search clients by name or email..."
              aria-label="Search clients to compare"
              containerClassName="flex-1"
              className="h-12 rounded-2xl border-brand-300/15 bg-muted/45 dark:bg-black/20 pr-4 text-sm text-foreground dark:text-white shadow-inner shadow-[0_14px_38px_rgba(15,23,42,0.08)] dark:shadow-black/20 placeholder:text-muted-foreground/80 dark:text-muted-foreground transition-all hover:border-brand-300/30 focus-visible:border-brand-300/55 focus-visible:ring-2 focus-visible:ring-brand-300/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              iconClassName="left-4 text-brand-700 dark:text-brand-100/55"
            />
            <Button
              variant={showActiveOnly ? 'default' : 'outline'}
              size="sm"
              aria-pressed={showActiveOnly}
              className={`h-12 shrink-0 gap-2 rounded-2xl px-4 text-sm font-semibold transition-all hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-brand-300/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                showActiveOnly
                  ? 'border-brand-300/30 bg-gradient-to-r from-brand-300 to-brand-500 text-black shadow-lg shadow-brand-500/20 hover:from-brand-200 hover:to-brand-400'
                  : 'border-border/60 dark:border-white/10 bg-background/65 dark:bg-white/[0.035] text-muted-foreground dark:text-foreground hover:border-brand-300/30 hover:bg-brand-300/10 hover:text-brand-700 dark:hover:text-brand-100'
              }`}
              onClick={() => setShowActiveOnly(!showActiveOnly)}
            >
              <Star className={`h-4 w-4 ${showActiveOnly ? 'fill-current' : ''}`} />
              Active Clients
              {activeClientCount > 0 && (
                <Badge variant={showActiveOnly ? 'secondary' : 'outline'} className={`h-5 rounded-full px-2 text-[10px] font-bold ${showActiveOnly ? 'border-black/10 bg-background/10 dark:bg-black/10 text-black' : 'border-brand-300/25 bg-brand-300/10 text-brand-700 dark:text-brand-100'}`}>
                  {activeClientCount}
                </Badge>
              )}
            </Button>
          </div>

          <ScrollArea className="h-[320px] rounded-2xl border border-border/60 dark:border-white/10 bg-muted/35 dark:bg-black/15 p-3 shadow-inner shadow-[0_16px_44px_rgba(15,23,42,0.10)] dark:shadow-black/25 sm:h-[280px]">
            {filteredClients.length === 0 ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-brand-300/20 bg-brand-300/[0.03] px-6 py-8 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-300/20 bg-brand-300/10 text-brand-700 dark:text-brand-100">
                  <Search className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-foreground/90 dark:text-foreground">
                  {showActiveOnly
                    ? 'No active clients found'
                    : 'No clients match your search'
                  }
                </p>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground/80 dark:text-muted-foreground">
                  {showActiveOnly
                    ? 'Star clients to mark them as active, or turn off the Active Clients filter.'
                    : 'Try a different name or email to build your comparison cohort.'
                  }
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredClients.map((client) => {
                  const isSelected = selectedIds.includes(client.id);

                  return (
                    <div
                      key={client.id}
                      className={`group flex cursor-pointer items-center gap-3 rounded-2xl border p-3.5 transition-all duration-300 ${
                        isSelected
                          ? 'border-brand-300/70 bg-brand-300/12 shadow-lg shadow-brand-500/20 ring-1 ring-brand-200/30 hover:shadow-[0_16px_36px_rgba(245,158,11,0.18)]'
                          : 'border-border/60 dark:border-white/10 bg-background/65 dark:bg-white/[0.035] opacity-90 hover:-translate-y-0.5 hover:border-brand-300/35 hover:bg-background/70 dark:bg-white/[0.06] hover:opacity-100 hover:shadow-[0_12px_28px_rgba(245,158,11,0.08)] focus-within:border-brand-300/45 focus-within:ring-2 focus-within:ring-brand-300/20'
                      }`}
                      onClick={() => toggleClient(client.id)}
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border transition-colors ${isSelected ? 'border-brand-200/60 bg-brand-300/20 text-brand-700 dark:text-brand-100' : 'border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20 text-muted-foreground/80 dark:text-muted-foreground group-hover:text-brand-700 dark:group-hover:text-brand-100'}`}>
                        <Checkbox 
                          checked={isSelected}
                          onCheckedChange={() => toggleClient(client.id)}
                          aria-label={`Select ${smartCapitalize(client.primary_first_name)} ${smartCapitalize(client.primary_surname)} for comparison`}
                          className="border-current data-[state=checked]:border-brand-300 data-[state=checked]:bg-brand-400 data-[state=checked]:text-black"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className={`truncate text-sm font-semibold ${isSelected ? 'text-brand-950 dark:text-brand-50' : 'text-foreground/90 dark:text-foreground'}`}>
                            {smartCapitalize(client.primary_first_name)} {smartCapitalize(client.primary_surname)}
                          </p>
                          {client.is_favorite && (
                            <Star className="h-3.5 w-3.5 shrink-0 fill-brand-400 text-brand-400" />
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground/80 dark:text-muted-foreground">
                          {client.primary_email || 'No email on file'}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-muted-foreground dark:text-muted-foreground">
                          <span className="rounded-full border border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20 px-2 py-0.5">{client.client_properties?.length || 0} properties</span>
                          <span className="rounded-full border border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20 px-2 py-0.5">{formatCurrency(Number(client.total_portfolio_value) || 0)}</span>
                        </div>
                      </div>
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-colors ${isSelected ? 'border-brand-200/50 bg-brand-300 text-black shadow-[0_0_18px_rgba(251,191,36,0.45)]' : 'border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20 text-muted-foreground group-hover:text-muted-foreground dark:text-foreground'}`}>
                        {isSelected ? selectedIds.indexOf(client.id) + 1 : '+'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Comparison Results */}
      {selectedClients.length < 2 ? (
        <Card className="relative overflow-hidden rounded-3xl border-brand-300/15 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.16),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(45,212,191,0.08),transparent_30%),linear-gradient(145deg,hsl(var(--card)),hsl(var(--muted)/0.22))] shadow-2xl shadow-[0_16px_44px_rgba(15,23,42,0.10)] dark:shadow-black/25">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
          <CardContent className="px-6 py-12 text-center sm:py-16">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-brand-300/25 bg-brand-300/10 text-brand-700 dark:text-brand-100 shadow-2xl shadow-brand-950/30">
              <Scale className="h-9 w-9" />
            </div>
            <div className="mx-auto max-w-xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/60 dark:border-white/10 bg-background/70 dark:bg-white/[0.04] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">
                <Sparkles className="h-3.5 w-3.5" />
                Decision support
              </div>
              <p className="text-2xl font-bold tracking-tight text-foreground dark:text-white">Build a comparison cohort</p>
              <p className="text-sm leading-6 text-muted-foreground dark:text-muted-foreground">Select at least 2 clients to unlock the side-by-side portfolio view. The output will populate here using the exact selected client data and existing comparison metrics.</p>
            </div>
            <div className="mx-auto mt-7 grid max-w-2xl gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-border/60 dark:border-white/10 bg-background/65 dark:bg-white/[0.035] px-4 py-3 text-left">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/80 dark:text-muted-foreground">Minimum</p>
                <p className="mt-1 text-sm font-semibold text-foreground/90 dark:text-foreground">2 clients</p>
              </div>
              <div className="rounded-2xl border border-border/60 dark:border-white/10 bg-background/65 dark:bg-white/[0.035] px-4 py-3 text-left">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/80 dark:text-muted-foreground">Maximum</p>
                <p className="mt-1 text-sm font-semibold text-foreground/90 dark:text-foreground">4 clients</p>
              </div>
              <div className="rounded-2xl border border-brand-300/20 bg-brand-300/10 px-4 py-3 text-left">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-100/60">Current</p>
                <p className="mt-1 text-sm font-semibold text-brand-950 dark:text-brand-50">{selectedClients.length}/2 ready</p>
              </div>
            </div>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20 px-4 py-2 text-xs font-semibold text-muted-foreground dark:text-foreground">
              <UserCheck className="h-3.5 w-3.5 text-brand-700 dark:text-brand-200" />
              {selectedClients.length === 1 ? '1 selected — pick one more' : 'Choose from the list above'}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="relative space-y-5 overflow-hidden rounded-3xl border border-border/60 dark:border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.1),transparent_28%),linear-gradient(145deg,rgba(24,24,27,0.72),rgba(3,7,18,0.58))] p-3 shadow-2xl shadow-[0_14px_38px_rgba(15,23,42,0.08)] dark:shadow-black/20 sm:p-5">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/45 to-transparent" />
          <div className="relative flex flex-col gap-3 rounded-3xl border border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-success dark:text-success">
                <Scale className="h-3.5 w-3.5" />
                Comparison active
              </div>
              <h3 className="mt-3 text-xl font-bold tracking-tight text-foreground dark:text-white">Client benchmarking output</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground dark:text-muted-foreground">Side-by-side metrics for {selectedClients.length} selected clients using the existing comparison calculations.</p>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-brand-300/20 bg-brand-300/10 px-3 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-100">
              <UserCheck className="h-3.5 w-3.5" />
              {selectedClients.length} clients selected
            </div>
          </div>

          {/* Client Headers */}
          <div className="grid gap-4 overflow-x-auto pb-1" style={{ gridTemplateColumns: `repeat(${selectedClients.length}, minmax(210px, 1fr))` }}>
            {selectedClients.map((client, index) => (
              <Card key={client.id} className="min-w-[210px] rounded-3xl border-brand-300/25 bg-[linear-gradient(145deg,rgba(245,158,11,0.14),rgba(255,255,255,0.035))] shadow-lg shadow-brand-950/15">
                <CardContent className="p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-brand-200/40 bg-brand-300 text-xs font-bold text-black shadow-[0_0_18px_rgba(251,191,36,0.35)]">{index + 1}</span>
                    {client.is_favorite && <Star className="h-4 w-4 shrink-0 fill-brand-400 text-brand-400" />}
                  </div>
                  <h3 className="truncate text-base font-bold text-brand-950 dark:text-brand-50">
                    {smartCapitalize(client.primary_first_name)} {smartCapitalize(client.primary_surname)}
                  </h3>
                  <p className="mt-1 truncate text-xs text-brand-700 dark:text-brand-100/55">{client.primary_email || 'No email on file'}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-brand-700 dark:text-brand-100/70">
                    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20 px-2 py-1">
                      <Building2 className="h-3 w-3" />
                      {client.client_properties?.length || 0} Properties
                    </span>
                    <span className="rounded-full border border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20 px-2 py-1">{formatCurrency(Number(client.total_portfolio_value) || 0)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Key Metrics Comparison */}
          <Card className="rounded-3xl border-border/60 dark:border-white/10 bg-[linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--muted)/0.22)_100%)] dark:bg-[linear-gradient(145deg,rgba(24,24,27,0.94),rgba(3,7,18,0.88))] shadow-xl shadow-[0_14px_38px_rgba(15,23,42,0.08)] dark:shadow-black/20">
            <CardHeader className="border-b border-border/60 dark:border-white/10 pb-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-base font-semibold text-foreground dark:text-white">Key Metrics</CardTitle>
                <p className="text-xs font-medium text-muted-foreground/80 dark:text-muted-foreground">Best values are highlighted without changing comparison math</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 p-4 sm:p-5">
              {metrics.map((metric) => {
                const highest = getHighestValue(metric.key);
                
                return (
                  <div key={metric.key} className="rounded-2xl border border-border/60 dark:border-white/10 bg-background/55 dark:bg-white/[0.025] p-3 sm:p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground dark:text-foreground">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20 text-brand-700 dark:text-brand-100">
                        <metric.icon className="h-4 w-4" />
                      </span>
                      {metric.label}
                    </div>
                    <div 
                      className="grid gap-3 overflow-x-auto pb-1" 
                      style={{ gridTemplateColumns: `repeat(${selectedClients.length}, minmax(170px, 1fr))` }}
                    >
                      {selectedClients.map((client) => {
                        const value = Number(client[metric.key]) || 0;
                        const isHighest = value === highest && highest !== 0;
                        const allValues = selectedClients.map(c => Number(c[metric.key]) || 0);
                        const isBest = metric.higherIsBetter 
                          ? isHighest 
                          : (value === Math.min(...allValues));
                        
                        return (
                          <div 
                            key={client.id} 
                            className={`min-w-[170px] rounded-2xl border p-3 text-left ${isBest ? 'border-success/30 bg-success/10 shadow-lg shadow-success/10' : 'border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20'}`}
                          >
                            <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground/80 dark:text-muted-foreground">
                              {smartCapitalize(client.primary_first_name)}
                            </p>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <p className={`text-lg font-bold tabular-nums ${metric.key === 'net_monthly_cash_flow' ? (value >= 0 ? 'text-success dark:text-success' : 'text-destructive dark:text-destructive') : 'text-foreground dark:text-foreground'}`}>
                                {metric.format(value)}
                              </p>
                              {isBest && (
                                <Badge variant="secondary" className="shrink-0 rounded-full border border-success/20 bg-success/10 text-xs text-success dark:text-success">
                                  Best
                                </Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Equity Comparison */}
              <div className="rounded-2xl border border-border/60 dark:border-white/10 bg-background/55 dark:bg-white/[0.025] p-3 sm:p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground dark:text-foreground">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20 text-brand-700 dark:text-brand-100">
                    <DollarSign className="h-4 w-4" />
                  </span>
                  Net Equity
                </div>
                <div 
                  className="grid gap-3 overflow-x-auto pb-1" 
                  style={{ gridTemplateColumns: `repeat(${selectedClients.length}, minmax(170px, 1fr))` }}
                >
                  {selectedClients.map((client) => {
                    const equity = (Number(client.total_portfolio_value) || 0) - (Number(client.total_debt) || 0);
                    const allEquity = selectedClients.map(c => (Number(c.total_portfolio_value) || 0) - (Number(c.total_debt) || 0));
                    const isBest = equity === Math.max(...allEquity) && equity !== 0;
                    
                    return (
                      <div 
                        key={client.id} 
                        className={`min-w-[170px] rounded-2xl border p-3 text-left ${isBest ? 'border-success/30 bg-success/10 shadow-lg shadow-success/10' : 'border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20'}`}
                      >
                        <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground/80 dark:text-muted-foreground">
                          {smartCapitalize(client.primary_first_name)}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className={`text-lg font-bold tabular-nums ${equity >= 0 ? 'text-success' : 'text-destructive'}`}>
                            {formatCurrency(equity)}
                          </p>
                          {isBest && (
                            <Badge variant="secondary" className="shrink-0 rounded-full bg-success/10 text-xs text-success">
                              Best
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* LTV Comparison */}
              <div className="rounded-2xl border border-border/60 dark:border-white/10 bg-background/55 dark:bg-white/[0.025] p-3 sm:p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground dark:text-foreground">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20 text-brand-700 dark:text-brand-100">
                    <Percent className="h-4 w-4" />
                  </span>
                  LTV Ratio
                </div>
                <div 
                  className="grid gap-3 overflow-x-auto pb-1" 
                  style={{ gridTemplateColumns: `repeat(${selectedClients.length}, minmax(170px, 1fr))` }}
                >
                  {selectedClients.map((client) => {
                    const ltv = Number(client.total_portfolio_value) > 0 
                      ? (Number(client.total_debt) / Number(client.total_portfolio_value)) * 100 
                      : 0;
                    const allLTVs = selectedClients.map(c => 
                      Number(c.total_portfolio_value) > 0 
                        ? (Number(c.total_debt) / Number(c.total_portfolio_value)) * 100 
                        : 0
                    );
                    const lowestLTV = Math.min(...allLTVs);
                    const isBest = ltv === lowestLTV;
                    
                    return (
                      <div 
                        key={client.id} 
                        className={`min-w-[170px] rounded-2xl border p-3 text-left ${isBest ? 'border-success/30 bg-success/10 shadow-lg shadow-success/10' : 'border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20'}`}
                      >
                        <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground/80 dark:text-muted-foreground">
                          {smartCapitalize(client.primary_first_name)}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className={`text-lg font-bold tabular-nums ${ltv > 80 ? 'text-destructive' : ltv > 60 ? 'text-brand-600' : 'text-success'}`}>
                            {ltv.toFixed(1)}%
                          </p>
                          {isBest && (
                            <Badge variant="secondary" className="shrink-0 rounded-full bg-success/10 text-xs text-success">
                              Best
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Scores Comparison */}
          {scores.length > 0 && (
            <Card className="rounded-3xl border-border/60 dark:border-white/10 bg-[linear-gradient(145deg,hsl(var(--card))_0%,hsl(var(--muted)/0.22)_100%)] dark:bg-[linear-gradient(145deg,rgba(24,24,27,0.94),rgba(3,7,18,0.88))] shadow-xl shadow-[0_14px_38px_rgba(15,23,42,0.08)] dark:shadow-black/20">
              <CardHeader className="border-b border-border/60 dark:border-white/10 pb-4">
                <CardTitle className="text-base font-semibold text-foreground dark:text-white">Client Scores</CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-5">
                <div 
                  className="grid gap-4 overflow-x-auto pb-1" 
                  style={{ gridTemplateColumns: `repeat(${selectedClients.length}, minmax(220px, 1fr))` }}
                >
                  {selectedClients.map((client) => {
                    const score = getScoreForClient(client.id);
                    
                    if (!score) {
                      return (
                        <div key={client.id} className="min-w-[220px] rounded-2xl border border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20 p-4 text-center">
                          <p className="text-sm text-muted-foreground">No score calculated</p>
                        </div>
                      );
                    }

                    const allOverallScores = scores.map((s: any) => s.overall_score);
                    const highestScore = Math.max(...allOverallScores);
                    const isBest = score.overall_score === highestScore;
                    
                    return (
                      <div 
                        key={client.id} 
                        className={`min-w-[220px] rounded-2xl border p-4 ${isBest ? 'border-success/30 bg-success/10 shadow-lg shadow-success/10' : 'border-border/60 dark:border-white/10 bg-muted/45 dark:bg-black/20'}`}
                      >
                        <div className="mb-4 rounded-2xl border border-border/60 dark:border-white/10 bg-background/65 dark:bg-white/[0.035] p-3 text-center">
                          <p className="text-3xl font-bold tabular-nums text-foreground dark:text-white">{score.overall_score}</p>
                          <p className="text-xs text-muted-foreground">Overall Score</p>
                          {isBest && (
                            <Badge variant="secondary" className="mt-1 text-xs bg-success/10 text-success">
                              Highest
                            </Badge>
                          )}
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between gap-3 rounded-xl bg-background/55 dark:bg-white/[0.025] px-3 py-2">
                            <span className="text-muted-foreground">Portfolio Health</span>
                            <span className="font-medium">{score.portfolio_health}%</span>
                          </div>
                          <div className="flex justify-between gap-3 rounded-xl bg-background/55 dark:bg-white/[0.025] px-3 py-2">
                            <span className="text-muted-foreground">Cash Flow</span>
                            <span className="font-medium">{score.cash_flow_score}%</span>
                          </div>
                          <div className="flex justify-between gap-3 rounded-xl bg-background/55 dark:bg-white/[0.025] px-3 py-2">
                            <span className="text-muted-foreground">Growth Potential</span>
                            <span className="font-medium">{score.growth_potential}%</span>
                          </div>
                          <div className="flex justify-between gap-3 rounded-xl border-t border-border/60 dark:border-white/10 bg-background/55 dark:bg-white/[0.025] px-3 py-2 pt-2">
                            <span className="text-muted-foreground">Risk Level</span>
                            <Badge 
                              variant="outline"
                              className={
                                score.risk_level === 'low' ? 'text-success' :
                                score.risk_level === 'medium' ? 'text-brand-600' :
                                score.risk_level === 'high' ? 'text-warning' :
                                'text-destructive'
                              }
                            >
                              {score.risk_level}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
