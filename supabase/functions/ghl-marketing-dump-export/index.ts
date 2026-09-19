/**
 * ghl-marketing-dump-export
 *
 * Builds a .zip containing all dumped assets (or a single asset) with
 * portable HTML, raw payloads, screenshots, and downloaded asset files.
 * Returns a 24h signed URL.
 *
 * body: { asset_id?: string, scope?: 'all' | 'forms' | 'funnels' | 'workflows' | 'surveys' }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { strToU8, zipSync, type Zippable } from 'https://esm.sh/fflate@0.8.2';
import {
  verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse,
} from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const BUCKET = 'ghl-marketing-dump';
const EXPORT_BUCKET = 'ghl-marketing-dump';

function safeName(s: string | null | undefined, fallback: string): string {
  if (!s) return fallback;
  return s.replace(/[^a-z0-9_\-]+/gi, '_').slice(0, 80) || fallback;
}

function decodeDataUrl(s: string): { bytes: Uint8Array; ext: string } | null {
  const m = s.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const ct = m[1];
  const ext = ct.includes('png') ? 'png' : ct.includes('jpeg') ? 'jpg' : ct.includes('webp') ? 'webp' : 'bin';
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, ext };
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) return createUnauthorizedResponse(authError || 'Auth required', corsHeaders);
    if (userId !== 'service_role') {
      const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', userId);
      if (!(roles || []).some((r: any) => r.role === 'superadmin')) {
        return createForbiddenResponse('Superadmin only', corsHeaders);
      }
    }

    const assetId: string | null = body.asset_id || null;
    let query = supabase.from('ghl_marketing_raw_dumps').select('*');
    if (assetId) query = query.eq('id', assetId);
    const { data: rows, error } = await query;
    if (error) throw error;
    if (!rows || rows.length === 0) throw new Error('No data to export');

    const zipObj: Zippable = {};

    // Index file
    const index: any = {
      exported_at: new Date().toISOString(),
      total: rows.length,
      breakdown: {} as Record<string, number>,
      assets: [] as any[],
    };

    const indexLines: string[] = [
      '# GHL Marketing Asset Rebuild Kit',
      `Exported: ${new Date().toISOString()}`,
      `Total assets: ${rows.length}`,
      '',
      '## Folder structure',
      '- `forms/` — rendered HTML, raw JSON, fields, submissions, downloaded assets',
      '- `surveys/`, `quizzes/` — same as forms',
      '- `funnels/<funnel_id>/` — funnel metadata',
      '- `funnel_pages/` — rendered HTML + screenshots + assets per page',
      '- `workflows/snapshot-bridge.csv` — legacy↔new workflow ID mapping',
      '- `INDEX.json` — full machine-readable index',
      '',
      '## Reconstruction notes per type',
      '- **Forms / Surveys / Quizzes**: API-recoverable. Rebuild in GHL using raw_payload.fields + the embed snippet.',
      '- **Funnel pages**: builder JSON is API-locked. Use the screenshot + portable.html + asset manifest as a pixel reference and rebuild section-by-section in GHL Funnels.',
      '- **Workflows**: internals (steps, emails, SMS bodies, branches) are API-locked. Export a GHL Snapshot from the legacy account and import it into the new account, then map IDs in `workflows/snapshot-bridge.csv`.',
      '',
    ];

    const workflowBridgeCsv: string[] = ['legacy_workflow_id,legacy_name,trigger_summary,step_count,new_workflow_id,status,notes'];

    for (const r of rows) {
      index.breakdown[r.resource_type] = (index.breakdown[r.resource_type] || 0) + 1;
      const folder = r.resource_type === 'funnel' || r.resource_type === 'funnel_page'
        ? `funnels/${r.parent_ghl_id || r.ghl_id}${r.resource_type === 'funnel_page' ? `/pages/${safeName(r.name, r.ghl_id)}` : ''}`
        : r.resource_type === 'location_custom_schema'
          ? `_location/custom_fields_and_values`
          : `${r.resource_type}s/${safeName(r.name, r.ghl_id)}`;

      // Raw payload
      zipObj[`${folder}/metadata.json`] = strToU8(JSON.stringify({
        id: r.ghl_id, name: r.name, resource_type: r.resource_type,
        parent_ghl_id: r.parent_ghl_id, full_url: r.full_url,
        fetch_status: r.fetch_status, fetch_error: r.fetch_error,
        last_fetched_at: r.last_fetched_at,
        enrichment_sources: r.enrichment_sources,
        endpoints_tried: r.endpoints_tried,
        reconstruction_notes: r.reconstruction_notes,
      }, null, 2));
      zipObj[`${folder}/raw_payload.json`] = strToU8(JSON.stringify(r.raw_payload || {}, null, 2));

      if (r.html_content) zipObj[`${folder}/rendered.html`] = strToU8(r.html_content);
      if (r.raw_html_content) zipObj[`${folder}/raw.html`] = strToU8(r.raw_html_content);
      if (r.markdown_content) zipObj[`${folder}/content.md`] = strToU8(r.markdown_content);
      if (r.css_content) zipObj[`${folder}/styles.css`] = strToU8(r.css_content);
      if (r.inlined_css) zipObj[`${folder}/inlined.css`] = strToU8(r.inlined_css);
      if (r.embed_code) zipObj[`${folder}/embed.html`] = strToU8(r.embed_code);
      if (r.submissions_sample) zipObj[`${folder}/submissions.json`] = strToU8(JSON.stringify(r.submissions_sample, null, 2));
      if (r.links) zipObj[`${folder}/links.json`] = strToU8(JSON.stringify(r.links, null, 2));
      if (r.metadata) zipObj[`${folder}/page_metadata.json`] = strToU8(JSON.stringify(r.metadata, null, 2));

      // Screenshot — may be data URL or http URL
      if (r.screenshot_url) {
        try {
          if (r.screenshot_url.startsWith('data:')) {
            const d = decodeDataUrl(r.screenshot_url);
            if (d) zipObj[`${folder}/screenshot.${d.ext}`] = d.bytes;
          } else if (r.screenshot_url.startsWith('http')) {
            const ss = await fetch(r.screenshot_url);
            if (ss.ok) zipObj[`${folder}/screenshot.png`] = new Uint8Array(await ss.arrayBuffer());
          }
        } catch {}
      }

      // Portable HTML from storage
      if (r.portable_html_path) {
        const { data: pf } = await supabase.storage.from(BUCKET).download(r.portable_html_path);
        if (pf) zipObj[`${folder}/portable.html`] = new Uint8Array(await pf.arrayBuffer());
      }

      // Asset manifest + downloaded assets
      if (Array.isArray(r.asset_manifest) && r.asset_manifest.length) {
        zipObj[`${folder}/asset_manifest.json`] = strToU8(JSON.stringify(r.asset_manifest, null, 2));
        for (const a of r.asset_manifest) {
          if (!a.storage_path) continue;
          try {
            const { data: f } = await supabase.storage.from(BUCKET).download(a.storage_path);
            if (f) {
              const fname = a.storage_path.split('/').pop();
              zipObj[`${folder}/assets/${fname}`] = new Uint8Array(await f.arrayBuffer());
            }
          } catch {}
        }
      }

      if (r.resource_type === 'workflow') {
        // also written separately to bridge csv
      }

      index.assets.push({
        id: r.id, ghl_id: r.ghl_id, type: r.resource_type, name: r.name, folder,
        fetch_status: r.fetch_status, asset_count: r.asset_count, asset_bytes: r.asset_bytes,
      });
    }

    // Workflow bridge CSV
    const { data: bridge } = await supabase.from('ghl_workflow_snapshot_bridge').select('*');
    for (const b of bridge || []) {
      const cells = [b.legacy_workflow_id, b.legacy_name, b.trigger_summary, b.step_count, b.new_workflow_id, b.status, b.notes]
        .map((v) => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
      workflowBridgeCsv.push(cells.join(','));
    }
    zipObj['workflows/snapshot-bridge.csv'] = strToU8(workflowBridgeCsv.join('\n'));

    zipObj['INDEX.json'] = strToU8(JSON.stringify(index, null, 2));
    zipObj['README.md'] = strToU8(indexLines.join('\n'));

    const zipped = zipSync(zipObj, { level: 6 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportPath = `exports/ghl-rebuild-kit-${stamp}.zip`;
    const { error: upErr } = await supabase.storage.from(EXPORT_BUCKET).upload(exportPath, zipped, {
      contentType: 'application/zip', upsert: true,
    });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
    const { data: signed, error: sigErr } = await supabase.storage.from(EXPORT_BUCKET)
      .createSignedUrl(exportPath, 60 * 60 * 24);
    if (sigErr || !signed) throw new Error(`Signed URL failed: ${sigErr?.message}`);

    return new Response(JSON.stringify({
      success: true,
      url: signed.signedUrl,
      bytes: zipped.byteLength,
      total_assets: rows.length,
      breakdown: index.breakdown,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[ghl-marketing-dump-export] error:', e);
    return new Response(JSON.stringify({ ...internalError(e, 'ghl-marketing-dump-export'), success: false }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
