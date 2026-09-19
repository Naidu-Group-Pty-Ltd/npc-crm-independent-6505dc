/**
 * Global Messages hub — consolidates every cross-portal thread
 * (Client Portal ↔ Command Centre and Finance Portal ↔ Command Centre/Client)
 * into a single workspace, independent of any client profile context.
 *
 * Distinct from the CRM Conversations tab, which surfaces external CRM
 * correspondence (GHL/SMS/email). This page is for portal-native messaging.
 */
import { useEffect, useMemo, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, MessageSquare, RefreshCcw, Search, ShieldCheck, Inbox, Plus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { ClientPortalMessagesPanel } from '@/components/clients/ClientPortalMessagesPanel';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { StaffFinancePortalMessagesPanel } from '@/components/clients/StaffFinancePortalMessagesPanel';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { SearchInput } from '@/components/ui/search-input';
import { toast } from 'sonner';

type NewMessageScope =
  | 'cp_client_only'
  | 'cp_internal'
  | 'cp_client_with_finance'
  | 'fp_command_finance'
  | 'fp_finance_client'
  | 'fp_command_client_allocated';

const SCOPE_OPTIONS: { value: NewMessageScope; label: string; group: 'client' | 'finance'; hint: string }[] = [
  { value: 'cp_client_only', label: 'Client Portal — Client visible', group: 'client', hint: 'Reply visible to client in their portal' },
  { value: 'cp_client_with_finance', label: 'Client Portal — Client + Finance allocated', group: 'client', hint: 'Visible to client and finance partner' },
  { value: 'cp_internal', label: 'Client Portal — Internal note', group: 'client', hint: 'Command Centre staff only' },
  { value: 'fp_command_finance', label: 'Finance Portal — Command ↔ Finance', group: 'finance', hint: 'Private between Command Centre and finance partner' },
  { value: 'fp_finance_client', label: 'Finance Portal — Finance ↔ Client (CC visible)', group: 'finance', hint: 'Finance partner ↔ client; Command Centre can observe' },
  { value: 'fp_command_client_allocated', label: 'Finance Portal — Command ↔ Client (finance allocated)', group: 'finance', hint: 'Command Centre ↔ client with finance allocation' },
];

interface ClientPortalThread {
  client_id: string;
  client_name: string;
  client_email: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_sender_type: string | null;
  unread_count: number;
}

interface FinanceThreadRow {
  id: string;
  client_id: string;
  finance_user_id: string;
  subject: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count_staff: number;
  thread_type?: string | null;
  visibility_scope?: string | null;
  clients?: { primary_contact_name?: string | null } | null;
  finance_portal_users?: { email?: string | null } | null;
}

interface FinanceClientGroup {
  client_id: string;
  client_name: string;
  partner_emails: string[];
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_total: number;
  thread_count: number;
}

export default function Messages() {
  const [tab, setTab] = useState<'client' | 'finance'>('client');
  const [search, setSearch] = useState('');

  // Client portal threads
  const [clientThreads, setClientThreads] = useState<ClientPortalThread[]>([]);
  const [loadingClient, setLoadingClient] = useState(true);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  // Finance portal threads
  const [financeThreads, setFinanceThreads] = useState<FinanceThreadRow[]>([]);
  const [loadingFinance, setLoadingFinance] = useState(true);
  const [selectedFinanceClientId, setSelectedFinanceClientId] = useState<string | null>(null);

  // New Message dialog
  const [newOpen, setNewOpen] = useState(false);
  const [newScope, setNewScope] = useState<NewMessageScope>('cp_client_only');
  const [newClientId, setNewClientId] = useState<string>('');
  const [newClientSearch, setNewClientSearch] = useState('');
  const [allClients, setAllClients] = useState<{ id: string; primary_contact_name: string | null; primary_contact_email: string | null }[]>([]);
  const [loadingAllClients, setLoadingAllClients] = useState(false);

  const loadAllClients = async () => {
    setLoadingAllClients(true);
    const { data, error } = await invokeSecureFunction('finance-portal-admin', { operation: 'list_clients' });
    if (!error) setAllClients((data?.records || []) as any);
    setLoadingAllClients(false);
  };

  const loadClientThreads = async () => {
    setLoadingClient(true);
    const { data, error } = await invokeSecureFunction('staff-client-portal-messages', {
      operation: 'list_clients_with_messages',
    });
    if (!error) setClientThreads((data?.threads || []) as ClientPortalThread[]);
    setLoadingClient(false);
  };

  const loadFinanceThreads = async () => {
    setLoadingFinance(true);
    const { data, error } = await invokeSecureFunction('finance-portal-messages', {
      operation: 'list_threads',
    });
    if (!error) setFinanceThreads((data?.threads || []) as FinanceThreadRow[]);
    setLoadingFinance(false);
  };

  useEffect(() => {
    loadClientThreads();
    loadFinanceThreads();
  }, []);

  // Real-time refresh on any portal message activity
  useEffect(() => {
    const cpm = supabase
      .channel('global-messages-client-portal')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_portal_messages' }, () => loadClientThreads())
      .subscribe();
    const fpm = supabase
      .channel('global-messages-finance-portal')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_portal_messages' }, () => loadFinanceThreads())
      .subscribe();
    return () => {
      supabase.removeChannel(cpm);
      supabase.removeChannel(fpm);
    };
  }, []);

  const financeGrouped: FinanceClientGroup[] = useMemo(() => {
    const map = new Map<string, FinanceClientGroup>();
    for (const t of financeThreads) {
      const name = t.clients?.primary_contact_name || 'Client';
      const existing = map.get(t.client_id);
      const partnerEmail = t.finance_portal_users?.email || null;
      if (!existing) {
        map.set(t.client_id, {
          client_id: t.client_id,
          client_name: name,
          partner_emails: partnerEmail ? [partnerEmail] : [],
          last_message_at: t.last_message_at,
          last_message_preview: t.last_message_preview,
          unread_total: t.unread_count_staff || 0,
          thread_count: 1,
        });
      } else {
        existing.thread_count += 1;
        existing.unread_total += t.unread_count_staff || 0;
        if (partnerEmail && !existing.partner_emails.includes(partnerEmail)) {
          existing.partner_emails.push(partnerEmail);
        }
        if (
          t.last_message_at &&
          (!existing.last_message_at || new Date(t.last_message_at) > new Date(existing.last_message_at))
        ) {
          existing.last_message_at = t.last_message_at;
          existing.last_message_preview = t.last_message_preview;
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if ((b.unread_total > 0 ? 1 : 0) !== (a.unread_total > 0 ? 1 : 0)) {
        return (b.unread_total > 0 ? 1 : 0) - (a.unread_total > 0 ? 1 : 0);
      }
      return new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime();
    });
  }, [financeThreads]);

  const filteredClientThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clientThreads;
    return clientThreads.filter(
      (t) =>
        t.client_name?.toLowerCase().includes(q) ||
        t.client_email?.toLowerCase().includes(q) ||
        t.last_message_preview?.toLowerCase().includes(q),
    );
  }, [clientThreads, search]);

  const filteredFinanceGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return financeGrouped;
    return financeGrouped.filter(
      (g) =>
        g.client_name.toLowerCase().includes(q) ||
        g.partner_emails.some((e) => e.toLowerCase().includes(q)) ||
        g.last_message_preview?.toLowerCase().includes(q),
    );
  }, [financeGrouped, search]);

  const totalClientUnread = clientThreads.reduce((s, t) => s + (t.unread_count || 0), 0);
  const totalFinanceUnread = financeGrouped.reduce((s, t) => s + (t.unread_total || 0), 0);

  const refreshing = loadingClient || loadingFinance;

  return (
    <main className="min-h-full bg-background p-4 sm:p-6 lg:p-8">
      <DashboardThemeFrame variant="page" className="flex flex-col gap-5">
        <DashboardThemeFrame variant="hero" as="header" className="border-primary/20 bg-gradient-to-br from-card via-card to-primary/10 shadow-[0_24px_70px_rgba(0,0,0,0.18)] dark:shadow-black/35">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/55 to-transparent" />
          <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-primary/15 blur-3xl" />
          <div className="pointer-events-none absolute -left-16 bottom-0 h-36 w-36 rounded-full bg-success/5 blur-3xl" />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/20 to-primary/5 text-primary shadow-lg shadow-primary/10">
                  <Inbox className="h-6 w-6" />
                </span>
                Portal Messages
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
                All Client Portal and Finance Portal threads, consolidated for Command Centre oversight.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-primary shadow-inner shadow-sm dark:shadow-black/10">Portal command hub</span>
                <span className="rounded-full border border-success/20 bg-success/10 px-3 py-1 text-success dark:text-success">{clientThreads.length} client threads</span>
                <span className="rounded-full border border-info/20 bg-info/10 px-3 py-1 text-info dark:text-info">{financeGrouped.length} finance clients</span>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <Button
                size="sm"
                className="h-10 justify-center rounded-full border border-primary/35 bg-primary px-5 font-semibold text-primary-foreground shadow-[0_14px_34px_hsl(var(--primary)/0.24)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.28),0_18px_42px_hsl(var(--primary)/0.22)] focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0"
                onClick={() => {
                  setNewOpen(true);
                  if (allClients.length === 0) loadAllClients();
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                New message
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-busy={refreshing}
                className={cn(
                  'h-10 justify-center rounded-full border-border/70 bg-card/80 px-5 text-foreground shadow-sm shadow-sm dark:shadow-black/10 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.12),0_14px_34px_hsl(var(--primary)/0.10)] focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 dark:bg-background/55',
                  refreshing && 'border-primary/45 bg-primary/10 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.16),0_14px_34px_hsl(var(--primary)/0.10)]',
                )}
                onClick={() => {
                  loadClientThreads();
                  loadFinanceThreads();
                }}
              >
                <RefreshCcw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          </div>
        </DashboardThemeFrame>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'client' | 'finance')} className="space-y-4">
          <DashboardThemeFrame variant="toolbar" className="relative overflow-hidden border-primary/15 bg-card/70 shadow-xl shadow-sm dark:shadow-black/10 dark:bg-background/45 dark:shadow-black/25">
            <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
            <div className="relative flex w-full flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative min-w-0 flex-1 xl:max-w-2xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/75" />
                <label htmlFor="portal-message-search" className="sr-only">Search portal messages by client, partner, or message</label>
                <SearchInput
                  value={search}
                  onValueChange={setSearch}
                  id="portal-message-search"
                  aria-label="Search portal messages by client, partner, or message"
                  placeholder="Search by client, partner, or message…"
                  hideIcon
                  className="h-12 rounded-2xl border-border/70 bg-background/70 pl-11 pr-4 text-sm text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_14px_34px_rgba(0,0,0,0.10)] transition-all duration-200 placeholder:text-muted-foreground/75 hover:border-primary/35 hover:bg-background/90 focus-visible:border-primary/65 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:bg-background/55"
                />
              </div>

              <TabsList aria-label="Portal message type" className="grid h-auto w-full grid-cols-2 gap-1.5 rounded-2xl border border-border/70 bg-background/70 dark:border-white/10 dark:bg-background/55 p-1.5 shadow-lg shadow-sm dark:shadow-black/20 xl:w-auto xl:min-w-[420px]">
                <TabsTrigger value="client" className="min-h-11 gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/10 hover:text-primary hover:shadow-[0_10px_28px_rgba(0,0,0,0.18)] focus-visible:ring-2 focus-visible:ring-primary/45 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/20">
                  <MessageSquare className="h-4 w-4 shrink-0" />
                  Client Portal
                  {totalClientUnread > 0 && (
                    <Badge className="ml-1 rounded-full border border-primary/40 bg-primary px-2 text-[10px] font-bold text-primary-foreground">{totalClientUnread}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="finance" className="min-h-11 gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/10 hover:text-primary hover:shadow-[0_10px_28px_rgba(0,0,0,0.18)] focus-visible:ring-2 focus-visible:ring-primary/45 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/20">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  Finance Portal
                  {totalFinanceUnread > 0 && (
                    <Badge className="ml-1 rounded-full border border-primary/40 bg-primary px-2 text-[10px] font-bold text-primary-foreground">{totalFinanceUnread}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>
          </DashboardThemeFrame>

          <TabsContent value="client" className="mt-0 min-h-0">
            <div className="grid min-h-[560px] grid-cols-1 gap-3 rounded-[2rem] border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 p-2 shadow-2xl shadow-sm dark:shadow-black/25 lg:h-[calc(100vh-282px)] lg:min-h-0 lg:grid-cols-[330px_1fr]">
              <Card className="flex min-h-[520px] flex-col overflow-hidden rounded-[1.5rem] border-primary/15 bg-[linear-gradient(180deg,rgba(24,24,27,0.96),rgba(9,9,11,0.98))] shadow-xl shadow-sm dark:shadow-black/25 lg:h-full lg:min-h-0">
              <CardHeader className="border-b border-primary/10 bg-gradient-to-r from-brand-300/12 via-success/[0.04] to-transparent px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-[13px] font-bold uppercase tracking-[0.18em] text-primary">Clients</CardTitle>
                    <p className="mt-1 text-[11px] text-muted-foreground">{filteredClientThreads.length} visible · {totalClientUnread} unread</p>
                  </div>
                  <Badge variant="outline" className="rounded-full border-success/25 bg-success/10 px-2 text-[10px] text-success">Client Portal</Badge>
                </div>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 p-0">
                {loadingClient ? (
                  <div className="m-4 flex flex-col items-center justify-center rounded-3xl border border-primary/15 bg-background/25 dark:bg-black/25 px-5 py-12 text-center shadow-inner shadow-sm dark:shadow-black/20">
                    <Loader2 className="h-5 w-5 animate-spin text-brand-200/80" />
                    <p className="mt-3 text-sm font-medium text-foreground">Loading client portal threads…</p>
                    <p className="mt-1 text-xs text-muted-foreground">Syncing the latest client conversations.</p>
                  </div>
                ) : filteredClientThreads.length === 0 ? (
                  <div className="m-4 rounded-3xl border border-dashed border-primary/15 bg-background/30 dark:bg-black/30 px-5 py-10 text-center text-sm text-muted-foreground shadow-inner shadow-sm dark:shadow-black/20">
                    <MessageSquare className="mx-auto mb-3 h-8 w-8 text-brand-200/60" />
                    <p className="font-medium text-foreground">{search.trim() ? 'No client portal matches found.' : 'No client portal messages yet.'}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {search.trim() ? 'Try a different client, email, or message search.' : 'Client conversations will appear here when portal messages arrive.'}
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-[calc(75vh-72px)] min-h-[420px] [scrollbar-color:rgba(245,158,11,0.38)_rgba(24,24,27,0.9)] lg:h-full lg:min-h-0">
                    <div className="space-y-1.5 p-2">
                      {filteredClientThreads.map((t) => (
                        <button
                          key={t.client_id}
                          onClick={() => setSelectedClientId(t.client_id)}
                          aria-pressed={selectedClientId === t.client_id}
                          aria-label={`Open Client Portal messages for ${t.client_name}`}
                          className={cn(
                            'group relative min-h-[112px] w-full overflow-hidden rounded-2xl border border-border dark:border-white/5 bg-white/[0.025] px-4 py-3.5 text-left shadow-sm shadow-sm dark:shadow-black/10 transition-all duration-200 before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-brand-300 before:opacity-0 before:transition-opacity hover:-translate-y-0.5 hover:border-brand-300/25 hover:bg-brand-300/10 hover:shadow-[0_16px_36px_rgba(0,0,0,0.24),0_0_0_1px_rgba(251,191,36,0.12)] hover:before:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/50',
                            selectedClientId === t.client_id && 'border-brand-300/45 bg-brand-300/12 shadow-[inset_4px_0_0_rgba(251,191,36,0.98),0_16px_38px_rgba(0,0,0,0.28)] before:opacity-100',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate pr-2 text-[15px] font-semibold leading-5 text-foreground transition-colors group-hover:text-brand-50">{t.client_name}</div>
                            {t.unread_count > 0 && (
                              <Badge className="shrink-0 rounded-full border border-brand-200/50 bg-primary px-2 text-[10px] font-bold text-primary-foreground shadow-sm shadow-brand-950/20">{t.unread_count}</Badge>
                            )}
                          </div>
                          <div className={cn('mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground/85', !t.last_message_preview && 'italic text-muted-foreground/55')}>
                            {t.last_message_preview || '—'}
                          </div>
                          {t.last_message_at && (
                            <div className="mt-3 inline-flex rounded-full border border-border dark:border-white/10 bg-background/30 dark:bg-black/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/85">
                              {formatDistanceToNow(new Date(t.last_message_at), { addSuffix: true })}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            <Card className="flex min-h-[520px] flex-col overflow-hidden rounded-[1.5rem] border-primary/15 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.06),transparent_34%),linear-gradient(180deg,rgba(9,9,11,0.96),rgba(3,3,4,0.98))] shadow-xl shadow-sm dark:shadow-black/25 lg:h-full lg:min-h-0 lg:border-l-amber-300/25">
                <CardContent className="min-h-0 flex-1 p-0 overflow-hidden">
                {selectedClientId ? (
                  <div className="h-full min-h-0 overflow-hidden overscroll-contain">
                      <ClientPortalMessagesPanel fillContainer className="h-full min-h-0" clientId={selectedClientId} clientName={clientThreads.find((thread) => thread.client_id === selectedClientId)?.client_name} />
                  </div>
                ) : (
                  <div className="relative flex h-full min-h-[520px] flex-col items-center justify-center overflow-hidden p-8 text-center text-sm text-muted-foreground lg:min-h-0">
                    <div className="pointer-events-none absolute inset-x-12 top-1/2 h-px -translate-y-24 bg-gradient-to-r from-transparent via-brand-300/25 to-transparent" />
                    <div className="pointer-events-none absolute h-56 w-56 rounded-full bg-brand-300/10 blur-3xl" />
                    <div className="relative mb-5 flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-brand-300/25 bg-gradient-to-br from-brand-300/15 to-white/[0.03] text-brand-200 shadow-[0_18px_45px_rgba(0,0,0,0.28)]">
                      <MessageSquare className="h-9 w-9 opacity-90" />
                    </div>
                    <div className="relative max-w-sm rounded-3xl border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 px-6 py-5 shadow-xl shadow-sm dark:shadow-black/20 backdrop-blur">
                      <p className="text-base font-semibold text-foreground">Select a client to view portal messages.</p>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">Choose a thread from the left pane to open the portal conversation workspace.</p>
                      <div className="mt-4 flex flex-wrap justify-center gap-1.5 text-[10px] font-medium text-primary/90">
                        <span className="rounded-full border border-primary/15 bg-brand-300/10 px-2 py-0.5">Search</span>
                        <span className="rounded-full border border-primary/15 bg-brand-300/10 px-2 py-0.5">Review</span>
                        <span className="rounded-full border border-primary/15 bg-brand-300/10 px-2 py-0.5">Reply</span>
                      </div>
                      <div className="mx-auto mt-4 h-1 w-14 rounded-full bg-gradient-to-r from-transparent via-brand-300/70 to-transparent" />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="finance" className="mt-0 min-h-0">
          <div className="grid min-h-[560px] grid-cols-1 gap-3 rounded-[2rem] border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 p-2 shadow-2xl shadow-sm dark:shadow-black/25 lg:h-[calc(100vh-282px)] lg:min-h-0 lg:grid-cols-[330px_1fr]">
            <Card className="flex min-h-[520px] flex-col overflow-hidden rounded-[1.5rem] border-primary/15 bg-[linear-gradient(180deg,rgba(24,24,27,0.96),rgba(9,9,11,0.98))] shadow-xl shadow-sm dark:shadow-black/25 lg:h-full lg:min-h-0">
              <CardHeader className="border-b border-primary/10 bg-gradient-to-r from-brand-300/10 via-info/[0.05] to-transparent px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-[13px] font-bold uppercase tracking-[0.18em] text-primary">Finance clients</CardTitle>
                    <p className="mt-1 text-[11px] text-muted-foreground">{filteredFinanceGroups.length} visible · {totalFinanceUnread} unread</p>
                  </div>
                  <Badge variant="outline" className="rounded-full border-info/25 bg-info/10 px-2 text-[10px] text-info">Finance Portal</Badge>
                </div>
              </CardHeader>
              <CardContent className="min-h-0 flex-1 p-0">
                {loadingFinance ? (
                  <div className="m-4 flex flex-col items-center justify-center rounded-3xl border border-primary/15 bg-background/25 dark:bg-black/25 px-5 py-12 text-center shadow-inner shadow-sm dark:shadow-black/20">
                    <Loader2 className="h-5 w-5 animate-spin text-brand-200/80" />
                    <p className="mt-3 text-sm font-medium text-foreground">Loading finance portal threads…</p>
                    <p className="mt-1 text-xs text-muted-foreground">Checking partner-visible finance activity.</p>
                  </div>
                ) : filteredFinanceGroups.length === 0 ? (
                  <div className="m-4 rounded-3xl border border-dashed border-primary/15 bg-background/30 dark:bg-black/30 px-5 py-10 text-center text-sm text-muted-foreground shadow-inner shadow-sm dark:shadow-black/20">
                    <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-brand-200/65" />
                    <p className="font-medium text-foreground">{search.trim() ? 'No finance portal matches found.' : 'No finance portal threads yet.'}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {search.trim() ? 'Try another client, partner email, or message search.' : 'Finance partner threads will appear here once available.'}
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-[calc(75vh-72px)] min-h-[420px] [scrollbar-color:rgba(245,158,11,0.38)_rgba(24,24,27,0.9)] lg:h-full lg:min-h-0">
                    <div className="space-y-1.5 p-2">
                      {filteredFinanceGroups.map((g) => (
                        <button
                          key={g.client_id}
                          onClick={() => setSelectedFinanceClientId(g.client_id)}
                          aria-pressed={selectedFinanceClientId === g.client_id}
                          aria-label={`Open Finance Portal messages for ${g.client_name}`}
                          className={cn(
                            'group relative min-h-[112px] w-full overflow-hidden rounded-2xl border border-border dark:border-white/5 bg-white/[0.025] px-4 py-3.5 text-left shadow-sm shadow-sm dark:shadow-black/10 transition-all duration-200 before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-brand-300 before:opacity-0 before:transition-opacity hover:-translate-y-0.5 hover:border-brand-300/25 hover:bg-brand-300/10 hover:shadow-[0_16px_36px_rgba(0,0,0,0.24),0_0_0_1px_rgba(251,191,36,0.12)] hover:before:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/50',
                            selectedFinanceClientId === g.client_id && 'border-brand-300/45 bg-brand-300/12 shadow-[inset_4px_0_0_rgba(251,191,36,0.98),0_16px_38px_rgba(0,0,0,0.28)] before:opacity-100',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate pr-2 text-[15px] font-semibold leading-5 text-foreground transition-colors group-hover:text-brand-50">{g.client_name}</div>
                            {g.unread_total > 0 && (
                              <Badge className="shrink-0 rounded-full border border-brand-200/50 bg-primary px-2 text-[10px] font-bold text-primary-foreground shadow-sm shadow-brand-950/20">{g.unread_total}</Badge>
                            )}
                          </div>
                          <div className={cn('mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground/85', !g.last_message_preview && 'italic text-muted-foreground/55')}>
                            {g.last_message_preview || '—'}
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <div className="truncate text-[10px] text-muted-foreground/75">
                              {g.partner_emails.join(', ') || 'Unassigned'}
                            </div>
                            <Badge variant="outline" className="shrink-0 rounded-full border-info/20 bg-info/10 px-2 text-[10px] text-info">
                              {g.thread_count} {g.thread_count === 1 ? 'thread' : 'threads'}
                            </Badge>
                          </div>
                          {g.last_message_at && (
                            <div className="mt-3 inline-flex rounded-full border border-primary/15 bg-background/30 dark:bg-black/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/85">
                              {formatDistanceToNow(new Date(g.last_message_at), { addSuffix: true })}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            <Card className="flex min-h-[520px] flex-col overflow-hidden rounded-[1.5rem] border-primary/15 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.06),transparent_34%),linear-gradient(180deg,rgba(9,9,11,0.96),rgba(3,3,4,0.98))] shadow-xl shadow-sm dark:shadow-black/25 lg:h-full lg:min-h-0 lg:border-l-amber-300/25">
              <CardContent className="min-h-0 flex-1 p-0 overflow-hidden">
                {selectedFinanceClientId ? (
                  <div className="h-full min-h-0 overflow-hidden overscroll-contain p-4">
                    <StaffFinancePortalMessagesPanel className="h-full min-h-0" clientId={selectedFinanceClientId} />
                  </div>
                ) : (
                  <div className="relative flex h-full min-h-[520px] flex-col items-center justify-center overflow-hidden p-8 text-center text-sm text-muted-foreground lg:min-h-0">
                    <div className="pointer-events-none absolute inset-x-12 top-1/2 h-px -translate-y-24 bg-gradient-to-r from-transparent via-brand-300/25 to-transparent" />
                    <div className="pointer-events-none absolute h-56 w-56 rounded-full bg-brand-300/10 blur-3xl" />
                    <div className="relative mb-5 flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-brand-300/25 bg-gradient-to-br from-brand-300/15 to-white/[0.03] text-brand-200 shadow-[0_18px_45px_rgba(0,0,0,0.28)]">
                      <ShieldCheck className="h-9 w-9 opacity-90" />
                    </div>
                    <div className="relative max-w-sm rounded-3xl border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 px-6 py-5 shadow-xl shadow-sm dark:shadow-black/20 backdrop-blur">
                      <p className="text-base font-semibold text-foreground">Select a client to view finance portal threads.</p>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">Choose a finance-linked client to review partner-visible thread activity.</p>
                      <div className="mt-4 flex flex-wrap justify-center gap-1.5 text-[10px] font-medium text-primary/90">
                        <span className="rounded-full border border-primary/15 bg-brand-300/10 px-2 py-0.5">Partner view</span>
                        <span className="rounded-full border border-info/15 bg-info/10 px-2 py-0.5 text-info">Finance threads</span>
                      </div>
                      <div className="mx-auto mt-4 h-1 w-14 rounded-full bg-gradient-to-r from-transparent via-brand-300/70 to-transparent" />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] max-w-2xl overflow-hidden rounded-[1.25rem] border-brand-300/20 sm:rounded-[1.75rem] bg-[linear-gradient(135deg,rgba(24,24,27,0.98),rgba(5,5,6,0.98))] p-0 shadow-2xl shadow-sm dark:shadow-black/50">
          <DialogHeader className="border-b border-primary/10 bg-gradient-to-r from-brand-300/10 via-white/[0.03] to-transparent px-6 py-5">
            <DialogTitle className="text-xl font-semibold tracking-tight text-foreground">New portal message</DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">
              Choose the scope and client. The thread will open in the relevant portal panel where you can compose your message.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[62vh] space-y-5 overflow-y-auto px-4 py-5 sm:px-6 [scrollbar-color:rgba(245,158,11,0.38)_rgba(24,24,27,0.9)]">
            <div className="space-y-2.5">
              <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Scope</Label>
              <Select value={newScope} onValueChange={(v) => setNewScope(v as NewMessageScope)}>
                <SelectTrigger className="h-12 rounded-2xl border-border dark:border-white/10 bg-background/35 dark:bg-black/35 px-4 text-sm shadow-inner shadow-sm dark:shadow-black/20 transition-all duration-200 hover:border-brand-300/30 hover:bg-black/45 focus:ring-2 focus:ring-brand-300/30"><SelectValue /></SelectTrigger>
                <SelectContent className="border-border dark:border-white/10 bg-background dark:bg-background">
                  {SCOPE_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      <div className="flex flex-col py-1">
                        <span className="text-sm font-medium">{s.label}</span>
                        <span className="text-[10px] leading-4 text-muted-foreground">{s.hint}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2.5">
              <Label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Client</Label>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/75" />
                <label htmlFor="new-portal-message-client-search" className="sr-only">Search clients for a new portal message</label>
                <SearchInput
                  value={newClientSearch}
                  onValueChange={setNewClientSearch}
                  id="new-portal-message-client-search"
                  aria-label="Search clients for a new portal message"
                  placeholder="Search clients…"
                  hideIcon
                  className="h-12 rounded-2xl border-border dark:border-white/10 bg-background/35 dark:bg-black/35 pl-11 text-sm shadow-inner shadow-sm dark:shadow-black/20 transition-all duration-200 placeholder:text-muted-foreground/70 hover:border-brand-300/30 hover:bg-black/45 focus-visible:border-brand-300/50 focus-visible:ring-2 focus-visible:ring-brand-300/30"
                />
              </div>
              <ScrollArea className="h-64 rounded-2xl border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 [scrollbar-color:rgba(245,158,11,0.38)_rgba(24,24,27,0.9)]">
                {loadingAllClients ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-brand-200/80" />
                  </div>
                ) : (
                  <div className="space-y-1.5 p-2">
                    {allClients
                      .filter((c) => {
                        const q = newClientSearch.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          c.primary_contact_name?.toLowerCase().includes(q) ||
                          c.primary_contact_email?.toLowerCase().includes(q)
                        );
                      })
                      .slice(0, 100)
                      .map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setNewClientId(c.id)}
                          className={cn(
                            'w-full rounded-2xl border border-transparent px-3.5 py-3 text-left text-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300/25 hover:bg-brand-300/10 hover:shadow-[0_12px_28px_rgba(0,0,0,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/40',
                            newClientId === c.id && 'border-brand-300/40 bg-brand-300/12 shadow-[inset_3px_0_0_rgba(251,191,36,0.95)]',
                          )}
                        >
                          <div className="truncate font-semibold text-foreground">{c.primary_contact_name || 'Unnamed client'}</div>
                          {c.primary_contact_email && (
                            <div className="mt-1 truncate text-xs text-muted-foreground">{c.primary_contact_email}</div>
                          )}
                        </button>
                      ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>

          <DialogFooter className="flex-col-reverse gap-2 border-t border-border dark:border-white/10 bg-background/25 dark:bg-black/25 px-4 py-4 sm:flex-row sm:justify-between sm:px-6">
            <Button variant="outline" onClick={() => setNewOpen(false)} className="w-full rounded-full border-border dark:border-white/10 bg-background/30 dark:bg-black/30 px-5 text-muted-foreground sm:w-auto transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300/30 hover:bg-brand-300/10 hover:text-primary hover:shadow-[0_10px_24px_rgba(0,0,0,0.22)] focus-visible:ring-brand-300/40">Cancel</Button>
            <Button
              disabled={!newClientId}
              className="w-full rounded-full bg-brand-300 px-6 font-semibold sm:w-auto text-black shadow-lg shadow-brand-950/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-200 hover:shadow-[0_14px_32px_rgba(245,158,11,0.22)] focus-visible:ring-brand-300 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:hover:translate-y-0"
              onClick={() => {
                const scopeMeta = SCOPE_OPTIONS.find((s) => s.value === newScope)!;
                if (scopeMeta.group === 'client') {
                  setTab('client');
                  setSelectedClientId(newClientId);
                } else {
                  setTab('finance');
                  setSelectedFinanceClientId(newClientId);
                }
                setNewOpen(false);
                toast.success(`Opened thread in ${scopeMeta.label}. Compose using the scope selector in the panel.`);
              }}
            >
              Open thread
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </DashboardThemeFrame>
    </main>
  );
}
