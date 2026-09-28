import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Builder Portal entry needs the Listings module AND the server-read
 * `builder_stock_marketplace` flag (docs/builder-portal/52). Every surface
 * reads navigation through `useNavigationVisibility`, so asserting it there
 * covers the sidebars, the bottom bar and the palette at once. The flag is
 * presentation only: the server refuses the page's calls while it is off.
 */
const flag = { loading: false, enabled: false };
vi.mock('@/hooks/useBuilderStockMarketplaceFlag', () => ({ useBuilderStockMarketplaceFlag: () => flag }));
vi.mock('@/hooks/useCapability', () => ({
  useCapabilityResolver: () => ({ resolve: () => ({ enabled: true, status: 'enabled' }) }),
}));

import { useNavigationVisibility } from '../useNavigation';

const titles = () => {
  const { result } = renderHook(() => useNavigationVisibility());
  return {
    sidebar: result.current.visibleAdminItems.map((i) => i.title),
    palette: result.current.paletteAdminItems.map((i) => i.title),
  };
};

describe('the Builder Portal entry follows the builder stock flag', () => {
  beforeEach(() => { flag.loading = false; flag.enabled = false; });

  it('is not drawn while the flag is off', () => {
    const { sidebar, palette } = titles();
    expect(sidebar).not.toContain('Builder Portal');
    expect(palette).not.toContain('Builder Portal');
    expect(sidebar).toContain('Solicitor Portal');
  });

  it('is not drawn while the flag is still being read', () => {
    flag.loading = true;
    expect(titles().sidebar).not.toContain('Builder Portal');
  });

  it('is drawn once the server says the flag is on', () => {
    flag.enabled = true;
    const { sidebar, palette } = titles();
    expect(sidebar).toContain('Builder Portal');
    expect(palette).toContain('Builder Portal');
  });
});
