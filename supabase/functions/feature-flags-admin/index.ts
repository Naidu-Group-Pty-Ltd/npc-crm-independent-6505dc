// feature-flags-admin — superadmin-only CRUD for `public.feature_flags`.
//
// Phase 6 of the Docling pipeline plan exposes the `pdf_import.engine` flag
// through a small admin UI. Frontend uses anon key + custom-auth session, so
// the table's `has_role(auth.uid(), 'superadmin')` RLS policy can't fire;
// this function mediates with the service-role key after re-checking the
// superadmin role server-side.
//
// Operations:
//   - { operation: 'get',    key }            -> { row }
//   - { operation: 'list',   prefix? }        -> { rows }
//   - { operation: 'upsert', key, value, description? } -> { row }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  verifyAuth,
  createTokenAuthCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  const cors = createTokenAuthCorsHeaders();
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(cors, __csrf);

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = await req.json().catch(() => ({}));
    const auth = await verifyAuth(admin, req.headers, body);
    if (auth.error || !auth.userId) return createUnauthorizedResponse(auth.error ?? 'unauthorized', cors);
    if (auth.userId === 'service_role') {
      // Internal callers may proceed.
    } else {
      const { data: roles } = await admin
        .from('user_roles')
        .select('role')
        .eq('user_id', auth.userId);
      const isSuperadmin = Array.isArray(roles) && roles.some((r: any) => r.role === 'superadmin');
      if (!isSuperadmin) return createForbiddenResponse('superadmin required', cors);
    }

    const operation = (body.operation as string) || 'get';

    if (operation === 'list') {
      const prefix = typeof body.prefix === 'string' ? body.prefix : null;
      let q = admin.from('feature_flags').select('key,value,description,updated_at,updated_by').order('key');
      if (prefix) q = q.like('key', `${prefix}%`);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ rows: data ?? [] });
    }

    if (operation === 'get') {
      const key = body.key as string;
      if (!key) return json({ error: 'key required' }, 400);
      const { data, error } = await admin
        .from('feature_flags')
        .select('key,value,description,updated_at,updated_by')
        .eq('key', key)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ row: data });
    }

    if (operation === 'upsert') {
      const key = body.key as string;
      if (!key) return json({ error: 'key required' }, 400);
      if (body.value === undefined) return json({ error: 'value required' }, 400);
      const patch: Record<string, unknown> = {
        key,
        value: body.value,
        updated_by: auth.userId === 'service_role' ? null : auth.userId,
        updated_at: new Date().toISOString(),
      };
      if (typeof body.description === 'string') patch.description = body.description;
      const { data, error } = await admin
        .from('feature_flags')
        .upsert(patch, { onConflict: 'key' })
        .select('key,value,description,updated_at,updated_by')
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ row: data });
    }

    return json({ error: `unknown operation: ${operation}` }, 400);
  } catch (e) {
    console.error('[feature-flags-admin] unhandled', e);
    return json({ ...internalError(e, 'feature-flags-admin') }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
