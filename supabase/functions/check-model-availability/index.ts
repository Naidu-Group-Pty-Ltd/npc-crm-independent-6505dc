// Live model availability probe.
// Calls each provider's official "list models" endpoint, refreshes the
// `model_catalog_cache` table, and returns the live catalog plus per-provider
// connectivity status. Cache TTL is 24h; pass { force: true } to re-probe.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { internalError } from '../_shared/errorResponse.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';
import { describeAnthropicReach } from '../_shared/anthropicCredential.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const PROVIDER_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type Route = 'gateway' | 'native' | 'openrouter';
type Status = 'available' | 'preview' | 'deprecated' | 'unavailable';
type ProbedModel = {
  provider: string;
  route: Route;
  model_id: string;
  display_name?: string;
  status: Status;
  context_window?: number;
  capabilities?: string[];
  pricing_input_per_1m?: number;
  pricing_output_per_1m?: number;
  raw_metadata?: any;
};

type ProviderResult = {
  provider: string;
  route: Route;
  ok: boolean;
  keyConfigured: boolean;
  modelCount: number;
  error?: string;
  probedAt: string;
};

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}

/** Determine if an id should be tagged preview/deprecated based on naming hints. */
function inferStatus(id: string, raw?: any): Status {
  const lower = id.toLowerCase();
  if (lower.includes('preview') || lower.includes('exp') || lower.includes('beta')) return 'preview';
  if (raw?.deprecated || raw?.status === 'deprecated' || lower.includes('deprecated')) return 'deprecated';
  return 'available';
}

// ===== Provider probes =====

async function probeLovableGateway(): Promise<{ result: ProviderResult; models: ProbedModel[] }> {
  const probedAt = new Date().toISOString();
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) return { result: { provider: 'lovable_gateway', route: 'gateway', ok: false, keyConfigured: false, modelCount: 0, error: 'LOVABLE_API_KEY missing', probedAt }, models: [] };

  try {
    const r = await fetchWithTimeout('https://ai.gateway.lovable.dev/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!r.ok) {
      // Fallback to known-good static list — gateway sometimes 404s on /models
      return { result: { provider: 'lovable_gateway', route: 'gateway', ok: true, keyConfigured: true, modelCount: KNOWN_GATEWAY.length, probedAt }, models: KNOWN_GATEWAY };
    }
    const data = await r.json();
    const list: any[] = data?.data ?? data?.models ?? [];
    const models: ProbedModel[] = list.map((m) => {
      const id = m.id ?? m.name;
      const provider = id.startsWith('openai/') ? 'openai' : id.startsWith('google/') ? 'gemini' : id.startsWith('anthropic/') ? 'anthropic' : 'gateway';
      return { provider, route: 'gateway', model_id: id, display_name: m.display_name ?? m.name ?? id, status: inferStatus(id, m), context_window: m.context_length ?? m.context_window, capabilities: deriveCaps(id), raw_metadata: m };
    });
    const merged = mergeWithKnown(models, KNOWN_GATEWAY);
    return { result: { provider: 'lovable_gateway', route: 'gateway', ok: true, keyConfigured: true, modelCount: merged.length, probedAt }, models: merged };
  } catch (e: any) {
    // Keep the gateway catalogue usable when its optional listing endpoint
    // times out. Calls still route through the gateway and are validated when
    // an assigned model is used.
    return {
      result: { provider: 'lovable_gateway', route: 'gateway', ok: true, keyConfigured: true, modelCount: KNOWN_GATEWAY.length, error: e.message, probedAt },
      models: KNOWN_GATEWAY,
    };
  }
}

async function probeOpenAI(): Promise<{ result: ProviderResult; models: ProbedModel[] }> {
  const probedAt = new Date().toISOString();
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) return { result: { provider: 'openai', route: 'native', ok: false, keyConfigured: false, modelCount: 0, probedAt }, models: [] };
  try {
    const r = await fetchWithTimeout('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!r.ok) return { result: { provider: 'openai', route: 'native', ok: false, keyConfigured: true, modelCount: 0, error: `${r.status}`, probedAt }, models: [] };
    const data = await r.json();
    const list: any[] = (data?.data ?? []).filter((m: any) => /^(gpt|o\d|chatgpt|text-embedding|whisper|tts|dall-e)/i.test(m.id));
    const models: ProbedModel[] = list.map((m) => ({ provider: 'openai', route: 'native', model_id: m.id, display_name: m.id, status: inferStatus(m.id, m), capabilities: deriveCaps(m.id), raw_metadata: m }));
    return { result: { provider: 'openai', route: 'native', ok: true, keyConfigured: true, modelCount: models.length, probedAt }, models };
  } catch (e: any) {
    return { result: { provider: 'openai', route: 'native', ok: false, keyConfigured: true, modelCount: 0, error: e.message, probedAt }, models: [] };
  }
}

async function probeAnthropic(): Promise<{ result: ProviderResult; models: ProbedModel[] }> {
  /*
   * The catalog and the self-test ask the SAME question, so they run the same
   * probe. `keyConfigured` is a reading about whether this deployment can
   * reach Anthropic AT ALL — which since federation is no longer the same
   * question as whether a key is set, and reading the environment directly
   * reported a correctly federated clone as unconfigured.
   *
   * No `freshCredential` here: this is a scheduled sweep rather than an
   * operator's question, and a cached token is exactly what inference will be
   * spending anyway.
   */
  const { reach, models: list } = await describeAnthropicReach();
  const probedAt = reach.probedAt;
  // `unconfigured` is the only reading that means no credential was found; a
  // route that resolved and was then refused HAS one, and reporting that as
  // an unset key sends an operator to add a credential that is already there.
  const keyConfigured = reach.route !== 'unconfigured';
  if (!reach.ok) {
    return { result: { provider: 'anthropic', route: 'native', ok: false, keyConfigured, modelCount: 0, error: reach.why ?? undefined, probedAt }, models: [] };
  }
  const models: ProbedModel[] = (list as any[]).map((m) => ({ provider: 'anthropic', route: 'native', model_id: m.id, display_name: m.display_name ?? m.id, status: inferStatus(m.id, m), capabilities: ['text', 'vision', 'reasoning'], raw_metadata: m }));
  return { result: { provider: 'anthropic', route: 'native', ok: true, keyConfigured: true, modelCount: models.length, probedAt }, models };
}

async function probeGemini(): Promise<{ result: ProviderResult; models: ProbedModel[] }> {
  const probedAt = new Date().toISOString();
  const apiKey = Deno.env.get('GEMINI_API_KEY') ?? Deno.env.get('GOOGLE_API_KEY');
  if (!apiKey) return { result: { provider: 'gemini', route: 'native', ok: false, keyConfigured: false, modelCount: 0, probedAt }, models: [] };
  try {
    const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!r.ok) return { result: { provider: 'gemini', route: 'native', ok: false, keyConfigured: true, modelCount: 0, error: `${r.status}`, probedAt }, models: [] };
    const data = await r.json();
    const list: any[] = (data?.models ?? []).filter((m: any) => /generateContent/i.test((m.supportedGenerationMethods ?? []).join(',')));
    const models: ProbedModel[] = list.map((m) => {
      const id = (m.name ?? '').replace(/^models\//, '');
      return { provider: 'gemini', route: 'native', model_id: id, display_name: m.displayName ?? id, status: inferStatus(id, m), context_window: m.inputTokenLimit, capabilities: deriveCaps(id), raw_metadata: m };
    });
    return { result: { provider: 'gemini', route: 'native', ok: true, keyConfigured: true, modelCount: models.length, probedAt }, models };
  } catch (e: any) {
    return { result: { provider: 'gemini', route: 'native', ok: false, keyConfigured: true, modelCount: 0, error: e.message, probedAt }, models: [] };
  }
}

async function probePerplexity(): Promise<{ result: ProviderResult; models: ProbedModel[] }> {
  const probedAt = new Date().toISOString();
  const apiKey = Deno.env.get('PERPLEXITY_API_KEY');
  if (!apiKey) return { result: { provider: 'perplexity', route: 'native', ok: false, keyConfigured: false, modelCount: 0, probedAt }, models: [] };
  // Perplexity has no /models endpoint — verify auth with a tiny call & return curated list.
  try {
    const r = await fetchWithTimeout('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
    });
    const ok = r.ok || r.status === 400; // 400 = bad payload but auth worked
    if (!ok) return { result: { provider: 'perplexity', route: 'native', ok: false, keyConfigured: true, modelCount: 0, error: `${r.status}`, probedAt }, models: [] };
    return { result: { provider: 'perplexity', route: 'native', ok: true, keyConfigured: true, modelCount: KNOWN_PERPLEXITY.length, probedAt }, models: KNOWN_PERPLEXITY };
  } catch (e: any) {
    return { result: { provider: 'perplexity', route: 'native', ok: false, keyConfigured: true, modelCount: 0, error: e.message, probedAt }, models: [] };
  }
}

async function probeOpenRouter(): Promise<{ result: ProviderResult; models: ProbedModel[] }> {
  const probedAt = new Date().toISOString();
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) return { result: { provider: 'openrouter', route: 'openrouter', ok: false, keyConfigured: false, modelCount: 0, probedAt }, models: [] };
  try {
    const r = await fetchWithTimeout('https://openrouter.ai/api/v1/models', { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!r.ok) return { result: { provider: 'openrouter', route: 'openrouter', ok: false, keyConfigured: true, modelCount: 0, error: `${r.status}`, probedAt }, models: [] };
    const data = await r.json();
    const list: any[] = data?.data ?? [];
    const models: ProbedModel[] = list.map((m) => ({
      provider: 'openrouter',
      route: 'openrouter',
      model_id: m.id,
      display_name: m.name ?? m.id,
      status: inferStatus(m.id, m),
      context_window: m.context_length,
      capabilities: deriveCaps(m.id, m),
      pricing_input_per_1m: m.pricing?.prompt ? Number(m.pricing.prompt) * 1_000_000 : undefined,
      pricing_output_per_1m: m.pricing?.completion ? Number(m.pricing.completion) * 1_000_000 : undefined,
      raw_metadata: m,
    }));
    return { result: { provider: 'openrouter', route: 'openrouter', ok: true, keyConfigured: true, modelCount: models.length, probedAt }, models };
  } catch (e: any) {
    return { result: { provider: 'openrouter', route: 'openrouter', ok: false, keyConfigured: true, modelCount: 0, error: e.message, probedAt }, models: [] };
  }
}

// ===== Curated fallbacks (used when an endpoint is unreliable) =====

const KNOWN_GATEWAY: ProbedModel[] = [
  { provider: 'gemini', route: 'gateway', model_id: 'google/gemini-3.1-pro-preview', display_name: 'Gemini 3.1 Pro (Preview)', status: 'preview', capabilities: ['text', 'vision', 'reasoning'] },
  { provider: 'gemini', route: 'gateway', model_id: 'google/gemini-3-flash-preview', display_name: 'Gemini 3 Flash (Preview)', status: 'preview', capabilities: ['text', 'vision'] },
  { provider: 'gemini', route: 'gateway', model_id: 'google/gemini-2.5-pro', display_name: 'Gemini 2.5 Pro', status: 'available', capabilities: ['text', 'vision', 'reasoning'] },
  { provider: 'gemini', route: 'gateway', model_id: 'google/gemini-2.5-flash', display_name: 'Gemini 2.5 Flash', status: 'available', capabilities: ['text', 'vision'] },
  { provider: 'gemini', route: 'gateway', model_id: 'google/gemini-2.5-flash-lite', display_name: 'Gemini 2.5 Flash Lite', status: 'available', capabilities: ['text'] },
  { provider: 'gemini', route: 'gateway', model_id: 'google/gemini-2.5-flash-image', display_name: 'Gemini 2.5 Flash Image', status: 'available', capabilities: ['image-gen'] },
  { provider: 'gemini', route: 'gateway', model_id: 'google/gemini-3.1-flash-image-preview', display_name: 'Gemini 3.1 Flash Image (Preview)', status: 'preview', capabilities: ['image-gen', 'image-edit'] },
  { provider: 'openai', route: 'gateway', model_id: 'openai/gpt-5', display_name: 'GPT-5', status: 'available', capabilities: ['text', 'vision', 'reasoning'] },
  { provider: 'openai', route: 'gateway', model_id: 'openai/gpt-5-mini', display_name: 'GPT-5 Mini', status: 'available', capabilities: ['text', 'vision'] },
  { provider: 'openai', route: 'gateway', model_id: 'openai/gpt-5-nano', display_name: 'GPT-5 Nano', status: 'available', capabilities: ['text'] },
  { provider: 'openai', route: 'gateway', model_id: 'openai/gpt-5.2', display_name: 'GPT-5.2', status: 'available', capabilities: ['text', 'reasoning'] },
];
const KNOWN_PERPLEXITY: ProbedModel[] = [
  { provider: 'perplexity', route: 'native', model_id: 'sonar-pro', display_name: 'Sonar Pro', status: 'available', capabilities: ['text', 'search', 'citations'] },
  { provider: 'perplexity', route: 'native', model_id: 'sonar', display_name: 'Sonar', status: 'available', capabilities: ['text', 'search'] },
];

function deriveCaps(id: string, raw?: any): string[] {
  const caps = new Set<string>(['text']);
  const lower = id.toLowerCase();
  if (lower.includes('vision') || lower.includes('gpt-4o') || lower.includes('gpt-5') || lower.includes('claude') || lower.includes('gemini')) caps.add('vision');
  if (lower.includes('reason') || lower.includes('o1') || lower.includes('o3') || lower.includes('opus') || lower.includes('pro')) caps.add('reasoning');
  if (lower.includes('image')) { caps.add('image-gen'); caps.delete('text'); }
  if (lower.includes('sonar')) caps.add('search');
  if (raw?.architecture?.modality) {
    const mod = String(raw.architecture.modality);
    if (mod.includes('image')) caps.add('vision');
  }
  return Array.from(caps);
}

function mergeWithKnown(probed: ProbedModel[], known: ProbedModel[]): ProbedModel[] {
  const map = new Map(probed.map((m) => [`${m.route}::${m.model_id}`, m]));
  for (const k of known) {
    const key = `${k.route}::${k.model_id}`;
    if (!map.has(key)) map.set(key, k);
  }
  return Array.from(map.values());
}

// ===== Persist + serve =====

async function persistCatalog(allModels: ProbedModel[], errorByKey: Record<string, string>) {
  const sb = admin();
  if (allModels.length > 0) {
    const rows = allModels.map((m) => ({
      provider: m.provider,
      route: m.route,
      model_id: m.model_id,
      display_name: m.display_name ?? m.model_id,
      status: m.status,
      context_window: m.context_window ?? null,
      capabilities: m.capabilities ?? [],
      pricing_input_per_1m: m.pricing_input_per_1m ?? null,
      pricing_output_per_1m: m.pricing_output_per_1m ?? null,
      raw_metadata: m.raw_metadata ?? {},
      last_probed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      probe_error: errorByKey[`${m.provider}::${m.route}`] ?? null,
    }));
    // Upsert in chunks of 200 to stay safe on payload size
    for (let i = 0; i < rows.length; i += 200) {
      const slice = rows.slice(i, i + 200);
      await sb.from('model_catalog_cache').upsert(slice, { onConflict: 'provider,route,model_id' });
    }
  }
}

const __corsWrappedHandler = async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    let force = false;
    if (req.method === 'POST') {
      try { const b = await req.json(); force = !!b?.force; } catch { /* noop */ }
    }

    // Try to serve from cache (unless force)
    const sb = admin();
    if (!force) {
      const { data: cached } = await sb
        .from('model_catalog_cache')
        .select('*')
        .gt('expires_at', new Date().toISOString());
      if (cached && cached.length > 0) {
        const { data: settings } = await sb.from('llm_integration_settings').select('*');
        return new Response(
          JSON.stringify({
            success: true,
            cached: true,
            checkedAt: cached[0].last_probed_at,
            providers: buildProviderSummary(cached as any[], settings ?? []),
            models: cached,
            // Legacy compat
            nativeKeys: legacyNativeKeys(cached as any[]),
            gatewayKey: cached.some((m: any) => m.route === 'gateway'),
            openrouterKey: cached.some((m: any) => m.route === 'openrouter'),
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Probe all providers in parallel
    const [gw, oa, an, ge, px, or] = await Promise.all([
      probeLovableGateway(),
      probeOpenAI(),
      probeAnthropic(),
      probeGemini(),
      probePerplexity(),
      probeOpenRouter(),
    ]);

    const allModels = [...gw.models, ...oa.models, ...an.models, ...ge.models, ...px.models, ...or.models];
    const results = [gw.result, oa.result, an.result, ge.result, px.result, or.result];
    const errorByKey: Record<string, string> = {};
    for (const r of results) if (r.error) errorByKey[`${r.provider}::${r.route}`] = r.error;

    await persistCatalog(allModels, errorByKey);

    // Update integration settings test status
    for (const r of results) {
      try {
        const providerKey = r.provider === 'lovable_gateway' ? 'lovable_gateway' : r.provider;
        await sb.from('llm_integration_settings').upsert({
          provider: providerKey,
          is_enabled: r.keyConfigured,
          last_test_at: r.probedAt,
          last_test_success: r.ok,
          last_test_error: r.error ?? null,
          metadata: { modelCount: r.modelCount },
        }, { onConflict: 'provider' });
      } catch { /* noop */ }
    }

    return new Response(
      JSON.stringify({
        success: true,
        cached: false,
        checkedAt: new Date().toISOString(),
        providers: results,
        models: allModels,
        // Legacy compat for existing UI
        nativeKeys: {
          openai: oa.result.keyConfigured,
          anthropic: an.result.keyConfigured,
          gemini: ge.result.keyConfigured,
          perplexity: px.result.keyConfigured,
        },
        gatewayKey: gw.result.keyConfigured,
        openrouterKey: or.result.keyConfigured,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ...internalError(e, 'check-model-availability'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. This function is browser-reachable and its callers
// send `credentials: 'include'`, and the Fetch spec makes the browser reject a
// credentialed response carrying `Access-Control-Allow-Origin: *` — opaquely,
// as "Failed to fetch". See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));


function buildProviderSummary(cached: any[], settings: any[]): ProviderResult[] {
  const grouped = new Map<string, any[]>();
  for (const m of cached) {
    const k = `${m.provider}::${m.route}`;
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(m);
  }
  return Array.from(grouped.entries()).map(([k, models]) => {
    const [provider, route] = k.split('::') as [string, Route];
    const setting = settings.find((s) => s.provider === provider);
    return {
      provider,
      route,
      ok: setting?.last_test_success ?? true,
      keyConfigured: setting?.is_enabled ?? true,
      modelCount: models.length,
      error: setting?.last_test_error ?? undefined,
      probedAt: models[0]?.last_probed_at ?? new Date().toISOString(),
    };
  });
}

function legacyNativeKeys(cached: any[]) {
  const has = (provider: string) => cached.some((m) => m.provider === provider && m.route === 'native');
  return { openai: has('openai'), anthropic: has('anthropic'), gemini: has('gemini'), perplexity: has('perplexity') };
}
