/**
 * AdaptiveReconciliationPolicyPanel — Phase 10D.
 * Pure display for the deterministic Adaptive Reconciliation Policy. Governance
 * only; no network, no AI, no reconciliation application.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  formatAdaptiveReconciliationConfidence,
  getAdaptiveReconciliationActionLabel,
  getAdaptiveReconciliationDecisionLabel,
  getAdaptiveReconciliationDecisionTone,
  getAdaptiveReconciliationSeverityLabel,
  getAdaptiveReconciliationSeverityTone,
  type AdaptiveReconciliationPolicy,
} from '@/lib/reportTemplate/ingestion/reconciliation';

interface AdaptiveReconciliationPolicyPanelProps {
  policy: AdaptiveReconciliationPolicy | null;
}

const DASH = '—';
const text = (v: string | number | boolean | null | undefined) =>
  v === null || v === undefined || v === '' ? DASH : String(v);
const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right break-all font-medium">{children}</span>
    </div>
  );
}

export function AdaptiveReconciliationPolicyPanel({ policy }: AdaptiveReconciliationPolicyPanelProps) {
  if (!policy) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Adaptive reconciliation policy</CardTitle></CardHeader>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No adaptive reconciliation policy generated.
        </CardContent>
      </Card>
    );
  }

  const { flags, sourceSummary } = policy;
  const topEvidence = policy.evidence.slice(0, 8);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2">
          Adaptive reconciliation policy
          <Badge variant={getAdaptiveReconciliationDecisionTone(policy.decision)}>
            {getAdaptiveReconciliationDecisionLabel(policy.decision)}
          </Badge>
          <Badge variant={getAdaptiveReconciliationSeverityTone(policy.severity)}>
            {getAdaptiveReconciliationSeverityLabel(policy.severity)}
          </Badge>
          <Badge variant="outline">Confidence {formatAdaptiveReconciliationConfidence(policy.confidence)}</Badge>
          <Badge variant="outline">{getAdaptiveReconciliationActionLabel(policy.recommendedAction)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {policy.decision === 'blocked' && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            AI reconciliation is blocked by policy. Manual review is required before running AI reconciliation.
          </div>
        )}
        {policy.decision === 'recommended' && (
          <div className="rounded-md border bg-muted/40 p-2 text-xs">
            AI reconciliation is recommended. Operator confirmation is still required.
          </div>
        )}

        <div className="rounded-md border bg-muted/30 p-2">
          <div className="text-xs font-medium mb-1">Flags</div>
          <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
            <Row label="AI allowed">{yesNo(flags.aiAllowed)}</Row>
            <Row label="AI blocked">{yesNo(flags.aiBlocked)}</Row>
            <Row label="Manual review required">{yesNo(flags.requiresManualReview)}</Row>
            <Row label="Operator confirmation required">{yesNo(flags.requiresOperatorConfirmation)}</Row>
            <Row label="Rerun Visual QA after AI">{yesNo(flags.requiresVisualQaAfterReconciliation)}</Row>
            <Row label="Rerun export parity after AI">{yesNo(flags.requiresExportParityAfterReconciliation)}</Row>
            <Row label="Rerun repair before AI">{yesNo(flags.shouldRerunRepairBeforeReconciliation)}</Row>
            <Row label="Can proceed without AI">{yesNo(flags.canProceedWithoutAi)}</Row>
          </div>
        </div>

        <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
          <Row label="Profile category">{text(sourceSummary.profileCategory)}</Row>
          <Row label="Import risk level">{text(sourceSummary.importRiskLevel)}</Row>
          <Row label="Primary repair pattern">{text(sourceSummary.primaryRepairPatternId)}</Row>
          <Row label="Repair pattern severity">{text(sourceSummary.repairPatternSeverity)}</Row>
          <Row label="Visual QA score">{text(sourceSummary.visualQaScore)}</Row>
          <Row label="Repair status">{text(sourceSummary.repairStatus)}</Row>
          <Row label="Export parity status">{text(sourceSummary.exportParityStatus)}</Row>
          <Row label="Golden quality gate">{text(sourceSummary.goldenQualityGateStatus)}</Row>
        </div>

        {policy.reasons.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">Reasons</div>
            <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
              {policy.reasons.map((r, i) => <li key={i} className="break-all">{r}</li>)}
            </ul>
          </div>
        )}

        {topEvidence.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">Evidence</div>
            <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
              {topEvidence.map((e, i) => (
                <li key={`${e.code}-${i}`} className="break-all">
                  <span className="font-medium text-foreground">{e.label}:</span> {text(e.value)} — {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs font-medium mb-1">Warnings ({policy.warnings.length})</div>
            {policy.warnings.length === 0 ? (
              <div className="text-xs text-muted-foreground">None</div>
            ) : (
              <ul className="list-disc pl-4 text-xs space-y-0.5">
                {policy.warnings.map((w, i) => <li key={i} className="break-all">{w}</li>)}
              </ul>
            )}
          </div>
          <div>
            <div className="text-xs font-medium mb-1">Blockers ({policy.blockers.length})</div>
            {policy.blockers.length === 0 ? (
              <div className="text-xs text-muted-foreground">None</div>
            ) : (
              <ul className="list-disc pl-4 text-xs text-destructive space-y-0.5">
                {policy.blockers.map((b, i) => <li key={i} className="break-all">{b}</li>)}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default AdaptiveReconciliationPolicyPanel;
