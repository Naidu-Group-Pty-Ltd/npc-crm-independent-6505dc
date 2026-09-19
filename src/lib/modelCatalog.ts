// Model catalog: source of truth for the Model Hub page.
// Segregated by route: "native" (direct provider API keys we hold) vs "gateway" (Lovable AI Gateway).

export type ModelRoute = 'native' | 'gateway';
export type ModelStatus = 'available' | 'deprecated' | 'preview' | 'unavailable';

export interface ModelEntry {
  id: string; // model identifier as used in API calls
  displayName: string;
  provider: 'openai' | 'anthropic' | 'gemini' | 'perplexity';
  route: ModelRoute;
  status: ModelStatus;
  context?: string;
  capabilities: string[]; // text, vision, reasoning, image-gen, search, audio
  notes?: string;
  successor?: string; // suggested replacement when deprecated
  releaseTier?: 'flagship' | 'balanced' | 'fast' | 'reasoning' | 'image' | 'search';
}

export interface ProviderMeta {
  id: 'openai' | 'anthropic' | 'gemini' | 'perplexity';
  name: string;
  envKey: string; // for native column
  docsUrl: string;
  /**
   * Third-party vendor identity colour. Deliberately a fixed Tailwind hue and
   * NOT a design token: these belong to the model vendors, so they must stay
   * recognisable and must not re-theme with our white-label brand.
   */
  brandColor: string;
}

export const PROVIDERS: ProviderMeta[] = [
  { id: 'openai', name: 'OpenAI', envKey: 'OPENAI_API_KEY', docsUrl: 'https://platform.openai.com/docs/models', brandColor: 'text-emerald-400' },
  { id: 'anthropic', name: 'Anthropic Claude', envKey: 'ANTHROPIC_API_KEY', docsUrl: 'https://docs.anthropic.com/en/docs/about-claude/models', brandColor: 'text-orange-400' },
  { id: 'gemini', name: 'Google Gemini', envKey: 'GEMINI_API_KEY', docsUrl: 'https://ai.google.dev/gemini-api/docs/models', brandColor: 'text-sky-400' },
  { id: 'perplexity', name: 'Perplexity', envKey: 'PERPLEXITY_API_KEY', docsUrl: 'https://docs.perplexity.ai/guides/model-cards', brandColor: 'text-violet-400' },
];

// =====================================================================
// GATEWAY MODELS (Lovable AI Gateway — uses LOVABLE_API_KEY automatically)
// =====================================================================
const GATEWAY_MODELS: ModelEntry[] = [
  // --- Gemini family
  { id: 'google/gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro (Preview)', provider: 'gemini', route: 'gateway', status: 'preview', releaseTier: 'flagship', capabilities: ['text', 'vision', 'reasoning'], notes: 'Latest preview reasoning model. Recommended primary for high-stakes analysis.' },
  { id: 'google/gemini-3-flash-preview', displayName: 'Gemini 3 Flash (Preview)', provider: 'gemini', route: 'gateway', status: 'preview', releaseTier: 'balanced', capabilities: ['text', 'vision'], notes: 'Default balanced model for most tasks. Fast and capable.' },
  { id: 'google/gemini-3-pro-preview', displayName: 'Gemini 3 Pro (Preview)', provider: 'gemini', route: 'gateway', status: 'deprecated', successor: 'google/gemini-3.1-pro-preview', releaseTier: 'flagship', capabilities: ['text', 'vision', 'reasoning'], notes: 'Superseded by 3.1 Pro. Routing may return 404; prefer the successor.' },
  { id: 'google/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', provider: 'gemini', route: 'gateway', status: 'available', releaseTier: 'flagship', capabilities: ['text', 'vision', 'reasoning'], notes: 'Stable flagship for big context + complex reasoning.' },
  { id: 'google/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', provider: 'gemini', route: 'gateway', status: 'available', releaseTier: 'balanced', capabilities: ['text', 'vision'], notes: 'Cost-efficient stable workhorse.' },
  { id: 'google/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', provider: 'gemini', route: 'gateway', status: 'available', releaseTier: 'fast', capabilities: ['text'], notes: 'Cheapest + fastest of the 2.5 line. Good for classification & summaries.' },
  { id: 'google/gemini-2.5-flash-image', displayName: 'Gemini 2.5 Flash Image (Nano Banana)', provider: 'gemini', route: 'gateway', status: 'available', releaseTier: 'image', capabilities: ['image-gen'] },
  { id: 'google/gemini-3-pro-image-preview', displayName: 'Gemini 3 Pro Image (Preview)', provider: 'gemini', route: 'gateway', status: 'preview', releaseTier: 'image', capabilities: ['image-gen'] },
  { id: 'google/gemini-3.1-flash-image-preview', displayName: 'Gemini 3.1 Flash Image (Nano Banana 2)', provider: 'gemini', route: 'gateway', status: 'preview', releaseTier: 'image', capabilities: ['image-gen', 'image-edit'] },

  // --- OpenAI via gateway
  { id: 'openai/gpt-5', displayName: 'GPT-5', provider: 'openai', route: 'gateway', status: 'available', releaseTier: 'flagship', capabilities: ['text', 'vision', 'reasoning'] },
  { id: 'openai/gpt-5-mini', displayName: 'GPT-5 Mini', provider: 'openai', route: 'gateway', status: 'available', releaseTier: 'balanced', capabilities: ['text', 'vision'] },
  { id: 'openai/gpt-5-nano', displayName: 'GPT-5 Nano', provider: 'openai', route: 'gateway', status: 'available', releaseTier: 'fast', capabilities: ['text'] },
  { id: 'openai/gpt-5.2', displayName: 'GPT-5.2', provider: 'openai', route: 'gateway', status: 'available', releaseTier: 'reasoning', capabilities: ['text', 'reasoning'], notes: 'Latest with enhanced reasoning. Good for complex problem-solving.' },
];

// =====================================================================
// NATIVE MODELS (called directly with our own API keys)
// =====================================================================
const NATIVE_MODELS: ModelEntry[] = [
  // --- OpenAI (direct OPENAI_API_KEY)
  { id: 'gpt-4.1', displayName: 'GPT-4.1', provider: 'openai', route: 'native', status: 'available', releaseTier: 'flagship', capabilities: ['text', 'vision'] },
  { id: 'gpt-4o', displayName: 'GPT-4o', provider: 'openai', route: 'native', status: 'available', releaseTier: 'balanced', capabilities: ['text', 'vision', 'audio'], notes: 'Used in PDF parsing & Formara extraction.' },
  { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini', provider: 'openai', route: 'native', status: 'available', releaseTier: 'fast', capabilities: ['text', 'vision'], notes: 'Used in Email Copilot, transcript cleaning, chart analysis.' },

  // --- Perplexity (direct PERPLEXITY_API_KEY)
  { id: 'sonar-pro', displayName: 'Sonar Pro', provider: 'perplexity', route: 'native', status: 'available', releaseTier: 'search', capabilities: ['text', 'search', 'citations'], notes: 'Powers investment reports & market intelligence with live web search.' },
  { id: 'sonar', displayName: 'Sonar', provider: 'perplexity', route: 'native', status: 'available', releaseTier: 'search', capabilities: ['text', 'search'], notes: 'Lower-cost search-grounded model.' },

  // --- Anthropic (no key configured yet, but listed for awareness)
  { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', provider: 'anthropic', route: 'native', status: 'available', releaseTier: 'flagship', capabilities: ['text', 'vision', 'reasoning'], notes: 'Requires ANTHROPIC_API_KEY to be configured.' },
  { id: 'claude-opus-4-1', displayName: 'Claude Opus 4.1', provider: 'anthropic', route: 'native', status: 'available', releaseTier: 'reasoning', capabilities: ['text', 'vision', 'reasoning'] },
  { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', provider: 'anthropic', route: 'native', status: 'available', releaseTier: 'fast', capabilities: ['text'] },

  // --- Native Gemini (direct GEMINI_API_KEY)
  { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro (Native)', provider: 'gemini', route: 'native', status: 'available', releaseTier: 'flagship', capabilities: ['text', 'vision'], notes: 'Requires GEMINI_API_KEY for direct calls.' },
];

export const ALL_MODELS: ModelEntry[] = [...GATEWAY_MODELS, ...NATIVE_MODELS];

export function modelsByRoute(route: ModelRoute): ModelEntry[] {
  return ALL_MODELS.filter((m) => m.route === route);
}

export function statusBadgeColor(status: ModelStatus): string {
  switch (status) {
    case 'available': return 'bg-success/15 text-success border-success/30';
    case 'preview': return 'bg-info/15 text-info border-info/30';
    case 'deprecated': return 'bg-warning/15 text-warning border-warning/30';
    case 'unavailable': return 'bg-destructive/15 text-destructive border-destructive/30';
  }
}
