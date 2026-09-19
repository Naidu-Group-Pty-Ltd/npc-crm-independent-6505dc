/**
 * ProductionOperatorControlsPanel — Phase 10G.
 *
 * Presentational panel for the production operator control audit. It renders the
 * operator decision state and the control catalog with each control's state,
 * safety level, reason, and (for safe controls) an action button wired to
 * parent-provided handlers. It performs no network calls itself and never
 * executes AI/template-mutating controls.
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  getOperatorControlStateLabel,
  getOperatorControlStateTone,
  getOperatorControlSafetyLabel,
  getOperatorControlSafetyTone,
  getOperatorDecisionLabel,
  getOperatorDecisionTone,
  getRequiredCapabilityForOperatorControl,
  type OperatorControlAvailability,
  type OperatorControlExecutionResult,
  type OperatorControlId,
  type ProductionOperatorControlAudit,
  type SaveOperatorControlAuditResult,
} from '@/lib/reportTemplate/ingestion/operatorControls';
import {
  evaluatePdfImportPermission,
  getPdfImportPermissionDecisionLabel,
  getPdfImportPermissionDecisionTone,
  type PdfImportPermissionCheck,
  type PdfImportResolvedRole,
} from '@/lib/reportTemplate/ingestion/operatorPermissions';

interface ProductionOperatorControlsPanelProps {
  audit: ProductionOperatorControlAudit | null;
  importId?: string | null;
  templateId?: string | null;
  persistenceResult?: SaveOperatorControlAuditResult | null;
  resolvedRole?: PdfImportResolvedRole | null;
  onExecuteMetadataControl?: (controlId: string, note?: string) => Promise<OperatorControlExecutionResult | null>;
  onEnableConsoleOption?: (controlId: string) => void;
}

/** Resolve the permission check for a control given the current role. */
function permissionForControl(
  control: OperatorControlAvailability,
  resolvedRole: PdfImportResolvedRole | null | undefined,
): PdfImportPermissionCheck | null {
  if (!resolvedRole) return null;
  const capability = getRequiredCapabilityForOperatorControl(control.controlId as OperatorControlId);
  if (!capability) return null;
  return evaluatePdfImportPermission({
    resolvedRole,
    capability,
    manualOnly: control.safetyLevel === 'manual_workflow',
    requiresConfirmation: control.requiresConfirmation,
  });
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

function ControlRow({
  control,
  busy,
  resolvedRole,
  onExecuteMetadataControl,
  onEnableConsoleOption,
}: {
  control: OperatorControlAvailability;
  busy: boolean;
  resolvedRole?: PdfImportResolvedRole | null;
  onExecuteMetadataControl?: (controlId: string, note?: string) => Promise<OperatorControlExecutionResult | null>;
  onEnableConsoleOption?: (controlId: string) => void;
}) {
  const isMetadata = control.safetyLevel === 'metadata_write';
  const isOrchestrator = control.safetyLevel === 'orchestrator_safe';
  const isBlocked = control.state === 'blocked' || control.state === 'disabled';
  const isManual = control.safetyLevel === 'manual_workflow' || control.state === 'manual_only';
  const isReadOnly = control.safetyLevel === 'read_only';

  const perm = permissionForControl(control, resolvedRole);
  const permDenied = perm?.decision === 'denied';
  const permAllowsAction = !perm || perm.decision === 'allowed' || perm.decision === 'requires_confirmation';

  return (
    <div className="rounded-md border bg-muted/20 p-2 text-xs space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-sm">{control.label}</span>
        <Badge variant={getOperatorControlStateTone(control.state)} className="text-[10px]">
          {getOperatorControlStateLabel(control.state)}
        </Badge>
        <Badge variant={getOperatorControlSafetyTone(control.safetyLevel)} className="text-[10px]">
          {getOperatorControlSafetyLabel(control.safetyLevel)}
        </Badge>
        {perm && (
          <Badge variant={getPdfImportPermissionDecisionTone(perm.decision)} className="text-[10px]">
            {getPdfImportPermissionDecisionLabel(perm.decision)}
          </Badge>
        )}
        {control.recommended && <Badge variant="secondary" className="text-[10px]">recommended</Badge>}
        {control.requiresConfirmation && <Badge variant="outline" className="text-[10px]">confirm</Badge>}
        <span className="ml-auto">
          {isMetadata && !isBlocked && permAllowsAction && onExecuteMetadataControl && (
            <Button size="sm" variant={control.recommended ? 'default' : 'outline'} disabled={busy}
              onClick={() => void onExecuteMetadataControl(control.controlId)}>
              Apply
            </Button>
          )}
          {isOrchestrator && !isBlocked && permAllowsAction && onEnableConsoleOption && (
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => onEnableConsoleOption(control.controlId)}>
              Enable in console
            </Button>
          )}
          {(isBlocked || permDenied) && <Badge variant="destructive" className="text-[10px]">unavailable</Badge>}
          {isManual && <Badge variant="outline" className="text-[10px]">manual</Badge>}
          {isReadOnly && <Badge variant="outline" className="text-[10px]">read only</Badge>}
        </span>
      </div>
      <div className="text-muted-foreground">{control.reason}</div>
      {permDenied && <div className="text-destructive">Your role does not allow this action.</div>}
      {control.blockedReason && (
        <div className="text-destructive">Blocked: {control.blockedReason}</div>
      )}
    </div>
  );
}

export function ProductionOperatorControlsPanel({
  audit,
  importId,
  persistenceResult,
  resolvedRole,
  onExecuteMetadataControl,
  onEnableConsoleOption,
}: ProductionOperatorControlsPanelProps) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const canAddNote = !resolvedRole
    || evaluatePdfImportPermission({ resolvedRole, capability: 'pdf_import.operator.add_note' }).allowed;

  if (!audit) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No production operator controls generated.
        </CardContent>
      </Card>
    );
  }

  const recommended = audit.controls.filter((c) => c.recommended);
  const others = audit.controls.filter((c) => !c.recommended);
  const blockedCount = audit.controls.filter((c) => c.state === 'blocked' || c.state === 'disabled').length;
  const manualCount = audit.controls.filter((c) => c.state === 'manual_only').length;
  const confirmCount = audit.controls.filter((c) => c.requiresConfirmation).length;

  const runNote = async () => {
    if (!onExecuteMetadataControl || !note.trim()) return;
    setBusy(true);
    try {
      await onExecuteMetadataControl('add_operator_note', note.trim());
      setNote('');
    } finally {
      setBusy(false);
    }
  };

  const wrapExecute = onExecuteMetadataControl
    ? async (controlId: string, n?: string) => {
        setBusy(true);
        try {
          return await onExecuteMetadataControl(controlId, n);
        } finally {
          setBusy(false);
        }
      }
    : undefined;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex flex-wrap items-center gap-2">
            Production operator controls
            <Badge variant={getOperatorDecisionTone(audit.operatorState.decision)}>
              {getOperatorDecisionLabel(audit.operatorState.decision)}
            </Badge>
            {audit.operatorState.manualReviewRequired && <Badge variant="secondary">Manual review required</Badge>}
            {audit.operatorState.blocked && <Badge variant="destructive">Blocked</Badge>}
            <Badge variant={audit.persistedAt ? 'default' : 'outline'}>
              {audit.persistedAt ? 'Persisted' : 'Not persisted'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            Controls are explicit and audited. Metadata controls only record operator decisions;
            orchestrator controls run through the console; AI/template-mutating and browser reruns are
            manual-only. Nothing here calls AI or mutates templates automatically.
          </div>
          <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
            <Row label="Import ID"><span className="font-mono text-xs">{text(audit.importId ?? importId)}</span></Row>
            <Row label="Template ID"><span className="font-mono text-xs">{text(audit.templateId)}</span></Row>
            <Row label="Last action">{text(audit.operatorState.lastActionId)}</Row>
            <Row label="Last action at">{text(audit.operatorState.lastActionAt)}</Row>
            <Row label="Generated at">{text(audit.generatedAt)}</Row>
            <Row label="Persisted at">{text(audit.persistedAt)}</Row>
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-center text-xs">
            <Stat label="Recommended" value={recommended.length} />
            <Stat label="Blocked/disabled" value={blockedCount} />
            <Stat label="Manual only" value={manualCount} />
            <Stat label="Needs confirm" value={confirmCount} />
          </div>
        </CardContent>
      </Card>

      {recommended.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Recommended controls ({recommended.length})</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-2">
            {recommended.map((c) => (
              <ControlRow key={c.controlId} control={c} busy={busy} resolvedRole={resolvedRole}
                onExecuteMetadataControl={wrapExecute} onEnableConsoleOption={onEnableConsoleOption} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">All controls ({others.length})</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-2">
          {others.map((c) => (
            <ControlRow key={c.controlId} control={c} busy={busy} resolvedRole={resolvedRole}
              onExecuteMetadataControl={wrapExecute} onEnableConsoleOption={onEnableConsoleOption} />
          ))}
        </CardContent>
      </Card>

      {onExecuteMetadataControl && canAddNote && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Add operator note</CardTitle></CardHeader>
          <CardContent className="pt-0 flex gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Operator note…" disabled={busy} />
            <Button variant="outline" disabled={busy || !note.trim()} onClick={() => void runNote()}>Save note</Button>
          </CardContent>
        </Card>
      )}
      {onExecuteMetadataControl && !canAddNote && (
        <div className="text-xs text-muted-foreground">Your role does not allow adding operator notes.</div>
      )}

      {audit.notes.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Notes ({audit.notes.length})</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <ul className="list-disc pl-4 text-xs space-y-0.5">{audit.notes.map((n, i) => <li key={i} className="break-all">{n}</li>)}</ul>
          </CardContent>
        </Card>
      )}

      {persistenceResult && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Operator control persistence</CardTitle></CardHeader>
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

export default ProductionOperatorControlsPanel;
