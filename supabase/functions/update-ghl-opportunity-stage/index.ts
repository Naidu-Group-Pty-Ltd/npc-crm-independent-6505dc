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

// Helper: search for an opportunity by contact ID and return the first match
async function findOpportunityByContact(
  contactId: string,
  locationId: string,
  headers: Record<string, string>
): Promise<{ id: string; pipelineId: string; pipelineStageId: string } | null> {
  try {
    const searchUrl = `${GHL_API_BASE}/opportunities/search`;
    const searchBody = {
      locationId,
      contactId,
      limit: 10,
    };

    const res = await fetch(searchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(searchBody),
    });

    if (!res.ok) {
      console.error('Opportunity search failed:', await res.text());
      return null;
    }

    const data = await res.json();
    const opportunities = data.opportunities || [];

    if (opportunities.length === 0) {
      return null;
    }

    // Return the first opportunity (could enhance to pick best one)
    const opp = opportunities[0];
    return {
      id: opp.id,
      pipelineId: opp.pipelineId,
      pipelineStageId: opp.pipelineStageId,
    };
  } catch (err) {
    console.error('Error searching for opportunity:', err);
    return null;
  }
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
      return new Response(JSON.stringify({ error: 'Supabase credentials not configured', success: false }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);
    const _ghlCreds = await getEffectiveGhlCredentials(supabase);
    const apiKey = _ghlCreds.apiKey;
    const locationId = _ghlCreds.locationId;
    console.log(`[update-ghl-opportunity-stage] Using GHL account: ${_ghlCreds.label}`);

    if (!apiKey || !locationId) {
      console.error('GHL credentials not configured');
      return new Response(JSON.stringify({ 
        error: 'GoHighLevel credentials not configured',
        success: false 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { clientId, newStageId } = body;
    
    // SECURITY: Verify authentication
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[update-ghl-opportunity-stage] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[update-ghl-opportunity-stage] Authenticated user: ${userId}`);

    if (!clientId || !newStageId) {
      return new Response(JSON.stringify({
        error: 'Missing required fields: clientId and newStageId',
        success: false
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Updating opportunity stage for client ${clientId} to stage ${newStageId}`);

    // Fetch client to get GHL opportunity ID
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('ghl_opportunity_id, ghl_contact_id')
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
      console.log('No GHL contact linked to this client');
      return new Response(JSON.stringify({
        error: 'No GHL contact linked to this client',
        success: false
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch the new stage to get its GHL ID
    const { data: stage, error: stageError } = await supabase
      .from('ghl_pipeline_stages')
      .select('ghl_id, name, pipeline_id')
      .eq('id', newStageId)
      .single();

    if (stageError || !stage) {
      console.error('Failed to fetch stage:', stageError);
      return new Response(JSON.stringify({
        error: `Stage not found: ${stageError?.message}`,
        success: false
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch the pipeline to get its GHL ID
    const { data: pipeline, error: pipelineError } = await supabase
      .from('ghl_pipelines')
      .select('ghl_id, name')
      .eq('id', stage.pipeline_id)
      .single();

    if (pipelineError || !pipeline) {
      console.error('Failed to fetch pipeline:', pipelineError);
      return new Response(JSON.stringify({
        error: `Pipeline not found: ${pipelineError?.message}`,
        success: false
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Determine which opportunity ID to use
    let opportunityId = client.ghl_opportunity_id;
    let opportunityWasRepaired = false;

    // If no opportunity ID stored, attempt to find one
    if (!opportunityId) {
      console.log('No ghl_opportunity_id stored; searching for opportunity by contact...');
      const found = await findOpportunityByContact(client.ghl_contact_id, locationId, headers);
      if (found) {
        opportunityId = found.id;
        opportunityWasRepaired = true;
        console.log(`Found opportunity ${opportunityId} for contact ${client.ghl_contact_id}`);
      } else {
        console.log('No opportunity found for contact');
        return new Response(JSON.stringify({
          error: 'No GHL opportunity linked to this client',
          success: false
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Update the opportunity in GHL
    const updatePayload = {
      pipelineId: pipeline.ghl_id,
      pipelineStageId: stage.ghl_id,
    };

    console.log(`Updating GHL opportunity ${opportunityId} with:`, updatePayload);

    let ghlResponse = await fetch(
      `${GHL_API_BASE}/opportunities/${opportunityId}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify(updatePayload),
      }
    );

    // If opportunity not found (400/404), try to repair by searching for a valid one
    if (!ghlResponse.ok) {
      const errorText = await ghlResponse.text();
      const isNotFound = errorText.includes("doesn't exist") || errorText.includes('not found') || ghlResponse.status === 404;

      if (isNotFound && !opportunityWasRepaired) {
        console.log('Opportunity not found in GHL; attempting repair by searching for contact...');
        const found = await findOpportunityByContact(client.ghl_contact_id, locationId, headers);

        if (found) {
          opportunityId = found.id;
          opportunityWasRepaired = true;
          console.log(`Repaired: found opportunity ${opportunityId} for contact ${client.ghl_contact_id}`);

          // Retry the update
          ghlResponse = await fetch(
            `${GHL_API_BASE}/opportunities/${opportunityId}`,
            {
              method: 'PUT',
              headers,
              body: JSON.stringify(updatePayload),
            }
          );

          if (!ghlResponse.ok) {
            const retryError = await ghlResponse.text();
            console.error('GHL update error after repair:', retryError);
            return new Response(JSON.stringify({
              error: `GHL update failed after repair: ${retryError}`,
              success: false
            }), {
              status: ghlResponse.status,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } else {
          console.log('No opportunity found for contact during repair');
          return new Response(JSON.stringify({
            error: 'No GHL opportunity found for this contact',
            success: false
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        console.error('GHL update error:', errorText);
        return new Response(JSON.stringify({
          error: `GHL update failed: ${errorText}`,
          success: false
        }), {
          status: ghlResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const ghlData = await ghlResponse.json();
    console.log('GHL update response:', ghlData);

    // Update local client record (including repaired opportunity ID if applicable)
    const updateFields: Record<string, any> = {
      current_stage_id: newStageId,
      current_pipeline_id: stage.pipeline_id,
      pipeline_status: stage.name,
      pipeline_updated_at: new Date().toISOString(),
      ghl_last_synced_at: new Date().toISOString(),
      ghl_sync_status: 'synced',
    };

    // If we repaired/found the opportunity, persist the new ID
    if (opportunityWasRepaired && opportunityId) {
      updateFields.ghl_opportunity_id = opportunityId;
    }

    const { error: updateError } = await supabase
      .from('clients')
      .update(updateFields)
      .eq('id', clientId);

    if (updateError) {
      console.error('Failed to update local client:', updateError);
    }

    // Also move the cached opportunity row: the tracker's kanban places cards
    // from ghl_client_opportunities.stage_id, and sync-ghl-pipelines only
    // rewrites it every 5 minutes — without this the board shows the old
    // column until the next sweep. After a repair the stored row still
    // carries the stale opportunity id, so match by client alone there.
    let oppUpdate = supabase
      .from('ghl_client_opportunities')
      .update({
        stage_id: newStageId,
        stage_name: stage.name,
        pipeline_id: stage.pipeline_id,
        pipeline_name: pipeline.name,
        synced_at: new Date().toISOString(),
      })
      .eq('client_id', clientId);
    if (!opportunityWasRepaired) {
      oppUpdate = oppUpdate.eq('ghl_opportunity_id', opportunityId);
    }
    const { error: oppUpdateError } = await oppUpdate;

    if (oppUpdateError) {
      console.error('Failed to update cached opportunity row:', oppUpdateError);
    }

    console.log(`Successfully moved opportunity to stage: ${stage.name}${opportunityWasRepaired ? ' (opportunity ID was repaired)' : ''}`);

    return new Response(JSON.stringify({
      success: true,
      message: `Moved to ${stage.name}`,
      ghlOpportunityId: opportunityId,
      newStage: stage.name,
      newPipeline: pipeline.name,
      repaired: opportunityWasRepaired,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in update-ghl-opportunity-stage:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'update-ghl-opportunity-stage'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
