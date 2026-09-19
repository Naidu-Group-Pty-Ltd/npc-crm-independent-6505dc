/**
 * PDF Extraction V3 · E11 — client-side capability derivation (UX only).
 *
 * IMPORTANT: hiding a control in the UI is NOT authorization. The server derives
 * the actor identity and re-authorizes every mutating action. These helpers only
 * decide what to SHOW, from a server-provided permission snapshot, so the UI does
 * not offer actions the server would reject.
 */
import type { PdfReviewCapabilitiesV1, LegacyState } from './contracts';

/** Server-provided, already-authorized permission snapshot for the current viewer. */
export interface ReviewPermissionSnapshot {
  authenticated: boolean;
  ownsImport: boolean;
  isStaff: boolean;
  isOperator: boolean;
  isAdmin: boolean;
  manualRepairConfigured: boolean;
}

/**
 * Derive UI capabilities from the server permission snapshot + legacy state.
 * Legacy imports never expose V3-only operator actions.
 */
export function deriveReviewCapabilities(
  perm: ReviewPermissionSnapshot,
  legacyState: LegacyState,
): PdfReviewCapabilitiesV1 {
  const canView = perm.authenticated && (perm.ownsImport || perm.isStaff || perm.isAdmin);
  const v3 = legacyState === 'v3-complete' || legacyState === 'v3-partial';
  const operator = canView && perm.isOperator;

  return {
    canReview: canView,
    canForceNative: operator && v3,
    canForceCrop: operator && v3,
    canForceRaster: operator && v3,
    canRestoreAutomatic: operator && v3,
    canRequestProviderRecovery: operator && v3,
    canRequestSameTargetRetry: operator && v3,
    // Manual AI repair only when a secure backend action exists; otherwise disabled.
    canManualRepair: operator && v3 && perm.manualRepairConfigured,
    canOpenEditor: canView,
    canAddNote: canView,
    isAdminDiagnostics: perm.isAdmin,
  };
}

/** Admin diagnostics require server-verified admin permission (never role-in-UI alone). */
export function canAccessAdminDiagnostics(perm: ReviewPermissionSnapshot): boolean {
  return perm.authenticated && perm.isAdmin;
}
