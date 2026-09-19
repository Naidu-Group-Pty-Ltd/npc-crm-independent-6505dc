// report-engine-inspector
// Superadmin-only read API for the report generation observability tables.
// Operations: list_runs, get_run (with chunks), get_chunk, recent_for_report,
// list_proposals, list_audit.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { PROMPT_CATALOG, getPromptCatalogEntry } from '../_shared/engine-prompts.ts';
import { COMPASS_40_SECTIONS } from '../_shared/compassSectionRegistry.ts';
import { FIN_SECTION_ORDER, PLDD_SECTION_ORDER } from '../_shared/reportSplitRegistry.ts';
import { buildNewTemplateRow } from './templateProposal.ts';
import { internalError } from '../_shared/errorResponse.ts';

async function isSuperadmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'superadmin')
    .maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(url, key);

    const body = await req.json().catch(() => ({}));
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) return createUnauthorizedResponse(authError || 'auth required', corsHeaders);

    if (!(await isSuperadmin(supabase, userId))) {
      return createForbiddenResponse('superadmin only', corsHeaders);
    }

    const rawOp = String(body?.op || body?.operation || body?.action || body?.type || '').trim();
    const opAliases: Record<string, string> = {
      listPrompts: 'list_prompts',
      upsertPrompt: 'upsert_prompt',
      deletePrompt: 'delete_prompt',
      exportPrompts: 'export_prompts',
      importPrompts: 'import_prompts',
    };
    const op = opAliases[rawOp] || rawOp;

    switch (op) {
      case 'list_runs': {
        const limit = Math.min(Number(body.limit ?? 50), 200);
        const filter = supabase
          .from('report_generation_runs')
          .select('id, report_id, scope, variant, model, status, total_prompt_tokens, total_completion_tokens, total_cost_cents, started_at, finished_at, trigger_source, error, data_packet_size_bytes')
          .order('started_at', { ascending: false })
          .limit(limit);
        if (body.report_id) filter.eq('report_id', body.report_id);
        if (body.status) filter.eq('status', body.status);
        if (body.scope) filter.eq('scope', body.scope);
        const { data, error } = await filter;
        if (error) throw error;
        return json({ runs: data ?? [] }, corsHeaders);
      }

      case 'get_run': {
        const runId = String(body.run_id || '');
        if (!runId) return json({ error: 'run_id required' }, corsHeaders, 400);
        const [{ data: run, error: rErr }, { data: chunks, error: cErr }] = await Promise.all([
          supabase.from('report_generation_runs').select('*').eq('id', runId).maybeSingle(),
          supabase.from('report_generation_chunks').select('*').eq('run_id', runId).order('ordinal', { ascending: true }),
        ]);
        if (rErr) throw rErr;
        if (cErr) throw cErr;
        return json({ run, chunks: chunks ?? [] }, corsHeaders);
      }

      case 'get_chunk': {
        const id = String(body.chunk_id || '');
        const { data, error } = await supabase.from('report_generation_chunks').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return json({ chunk: data }, corsHeaders);
      }

      case 'list_proposals': {
        const status = body.status || null;
        const q = supabase
          .from('report_engine_proposals')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        if (status) q.eq('status', status);
        const { data, error } = await q;
        if (error) throw error;
        return json({ proposals: data ?? [] }, corsHeaders);
      }

      case 'list_audit': {
        const { data, error } = await supabase
          .from('report_engine_audit')
          .select('*')
          .order('performed_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        return json({ audit: data ?? [] }, corsHeaders);
      }

      case 'apply_proposal': {
        const proposalId = String(body.proposal_id || '');
        const { data: prop, error: pErr } = await supabase
          .from('report_engine_proposals').select('*').eq('id', proposalId).maybeSingle();
        if (pErr) throw pErr;
        if (!prop || prop.status !== 'pending') {
          return json({ error: 'proposal not pending' }, corsHeaders, 400);
        }

        let appliedOk = false;
        let appliedErr: string | null = null;
        let newTargetId: string | null = prop.target_id;

        try {
          if (prop.target_kind === 'report_structure_template' && prop.target_id) {
            const { error } = await supabase
              .from('report_structure_templates')
              .update(prop.after_value || {})
              .eq('id', prop.target_id);
            if (error) throw error;
            appliedOk = true;
          } else if (prop.target_kind === 'report_structure_template_new') {
            const row = buildNewTemplateRow(prop.after_value, userId, proposalId);
            const { data: ins, error } = await supabase
              .from('report_structure_templates').insert(row).select('id').single();
            if (error) throw error;
            newTargetId = ins?.id ?? null;
            appliedOk = true;
          } else if (prop.target_kind === 'engine_config') {
            const payload = prop.after_value || {};
            const config_key = payload.config_key;
            const scope = payload.scope || 'global';
            if (!config_key) throw new Error('engine_config proposal missing config_key');
            const { error } = await supabase
              .from('report_engine_config')
              .upsert({
                config_key, scope, value: payload.value ?? null,
                description: payload.description ?? null, updated_by: userId,
              }, { onConflict: 'config_key,scope' });
            if (error) throw error;
            appliedOk = true;
          } else if (prop.target_kind === 'report_manual_overrides' && prop.target_id) {
            // Shallow-merge patch into existing manual_overrides (null value deletes key).
            const { data: cur } = await supabase
              .from('investment_reports').select('manual_overrides').eq('id', prop.target_id).maybeSingle();
            const existing = (cur?.manual_overrides && typeof cur.manual_overrides === 'object') ? cur.manual_overrides : {};
            const patch = (prop.after_value?.patch && typeof prop.after_value.patch === 'object') ? prop.after_value.patch : {};
            const merged: Record<string, any> = { ...existing };
            for (const [k, v] of Object.entries(patch)) {
              if (v === null) delete merged[k];
              else merged[k] = v;
            }
            const { error } = await supabase
              .from('investment_reports').update({ manual_overrides: merged }).eq('id', prop.target_id);
            if (error) throw error;
            appliedOk = true;
          } else {
            throw new Error(`unknown target_kind: ${prop.target_kind}`);
          }
        } catch (e: any) {
          appliedErr = e?.message || String(e);
        }

        await supabase.from('report_engine_proposals').update({
          status: appliedOk ? 'applied' : 'failed',
          applied_by_user: userId,
          applied_at: new Date().toISOString(),
          rejection_reason: appliedErr,
          target_id: newTargetId,
        }).eq('id', proposalId);

        if (appliedOk) {
          await supabase.from('report_engine_audit').insert({
            proposal_id: proposalId,
            target_kind: prop.target_kind,
            target_id: newTargetId,
            before_value: prop.before_value,
            after_value: prop.after_value,
            performed_by: userId,
            rationale: prop.rationale,
          });
        }

        return json({ ok: appliedOk, error: appliedErr, target_id: newTargetId }, corsHeaders);
      }

      case 'reject_proposal': {
        const proposalId = String(body.proposal_id || '');
        const { error } = await supabase.from('report_engine_proposals').update({
          status: 'rejected',
          rejected_at: new Date().toISOString(),
          rejection_reason: body.reason ?? null,
        }).eq('id', proposalId);
        if (error) throw error;
        return json({ ok: true }, corsHeaders);
      }

      case 'list_engine_config': {
        const q = supabase.from('report_engine_config').select('*')
          .order('config_key').order('scope');
        if (body.config_key) q.eq('config_key', body.config_key);
        if (body.scope) q.eq('scope', body.scope);
        const { data, error } = await q;
        if (error) throw error;
        return json({ configs: data ?? [] }, corsHeaders);
      }

      case 'upsert_engine_config': {
        // Direct superadmin edit (UI form), no proposal staging.
        const { config_key, scope = 'global', value, description } = body;
        if (!config_key) return json({ error: 'config_key required' }, corsHeaders, 400);
        const { data: before } = await supabase
          .from('report_engine_config').select('*')
          .eq('config_key', config_key).eq('scope', scope).maybeSingle();
        const { error } = await supabase.from('report_engine_config').upsert({
          config_key, scope, value: value ?? null, description: description ?? null, updated_by: userId,
        }, { onConflict: 'config_key,scope' });
        if (error) throw error;
        await supabase.from('report_engine_audit').insert({
          proposal_id: null,
          target_kind: 'engine_config',
          target_id: `${config_key}:${scope}`,
          before_value: before ?? null,
          after_value: { config_key, scope, value },
          performed_by: userId,
          rationale: body.rationale || 'direct edit',
        });
        return json({ ok: true }, corsHeaders);
      }

      case 'delete_engine_config': {
        const { config_key, scope = 'global' } = body;
        if (!config_key) return json({ error: 'config_key required' }, corsHeaders, 400);
        const { data: before } = await supabase
          .from('report_engine_config').select('*')
          .eq('config_key', config_key).eq('scope', scope).maybeSingle();
        const { error } = await supabase.from('report_engine_config')
          .delete().eq('config_key', config_key).eq('scope', scope);
        if (error) throw error;
        if (before) {
          await supabase.from('report_engine_audit').insert({
            proposal_id: null, target_kind: 'engine_config',
            target_id: `${config_key}:${scope}`,
            before_value: before, after_value: null,
            performed_by: userId, rationale: body.rationale || 'direct delete',
          });
        }
        return json({ ok: true }, corsHeaders);
      }

      case 'list_prompts': {
        // Return the full catalog joined with any overrides currently in DB.
        const keys = PROMPT_CATALOG.map((p) => `prompt:${p.key}`);
        const { data: overrides } = await supabase
          .from('report_engine_config')
          .select('config_key, scope, value, description, updated_at, updated_by')
          .in('config_key', keys);
        const byKey = new Map<string, any>();
        for (const o of overrides ?? []) {
          if (o.scope === 'default') byKey.set(o.config_key, o);
        }
        const prompts = PROMPT_CATALOG.map((p) => {
          const ov = byKey.get(`prompt:${p.key}`);
          const overrideText = ov
            ? (typeof ov.value === 'string' ? ov.value : ov.value?.text ?? ov.value?.value ?? null)
            : null;
          return {
            key: p.key,
            label: p.label,
            family: p.family,
            function: p.function,
            description: p.description,
            tokens: p.tokens ?? [],
            default: p.default,
            override: overrideText,
            has_override: !!ov,
            updated_at: ov?.updated_at ?? null,
            override_description: ov?.description ?? null,
          };
        });
        return json({ prompts }, corsHeaders);
      }

      case 'upsert_prompt': {
        const key = String(body.key || '');
        const entry = getPromptCatalogEntry(key);
        if (!entry) return json({ error: `unknown prompt key: ${key}` }, corsHeaders, 400);
        const text = body.text;
        if (typeof text !== 'string' || !text.trim()) {
          return json({ error: 'text required (non-empty string)' }, corsHeaders, 400);
        }
        const config_key = `prompt:${key}`;
        const { data: before } = await supabase
          .from('report_engine_config').select('*')
          .eq('config_key', config_key).eq('scope', 'default').maybeSingle();
        const { error } = await supabase.from('report_engine_config').upsert({
          config_key,
          scope: 'default',
          value: text,
          description: body.description ?? entry.label,
          updated_by: userId,
        }, { onConflict: 'config_key,scope' });
        if (error) throw error;
        await supabase.from('report_engine_audit').insert({
          proposal_id: null,
          target_kind: 'prompt_override',
          target_id: key,
          before_value: before ?? null,
          after_value: { key, text, description: body.description ?? null },
          performed_by: userId,
          rationale: body.rationale || 'direct prompt edit',
        });
        return json({ ok: true }, corsHeaders);
      }

      case 'delete_prompt': {
        const key = String(body.key || '');
        const entry = getPromptCatalogEntry(key);
        if (!entry) return json({ error: `unknown prompt key: ${key}` }, corsHeaders, 400);
        const config_key = `prompt:${key}`;
        const { data: before } = await supabase
          .from('report_engine_config').select('*')
          .eq('config_key', config_key).eq('scope', 'default').maybeSingle();
        const { error } = await supabase.from('report_engine_config').delete()
          .eq('config_key', config_key).eq('scope', 'default');
        if (error) throw error;
        if (before) {
          await supabase.from('report_engine_audit').insert({
            proposal_id: null, target_kind: 'prompt_override', target_id: key,
            before_value: before, after_value: null,
            performed_by: userId, rationale: body.rationale || 'reverted to default',
          });
        }
        return json({ ok: true }, corsHeaders);
      }

      case 'export_prompts': {
        const keys = PROMPT_CATALOG.map((p) => `prompt:${p.key}`);
        const { data: overrides } = await supabase
          .from('report_engine_config')
          .select('config_key, value, description, updated_at')
          .in('config_key', keys);
        const out: Record<string, any> = {};
        for (const o of overrides ?? []) {
          const k = (o.config_key as string).replace(/^prompt:/, '');
          out[k] = { text: typeof o.value === 'string' ? o.value : o.value?.text ?? o.value?.value ?? null, description: o.description, updated_at: o.updated_at };
        }
        return json({ exported_at: new Date().toISOString(), prompts: out }, corsHeaders);
      }

      case 'import_prompts': {
        const incoming = body.prompts;
        if (!incoming || typeof incoming !== 'object') {
          return json({ error: 'prompts object required' }, corsHeaders, 400);
        }
        const results: Array<{ key: string; ok: boolean; error?: string }> = [];
        for (const [key, raw] of Object.entries(incoming)) {
          const entry = getPromptCatalogEntry(key);
          if (!entry) { results.push({ key, ok: false, error: 'unknown key' }); continue; }
          const text = typeof raw === 'string' ? raw : (raw as any)?.text;
          if (!text || typeof text !== 'string') { results.push({ key, ok: false, error: 'invalid text' }); continue; }
          const { error } = await supabase.from('report_engine_config').upsert({
            config_key: `prompt:${key}`, scope: 'default', value: text,
            description: (raw as any)?.description ?? entry.label, updated_by: userId,
          }, { onConflict: 'config_key,scope' });
          if (error) { results.push({ key, ok: false, error: error.message }); continue; }
          results.push({ key, ok: true });
        }
        await supabase.from('report_engine_audit').insert({
          proposal_id: null, target_kind: 'prompt_import', target_id: null,
          before_value: null, after_value: { count: results.filter((r) => r.ok).length, results },
          performed_by: userId, rationale: body.rationale || 'bulk import',
        });
        return json({ results }, corsHeaders);
      }

      case 'resolve_templates': {
        // Input: { template_ids: string[] } accepts raw UUIDs or "template:<uuid>".
        const raw: any[] = Array.isArray(body.template_ids) ? body.template_ids : [];
        const ids = Array.from(new Set(raw
          .map((v) => String(v || '').replace(/^template:/, '').trim())
          .filter((v) => /^[0-9a-f-]{36}$/i.test(v))));
        if (ids.length === 0) return json({ templates: [] }, corsHeaders);
        const { data, error } = await supabase
          .from('report_structure_templates')
          .select('id, name, template_type, report_tier, report_category, is_active, priority')
          .in('id', ids);
        if (error) throw error;
        return json({ templates: data ?? [] }, corsHeaders);
      }

      case 'get_report_overrides': {
        // Pre-gen overrides + best-effort post-gen audit entries for a report.
        const reportId = String(body.report_id || '');
        if (!reportId) return json({ error: 'report_id required' }, corsHeaders, 400);
        const { data: report } = await supabase
          .from('investment_reports')
          .select('id, manual_overrides, updated_at, created_at, report_scope')
          .eq('id', reportId).maybeSingle();
        const { data: audit } = await supabase
          .from('report_engine_audit')
          .select('target_kind, target_id, before_value, after_value, performed_at, rationale')
          .eq('target_id', reportId)
          .order('performed_at', { ascending: false })
          .limit(50);
        return json({
          report,
          pre_gen_overrides: report?.manual_overrides ?? null,
          post_gen_edits: audit ?? [],
        }, corsHeaders);
      }

      case 'static_plan': {
        // Static (no-run) view of the engine: what sections the registry will
        // emit, which template pool will be retrieved against, how many
        // embedding chunks exist per template, and (if report_id is given)
        // which manual_overrides / post-gen edits are on record for that
        // report — heuristically mapped to each section.
        const scope = String(body.scope || 'compass').toLowerCase();
        const reportTier = body.report_tier ? String(body.report_tier) : null;
        const reportCategory = body.report_category ? String(body.report_category) : null;
        const templateType = String(body.template_type || 'ai_structure');
        const reportId = body.report_id ? String(body.report_id) : null;

        // 1. Registry sections for the requested scope.
        let sections: Array<{ id: string; ordinal: number; name: string; sourceHeadings?: string[]; purpose?: string; pageBudget?: number }>; 
        if (scope === 'financial' || scope === 'fin') {
          sections = FIN_SECTION_ORDER.map((s) => ({
            id: `fin.${s.ordinal}`, ordinal: s.ordinal, name: s.heading,
          }));
        } else if (scope === 'pldd' || scope === 'due_diligence') {
          sections = PLDD_SECTION_ORDER.map((s) => ({
            id: `pldd.${s.ordinal}`, ordinal: s.ordinal, name: s.heading,
          }));
        } else {
          sections = COMPASS_40_SECTIONS.map((s) => ({
            id: s.id, ordinal: s.ordinal, name: s.name,
            sourceHeadings: s.sourceHeadings, purpose: s.purpose, pageBudget: s.pageBudget,
          }));
        }

        // 2. Eligible template pool (mirrors retrieve-template-context filter).
        let tplQ = supabase
          .from('report_structure_templates')
          .select('id, name, template_type, report_tier, report_category, is_active, priority')
          .eq('is_active', true)
          .eq('template_type', templateType);
        if (reportTier) tplQ = tplQ.or(`report_tier.eq.${reportTier},report_tier.is.null`);
        if (reportCategory) tplQ = tplQ.or(`report_category.eq.${reportCategory},report_category.is.null`);
        const { data: templates, error: tplErr } = await tplQ.order('priority', { ascending: false });
        if (tplErr) throw tplErr;

        // 3. Embedding chunk counts for each template (document_chunks.document_name = 'template:<uuid>').
        const docNames = (templates ?? []).map((t: any) => `template:${t.id}`);
        let chunkCounts: Record<string, number> = {};
        if (docNames.length > 0) {
          const { data: chunkRows } = await supabase
            .from('document_chunks')
            .select('document_name')
            .in('document_name', docNames);
          for (const r of chunkRows ?? []) {
            chunkCounts[r.document_name] = (chunkCounts[r.document_name] ?? 0) + 1;
          }
        }
        const templatesOut = (templates ?? []).map((t: any) => ({
          ...t,
          embedding_chunks: chunkCounts[`template:${t.id}`] ?? 0,
        }));

        // 4. Optional report overlay: pre-gen overrides + post-gen edits.
        let overridesOverlay: any = null;
        if (reportId) {
          const { data: report } = await supabase
            .from('investment_reports')
            .select('id, manual_overrides, report_scope, updated_at')
            .eq('id', reportId).maybeSingle();
          const { data: audit } = await supabase
            .from('report_engine_audit')
            .select('target_kind, target_id, before_value, after_value, performed_at, rationale')
            .eq('target_id', reportId)
            .order('performed_at', { ascending: false })
            .limit(100);
          const preGen = (report?.manual_overrides && typeof report.manual_overrides === 'object')
            ? report.manual_overrides : {};
          const preGenKeys = Object.keys(preGen);
          // Heuristic per-section mapping: an override key maps to a section
          // when its lowercased name shares a non-trivial token with the
          // section id / heading / source headings.
          const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 3);
          const sectionTokens = sections.map((s) => new Set([
            ...norm(s.id), ...norm(s.name), ...(s.sourceHeadings ?? []).flatMap(norm),
          ]));
          const sectionOverrideMap = sections.map((s, i) => {
            const tokens = sectionTokens[i];
            const matched = preGenKeys.filter((k) => norm(k).some((t) => tokens.has(t)));
            return { section_id: s.id, override_keys: matched };
          });
          overridesOverlay = {
            report,
            pre_gen_overrides: preGen,
            pre_gen_keys: preGenKeys,
            post_gen_edits: audit ?? [],
            section_override_map: sectionOverrideMap,
          };
        }

        // 5. Per-section template assignment overlay (if any).
        const { data: mapRow } = await supabase
          .from('report_engine_config')
          .select('value')
          .eq('config_key', `section_template_map:${scope}`)
          .eq('scope', 'default').maybeSingle();
        const sectionTemplateMap = (mapRow?.value && typeof mapRow.value === 'object') ? mapRow.value : {};

        return json({
          scope,
          sections,
          templates: templatesOut,
          template_pool_size: templatesOut.length,
          total_embedding_chunks: Object.values(chunkCounts).reduce((a, b) => a + b, 0),
          overrides: overridesOverlay,
          section_template_map: sectionTemplateMap,
          retrieval_note: 'Live generation picks the top-K embedding chunks from this pool by semantic similarity to each section query. Statically, every section is eligible to draw from the full pool above. Per-section pinned assignments (if set) appear when you expand a section.',
        }, corsHeaders);
      }

      case 'list_template_chunks': {
        const tplId = String(body.template_id || '').replace(/^template:/, '');
        if (!/^[0-9a-f-]{36}$/i.test(tplId)) return json({ error: 'template_id required' }, corsHeaders, 400);
        const limit = Math.min(Number(body.limit ?? 200), 500);
        const { data, error } = await supabase
          .from('document_chunks')
          .select('id, chunk_index, chunk_text, metadata')
          .eq('document_name', `template:${tplId}`)
          .order('chunk_index', { ascending: true })
          .limit(limit);
        if (error) throw error;
        return json({ template_id: tplId, chunks: data ?? [] }, corsHeaders);
      }

      case 'get_section_template_map': {
        const scope = String(body.scope || 'compass').toLowerCase();
        const { data } = await supabase
          .from('report_engine_config')
          .select('value, updated_at, updated_by')
          .eq('config_key', `section_template_map:${scope}`)
          .eq('scope', 'default')
          .maybeSingle();
        return json({ scope, map: data?.value ?? {}, updated_at: data?.updated_at ?? null }, corsHeaders);
      }

      case 'set_section_template_map': {
        const scope = String(body.scope || 'compass').toLowerCase();
        const section_id = String(body.section_id || '');
        const template_ids: string[] = Array.isArray(body.template_ids)
          ? body.template_ids.map((v: any) => String(v)).filter((v: string) => /^[0-9a-f-]{36}$/i.test(v))
          : [];
        if (!section_id) return json({ error: 'section_id required' }, corsHeaders, 400);
        const config_key = `section_template_map:${scope}`;
        const { data: before } = await supabase
          .from('report_engine_config').select('value')
          .eq('config_key', config_key).eq('scope', 'default').maybeSingle();
        const current = (before?.value && typeof before.value === 'object') ? before.value : {};
        const next = { ...current, [section_id]: template_ids };
        const { error } = await supabase.from('report_engine_config').upsert({
          config_key, scope: 'default', value: next,
          description: `Per-section template assignment for ${scope}`,
          updated_by: userId,
        }, { onConflict: 'config_key,scope' });
        if (error) throw error;
        await supabase.from('report_engine_audit').insert({
          proposal_id: null, target_kind: 'section_template_map',
          target_id: `${scope}:${section_id}`,
          before_value: current[section_id] ?? null,
          after_value: template_ids,
          performed_by: userId, rationale: body.rationale || 'static plan edit',
        });
        return json({ ok: true, map: next }, corsHeaders);
      }

      case 'update_report_manual_overrides': {
        const reportId = String(body.report_id || '');
        if (!reportId) return json({ error: 'report_id required' }, corsHeaders, 400);
        const next = body.manual_overrides;
        if (next !== null && (typeof next !== 'object' || Array.isArray(next))) {
          return json({ error: 'manual_overrides must be object or null' }, corsHeaders, 400);
        }
        const { data: before } = await supabase
          .from('investment_reports').select('manual_overrides').eq('id', reportId).maybeSingle();
        const { error } = await supabase
          .from('investment_reports').update({ manual_overrides: next }).eq('id', reportId);
        if (error) throw error;
        await supabase.from('report_engine_audit').insert({
          proposal_id: null, target_kind: 'report_manual_overrides',
          target_id: reportId,
          before_value: before?.manual_overrides ?? null,
          after_value: next,
          performed_by: userId, rationale: body.rationale || 'static plan packet edit',
        });
        return json({ ok: true }, corsHeaders);
      }

      case 'lookup_report': {
        const reportId = String(body.report_id || '').trim();
        if (!/^[0-9a-f-]{36}$/i.test(reportId)) return json({ error: 'valid report_id required' }, corsHeaders, 400);
        const { data: report, error: rErr } = await supabase
          .from('investment_reports')
          .select('id, status, property_address, report_scope, report_tier, created_at, updated_at, manual_overrides, report_variant, derived_from_report_id, parent_report_id')
          .eq('id', reportId).maybeSingle();
        if (rErr) throw rErr;
        if (!report) return json({ error: 'report not found' }, corsHeaders, 404);
        const { data: runs } = await supabase
          .from('report_generation_runs')
          .select('id, scope, variant, status, model, started_at, finished_at, total_prompt_tokens, total_completion_tokens, total_cost_cents, error')
          .eq('report_id', reportId)
          .order('started_at', { ascending: false })
          .limit(20);
        const mo = (report.manual_overrides && typeof report.manual_overrides === 'object') ? report.manual_overrides : {};
        const overrideKeys = Object.keys(mo);
        return json({
          report,
          latest_run: runs?.[0] ?? null,
          runs: runs ?? [],
          override_keys: overrideKeys,
          override_count: overrideKeys.length,
        }, corsHeaders);
      }

      case 'propose_section_template_map': {
        const scope = String(body.scope || 'compass').toLowerCase();
        const section_id = String(body.section_id || '');
        const template_ids: string[] = Array.isArray(body.template_ids)
          ? body.template_ids.map((v: any) => String(v)).filter((v: string) => /^[0-9a-f-]{36}$/i.test(v))
          : [];
        if (!section_id) return json({ error: 'section_id required' }, corsHeaders, 400);
        const config_key = `section_template_map:${scope}`;
        const { data: before } = await supabase
          .from('report_engine_config').select('value')
          .eq('config_key', config_key).eq('scope', 'default').maybeSingle();
        const current = (before?.value && typeof before.value === 'object') ? before.value : {};
        const next = { ...current, [section_id]: template_ids };
        const { data: prop, error } = await supabase
          .from('report_engine_proposals').insert({
            target_kind: 'engine_config',
            target_id: null,
            before_value: { config_key, scope: 'default', value: current },
            after_value: { config_key, scope: 'default', value: next },
            rationale: body.rationale || `Pin ${template_ids.length} template(s) to ${scope}:${section_id}`,
            // `proposed_by` does not exist; the table separates the two kinds
            // of proposer, `proposed_by_agent` and `proposed_by_user`. This is
            // a person, so it is the user column — and because the error below
            // is thrown, this operation answered 500 on every call.
            proposed_by_user: userId,
            status: 'pending',
          }).select('*').single();
        if (error) throw error;
        return json({ ok: true, proposal: prop }, corsHeaders);
      }

      default:
        console.warn('[report-engine-inspector] unknown op', { rawOp, op, bodyKeys: Object.keys(body ?? {}) });
        return json({
          error: `unknown op: ${op || '(missing)'}`,
          allowed_ops: [
            'list_runs', 'get_run', 'get_chunk', 'list_proposals', 'list_audit',
            'apply_proposal', 'reject_proposal', 'list_engine_config', 'upsert_engine_config',
            'delete_engine_config', 'list_prompts', 'upsert_prompt', 'delete_prompt',
            'export_prompts', 'import_prompts', 'resolve_templates', 'get_report_overrides',
            'static_plan', 'list_template_chunks', 'get_section_template_map',
            'set_section_template_map', 'update_report_manual_overrides',
            'lookup_report', 'propose_section_template_map',
          ],
        }, corsHeaders, 400);
    }
  } catch (e: any) {
    return json({ ...internalError(e, 'report-engine-inspector') }, createCorsHeaders(origin), 500);
  }
});

function json(body: any, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
