/**
 * PdfImportAlertEventDetail — Phase 11C.
 *
 * Detail + permission-gated lifecycle actions for a single alert event.
 * Lifecycle actions (acknowledge / resolve / suppress / mark false positive)
 * require the `pdf_import.manage_monitoring_alerts` capability. This layer is
 * NON-remediating — it never repairs, retries, reruns, or reconciles anything.
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getMonitoringDomainLabel,
  getMonitoringOwnerLabel,
  getMonitoringSeverityLabel,
  getMonitoringSeverityTone,
  getMonitoringStatusLabel,
  getMonitoringStatusTone,
  type MonitoringEvent,
  type MonitoringEventLifecycleAction,
} from '@/lib/reportTemplate/ingestion/monitoring';

interface Props {
  event: MonitoringEvent | null;
  canManage: boolean;
  busy: boolean;
  onAction: (action: MonitoringEventLifecycleAction, event: MonitoringEvent) => void;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function PdfImportAlertEventDetail({ event, canManage, busy, onAction }: Props) {
  const [showSuppress, setShowSuppress] = useState(false);

  if (!event) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Select an alert to view details and available actions.
        </CardContent>
      </Card>
    );
  }

  const isActive = event.status === 'open' || event.status === 'acknowledged';
  const canAcknowledge = canManage && event.status === 'open';
  const canResolve = canManage && event.status !== 'resolved' && event.status !== 'false_positive';
  const canSuppress = canManage && isActive;
  const canFalsePositive = canManage && event.status !== 'false_positive';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={getMonitoringSeverityTone(event.severity)}>
            {getMonitoringSeverityLabel(event.severity)}
          </Badge>
          <Badge variant={getMonitoringStatusTone(event.status)}>
            {getMonitoringStatusLabel(event.status)}
          </Badge>
          {event.releaseBlocking && <Badge variant="destructive">Release-blocking</Badge>}
        </div>
        <CardTitle className="mt-2 text-base">{event.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{event.summary}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border p-3">
          <Row label="Rule" value={<code className="text-xs">{event.ruleId}</code>} />
          <Row label="Domain" value={getMonitoringDomainLabel(event.domain)} />
          <Row label="Owner" value={getMonitoringOwnerLabel(event.owner)} />
          <Row label="Metric / threshold" value={`${event.metricValue ?? '—'} / ${event.threshold ?? '—'}`} />
          <Row label="Occurrences" value={event.occurrenceCount} />
          <Row label="First seen" value={event.firstSeenAt ? new Date(event.firstSeenAt).toLocaleString('en-AU') : '—'} />
          <Row label="Last seen" value={event.lastSeenAt ? new Date(event.lastSeenAt).toLocaleString('en-AU') : '—'} />
          {event.acknowledgedAt && <Row label="Acknowledged" value={new Date(event.acknowledgedAt).toLocaleString('en-AU')} />}
          {event.resolvedAt && <Row label="Resolved" value={new Date(event.resolvedAt).toLocaleString('en-AU')} />}
          {event.suppressedUntil && <Row label="Suppressed until" value={new Date(event.suppressedUntil).toLocaleString('en-AU')} />}
          <Row label="Runbook" value={<code className="text-xs">{event.runbookAnchor}</code>} />
        </div>

        {event.note && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <span className="text-muted-foreground">Note: </span>
            {event.note}
          </div>
        )}

        {!canManage ? (
          <p className="text-xs text-muted-foreground">
            Your role does not allow managing monitoring alerts. Actions require the
            <code className="mx-1">pdf_import.manage_monitoring_alerts</code>
            capability (pdf_admin / developer_admin).
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="default" disabled={!canAcknowledge || busy} onClick={() => onAction('acknowledge', event)}>
              Acknowledge
            </Button>
            <Button size="sm" variant="outline" disabled={!canResolve || busy} onClick={() => onAction('resolve', event)}>
              Resolve
            </Button>
            <Button size="sm" variant="outline" disabled={!canSuppress || busy} onClick={() => setShowSuppress((v) => !v)}>
              Suppress…
            </Button>
            <Button size="sm" variant="secondary" disabled={!canFalsePositive || busy} onClick={() => onAction('mark_false_positive', event)}>
              False positive
            </Button>
          </div>
        )}

        {canManage && showSuppress && canSuppress && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
            <span className="text-sm text-muted-foreground">Suppress this alert:</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction('suppress', event)}>
              Indefinitely
            </Button>
            <span className="text-xs text-muted-foreground">
              (Suppressed alerts stay muted but continue to record recurrences.)
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default PdfImportAlertEventDetail;
