/**
 * manage-branding — service-role mediated read/write for `whitelabel_settings`.
 *
 * Why this exists: the Branding page wrote directly through PostgREST with the
 * short-lived RLS access-token JWT. Staff sessions live in the HttpOnly
 * `__Host-session_token` cookie; the access token is a derived, tab-scoped
 * artefact that can be missing or expired while the user is very much signed
 * in. When that happened the UPDATE matched zero rows and the page reported
 * "Branding changes were not saved / no database token". Routing the write
 * through this function makes the cookie session the source of truth, exactly
 * like every other mediated table in the project.
 *
 * Deploy with verify_jwt = false: the gateway cannot see the cookie session, so
 * authentication is performed inside the handler by `verifyAuth`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders, createForbiddenResponse } from "../_shared/auth.ts";
import { requireModulePermission } from "../_shared/authz.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';

type Operation = 'get' | 'update';

/**
 * Only these columns may be written. Everything else on the row (id,
 * timestamps, anything added later) is server-owned. `null` is a legitimate
 * value for every asset column — that is how "remove logo" is expressed.
 */
const WRITABLE_COLUMNS = [
  'auth_logo',
  'sidebar_logo',
  'sidebar_icon',
  'favicon',
  'company_name',
  'primary_color',
  'accent_color',
  'dark_mode_default',
  'email_signature_banner',
  'email_signature_name',
  'email_signature_title',
  'email_signature_phone',
  'email_signature_email',
  'email_signature_website',
  'email_signature_address',
  'email_signature_disclaimer',
  'theme_config',
  'logo_config',
  'theme_version',
] as const;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({})) as {
      operation?: Operation;
      id?: string;
      data?: Record<string, unknown>;
      session_token?: string;
    };

    const { error: authError, userId, username, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[manage-branding] Auth error:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    const operation: Operation = body.operation === 'update' ? 'update' : 'get';

    if (operation === 'get') {
      const { data, error } = await supabase
        .from('whitelabel_settings')
        .select('*')
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error('[manage-branding] Read failed:', error);
        return json({ success: false, error: error.message }, 400);
      }
      return json({ success: true, operation, settings: data });
    }

    // Writes are a genuine tenant-wide configuration change — gate them on the
    // same module permission the Branding page uses in the browser.
    const permission = await requireModulePermission(
      supabase,
      { userId, authMethod },
      'white_label',
      'can_edit',
    );
    if (!permission.ok) {
      console.warn('[manage-branding] Permission denied:', { userId, reason: permission.reason_code });
      return createForbiddenResponse(permission.error || 'White Label edit permission required', corsHeaders);
    }

    const incoming = body.data || {};
    const update: Record<string, unknown> = {};
    for (const column of WRITABLE_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(incoming, column)) {
        // Trimmed at the write boundary: the production company name carried
        // a trailing space for months (audit F15). Every reader trimmed it
        // defensively, which is how nobody noticed the record was wrong.
        const value = incoming[column];
        update[column] = typeof value === 'string' ? value.trim() : value;
      }
    }

    if (Object.keys(update).length === 0) {
      return json({ success: false, error: 'No branding fields supplied.' }, 400);
    }

    if (typeof update.company_name === 'string' && update.company_name.trim().length === 0) {
      return json({ success: false, error: 'Company name cannot be empty.' }, 400);
    }

    // Resolve the target row server-side when the client did not supply an id,
    // so a client that never finished loading can still save.
    let targetId = typeof body.id === 'string' && body.id ? body.id : null;
    if (!targetId) {
      const { data: existing, error: lookupError } = await supabase
        .from('whitelabel_settings')
        .select('id')
        .limit(1)
        .maybeSingle();
      if (lookupError) {
        console.error('[manage-branding] Row lookup failed:', lookupError);
        return json({ success: false, error: lookupError.message }, 400);
      }
      targetId = existing?.id ?? null;
    }

    if (!targetId) {
      const { data: created, error: insertError } = await supabase
        .from('whitelabel_settings')
        .insert(update)
        .select('*')
        .single();
      if (insertError) {
        console.error('[manage-branding] Insert failed:', insertError);
        return json({ success: false, error: insertError.message }, 400);
      }
      console.log(`[manage-branding] Created branding row by ${username || userId}`);
      return json({ success: true, operation, settings: created });
    }

    const { data: updated, error: updateError } = await supabase
      .from('whitelabel_settings')
      .update(update)
      .eq('id', targetId)
      .select('*')
      .maybeSingle();

    if (updateError) {
      console.error('[manage-branding] Update failed:', updateError);
      return json({ success: false, error: updateError.message }, 400);
    }

    if (!updated) {
      return json({ success: false, error: 'Branding record no longer exists.' }, 404);
    }

    console.log(`[manage-branding] Saved branding by ${username || userId}`);
    return json({ success: true, operation, settings: updated });
  } catch (error) {
    console.error('[manage-branding] Unexpected error:', error);
    return json({ ...internalError(error, 'manage-branding'), success: false }, 500);
  }
});
