export type AmlStepUpCapability = "aml.view" | "aml.investigate" | "aml.report" | "aml.configure";

const CAPABILITY_ROLES: Record<AmlStepUpCapability, ReadonlySet<string>> = {
  "aml.view": new Set(["analyst", "reviewer", "mlro", "auditor"]),
  "aml.investigate": new Set(["analyst", "reviewer", "mlro"]),
  "aml.report": new Set(["mlro"]),
  "aml.configure": new Set(["mlro"]),
};

export const STEP_UP_CAPABILITIES: ReadonlySet<string> = new Set<AmlStepUpCapability>(
  Object.keys(CAPABILITY_ROLES) as AmlStepUpCapability[],
);

export function canUseAmlCapability(
  roles: Iterable<string>,
  capability: string,
  isSuperadmin = false,
): capability is AmlStepUpCapability {
  if (isSuperadmin) return STEP_UP_CAPABILITIES.has(capability as AmlStepUpCapability);
  const allowedRoles = CAPABILITY_ROLES[capability as AmlStepUpCapability];
  return Boolean(allowedRoles && Array.from(roles).some((role) => allowedRoles.has(role)));
}
