/**
 * PdfImportClientReportList — Phase 11G. Presentational list of report records.
 */
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  getPdfImportClientReportAudienceLabel,
  getPdfImportClientReportSafetyLabel,
  getPdfImportClientReportSafetyTone,
  getPdfImportClientReportStatusLabel,
  getPdfImportClientReportStatusTone,
  getPdfImportClientReportTypeLabel,
  type PdfImportClientReportRecord,
} from '@/lib/reportTemplate/ingestion/clientReports';

interface Props {
  reports: PdfImportClientReportRecord[];
  selectedReportId: string | null;
  onSelect: (report: PdfImportClientReportRecord) => void;
}

export function PdfImportClientReportList({ reports, selectedReportId, onSelect }: Props) {
  if (reports.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        No client reports for the current filter.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Audience</TableHead>
            <TableHead>Safety</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Generated</TableHead>
            <TableHead>Approved / Exported</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reports.map((r) => (
            <TableRow key={r.id} data-state={r.id === selectedReportId ? 'selected' : undefined} className="cursor-pointer" onClick={() => onSelect(r)}>
              <TableCell className="text-sm">
                <div className="font-medium">{getPdfImportClientReportTypeLabel(r.reportType)}</div>
                <div className="truncate text-xs text-muted-foreground max-w-[16rem]">{r.title}</div>
              </TableCell>
              <TableCell className="text-xs">{getPdfImportClientReportAudienceLabel(r.audience)}</TableCell>
              <TableCell><Badge variant={getPdfImportClientReportSafetyTone(r.safetyLevel)}>{getPdfImportClientReportSafetyLabel(r.safetyLevel)}</Badge></TableCell>
              <TableCell><Badge variant={getPdfImportClientReportStatusTone(r.status)}>{getPdfImportClientReportStatusLabel(r.status)}</Badge></TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{r.generatedAt ? new Date(r.generatedAt).toLocaleString('en-AU') : '—'}</TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {r.approvedAt ? new Date(r.approvedAt).toLocaleDateString('en-AU') : '—'}
                {r.exportedAt ? ` / ${new Date(r.exportedAt).toLocaleDateString('en-AU')}` : ''}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default PdfImportClientReportList;
