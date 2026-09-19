import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getEffectiveGhlCredentials } from '../_shared/ghl-account.ts';
import { internalError } from '../_shared/errorResponse.ts';

// corsHeaders defined dynamically via createCorsHeaders below

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: 'Supabase credentials not configured', success: false }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    const _ghlCreds = await getEffectiveGhlCredentials(supabase);
    const apiKey = _ghlCreds.apiKey;
    console.log(`[sync-notes-to-ghl] Using GHL account: ${_ghlCreds.label}`);

    if (!apiKey) {
      console.error('GHL API key not configured');
      return new Response(JSON.stringify({ 
        error: 'GoHighLevel API key not configured',
        success: false 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { action, clientId, noteId, noteContent, noteType } = body;

    // SECURITY: Verify authentication
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[sync-notes-to-ghl] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[sync-notes-to-ghl] Authenticated user: ${userId}`);

    if (!clientId) {
      return new Response(JSON.stringify({
        error: 'Missing required field: clientId',
        success: false
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch client to get GHL contact ID
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('ghl_contact_id, primary_first_name, primary_surname')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      console.error('Failed to fetch client:', clientError);
      return new Response(JSON.stringify({
        error: `Client not found: ${clientError?.message}`,
        success: false
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!client.ghl_contact_id) {
      console.log('No GHL contact linked to this client, skipping sync');
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        message: 'No GHL contact linked'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      // HighLevel Marketplace docs specify 2021-07-28 for notes endpoints
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Format the note content with type prefix
    const formattedNote = noteType && noteType !== 'general' 
      ? `[${noteType.toUpperCase()}] ${noteContent}`
      : noteContent;

    if (action === 'create') {
      console.log(`Creating GHL note for contact ${client.ghl_contact_id}`);

      // Per docs: contactId is ONLY a path param; body must contain { body }
      const notePayload = { body: formattedNote };

      const ghlResponse = await fetch(`${GHL_API_BASE}/contacts/${client.ghl_contact_id}/notes`, {
        method: 'POST',
        headers,
        body: JSON.stringify(notePayload),
      });

      if (!ghlResponse.ok) {
        const errorText = await ghlResponse.text();
        console.error('GHL note creation error:', errorText);
        return new Response(JSON.stringify({
          success: false,
          error: `GHL sync failed: ${errorText}`,
          localOnly: true,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const ghlData = await ghlResponse.json();
      console.log('GHL note created:', ghlData);

      if (noteId && ghlData?.note?.id) {
        const { error: noteUpdateError } = await supabase
          .from('client_notes')
          .update({ ghl_note_id: ghlData.note.id })
          .eq('id', noteId);

        if (noteUpdateError) {
          console.error('Failed to store ghl_note_id on local note:', noteUpdateError);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Note created in GHL',
        ghlNoteId: ghlData?.note?.id,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'update') {
      if (!noteId) {
        return new Response(JSON.stringify({
          error: 'Missing required field: noteId (for update)',
          success: false,
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: localNote, error: localNoteError } = await supabase
        .from('client_notes')
        .select('ghl_note_id')
        .eq('id', noteId)
        .single();

      if (localNoteError) {
        console.error('Failed to fetch local note for update:', localNoteError);
      }

      // If we don't have a GHL note ID, fall back to create
      if (!localNote?.ghl_note_id) {
        console.log('No ghl_note_id found for note update; falling back to create');
        const createRes = await fetch(`${GHL_API_BASE}/contacts/${client.ghl_contact_id}/notes`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ body: formattedNote }),
        });

        if (!createRes.ok) {
          const errorText = await createRes.text();
          console.error('GHL note create-on-update error:', errorText);
          return new Response(JSON.stringify({
            success: false,
            error: `GHL sync failed: ${errorText}`,
            localOnly: true,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const created = await createRes.json();
        if (created?.note?.id) {
          await supabase
            .from('client_notes')
            .update({ ghl_note_id: created.note.id })
            .eq('id', noteId);
        }

        return new Response(JSON.stringify({
          success: true,
          message: 'Note updated in GHL (created new note because no ghl_note_id existed)',
          ghlNoteId: created?.note?.id,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`Updating GHL note ${localNote.ghl_note_id} for contact ${client.ghl_contact_id}`);
      const updateRes = await fetch(
        `${GHL_API_BASE}/contacts/${client.ghl_contact_id}/notes/${localNote.ghl_note_id}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ body: formattedNote }),
        }
      );

      if (!updateRes.ok) {
        const errorText = await updateRes.text();
        console.error('GHL note update error:', errorText);
        return new Response(JSON.stringify({
          success: false,
          error: `GHL sync failed: ${errorText}`,
          localOnly: true,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const updated = await updateRes.json();
      console.log('GHL note updated:', updated);

      return new Response(JSON.stringify({
        success: true,
        message: 'Note updated in GHL',
        ghlNoteId: localNote.ghl_note_id,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else if (action === 'delete') {
      if (!noteId) {
        return new Response(JSON.stringify({
          error: 'Missing required field: noteId (for delete)',
          success: false,
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: localNote, error: localNoteError } = await supabase
        .from('client_notes')
        .select('ghl_note_id')
        .eq('id', noteId)
        .single();

      if (localNoteError) {
        console.error('Failed to fetch local note for delete:', localNoteError);
      }

      if (localNote?.ghl_note_id) {
        console.log(`Deleting GHL note ${localNote.ghl_note_id} for contact ${client.ghl_contact_id}`);
        const deleteRes = await fetch(
          `${GHL_API_BASE}/contacts/${client.ghl_contact_id}/notes/${localNote.ghl_note_id}`,
          {
            method: 'DELETE',
            headers,
          }
        );

        if (!deleteRes.ok) {
          const errorText = await deleteRes.text();
          console.error('GHL note deletion error:', errorText);
          return new Response(JSON.stringify({
            success: false,
            error: `GHL sync failed: ${errorText}`,
            localOnly: true,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        console.log('No ghl_note_id found for delete; local-only delete');
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'Note deletion processed'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      error: 'Invalid action. Use: create, update, or delete',
      success: false
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in sync-notes-to-ghl:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'sync-notes-to-ghl'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
