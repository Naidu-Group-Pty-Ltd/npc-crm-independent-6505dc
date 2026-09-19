type TemplateResyncPermissionContext = {
  templateOwnerId: string | null;
  requesterId: string;
  customUserRole?: string | null;
  assignedRoles?: string[];
  canEditTemplates?: boolean;
};

export function canResyncTemplate(context: TemplateResyncPermissionContext): boolean {
  if (context.requesterId === 'service_role') return true;
  if (context.templateOwnerId === context.requesterId) return true;

  const roles = new Set([
    context.customUserRole ?? '',
    ...(context.assignedRoles ?? []),
  ].map((role) => String(role).toLowerCase()));

  return roles.has('superadmin') || roles.has('super_admin') || context.canEditTemplates === true;
}

/** Re-establish the authorization boundary bypassed by service-role writes. */
export async function authorizeTemplateResync(
  admin: any,
  requesterId: string | null,
  templateId: string,
): Promise<{ allowed: boolean; exists: boolean }> {
  if (!requesterId) return { allowed: false, exists: false };

  const [{ data: template }, { data: user }, { data: roles }, { data: permissions }] = await Promise.all([
    admin.from('report_templates').select('id,created_by').eq('id', templateId).maybeSingle(),
    admin.from('custom_users').select('role').eq('id', requesterId).maybeSingle(),
    admin.from('user_roles').select('role').eq('user_id', requesterId),
    admin
      .from('user_permissions')
      .select('can_edit,dashboard_modules!inner(module_key)')
      .eq('user_id', requesterId)
      .eq('dashboard_modules.module_key', 'templates'),
  ]);

  if (!template) return { allowed: false, exists: false };

  return {
    exists: true,
    allowed: canResyncTemplate({
      requesterId,
      templateOwnerId: template.created_by ?? null,
      customUserRole: user?.role ?? null,
      assignedRoles: (roles ?? []).map((row: any) => String(row.role)),
      canEditTemplates: (permissions ?? []).some((row: any) => row.can_edit === true),
    }),
  };
}
