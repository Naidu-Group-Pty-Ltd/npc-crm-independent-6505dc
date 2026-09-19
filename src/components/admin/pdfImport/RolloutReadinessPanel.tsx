/**
 * RolloutReadinessPanel — Phase 11A.
 *
 * Pure display for a locally-built production rollout readiness report. It renders
 * the rollout decision, recommended mode, score, summary counts, critical
 * blockers, conditions, recommended next phases, and the checks grouped by domain.
 * It performs no network calls and adds no runtime behaviour.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  getPdfImportRolloutDecisionLabel,
  getPdfImportRolloutDecisionTone,
  getPdfImportRolloutModeLabel,
  getPdfImportRolloutModeTone,
  getPdfImportRolloutReadinessStatusLabel,
  getPdfImportRolloutReadinessStatusTone,
  getPdfImportRolloutReadinessSeverityLabel,
  getPdfImportRolloutReadinessDomainLabel,
  formatPdfImportRolloutReadinessScore,
  type PdfImportRolloutReadinessCheck,
  type PdfImportRolloutReadinessDomain,
  type PdfImportRolloutReadinessReport,
} from '@/lib/reportTemplate/ingestion/rolloutReadiness';

interface RolloutReadinessPanelProps {
  report: PdfImportRolloutReadinessReport | null;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2 text-center">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function CheckRow({ check }: { check: PdfImportRolloutReadinessCheck }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b py-1 text-xs last:border-b-0">
      <Badge variant={getPdfImportRolloutReadinessStatusTone(check.status)} className="text-[10px] w-[92px] justify-center">
        {getPdfImportRolloutReadinessStatusLabel(check.status)}
      </Badge>
      <span className="font-mono text-[10px] text-muted-foreground">{check.id}</span>
      <span className="font-medium">{check.title}</span>
      <Badge variant="outline" className="text-[10px]">{getPdfImportRolloutReadinessSeverityLabel(check.severity)}</Badge>
      <Badge variant="outline" className="text-[10px]">{check.targetPhase}</Badge>
      {(check.status === 'fail' || check.status === 'unknown') && (
        <span className="ml-auto text-muted-foreground">{check.remediation}</span>
      )}
    </div>
  );
}

export function RolloutReadinessPanel({ report }: RolloutReadinessPanelProps) {
  if (!report) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No rollout readiness report generated.
        </CardContent>
      </Card>
    );
  }

  const { summary } = report;
  const domains = Array.from(new Set(report.checks.map((c) => c.domain))) as PdfImportRolloutReadinessDomain[];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex flex-wrap items-center gap-2">
            Production rollout readiness
            <Badge variant={getPdfImportRolloutDecisionTone(summary.decision)}>
              {getPdfImportRolloutDecisionLabel(summary.decision)}
            </Badge>
            <Badge variant={getPdfImportRolloutModeTone(summary.recommendedMode)}>
              {getPdfImportRolloutModeLabel(summary.recommendedMode)}
            </Badge>
            <Badge variant="outline">{formatPdfImportRolloutReadinessScore(summary.score)}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            Live readiness preview. The full rollout decision also requires the docs review, final SQL,
            permissions/monitoring/runbooks/release governance, and the private-artifact check. This view
            adds no runtime behaviour and makes no network calls.
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 text-xs">
            <Stat label="Total" value={summary.total} />
            <Stat label="Pass" value={summary.pass} />
            <Stat label="Warning" value={summary.warning} />
            <Stat label="Fail" value={summary.fail} />
            <Stat label="Unknown" value={summary.unknown} />
            <Stat label="Critical blockers" value={report.criticalBlockers.length} />
          </div>
          {report.recommendedNextPhases.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-muted-foreground">Recommended next phases:</span>
              {report.recommendedNextPhases.map((p) => (
                <Badge key={p} variant="secondary" className="text-[10px]">{p}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {report.criticalBlockers.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Critical blockers ({report.criticalBlockers.length})</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-1">
            {report.criticalBlockers.map((c) => (
              <div key={c.id} className="text-xs">
                <span className="font-mono text-[10px] text-muted-foreground">{c.id}</span>{' '}
                <span className="font-medium">{c.title}</span>{' '}
                <Badge variant="outline" className="text-[10px]">{getPdfImportRolloutReadinessDomainLabel(c.domain)}</Badge>
                <div className="text-muted-foreground">{c.remediation}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Readiness checks ({report.checks.length})</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-3">
          {domains.map((domain) => {
            const checks = report.checks.filter((c) => c.domain === domain);
            return (
              <div key={domain}>
                <div className="text-xs font-semibold text-muted-foreground">{getPdfImportRolloutReadinessDomainLabel(domain)}</div>
                <Separator className="my-1" />
                {checks.map((c) => <CheckRow key={c.id} check={c} />)}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

export default RolloutReadinessPanel;
