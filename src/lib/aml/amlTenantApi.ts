import { invokeAmlFunction } from "./invokeAmlFunction";

export type AmlProviderCapability =
  | "idv" | "pep_sanctions" | "adverse_media" | "transaction_monitoring" | "austrac_lodgement";

export type AmlProviderHealth = "ok" | "degraded" | "failing" | "unknown";

export interface AmlTenantSettings {
  tenant_id: string;
  display_name: string;
  brand_kit_id: string | null;
  plan_tier_key: string;
  terminology_overrides: Record<string, string>;
  contact_email: string | null;
  mlro_contact_name: string | null;
  mlro_contact_email: string | null;
  locale: string;
  timezone: string;
  disposal_grace_days: number;
  support_url: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AmlPlanTier {
  id: string; key: string; label: string; description: string | null;
  entitlements: Record<string, any>;
  monthly_price_cents: number; sort_order: number; active: boolean;
  created_at: string; updated_at: string;
}

export interface AmlEntitlementOverride {
  id: string; tenant_id: string; entitlement_key: string;
  value: any; note: string | null; created_by: string | null;
  created_at: string; updated_at: string;
}

export type AmlProviderMode = "simulator" | "live";

export interface AmlProviderConfig {
  id: string; tenant_id: string; capability: AmlProviderCapability; provider_key: string;
  display_label: string | null; priority: number;
  cost_per_unit_cents: number; currency: string;
  active: boolean; secret_ref: string | null; config: Record<string, any>;
  mode: AmlProviderMode;
  last_health_at: string | null; last_health_status: AmlProviderHealth | null;
  last_health_message: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}

export interface AmlProviderMetricRollup {
  capability: AmlProviderCapability; provider_key: string;
  calls: number; failures: number; failure_rate: number;
  avg_latency_ms: number; cost_cents: number;
}

export interface AmlTenantSummary {
  settings: AmlTenantSettings | null;
  plans: AmlPlanTier[];
  providers: AmlProviderConfig[];
  overrides: AmlEntitlementOverride[];
  metrics_30d: { calls: number; failures: number; cost_cents: number };
  locked_terminology_keys: string[];
  orchestration?: { env_mode: AmlProviderMode; live_active: number; simulator_active: number };
}

export interface AmlActivationProgram {
  legal_approval: boolean;
  program_version: string;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
}

export interface AmlGovernanceContact {
  name: string;
  email: string;
  phone: string;
  title: string;
  notes: string;
}
export type AmlGovernanceContactRole =
  | "compliance_officer"
  | "mlro"
  | "senior_approver"
  | "backup_officer"
  | "austrac_administrator";
export type AmlGovernanceContacts = Record<AmlGovernanceContactRole, AmlGovernanceContact>;

async function invoke<T>(op: string, args: Record<string, any> = {}): Promise<T> {
  return invokeAmlFunction<T>("aml-tenant", { op, ...args });
}


export const amlTenantApi = {
  summary: () => invoke<AmlTenantSummary>("summary"),
  terminology: () =>
    invoke<{ terminology_overrides: Record<string, string> }>("terminology"),
  getSettings: () => invoke<{ settings: AmlTenantSettings | null }>("get_tenant_settings").then((r) => r.settings),
  updateSettings: (patch: Partial<AmlTenantSettings>) =>
    invoke<{ settings: AmlTenantSettings; rejected_terminology_keys?: string[] }>("update_tenant_settings", { patch }),

  /**
   * Phase 3 — Activation program (Model B gate).
   * Stored under `tenant_settings.metadata.aml_activation_program`.
   * Model B activation is BLOCKED unless `legal_approval === true` and
   * `program_version` is a non-empty string. Enforced server-side too.
   */
  getActivationProgram: async () => {
    const s = await invoke<{ settings: AmlTenantSettings | null }>("get_tenant_settings").then((r) => r.settings);
    const p = (s?.metadata as any)?.aml_activation_program ?? {};
    return {
      legal_approval: Boolean(p?.legal_approval),
      program_version: String(p?.program_version ?? ""),
      approved_by: p?.approved_by ?? null,
      approved_at: p?.approved_at ?? null,
      notes: p?.notes ?? null,
    } as AmlActivationProgram;
  },
  updateActivationProgram: async (patch: Partial<AmlActivationProgram>) => {
    const current = await invoke<{ settings: AmlTenantSettings | null }>("get_tenant_settings").then((r) => r.settings);
    const nextProgram = {
      ...((current?.metadata as any)?.aml_activation_program ?? {}),
      ...patch,
    };
    const nextMeta = { ...(current?.metadata ?? {}), aml_activation_program: nextProgram };
    return invoke<{ settings: AmlTenantSettings }>(
      "update_tenant_settings",
      { patch: { metadata: nextMeta } },
    ).then((r) => r.settings);
  },

  /**
   * Phase 9 — Governance & Compliance Leadership Contacts (Directive 14).
   * Stored under `tenant_settings.metadata.aml_governance_contacts`, same
   * additive pattern as the activation program — no schema change required.
   * Roles: compliance_officer, mlro, senior_approver, backup_officer,
   * austrac_administrator.
   */
  getGovernanceContacts: async () => {
    const s = await invoke<{ settings: AmlTenantSettings | null }>("get_tenant_settings").then((r) => r.settings);
    const raw = (s?.metadata as any)?.aml_governance_contacts ?? {};
    const norm = (r: any) => ({
      name: String(r?.name ?? ""),
      email: String(r?.email ?? ""),
      phone: String(r?.phone ?? ""),
      title: String(r?.title ?? ""),
      notes: String(r?.notes ?? ""),
    });
    return {
      compliance_officer: norm(raw.compliance_officer),
      mlro: norm(raw.mlro),
      senior_approver: norm(raw.senior_approver),
      backup_officer: norm(raw.backup_officer),
      austrac_administrator: norm(raw.austrac_administrator),
    } as AmlGovernanceContacts;
  },
  updateGovernanceContacts: async (patch: Partial<AmlGovernanceContacts>) => {
    const current = await invoke<{ settings: AmlTenantSettings | null }>("get_tenant_settings").then((r) => r.settings);
    const prev = (current?.metadata as any)?.aml_governance_contacts ?? {};
    const next = { ...prev, ...patch };
    const nextMeta = { ...(current?.metadata ?? {}), aml_governance_contacts: next };
    return invoke<{ settings: AmlTenantSettings }>(
      "update_tenant_settings",
      { patch: { metadata: nextMeta } },
    ).then((r) => r.settings);
  },

  listPlans: () => invoke<{ plans: AmlPlanTier[] }>("list_plans").then((r) => r.plans),
  upsertPlan: (plan: Partial<AmlPlanTier>) =>
    invoke<{ plan: AmlPlanTier }>("upsert_plan", { plan }).then((r) => r.plan),

  listEntitlements: () =>
    invoke<{ overrides: AmlEntitlementOverride[] }>("list_entitlements").then((r) => r.overrides),
  upsertEntitlementOverride: (override: Partial<AmlEntitlementOverride>) =>
    invoke<{ override: AmlEntitlementOverride }>("upsert_entitlement_override", { override }).then((r) => r.override),
  deleteEntitlementOverride: (id: string) =>
    invoke<{ ok: true }>("delete_entitlement_override", { id }),
  effectiveEntitlements: () =>
    invoke<{ plan_key: string; base: Record<string, any>; overrides: AmlEntitlementOverride[]; effective: Record<string, any> }>(
      "effective_entitlements"),

  listProviders: () =>
    invoke<{ providers: AmlProviderConfig[] }>("list_providers").then((r) => r.providers),
  upsertProvider: (provider: Partial<AmlProviderConfig>) =>
    invoke<{ provider: AmlProviderConfig }>("upsert_provider", { provider }).then((r) => r.provider),
  deleteProvider: (id: string) =>
    invoke<{ ok: true }>("delete_provider", { id }),
  setProviderHealth: (id: string, status: AmlProviderHealth, message?: string) =>
    invoke<{ provider: AmlProviderConfig }>("set_provider_health", { id, status, message }).then((r) => r.provider),

  recordMetric: (args: {
    capability: AmlProviderCapability; provider_key: string;
    calls?: number; failures?: number; latency_ms?: number; cost_cents?: number;
  }) => invoke<{ metric: any }>("record_provider_metric", args),

  metricsRollup: (days = 30, capability?: AmlProviderCapability) =>
    invoke<{ providers: AmlProviderMetricRollup[]; timeline: Array<{ metric_date: string; calls: number; failures: number; cost_cents: number }>; days: number }>(
      "provider_metrics_rollup", { days, capability }),
};

export const AML_PROVIDER_CAPABILITIES: { key: AmlProviderCapability; label: string; suggested: string[] }[] = [
  { key: "idv", label: "Identity Verification", suggested: ["greenid", "frankieone", "onfido", "jumio"] },
  { key: "pep_sanctions", label: "PEP & Sanctions", suggested: ["dowjones", "worldcheck", "comply_advantage"] },
  { key: "adverse_media", label: "Adverse Media", suggested: ["comply_advantage", "lexisnexis"] },
  { key: "transaction_monitoring", label: "Transaction Monitoring", suggested: ["internal_engine", "napier", "actimize"] },
  { key: "austrac_lodgement", label: "AUSTRAC Lodgement", suggested: ["austrac_online", "manual_upload"] },
];
