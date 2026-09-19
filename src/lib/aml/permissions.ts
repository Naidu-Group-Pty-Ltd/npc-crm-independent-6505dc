import type { AmlRole } from "@/hooks/useAmlAccess";

/**
 * Phase 2 permission mapping — role → capability.
 *
 * `aml.view`         — any assigned AML role (analyst/reviewer/mlro/auditor)
 * `aml.investigate`  — analyst/reviewer/mlro (write into cases, notes, EDD)
 * `aml.report`       — mlro only (AUSTRAC lodgement, SMR/TTR/IFTI)
 * `aml.configure`    — mlro only (tenant, thresholds, provider keys)
 *
 * Auditor is read-only and never gets investigate/report/configure.
 */
export type AmlCapability = "aml.view" | "aml.investigate" | "aml.report" | "aml.configure";

export function hasAmlCapability(roles: Set<AmlRole>, cap: AmlCapability): boolean {
  if (roles.size === 0) return false;
  switch (cap) {
    case "aml.view":
      return true;
    case "aml.investigate":
      return roles.has("analyst") || roles.has("reviewer") || roles.has("mlro");
    case "aml.report":
      return roles.has("mlro");
    case "aml.configure":
      return roles.has("mlro");
    default:
      return false;
  }
}

/**
 * Restricted routes always require a step-up confirmation.
 * Step-up is a placeholder in Phase 2 (real TOTP / WebAuthn wires in Phase 13).
 */
export const AML_STEP_UP_CAPABILITIES: AmlCapability[] = ["aml.report", "aml.configure"];
