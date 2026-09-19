// The single canonicalisation boundary for commercial identifiers.
//
// Mission Control, the pricing site, the app's permission keys and this
// prompt's own capability vocabulary all spell the same product differently
// ("market-updates" / "market-news-feed" / "market_updates" /
// "module.market_news_feed"). Aliases are resolved HERE, once, when a
// snapshot is received or a legacy key is looked up. Application code beyond
// this module speaks canonical `CapabilityKey`s only.

import type { CapabilityKey, PlanSlug } from "./types";
import { PLAN_ORDER } from "./types";

/** Plan slugs older Mission Control rows may still carry. The catalogue
 * records the row reuse: the old Professional row became Growth. */
const LEGACY_PLAN_ALIASES: Readonly<Record<string, PlanSlug>> = {
  professional: "growth",
};

export interface CanonicalPlan {
  planSlug: PlanSlug | string;
  /** Add-on slugs implied by the SKU itself (e.g. `launch-with-aml`). */
  impliedAddons: string[];
  /** True when the SKU explicitly excludes AML/CTF. */
  amlExcluded: boolean;
}

/**
 * Canonicalise a plan/SKU slug.
 *
 * Handles the with/without-AML SKU convention (`launch-with-aml`,
 * `growth_without_aml`, …) by decomposing into base tier + implied `aml-ctf`
 * add-on, and maps legacy tier names onto current ones. An unrecognised slug
 * passes through unchanged so diagnostics can show exactly what arrived.
 */
export function canonicalisePlanSlug(raw: string | null | undefined): CanonicalPlan {
  const slug = (raw ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (!slug) return { planSlug: "", impliedAddons: [], amlExcluded: false };

  const withAml = /-with-aml(-ctf)?$/.test(slug);
  const withoutAml = /-without-aml(-ctf)?$/.test(slug);
  const base = slug.replace(/-(with|without)-aml(-ctf)?$/, "");
  const mapped = LEGACY_PLAN_ALIASES[base] ?? base;

  return {
    planSlug: mapped,
    impliedAddons: withAml ? ["aml-ctf"] : [],
    amlExcluded: withoutAml,
  };
}

export function isKnownPlanSlug(slug: string | null | undefined): slug is PlanSlug {
  return !!slug && (PLAN_ORDER as readonly string[]).includes(slug);
}

/**
 * Add-on slug spellings → the canonical pricing-catalogue slug.
 *
 * The right-hand side is always the slug Mission Control's catalogue sells
 * (`aurixa-catalog.ts` in the Mission Control repo). The left-hand side
 * collects every spelling seen in the app, the spec, or historic data.
 */
const ADDON_SLUG_ALIASES: Readonly<Record<string, string>> = {
  // Market News Feed — sold as "market-updates"; the spec names it
  // "market-news-feed"; the app permission key is "market_updates".
  "market-news-feed": "market-updates",
  market_updates: "market-updates",
  "market-news": "market-updates",

  // Commercial & Industrial.
  commercial: "commercial-industrial",
  industrial: "commercial-industrial",
  commercial_industrial: "commercial-industrial",

  // Property Marketplace — the app calls it "listings".
  listings: "opportunity-marketplace",
  "property-marketplace": "opportunity-marketplace",
  property_marketplace: "opportunity-marketplace",

  // Comparisons.
  "generated-report-comparisons": "report-comparisons",
  report_comparisons: "report-comparisons",
  "cash-flow-comparisons": "cashflow-comparisons",
  cashflow_comparisons: "cashflow-comparisons",

  // Deals / pipeline. "deals" is the spec's name for the client-deals
  // add-on; commercially it is sold as the Deal Pipeline module.
  deals: "deal-pipeline",
  deal_pipeline: "deal-pipeline",

  // AML.
  aml: "aml-ctf",
  aml_ctf: "aml-ctf",
  "aml-ctf-compliance": "aml-ctf",

  // Assorted underscore spellings of catalogue slugs.
  email_copilot: "email-copilot",
  call_logs: "call-logs",
  portfolio_reports: "portfolio-analysis",
  portfolio_analysis: "portfolio-analysis",
  send_portfolio: "send-portfolio",
  client_forms: "client-forms",
  borrowing_capacity: "borrowing-capacity",
  client_ai: "client-ai",
  model_hub: "model-hub",
  finance_portal: "finance-portal",
  finance_portal_admin: "finance-portal",
  api_usage: "api-usage",
  marketing_analytics: "marketing",
  intelligence_hub: "intelligence-hub",
  agent: "aurixa-agent",
  aurixa_agent: "aurixa-agent",
};

/** Canonicalise one add-on slug. Unknown slugs pass through lowercased so
 * they stay visible in diagnostics rather than vanishing. */
export function canonicaliseAddonSlug(raw: string): string {
  const slug = raw.trim().toLowerCase().replace(/\s+/g, "-");
  return ADDON_SLUG_ALIASES[slug] ?? ADDON_SLUG_ALIASES[slug.replace(/-/g, "_")] ?? slug;
}

/** Canonicalise and de-duplicate a list of add-on slugs. */
export function canonicaliseAddonSlugs(raw: readonly string[] | null | undefined): string[] {
  if (!raw?.length) return [];
  return [...new Set(raw.map(canonicaliseAddonSlug))].sort();
}

/**
 * Legacy module/permission/sub-module keys → canonical capability keys.
 *
 * This is what lets `ModuleGuard moduleKey="market_updates"` and the old
 * sub-module keys (`generated-reports.comparisons`) resolve through the new
 * registry without rewriting every call site at once.
 */
export const LEGACY_KEY_TO_CAPABILITY: Readonly<Record<string, CapabilityKey>> = {
  // App module keys (routes, sidebar, permissions vocabulary).
  overview: "module.overview",
  calendar: "module.calendar",
  clients: "module.clients",
  client_tracker: "module.client_tracker",
  reminders: "module.reminders",
  checklists: "module.checklists",
  game_plans: "module.game_plan",
  game_plan: "module.game_plan",
  reports: "module.reports",
  generated_reports: "module.generated_reports",
  cash_flow: "module.cashflow",
  report_requests: "module.report_requests",
  user_guide: "module.user_guide",
  billing: "module.billing",
  settings: "module.settings",
  user_management: "module.user_management",
  branding: "module.branding",
  portal_config: "module.client_portal",
  market_updates: "module.market_news_feed",
  "market-updates": "module.market_news_feed",
  "market-news-feed": "module.market_news_feed",
  commercial: "module.commercial_industrial",
  industrial: "module.commercial_industrial",
  "commercial-industrial": "module.commercial_industrial",
  listings: "module.property_marketplace",
  "opportunity-marketplace": "module.property_marketplace",
  deal_pipeline: "module.deal_pipeline",
  "deal-pipeline": "module.deal_pipeline",
  email_copilot: "module.email_copilot",
  "email-copilot": "module.email_copilot",
  call_logs: "module.call_logs",
  "call-logs": "module.call_logs",
  finance_portal_admin: "module.finance_portal",
  "finance-portal": "module.finance_portal",
  agreements: "module.agreements",
  marketing_analytics: "module.marketing",
  marketing: "module.marketing",
  "model-hub": "module.model_hub",
  model_hub: "module.model_hub",
  api_usage: "module.api_usage",
  "api-usage": "module.api_usage",
  integrations: "module.integrations",
  agent: "module.aurixa_agent",
  "aurixa-agent": "module.aurixa_agent",
  "aml-ctf": "module.aml_ctf",
  aml: "module.aml_ctf",
  "intelligence-hub": "module.intelligence_hub",
  intelligence_hub: "module.intelligence_hub",

  // Legacy sub-module keys (SUB_MODULE_ENTITLEMENTS vocabulary).
  "generated-reports.investment": "report.investment",
  "generated-reports.comparisons": "report.comparisons",
  "report-comparisons": "report.comparisons",
  "cash-flow-analysis.10-year-cash-flow": "cashflow.standard",
  "cash-flow-analysis.comparisons": "cashflow.comparisons",
  "cashflow-comparisons": "cashflow.comparisons",
  "clients.overview": "client.overview",
  "clients.personal": "client.personal",
  "clients.properties": "client.properties",
  "clients.deals": "client.deals",
  "clients.employment": "client.employment",
  "clients.financials": "client.financials",
  "clients.reports": "client.reports",
  "clients.sent-reports": "client.sent_reports",
  "clients.requests": "client.requests",
  "clients.emails": "client.emails",
  "clients.conversations": "client.conversations",
  "clients.appointments": "client.appointments",
  "clients.portal-messages": "client.portal_messages",
  "clients.finance-messages": "client.finance_messages",
  "clients.notes": "client.notes",
  "clients.reminders": "client.reminders",
  "clients.client-forms": "client.forms",
  "clients.files": "client.files",
  "clients.activity-documents": "client.activity",
  "clients.review": "client.review",
  "clients.download-client-details-pdf": "client.download_pdf",
  "clients.portal-access": "client.portal_access",
  "clients.view-as-client": "client.view_as_client",
  "clients.send-to-finance": "client.send_to_finance",
  "clients.portfolio-analysis": "client.portfolio_analysis",
  "clients.send-portfolio-to-client": "client.send_portfolio",
  "clients.send-agreement": "client.send_agreement",
  "clients.borrowing-capacity": "client.borrowing_capacity",
  "clients.commercial-industrial": "client.commercial_industrial",
  "clients.lenders": "client.lenders",
  "clients.ai": "client.ai",
};

/** Resolve any known key spelling to a canonical capability key, or null
 * when the key does not describe a commercially gated capability. */
export function toCapabilityKey(key: string | null | undefined): CapabilityKey | null {
  if (!key) return null;
  if (key.startsWith("module.") || key.startsWith("client.") || key.startsWith("report.") || key.startsWith("cashflow.")) {
    return key as CapabilityKey;
  }
  return LEGACY_KEY_TO_CAPABILITY[key] ?? null;
}
