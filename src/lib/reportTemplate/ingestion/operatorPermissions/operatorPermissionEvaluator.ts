/**
 * operatorPermissionEvaluator — Phase 11B.
 *
 * Evaluates whether a resolved role may perform a capability. Deny-by-default:
 * unknown/unauthenticated roles receive no capabilities. `manualOnly` returns a
 * visibility-`allowed` check but execution layers must still never auto-execute.
 */
import { resolvePdfImportOperatorRole } from './operatorRoleResolver';
import { roleHasPdfImportCapability } from './operatorPermissionMatrix';
import type {
  PdfImportCapability,
  PdfImportPermissionCheck,
  PdfImportPermissionContext,
  PdfImportResolvedRole,
} from './operatorPermissionTypes';

function resolve(
  context?: PdfImportPermissionContext,
  resolvedRole?: PdfImportResolvedRole,
): PdfImportResolvedRole {
  if (resolvedRole) return resolvedRole;
  if (context) return resolvePdfImportOperatorRole(context);
  return {
    role: 'no_access',
    source: 'fallback',
    rawRoles: [],
    isAuthenticated: false,
    userId: null,
    reason: 'No permission context provided; denied by default.',
  };
}

export function evaluatePdfImportPermission(input: {
  context?: PdfImportPermissionContext;
  resolvedRole?: PdfImportResolvedRole;
  capability: PdfImportCapability;
  requiresConfirmation?: boolean;
  manualOnly?: boolean;
  blocked?: boolean;
  blockedReason?: string | null;
}): PdfImportPermissionCheck {
  const resolved = resolve(input.context, input.resolvedRole);
  const role = resolved.role;
  const hasCap = roleHasPdfImportCapability(role, input.capability);

  // 1. Blocked always wins.
  if (input.blocked === true) {
    return {
      capability: input.capability,
      decision: 'blocked',
      allowed: false,
      role,
      reason: input.blockedReason ?? 'Action is blocked.',
      requiresConfirmation: false,
      manualOnly: false,
    };
  }

  // 2. No capability → denied (deny by default).
  if (!hasCap) {
    return {
      capability: input.capability,
      decision: 'denied',
      allowed: false,
      role,
      reason: role === 'no_access'
        ? 'Unknown or unauthenticated role denied by default.'
        : `Role ${role} does not have capability ${input.capability}.`,
      requiresConfirmation: false,
      manualOnly: false,
    };
  }

  // 3. Has capability but manual-only → allowed for visibility/manual workflow.
  if (input.manualOnly === true) {
    return {
      capability: input.capability,
      decision: 'manual_only',
      allowed: true,
      role,
      reason: 'Permitted, but this action is manual-only and requires an explicit manual workflow.',
      requiresConfirmation: false,
      manualOnly: true,
    };
  }

  // 4. Has capability, requires confirmation.
  if (input.requiresConfirmation === true) {
    return {
      capability: input.capability,
      decision: 'requires_confirmation',
      allowed: true,
      role,
      reason: `Role ${role} may perform this action with confirmation.`,
      requiresConfirmation: true,
      manualOnly: false,
    };
  }

  // 5. Allowed.
  return {
    capability: input.capability,
    decision: 'allowed',
    allowed: true,
    role,
    reason: `Role ${role} is allowed capability ${input.capability}.`,
    requiresConfirmation: false,
    manualOnly: false,
  };
}

export function evaluatePdfImportPermissions(input: {
  context?: PdfImportPermissionContext;
  resolvedRole?: PdfImportResolvedRole;
  capabilities: PdfImportCapability[];
}): PdfImportPermissionCheck[] {
  const resolvedRole = resolve(input.context, input.resolvedRole);
  return input.capabilities.map((capability) =>
    evaluatePdfImportPermission({ resolvedRole, capability }),
  );
}

export function requirePdfImportCapability(input: {
  context?: PdfImportPermissionContext;
  resolvedRole?: PdfImportResolvedRole;
  capability: PdfImportCapability;
}): { ok: boolean; check: PdfImportPermissionCheck } {
  const check = evaluatePdfImportPermission({
    context: input.context,
    resolvedRole: input.resolvedRole,
    capability: input.capability,
  });
  // `ok` means it may proceed automatically — manual_only and blocked are not ok.
  return { ok: check.decision === 'allowed' || check.decision === 'requires_confirmation', check };
}

export function getPdfImportPermissionDeniedMessage(check: PdfImportPermissionCheck): string {
  switch (check.decision) {
    case 'blocked':
      return check.reason || 'This action is blocked.';
    case 'manual_only':
      return 'This action is manual-only and must be completed through the existing manual workflow.';
    case 'denied':
      return check.reason || 'Your role does not allow this action.';
    default:
      return '';
  }
}
