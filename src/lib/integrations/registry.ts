/**
 * Central registry of every external service this platform talks to.
 *
 * Every entry maps to real credentials consumed by edge functions
 * (`Deno.env.get(...)`) or by the browser. Grouping is by capability so the
 * Integrations page can render categorised, searchable sections.
 *
 * Field `key` values MUST stay stable — they are the primary key in
 * `integration_configs.key_name`. For legacy entries (airtable, gohighlevel)
 * the stored key differs from the Supabase secret name; that translation lives
 * in `SUPABASE_SECRET_ALIASES` below.
 */

export type IntegrationCategoryId =
  | 'ai'
  | 'property_data'
  | 'crm_marketing'
  | 'communications'
  | 'documents'
  | 'automation'
  | 'payments'
  | 'compliance'
  | 'analytics'
  | 'productivity'
  | 'storage'
  | 'media'
  | 'infrastructure';

export interface IntegrationCategory {
  id: IntegrationCategoryId;
  label: string;
  description: string;
}

export interface IntegrationField {
  key: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password';
  required?: boolean;
}

export interface IntegrationDefinition {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategoryId;
  /** Free-text keywords used by the search box (name/description already indexed). */
  tags: string[];
  fields: IntegrationField[];
  docsUrl?: string;
  /** Rendered when neither Simple Icons nor thesvg.org has a mark. */
  fallbackIcon:
    | 'brain'
    | 'database'
    | 'phone'
    | 'mail'
    | 'webhook'
    | 'shield'
    | 'cloud'
    | 'map'
    | 'file'
    | 'sparkles'
    | 'megaphone'
    | 'settings'
    | 'bell'
    | 'creditCard'
    | 'barChart'
    | 'users'
    | 'lock'
    | 'image'
    | 'calendar'
    | 'package'
    | 'code'
    | 'video'
    | 'coins'
    | 'building'
    | 'mic'
    | 'globe'
    | 'message'
    | 'cart';
}

export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  { id: 'ai', label: 'AI & Models', description: 'LLM providers, speech, vision and inference gateways powering agents, reports and analysis.' },
  { id: 'property_data', label: 'Property & Market Data', description: 'Listing feeds, valuations, geocoding, imagery and location intelligence.' },
  { id: 'crm_marketing', label: 'CRM & Marketing', description: 'Pipelines, lead capture, ad platforms and conversational marketing.' },
  { id: 'communications', label: 'Communications', description: 'Email, SMS, voice, chat and push notification delivery.' },
  { id: 'documents', label: 'Documents & Rendering', description: 'PDF pipelines, e-signature, decks and document extraction services.' },
  { id: 'compliance', label: 'Identity & Compliance', description: 'KYC/AML verification, PEP & sanctions screening, credit and banking data.' },
  { id: 'payments', label: 'Payments & Finance', description: 'Billing, subscriptions, accounting ledgers and revenue reconciliation.' },
  { id: 'analytics', label: 'Analytics & Monitoring', description: 'Product analytics, SEO intelligence, error tracking and observability.' },
  { id: 'productivity', label: 'Productivity & Collaboration', description: 'Team chat, docs, project tracking, scheduling and meetings.' },
  { id: 'storage', label: 'Storage & Files', description: 'Object storage, cloud drives and media asset pipelines.' },
  { id: 'media', label: 'Media & Social', description: 'Social publishing, video platforms and audience distribution.' },
  { id: 'automation', label: 'Automation & Workflows', description: 'Webhooks, scraping, orchestration and platform control planes.' },
  { id: 'infrastructure', label: 'Infrastructure & Security', description: 'Edge network, secret management, bot protection and developer tooling.' },
];

export const INTEGRATIONS: IntegrationDefinition[] = [
  // ── AI & Models ─────────────────────────────────────────────────────────
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'AI-powered analysis, chart generation, and report Q&A.',
    category: 'ai',
    tags: ['gpt', 'llm', 'embeddings', 'vision'],
    docsUrl: 'https://platform.openai.com/docs',
    fallbackIcon: 'brain',
    fields: [{ key: 'OPENAI_API_KEY', label: 'API Key', placeholder: 'sk-...', type: 'password', required: true }],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Native Claude models (Sonnet, Opus, Haiku) for reasoning-heavy agents. Unlocks Claude in the Model Hub.',
    category: 'ai',
    tags: ['claude', 'llm', 'reasoning'],
    docsUrl: 'https://docs.anthropic.com/en/api/getting-started',
    fallbackIcon: 'brain',
    fields: [{ key: 'ANTHROPIC_API_KEY', label: 'API Key', placeholder: 'sk-ant-...', type: 'password', required: true }],
  },
  {
    id: 'gemini',
    name: 'Google Gemini (Native)',
    description: 'Direct Gemini API access for native calls outside the Lovable Gateway.',
    category: 'ai',
    tags: ['google', 'llm', 'multimodal'],
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    fallbackIcon: 'brain',
    fields: [{ key: 'GEMINI_API_KEY', label: 'API Key', placeholder: 'AIza...', type: 'password', required: true }],
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'AI search for report regeneration, market research and citation-backed answers.',
    category: 'ai',
    tags: ['search', 'research', 'sonar'],
    docsUrl: 'https://docs.perplexity.ai',
    fallbackIcon: 'brain',
    fields: [{ key: 'PERPLEXITY_API_KEY', label: 'API Key', placeholder: 'pplx-...', type: 'password', required: true }],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified gateway to 300+ models (Claude, GPT, Llama, Mistral, DeepSeek, Qwen). Unlocks the OpenRouter section in the Model Hub.',
    category: 'ai',
    tags: ['gateway', 'llm', 'router', 'llama', 'mistral'],
    docsUrl: 'https://openrouter.ai/docs',
    fallbackIcon: 'brain',
    fields: [{ key: 'OPENROUTER_API_KEY', label: 'API Key', placeholder: 'sk-or-v1-...', type: 'password', required: true }],
  },

  // ── Property & Market Data ─────────────────────────────────────────────
  {
    id: 'airtable',
    name: 'Airtable',
    description:
      'Airtable connection for workflow automations (the Workflow Playground\u2019s Airtable operations). ' +
      'The Listings & Overview pipeline reads a different key, AIRTABLE_TOKEN, which is managed by Mission Control ' +
      'and is the same across the prime and every clone \u2014 nothing entered here can change it.',
    category: 'property_data',
    tags: ['workflows', 'database', 'automation'],
    docsUrl: 'https://airtable.com/developers/web/api/introduction',
    fallbackIcon: 'database',
    fields: [
      { key: 'AIRTABLE_API_KEY', label: 'API key (workflows)', placeholder: 'pat...', type: 'password', required: true },
      { key: 'AIRTABLE_WORKFLOW_BASE_ID', label: 'Base ID (workflows)', placeholder: 'app...', type: 'text', required: true },
    ],
  },
  {
    id: 'cotality',
    name: 'Cotality (CoreLogic)',
    description: 'Licensed property data spine — valuations, comparable sales, rental evidence and suburb analytics.',
    category: 'property_data',
    tags: ['corelogic', 'rp data', 'valuation', 'comparables', 'avm'],
    docsUrl: 'https://www.cotality.com/en-au',
    fallbackIcon: 'database',
    fields: [
      { key: 'COTALITY_API_KEY', label: 'API Key', placeholder: 'Enter Cotality API key', type: 'password', required: true },
      { key: 'COTALITY_BASE_URL', label: 'Base URL', placeholder: 'https://api.cotality.com', type: 'text', required: false },
    ],
  },
  {
    id: 'domain',
    name: 'Domain',
    description: 'Australian residential listing and sales history feed for market comparisons.',
    category: 'property_data',
    tags: ['listings', 'australia', 'sales history', 'real estate'],
    docsUrl: 'https://developer.domain.com.au/docs/latest',
    fallbackIcon: 'database',
    fields: [{ key: 'DOMAIN_API_KEY', label: 'API Key', placeholder: 'Enter Domain API key', type: 'password', required: true }],
  },
  {
    id: 'google',
    name: 'Google Maps Platform',
    description: 'Geocoding, Places, Distance Matrix, Street View and Static Maps — for the map view, address capture and report location evidence.',
    category: 'property_data',
    tags: ['maps', 'geocoding', 'places', 'street view', 'autocomplete'],
    docsUrl: 'https://developers.google.com/maps/documentation',
    fallbackIcon: 'map',
    fields: [
      { key: 'GOOGLE_MAPS_API_KEY', label: 'Maps API Key', placeholder: 'AIza...', type: 'password', required: true },
      // One ceiling per Google BILLING SKU, because that is what Google
      // charges for separately — a Nearby Search and an Autocomplete are
      // different prices, and one shared number could not express either.
      // Every ceiling the runtime reads is declared here: a spending limit
      // that exists only in code is configuration an operator cannot see.
      // Defaults live in `_shared/googleMapsDailyCaps.ts` and are set to keep
      // ordinary pay-as-you-go usage under Google's free monthly thresholds;
      // the placeholders below show them.
      { key: 'GOOGLE_GEOCODING_DAILY_LIMIT', label: 'Geocoding Daily Cap', placeholder: '250', type: 'text', required: false },
      { key: 'GOOGLE_PLACES_NEARBY_DAILY_LIMIT', label: 'Places Nearby Daily Cap', placeholder: '150', type: 'text', required: false },
      { key: 'GOOGLE_PLACES_AUTOCOMPLETE_DAILY_LIMIT', label: 'Places Autocomplete Daily Cap', placeholder: '250', type: 'text', required: false },
      { key: 'GOOGLE_DISTANCE_MATRIX_DAILY_LIMIT', label: 'Distance Matrix Daily Cap', placeholder: '250', type: 'text', required: false },
      { key: 'GOOGLE_STREET_VIEW_DAILY_LIMIT', label: 'Street View Daily Cap', placeholder: '250', type: 'text', required: false },
      { key: 'GOOGLE_STATIC_MAPS_DAILY_LIMIT', label: 'Static Maps Daily Cap', placeholder: '250', type: 'text', required: false },
      // Superseded by the two SKU-specific Places caps above and still read as
      // a fallback for Autocomplete, so a value an operator already set is not
      // silently discarded.
      { key: 'GOOGLE_PLACES_DAILY_LIMIT', label: 'Places Daily Cap (legacy)', placeholder: '250', type: 'text', required: false },
    ],
  },
  {
    id: 'mapillary',
    name: 'Mapillary',
    description:
      'Free, crowd-photographed street-level imagery (CC BY-SA 4.0) — serves the listing Street View panel ahead of ' +
      'Google when a client token is set. A token is minted free at mapillary.com/developer; without one the panel ' +
      'uses Google Street View exactly as before.',
    category: 'property_data',
    tags: ['street view', 'imagery', 'openstreetmap', 'free'],
    docsUrl: 'https://www.mapillary.com/developer/api-documentation',
    fallbackIcon: 'map',
    fields: [
      { key: 'MAPILLARY_ACCESS_TOKEN', label: 'Client Access Token', placeholder: 'MLY|...', type: 'password', required: true },
    ],
  },
  {
    id: 'gohighlevel',
    name: 'GoHighLevel',
    description: 'CRM, pipelines and marketing automation — the primary contact system of record.',
    category: 'crm_marketing',
    tags: ['ghl', 'crm', 'pipeline', 'contacts', 'workflows'],
    docsUrl: 'https://highlevel.stoplight.io/docs/integrations',
    fallbackIcon: 'settings',
    fields: [
      { key: 'GHL_API_KEY', label: 'API Key', placeholder: 'Enter GHL API key', type: 'password', required: true },
      { key: 'GHL_LOCATION_ID', label: 'Location ID', placeholder: 'Enter location ID', type: 'text', required: true },
    ],
  },
  {
    id: 'gohighlevel_new',
    name: 'GoHighLevel (Migration Account)',
    description: 'Destination GHL location used by the dual-account resolver during migration cutover.',
    category: 'crm_marketing',
    tags: ['ghl', 'migration', 'cutover', 'crm'],
    docsUrl: 'https://highlevel.stoplight.io/docs/integrations',
    fallbackIcon: 'settings',
    fields: [
      { key: 'GOHIGHLEVEL_API_KEY_NEW', label: 'API Key (New)', placeholder: 'Enter new GHL API key', type: 'password', required: true },
      { key: 'GOHIGHLEVEL_LOCATION_ID_NEW', label: 'Location ID (New)', placeholder: 'Enter new location ID', type: 'text', required: true },
    ],
  },
  {
    id: 'meta_ads',
    name: 'Meta Ads',
    description: 'Facebook and Instagram lead ads plus campaign performance for marketing attribution.',
    category: 'crm_marketing',
    tags: ['facebook', 'instagram', 'ads', 'lead gen', 'campaigns'],
    docsUrl: 'https://developers.facebook.com/docs/marketing-apis',
    fallbackIcon: 'megaphone',
    fields: [
      { key: 'META_ADS_ACCESS_TOKEN', label: 'Access Token', placeholder: 'EAA...', type: 'password', required: true },
      { key: 'META_ADS_AD_ACCOUNT_ID', label: 'Ad Account ID', placeholder: 'act_...', type: 'text', required: true },
    ],
  },
  {
    id: 'manychat',
    name: 'ManyChat',
    description: 'Conversational marketing flows across Messenger, Instagram DM and SMS.',
    category: 'crm_marketing',
    tags: ['chatbot', 'messenger', 'instagram', 'drip'],
    docsUrl: 'https://api.manychat.com',
    fallbackIcon: 'megaphone',
    fields: [{ key: 'MANYCHAT_API_KEY', label: 'API Key', placeholder: 'Enter ManyChat API key', type: 'password', required: true }],
  },

  // ── Communications ─────────────────────────────────────────────────────
  {
    id: 'resend',
    name: 'Resend',
    description: 'Transactional email delivery for portal invites, notifications and client comms.',
    category: 'communications',
    tags: ['email', 'smtp', 'transactional', 'notifications'],
    docsUrl: 'https://resend.com/docs',
    fallbackIcon: 'mail',
    fields: [
      { key: 'RESEND_API_KEY', label: 'API Key', placeholder: 're_...', type: 'password', required: true },
      // Same reasoning as Twilio's number: optional, and the default a workflow
      // "Send an email" step uses when its own From is blank.
      { key: 'RESEND_FROM_EMAIL', label: 'Default From address', placeholder: 'NPC Services <hello@example.com>', type: 'text' },
    ],
  },
  {
    id: 'microsoft',
    name: 'Microsoft / Outlook',
    description: 'Email sync, calendar and mailbox subscriptions via Microsoft Graph.',
    category: 'communications',
    tags: ['outlook', 'graph', 'calendar', 'email', 'office 365'],
    docsUrl: 'https://learn.microsoft.com/en-us/graph/overview',
    fallbackIcon: 'mail',
    fields: [
      { key: 'MICROSOFT_CLIENT_ID', label: 'Client ID', placeholder: 'Enter client ID', type: 'text', required: true },
      { key: 'MICROSOFT_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', required: true },
      { key: 'MICROSOFT_TENANT_ID', label: 'Tenant ID', placeholder: 'Enter tenant ID', type: 'text', required: true },
      { key: 'MICROSOFT_MAILBOX_EMAIL', label: 'Mailbox Email', placeholder: 'ops@example.com', type: 'text', required: false },
    ],
  },
  {
    id: 'twilio',
    name: 'Twilio',
    description: 'SMS and programmable voice delivery.',
    category: 'communications',
    tags: ['sms', 'voice', 'messaging', 'phone'],
    docsUrl: 'https://www.twilio.com/docs',
    fallbackIcon: 'phone',
    fields: [
      { key: 'TWILIO_ACCOUNT_SID', label: 'Account SID', placeholder: 'AC...', type: 'text', required: true },
      { key: 'TWILIO_AUTH_TOKEN', label: 'Auth Token', placeholder: 'Enter auth token', type: 'password', required: true },
      // Optional so an existing Twilio setup does not become "unconfigured"
      // overnight. Workflow SMS steps fall back to it when their own From is
      // blank, which is what stops the number being retyped on every step.
      { key: 'TWILIO_FROM_NUMBER', label: 'Default sending number', placeholder: '+61...', type: 'text' },
    ],
  },
  {
    id: 'vapi',
    name: 'Vapi',
    description: 'Voice AI agents for inbound and outbound calls, with recordings and transcription.',
    category: 'communications',
    tags: ['voice ai', 'calls', 'transcription', 'recordings'],
    docsUrl: 'https://docs.vapi.ai',
    fallbackIcon: 'phone',
    fields: [
      { key: 'VAPI_API_KEY', label: 'API Key', placeholder: 'Enter Vapi API key', type: 'password', required: true },
      { key: 'VAPI_WEBHOOK_SECRET', label: 'Webhook Secret', placeholder: 'Enter webhook signing secret', type: 'password', required: false },
    ],
  },
  {
    id: 'webpush',
    name: 'Web Push (VAPID)',
    description: 'Browser push notifications for Command Centre and all portals.',
    category: 'communications',
    tags: ['push', 'vapid', 'notifications', 'service worker'],
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Push_API',
    fallbackIcon: 'bell',
    fields: [
      { key: 'VAPID_PUBLIC_KEY', label: 'Public Key', placeholder: 'B...', type: 'text', required: true },
      { key: 'VAPID_PRIVATE_KEY', label: 'Private Key', placeholder: 'Enter VAPID private key', type: 'password', required: true },
      { key: 'VAPID_SUBJECT_EMAIL', label: 'Subject Email', placeholder: 'mailto:ops@example.com', type: 'text', required: false },
    ],
  },

  // ── Documents & Rendering ──────────────────────────────────────────────
  {
    id: 'docusign',
    name: 'DocuSign',
    description: 'E-signature for partner agreements, consents and loan writer undertakings.',
    category: 'documents',
    tags: ['esign', 'signature', 'agreements', 'envelopes'],
    docsUrl: 'https://developers.docusign.com/docs',
    fallbackIcon: 'file',
    fields: [
      { key: 'DOCUSIGN_INTEGRATION_KEY', label: 'Integration Key', placeholder: 'Enter integration key', type: 'text', required: true },
      { key: 'DOCUSIGN_USER_ID', label: 'User ID', placeholder: 'Enter impersonated user GUID', type: 'text', required: true },
      { key: 'DOCUSIGN_ACCOUNT_ID', label: 'Account ID', placeholder: 'Enter account GUID', type: 'text', required: true },
      { key: 'DOCUSIGN_RSA_PRIVATE_KEY', label: 'RSA Private Key', placeholder: '-----BEGIN RSA PRIVATE KEY-----', type: 'password', required: true },
      { key: 'DOCUSIGN_BASE_URL', label: 'Base URL', placeholder: 'https://demo.docusign.net/restapi', type: 'text', required: false },
    ],
  },
  {
    id: 'gamma',
    name: 'Gamma',
    description: 'Branded deck and report generation from structured report payloads.',
    category: 'documents',
    tags: ['decks', 'presentations', 'reports', 'templates'],
    docsUrl: 'https://developers.gamma.app',
    fallbackIcon: 'sparkles',
    fields: [
      { key: 'GAMMA_API_KEY', label: 'API Key', placeholder: 'Enter Gamma API key', type: 'password', required: true },
      { key: 'GAMMA_TEMPLATE_ID', label: 'Template ID', placeholder: 'Enter default template ID', type: 'text', required: false },
    ],
  },
  {
    id: 'api2pdf',
    name: 'API2PDF',
    description: 'HTML-to-PDF fallback renderer for investment and portfolio reports.',
    category: 'documents',
    tags: ['pdf', 'render', 'html', 'chrome'],
    docsUrl: 'https://www.api2pdf.com/documentation',
    fallbackIcon: 'file',
    fields: [{ key: 'API2PDF_API_KEY', label: 'API Key', placeholder: 'Enter API2PDF key', type: 'password', required: true }],
  },
  {
    id: 'weasyprint',
    name: 'WeasyPrint Service',
    description: 'Self-hosted print-grade PDF renderer used for premium report layouts.',
    category: 'documents',
    tags: ['pdf', 'render', 'self-hosted', 'print'],
    docsUrl: 'https://doc.courtbouillon.org/weasyprint/stable/',
    fallbackIcon: 'file',
    fields: [
      { key: 'WEASYPRINT_SERVICE_URL', label: 'Service URL', placeholder: 'https://weasyprint.example.com', type: 'text', required: true },
      { key: 'WEASYPRINT_SERVICE_TOKEN', label: 'Service Token', placeholder: 'Enter service token', type: 'password', required: true },
    ],
  },
  {
    id: 'pdf_parse',
    name: 'PDF Parse Service',
    description: 'Docling / Document AI sidecar that extracts structured data from client PDFs.',
    category: 'documents',
    tags: ['ocr', 'docling', 'extraction', 'document ai', 'sidecar'],
    fallbackIcon: 'file',
    fields: [
      { key: 'PDF_PARSE_SERVICE_URL', label: 'Service URL', placeholder: 'https://pdf-parse.example.com', type: 'text', required: true },
      { key: 'PDF_PARSE_SERVICE_TOKEN', label: 'Service Token', placeholder: 'Enter service token', type: 'password', required: true },
    ],
  },
  {
    id: 'render_source',
    name: 'Render Source Service',
    description: 'Sandboxed renderer that turns report source bundles into paginated output.',
    category: 'documents',
    tags: ['render', 'bundle', 'sandbox', 'reports'],
    fallbackIcon: 'file',
    fields: [
      { key: 'RENDER_SOURCE_URL', label: 'Service URL', placeholder: 'https://render.example.com', type: 'text', required: true },
      { key: 'RENDER_SOURCE_TOKEN', label: 'Service Token', placeholder: 'Enter service token', type: 'password', required: true },
    ],
  },

  // ── Automation & Workflows ─────────────────────────────────────────────
  {
    id: 'make',
    name: 'Make.com',
    description: 'Workflow automation webhooks for cross-system orchestration.',
    category: 'automation',
    tags: ['integromat', 'webhook', 'scenarios', 'automation'],
    docsUrl: 'https://www.make.com/en/help',
    fallbackIcon: 'webhook',
    fields: [{ key: 'MAKE_WEBHOOK_URL', label: 'Webhook URL', placeholder: 'https://hook.make.com/...', type: 'text' }],
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description: 'Web scraping and crawling for market updates, listing enrichment and research.',
    category: 'automation',
    tags: ['scraping', 'crawler', 'market updates', 'research'],
    docsUrl: 'https://docs.firecrawl.dev',
    fallbackIcon: 'webhook',
    fields: [{ key: 'FIRECRAWL_API_KEY', label: 'API Key', placeholder: 'fc-...', type: 'password', required: true }],
  },
  {
    id: 'mission_control',
    name: 'Aurixa Mission Control',
    description: 'Billing, seats, device caps and pricing catalog control plane.',
    category: 'automation',
    tags: ['billing', 'tokens', 'seats', 'catalog', 'aurixa'],
    fallbackIcon: 'creditCard',
    fields: [
      { key: 'MISSION_CONTROL_URL', label: 'Base URL', placeholder: 'https://mission-control.example.com', type: 'text', required: true },
      { key: 'MISSION_CONTROL_CLONE_API_KEY', label: 'Clone API Key', placeholder: 'Enter Mission Control API key', type: 'password', required: true },
      { key: 'MISSION_CONTROL_AGENCY_NAME', label: 'Agency / Tenant Ref', placeholder: 'npc-services', type: 'text', required: false },
      { key: 'MISSION_CONTROL_WEBHOOK_SECRET', label: 'Webhook Secret', placeholder: 'Enter webhook signing secret', type: 'password', required: false },
    ],
  },

  // ── Infrastructure & Security ──────────────────────────────────────────
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'CDN, R2 storage, analytics, Workers and firewall management.',
    category: 'infrastructure',
    tags: ['cdn', 'r2', 'dns', 'workers', 'waf'],
    docsUrl: 'https://developers.cloudflare.com/api',
    fallbackIcon: 'cloud',
    fields: [
      { key: 'CLOUDFLARE_API_TOKEN', label: 'API Token', placeholder: 'Enter Cloudflare API token', type: 'password', required: true },
      { key: 'CLOUDFLARE_ZONE_ID', label: 'Zone ID', placeholder: 'Enter zone ID', type: 'text', required: true },
      { key: 'CLOUDFLARE_ACCOUNT_ID', label: 'Account ID', placeholder: 'Enter account ID', type: 'text', required: true },
    ],
  },
  {
    id: 'supabase',
    name: 'Supabase Management',
    description: 'Management API access token used to sync secrets and inspect project configuration.',
    category: 'infrastructure',
    tags: ['database', 'secrets', 'edge functions', 'management api'],
    docsUrl: 'https://supabase.com/docs/reference/api/introduction',
    fallbackIcon: 'database',
    fields: [{ key: 'SUPABASE_ACCESS_TOKEN', label: 'Access Token', placeholder: 'sbp_...', type: 'password', required: true }],
  },
  {
    id: 'turnstile',
    name: 'Cloudflare Turnstile',
    description: 'Bot protection on public portal, consent and lead magnet forms.',
    category: 'infrastructure',
    tags: ['captcha', 'bot', 'security', 'forms'],
    docsUrl: 'https://developers.cloudflare.com/turnstile',
    fallbackIcon: 'shield',
    fields: [{ key: 'TURNSTILE_SECRET_KEY', label: 'Secret Key', placeholder: 'Enter Turnstile secret key', type: 'password', required: true }],
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Design token and asset sync for brand and template tooling.',
    category: 'infrastructure',
    tags: ['design', 'tokens', 'assets', 'branding'],
    docsUrl: 'https://www.figma.com/developers/api',
    fallbackIcon: 'sparkles',
    fields: [{ key: 'FIGMA_API_TOKEN', label: 'Personal Access Token', placeholder: 'figd_...', type: 'password', required: true }],
  },
  {
    id: 'mcp',
    name: 'MCP Server',
    description:
      'Model Context Protocol server. Exposes its tools, resources and prompts to workflows, so any MCP-compatible service becomes a step without needing its own integration.',
    category: 'infrastructure',
    tags: ['mcp', 'model context protocol', 'tools', 'agent', 'resources'],
    docsUrl: 'https://modelcontextprotocol.io/docs',
    fallbackIcon: 'code',
    fields: [
      { key: 'MCP_SERVER_URL', label: 'Server URL', placeholder: 'https://mcp.example.com/sse', type: 'text', required: true },
      { key: 'MCP_ACCESS_TOKEN', label: 'Access Token', placeholder: 'Bearer token, if the server requires one', type: 'password', required: false },
    ],
  },

  // ══ Expanded library ═══════════════════════════════════════════════════
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-low-latency inference for Llama, Mixtral and Whisper models.',
    category: 'ai',
    tags: ['llm', 'inference', 'fast', 'whisper'],
    docsUrl: 'https://console.groq.com/docs',
    fallbackIcon: 'brain',
    fields: [
      { key: 'GROQ_API_KEY', label: 'API Key', placeholder: 'gsk_...', type: 'password', required: true },
    ],
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: 'European open-weight models for extraction, summarisation and OCR.',
    category: 'ai',
    tags: ['llm', 'open weights', 'ocr', 'europe'],
    docsUrl: 'https://docs.mistral.ai',
    fallbackIcon: 'brain',
    fields: [
      { key: 'MISTRAL_API_KEY', label: 'API Key', placeholder: 'Enter Mistral API key', type: 'password', required: true },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'Cost-efficient reasoning and coding models.',
    category: 'ai',
    tags: ['llm', 'reasoning', 'coding'],
    docsUrl: 'https://api-docs.deepseek.com',
    fallbackIcon: 'brain',
    fields: [
      { key: 'DEEPSEEK_API_KEY', label: 'API Key', placeholder: 'sk-...', type: 'password', required: true },
    ],
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    description: 'Grok models with real-time context for market commentary.',
    category: 'ai',
    tags: ['grok', 'llm', 'realtime'],
    docsUrl: 'https://docs.x.ai',
    fallbackIcon: 'brain',
    fields: [
      { key: 'XAI_API_KEY', label: 'API Key', placeholder: 'xai-...', type: 'password', required: true },
    ],
  },
  {
    id: 'cohere',
    name: 'Cohere',
    description: 'Embeddings, rerank and enterprise RAG for the Intelligence Hub.',
    category: 'ai',
    tags: ['embeddings', 'rerank', 'rag'],
    docsUrl: 'https://docs.cohere.com',
    fallbackIcon: 'brain',
    fields: [
      { key: 'COHERE_API_KEY', label: 'API Key', placeholder: 'Enter Cohere API key', type: 'password', required: true },
    ],
  },
  {
    id: 'together',
    name: 'Together AI',
    description: 'Serverless open-source model hosting and fine-tuning.',
    category: 'ai',
    tags: ['llm', 'open source', 'fine-tune'],
    docsUrl: 'https://docs.together.ai',
    fallbackIcon: 'brain',
    fields: [
      { key: 'TOGETHER_API_KEY', label: 'API Key', placeholder: 'Enter Together API key', type: 'password', required: true },
    ],
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    description: 'Inference endpoints and model hub access for custom models.',
    category: 'ai',
    tags: ['models', 'inference', 'transformers'],
    docsUrl: 'https://huggingface.co/docs/api-inference',
    fallbackIcon: 'brain',
    fields: [
      { key: 'HUGGINGFACE_API_TOKEN', label: 'Access Token', placeholder: 'hf_...', type: 'password', required: true },
    ],
  },
  {
    id: 'replicate',
    name: 'Replicate',
    description: 'Run hosted vision, upscaling and image models for report hero imagery.',
    category: 'ai',
    tags: ['images', 'vision', 'upscale', 'models'],
    docsUrl: 'https://replicate.com/docs',
    fallbackIcon: 'sparkles',
    fields: [
      { key: 'REPLICATE_API_TOKEN', label: 'API Token', placeholder: 'r8_...', type: 'password', required: true },
    ],
  },
  {
    id: 'fal',
    name: 'fal.ai',
    description: 'Fast image and video generation for marketing and hero assets.',
    category: 'ai',
    tags: ['image gen', 'video', 'diffusion'],
    docsUrl: 'https://fal.ai/docs',
    fallbackIcon: 'sparkles',
    fields: [
      { key: 'FAL_API_KEY', label: 'API Key', placeholder: 'Enter fal.ai key', type: 'password', required: true },
    ],
  },
  {
    id: 'stability',
    name: 'Stability AI',
    description: 'Stable Diffusion image generation and editing.',
    category: 'ai',
    tags: ['image gen', 'diffusion', 'editing'],
    docsUrl: 'https://platform.stability.ai/docs',
    fallbackIcon: 'image',
    fields: [
      { key: 'STABILITY_API_KEY', label: 'API Key', placeholder: 'sk-...', type: 'password', required: true },
    ],
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    description: 'Natural text-to-speech for voice summaries and call agents.',
    category: 'ai',
    tags: ['tts', 'voice', 'speech', 'audio'],
    docsUrl: 'https://elevenlabs.io/docs',
    fallbackIcon: 'mic',
    fields: [
      { key: 'ELEVENLABS_API_KEY', label: 'API Key', placeholder: 'Enter ElevenLabs key', type: 'password', required: true },
    ],
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    description: 'Real-time speech-to-text for call transcription.',
    category: 'ai',
    tags: ['stt', 'transcription', 'calls', 'audio'],
    docsUrl: 'https://developers.deepgram.com',
    fallbackIcon: 'mic',
    fields: [
      { key: 'DEEPGRAM_API_KEY', label: 'API Key', placeholder: 'Enter Deepgram key', type: 'password', required: true },
    ],
  },
  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    description: 'Async transcription, speaker diarisation and call summarisation.',
    category: 'ai',
    tags: ['transcription', 'diarisation', 'calls'],
    docsUrl: 'https://www.assemblyai.com/docs',
    fallbackIcon: 'mic',
    fields: [
      { key: 'ASSEMBLYAI_API_KEY', label: 'API Key', placeholder: 'Enter AssemblyAI key', type: 'password', required: true },
    ],
  },
  {
    id: 'voyage',
    name: 'Voyage AI',
    description: 'High-recall embeddings for report and document retrieval.',
    category: 'ai',
    tags: ['embeddings', 'retrieval', 'rag'],
    docsUrl: 'https://docs.voyageai.com',
    fallbackIcon: 'brain',
    fields: [
      { key: 'VOYAGE_API_KEY', label: 'API Key', placeholder: 'pa-...', type: 'password', required: true },
    ],
  },
  {
    id: 'pinecone',
    name: 'Pinecone',
    description: 'Managed vector database backing document and report search.',
    category: 'ai',
    tags: ['vector', 'rag', 'search', 'embeddings'],
    docsUrl: 'https://docs.pinecone.io',
    fallbackIcon: 'database',
    fields: [
      { key: 'PINECONE_API_KEY', label: 'API Key', placeholder: 'Enter Pinecone key', type: 'password', required: true },
      { key: 'PINECONE_INDEX', label: 'Index Name', placeholder: 'npc-reports', type: 'text' },
    ],
  },
  {
    id: 'proptrack',
    name: 'PropTrack (REA)',
    description: 'REA Group valuations, AVMs and listing performance data.',
    category: 'property_data',
    tags: ['rea', 'realestate.com.au', 'avm', 'valuation'],
    docsUrl: 'https://www.proptrack.com.au',
    fallbackIcon: 'database',
    fields: [
      { key: 'PROPTRACK_API_KEY', label: 'API Key', placeholder: 'Enter PropTrack key', type: 'password', required: true },
      { key: 'PROPTRACK_BASE_URL', label: 'Base URL', placeholder: 'https://data.proptrack.com', type: 'text' },
    ],
  },
  {
    id: 'pricefinder',
    name: 'Pricefinder',
    description: 'Property attributes, sales evidence and owner records.',
    category: 'property_data',
    tags: ['sales evidence', 'ownership', 'attributes'],
    docsUrl: 'https://www.pricefinder.com.au',
    fallbackIcon: 'database',
    fields: [
      { key: 'PRICEFINDER_API_KEY', label: 'API Key', placeholder: 'Enter Pricefinder key', type: 'password', required: true },
    ],
  },
  {
    id: 'landchecker',
    name: 'Landchecker',
    description: 'Planning overlays, zoning and title information.',
    category: 'property_data',
    tags: ['zoning', 'planning', 'overlays', 'title'],
    docsUrl: 'https://landchecker.com.au',
    fallbackIcon: 'map',
    fields: [
      { key: 'LANDCHECKER_API_KEY', label: 'API Key', placeholder: 'Enter Landchecker key', type: 'password', required: true },
    ],
  },
  {
    id: 'nearmap',
    name: 'Nearmap',
    description: 'High-resolution aerial imagery and roof/site measurement.',
    category: 'property_data',
    tags: ['aerial', 'imagery', 'survey', 'roof'],
    docsUrl: 'https://docs.nearmap.com',
    fallbackIcon: 'image',
    fields: [
      { key: 'NEARMAP_API_KEY', label: 'API Key', placeholder: 'Enter Nearmap key', type: 'password', required: true },
    ],
  },
  {
    id: 'geoscape',
    name: 'Geoscape (PSMA)',
    description: 'Authoritative Australian address, cadastre and building footprints.',
    category: 'property_data',
    tags: ['gnaf', 'address', 'cadastre', 'psma'],
    docsUrl: 'https://docs.geoscape.com.au',
    fallbackIcon: 'map',
    fields: [
      { key: 'GEOSCAPE_API_KEY', label: 'API Key', placeholder: 'Enter Geoscape key', type: 'password', required: true },
    ],
  },
  {
    id: 'mapbox',
    name: 'Mapbox',
    // Server-side workflow credential only. The marketplace map's basemaps are
    // keyless (Esri) and upgrade via the build-time VITE_MAPBOX_ACCESS_TOKEN
    // public token instead — a secret stored here is unreadable to the browser.
    description: 'Mapbox geocoding and map APIs for workflow automations.',
    category: 'property_data',
    tags: ['maps', 'tiles', 'heatmap', 'geocoding'],
    docsUrl: 'https://docs.mapbox.com',
    fallbackIcon: 'map',
    fields: [
      { key: 'MAPBOX_ACCESS_TOKEN', label: 'Access Token', placeholder: 'pk....', type: 'password', required: true },
    ],
  },
  {
    id: 'abs',
    name: 'ABS Data API',
    description: 'Census demographics and dwelling statistics for suburb profiling.',
    category: 'property_data',
    tags: ['census', 'demographics', 'statistics', 'government'],
    docsUrl: 'https://api.data.abs.gov.au',
    fallbackIcon: 'barChart',
    fields: [
      { key: 'ABS_API_KEY', label: 'API Key', placeholder: 'Optional — public API', type: 'password' },
    ],
  },
  {
    id: 'rba',
    name: 'RBA Statistics',
    description: 'Official cash rate and lending series for finance modelling.',
    category: 'property_data',
    tags: ['cash rate', 'interest', 'statistics', 'government'],
    docsUrl: 'https://www.rba.gov.au/statistics',
    fallbackIcon: 'barChart',
    fields: [
      { key: 'RBA_FEED_URL', label: 'Feed URL', placeholder: 'https://www.rba.gov.au/statistics/tables/', type: 'text' },
    ],
  },
  {
    id: 'walkscore',
    name: 'Walk Score',
    description: 'Walkability, transit and bike scores for location analysis.',
    category: 'property_data',
    tags: ['walkability', 'transit', 'amenity', 'location'],
    docsUrl: 'https://www.walkscore.com/professional/api.php',
    fallbackIcon: 'map',
    fields: [
      { key: 'WALKSCORE_API_KEY', label: 'API Key', placeholder: 'Enter Walk Score key', type: 'password', required: true },
    ],
  },
  {
    id: 'cordell',
    name: 'Cordell Insights',
    description: 'Construction cost benchmarks for build and H&L feasibility.',
    category: 'property_data',
    tags: ['build cost', 'construction', 'feasibility', 'cordell'],
    docsUrl: 'https://www.cotality.com/en-au',
    fallbackIcon: 'building',
    fields: [
      { key: 'CORDELL_API_KEY', label: 'API Key', placeholder: 'Enter Cordell key', type: 'password', required: true },
    ],
  },
  {
    id: 'sqm_research',
    name: 'SQM Research',
    description: 'Vacancy rates, stock on market and rental series.',
    category: 'property_data',
    tags: ['vacancy', 'stock on market', 'rents'],
    docsUrl: 'https://sqmresearch.com.au',
    fallbackIcon: 'barChart',
    fields: [
      { key: 'SQM_RESEARCH_API_KEY', label: 'API Key', placeholder: 'Enter SQM Research key', type: 'password', required: true },
    ],
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'CRM contacts, deals and marketing email sync.',
    category: 'crm_marketing',
    tags: ['crm', 'deals', 'contacts', 'marketing'],
    docsUrl: 'https://developers.hubspot.com/docs/api/overview',
    fallbackIcon: 'users',
    fields: [
      { key: 'HUBSPOT_ACCESS_TOKEN', label: 'Private App Token', placeholder: 'pat-...', type: 'password', required: true },
    ],
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    description: 'Enterprise CRM objects, opportunities and campaign sync.',
    category: 'crm_marketing',
    tags: ['crm', 'opportunities', 'enterprise'],
    docsUrl: 'https://developer.salesforce.com/docs',
    fallbackIcon: 'users',
    fields: [
      { key: 'SALESFORCE_CLIENT_ID', label: 'Client ID', placeholder: 'Enter consumer key', type: 'text', required: true },
      { key: 'SALESFORCE_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Enter consumer secret', type: 'password', required: true },
      { key: 'SALESFORCE_INSTANCE_URL', label: 'Instance URL', placeholder: 'https://your.my.salesforce.com', type: 'text' },
    ],
  },
  {
    id: 'pipedrive',
    name: 'Pipedrive',
    description: 'Sales pipeline sync for referral and partner deal flow.',
    category: 'crm_marketing',
    tags: ['crm', 'pipeline', 'sales'],
    docsUrl: 'https://developers.pipedrive.com/docs/api/v1',
    fallbackIcon: 'users',
    fields: [
      { key: 'PIPEDRIVE_API_TOKEN', label: 'API Token', placeholder: 'Enter Pipedrive token', type: 'password', required: true },
    ],
  },
  {
    id: 'zoho_crm',
    name: 'Zoho CRM',
    description: 'Contact, lead and deal synchronisation with Zoho.',
    category: 'crm_marketing',
    tags: ['crm', 'leads', 'zoho'],
    docsUrl: 'https://www.zoho.com/crm/developer/docs/api/v6/',
    fallbackIcon: 'users',
    fields: [
      { key: 'ZOHO_CRM_CLIENT_ID', label: 'Client ID', placeholder: 'Enter client ID', type: 'text', required: true },
      { key: 'ZOHO_CRM_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', required: true },
      { key: 'ZOHO_CRM_REFRESH_TOKEN', label: 'Refresh Token', placeholder: 'Enter refresh token', type: 'password', required: true },
    ],
  },
  {
    id: 'activecampaign',
    name: 'ActiveCampaign',
    description: 'Lifecycle email automation and lead scoring.',
    category: 'crm_marketing',
    tags: ['email automation', 'lead scoring', 'nurture'],
    docsUrl: 'https://developers.activecampaign.com',
    fallbackIcon: 'megaphone',
    fields: [
      { key: 'ACTIVECAMPAIGN_API_URL', label: 'Account URL', placeholder: 'https://account.api-us1.com', type: 'text', required: true },
      { key: 'ACTIVECAMPAIGN_API_KEY', label: 'API Key', placeholder: 'Enter API key', type: 'password', required: true },
    ],
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    description: 'Audience lists and campaign broadcast for market updates.',
    category: 'crm_marketing',
    tags: ['newsletter', 'campaigns', 'audience'],
    docsUrl: 'https://mailchimp.com/developer/marketing/api/',
    fallbackIcon: 'megaphone',
    fields: [
      { key: 'MAILCHIMP_API_KEY', label: 'API Key', placeholder: 'Enter Mailchimp key', type: 'password', required: true },
      { key: 'MAILCHIMP_SERVER_PREFIX', label: 'Server Prefix', placeholder: 'us21', type: 'text' },
    ],
  },
  {
    id: 'klaviyo',
    name: 'Klaviyo',
    description: 'Behaviour-driven email and SMS flows for nurture sequences.',
    category: 'crm_marketing',
    tags: ['email', 'sms', 'flows', 'segmentation'],
    docsUrl: 'https://developers.klaviyo.com',
    fallbackIcon: 'megaphone',
    fields: [
      { key: 'KLAVIYO_API_KEY', label: 'Private API Key', placeholder: 'pk_...', type: 'password', required: true },
    ],
  },
  {
    id: 'google_ads',
    name: 'Google Ads',
    description: 'Search and performance-max campaign metrics for attribution.',
    category: 'crm_marketing',
    tags: ['ads', 'ppc', 'campaigns', 'attribution'],
    docsUrl: 'https://developers.google.com/google-ads/api/docs/start',
    fallbackIcon: 'megaphone',
    fields: [
      { key: 'GOOGLE_ADS_DEVELOPER_TOKEN', label: 'Developer Token', placeholder: 'Enter developer token', type: 'password', required: true },
      { key: 'GOOGLE_ADS_CUSTOMER_ID', label: 'Customer ID', placeholder: '123-456-7890', type: 'text', required: true },
      { key: 'GOOGLE_ADS_REFRESH_TOKEN', label: 'Refresh Token', placeholder: 'Enter refresh token', type: 'password', required: true },
    ],
  },
  {
    id: 'linkedin_ads',
    name: 'LinkedIn Ads',
    description: 'B2B campaign performance and lead gen form sync.',
    category: 'crm_marketing',
    tags: ['ads', 'b2b', 'lead gen', 'linkedin'],
    docsUrl: 'https://learn.microsoft.com/en-us/linkedin/marketing/',
    fallbackIcon: 'megaphone',
    fields: [
      { key: 'LINKEDIN_ADS_ACCESS_TOKEN', label: 'Access Token', placeholder: 'Enter access token', type: 'password', required: true },
      { key: 'LINKEDIN_ADS_ACCOUNT_ID', label: 'Ad Account ID', placeholder: 'Enter account ID', type: 'text' },
    ],
  },
  {
    id: 'tiktok_ads',
    name: 'TikTok Ads',
    description: 'Short-form campaign metrics and lead form ingestion.',
    category: 'crm_marketing',
    tags: ['ads', 'tiktok', 'campaigns', 'social'],
    docsUrl: 'https://business-api.tiktok.com/portal/docs',
    fallbackIcon: 'megaphone',
    fields: [
      { key: 'TIKTOK_ADS_ACCESS_TOKEN', label: 'Access Token', placeholder: 'Enter access token', type: 'password', required: true },
      { key: 'TIKTOK_ADS_ADVERTISER_ID', label: 'Advertiser ID', placeholder: 'Enter advertiser ID', type: 'text' },
    ],
  },
  {
    id: 'sendgrid',
    name: 'SendGrid',
    description: 'High-volume transactional and marketing email delivery.',
    category: 'communications',
    tags: ['email', 'smtp', 'transactional'],
    docsUrl: 'https://docs.sendgrid.com',
    fallbackIcon: 'mail',
    fields: [
      { key: 'SENDGRID_API_KEY', label: 'API Key', placeholder: 'SG....', type: 'password', required: true },
    ],
  },
  {
    id: 'postmark',
    name: 'Postmark',
    description: 'Fast transactional email with per-message delivery tracking.',
    category: 'communications',
    tags: ['email', 'transactional', 'tracking'],
    docsUrl: 'https://postmarkapp.com/developer',
    fallbackIcon: 'mail',
    fields: [
      { key: 'POSTMARK_SERVER_TOKEN', label: 'Server Token', placeholder: 'Enter server token', type: 'password', required: true },
    ],
  },
  {
    id: 'mailgun',
    name: 'Mailgun',
    description: 'Email delivery, routing and inbound parsing.',
    category: 'communications',
    tags: ['email', 'inbound', 'routing'],
    docsUrl: 'https://documentation.mailgun.com',
    fallbackIcon: 'mail',
    fields: [
      { key: 'MAILGUN_API_KEY', label: 'API Key', placeholder: 'key-...', type: 'password', required: true },
      { key: 'MAILGUN_DOMAIN', label: 'Sending Domain', placeholder: 'mg.example.com', type: 'text' },
    ],
  },
  {
    id: 'brevo',
    name: 'Brevo',
    description: 'Combined email, SMS and chat delivery.',
    category: 'communications',
    tags: ['email', 'sms', 'chat', 'sendinblue'],
    docsUrl: 'https://developers.brevo.com',
    fallbackIcon: 'mail',
    fields: [
      { key: 'BREVO_API_KEY', label: 'API Key', placeholder: 'xkeysib-...', type: 'password', required: true },
    ],
  },
  {
    id: 'messagemedia',
    name: 'MessageMedia',
    description: 'Australian SMS gateway with two-way conversations.',
    category: 'communications',
    tags: ['sms', 'australia', 'two-way'],
    docsUrl: 'https://developers.sinch.com/docs/messagemedia',
    fallbackIcon: 'phone',
    fields: [
      { key: 'MESSAGEMEDIA_API_KEY', label: 'API Key', placeholder: 'Enter API key', type: 'text', required: true },
      { key: 'MESSAGEMEDIA_API_SECRET', label: 'API Secret', placeholder: 'Enter API secret', type: 'password', required: true },
    ],
  },
  {
    id: 'clicksend',
    name: 'ClickSend',
    description: 'SMS, voice and physical post delivery for client comms.',
    category: 'communications',
    tags: ['sms', 'voice', 'post', 'australia'],
    docsUrl: 'https://developers.clicksend.com',
    fallbackIcon: 'phone',
    fields: [
      { key: 'CLICKSEND_USERNAME', label: 'Username', placeholder: 'Enter username', type: 'text', required: true },
      { key: 'CLICKSEND_API_KEY', label: 'API Key', placeholder: 'Enter API key', type: 'password', required: true },
    ],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Template messaging and client conversations via the Cloud API.',
    category: 'communications',
    tags: ['whatsapp', 'messaging', 'meta', 'templates'],
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    fallbackIcon: 'message',
    fields: [
      { key: 'WHATSAPP_ACCESS_TOKEN', label: 'Access Token', placeholder: 'Enter access token', type: 'password', required: true },
      { key: 'WHATSAPP_PHONE_NUMBER_ID', label: 'Phone Number ID', placeholder: 'Enter phone number ID', type: 'text', required: true },
    ],
  },
  {
    id: 'telegram',
    name: 'Telegram Bot',
    description: 'Internal ops alerts and broker notifications via bot messages.',
    category: 'communications',
    tags: ['bot', 'alerts', 'messaging'],
    docsUrl: 'https://core.telegram.org/bots/api',
    fallbackIcon: 'message',
    fields: [
      { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token', placeholder: '123456:ABC-...', type: 'password', required: true },
      { key: 'TELEGRAM_CHAT_ID', label: 'Default Chat ID', placeholder: 'Enter chat ID', type: 'text' },
    ],
  },
  {
    id: 'adobe_pdf',
    name: 'Adobe PDF Services',
    description: 'PDF generation, OCR, splitting and accessibility tagging.',
    category: 'documents',
    tags: ['pdf', 'ocr', 'adobe', 'accessibility'],
    docsUrl: 'https://developer.adobe.com/document-services/',
    fallbackIcon: 'file',
    fields: [
      { key: 'ADOBE_PDF_CLIENT_ID', label: 'Client ID', placeholder: 'Enter client ID', type: 'text', required: true },
      { key: 'ADOBE_PDF_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', required: true },
    ],
  },
  {
    id: 'pandadoc',
    name: 'PandaDoc',
    description: 'Proposal and agreement workflows with embedded signing.',
    category: 'documents',
    tags: ['esign', 'proposals', 'agreements'],
    docsUrl: 'https://developers.pandadoc.com',
    fallbackIcon: 'file',
    fields: [
      { key: 'PANDADOC_API_KEY', label: 'API Key', placeholder: 'Enter PandaDoc key', type: 'password', required: true },
    ],
  },
  {
    id: 'dropbox_sign',
    name: 'Dropbox Sign',
    description: 'Lightweight e-signature alternative for client forms.',
    category: 'documents',
    tags: ['esign', 'hellosign', 'signature'],
    docsUrl: 'https://developers.hellosign.com',
    fallbackIcon: 'file',
    fields: [
      { key: 'DROPBOX_SIGN_API_KEY', label: 'API Key', placeholder: 'Enter Dropbox Sign key', type: 'password', required: true },
    ],
  },
  {
    id: 'google_document_ai',
    name: 'Google Document AI',
    description: 'Layout-aware OCR and form parsing for the PDF sidecar.',
    category: 'documents',
    tags: ['ocr', 'document ai', 'forms', 'layout'],
    docsUrl: 'https://cloud.google.com/document-ai/docs',
    fallbackIcon: 'file',
    fields: [
      { key: 'GOOGLE_DOCUMENT_AI_PROJECT_ID', label: 'Project ID', placeholder: 'Enter GCP project ID', type: 'text', required: true },
      { key: 'GOOGLE_DOCUMENT_AI_PROCESSOR_ID', label: 'Processor ID', placeholder: 'Enter processor ID', type: 'text', required: true },
      { key: 'GOOGLE_DOCUMENT_AI_CREDENTIALS', label: 'Service Account JSON', placeholder: 'Paste service account JSON', type: 'password', required: true },
    ],
  },
  {
    id: 'cloudconvert',
    name: 'CloudConvert',
    description: 'Format conversion for uploaded client documents and images.',
    category: 'documents',
    tags: ['convert', 'docx', 'images', 'files'],
    docsUrl: 'https://cloudconvert.com/api/v2',
    fallbackIcon: 'file',
    fields: [
      { key: 'CLOUDCONVERT_API_KEY', label: 'API Key', placeholder: 'Enter CloudConvert key', type: 'password', required: true },
    ],
  },
  {
    id: 'canva',
    name: 'Canva',
    description: 'Brand template rendering for marketing collateral.',
    category: 'documents',
    tags: ['design', 'templates', 'collateral', 'brand'],
    docsUrl: 'https://www.canva.dev/docs/connect/',
    fallbackIcon: 'image',
    fields: [
      { key: 'CANVA_CLIENT_ID', label: 'Client ID', placeholder: 'Enter client ID', type: 'text', required: true },
      { key: 'CANVA_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', required: true },
    ],
  },
  {
    id: 'npc_aml_verification',
    name: 'NPC Verification Service (self-hosted)',
    description:
      'Our own face-match, liveness and MRZ service — the zero-cost KYC stack. '
      + 'Both values must be set before AML › Configuration › Providers can move IDV to live.',
    category: 'compliance',
    tags: ['kyc', 'aml', 'identity', 'biometric', 'liveness', 'self-hosted', 'face match'],
    docsUrl: 'https://github.com/Naidu-Group-Pty-Ltd/npc-property-dashbord/blob/main/docs/aml/kyc-go-live-runbook.md',
    fallbackIcon: 'shield',
    fields: [
      { key: 'AML_VERIFICATION_SERVICE_URL', label: 'Service URL', placeholder: 'https://aml-verify.internal', type: 'text', required: true },
      { key: 'AML_VERIFICATION_SERVICE_TOKEN', label: 'Service Token', placeholder: 'openssl rand -hex 32', type: 'password', required: true },
    ],
  },
  {
    id: 'frankieone',
    name: 'FrankieOne',
    description: 'Orchestrated KYC/KYB, document verification and AML workflows.',
    category: 'compliance',
    tags: ['kyc', 'aml', 'identity', 'onboarding'],
    docsUrl: 'https://apidocs.frankiefinancial.com',
    fallbackIcon: 'lock',
    fields: [
      { key: 'FRANKIEONE_API_KEY', label: 'API Key', placeholder: 'Enter FrankieOne key', type: 'password', required: true },
      { key: 'FRANKIEONE_CUSTOMER_ID', label: 'Customer ID', placeholder: 'Enter customer ID', type: 'text' },
    ],
  },
  {
    id: 'illion',
    name: 'illion',
    description: 'Bank statement retrieval and credit bureau data for finance files.',
    category: 'compliance',
    tags: ['bank statements', 'credit', 'bureau', 'open data'],
    docsUrl: 'https://bankstatements.com.au',
    fallbackIcon: 'lock',
    fields: [
      { key: 'ILLION_API_KEY', label: 'API Key', placeholder: 'Enter illion key', type: 'password', required: true },
      { key: 'ILLION_INSTITUTION', label: 'Default Institution', placeholder: 'Optional', type: 'text' },
    ],
  },
  {
    id: 'equifax',
    name: 'Equifax',
    description: 'Consumer and commercial credit checks for loan applications.',
    category: 'compliance',
    tags: ['credit check', 'bureau', 'scoring'],
    docsUrl: 'https://developer.equifax.com',
    fallbackIcon: 'lock',
    fields: [
      { key: 'EQUIFAX_CLIENT_ID', label: 'Client ID', placeholder: 'Enter client ID', type: 'text', required: true },
      { key: 'EQUIFAX_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', required: true },
    ],
  },
  {
    id: 'trulioo',
    name: 'Trulioo',
    description: 'Global identity verification and watchlist screening.',
    category: 'compliance',
    tags: ['identity', 'global', 'watchlist', 'verification'],
    docsUrl: 'https://developer.trulioo.com',
    fallbackIcon: 'lock',
    fields: [
      { key: 'TRULIOO_API_KEY', label: 'API Key', placeholder: 'Enter Trulioo key', type: 'password', required: true },
    ],
  },
  {
    id: 'sumsub',
    name: 'Sumsub',
    description: 'Liveness, document capture and ongoing AML monitoring.',
    category: 'compliance',
    tags: ['liveness', 'kyc', 'aml', 'monitoring'],
    docsUrl: 'https://docs.sumsub.com',
    fallbackIcon: 'shield',
    fields: [
      { key: 'SUMSUB_APP_TOKEN', label: 'App Token', placeholder: 'Enter app token', type: 'password', required: true },
      { key: 'SUMSUB_SECRET_KEY', label: 'Secret Key', placeholder: 'Enter secret key', type: 'password', required: true },
    ],
  },
  {
    id: 'onfido',
    name: 'Onfido',
    description: 'Document and biometric verification for portal onboarding.',
    category: 'compliance',
    tags: ['biometric', 'document', 'kyc'],
    docsUrl: 'https://documentation.onfido.com',
    fallbackIcon: 'shield',
    fields: [
      { key: 'ONFIDO_API_TOKEN', label: 'API Token', placeholder: 'api_live....', type: 'password', required: true },
    ],
  },
  {
    id: 'greenid',
    name: 'GreenID (VIX)',
    description: 'Australian electronic identity verification against DVS sources.',
    category: 'compliance',
    tags: ['evi', 'dvs', 'australia', 'identity'],
    docsUrl: 'https://www.vixverify.com',
    fallbackIcon: 'shield',
    fields: [
      { key: 'GREENID_ACCOUNT_ID', label: 'Account ID', placeholder: 'Enter account ID', type: 'text', required: true },
      { key: 'GREENID_API_PASSWORD', label: 'API Password', placeholder: 'Enter API password', type: 'password', required: true },
    ],
  },
  {
    id: 'comply_advantage',
    name: 'ComplyAdvantage',
    description: 'PEP, sanctions and adverse media screening for AML cases.',
    category: 'compliance',
    tags: ['pep', 'sanctions', 'adverse media', 'screening'],
    docsUrl: 'https://docs.complyadvantage.com',
    fallbackIcon: 'shield',
    fields: [
      { key: 'COMPLY_ADVANTAGE_API_KEY', label: 'API Key', placeholder: 'Enter ComplyAdvantage key', type: 'password', required: true },
    ],
  },
  {
    id: 'basiq',
    name: 'Basiq',
    description: 'Consented open banking data for income and expense verification.',
    category: 'compliance',
    tags: ['open banking', 'cdr', 'income', 'expenses'],
    docsUrl: 'https://api.basiq.io/reference',
    fallbackIcon: 'coins',
    fields: [
      { key: 'BASIQ_API_KEY', label: 'API Key', placeholder: 'Enter Basiq key', type: 'password', required: true },
    ],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Card payments, subscriptions and invoices.',
    category: 'payments',
    tags: ['payments', 'subscriptions', 'invoices', 'billing'],
    docsUrl: 'https://stripe.com/docs/api',
    fallbackIcon: 'creditCard',
    fields: [
      { key: 'STRIPE_SECRET_KEY', label: 'Secret Key', placeholder: 'sk_live_...', type: 'password', required: true },
      { key: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook Secret', placeholder: 'whsec_...', type: 'password' },
    ],
  },
  {
    id: 'paddle',
    name: 'Paddle',
    description: 'Merchant-of-record billing with global tax handling.',
    category: 'payments',
    tags: ['billing', 'merchant of record', 'tax', 'subscriptions'],
    docsUrl: 'https://developer.paddle.com',
    fallbackIcon: 'creditCard',
    fields: [
      { key: 'PADDLE_API_KEY', label: 'API Key', placeholder: 'Enter Paddle key', type: 'password', required: true },
      { key: 'PADDLE_WEBHOOK_SECRET', label: 'Webhook Secret', placeholder: 'Enter webhook secret', type: 'password' },
    ],
  },
  {
    id: 'xero',
    name: 'Xero',
    description: 'Accounting ledger sync for commissions, RCTIs and reconciliation.',
    category: 'payments',
    tags: ['accounting', 'invoices', 'rcti', 'ledger'],
    docsUrl: 'https://developer.xero.com/documentation',
    fallbackIcon: 'coins',
    fields: [
      { key: 'XERO_CLIENT_ID', label: 'Client ID', placeholder: 'Enter client ID', type: 'text', required: true },
      { key: 'XERO_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', required: true },
      { key: 'XERO_TENANT_ID', label: 'Tenant ID', placeholder: 'Enter tenant ID', type: 'text' },
    ],
  },
  {
    id: 'myob',
    name: 'MYOB',
    description: 'Australian accounting sync for partner payouts and invoices.',
    category: 'payments',
    tags: ['accounting', 'australia', 'payouts', 'invoices'],
    docsUrl: 'https://developer.myob.com',
    fallbackIcon: 'coins',
    fields: [
      { key: 'MYOB_CLIENT_ID', label: 'Client ID', placeholder: 'Enter client ID', type: 'text', required: true },
      { key: 'MYOB_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', required: true },
    ],
  },
  {
    id: 'chargebee',
    name: 'Chargebee',
    description: 'Subscription lifecycle, dunning and revenue recognition.',
    category: 'payments',
    tags: ['subscriptions', 'dunning', 'revenue'],
    docsUrl: 'https://apidocs.chargebee.com',
    fallbackIcon: 'creditCard',
    fields: [
      { key: 'CHARGEBEE_API_KEY', label: 'API Key', placeholder: 'Enter Chargebee key', type: 'password', required: true },
      { key: 'CHARGEBEE_SITE', label: 'Site Name', placeholder: 'yoursite', type: 'text' },
    ],
  },
  {
    id: 'wise',
    name: 'Wise',
    description: 'Multi-currency partner payouts and FX transfers.',
    category: 'payments',
    tags: ['payouts', 'fx', 'transfers', 'banking'],
    docsUrl: 'https://docs.wise.com',
    fallbackIcon: 'coins',
    fields: [
      { key: 'WISE_API_TOKEN', label: 'API Token', placeholder: 'Enter Wise token', type: 'password', required: true },
    ],
  },
  {
    id: 'posthog',
    name: 'PostHog',
    description: 'Product analytics, session replay and feature flags.',
    category: 'analytics',
    tags: ['analytics', 'replay', 'feature flags', 'events'],
    docsUrl: 'https://posthog.com/docs/api',
    fallbackIcon: 'barChart',
    fields: [
      { key: 'POSTHOG_API_KEY', label: 'Project API Key', placeholder: 'phc_...', type: 'text', required: true },
      { key: 'POSTHOG_HOST', label: 'Host', placeholder: 'https://app.posthog.com', type: 'text' },
    ],
  },
  {
    id: 'google_analytics',
    name: 'Google Analytics 4',
    description: 'Traffic, conversion and lead-magnet funnel reporting.',
    category: 'analytics',
    tags: ['ga4', 'traffic', 'conversions', 'funnels'],
    docsUrl: 'https://developers.google.com/analytics/devguides/reporting/data/v1',
    fallbackIcon: 'barChart',
    fields: [
      { key: 'GA4_PROPERTY_ID', label: 'Property ID', placeholder: 'Enter GA4 property ID', type: 'text', required: true },
      { key: 'GA4_SERVICE_ACCOUNT_JSON', label: 'Service Account JSON', placeholder: 'Paste service account JSON', type: 'password', required: true },
    ],
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    description: 'Event analytics and cohort retention for portal usage.',
    category: 'analytics',
    tags: ['events', 'cohorts', 'retention'],
    docsUrl: 'https://developer.mixpanel.com/reference',
    fallbackIcon: 'barChart',
    fields: [
      { key: 'MIXPANEL_PROJECT_TOKEN', label: 'Project Token', placeholder: 'Enter project token', type: 'text', required: true },
      { key: 'MIXPANEL_API_SECRET', label: 'API Secret', placeholder: 'Enter API secret', type: 'password' },
    ],
  },
  {
    id: 'amplitude',
    name: 'Amplitude',
    description: 'Behavioural analytics across Command Centre and portals.',
    category: 'analytics',
    tags: ['behaviour', 'analytics', 'product'],
    docsUrl: 'https://amplitude.com/docs/apis',
    fallbackIcon: 'barChart',
    fields: [
      { key: 'AMPLITUDE_API_KEY', label: 'API Key', placeholder: 'Enter Amplitude key', type: 'password', required: true },
    ],
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Error tracking and performance monitoring for the app and edge functions.',
    category: 'analytics',
    tags: ['errors', 'monitoring', 'tracing', 'alerts'],
    docsUrl: 'https://docs.sentry.io',
    fallbackIcon: 'code',
    fields: [
      { key: 'SENTRY_DSN', label: 'DSN', placeholder: 'https://...@sentry.io/...', type: 'text', required: true },
      { key: 'SENTRY_AUTH_TOKEN', label: 'Auth Token', placeholder: 'Enter auth token', type: 'password' },
    ],
  },
  {
    id: 'logrocket',
    name: 'LogRocket',
    description: 'Session replay and frontend performance diagnostics.',
    category: 'analytics',
    tags: ['replay', 'frontend', 'diagnostics'],
    docsUrl: 'https://docs.logrocket.com',
    fallbackIcon: 'video',
    fields: [
      { key: 'LOGROCKET_APP_ID', label: 'App ID', placeholder: 'org/app', type: 'text', required: true },
    ],
  },
  {
    id: 'datadog',
    name: 'Datadog',
    description: 'Infrastructure metrics, logs and synthetic monitoring.',
    category: 'analytics',
    tags: ['metrics', 'logs', 'apm', 'observability'],
    docsUrl: 'https://docs.datadoghq.com/api/latest/',
    fallbackIcon: 'barChart',
    fields: [
      { key: 'DATADOG_API_KEY', label: 'API Key', placeholder: 'Enter Datadog key', type: 'password', required: true },
      { key: 'DATADOG_APP_KEY', label: 'Application Key', placeholder: 'Enter application key', type: 'password' },
    ],
  },
  {
    id: 'semrush',
    name: 'Semrush',
    description: 'Keyword, backlink and competitor SEO intelligence.',
    category: 'analytics',
    tags: ['seo', 'keywords', 'backlinks', 'competitors'],
    docsUrl: 'https://developer.semrush.com',
    fallbackIcon: 'globe',
    fields: [
      { key: 'SEMRUSH_API_KEY', label: 'API Key', placeholder: 'Enter Semrush key', type: 'password', required: true },
    ],
  },
  {
    id: 'google_search_console',
    name: 'Google Search Console',
    description: 'Indexing status and organic query performance.',
    category: 'analytics',
    tags: ['seo', 'indexing', 'organic', 'search'],
    docsUrl: 'https://developers.google.com/webmaster-tools',
    fallbackIcon: 'globe',
    fields: [
      { key: 'GSC_SITE_URL', label: 'Site URL', placeholder: 'https://example.com', type: 'text', required: true },
      { key: 'GSC_SERVICE_ACCOUNT_JSON', label: 'Service Account JSON', placeholder: 'Paste service account JSON', type: 'password', required: true },
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Deal alerts, compliance escalations and ops channels.',
    category: 'productivity',
    tags: ['chat', 'alerts', 'channels', 'notifications'],
    docsUrl: 'https://api.slack.com',
    fallbackIcon: 'message',
    fields: [
      { key: 'SLACK_BOT_TOKEN', label: 'Bot Token', placeholder: 'xoxb-...', type: 'password', required: true },
      { key: 'SLACK_DEFAULT_CHANNEL', label: 'Default Channel', placeholder: '#ops', type: 'text' },
    ],
  },
  {
    id: 'microsoft_teams',
    name: 'Microsoft Teams',
    description: 'Channel notifications and adaptive card approvals.',
    category: 'productivity',
    tags: ['teams', 'chat', 'notifications', 'approvals'],
    docsUrl: 'https://learn.microsoft.com/en-us/microsoftteams/platform/',
    fallbackIcon: 'message',
    fields: [
      { key: 'TEAMS_WEBHOOK_URL', label: 'Incoming Webhook URL', placeholder: 'https://outlook.office.com/webhook/...', type: 'text', required: true },
    ],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Knowledge base, SOPs and internal documentation sync.',
    category: 'productivity',
    tags: ['docs', 'wiki', 'sops', 'knowledge'],
    docsUrl: 'https://developers.notion.com',
    fallbackIcon: 'file',
    fields: [
      { key: 'NOTION_API_KEY', label: 'Integration Token', placeholder: 'secret_...', type: 'password', required: true },
      { key: 'NOTION_DATABASE_ID', label: 'Default Database ID', placeholder: 'Enter database ID', type: 'text' },
    ],
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Engineering issue tracking linked to platform defects.',
    category: 'productivity',
    tags: ['issues', 'engineering', 'tickets'],
    docsUrl: 'https://developers.linear.app',
    fallbackIcon: 'code',
    fields: [
      { key: 'LINEAR_API_KEY', label: 'API Key', placeholder: 'lin_api_...', type: 'password', required: true },
    ],
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Project and defect tracking for delivery workstreams.',
    category: 'productivity',
    tags: ['tickets', 'projects', 'atlassian'],
    docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/',
    fallbackIcon: 'code',
    fields: [
      { key: 'JIRA_BASE_URL', label: 'Base URL', placeholder: 'https://your.atlassian.net', type: 'text', required: true },
      { key: 'JIRA_EMAIL', label: 'Account Email', placeholder: 'ops@example.com', type: 'text', required: true },
      { key: 'JIRA_API_TOKEN', label: 'API Token', placeholder: 'Enter API token', type: 'password', required: true },
    ],
  },
  {
    id: 'asana',
    name: 'Asana',
    description: 'Task and onboarding checklist orchestration.',
    category: 'productivity',
    tags: ['tasks', 'projects', 'checklists'],
    docsUrl: 'https://developers.asana.com',
    fallbackIcon: 'package',
    fields: [
      { key: 'ASANA_ACCESS_TOKEN', label: 'Personal Access Token', placeholder: 'Enter Asana token', type: 'password', required: true },
    ],
  },
  {
    id: 'monday',
    name: 'monday.com',
    description: 'Board-driven workflow tracking for operations teams.',
    category: 'productivity',
    tags: ['boards', 'workflow', 'tasks'],
    docsUrl: 'https://developer.monday.com/api-reference',
    fallbackIcon: 'package',
    fields: [
      { key: 'MONDAY_API_TOKEN', label: 'API Token', placeholder: 'Enter monday token', type: 'password', required: true },
    ],
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    description: 'Task management for delivery and compliance follow-ups.',
    category: 'productivity',
    tags: ['tasks', 'projects', 'docs'],
    docsUrl: 'https://clickup.com/api',
    fallbackIcon: 'package',
    fields: [
      { key: 'CLICKUP_API_TOKEN', label: 'API Token', placeholder: 'pk_...', type: 'password', required: true },
    ],
  },
  {
    id: 'calendly',
    name: 'Calendly',
    description: 'Scheduling links, event types and booking webhooks.',
    category: 'productivity',
    tags: ['scheduling', 'bookings', 'calendar'],
    docsUrl: 'https://developer.calendly.com',
    fallbackIcon: 'calendar',
    fields: [
      { key: 'CALENDLY_API_TOKEN', label: 'Personal Access Token', placeholder: 'Enter Calendly token', type: 'password', required: true },
    ],
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    description: 'Two-way appointment sync for advisers and partners.',
    category: 'productivity',
    tags: ['calendar', 'appointments', 'sync', 'google'],
    docsUrl: 'https://developers.google.com/calendar/api',
    fallbackIcon: 'calendar',
    fields: [
      { key: 'GOOGLE_CALENDAR_CLIENT_ID', label: 'Client ID', placeholder: 'Enter client ID', type: 'text', required: true },
      { key: 'GOOGLE_CALENDAR_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', required: true },
      { key: 'GOOGLE_CALENDAR_REFRESH_TOKEN', label: 'Refresh Token', placeholder: 'Enter refresh token', type: 'password', required: true },
    ],
  },
  {
    id: 'zoom',
    name: 'Zoom',
    description: 'Meeting creation, recordings and transcripts for client sessions.',
    category: 'productivity',
    tags: ['meetings', 'recordings', 'video', 'transcripts'],
    docsUrl: 'https://developers.zoom.us/docs/api/',
    fallbackIcon: 'video',
    fields: [
      { key: 'ZOOM_ACCOUNT_ID', label: 'Account ID', placeholder: 'Enter account ID', type: 'text', required: true },
      { key: 'ZOOM_CLIENT_ID', label: 'Client ID', placeholder: 'Enter client ID', type: 'text', required: true },
      { key: 'ZOOM_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', required: true },
    ],
  },
  {
    id: 'fireflies',
    name: 'Fireflies.ai',
    description: 'Meeting notes and action items captured from client calls.',
    category: 'productivity',
    tags: ['meeting notes', 'transcription', 'action items'],
    docsUrl: 'https://docs.fireflies.ai',
    fallbackIcon: 'mic',
    fields: [
      { key: 'FIREFLIES_API_KEY', label: 'API Key', placeholder: 'Enter Fireflies key', type: 'password', required: true },
    ],
  },
  {
    id: 'aws_s3',
    name: 'Amazon S3',
    description: 'Object storage for report archives and document vaults.',
    category: 'storage',
    tags: ['s3', 'object storage', 'aws', 'archive'],
    docsUrl: 'https://docs.aws.amazon.com/s3/',
    fallbackIcon: 'package',
    fields: [
      { key: 'AWS_ACCESS_KEY_ID', label: 'Access Key ID', placeholder: 'AKIA...', type: 'text', required: true },
      { key: 'AWS_SECRET_ACCESS_KEY', label: 'Secret Access Key', placeholder: 'Enter secret access key', type: 'password', required: true },
      { key: 'AWS_REGION', label: 'Region', placeholder: 'ap-southeast-2', type: 'text' },
      { key: 'AWS_S3_BUCKET', label: 'Bucket', placeholder: 'npc-documents', type: 'text' },
    ],
  },
  {
    id: 'cloudflare_r2',
    name: 'Cloudflare R2',
    description: 'Zero-egress object storage for call recordings and media.',
    category: 'storage',
    tags: ['r2', 'object storage', 'recordings', 'media'],
    docsUrl: 'https://developers.cloudflare.com/r2/',
    fallbackIcon: 'cloud',
    fields: [
      { key: 'R2_ACCOUNT_ID', label: 'Account ID', placeholder: 'Enter account ID', type: 'text', required: true },
      { key: 'R2_ACCESS_KEY_ID', label: 'Access Key ID', placeholder: 'Enter access key ID', type: 'text', required: true },
      { key: 'R2_SECRET_ACCESS_KEY', label: 'Secret Access Key', placeholder: 'Enter secret access key', type: 'password', required: true },
      { key: 'R2_BUCKET', label: 'Bucket', placeholder: 'call-recordings', type: 'text' },
    ],
  },
  {
    id: 'google_drive',
    name: 'Google Drive',
    description: 'Shared drive document intake and export.',
    category: 'storage',
    tags: ['drive', 'documents', 'google', 'sync'],
    docsUrl: 'https://developers.google.com/drive/api',
    fallbackIcon: 'package',
    fields: [
      { key: 'GOOGLE_DRIVE_CLIENT_ID', label: 'Client ID', placeholder: 'Enter client ID', type: 'text', required: true },
      { key: 'GOOGLE_DRIVE_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', required: true },
      { key: 'GOOGLE_DRIVE_REFRESH_TOKEN', label: 'Refresh Token', placeholder: 'Enter refresh token', type: 'password', required: true },
    ],
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    description: 'Client document collection folders and file requests.',
    category: 'storage',
    tags: ['files', 'folders', 'sharing'],
    docsUrl: 'https://www.dropbox.com/developers/documentation',
    fallbackIcon: 'package',
    fields: [
      { key: 'DROPBOX_ACCESS_TOKEN', label: 'Access Token', placeholder: 'Enter Dropbox token', type: 'password', required: true },
    ],
  },
  {
    id: 'onedrive',
    name: 'Microsoft OneDrive',
    description: 'SharePoint and OneDrive document libraries via Graph.',
    category: 'storage',
    tags: ['onedrive', 'sharepoint', 'graph', 'files'],
    docsUrl: 'https://learn.microsoft.com/en-us/graph/onedrive-concept-overview',
    fallbackIcon: 'package',
    fields: [
      { key: 'ONEDRIVE_DRIVE_ID', label: 'Drive ID', placeholder: 'Enter drive ID', type: 'text' },
    ],
  },
  {
    id: 'cloudinary',
    name: 'Cloudinary',
    description: 'Image optimisation, transformation and CDN delivery for listings.',
    category: 'storage',
    tags: ['images', 'cdn', 'transform', 'media'],
    docsUrl: 'https://cloudinary.com/documentation',
    fallbackIcon: 'image',
    fields: [
      { key: 'CLOUDINARY_CLOUD_NAME', label: 'Cloud Name', placeholder: 'Enter cloud name', type: 'text', required: true },
      { key: 'CLOUDINARY_API_KEY', label: 'API Key', placeholder: 'Enter API key', type: 'text', required: true },
      { key: 'CLOUDINARY_API_SECRET', label: 'API Secret', placeholder: 'Enter API secret', type: 'password', required: true },
    ],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Organic company page publishing and engagement metrics.',
    category: 'media',
    tags: ['social', 'publishing', 'b2b', 'company page'],
    docsUrl: 'https://learn.microsoft.com/en-us/linkedin/',
    fallbackIcon: 'globe',
    fields: [
      { key: 'LINKEDIN_ACCESS_TOKEN', label: 'Access Token', placeholder: 'Enter access token', type: 'password', required: true },
      { key: 'LINKEDIN_ORGANIZATION_ID', label: 'Organisation ID', placeholder: 'Enter organisation URN', type: 'text' },
    ],
  },
  {
    id: 'x_twitter',
    name: 'X (Twitter)',
    description: 'Post scheduling and listening for market commentary.',
    category: 'media',
    tags: ['social', 'tweets', 'publishing'],
    docsUrl: 'https://developer.x.com/en/docs',
    fallbackIcon: 'globe',
    fields: [
      { key: 'X_API_KEY', label: 'API Key', placeholder: 'Enter API key', type: 'text', required: true },
      { key: 'X_API_SECRET', label: 'API Secret', placeholder: 'Enter API secret', type: 'password', required: true },
      { key: 'X_ACCESS_TOKEN', label: 'Access Token', placeholder: 'Enter access token', type: 'password', required: true },
    ],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Video upload and performance metrics for education content.',
    category: 'media',
    tags: ['video', 'uploads', 'analytics', 'google'],
    docsUrl: 'https://developers.google.com/youtube/v3',
    fallbackIcon: 'video',
    fields: [
      { key: 'YOUTUBE_API_KEY', label: 'API Key', placeholder: 'AIza...', type: 'password', required: true },
      { key: 'YOUTUBE_CHANNEL_ID', label: 'Channel ID', placeholder: 'Enter channel ID', type: 'text' },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram Graph',
    description: 'Business account publishing and insights.',
    category: 'media',
    tags: ['social', 'instagram', 'insights', 'meta'],
    docsUrl: 'https://developers.facebook.com/docs/instagram-api',
    fallbackIcon: 'image',
    fields: [
      { key: 'INSTAGRAM_ACCESS_TOKEN', label: 'Access Token', placeholder: 'Enter access token', type: 'password', required: true },
      { key: 'INSTAGRAM_BUSINESS_ACCOUNT_ID', label: 'Business Account ID', placeholder: 'Enter account ID', type: 'text' },
    ],
  },
  {
    id: 'buffer',
    name: 'Buffer',
    description: 'Cross-channel social scheduling for marketing campaigns.',
    category: 'media',
    tags: ['scheduling', 'social', 'queue'],
    docsUrl: 'https://buffer.com/developers/api',
    fallbackIcon: 'megaphone',
    fields: [
      { key: 'BUFFER_ACCESS_TOKEN', label: 'Access Token', placeholder: 'Enter Buffer token', type: 'password', required: true },
    ],
  },
  {
    id: 'zapier',
    name: 'Zapier',
    description: 'No-code automation webhooks across 6,000+ apps.',
    category: 'automation',
    tags: ['zaps', 'webhooks', 'no-code'],
    docsUrl: 'https://platform.zapier.com/docs',
    fallbackIcon: 'webhook',
    fields: [
      { key: 'ZAPIER_WEBHOOK_URL', label: 'Webhook URL', placeholder: 'https://hooks.zapier.com/hooks/catch/...', type: 'text', required: true },
    ],
  },
  {
    id: 'n8n',
    name: 'n8n',
    description: 'Self-hosted workflow orchestration for internal pipelines.',
    category: 'automation',
    tags: ['workflows', 'self-hosted', 'orchestration'],
    docsUrl: 'https://docs.n8n.io',
    fallbackIcon: 'webhook',
    fields: [
      { key: 'N8N_BASE_URL', label: 'Base URL', placeholder: 'https://n8n.example.com', type: 'text', required: true },
      { key: 'N8N_API_KEY', label: 'API Key', placeholder: 'Enter n8n API key', type: 'password', required: true },
    ],
  },
  {
    id: 'apify',
    name: 'Apify',
    description: 'Managed scrapers and actors for listing and market ingestion.',
    category: 'automation',
    tags: ['scraping', 'actors', 'crawlers'],
    docsUrl: 'https://docs.apify.com/api/v2',
    fallbackIcon: 'webhook',
    fields: [
      { key: 'APIFY_API_TOKEN', label: 'API Token', placeholder: 'apify_api_...', type: 'password', required: true },
    ],
  },
  {
    id: 'scrapingbee',
    name: 'ScrapingBee',
    description: 'Rendered-page scraping with proxy rotation.',
    category: 'automation',
    tags: ['scraping', 'proxy', 'headless'],
    docsUrl: 'https://www.scrapingbee.com/documentation/',
    fallbackIcon: 'webhook',
    fields: [
      { key: 'SCRAPINGBEE_API_KEY', label: 'API Key', placeholder: 'Enter ScrapingBee key', type: 'password', required: true },
    ],
  },
  {
    id: 'browserless',
    name: 'Browserless',
    description: 'Hosted headless Chrome for PDF capture and page rendering.',
    category: 'automation',
    tags: ['headless', 'chrome', 'screenshots', 'pdf'],
    docsUrl: 'https://docs.browserless.io',
    fallbackIcon: 'code',
    fields: [
      { key: 'BROWSERLESS_URL', label: 'Service URL', placeholder: 'https://chrome.browserless.io', type: 'text', required: true },
      { key: 'BROWSERLESS_TOKEN', label: 'Token', placeholder: 'Enter Browserless token', type: 'password', required: true },
    ],
  },
  {
    id: 'inngest',
    name: 'Inngest',
    description: 'Durable background jobs and scheduled workflow steps.',
    category: 'automation',
    tags: ['jobs', 'queues', 'durable', 'cron'],
    docsUrl: 'https://www.inngest.com/docs',
    fallbackIcon: 'webhook',
    fields: [
      { key: 'INNGEST_EVENT_KEY', label: 'Event Key', placeholder: 'Enter event key', type: 'password', required: true },
      { key: 'INNGEST_SIGNING_KEY', label: 'Signing Key', placeholder: 'signkey-...', type: 'password' },
    ],
  },
  {
    id: 'aws',
    name: 'Amazon Web Services',
    description: 'Baseline AWS credentials for SES, Lambda and Bedrock services.',
    category: 'infrastructure',
    tags: ['aws', 'cloud', 'iam', 'bedrock'],
    docsUrl: 'https://docs.aws.amazon.com',
    fallbackIcon: 'cloud',
    fields: [
      { key: 'AWS_ACCOUNT_ACCESS_KEY_ID', label: 'Access Key ID', placeholder: 'AKIA...', type: 'text', required: true },
      { key: 'AWS_ACCOUNT_SECRET_ACCESS_KEY', label: 'Secret Access Key', placeholder: 'Enter secret access key', type: 'password', required: true },
      { key: 'AWS_DEFAULT_REGION', label: 'Default Region', placeholder: 'ap-southeast-2', type: 'text' },
    ],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repository automation, deployment status and issue sync.',
    category: 'infrastructure',
    tags: ['repo', 'ci', 'deployments', 'issues'],
    docsUrl: 'https://docs.github.com/en/rest',
    fallbackIcon: 'code',
    fields: [
      { key: 'GITHUB_TOKEN', label: 'Personal Access Token', placeholder: 'ghp_...', type: 'password', required: true },
      { key: 'GITHUB_REPOSITORY', label: 'Repository', placeholder: 'owner/repo', type: 'text' },
    ],
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Frontend deployment status and preview environments.',
    category: 'infrastructure',
    tags: ['deploy', 'hosting', 'preview'],
    docsUrl: 'https://vercel.com/docs/rest-api',
    fallbackIcon: 'cloud',
    fields: [
      { key: 'VERCEL_API_TOKEN', label: 'API Token', placeholder: 'Enter Vercel token', type: 'password', required: true },
      { key: 'VERCEL_PROJECT_ID', label: 'Project ID', placeholder: 'prj_...', type: 'text' },
    ],
  },
  {
    id: 'upstash',
    name: 'Upstash Redis',
    description: 'Serverless Redis for rate limiting, caching and queues.',
    category: 'infrastructure',
    tags: ['redis', 'cache', 'rate limit', 'queue'],
    docsUrl: 'https://upstash.com/docs',
    fallbackIcon: 'database',
    fields: [
      { key: 'UPSTASH_REDIS_REST_URL', label: 'REST URL', placeholder: 'https://xxx.upstash.io', type: 'text', required: true },
      { key: 'UPSTASH_REDIS_REST_TOKEN', label: 'REST Token', placeholder: 'Enter REST token', type: 'password', required: true },
    ],
  },
  {
    id: 'doppler',
    name: 'Doppler',
    description: 'Centralised secret management and environment sync.',
    category: 'infrastructure',
    tags: ['secrets', 'env', 'rotation'],
    docsUrl: 'https://docs.doppler.com',
    fallbackIcon: 'lock',
    fields: [
      { key: 'DOPPLER_TOKEN', label: 'Service Token', placeholder: 'dp.st....', type: 'password', required: true },
    ],
  },
  {
    id: 'auth0',
    name: 'Auth0',
    description: 'Optional enterprise SSO for staff Command Centre access.',
    category: 'infrastructure',
    tags: ['sso', 'oauth', 'identity', 'saml'],
    docsUrl: 'https://auth0.com/docs',
    fallbackIcon: 'lock',
    fields: [
      { key: 'AUTH0_DOMAIN', label: 'Domain', placeholder: 'tenant.au.auth0.com', type: 'text', required: true },
      { key: 'AUTH0_CLIENT_ID', label: 'Client ID', placeholder: 'Enter client ID', type: 'text', required: true },
      { key: 'AUTH0_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', required: true },
    ],
  },
  {
    id: 'segment',
    name: 'Twilio Segment',
    description: 'Customer data platform for unified event streaming.',
    category: 'infrastructure',
    tags: ['cdp', 'events', 'segment', 'streaming'],
    docsUrl: 'https://segment.com/docs/api/',
    fallbackIcon: 'webhook',
    fields: [
      { key: 'SEGMENT_WRITE_KEY', label: 'Write Key', placeholder: 'Enter write key', type: 'password', required: true },
    ],
  },
];

/**
 * Frontend field key → Supabase secret name, when they differ.
 *
 * `AIRTABLE_API_KEY` used to alias `AIRTABLE_TOKEN` — so a key typed on this
 * page overwrote the one the Listings & Overview pipeline runs on. That key is
 * managed by Mission Control now (one value across the prime and every clone),
 * and the page's Airtable card is the workflow connection under its own names.
 * See docs/integrations/AIRTABLE_KEY_OWNERSHIP.md.
 */
export const SUPABASE_SECRET_ALIASES: Record<string, string> = {
  GHL_API_KEY: 'GOHIGHLEVEL_API_KEY',
  GHL_LOCATION_ID: 'GOHIGHLEVEL_LOCATION_ID',
};

export function getSupabaseSecretName(fieldKey: string): string {
  return SUPABASE_SECRET_ALIASES[fieldKey] ?? fieldKey;
}

export function getCategory(id: IntegrationCategoryId): IntegrationCategory {
  return INTEGRATION_CATEGORIES.find((c) => c.id === id) ?? INTEGRATION_CATEGORIES[0];
}

/** Lowercased haystack used by the search box. */
export function integrationSearchIndex(integration: IntegrationDefinition): string {
  return [
    integration.name,
    integration.description,
    integration.category,
    ...integration.tags,
    ...integration.fields.map((f) => `${f.key} ${f.label}`),
  ]
    .join(' ')
    .toLowerCase();
}
