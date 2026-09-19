// The canonical capability registry — one table describing every
// commercially gated capability, what includes it, and what unlocks it.
//
// COMMERCIAL RULES (the two that anchor the whole model):
//
//   Market News Feed:          Scale, OR an active add-on.
//   Commercial & Industrial:   Scale, OR an active add-on.
//
// Note on Market News Feed: the transcribed pricing sheet in Mission
// Control's catalogue previously listed `market-updates` as included from
// Growth. The signed-off commercial rules place it in Scale only, with an
// independently purchasable add-on for Launch and Growth. This registry, the
// Mission Control catalogue and the pricing site were aligned to Scale-only
// in the same change — see docs/entitlements/ARCHITECTURE.md for the record
// of that decision.
//
// AML/CTF is deliberately in NO tier list here: entitlement comes from the
// purchased SKU (Mission Control normalises with-AML SKUs into the `aml-ctf`
// add-on slug) — never from tier membership alone.
//
// Add-on slugs are canonical catalogue slugs (aliases.ts translates every
// other spelling before lookup).

import type { CapabilityDefinition, CapabilityKey, PlanSlug } from "./types";

const ALL_PLANS: readonly PlanSlug[] = ["launch", "growth", "scale"];
const GROWTH_UP: readonly PlanSlug[] = ["growth", "scale"];
const SCALE_ONLY: readonly PlanSlug[] = ["scale"];
const ADDON_ONLY: readonly PlanSlug[] = [];

export const CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  // ── Core modules: part of every active subscription ─────────────────
  { key: "module.overview", label: "Overview", includedInPlans: ALL_PLANS },
  { key: "module.calendar", label: "Calendar", includedInPlans: ALL_PLANS, permissionKey: "calendar" },
  { key: "module.clients", label: "Clients", includedInPlans: ALL_PLANS, permissionKey: "clients" },
  { key: "module.client_tracker", label: "Client Tracker", includedInPlans: ALL_PLANS, permissionKey: "client_tracker" },
  { key: "module.reminders", label: "Reminders", includedInPlans: ALL_PLANS, permissionKey: "reminders" },
  { key: "module.checklists", label: "Checklists", includedInPlans: ALL_PLANS, permissionKey: "checklists" },
  { key: "module.game_plan", label: "Game Plan", includedInPlans: ALL_PLANS, permissionKey: "game_plans" },
  { key: "module.reports", label: "Reports", includedInPlans: ALL_PLANS, permissionKey: "reports" },
  { key: "module.generated_reports", label: "Generated Reports", includedInPlans: ALL_PLANS, permissionKey: "generated_reports" },
  { key: "module.cashflow", label: "Cash Flow Analysis", includedInPlans: ALL_PLANS, permissionKey: "cash_flow" },
  { key: "module.report_requests", label: "Report Requests", includedInPlans: ALL_PLANS, permissionKey: "reports" },
  { key: "module.user_guide", label: "User Guide", includedInPlans: ALL_PLANS },
  { key: "module.billing", label: "Billing & Usage", includedInPlans: ALL_PLANS },
  { key: "module.settings", label: "Settings", includedInPlans: ALL_PLANS, permissionKey: "settings" },
  { key: "module.user_management", label: "User Management", includedInPlans: ALL_PLANS, permissionKey: "user_management" },
  { key: "module.branding", label: "Branding", includedInPlans: ALL_PLANS, permissionKey: "white_label" },
  { key: "module.client_portal", label: "Client Portal", includedInPlans: ALL_PLANS, permissionKey: "portal_config" },

  // ── Premium modules ─────────────────────────────────────────────────
  {
    key: "module.market_news_feed",
    label: "Market News Feed",
    description: "Curated market developments, digests, and the news archive.",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["market-updates"],
    aliases: ["market_updates", "market-news-feed"],
  },
  {
    key: "module.commercial_industrial",
    label: "Commercial & Industrial",
    description: "Commercial and industrial assessments, calculators and property records.",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["commercial-industrial"],
    aliases: ["commercial", "industrial"],
  },
  {
    key: "module.property_marketplace",
    label: "Property Marketplace",
    description: "The property listings intake and marketplace intelligence.",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["opportunity-marketplace"],
    permissionKey: "listings",
    aliases: ["listings"],
  },
  {
    key: "module.deal_pipeline",
    label: "Deal Pipeline",
    includedInPlans: GROWTH_UP,
    addonSlugs: ["deal-pipeline"],
    permissionKey: "deal_pipeline",
  },
  {
    key: "module.intelligence_hub",
    label: "Aurixa Intelligence Hub",
    includedInPlans: ADDON_ONLY,
    addonSlugs: ["intelligence-hub"],
  },
  {
    key: "module.email_copilot",
    label: "Email Copilot",
    includedInPlans: ADDON_ONLY,
    addonSlugs: ["email-copilot"],
    permissionKey: "email_copilot",
  },
  {
    key: "module.call_logs",
    label: "Call Logs",
    includedInPlans: ADDON_ONLY,
    addonSlugs: ["call-logs"],
    permissionKey: "call_logs",
  },
  {
    key: "module.finance_portal",
    label: "Finance Portal",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["finance-portal"],
    permissionKey: "finance_portal_admin",
  },
  {
    key: "module.agreements",
    label: "Agreements",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["agreements"],
    permissionKey: "agreements",
  },
  {
    key: "module.marketing",
    label: "Marketing",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["marketing"],
    permissionKey: "marketing_analytics",
  },
  {
    key: "module.model_hub",
    label: "Model Hub",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["model-hub"],
    permissionKey: "integrations",
  },
  {
    key: "module.api_usage",
    label: "API Usage",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["api-usage"],
    permissionKey: "api_usage",
  },
  {
    key: "module.integrations",
    label: "Integrations",
    includedInPlans: ADDON_ONLY,
    addonSlugs: ["integrations"],
    permissionKey: "integrations",
  },
  {
    key: "module.aurixa_agent",
    label: "Aurixa Agent",
    includedInPlans: ADDON_ONLY,
    addonSlugs: ["aurixa-agent"],
    permissionKey: "agent",
  },
  {
    key: "module.aml_ctf",
    label: "AML / CTF Compliance",
    description:
      "Entitled by the purchased SKU (with-AML tiers) or a standalone add-on — never by tier membership alone.",
    includedInPlans: ADDON_ONLY,
    addonSlugs: ["aml-ctf"],
  },

  // ── Reports & cash-flow sub-capabilities ────────────────────────────
  {
    key: "report.investment",
    label: "Investment Reports",
    includedInPlans: ALL_PLANS,
    parentCapability: "module.generated_reports",
  },
  {
    key: "report.comparisons",
    label: "Generated Report Comparisons",
    includedInPlans: GROWTH_UP,
    addonSlugs: ["report-comparisons"],
    parentCapability: "module.generated_reports",
  },
  {
    key: "cashflow.standard",
    label: "10-Year Cash Flow Analysis",
    includedInPlans: ALL_PLANS,
    parentCapability: "module.cashflow",
  },
  {
    key: "cashflow.comparisons",
    label: "Cash Flow Comparisons",
    includedInPlans: GROWTH_UP,
    addonSlugs: ["cashflow-comparisons"],
    parentCapability: "module.cashflow",
  },

  // ── Client workspace tabs ───────────────────────────────────────────
  { key: "client.overview", label: "Client Overview", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  { key: "client.personal", label: "Personal", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  { key: "client.properties", label: "Properties", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  {
    key: "client.deals",
    label: "Client Deals",
    includedInPlans: GROWTH_UP,
    // "deals" (the spec's slug) and "deal-pipeline" (the catalogue SKU that
    // sells the deals experience) both canonicalise to deal-pipeline.
    addonSlugs: ["deal-pipeline"],
    parentCapability: "module.clients",
  },
  { key: "client.employment", label: "Employment", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  { key: "client.financials", label: "Financials", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  { key: "client.reports", label: "Client Reports", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  { key: "client.sent_reports", label: "Sent Reports", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  { key: "client.requests", label: "Client Requests", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  {
    key: "client.emails",
    label: "Client Emails",
    includedInPlans: ADDON_ONLY,
    addonSlugs: ["email-copilot"],
    parentCapability: "module.clients",
  },
  { key: "client.conversations", label: "Conversations", includedInPlans: SCALE_ONLY, parentCapability: "module.clients" },
  { key: "client.appointments", label: "Appointments", includedInPlans: SCALE_ONLY, parentCapability: "module.clients" },
  { key: "client.portal_messages", label: "Portal Messages", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  {
    key: "client.finance_messages",
    label: "Finance Messages",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["finance-portal"],
    parentCapability: "module.clients",
  },
  { key: "client.notes", label: "Notes", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  { key: "client.reminders", label: "Client Reminders", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  {
    key: "client.forms",
    label: "Client Forms",
    includedInPlans: ALL_PLANS,
    addonSlugs: ["client-forms"],
    parentCapability: "module.clients",
  },
  { key: "client.files", label: "Files", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  { key: "client.activity", label: "Activity & Documents", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },

  // ── Client workspace actions ────────────────────────────────────────
  { key: "client.review", label: "Client Review", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  { key: "client.download_pdf", label: "Download Client Details PDF", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  { key: "client.portal_access", label: "Portal Access", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  { key: "client.view_as_client", label: "View as Client", includedInPlans: ALL_PLANS, parentCapability: "module.clients" },
  {
    key: "client.send_to_finance",
    label: "Send To Finance",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["finance-portal"],
    parentCapability: "module.clients",
  },
  {
    key: "client.portfolio_analysis",
    label: "Portfolio Analysis",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["portfolio-analysis"],
    parentCapability: "module.clients",
  },
  {
    key: "client.send_portfolio",
    label: "Send Portfolio To Client",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["send-portfolio"],
    parentCapability: "module.clients",
  },
  {
    key: "client.send_agreement",
    label: "Send Agreement",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["agreements"],
    parentCapability: "module.clients",
  },
  {
    key: "client.borrowing_capacity",
    label: "Borrowing Capacity",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["borrowing-capacity"],
    parentCapability: "module.clients",
  },
  {
    // The client-profile view of the Commercial & Industrial module: linked
    // assessments, calculation runs and generated capacity reports. Gated by
    // the same plan/add-on as the module itself, so the tab appears exactly
    // where the workspace can use what it shows.
    key: "client.commercial_industrial",
    label: "Commercial / Industrial",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["commercial-industrial"],
    parentCapability: "module.clients",
  },
  {
    key: "client.lenders",
    label: "Lenders",
    includedInPlans: ADDON_ONLY,
    addonSlugs: ["lenders"],
    parentCapability: "module.clients",
    productStatus: "coming_soon",
  },
  {
    key: "client.ai",
    label: "Client AI",
    includedInPlans: SCALE_ONLY,
    addonSlugs: ["client-ai"],
    parentCapability: "module.clients",
  },
];

const BY_KEY = new Map<CapabilityKey, CapabilityDefinition>(
  CAPABILITY_DEFINITIONS.map((d) => [d.key, d]),
);

export function getCapabilityDefinition(key: CapabilityKey): CapabilityDefinition | undefined {
  return BY_KEY.get(key);
}

export function allCapabilityKeys(): CapabilityKey[] {
  return CAPABILITY_DEFINITIONS.map((d) => d.key);
}

/** The cheapest tier that includes a capability, for denial screens. */
export function cheapestIncludingPlan(def: CapabilityDefinition): PlanSlug | undefined {
  for (const plan of ["launch", "growth", "scale"] as const) {
    if (def.includedInPlans.includes(plan)) return plan;
  }
  return undefined;
}
