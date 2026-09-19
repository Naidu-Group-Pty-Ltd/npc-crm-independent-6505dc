import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const GHL_API_BASE = 'https://services.leadconnectorhq.com';

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const apiKey = Deno.env.get('GOHIGHLEVEL_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!apiKey || !supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: 'Missing configuration', success: false }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl.trim(), supabaseKey.trim());

    const body = await req.json();

    // SECURITY: Verify authentication
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[backfill-notes-to-ghl] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[backfill-notes-to-ghl] Authenticated user: ${userId}`);

    // Fetch all unsynced notes for non-Active-Client contacts with GHL contact IDs
    const { data: notes, error: fetchError } = await supabase
      .from('client_notes')
      .select('id, content, note_type, client_id, clients!inner(ghl_contact_id, pipeline_status, primary_first_name, primary_surname)')
      .is('ghl_note_id', null)
      .neq('clients.pipeline_status', 'Active Client')
      .not('clients.ghl_contact_id', 'is', null);

    if (fetchError) {
      console.error('[backfill-notes-to-ghl] Query error:', fetchError);
      return new Response(JSON.stringify({ error: fetchError.message, success: false }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[backfill-notes-to-ghl] Found ${notes?.length || 0} notes to backfill`);

    if (!notes || notes.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No notes to backfill', synced: 0, failed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ghlHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    let synced = 0;
    let failed = 0;
    const errors: Array<{ noteId: string; error: string }> = [];

    for (const note of notes) {
      const client = (note as any).clients;
      const ghlContactId = client?.ghl_contact_id;

      if (!ghlContactId) {
        console.log(`[backfill] Skipping note ${note.id} - no GHL contact ID`);
        continue;
      }

      const formattedNote = note.note_type && note.note_type !== 'general'
        ? `[${note.note_type.toUpperCase()}] ${note.content}`
        : note.content;

      try {
        // Rate limit: 500ms between requests to avoid GHL throttling
        await delay(500);

        const res = await fetch(`${GHL_API_BASE}/contacts/${ghlContactId}/notes`, {
          method: 'POST',
          headers: ghlHeaders,
          body: JSON.stringify({ body: formattedNote }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[backfill] Failed for note ${note.id} (${client.primary_first_name} ${client.primary_surname}): ${errText}`);
          errors.push({ noteId: note.id, error: errText });
          failed++;
          continue;
        }

        const ghlData = await res.json();
        const ghlNoteId = ghlData?.note?.id;

        if (ghlNoteId) {
          await supabase
            .from('client_notes')
            .update({ ghl_note_id: ghlNoteId })
            .eq('id', note.id);
        }

        synced++;
        console.log(`[backfill] ✅ Synced note ${note.id} for ${client.primary_first_name} ${client.primary_surname} → GHL note ${ghlNoteId}`);
      } catch (err) {
        console.error(`[backfill] Exception for note ${note.id}:`, err);
        errors.push({ noteId: note.id, error: err.message });
        failed++;
      }
    }

    console.log(`[backfill-notes-to-ghl] Complete: ${synced} synced, ${failed} failed out of ${notes.length} total`);

    return new Response(JSON.stringify({
      success: true,
      total: notes.length,
      synced,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[backfill-notes-to-ghl] Error:', error);
    return new Response(JSON.stringify({ ...internalError(error, 'backfill-notes-to-ghl'), success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
