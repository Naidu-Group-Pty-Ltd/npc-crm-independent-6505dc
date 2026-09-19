/**
 * PdfImportAlertEventList — Phase 11C.
 *
 * Presentational list of durable monitoring alert events. Emits selection; all
 * lifecycle actions live in the detail panel. Shows only safe metadata.
 */
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getMonitoringDomainLabel,
  getMonitoringSeverityLabel,
  getMonitoringSeverityTone,
  getMonitoringStatusLabel,
  getMonitoringStatusTone,
  type MonitoringEvent,
} from '@/lib/reportTemplate/ingestion/monitoring';

interface Props {
  events: MonitoringEvent[];
  selectedId: string | null;
  onSelect: (event: MonitoringEvent) => void;
}

export function PdfImportAlertEventList({ events, selectedId, onSelect }: Props) {
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        No alert events for the current filter.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Severity</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Alert</TableHead>
            <TableHead>Domain</TableHead>
            <TableHead className="text-right">Count</TableHead>
            <TableHead>Last seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <TableRow
              key={event.id}
              data-state={event.id === selectedId ? 'selected' : undefined}
              className="cursor-pointer"
              onClick={() => onSelect(event)}
            >
              <TableCell>
                <Badge variant={getMonitoringSeverityTone(event.severity)}>
                  {getMonitoringSeverityLabel(event.severity)}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={getMonitoringStatusTone(event.status)}>
                  {getMonitoringStatusLabel(event.status)}
                </Badge>
              </TableCell>
              <TableCell className="max-w-[24rem]">
                <div className="font-medium">{event.title}</div>
                <div className="truncate text-xs text-muted-foreground">{event.summary}</div>
              </TableCell>
              <TableCell className="text-sm">{getMonitoringDomainLabel(event.domain)}</TableCell>
              <TableCell className="text-right tabular-nums">{event.occurrenceCount}</TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {event.lastSeenAt ? new Date(event.lastSeenAt).toLocaleString('en-AU') : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default PdfImportAlertEventList;
