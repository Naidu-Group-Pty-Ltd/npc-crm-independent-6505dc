/**
 * The AML/CTF module has a door on a phone.
 *
 * Reported from a phone: "the AML/CTF Compliance page is not populating."
 * The page was fine. The navigation drawer never offered it — `MobileSidebar`
 * renders the shared registry, and the AML entry is not in the registry
 * because it is gated by the `aml_ctf` flag and an assigned AML role rather
 * than by a module entitlement. The desktop sidebar and the command palette
 * each bolted their own copy on; the two mobile surfaces were never told.
 *
 * These render the real drawer rather than reading its source, because
 * "the entry appears" is the thing that was wrong.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { AmlRole } from '@/hooks/useAmlAccess';

let access = {
  loading: false,
  flagEnabled: true,
  roles: new Set<AmlRole>(['mlro']),
  hasAnyRole: true,
  canWrite: true,
  isMlro: true,
  refresh: vi.fn(),
};
vi.mock('@/hooks/useAmlAccess', () => ({ useAmlAccess: () => access }));

/* The registry's own capability resolver reaches Supabase; the entitlement
   answer is not what these tests are about, so every module is enabled. */
vi.mock('@/hooks/useCapability', () => ({
  useCapabilityResolver: () => ({
    resolve: () => ({ enabled: true, status: 'ready' as const }),
  }),
}));
vi.mock('@/components/branding/BrandAssets', () => ({
  BrandLockup: () => <div data-testid="brand" />,
  BrandLogo: () => <div data-testid="brand-logo" />,
}));

import { MobileSidebar } from '../MobileSidebar';

const mount = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <MobileSidebar />
    </MemoryRouter>,
  );

beforeEach(() => {
  access = {
    loading: false, flagEnabled: true, roles: new Set<AmlRole>(['mlro']),
    hasAnyRole: true, canWrite: true, isMlro: true, refresh: vi.fn(),
  };
});

describe('the mobile navigation drawer', () => {
  it('offers AML/CTF Compliance to a user who has it', () => {
    mount();
    const link = screen.getByRole('link', { name: /AML\/CTF Compliance/i });
    expect(link).toHaveAttribute('href', '/admin/aml');
  });

  it('puts it directly after Main Dashboard, where the desktop sidebar has it', () => {
    /* Position is the point: at the foot of a twelve-entry drawer a
       statutory module reads as an appendix. */
    const { container } = mount();
    const groups = [...container.querySelectorAll('.dashboard-sidebar-group-trigger')]
      .map((el) => el.textContent?.trim());
    expect(groups[0]).toBe('Main Dashboard');
    expect(groups[1]).toBe('AML/CTF Compliance');
  });

  it('marks it active on every AML URL, not only the module root', () => {
    mount('/admin/aml/austrac');
    expect(screen.getByRole('link', { name: /AML\/CTF Compliance/i }))
      .toHaveAttribute('aria-current', 'page');
  });

  it('does not offer it where the module is switched off', () => {
    access = { ...access, flagEnabled: false };
    mount();
    expect(screen.queryByRole('link', { name: /AML\/CTF Compliance/i })).toBeNull();
  });

  it('does not offer it to a user with no AML role', () => {
    access = { ...access, roles: new Set<AmlRole>(), hasAnyRole: false };
    mount();
    expect(screen.queryByRole('link', { name: /AML\/CTF Compliance/i })).toBeNull();
  });

  it('offers nothing while the answer is still on its way', () => {
    access = { ...access, loading: true };
    mount();
    expect(screen.queryByRole('link', { name: /AML\/CTF Compliance/i })).toBeNull();
    // …and the rest of the drawer is unaffected: a slow AML answer must not
    // hold up the navigation around it.
    expect(screen.getByRole('link', { name: /Overview/i })).toBeInTheDocument();
  });

  it('still draws every other group', () => {
    /* The regression this could cause: an entry inserted into the map that
       renders the groups swallows or reorders the groups themselves. */
    const { container } = mount();
    const groups = [...container.querySelectorAll('.dashboard-sidebar-group-trigger')]
      .map((el) => el.textContent?.trim());
    expect(groups).toContain('Reports & Analysis');
    expect(new Set(groups).size).toBe(groups.length);
  });
});
