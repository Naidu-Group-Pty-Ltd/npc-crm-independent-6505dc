// Batch 7D.2 — Lender favourites CRUD (service-role mediated)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
interface Body {
  action: 'list' | 'add' | 'remove' | 'reorder' | 'updateNotes';
  lender_id?: string;
  lender_name?: string;
  notes?: string;
  ordered_ids?: string[];
  session_token?: string;
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(cors, __csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body: Body = await req.json();
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId || auth.userId === 'service_role') {
      return createUnauthorizedResponse(auth.error || 'Auth required', cors);
    }
    const userId = auth.userId;

    const j = (data: any, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    switch (body.action) {
      case 'list': {
        const { data, error } = await supabase
          .from('lender_favourites')
          .select('*')
          .eq('user_id', userId)
          .order('display_order', { ascending: true })
          .order('lender_name', { ascending: true });
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'add': {
        if (!body.lender_id || !body.lender_name) return j({ success: false, error: 'lender_id and lender_name required' }, 400);
        const { data, error } = await supabase
          .from('lender_favourites')
          .upsert({ user_id: userId, lender_id: body.lender_id, lender_name: body.lender_name, notes: body.notes ?? null }, { onConflict: 'user_id,lender_id' })
          .select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'updateNotes': {
        if (!body.lender_id) return j({ success: false, error: 'lender_id required' }, 400);
        const { data, error } = await supabase
          .from('lender_favourites')
          .update({ notes: body.notes ?? null })
          .eq('user_id', userId).eq('lender_id', body.lender_id)
          .select().single();
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true, data });
      }
      case 'remove': {
        if (!body.lender_id) return j({ success: false, error: 'lender_id required' }, 400);
        const { error } = await supabase
          .from('lender_favourites')
          .delete()
          .eq('user_id', userId).eq('lender_id', body.lender_id);
        if (error) return j({ success: false, error: error.message }, 500);
        return j({ success: true });
      }
      case 'reorder': {
        if (!Array.isArray(body.ordered_ids)) return j({ success: false, error: 'ordered_ids required' }, 400);
        for (let i = 0; i < body.ordered_ids.length; i++) {
          await supabase.from('lender_favourites')
            .update({ display_order: i })
            .eq('user_id', userId).eq('lender_id', body.ordered_ids[i]);
        }
        return j({ success: true });
      }
      default:
        return j({ success: false, error: 'Invalid action' }, 400);
    }
  } catch (e: any) {
    return new Response(JSON.stringify({ ...internalError(e, 'manage-lender-favourites'), success: false }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
