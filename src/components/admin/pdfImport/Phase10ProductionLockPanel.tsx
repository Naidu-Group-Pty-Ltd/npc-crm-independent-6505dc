/**
 * Phase10ProductionLockPanel — Phase 10H.
 *
 * Pure display for a locally-built Phase 10 production lock report. It renders the
 * lock decision, score, summary counts, critical blockers, warnings, and the
 * requirement checklist grouped by domain. It performs no network calls and adds
 * no runtime behaviour — it is a read-only readiness view.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  getPhase10ProductionLockDecisionLabel,
  getPhase10ProductionLockDecisionTone,
  getPhase10ProductionLockStatusLabel,
  getPhase10ProductionLockStatusTone,
  getPhase10ProductionLockSeverityLabel,
  getPhase10ProductionLockDomainLabel,
  formatPhase10ProductionLockScore,
  type Phase10ProductionLockDomain,
  type Phase10ProductionLockReport,
  type Phase10ProductionLockRequirement,
} from '@/lib/reportTemplate/ingestion/phase10Lock';

interface Phase10ProductionLockPanelProps {
  report: Phase10ProductionLockReport | null;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2 text-center">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function RequirementRow({ req }: { req: Phase10ProductionLockRequirement }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b py-1 text-xs last:border-b-0">
      <Badge variant={getPhase10ProductionLockStatusTone(req.status)} className="text-[10px] w-[92px] justify-center">
        {getPhase10ProductionLockStatusLabel(req.status)}
      </Badge>
      <span className="font-mono text-[10px] text-muted-foreground">{req.id}</span>
      <span className="font-medium">{req.title}</span>
      <Badge variant="outline" className="text-[10px]">{getPhase10ProductionLockSeverityLabel(req.severity)}</Badge>
      {(req.status === 'fail' || req.status === 'unknown') && (
        <span className="ml-auto text-muted-foreground">{req.remediation}</span>
      )}
    </div>
  );
}

export function Phase10ProductionLockPanel({ report }: Phase10ProductionLockPanelProps) {
  if (!report) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No Phase 10 lock report generated.
        </CardContent>
      </Card>
    );
  }

  const { summary } = report;
  const domains = Array.from(new Set(report.requirements.map((r) => r.domain))) as Phase10ProductionLockDomain[];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex flex-wrap items-center gap-2">
            Phase 10 production lock
            <Badge variant={getPhase10ProductionLockDecisionTone(summary.decision)}>
              {getPhase10ProductionLockDecisionLabel(summary.decision)}
            </Badge>
            <Badge variant="outline">{formatPhase10ProductionLockScore(summary.score)}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            Live readiness preview. The full lock decision also requires the docs checklist, final SQL,
            the production-preview smoke test, and the private-artifact review. This view adds no runtime
            behaviour and makes no network calls.
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 text-xs">
            <Stat label="Total" value={summary.total} />
            <Stat label="Pass" value={summary.pass} />
            <Stat label="Warning" value={summary.warning} />
            <Stat label="Fail" value={summary.fail} />
            <Stat label="Unknown" value={summary.unknown} />
            <Stat label="Critical blockers" value={report.criticalBlockers.length} />
          </div>
        </CardContent>
      </Card>

      {report.criticalBlockers.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Critical blockers ({report.criticalBlockers.length})</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-1">
            {report.criticalBlockers.map((r) => (
              <div key={r.id} className="text-xs">
                <span className="font-mono text-[10px] text-muted-foreground">{r.id}</span>{' '}
                <span className="font-medium">{r.title}</span>
                <div className="text-muted-foreground">{r.remediation}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Requirements ({report.requirements.length})</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-3">
          {domains.map((domain) => {
            const reqs = report.requirements.filter((r) => r.domain === domain);
            return (
              <div key={domain}>
                <div className="text-xs font-semibold text-muted-foreground">{getPhase10ProductionLockDomainLabel(domain)}</div>
                <Separator className="my-1" />
                {reqs.map((r) => <RequirementRow key={r.id} req={r} />)}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

export default Phase10ProductionLockPanel;
