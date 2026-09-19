export type FinancePortalPermissionAction = 'view' | 'edit' | 'delete';

export function hasFinancePortalPermission(
  globalPermissions: unknown,
  assignmentPermissions: unknown,
  permissionKey: string,
  action: FinancePortalPermissionAction,
  defaultAllowWhenUnconfigured = false,
): boolean {
  const globalEntry = globalPermissions && typeof globalPermissions === 'object'
    ? (globalPermissions as Record<string, any>)[permissionKey]
    : undefined;
  const assignmentEntry = assignmentPermissions && typeof assignmentPermissions === 'object'
    ? (assignmentPermissions as Record<string, any>)[permissionKey]
    : undefined;

  if (globalEntry === undefined && assignmentEntry === undefined) {
    return defaultAllowWhenUnconfigured;
  }

  return globalEntry?.[action] === true || assignmentEntry?.[action] === true;
}
