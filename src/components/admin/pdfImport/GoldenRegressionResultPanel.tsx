/**
 * GoldenRegressionResultPanel — Phase 9B.
 * Renders the overall Phase 9A orchestrator result: status, identity, steps,
 * golden regression summary, warnings/failures, and persistence. Pure display.
 * Snapshot / quality gate / triage detail live in their own panels (no duplication).
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  getGoldenCorpusConsoleStatusLabel,
  getGoldenCorpusConsoleStatusTone,
  getGoldenRunBaselineOutcomeLabel,
  getGoldenRunBaselineOutcomeTone,
  type GoldenCorpusOrchestratorResult,
  type GoldenCorpusOrchestratorStepStatus,
  type GoldenRunMetricComparison,
} from '@/lib/reportTemplate/ingestion/goldenCorpus';
import { AutomatedExportParityPanel } from './AutomatedExportParityPanel';
import { ImportIntelligenceProfilePanel } from './ImportIntelligenceProfilePanel';
import { RepairPatternAnalysisPanel } from './RepairPatternAnalysisPanel';
import { AdaptiveReconciliationPolicyPanel } from './AdaptiveReconciliationPolicyPanel';
import { SelfHealingRetryPanel } from './SelfHealingRetryPanel';
import { PerformanceCostAuditPanel } from './PerformanceCostAuditPanel';
import { ProductionOperatorControlsPanel } from './ProductionOperatorControlsPanel';
import { OperatorPermissionStatusPanel } from './OperatorPermissionStatusPanel';
import { Phase10ProductionLockPanel } from './Phase10ProductionLockPanel';
import { RolloutReadinessPanel } from './RolloutReadinessPanel';
import { usePdfImportPermissions } from '@/hooks/usePdfImportPermissions';
import {
  evaluatePhase10ProductionLock,
  listPhase10ProductionLockRequirements,
  type Phase10ProductionLockReport,
  type Phase10ProductionLockRequirementStatus,
} from '@/lib/reportTemplate/ingestion/phase10Lock';
import {
  evaluatePdfImportRolloutReadiness,
  listPdfImportRolloutReadinessChecks,
  type PdfImportRolloutReadinessReport,
  type PdfImportRolloutReadinessStatus,
} from '@/lib/reportTemplate/ingestion/rolloutReadiness';

interface GoldenRegressionResultPanelProps {
  result: GoldenCorpusOrchestratorResult | null;
}

/**
 * Build a read-only Phase 10 lock *preview* from a run result. Only the
 * intelligence-layer requirements are derived (pass when the audit is present on
 * the result); documentation/SQL/DB/test requirements stay `unknown` because they
 * are verified out-of-band. This is a live readiness hint, not the full lock.
 */
function buildPhase10LockPreview(result: GoldenCorpusOrchestratorResult): Phase10ProductionLockReport {
  const reqs = listPhase10ProductionLockRequirements();
  const set = (id: string, status: Phase10ProductionLockRequirementStatus, evidence?: string) => {
    const r = reqs.find((x) => x.id === id);
    if (r) { r.status = status; if (evidence) r.evidence = [evidence]; }
  };
  const pass = (ids: string[], evidence: string) => ids.forEach((id) => set(id, 'pass', evidence));

  if (result.importIntelligenceProfile) pass(['PHASE10-INTEL-001', 'PHASE10-INTEL-002'], 'profile present on run result');
  if (result.repairPatternAnalysis) pass(['PHASE10-REPAIRPATTERN-001', 'PHASE10-REPAIRPATTERN-002'], 'analysis present on run result');
  if (result.adaptiveReconciliationPolicy) pass(['PHASE10-ADAPTIVE-001', 'PHASE10-ADAPTIVE-002', 'PHASE10-ADAPTIVE-003'], 'policy present on run result');
  if (result.selfHealingRetryAudit) pass(['PHASE10-SELFHEAL-001', 'PHASE10-SELFHEAL-002', 'PHASE10-SELFHEAL-003', 'PHASE10-SELFHEAL-004'], 'audit present on run result');
  if (result.performanceCostAudit) pass(['PHASE10-PERF-001', 'PHASE10-PERF-002', 'PHASE10-PERF-003'], 'audit present on run result');
  if (result.productionOperatorControlAudit) pass(['PHASE10-OPERATOR-001', 'PHASE10-OPERATOR-002', 'PHASE10-OPERATOR-003', 'PHASE10-OPERATOR-004'], 'audit present on run result');
  if (result.goldenRegressionSummary) pass(['PHASE10-GOLDEN-001', 'PHASE10-GOLDEN-002', 'PHASE10-GOLDEN-003'], 'golden summary present on run result');
  if (result.exportParityRunnerResult) pass(['PHASE10-EXPORT-001', 'PHASE10-EXPORT-002'], 'export parity present on run result');

  return evaluatePhase10ProductionLock({ requirements: reqs });
}

/**
 * Build a read-only rollout readiness *preview* from a run result. Only the
 * operator-safety and intelligence checks that are directly observable on the run
 * result are marked pass; deployment/permissions/monitoring/runbook checks stay
 * `unknown` because they are verified out-of-band. This is a live hint, not the
 * full rollout review.
 */
function buildRolloutReadinessPreview(result: GoldenCorpusOrchestratorResult): PdfImportRolloutReadinessReport {
  const checks = listPdfImportRolloutReadinessChecks();
  const set = (id: string, status: PdfImportRolloutReadinessStatus, evidence?: string) => {
    const c = checks.find((x) => x.id === id);
    if (c) { c.status = status; if (evidence) c.evidence = [evidence]; }
  };
  const pass = (ids: string[], evidence: string) => ids.forEach((id) => set(id, 'pass', evidence));

  // Operator workflow safety is observable from the run result.
  pass(['ROLL-OP-001', 'ROLL-OP-002', 'ROLL-OP-003'], 'console run produced a result');
  if (result.productionOperatorControlAudit) {
    pass(['ROLL-OP-004', 'ROLL-OP-005', 'ROLL-OP-006', 'ROLL-OP-007'], 'operator control audit present');
  }
  if (result.performanceCostAudit) pass(['ROLL-PERF-001', 'ROLL-PERF-002', 'ROLL-PERF-003'], 'performance audit present; AI operator-controlled');
  if (result.goldenRegressionSummary) pass(['ROLL-REL-001'], 'golden regression evaluated');

  return evaluatePdfImportRolloutReadiness({ checks });
}

const DASH = '—';
const text = (v: string | null | undefined) => (v && String(v).trim() !== '' ? v : DASH);
const pct = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * 100)}%` : DASH;

function stepVariant(status: GoldenCorpusOrchestratorStepStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'pass': return 'default';
    case 'warning': return 'secondary';
    case 'fail': return 'destructive';
    case 'blocked': return 'destructive';
    default: return 'outline'; // pending | skipped
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right break-all font-medium">{children}</span>
    </div>
  );
}

export function GoldenRegressionResultPanel({ result }: GoldenRegressionResultPanelProps) {
  const { resolvedRole } = usePdfImportPermissions();
  if (!result) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No golden regression run yet.
        </CardContent>
      </Card>
    );
  }

  const summary = result.goldenRegressionSummary;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex flex-wrap items-center gap-2">
            Result
            <Badge variant={getGoldenCorpusConsoleStatusTone(result.status)}>
              {getGoldenCorpusConsoleStatusLabel(result.status)}
            </Badge>
            <Badge variant="outline">{result.mode}</Badge>
            <Badge variant={result.persisted ? 'default' : 'outline'}>
              {result.persisted ? 'Persisted' : 'Not persisted'}
            </Badge>
            <Badge variant={result.historySaved ? 'default' : 'outline'}>
              {result.historySaved ? 'History saved' : 'History not saved'}
            </Badge>
            {result.baselineComparison && (
              <Badge variant={getGoldenRunBaselineOutcomeTone(result.baselineComparison.outcome)}>
                Baseline: {getGoldenRunBaselineOutcomeLabel(result.baselineComparison.outcome)}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 grid gap-x-8 gap-y-0 md:grid-cols-2">
          <Row label="Corpus ID">{text(result.corpusId)}</Row>
          <Row label="Import ID"><span className="font-mono text-xs">{text(result.importId)}</span></Row>
          <Row label="Template ID"><span className="font-mono text-xs">{text(result.templateId)}</span></Row>
          <Row label="Run ID"><span className="font-mono text-xs">{text(result.runId)}</span></Row>
          <Row label="Run batch ID">{text(result.runBatchId)}</Row>
          <Row label="Generated at">{text(result.generatedAt)}</Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Orchestration steps</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-1">
          {result.steps.map((step) => (
            <div key={step.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <Badge variant={stepVariant(step.status)} className="text-[10px] px-1 py-0 w-[64px] justify-center">{step.status}</Badge>
                <span className="font-medium">{step.label}</span>
              </span>
              <span className="text-right text-xs text-muted-foreground max-w-[55%]">{step.message}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Golden regression summary</CardTitle></CardHeader>
          <CardContent className="pt-0 grid gap-x-8 gap-y-0 md:grid-cols-2">
            <Row label="Quality gate status">{text(summary.qualityGateStatus)}</Row>
            <Row label="Operator decision">{text(summary.operatorDecision)}</Row>
            <Row label="Visual QA score">{pct(summary.visualQaScore)}</Row>
            <Row label="Repair final score">{pct(summary.repairFinalScore)}</Row>
            <Row label="Export parity status">{text(summary.exportParityStatus)}</Row>
            <Row label="Export vs source">{pct(summary.exportVsSourceScore)}</Row>
            <Row label="Warnings">{summary.warnings.length}</Row>
            <Row label="Failures">{summary.failures.length}</Row>
            <Row label="Persisted at">{text(summary.persistedAt)}</Row>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Warnings ({result.warnings.length})</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {result.warnings.length === 0 ? (
              <div className="text-sm text-muted-foreground">None</div>
            ) : (
              <ul className="list-disc pl-4 text-xs space-y-0.5">{result.warnings.map((w, i) => <li key={i} className="break-all">{w}</li>)}</ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Failures ({result.failures.length})</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {result.failures.length === 0 ? (
              <div className="text-sm text-muted-foreground">None</div>
            ) : (
              <ul className="list-disc pl-4 text-xs space-y-0.5">{result.failures.map((f, i) => <li key={i} className="break-all">{f}</li>)}</ul>
            )}
          </CardContent>
        </Card>
      </div>

      {result.persistenceResult && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Persistence</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <Row label="Result">
              <Badge variant={result.persistenceResult.kind === 'ok' ? 'default' : 'destructive'}>
                {result.persistenceResult.kind}
              </Badge>
            </Row>
            {result.persistenceResult.kind === 'error' && (
              <Separator className="my-2" />
            )}
            {result.persistenceResult.kind === 'error' && (
              <p className="text-xs text-destructive break-all">{result.persistenceResult.message}</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex flex-wrap items-center gap-2">
            Regression history
            <Badge variant={result.historySaved ? 'default' : 'outline'}>
              {result.historySaved ? 'Saved' : 'Not saved'}
            </Badge>
            {result.baselineComparison && (
              <Badge variant={getGoldenRunBaselineOutcomeTone(result.baselineComparison.outcome)}>
                {getGoldenRunBaselineOutcomeLabel(result.baselineComparison.outcome)}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
            <Row label="History saved">{result.historySaved ? 'Yes' : 'No'}</Row>
            <Row label="History ID">
              <span className="font-mono text-xs">
                {text(result.historyPersistenceResult?.kind === 'ok' ? result.historyPersistenceResult.historyId : result.historyRecord?.id)}
              </span>
            </Row>
            <Row label="Current run ID"><span className="font-mono text-xs">{text(result.baselineComparison?.currentRunId ?? result.runId)}</span></Row>
            <Row label="Previous run ID"><span className="font-mono text-xs">{text(result.baselineComparison?.previousRunId)}</span></Row>
          </div>

          {result.historyPersistenceResult?.kind === 'error' && (
            <p className="text-xs text-destructive break-all">
              History save failed: {result.historyPersistenceResult.message}
            </p>
          )}

          {!result.baselineComparison ? (
            <div className="text-sm text-muted-foreground">No baseline comparison generated.</div>
          ) : (
            <>
              <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
                <Row label="Quality gate">
                  {text(result.baselineComparison.qualityGateStatus.previous)} → {text(result.baselineComparison.qualityGateStatus.current)}{' '}
                  <MetricBadge outcome={result.baselineComparison.qualityGateStatus.outcome} />
                </Row>
                <Row label="Operator decision">
                  {text(result.baselineComparison.operatorDecision.previous)} → {text(result.baselineComparison.operatorDecision.current)}{' '}
                  <MetricBadge outcome={result.baselineComparison.operatorDecision.outcome} />
                </Row>
                <Row label="Warnings Δ">{result.baselineComparison.warningCountDelta ?? DASH}</Row>
                <Row label="Failures Δ">{result.baselineComparison.failureCountDelta ?? DASH}</Row>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {result.baselineComparison.metrics.map((m) => (
                  <MetricCard key={m.metric} metric={m} />
                ))}
              </div>

              {result.baselineComparison.messages.length > 0 && (
                <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
                  {result.baselineComparison.messages.map((msg, i) => <li key={i} className="break-all">{msg}</li>)}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <ImportIntelligenceProfilePanel profile={result.importIntelligenceProfile} />
        {result.importIntelligencePersistenceResult && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Import intelligence persistence</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <Row label="Result">
                <Badge variant={result.importIntelligencePersistenceResult.kind === 'ok' ? 'default' : 'destructive'}>
                  {result.importIntelligencePersistenceResult.kind}
                </Badge>
              </Row>
              {result.importIntelligencePersistenceResult.kind === 'error' && (
                <p className="text-xs text-destructive break-all">{result.importIntelligencePersistenceResult.message}</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-2">
        <RepairPatternAnalysisPanel analysis={result.repairPatternAnalysis} />
        {result.repairPatternPersistenceResult && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Repair pattern persistence</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <Row label="Result">
                <Badge variant={result.repairPatternPersistenceResult.kind === 'ok' ? 'default' : 'destructive'}>
                  {result.repairPatternPersistenceResult.kind}
                </Badge>
              </Row>
              {result.repairPatternPersistenceResult.kind === 'error' && (
                <p className="text-xs text-destructive break-all">{result.repairPatternPersistenceResult.message}</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-2">
        <AdaptiveReconciliationPolicyPanel policy={result.adaptiveReconciliationPolicy} />
        {result.adaptiveReconciliationPolicyPersistenceResult && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Adaptive reconciliation persistence</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <Row label="Result">
                <Badge variant={result.adaptiveReconciliationPolicyPersistenceResult.kind === 'ok' ? 'default' : 'destructive'}>
                  {result.adaptiveReconciliationPolicyPersistenceResult.kind}
                </Badge>
              </Row>
              {result.adaptiveReconciliationPolicyPersistenceResult.kind === 'error' && (
                <p className="text-xs text-destructive break-all">{result.adaptiveReconciliationPolicyPersistenceResult.message}</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-2">
        <SelfHealingRetryPanel
          audit={result.selfHealingRetryAudit}
          persistenceResult={result.selfHealingRetryAuditPersistenceResult}
        />
      </div>

      <div className="space-y-2">
        <PerformanceCostAuditPanel
          audit={result.performanceCostAudit}
          persistenceResult={result.performanceCostAuditPersistenceResult}
        />
      </div>

      <div className="space-y-2">
        <OperatorPermissionStatusPanel resolvedRole={resolvedRole} />
        <ProductionOperatorControlsPanel
          audit={result.productionOperatorControlAudit}
          importId={result.importId}
          templateId={result.templateId}
          persistenceResult={result.productionOperatorControlAuditPersistenceResult}
          resolvedRole={resolvedRole}
        />
      </div>

      <div className="space-y-2">
        <Phase10ProductionLockPanel report={buildPhase10LockPreview(result)} />
      </div>

      <div className="space-y-2">
        <RolloutReadinessPanel report={buildRolloutReadinessPreview(result)} />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Export parity automation</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-2">
          {result.exportParityRunnerResult ? (
            <>
              <AutomatedExportParityPanel result={result.exportParityRunnerResult} />
              <p className="text-xs text-muted-foreground">
                {result.exportParityRunnerResult.persisted
                  ? 'Quality gates were evaluated against the refreshed export parity metadata.'
                  : 'Export parity was not persisted; quality gates used the existing export parity metadata.'}
              </p>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Export parity automation was not run.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricBadge({ outcome }: { outcome: string }) {
  const variant = outcome === 'degraded' ? 'destructive'
    : outcome === 'improved' ? 'default'
    : outcome === 'stable' ? 'secondary'
    : 'outline';
  return <Badge variant={variant} className="text-[10px]">{outcome}</Badge>;
}

function MetricCard({ metric }: { metric: GoldenRunMetricComparison }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2 text-xs">
      <div className="font-medium">{metric.metric}</div>
      <div className="text-muted-foreground">{pct(metric.previous)} → {pct(metric.current)}</div>
      <MetricBadge outcome={metric.outcome} />
    </div>
  );
}

export default GoldenRegressionResultPanel;
