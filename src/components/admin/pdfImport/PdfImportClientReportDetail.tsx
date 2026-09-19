/**
 * PdfImportClientReportDetail — Phase 11G.
 *
 * Detail + permission-gated lifecycle actions for a client report. There is NO
 * "send email", NO "public link", and NO PDF download button (PDF export is
 * deferred in Phase 11G). Export marking records that an approved report was
 * exported/copied — it performs no external delivery.
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PdfImportClientReportPreview } from './PdfImportClientReportPreview';
import {
  getPdfImportClientReportSafetyLabel,
  getPdfImportClientReportSafetyTone,
  getPdfImportClientReportStatusLabel,
  getPdfImportClientReportStatusTone,
  type PdfImportClientReportRecord,
} from '@/lib/reportTemplate/ingestion/clientReports';

interface Props {
  report: PdfImportClientReportRecord | null;
  canApprove: boolean;
  canReject: boolean;
  canMarkExported: boolean;
  busy?: boolean;
  onApprove: (r: PdfImportClientReportRecord) => void;
  onReject: (r: PdfImportClientReportRecord) => void;
  onMarkExported: (r: PdfImportClientReportRecord) => void;
  onSupersede: (r: PdfImportClientReportRecord) => void;
}

export function PdfImportClientReportDetail({
  report, canApprove, canReject, canMarkExported, busy, onApprove, onReject, onMarkExported, onSupersede,
}: Props) {
  if (!report) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Select a report to view its details and available actions.
        </CardContent>
      </Card>
    );
  }

  const exportable = report.status === 'approved' && (report.safetyLevel === 'safe' || report.safetyLevel === 'safe_with_warnings');
  const approvable = (report.status === 'draft' || report.status === 'pending_review') &&
    report.safetyLevel !== 'blocked' && report.safetyLevel !== 'internal_only';
  const closed = report.status === 'rejected' || report.status === 'superseded';

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={getPdfImportClientReportSafetyTone(report.safetyLevel)}>{getPdfImportClientReportSafetyLabel(report.safetyLevel)}</Badge>
            <Badge variant={getPdfImportClientReportStatusTone(report.status)}>{getPdfImportClientReportStatusLabel(report.status)}</Badge>
            {report.exportFormat && <Badge variant="outline">Exported: {report.exportFormat}</Badge>}
          </div>
          <CardTitle className="mt-2 text-base">{report.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(report.reviewNote || report.approvalNote || report.rejectionNote) && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs">
              {report.reviewNote && <div>Review: {report.reviewNote}</div>}
              {report.approvalNote && <div>Approval: {report.approvalNote}</div>}
              {report.rejectionNote && <div>Rejection: {report.rejectionNote}</div>}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="default" disabled={!canApprove || !approvable || busy} onClick={() => onApprove(report)}>Approve</Button>
            <Button size="sm" variant="outline" disabled={!canReject || closed || busy} onClick={() => onReject(report)}>Reject</Button>
            <Button size="sm" variant="outline" disabled={!canMarkExported || !exportable || busy} onClick={() => onMarkExported(report)} title="Records that this approved report was exported/copied. No external delivery.">Mark exported</Button>
            <Button size="sm" variant="secondary" disabled={closed || busy} onClick={() => onSupersede(report)}>Supersede</Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            No email is sent and no public link is created. PDF export is deferred in Phase 11G.
          </p>
        </CardContent>
      </Card>

      <PdfImportClientReportPreview payload={report} />
    </div>
  );
}

export default PdfImportClientReportDetail;
