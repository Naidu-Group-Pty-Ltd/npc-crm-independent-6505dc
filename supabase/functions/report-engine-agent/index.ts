// report-engine-agent
// Dedicated agentic editor for the report generation engine.
// All mutations stage to report_engine_proposals — superadmin clicks Apply
// in the inspector UI to commit them.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { loadSplitRegistry, defaultSplitRegistryBundle } from '../_shared/reportSplitRegistry.ts';
import { loadPacketConfig, applyPacketConfig, DEFAULT_PACKET_KEYS } from '../_shared/packetConfigLoader.ts';
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';

const SYSTEM_PROMPT = `
You are the Report Engine Operator: a strictly-scoped AI agent whose ONLY job is to
inspect and improve the property investment report generation engine for this app.

You can READ:
- Reports themselves: find_reports (by address), lookup_report, get_report_runs,
  get_report_overrides. ALWAYS prefer a report_id when the user gives one — resolve
  runs and chunks through it.
- Generation runs (list_runs, get_run, get_chunk): exact system prompt, data packet,
  per-section prompts/responses/retrieval results, tokens, latency.
- Diff between runs: compare_runs.
- Templates in report_structure_templates (list_templates, get_template), and the
  embedding chunks attached to a template (list_template_chunks).
- Engine runtime config in report_engine_config (list_engine_config, get_engine_config) —
  system messages per scope, retrieval knobs, hard-exclusion lists, registry overrides.
- Per-scope section→template pinning map (get_section_template_map).
- Pending proposals (list_proposals, get_proposal) and applied audit (get_audit_log).

You can PROPOSE (everything is staged — a superadmin clicks Apply):
- propose_system_prompt_edit: change the system message for a scope
  (default | suburb | postcode | statewide | compass | executive | comparison).
- propose_engine_config: any structured config knob.
- propose_retrieval_config: convenience for similarity_threshold / max_chunks / template_type.
- propose_template_edit / propose_template_create / propose_template_deactivate.
- propose_section_template_map_edit: pin specific templates to specific section_keys for a scope.
- propose_report_override_edit: shallow-merge a patch into a specific report's
  manual_overrides jsonb (pass null for a key to delete it).
- propose_split_registry_edit / reset_split_registry_to_defaults: edit the
  composite→fork routing rules (split_routes), titles/lens/footers (split_metadata),
  and FIN/PLDD section orders. These drive fork-investment-report — edits affect
  every future fork. Always read get_split_registry first so you can diff defaults
  vs live before staging a change.
- propose_packet_config_edit: control which keys/columns the data_packet inlines
  per scope (whitelist inline_keys, blacklist exclude_keys, extra inline_columns,
  per-section overrides, max_bytes_per_key truncation). simulate_data_packet
  reflects this immediately so you can preview the effect.

You CANNOT:
- Touch any table other than the engine + report tables listed above.
- Change RLS, grants, secrets, or any code.
- Apply your own proposals — only superadmins can.

Style: terse, technical, evidence-based. When proposing an edit always include:
  1) the smallest possible patch (only the fields that change),
  2) the rationale tied to data you observed in runs/chunks,
  3) what you expect to improve.

Always read before you write. If the user gives a report_id, start with lookup_report
to surface address + scope + latest run, then drill into get_run / get_chunk as needed.
Never invent a "before" value — fetch it.

IMPORTANT — auditing without runs:
A report can be audited even when report_generation_runs is empty. NEVER refuse on
that basis. Use this static-audit playbook:
  1) lookup_report(report_id) — metadata, scope, override key list.
  2) get_report_full(report_id) — full data spine: manual_overrides, financial_calculations,
     demographics_data, economic_data, investment_score, location_intelligence, scoring etc.
  3) static_plan(scope, report_id) — registry sections that WOULD run, eligible template pool,
     embedding-chunk counts per template, per-section pinned templates, and the report's
     override → section heuristic mapping. This is the same view the inspector UI shows.
  4) get_section_template_map(scope) — pinned templates per section_key.
  5) list_engine_config / get_engine_config — resolved system prompt, retrieval knobs,
     hard exclusions for the scope.
  6) get_audit_log(target_id=report_id) — post-gen edits already applied.
  7) simulate_data_packet(report_id) — synthesise the exact payload (system prompt,
     retrieval knobs, manual_overrides injection, per-section pinned templates) that
     WOULD be sent to the LLM. Use this whenever the user asks about data_packet
     contents for a report that has no runs — NEVER answer "cannot confirm injection".
  8) Optionally list_template_chunks on any template you want to inspect.
Combine these into a structured audit (data coverage, missing fields, override
collisions, template-pool health, pinned vs unpinned sections, anomalies).
Only mention "no runs recorded" as a footnote, never as a blocker.

If the user asks something outside your scope, refuse politely and explain why.
`.trim();


async function isSuperadmin(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_roles').select('role').eq('user_id', userId).eq('role', 'superadmin').maybeSingle();
  return !!data;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function toolDefs() {
  return [
    // ---------- Read ----------
    {
      type: 'function',
      function: {
        name: 'list_runs',
        description: 'List recent generation runs, newest first.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
            scope: { type: 'string' },
            status: { type: 'string' },
            report_id: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_run',
        description: 'Get a single run + its chunks (full prompts, packet, retrieval, responses).',
        parameters: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_templates',
        description: 'List active report_structure_templates (RAG sources).',
        parameters: {
          type: 'object',
          properties: {
            template_type: { type: 'string' },
            report_tier: { type: 'string' },
            report_category: { type: 'string' },
            include_inactive: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_template',
        description: 'Read one report_structure_templates row by id (includes parsed_content).',
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_engine_config',
        description: 'List engine runtime config rows (system prompts, retrieval knobs, etc).',
        parameters: {
          type: 'object',
          properties: { config_key: { type: 'string' }, scope: { type: 'string' } },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_engine_config',
        description: 'Get a single engine config value by (config_key, scope).',
        parameters: {
          type: 'object',
          properties: { config_key: { type: 'string' }, scope: { type: 'string' } },
          required: ['config_key'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_proposals',
        description: 'List engine proposals (pending by default).',
        parameters: {
          type: 'object',
          properties: { status: { type: 'string' }, limit: { type: 'number' } },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_proposal',
        description: 'Read one proposal with full before/after diff.',
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
    },

    // ---------- Write (staged proposals) ----------
    {
      type: 'function',
      function: {
        name: 'propose_system_prompt_edit',
        description: 'Stage a change to the engine\'s system message for a given scope. scope examples: default, suburb, postcode, statewide, compass, executive, comparison.',
        parameters: {
          type: 'object',
          properties: {
            scope: { type: 'string' },
            new_prompt: { type: 'string', description: 'The full new system message text.' },
            rationale: { type: 'string' },
          },
          required: ['scope', 'new_prompt', 'rationale'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_engine_config',
        description: 'Stage a change to any engine config row (insert or update). value is the full new jsonb value.',
        parameters: {
          type: 'object',
          properties: {
            config_key: { type: 'string', description: 'e.g. system_message, retrieval, hard_exclusions, registry_override, model_settings' },
            scope: { type: 'string', description: 'e.g. default, compass, suburb, executive — defaults to "global"' },
            value: { description: 'Full new value (any JSON type).' },
            rationale: { type: 'string' },
          },
          required: ['config_key', 'value', 'rationale'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_retrieval_config',
        description: 'Stage retrieval knob changes (similarity threshold, top-k, template filters). Convenience wrapper around propose_engine_config with config_key=retrieval.',
        parameters: {
          type: 'object',
          properties: {
            scope: { type: 'string' },
            after_value: {
              type: 'object',
              properties: {
                similarity_threshold: { type: 'number' },
                max_chunks: { type: 'number' },
                template_type: { type: 'string' },
              },
              additionalProperties: true,
            },
            rationale: { type: 'string' },
          },
          required: ['after_value', 'rationale'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_template_edit',
        description: 'Stage a partial update to a report_structure_templates row.',
        parameters: {
          type: 'object',
          properties: {
            template_id: { type: 'string' },
            after_value: {
              type: 'object',
              description: 'Partial patch. Allowed fields: name, description, parsed_content, priority, is_active, metadata, report_tier, report_category, template_type.',
              additionalProperties: true,
            },
            rationale: { type: 'string' },
          },
          required: ['template_id', 'after_value', 'rationale'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_template_create',
        description: 'Stage creation of a brand-new report_structure_templates row.',
        parameters: {
          type: 'object',
          properties: {
            after_value: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                template_type: { type: 'string' },
                report_tier: { type: 'string' },
                report_category: { type: 'string' },
                parsed_content: { type: 'string' },
                description: { type: 'string' },
                priority: { type: 'number' },
                metadata: { type: 'object', additionalProperties: true },
              },
              required: ['name', 'template_type', 'parsed_content'],
            },
            rationale: { type: 'string' },
          },
          required: ['after_value', 'rationale'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_template_deactivate',
        description: 'Stage soft-delete (is_active=false) of a template.',
        parameters: {
          type: 'object',
          properties: { template_id: { type: 'string' }, rationale: { type: 'string' } },
          required: ['template_id', 'rationale'],
        },
      },
    },

    // ---------- Report-centric (resolves report_id → runs/chunks/overrides) ----------
    {
      type: 'function',
      function: {
        name: 'find_reports',
        description: 'Search investment_reports by address substring or list recent reports. Compass/briefing are report_tier filters, not report_scope. Handles minor suburb typos with fuzzy fallback.',
        parameters: {
          type: 'object',
          properties: {
            address_query: { type: 'string' },
            scope: { type: 'string', description: 'address | suburb | postcode | statewide. If compass/briefing/snapshot is supplied it is treated as report_tier.' },
            report_tier: { type: 'string', description: 'compass | briefing | snapshot' },
            variant: { type: 'string' },
            limit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'lookup_report',
        description: 'Get one investment_reports row by id with summary metadata, latest run id, run counts, and override key list. Use this whenever the user gives a report_id.',
        parameters: {
          type: 'object',
          properties: { report_id: { type: 'string' } },
          required: ['report_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_report_runs',
        description: 'List all generation runs for a given report_id, newest first.',
        parameters: {
          type: 'object',
          properties: { report_id: { type: 'string' }, limit: { type: 'number' } },
          required: ['report_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_report_overrides',
        description: 'Return manual_overrides jsonb for a report plus its top-level key list. Use before propose_report_override_edit.',
        parameters: {
          type: 'object',
          properties: { report_id: { type: 'string' } },
          required: ['report_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_report_override_edit',
        description: 'Stage a patch to investment_reports.manual_overrides. patch is shallow-merged into the existing object; pass null for a key to delete it on apply.',
        parameters: {
          type: 'object',
          properties: {
            report_id: { type: 'string' },
            patch: { type: 'object', additionalProperties: true },
            rationale: { type: 'string' },
          },
          required: ['report_id', 'patch', 'rationale'],
        },
      },
    },

    // ---------- Chunk / run drill-down + diff ----------
    {
      type: 'function',
      function: {
        name: 'get_chunk',
        description: 'Get one report_generation_chunks row with full system_prompt, user_prompt, response, retrieval_meta, attached packet keys, and attached template chunk ids.',
        parameters: {
          type: 'object',
          properties: { chunk_id: { type: 'string' } },
          required: ['chunk_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'compare_runs',
        description: 'Diff two runs: system_prompt change, data_packet key set, models, total tokens, and per-section presence/latency/status differences.',
        parameters: {
          type: 'object',
          properties: { run_id_a: { type: 'string' }, run_id_b: { type: 'string' } },
          required: ['run_id_a', 'run_id_b'],
        },
      },
    },

    // ---------- Template chunks (RAG embeddings) ----------
    {
      type: 'function',
      function: {
        name: 'list_template_chunks',
        description: 'List embedding chunks in document_chunks attached to a given template (via metadata.template_id). Returns ids, chunk_index, text preview, length.',
        parameters: {
          type: 'object',
          properties: {
            template_id: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['template_id'],
        },
      },
    },

    // ---------- Section→template pinning map ----------
    {
      type: 'function',
      function: {
        name: 'get_section_template_map',
        description: 'Read the section→template pinning map for a scope. Stored in report_engine_config under config_key=section_template_map, scope=<scope>.',
        parameters: {
          type: 'object',
          properties: { scope: { type: 'string' } },
          required: ['scope'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_section_template_map_edit',
        description: 'Stage an update to the section→template pinning map for a scope. map is the full new {section_key: [template_id, ...]} object that will overwrite the current value.',
        parameters: {
          type: 'object',
          properties: {
            scope: { type: 'string' },
            map: { type: 'object', additionalProperties: true },
            rationale: { type: 'string' },
          },
          required: ['scope', 'map', 'rationale'],
        },
      },
    },

    // ---------- Audit ----------
    {
      type: 'function',
      function: {
        name: 'get_audit_log',
        description: 'Recent applied engine changes from report_engine_audit (who, when, before/after, rationale).',
        parameters: {
          type: 'object',
          properties: { limit: { type: 'number' }, target_kind: { type: 'string' }, target_id: { type: 'string' } },
          additionalProperties: false,
        },

      },
    },

    // ---------- Static audit (no runs required) ----------
    {
      type: 'function',
      function: {
        name: 'get_report_full',
        description: 'Return the full data spine for a report: overrides, financials, demographics, economics, score, location intelligence, property specs, validation flags, data sources, plus key listings and byte sizes. Use when no runs exist.',
        parameters: {
          type: 'object',
          properties: {
            report_id: { type: 'string' },
            include_raw: { type: 'boolean', description: 'Return full JSON blobs (default false — only key listings + sizes).' },
          },
          required: ['report_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'static_plan',
        description: 'Inspector-style static plan for a scope (no run required): registry sections, eligible template pool with embedding-chunk counts, per-section pinned templates, and (when report_id given) the report\'s override → section heuristic mapping. Equivalent to the inspector UI Static Plan tab.',
        parameters: {
          type: 'object',
          properties: {
            scope: { type: 'string', description: 'compass | financial | pldd (default compass)' },
            report_id: { type: 'string' },
            report_tier: { type: 'string' },
            report_category: { type: 'string' },
            template_type: { type: 'string', description: 'default ai_structure' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'audit_report',
        description: 'One-shot static audit of a report by id. Bundles lookup_report + get_report_full + static_plan + section_template_map + recent audit log into a single structured report. Works even when no generation runs exist.',
        parameters: {
          type: 'object',
          properties: {
            report_id: { type: 'string' },
            scope: { type: 'string', description: 'override the scope used for static_plan (defaults to report.report_scope or compass)' },
          },
          required: ['report_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_report_column',
        description: 'Read a specific column from investment_reports (read-only). Useful for inspecting large jsonb fields not surfaced by get_report_full. Allowed columns only.',
        parameters: {
          type: 'object',
          properties: {
            report_id: { type: 'string' },
            column: { type: 'string', description: 'one of: report_content, sources_content, manual_overrides, financial_calculations, demographics_data, economic_data, investment_score, location_intelligence, property_specs, validation_flags, data_sources' },
          },
          required: ['report_id', 'column'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'simulate_data_packet',
        description: 'Synthesize the data_packet that WOULD be sent to the LLM for this report at generation time, using current investment_reports columns + engine_config + section_template_map + packet_config. Bypasses the "no runs recorded" gap: returns the exact payload shape (top-level keys, sizes, manual_overrides injection, resolved system prompt, retrieval knobs, per-section pinned templates, packet_config filtering trace). Use when the user asks about what gets sent to the model for a specific report id.',
        parameters: {
          type: 'object',
          properties: {
            report_id: { type: 'string' },
            scope: { type: 'string', description: 'override scope (defaults to report.report_tier or report.report_scope or compass)' },
            section_key: { type: 'string', description: 'optional — also return the per-section slice (pinned templates + their chunk counts + override hints) for this section_key' },
            include_raw_overrides: { type: 'boolean', description: 'inline the full manual_overrides jsonb (default false — only keys + sizes)' },
          },
          required: ['report_id'],
        },
      },
    },
    // ── Split registry tools (FIN / PLDD fork routing) ──
    {
      type: 'function',
      function: {
        name: 'get_split_registry',
        description: 'Read the live composite→fork split registry (routing rules, section orders, titles/subtitles/lens preambles/footers) as resolved by loadSplitRegistry. Returns both the DB-overlaid live values AND the in-code defaults so the agent can diff them. This drives fork-investment-report; edits affect every future FIN/PLDD fork.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_split_registry_edit',
        description: 'Stage an edit to one of the split registry config_keys (split_routes | split_metadata | split_section_order_fin | split_section_order_pldd). Provide the FULL new value (not a patch) — for routes pass the full array. The inspector apply_proposal handler upserts it into report_engine_config.',
        parameters: {
          type: 'object',
          properties: {
            config_key: { type: 'string', enum: ['split_routes', 'split_metadata', 'split_section_order_fin', 'split_section_order_pldd'] },
            new_value: { description: 'Full replacement value for the config_key (array for routes/section_orders, object for metadata).' },
            rationale: { type: 'string' },
          },
          required: ['config_key', 'new_value', 'rationale'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'reset_split_registry_to_defaults',
        description: 'Stage a proposal that restores one (or all) split registry config_keys to the in-code defaults. Use to recover after a bad edit.',
        parameters: {
          type: 'object',
          properties: {
            config_key: { type: 'string', enum: ['split_routes', 'split_metadata', 'split_section_order_fin', 'split_section_order_pldd', 'all'] },
            rationale: { type: 'string' },
          },
          required: ['config_key', 'rationale'],
        },
      },
    },
    // ── Packet config tools (which keys/columns get inlined into the data_packet) ──
    {
      type: 'function',
      function: {
        name: 'get_packet_config',
        description: 'Read the data_packet construction config for a scope. Controls inline_keys (whitelist), exclude_keys (blacklist), inline_columns (extra investment_reports columns to pull), per_section_overrides, and max_bytes_per_key truncation. Returns resolved value + source (default | global | scope).',
        parameters: {
          type: 'object',
          properties: { scope: { type: 'string', description: 'compass | briefing | snapshot | suburb | postcode | statewide | global' } },
          required: ['scope'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'propose_packet_config_edit',
        description: 'Stage an edit to the packet_config for a scope. Pass the FULL new value object: { inline_keys?: string[], exclude_keys?: string[], inline_columns?: string[], per_section_overrides?: {[key]: {inline_keys?, exclude_keys?}}, max_bytes_per_key?: number }. Use scope="global" to set a baseline; per-scope rows override it.',
        parameters: {
          type: 'object',
          properties: {
            scope: { type: 'string' },
            new_value: { type: 'object' },
            rationale: { type: 'string' },
          },
          required: ['scope', 'new_value', 'rationale'],
        },
      },
    },
  ];
}


// ---------------------------------------------------------------------------
// Tool runners
// ---------------------------------------------------------------------------

const TEMPLATE_EDITABLE_FIELDS = new Set([
  'name', 'description', 'parsed_content', 'priority', 'is_active',
  'metadata', 'report_tier', 'report_category', 'template_type',
]);

function filterTemplatePatch(patch: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (TEMPLATE_EDITABLE_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

async function stageProposal(supabase: any, row: Record<string, any>) {
  const { data, error } = await supabase
    .from('report_engine_proposals').insert(row).select('id, target_kind, target_id, status').single();
  if (error) throw error;
  return data;
}

const TIER_ALIASES = new Set(['compass', 'briefing', 'snapshot']);
const REPORT_BASE_SELECT = 'id, property_address, report_scope, report_tier, report_variant, derived_from_report_id, parent_report_id, status, generation_engine, current_version, total_sections, last_completed_section, error_message, created_at, updated_at';
const REPORT_JSON_FIELDS = ['manual_overrides','financial_calculations','demographics_data','economic_data','investment_score','location_intelligence','property_specs','validation_flags','data_sources'];

function normaliseSearch(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function reportSearchScore(report: any, query: string): number {
  const haystack = normaliseSearch(report?.property_address || '');
  const tokens = normaliseSearch(query).split(' ').filter((t) => t.length >= 4 && !['property','report','compass','briefing','snapshot','recent','latest'].includes(t));
  if (!tokens.length) return 0;
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 4;
    else if (haystack.includes(token.slice(0, 4))) score += 2;
    else if (token.length >= 6 && haystack.includes(token.slice(0, 5))) score += 1;
  }
  return score;
}

async function runTool(supabase: any, name: string, args: any): Promise<any> {
  switch (name) {
    case 'list_runs': {
      const q = supabase
        .from('report_generation_runs')
        .select('id, report_id, scope, variant, model, status, started_at, finished_at, total_prompt_tokens, total_completion_tokens, error, data_packet_size_bytes')
        .order('started_at', { ascending: false })
        .limit(Math.min(args.limit ?? 20, 100));
      if (args.scope) q.eq('scope', args.scope);
      if (args.status) q.eq('status', args.status);
      if (args.report_id) q.eq('report_id', args.report_id);
      const { data, error } = await q;
      if (error) throw error;
      return { runs: data };
    }
    case 'get_run': {
      const [{ data: run }, { data: chunks }] = await Promise.all([
        supabase.from('report_generation_runs').select('*').eq('id', args.run_id).maybeSingle(),
        supabase.from('report_generation_chunks')
          .select('id, section_key, section_label, ordinal, model, attached_packet_keys, attached_template_chunk_ids, retrieval_meta, prompt_tokens, completion_tokens, latency_ms, status, error')
          .eq('run_id', args.run_id).order('ordinal'),
      ]);
      return { run, chunks };
    }
    case 'list_templates': {
      const q = supabase.from('report_structure_templates')
        .select('id, name, template_type, report_tier, report_category, is_active, priority, updated_at')
        .order('priority', { ascending: false });
      if (!args.include_inactive) q.eq('is_active', true);
      if (args.template_type) q.eq('template_type', args.template_type);
      if (args.report_tier) q.eq('report_tier', args.report_tier);
      if (args.report_category) q.eq('report_category', args.report_category);
      const { data, error } = await q;
      if (error) throw error;
      return { templates: data };
    }
    case 'get_template': {
      const { data, error } = await supabase.from('report_structure_templates').select('*').eq('id', args.id).maybeSingle();
      if (error) throw error;
      // Trim huge parsed_content for context safety; agent can request specific slices if needed.
      if (data?.parsed_content && data.parsed_content.length > 8000) {
        data.parsed_content_preview = data.parsed_content.slice(0, 8000) + '\n…[truncated]…';
        data.parsed_content_length = data.parsed_content.length;
        delete data.parsed_content;
      }
      return { template: data };
    }
    case 'list_engine_config': {
      const q = supabase.from('report_engine_config').select('*').order('config_key').order('scope');
      if (args.config_key) q.eq('config_key', args.config_key);
      if (args.scope) q.eq('scope', args.scope);
      const { data, error } = await q;
      if (error) throw error;
      return { configs: data };
    }
    case 'get_engine_config': {
      const scope = args.scope || 'global';
      const { data, error } = await supabase
        .from('report_engine_config').select('*')
        .eq('config_key', args.config_key).eq('scope', scope).maybeSingle();
      if (error) throw error;
      return { config: data };
    }
    case 'list_proposals': {
      const q = supabase.from('report_engine_proposals').select('*')
        .order('created_at', { ascending: false }).limit(Math.min(args.limit ?? 30, 100));
      if (args.status) q.eq('status', args.status);
      else q.eq('status', 'pending');
      const { data, error } = await q;
      if (error) throw error;
      return { proposals: data };
    }
    case 'get_proposal': {
      const { data, error } = await supabase.from('report_engine_proposals').select('*').eq('id', args.id).maybeSingle();
      if (error) throw error;
      return { proposal: data };
    }

    case 'propose_system_prompt_edit': {
      const scope = String(args.scope || 'default');
      const { data: before } = await supabase
        .from('report_engine_config').select('*')
        .eq('config_key', 'system_message').eq('scope', scope).maybeSingle();
      const p = await stageProposal(supabase, {
        target_kind: 'engine_config',
        target_id: `system_message:${scope}`,
        before_value: before ?? null,
        after_value: { config_key: 'system_message', scope, value: String(args.new_prompt) },
        rationale: args.rationale,
        proposed_by_agent: true,
        status: 'pending',
      });
      return p;
    }
    case 'propose_engine_config': {
      const scope = String(args.scope || 'global');
      const { data: before } = await supabase
        .from('report_engine_config').select('*')
        .eq('config_key', args.config_key).eq('scope', scope).maybeSingle();
      const p = await stageProposal(supabase, {
        target_kind: 'engine_config',
        target_id: `${args.config_key}:${scope}`,
        before_value: before ?? null,
        after_value: { config_key: args.config_key, scope, value: args.value },
        rationale: args.rationale,
        proposed_by_agent: true,
        status: 'pending',
      });
      return p;
    }
    case 'propose_retrieval_config': {
      const scope = String(args.scope || 'global');
      const { data: before } = await supabase
        .from('report_engine_config').select('*')
        .eq('config_key', 'retrieval').eq('scope', scope).maybeSingle();
      const p = await stageProposal(supabase, {
        target_kind: 'engine_config',
        target_id: `retrieval:${scope}`,
        before_value: before ?? null,
        after_value: { config_key: 'retrieval', scope, value: args.after_value },
        rationale: args.rationale,
        proposed_by_agent: true,
        status: 'pending',
      });
      return p;
    }
    case 'propose_template_edit': {
      const { data: before } = await supabase
        .from('report_structure_templates').select('*').eq('id', args.template_id).maybeSingle();
      if (!before) throw new Error('template not found');
      const patch = filterTemplatePatch(args.after_value);
      if (!Object.keys(patch).length) throw new Error('no editable fields in patch');
      const p = await stageProposal(supabase, {
        target_kind: 'report_structure_template',
        target_id: args.template_id,
        before_value: before,
        after_value: patch,
        rationale: args.rationale,
        proposed_by_agent: true,
        status: 'pending',
      });
      return p;
    }
    case 'propose_template_create': {
      const patch = filterTemplatePatch(args.after_value);
      if (!patch.name || !patch.template_type || !patch.parsed_content) {
        throw new Error('name, template_type, parsed_content required');
      }
      const p = await stageProposal(supabase, {
        target_kind: 'report_structure_template_new',
        target_id: null,
        before_value: null,
        after_value: patch,
        rationale: args.rationale,
        proposed_by_agent: true,
        status: 'pending',
      });
      return p;
    }
    case 'propose_template_deactivate': {
      const { data: before } = await supabase
        .from('report_structure_templates').select('*').eq('id', args.template_id).maybeSingle();
      if (!before) throw new Error('template not found');
      const p = await stageProposal(supabase, {
        target_kind: 'report_structure_template',
        target_id: args.template_id,
        before_value: before,
        after_value: { is_active: false },
        rationale: args.rationale,
        proposed_by_agent: true,
        status: 'pending',
      });
      return p;
    }


    // ----- Report-centric -----
    case 'find_reports': {
      const requestedScope = args.scope ? String(args.scope).toLowerCase() : null;
      const reportTier = args.report_tier || (requestedScope && TIER_ALIASES.has(requestedScope) ? requestedScope : null);
      const reportScope = requestedScope && !TIER_ALIASES.has(requestedScope) ? requestedScope : null;
      const limit = Math.min(args.limit ?? 20, 50);
      const q = supabase.from('investment_reports')
        .select('id, property_address, report_scope, report_tier, report_variant, status, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (args.address_query) q.ilike('property_address', `%${args.address_query}%`);
      if (reportScope) q.eq('report_scope', reportScope);
      if (reportTier) q.eq('report_tier', reportTier);
      if (args.variant) q.eq('report_variant', args.variant);
      const { data, error } = await q;
      if (error) throw error;
      if ((data ?? []).length || !args.address_query) {
        return { reports: data ?? [], filters_interpreted: { report_scope: reportScope, report_tier: reportTier, variant: args.variant ?? null } };
      }

      // Fuzzy fallback for common voice/transcription misspellings, e.g. Kalkollo → Kalkallo.
      let fallback = supabase.from('investment_reports')
        .select('id, property_address, report_scope, report_tier, report_variant, status, created_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(250);
      if (reportScope) fallback = fallback.eq('report_scope', reportScope);
      if (reportTier) fallback = fallback.eq('report_tier', reportTier);
      if (args.variant) fallback = fallback.eq('report_variant', args.variant);
      const { data: pool, error: fbErr } = await fallback;
      if (fbErr) throw fbErr;
      const scored = (pool ?? [])
        .map((r: any) => ({ ...r, match_score: reportSearchScore(r, args.address_query) }))
        .filter((r: any) => r.match_score > 0)
        .sort((a: any, b: any) => b.match_score - a.match_score || String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))
        .slice(0, limit);
      return { reports: scored, fuzzy_fallback_used: true, filters_interpreted: { report_scope: reportScope, report_tier: reportTier, variant: args.variant ?? null } };
    }
    case 'lookup_report': {
      const { data: report, error } = await supabase
        .from('investment_reports')
        .select('id, property_address, report_scope, report_tier, report_variant, derived_from_report_id, parent_report_id, status, generation_engine, current_version, total_sections, last_completed_section, error_message, created_at, updated_at, manual_overrides')
        .eq('id', args.report_id).maybeSingle();
      if (error) throw error;
      if (!report) return { error: 'report not found' };
      const { data: runs } = await supabase
        .from('report_generation_runs')
        .select('id, scope, variant, status, started_at, finished_at, model, total_prompt_tokens, total_completion_tokens')
        .eq('report_id', args.report_id)
        .order('started_at', { ascending: false })
        .limit(10);
      const overrideKeys = report.manual_overrides && typeof report.manual_overrides === 'object'
        ? Object.keys(report.manual_overrides) : [];
      const summary = { ...report, manual_overrides: undefined, override_keys: overrideKeys, override_key_count: overrideKeys.length };
      const { data: relatedReports } = await supabase
        .from('investment_reports')
        .select('id, property_address, report_scope, report_tier, report_variant, derived_from_report_id, parent_report_id, status, created_at, updated_at')
        .or(`derived_from_report_id.eq.${args.report_id},parent_report_id.eq.${args.report_id}`)
        .order('updated_at', { ascending: false })
        .limit(20);
      return { report: summary, latest_run: runs?.[0] ?? null, recent_runs: runs ?? [], run_count_recent: runs?.length ?? 0, related_reports: relatedReports ?? [] };
    }
    case 'get_report_runs': {
      const { data, error } = await supabase
        .from('report_generation_runs')
        .select('id, scope, variant, status, started_at, finished_at, model, total_prompt_tokens, total_completion_tokens, error, data_packet_size_bytes')
        .eq('report_id', args.report_id)
        .order('started_at', { ascending: false })
        .limit(Math.min(args.limit ?? 20, 100));
      if (error) throw error;
      return { runs: data };
    }
    case 'get_report_overrides': {
      const { data, error } = await supabase
        .from('investment_reports').select('id, manual_overrides').eq('id', args.report_id).maybeSingle();
      if (error) throw error;
      if (!data) return { error: 'report not found' };
      const overrides = (data.manual_overrides && typeof data.manual_overrides === 'object') ? data.manual_overrides : {};
      return { report_id: data.id, override_keys: Object.keys(overrides), manual_overrides: overrides };
    }
    case 'propose_report_override_edit': {
      const { data: before } = await supabase
        .from('investment_reports').select('id, property_address, manual_overrides').eq('id', args.report_id).maybeSingle();
      if (!before) throw new Error('report not found');
      const p = await stageProposal(supabase, {
        target_kind: 'report_manual_overrides',
        target_id: args.report_id,
        before_value: { manual_overrides: before.manual_overrides ?? {}, property_address: before.property_address },
        after_value: { patch: args.patch },
        rationale: args.rationale,
        proposed_by_agent: true,
        status: 'pending',
      });
      return p;
    }

    // ----- Chunk drill-down / diff -----
    case 'get_chunk': {
      const { data, error } = await supabase
        .from('report_generation_chunks').select('*').eq('id', args.chunk_id).maybeSingle();
      if (error) throw error;
      if (!data) return { error: 'chunk not found' };
      // Trim ultra-large strings for context safety.
      const trim = (s: any, n = 6000) => (typeof s === 'string' && s.length > n)
        ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]…` : s;
      data.system_prompt = trim(data.system_prompt);
      data.user_prompt = trim(data.user_prompt);
      data.response = trim(data.response);
      return { chunk: data };
    }
    case 'compare_runs': {
      const [{ data: a }, { data: b }] = await Promise.all([
        supabase.from('report_generation_runs').select('id, scope, variant, model, system_prompt, data_packet, total_prompt_tokens, total_completion_tokens, started_at, finished_at, status').eq('id', args.run_id_a).maybeSingle(),
        supabase.from('report_generation_runs').select('id, scope, variant, model, system_prompt, data_packet, total_prompt_tokens, total_completion_tokens, started_at, finished_at, status').eq('id', args.run_id_b).maybeSingle(),
      ]);
      if (!a || !b) return { error: 'one or both runs not found' };
      const [{ data: ca }, { data: cb }] = await Promise.all([
        supabase.from('report_generation_chunks').select('section_key, status, latency_ms, prompt_tokens, completion_tokens').eq('run_id', args.run_id_a),
        supabase.from('report_generation_chunks').select('section_key, status, latency_ms, prompt_tokens, completion_tokens').eq('run_id', args.run_id_b),
      ]);
      const keysA = new Set(Object.keys(a.data_packet || {}));
      const keysB = new Set(Object.keys(b.data_packet || {}));
      const onlyA = [...keysA].filter(k => !keysB.has(k));
      const onlyB = [...keysB].filter(k => !keysA.has(k));
      const sectionsA = new Map((ca || []).map((c: any) => [c.section_key, c]));
      const sectionsB = new Map((cb || []).map((c: any) => [c.section_key, c]));
      const allSections = new Set([...sectionsA.keys(), ...sectionsB.keys()]);
      const sectionDiff = [...allSections].map(k => ({
        section_key: k,
        in_a: sectionsA.has(k), in_b: sectionsB.has(k),
        a: sectionsA.get(k), b: sectionsB.get(k),
      }));
      return {
        a: { id: a.id, scope: a.scope, variant: a.variant, model: a.model, tokens: (a.total_prompt_tokens || 0) + (a.total_completion_tokens || 0), status: a.status },
        b: { id: b.id, scope: b.scope, variant: b.variant, model: b.model, tokens: (b.total_prompt_tokens || 0) + (b.total_completion_tokens || 0), status: b.status },
        system_prompt_changed: a.system_prompt !== b.system_prompt,
        system_prompt_a_len: (a.system_prompt || '').length,
        system_prompt_b_len: (b.system_prompt || '').length,
        packet_keys_only_in_a: onlyA,
        packet_keys_only_in_b: onlyB,
        section_diff: sectionDiff,
      };
    }

    // ----- Template chunks -----
    case 'list_template_chunks': {
      const tplId = String(args.template_id || '');
      const { data, error } = await supabase
        .from('document_chunks')
        .select('id, document_name, chunk_index, chunk_text, page_number, metadata, created_at')
        .eq('document_name', `template:${tplId}`)
        .order('chunk_index', { ascending: true })
        .limit(Math.min(args.limit ?? 50, 200));
      if (error) throw error;
      const chunks = (data || []).map((c: any) => ({
        id: c.id,
        document_name: c.document_name,
        chunk_index: c.chunk_index,
        page_number: c.page_number,
        length: (c.chunk_text || '').length,
        preview: (c.chunk_text || '').slice(0, 400),
      }));
      return { template_id: tplId, chunk_count: chunks.length, chunks };
    }


    // ----- Section→template pinning map -----
    case 'get_section_template_map': {
      const { data, error } = await supabase
        .from('report_engine_config').select('*')
        .eq('config_key', `section_template_map:${args.scope}`).eq('scope', 'default').maybeSingle();
      if (error) throw error;
      return { scope: args.scope, config: data ?? null };
    }
    case 'propose_section_template_map_edit': {
      const { data: before } = await supabase
        .from('report_engine_config').select('*')
        .eq('config_key', `section_template_map:${args.scope}`).eq('scope', 'default').maybeSingle();
      const p = await stageProposal(supabase, {
        target_kind: 'engine_config',
        target_id: `section_template_map:${args.scope}`,
        before_value: before ?? null,
        after_value: { config_key: `section_template_map:${args.scope}`, scope: 'default', value: args.map },
        rationale: args.rationale,
        proposed_by_agent: true,
        status: 'pending',
      });
      return p;
    }

    // ----- Audit -----
    case 'get_audit_log': {
      const q = supabase.from('report_engine_audit')
        .select('*').order('performed_at', { ascending: false })
        .limit(Math.min(args.limit ?? 25, 100));
      if (args.target_kind) q.eq('target_kind', args.target_kind);
      if (args.target_id) q.eq('target_id', args.target_id);
      const { data, error } = await q;
      if (error) throw error;
      return { audit: data };
    }

    // ----- Static audit (works without runs) -----
    case 'get_report_full': {
      const cols = `${REPORT_BASE_SELECT}, ${REPORT_JSON_FIELDS.join(',')}`;
      const { data, error } = await supabase
        .from('investment_reports').select(cols).eq('id', args.report_id).maybeSingle();
      if (error) throw error;
      if (!data) return { error: 'report not found' };
      const summarize = (v: any) => {
        if (v == null) return { present: false };
        const bytes = JSON.stringify(v).length;
        if (Array.isArray(v)) return { present: true, kind: 'array', length: v.length, bytes };
        if (typeof v === 'object') return { present: true, kind: 'object', keys: Object.keys(v), key_count: Object.keys(v).length, bytes };
        return { present: true, kind: typeof v, bytes };
      };
      const spine: any = {};
      for (const f of REPORT_JSON_FIELDS) spine[f] = summarize((data as any)[f]);
      const out: any = {
        report: {
          id: data.id, property_address: data.property_address,
          report_scope: data.report_scope, report_tier: data.report_tier, report_variant: data.report_variant,
          status: data.status, generation_engine: data.generation_engine,
          current_version: data.current_version, total_sections: data.total_sections,
          last_completed_section: data.last_completed_section, error_message: data.error_message,
          created_at: data.created_at, updated_at: data.updated_at,
        },
        data_spine: spine,
      };
      if (args.include_raw) {
        out.raw = {};
        for (const f of REPORT_JSON_FIELDS) out.raw[f] = (data as any)[f];
      }
      return out;
    }

    case 'read_report_column': {
      const ALLOWED = new Set([
        'report_content','sources_content','manual_overrides','financial_calculations',
        'demographics_data','economic_data','investment_score','location_intelligence',
        'property_specs','validation_flags','data_sources',
      ]);
      if (!ALLOWED.has(args.column)) return { error: `column not allowed: ${args.column}` };
      const { data, error } = await supabase
        .from('investment_reports').select(`id, ${args.column}`).eq('id', args.report_id).maybeSingle();
      if (error) throw error;
      if (!data) return { error: 'report not found' };
      const val = (data as any)[args.column];
      const bytes = val == null ? 0 : JSON.stringify(val).length;
      // Trim huge strings for context safety.
      let payload = val;
      if (typeof val === 'string' && val.length > 12000) {
        payload = val.slice(0, 12000) + `\n…[truncated ${val.length - 12000} chars]…`;
      }
      return { report_id: data.id, column: args.column, bytes, value: payload };
    }

    case 'static_plan': {
      // Inline implementation that calls the inspector's static_plan helper data
      // by replicating the same queries (keeps the agent self-contained).
      const scope = String(args.scope || 'compass').toLowerCase();
      const templateType = String(args.template_type || 'ai_structure');
      let tplQ = supabase.from('report_structure_templates')
        .select('id, name, template_type, report_tier, report_category, is_active, priority')
        .eq('is_active', true).eq('template_type', templateType);
      if (args.report_tier) tplQ = tplQ.or(`report_tier.eq.${args.report_tier},report_tier.is.null`);
      if (args.report_category) tplQ = tplQ.or(`report_category.eq.${args.report_category},report_category.is.null`);
      const { data: templates, error: tplErr } = await tplQ.order('priority', { ascending: false });
      if (tplErr) throw tplErr;
      const docNames = (templates ?? []).map((t: any) => `template:${t.id}`);
      const chunkCounts: Record<string, number> = {};
      if (docNames.length) {
        const { data: chunkRows } = await supabase
          .from('document_chunks').select('document_name').in('document_name', docNames);
        for (const r of chunkRows ?? []) chunkCounts[r.document_name] = (chunkCounts[r.document_name] ?? 0) + 1;
      }
      const templatesOut = (templates ?? []).map((t: any) => ({
        ...t, embedding_chunks: chunkCounts[`template:${t.id}`] ?? 0,
      }));
      const { data: mapRow } = await supabase
        .from('report_engine_config').select('value')
        .eq('config_key', `section_template_map:${scope}`).eq('scope', 'default').maybeSingle();
      const sectionTemplateMap = (mapRow?.value && typeof mapRow.value === 'object') ? mapRow.value : {};

      let overridesOverlay: any = null;
      if (args.report_id) {
        const { data: report } = await supabase
          .from('investment_reports').select('id, manual_overrides, report_scope')
          .eq('id', args.report_id).maybeSingle();
        const preGen = (report?.manual_overrides && typeof report.manual_overrides === 'object')
          ? report.manual_overrides : {};
        overridesOverlay = {
          report_id: report?.id ?? args.report_id,
          report_scope: report?.report_scope ?? null,
          pre_gen_keys: Object.keys(preGen),
          pre_gen_key_count: Object.keys(preGen).length,
        };
      }
      return {
        scope, template_type: templateType,
        template_pool_size: templatesOut.length,
        total_embedding_chunks: Object.values(chunkCounts).reduce((a, b) => a + b, 0),
        templates: templatesOut,
        section_template_map: sectionTemplateMap,
        pinned_section_count: Object.keys(sectionTemplateMap).length,
        overrides: overridesOverlay,
        note: 'Registry section lists live in src/lib/reports/reportSplitRegistry.ts (compass-40, fin, pldd). Each section is eligible to draw from the full pool above via semantic retrieval; pinned templates (if any) take precedence.',
      };
    }

    case 'audit_report': {
      const reportId = String(args.report_id || '');
      if (!reportId) return { error: 'report_id required' };
      // 1. lookup
      const { data: report } = await supabase
        .from('investment_reports')
        .select(`${REPORT_BASE_SELECT}, ${REPORT_JSON_FIELDS.join(',')}`)
        .eq('id', reportId).maybeSingle();
      if (!report) return { error: 'report not found' };
      const scope = String(args.scope || report.report_tier || report.report_scope || 'compass').toLowerCase();

      // 2. runs (informational only — absence is OK)
      const { data: runs } = await supabase
        .from('report_generation_runs')
        .select('id, scope, variant, status, started_at, finished_at, model, total_prompt_tokens, total_completion_tokens, error')
        .eq('report_id', reportId).order('started_at', { ascending: false }).limit(10);

      // 3. data spine summary
      const summarize = (v: any) => {
        if (v == null) return { present: false };
        const bytes = JSON.stringify(v).length;
        if (Array.isArray(v)) return { present: true, kind: 'array', length: v.length, bytes };
        if (typeof v === 'object') return { present: true, kind: 'object', keys: Object.keys(v), key_count: Object.keys(v).length, bytes };
        return { present: true, kind: typeof v, bytes };
      };
      const dataSpine = {
        manual_overrides: summarize(report.manual_overrides),
        financial_calculations: summarize(report.financial_calculations),
        demographics_data: summarize(report.demographics_data),
        economic_data: summarize(report.economic_data),
        investment_score: summarize(report.investment_score),
        location_intelligence: summarize(report.location_intelligence),
        property_specs: summarize(report.property_specs),
        validation_flags: summarize(report.validation_flags),
        data_sources: summarize(report.data_sources),
      };

      // 4. static plan
      const planRes = await runTool(supabase, 'static_plan', { scope, report_id: reportId });

      // 5. engine config snapshot for scope
      const { data: configs } = await supabase
        .from('report_engine_config').select('config_key, scope, value, updated_at')
        .in('scope', [scope, 'default', 'global'])
        .order('config_key');

      // 6. audit log targeting this report
      const { data: audit } = await supabase
        .from('report_engine_audit')
        .select('target_kind, target_id, before_value, after_value, performed_at, rationale, performed_by')
        .eq('target_id', reportId).order('performed_at', { ascending: false }).limit(50);

      // 7. anomaly checks
      const anomalies: string[] = [];
      if (!dataSpine.financial_calculations.present) anomalies.push('financial_calculations missing — investment score will degrade');
      if (!dataSpine.investment_score.present) anomalies.push('investment_score missing');
      if (!dataSpine.location_intelligence.present) anomalies.push('location_intelligence missing — Compass location chapters will be thin');
      if (!dataSpine.demographics_data.present) anomalies.push('demographics_data missing');
      if (planRes?.template_pool_size === 0) anomalies.push('template pool is empty for this scope/tier/category');
      if (planRes?.total_embedding_chunks === 0) anomalies.push('no embedding chunks indexed for any template in the pool');
      if (report.status === 'failed' || report.error_message) anomalies.push(`last status: ${report.status}${report.error_message ? ' — ' + report.error_message : ''}`);

      return {
        report: {
          id: report.id, property_address: report.property_address,
          report_scope: report.report_scope, report_tier: report.report_tier, report_variant: report.report_variant,
          derived_from_report_id: report.derived_from_report_id, parent_report_id: report.parent_report_id,
          status: report.status, generation_engine: report.generation_engine,
          current_version: report.current_version, total_sections: report.total_sections,
          last_completed_section: report.last_completed_section, error_message: report.error_message,
          created_at: report.created_at, updated_at: report.updated_at,
        },
        scope_used: scope,
        runs: { count: runs?.length ?? 0, latest: runs?.[0] ?? null, all: runs ?? [] },
        data_spine: dataSpine,
        static_plan: planRes,
        engine_config: configs ?? [],
        post_gen_audit: audit ?? [],
        anomalies,
        note: runs && runs.length ? undefined : 'No generation runs recorded for this report — audit performed statically from the data spine + engine config.',
      };
    }

    case 'simulate_data_packet': {
      const reportId = String(args.report_id || '');
      if (!reportId) return { error: 'report_id required' };
      const { data: report } = await supabase
        .from('investment_reports')
        .select(`${REPORT_BASE_SELECT}, ${REPORT_JSON_FIELDS.join(',')}`)
        .eq('id', reportId).maybeSingle();
      if (!report) return { error: 'report not found' };
      const scope = String(args.scope || report.report_tier || report.report_scope || 'compass').toLowerCase();

      // Engine config snapshot (system prompt + retrieval knobs)
      const { data: configs } = await supabase
        .from('report_engine_config').select('config_key, scope, value')
        .in('scope', [scope, 'default', 'global']);
      const cfgIdx: Record<string, any> = {};
      for (const c of configs ?? []) {
        // scope precedence: specific scope > default > global (first-wins after sort)
      }
      const pickCfg = (key: string) => {
        const ordered = (configs ?? []).filter((c: any) => c.config_key === key)
          .sort((a: any, b: any) => {
            const rank = (s: string) => s === scope ? 0 : s === 'default' ? 1 : 2;
            return rank(a.scope) - rank(b.scope);
          });
        return ordered[0]?.value ?? null;
      };
      const systemPrompt = pickCfg(`system_prompt:${scope}`) ?? pickCfg('system_prompt') ?? null;
      const retrieval = pickCfg(`retrieval:${scope}`) ?? pickCfg('retrieval') ?? null;
      const hardExclusions = pickCfg(`hard_exclusions:${scope}`) ?? pickCfg('hard_exclusions') ?? null;
      const sectionMap = pickCfg(`section_template_map:${scope}`) ?? {};

      const mo = (report.manual_overrides && typeof report.manual_overrides === 'object') ? report.manual_overrides : {};
      const moKeys = Object.keys(mo);

      // Build the simulated packet (mirrors generate-investment-report's enhancedData shape)
      const packet: Record<string, any> = {
        report_id: report.id,
        property_address: report.property_address,
        report_scope: report.report_scope,
        report_tier: report.report_tier,
        report_variant: report.report_variant,
        manual_overrides: args.include_raw_overrides ? mo : { __summary: { key_count: moKeys.length, keys: moKeys } },
        financial_calculations: report.financial_calculations ?? null,
        demographics_data: report.demographics_data ?? null,
        economic_data: report.economic_data ?? null,
        investment_score: report.investment_score ?? null,
        location_intelligence: report.location_intelligence ?? null,
        property_specs: report.property_specs ?? null,
        validation_flags: report.validation_flags ?? null,
        data_sources: report.data_sources ?? null,
      };

      // Apply packet_config filtering (whitelist/blacklist/truncation)
      const packetCfg = await loadPacketConfig(supabase, scope);
      const { filtered: filteredPacket, trace: packetTrace } = applyPacketConfig(packet, packetCfg, args.section_key);

      const sizes: Record<string, number> = {};
      for (const [k, v] of Object.entries(filteredPacket)) {
        sizes[k] = v == null ? 0 : JSON.stringify(v).length;
      }
      const totalBytes = Object.values(sizes).reduce((a, b) => a + b, 0);

      // Per-section slice
      let sectionSlice: any = null;
      if (args.section_key) {
        const pinnedIds: string[] = Array.isArray(sectionMap[args.section_key]) ? sectionMap[args.section_key] : [];
        let pinnedTemplates: any[] = [];
        let chunkCounts: Record<string, number> = {};
        if (pinnedIds.length) {
          const { data: tpls } = await supabase
            .from('report_structure_templates')
            .select('id, name, template_type, report_tier, report_category, is_active, priority')
            .in('id', pinnedIds);
          pinnedTemplates = tpls ?? [];
          const docNames = pinnedIds.map((id) => `template:${id}`);
          const { data: chunkRows } = await supabase
            .from('document_chunks').select('document_name').in('document_name', docNames);
          for (const r of chunkRows ?? []) chunkCounts[r.document_name] = (chunkCounts[r.document_name] ?? 0) + 1;
        }
        const overrideHints = moKeys.filter((k) => k.toLowerCase().includes(String(args.section_key).toLowerCase()));
        sectionSlice = {
          section_key: args.section_key,
          pinned_template_ids: pinnedIds,
          pinned_templates: pinnedTemplates.map((t: any) => ({ ...t, embedding_chunks: chunkCounts[`template:${t.id}`] ?? 0 })),
          override_hints: overrideHints,
        };
      }

      return {
        report_id: report.id,
        scope_used: scope,
        simulated: true,
        note: 'Synthesised from current investment_reports row + engine_config + section_template_map. This mirrors what generate-investment-report would inject as data_packet on its next run.',
        system_prompt: systemPrompt ? { resolved: true, bytes: JSON.stringify(systemPrompt).length, value: typeof systemPrompt === 'string' ? systemPrompt.slice(0, 4000) : systemPrompt } : { resolved: false },
        retrieval_config: retrieval,
        hard_exclusions: hardExclusions,
        section_template_map_keys: Object.keys(sectionMap),
        manual_overrides_injection: {
          present: moKeys.length > 0,
          key_count: moKeys.length,
          keys: moKeys,
          bytes: sizes.manual_overrides,
          injected_at_root: true,
          note: 'manual_overrides is shallow-merged into the packet root and also passed verbatim — sections can read it directly.',
        },
        packet_shape: Object.keys(filteredPacket),
        packet_sizes_bytes: sizes,
        packet_total_bytes: totalBytes,
        packet_preview: filteredPacket,
        packet_config: { resolved: packetCfg, trace: packetTrace },
        section_slice: sectionSlice,
      };
    }

    // ── Split registry tools ─────────────────────────────────────────────
    case 'get_split_registry': {
      const live = await loadSplitRegistry(supabase);
      const defaults = defaultSplitRegistryBundle();
      const { data: configs } = await supabase
        .from('report_engine_config').select('config_key, scope, value, updated_at, updated_by')
        .in('config_key', ['split_routes', 'split_metadata', 'split_section_order_fin', 'split_section_order_pldd']);
      return {
        source: live.source,
        live: {
          routes_count: live.routes.length,
          routes: live.routes,
          section_order_fin: live.finSectionOrder,
          section_order_pldd: live.plddSectionOrder,
          metadata: {
            fin_title: live.finTitle, fin_subtitle: live.finSubtitle,
            pldd_title: live.plddTitle, pldd_subtitle: live.plddSubtitle,
            fin_lens_preamble: live.finLensPreamble, pldd_lens_preamble: live.plddLensPreamble,
            fin_footer: live.finFooter, pldd_footer: live.plddFooter,
          },
        },
        defaults,
        db_rows: configs ?? [],
        note: 'Edits via propose_split_registry_edit stage into report_engine_proposals; superadmin Apply upserts into report_engine_config. Affects every future FIN/PLDD fork from fork-investment-report.',
      };
    }

    case 'propose_split_registry_edit': {
      const config_key = String(args.config_key || '');
      if (!['split_routes', 'split_metadata', 'split_section_order_fin', 'split_section_order_pldd'].includes(config_key)) {
        return { error: 'invalid config_key' };
      }
      const { data: before } = await supabase
        .from('report_engine_config').select('*')
        .eq('config_key', config_key).eq('scope', 'global').maybeSingle();
      const p = await stageProposal(supabase, {
        target_kind: 'engine_config',
        target_id: `${config_key}:global`,
        before_value: before ?? null,
        after_value: { config_key, scope: 'global', value: args.new_value },
        rationale: args.rationale,
        proposed_by_agent: true,
        status: 'pending',
      });
      return p;
    }

    case 'reset_split_registry_to_defaults': {
      const defaults = defaultSplitRegistryBundle();
      const target = String(args.config_key || 'all');
      const map: Record<string, any> = {
        split_routes: defaults.routes,
        split_section_order_fin: defaults.section_order_fin,
        split_section_order_pldd: defaults.section_order_pldd,
        split_metadata: defaults.metadata,
      };
      const keys = target === 'all' ? Object.keys(map) : [target];
      const staged: any[] = [];
      for (const key of keys) {
        if (!(key in map)) continue;
        const { data: before } = await supabase
          .from('report_engine_config').select('*')
          .eq('config_key', key).eq('scope', 'global').maybeSingle();
        const p = await stageProposal(supabase, {
          target_kind: 'engine_config',
          target_id: `${key}:global`,
          before_value: before ?? null,
          after_value: { config_key: key, scope: 'global', value: map[key] },
          rationale: args.rationale + ' (reset to in-code defaults)',
          proposed_by_agent: true,
          status: 'pending',
        });
        staged.push(p);
      }
      return { staged_count: staged.length, proposals: staged };
    }

    // ── Packet config tools ──────────────────────────────────────────────
    case 'get_packet_config': {
      const scope = String(args.scope || 'global');
      const cfg = await loadPacketConfig(supabase, scope);
      const { data: rows } = await supabase
        .from('report_engine_config').select('config_key, scope, value, updated_at, updated_by')
        .in('config_key', ['packet_config', `packet_config:${scope}`]);
      return {
        scope_requested: scope,
        resolved: cfg,
        default_packet_keys: DEFAULT_PACKET_KEYS,
        db_rows: rows ?? [],
        note: 'inline_keys empty = include all DEFAULT_PACKET_KEYS. exclude_keys always wins. per_section_overrides override the scope-level lists for that section_key only.',
      };
    }

    case 'propose_packet_config_edit': {
      const scope = String(args.scope || 'global');
      const config_key = scope === 'global' ? 'packet_config' : `packet_config:${scope}`;
      const { data: before } = await supabase
        .from('report_engine_config').select('*')
        .eq('config_key', config_key).eq('scope', scope === 'global' ? 'global' : scope).maybeSingle();
      const p = await stageProposal(supabase, {
        target_kind: 'engine_config',
        target_id: `${config_key}:${scope === 'global' ? 'global' : scope}`,
        before_value: before ?? null,
        after_value: { config_key, scope: scope === 'global' ? 'global' : scope, value: args.new_value },
        rationale: args.rationale,
        proposed_by_agent: true,
        status: 'pending',
      });
      return p;
    }

    default:
      return { error: `unknown tool ${name}` };
  }
}


// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body = await req.json().catch(() => ({}));
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) return createUnauthorizedResponse(authError || 'auth required', corsHeaders);
    if (!(await isSuperadmin(supabase, userId))) return createForbiddenResponse('superadmin only', corsHeaders);

    const messages: any[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(Array.isArray(body.messages) ? body.messages : []),
    ];

    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableKey) return json({ error: 'LOVABLE_API_KEY missing' }, corsHeaders, 500);

    const invocations: any[] = [];
    let assistantText = '';
    const MAX_TURNS = 8;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const resp = await meteredFetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${lovableKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages,
          tools: toolDefs(),
        }),
      });

      if (!resp.ok) {
        const t = await resp.text();
        return json({ error: `AI gateway ${resp.status}: ${t.slice(0, 500)}` }, corsHeaders, 500);
      }
      const j = await resp.json();
      const msg = j?.choices?.[0]?.message;
      if (!msg) return json({ error: 'no message from model' }, corsHeaders, 500);

      messages.push(msg);
      const toolCalls = msg.tool_calls || [];
      if (!toolCalls.length) { assistantText = msg.content || ''; break; }

      for (const call of toolCalls) {
        const name = call?.function?.name;
        let parsed: any = {};
        try { parsed = JSON.parse(call?.function?.arguments || '{}'); } catch {}
        const started = Date.now();
        let result: any; let error: string | undefined;
        try { result = await runTool(supabase, name, parsed); }
        catch (e: any) { error = e?.message || String(e); result = { error }; }
        invocations.push({ id: call.id, name, arguments: parsed, result, error, duration_ms: Date.now() - started });
        messages.push({
          role: 'tool', tool_call_id: call.id, name,
          content: JSON.stringify(result).slice(0, 12000),
        });
      }
    }

    return json({ assistant: assistantText, tool_invocations: invocations }, corsHeaders);
  } catch (e: any) {
    return json({ ...internalError(e, 'report-engine-agent') }, createCorsHeaders(origin), 500);
  }
});

function json(body: any, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
