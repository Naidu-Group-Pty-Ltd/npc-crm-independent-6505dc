import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { requireSuperadmin } from '../_shared/authz.ts';
import { logSecurityEvent } from '../_shared/auth_v2.ts';
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const MICROSOFT_CLIENT_ID = Deno.env.get('MICROSOFT_CLIENT_ID');
const MICROSOFT_CLIENT_SECRET = Deno.env.get('MICROSOFT_CLIENT_SECRET');
const MICROSOFT_TENANT_ID = Deno.env.get('MICROSOFT_TENANT_ID');
const MICROSOFT_MAILBOX_EMAIL = Deno.env.get('MICROSOFT_MAILBOX_EMAIL');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');

// Get access token from Microsoft
async function getAccessToken(): Promise<string> {
  const tokenUrl = `https://login.microsoftonline.com/${MICROSOFT_TENANT_ID}/oauth2/v2.0/token`;
  
  const params = new URLSearchParams({
    client_id: MICROSOFT_CLIENT_ID!,
    client_secret: MICROSOFT_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
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
    // SECURITY: Verify authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json();
    const { action } = body;
    
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[outlook-manage-subscription] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[outlook-manage-subscription] Authenticated user: ${userId}`);

    // AUTHZ: creating/listing/renewing/deleting Microsoft Graph subscriptions is
    // an admin/internal operation — it wires the org mailbox to a webhook. Any
    // authenticated user must NOT be able to do this. Require superadmin
    // (deny-by-default; verified service calls bypass).
    const authz = await requireSuperadmin(supabase, { userId, authMethod });
    if (!authz.ok) {
      await logSecurityEvent(supabase, {
        action: `outlook_subscription.${action}`, decision: 'deny',
        reason_code: authz.reason_code, actor_type: 'human', actor_id: userId,
      });
      return createForbiddenResponse(authz.error || 'Access denied', corsHeaders);
    }

    if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET || !MICROSOFT_TENANT_ID || !MICROSOFT_MAILBOX_EMAIL) {
      return new Response(JSON.stringify({ error: 'Missing Microsoft credentials' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const accessToken = await getAccessToken();
    const webhookUrl = `${SUPABASE_URL}/functions/v1/outlook-email-webhook`;

    if (action === 'create') {
      // WP-13: require a high-entropy OUTLOOK_WEBHOOK_CLIENT_STATE. Legacy
      // constant fallback is removed — refuse to create a subscription with a
      // weak/predictable clientState.
      const clientStateSecret = (Deno.env.get('OUTLOOK_WEBHOOK_CLIENT_STATE') || '').trim();
      if (clientStateSecret.length < 16) {
        return new Response(JSON.stringify({
          error: 'OUTLOOK_WEBHOOK_CLIENT_STATE is not configured (min 16 chars). Ask an administrator to set it before creating a subscription.',
        }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      // Create a new subscription for mail notifications
      const subscription = {
        changeType: 'created',
        notificationUrl: webhookUrl,
        resource: `/users/${MICROSOFT_MAILBOX_EMAIL}/messages`,
        expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days max
        clientState: clientStateSecret,
      };

      // clientState authenticates calls to the public receiver. Never expose it
      // through function logs; operational metadata is sufficient here.
      console.log('Creating subscription:', {
        changeType: subscription.changeType,
        notificationUrl: subscription.notificationUrl,
        resource: subscription.resource,
        expirationDateTime: subscription.expirationDateTime,
      });

      const response = await meteredFetch('https://graph.microsoft.com/v1.0/subscriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(subscription)
      });

      const result = await response.json();
      // Graph may echo clientState in success or error responses. Strip it
      // before the response crosses any logging or API boundary.
      const safeResult = { ...(result ?? {}) };
      delete safeResult.clientState;
      
      if (!response.ok) {
        console.error('Subscription creation failed:', safeResult);
        return new Response(JSON.stringify({ 
          error: 'Failed to create subscription', 
          details: safeResult
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      console.log('Subscription created:', safeResult);
      return new Response(JSON.stringify({ 
        success: true, 
        subscription: safeResult,
        message: 'Webhook subscription created successfully. Expires in 3 days.'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else if (action === 'list') {
      // List all subscriptions
      const response = await meteredFetch('https://graph.microsoft.com/v1.0/subscriptions', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();
      return new Response(JSON.stringify({ subscriptions: result.value || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else if (action === 'renew') {
      // List and renew all subscriptions
      const listResponse = await meteredFetch('https://graph.microsoft.com/v1.0/subscriptions', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const listResult = await listResponse.json();
      const subscriptions = listResult.value || [];
      const renewed = [];

      for (const sub of subscriptions) {
        const renewResponse = await meteredFetch(`https://graph.microsoft.com/v1.0/subscriptions/${sub.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            expirationDateTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
          })
        });

        if (renewResponse.ok) {
          renewed.push(sub.id);
        }
      }

      return new Response(JSON.stringify({ 
        success: true, 
        renewed,
        message: `Renewed ${renewed.length} subscription(s)`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else if (action === 'delete') {
      // Delete all subscriptions
      const listResponse = await meteredFetch('https://graph.microsoft.com/v1.0/subscriptions', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const listResult = await listResponse.json();
      const subscriptions = listResult.value || [];
      const deleted = [];

      for (const sub of subscriptions) {
        const deleteResponse = await meteredFetch(`https://graph.microsoft.com/v1.0/subscriptions/${sub.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });

        if (deleteResponse.ok || deleteResponse.status === 204) {
          deleted.push(sub.id);
        }
      }

      return new Response(JSON.stringify({ 
        success: true, 
        deleted,
        message: `Deleted ${deleted.length} subscription(s)`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else {
      return new Response(JSON.stringify({ 
        error: 'Invalid action. Use: create, list, renew, or delete' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify(internalError(error, 'outlook-manage-subscription')), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
