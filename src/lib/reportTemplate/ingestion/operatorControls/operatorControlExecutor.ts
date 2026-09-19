/**
 * operatorControlExecutor — Phase 10G.
 *
 * Executes ONLY safe operator controls. Metadata decision controls produce a
 * metadata patch (operator state / notes) with no template mutation, AI call, or
 * pipeline execution. Orchestrator-safe controls are delegated to an injected
 * runner (or return not_supported). Manual-workflow controls return
 * manual_required; blocked controls return blocked. Confirmation is enforced.
 */
import {
  PRODUCTION_OPERATOR_CONTROL_AUDIT_VERSION,
  type OperatorControlExecutionRequest,
  type OperatorControlExecutionResult,
  type OperatorControlId,
  type OperatorDecisionState,
  type ProductionOperatorControlAudit,
  type ProductionOperatorState,
} from './operatorControlTypes';
import { getOperatorControlDefinition } from './operatorControlCatalog';
import { getRequiredCapabilityForOperatorControl } from './operatorControlRules';
import {
  evaluatePdfImportPermission,
  type PdfImportPermissionContext,
  type PdfImportResolvedRole,
} from '../operatorPermissions';

const DECISION_CONTROLS: Record<string, OperatorDecisionState> = {
  mark_not_reviewed: 'not_reviewed',
  mark_accepted: 'accepted',
  mark_accepted_with_warnings: 'accepted_with_warnings',
  mark_rejected: 'rejected',
  mark_needs_rerun: 'needs_rerun',
  mark_manual_review_required: 'manual_review_required',
  mark_blocked: 'blocked',
};

const METADATA_CONTROLS = new Set<OperatorControlId>([
  'mark_not_reviewed', 'mark_accepted', 'mark_accepted_with_warnings', 'mark_rejected',
  'mark_needs_rerun', 'mark_manual_review_required', 'mark_blocked', 'add_operator_note',
]);

function emptyState(): ProductionOperatorState {
  return {
    decision: 'not_reviewed',
    manualReviewRequired: false,
    blocked: false,
    acceptedAt: null,
    rejectedAt: null,
    lastActionId: null,
    lastActionAt: null,
  };
}

function baseAudit(request: OperatorControlExecutionRequest, generatedAt: string): ProductionOperatorControlAudit {
  return {
    version: PRODUCTION_OPERATOR_CONTROL_AUDIT_VERSION,
    importId: request.importId,
    templateId: request.templateId ?? null,
    sourceFilename: null,
    operatorState: emptyState(),
    controls: [],
    executedActions: [],
    notes: [],
    warnings: [],
    blockers: [],
    generatedAt,
    persistedAt: null,
  };
}

export function canExecuteOperatorControl(input: {
  request: OperatorControlExecutionRequest;
  currentAudit?: ProductionOperatorControlAudit | null;
}): { canExecute: boolean; reason?: string } {
  const { request } = input;
  const def = getOperatorControlDefinition(request.controlId);
  if (!def) return { canExecute: false, reason: 'unknown_control' };
  if (!request.importId) return { canExecute: false, reason: 'import_id_missing' };
  if (def.safetyLevel === 'blocked') return { canExecute: false, reason: 'control_blocked' };
  if (def.safetyLevel === 'manual_workflow') return { canExecute: false, reason: 'manual_workflow' };
  if (def.requiresConfirmation && request.operatorConfirmed !== true) {
    return { canExecute: false, reason: 'operator_confirmation_required' };
  }
  return { canExecute: true };
}

export function buildOperatorDecisionMetadataPatch(input: {
  request: OperatorControlExecutionRequest;
  currentAudit?: ProductionOperatorControlAudit | null;
  now?: () => Date;
}): {
  operatorState: ProductionOperatorState;
  notes: string[];
  metadataPatch: Record<string, unknown>;
} {
  const now = input.now ?? (() => new Date());
  const at = now().toISOString();
  const request = input.request;

  const current = input.currentAudit ?? baseAudit(request, at);
  const prevState = current.operatorState ?? emptyState();
  const notes = Array.isArray(current.notes) ? current.notes.slice() : [];

  const nextState: ProductionOperatorState = {
    ...prevState,
    lastActionId: request.controlId,
    lastActionAt: at,
  };

  const decision = DECISION_CONTROLS[request.controlId];
  if (decision) {
    nextState.decision = decision;
    if (decision === 'accepted' || decision === 'accepted_with_warnings') {
      nextState.acceptedAt = at;
      nextState.blocked = false;
    }
    if (decision === 'rejected') nextState.rejectedAt = at;
    if (decision === 'manual_review_required') nextState.manualReviewRequired = true;
    if (decision === 'blocked') nextState.blocked = true;
    if (decision === 'not_reviewed') {
      nextState.manualReviewRequired = false;
      nextState.blocked = false;
    }
  }

  const note = (request.note ?? '').trim();
  if (note && !notes.includes(note)) notes.push(note);

  const updatedAudit: ProductionOperatorControlAudit = {
    ...current,
    version: PRODUCTION_OPERATOR_CONTROL_AUDIT_VERSION,
    importId: request.importId,
    templateId: request.templateId ?? current.templateId ?? null,
    operatorState: nextState,
    notes,
    generatedAt: current.generatedAt ?? at,
    persistedAt: null,
  };

  return {
    operatorState: nextState,
    notes,
    metadataPatch: { production_operator_control_audit: updatedAudit },
  };
}

export async function executeOperatorControl(input: {
  request: OperatorControlExecutionRequest;
  currentAudit?: ProductionOperatorControlAudit | null;
  now?: () => Date;
  orchestratorRunner?: (request: unknown) => Promise<unknown>;
}): Promise<OperatorControlExecutionResult> {
  const now = input.now ?? (() => new Date());
  const executedAt = now().toISOString();
  const request = input.request;
  const def = getOperatorControlDefinition(request.controlId);

  const base = (
    status: OperatorControlExecutionResult['status'],
    message: string,
    metadataPatch?: Record<string, unknown> | null,
  ): OperatorControlExecutionResult => ({
    controlId: request.controlId,
    status,
    message,
    metadataPatch: metadataPatch ?? null,
    executedAt,
  });

  if (!def) return base('not_supported', `Unknown control: ${request.controlId}.`);
  if (!request.importId) return base('failed', 'Import ID is required.');

  // Phase 11B — second permission enforcement layer (beyond UI gating). When a
  // permission context/role is supplied, deny controls the role is not permitted
  // to perform before any safety/execution logic runs.
  if (request.permissionContext || request.resolvedRole) {
    const capability = getRequiredCapabilityForOperatorControl(request.controlId);
    if (capability) {
      const check = evaluatePdfImportPermission({
        context: request.permissionContext as PdfImportPermissionContext | undefined,
        resolvedRole: request.resolvedRole as PdfImportResolvedRole | undefined,
        capability,
        manualOnly: def.safetyLevel === 'manual_workflow',
      });
      if (check.decision === 'denied') {
        return base('blocked', check.reason || 'permission_denied');
      }
    }
  }

  if (def.safetyLevel === 'blocked') {
    return base('blocked', def.blockedReason ?? 'Control is blocked in Phase 10G.');
  }

  if (def.safetyLevel === 'manual_workflow') {
    return base('manual_required', def.manualReason ?? 'This control must be completed manually.');
  }

  if (def.requiresConfirmation && request.operatorConfirmed !== true) {
    return base('blocked', 'operator_confirmation_required');
  }

  // Metadata decision controls: produce a metadata patch only.
  if (METADATA_CONTROLS.has(request.controlId)) {
    const patch = buildOperatorDecisionMetadataPatch({
      request, currentAudit: input.currentAudit, now,
    });
    return base('completed', `Operator control ${request.controlId} recorded.`, patch.metadataPatch);
  }

  // Orchestrator-safe controls: only via injected runner.
  if (def.safetyLevel === 'orchestrator_safe') {
    if (!input.orchestratorRunner) {
      return base('not_supported', 'Orchestrator-safe controls run through the console; no runner was provided.');
    }
    try {
      await input.orchestratorRunner({ controlId: request.controlId, importId: request.importId, templateId: request.templateId ?? null });
      return base('completed', `Orchestrator control ${request.controlId} executed.`);
    } catch (err) {
      return base('failed', (err as Error).message);
    }
  }

  // Read-only controls are navigational; there is nothing to execute server-side.
  if (def.safetyLevel === 'read_only') {
    return base('completed', 'Read-only navigation control.');
  }

  return base('not_supported', `Control ${request.controlId} is not executable in Phase 10G.`);
}
