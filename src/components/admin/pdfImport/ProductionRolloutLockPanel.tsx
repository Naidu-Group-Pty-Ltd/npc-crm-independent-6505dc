/**
 * ProductionRolloutLockPanel — Phase 11H final production rollout lock report.
 *
 * Presentational, read-only view of a final production rollout lock report:
 * decision, rollout mode, score, summary counts, blockers, conditions, and
 * checks grouped by domain. No network calls, no mutation.
 */
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getPdfImportProductionRolloutLockDecisionLabel,
  getPdfImportProductionRolloutLockDecisionTone,
  getPdfImportProductionRolloutModeLabel,
  getPdfImportProductionRolloutModeTone,
  getPdfImportProductionRolloutLockStatusLabel,
  getPdfImportProductionRolloutLockStatusTone,
  getPdfImportProductionRolloutLockSeverityLabel,
  getPdfImportProductionRolloutLockDomainLabel,
  formatPdfImportProductionRolloutLockScore,
  type PdfImportProductionRolloutLockCheck,
  type PdfImportProductionRolloutLockDomain,
  type PdfImportProductionRolloutLockReport,
} from '@/lib/reportTemplate/ingestion/productionRolloutLock';

interface ProductionRolloutLockPanelProps {
  report: PdfImportProductionRolloutLockReport | null;
}

function CheckRow({ check }: { check: PdfImportProductionRolloutLockCheck }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{check.id}</span>
          <span className="text-sm font-medium">{check.title}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{check.message}</p>
        {check.status !== 'pass' && check.status !== 'not_applicable' && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-medium">Remediation:</span> {check.remediation}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Badge variant="outline">{getPdfImportProductionRolloutLockSeverityLabel(check.severity)}</Badge>
        <Badge variant={getPdfImportProductionRolloutLockStatusTone(check.status)}>
          {getPdfImportProductionRolloutLockStatusLabel(check.status)}
        </Badge>
      </div>
    </div>
  );
}

export function ProductionRolloutLockPanel({ report }: ProductionRolloutLockPanelProps) {
  if (!report) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          No production rollout lock report generated.
        </CardContent>
      </Card>
    );
  }

  const byDomain = new Map<PdfImportProductionRolloutLockDomain, PdfImportProductionRolloutLockCheck[]>();
  for (const check of report.checks) {
    const list = byDomain.get(check.domain) ?? [];
    list.push(check);
    byDomain.set(check.domain, list);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            Final production rollout lock
            <Badge variant={getPdfImportProductionRolloutLockDecisionTone(report.decision)}>
              {getPdfImportProductionRolloutLockDecisionLabel(report.decision)}
            </Badge>
            <Badge variant={getPdfImportProductionRolloutModeTone(report.rolloutMode)}>
              {getPdfImportProductionRolloutModeLabel(report.rolloutMode)}
            </Badge>
            <span className="text-muted-foreground">
              {formatPdfImportProductionRolloutLockScore(report.score)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <div>Generated at {report.generatedAt}</div>
          <div className="flex flex-wrap gap-3">
            <span>Total: {report.summary.total}</span>
            <span>Pass: {report.summary.pass}</span>
            <span>Warning: {report.summary.warning}</span>
            <span>Fail: {report.summary.fail}</span>
            <span>Unknown: {report.summary.unknown}</span>
            <span>N/A: {report.summary.notApplicable}</span>
            <span>Critical failures: {report.summary.criticalFailures}</span>
            <span>High failures: {report.summary.highFailures}</span>
          </div>
        </CardContent>
      </Card>

      {report.blockers.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Blockers</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {report.blockers.map((c) => <CheckRow key={c.id} check={c} />)}
          </CardContent>
        </Card>
      )}

      {report.conditions.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Conditions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {report.conditions.map((c) => <CheckRow key={c.id} check={c} />)}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Checks by domain</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {Array.from(byDomain.entries()).map(([domain, checks]) => (
            <div key={domain} className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {getPdfImportProductionRolloutLockDomainLabel(domain)}
              </div>
              {checks.map((c) => <CheckRow key={c.id} check={c} />)}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
