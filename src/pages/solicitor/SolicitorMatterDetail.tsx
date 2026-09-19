import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Building2, CalendarClock, Contact, FileText, Landmark, Loader2,
  MessagesSquare, Pencil, Plus, Route, Save, ShieldAlert, ShieldCheck, Sparkles, Trash2, Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';
import { SolicitorPortalShell } from '@/components/solicitor-portal/SolicitorPortalShell';
import { ContractIntelligencePanel } from '@/components/solicitor-portal/ContractIntelligencePanel';
import { MatterCompliancePanel } from '@/components/solicitor-portal/MatterCompliancePanel';
import { MatterFinanceCoordinationPanel } from '@/components/solicitor-portal/MatterFinanceCoordinationPanel';
import {
  MATTER_STATUS_CLASSES, MATTER_STATUS_LABELS, MATTER_STATUS_ORDER, MATTER_TYPE_LABELS,
  PARTY_ROLE_LABELS, countdownLabel, formatCurrency, formatMatterDate, formatPropertyAddress,
  type LegalMatter, type LegalMatterParty, type LegalMatterStatus, type LegalMatterStatusEvent,
  type LegalPartyRole,
} from '@/lib/legalMatters';
import {
  CriticalDatesPanel, type DateDraft,
} from '@/components/solicitor-portal/CriticalDatesPanel';
import {
  SettlementRunwayPanel, type TaskDraft,
} from '@/components/solicitor-portal/SettlementRunwayPanel';
import type {
  LegalCriticalDate, LegalCriticalDateStatus, LegalSettlementTask, RunwaySummary,
} from '@/lib/legalCriticalDates';
import {
  MatterDocumentsPanel, type DocumentDraft,
} from '@/components/solicitor-portal/MatterDocumentsPanel';
import {
  MatterSearchesPanel, type SearchDraft,
} from '@/components/solicitor-portal/MatterSearchesPanel';
import {
  MatterRequisitionsPanel, type RequisitionDraft,
} from '@/components/solicitor-portal/MatterRequisitionsPanel';
import {
  MatterDisbursementsPanel, type DisbursementDraft,
} from '@/components/solicitor-portal/MatterDisbursementsPanel';
import {
  MatterCommunicationsPanel,
} from '@/components/solicitor-portal/MatterCommunicationsPanel';
import {
  MAX_DOCUMENT_BYTES,
  type DocumentRegisterSummary, type LegalDocumentStatus, type LegalMatterDisbursement,
  type LegalMatterDocument, type LegalMatterRequisition, type LegalMatterSearch,
  type LegalRequisitionStatus, type LegalSearchStatus,
} from '@/lib/legalDocuments';

type PermissionMatrix = Record<string, { view?: boolean; edit?: boolean; delete?: boolean }>;

const DATE_FIELDS: Array<{ key: keyof LegalMatter; label: string }> = [
  { key: 'contract_date', label: 'Contract date' },
  { key: 'exchange_date', label: 'Exchange date' },
  { key: 'cooling_off_expiry', label: 'Cooling-off expiry' },
  { key: 'finance_clause_date', label: 'Finance clause' },
  { key: 'building_pest_date', label: 'Building & pest' },
  { key: 'sunset_date', label: 'Sunset date' },
  { key: 'settlement_date', label: 'Settlement date' },
  { key: 'actual_settlement_date', label: 'Actual settlement' },
];

const EMPTY_PARTY = {
  id: '' as string | null,
  role: 'other' as LegalPartyRole,
  name: '',
  organisation: '',
  email: '',
  phone: '',
  reference: '',
  notes: '',
  is_primary_contact: false,
};

export default function SolicitorMatterDetail() {
  const { matterId } = useParams<{ matterId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTabState] = useState(searchParams.get('tab') || 'overview');

  const setActiveTab = useCallback((tab: string) => {
    setActiveTabState(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'overview') next.delete('tab'); else next.set('tab', tab);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [matter, setMatter] = useState<LegalMatter | null>(null);
  const [parties, setParties] = useState<LegalMatterParty[]>([]);
  const [history, setHistory] = useState<LegalMatterStatusEvent[]>([]);
  const [finance, setFinance] = useState<Record<string, any> | null>(null);
  const [perms, setPerms] = useState<PermissionMatrix>({});
  const [draft, setDraft] = useState<Partial<LegalMatter>>({});
  const [statusDialog, setStatusDialog] = useState(false);
  const [conflictDialog, setConflictDialog] = useState(false);
  const [nextStatus, setNextStatus] = useState<LegalMatterStatus>('instructed');
  const [statusReason, setStatusReason] = useState('');
  const [partyDialog, setPartyDialog] = useState<typeof EMPTY_PARTY | null>(null);
  const [criticalDates, setCriticalDates] = useState<LegalCriticalDate[]>([]);
  const [runwayTasks, setRunwayTasks] = useState<LegalSettlementTask[]>([]);
  const [runway, setRunway] = useState<RunwaySummary | null>(null);
  const [datesSaving, setDatesSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [documents, setDocuments] = useState<LegalMatterDocument[]>([]);
  const [searches, setSearches] = useState<LegalMatterSearch[]>([]);
  const [requisitions, setRequisitions] = useState<LegalMatterRequisition[]>([]);
  const [disbursements, setDisbursements] = useState<LegalMatterDisbursement[]>([]);
  const [registerSummary, setRegisterSummary] = useState<DocumentRegisterSummary | null>(null);
  const [registerSaving, setRegisterSaving] = useState(false);

  const canEdit = !!perms.matters?.edit;
  const canEditParties = !!perms.parties?.edit;
  const canDeleteParties = !!perms.parties?.delete;

  const load = useCallback(async () => {
    if (!matterId) return;
    setLoading(true);
    const { data, error } = await invokeSolicitorFunction('solicitor-portal-matters', {
      operation: 'get_matter', matter_id: matterId,
    });
    if (error || !data?.matter) {
      toast.error(error?.message || 'Matter not available');
      setLoading(false);
      return;
    }
    setMatter(data.matter as LegalMatter);
    setDraft(data.matter as LegalMatter);
    setParties((data.parties || []) as LegalMatterParty[]);
    setHistory((data.status_history || []) as LegalMatterStatusEvent[]);
    setFinance(data.finance_snapshot ?? null);
    setPerms((data.permissions || {}) as PermissionMatrix);
    setCriticalDates((data.critical_dates || []) as LegalCriticalDate[]);
    setRunwayTasks((data.settlement_tasks || []) as LegalSettlementTask[]);
    setRunway((data.runway ?? null) as RunwaySummary | null);
    setNextStatus((data.matter as LegalMatter).status);
    setLoading(false);
  }, [matterId]);

  const callMatters = useCallback(
    async (payload: Record<string, unknown>) =>
      invokeSolicitorFunction('solicitor-portal-matters', { ...payload, matter_id: matterId }),
    [matterId],
  );

  const refreshDates = useCallback(async () => {
    const [dates, tasks] = await Promise.all([
      callMatters({ operation: 'list_dates' }),
      callMatters({ operation: 'list_runway' }),
    ]);
    if (dates.data?.records) setCriticalDates(dates.data.records as LegalCriticalDate[]);
    if (tasks.data?.records) setRunwayTasks(tasks.data.records as LegalSettlementTask[]);
    if (tasks.data?.runway) setRunway(tasks.data.runway as RunwaySummary);
  }, [callMatters]);

  const saveCriticalDate = async (d: DateDraft) => {
    setDatesSaving(true);
    const { error } = await callMatters({
      operation: 'upsert_date',
      date_id: d.id,
      date_type: d.date_type,
      label: d.label,
      due_date: d.due_date || null,
      owner: d.owner,
      status: d.status,
      is_key: d.is_key,
      visible_to_client: d.visible_to_client,
      reminder_days: d.reminder_days,
      notes: d.notes || null,
    });
    setDatesSaving(false);
    if (error) { toast.error(error.message || 'Could not save the date'); return; }
    toast.success('Critical date saved');
    await refreshDates();
  };

  const setCriticalDateStatus = async (dateId: string, status: LegalCriticalDateStatus) => {
    const { error } = await callMatters({ operation: 'set_date_status', date_id: dateId, status });
    if (error) { toast.error(error.message || 'Could not update the status'); return; }
    await refreshDates();
  };

  const deleteCriticalDate = async (dateId: string) => {
    const { error } = await callMatters({ operation: 'delete_date', date_id: dateId });
    if (error) { toast.error(error.message || 'Could not remove the date'); return; }
    toast.success('Critical date removed');
    await refreshDates();
  };

  const seedRunway = async () => {
    setSeeding(true);
    const { error } = await callMatters({ operation: 'seed_runway' });
    setSeeding(false);
    if (error) { toast.error(error.message || 'Could not generate the runway'); return; }
    toast.success('Settlement runway generated');
    await refreshDates();
  };

  const updateRunwayTask = async (t: TaskDraft, quick = false) => {
    setDatesSaving(true);
    const payload: Record<string, unknown> = {
      operation: 'update_task', task_id: t.id, status: t.status,
    };
    if (!quick) {
      payload.due_date = t.due_date || null;
      payload.blocked_reason = t.blocked_reason || null;
      payload.notes = t.notes || null;
    }
    const { error } = await callMatters(payload);
    setDatesSaving(false);
    if (error) { toast.error(error.message || 'Could not update the step'); return; }
    await refreshDates();
  };

  // ───────────── Phase 5 registers ─────────────
  const callDocs = useCallback(
    async (payload: Record<string, unknown>) =>
      invokeSolicitorFunction('solicitor-portal-documents', { ...payload, matter_id: matterId }),
    [matterId],
  );

  const refreshRegisters = useCallback(async () => {
    const { data, error } = await callDocs({ operation: 'list_registers' });
    if (error || !data?.success) return;
    setDocuments((data.documents || []) as LegalMatterDocument[]);
    setSearches((data.searches || []) as LegalMatterSearch[]);
    setRequisitions((data.requisitions || []) as LegalMatterRequisition[]);
    setDisbursements((data.disbursements || []) as LegalMatterDisbursement[]);
    setRegisterSummary((data.summary ?? null) as DocumentRegisterSummary | null);
  }, [callDocs]);

  useEffect(() => { if (matterId) void refreshRegisters(); }, [matterId, refreshRegisters]);

  const runRegisterOp = async (
    payload: Record<string, unknown>,
    successMessage?: string,
  ): Promise<void> => {
    setRegisterSaving(true);
    const { data, error } = await callDocs(payload);
    setRegisterSaving(false);
    const message = error?.message || (data as any)?.error;
    if (message) { toast.error(message); return; }
    if (successMessage) toast.success(successMessage);
    await refreshRegisters();
  };

  const saveDocument = (d: DocumentDraft) => runRegisterOp({
    operation: d.id ? 'upsert_document' : 'request_document',
    document_id: d.id || undefined,
    category: d.category,
    label: d.label,
    description: d.description,
    owner: d.owner,
    due_date: d.due_date || null,
    visible_to_client: d.visible_to_client,
    visible_to_npc: d.visible_to_npc,
    expected_version: d.id ? documents.find((doc) => doc.id === d.id)?.row_version : undefined,
  }, 'Document saved');

  const setDocumentStatus = (documentId: string, status: LegalDocumentStatus) => {
    const document = documents.find((doc) => doc.id === documentId);
    return runRegisterOp({ operation: 'set_document_status', document_id: documentId, document_version_id: document?.current_version_id, expected_version: document?.row_version, status });
  };

  const deleteDocument = (documentId: string) =>
    runRegisterOp({ operation: 'delete_document', document_id: documentId }, 'Document removed');
  const setDocumentAiPermission = (documentId:string, allow:boolean) => runRegisterOp({operation:'set_document_ai_permission',document_id:documentId,allow_external_ai:allow},allow?'AI processing permission enabled':'AI processing permission revoked');

  const uploadDocument = async (documentId: string, file: File) => {
    if (file.size > MAX_DOCUMENT_BYTES) { toast.error('Files must be 50 MB or smaller'); return; }
    setRegisterSaving(true);
    try {
      const document = documents.find((doc) => doc.id === documentId);
      const { data: signed, error: signError } = await callDocs({
        operation: 'upload_url',
        document_id: documentId,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        file_size: file.size,
        expected_version: document?.row_version,
      });
      const signMessage = signError?.message || (signed as any)?.error;
      if (signMessage || !signed?.signed_url) { toast.error(signMessage || 'Could not start the upload'); return; }

      const put = await fetch(signed.signed_url as string, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!put.ok) { toast.error('The file could not be uploaded'); return; }

      const { data, error } = await callDocs({
        operation: 'attach_upload',
        document_id: documentId,
        storage_path: signed.path,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        file_size: file.size,
        version_id: signed.version_id,
      });
      const message = error?.message || (data as any)?.error;
      if (message) { toast.error(message); return; }
      toast.success((data as any)?.processing_status === 'queued' ? 'File uploaded and queued for security scanning' : 'File uploaded');
      await refreshRegisters();
    } finally {
      setRegisterSaving(false);
    }
  };

  const downloadDocument = async (documentId: string) => {
    const { data, error } = await callDocs({ operation: 'download_url', document_id: documentId });
    const message = error?.message || (data as any)?.error;
    if (message || !data?.url) { toast.error(message || 'No file available yet'); return; }
    window.open(data.url as string, '_blank', 'noopener,noreferrer');
  };

  const saveSearch = (s: SearchDraft) => runRegisterOp({
    operation: 'upsert_search',
    search_id: s.id || undefined,
    search_type: s.search_type,
    label: s.label,
    provider: s.provider,
    reference: s.reference,
    status: s.status,
    ordered_at: s.ordered_at || null,
    received_at: s.received_at || null,
    due_date: s.due_date || null,
    cost_amount: s.cost_amount === '' ? null : Number(s.cost_amount),
    issue_flag: s.issue_flag,
    result_summary: s.result_summary,
    notes: s.notes,
    visible_to_client: s.visible_to_client,
  }, 'Search saved');

  const setSearchStatus = (searchId: string, status: LegalSearchStatus) =>
    runRegisterOp({ operation: 'upsert_search', search_id: searchId, status });

  const deleteSearch = (searchId: string) =>
    runRegisterOp({ operation: 'delete_search', search_id: searchId }, 'Search removed');

  const saveRequisition = (r: RequisitionDraft) => runRegisterOp({
    operation: 'upsert_requisition',
    requisition_id: r.id || undefined,
    direction: r.direction,
    reference: r.reference,
    subject: r.subject,
    detail: r.detail,
    response: r.response,
    status: r.status,
    raised_on: r.raised_on || null,
    response_due: r.response_due || null,
    is_blocking: r.is_blocking,
    visible_to_client: r.visible_to_client,
    notes: r.notes,
  }, 'Requisition saved');

  const setRequisitionStatus = (requisitionId: string, status: LegalRequisitionStatus) =>
    runRegisterOp({ operation: 'upsert_requisition', requisition_id: requisitionId, status });

  const deleteRequisition = (requisitionId: string) =>
    runRegisterOp({ operation: 'delete_requisition', requisition_id: requisitionId }, 'Requisition removed');

  const saveDisbursement = (d: DisbursementDraft) => runRegisterOp({
    operation: 'upsert_disbursement',
    disbursement_id: d.id || undefined,
    label: d.label,
    category: d.category,
    amount: d.amount === '' ? 0 : Number(d.amount),
    gst_amount: d.gst_amount === '' ? 0 : Number(d.gst_amount),
    payable_to: d.payable_to,
    status: d.status,
    incurred_on: d.incurred_on || null,
    paid_on: d.paid_on || null,
    invoice_reference: d.invoice_reference,
    include_in_settlement: d.include_in_settlement,
    visible_to_client: d.visible_to_client,
    notes: d.notes,
  }, 'Disbursement saved');

  const deleteDisbursement = (disbursementId: string) =>
    runRegisterOp({ operation: 'delete_disbursement', disbursement_id: disbursementId }, 'Disbursement removed');

  useEffect(() => { void load(); }, [load]);

  const patch = (key: keyof LegalMatter, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value as never }));

  const saveMatter = async (fields: Array<keyof LegalMatter>) => {
    if (!matterId) return;
    setSaving(true);
    const payload: Record<string, unknown> = { operation: 'update_matter', matter_id: matterId, expected_version: matter?.row_version };
    for (const f of fields) payload[f as string] = (draft as any)[f] ?? null;
    const { data, error } = await invokeSolicitorFunction('solicitor-portal-matters', payload);
    setSaving(false);
    if (error?.status === 409 || error?.code === 'STALE_VERSION') { setConflictDialog(true); return; }
    if (error) { toast.error(error.message || 'Could not save changes'); return; }
    toast.success('Matter updated');
    if (data?.matter) { setMatter(data.matter); setDraft(data.matter); }
  };

  const applyStatus = async () => {
    if (!matterId) return;
    setSaving(true);
    const { error } = await invokeSolicitorFunction('solicitor-portal-matters', {
      operation: 'set_status', matter_id: matterId, expected_version: matter?.row_version,
      status: nextStatus, reason: statusReason || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message || 'Could not change status'); return; }
    toast.success('Status updated');
    setStatusDialog(false);
    setStatusReason('');
    void load();
  };

  const saveParty = async () => {
    if (!matterId || !partyDialog) return;
    if (!partyDialog.name.trim()) { toast.error('Party name is required'); return; }
    setSaving(true);
    const { error } = await invokeSolicitorFunction('solicitor-portal-matters', {
      operation: 'upsert_party',
      matter_id: matterId,
      party_id: partyDialog.id || undefined,
      role: partyDialog.role,
      name: partyDialog.name,
      organisation: partyDialog.organisation,
      email: partyDialog.email,
      phone: partyDialog.phone,
      reference: partyDialog.reference,
      notes: partyDialog.notes,
      is_primary_contact: partyDialog.is_primary_contact,
    });
    setSaving(false);
    if (error) { toast.error(error.message || 'Could not save party'); return; }
    toast.success('Party saved');
    setPartyDialog(null);
    void load();
  };

  const removeParty = async (partyId: string) => {
    if (!matterId) return;
    const { error } = await invokeSolicitorFunction('solicitor-portal-matters', {
      operation: 'delete_party', matter_id: matterId, party_id: partyId,
    });
    if (error) { toast.error(error.message || 'Could not remove party'); return; }
    toast.success('Party removed');
    void load();
  };

  if (loading) {
    return (
      <SolicitorPortalShell title="Matter">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </SolicitorPortalShell>
    );
  }

  if (!matter) {
    return (
      <SolicitorPortalShell title="Matter unavailable" description="This matter is not shared with your practice.">
        <Button variant="outline" onClick={() => navigate('/solicitor/matters')}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to matters
        </Button>
      </SolicitorPortalShell>
    );
  }

  return (
    <SolicitorPortalShell
      eyebrow="Matter"
      title={matter.title}
      description={formatPropertyAddress(matter)}
      actions={
        <>
          <Button asChild variant="ghost" size="sm">
            <Link to="/solicitor/matters"><ArrowLeft className="mr-2 h-4 w-4" /> All matters</Link>
          </Button>
          <Badge variant="outline" className={cn('h-8 px-3 text-sm font-medium', MATTER_STATUS_CLASSES[matter.status])}>
            {MATTER_STATUS_LABELS[matter.status]}
          </Badge>
          {canEdit ? (
            <Button size="sm" onClick={() => setStatusDialog(true)}>
              <Pencil className="mr-2 h-4 w-4" /> Change status
            </Button>
          ) : null}
        </>
      }
    >
      {matter.risk_flag ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-3 pt-6">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" aria-hidden />
            <div>
              <p className="text-sm font-medium text-foreground">This matter is flagged at risk</p>
              <p className="text-sm text-muted-foreground">{matter.risk_notes || 'Contact your NPC coordinator for context.'}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview" className="gap-2"><FileText className="h-4 w-4" /> Overview</TabsTrigger>
          <TabsTrigger value="parties" className="gap-2"><Users className="h-4 w-4" /> Parties</TabsTrigger>
          <TabsTrigger value="dates" className="gap-2"><CalendarClock className="h-4 w-4" /> Dates</TabsTrigger>
          <TabsTrigger value="settlement" className="gap-2"><Route className="h-4 w-4" /> Settlement</TabsTrigger>
          <TabsTrigger value="docs" className="gap-2"><FileText className="h-4 w-4" /> Docs</TabsTrigger>
          <TabsTrigger value="searches" className="gap-2"><FileText className="h-4 w-4" /> Searches</TabsTrigger>
          <TabsTrigger value="costs" className="gap-2"><FileText className="h-4 w-4" /> Costs</TabsTrigger>
          <TabsTrigger value="messages" className="gap-2"><MessagesSquare className="h-4 w-4" /> Messages</TabsTrigger>
          <TabsTrigger value="intelligence" className="gap-2"><Sparkles className="h-4 w-4" /> Intelligence</TabsTrigger>
          <TabsTrigger value="compliance" className="gap-2"><ShieldCheck className="h-4 w-4" /> Compliance</TabsTrigger>
          <TabsTrigger value="notes" className="gap-2"><Contact className="h-4 w-4" /> Notes</TabsTrigger>
        </TabsList>

        {/* ─────────── MESSAGES ─────────── */}
        <TabsContent value="messages" className="mt-4 space-y-4">
          {matterId ? (
            <MatterCommunicationsPanel
              matterId={matterId}
              canEdit={!!perms.messages?.edit}
              onError={(message) => toast.error(message)}
            />
          ) : null}
        </TabsContent>



        {/* ─────────── OVERVIEW ─────────── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {import.meta.env.VITE_FINANCE_SOLICITOR_COLLABORATION === 'true' && matterId ? <MatterFinanceCoordinationPanel matterId={matterId} /> : null}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Matter details</CardTitle>
                <CardDescription>Core file information for this conveyance.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field label="Client">{matter.client_name || '—'}</Field>
                <Field label="Matter type">{MATTER_TYPE_LABELS[matter.matter_type]}</Field>
                <Field label="Reference">{matter.matter_reference || '—'}</Field>
                <Field label="Purchase price">{formatCurrency(matter.purchase_price)}</Field>
                <Field label="Deposit">{formatCurrency(matter.deposit_amount)}</Field>
                <Field label="Opened">{formatMatterDate(matter.opened_at)}</Field>

                <div className="sm:col-span-2"><Separator /></div>

                <div className="grid gap-2">
                  <Label htmlFor="title_reference">Title reference</Label>
                  <Input
                    id="title_reference"
                    value={(draft.title_reference as string) ?? ''}
                    onChange={(e) => patch('title_reference', e.target.value)}
                    disabled={!canEdit}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="lot_plan">Lot / plan</Label>
                  <Input
                    id="lot_plan"
                    value={(draft.lot_plan as string) ?? ''}
                    onChange={(e) => patch('lot_plan', e.target.value)}
                    disabled={!canEdit}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="pexa">PEXA workspace</Label>
                  <Input
                    id="pexa"
                    value={(draft.pexa_workspace_id as string) ?? ''}
                    onChange={(e) => patch('pexa_workspace_id', e.target.value)}
                    disabled={!canEdit}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="other_side">Other side's firm</Label>
                  <Input
                    id="other_side"
                    value={(draft.other_side_firm as string) ?? ''}
                    onChange={(e) => patch('other_side_firm', e.target.value)}
                    disabled={!canEdit}
                  />
                </div>

                {canEdit ? (
                  <div className="sm:col-span-2 flex justify-end">
                    <Button
                      size="sm"
                      disabled={saving}
                      onClick={() => void saveMatter(['title_reference', 'lot_plan', 'pexa_workspace_id', 'other_side_firm'])}
                    >
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Save details
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Landmark className="h-4 w-4 text-primary" aria-hidden /> Finance status
                  </CardTitle>
                  <CardDescription>Finance clause visibility only — no client financials.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {finance ? (
                    <>
                      <Field label="Finance file">{finance.title || '—'}</Field>
                      <Field label="Status">{String(finance.finance_status || '—').replace(/_/g, ' ')}</Field>
                      <Field label="Finance clause">{formatMatterDate(finance.finance_clause_date)}</Field>
                      <Field label="Lender">{finance.lender || '—'}</Field>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      No finance file is linked to this matter yet.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="h-4 w-4 text-primary" aria-hidden /> Status history
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-52 pr-3">
                    <ol className="space-y-3">
                      {history.map((h) => (
                        <li key={h.id} className="border-l-2 border-border pl-3">
                          <p className="text-sm font-medium text-foreground">
                            {h.from_status ? `${MATTER_STATUS_LABELS[h.from_status]} → ` : ''}
                            {MATTER_STATUS_LABELS[h.to_status]}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatMatterDate(h.created_at)} · {h.changed_by_type.replace(/_/g, ' ')}
                          </p>
                          {h.reason ? <p className="mt-1 text-xs text-muted-foreground">{h.reason}</p> : null}
                        </li>
                      ))}
                      {history.length === 0 ? (
                        <li className="text-sm text-muted-foreground">No status changes recorded.</li>
                      ) : null}
                    </ol>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─────────── PARTIES ─────────── */}
        <TabsContent value="parties" className="mt-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-base">Parties</CardTitle>
                <CardDescription>Everyone on the other side of this transaction.</CardDescription>
              </div>
              {canEditParties ? (
                <Button size="sm" onClick={() => setPartyDialog({ ...EMPTY_PARTY })}>
                  <Plus className="mr-2 h-4 w-4" /> Add party
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              {parties.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
                  No parties recorded yet.{canEditParties ? ' Add the selling agent and the other side\u2019s solicitor to start.' : ''}
                </div>
              ) : parties.map((p) => (
                <div key={p.id} className="flex flex-col gap-2 rounded-lg border border-border/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{p.name}</span>
                      <Badge variant="outline">{PARTY_ROLE_LABELS[p.role]}</Badge>
                      {p.is_primary_contact ? <Badge variant="secondary">Primary</Badge> : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {[p.organisation, p.email, p.phone].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canEditParties ? (
                      <Button
                        variant="outline" size="sm"
                        onClick={() => setPartyDialog({
                          id: p.id, role: p.role, name: p.name,
                          organisation: p.organisation ?? '', email: p.email ?? '',
                          phone: p.phone ?? '', reference: p.reference ?? '',
                          notes: p.notes ?? '', is_primary_contact: p.is_primary_contact,
                        })}
                      >
                        <Pencil className="h-4 w-4" aria-label={`Edit ${p.name}`} />
                      </Button>
                    ) : null}
                    {canDeleteParties ? (
                      <Button variant="ghost" size="sm" onClick={() => void removeParty(p.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" aria-label={`Remove ${p.name}`} />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─────────── DATES ─────────── */}
        <TabsContent value="dates" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contract dates</CardTitle>
              <CardDescription>
                These fields drive the synced entries in the critical date register below.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {DATE_FIELDS.map(({ key, label }) => {
                const countdown = countdownLabel(draft[key] as string | null);
                return (
                  <div key={String(key)} className="grid gap-2">
                    <Label htmlFor={String(key)}>{label}</Label>
                    <Input
                      id={String(key)}
                      type="date"
                      value={((draft[key] as string) ?? '').slice(0, 10)}
                      onChange={(e) => patch(key, e.target.value || null)}
                      disabled={!canEdit}
                    />
                    {countdown ? (
                      <p className={cn('text-xs', countdown.includes('overdue') ? 'text-destructive' : 'text-muted-foreground')}>
                        {countdown}
                      </p>
                    ) : null}
                  </div>
                );
              })}
              {canEdit ? (
                <div className="sm:col-span-2 flex justify-end">
                  <Button size="sm" disabled={saving} onClick={() => void saveMatter(DATE_FIELDS.map((d) => d.key))}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save dates
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {perms.critical_dates?.view === false ? null : (
            <CriticalDatesPanel
              dates={criticalDates}
              canEdit={!!perms.critical_dates?.edit}
              canDelete={!!perms.critical_dates?.delete}
              saving={datesSaving}
              onSave={saveCriticalDate}
              onSetStatus={setCriticalDateStatus}
              onDelete={deleteCriticalDate}
            />
          )}
        </TabsContent>

        {/* ─────────── SETTLEMENT ─────────── */}
        <TabsContent value="settlement" className="mt-4">
          <SettlementRunwayPanel
            tasks={runwayTasks}
            runway={runway}
            canEdit={!!perms.settlement?.edit}
            saving={datesSaving}
            seeding={seeding}
            onUpdateTask={updateRunwayTask}
            onQuickStatus={(taskId, status) => updateRunwayTask({
              id: taskId, status, due_date: '', blocked_reason: '', notes: '',
            }, true)}
            onSeed={seedRunway}
          />
        </TabsContent>

        {/* ─────────── CONTRACT INTELLIGENCE ─────────── */}
        {/* ─────────── COMPLIANCE ─────────── */}
        <TabsContent value="compliance" className="mt-4">
          {matterId ? (
            <MatterCompliancePanel
              matterId={matterId}
              matterReference={matter.matter_reference}
              canEdit={canEdit}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="intelligence" className="mt-4">
          <ContractIntelligencePanel
            matterId={matterId!}
            documents={documents}
            canEdit={perms.contract?.edit !== false}
            canDelete={!!perms.contract?.delete}
          />
        </TabsContent>



        {/* ─────────── DOCS ─────────── */}
        <TabsContent value="docs" className="mt-4 space-y-4">
          {registerSummary ? (
            <p className="text-sm text-muted-foreground">
              {registerSummary.documents_outstanding} outstanding · {registerSummary.documents_overdue} overdue
            </p>
          ) : null}
          <MatterDocumentsPanel
            documents={documents}
            canEdit={!!perms.documents?.edit}
            canDelete={!!perms.documents?.delete}
            saving={registerSaving}
            onSave={saveDocument}
            onSetStatus={setDocumentStatus}
            onUpload={uploadDocument}
            onDownload={downloadDocument}
            onDelete={deleteDocument}
            onSetAiPermission={setDocumentAiPermission}
          />
        </TabsContent>

        {/* ─────────── SEARCHES & REQUISITIONS ─────────── */}
        <TabsContent value="searches" className="mt-4 space-y-4">
          <MatterSearchesPanel
            searches={searches}
            canEdit={!!perms.searches?.edit}
            canDelete={!!perms.searches?.delete}
            saving={registerSaving}
            onSave={saveSearch}
            onSetStatus={setSearchStatus}
            onDelete={deleteSearch}
          />
          <MatterRequisitionsPanel
            requisitions={requisitions}
            canEdit={!!perms.searches?.edit}
            canDelete={!!perms.searches?.delete}
            saving={registerSaving}
            onSave={saveRequisition}
            onSetStatus={setRequisitionStatus}
            onDelete={deleteRequisition}
          />
        </TabsContent>

        {/* ─────────── COSTS ─────────── */}
        <TabsContent value="costs" className="mt-4">
          <MatterDisbursementsPanel
            disbursements={disbursements}
            canEdit={!!perms.disbursements?.edit}
            canDelete={!!perms.disbursements?.delete}
            saving={registerSaving}
            onSave={saveDisbursement}
            onDelete={deleteDisbursement}
          />
        </TabsContent>


        {/* ─────────── NOTES ─────────── */}
        <TabsContent value="notes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Notes</CardTitle>
              <CardDescription>
                The client summary is shared with NPC and the client. Practice notes never leave this portal.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="shared_summary">Client-facing summary</Label>
                <Textarea
                  id="shared_summary" rows={4}
                  value={(draft.shared_summary as string) ?? ''}
                  onChange={(e) => patch('shared_summary', e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="internal_notes">Practice-only notes</Label>
                <Textarea
                  id="internal_notes" rows={6}
                  value={(draft.internal_notes as string) ?? ''}
                  onChange={(e) => patch('internal_notes', e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              {canEdit ? (
                <div className="flex justify-end">
                  <Button size="sm" disabled={saving} onClick={() => void saveMatter(['shared_summary', 'internal_notes'])}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save notes
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Status dialog */}
      <Dialog open={statusDialog} onOpenChange={setStatusDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change matter status</DialogTitle>
            <DialogDescription>NPC and the client see this change in their portals.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="next_status">New status</Label>
              <Select value={nextStatus} onValueChange={(v) => setNextStatus(v as LegalMatterStatus)}>
                <SelectTrigger id="next_status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MATTER_STATUS_ORDER.map((s) => (
                    <SelectItem key={s} value={s}>{MATTER_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="status_reason">Reason (optional)</Label>
              <Textarea id="status_reason" rows={3} value={statusReason} onChange={(e) => setStatusReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialog(false)}>Cancel</Button>
            <Button onClick={() => void applyStatus()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Update status
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Party dialog */}
      <Dialog open={conflictDialog} onOpenChange={setConflictDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>This matter changed elsewhere</DialogTitle><DialogDescription>Your draft was not overwritten. Reload the latest version, review it, then apply your change again.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setConflictDialog(false)}>Keep reviewing draft</Button><Button onClick={async () => { setConflictDialog(false); await load(); }}>Reload latest matter</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!partyDialog} onOpenChange={(o) => !o && setPartyDialog(null)}>
        <DialogContent className="max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{partyDialog?.id ? 'Edit party' : 'Add party'}</DialogTitle>
            <DialogDescription>Record who you deal with on this matter.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="party_role">Role</Label>
                <Select
                  value={partyDialog?.role ?? 'other'}
                  onValueChange={(v) => setPartyDialog((p) => p && { ...p, role: v as LegalPartyRole })}
                >
                  <SelectTrigger id="party_role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PARTY_ROLE_LABELS) as LegalPartyRole[]).map((r) => (
                      <SelectItem key={r} value={r}>{PARTY_ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {([
                ['name', 'Name'], ['organisation', 'Organisation'], ['email', 'Email'],
                ['phone', 'Phone'], ['reference', 'Their reference'],
              ] as const).map(([key, label]) => (
                <div key={key} className="grid gap-2">
                  <Label htmlFor={`party_${key}`}>{label}</Label>
                  <Input
                    id={`party_${key}`}
                    value={(partyDialog?.[key] as string) ?? ''}
                    onChange={(e) => setPartyDialog((p) => p && { ...p, [key]: e.target.value })}
                  />
                </div>
              ))}
              <div className="grid gap-2">
                <Label htmlFor="party_notes">Notes</Label>
                <Textarea
                  id="party_notes" rows={3}
                  value={partyDialog?.notes ?? ''}
                  onChange={(e) => setPartyDialog((p) => p && { ...p, notes: e.target.value })}
                />
              </div>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartyDialog(null)}>Cancel</Button>
            <Button onClick={() => void saveParty()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save party
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SolicitorPortalShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{children}</p>
    </div>
  );
}
