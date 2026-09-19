/**
 * SelfHealingRetryPanel — Phase 10E.
 *
 * Pure display for the controlled Self-Healing Retry Audit. It surfaces the
 * recovery plan, the safety gate of every action, and what (if anything) was
 * executed. It renders evidence only; it never triggers actions, calls AI,
 * mutates templates, reruns imports, or performs browser-dependent work.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  getSelfHealingActionLabel,
  getSelfHealingActionStatusLabel,
  getSelfHealingActionStatusTone,
  getSelfHealingModeLabel,
  getSelfHealingPlanStatusLabel,
  getSelfHealingPlanStatusTone,
  getSelfHealingSafetyLevelLabel,
  getSelfHealingSafetyLevelTone,
  type SelfHealingActionPlan,
  type SelfHealingRetryAudit,
  type SaveSelfHealingRetryAuditResult,
} from '@/lib/reportTemplate/ingestion/selfHealing';

interface SelfHealingRetryPanelProps {
  audit: SelfHealingRetryAudit | null;
  persistenceResult?: SaveSelfHealingRetryAuditResult | null;
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

function ActionCard({ action }: { action: SelfHealingActionPlan }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">{getSelfHealingActionLabel(action.actionId)}</span>
        <Badge variant={getSelfHealingActionStatusTone(action.status)} className="text-[10px]">
          {getSelfHealingActionStatusLabel(action.status)}
        </Badge>
        <Badge variant={getSelfHealingSafetyLevelTone(action.safetyLevel)} className="text-[10px]">
          {getSelfHealingSafetyLevelLabel(action.safetyLevel)}
        </Badge>
        <Badge variant="outline" className="text-[10px]">priority {action.priority}</Badge>
        <Badge variant="outline" className="text-[10px]">
          attempt {action.attemptCount}/{action.maxAttempts}
        </Badge>
      </div>
      {action.message && <div className="text-muted-foreground">{action.message}</div>}
      {action.resultMessage && (
        <div className="text-muted-foreground">Result: {action.resultMessage}</div>
      )}
      {action.reasonCodes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {action.reasonCodes.map((code) => (
            <Badge key={code} variant="outline" className="text-[10px] font-mono">{code}</Badge>
          ))}
        </div>
      )}
      {action.prerequisites.length > 0 && (
        <div className="text-muted-foreground">
          Prerequisites: {action.prerequisites.join(', ')}
        </div>
      )}
      {action.evidence.length > 0 && (
        <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
          {action.evidence.map((e) => (
            <li key={e.code} className="break-all">{e.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SelfHealingRetryPanel({ audit, persistenceResult }: SelfHealingRetryPanelProps) {
  if (!audit) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No self-healing retry plan was built for this run.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex flex-wrap items-center gap-2">
            Self-healing retry plan
            <Badge variant={getSelfHealingPlanStatusTone(audit.status)}>
              {getSelfHealingPlanStatusLabel(audit.status)}
            </Badge>
            <Badge variant="outline">{getSelfHealingModeLabel(audit.mode)}</Badge>
            <Badge variant={audit.executedAt ? 'default' : 'outline'}>
              {audit.executedAt ? 'Executed' : 'Not executed'}
            </Badge>
            <Badge variant={audit.persistedAt ? 'default' : 'outline'}>
              {audit.persistedAt ? 'Persisted' : 'Not persisted'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            This is an evidence-only plan. It never calls AI, mutates templates, reruns imports,
            or performs browser-dependent actions automatically. Only safe metadata-level actions
            can be executed, and only after an explicit operator trigger.
          </div>
          <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
            <Row label="Plan ID"><span className="font-mono text-xs">{text(audit.planId)}</span></Row>
            <Row label="Import ID"><span className="font-mono text-xs">{text(audit.importId)}</span></Row>
            <Row label="Template ID"><span className="font-mono text-xs">{text(audit.templateId)}</span></Row>
            <Row label="Generated at">{text(audit.generatedAt)}</Row>
            <Row label="Executed at">{text(audit.executedAt)}</Row>
            <Row label="Persisted at">{text(audit.persistedAt)}</Row>
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7 text-center text-xs">
            <Stat label="Total" value={audit.summary.totalActions} />
            <Stat label="Executable" value={audit.summary.executableActions} />
            <Stat label="Completed" value={audit.summary.completedActions} />
            <Stat label="Failed" value={audit.summary.failedActions} />
            <Stat label="Skipped" value={audit.summary.skippedActions} />
            <Stat label="Manual" value={audit.summary.manualActions} />
            <Stat label="Blocked" value={audit.summary.blockedActions} />
          </div>
        </CardContent>
      </Card>

      {(audit.blockers.length > 0 || audit.warnings.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Blockers ({audit.blockers.length})</CardTitle></CardHeader>
            <CardContent className="pt-0">
              {audit.blockers.length === 0 ? (
                <div className="text-sm text-muted-foreground">None</div>
              ) : (
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {audit.blockers.map((b, i) => <li key={i} className="break-all">{b}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Warnings ({audit.warnings.length})</CardTitle></CardHeader>
            <CardContent className="pt-0">
              {audit.warnings.length === 0 ? (
                <div className="text-sm text-muted-foreground">None</div>
              ) : (
                <ul className="list-disc pl-4 text-xs space-y-0.5">
                  {audit.warnings.map((w, i) => <li key={i} className="break-all">{w}</li>)}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recovery actions ({audit.actions.length})</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-2">
          {audit.actions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No recovery actions were planned.</div>
          ) : (
            audit.actions.map((action) => <ActionCard key={action.actionId} action={action} />)
          )}
        </CardContent>
      </Card>

      {persistenceResult && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Self-healing persistence</CardTitle></CardHeader>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

export default SelfHealingRetryPanel;
