/**
 * PdfImportRetentionPanel — Phase 11E.
 *
 * Dry-run retention dashboard: summary cards, permission-gated scan, filters,
 * candidate list + detail with review/approve/reject/block/supersede actions.
 * No physical cleanup is ever performed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, PlayCircle, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { usePdfImportPermissions } from '@/hooks/usePdfImportPermissions';
import {
  formatEstimatedBytes,
  listPdfImportRetentionEvents,
  runPdfImportRetentionScan,
  summarizePdfImportRetentionEvents,
  updatePdfImportRetentionEventStatus,
  type ListPdfImportRetentionEventsOptions,
  type PdfImportRetentionAction,
  type PdfImportRetentionEventRecord,
} from '@/lib/reportTemplate/ingestion/retention';
import { PdfImportRetentionCandidateList } from './PdfImportRetentionCandidateList';
import { PdfImportRetentionCandidateDetail } from './PdfImportRetentionCandidateDetail';

type StatusFilter = NonNullable<ListPdfImportRetentionEventsOptions['status']>;
type DecisionFilter = NonNullable<ListPdfImportRetentionEventsOptions['decision']>;
type DomainFilter = NonNullable<ListPdfImportRetentionEventsOptions['domain']>;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'candidate', label: 'Candidate' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'approved_for_future_cleanup', label: 'Approved (future)' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'all', label: 'All' },
];
const DECISION_FILTERS: { value: DecisionFilter; label: string }[] = [
  { value: 'all', label: 'All decisions' },
  { value: 'delete_candidate', label: 'Delete candidate' },
  { value: 'archive_candidate', label: 'Archive candidate' },
  { value: 'review', label: 'Review' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'retain', label: 'Retain' },
];
const DOMAIN_FILTERS: { value: DomainFilter; label: string }[] = [
  { value: 'all', label: 'All domains' },
  { value: 'storage_orphan', label: 'Storage orphan' },
  { value: 'metadata_reference', label: 'Metadata reference' },
  { value: 'visual_quality', label: 'Visual quality' },
  { value: 'visual_repair', label: 'Visual repair' },
  { value: 'export_parity', label: 'Export parity' },
  { value: 'diagnostics', label: 'Diagnostics' },
  { value: 'monitoring_events', label: 'Monitoring events' },
  { value: 'phase10_metadata', label: 'Phase 10 metadata' },
  { value: 'source_pdf', label: 'Source PDF' },
];

export function PdfImportRetentionPanel() {
  const { allows } = usePdfImportPermissions();
  const canView = allows('pdf_import.view_retention');
  const canScan = allows('pdf_import.run_retention_scan');
  const canManage = allows('pdf_import.manage_retention_candidates');

  const [events, setEvents] = useState<PdfImportRetentionEventRecord[]>([]);
  const [status, setStatus] = useState<StatusFilter>('active');
  const [decision, setDecision] = useState<DecisionFilter>('all');
  const [domain, setDomain] = useState<DomainFilter>('all');
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => events.find((e) => e.id === selectedId) ?? null, [events, selectedId]);
  const summary = useMemo(() => summarizePdfImportRetentionEvents(events), [events]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    const res = await listPdfImportRetentionEvents({ status, decision, domain, limit: 500 });
    setLoading(false);
    if (res.kind === 'error') { toast.error(`Failed to load candidates: ${res.message}`); return; }
    setEvents(res.events);
  }, [canView, status, decision, domain]);

  useEffect(() => { void load(); }, [load]);

  const runScan = useCallback(async () => {
    if (!canScan) return;
    setScanning(true);
    const res = await runPdfImportRetentionScan();
    setScanning(false);
    if (res.kind === 'error') { toast.error(`Scan failed: ${res.message}`); return; }
    toast.success(`Dry-run scan complete — ${res.persistedCount} candidate(s) recorded. No cleanup performed.`);
    void load();
  }, [canScan, load]);

  const act = useCallback(
    (action: PdfImportRetentionAction) => async (event: PdfImportRetentionEventRecord) => {
      if (!canManage) return;
      setBusyId(event.id);
      const res = await updatePdfImportRetentionEventStatus({ eventId: event.id, action });
      setBusyId(null);
      if (res.kind === 'error') { toast.error(`Action failed: ${res.message}`); return; }
      toast.success('Candidate updated.');
      void load();
    },
    [canManage, load],
  );

  if (!canView) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          Your role does not allow viewing PDF import retention. This requires the
          <code className="mx-1">pdf_import.view_retention</code> capability.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {([
          ['Total', String(summary.total)],
          ['Review', String(summary.review)],
          ['Archive', String(summary.archiveCandidates)],
          ['Delete', String(summary.deleteCandidates)],
          ['Blocked', String(summary.blocked)],
          ['Est. recoverable', formatEstimatedBytes(summary.estimatedRecoverableBytes)],
        ] as [string, string][]).map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-muted-foreground">{label}</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0 text-xl font-semibold tabular-nums">{value}</CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUS_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={decision} onValueChange={(v) => setDecision(v as DecisionFilter)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{DECISION_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={domain} onValueChange={(v) => setDomain(v as DomainFilter)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{DOMAIN_FILTERS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}<span className="ml-1">Refresh</span>
          </Button>
        </div>
        <Button size="sm" onClick={() => void runScan()} disabled={!canScan || scanning} title={!canScan ? 'Requires run_retention_scan' : undefined}>
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}<span className="ml-1">Run retention scan (dry-run)</span>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PdfImportRetentionCandidateList events={events} selectedEventId={selectedId} onSelect={(e) => setSelectedId(e.id)} />
        <PdfImportRetentionCandidateDetail
          event={selected}
          canManage={canManage}
          busy={busyId === selected?.id}
          onReview={act('review')}
          onApproveForFutureCleanup={act('approve_for_future_cleanup')}
          onReject={act('reject')}
          onBlock={act('block')}
          onSupersede={act('supersede')}
        />
      </div>
    </div>
  );
}

export default PdfImportRetentionPanel;
