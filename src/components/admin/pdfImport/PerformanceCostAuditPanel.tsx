/**
 * PerformanceCostAuditPanel — Phase 10F.
 *
 * Pure display for the advisory Performance + Cost audit. It surfaces the overall
 * cost/risk, step cost breakdown, optimization recommendations, staleness, and
 * duplicate-work signals. It renders evidence only; it never triggers actions,
 * calls AI, mutates templates, or changes pipeline behaviour. No network calls.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  getPdfImportCostLevelLabel,
  getPdfImportCostLevelTone,
  getPdfImportPerformanceRiskLabel,
  getPdfImportPerformanceRiskTone,
  getPdfImportOptimizationActionLabel,
  formatPdfImportPerformanceScore,
  type PdfImportPerformanceCostAudit,
  type SavePdfImportPerformanceAuditResult,
} from '@/lib/reportTemplate/ingestion/performance';

interface PerformanceCostAuditPanelProps {
  audit: PdfImportPerformanceCostAudit | null;
  persistenceResult?: SavePdfImportPerformanceAuditResult | null;
}

const DASH = '—';
const text = (v: string | number | boolean | null | undefined) =>
  v === null || v === undefined || v === '' ? DASH : String(v);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right break-all font-medium">{children}</span>
    </div>
  );
}

export function PerformanceCostAuditPanel({ audit, persistenceResult }: PerformanceCostAuditPanelProps) {
  if (!audit) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No performance/cost audit generated.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex flex-wrap items-center gap-2">
            Performance + cost audit
            <Badge variant={getPdfImportPerformanceRiskTone(audit.overallRiskLevel)}>
              Risk: {getPdfImportPerformanceRiskLabel(audit.overallRiskLevel)}
            </Badge>
            <Badge variant={getPdfImportCostLevelTone(audit.overallCostLevel)}>
              Cost: {getPdfImportCostLevelLabel(audit.overallCostLevel)}
            </Badge>
            <Badge variant={audit.persistedAt ? 'default' : 'outline'}>
              {audit.persistedAt ? 'Persisted' : 'Not persisted'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            Advisory only. This audit identifies waste, stale metadata, and expensive steps. It never
            skips quality gates, bypasses Visual QA/export parity, calls AI, or mutates templates.
          </div>
          <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
            <Row label="Estimated cost score">{formatPdfImportPerformanceScore(audit.estimatedCostScore)}</Row>
            <Row label="Estimated waste score">{formatPdfImportPerformanceScore(audit.estimatedWasteScore)}</Row>
            <Row label="Import ID"><span className="font-mono text-xs">{text(audit.importId)}</span></Row>
            <Row label="Template ID"><span className="font-mono text-xs">{text(audit.templateId)}</span></Row>
            <Row label="Generated at">{text(audit.generatedAt)}</Row>
            <Row label="Persisted at">{text(audit.persistedAt)}</Row>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Step cost breakdown ({audit.stepCosts.length})</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-1">
          {audit.stepCosts.map((step) => (
            <div key={step.stepId} className="flex flex-wrap items-center gap-2 text-xs border-b py-1 last:border-b-0">
              <span className="font-medium text-sm min-w-[180px]">{step.label}</span>
              <Badge variant="outline" className="text-[10px]">{step.domain}</Badge>
              <Badge variant={getPdfImportCostLevelTone(step.costLevel)} className="text-[10px]">
                {getPdfImportCostLevelLabel(step.costLevel)}
              </Badge>
              {step.shouldRequireConfirmation && <Badge variant="secondary" className="text-[10px]">confirm</Badge>}
              {step.canReuseExistingResult && <Badge variant="default" className="text-[10px]">reusable</Badge>}
              <span className="text-muted-foreground">{step.reason}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recommendations ({audit.recommendations.length})</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-2">
          {audit.recommendations.length === 0 ? (
            <div className="text-sm text-muted-foreground">None</div>
          ) : (
            audit.recommendations.map((rec) => (
              <div key={rec.id} className="rounded-md border bg-muted/20 p-2 text-xs space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{getPdfImportOptimizationActionLabel(rec.action)}</span>
                  <Badge variant="outline" className="text-[10px]">{rec.domain}</Badge>
                  <Badge variant={getPdfImportCostLevelTone(rec.costLevel)} className="text-[10px]">
                    {getPdfImportCostLevelLabel(rec.costLevel)}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">{rec.severity}</Badge>
                  <Badge variant="outline" className="text-[10px]">conf {Math.round(rec.confidence * 100)}%</Badge>
                </div>
                <div className="text-muted-foreground">{rec.message}</div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Metadata staleness ({audit.staleness.length})</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-1">
            {audit.staleness.map((s) => (
              <div key={s.metadataKey} className="flex flex-wrap items-center gap-2 text-xs py-0.5">
                <Badge variant={s.status === 'fresh' ? 'default' : s.status === 'stale' || s.status === 'missing' ? 'destructive' : 'outline'} className="text-[10px]">
                  {s.status}
                </Badge>
                <span className="font-mono">{s.metadataKey}</span>
                <span className="text-muted-foreground">{s.reason}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Duplicate work ({audit.duplicateWork.length})</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-1">
            {audit.duplicateWork.length === 0 ? (
              <div className="text-sm text-muted-foreground">None</div>
            ) : (
              audit.duplicateWork.map((d) => (
                <div key={d.code} className="text-xs py-0.5">
                  <span className="font-mono">{d.code}</span> <Badge variant="outline" className="text-[10px]">×{d.count}</Badge>
                  <div className="text-muted-foreground">{d.message}</div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Warnings ({audit.warnings.length})</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {audit.warnings.length === 0 ? (
              <div className="text-sm text-muted-foreground">None</div>
            ) : (
              <ul className="list-disc pl-4 text-xs space-y-0.5">{audit.warnings.map((w, i) => <li key={i} className="break-all">{w}</li>)}</ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Blockers ({audit.blockers.length})</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {audit.blockers.length === 0 ? (
              <div className="text-sm text-muted-foreground">None</div>
            ) : (
              <ul className="list-disc pl-4 text-xs space-y-0.5">{audit.blockers.map((b, i) => <li key={i} className="break-all">{b}</li>)}</ul>
            )}
          </CardContent>
        </Card>
      </div>

      {persistenceResult && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Performance audit persistence</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <Row label="Result">
              <Badge variant={persistenceResult.kind === 'ok' ? 'default' : 'destructive'}>
                {persistenceResult.kind}
              </Badge>
            </Row>
            {persistenceResult.kind === 'error' && (
              <p className="text-xs text-destructive break-all">{persistenceResult.message}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default PerformanceCostAuditPanel;
