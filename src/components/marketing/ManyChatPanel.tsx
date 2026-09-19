import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchInput } from '@/components/ui/search-input';
import {
  Loader2, Users, MessageSquare, Tag, Workflow, RefreshCw,
  Bot, MousePointerClick, Search, User, Clock, Globe,
  Shield, Database, ChevronDown, ChevronUp, ExternalLink, Hash,
  Zap, Settings2, Info, Activity, BarChart3, Filter, CheckCircle2, XCircle
} from 'lucide-react';
import { toast } from 'sonner';

interface ManyChatOverview {
  pageInfo: any;
  tags: any[];
  flows: any[];
  widgets: any[];
  customFields: any[];
  botFields: any[];
}

function toArray<T = any>(value: unknown, nestedKeys: string[] = []): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    for (const key of nestedKeys) {
      const nestedValue = (value as Record<string, unknown>)[key];
      if (Array.isArray(nestedValue)) return nestedValue as T[];
    }
  }
  return [];
}

function toObject<T extends Record<string, any> = Record<string, any>>(value: unknown): T | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as T;
}

export function ManyChatPanel() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'name' | 'custom_field'>('name');
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [selectedSubscriber, setSelectedSubscriber] = useState<any | null>(null);
  const [loadingSubscriber, setLoadingSubscriber] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    widgets: true,
    tags: false,
    fields: false,
    botFields: false,
    flows: false,
  });

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['manychat-overview'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manychat-proxy', {
        action: 'get_overview',
      });
      if (error) throw new Error(error.message);
      return data as ManyChatOverview;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const pageInfo = toObject(data?.pageInfo);
  const tags = toArray(data?.tags, ['tags']);
  const flows = toArray(data?.flows, ['flows']);
  const widgets = toArray(data?.widgets, ['widgets', 'growth_tools']);
  const customFields = toArray(data?.customFields, ['customFields', 'custom_fields']);
  const botFields = toArray(data?.botFields, ['botFields', 'bot_fields']);

  // Flow status breakdown
  const flowStats = useMemo(() => {
    const active = flows.filter(f => f.status === 'active').length;
    const inactive = flows.filter(f => f.status !== 'active').length;
    return { active, inactive, total: flows.length };
  }, [flows]);

  // Widget type breakdown
  const widgetTypeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of widgets) {
      const type = (w.type || 'unknown').replace(/_/g, ' ');
      map.set(type, (map.get(type) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [widgets]);

  // Custom field type breakdown
  const fieldTypeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of customFields) {
      const type = f.type || 'text';
      map.set(type, (map.get(type) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [customFields]);

  const handleRefresh = () => {
    refetch();
    toast.success('Refreshing ManyChat data...');
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleSearch = useCallback(async () => {
    if (searchMode === 'name') {
      if (!searchQuery.trim() || searchQuery.trim().length < 2) {
        toast.error('Enter at least 2 characters to search');
        return;
      }
      setIsSearching(true);
      setSelectedSubscriber(null);
      try {
        const { data, error } = await invokeSecureFunction('manychat-proxy', {
          action: 'find_subscriber',
          name: searchQuery.trim(),
        });
        if (error) throw new Error(error.message);
        const normalizedSubscribers = toArray(data?.subscribers, ['subscribers']);
        setSearchResults(normalizedSubscribers);
        if (!normalizedSubscribers.length) toast.info('No subscribers found');
      } catch (err: any) {
        toast.error(err.message || 'Search failed');
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    } else {
      if (!selectedFieldId || !searchQuery.trim()) {
        toast.error('Select a custom field and enter a value');
        return;
      }
      setIsSearching(true);
      setSelectedSubscriber(null);
      try {
        const { data, error } = await invokeSecureFunction('manychat-proxy', {
          action: 'find_by_custom_field',
          field_id: selectedFieldId,
          field_value: searchQuery.trim(),
        });
        if (error) throw new Error(error.message);
        const normalizedSubscribers = toArray(data?.subscribers, ['subscribers']);
        setSearchResults(normalizedSubscribers);
        if (!normalizedSubscribers.length) toast.info('No subscribers found');
      } catch (err: any) {
        toast.error(err.message || 'Search failed');
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }
  }, [searchQuery, searchMode, selectedFieldId]);

  const handleViewSubscriber = useCallback(async (subscriberId: string) => {
    setLoadingSubscriber(true);
    try {
      const { data, error } = await invokeSecureFunction('manychat-proxy', {
        action: 'get_subscriber',
        subscriberId,
      });
      if (error) throw new Error(error.message);
      setSelectedSubscriber(toObject(data?.subscriber));
    } catch (err: any) {
      toast.error(err.message || 'Failed to load subscriber');
    } finally {
      setLoadingSubscriber(false);
    }
  }, []);

  if (error) {
    const errMsg = (error as Error).message;
    const isNotConfigured = errMsg.includes('MANYCHAT_API_KEY');

    return (
      <Card className="overflow-hidden border-dashed border-border/70 bg-card/95 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
        <CardContent className="py-12 text-center">
          <Bot className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-1">
            {isNotConfigured ? 'ManyChat Not Connected' : 'Connection Error'}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
            {isNotConfigured
              ? 'Add your ManyChat API key in the Integrations page to enable this dashboard.'
              : errMsg}
          </p>
          {!isNotConfigured && (
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Retry
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-2xl border border-primary/20 bg-primary/10 flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold tracking-tight text-foreground">ManyChat</h2>
            <p className="text-muted-foreground text-sm">Chat automation & subscriber management</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching} className="shrink-0 rounded-xl border-primary/20 hover:bg-primary/10 hover:text-primary">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Page Info Card */}
      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
        <div className="bg-[linear-gradient(135deg,hsl(var(--primary)/0.10),hsl(var(--background)/0.35)_58%,hsl(var(--card)/0.92))] p-5">
          {isLoading ? (
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-muted animate-pulse" />
              <div className="space-y-2 flex-1">
                <div className="h-5 w-48 bg-muted animate-pulse rounded" />
                <div className="h-4 w-32 bg-muted animate-pulse rounded" />
              </div>
            </div>
          ) : pageInfo ? (
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                {pageInfo.avatar_link ? (
                  <img src={pageInfo.avatar_link} alt={pageInfo.name} className="h-14 w-14 rounded-full" />
                ) : (
                  <Bot className="h-7 w-7 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-foreground text-lg truncate" title={pageInfo.name || 'ManyChat Account'}>{pageInfo.name || 'ManyChat Account'}</h3>
                  <Badge variant={pageInfo.is_pro ? 'default' : 'secondary'} className="shrink-0 rounded-full">
                    {pageInfo.is_pro ? '⭐ Pro' : 'Free'}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 mt-1.5 text-sm text-muted-foreground flex-wrap">
                  {pageInfo.timezone && (
                    <span className="flex min-w-0 items-center gap-1">
                      <Globe className="h-3.5 w-3.5" />
                      <span className="truncate">{pageInfo.timezone}</span>
                    </span>
                  )}
                  {pageInfo.category && (
                    <span className="flex min-w-0 items-center gap-1">
                      <Tag className="h-3.5 w-3.5" />
                      <span className="truncate">{pageInfo.category}</span>
                    </span>
                  )}
                  {pageInfo.subscribers !== undefined && (
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {Number(pageInfo.subscribers).toLocaleString('en-AU')} subscribers
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 divide-y divide-border border-t sm:grid-cols-5 sm:divide-x sm:divide-y-0">
          <QuickStat
            icon={<MousePointerClick className="h-4 w-4" />}
            label="Growth Tools"
            value={isLoading ? '—' : String(widgets.length)}
            loading={isLoading}
          />
          <QuickStat
            icon={<Tag className="h-4 w-4" />}
            label="Tags"
            value={isLoading ? '—' : String(tags.length)}
            loading={isLoading}
          />
          <QuickStat
            icon={<Database className="h-4 w-4" />}
            label="Custom Fields"
            value={isLoading ? '—' : String(customFields.length)}
            loading={isLoading}
          />
          <QuickStat
            icon={<Workflow className="h-4 w-4" />}
            label="Active Flows"
            value={isLoading ? '—' : String(flowStats.active)}
            loading={isLoading}
            accent={flowStats.active > 0}
          />
          <QuickStat
            icon={<Bot className="h-4 w-4" />}
            label="Bot Fields"
            value={isLoading ? '—' : String(botFields.length)}
            loading={isLoading}
          />
        </div>
      </Card>

      {/* Automation Health Overview */}
      {!isLoading && (flows.length > 0 || widgets.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Flow Status Card */}
          {flows.length > 0 && (
            <Card className="overflow-hidden border-border/70 bg-card/95 shadow-lg shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  Flow Health
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden flex gap-0.5">
                    {flowStats.active > 0 && (
                      <div
                        className="h-full bg-success rounded-l-full transition-all"
                        style={{ width: `${(flowStats.active / flowStats.total) * 100}%` }}
                      />
                    )}
                    {flowStats.inactive > 0 && (
                      <div
                        className="h-full bg-muted-foreground/30 rounded-r-full transition-all"
                        style={{ width: `${(flowStats.inactive / flowStats.total) * 100}%` }}
                      />
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    <span className="text-muted-foreground">Active</span>
                    <span className="font-semibold text-foreground">{flowStats.active}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <XCircle className="h-3.5 w-3.5 text-muted-foreground/60" />
                    <span className="text-muted-foreground">Inactive</span>
                    <span className="font-semibold text-foreground">{flowStats.inactive}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-semibold text-foreground">{flowStats.total}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Widget Type Breakdown */}
          {widgets.length > 0 && (
            <Card className="overflow-hidden border-border/70 bg-card/95 shadow-lg shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Growth Tool Types
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="space-y-2">
                  {widgetTypeMap.slice(0, 5).map(([type, count]) => (
                    <div key={type} className="flex min-w-0 items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-muted-foreground capitalize truncate">{type}</span>
                          <span className="text-xs font-semibold text-foreground">{count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary/60 rounded-full transition-all"
                            style={{ width: `${(count / widgets.length) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Subscriber Search */}
      <Card className="overflow-hidden border-border/70 bg-card/95 shadow-xl shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/25">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="h-4 w-4" />
                Subscriber Search
              </CardTitle>
              <CardDescription>Search subscribers by name or custom field value</CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant={searchMode === 'name' ? 'default' : 'outline'}
                size="sm"
                className="h-7 rounded-xl text-xs focus-visible:ring-primary/45"
                onClick={() => { setSearchMode('name'); setSearchResults(null); }}
                aria-pressed={searchMode === 'name'}
              >
                <User className="h-3 w-3 mr-1" />
                Name
              </Button>
              <Button
                variant={searchMode === 'custom_field' ? 'default' : 'outline'}
                size="sm"
                className="h-7 rounded-xl text-xs focus-visible:ring-primary/45"
                onClick={() => { setSearchMode('custom_field'); setSearchResults(null); }}
                aria-pressed={searchMode === 'custom_field'}
              >
                <Filter className="h-3 w-3 mr-1" />
                Field
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {searchMode === 'custom_field' && (
            <Select value={selectedFieldId} onValueChange={setSelectedFieldId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select a custom field..." />
              </SelectTrigger>
              <SelectContent>
                {customFields.map((field: any) => (
                  <SelectItem key={field.id} value={String(field.id)}>
                    {field.name} ({field.type || 'text'})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <SearchInput
              value={searchQuery}
              onValueChange={setSearchQuery}
              placeholder={searchMode === 'name' ? 'Search by name...' : 'Enter field value...'}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              aria-label={searchMode === 'name' ? 'Search ManyChat subscribers by name' : 'Search ManyChat subscribers by custom field value'}
              hideIcon
              className="flex-1 min-w-0"
            />
            <Button onClick={handleSearch} disabled={isSearching} size="sm" className="shrink-0 rounded-xl focus-visible:ring-primary/45" aria-label="Search ManyChat subscribers">
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-1.5 hidden sm:inline">Search</span>
            </Button>
          </div>

          {searchResults !== null && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
              </p>
              {searchResults.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-background/45 py-6 text-center text-sm text-muted-foreground">
                  No subscribers match "{searchQuery}"
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                  {searchResults.map((sub: any) => (
                    <div
                      key={sub.id}
                      className="flex items-center justify-between p-3 rounded-2xl border border-border/60 bg-background/45 hover:border-primary/25 hover:bg-primary/[0.04] transition-colors cursor-pointer"
                      onClick={() => handleViewSubscriber(sub.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          {sub.profile_pic ? (
                            <img src={sub.profile_pic} alt={sub.name} className="h-9 w-9 rounded-full" />
                          ) : (
                            <User className="h-4 w-4 text-primary" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {sub.first_name} {sub.last_name}
                          </p>
                          {sub.gender && (
                            <p className="text-xs text-muted-foreground">{sub.gender}</p>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0 ml-2">View</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {loadingSubscriber && (
            <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/45 py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading subscriber details...</span>
            </div>
          )}
          {selectedSubscriber && !loadingSubscriber && (
            <SubscriberDetail subscriber={selectedSubscriber} onClose={() => setSelectedSubscriber(null)} />
          )}
        </CardContent>
      </Card>

      {/* Collapsible Sections */}
      <CollapsibleSection
        title="Growth Tools"
        description="Subscriber acquisition triggers & widgets"
        icon={<MousePointerClick className="h-4 w-4" />}
        count={widgets.length}
        expanded={expandedSections.widgets}
        onToggle={() => toggleSection('widgets')}
        loading={isLoading}
      >
        {widgets.length === 0 ? (
          <EmptyState message="No growth tools configured yet" />
        ) : (
          <div className="space-y-2">
            {widgets.map((widget: any, i: number) => (
              <div key={widget.id || i} className="flex items-center justify-between p-3 rounded-2xl border border-border/60 bg-background/45 hover:border-primary/25 hover:bg-primary/[0.04] transition-colors">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <Zap className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate" title={widget.name || `Widget ${i + 1}`}>{widget.name || `Widget ${i + 1}`}</p>
                    <p className="text-xs text-muted-foreground capitalize">{(widget.type || 'unknown').replace(/_/g, ' ')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <Badge variant="outline" className="max-w-[140px] truncate rounded-full text-xs" title={`ID: ${widget.id}`}>
                    ID: {widget.id}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Tags"
        description="Subscriber segmentation labels"
        icon={<Tag className="h-4 w-4" />}
        count={tags.length}
        expanded={expandedSections.tags}
        onToggle={() => toggleSection('tags')}
        loading={isLoading}
      >
        {tags.length === 0 ? (
          <EmptyState message="No tags created yet. Tags will appear here once you create them in ManyChat." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag: any, i: number) => (
              <Badge key={tag.id || i} variant="secondary" className="max-w-full rounded-full px-3 py-1.5 text-xs" title={tag.name || `Tag ${i + 1}`}>
                <Hash className="h-3 w-3 mr-1" />
                <span className="truncate">{tag.name || `Tag ${i + 1}`}</span>
              </Badge>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Custom Fields"
        description="Subscriber data fields for personalization"
        icon={<Database className="h-4 w-4" />}
        count={customFields.length}
        expanded={expandedSections.fields}
        onToggle={() => toggleSection('fields')}
        loading={isLoading}
      >
        {customFields.length === 0 ? (
          <EmptyState message="No custom fields defined yet." />
        ) : (
          <>
            {/* Field type summary */}
            <div className="flex flex-wrap gap-2 mb-3">
              {fieldTypeMap.map(([type, count]) => (
                <Badge key={type} variant="outline" className="text-[10px] capitalize">
                  {type}: {count}
                </Badge>
              ))}
            </div>
            <div className="space-y-1.5">
              {customFields.map((field: any, i: number) => (
                <div key={field.id || i} className="flex items-center justify-between p-2.5 rounded-2xl border border-border/60 bg-background/45">
                  <div className="flex items-center gap-2 min-w-0">
                    <Settings2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm text-foreground truncate" title={field.name}>{field.name}</span>
                  </div>
                  <div className="flex items-center gap-2 ml-2 shrink-0">
                    {field.type && (
                      <Badge variant="outline" className="rounded-full text-xs capitalize">{field.type}</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Bot Fields"
        description="Global bot-level variables"
        icon={<Bot className="h-4 w-4" />}
        count={botFields.length}
        expanded={expandedSections.botFields}
        onToggle={() => toggleSection('botFields')}
        loading={isLoading}
      >
        {botFields.length === 0 ? (
          <EmptyState message="No bot fields defined yet." />
        ) : (
          <div className="space-y-1.5">
            {botFields.map((field: any, i: number) => (
              <div key={field.id || i} className="flex items-center justify-between p-2.5 rounded-2xl border border-border/60 bg-background/45">
                <div className="flex items-center gap-2 min-w-0">
                  <Settings2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm text-foreground truncate" title={field.name}>{field.name}</span>
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  {field.type && (
                    <Badge variant="outline" className="rounded-full text-xs capitalize">{field.type}</Badge>
                  )}
                  {field.value !== undefined && field.value !== null && (
                    <span className="max-w-[180px] truncate text-xs text-muted-foreground font-mono" title={String(field.value)}>{String(field.value)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Flows"
        description="Automation sequences and conversation flows"
        icon={<Workflow className="h-4 w-4" />}
        count={flows.length}
        expanded={expandedSections.flows}
        onToggle={() => toggleSection('flows')}
        loading={isLoading}
      >
        {flows.length === 0 ? (
          <EmptyState message="No flows available via API. Instagram accounts may have limited flow visibility through the API." />
        ) : (
          <div className="space-y-2">
            {flows.map((flow: any, i: number) => (
              <div key={flow.ns_id || i} className="flex items-center justify-between p-3 rounded-2xl border border-border/60 bg-background/45 hover:border-primary/25 hover:bg-primary/[0.04]">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate" title={flow.name || `Flow ${i + 1}`}>{flow.name || `Flow ${i + 1}`}</p>
                  {flow.folder_name && (
                    <p className="text-xs text-muted-foreground">{flow.folder_name}</p>
                  )}
                </div>
                <Badge variant={flow.status === 'active' ? 'default' : 'secondary'} className="ml-2 shrink-0 rounded-full text-xs">
                  {flow.status || 'unknown'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <Card className="border-dashed border-border/70 bg-card/80">
        <CardContent className="py-3 px-4">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Data is fetched live from the ManyChat API. Some features (e.g., flow analytics, subscriber counts) may have limited availability depending on your account type and connected channel (Instagram vs. Messenger). 
              Manage your automations directly in{' '}
              <a href="https://manychat.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                ManyChat <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QuickStat({ icon, label, value, loading, accent }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading: boolean;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3 text-center">
      <div className="flex items-center justify-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      {loading ? (
        <div className="h-6 w-8 bg-muted animate-pulse rounded mx-auto" />
      ) : (
        <p className={`text-lg font-bold ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
      )}
    </div>
  );
}

function CollapsibleSection({ title, description, icon, count, expanded, onToggle, loading, children }: {
  title: string;
  description: string;
  icon: React.ReactNode;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden border-border/70 bg-card/95 shadow-lg shadow-sm dark:shadow-black/5 dark:border-white/10 dark:shadow-black/20">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="text-muted-foreground shrink-0">{icon}</div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="rounded-full text-xs">{loading ? '...' : count}</Badge>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>
      {expanded && (
        <CardContent className="pt-0 pb-4">
          <Separator className="mb-4" />
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            children
          )}
        </CardContent>
      )}
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-background/45 py-6 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function SubscriberDetail({ subscriber, onClose }: { subscriber: any; onClose: () => void }) {
  const subscriberTags = toArray(subscriber?.tags, ['tags']);
  const subscriberCustomFields = toArray(subscriber?.custom_fields, ['custom_fields', 'customFields']);
  const visibleCustomFields = subscriberCustomFields.filter((field: any) => field.value !== null && field.value !== '');

  return (
    <Card className="overflow-hidden border-primary/20 bg-primary/[0.02]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              {subscriber.profile_pic ? (
                <img src={subscriber.profile_pic} alt="Profile" className="h-10 w-10 rounded-full" />
              ) : (
                <User className="h-5 w-5 text-primary" />
              )}
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-base">
                {subscriber.first_name} {subscriber.last_name}
              </CardTitle>
              {subscriber.name && (
                <CardDescription>{subscriber.name}</CardDescription>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {subscriber.gender && <InfoRow label="Gender" value={subscriber.gender} />}
          {subscriber.language && <InfoRow label="Language" value={subscriber.language} />}
          {subscriber.timezone && <InfoRow label="Timezone" value={subscriber.timezone} />}
          {subscriber.subscribed && (
            <InfoRow label="Subscribed" value={new Date(subscriber.subscribed).toLocaleDateString('en-AU')} />
          )}
          {subscriber.last_interaction && (
            <InfoRow label="Last Interaction" value={new Date(subscriber.last_interaction).toLocaleDateString('en-AU')} />
          )}
          {subscriber.last_seen && (
            <InfoRow label="Last Seen" value={new Date(subscriber.last_seen).toLocaleDateString('en-AU')} />
          )}
          {subscriber.live_chat_url && (
            <div className="col-span-full">
              <a
                href={subscriber.live_chat_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary text-sm hover:underline inline-flex items-center gap-1"
              >
                Open in ManyChat <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>

        {subscriberTags.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {subscriberTags.map((tag: any) => (
                  <Badge key={tag.id} variant="secondary" className="max-w-full rounded-full text-xs" title={tag.name}>
                  <span className="truncate">{tag.name}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {visibleCustomFields.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Custom Fields</p>
            <div className="space-y-1.5">
              {visibleCustomFields.map((field: any) => (
                <div key={field.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-muted-foreground" title={field.name}>{field.name}</span>
                  <span className="max-w-[60%] truncate text-foreground font-medium" title={String(field.value)}>{String(field.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}
