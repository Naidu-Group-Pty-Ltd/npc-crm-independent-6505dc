import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders, createForbiddenResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { TemplateSchemaVersionError, validateAndMigrateTemplateSchemaVersion } from '../_shared/templateSchemaVersion.ts';
import { permForAction, requireModulePermission } from '../_shared/authz.ts';
import { insertGoesLive, validateReportTemplateInsert } from '../_shared/reportTemplateInsertGuard.pure.ts';

type TableName = 'report_structure_templates' | 'client_branding_profiles' | 'integration_configs' | 'depreciation_comps' | 'depreciation_estimator_runs' | 'charts' | 'chart_analysis' | 'chart_configurations' | 'global_report_settings' | 'finance_agent_contacts' | 'bulk_generation_jobs' | 'property_comparisons' | 'portfolio_analysis_templates' | 'checklist_templates' | 'checklist_template_sections' | 'checklist_template_items' | 'checklist_instances' | 'checklist_instance_items' | 'game_plans' | 'game_plan_phases' | 'game_plan_milestones' | 'game_plan_kpis' | 'game_plan_notes' | 'game_plan_actions' | 'custom_users' | 'cover_page_overlays' | 'report_templates' | 'report_template_versions' | 'report_template_selections' | 'comparison_analysis_templates' | 'workflows' | 'workflow_runs' | 'workflow_run_steps';

interface RequestBody {
  // Operation type
  operation: 'list' | 'get' | 'insert' | 'update' | 'upsert' | 'delete';
  
  // Target table
  table: TableName;
  
  // For get/update/delete operations
  recordId?: string;

  // Optional optimistic-concurrency guard for report_templates updates.
  expectedVersion?: number;
  
  // For list operations
  listOptions?: {
    select?: string;
    orderBy?: string;
    orderAsc?: boolean;
    limit?: number;
    filters?: Record<string, any>;
  };
  
  // For insert/update/upsert operations
  data?: Record<string, any> | Record<string, any>[];
  
  // For upsert operations
  onConflict?: string;
  
  session_token?: string;
}

const DEFAULT_SELECTS: Record<TableName, string> = {
  report_structure_templates: '*',
  client_branding_profiles: '*',
  integration_configs: '*',
  depreciation_comps: '*',
  depreciation_estimator_runs: 'id, created_at',
  charts: '*',
  chart_analysis: '*',
  chart_configurations: '*',
  global_report_settings: '*',
  finance_agent_contacts: '*',
  bulk_generation_jobs: '*',
  property_comparisons: '*',
  portfolio_analysis_templates: '*',
  checklist_templates: '*',
  checklist_template_sections: '*',
  checklist_template_items: '*',
  checklist_instances: '*',
  checklist_instance_items: '*',
  game_plans: '*',
  game_plan_phases: '*',
  game_plan_milestones: '*',
  game_plan_kpis: '*',
  game_plan_notes: '*',
  game_plan_actions: '*',
  custom_users: 'id, username, email, is_active',
  cover_page_overlays: '*',
  report_templates: '*',
  report_template_versions: '*',
  report_template_selections: '*',
  comparison_analysis_templates: '*',
  workflows: '*',
  workflow_runs: '*',
  workflow_run_steps: '*',
};

function normaliseTemplateSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  const s = JSON.parse(JSON.stringify(schema));
  // Phase 4: validate + migrate explicitly instead of stamping version=1.
  // Throws TemplateSchemaVersionError for invalid/future versions (→ 422).
  validateAndMigrateTemplateSchemaVersion(s);
  s.tokens = s.tokens && typeof s.tokens === 'object' ? s.tokens : { colors: {}, fonts: {}, spacing: {} };
  s.tokens.colors = s.tokens.colors && typeof s.tokens.colors === 'object' ? s.tokens.colors : {};
  s.tokens.fonts = s.tokens.fonts && typeof s.tokens.fonts === 'object' ? s.tokens.fonts : {};
  s.tokens.spacing = s.tokens.spacing && typeof s.tokens.spacing === 'object' ? s.tokens.spacing : {};
  s.slots = s.slots && typeof s.slots === 'object' ? s.slots : {};
  s.pages = Array.isArray(s.pages)
    ? s.pages.filter((page: unknown) => page !== null && typeof page === 'object' && !Array.isArray(page))
    : [];
  for (const page of s.pages) {
    page.blocks = Array.isArray(page.blocks)
      ? page.blocks.filter((block: unknown) => block !== null && typeof block === 'object' && !Array.isArray(block))
      : [];
    for (const block of page.blocks) {
      block.overlays = Array.isArray(block.overlays) ? block.overlays : [];
      for (const overlay of block.overlays) {
        if (overlay?.type !== 'text') continue;
        const weight = Number(overlay.fontWeight);
        overlay.fontWeight = overlay.fontWeight === 'bold' || (Number.isFinite(weight) && weight >= 600) ? 'bold' : 'normal';
        overlay.fontStyle = overlay.fontStyle === 'italic' ? 'italic' : 'normal';
        overlay.align = ['left', 'center', 'right', 'justify'].includes(overlay.align) ? overlay.align : 'left';
      }
    }
  }
  return s;
}

function normaliseTemplatePayload(table: TableName, payload: any): any {
  if (!payload || (table !== 'report_templates' && table !== 'report_template_versions')) return payload;
  const fix = (row: any) => row?.schema ? { ...row, schema: normaliseTemplateSchema(row.schema) } : row;
  return Array.isArray(payload) ? payload.map(fix) : fix(payload);
}

function containsReservedChecklistGenerationMetadata(table: TableName, payload: any): boolean {
  if (table !== 'checklist_instances' || !payload) return false;
  const rows = Array.isArray(payload) ? payload : [payload];
  return rows.some((row) => row?.generated_by === 'cron' || Object.prototype.hasOwnProperty.call(row ?? {}, 'recurrence_key'));
}

function jsonResponse(body: unknown, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const PRODUCTION_SAFE_BLOCK_TYPES = new Set([
  'free',
  'disclaimer',
  'hero',
  'kpi-grid',
  'data-table',
  'chart',
  'image',
  'text-block',
  'text',
  'footer',
  'cover',
  'divider',
  'callout',
  'two-column',
  'gallery',
  'page-number',
  'spacer',
  'qr',
  'badge-list',
  'toc',
  'signature',
  'slot',
  'scorecard',
  'risk-register',
  'infra-timeline',
  'amenity-matrix',
  'planning-table',
  'dd-checklist',
  'decision-box',
  'strengths-watch',
  'timeline',
  'swot',
  'gantt',
  'comparison',
  'stat-callout',
  'pull-quote',
  'faq',
  'pricing-card',
  'feature-list',
  'process-steps',
  'progress-bars',
  'map',
  'icon-grid',
  'testimonials',
  'ribbon',
  'metric-delta',
  'definition-list',
  'sparkline',
  'before-after',
  'image-text',
  'data-grid',
  'pivot-table',
  'chart-bar',
  'chart-stacked-bar',
  'chart-line',
  'chart-area',
  'chart-pie',
  'chart-donut',
  'chart-scatter',
  'chart-radar',
  'heatmap',
  'kpi-strip',
  'legend',
  'auto-toc',
  // Takes Markdown *source* and renders it itself through the programme's
  // escape-first renderer, so it cannot emit markup the author of the content
  // chose. That is what makes it admissible here: this list is a security
  // boundary, and a block that accepted rendered HTML would be a hole in it for
  // exactly the content least able to be trusted. See `markdownBlock.html.ts`.
  'markdown-block',
]);

function collectUnsupportedProductionBlocks(schema: any): Array<{ pageIndex: number; blockIndex: number; type: string }> {
  const pages = Array.isArray(schema?.pages) ? schema.pages : [];
  const issues: Array<{ pageIndex: number; blockIndex: number; type: string }> = [];
  pages.forEach((page: any, pageIndex: number) => {
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    blocks.forEach((block: any, blockIndex: number) => {
      const type = String(block?.type ?? '');
      if (!type || !PRODUCTION_SAFE_BLOCK_TYPES.has(type)) issues.push({ pageIndex, blockIndex, type: type || '(missing)' });
    });
  });
  return issues;
}

function validateProductionRendererSchema(schema: any, corsHeaders: Record<string, string>): Response | null {
  const unsupported = collectUnsupportedProductionBlocks(schema);
  if (unsupported.length === 0) return null;
  return jsonResponse({
    success: false,
    error: {
      code: 'template_renderer_blocked',
      message: 'Template contains block types without production HTML/WeasyPrint renderer support.',
      unsupportedBlocks: unsupported.slice(0, 20),
    },
  }, 422, corsHeaders);
}

async function getModulePermissionContext(supabase: any, userId: string, moduleKey: string) {
  if (userId === 'service_role') {
    return { isSuperadmin: true, canView: true, canEdit: true, canDelete: true };
  }

  const [{ data: user }, { data: roles }, { data: perms }] = await Promise.all([
    supabase.from('custom_users').select('role').eq('id', userId).maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', userId),
    supabase
      .from('user_permissions')
      .select('can_view, can_edit, can_delete, dashboard_modules(module_key)')
      .eq('user_id', userId),
  ]);

  const roleNames = (roles ?? []).map((r: any) => String(r.role));
  const userRole = String(user?.role ?? '');
  const isSuperadmin = roleNames.includes('superadmin') || userRole === 'super_admin' || userRole === 'superadmin';
  const modulePerm = (perms ?? []).find((p: any) => (p.dashboard_modules as any)?.module_key === moduleKey) ?? null;

  return {
    isSuperadmin,
    canView: isSuperadmin || !!modulePerm?.can_view,
    canEdit: isSuperadmin || !!modulePerm?.can_edit,
    canDelete: isSuperadmin || !!modulePerm?.can_delete,
  };
}

const getTemplatePermissionContext = (supabase: any, userId: string) =>
  getModulePermissionContext(supabase, userId, 'templates');

function applyReportTemplateReadScope(query: any, userId: string, isSuperadmin: boolean) {
  if (isSuperadmin || userId === 'service_role') return query;

  // There is currently no authoritative user-to-agency membership relation.
  // Never trust a caller-supplied agency_id: ordinary users may see global
  // templates and user-scoped templates that they own, while agency templates
  // remain available only to the authoritative superadmin control plane.
  return query.or(`scope.eq.global,and(scope.eq.user,owner_user_id.eq.${userId})`);
}

async function assertTemplatePermission(
  supabase: any,
  userId: string | null,
  authMethod: string | undefined,
  table: TableName,
  operation: RequestBody['operation'],
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  if (!userId) return createUnauthorizedResponse('Authentication required', corsHeaders);
  // A workflow can invoke any configured integration, so editing one is the same
  // privilege as editing the integrations themselves. Note that a table absent
  // from this map skips the permission check entirely — see the early return.
  const moduleKey = table.startsWith('checklist_')
    ? 'checklists'
    : table.startsWith('workflow')
      ? 'integrations'
      : table === 'report_templates' || table === 'report_template_versions'
        ? 'templates'
        : null;
  if (!moduleKey) return null;

  const permissions = await getModulePermissionContext(supabase, userId, moduleKey);
  const required = operation === 'delete'
    ? 'delete'
    : ['insert', 'update', 'upsert', 'rpc'].includes(operation)
      ? 'edit'
      : 'view';

  const allowed = required === 'delete'
    ? permissions.canDelete
    : required === 'edit'
      ? permissions.canEdit
      : permissions.canView;

  if (!allowed) {
    return createForbiddenResponse(`${moduleKey}:${required} permission required`, corsHeaders);
  }
  return null;
}

const LOCK_SAFE_TEMPLATE_UPDATE_KEYS = new Set([
  'approval_status',
  'locked_for_review',
  'locked_at',
  'locked_by',
  'is_active',
  'is_default',
]);

function isLockSafeTemplateUpdate(updateData: Record<string, any>): boolean {
  return Object.keys(updateData).every((key) => LOCK_SAFE_TEMPLATE_UPDATE_KEYS.has(key));
}

function willActivateTemplate(current: any, updateData: Record<string, any>): boolean {
  return updateData.is_active === true && current?.is_active !== true;
}

function willSetDefaultTemplate(current: any, updateData: Record<string, any>): boolean {
  return updateData.is_default === true && current?.is_default !== true;
}

const PRODUCTION_REPORT_TEMPLATE_TYPES = new Set([
  'investment',
  'compass',
  'investment_compass',
  'investment_report',
  'property_investment',
  // Borrowing Capacity gained a real adapter reading
  // `borrowing_capacity_assessments` — a typed 35-column table with 143 rows.
  // Both spellings are listed because this set matches the raw `report_type`
  // and does not run it through the client registry's alias map.
  'borrowing_capacity',
  'borrowing',
  // Portfolio Performance Review reads `portfolio_analysis_reports`.
  'portfolio',
  // Property Comparison Analysis reads `property_comparisons`, through the
  // normaliser its own render route uses.
  'comparison',
  // Client Details reads nine `client_*` tables through the normaliser the
  // format's own render route uses. `formara` is the legacy generator's name
  // for the same document and reaches the same adapter, so a template stored
  // under it is activatable rather than stranded.
  'client_details',
  'formara',
  // 10 Year Cash Flow reads the stored `financial_calculations.projections` on
  // `investment_reports`; `cash_flow_analyses` holds 0 rows by design. Its
  // adapter returns null for the 1,020 reports that store no series, so a
  // template being activatable for the type does not make every report render.
  'cashflow',
  'cash_flow',
  // Report Q&A reads `report_qa_conversations` / `report_qa_messages` through
  // the normaliser its own render route uses. Activatable since `markdown-block`
  // gave the vocabulary a way to set model-authored Markdown as structure; the
  // flowing route stays the default for a long transcript, because a template is
  // a fixed page sequence and carries the first exchanges.
  'qa',
  // Commercial & Industrial Capacity reads the stored calculation run through
  // the normaliser its own render route uses, and defers to that route's
  // `isReportable` so a template cannot produce a document the route refuses.
  'commercial_capacity',
  'commercial_industrial',
  // Market Intelligence reads `marketing_intelligence_reports` through the
  // normaliser its own route uses, so the three editorial strips are applied
  // before a word reaches a page.
  'market_intelligence',
]);

function normaliseReportTemplateType(reportType: unknown): string {
  return String(reportType ?? '').trim().toLowerCase();
}

function hasProductionReportTemplateAdapter(reportType: unknown): boolean {
  const key = normaliseReportTemplateType(reportType);
  return !!key && PRODUCTION_REPORT_TEMPLATE_TYPES.has(key);
}

async function validateReportTemplateUpdate(
  supabase: any,
  recordId: string,
  updateData: Record<string, any>,
  userId: string | null,
  corsHeaders: Record<string, string>,
): Promise<{ current: any; response: Response | null }> {
  const { data: current, error } = await supabase
    .from('report_templates')
    .select('id,name,report_type,approval_status,is_active,is_default,is_draft,locked_for_review,version,schema')
    .eq('id', recordId)
    .maybeSingle();

  if (error) {
    return {
      current: null,
      response: jsonResponse({ error: error.message }, 500, corsHeaders),
    };
  }
  if (!current) {
    return {
      current: null,
      response: jsonResponse({ error: 'Template not found' }, 404, corsHeaders),
    };
  }

  if (current.locked_for_review && !isLockSafeTemplateUpdate(updateData)) {
    return {
      current,
      response: jsonResponse({
        success: false,
        error: {
          code: 'template_locked_for_review',
          message: 'Template is locked for review. Unlock it before editing content or metadata.',
          currentVersion: current.version ?? null,
        },
      }, 423, corsHeaders),
    };
  }

  const nextSchema = updateData.schema ?? current.schema;
  if ((current.is_active || updateData.is_active === true || updateData.is_default === true) && updateData.schema !== undefined) {
    const rendererValidation = validateProductionRendererSchema(nextSchema, corsHeaders);
    if (rendererValidation) return { current, response: rendererValidation };
  }

  if (willActivateTemplate(current, updateData) || willSetDefaultTemplate(current, updateData)) {
    const rendererValidation = validateProductionRendererSchema(nextSchema, corsHeaders);
    if (rendererValidation) return { current, response: rendererValidation };

    const permissions = userId ? await getTemplatePermissionContext(supabase, userId) : { isSuperadmin: false };
    if (!permissions.isSuperadmin) {
      return {
        current,
        response: createForbiddenResponse('superadmin required to activate or set default report templates', corsHeaders),
      };
    }

    const nextApprovalStatus = String(updateData.approval_status ?? current.approval_status ?? 'draft');
    if (nextApprovalStatus !== 'approved') {
      return {
        current,
        response: jsonResponse({
          success: false,
          error: {
            code: 'template_activation_blocked',
            message: 'Template must be approved before it can be activated or set as default.',
            approvalStatus: nextApprovalStatus,
          },
        }, 422, corsHeaders),
      };
    }

    const nextReportType = updateData.report_type !== undefined ? updateData.report_type : current.report_type;
    if (!nextReportType) {
      return {
        current,
        response: jsonResponse({
          success: false,
          error: {
            code: 'template_activation_blocked',
            message: 'Template must have a report type before it can be activated or set as default.',
          },
        }, 422, corsHeaders),
      };
    }

    if (!hasProductionReportTemplateAdapter(nextReportType)) {
      return {
        current,
        response: jsonResponse({
          success: false,
          error: {
            code: 'template_activation_blocked',
            message: `Template report type "${nextReportType}" does not have a production Template Builder adapter yet.`,
            reportType: nextReportType,
          },
        }, 422, corsHeaders),
      };
    }
  }

  return { current, response: null };
}

async function validateReportTemplateDelete(
  supabase: any,
  recordId: string,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  const { data: current, error } = await supabase
    .from('report_templates')
    .select('id,is_active,locked_for_review')
    .eq('id', recordId)
    .maybeSingle();

  if (error) return jsonResponse({ error: error.message }, 500, corsHeaders);
  if (!current) return jsonResponse({ error: 'Template not found' }, 404, corsHeaders);

  if (current.is_active) {
    return jsonResponse({
      success: false,
      error: {
        code: 'template_delete_blocked',
        message: 'Active templates cannot be deleted. Deactivate the template before deleting it.',
      },
    }, 409, corsHeaders);
  }
  if (current.locked_for_review) {
    return jsonResponse({
      success: false,
      error: {
        code: 'template_locked_for_review',
        message: 'Template is locked for review. Unlock it before deleting it.',
      },
    }, 423, corsHeaders);
  }
  return null;
}

Deno.serve(async (req) => {
  // IMPORTANT: Declare corsHeaders BEFORE try block so it's available in catch
  const origin = req.headers.get('origin') || '';
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: RequestBody = await req.json();
    
    // SECURITY: Verify authentication
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[manage-templates] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    console.log(`[manage-templates] Authenticated user ${userId}, operation: ${body.operation}, table: ${body.table}`);

    const { operation, table, recordId, listOptions = {}, onConflict } = body;
    let data: any;
    try {
      data = normaliseTemplatePayload(table, body.data);
    } catch (schemaError) {
      if (schemaError instanceof TemplateSchemaVersionError) {
        return jsonResponse({ error: schemaError.message, code: 'unsupported_schema_version' }, 422, corsHeaders);
      }
      throw schemaError;
    }

    // Validate table
    const validTables: TableName[] = ['report_structure_templates', 'client_branding_profiles', 'integration_configs', 'depreciation_comps', 'depreciation_estimator_runs', 'charts', 'chart_analysis', 'chart_configurations', 'global_report_settings', 'finance_agent_contacts', 'bulk_generation_jobs', 'property_comparisons', 'portfolio_analysis_templates', 'checklist_templates', 'checklist_template_sections', 'checklist_template_items', 'checklist_instances', 'checklist_instance_items', 'game_plans', 'game_plan_phases', 'game_plan_milestones', 'game_plan_kpis', 'game_plan_notes', 'game_plan_actions', 'custom_users', 'cover_page_overlays', 'report_templates', 'report_template_versions', 'report_template_selections', 'comparison_analysis_templates', 'workflows', 'workflow_runs', 'workflow_run_steps'];
    if (!validTables.includes(table)) {
      return new Response(
        JSON.stringify({ error: `Invalid table: ${table}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const permissionError = await assertTemplatePermission(supabase, userId, authMethod, table, operation, corsHeaders);
    if (permissionError) return permissionError;

    const reportTemplatePermissions = table === 'report_templates'
      ? await getTemplatePermissionContext(supabase, userId!)
      : null;

    // Recurrence keys are an idempotency boundary owned exclusively by trusted
    // generation flows. This broker uses service-role access, so never allow a
    // caller to reserve an occurrence or impersonate the scheduled runner.
    if (['insert', 'update', 'upsert'].includes(operation) && containsReservedChecklistGenerationMetadata(table, data)) {
      return jsonResponse({ error: 'Checklist generation metadata is managed by trusted generation flows.' }, 400, corsHeaders);
    }

    // Comparison analysis templates are personal configurations. The function
    // uses a service-role client, so scope them explicitly rather than relying
    // on browser-side filters or service-role RLS bypass behaviour.
    const isComparisonTemplate = table === 'comparison_analysis_templates';
    if (isComparisonTemplate && ['get', 'update', 'delete'].includes(operation) && recordId) {
      const { data: ownedTemplate, error: ownershipError } = await supabase
        .from('comparison_analysis_templates').select('id').eq('id', recordId).eq('created_by', userId).maybeSingle();
      if (ownershipError || !ownedTemplate) {
        return jsonResponse({ error: 'Template not found or not accessible.' }, 404, corsHeaders);
      }
    }
    if (isComparisonTemplate && operation === 'insert' && data && !Array.isArray(data)) {
      data = { ...data, created_by: userId };
    }

    /**
     * "Which template do my Investment reports come out in?" — one answer per
     * person per format, and the same treatment comparison templates get above,
     * for the same reason: this client is service-role and bypasses RLS, so
     * ownership is enforced HERE rather than assumed from a policy.
     *
     * The owner is stamped from the verified session on every write and never
     * read off the payload, so `owner_user_id` in a request body is inert. Reads
     * are scoped the same way, so the list operation cannot enumerate anyone
     * else's choices even with no filter supplied.
     *
     * No module permission is required, deliberately. A selection is a
     * preference among templates somebody else already approved — a row is only
     * selectable because it is `is_active`, and reaching that state goes through
     * `validateReportTemplateUpdate` (superadmin, approved, production adapter,
     * schema renders). Choosing between approved templates is not an
     * authorisation decision, and gating it on `templates:edit` would mean the
     * people who generate reports could not choose which template they use.
     */
    const isTemplateSelection = table === 'report_template_selections';
    if (isTemplateSelection && ['get', 'update', 'delete'].includes(operation) && recordId) {
      const { data: ownedSelection, error: selectionOwnershipError } = await supabase
        .from('report_template_selections').select('id').eq('id', recordId).eq('owner_user_id', userId).maybeSingle();
      if (selectionOwnershipError || !ownedSelection) {
        return jsonResponse({ error: 'Template selection not found or not accessible.' }, 404, corsHeaders);
      }
    }
    if (isTemplateSelection && ['insert', 'upsert'].includes(operation) && data) {
      const stampOwner = (row: any) => {
        // `id` is dropped rather than trusted. An upsert names its conflict
        // target as (owner_user_id, report_type); a caller-supplied primary key
        // would be a second, unscoped way to address a row — someone else's.
        const { id: _ignored, ...rest } = (row ?? {}) as Record<string, unknown>;
        return { ...rest, owner_user_id: userId };
      };
      data = Array.isArray(data) ? data.map(stampOwner) : stampOwner(data);
    }

    // Handle list operation
    if (operation === 'list') {
      const { select = DEFAULT_SELECTS[table], orderBy = 'created_at', orderAsc = false, limit, filters } = listOptions;
      
      let query = supabase.from(table).select(select);

      if (isComparisonTemplate) query = query.eq('created_by', userId);
      // Never enumerable across users, whatever filters the caller supplies.
      if (isTemplateSelection) query = query.eq('owner_user_id', userId);
      if (table === 'report_templates') {
        query = applyReportTemplateReadScope(query, userId!, reportTemplatePermissions!.isSuperadmin);
      }
      
      // Apply filters
      if (filters) {
        for (const [key, value] of Object.entries(filters)) {
          if (value !== undefined && value !== null) {
            query = query.eq(key, value);
          }
        }
      }
      
      query = query.order(orderBy, { ascending: orderAsc });
      
      if (limit) {
        query = query.limit(limit);
      }
      
      const { data: records, error } = await query;
      
      if (error) {
        console.error(`[manage-templates] List error:`, error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: true, records, count: records?.length || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle get operation
    if (operation === 'get' && recordId) {
      let query = supabase
        .from(table)
        .select('*')
        .eq('id', recordId);

      if (table === 'report_templates') {
        query = applyReportTemplateReadScope(query, userId!, reportTemplatePermissions!.isSuperadmin);
      }

      const { data: record, error } = await query.single();
      
      if (error) {
        console.error(`[manage-templates] Get error:`, error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: error.code === 'PGRST116' ? 404 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: true, record }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle insert operation
    if (operation === 'insert' && data) {
      // Authorisation gate for report_templates. The update path has enforced
      // "superadmin AND approved AND has a production adapter" since Phase 4;
      // insert had no equivalent, so a caller with templates:edit could create
      // a row that was already is_active=true and have resolve_report_template()
      // pick it for live customer PDFs. Rules live in the pure module so they
      // are executed by the test suite, which also replays the exact payloads
      // the Builder's create and branch flows send to prove they are unaffected.
      if (table === 'report_templates') {
        const rows = Array.isArray(data) ? data : [data];
        for (const row of rows) {
          const problem = validateReportTemplateInsert(
            row ?? {},
            { isSuperadmin: !!reportTemplatePermissions?.isSuperadmin, userId },
            hasProductionReportTemplateAdapter,
          );
          if (problem) {
            return jsonResponse({
              success: false,
              error: { code: problem.code, message: problem.message, ...(problem.detail ?? {}) },
            }, problem.status, corsHeaders);
          }
        }
        // An insert that legitimately goes live must still render, exactly as
        // the update path requires before activation.
        for (const row of rows) {
          if (!insertGoesLive(row ?? {})) continue;
          const rendererValidation = validateProductionRendererSchema(row?.schema, corsHeaders);
          if (rendererValidation) return rendererValidation;
        }
      }

      // A batch insert cannot use .single() — PostgREST refuses to coerce more
      // than one row and the whole call fails even though every row was
      // written. Arrays therefore return `records`, single payloads `record`.
      const isBatch = Array.isArray(data);
      const inserted = isBatch
        ? await supabase.from(table).insert(data).select()
        : await supabase.from(table).insert(data).select().single();
      const { data: record, error } = inserted;

      if (error) {
        console.error(`[manage-templates] Insert error:`, error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify(
          isBatch
            ? { success: true, records: record, count: (record as any[])?.length ?? 0 }
            : { success: true, record }
        ),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle update operation
    if (operation === 'update' && recordId && data) {
      const expectedVersion = Number(body.expectedVersion);
      const shouldGuardVersion = table === 'report_templates' && Number.isFinite(expectedVersion);
      const updateData: any = { ...(data as any) };

      if (table === 'report_templates') {
        const validation = await validateReportTemplateUpdate(supabase, recordId, updateData, userId, corsHeaders);
        if (validation.response) return validation.response;
      }

      if (shouldGuardVersion) {
        updateData.version = Number.isFinite(Number(updateData.version))
          ? Number(updateData.version)
          : expectedVersion + 1;
      }

      let query = supabase
        .from(table)
        .update(updateData)
        .eq('id', recordId);

      if (shouldGuardVersion) {
        query = query.eq('version', expectedVersion);
      }

      const { data: records, error } = await query.select();
      
      if (error) {
        console.error(`[manage-templates] Update error:`, error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const record = Array.isArray(records) ? records[0] : records;
      if (shouldGuardVersion && !record) {
        const { data: current } = await supabase
          .from(table)
          .select('*')
          .eq('id', recordId)
          .maybeSingle();
        return jsonResponse({
          success: false,
          error: {
            code: 'version_conflict',
            message: 'Template changed on the server. Review the latest version before saving again.',
            expectedVersion,
            currentVersion: current?.version ?? null,
            current,
          },
        }, 409, corsHeaders);
      }
      
      return new Response(
        JSON.stringify({ success: true, record }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle upsert operation
    if (operation === 'upsert' && data) {
      const upsertOptions = onConflict ? { onConflict } : {};
      const { data: record, error } = await supabase
        .from(table)
        .upsert(data, upsertOptions)
        .select();
      
      if (error) {
        console.error(`[manage-templates] Upsert error:`, error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: true, records: record }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle delete operation
    if (operation === 'delete' && recordId) {
      if (table === 'report_templates') {
        const deleteValidation = await validateReportTemplateDelete(supabase, recordId, corsHeaders);
        if (deleteValidation) return deleteValidation;
      }

      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', recordId);
      
      if (error) {
        console.error(`[manage-templates] Delete error:`, error);
        return new Response(
          JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid operation or missing required parameters' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[manage-templates] Error:', error);
    // `error` is `unknown` in a catch binding, so reading `.message` off it was
    // the file's only type error. Narrowing here keeps `deno check` clean, which
    // matters because a deploy that type-checks the bundle refuses to ship
    // otherwise — and this is the broker 38 call sites depend on.
    const details = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
