import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { INTEGRATION_SECRET_MAP } from '../_shared/integrationSecrets.ts';
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

// Map of integration IDs to their secret names.
//
// NOTE: `INTEGRATION_SECRET_MAP` (imported above, generated from
// `src/lib/integrations/registry.ts`) is the source of truth for which
// credentials a card declares. This local copy is a second literal of the same
// fact, and the two have drifted: measured 2026-09-16, 37 integrations differ,
// every difference being a name the generated map has and this one lacks. No
// key exists only here, so this copy carries nothing unique.
//
// It is not simply replaced yet because `configured` below is all-or-nothing
// (`configuredSecrets.length === secretNames.length`), so adopting the generated
// map would make every card with an unset OPTIONAL name — RESEND_FROM_EMAIL,
// TWILIO_FROM_NUMBER, the eight GOOGLE_*_DAILY_LIMIT names — start reporting as
// incomplete. Reconciling the two is a change to `configured` first, then a
// deletion of this map.
const integrationSecretMap: Record<string, string[]> = {
  // Expanded library
  'groq': ['GROQ_API_KEY'],
  'mistral': ['MISTRAL_API_KEY'],
  'deepseek': ['DEEPSEEK_API_KEY'],
  'xai': ['XAI_API_KEY'],
  'cohere': ['COHERE_API_KEY'],
  'together': ['TOGETHER_API_KEY'],
  'huggingface': ['HUGGINGFACE_API_TOKEN'],
  'replicate': ['REPLICATE_API_TOKEN'],
  'fal': ['FAL_API_KEY'],
  'stability': ['STABILITY_API_KEY'],
  'elevenlabs': ['ELEVENLABS_API_KEY'],
  'deepgram': ['DEEPGRAM_API_KEY'],
  'assemblyai': ['ASSEMBLYAI_API_KEY'],
  'voyage': ['VOYAGE_API_KEY'],
  'pinecone': ['PINECONE_API_KEY'],
  'proptrack': ['PROPTRACK_API_KEY'],
  'pricefinder': ['PRICEFINDER_API_KEY'],
  'landchecker': ['LANDCHECKER_API_KEY'],
  'nearmap': ['NEARMAP_API_KEY'],
  'geoscape': ['GEOSCAPE_API_KEY'],
  'mapbox': ['MAPBOX_ACCESS_TOKEN'],
  'abs': ['ABS_API_KEY'],
  'rba': ['RBA_FEED_URL'],
  'walkscore': ['WALKSCORE_API_KEY'],
  'cordell': ['CORDELL_API_KEY'],
  'sqm_research': ['SQM_RESEARCH_API_KEY'],
  'hubspot': ['HUBSPOT_ACCESS_TOKEN'],
  'salesforce': ['SALESFORCE_CLIENT_ID', 'SALESFORCE_CLIENT_SECRET'],
  'pipedrive': ['PIPEDRIVE_API_TOKEN'],
  'zoho_crm': ['ZOHO_CRM_CLIENT_ID', 'ZOHO_CRM_CLIENT_SECRET', 'ZOHO_CRM_REFRESH_TOKEN'],
  'activecampaign': ['ACTIVECAMPAIGN_API_URL', 'ACTIVECAMPAIGN_API_KEY'],
  'mailchimp': ['MAILCHIMP_API_KEY'],
  'klaviyo': ['KLAVIYO_API_KEY'],
  'google_ads': ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_REFRESH_TOKEN'],
  'linkedin_ads': ['LINKEDIN_ADS_ACCESS_TOKEN'],
  'tiktok_ads': ['TIKTOK_ADS_ACCESS_TOKEN'],
  'sendgrid': ['SENDGRID_API_KEY'],
  'postmark': ['POSTMARK_SERVER_TOKEN'],
  'mailgun': ['MAILGUN_API_KEY'],
  'brevo': ['BREVO_API_KEY'],
  'messagemedia': ['MESSAGEMEDIA_API_KEY', 'MESSAGEMEDIA_API_SECRET'],
  'clicksend': ['CLICKSEND_USERNAME', 'CLICKSEND_API_KEY'],
  'whatsapp': ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
  'telegram': ['TELEGRAM_BOT_TOKEN'],
  'adobe_pdf': ['ADOBE_PDF_CLIENT_ID', 'ADOBE_PDF_CLIENT_SECRET'],
  'pandadoc': ['PANDADOC_API_KEY'],
  'dropbox_sign': ['DROPBOX_SIGN_API_KEY'],
  'google_document_ai': ['GOOGLE_DOCUMENT_AI_PROJECT_ID', 'GOOGLE_DOCUMENT_AI_PROCESSOR_ID', 'GOOGLE_DOCUMENT_AI_CREDENTIALS'],
  'cloudconvert': ['CLOUDCONVERT_API_KEY'],
  'canva': ['CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET'],
  // Zero-cost KYC stack — docs/aml/kyc-go-live-runbook.md. The IDV provider
  // throws rather than degrading if either is missing, so surfacing them here
  // is what turns "verification is broken" into "the token was never set".
  'npc_aml_verification': ['AML_VERIFICATION_SERVICE_URL', 'AML_VERIFICATION_SERVICE_TOKEN'],
  'frankieone': ['FRANKIEONE_API_KEY'],
  'illion': ['ILLION_API_KEY'],
  'equifax': ['EQUIFAX_CLIENT_ID', 'EQUIFAX_CLIENT_SECRET'],
  'trulioo': ['TRULIOO_API_KEY'],
  'sumsub': ['SUMSUB_APP_TOKEN', 'SUMSUB_SECRET_KEY'],
  'onfido': ['ONFIDO_API_TOKEN'],
  'greenid': ['GREENID_ACCOUNT_ID', 'GREENID_API_PASSWORD'],
  'comply_advantage': ['COMPLY_ADVANTAGE_API_KEY'],
  'basiq': ['BASIQ_API_KEY'],
  'stripe': ['STRIPE_SECRET_KEY'],
  'paddle': ['PADDLE_API_KEY'],
  'xero': ['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET'],
  'myob': ['MYOB_CLIENT_ID', 'MYOB_CLIENT_SECRET'],
  'chargebee': ['CHARGEBEE_API_KEY'],
  'wise': ['WISE_API_TOKEN'],
  'posthog': ['POSTHOG_API_KEY'],
  'google_analytics': ['GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT_JSON'],
  'mixpanel': ['MIXPANEL_PROJECT_TOKEN'],
  'amplitude': ['AMPLITUDE_API_KEY'],
  'sentry': ['SENTRY_DSN'],
  'logrocket': ['LOGROCKET_APP_ID'],
  'datadog': ['DATADOG_API_KEY'],
  'semrush': ['SEMRUSH_API_KEY'],
  'google_search_console': ['GSC_SITE_URL', 'GSC_SERVICE_ACCOUNT_JSON'],
  'slack': ['SLACK_BOT_TOKEN'],
  'microsoft_teams': ['TEAMS_WEBHOOK_URL'],
  'notion': ['NOTION_API_KEY'],
  'linear': ['LINEAR_API_KEY'],
  'jira': ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'],
  'asana': ['ASANA_ACCESS_TOKEN'],
  'monday': ['MONDAY_API_TOKEN'],
  'clickup': ['CLICKUP_API_TOKEN'],
  'calendly': ['CALENDLY_API_TOKEN'],
  'google_calendar': ['GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'GOOGLE_CALENDAR_REFRESH_TOKEN'],
  'zoom': ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'],
  'fireflies': ['FIREFLIES_API_KEY'],
  'aws_s3': ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
  'cloudflare_r2': ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
  'google_drive': ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN'],
  'dropbox': ['DROPBOX_ACCESS_TOKEN'],
  'onedrive': ['ONEDRIVE_DRIVE_ID'],
  'cloudinary': ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
  'linkedin': ['LINKEDIN_ACCESS_TOKEN'],
  'x_twitter': ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN'],
  'youtube': ['YOUTUBE_API_KEY'],
  'instagram': ['INSTAGRAM_ACCESS_TOKEN'],
  'buffer': ['BUFFER_ACCESS_TOKEN'],
  'zapier': ['ZAPIER_WEBHOOK_URL'],
  'n8n': ['N8N_BASE_URL', 'N8N_API_KEY'],
  'apify': ['APIFY_API_TOKEN'],
  'scrapingbee': ['SCRAPINGBEE_API_KEY'],
  'browserless': ['BROWSERLESS_URL', 'BROWSERLESS_TOKEN'],
  'inngest': ['INNGEST_EVENT_KEY'],
  'aws': ['AWS_ACCOUNT_ACCESS_KEY_ID', 'AWS_ACCOUNT_SECRET_ACCESS_KEY'],
  'github': ['GITHUB_TOKEN'],
  'vercel': ['VERCEL_API_TOKEN'],
  'upstash': ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  'doppler': ['DOPPLER_TOKEN'],
  'auth0': ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET'],
  'segment': ['SEGMENT_WRITE_KEY'],
  // AI & models
  'openai': ['OPENAI_API_KEY'],
  'anthropic': ['ANTHROPIC_API_KEY'],
  'gemini': ['GEMINI_API_KEY'],
  'perplexity': ['PERPLEXITY_API_KEY'],
  'openrouter': ['OPENROUTER_API_KEY'],
  // Property & market data
  // The workflow connection. The Listings pipeline's AIRTABLE_TOKEN / AIRTABLE_BASE_ID
  // are managed by Mission Control and are not an integration this page configures.
  'airtable': ['AIRTABLE_API_KEY', 'AIRTABLE_WORKFLOW_BASE_ID'],
  'cotality': ['COTALITY_API_KEY'],
  'domain': ['DOMAIN_API_KEY'],
  'google': ['GOOGLE_MAPS_API_KEY'],
  // CRM & marketing
  'gohighlevel': ['GOHIGHLEVEL_API_KEY', 'GOHIGHLEVEL_LOCATION_ID'],
  'gohighlevel_new': ['GOHIGHLEVEL_API_KEY_NEW', 'GOHIGHLEVEL_LOCATION_ID_NEW'],
  'meta_ads': ['META_ADS_ACCESS_TOKEN', 'META_ADS_AD_ACCOUNT_ID'],
  'manychat': ['MANYCHAT_API_KEY'],
  // Communications
  'resend': ['RESEND_API_KEY'],
  'microsoft': ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID', 'MICROSOFT_MAILBOX_EMAIL'],
  'twilio': ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
  // VAPI_WEBHOOK_SECRET is named here because it is the one credential the call
  // webhook actually verifies. Omitting it meant this endpoint could never place
  // it in `missingSecrets`, so the page that exists to configure it could not
  // report it unset — while call logging was dead from 2026-07-22 for want of it.
  'vapi': ['VAPI_API_KEY', 'VAPI_WEBHOOK_SECRET'],
  'webpush': ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
  // Documents & rendering
  'docusign': ['DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_USER_ID', 'DOCUSIGN_ACCOUNT_ID', 'DOCUSIGN_RSA_PRIVATE_KEY'],
  'gamma': ['GAMMA_API_KEY'],
  'api2pdf': ['API2PDF_API_KEY'],
  'weasyprint': ['WEASYPRINT_SERVICE_URL', 'WEASYPRINT_SERVICE_TOKEN'],
  'pdf_parse': ['PDF_PARSE_SERVICE_URL', 'PDF_PARSE_SERVICE_TOKEN'],
  'render_source': ['RENDER_SOURCE_URL', 'RENDER_SOURCE_TOKEN'],
  // Automation & workflows
  'make': ['MAKE_WEBHOOK_URL'],
  'firecrawl': ['FIRECRAWL_API_KEY'],
  'mission_control': ['MISSION_CONTROL_URL', 'MISSION_CONTROL_CLONE_API_KEY'],
  // Infrastructure & security
  'cloudflare': ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_ACCOUNT_ID'],
  'supabase': ['SUPABASE_ACCESS_TOKEN'],
  'turnstile': ['TURNSTILE_SECRET_KEY'],
  'figma': ['FIGMA_API_TOKEN'],
};


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
    // SECURITY: Verify authentication and admin role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body: { integrationId?: string } = await req.json().catch(() => ({}));
    
    const authResult = await verifyAuth(supabase, req.headers, body);
    if (authResult.error) {
      console.log('[check-integration-secrets] Auth failed:', authResult.error);
      return createUnauthorizedResponse(authResult.error, corsHeaders);
    }
    
    // Check if user has superadmin role
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', authResult.userId)
      .eq('role', 'superadmin')
      .single();

    if (roleError || !roleData) {
      console.warn(`User ${authResult.userId} attempted to check integration secrets without superadmin role.`);
      return createForbiddenResponse('Forbidden: Superadmin access required', corsHeaders);
    }
    console.log(`Superadmin ${authResult.userId} is checking integration secrets.`);

    // If specific integration requested, return just that one with extra info
    if (body.integrationId) {
      const integrationId = body.integrationId;
      // Own-property check only: a bare index would resolve inherited keys such as
      // 'constructor' or 'toString' to a non-array and fall through to the loop below.
      const secretNames = Object.hasOwn(integrationSecretMap, integrationId)
        ? integrationSecretMap[integrationId]
        : undefined;

      if (!secretNames) {
        return new Response(
          JSON.stringify({ success: false, error: 'Unknown integration' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const configuredSecrets: string[] = [];
      const missingSecrets: string[] = [];

      for (const secretName of secretNames) {
        const value = Deno.env.get(secretName);
        if (value && value.trim() !== '') {
          configuredSecrets.push(secretName);
        } else {
          missingSecrets.push(secretName);
        }
      }

      const response: Record<string, unknown> = {
        success: true,
        configured: configuredSecrets.length === secretNames.length,
        configuredSecrets,
        missingSecrets,
      };

      // For GHL, also return the location ID (non-sensitive, needed for building URLs)
      if (integrationId === 'gohighlevel') {
        response.locationId = Deno.env.get('GOHIGHLEVEL_LOCATION_ID') || null;
      }

      return new Response(
        JSON.stringify(response),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Default: return all integrations status
    const results: Record<string, { configured: boolean; configuredSecrets: string[]; missingSecrets: string[] }> = {};

    for (const [integrationId, secretNames] of Object.entries(integrationSecretMap)) {
      const configuredSecrets: string[] = [];
      const missingSecrets: string[] = [];

      for (const secretName of secretNames) {
        const value = Deno.env.get(secretName);
        if (value && value.trim() !== '') {
          configuredSecrets.push(secretName);
        } else {
          missingSecrets.push(secretName);
        }
      }

      results[integrationId] = {
        configured: configuredSecrets.length === secretNames.length,
        configuredSecrets,
        missingSecrets,
      };
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        integrations: results,
        message: 'These are display-only statuses from Supabase secrets'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error checking integration secrets:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'check-integration-secrets'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
