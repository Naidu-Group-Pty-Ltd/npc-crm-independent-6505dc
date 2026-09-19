/**
 * Finance Portal — Cross-client Unified Inbox.
 * Aggregates assigned-client communication/activity without duplicating source records.
 */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import {
  MessageSquare, Inbox, ChevronRight, Search, Phone, Mail, Globe, StickyNote,
  Activity, AlertCircle, RefreshCcw, Filter, UserRound, Clock, Layers,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useMemo, useState } from 'react';
import { smartCapitalize } from '@/lib/nameUtils';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const FN = 'finance-portal-client-comms';

type SourceType = 'all' | 'finance_portal' | 'client_portal' | 'command_centre' | 'ghl' | 'outbound' | 'note' | 'activity';
type StatusFilter = 'all' | 'unread' | 'recent';

interface InboxRow {
  id?: string;
  client_id: string;
  client_name?: string;
  name?: string;
  secondary_name?: string | null;
  email?: string;
  secondary_email?: string;
  phone?: string;
  secondary_phone?: string;
  assigned_finance_partner?: string | null;
  assigned_finance_partner_email?: string | null;
  sources?: string[];
  unread_count?: number;
  unread_portal?: number;
  unread_finance?: number;
  last_message_at?: string | null;
  last_message_preview?: string | null;
  last_channel?: string | null;
  last_source?: string | null;
  last_source_label?: string | null;
  item_count?: number;
  open_path?: string;
}

interface InboxMeta {
  assigned_clients?: number;
  visible_clients?: number;
  returned_conversations?: number;
  source_counts?: Record<string, number>;
  source_errors?: Array<{ source: string; message: string }>;
  empty_reason?: string | null;
}

const SOURCE_OPTIONS: Array<{ value: SourceType; label: string }> = [
  { value: 'all', label: 'All sources' },
  { value: 'finance_portal', label: 'Finance Portal' },
  { value: 'command_centre', label: 'Command Centre' },
  { value: 'client_portal', label: 'Client Portal' },
  { value: 'ghl', label: 'SMS / WhatsApp / Email' },
  { value: 'outbound', label: 'Outbound' },
  { value: 'note', label: 'Notes' },
  { value: 'activity', label: 'Activity' },
];

const CHANNEL_ICON: Record<string, any> = {
  sms: Phone,
  whatsapp: MessageSquare,
  email: Mail,
  portal: Globe,
  note: StickyNote,
  activity: Activity,
};

const SOURCE_TONE: Record<string, string> = {
  finance_portal: 'bg-primary/10 text-primary border-primary/20',
  command_centre: 'bg-info/10 text-info dark:text-info border-info/20',
  client_portal: 'bg-info/10 text-info dark:text-info border-info/20',
  ghl: 'bg-success/10 text-success dark:text-success border-success/20',
  outbound: 'bg-accent/10 text-accent dark:text-accent border-accent/20',
  note: 'bg-brand-500/10 text-brand-700 dark:text-brand-300 border-brand-500/20',
  activity: 'bg-muted text-muted-foreground border-border',
};

function initials(name: string) {
  return name.split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

function normalizeSource(row: InboxRow) {
  if (row.last_source === 'outbound') return row.last_channel === 'portal' ? 'finance_portal' : 'outbound';
  return row.last_source || row.last_channel || 'activity';
}

export default function FinancePortalClientInbox() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['client-inbox-list'],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(FN, { action: 'inbox_list' });
      if (error) throw new Error(error.message || data?.error || 'Failed to load Client Inbox');
      return {
        rows: (data?.clients || []) as InboxRow[],
        meta: (data?.meta || {}) as InboxMeta,
      };
    },
    refetchInterval: 60_000,
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const recentCutoff = Date.now() - 1000 * 60 * 60 * 24 * 30;

    return (data?.rows || []).filter((row) => {
      const haystack = [
        row.client_name,
        row.name,
        row.secondary_name,
        row.email,
        row.secondary_email,
        row.phone,
        row.secondary_phone,
        row.assigned_finance_partner,
        row.last_message_preview,
      ].filter(Boolean).join(' ').toLowerCase();

      const matchesSearch = !s || haystack.includes(s);
      const matchesSource = sourceFilter === 'all' || (row.sources || []).includes(sourceFilter) || normalizeSource(row) === sourceFilter;
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'unread' && Number(row.unread_count || 0) > 0)
        || (statusFilter === 'recent' && !!row.last_message_at && new Date(row.last_message_at).getTime() >= recentCutoff);

      return matchesSearch && matchesSource && matchesStatus;
    });
  }, [data?.rows, search, sourceFilter, statusFilter]);

  const meta = data?.meta || {};
  const sourceCounts = meta.source_counts || {};
  const totalUnread = (data?.rows || []).reduce((sum, row) => sum + Number(row.unread_count || 0), 0);
  const hasActiveFilters = !!search.trim() || sourceFilter !== 'all' || statusFilter !== 'all';

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Inbox className="h-6 w-6 text-primary" /> Client Inbox
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            All available Finance Portal, Client Portal, SMS, WhatsApp, email, notes and activity across assigned clients.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalUnread > 0 && <Badge className="bg-primary text-primary-foreground">{totalUnread} unread</Badge>}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCcw className={cn('h-4 w-4 mr-2', isFetching && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Conversations</div><div className="text-2xl font-semibold">{meta.returned_conversations ?? data?.rows?.length ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Assigned clients</div><div className="text-2xl font-semibold">{meta.visible_clients ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Portal messages</div><div className="text-2xl font-semibold">{Number(sourceCounts.client_portal || 0) + Number(sourceCounts.finance_portal || 0) + Number(sourceCounts.command_centre || 0)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Notes/activity</div><div className="text-2xl font-semibold">{Number(sourceCounts.notes || 0) + Number(sourceCounts.activity || 0)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3 space-y-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" /> Find communication
          </CardTitle>
          <div className="grid gap-2 md:grid-cols-[1fr_220px_180px]">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search by client name, email, phone, partner, or message preview…"
              hideIcon
            />
            <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value as SourceType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="unread">Unread/open</SelectItem>
                <SelectItem value="recent">Recent 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3" aria-label="Loading client inbox">
              {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3">
              <AlertCircle className="h-7 w-7 mx-auto text-destructive" />
              <div>
                <p className="font-medium text-destructive">Unable to load Client Inbox</p>
                <p className="text-sm text-muted-foreground mt-1">{(error as Error).message}</p>
              </div>
              <Button variant="outline" onClick={() => refetch()}>Try again</Button>
            </div>
          ) : meta.source_errors?.length ? (
            <div className="mb-3 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3 text-sm text-brand-800 dark:text-brand-200">
              Some sources could not be queried: {meta.source_errors.map(e => e.source).join(', ')}. Showing available inbox data.
            </div>
          ) : null}

          {!isLoading && !error && rows.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-12 border border-dashed rounded-xl">
              <Inbox className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="font-medium text-foreground">
                {hasActiveFilters ? 'No conversations match your filters.' : 'No client conversations yet.'}
              </p>
              <p className="mt-1 max-w-xl mx-auto">
                {hasActiveFilters
                  ? 'Clear search or filters to see all available client communication.'
                  : meta.empty_reason || 'When assigned clients have portal messages, Finance Portal threads, SMS/WhatsApp/email records, notes, or activity, they will appear here.'}
              </p>
            </div>
          ) : null}

          {!isLoading && !error && rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((row) => {
                const displayName = smartCapitalize(row.client_name || row.name || 'Unknown client');
                const Icon = CHANNEL_ICON[String(row.last_channel || '').toLowerCase()] || MessageSquare;
                const hasUnread = Number(row.unread_count || 0) > 0;
                const source = normalizeSource(row);
                const sourceLabel = row.last_source_label || SOURCE_OPTIONS.find(o => o.value === source)?.label || 'Client activity';

                return (
                  <button
                    key={row.client_id}
                    onClick={() => navigate(row.open_path || `/finance/clients/${row.client_id}?tab=messages`)}
                    className={cn(
                      'w-full flex items-start gap-3 p-4 border rounded-xl text-left transition-all',
                      hasUnread ? 'border-l-[3px] border-l-primary bg-primary/[0.02]' : 'border-border/60',
                      'hover:bg-card/80 hover:border-primary/30 hover:shadow-sm',
                    )}
                  >
                    <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold shrink-0">
                      {initials(displayName)}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span className="font-medium truncate">{displayName}</span>
                        {row.secondary_name && <span className="text-xs text-muted-foreground">& {smartCapitalize(row.secondary_name)}</span>}
                        {hasUnread && <Badge className="bg-primary text-primary-foreground h-5">{row.unread_count} unread</Badge>}
                        <Badge variant="outline" className={cn('h-5 gap-1', SOURCE_TONE[source] || SOURCE_TONE.activity)}>
                          <Icon className="h-3 w-3" /> {sourceLabel}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {row.last_message_preview || 'Client activity recorded'}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {row.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{row.email}</span>}
                        {row.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{row.phone}</span>}
                        {row.assigned_finance_partner && <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{row.assigned_finance_partner}</span>}
                        <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" />{row.item_count || 1} linked item{Number(row.item_count || 1) === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1 whitespace-nowrap">
                        <Clock className="h-3 w-3" />
                        {row.last_message_at ? formatDistanceToNow(new Date(row.last_message_at), { addSuffix: true }) : '—'}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <Filter className="h-3.5 w-3.5" />
        The inbox is aggregated from existing source records and does not create duplicate conversations.
      </div>
    </div>
  );
}
