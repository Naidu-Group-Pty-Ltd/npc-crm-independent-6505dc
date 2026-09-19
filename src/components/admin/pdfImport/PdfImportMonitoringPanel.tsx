/**
 * PdfImportMonitoringPanel — Phase 11C.
 *
 * Durable monitoring + alerting dashboard for the PDF import pipeline. Loads
 * persisted alert events via the secure `pdf-import-monitoring` edge function,
 * shows a severity/status-aware rollup, and provides permission-gated lifecycle
 * actions. Viewing requires `pdf_import.view_monitoring`; running a check and
 * managing alerts require `pdf_import.manage_monitoring_alerts`. NON-remediating.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, PlayCircle, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { usePdfImportPermissions } from '@/hooks/usePdfImportPermissions';
import {
  acknowledgeMonitoringEvent,
  getMonitoringHealthLabel,
  getMonitoringHealthTone,
  listMonitoringEvents,
  markMonitoringEventFalsePositive,
  resolveMonitoringEvent,
  runMonitoringCheck,
  suppressMonitoringEvent,
  type ListMonitoringEventsOptions,
  type MonitoringEvent,
  type MonitoringEventLifecycleAction,
  type MonitoringHealthRollup,
} from '@/lib/reportTemplate/ingestion/monitoring';
import { PdfImportAlertEventList } from './PdfImportAlertEventList';
import { PdfImportAlertEventDetail } from './PdfImportAlertEventDetail';

type StatusFilter = NonNullable<ListMonitoringEventsOptions['status']>;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Active (open + acknowledged)' },
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'suppressed', label: 'Suppressed' },
  { value: 'false_positive', label: 'False positive' },
  { value: 'all', label: 'All' },
];

function RollupCards({ rollup }: { rollup: MonitoringHealthRollup | null }) {
  if (!rollup) return null;
  const c = rollup.counts;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Card>
        <CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-muted-foreground">Health</CardTitle></CardHeader>
        <CardContent className="p-3 pt-0">
          <Badge variant={getMonitoringHealthTone(rollup.status)}>{getMonitoringHealthLabel(rollup.status)}</Badge>
        </CardContent>
      </Card>
      {([
        ['Active', c.active],
        ['Critical', c.critical],
        ['High', c.high],
        ['Warning', c.warning],
        ['Resolved', c.resolved],
      ] as [string, number][]).map(([label, value]) => (
        <Card key={label}>
          <CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-muted-foreground">{label}</CardTitle></CardHeader>
          <CardContent className="p-3 pt-0 text-2xl font-semibold tabular-nums">{value}</CardContent>
        </Card>
      ))}
    </div>
  );
}

export function PdfImportMonitoringPanel() {
  const { allows } = usePdfImportPermissions();
  const canView = allows('pdf_import.view_monitoring');
  const canManage = allows('pdf_import.manage_monitoring_alerts');

  const [events, setEvents] = useState<MonitoringEvent[]>([]);
  const [rollup, setRollup] = useState<MonitoringHealthRollup | null>(null);
  const [status, setStatus] = useState<StatusFilter>('active');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(
    () => events.find((e) => e.id === selectedId) ?? null,
    [events, selectedId],
  );

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    const result = await listMonitoringEvents({ status, limit: 200 });
    setLoading(false);
    if (result.kind === 'error') {
      toast.error(`Failed to load alerts: ${result.message}`);
      return;
    }
    setEvents(result.value.events);
    setRollup(result.value.rollup);
  }, [canView, status]);

  useEffect(() => { void load(); }, [load]);

  const runCheck = useCallback(async () => {
    if (!canManage) return;
    setChecking(true);
    const result = await runMonitoringCheck();
    setChecking(false);
    if (result.kind === 'error') {
      toast.error(`Check failed: ${result.message}`);
      return;
    }
    toast.success(
      `Check complete — ${result.value.inserted} new, ${result.value.updated} updated, ${result.value.autoResolved} auto-resolved.`,
    );
    void load();
  }, [canManage, load]);

  const handleAction = useCallback(
    async (action: MonitoringEventLifecycleAction, event: MonitoringEvent) => {
      if (!canManage) return;
      setBusyId(event.id);
      const run = () => {
        switch (action) {
          case 'acknowledge': return acknowledgeMonitoringEvent(event.id);
          case 'resolve': return resolveMonitoringEvent(event.id);
          case 'suppress': return suppressMonitoringEvent(event.id, null);
          case 'mark_false_positive': return markMonitoringEventFalsePositive(event.id);
        }
      };
      const result = await run();
      setBusyId(null);
      if (result.kind === 'error') {
        toast.error(`Action failed: ${result.message}`);
        return;
      }
      toast.success(`Alert ${action.replace(/_/g, ' ')}d.`);
      void load();
    },
    [canManage, load],
  );

  if (!canView) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          Your role does not allow viewing PDF import monitoring. This requires the
          <code className="mx-1">pdf_import.view_monitoring</code> capability.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-1">Refresh</span>
          </Button>
        </div>
        <Button size="sm" onClick={() => void runCheck()} disabled={!canManage || checking} title={!canManage ? 'Requires manage_monitoring_alerts' : undefined}>
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          <span className="ml-1">Run monitoring check</span>
        </Button>
      </div>

      <RollupCards rollup={rollup} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PdfImportAlertEventList
          events={events}
          selectedId={selectedId}
          onSelect={(e) => setSelectedId(e.id)}
        />
        <PdfImportAlertEventDetail
          event={selected}
          canManage={canManage}
          busy={busyId === selected?.id}
          onAction={handleAction}
        />
      </div>
    </div>
  );
}

export default PdfImportMonitoringPanel;
