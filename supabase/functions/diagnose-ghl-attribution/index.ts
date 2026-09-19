import { internalError } from '../_shared/errorResponse.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';

const __corsWrappedHandler = async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
    'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('GOHIGHLEVEL_API_KEY');
    const body = await req.json().catch(() => ({}));
    const { contactId } = body;

    if (!contactId) {
      return new Response(JSON.stringify({ error: 'contactId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const response = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-04-15',
        'Content-Type': 'application/json',
      },
    });

    const rawData = await response.json();
    const contact = rawData.contact || rawData;

    const diagnosis = {
      contactId,
      contactName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
      source: contact.source,
      attributionSource: contact.attributionSource || null,
      lastAttributionSource: contact.lastAttributionSource || null,
      customFieldsWithValues: (contact.customFields || [])
        .filter((f: any) => f.value)
        .map((f: any) => ({ key: f.key || f.fieldKey, id: f.id, value: f.value })),
      allTopLevelKeys: Object.keys(contact),
      attributionRelatedFields: {} as Record<string, any>,
    };

    // Extract any field that might contain attribution data
    for (const key of Object.keys(contact)) {
      const k = key.toLowerCase();
      if (k.includes('utm') || k.includes('campaign') || k.includes('attribution') ||
          k.includes('source') || k.includes('medium') || k.includes('fbclid') ||
          k.includes('gclid') || k.includes('ad') || k.includes('referrer')) {
        diagnosis.attributionRelatedFields[key] = contact[key];
      }
    }

    console.log('[diagnose] Result:', JSON.stringify(diagnosis, null, 2));

    return new Response(JSON.stringify({ success: true, diagnosis }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[diagnose] Error:', error);
    return new Response(JSON.stringify(internalError(error, 'diagnose-ghl-attribution')), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. This function is browser-reachable and its callers
// send `credentials: 'include'`, and the Fetch spec makes the browser reject a
// credentialed response carrying `Access-Control-Allow-Origin: *` — opaquely,
// as "Failed to fetch". See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));

