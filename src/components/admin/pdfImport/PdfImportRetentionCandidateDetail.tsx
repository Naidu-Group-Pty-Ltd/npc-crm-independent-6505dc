/**
 * PdfImportRetentionCandidateDetail — Phase 11E.
 *
 * Detail + permission-gated lifecycle actions for a retention candidate. DRY-RUN
 * ONLY: there is NO "delete now" / "archive now" / "cleanup now" button. Actions
 * only change review/approval/rejection/block/supersede state.
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  event: PdfImportRetentionEventRecord | null;
  canManage: boolean;
  busy: boolean;
  onReview: (e: PdfImportRetentionEventRecord) => void;
  onApproveForFutureCleanup: (e: PdfImportRetentionEventRecord) => void;
  onReject: (e: PdfImportRetentionEventRecord) => void;
  onBlock: (e: PdfImportRetentionEventRecord) => void;
  onSupersede: (e: PdfImportRetentionEventRecord) => void;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function PdfImportRetentionCandidateDetail({
  event, canManage, busy, onReview, onApproveForFutureCleanup, onReject, onBlock, onSupersede,
}: Props) {
  if (!event) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Select a candidate to view details and available review actions.
        </CardContent>
      </Card>
    );
  }

  const isClosed = event.status === 'rejected' || event.status === 'completed' || event.status === 'superseded';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={getPdfImportRetentionDecisionTone(event.decision)}>{getPdfImportRetentionDecisionLabel(event.decision)}</Badge>
          <Badge variant={getPdfImportRetentionSafetyTone(event.safetyLevel)}>{getPdfImportRetentionSafetyLabel(event.safetyLevel)}</Badge>
          <Badge variant={getPdfImportRetentionStatusTone(event.status)}>{getPdfImportRetentionStatusLabel(event.status)}</Badge>
        </div>
        <CardTitle className="mt-2 text-base">{event.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{event.message}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border p-3">
          <Row label="Rule" value={<code className="text-xs">{event.retentionRuleId}</code>} />
          <Row label="Domain" value={getPdfImportRetentionDomainLabel(event.domain)} />
          <Row label="Cleanup action" value={getPdfImportCleanupActionLabel(event.cleanupAction)} />
          <Row label="Scope" value={<code className="text-xs">{event.scope.type}:{event.scope.label ?? event.scope.id}</code>} />
          {event.storageBucket && <Row label="Storage bucket" value={<code className="text-xs">{event.storageBucket}</code>} />}
          {event.storageObjectPath && <Row label="Object path" value={<code className="text-xs break-all">{event.storageObjectPath}</code>} />}
          {event.importId && <Row label="Import" value={<code className="text-xs">{event.importId}</code>} />}
          {event.templateId && <Row label="Template" value={<code className="text-xs">{event.templateId}</code>} />}
          <Row label="Estimated bytes" value={formatEstimatedBytes(event.estimatedBytes)} />
          {event.objectCreatedAt && <Row label="Object created" value={new Date(event.objectCreatedAt).toLocaleString('en-AU')} />}
          {event.objectUpdatedAt && <Row label="Object updated" value={new Date(event.objectUpdatedAt).toLocaleString('en-AU')} />}
          <Row label="Occurrences" value={event.occurrenceCount} />
          <Row label="Recommended" value={<span className="text-xs">{event.recommendedAction}</span>} />
        </div>

        {event.evidence.length > 0 && (
          <div className="rounded-md border p-3 text-sm">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Evidence</div>
            <ul className="space-y-1">
              {event.evidence.map((ev, i) => (
                <li key={i} className="text-xs"><code>{ev.code}</code>: {String(ev.value ?? '')} — {ev.message}</li>
              ))}
            </ul>
          </div>
        )}

        {(event.reviewNote || event.approvalNote || event.rejectionNote || event.blockNote) && (
          <div className="rounded-md border bg-muted/40 p-3 text-xs">
            {event.reviewNote && <div>Review: {event.reviewNote}</div>}
            {event.approvalNote && <div>Approval: {event.approvalNote}</div>}
            {event.rejectionNote && <div>Rejection: {event.rejectionNote}</div>}
            {event.blockNote && <div>Block: {event.blockNote}</div>}
          </div>
        )}

        {!canManage ? (
          <p className="text-xs text-muted-foreground">
            Your role does not allow managing retention candidates. Actions require the
            <code className="mx-1">pdf_import.manage_retention_candidates</code> capability.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="default" disabled={busy || event.status !== 'candidate'} onClick={() => onReview(event)}>Review</Button>
            <Button size="sm" variant="outline" disabled={busy || isClosed} onClick={() => onApproveForFutureCleanup(event)} title="Marks the candidate approved for a FUTURE cleanup phase — performs no deletion now.">Approve for future cleanup</Button>
            <Button size="sm" variant="outline" disabled={busy || isClosed} onClick={() => onReject(event)}>Reject cleanup</Button>
            <Button size="sm" variant="secondary" disabled={busy || isClosed} onClick={() => onBlock(event)}>Block cleanup</Button>
            <Button size="sm" variant="outline" disabled={busy || isClosed} onClick={() => onSupersede(event)}>Supersede</Button>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          Dry-run only — no files or rows are deleted, archived, or compacted in this phase.
        </p>
      </CardContent>
    </Card>
  );
}

export default PdfImportRetentionCandidateDetail;
