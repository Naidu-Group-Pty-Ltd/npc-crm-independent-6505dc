import { useMemo } from 'react';
import { usePermissions } from './usePermissions';
import { usePlanEntitlements } from './usePlanEntitlements';
import { toCapabilityKey } from '@/lib/entitlements';
import { useCapabilityResolver } from './useCapability';
import type { CapabilityDecision } from '@/lib/entitlements';

/**
 * Convenience hook that returns permission flags for a specific module.
 * Use in pages/components to conditionally show/hide edit/delete UI.
 *
 * Two independent questions have to both say yes:
 *   • does this workspace's PLAN or an active ADD-ON include the module
 *     (the capability resolver), and
 *   • is this USER permitted to use it (usePermissions)?
 *
 * A superadmin bypasses both, as the deployment's operator. The plan check
 * used to bind them too, on the reasoning that a superadmin seeing features
 * nobody else can see is how support tickets get answered with advice that
 * cannot be followed — but the cost landed the other way round: add-on-only
 * modules belong to NO tier, so Email Copilot, Call Logs, Integrations and
 * the agent were shut to every superadmin on every plan, and an operator
 * cannot administer a surface they cannot open. The bypass is reported, not
 * silent: the decision carries `operator_override` as its source and
 * `operatorOnly` when the workspace holds nothing of its own, which is what
 * the guard puts on the page.
 *
 * @example
 * const { canView, canEdit, canDelete } = useModulePermissions('clients');
 * // Then conditionally render buttons based on these flags
 */
export function useModulePermissions(moduleKey: string) {
  const { hasModuleAccess, canEdit, canDelete, isSuperadmin, loading } = usePermissions();
  const { isModuleIncluded, loading: planLoading } = usePlanEntitlements();
  const { resolve } = useCapabilityResolver();

  return useMemo(() => {
    // `isModuleIncluded` answers the pure workspace question and knows
    // nothing about who is asking, so the operator override is applied here —
    // where the two axes already meet — rather than leaking user identity
    // into the workspace-level hook.
    const workspaceHasIt = isModuleIncluded(moduleKey);
    const inPlan = isSuperadmin || workspaceHasIt;
    /** Full decision for the mapped capability — denial screens read this to
     * distinguish "not purchased" from "not permitted". Null when the key is
     * not commercially gated. */
    const decision: CapabilityDecision | null = toCapabilityKey(moduleKey)
      ? resolve(moduleKey)
      : null;
    // The USER-permission axis is evaluated against the capability's own
    // permission key when it declares one (Model Hub rides the
    // `integrations` permission; Report Requests rides `reports`), and the
    // raw module key otherwise — the legacy behaviour.
    const permKey = decision?.permissionKey ?? moduleKey;
    return {
      canView: inPlan && (isSuperadmin || hasModuleAccess(permKey)),
      canEdit: inPlan && (isSuperadmin || canEdit(permKey)),
      canDelete: inPlan && (isSuperadmin || canDelete(permKey)),
      /** False when the plan excludes it — lets callers offer an upgrade.
       * Reports the WORKSPACE's position, not the viewer's: an operator
       * override opens the module without making it bought, and an upsell is
       * still the honest thing to show. */
      includedInPlan: workspaceHasIt,
      decision,
      loading: loading || planLoading,
    };
  }, [moduleKey, isSuperadmin, hasModuleAccess, canEdit, canDelete, loading, isModuleIncluded, planLoading, resolve]);
}
