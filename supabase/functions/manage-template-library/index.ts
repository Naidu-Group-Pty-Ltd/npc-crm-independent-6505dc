/**
 * manage-template-library — the Template Library's only write path.
 *
 * Deliberately a separate function from `manage-templates`:
 *
 *  - `manage-templates` is the live Template Builder broker. Adding operations
 *    to it would put library code in the blast radius of every Builder save.
 *  - Its generic `insert` passes the caller's payload straight through to
 *    Postgres — `validateReportTemplateUpdate` is wired only into `update`. A
 *    client-built payload could therefore name its own `owner_user_id`,
 *    `scope` or `is_active`. Instantiation happens HERE, server-side, where the
 *    row is assembled from the verified session and the caller cannot influence
 *    a single safety-critical field.
 *
 * This module is the I/O shell only. Every decision — authorisation
 * requirements, derived facts, the publish gate, the working-copy payload —
 * lives in `_shared/templateLibraryCore.pure.ts` so it can be executed by the
 * test suite rather than merely scanned.
 *
 * Library entries are catalogue data and are never rows in `report_templates`.
 * See docs/architecture/adr/017-template-library-separation.md.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createUnauthorizedResponse,
  createCorsHeaders,
  createForbiddenResponse,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { requireModulePermission, requireSuperadmin } from '../_shared/authz.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  TemplateSchemaVersionError,
  validateAndMigrateTemplateSchemaVersion,
} from '../_shared/templateSchemaVersion.ts';
import {
  LIST_SELECT,
  buildNextVersionDraft,
  buildReportUseCopyPayload,
  buildWorkingCopyPayload,
  deriveEntryFacts,
  editRequiresNewVersion,
  matchesReportUseCopy,
  normaliseRequestedColourwayId,
  pickEditable,
  requiredAuthzFor,
  resolveRequestedColourway,
  slugify,
  statusForLifecycleOperation,
  validateEntryForReportUse,
  validateForPublish,
  validateWorkingCopyName,
  type LibraryOperation,
} from '../_shared/templateLibraryCore.pure.ts';

interface RequestBody {
  operation: LibraryOperation;
  entryId?: string;
  templateId?: string;
  filters?: {
    status?: string;
    category?: string;
    reportType?: string;
    includeUnpublished?: boolean;
  };
  name?: string;
  description?: string;
  /**
   * Colourway to bake into the working copy. Validated server-side against the
   * entry's own curated list — never trusted, and never used to select a
   * palette from another family.
   */
  colourwayId?: string;
  entry?: Record<string, unknown>;
  session_token?: string;
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function fail(
  code: string,
  message: string,
  status: number,
  cors: Record<string, string>,
  extra?: Record<string, unknown>,
): Response {
  return json({ success: false, error: { code, message, ...(extra ?? {}) } }, status, cors);
}

async function recordEvent(
  supabase: any,
  entryId: string,
  eventType: string,
  actorId: string | null,
  summary: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.from('template_library_events').insert({
      entry_id: entryId,
      event_type: eventType,
      actor_id: actorId,
      summary,
      metadata,
    });
  } catch (e) {
    // Governance telemetry must never fail the operation it is recording.
    console.warn('[manage-template-library] event insert failed:', (e as Error).message);
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body: RequestBody = await req.json();
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) return createUnauthorizedResponse(authError, corsHeaders);

    const operation = body.operation;
    const actor = { userId: userId ?? null, authMethod };

    // Deny-by-default. Anything not explicitly a read or an edit requires
    // superadmin, so a new operation is control-plane until lowered on purpose.
    const required = requiredAuthzFor(operation);
    const authz = required.kind === 'superadmin'
      ? await requireSuperadmin(supabase, actor)
      : await requireModulePermission(supabase, actor, 'templates', required.permission);
    if (!authz.ok) return createForbiddenResponse(authz.error ?? 'Not authorised', corsHeaders);

    const isSuperadmin = required.kind === 'superadmin'
      ? true
      : (await requireSuperadmin(supabase, actor)).ok;

    // ── list ────────────────────────────────────────────────────────────────
    if (operation === 'list') {
      let query = supabase.from('template_library_entries').select(LIST_SELECT);

      // Non-superadmins only ever see published entries, whatever they ask for.
      if (!isSuperadmin || !body.filters?.includeUnpublished) {
        query = query.eq('status', body.filters?.status ?? 'published');
      } else if (body.filters?.status) {
        query = query.eq('status', body.filters.status);
      }
      if (body.filters?.category) query = query.eq('category', body.filters.category);
      if (body.filters?.reportType) query = query.eq('report_type', body.filters.reportType);

      const { data: records, error } = await query.order('updated_at', { ascending: false });
      if (error) return json({ error: error.message }, 500, corsHeaders);
      return json({ success: true, records, count: records?.length ?? 0 }, 200, corsHeaders);
    }

    // ── get ─────────────────────────────────────────────────────────────────
    if (operation === 'get') {
      if (!body.entryId) return fail('missing_entry_id', 'entryId is required.', 400, corsHeaders);
      let query = supabase.from('template_library_entries').select('*').eq('id', body.entryId);
      if (!isSuperadmin) query = query.eq('status', 'published');

      const { data: record, error } = await query.maybeSingle();
      if (error) return json({ error: error.message }, 500, corsHeaders);
      if (!record) return fail('not_found', 'Template not found.', 404, corsHeaders);
      return json({ success: true, record }, 200, corsHeaders);
    }

    // ── instantiate ─────────────────────────────────────────────────────────
    if (operation === 'instantiate') {
      if (!body.entryId) return fail('missing_entry_id', 'entryId is required.', 400, corsHeaders);
      const nameProblem = validateWorkingCopyName(body.name);
      if (nameProblem) return fail(nameProblem.code, nameProblem.message, 400, corsHeaders);

      const { data: entry, error: entryErr } = await supabase
        .from('template_library_entries')
        .select('*')
        .eq('id', body.entryId)
        .eq('status', 'published')
        .maybeSingle();
      if (entryErr) return json({ error: entryErr.message }, 500, corsHeaders);
      if (!entry) return fail('not_found', 'Template not found or not published.', 404, corsHeaders);

      // Validate and migrate on the way OUT of the library, so a stale entry
      // can never inject an unsupported schema into the Builder's table.
      let schema: unknown;
      try {
        schema = validateAndMigrateTemplateSchemaVersion(
          JSON.parse(JSON.stringify(entry.schema ?? {})),
        );
      } catch (e) {
        if (e instanceof TemplateSchemaVersionError) {
          return fail('unsupported_schema_version', e.message, 422, corsHeaders);
        }
        throw e;
      }

      // Resolved from the entry's own curated list. A rejected id fails the
      // request rather than falling back to the default: a user who chose
      // Oxblood Night and silently received Gold on Obsidian would only find
      // out after opening the copy in the Builder.
      const { colourway, problem: colourwayProblem } =
        resolveRequestedColourway(entry, body.colourwayId);
      if (colourwayProblem) {
        return fail(colourwayProblem.code, colourwayProblem.message, 422, corsHeaders);
      }

      const insertPayload = buildWorkingCopyPayload({
        userId: userId!,
        name: String(body.name).trim(),
        description: body.description ? String(body.description).slice(0, 2000) : null,
        entry,
        schema,
        colourway,
      });

      const { data: created, error: insertErr } = await supabase
        .from('report_templates')
        .insert(insertPayload)
        .select('id,name,version')
        .single();
      if (insertErr) return json({ error: insertErr.message }, 500, corsHeaders);

      const { data: lineage, error: lineageErr } = await supabase
        .from('template_library_instantiations')
        .insert({
          entry_id: entry.id,
          entry_version_at_copy: entry.version,
          template_id: created.id,
          created_by_user_id: userId,
        })
        .select('id')
        .single();
      if (lineageErr) {
        console.warn('[manage-template-library] lineage insert failed:', lineageErr.message);
      }

      // Usage counters are telemetry; never fail a copy over them.
      await supabase
        .from('template_library_entries')
        .update({
          usage_count: (entry.usage_count ?? 0) + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', entry.id)
        .then(() => {}, () => {});

      // The working copy now exists, so template_audit_log's NOT NULL FK to
      // report_templates is satisfied.
      await supabase.from('template_audit_log').insert({
        template_id: created.id,
        actor_id: null,
        action: 'library_instantiated',
        summary: `Created from library template "${entry.name}" v${entry.version}`
          + (colourway ? ` in ${colourway.name}` : ''),
        metadata: {
          entry_id: entry.id,
          entry_version: entry.version,
          entry_slug: entry.slug,
          ...(colourway ? { colourway_id: colourway.id, colourway_name: colourway.name } : {}),
        },
      }).then(() => {}, () => {});

      await recordEvent(supabase, entry.id, 'instantiated', userId, `Copied as "${body.name}"`, {
        template_id: created.id,
        ...(colourway ? { colourway_id: colourway.id } : {}),
      });

      return json({
        success: true,
        templateId: created.id,
        instantiationId: lineage?.id ?? null,
        colourwayId: colourway?.id ?? null,
      }, 200, corsHeaders);
    }

    // ── use_for_reports (entry → selectable copy, reused when it exists) ────
    //
    // The picker's path from the library to a choice. Where `instantiate`
    // hands back an editing draft, this hands back a template the caller can
    // SELECT: active, approved, user-scoped — a row that affects nobody else's
    // documents. It is idempotent on (entry, entry version, colourway): asking
    // twice returns the same row, and the globally seeded masters are found
    // before any copy is made, so adopting the house default never mints a
    // private duplicate of it.
    if (operation === 'use_for_reports') {
      if (!body.entryId) return fail('missing_entry_id', 'entryId is required.', 400, corsHeaders);

      const { data: entry, error: entryErr } = await supabase
        .from('template_library_entries')
        .select('*')
        .eq('id', body.entryId)
        .eq('status', 'published')
        .maybeSingle();
      if (entryErr) return json({ error: entryErr.message }, 500, corsHeaders);
      if (!entry) return fail('not_found', 'Template not found or not published.', 404, corsHeaders);

      const useProblem = validateEntryForReportUse(entry);
      if (useProblem) return fail(useProblem.code, useProblem.message, 422, corsHeaders);

      // The default colourway is recorded as null — the authored palette,
      // unbaked — which is how the seeded global masters record it too. This is
      // NOT what `instantiate` does (it resolves the default and bakes it):
      // baking here would stamp the default's id into the lineage, the reuse
      // match below is keyed on that id, and "the default, explicitly" would
      // then mint a private duplicate of a template the user already has.
      const requestedColourwayId = normaliseRequestedColourwayId(entry, body.colourwayId);
      let colourway: ReturnType<typeof resolveRequestedColourway>['colourway'] = null;
      if (requestedColourwayId) {
        const resolved = resolveRequestedColourway(entry, requestedColourwayId);
        if (resolved.problem) {
          return fail(resolved.problem.code, resolved.problem.message, 422, corsHeaders);
        }
        colourway = resolved.colourway;
      }

      // Reuse before create. Global rows first — the house default outranks a
      // private duplicate of itself — then the caller's own copies, newest
      // first. The SQL narrows to this entry's descendants; the pure matcher
      // makes the version/colourway decision so the rule is testable.
      const { data: existingRows } = await supabase
        .from('report_templates')
        .select('id,name,scope,owner_user_id,is_active,is_draft,config')
        .eq('is_active', true)
        .eq('is_draft', false)
        .filter('config->libraryLineage->>entryId', 'eq', entry.id)
        .or(`scope.eq.global,and(scope.eq.user,owner_user_id.eq.${userId})`)
        .order('created_at', { ascending: false });

      const reusable = (existingRows ?? [])
        .filter((row: Record<string, unknown>) =>
          matchesReportUseCopy(row, entry, requestedColourwayId))
        .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
          (a.scope === 'global' ? 0 : 1) - (b.scope === 'global' ? 0 : 1));
      if (reusable.length > 0) {
        return json({
          success: true,
          templateId: reusable[0].id,
          reused: true,
          colourwayId: colourway?.id ?? null,
        }, 200, corsHeaders);
      }

      // Validate and migrate on the way out of the library, exactly as
      // `instantiate` does: a stale entry must not inject an unsupported
      // schema into the selectable set.
      let useSchema: unknown;
      try {
        useSchema = validateAndMigrateTemplateSchemaVersion(
          JSON.parse(JSON.stringify(entry.schema ?? {})),
        );
      } catch (e) {
        if (e instanceof TemplateSchemaVersionError) {
          return fail('unsupported_schema_version', e.message, 422, corsHeaders);
        }
        throw e;
      }

      const { data: created, error: insertErr } = await supabase
        .from('report_templates')
        .insert(buildReportUseCopyPayload({
          userId: userId!,
          entry,
          schema: useSchema,
          colourway,
        }))
        .select('id,name')
        .single();
      if (insertErr) return json({ error: insertErr.message }, 500, corsHeaders);

      const { data: lineage } = await supabase
        .from('template_library_instantiations')
        .insert({
          entry_id: entry.id,
          entry_version_at_copy: entry.version,
          template_id: created.id,
          created_by_user_id: userId,
        })
        .select('id')
        .single();

      await supabase.from('template_audit_log').insert({
        template_id: created.id,
        actor_id: null,
        action: 'library_instantiated',
        summary: `Adopted for report generation from library template "${entry.name}" v${entry.version}`
          + (colourway ? ` in ${colourway.name}` : ''),
        metadata: {
          entry_id: entry.id,
          entry_version: entry.version,
          entry_slug: entry.slug,
          purpose: 'report_generation',
          ...(colourway ? { colourway_id: colourway.id, colourway_name: colourway.name } : {}),
        },
      }).then(() => {}, () => {});

      await recordEvent(supabase, entry.id, 'instantiated', userId,
        `Adopted for report generation`, {
          template_id: created.id,
          purpose: 'report_generation',
          ...(colourway ? { colourway_id: colourway.id } : {}),
        });

      return json({
        success: true,
        templateId: created.id,
        reused: false,
        colourwayId: colourway?.id ?? null,
      }, 200, corsHeaders);
    }

    // ── promote (Builder template → library draft) ──────────────────────────
    if (operation === 'promote') {
      if (!body.templateId) {
        return fail('missing_template_id', 'templateId is required.', 400, corsHeaders);
      }

      const { data: source, error: srcErr } = await supabase
        .from('report_templates')
        .select('id,name,description,schema,config,custom_css,report_type,tier,variant,engine')
        .eq('id', body.templateId)
        .maybeSingle();
      if (srcErr) return json({ error: srcErr.message }, 500, corsHeaders);
      if (!source) return fail('not_found', 'Source template not found.', 404, corsHeaders);

      const overrides = pickEditable(body.entry);
      const name = String(overrides.name ?? source.name ?? 'Untitled template').slice(0, 200);
      const draft: Record<string, unknown> = {
        name,
        slug: slugify(name),
        version: 1,
        description: overrides.description ?? source.description ?? null,
        long_description: overrides.long_description ?? null,
        category: overrides.category ?? 'investment',
        report_type: overrides.report_type ?? source.report_type ?? null,
        tier: overrides.tier ?? source.tier ?? null,
        variant: overrides.variant ?? source.variant ?? null,
        industry: overrides.industry ?? [],
        tags: overrides.tags ?? [],
        style: overrides.style ?? null,
        page_size: overrides.page_size ?? 'A4',
        access_tier: overrides.access_tier ?? 'standard',
        schema: overrides.schema ?? source.schema ?? {},
        config: overrides.config ?? source.config ?? {},
        custom_css: overrides.custom_css ?? source.custom_css ?? null,
        engine: source.engine ?? 'weasyprint',
        status: 'draft',
        visibility: 'global',
        source_template_id: source.id,
        created_by_user_id: userId,
      };
      Object.assign(draft, deriveEntryFacts(draft));

      const { data: record, error } = await supabase
        .from('template_library_entries')
        .insert(draft)
        .select('*')
        .single();
      if (error) return json({ error: error.message }, 500, corsHeaders);

      await recordEvent(
        supabase, record.id, 'promoted', userId,
        `Promoted from Builder template "${source.name}"`,
        { source_template_id: source.id },
      );

      return json({ success: true, record }, 200, corsHeaders);
    }

    // ── save_draft ──────────────────────────────────────────────────────────
    if (operation === 'save_draft') {
      if (!body.entryId) return fail('missing_entry_id', 'entryId is required.', 400, corsHeaders);

      const { data: current, error: curErr } = await supabase
        .from('template_library_entries')
        .select('*')
        .eq('id', body.entryId)
        .maybeSingle();
      if (curErr) return json({ error: curErr.message }, 500, corsHeaders);
      if (!current) return fail('not_found', 'Entry not found.', 404, corsHeaders);

      const patch = pickEditable(body.entry);
      if (Object.keys(patch).length === 0) {
        return fail('nothing_to_update', 'No editable fields supplied.', 400, corsHeaders);
      }

      // Published entries are immutable: editing one forks the next version as
      // a draft, so copies already taken keep pointing at a fixed snapshot.
      if (editRequiresNewVersion(current.status)) {
        const next = buildNextVersionDraft(current, patch, userId ?? null);
        const { data: record, error } = await supabase
          .from('template_library_entries').insert(next).select('*').single();
        if (error) return json({ error: error.message }, 500, corsHeaders);
        await recordEvent(
          supabase, record.id, 'version_drafted', userId,
          `Draft v${record.version} created from published v${current.version}`,
          { previous_entry_id: current.id },
        );
        return json({ success: true, record, createdNewVersion: true }, 200, corsHeaders);
      }

      const merged = { ...current, ...patch };
      Object.assign(patch, deriveEntryFacts(merged));
      const { data: record, error } = await supabase
        .from('template_library_entries')
        .update(patch)
        .eq('id', body.entryId)
        .select('*')
        .single();
      if (error) return json({ error: error.message }, 500, corsHeaders);
      await recordEvent(supabase, record.id, 'draft_saved', userId, 'Draft updated', {
        fields: Object.keys(patch),
      });
      return json({ success: true, record, createdNewVersion: false }, 200, corsHeaders);
    }

    // ── publish ─────────────────────────────────────────────────────────────
    if (operation === 'publish') {
      if (!body.entryId) return fail('missing_entry_id', 'entryId is required.', 400, corsHeaders);

      const { data: entry, error: getErr } = await supabase
        .from('template_library_entries').select('*').eq('id', body.entryId).maybeSingle();
      if (getErr) return json({ error: getErr.message }, 500, corsHeaders);
      if (!entry) return fail('not_found', 'Entry not found.', 404, corsHeaders);
      if (entry.status === 'published') {
        return fail('already_published', 'Entry is already published.', 409, corsHeaders);
      }

      try {
        validateAndMigrateTemplateSchemaVersion(JSON.parse(JSON.stringify(entry.schema ?? {})));
      } catch (e) {
        if (e instanceof TemplateSchemaVersionError) {
          return fail('unsupported_schema_version', e.message, 422, corsHeaders);
        }
        throw e;
      }

      const problem = validateForPublish(entry);
      if (problem) {
        return fail(problem.code, problem.message, 422, corsHeaders, { detail: problem.detail });
      }

      const derived = deriveEntryFacts(entry);
      const { data: record, error } = await supabase
        .from('template_library_entries')
        .update({ ...derived, status: 'published', published_at: new Date().toISOString() })
        .eq('id', body.entryId)
        .select('*')
        .single();
      if (error) return json({ error: error.message }, 500, corsHeaders);

      // Publishing a newer version retires the previously published one in the
      // family. Older versions stay on disk, so rollback is republishing.
      await supabase
        .from('template_library_entries')
        .update({ status: 'deprecated', deprecated_at: new Date().toISOString() })
        .eq('family_id', record.family_id)
        .eq('status', 'published')
        .neq('id', record.id)
        .then(() => {}, () => {});

      await recordEvent(supabase, record.id, 'published', userId, `Published v${record.version}`, {
        production_ready: record.production_ready,
        brand_safe: record.brand_safe,
        page_count: record.page_count,
      });
      return json({ success: true, record }, 200, corsHeaders);
    }

    // ── deprecate / archive / restore ───────────────────────────────────────
    const lifecycleStatus = statusForLifecycleOperation(operation);
    if (lifecycleStatus) {
      if (!body.entryId) return fail('missing_entry_id', 'entryId is required.', 400, corsHeaders);

      const patch: Record<string, unknown> = { status: lifecycleStatus };
      if (operation === 'deprecate') patch.deprecated_at = new Date().toISOString();
      if (operation === 'restore') { patch.deprecated_at = null; patch.published_at = null; }

      const { data: record, error } = await supabase
        .from('template_library_entries')
        .update(patch)
        .eq('id', body.entryId)
        .select('*')
        .single();
      if (error) return json({ error: error.message }, 500, corsHeaders);

      await recordEvent(supabase, record.id, operation, userId, `Entry ${operation}d`, {});
      return json({ success: true, record }, 200, corsHeaders);
    }

    // ── events ──────────────────────────────────────────────────────────────
    if (operation === 'events') {
      if (!body.entryId) return fail('missing_entry_id', 'entryId is required.', 400, corsHeaders);
      const { data: records, error } = await supabase
        .from('template_library_events')
        .select('*')
        .eq('entry_id', body.entryId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return json({ error: error.message }, 500, corsHeaders);
      return json({ success: true, records }, 200, corsHeaders);
    }

    return fail('invalid_operation', `Unknown operation: ${String(operation)}`, 400, corsHeaders);
  } catch (error) {
    console.error('[manage-template-library] Error:', error);
    return json(
      { ...internalError(error, 'manage-template-library'), error: 'Internal server error' },
      500,
      corsHeaders,
    );
  }
});
