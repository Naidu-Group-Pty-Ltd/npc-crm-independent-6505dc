/**
 * PdfImportRetentionCandidateList — Phase 11E.
 *
 * Presentational list of dry-run retention candidates. No cleanup actions here.
 */
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  formatEstimatedBytes,
  getPdfImportCleanupActionLabel,
  getPdfImportRetentionDecisionLabel,
  getPdfImportRetentionDecisionTone,
  getPdfImportRetentionDomainLabel,
  getPdfImportRetentionSafetyLabel,
  getPdfImportRetentionSafetyTone,
  getPdfImportRetentionStatusLabel,
  getPdfImportRetentionStatusTone,
  type PdfImportRetentionEventRecord,
} from '@/lib/reportTemplate/ingestion/retention';

interface Props {
  events: PdfImportRetentionEventRecord[];
  selectedEventId: string | null;
  onSelect: (event: PdfImportRetentionEventRecord) => void;
}

export function PdfImportRetentionCandidateList({ events, selectedEventId, onSelect }: Props) {
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        No retention candidates for the current filter. Run a scan to generate dry-run candidates.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Decision</TableHead>
            <TableHead>Cleanup action</TableHead>
            <TableHead>Safety</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Domain</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead className="text-right">Est. bytes</TableHead>
            <TableHead className="text-right">Count</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e) => (
            <TableRow
              key={e.id}
              data-state={e.id === selectedEventId ? 'selected' : undefined}
              className="cursor-pointer"
              onClick={() => onSelect(e)}
            >
              <TableCell><Badge variant={getPdfImportRetentionDecisionTone(e.decision)}>{getPdfImportRetentionDecisionLabel(e.decision)}</Badge></TableCell>
              <TableCell className="text-xs">{getPdfImportCleanupActionLabel(e.cleanupAction)}</TableCell>
              <TableCell><Badge variant={getPdfImportRetentionSafetyTone(e.safetyLevel)}>{getPdfImportRetentionSafetyLabel(e.safetyLevel)}</Badge></TableCell>
              <TableCell><Badge variant={getPdfImportRetentionStatusTone(e.status)}>{getPdfImportRetentionStatusLabel(e.status)}</Badge></TableCell>
              <TableCell className="text-xs">{getPdfImportRetentionDomainLabel(e.domain)}</TableCell>
              <TableCell className="max-w-[16rem] truncate text-xs text-muted-foreground" title={e.scope.label ?? e.scope.id}>{e.scope.label ?? e.scope.id}</TableCell>
              <TableCell className="text-right tabular-nums text-xs">{formatEstimatedBytes(e.estimatedBytes)}</TableCell>
              <TableCell className="text-right tabular-nums text-xs">{e.occurrenceCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default PdfImportRetentionCandidateList;
