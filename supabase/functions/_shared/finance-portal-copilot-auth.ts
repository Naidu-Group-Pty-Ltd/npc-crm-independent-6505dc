import { hasFinancePortalPermission, type FinancePortalPermissionAction } from "./finance-portal-permissions.ts";

type Assignment = {
  permissions?: unknown;
  purchase_file_id?: string | null;
};

/**
 * A client-wide assignment applies to every purchase file for that client. A
 * deal-scoped assignment applies only to its named purchase file. Client-only
 * access therefore cannot be inherited from an unrelated deal assignment.
 */
export function hasCopilotObjectPermission(
  globalPermissions: unknown,
  assignments: Assignment[],
  purchaseFileId: string | null,
  action: FinancePortalPermissionAction,
): boolean {
  return assignments.some((assignment) => {
    const applies = purchaseFileId
      ? assignment.purchase_file_id == null || assignment.purchase_file_id === purchaseFileId
      : assignment.purchase_file_id == null;
    return applies && hasFinancePortalPermission(
      globalPermissions,
      assignment.permissions,
      "purchase_files",
      action,
      true,
    );
  });
}
