/**
 * Shared permission checking utilities for Edge Functions
 * Validates that a user has the required module-level permissions (can_view, can_edit, can_delete)
 * before allowing mutations through the data mediation layer.
 * 
 * Superadmins bypass all checks. Service-role calls bypass all checks.
 */

/** Maps database table names to their governing module key */
const TABLE_TO_MODULE_MAP: Record<string, string> = {
  // Client-related tables → existing client_management module
  clients: 'client_management',
  client_properties: 'client_management',
  client_income: 'client_management',
  client_expenses: 'client_management',
  client_assets: 'client_management',
  client_liabilities: 'client_management',
  client_employment: 'client_management',
  client_notes: 'client_management',
  client_files: 'client_management',
  client_activities: 'client_management',
  client_additional_contacts: 'client_management',
  client_scores: 'client_management',
  client_income_sources: 'client_management',
  // manage-client-data accepts writes to this table, so leaving it unmapped
  // made every non-superadmin write fail closed with 'unmapped_table' — the
  // safe direction, but it silently broke address history for ordinary users.
  client_address_history: 'client_management',

  // Deal-related tables → deal_pipeline module
  client_deals: 'deal_pipeline',
  deal_stages: 'deal_pipeline',
  build_progress_payments: 'deal_pipeline',
  builder_invoices: 'deal_pipeline',

  // Report-related
  report_qa_messages: 'report_qa',
  report_qa_conversations: 'report_qa',
  portfolio_reviews: 'portfolio_reports',
  portfolio_analysis_reports: 'portfolio_reports',
  // A comparison is a derived view of two to five investment reports, so it is
  // governed by the same module they are. Nothing writes this table through
  // `checkPermission` today, so mapping it changes no behaviour — it stops the
  // day something does from falling through to `unmapped_table`.
  property_comparisons: 'reports',
  // The saved form of a cash flow comparison — a derived view of two to five
  // investment reports, so governed by the same module they are. Mapping it
  // changes no behaviour today: the table holds zero rows and nothing writes it
  // through `checkPermission`. It stops the day something does from falling
  // through to `unmapped_table`.
  cash_flow_analyses: 'reports',

  // Reminders
  client_reminders: 'reminders',

  // Marketing
  lead_source_attributions: 'marketing_analytics',

  // Portal
  portal_configuration: 'portal_config',
  client_portal_reports: 'reports',
  client_portal_report_requests: 'reports',

  // Agreements
  agency_agreements: 'agreements',

  // Checklists
  checklist_instances: 'checklists',
  checklist_instance_items: 'checklists',

  // Email
  email_copilot_emails: 'email_copilot',

  // Game plans
  game_plans: 'game_plans',

  // Automation
  auto_report_switches: 'automation',

  // Templates
  report_templates: 'templates',

  // Call logs
  vapi_call_logs: 'call_logs',

  // GHL Conversations
  ghl_conversations: 'conversations',
  ghl_conversation_messages: 'conversations',
};

/** Maps CRUD operations to the required permission flag */
const OPERATION_TO_PERMISSION: Record<string, 'can_view' | 'can_edit' | 'can_delete'> = {
  create: 'can_edit',
  update: 'can_edit',
  upsert: 'can_edit',
  delete: 'can_delete',
  bulkDelete: 'can_delete',
};

interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  moduleKey?: string;
}

/**
 * Check if a user has the required permission for a table operation.
 * 
 * @param supabase - Service-role Supabase client
 * @param userId - The authenticated user's ID
 * @param tableName - The database table being accessed
 * @param operation - The CRUD operation being performed
 * @param authMethod - How the user authenticated ('jwt' | 'session' | 'service_role')
 * @returns Whether the operation is allowed
 */
export async function checkPermission(
  supabase: any,
  userId: string,
  tableName: string,
  operation: string,
  authMethod?: string,
): Promise<PermissionCheckResult> {
  // Service-role calls always bypass permission checks (internal edge-function-to-edge-function)
  if (authMethod === 'service_role' || userId === 'service_role') {
    return { allowed: true };
  }

  // Check if user is superadmin (bypass all permission checks)
  const { data: superadminRole } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'superadmin')
    .maybeSingle();

  if (superadminRole) {
    return { allowed: true };
  }

  // Fail closed by default. Set LEGACY_PERMS_STRICT=false only for a temporary,
  // explicitly approved legacy compatibility window.
  const strict = (Deno.env.get('LEGACY_PERMS_STRICT') || 'true').toLowerCase() !== 'false';


  // Determine which module governs this table
  const moduleKey = TABLE_TO_MODULE_MAP[tableName];
  if (!moduleKey) {
    if (strict) {
      console.warn(`[permissions] Table "${tableName}" not mapped to any module (strict deny).`);
      return { allowed: false, reason: 'unmapped_table' };
    }
    console.log(`[permissions] Table "${tableName}" not mapped to any module, allowing (LEGACY_PERMS_STRICT=false)`);
    return { allowed: true };
  }

  // Determine required permission flag
  const requiredPerm = OPERATION_TO_PERMISSION[operation];
  if (!requiredPerm) {
    // Read operations (select/get) only need can_view, but manage-client-data is write-only
    // If operation isn't mapped, allow it (it's likely a read)
    return { allowed: true };
  }

  // Look up the module ID
  const { data: moduleData } = await supabase
    .from('dashboard_modules')
    .select('id')
    .eq('module_key', moduleKey)
    .eq('is_active', true)
    .maybeSingle();

  if (!moduleData) {
    if (strict) {
      console.warn(`[permissions] Module "${moduleKey}" not registered (strict deny).`);
      return { allowed: false, reason: 'unregistered_module' };
    }
    console.log(`[permissions] Module "${moduleKey}" not found in registry, allowing (LEGACY_PERMS_STRICT=false)`);
    return { allowed: true };
  }


  // Check the user's permission for this module
  const { data: userPerm } = await supabase
    .from('user_permissions')
    .select('can_view, can_edit, can_delete')
    .eq('user_id', userId)
    .eq('module_id', moduleData.id)
    .maybeSingle();

  if (!userPerm) {
    return {
      allowed: false,
      reason: `No permissions assigned for module "${moduleKey}"`,
      moduleKey,
    };
  }

  if (!userPerm[requiredPerm]) {
    const permLabel = requiredPerm.replace('can_', '');
    return {
      allowed: false,
      reason: `You do not have ${permLabel} permission for the "${moduleKey}" module`,
      moduleKey,
    };
  }

  return { allowed: true, moduleKey };
}

/**
 * Read-side gate: require can_view on a module identified directly by key.
 *
 * Used for storage READ operations (download/list/signedUrl) which previously
 * had no authorization at all — any authenticated user could read any object in
 * an allowed bucket. Semantics mirror checkPermission: service-role and
 * superadmin bypass; an unregistered module stays open (legacy compatibility);
 * a registered module requires an explicit can_view permission row.
 */
export async function checkModuleView(
  supabase: any,
  userId: string,
  moduleKey: string,
  authMethod?: string,
  requireRegistered = false,
): Promise<PermissionCheckResult> {
  if (authMethod === 'service_role' || userId === 'service_role') {
    return { allowed: true };
  }

  const { data: superadminRole } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'superadmin')
    .maybeSingle();
  if (superadminRole) return { allowed: true };

  const { data: moduleData } = await supabase
    .from('dashboard_modules')
    .select('id')
    .eq('module_key', moduleKey)
    .eq('is_active', true)
    .maybeSingle();
  if (!moduleData) {
    if (requireRegistered) {
      return { allowed: false, reason: `Module "${moduleKey}" is not registered`, moduleKey };
    }
    // Unregistered module → allow (don't break reads for modules not yet in the registry)
    return { allowed: true };
  }

  const { data: userPerm } = await supabase
    .from('user_permissions')
    .select('can_view')
    .eq('user_id', userId)
    .eq('module_id', moduleData.id)
    .maybeSingle();

  if (!userPerm || !userPerm.can_view) {
    return { allowed: false, reason: `You do not have view permission for "${moduleKey}"`, moduleKey };
  }
  return { allowed: true, moduleKey };
}

export { TABLE_TO_MODULE_MAP, OPERATION_TO_PERMISSION };
