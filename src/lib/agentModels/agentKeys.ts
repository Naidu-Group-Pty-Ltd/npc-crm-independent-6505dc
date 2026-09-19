/**
 * Central registry of agent keys used across the app UI.
 *
 * Anywhere the front-end displays which AI model powers a feature, we look
 * up the assignment by one of these keys via `useAgentModels()`. The
 * canonical source of truth remains the `agent_model_assignments` table —
 * this file only enumerates the keys and their user-facing metadata so we
 * can render a live badge without hardcoding a specific model string.
 *
 * NOTE: adding a new agent surface here does NOT create a DB row. Insert
 * or seed the row in `agent_model_assignments` via the Model Hub or a
 * migration; this catalog just tells the UI how to label the slot.
 */

export type AgentSlot = {
  /** Primary key used to look up the assignment in agent_model_assignments. */
  key: string;
  /** Short human label for the slot ("Primary", "Fast", "Deep", "Search"). */
  slotLabel: string;
  /** Short blurb shown in tooltips/upgrade menus. */
  slotDescription?: string;
};

export type AgentSurface = {
  /** Stable id used by hooks / components (e.g. "report_qa"). */
  id: string;
  /** Display name shown in headers/badges ("Report Q&A"). */
  label: string;
  /** Category matches agent_model_assignments.agent_category. */
  category: 'agent' | 'extraction' | 'marketing' | 'reports' | 'other';
  /** One or more slots; single-slot surfaces still use this array. */
  slots: AgentSlot[];
};

/**
 * Registry of every UI surface that displays a live model chip.
 *
 * Keep this list in sync with docs/model-hub-frontend-surfaces.md.
 * The `key` on each slot MUST exist in `agent_model_assignments` — if it
 * does not, the hook falls back gracefully to "Unassigned".
 */
export const AGENT_SURFACES = {
  reportQa: {
    id: 'report_qa',
    label: 'Aurixa Intelligence Hub',
    category: 'agent',
    slots: [
      { key: 'report_qa', slotLabel: 'Primary', slotDescription: 'Default model for grounded Q&A over reports.' },
      { key: 'report_qa_fast', slotLabel: 'Fast', slotDescription: 'Low-latency responses for quick lookups.' },
      { key: 'report_qa_deep', slotLabel: 'Deep', slotDescription: 'High-reasoning model for complex analysis.' },
      { key: 'report_qa_search', slotLabel: 'Search', slotDescription: 'Retrieval-tuned model for citation-heavy queries.' },
    ],
  },
  aurixaAgent: {
    id: 'dashboard_agent',
    label: 'Aurixa Agent',
    category: 'agent',
    slots: [{ key: 'dashboard_agent', slotLabel: 'Primary' }],
  },
  agentTaskRunner: {
    id: 'agent_task_runner',
    label: 'Scheduled Task Runner',
    category: 'agent',
    slots: [{ key: 'agent_task_runner', slotLabel: 'Primary' }],
  },
  bcScenario: {
    id: 'bc_scenario_agent',
    label: 'Borrowing Capacity What-If',
    category: 'agent',
    slots: [{ key: 'bc_scenario_agent', slotLabel: 'Primary' }],
  },
  emailCopilot: {
    id: 'email_copilot',
    label: 'Email Copilot',
    category: 'agent',
    slots: [{ key: 'email_copilot', slotLabel: 'Primary' }],
  },
  userGuide: {
    id: 'user_guide_assistant',
    label: 'User Guide Assistant',
    category: 'agent',
    slots: [{ key: 'user_guide_assistant', slotLabel: 'Primary' }],
  },
  marketQa: {
    id: 'market_qa',
    label: 'Market News Feed Q&A',
    category: 'marketing',
    slots: [{ key: 'market_qa', slotLabel: 'Primary' }],
  },
  marketDigest: {
    id: 'market_digest',
    label: 'Market Digest',
    category: 'marketing',
    slots: [{ key: 'market_digest', slotLabel: 'Primary' }],
  },
  metaAdsAnalysis: {
    id: 'meta_ads_analysis',
    label: 'Meta Ads Analysis',
    category: 'marketing',
    slots: [{ key: 'meta_ads_analysis', slotLabel: 'Primary' }],
  },
  metaAdsDigest: {
    id: 'meta_ads_digest',
    label: 'Meta Ads Daily Digest',
    category: 'marketing',
    slots: [{ key: 'meta_ads_digest', slotLabel: 'Primary' }],
  },
  metaAdsForecast: {
    id: 'meta_ads_forecast',
    label: 'Meta Ads Forecast',
    category: 'marketing',
    slots: [{ key: 'meta_ads_forecast', slotLabel: 'Primary' }],
  },
  metaAdsLeadQuality: {
    id: 'meta_ads_lead_quality',
    label: 'Meta Ads Lead Quality',
    category: 'marketing',
    slots: [{ key: 'meta_ads_lead_quality', slotLabel: 'Primary' }],
  },
  pdfPropertyExtraction: {
    id: 'pdf_property_extraction',
    label: 'PDF Property Extraction',
    category: 'extraction',
    slots: [{ key: 'pdf_property_extraction', slotLabel: 'Primary' }],
  },
  pdfFormaraExtraction: {
    id: 'pdf_formara_extraction',
    label: 'Formara PDF Extraction',
    category: 'extraction',
    slots: [{ key: 'pdf_formara_extraction', slotLabel: 'Primary' }],
  },
  transcriptCleaning: {
    id: 'transcript_cleaning',
    label: 'Call Transcript Cleaner',
    category: 'extraction',
    slots: [{ key: 'transcript_cleaning', slotLabel: 'Primary' }],
  },
  vapiCallSummary: {
    id: 'vapi_call_summary',
    label: 'Call Summary Generator',
    category: 'extraction',
    slots: [{ key: 'vapi_call_summary', slotLabel: 'Primary' }],
  },
  chartImageGeneration: {
    id: 'chart_image_generation',
    label: 'Chart Image Generator',
    category: 'extraction',
    slots: [{ key: 'chart_image_generation', slotLabel: 'Primary' }],
  },
  expenseEstimation: {
    id: 'expense_estimation',
    label: 'Property Expense Estimator',
    category: 'extraction',
    slots: [{ key: 'expense_estimation', slotLabel: 'Primary' }],
  },
  listingScrape: {
    id: 'listing_scrape',
    label: 'Property Listing Scraper',
    category: 'extraction',
    slots: [{ key: 'listing_scrape', slotLabel: 'Primary' }],
  },
  rbaDataService: {
    id: 'rba_data_service',
    label: 'RBA Data Interpreter',
    category: 'extraction',
    slots: [{ key: 'rba_data_service', slotLabel: 'Primary' }],
  },
  templateRetrieval: {
    id: 'template_retrieval',
    label: 'Template Context Retrieval',
    category: 'extraction',
    slots: [{ key: 'template_retrieval', slotLabel: 'Primary' }],
  },
  templateParsing: {
    id: 'template_parsing',
    label: 'Template Document Parsing',
    category: 'extraction',
    slots: [{ key: 'template_parsing', slotLabel: 'Primary' }],
  },
} as const satisfies Record<string, AgentSurface>;

export type AgentSurfaceId = keyof typeof AGENT_SURFACES;

/** Flat list of every agent_key the UI references. */
export const ALL_AGENT_KEYS: string[] = Array.from(
  new Set(
    Object.values(AGENT_SURFACES).flatMap((surface) =>
      surface.slots.map((slot) => slot.key),
    ),
  ),
);

/** Reverse lookup: agent_key → { surface, slot }. */
export function findSurfaceByKey(agentKey: string):
  | { surface: AgentSurface; slot: AgentSlot }
  | null {
  for (const surface of Object.values(AGENT_SURFACES)) {
    const slot = surface.slots.find((s) => s.key === agentKey);
    if (slot) return { surface, slot };
  }
  return null;
}
