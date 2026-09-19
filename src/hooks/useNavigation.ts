import { useMemo } from 'react';
import {
  ADMIN_NAVIGATION_ITEMS,
  NAVIGATION_ITEMS,
  type NavItemDef,
} from '@/lib/navigation/registry';
import { isClientFacingDeployment, isPathVisibleInDeployment } from '@/lib/clientFacing';
import { useCapabilityResolver } from './useCapability';

/**
 * The one visibility rule for navigation, shared by the desktop sidebar,
 * mobile sidebar, bottom bar and command palette.
 *
 * An item is visible when its capability decision is enabled. While the
 * decision is still loading, MAIN navigation stays visible (no flash of an
 * emptied sidebar at startup) and ADMIN navigation stays hidden (fail closed
 * — matching the pre-registry behaviour). Excluded premium modules are
 * REMOVED, not rendered disabled.
 *
 * A client-facing deployment additionally removes developer/operator tooling
 * by the item's URL — the same list ClientFacingGate refuses to route to, so
 * the two cannot disagree.
 */
export function useNavigationVisibility() {
  const { resolve } = useCapabilityResolver();
  const clientFacing = isClientFacingDeployment();

  return useMemo(() => {
    const isNavItemVisible = (item: NavItemDef): boolean => {
      if (!isPathVisibleInDeployment(item.url, clientFacing)) return false;
      const decision = resolve(item.moduleKey);
      return decision.enabled || decision.status === 'loading';
    };
    const isAdminItemVisible = (item: NavItemDef): boolean =>
      isPathVisibleInDeployment(item.url, clientFacing) && resolve(item.moduleKey).enabled;

    return {
      isNavItemVisible,
      isAdminItemVisible,
      visibleNavItems: NAVIGATION_ITEMS.filter((i) => !i.paletteOnly && isNavItemVisible(i)),
      visibleAdminItems: ADMIN_NAVIGATION_ITEMS.filter(
        (i) => !i.paletteOnly && isAdminItemVisible(i),
      ),
      paletteNavItems: NAVIGATION_ITEMS.filter(isNavItemVisible),
      paletteAdminItems: ADMIN_NAVIGATION_ITEMS.filter(isAdminItemVisible),
    };
  }, [resolve, clientFacing]);
}
