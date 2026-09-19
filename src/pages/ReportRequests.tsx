import { useState, useEffect, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { smartCapitalize } from '@/lib/nameUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { SearchInput } from '@/components/ui/search-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import {
  Loader2, Clock, ArrowRight, CheckCircle2, XCircle,
  BarChart3, PiggyBank, Building2, User, Send, Calendar,
  MessageSquare, Filter, Inbox, Mail, Phone, MapPin, ExternalLink
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { cn } from '@/lib/utils';
import { PORTFOLIO_REPORT_LABEL } from '@/lib/reports/portfolio/label';

const requestTypeConfig: Record<string, { label: string; icon: typeof BarChart3; color: string }> = {
  portfolio_review: { label: PORTFOLIO_REPORT_LABEL, icon: BarChart3, color: 'border border-success/25 bg-gradient-to-br from-success/20 via-success/10 to-success/10 text-success ring-1 ring-success/20' },
  borrowing_capacity: { label: 'Borrowing Capacity', icon: PiggyBank, color: 'border border-brand-300/25 bg-gradient-to-br from-brand-300/20 via-brand-500/10 to-warning/10 text-brand-200 ring-1 ring-brand-300/20' },
  investment_property: { label: 'Investment Property', icon: Building2, color: 'border border-info/25 bg-gradient-to-br from-info/20 via-info/10 to-accent/10 text-info ring-1 ring-info/20' },
};

const statusConfig: Record<string, { label: string; icon: typeof Clock; color: string; badgeVariant: string }> = {
  pending: { label: 'Pending', icon: Clock, color: 'text-brand-300', badgeVariant: 'border-brand-300/35 bg-brand-400/10 text-brand-100 shadow-brand-950/20' },
  in_progress: { label: 'In Progress', icon: ArrowRight, color: 'text-info', badgeVariant: 'border-info/35 bg-info/10 text-info shadow-info/20' },
  completed: { label: 'Completed', icon: CheckCircle2, color: 'text-success', badgeVariant: 'border-success/35 bg-success/10 text-success shadow-success/20' },
  declined: { label: 'Declined', icon: XCircle, color: 'text-destructive', badgeVariant: 'border-destructive/35 bg-destructive/10 text-destructive shadow-destructive/20' },
};

const statusCardConfig: Record<string, { glow: string; iconWrap: string; edge: string; count: string; active: string }> = {
  pending: {
    glow: 'hover:shadow-[0_18px_48px_rgba(245,158,11,0.22)]',
    iconWrap: 'border-brand-300/25 bg-brand-300/10 text-brand-200 group-hover:bg-brand-300/20',
    edge: 'from-brand-300/0 via-brand-300/80 to-brand-300/0',
    count: 'text-brand-50',
    active: 'border-brand-300/55 ring-2 ring-brand-300/20 shadow-[0_18px_48px_rgba(245,158,11,0.2)]',
  },
  in_progress: {
    glow: 'hover:shadow-[0_18px_48px_rgba(59,130,246,0.22)]',
    iconWrap: 'border-info/25 bg-info/10 text-info group-hover:bg-info/20',
    edge: 'from-info/0 via-info/80 to-brand-200/30',
    count: 'text-info',
    active: 'border-info/55 ring-2 ring-info/20 shadow-[0_18px_48px_rgba(59,130,246,0.2)]',
  },
  completed: {
    glow: 'hover:shadow-[0_18px_48px_rgba(16,185,129,0.2)]',
    iconWrap: 'border-success/25 bg-success/10 text-success group-hover:bg-success/20',
    edge: 'from-success/0 via-success/80 to-success/30',
    count: 'text-success-foreground',
    active: 'border-success/55 ring-2 ring-success/20 shadow-[0_18px_48px_rgba(16,185,129,0.18)]',
  },
  declined: {
    glow: 'hover:shadow-[0_18px_48px_rgba(248,113,113,0.18)]',
    iconWrap: 'border-destructive/25 bg-destructive/10 text-destructive group-hover:bg-destructive/20',
    edge: 'from-destructive/0 via-destructive/70 to-destructive/0',
    count: 'text-destructive-foreground',
    active: 'border-destructive/50 ring-2 ring-destructive/20 shadow-[0_18px_48px_rgba(248,113,113,0.16)]',
  },
};

const statusButtonConfig: Record<string, { idle: string; active: string; icon: string }> = {
  pending: {
    idle: 'hover:border-brand-300/45 hover:bg-brand-300/10 hover:text-brand-100 focus-visible:ring-brand-300/35',
    active: 'border-brand-300/55 bg-brand-300/15 text-brand-100 ring-2 ring-brand-300/20 shadow-[0_10px_26px_rgba(245,158,11,0.16)]',
    icon: 'text-brand-200',
  },
  in_progress: {
    idle: 'hover:border-info/45 hover:bg-info/10 hover:text-info focus-visible:ring-info/35',
    active: 'border-info/55 bg-info/15 text-info ring-2 ring-info/20 shadow-[0_10px_26px_rgba(59,130,246,0.16)]',
    icon: 'text-info',
  },
  completed: {
    idle: 'hover:border-success/45 hover:bg-success/10 hover:text-success focus-visible:ring-success/35',
    active: 'border-success/55 bg-success/15 text-success ring-2 ring-success/20 shadow-[0_10px_26px_rgba(16,185,129,0.14)]',
    icon: 'text-success',
  },
  declined: {
    idle: 'hover:border-destructive/45 hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/35',
    active: 'border-destructive/55 bg-destructive/15 text-destructive ring-2 ring-destructive/20 shadow-[0_10px_26px_rgba(248,113,113,0.14)]',
    icon: 'text-destructive',
  },
};

interface ReportRequest {
  id: string;
  client_id: string;
  request_type: string;
  status: string;
  property_address: string | null;
  client_property_id: string | null;
  notes: string | null;
  admin_notes: string | null;
  assigned_to: string | null;
  fulfilled_report_id: string | null;
  created_at: string;
  updated_at: string;
  // Joined from client lookup
  client_name?: string;
  client_email?: string;
  client_phone?: string;
  client_address?: string;
}

export default function ReportRequests() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { canEdit: canEditRequests } = useModulePermissions('reports');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedRequest, setSelectedRequest] = useState<ReportRequest | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const { data: requestsData, isLoading, error } = useQuery({
    queryKey: ['report-requests-admin'],
    queryFn: async () => {
      // Fetch all report requests
      const { data, error } = await invokeSecureFunction<{ success: boolean; data: any[] }>('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'client_portal_report_requests',
          select: '*',
          orderBy: 'created_at',
          orderAsc: false,
          limit: 200,
        },
      });
      if (error) throw error;
      const requests = (data as any)?.records || (data as any)?.data || [];

      // Fetch client names for all unique client_ids — fetch them individually to avoid 500-limit issue
      const clientIds = [...new Set(requests.map((r: any) => r.client_id).filter(Boolean))];
      const clientMap: Record<string, { name: string; email: string | null; phone: string | null; address: string | null }> = {};
      
      if (clientIds.length > 0) {
        // Fetch each client by ID directly to avoid pagination limits
        const clientFetches = clientIds.map(async (cid: string) => {
          try {
            const { data: clientData } = await invokeSecureFunction('get-client-data', {
              clientId: cid,
              include: { properties: false, employment: false, income: false, expenses: false, assets: false, liabilities: false, deals: false, files: false, reminders: false, notes: false },
            });
            const c = (clientData as any)?.client;
            if (c) {
              const name = smartCapitalize(`${c.primary_first_name || ''} ${c.primary_surname || ''}`.trim());
              clientMap[cid] = {
                name: name || 'Unnamed Client',
                email: c.primary_email || null,
                phone: c.primary_mobile || null,
                address: c.primary_current_address || null,
              };
            }
          } catch (e) {
            console.error(`Failed to fetch client ${cid}:`, e);
          }
        });
        await Promise.all(clientFetches);
      }
      
      return requests.map((r: any) => ({
        ...r,
        client_name: clientMap[r.client_id]?.name || 'Unknown Client',
        client_email: clientMap[r.client_id]?.email || null,
        client_phone: clientMap[r.client_id]?.phone || null,
        client_address: clientMap[r.client_id]?.address || null,
      }));
    },
    staleTime: 15000,
  });

  const requests = requestsData || [];

  // Auto-open a highlighted request from notification deep link
  const highlightId = searchParams.get('highlight');
  useEffect(() => {
    if (highlightId && requests.length > 0) {
      const target = requests.find((r: ReportRequest) => r.id === highlightId);
      if (target) {
        setSelectedRequest(target);
        setAdminNotes(target.admin_notes || '');
        // Clear the highlight param so refresh doesn't re-open
        searchParams.delete('highlight');
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [highlightId, requests]);

  const filtered = requests.filter((r: ReportRequest) => {
    const matchesSearch = !search ||
      r.client_name?.toLowerCase().includes(search.toLowerCase()) ||
      r.property_address?.toLowerCase().includes(search.toLowerCase()) ||
      r.notes?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
    const matchesType = typeFilter === 'all' || r.request_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const counts = {
    pending: requests.filter((r: ReportRequest) => r.status === 'pending').length,
    in_progress: requests.filter((r: ReportRequest) => r.status === 'in_progress').length,
    completed: requests.filter((r: ReportRequest) => r.status === 'completed').length,
    declined: requests.filter((r: ReportRequest) => r.status === 'declined').length,
  };

  const handleStatusUpdate = async (requestId: string, newStatus: string) => {
    setUpdatingStatus(true);
    try {
      const { error } = await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'client_portal_report_requests',
        recordId: requestId,
        data: {
          status: newStatus,
          admin_notes: adminNotes.trim() || null,
        },
      });
      if (error) throw error;
      toast.success(`Request marked as ${newStatus.replace('_', ' ')}`);
      queryClient.invalidateQueries({ queryKey: ['report-requests-admin'] });
      setSelectedRequest(null);
      setAdminNotes('');
    } catch (err: any) {
      toast.error('Failed to update: ' + (err.message || 'Unknown error'));
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleKeyboardActivate = (event: KeyboardEvent, action: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  };

  return (
    <DashboardThemeFrame variant="page" className="relative min-h-[calc(100vh-6rem)] rounded-[1.5rem] border border-border/60 bg-background/80 p-3 shadow-2xl shadow-sm dark:shadow-black/10 selection:bg-primary/20 selection:text-foreground dark:border-white/10 dark:bg-background/80 dark:shadow-black/40 sm:rounded-[2rem] sm:p-6 lg:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(212,175,55,0.18),transparent_32%),radial-gradient(circle_at_85%_12%,rgba(59,130,246,0.12),transparent_26%),linear-gradient(135deg,rgba(255,255,255,0.06),transparent_35%)]" />
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-300/60 to-transparent" />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6">
        {/* Header */}
        <DashboardThemeFrame as="header" variant="hero" className="border-primary/20 p-5 shadow-lg shadow-primary/5 sm:p-7">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/60 to-transparent" />
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-300/25 bg-brand-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-brand-200 shadow-inner shadow-brand-950/20">
                <Send className="h-3.5 w-3.5" />
                Portal Operations
              </div>
              <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground dark:text-white sm:text-5xl">Client Report Requests</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground/85 dark:text-foreground/85 sm:text-base">Manage incoming report requests from portal clients</p>
            </div>
            <div className="rounded-2xl border border-brand-300/15 bg-background/25 dark:bg-black/25 px-4 py-3 text-sm text-muted-foreground dark:text-muted-foreground shadow-inner shadow-sm dark:shadow-black/30">
              <span className="text-2xl font-semibold tabular-nums text-brand-200">{requests.length}</span>
              <span className="ml-2">total requests</span>
            </div>
          </div>
        </DashboardThemeFrame>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(['pending', 'in_progress', 'completed', 'declined'] as const).map((status) => {
            const conf = statusConfig[status];
            const tile = statusCardConfig[status];
            const Icon = conf.icon;
            return (
              <Card
                key={status}
                className={cn(
                  'group relative cursor-pointer overflow-hidden rounded-3xl border-border dark:border-white/10 bg-[linear-gradient(145deg,rgba(24,24,27,0.94),rgba(9,9,11,0.86))] shadow-lg shadow-sm dark:shadow-black/25 outline-none transition-all duration-300 hover:-translate-y-1 hover:border-brand-300/35 active:translate-y-0 focus-visible:border-brand-300/45 focus-visible:ring-2 focus-visible:ring-brand-300/20',
                  tile.glow,
                  statusFilter === status && tile.active
                )}
                onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
                onKeyDown={(event) => handleKeyboardActivate(event, () => setStatusFilter(statusFilter === status ? 'all' : status))}
                role="button"
                tabIndex={0}
                aria-pressed={statusFilter === status}
                aria-label={`Filter report requests by ${conf.label}`}
              >
                <CardContent className="relative flex min-h-[132px] flex-col justify-between p-4 sm:p-5">
                  <div className={cn('absolute inset-x-0 top-0 h-px bg-gradient-to-r opacity-70 transition-opacity group-hover:opacity-100', tile.edge)} />
                  <div className="absolute -right-8 -top-10 h-24 w-24 rounded-full bg-card/5 dark:bg-white/5 blur-2xl transition-opacity group-hover:opacity-80" />
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground dark:text-muted-foreground">{conf.label}</p>
                    <div className={cn('rounded-2xl border p-2.5 shadow-inner transition-all duration-300 group-hover:scale-105', tile.iconWrap)}>
                      <Icon className={cn('h-5 w-5', conf.color)} />
                    </div>
                  </div>
                  <div>
                    <p className={cn('text-4xl font-semibold leading-none tracking-[-0.04em] tabular-nums sm:text-5xl', tile.count)}>{counts[status]}</p>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className={cn('h-full w-10 rounded-full bg-gradient-to-r transition-all duration-300 group-hover:w-16', tile.edge)} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Filters */}
        <DashboardThemeFrame variant="toolbar" className="relative overflow-hidden p-3 shadow-xl shadow-sm dark:shadow-black/10 sm:p-4 dark:shadow-black/25">
          <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/35 to-transparent" />
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              aria-label="Search report requests"
              placeholder="Search by client, property, or notes..."
              containerClassName="group/search flex-1"
              className="h-12 rounded-2xl border-border dark:border-white/10 bg-background/45 dark:bg-black/45 pr-4 text-sm text-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/30 placeholder:text-muted-foreground dark:placeholder:text-muted-foreground transition-all duration-200 hover:border-white/20 hover:bg-black/55 focus-visible:border-brand-300/55 focus-visible:ring-2 focus-visible:ring-brand-300/20 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              iconClassName="left-4 dark:text-muted-foreground transition-colors group-focus-within/search:text-brand-200"
            />
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger
                aria-label="Filter report requests by type"
                className={cn(
                  'h-12 w-full rounded-2xl border-border dark:border-white/10 bg-background/45 dark:bg-black/45 px-4 text-sm font-medium text-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/30 transition-all duration-200 hover:border-brand-300/30 hover:bg-black/55 focus:border-brand-300/55 focus:ring-2 focus:ring-brand-300/20 focus:ring-offset-2 focus:ring-offset-background data-[state=open]:border-brand-300/45 data-[state=open]:bg-brand-300/10 lg:w-60',
                  typeFilter !== 'all' && 'border-brand-300/35 bg-brand-300/10 text-brand-100'
                )}
              >
                <Filter className="mr-2 h-3.5 w-3.5 text-brand-200" />
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent className="overflow-hidden rounded-2xl border-border dark:border-white/10 bg-background/95 dark:bg-background/95 p-1 text-foreground dark:text-foreground shadow-2xl shadow-sm dark:shadow-black/50 backdrop-blur-xl">
                <SelectItem className="rounded-xl font-medium focus:bg-brand-300/10 focus:text-brand-100 data-[highlighted]:bg-brand-300/10 data-[highlighted]:text-brand-100" value="all">All Types</SelectItem>
                <SelectItem className="rounded-xl focus:bg-brand-300/10 focus:text-brand-100 data-[highlighted]:bg-brand-300/10 data-[highlighted]:text-brand-100" value="portfolio_review">{PORTFOLIO_REPORT_LABEL}</SelectItem>
                <SelectItem className="rounded-xl focus:bg-brand-300/10 focus:text-brand-100 data-[highlighted]:bg-brand-300/10 data-[highlighted]:text-brand-100" value="borrowing_capacity">Borrowing Capacity</SelectItem>
                <SelectItem className="rounded-xl focus:bg-brand-300/10 focus:text-brand-100 data-[highlighted]:bg-brand-300/10 data-[highlighted]:text-brand-100" value="investment_property">Investment Property</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DashboardThemeFrame>

        {/* Request List */}
        {isLoading ? (
          <div className="relative overflow-hidden rounded-3xl border border-border dark:border-white/10 bg-[linear-gradient(135deg,rgba(24,24,27,0.82),rgba(9,9,11,0.78))] p-4 shadow-xl shadow-sm dark:shadow-black/25">
            <div className="flex flex-col items-center justify-center rounded-2xl border border-border dark:border-white/10 bg-background/25 dark:bg-black/25 py-16 text-center">
              <div className="mb-4 rounded-full border border-brand-300/20 bg-brand-300/10 p-3 shadow-[0_0_32px_rgba(245,158,11,0.16)]">
                <Loader2 className="h-7 w-7 animate-spin text-brand-200" />
              </div>
              <p className="text-sm font-medium text-foreground dark:text-foreground">Loading report requests</p>
              <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">Fetching the latest client portal requests…</p>
            </div>
          </div>
        ) : error ? (
          <Card className="overflow-hidden rounded-3xl border-destructive/20 bg-[linear-gradient(135deg,rgba(127,29,29,0.2),rgba(9,9,11,0.86))] shadow-xl shadow-sm dark:shadow-black/25">
            <CardContent className="py-12 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-destructive/20 bg-destructive/10">
                <XCircle className="h-7 w-7 text-destructive/80" />
              </div>
              <p className="font-semibold text-destructive-foreground">Unable to load report requests.</p>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-destructive-foreground/70">{(error as Error).message || 'Please try again shortly.'}</p>
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="overflow-hidden rounded-3xl border-border dark:border-white/10 bg-[linear-gradient(135deg,rgba(24,24,27,0.82),rgba(9,9,11,0.78))] shadow-xl shadow-sm dark:shadow-black/25">
            <CardContent className="py-14 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-brand-300/15 bg-brand-300/10">
                <Inbox className="h-7 w-7 text-brand-200/50" />
              </div>
              <p className="font-medium text-muted-foreground dark:text-foreground">
                {requests.length === 0 ? 'No report requests yet.' : 'No requests match your filters.'}
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground dark:text-muted-foreground">
                {requests.length === 0 ? 'New portal requests will appear here as soon as clients submit them.' : 'Try adjusting the search term or selected request type/status filters.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <DashboardThemeFrame variant="section" className="relative p-3 shadow-xl shadow-sm dark:shadow-black/10 ring-1 ring-border dark:ring-white/[0.03] sm:p-4 dark:shadow-black/25">
            <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/30 to-transparent" />
            <div className="space-y-3 sm:space-y-4">
              {filtered.map((req: ReportRequest) => {
                const typeConf = requestTypeConfig[req.request_type] || requestTypeConfig.portfolio_review;
                const statConf = statusConfig[req.status] || statusConfig.pending;
                const TypeIcon = typeConf.icon;
                return (
                  <Card
                    key={req.id}
                    className="group cursor-pointer overflow-hidden rounded-3xl border-border dark:border-white/10 bg-[linear-gradient(145deg,rgba(24,24,27,0.94),rgba(9,9,11,0.86))] shadow-lg shadow-sm dark:shadow-black/20 outline-none transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-300/40 hover:bg-background/80 hover:shadow-[0_20px_52px_rgba(245,158,11,0.14)] active:translate-y-0 focus-visible:border-brand-300/45 focus-visible:ring-2 focus-visible:ring-brand-300/20"
                    onClick={() => { setSelectedRequest(req); setAdminNotes(req.admin_notes || ''); }}
                    onKeyDown={(event) => handleKeyboardActivate(event, () => { setSelectedRequest(req); setAdminNotes(req.admin_notes || ''); })}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${typeConf.label} request for ${req.client_name}`}
                  >
                    <CardContent className="relative p-4 sm:p-5">
                      <div className="absolute inset-y-4 left-0 w-1 rounded-r-full bg-brand-300/0 transition-colors duration-300 group-hover:bg-brand-300/80" />
                      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                      <div className="flex items-start gap-4">
                        <div className={cn('shrink-0 rounded-2xl p-3.5 shadow-inner shadow-sm dark:shadow-black/20 transition-transform duration-300 group-hover:scale-105', typeConf.color)}>
                          <TypeIcon className="h-6 w-6" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold tracking-tight text-foreground dark:text-white sm:text-base">{typeConf.label}</p>
                                <Badge variant="outline" className={cn('rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-sm backdrop-blur transition-colors duration-200 group-hover:border-brand-300/35', statConf.badgeVariant)}>
                                  {statConf.label}
                                </Badge>
                              </div>
                              <div className="grid gap-1.5 text-xs leading-5 text-muted-foreground dark:text-muted-foreground">
                                <div className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-brand-200/75" /><span className="capitalize font-medium text-foreground dark:text-foreground">{req.client_name}</span></div>
                                {req.client_email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground dark:text-muted-foreground" /><span className="break-all">{req.client_email}</span></div>}
                                {req.client_phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground dark:text-muted-foreground" /><span>{req.client_phone}</span></div>}
                                {req.property_address && <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 text-muted-foreground dark:text-muted-foreground" /><span>{req.property_address}</span></div>}
                                {req.notes && <div className="flex items-start gap-2 rounded-2xl border border-border dark:border-white/10 bg-background/20 dark:bg-black/20 px-3 py-2 text-muted-foreground dark:text-foreground"><MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-200/60" /><span className="line-clamp-2">{req.notes}</span></div>}
                              </div>
                            </div>
                            <div className="shrink-0 self-start rounded-2xl border border-border dark:border-white/10 bg-background/30 dark:bg-black/30 px-3 py-2 text-left shadow-inner shadow-sm dark:shadow-black/25 sm:text-right">
                              <p className="text-xs font-medium tabular-nums text-foreground dark:text-foreground">{format(new Date(req.created_at), 'dd MMM yyyy')}</p>
                              <p className="mt-0.5 text-[10px] text-muted-foreground dark:text-muted-foreground">{formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </DashboardThemeFrame>
        )}
      </div>

      {/* Detail / Action Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={(open) => { if (!open) setSelectedRequest(null); }}>
        <DialogContent className="!flex w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] flex-col gap-0 !overflow-hidden border-brand-300/25 bg-[linear-gradient(145deg,rgba(24,24,27,0.98),rgba(9,9,11,0.96))] p-0 text-foreground shadow-[0_28px_90px_rgba(0,0,0,0.72)] sm:max-h-[min(calc(100dvh-2rem),760px)] sm:max-w-xl sm:rounded-3xl [&>button]:right-5 [&>button]:top-5 [&>button]:z-10 [&>button]:rounded-full [&>button]:border [&>button]:border-white/10 [&>button]:bg-black/35 [&>button]:text-muted-foreground [&>button]:opacity-100 [&>button]:shadow-inner [&>button]:shadow-black/30 [&>button]:transition-all [&>button:hover]:border-brand-300/40 [&>button:hover]:bg-brand-300/10 [&>button:hover]:text-brand-100 [&>button:focus-visible]:ring-2 [&>button:focus-visible]:ring-brand-300/40 [&>button:focus-visible]:ring-offset-2 [&>button:focus-visible]:ring-offset-background">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/70 to-transparent" />
          <DialogHeader className="shrink-0 border-b border-border bg-white/[0.02] px-4 pb-5 pt-6 pr-16 text-left dark:border-white/10 sm:px-6 sm:pr-16">
            <DialogTitle className="flex items-center gap-3 text-xl font-semibold tracking-[-0.02em] text-foreground dark:text-white">
              <span className="rounded-2xl border border-brand-300/25 bg-brand-300/10 p-2 text-brand-200 shadow-inner shadow-sm dark:shadow-black/20">
                <Send className="h-4 w-4" />
              </span>
              Report Request Details
            </DialogTitle>
            <DialogDescription className="pt-1 text-sm leading-6 text-muted-foreground dark:text-muted-foreground">Review and manage this client report request.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-5 sm:px-6">

          {selectedRequest && (() => {
            const typeConf = requestTypeConfig[selectedRequest.request_type] || requestTypeConfig.portfolio_review;
            const statConf = statusConfig[selectedRequest.status] || statusConfig.pending;
            const TypeIcon = typeConf.icon;
            return (
              <div className="space-y-4 pb-2">
                <div className="space-y-4 rounded-3xl border border-border dark:border-white/10 bg-[linear-gradient(145deg,rgba(39,39,42,0.62),rgba(9,9,11,0.46))] p-4 shadow-inner shadow-sm dark:shadow-black/30 ring-1 ring-border dark:ring-white/[0.03]">
                  <div className="rounded-2xl border border-border dark:border-white/10 bg-background/20 dark:bg-black/20 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className={cn('shrink-0 rounded-2xl p-3 shadow-inner shadow-sm dark:shadow-black/20', typeConf.color)}><TypeIcon className="h-5 w-5" /></div>
                        <p className="min-w-0 [overflow-wrap:anywhere] break-words text-base font-semibold tracking-tight text-foreground dark:text-white">{typeConf.label}</p>
                      </div>
                      {/* One status, drawn once. There were two of these — the
                          same badge, the same variant, the same label — one in
                          this row and a second directly under it, which is the
                          audit's "it says in progress twice". */}
                      <Badge variant="outline" className={cn('w-fit shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-sm backdrop-blur', statConf.badgeVariant)}>{statConf.label}</Badge>
                    </div>
                  </div>

                  <div className="grid gap-2.5 text-sm">
                    <div className="flex items-start gap-3 rounded-2xl border border-border dark:border-white/5 bg-background/15 dark:bg-black/15 px-3 py-2">
                      <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-200/70" />
                      <span className="w-20 shrink-0 text-muted-foreground dark:text-muted-foreground">Client:</span>
                      <span className="min-w-0 flex-1 font-semibold capitalize text-foreground dark:text-white">{selectedRequest.client_name}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 gap-1.5 rounded-full border-brand-300/30 bg-background/50 px-3 text-xs font-semibold text-brand-100 transition-all hover:border-brand-300/55 hover:bg-brand-300/10 focus-visible:ring-2 focus-visible:ring-brand-300/35"
                        aria-label={`Open the client card for ${selectedRequest.client_name}`}
                        onClick={() => {
                          const targetClientId = selectedRequest.client_id;
                          setSelectedRequest(null);
                          navigate(`/clients?clientId=${targetClientId}`);
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open client card
                      </Button>
                    </div>
                    {selectedRequest.client_email && <div className="flex items-start gap-3 rounded-2xl border border-border dark:border-white/5 bg-background/15 dark:bg-black/15 px-3 py-2"><Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground dark:text-muted-foreground" /><span className="w-20 shrink-0 text-muted-foreground dark:text-muted-foreground">Email:</span><span className="min-w-0 break-all font-medium text-foreground dark:text-white">{selectedRequest.client_email}</span></div>}
                    {selectedRequest.client_phone && <div className="flex items-start gap-3 rounded-2xl border border-border dark:border-white/5 bg-background/15 dark:bg-black/15 px-3 py-2"><Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground dark:text-muted-foreground" /><span className="w-20 shrink-0 text-muted-foreground dark:text-muted-foreground">Phone:</span><span className="min-w-0 font-medium text-foreground dark:text-white">{selectedRequest.client_phone}</span></div>}
                    {selectedRequest.client_address && <div className="flex items-start gap-3 rounded-2xl border border-border dark:border-white/5 bg-background/15 dark:bg-black/15 px-3 py-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground dark:text-muted-foreground" /><span className="w-20 shrink-0 text-muted-foreground dark:text-muted-foreground">Address:</span><span className="min-w-0 break-words font-medium text-foreground dark:text-white">{selectedRequest.client_address}</span></div>}
                    <div className="flex items-start gap-3 rounded-2xl border border-border dark:border-white/5 bg-background/15 dark:bg-black/15 px-3 py-2"><Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground dark:text-muted-foreground" /><span className="w-20 shrink-0 text-muted-foreground dark:text-muted-foreground">Requested:</span><span className="min-w-0 font-medium text-foreground dark:text-white">{format(new Date(selectedRequest.created_at), 'dd MMM yyyy, HH:mm')}</span></div>
                    {selectedRequest.property_address && <div className="flex items-start gap-3 rounded-2xl border border-border dark:border-white/5 bg-background/15 dark:bg-black/15 px-3 py-2"><Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground dark:text-muted-foreground" /><span className="w-20 shrink-0 text-muted-foreground dark:text-muted-foreground">Property:</span><span className="min-w-0 break-words font-medium text-foreground dark:text-white">{selectedRequest.property_address}</span></div>}
                    {selectedRequest.notes && <div className="flex items-start gap-3 rounded-2xl border border-brand-300/10 bg-brand-300/5 px-3 py-3"><MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-200/70" /><span className="w-20 shrink-0 text-muted-foreground dark:text-muted-foreground">Client notes:</span><span className="min-w-0 whitespace-pre-wrap break-words leading-5 text-foreground dark:text-white">{selectedRequest.notes}</span></div>}
                  </div>
                </div>

                {/* Status Selector */}
                <div className="space-y-2 rounded-3xl border border-border dark:border-white/10 bg-background/20 dark:bg-black/20 p-4 shadow-inner shadow-sm dark:shadow-black/25">
                  <Label className="text-sm font-semibold text-foreground dark:text-foreground">Update Status</Label>
                  <div className="flex flex-wrap gap-2.5">
                    {(['pending', 'in_progress', 'completed', 'declined'] as const).map((status) => {
                      const conf = statusConfig[status];
                      const buttonTone = statusButtonConfig[status];
                      const Icon = conf.icon;
                      const isActive = selectedRequest.status === status;
                      return (
                        <Button
                          key={status}
                          size="sm"
                          variant="outline"
                          disabled={updatingStatus || isActive}
                          aria-pressed={isActive}
                          aria-label={`Set request status to ${conf.label}`}
                          onClick={() => handleStatusUpdate(selectedRequest.id, status)}
                          className={cn(
                            'min-h-10 rounded-full border-border dark:border-white/10 bg-background/60 dark:bg-background/60 px-3.5 text-xs font-semibold text-muted-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/20 transition-all duration-200 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:translate-y-0 disabled:opacity-100',
                            buttonTone.idle,
                            isActive && buttonTone.active,
                            isActive && 'pointer-events-none',
                            updatingStatus && 'cursor-wait'
                          )}
                        >
                          {updatingStatus ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Icon className={cn('mr-1.5 h-3.5 w-3.5', buttonTone.icon)} />}
                          {conf.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                {/* Admin Notes */}
                <div className="space-y-2 rounded-3xl border border-border dark:border-white/10 bg-background/20 dark:bg-black/20 p-4 shadow-inner shadow-sm dark:shadow-black/25">
                  <Label className="flex items-center gap-2 text-sm font-semibold text-foreground dark:text-foreground">
                    <MessageSquare className="h-3.5 w-3.5 text-brand-200/75" />
                    Admin Notes
                  </Label>
                  <Textarea
                    aria-label="Admin Notes"
                    placeholder="Add internal notes or a response to the client..."
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    rows={4}
                    className="max-h-44 min-h-28 resize-y rounded-2xl border-border dark:border-white/10 bg-background/70 dark:bg-background/70 text-sm leading-6 text-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/30 placeholder:text-muted-foreground dark:placeholder:text-muted-foreground transition-all duration-200 focus-visible:border-brand-300/55 focus-visible:ring-2 focus-visible:ring-brand-300/20 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                </div>
              </div>
            );
          })()}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardThemeFrame>
  );
}
