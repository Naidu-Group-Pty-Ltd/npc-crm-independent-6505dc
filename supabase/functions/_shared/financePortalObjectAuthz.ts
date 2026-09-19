/** Object-level authorization for service-role-backed Finance Portal functions. */

import { hasFinancePortalPermission, type FinancePortalPermissionAction } from './finance-portal-permissions.ts';

export async function canAccessFinanceClient(
  supabase: any,
  financeUserId: string,
  clientId: string,
  purchaseFileId?: string | null,
  globalPermissions?: unknown,
  permissionKey?: string,
  action?: FinancePortalPermissionAction,
): Promise<boolean> {
  let query = supabase
    .from('finance_portal_client_assignments')
    .select('id, purchase_file_id, permissions')
    .eq('finance_user_id', financeUserId)
    .eq('client_id', clientId);

  if (purchaseFileId) {
    query = query.or(`purchase_file_id.is.null,purchase_file_id.eq.${purchaseFileId}`);
  }

  const { data, error } = await query.limit(1).maybeSingle();
  if (error || !data) return false;
  return !permissionKey || !action || hasFinancePortalPermission(
    globalPermissions,
    data.permissions,
    permissionKey,
    action,
    true,
  );
}

export async function canAccessPurchaseFile(
  supabase: any,
  financeUserId: string,
  purchaseFileId: string,
  globalPermissions?: unknown,
  permissionKey?: string,
  action?: FinancePortalPermissionAction,
): Promise<boolean> {
  const { data: file, error } = await supabase
    .from('purchase_files')
    .select('id, client_id, assigned_finance_user_id')
    .eq('id', purchaseFileId)
    .maybeSingle();

  if (error || !file) return false;
  if (file.assigned_finance_user_id === financeUserId) return true;
  return canAccessFinanceClient(
    supabase,
    financeUserId,
    file.client_id,
    purchaseFileId,
    globalPermissions,
    permissionKey,
    action,
  );
}

export async function canAccessPurchaseFileResource(
  supabase: any,
  financeUserId: string,
  table: string,
  resourceId: string,
  globalPermissions?: unknown,
  permissionKey?: string,
  action?: FinancePortalPermissionAction,
): Promise<boolean> {
  const { data: resource, error } = await supabase
    .from(table)
    .select('purchase_file_id')
    .eq('id', resourceId)
    .maybeSingle();

  return !error && !!resource?.purchase_file_id
    && canAccessPurchaseFile(
      supabase,
      financeUserId,
      resource.purchase_file_id,
      globalPermissions,
      permissionKey,
      action,
    );
}

export async function listAccessiblePurchaseFileIds(
  supabase: any,
  financeUserId: string,
): Promise<string[]> {
  const [{ data: assignments, error: assignmentError }, { data: owned, error: ownedError }] = await Promise.all([
    supabase
      .from('finance_portal_client_assignments')
      .select('client_id, purchase_file_id')
      .eq('finance_user_id', financeUserId),
    supabase
      .from('purchase_files')
      .select('id')
      .eq('assigned_finance_user_id', financeUserId),
  ]);
  if (assignmentError || ownedError) return [];

  const ids = new Set<string>((owned || []).map((file: any) => file.id));
  const scopedIds = (assignments || [])
    .map((assignment: any) => assignment.purchase_file_id)
    .filter(Boolean);
  scopedIds.forEach((id: string) => ids.add(id));

  const clientIds = (assignments || [])
    .filter((assignment: any) => !assignment.purchase_file_id)
    .map((assignment: any) => assignment.client_id);
  if (clientIds.length) {
    const { data: files } = await supabase.from('purchase_files').select('id').in('client_id', clientIds);
    (files || []).forEach((file: any) => ids.add(file.id));
  }
  return [...ids];
}
