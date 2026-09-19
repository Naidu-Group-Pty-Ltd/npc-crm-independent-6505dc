/**
 * PdfImportRunbookPanel — Phase 11F.
 *
 * Presentational registry of production runbooks, grouped by domain. No network
 * calls and no markdown loading — it shows runbook metadata + doc paths so
 * operators can find the right SOP. Optionally shows a readiness rollup.
 */
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  formatPdfImportRunbookReadinessScore,
  getPdfImportRunbookCriticalityLabel,
  getPdfImportRunbookCriticalityTone,
  getPdfImportRunbookDomainLabel,
  type PdfImportRunbookReadinessReport,
  type PdfImportRunbookRegistry,
} from '@/lib/reportTemplate/ingestion/runbooks';

interface PdfImportRunbookPanelProps {
  registry: PdfImportRunbookRegistry;
  readiness?: PdfImportRunbookReadinessReport | null;
}

export function PdfImportRunbookPanel({ registry, readiness }: PdfImportRunbookPanelProps) {
  const runbooks = registry.runbooks;
  const criticalCount = runbooks.filter((r) => r.criticality === 'critical').length;
  const domains = Array.from(new Set(runbooks.map((r) => r.domain)));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {readiness && (
          <Card>
            <CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-muted-foreground">Readiness</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0 text-xl font-semibold tabular-nums">{formatPdfImportRunbookReadinessScore(readiness.score)}</CardContent>
          </Card>
        )}
        <Card>
          <CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-muted-foreground">Runbooks</CardTitle></CardHeader>
          <CardContent className="p-3 pt-0 text-xl font-semibold tabular-nums">{runbooks.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-muted-foreground">Critical</CardTitle></CardHeader>
          <CardContent className="p-3 pt-0 text-xl font-semibold tabular-nums">{criticalCount}</CardContent>
        </Card>
        {readiness && (
          <Card>
            <CardHeader className="p-3 pb-1"><CardTitle className="text-xs text-muted-foreground">Missing / incomplete</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0 text-xl font-semibold tabular-nums">{readiness.missing + readiness.incomplete}</CardContent>
          </Card>
        )}
      </div>

      {domains.map((domain) => (
        <Card key={domain}>
          <CardHeader className="p-3 pb-1"><CardTitle className="text-sm">{getPdfImportRunbookDomainLabel(domain)}</CardTitle></CardHeader>
          <CardContent className="space-y-2 p-3 pt-0">
            {runbooks.filter((r) => r.domain === domain).map((r) => (
              <div key={r.id} className="rounded-md border p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={getPdfImportRunbookCriticalityTone(r.criticality)}>{getPdfImportRunbookCriticalityLabel(r.criticality)}</Badge>
                  <span className="font-medium">{r.title}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  <code className="break-all">{r.path}</code>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span>Audience: {r.audience.join(', ')}</span>
                  {r.relatedRoutes.length > 0 && <span>Routes: {r.relatedRoutes.join(', ')}</span>}
                  {r.relatedAlerts.length > 0 && <span>Alerts: {r.relatedAlerts.slice(0, 4).join(', ')}{r.relatedAlerts.length > 4 ? '…' : ''}</span>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default PdfImportRunbookPanel;
