// Per-integration brand profiles.
// Logos come from Simple Icons CDN (SVG, no auth, cached on their edge).
// `slug` is the simple-icons slug — see https://simpleicons.org
// `color` is the official brand hex (used for icon halo, header wash, hover ring).
// Third-party brand identity is not a theme token — hex is correct here.

export interface BrandProfile {
  /** simple-icons slug — omit to fall back to thesvg.org / the lucide icon */
  slug?: string;
  /** thesvg.org slug — used when Simple Icons has no (or a removed) mark */
  svgOrgSlug?: string;
  /** Official brand hex, no leading # */
  color: string;
  /** Optional secondary hex for two-tone wash (Gemini spectrum, etc.) */
  color2?: string;
  /** Legibility of the brand color on the header wash — currently informational */
  luminance?: 'light' | 'dark';
}

export const BRAND_PROFILES: Record<string, BrandProfile> = {
  // AI & Models
  openai:      { slug: 'openai',           svgOrgSlug: 'openai',     color: '10A37F', luminance: 'dark' },
  anthropic:   { slug: 'anthropic',        svgOrgSlug: 'anthropic',  color: 'D97757', luminance: 'dark' },
  gemini:      { slug: 'googlegemini',                               color: '4285F4', color2: '9B72CB', luminance: 'dark' },
  perplexity:  { slug: 'perplexity',       svgOrgSlug: 'perplexity', color: '20808D', luminance: 'dark' },
  openrouter:  { slug: 'openrouter',       svgOrgSlug: 'openrouter', color: '6467F2', luminance: 'dark' },
  xai:         { slug: 'x',                                          color: '000000', luminance: 'dark' },

  // Property & market data
  airtable:    { slug: 'airtable',         svgOrgSlug: 'airtable',   color: '18BFFF', luminance: 'dark' },
  cotality:    {                                                     color: '0B7285', luminance: 'dark' },
  domain:      {                                                     color: '2B7A3D', luminance: 'dark' },
  google_maps: { slug: 'googlemaps',                                 color: '4285F4', luminance: 'dark' },

  // CRM & marketing
  gohighlevel: {                                                     color: 'FFB800', luminance: 'dark' },
  gohighlevel_new: {                                                 color: 'FFB800', luminance: 'dark' },
  meta_ads:    { slug: 'meta',             svgOrgSlug: 'meta',       color: '0668E1', luminance: 'dark' },
  manychat:    {                                                     color: '2C6BED', luminance: 'dark' },

  // Communications
  resend:      { slug: 'resend',           svgOrgSlug: 'resend',     color: '000000', luminance: 'dark' },
  twilio:      { slug: 'twilio',           svgOrgSlug: 'twilio',     color: 'F22F46', luminance: 'dark' },
  microsoft:   { slug: 'microsoft',                                  color: '0078D4', luminance: 'dark' },
  vapi:        {                                                     color: '14B8A6', luminance: 'dark' },
  webpush:     {                                                     color: '8B5CF6', luminance: 'dark' },

  // Documents & rendering
  docusign:    {                           svgOrgSlug: 'docusign',   color: 'FFCC22', luminance: 'dark' },
  gamma:       {                                                     color: '7C3AED', luminance: 'dark' },
  api2pdf:     {                                                     color: 'E4572E', luminance: 'dark' },
  weasyprint:  {                                                     color: '3B7EA1', luminance: 'dark' },
  pdf_parse:   {                                                     color: 'DC2626', luminance: 'dark' },
  render_source: {                                                   color: '6366F1', luminance: 'dark' },

  // Automation & workflows
  make:        { slug: 'make',             svgOrgSlug: 'make',       color: '6D00CC', luminance: 'dark' },
  firecrawl:   {                           svgOrgSlug: 'firecrawl',  color: 'F97316', luminance: 'dark' },
  mission_control: {                                                 color: 'D4A843', luminance: 'dark' },

  // Infrastructure & security
  cloudflare:  { slug: 'cloudflare',       svgOrgSlug: 'cloudflare', color: 'F38020', luminance: 'dark' },
  supabase:    { slug: 'supabase',         svgOrgSlug: 'supabase',   color: '3ECF8E', luminance: 'dark' },
  turnstile:   { slug: 'cloudflare',       svgOrgSlug: 'cloudflare', color: 'F38020', luminance: 'dark' },
  figma:       { slug: 'figma',            svgOrgSlug: 'figma',      color: 'F24E1E', luminance: 'dark' },


  // Model Hub — direct provider routes
  gateway:     { slug: 'lovable',          color: 'D4A843', luminance: 'dark' },

  // Model Hub — OpenRouter family slugs (id.split('/')[0])
  google:       { slug: 'google',          color: '4285F4', luminance: 'dark' },
  'meta-llama': { slug: 'meta',            color: '0668E1', luminance: 'dark' },
  mistralai:    { slug: 'mistralai',       color: 'FA520F', luminance: 'dark' },
  deepseek:     { slug: 'deepseek',        color: '4D6BFE', luminance: 'dark' },
  qwen:         { slug: 'qwen',            color: '615CED', luminance: 'dark' },
  'x-ai':       { slug: 'x',               color: '000000', luminance: 'dark' },
  cohere:       { svgOrgSlug: 'cohere',    color: '39594D', luminance: 'dark' },
  nvidia:       { slug: 'nvidia',          color: '76B900', luminance: 'dark' },
  'hugging-face': { slug: 'huggingface',   color: 'FFD21E', luminance: 'dark' },
  huggingfaceh4: { slug: 'huggingface',    color: 'FFD21E', luminance: 'dark' },
  databricks:   { slug: 'databricks',      color: 'FF3621', luminance: 'dark' },
  amazon:       {                          color: 'FF9900', luminance: 'dark' },
  'amazon-bedrock': {                      color: 'FF9900', luminance: 'dark' },
  nousresearch: {                          color: '8B5CF6', luminance: 'dark' },
  microsoft_wsl: { slug: 'microsoft',      color: '0078D4', luminance: 'dark' },
  ai21:         {                          color: 'FF6B00', luminance: 'dark' },
  moonshotai:   {                          color: '2ECC71', luminance: 'dark' },
  z_ai:         {                          color: '0EA5E9', luminance: 'dark' },
  inception:    {                          color: '8B5CF6', luminance: 'dark' },
  liquid:       {                          color: '06B6D4', luminance: 'dark' },

  // ── Expanded library ──────────────────────────────────────────────────
  groq: { slug: 'groq', color: '00A67E', luminance: 'dark' },
  mistral: { slug: 'mistralai', color: 'FA520F', luminance: 'dark' },
  together: { svgOrgSlug: 'togetherdotai', color: '0F6FFF', luminance: 'dark' },
  huggingface: { slug: 'huggingface', color: 'FFD21E', luminance: 'dark' },
  replicate: { slug: 'replicate', color: '000000', luminance: 'dark' },
  fal: { svgOrgSlug: 'fal', color: '8B5CF6', luminance: 'dark' },
  stability: { slug: 'stabilityai', color: '330066', luminance: 'dark' },
  elevenlabs: { slug: 'elevenlabs', svgOrgSlug: 'elevenlabs', color: '000000', luminance: 'dark' },
  deepgram: { slug: 'deepgram', color: '13EF93', luminance: 'dark' },
  assemblyai: { svgOrgSlug: 'assemblyai', color: '2545F6', luminance: 'dark' },
  voyage: { color: '2563EB', luminance: 'dark' },
  pinecone: { svgOrgSlug: 'pinecone', color: '000000', luminance: 'dark' },
  proptrack: { color: 'E4002B', luminance: 'dark' },
  pricefinder: { color: '0B4F6C', luminance: 'dark' },
  landchecker: { color: '2E7D32', luminance: 'dark' },
  nearmap: { color: 'FF6D00', luminance: 'dark' },
  geoscape: { color: '0F766E', luminance: 'dark' },
  mapbox: { slug: 'mapbox', svgOrgSlug: 'mapbox', color: '000000', luminance: 'dark' },
  abs: { color: '00558B', luminance: 'dark' },
  rba: { color: '1B3A6B', luminance: 'dark' },
  walkscore: { color: '3AAA35', luminance: 'dark' },
  cordell: { color: '0B7285', luminance: 'dark' },
  sqm_research: { color: '8B5CF6', luminance: 'dark' },
  hubspot: { slug: 'hubspot', svgOrgSlug: 'hubspot', color: 'FF7A59', luminance: 'dark' },
  salesforce: { slug: 'salesforce', svgOrgSlug: 'salesforce', color: '00A1E0', luminance: 'dark' },
  pipedrive: { slug: 'pipedrive', color: '017737', luminance: 'dark' },
  zoho_crm: { slug: 'zoho', color: 'E42527', luminance: 'dark' },
  activecampaign: { slug: 'activecampaign', color: '356AE6', luminance: 'dark' },
  mailchimp: { slug: 'mailchimp', svgOrgSlug: 'mailchimp', color: 'FFE01B', luminance: 'dark' },
  klaviyo: { slug: 'klaviyo', color: '000000', luminance: 'dark' },
  google_ads: { slug: 'googleads', color: '4285F4', luminance: 'dark' },
  linkedin_ads: { slug: 'linkedin', svgOrgSlug: 'linkedin', color: '0A66C2', luminance: 'dark' },
  tiktok_ads: { slug: 'tiktok', svgOrgSlug: 'tiktok', color: '000000', luminance: 'dark' },
  sendgrid: { color: '1A82E2', luminance: 'dark' },
  postmark: { svgOrgSlug: 'postmark', color: 'FFDE00', luminance: 'dark' },
  mailgun: { color: 'F06B66', luminance: 'dark' },
  brevo: { slug: 'brevo', color: '0B996E', luminance: 'dark' },
  messagemedia: { color: 'E4002B', luminance: 'dark' },
  clicksend: { color: '1D9BF0', luminance: 'dark' },
  whatsapp: { slug: 'whatsapp', svgOrgSlug: 'whatsapp', color: '25D366', luminance: 'dark' },
  telegram: { slug: 'telegram', svgOrgSlug: 'telegram', color: '26A5E4', luminance: 'dark' },
  adobe_pdf: { svgOrgSlug: 'adobe', color: 'EC1C24', luminance: 'dark' },
  pandadoc: { color: '4CAF50', luminance: 'dark' },
  dropbox_sign: { slug: 'dropbox', svgOrgSlug: 'dropbox', color: '0061FF', luminance: 'dark' },
  google_document_ai: { slug: 'googlecloud', color: '4285F4', luminance: 'dark' },
  cloudconvert: { color: '1B57A6', luminance: 'dark' },
  canva: { color: '00C4CC', luminance: 'dark' },
  frankieone: { color: '1D4ED8', luminance: 'dark' },
  illion: { color: '00A0AF', luminance: 'dark' },
  equifax: { color: '9E1B32', luminance: 'dark' },
  trulioo: { color: '00A0DF', luminance: 'dark' },
  sumsub: { color: '1F6FEB', luminance: 'dark' },
  onfido: { color: '3B37FF', luminance: 'dark' },
  greenid: { color: '2E7D32', luminance: 'dark' },
  comply_advantage: { color: '111827', luminance: 'dark' },
  basiq: { color: '5B21B6', luminance: 'dark' },
  stripe: { slug: 'stripe', svgOrgSlug: 'stripe', color: '635BFF', luminance: 'dark' },
  paddle: { slug: 'paddle', color: 'FDDD35', luminance: 'dark' },
  xero: { slug: 'xero', svgOrgSlug: 'xero', color: '13B5EA', luminance: 'dark' },
  myob: { slug: 'myob', svgOrgSlug: 'myob', color: '6100A5', luminance: 'dark' },
  chargebee: { slug: 'chargebee', color: 'FF7846', luminance: 'dark' },
  wise: { slug: 'wise', color: '9FE870', luminance: 'dark' },
  posthog: { slug: 'posthog', svgOrgSlug: 'posthog', color: 'F54E00', luminance: 'dark' },
  google_analytics: { slug: 'googleanalytics', color: 'E37400', luminance: 'dark' },
  mixpanel: { slug: 'mixpanel', svgOrgSlug: 'mixpanel', color: '7856FF', luminance: 'dark' },
  amplitude: { slug: 'amplitude', color: '1E61F0', luminance: 'dark' },
  sentry: { slug: 'sentry', svgOrgSlug: 'sentry', color: '362D59', luminance: 'dark' },
  logrocket: { color: '764ABC', luminance: 'dark' },
  datadog: { slug: 'datadog', color: '632CA6', luminance: 'dark' },
  semrush: { slug: 'semrush', color: 'FF642D', luminance: 'dark' },
  google_search_console: { slug: 'googlesearchconsole', color: '458CF5', luminance: 'dark' },
  slack: { slug: 'slack', svgOrgSlug: 'slack', color: '4A154B', luminance: 'dark' },
  microsoft_teams: { svgOrgSlug: 'microsoft-teams', color: '6264A7', luminance: 'dark' },
  notion: { slug: 'notion', svgOrgSlug: 'notion', color: '000000', luminance: 'dark' },
  linear: { slug: 'linear', svgOrgSlug: 'linear', color: '5E6AD2', luminance: 'dark' },
  jira: { slug: 'jira', svgOrgSlug: 'jira', color: '0052CC', luminance: 'dark' },
  asana: { slug: 'asana', svgOrgSlug: 'asana', color: 'F06A6A', luminance: 'dark' },
  monday: { color: 'FF3D57', luminance: 'dark' },
  clickup: { slug: 'clickup', color: '7B68EE', luminance: 'dark' },
  calendly: { slug: 'calendly', color: '006BFF', luminance: 'dark' },
  google_calendar: { slug: 'googlecalendar', color: '4285F4', luminance: 'dark' },
  zoom: { slug: 'zoom', svgOrgSlug: 'zoom', color: '0B5CFF', luminance: 'dark' },
  fireflies: { color: 'FF6B35', luminance: 'dark' },
  aws_s3: { slug: 'amazons3', color: '569A31', luminance: 'dark' },
  cloudflare_r2: { slug: 'cloudflare', svgOrgSlug: 'cloudflare', color: 'F38020', luminance: 'dark' },
  google_drive: { slug: 'googledrive', color: '4285F4', luminance: 'dark' },
  dropbox: { slug: 'dropbox', svgOrgSlug: 'dropbox', color: '0061FF', luminance: 'dark' },
  onedrive: { svgOrgSlug: 'microsoft-onedrive', color: '0078D4', luminance: 'dark' },
  cloudinary: { slug: 'cloudinary', color: '3448C5', luminance: 'dark' },
  linkedin: { slug: 'linkedin', svgOrgSlug: 'linkedin', color: '0A66C2', luminance: 'dark' },
  x_twitter: { slug: 'x', color: '000000', luminance: 'dark' },
  youtube: { slug: 'youtube', svgOrgSlug: 'youtube', color: 'FF0000', luminance: 'dark' },
  instagram: { slug: 'instagram', svgOrgSlug: 'instagram', color: 'E4405F', luminance: 'dark' },
  buffer: { slug: 'buffer', color: '231F20', luminance: 'dark' },
  zapier: { slug: 'zapier', svgOrgSlug: 'zapier', color: 'FF4F00', luminance: 'dark' },
  n8n: { slug: 'n8n', color: 'EA4B71', luminance: 'dark' },
  apify: { color: 'FF9013', luminance: 'dark' },
  scrapingbee: { color: 'F5A623', luminance: 'dark' },
  browserless: { slug: 'googlechrome', color: '4285F4', luminance: 'dark' },
  inngest: { slug: 'inngest', color: '000000', luminance: 'dark' },
  aws: { svgOrgSlug: 'amazon-web-services', color: 'FF9900', luminance: 'dark' },
  github: { slug: 'github', svgOrgSlug: 'github', color: '181717', luminance: 'dark' },
  vercel: { slug: 'vercel', svgOrgSlug: 'vercel', color: '000000', luminance: 'dark' },
  upstash: { slug: 'upstash', color: '00E9A3', luminance: 'dark' },
  doppler: { svgOrgSlug: 'doppler', color: '3391FF', luminance: 'dark' },
  auth0: { slug: 'auth0', color: 'EB5424', luminance: 'dark' },
  segment: { slug: 'segment', color: '52BD94', luminance: 'dark' },
};

export function getBrandProfile(id: string): BrandProfile | undefined {
  return Object.prototype.hasOwnProperty.call(BRAND_PROFILES, id) ? BRAND_PROFILES[id] : undefined;
}

/** Build the Simple Icons CDN URL for a colored SVG mark. */
export function brandLogoUrl(slug: string, colorHex: string): string {
  return `https://cdn.simpleicons.org/${slug}/${colorHex}`;
}

/**
 * Fallback mark from thesvg.org — used when Simple Icons has no entry
 * (or dropped one for trademark reasons). The raw file is rendered through a
 * CSS mask by `BrandMark`, so it receives the same brand-colour treatment as
 * Simple Icons marks (which are tinted server-side via the CDN path).
 */
export function svgOrgLogoUrl(slug: string): string {
  return `https://thesvg.org/icons/${slug}/default.svg`;
}

/**
 * Locally vendored brand marks for services neither icon library carries.
 * Files were sourced from each vendor's own site/CDN and live in
 * `src/assets/brands/`. They are rendered through the same CSS mask treatment
 * as the thesvg.org fallbacks so every mark keeps one consistent colour rule.
 */
const LOCAL_BRAND_MODULES = import.meta.glob('../../assets/brands/*.{svg,png}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const LOCAL_BRAND_ASSETS: Record<string, string> = Object.fromEntries(
  Object.entries(LOCAL_BRAND_MODULES).map(([path, url]) => [
    path.split('/').pop()!.replace(/\.(svg|png)$/, ''),
    url,
  ]),
);

/** Integration ids that reuse another brand's vendored mark. */
const LOCAL_BRAND_ALIASES: Record<string, string> = {
  gohighlevel_new: 'gohighlevel',
  landchecker: 'landchecker-mark',
};


export function getLocalBrandAsset(id: string): string | undefined {
  const key = Object.prototype.hasOwnProperty.call(LOCAL_BRAND_ALIASES, id)
    ? LOCAL_BRAND_ALIASES[id]
    : id;
  return Object.prototype.hasOwnProperty.call(LOCAL_BRAND_ASSETS, key)
    ? LOCAL_BRAND_ASSETS[key]
    : undefined;
}

/**
 * Vendored marks that are full-colour badges (the glyph sits inside a filled
 * tile or is multi-tone). CSS-masking these collapses them into a solid
 * brand-coloured square, so they render as plain images instead.
 */
const FULL_COLOR_LOCAL_ASSETS = new Set([
  'apify',
  'basiq',
  'domain',
  'sumsub',
  'trulioo',
  'canva',
  'pandadoc',
  'onfido',
  'pricefinder',
  'vapi',
  'postmark',
  'gamma',
  'landchecker',
  'clicksend',
  'cloudconvert',
  'greenid',
]);

export function isFullColorLocalAsset(id: string): boolean {
  return FULL_COLOR_LOCAL_ASSETS.has(id);
}

/**
 * Brands with no usable public mark (wordmark-only, or the only asset in
 * circulation belongs to a parent company). These render a brand-coloured
 * monogram tile rather than a misattributed or blank glyph.
 */
const BRAND_MONOGRAMS: Record<string, string> = {
  illion: 'il',
};


export function getBrandMonogram(id: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(BRAND_MONOGRAMS, id)
    ? BRAND_MONOGRAMS[id]
    : undefined;
}



/** Relative luminance (0–1) of a `RRGGBB` hex string. */
function hexLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return 0.5;
  const channel = (start: number) => {
    const value = parseInt(clean.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Brand marks this dark disappear against a dark surface. */
const NEAR_BLACK_LUMINANCE = 0.06;

/** Light substitute used for near-black marks in dark mode. */
export const DARK_MODE_MARK_HEX = 'F4F4F5';

export function isNearBlackBrandColor(colorHex: string): boolean {
  return hexLuminance(colorHex) <= NEAR_BLACK_LUMINANCE;
}

/**
 * Resolve the hex a brand mark should render in for the active theme.
 * Near-black marks (X/xAI, Resend, Vercel-likes) flip to a light tint in dark
 * mode so they stay visible; every other brand keeps its official colour.
 */
export function resolveBrandMarkHex(colorHex: string, isDark: boolean): string {
  const clean = colorHex.replace('#', '');
  return isDark && isNearBlackBrandColor(clean) ? DARK_MODE_MARK_HEX : clean;
}

