/**
 * PdfImportClientReports — Phase 11G admin page.
 *
 * Generate, review, approve, reject, and mark-exported client-safe report
 * summaries. Redaction-first + approval-gated + permission-gated + audit-backed.
 * No AI, no template mutation, no email, no public links, no PDF binary export.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OperatorPermissionStatusPanel } from '@/components/admin/pdfImport/OperatorPermissionStatusPanel';
import { PdfImportClientReportPanel } from '@/components/admin/pdfImport/PdfImportClientReportPanel';
import { PdfImportClientReportPreview } from '@/components/admin/pdfImport/PdfImportClientReportPreview';
import { PdfImportClientReportList } from '@/components/admin/pdfImport/PdfImportClientReportList';
import { PdfImportClientReportDetail } from '@/components/admin/pdfImport/PdfImportClientReportDetail';
import { usePdfImportPermissions } from '@/hooks/usePdfImportPermissions';
import {
  generatePdfImportClientReportPreview,
  listPdfImportClientReports,
  savePdfImportClientReportDraft,
  summarizePdfImportClientReports,
  updatePdfImportClientReportStatus,
  type BuildPdfImportClientReportOptions,
  type ListPdfImportClientReportsOptions,
  type PdfImportClientReportPayload,
  type PdfImportClientReportRecord,
} from '@/lib/reportTemplate/ingestion/clientReports';

type StatusFilter = NonNullable<ListPdfImportClientReportsOptions['status']>;

const STATUS_FILTERS: StatusFilter[] = ['all', 'draft', 'pending_review', 'approved', 'exported', 'rejected', 'superseded'];

export default function PdfImportClientReports() {
  const { resolvedRole, allows } = usePdfImportPermissions();
  const canView = allows('pdf_import.view_client_reports');
  const canGenerate = allows('pdf_import.generate_client_report_preview');
  const canSave = allows('pdf_import.save_client_report_draft');
  const canApprove = allows('pdf_import.approve_client_report');
  const canExport = allows('pdf_import.export_client_report');

  const [preview, setPreview] = useState<PdfImportClientReportPayload | null>(null);
  const [reports, setReports] = useState<PdfImportClientReportRecord[]>([]);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => reports.find((r) => r.id === selectedId) ?? null, [reports, selectedId]);
  const summary = useMemo(() => summarizePdfImportClientReports(reports), [reports]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    const res = await listPdfImportClientReports({ status, limit: 200 });
    setLoading(false);
    if (res.kind === 'error') { toast.error(`Failed to load reports: ${res.message}`); return; }
    setReports(res.reports);
  }, [canView, status]);

  useEffect(() => { void load(); }, [load]);

  const onGeneratePreview = useCallback(async (options: BuildPdfImportClientReportOptions) => {
    if (!canGenerate) return;
    setGenerating(true);
    const res = await generatePdfImportClientReportPreview(options);
    setGenerating(false);
    if (res.kind === 'error') { toast.error(`Preview failed: ${res.message}`); return; }
    setPreview(res.report);
    if (res.report.safetyLevel === 'blocked' || res.report.safetyLevel === 'internal_only') {
      toast.warning(`Report safety: ${res.report.safetyLevel} — not for external sharing.`);
    }
  }, [canGenerate]);

  const onSaveDraft = useCallback(async () => {
    if (!canSave || !preview) return;
    setSaving(true);
    const res = await savePdfImportClientReportDraft(preview);
    setSaving(false);
    if (res.kind === 'error') { toast.error(`Save failed: ${res.message}`); return; }
    toast.success('Draft saved.');
    void load();
  }, [canSave, preview, load]);

  const act = useCallback(
    (action: 'approve' | 'reject' | 'mark_exported' | 'supersede') => async (report: PdfImportClientReportRecord) => {
      setBusyId(report.id);
      const res = await updatePdfImportClientReportStatus({
        reportId: report.id,
        action,
        exportFormat: action === 'mark_exported' ? 'markdown' : undefined,
      });
      setBusyId(null);
      if (res.kind === 'error') { toast.error(`Action failed: ${res.message}`); return; }
      toast.success(`Report ${action.replace('_', ' ')}d.`);
      void load();
    },
    [load],
  );

  if (!canView) {
    return (
      <DashboardThemeFrame as="main" variant="page" className="min-w-0 space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Your role does not allow viewing PDF import client reports. This requires the
            <code className="mx-1">pdf_import.view_client_reports</code> capability.
          </CardContent>
        </Card>
      </DashboardThemeFrame>
    );
  }

  return (
    <DashboardThemeFrame as="main" variant="page" className="min-w-0 space-y-6 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><FileText className="h-5 w-5" />PDF Import Client Reports</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Generate sanitized, approval-gated client-safe summaries. No raw PDFs, screenshots, signed
            URLs, storage paths, or logs are ever included. No email or public links are created.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Client-report safety is validated as part of the final rollout lock:{' '}
            <code>docs/pdf-import/phase-11h-final-production-rollout-lock.md</code>
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/pdf-import-monitoring"><Activity className="mr-1 h-4 w-4" />Monitoring</Link>
        </Button>
      </div>

      <OperatorPermissionStatusPanel resolvedRole={resolvedRole} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {([
          ['Total', summary.total], ['Draft', summary.draft], ['Pending', summary.pendingReview],
          ['Approved', summary.approved], ['Exported', summary.exported], ['Blocked', summary.blocked],
        ] as [string, number][]).map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-muted-foreground">{label}</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0 text-xl font-semibold tabular-nums">{value}</CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <PdfImportClientReportPanel
            canGenerate={canGenerate}
            canSave={canSave}
            generating={generating}
            saving={saving}
            hasPreview={!!preview}
            onGeneratePreview={onGeneratePreview}
            onSaveDraft={onSaveDraft}
          />
          <PdfImportClientReportPreview payload={preview} />
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUS_FILTERS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>Refresh</Button>
          </div>
          <PdfImportClientReportList reports={reports} selectedReportId={selectedId} onSelect={(r) => setSelectedId(r.id)} />
          <PdfImportClientReportDetail
            report={selected}
            canApprove={canApprove}
            canReject={canApprove}
            canMarkExported={canExport}
            busy={busyId === selected?.id}
            onApprove={act('approve')}
            onReject={act('reject')}
            onMarkExported={act('mark_exported')}
            onSupersede={act('supersede')}
          />
        </div>
      </div>
    </DashboardThemeFrame>
  );
}
