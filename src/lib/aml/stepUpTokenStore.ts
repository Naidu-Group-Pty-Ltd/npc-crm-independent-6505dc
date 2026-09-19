/**
 * Phase 13 — Client-side lookup for active step-up session tokens.
 *
 * Tokens are intentionally retained only in memory. AmlGuard may persist
 * non-secret expiry metadata for the current tab, but bearer credentials must
 * never be written to Web Storage where same-origin scripts can recover them.
 */
import type { AmlCapability } from "./permissions";

interface ActiveStepUp {
  session_token: string;
  expires_at: string;
}

const activeStepUps = new Map<AmlCapability, ActiveStepUp>();

export function setStepUpToken(capability: AmlCapability, session: ActiveStepUp): void {
  activeStepUps.set(capability, session);
}

export function getStepUpToken(capability: AmlCapability): string | null {
  const session = activeStepUps.get(capability);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    activeStepUps.delete(capability);
    return null;
  }
  return session.session_token;
}

/**
 * Map of `${functionName}:${op}` → required capability. Only these ops attach
 * a step-up token; regular reads are unaffected.
 */
const RESTRICTED_OPS: Record<string, AmlCapability> = {
  // AUSTRAC lodgement + sign-off — aml.report
  "aml-reporting:submit_record": "aml.report",
  "aml-reporting:mlro_signoff": "aml.report",
  "aml-reporting:mlro_reject": "aml.report",
  "aml-reporting:withdraw_report": "aml.report",
  "aml-reporting:record_receipt": "aml.report",
  "aml-reporting:delete_report": "aml.report",
  // Tenant / plan / provider config — aml.configure
  "aml-tenant:update_tenant_settings": "aml.configure",
  "aml-tenant:upsert_plan": "aml.configure",
  "aml-tenant:upsert_provider": "aml.configure",
  "aml-tenant:delete_provider": "aml.configure",
  "aml-tenant:set_provider_health": "aml.configure",
  "aml-tenant:upsert_entitlement_override": "aml.configure",
  "aml-tenant:delete_entitlement_override": "aml.configure",
  // Launch certifications (Phase 15)
  "aml-launch-ops:certify_launch": "aml.configure",
  "aml-launch-ops:revoke_certification": "aml.configure",
};

export function requiredCapabilityFor(functionName: string, op: string | undefined): AmlCapability | null {
  if (!op) return null;
  return RESTRICTED_OPS[`${functionName}:${op}`] ?? null;
}
