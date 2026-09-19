/**
 * Phase 7.6 — Settings & Collaboration backbone for the finance portal.
 *
 * Operations (partner session token required: x-finance-session-token):
 *
 *   ── Entity comments (F1) ─────────────────────────────────────────────
 *   list_comments    { purchase_file_id, entity_type, entity_id? }
 *   post_comment     { purchase_file_id, entity_type, entity_id?, parent_id?, body, visibility?, mentions? }
 *   delete_comment   { id }            -- soft-delete (sets deleted_at). Author or superadmin only.
 *
 *   ── Notification routing (H2) ────────────────────────────────────────
 *   get_notification_prefs   {}
 *   upsert_notification_pref { event_type, channels[], quiet_hours_start?, quiet_hours_end?, timezone?, is_enabled? }
 *
 *   ── Partner branding (H3) ────────────────────────────────────────────
 *   get_branding             {}
 *   upsert_branding          { logo_storage_path?, accent_hsl?, company_display_name?, tagline? }
 *   branding_logo_upload_url { filename, content_type }  -- signed upload URL
 *   branding_logo_signed_url {}                          -- signed read URL for own logo
 *
 * Internal: service-role.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.55.0';

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token, x-portal-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const BRANDING_BUCKET = 'finance-partner-branding';

const jsonWithHeaders = (data: unknown, responseCorsHeaders: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });

// Delegates to the ONE cookie-aware reader. The local body used to read only
// the header and the request body, so a portal whose session lives in the
// HttpOnly `__Host-finance_session_token` cookie (WP-11B/C) got a 401 on
// every call once its in-memory token was lost to a page load.
function extractToken(req: Request, body: any): string | null {
  return extractFinanceSessionToken(req.headers, body as Record<string, unknown> | undefined);
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const { operation = '' } = body || {};

    const token = extractToken(req, body);
    if (!token) return json({ error: 'Session token required' }, 401);

    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, finance_contact_id, email, is_active, revoked_at, session_expires_at')
      .eq('session_token', token)
      .maybeSingle();

    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return json({ error: 'Invalid session' }, 401);
    }
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return json({ error: 'Session expired' }, 401);
    }

    const partnerId = portalUser.finance_contact_id;
    // finance_portal_users has no role column; superadmin override is unavailable
    // here, so authors can manage their own items only.
    const isSuperadmin = false;

    async function canAccessPurchaseFile(purchaseFileId: string): Promise<boolean> {
      const { data: purchaseFile, error: purchaseFileError } = await supabase
        .from('purchase_files')
        .select('client_id')
        .eq('id', purchaseFileId)
        .maybeSingle();
      if (purchaseFileError || !purchaseFile?.client_id) return false;

      const { data: assignment, error: assignmentError } = await supabase
        .from('finance_portal_client_assignments')
        .select('purchase_file_id')
        .eq('finance_user_id', portalUser.id)
        .eq('client_id', purchaseFile.client_id)
        .maybeSingle();

      return !assignmentError && !!assignment &&
        (!assignment.purchase_file_id || assignment.purchase_file_id === purchaseFileId);
    }

    // ── COMMENTS ───────────────────────────────────────────────────────
    if (operation === 'list_comments') {
      const { purchase_file_id, entity_type, entity_id } = body;
      if (!purchase_file_id || !entity_type) return json({ error: 'purchase_file_id and entity_type required' }, 400);
      if (!await canAccessPurchaseFile(purchase_file_id)) return json({ error: 'Forbidden' }, 403);

      let q = supabase
        .from('purchase_file_entity_comments')
        .select('*')
        .eq('purchase_file_id', purchase_file_id)
        .eq('entity_type', entity_type)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (entity_id) q = q.eq('entity_id', entity_id);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ comments: data || [] });
    }

    if (operation === 'post_comment') {
      const { purchase_file_id, entity_type, entity_id, parent_id, body: text, visibility = 'internal_npc', mentions = [] } = body;
      if (!purchase_file_id || !entity_type || !text?.trim()) {
        return json({ error: 'purchase_file_id, entity_type and body required' }, 400);
      }
      if (!await canAccessPurchaseFile(purchase_file_id)) return json({ error: 'Forbidden' }, 403);
      const row = {
        purchase_file_id,
        entity_type,
        entity_id: entity_id || null,
        parent_id: parent_id || null,
        body: String(text).trim(),
        visibility,
        author_type: 'finance' as const,
        author_id: portalUser.id,
        author_name: portalUser.name || portalUser.email || 'Partner',
        mentions: Array.isArray(mentions) ? mentions : [],
      };
      const { data, error } = await supabase
        .from('purchase_file_entity_comments')
        .insert(row)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ comment: data });
    }

    if (operation === 'delete_comment') {
      const { id } = body;
      if (!id) return json({ error: 'id required' }, 400);
      const { data: existing } = await supabase
        .from('purchase_file_entity_comments')
        .select('author_id')
        .eq('id', id)
        .maybeSingle();
      if (!existing) return json({ error: 'Not found' }, 404);
      if (existing.author_id !== portalUser.id && !isSuperadmin) {
        return json({ error: 'Forbidden' }, 403);
      }
      const { error } = await supabase
        .from('purchase_file_entity_comments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    // ── NOTIFICATION PREFS ─────────────────────────────────────────────
    if (operation === 'get_notification_prefs') {
      const { data } = await supabase
        .from('finance_partner_notification_prefs')
        .select('*')
        .eq('finance_contact_id', partnerId)
        .order('event_type');
      return json({ prefs: data || [] });
    }

    if (operation === 'upsert_notification_pref') {
      const { event_type, channels, quiet_hours_start, quiet_hours_end, timezone, is_enabled } = body;
      if (!event_type || !Array.isArray(channels)) {
        return json({ error: 'event_type and channels[] required' }, 400);
      }
      const validChannels = channels.filter((c: string) => ['in_app', 'email', 'sms', 'push'].includes(c));
      const { data, error } = await supabase
        .from('finance_partner_notification_prefs')
        .upsert({
          finance_contact_id: partnerId,
          event_type,
          channels: validChannels,
          quiet_hours_start: quiet_hours_start || null,
          quiet_hours_end: quiet_hours_end || null,
          timezone: timezone || 'Australia/Sydney',
          is_enabled: is_enabled !== false,
        }, { onConflict: 'finance_contact_id,event_type' })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ pref: data });
    }

    // ── BRANDING ───────────────────────────────────────────────────────
    if (operation === 'get_branding') {
      const { data } = await supabase
        .from('finance_partner_branding')
        .select('*')
        .eq('finance_contact_id', partnerId)
        .maybeSingle();
      let signedLogoUrl: string | null = null;
      if (data?.logo_storage_path) {
        const { data: signed } = await supabase.storage
          .from(BRANDING_BUCKET)
          .createSignedUrl(data.logo_storage_path, 60 * 60 * 24);
        signedLogoUrl = signed?.signedUrl || null;
      }
      return json({ branding: data || null, signed_logo_url: signedLogoUrl });
    }

    if (operation === 'upsert_branding') {
      const { logo_storage_path, accent_hsl, company_display_name, tagline } = body;
      const { data, error } = await supabase
        .from('finance_partner_branding')
        .upsert({
          finance_contact_id: partnerId,
          logo_storage_path: logo_storage_path ?? null,
          accent_hsl: accent_hsl ?? null,
          company_display_name: company_display_name ?? null,
          tagline: tagline ?? null,
          updated_by_finance_user_id: portalUser.id,
        }, { onConflict: 'finance_contact_id' })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ branding: data });
    }

    if (operation === 'branding_logo_upload_url') {
      const { filename, content_type } = body;
      if (!filename) return json({ error: 'filename required' }, 400);
      const safe = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${partnerId}/${Date.now()}_${safe}`;
      const { data, error } = await supabase.storage
        .from(BRANDING_BUCKET)
        .createSignedUploadUrl(path);
      if (error) return json({ error: error.message }, 500);
      return json({ ...data, path, content_type: content_type || 'image/png' });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (err: any) {
    return json({ ...internalError(err, 'finance-portal-settings') }, 500);
  }
});
