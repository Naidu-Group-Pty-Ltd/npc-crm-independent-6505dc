// Recommended model upgrades per agent based on its module scope/functionality.
// Used by Model Hub → Agent Bindings to flag deprecated/sub-optimal choices and
// suggest a safer, newer model that matches the agent's job-to-be-done.
//
// Heuristics:
//  • Reasoning / report generation / analysis  → Gemini 2.5 Pro (gateway) or GPT-5
//  • Streaming chat / tool-calling agent       → Gemini 2.5 Flash (gateway) — fast + cheap
//  • Search / market intelligence              → Perplexity sonar-pro (native)
//  • Vision / PDF / chart / document parsing   → google/gemini-2.5-pro (vision) or gpt-4o
//  • Light text cleanup / classification       → google/gemini-2.5-flash-lite or gpt-5-nano
//  • Image generation                          → google/gemini-2.5-flash-image

export type UpgradeRoute = 'gateway' | 'native' | 'openrouter';

export interface UpgradeRecommendation {
  route: UpgradeRoute;
  model_id: string;
  reason: string;
}

// Models we consider deprecated or actively being phased out across the platform.
// Anything in this set will trigger the "deprecated" warning in the Bindings table,
// regardless of the catalog probe status (defence-in-depth).
export const DEPRECATED_MODEL_IDS = new Set<string>([
  'google/gemini-3-pro-preview',          // superseded by 3.1 Pro
  'google/gemini-1.5-pro',                // superseded by 2.5 Pro
  'google/gemini-1.5-flash',              // superseded by 2.5 Flash
  'gpt-4',                                // legacy
  'gpt-4-turbo',                          // legacy
  'gpt-3.5-turbo',                        // legacy
  'openai/gpt-4-turbo',                   // legacy via gateway
  'openai/gpt-3.5-turbo',                 // legacy via gateway
  'claude-3-opus-20240229',               // legacy
  'claude-3-sonnet-20240229',             // legacy
  'claude-3-haiku-20240307',              // legacy
]);

// Per-agent recommendations keyed by `agent_key`.
// When an agent is missing here we fall back to a category-based recommendation.
const AGENT_KEY_RECOMMENDATIONS: Record<string, UpgradeRecommendation> = {
  // ── Voice intelligence
  vapi_call_analysis: {
    route: 'gateway',
    model_id: 'google/gemini-3-flash-preview',
    reason: 'Fast multi-field JSON extraction with strong reasoning — ideal for post-call sentiment + escalation analysis.',
  },
  transcript_cleaning: {
    route: 'gateway',
    model_id: 'google/gemini-2.5-flash-lite',
    reason: 'Cheapest model that still produces clean prose. Used in high-volume voice note polishing.',
  },

  // ── Reports & analysis
  investment_report: {
    route: 'native',
    model_id: 'sonar-pro',
    reason: 'Live web-grounded research with citations is required for investment-grade reports.',
  },
  comparison_report: {
    route: 'gateway',
    model_id: 'google/gemini-2.5-pro',
    reason: 'Stable flagship reasoning + large context for multi-suburb comparisons.',
  },
  suburb_snapshot: {
    route: 'gateway',
    model_id: 'google/gemini-3-flash-preview',
    reason: 'Balanced speed/quality for short snapshot generation.',
  },
  cash_flow_analysis: {
    route: 'gateway',
    model_id: 'google/gemini-2.5-pro',
    reason: 'Numeric reasoning + structured narrative output.',
  },
  portfolio_review: {
    route: 'gateway',
    model_id: 'google/gemini-2.5-pro',
    reason: 'Long context + reasoning for full-portfolio synthesis.',
  },

  // ── Document/vision
  pdf_parsing: {
    route: 'native',
    model_id: 'gpt-4o',
    reason: 'Native vision + structured output is currently the most reliable for PDF extraction.',
  },
  formara_extraction: {
    route: 'native',
    model_id: 'gpt-4o',
    reason: 'Vision-grounded structured extraction — keep on native gpt-4o.',
  },
  chart_analysis: {
    route: 'native',
    model_id: 'gpt-4o-mini',
    reason: 'Vision capable + cheap; sufficient for chart description.',
  },

  // ── Email & comms
  email_copilot: {
    route: 'gateway',
    model_id: 'google/gemini-2.5-flash',
    reason: 'Fast drafting with good tone — reduces cost vs gpt-4o-mini.',
  },

  // ── Search / market intel
  market_intelligence: {
    route: 'native',
    model_id: 'sonar-pro',
    reason: 'Web-grounded answers with citations are mandatory for market intel.',
  },

  // ── Agent / tool-calling
  ai_dashboard_agent: {
    route: 'gateway',
    model_id: 'google/gemini-2.5-flash',
    reason: 'Best balance of latency, tool-calling reliability, and cost for the streaming agent loop.',
  },
  tool_arg_repair: {
    route: 'gateway',
    model_id: 'google/gemini-2.5-flash-lite',
    reason: 'Cheap structural JSON fix-ups — no need for a flagship model.',
  },
  conversation_title: {
    route: 'gateway',
    model_id: 'google/gemini-2.5-flash-lite',
    reason: 'One-shot summarisation; cheapest viable model wins.',
  },

  // ── Image generation
  image_generation: {
    route: 'gateway',
    model_id: 'google/gemini-2.5-flash-image',
    reason: 'Nano Banana — current best price/quality for inline image generation.',
  },
};

// Category-level fallbacks when a specific agent_key isn't mapped above.
const CATEGORY_RECOMMENDATIONS: Record<string, UpgradeRecommendation> = {
  voice_intelligence: {
    route: 'gateway',
    model_id: 'google/gemini-3-flash-preview',
    reason: 'Fast structured extraction for call/transcript analysis.',
  },
  reports: {
    route: 'gateway',
    model_id: 'google/gemini-2.5-pro',
    reason: 'Flagship reasoning + long context for report narratives.',
  },
  documents: {
    route: 'native',
    model_id: 'gpt-4o',
    reason: 'Native vision is currently the most reliable for document/PDF tasks.',
  },
  search: {
    route: 'native',
    model_id: 'sonar-pro',
    reason: 'Citations + live web grounding required for search-style agents.',
  },
  agent: {
    route: 'gateway',
    model_id: 'google/gemini-2.5-flash',
    reason: 'Balanced latency/quality for streaming tool-calling loops.',
  },
  utility: {
    route: 'gateway',
    model_id: 'google/gemini-2.5-flash-lite',
    reason: 'Cheapest viable model for utility/cleanup tasks.',
  },
  imaging: {
    route: 'gateway',
    model_id: 'google/gemini-2.5-flash-image',
    reason: 'Best price/quality image generation currently available via gateway.',
  },
};

export function getRecommendedUpgrade(
  agentKey: string,
  agentCategory: string,
): UpgradeRecommendation | null {
  return (
    AGENT_KEY_RECOMMENDATIONS[agentKey] ??
    CATEGORY_RECOMMENDATIONS[agentCategory] ??
    null
  );
}

export function isModelDeprecated(modelId: string, catalogStatus?: string): boolean {
  if (catalogStatus === 'deprecated') return true;
  return DEPRECATED_MODEL_IDS.has(modelId);
}
