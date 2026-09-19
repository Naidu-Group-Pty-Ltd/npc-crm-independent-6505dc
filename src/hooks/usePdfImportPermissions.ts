/**
 * usePdfImportPermissions — Phase 11B.
 *
 * Resolves the current user's PDF import role and capability checks from the
 * existing app auth context (`useAuth`). Frontend permission checks improve UX;
 * backend enforcement (authentication, import ownership, RLS, admin guards in the
 * template-import-pdf Edge Function) remains the security boundary. This hook
 * makes no network calls and never surfaces raw tokens/claims.
 */
import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  resolvePdfImportOperatorRole,
  evaluatePdfImportPermission,
  type PdfImportCapability,
  type PdfImportPermissionCheck,
  type PdfImportPermissionContext,
  type PdfImportResolvedRole,
} from '@/lib/reportTemplate/ingestion/operatorPermissions';

export interface UsePdfImportPermissionsResult {
  resolvedRole: PdfImportResolvedRole;
  context: PdfImportPermissionContext;
  can: (capability: PdfImportCapability, opts?: { requiresConfirmation?: boolean; manualOnly?: boolean }) => PdfImportPermissionCheck;
  allows: (capability: PdfImportCapability) => boolean;
}

export function usePdfImportPermissions(): UsePdfImportPermissionsResult {
  const { user, isAdmin, roles } = useAuth();

  const context = useMemo<PdfImportPermissionContext>(() => ({
    userId: user?.id ?? null,
    isAuthenticated: !!user,
    profile: user ? { role: user.role, roles } : null,
    existingAdminGuard: isAdmin === true,
    serviceContext: false,
  }), [user, isAdmin, roles]);

  const resolvedRole = useMemo(() => resolvePdfImportOperatorRole(context), [context]);

  return useMemo(() => ({
    resolvedRole,
    context,
    can: (capability, opts) => evaluatePdfImportPermission({ resolvedRole, capability, ...opts }),
    allows: (capability) => evaluatePdfImportPermission({ resolvedRole, capability }).allowed,
  }), [resolvedRole, context]);
}

export default usePdfImportPermissions;
