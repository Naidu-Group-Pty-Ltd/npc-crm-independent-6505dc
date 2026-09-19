import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getEffectiveGhlCredentials } from '../_shared/ghl-account.ts';
import { internalError } from '../_shared/errorResponse.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

interface ClientData {
  id: string;
  primary_first_name: string;
  primary_surname: string;
  primary_email: string | null;
  primary_mobile: string | null;
  secondary_first_name: string | null;
  secondary_surname: string | null;
  current_address: string | null;
  total_portfolio_value: number;
  total_debt: number;
  net_monthly_cash_flow: number;
  ghl_contact_id: string | null;
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase credentials not configured');
      return new Response(JSON.stringify({ error: 'Supabase credentials not configured', success: false }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabaseTmp = createClient(supabaseUrl, supabaseKey);
    // Resolve effective GHL credentials (auto-flips to NEW after legacy decommission)
    const creds = await getEffectiveGhlCredentials(supabaseTmp);
    const apiKey = creds.apiKey;
    const locationId = creds.locationId;
    if (!apiKey || !locationId) {
      console.error(`GHL credentials not configured for ${creds.label} account`);
      return new Response(JSON.stringify({
        error: `GoHighLevel credentials not configured for ${creds.label} account`,
        success: false
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = supabaseTmp;

    const body = await req.json();
    const { action, clientId, clientIds, pipelineStageGhlId, pipelineGhlId } = body;
    
    // SECURITY: Verify authentication
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[sync-client-to-ghl] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log('[sync-client-to-ghl] Authenticated user:', userId);

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-04-15',
      'Content-Type': 'application/json',
    };

    // Handle batch sync
    if (action === 'batch' && clientIds && Array.isArray(clientIds)) {
      console.log(`Batch syncing ${clientIds.length} clients to GHL`);
      
      const results = [];
      for (const id of clientIds) {
        const result = await syncSingleClient(supabase, id, headers, locationId);
        results.push(result);
      }

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return new Response(JSON.stringify({
        success: true,
        message: `Synced ${successful} clients, ${failed} failed`,
        results
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle single client sync
    if (!clientId) {
      return new Response(JSON.stringify({
        error: 'Missing required field: clientId',
        success: false
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const result = await syncSingleClient(supabase, clientId, headers, locationId, pipelineStageGhlId, pipelineGhlId);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in sync-client-to-ghl:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'sync-client-to-ghl'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function syncSingleClient(
  supabase: any, 
  clientId: string, 
  headers: Record<string, string>,
  locationId: string,
  pipelineStageGhlId?: string,
  pipelineGhlId?: string
) {
  console.log(`Syncing client ${clientId} to GHL`);

  // Fetch client data from Supabase
  const { data: client, error: fetchError } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();

  if (fetchError || !client) {
    console.error('Failed to fetch client:', fetchError);
    return {
      success: false,
      clientId,
      error: `Failed to fetch client: ${fetchError?.message || 'Not found'}`
    };
  }

  // Format currency for GHL custom fields
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value || 0);
  };

  // Prepare contact payload for GHL
  const contactPayload = {
    firstName: client.primary_first_name,
    lastName: client.primary_surname,
    email: client.primary_email || undefined,
    phone: client.primary_mobile || undefined,
    address1: client.current_address || undefined,
    country: client.country || 'Australia',
    locationId,
    customFields: [
      { key: 'portfolio_value', field_value: formatCurrency(client.total_portfolio_value) },
      { key: 'total_debt', field_value: formatCurrency(client.total_debt) },
      { key: 'monthly_cash_flow', field_value: formatCurrency(client.net_monthly_cash_flow) },
      { key: 'client_source', field_value: 'Advisory Portal Import' },
    ],
    tags: ['Advisory Client', 'Portal Import'],
  };

  let ghlContactId = client.ghl_contact_id;
  let isNewContact = false;

  try {
    if (ghlContactId) {
      // Update existing contact
      console.log(`Updating existing GHL contact: ${ghlContactId}`);
      
      const updateResponse = await fetch(`${GHL_API_BASE}/contacts/${ghlContactId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(contactPayload),
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('GHL update error:', errorText);
        
        // If contact not found, create new one (GHL returns 404 or 400 with "Contact not found")
        const notFound =
          updateResponse.status === 404 ||
          /contact not found/i.test(errorText);
        if (notFound) {
          console.log(`Stale GHL contact id ${ghlContactId}; will create a new contact.`);
          ghlContactId = null;
        } else {
          throw new Error(`GHL update failed: ${errorText}`);
        }
      }
    }

    if (!ghlContactId) {
      // Create new contact
      console.log('Creating new GHL contact');
      isNewContact = true;
      
      const createResponse = await fetch(`${GHL_API_BASE}/contacts/`, {
        method: 'POST',
        headers,
        body: JSON.stringify(contactPayload),
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('GHL create error:', errorText);
        throw new Error(`GHL create failed: ${errorText}`);
      }

      const createData = await createResponse.json();
      ghlContactId = createData.contact?.id;
      
      if (!ghlContactId) {
        throw new Error('GHL did not return a contact ID');
      }
    }

    // Update client record with GHL contact ID and sync status
    const { error: updateError } = await supabase
      .from('clients')
      .update({
        ghl_contact_id: ghlContactId,
        ghl_sync_status: 'synced',
        ghl_last_synced_at: new Date().toISOString()
      })
      .eq('id', clientId);

    if (updateError) {
      console.error('Failed to update client sync status:', updateError);
    }

    // Create opportunity in pipeline if stage was specified
    let opportunityCreated = false;
    if (pipelineStageGhlId && pipelineGhlId && ghlContactId) {
      try {
        console.log(`Creating GHL opportunity for contact ${ghlContactId} in pipeline ${pipelineGhlId}, stage ${pipelineStageGhlId}`);
        const oppPayload = {
          pipelineId: pipelineGhlId,
          pipelineStageId: pipelineStageGhlId,
          contactId: ghlContactId,
          locationId,
          name: `${client.primary_first_name} ${client.primary_surname}`.trim(),
          status: 'open',
        };
        
        const oppResponse = await fetch(`${GHL_API_BASE}/opportunities/`, {
          method: 'POST',
          headers,
          body: JSON.stringify(oppPayload),
        });

        if (oppResponse.ok) {
          const oppData = await oppResponse.json();
          console.log(`GHL opportunity created: ${oppData.opportunity?.id}`);
          opportunityCreated = true;
        } else {
          const errText = await oppResponse.text();
          console.error('GHL opportunity creation error:', errText);
        }
      } catch (oppErr) {
        console.error('Failed to create GHL opportunity:', oppErr);
      }
    }

    console.log(`Successfully synced client ${clientId} to GHL contact ${ghlContactId}`);

    return {
      success: true,
      clientId,
      ghlContactId,
      isNewContact,
      opportunityCreated,
    };

  } catch (error) {
    console.error(`Failed to sync client ${clientId}:`, error);

    // Update sync status to error
    await supabase
      .from('clients')
      .update({
        ghl_sync_status: 'error'
      })
      .eq('id', clientId);

    return {
      success: false,
      clientId,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
