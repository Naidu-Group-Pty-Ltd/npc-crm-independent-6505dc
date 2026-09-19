import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowLeft, Briefcase, Calendar, AlertTriangle, Clock, CheckCircle2,
  Plus, Trash2, Loader2, Activity, FileText, Lightbulb, Wallet, ShieldCheck,
  ShieldAlert, Calculator, ListChecks, Ship, FileSearch, Inbox, Users, PackageCheck,
  ChevronLeft, ChevronRight,
  Scale,
} from 'lucide-react';
import { ComplianceTab } from '@/components/finance-portal/ComplianceTab';
import { ApplicantsCard } from '@/components/finance-portal/ApplicantsCard';
import { OnboardingChecklistCard } from '@/components/finance-portal/OnboardingChecklistCard';
import { ClientCommsInboxTab } from '@/components/finance-portal/ClientCommsInboxTab';
import { AuditTrailTab } from '@/components/finance-portal/AuditTrailTab';
import { CalculatorsTab } from '@/components/finance-portal/CalculatorsTab';
import { ClientTasksTab } from '@/components/finance-portal/ClientTasksTab';
import { DocumentsTab } from '@/components/finance-portal/DocumentsTab';
import { AiFileSummaryCard } from '@/components/finance-portal/AiFileSummaryCard';
import { AiLenderRecommenderCard } from '@/components/finance-portal/AiLenderRecommenderCard';
import { AiLoanAppPrefillCard } from '@/components/finance-portal/AiLoanAppPrefillCard';
import { FinanceDecisionsTab, ConditionsTab, ValuationsTab } from '@/components/finance-portal/DealTrackerTabs';
import { RiskRegisterTab } from '@/components/finance-portal/RiskRegisterTab';
import { BorrowingSnapshotCard } from '@/components/finance-portal/BorrowingSnapshotCard';
import { ActivityTimeline } from '@/components/finance-portal/ActivityTimeline';
import { InternalDealLinkCard } from '@/components/finance-portal/InternalDealLinkCard';
import { PurchaseFileStickyBar } from '@/components/finance-portal/PurchaseFileStickyBar';
import { RecordOutcomeDialog } from '@/components/finance-portal/RecordOutcomeDialog';
import { NudgeSequencesPanel } from '@/components/finance-portal/NudgeSequencesPanel';

import { NpcHandoffCard } from '@/components/finance-portal/NpcHandoffCard';
import { LimitedAmlStatusCard } from '@/components/finance-portal/LimitedAmlStatusCard';
import { AmlFinanceRequestsCard } from '@/components/finance-portal/AmlFinanceRequestsCard';
import { EntityCommentsThread } from '@/components/finance-portal/EntityCommentsThread';
import { DealTypeFieldsCard } from '@/components/finance-portal/DealTypeFieldsCard';
import { LenderPacketHistoryCard } from '@/components/finance-portal/LenderPacketHistoryCard';
import { SettlementRunwayTab } from '@/components/finance-portal/SettlementRunwayTab';
import { FinanceLegalCoordinationPanel } from '@/components/finance-portal/FinanceLegalCoordinationPanel';

import { toast } from 'sonner';
import { smartCapitalize } from '@/lib/nameUtils';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

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

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', active: 'Active', on_hold: 'On Hold',
  at_risk: 'At Risk', settled: 'Settled', cancelled: 'Cancelled',
};

const CRITICAL_DATE_LABEL: Record<string, string> = {
  offer_submitted: 'Offer submitted',
  contract_received: 'Contract received',
  cooling_off_expiry: 'Cooling-off expiry',
  finance_clause_expiry: 'Finance clause expiry',
  building_pest_deadline: 'Building & pest deadline',
  deposit_due: 'Deposit due',
  valuation_due: 'Valuation due',
  loan_approval_target: 'Loan approval target',
  settlement: 'Settlement',
};

function urgencyClass(date: string | null | undefined, completed: boolean) {
  if (completed) return 'border-success/30 bg-success/5';
  if (!date) return 'border-border bg-card';
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return 'border-destructive/40 bg-destructive/5';
  if (days <= 5) return 'border-brand-500/40 bg-brand-500/5';
  return 'border-success/30 bg-success/5';
}

function urgencyText(date: string | null | undefined, completed: boolean) {
  if (completed) return { label: 'Completed', tone: 'text-success' };
  if (!date) return { label: 'No date set', tone: 'text-muted-foreground' };
  const days = Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: 'text-destructive' };
  if (days === 0) return { label: 'Due today', tone: 'text-brand-500' };
  if (days <= 5) return { label: `Due in ${days}d`, tone: 'text-brand-500' };
  return { label: `In ${days}d`, tone: 'text-success' };
}

export default function FinancePortalPurchaseFileDetail() {
  const { fileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const queryClient = useQueryClient();
  const [savingStatus, setSavingStatus] = useState(false);
  const [tab, setTab] = useState('overview');
  const tabsScrollRef = useRef<HTMLDivElement | null>(null);

  const tabDefs = useMemo(() => ([
    { key: 'overview', label: 'Overview', icon: Briefcase },
    { key: 'dates', label: 'Critical Dates', icon: Calendar },
    { key: 'documents', label: 'Documents', icon: FileText },
    { key: 'decisions', label: 'Finance Decisions', icon: Lightbulb },
    { key: 'tasks', label: 'Action Items', icon: ListChecks },
    { key: 'conditions', label: 'Conditions', icon: ShieldCheck },
    { key: 'valuation', label: 'Valuation', icon: Wallet },
    { key: 'risks', label: 'Risks', icon: ShieldAlert },
    { key: 'runway', label: 'Settlement Runway', icon: Ship },
    ...(import.meta.env.VITE_FINANCE_SOLICITOR_COLLABORATION === 'true'
      ? [{ key: 'legal', label: 'Legal Coordination', icon: Scale }]
      : []),
    { key: 'borrowing', label: 'Borrowing', icon: Calculator },
    { key: 'inbox', label: 'Unified Inbox', icon: Inbox },
    { key: 'activity', label: 'Activity', icon: Activity },
    { key: 'onboarding', label: 'Onboarding', icon: Users },
    { key: 'compliance', label: 'Compliance', icon: PackageCheck },
    { key: 'calculators', label: 'Calculators', icon: Calculator },
    { key: 'audit', label: 'Audit Trail', icon: FileSearch },
  ]), []);

  const activeIndex = tabDefs.findIndex(t => t.key === tab);
  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex >= 0 && activeIndex < tabDefs.length - 1;
  const goToTab = useCallback((direction: 'prev' | 'next') => {
    if (activeIndex < 0) return;
    const next = tabDefs[direction === 'prev' ? activeIndex - 1 : activeIndex + 1];
    if (next) setTab(next.key);
  }, [activeIndex, tabDefs]);

  useEffect(() => {
    const node = tabsScrollRef.current;
    if (!node || !tab) return;
    const btn = node.querySelector<HTMLButtonElement>(`button[data-tab-key="${tab}"]`);
    btn?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [tab]);

  const { data: getRes, isLoading } = useQuery({
    queryKey: ['finance-portal-purchase-file', fileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-purchase-files', {
        operation: 'get_file', file_id: fileId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!fileId,
  });
  const data = getRes?.file;
  const linkedDeal = getRes?.linked_deal || null;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['finance-portal-purchase-file', fileId] });

  const clientName = useMemo(() => {
    const c = data?.clients;
    if (!c) return '';
    return smartCapitalize(`${c.primary_first_name || ''} ${c.primary_surname || ''}`.trim());
  }, [data]);

  const updateField = async (field: string, value: any) => {
    setSavingStatus(true);
    try {
      const { error } = await invokeFinanceFunction('finance-portal-purchase-files', {
        operation: 'update_file', file_id: fileId, payload: { [field]: value },
      });
      if (error) throw new Error(error.message);
      toast.success('Updated');
      refresh();
    } catch (e: any) {
      toast.error(e.message || 'Update failed');
    } finally {
      setSavingStatus(false);
    }
  };

  const toggleWatch = async () => {
    const { data: res, error } = await invokeFinanceFunction('finance-portal-purchase-files', {
      operation: 'toggle_watch', file_id: fileId,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(res?.is_watched ? 'Watching this file' : 'Removed from watchlist');
    refresh();
  };

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-6xl py-8 px-4 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container mx-auto max-w-6xl py-12 px-4 text-center">
        <p className="text-lg font-medium">Purchase file not found</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate('/finance/purchase-files')}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to files
        </Button>
      </div>
    );
  }

  const dates = (data.purchase_file_critical_dates || []) as any[];
  const history = (data.purchase_file_status_history || []) as any[];

  return (
    <div className="container mx-auto max-w-6xl py-6 px-4">
      <PurchaseFileStickyBar
        title={data.title}
        status={data.status}
        isWatched={data.is_watched}
        onToggleWatch={toggleWatch}
        onJumpDates={() => setTab('dates')}
        onJumpDocs={() => setTab('documents')}
        onJumpDecisions={() => setTab('decisions')}
        onOpenMessages={() => navigate(`/finance/messages?client=${data.client_id}`)}
      />

      <Button variant="ghost" size="sm" onClick={() => navigate('/finance/purchase-files')} className="mt-4 mb-4 -ml-2">
        <ArrowLeft className="h-4 w-4 mr-1" /> All purchase files
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Briefcase className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">{data.title}</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            {clientName}
            {data.property_address ? ` · ${data.property_address}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Select value={data.status} onValueChange={(v) => updateField('status', v)} disabled={savingStatus}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS_LABEL).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={data.finance_status}
            onValueChange={(v) => updateField('finance_status', v)}
            disabled={savingStatus}
          >
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(FINANCE_STATUS_LABEL).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <RecordOutcomeDialog
            purchaseFileId={fileId!}
            defaultLender={data.lender}
            defaultLoanAmount={Number(data.loan_amount || data.purchase_price || 0)}
          />
        </div>
      </div>


      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute left-0 top-1/2 z-10 -translate-y-1/2 h-8 w-8 md:h-9 md:w-9 shadow-sm bg-card"
            onClick={() => goToTab('prev')}
            disabled={!canGoPrev}
            aria-label="Previous tab"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute right-0 top-1/2 z-10 -translate-y-1/2 h-8 w-8 md:h-9 md:w-9 shadow-sm bg-card"
            onClick={() => goToTab('next')}
            disabled={!canGoNext}
            aria-label="Next tab"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="w-full px-9 md:px-10">
            <div ref={tabsScrollRef} className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-2 px-0.5 scroll-smooth">
              {tabDefs.map((t) => {
                const Icon = t.icon;
                const isActive = tab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    data-tab-key={t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      'flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-200 shrink-0 border',
                      isActive
                        ? 'bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20'
                        : 'bg-card text-muted-foreground border-border/50 hover:border-primary/20 hover:text-foreground hover:bg-primary/5'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <TabsContent value="overview">
          <div className="space-y-4">
            <AiFileSummaryCard purchaseFileId={fileId!} />
            <InternalDealLinkCard
              fileId={fileId!}
              clientId={data.client_id}
              file={data}
              linkedDeal={linkedDeal}
              onChange={refresh}
            />
            <OverviewTab file={data} onSave={updateField} />
            <div className="grid gap-4 md:grid-cols-2">
              <AiLenderRecommenderCard purchaseFileId={fileId!} />
              <AiLoanAppPrefillCard purchaseFileId={fileId!} />
            </div>
            
            <div className="grid gap-4 md:grid-cols-2">
              <NpcHandoffCard purchaseFileId={fileId!} />
              <LimitedAmlStatusCard purchaseFileId={fileId!} clientId={data.client_id} />
            </div>
            <AmlFinanceRequestsCard purchaseFileId={fileId!} />
            <EntityCommentsThread purchaseFileId={fileId!} entityType="purchase_file" title="File comments" />
            <NudgeSequencesPanel purchaseFileId={fileId!} clientId={data.client_id} />
          </div>

        </TabsContent>
        <TabsContent value="dates"><CriticalDatesTab fileId={fileId!} dates={dates} onChange={refresh} /></TabsContent>
        <TabsContent value="documents">
          <div className="space-y-4">
            <DocumentsTab fileId={fileId!} purchaseType={data.purchase_type} />
            <LenderPacketHistoryCard fileId={fileId!} />
          </div>
        </TabsContent>
        <TabsContent value="decisions"><FinanceDecisionsTab fileId={fileId!} /></TabsContent>
        <TabsContent value="tasks"><ClientTasksTab fileId={fileId!} /></TabsContent>
        <TabsContent value="conditions"><ConditionsTab fileId={fileId!} /></TabsContent>
        <TabsContent value="valuation"><ValuationsTab fileId={fileId!} /></TabsContent>
        <TabsContent value="risks"><RiskRegisterTab fileId={fileId!} /></TabsContent>
        <TabsContent value="runway"><SettlementRunwayTab fileId={fileId!} /></TabsContent>
        <TabsContent value="legal"><FinanceLegalCoordinationPanel purchaseFileId={fileId!} /></TabsContent>
        <TabsContent value="borrowing">
          <BorrowingSnapshotCard
            fileId={fileId!}
            snapshot={data.borrowing_snapshot || {}}
            updatedAt={data.borrowing_snapshot_updated_at}
          />
        </TabsContent>
        <TabsContent value="inbox"><ClientCommsInboxTab clientId={data.client_id} purchaseFileId={fileId!} /></TabsContent>
        <TabsContent value="activity"><ActivityTimeline fileId={fileId!} /></TabsContent>
        <TabsContent value="onboarding">
          <div className="grid gap-4 md:grid-cols-2">
            <ApplicantsCard fileId={fileId!} />
            <OnboardingChecklistCard fileId={fileId!} />
          </div>
        </TabsContent>
        <TabsContent value="compliance"><ComplianceTab fileId={fileId!} clientId={data.client_id} /></TabsContent>
        <TabsContent value="calculators"><CalculatorsTab fileId={fileId!} file={data} /></TabsContent>
        <TabsContent value="audit"><AuditTrailTab fileId={fileId!} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ───────── Overview ───────── */
function OverviewTab({ file, onSave }: { file: any; onSave: (k: string, v: any) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Property</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <EditableText label="Address" value={file.property_address} onSave={(v) => onSave('property_address', v)} />
          <div className="grid grid-cols-3 gap-3">
            <EditableText label="Suburb" value={file.property_suburb} onSave={(v) => onSave('property_suburb', v)} />
            <EditableText label="State" value={file.property_state} onSave={(v) => onSave('property_state', v)} />
            <EditableText label="Postcode" value={file.property_postcode} onSave={(v) => onSave('property_postcode', v)} />
          </div>
          <EditableNumber label="Purchase Price (AUD)" value={file.purchase_price} onSave={(v) => onSave('purchase_price', v)} />
          <EditableNumber label="Estimated rent (weekly)" value={file.estimated_rent_weekly} onSave={(v) => onSave('estimated_rent_weekly', v)} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Finance</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <EditableText label="Lender" value={file.lender} onSave={(v) => onSave('lender', v)} />
          <EditableNumber label="Max Approved Budget" value={file.max_approved_budget} onSave={(v) => onSave('max_approved_budget', v)} />
          <EditableNumber label="Deposit" value={file.deposit_amount} onSave={(v) => onSave('deposit_amount', v)} />
          <EditableNumber label="Client Contribution" value={file.client_contribution} onSave={(v) => onSave('client_contribution', v)} />
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Risk Level</Label>
            <Select value={file.risk_level || 'low'} onValueChange={(v) => onSave('risk_level', v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      <DealTypeFieldsCard file={file} onSave={onSave} />
      <Card className="md:col-span-2">
        <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
        <CardContent>
          <EditableTextarea value={file.notes} onSave={(v) => onSave('notes', v)} />
        </CardContent>
      </Card>
    </div>
  );
}

function EditableText({ label, value, onSave }: { label: string; value: any; onSave: (v: string | null) => void }) {
  const [local, setLocal] = useState<string>(value ?? '');
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { if ((value ?? '') !== local) onSave(local.trim() || null); }}
      />
    </div>
  );
}

function EditableNumber({ label, value, onSave }: { label: string; value: any; onSave: (v: number | null) => void }) {
  const [local, setLocal] = useState<string>(value != null ? String(value) : '');
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const next = local === '' ? null : Number(local);
          if ((value ?? null) !== next) onSave(next);
        }}
      />
    </div>
  );
}

function EditableTextarea({ value, onSave }: { value: any; onSave: (v: string | null) => void }) {
  const [local, setLocal] = useState<string>(value ?? '');
  return (
    <Textarea
      rows={4}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if ((value ?? '') !== local) onSave(local.trim() || null); }}
      placeholder="Shared notes for this purchase file…"
    />
  );
}

/* ───────── Critical Dates ───────── */
function CriticalDatesTab({
  fileId, dates, onChange,
}: { fileId: string; dates: any[]; onChange: () => void }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [addOpen, setAddOpen] = useState(false);
  const sorted = useMemo(
    () => [...dates].sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    }),
    [dates]
  );

  const handleDelete = async (id: string) => {
    const { error } = await invokeFinanceFunction('finance-portal-purchase-files', {
      operation: 'delete_critical_date', file_id: fileId, date_id: id,
    });
    if (error) return toast.error(error.message);
    toast.success('Removed');
    onChange();
  };

  const toggleComplete = async (d: any) => {
    const next = d.status === 'completed';
    const { error } = await invokeFinanceFunction('finance-portal-purchase-files', {
      operation: 'upsert_critical_date',
      file_id: fileId,
      payload: {
        id: d.id, date_type: d.date_type, due_date: d.due_date, notes: d.notes,
        status: next ? 'on_track' : 'completed',
        completed_at: next ? null : new Date().toISOString(),
      },
    });
    if (error) return toast.error(error.message);
    onChange();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Critical dates</CardTitle>
        <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Add date
        </Button>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No dates yet. Add the first deadline to start the countdown.
          </p>
        ) : (
          <div className="grid gap-2">
            {sorted.map(d => {
              const u = urgencyText(d.due_date, d.status === 'completed');
              return (
                <motion.div
                  key={d.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3',
                    urgencyClass(d.due_date, d.status === 'completed')
                  )}
                >
                  <button
                    onClick={() => toggleComplete(d)}
                    className="shrink-0"
                    title={d.status === 'completed' ? 'Mark as not done' : 'Mark complete'}
                  >
                    {d.status === 'completed'
                      ? <CheckCircle2 className="h-5 w-5 text-success" />
                      : <Clock className="h-5 w-5 text-muted-foreground" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={cn('font-medium text-sm', d.status === 'completed' && 'line-through text-muted-foreground')}>
                      {CRITICAL_DATE_LABEL[d.date_type] || d.date_type}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.due_date ? new Date(d.due_date).toLocaleDateString('en-AU') : 'No date'}
                      {d.notes ? ` · ${d.notes}` : ''}
                    </p>
                  </div>
                  <span className={cn('text-xs font-medium whitespace-nowrap', u.tone)}>{u.label}</span>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(d.id)} className="h-8 w-8">
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </motion.div>
              );
            })}
          </div>
        )}
      </CardContent>
      <AddCriticalDateDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        fileId={fileId}
        onAdded={onChange}
      />
    </Card>
  );
}

function AddCriticalDateDialog({
  open, onOpenChange, fileId, onAdded,
}: { open: boolean; onOpenChange: (v: boolean) => void; fileId: string; onAdded: () => void }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [type, setType] = useState('finance_clause_expiry');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const { error } = await invokeFinanceFunction('finance-portal-purchase-files', {
        operation: 'upsert_critical_date',
        file_id: fileId,
        payload: { date_type: type, due_date: date || null, notes: notes.trim() || null, status: 'on_track' },
      });
      if (error) throw new Error(error.message);
      toast.success('Date added');
      onAdded();
      onOpenChange(false);
      setDate(''); setNotes('');
    } catch (e: any) {
      toast.error(e.message || 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add critical date</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CRITICAL_DATE_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Due date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
