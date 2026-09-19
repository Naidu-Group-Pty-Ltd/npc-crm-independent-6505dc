import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchInput } from '@/components/ui/search-input';
import {
  Briefcase, Plus, ChevronRight, AlertTriangle, Clock, CheckCircle2, Loader2, Eye, EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { smartCapitalize } from '@/lib/nameUtils';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { formatDistanceToNowStrict } from 'date-fns';
import { SavedViewsBar } from '@/components/finance-portal/SavedViewsBar';
import { BulkActionsBar } from '@/components/finance-portal/BulkActionsBar';
import { InlineEdit } from '@/components/finance-portal/InlineEdit';
import { SmartSnoozeDialog } from '@/components/finance-portal/SmartSnoozeDialog';

function agingTone(iso: string | null | undefined) {
  if (!iso) return { label: 'no activity', cls: 'bg-muted text-muted-foreground' };
  const hrs = (Date.now() - new Date(iso).getTime()) / 3600_000;
  const label = formatDistanceToNowStrict(new Date(iso));
  if (hrs >= 168) return { label, cls: 'bg-destructive/15 text-destructive border-destructive/30' };
  if (hrs >= 72)  return { label, cls: 'bg-brand-500/15 text-brand-500 border-brand-500/30' };
  return { label, cls: 'bg-muted text-muted-foreground' };
}

const FINANCE_STATUS_LABEL: Record<string, string> = {
  not_started: 'Not Started',
  docs_requested: 'Docs Requested',
  docs_received: 'Docs Received',
  in_review: 'In Assessment',
  pre_approval_in_progress: 'Pre-Approval In Progress',
  pre_approved: 'Pre-Approved',
  purchase_specific_review: 'Property Review Required',
  green_light_given: 'Green Light Given',
  proceed_with_caution: 'Proceed With Caution',
  application_lodged: 'Application Lodged',
  conditional_approval: 'Conditional Approval',
  valuation_pending: 'Valuation Ordered',
  valuation_returned: 'Valuation Returned',
  unconditional_approval: 'Unconditional Approval',
  loan_docs_issued: 'Loan Docs Issued',
  ready_for_settlement: 'Ready for Settlement',
  settled: 'Settled',
  at_risk: 'At Risk',
};

const STATUS_TONE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  active: 'bg-primary/15 text-primary border-primary/30',
  on_hold: 'bg-brand-500/15 text-brand-500 border-brand-500/30',
  at_risk: 'bg-destructive/15 text-destructive border-destructive/30',
  settled: 'bg-success/15 text-success border-success/30',
  cancelled: 'bg-muted text-muted-foreground',
};

const PURCHASE_TYPE_LABEL: Record<string, string> = {
  existing_property: 'Existing Property',
  off_the_plan: 'Off-the-Plan',
  house_and_land: 'House & Land',
  land_only: 'Land Only',
  build_only: 'Build Only',
  dual_occupancy: 'Dual Occupancy',
  smsf: 'SMSF',
  commercial: 'Commercial',
  refinance_equity: 'Refinance / Equity Release',
};

function nextDeadline(dates: any[] | undefined) {
  if (!dates?.length) return null;
  const now = new Date();
  const upcoming = dates
    .filter(d => d.due_date && d.status !== 'completed')
    .map(d => ({ ...d, _d: new Date(d.due_date) }))
    .sort((a, b) => a._d.getTime() - b._d.getTime());
  return upcoming.find(d => d._d >= now) || upcoming[upcoming.length - 1] || null;
}

function urgencyTone(date: string | null | undefined) {
  if (!date) return 'text-muted-foreground';
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'text-destructive';
  if (days <= 5) return 'text-brand-500';
  return 'text-success';
}

export default function FinancePortalPurchaseFiles() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [inbox, setInbox] = useState<'mine' | 'team' | 'watching'>('mine');
  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [snoozeId, setSnoozeId] = useState<string | null>(null);

  // Honour ?new=1 deep-link + initial inbox
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setNewOpen(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
    const inb = searchParams.get('inbox');
    if (inb === 'mine' || inb === 'team' || inb === 'watching') setInbox(inb);
  }, []);

  // Global "s" key trigger for snooze (first visible file)
  useEffect(() => {
    const handler = () => {
      if (selected.size > 0) setSnoozeId('__bulk__');
    };
    window.addEventListener('finance:open-snooze', handler);
    return () => window.removeEventListener('finance:open-snooze', handler);
  }, [selected]);



  const { data: payload, isLoading } = useQuery({
    queryKey: ['finance-portal-purchase-files'],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-purchase-files', { operation: 'list_files' });
      if (error) throw new Error(data?.error || error.message);
      return data ?? { files: [] };
    },
  });
  const data = payload?.files ?? [];

  const toggleWatch = async (fileId: string) => {
    const { data: res, error } = await invokeFinanceFunction('finance-portal-purchase-files', {
      operation: 'toggle_watch', file_id: fileId,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(res?.is_watched ? 'Watching this file' : 'Removed from watchlist');
    queryClient.invalidateQueries({ queryKey: ['finance-portal-purchase-files'] });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data || []).filter((f: any) => {
      if (inbox === 'mine' && !f.is_mine) return false;
      if (inbox === 'watching' && !f.is_watched) return false;
      if (inbox === 'team' && f.is_mine) return false;
      if (statusFilter !== 'all' && f.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        f.title, f.property_address, f.lender,
        smartCapitalize(`${f.clients?.primary_first_name || ''} ${f.clients?.primary_surname || ''}`),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [data, search, statusFilter, inbox]);

  const counts = useMemo(() => ({
    mine: (data || []).filter((f: any) => f.is_mine).length,
    team: (data || []).filter((f: any) => !f.is_mine).length,
    watching: (data || []).filter((f: any) => f.is_watched).length,
  }), [data]);

  const grouped = useMemo(() => {
    const map: Record<string, any[]> = { active: [], at_risk: [], on_hold: [], draft: [], settled: [], cancelled: [] };
    for (const f of filtered) (map[f.status] ||= []).push(f);
    return map;
  }, [filtered]);


  return (
    <div className="container mx-auto max-w-7xl py-8 px-4">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Briefcase className="h-7 w-7 text-primary" />
            Active Purchase Files
          </h1>
          <p className="text-muted-foreground mt-1">
            Live deal rooms for every property your clients are acquiring.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> New Purchase File
        </Button>
      </div>

      <Tabs value={inbox} onValueChange={(v) => setInbox(v as any)} className="mb-4">
        <TabsList>
          <TabsTrigger value="mine">Mine <span className="ml-1.5 text-[10px] opacity-70 tabular-nums">{counts.mine}</span></TabsTrigger>
          <TabsTrigger value="team">Team <span className="ml-1.5 text-[10px] opacity-70 tabular-nums">{counts.team}</span></TabsTrigger>
          <TabsTrigger value="watching">Watching <span className="ml-1.5 text-[10px] opacity-70 tabular-nums">{counts.watching}</span></TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search by client, address, lender…"
          containerClassName="flex-1 min-w-[240px]"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="at_risk">At Risk</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="settled">Settled</SelectItem>
          </SelectContent>
        </Select>
        <SavedViewsBar
          scope="purchase_files"
          currentFilters={{ inbox, statusFilter, search }}
          onApply={(filters) => {
            if (filters.inbox) setInbox(filters.inbox);
            if (filters.statusFilter) setStatusFilter(filters.statusFilter);
            if (typeof filters.search === 'string') setSearch(filters.search);
          }}
        />
      </div>


      {isLoading ? (
        <div className="grid gap-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Briefcase className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-lg font-medium">No purchase files yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a purchase file to start tracking finance milestones, critical dates and conditions.
            </p>
            <Button className="mt-4 gap-2" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" /> Create first file
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {(['at_risk', 'active', 'on_hold', 'draft', 'settled', 'cancelled'] as const).map(key => {
            const items = grouped[key];
            if (!items?.length) return null;
            return (
              <section key={key}>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  {key === 'at_risk' ? 'At Risk' : key.replace('_', ' ')}
                  <span className="ml-2 text-xs">({items.length})</span>
                </h2>
                <div className="grid gap-3">
                  {items.map((file: any) => {
                    const clientName = smartCapitalize(
                      `${file.clients?.primary_first_name || ''} ${file.clients?.primary_surname || ''}`.trim()
                    ) || 'Unnamed client';
                    const deadline = nextDeadline(file.purchase_file_critical_dates);
                    return (
                      <motion.div
                        key={file.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        <Card
                          className={cn(
                            'cursor-pointer hover:border-primary/40 transition-all',
                            selected.has(file.id) && 'border-primary ring-1 ring-primary/40',
                          )}
                          onClick={() => navigate(`/finance/purchase-files/${file.id}`)}
                        >
                          <CardContent className="py-4 px-5 flex items-center gap-4">
                            {file.is_mine && (
                              <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                                <Checkbox
                                  checked={selected.has(file.id)}
                                  onCheckedChange={(v) => {
                                    setSelected(prev => {
                                      const next = new Set(prev);
                                      if (v) next.add(file.id); else next.delete(file.id);
                                      return next;
                                    });
                                  }}
                                  aria-label="Select file"
                                />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold truncate">{file.title}</p>
                                <Badge variant="outline" className={cn('text-xs', STATUS_TONE[file.status])}>
                                  {file.status === 'at_risk' ? 'At Risk' : file.status.replace('_', ' ')}
                                </Badge>
                                {file.risk_level === 'high' && (
                                  <Badge variant="outline" className="text-xs bg-destructive/15 text-destructive border-destructive/30 gap-1">
                                    <AlertTriangle className="h-3 w-3" /> High risk
                                  </Badge>
                                )}
                                {(() => { const a = agingTone(file.last_partner_action_at); return (
                                  <Badge variant="outline" className={cn('text-[10px]', a.cls)} title="Time since last partner action">
                                    {a.label}
                                  </Badge>
                                ); })()}
                                {file.is_watched && (
                                  <Badge variant="outline" className="text-[10px] gap-1"><Eye className="h-3 w-3" /> Watching</Badge>
                                )}
                              </div>

                              <p className="text-sm text-muted-foreground truncate mt-0.5">
                                {clientName} · {PURCHASE_TYPE_LABEL[file.purchase_type] || file.purchase_type}
                                {file.property_address ? ` · ${file.property_address}` : ''}
                              </p>
                              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                                <span className="inline-flex items-center gap-1">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {FINANCE_STATUS_LABEL[file.finance_status] || file.finance_status}
                                </span>
                                <span onClick={(e) => e.stopPropagation()}>
                                  Lender:{' '}
                                  <InlineEdit
                                    value={file.lender}
                                    placeholder="set lender"
                                    disabled={!file.is_mine}
                                    onSave={async (next) => {
                                      const { error } = await invokeFinanceFunction('finance-portal-purchase-files', {
                                        operation: 'update_file', file_id: file.id, payload: { lender: next || null },
                                      });
                                      if (error) { toast.error(error.message); return; }
                                      toast.success('Lender updated');
                                      queryClient.invalidateQueries({ queryKey: ['finance-portal-purchase-files'] });
                                    }}
                                  />
                                </span>
                                <span onClick={(e) => e.stopPropagation()}>
                                  Price:{' '}
                                  <InlineEdit
                                    value={file.purchase_price ?? ''}
                                    type="number"
                                    placeholder="set price"
                                    disabled={!file.is_mine}
                                    display={(v) => v ? `$${Number(v).toLocaleString('en-AU')}` : 'set price'}
                                    onSave={async (next) => {
                                      const num = next ? Number(next) : null;
                                      const { error } = await invokeFinanceFunction('finance-portal-purchase-files', {
                                        operation: 'update_file', file_id: file.id, payload: { purchase_price: num },
                                      });
                                      if (error) { toast.error(error.message); return; }
                                      toast.success('Price updated');
                                      queryClient.invalidateQueries({ queryKey: ['finance-portal-purchase-files'] });
                                    }}
                                  />
                                </span>
                                {deadline && (
                                  <span className={cn('inline-flex items-center gap-1', urgencyTone(deadline.due_date))}>
                                    <Clock className="h-3.5 w-3.5" />
                                    Next: {new Date(deadline.due_date).toLocaleDateString('en-AU')}
                                  </span>
                                )}
                              </div>
                            </div>
                            <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                          </CardContent>
                        </Card>
                      </motion.div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <BulkActionsBar selected={selected} onClear={() => setSelected(new Set())} />

      <NewPurchaseFileDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(id) => {
          queryClient.invalidateQueries({ queryKey: ['finance-portal-purchase-files'] });
          if (id) navigate(`/finance/purchase-files/${id}`);
        }}
      />
    </div>
  );
}

function NewPurchaseFileDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id?: string) => void }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [submitting, setSubmitting] = useState(false);
  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [purchaseType, setPurchaseType] = useState('existing_property');
  const [propertyAddress, setPropertyAddress] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');

  const { data: clients } = useQuery({
    queryKey: ['finance-portal-clients-min'],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-client-data', { operation: 'list_assigned_clients' });
      if (error) throw new Error(error.message);
      return (data?.records ?? []).map((r: any) => ({
        id: r.client_id,
        primary_first_name: r.client?.primary_contact_name?.split(' ')[0] || '',
        primary_surname: r.client?.primary_contact_name?.split(' ').slice(1).join(' ') || '',
        primary_email: r.client?.primary_contact_email,
      }));
    },
    enabled: open,
  });

  const handleSubmit = async () => {
    if (!clientId || !title.trim()) {
      toast.error('Client and title are required');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await invokeFinanceFunction('finance-portal-purchase-files', {
        operation: 'create_file',
        client_id: clientId,
        payload: {
          title: title.trim(),
          purchase_type: purchaseType,
          property_address: propertyAddress.trim() || null,
          purchase_price: purchasePrice ? Number(purchasePrice) : null,
          status: 'active',
        },
      });
      if (error || data?.error) {
        const msg = data?.error || error?.message || 'Unknown error';
        const hint = data?.hint ? ` (${data.hint})` : '';
        throw new Error(`${msg}${hint}`);
      }
      toast.success(data?.linked_deal ? 'Purchase file created and mirrored to Command Centre' : 'Purchase file created');
      onCreated(data?.file?.id);
      onOpenChange(false);
      setClientId(''); setTitle(''); setPropertyAddress(''); setPurchasePrice('');
    } catch (e: any) {
      console.error('[NewPurchaseFileDialog] create failed', e);
      toast.error(`Failed to create: ${e?.message || 'Unknown error'}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Purchase File</DialogTitle>
        </DialogHeader>
        <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
          Creating a finance purchase file also mirrors a linked deal into the Command Centre and raises an internal notification.
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger>
              <SelectContent>
                {(clients || []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {smartCapitalize(`${c.primary_first_name || ''} ${c.primary_surname || ''}`.trim()) || c.primary_email || c.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              placeholder="e.g. 12 Example St, Wyndham Vale"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Purchase Type</Label>
            <Select value={purchaseType} onValueChange={setPurchaseType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PURCHASE_TYPE_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Property Address</Label>
              <Input value={propertyAddress} onChange={(e) => setPropertyAddress(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Purchase Price (AUD)</Label>
              <Input type="number" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create File
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
