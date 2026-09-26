/**
 * Navigation used to be four hand-synchronised lists (desktop sidebar,
 * mobile sidebar, bottom bar, command palette), and the admin group was a
 * second layer of drift: an item could be fully defined and still never
 * render because its title was missing from a separate `itemTitles` list.
 * That silent-gap bug shipped twice.
 *
 * The registry refactor removed the failure mode structurally — items carry
 * their own group, there is no title lookup, and every surface renders from
 * `src/lib/navigation/registry.ts` through the one visibility rule in
 * `useNavigationVisibility`. What this suite pins now is that the structure
 * STAYS that way: no surface may reintroduce a private navigation list, and
 * the registry itself must stay internally coherent.
 *
 * Read as source text rather than imported where the assertion is about the
 * file's shape, matching the repo's contract-test convention.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_NAVIGATION_ITEMS,
  NAVIGATION_GROUP_ORDER,
  NAVIGATION_ITEMS,
} from '@/lib/navigation/registry';
import { AML_NAV_GROUP_TITLE, AML_NAV_ITEM, amlNavEntry } from '@/lib/navigation/amlEntry';
import type { AmlRole } from '@/hooks/useAmlAccess';

const SURFACES = [
  'DashboardSidebar',
  'MobileSidebar',
  'MobileNav',
  'GlobalCommandPalette',
] as const;

describe.each(SURFACES)('%s navigation source', (surface) => {
  const source = readFileSync(`src/components/layout/${surface}.tsx`, 'utf8');

  it('consumes the shared registry visibility rule', () => {
    expect(source).toContain('useNavigationVisibility');
  });

  it('declares no private admin list to drift out of sync', () => {
    expect(source).not.toContain('const adminGroup');
    expect(source).not.toContain('const adminItems');
    expect(source).not.toContain('const navigationItems = [');
  });
});

describe('navigation registry coherence', () => {
  it('renders every admin item it defines — no silent gaps possible', () => {
    // Every admin item is rendered directly from the array; the historical
    // title-lookup indirection no longer exists. Titles must be unique so a
    // rename cannot shadow another entry.
    const titles = ADMIN_NAVIGATION_ITEMS.map((item) => item.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('reaches the Workflow Playground from the registry, not from a private list', () => {
    const titles = ADMIN_NAVIGATION_ITEMS.map((item) => item.title);
    expect(titles).toContain('Workflow Playground');
    /*
     * The Builder / Developer Portal used to be asserted here beside it: it
     * was unlisted-by-design in `MobileSidebar`, and putting it in the
     * registry was what closed that gap.
     *
     * It left the prime in "Phase 7 wave 3 — the builder portal leaves the
     * prime, one way" (d545665), which took the entry out with it. The rule
     * that entry existed to prove is the one still asserted, and it is
     * asserted over the whole registry rather than over one title: every
     * navigation surface reads this array, so nothing can be reachable on the
     * desktop and missing on a phone.
     */
    expect(titles).not.toContain('Builder / Developer Portal');
  });

  it('assigns every main item to a rendered group', () => {
    for (const item of NAVIGATION_ITEMS) {
      expect(NAVIGATION_GROUP_ORDER, item.title).toContain(item.group);
    }
  });

  it('places portal links in their own group between Operations and Help & Usage', () => {
    const portals = ADMIN_NAVIGATION_ITEMS.filter((item) => item.group === 'Portals');
    expect(portals.map((item) => item.title)).toEqual([
      'Finance Portal',
      'Builder Portal',
      'Solicitor Portal',
      'Client Portal',
    ]);
    expect(NAVIGATION_GROUP_ORDER.slice(-3)).toEqual([
      'Operations',
      'Portals',
      'Help & Usage',
    ]);
  });
});

/**
 * AML/CTF Compliance — the module the registry cannot carry.
 *
 * It is gated by the `aml_ctf` feature flag AND an assigned AML role, which
 * is a different question from the module entitlement every other entry is
 * gated by, so it is not in `NAVIGATION_ITEMS`. That is fine. What was not
 * fine is where the decision lived: the desktop sidebar built the entry
 * inline, the command palette built a second copy under a different title
 * and a different group, and the two MOBILE surfaces — which render the
 * registry and nothing else — never had it at all.
 *
 * On a phone the whole module therefore had no door. The route worked if you
 * typed it; there was nothing to tap. It was reported from a phone as "the
 * AML/CTF Compliance page is not populating".
 *
 * This is the same failure this file was written to prevent — a surface with
 * a private navigation list — in the one place the original rule could not
 * see, because the private list was not the registry's.
 */
const AML_NAV_SURFACES = ['DashboardSidebar', 'MobileSidebar', 'GlobalCommandPalette'] as const;

describe.each(AML_NAV_SURFACES)('%s offers the AML/CTF module', (surface) => {
  const source = readFileSync(`src/components/layout/${surface}.tsx`, 'utf8');

  it('asks the one shared entry rather than building its own', () => {
    expect(source).toContain('useAmlNavEntry');
  });

  it('builds no AML navigation item of its own', () => {
    /* Comments are stripped first: these files EXPLAIN the defect, and a
       source scan that trips over its own reasoning is a test about prose. */
    const code = source
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toContain("url: '/admin/aml'");
    expect(code).not.toContain("moduleKey: '__aml__'");
  });
});

describe('MobileNav', () => {
  it('reaches the AML module through the mobile sidebar rather than a copy', () => {
    /* The bottom bar is a deliberate five-item shortlist; everything else is
       behind "More", which mounts `MobileSidebar`. That is the one surface
       allowed not to ask, because the surface it renders does. */
    const source = readFileSync('src/components/layout/MobileNav.tsx', 'utf8');
    expect(source).toContain('MobileSidebar');
    expect(source).not.toContain("'/admin/aml'");
  });
});

describe('the AML entry itself', () => {
  it('is one item, at the module root, in its own group', () => {
    expect(AML_NAV_ITEM.url).toBe('/admin/aml');
    expect(AML_NAV_ITEM.group).toBe(AML_NAV_GROUP_TITLE);
    // Every sub-surface is an in-page tab inside `AmlLayout`, so a group of
    // entries here would be a second navigation for the same pages.
    expect(AML_NAV_ITEM.activePatterns).toEqual(['/admin/aml']);
    // Not hidden from mobile: that default is what this whole suite is about.
    expect(AML_NAV_ITEM.mobile).not.toBe(false);
  });

  it('is not in the shared registry, and does not collide with it', () => {
    expect(NAVIGATION_ITEMS.some((i) => i.url === AML_NAV_ITEM.url)).toBe(false);
    expect(ADMIN_NAVIGATION_ITEMS.some((i) => i.url === AML_NAV_ITEM.url)).toBe(false);
  });

  const access = (over: Partial<Parameters<typeof amlNavEntry>[0]> = {}) => ({
    loading: false,
    flagEnabled: true,
    hasAnyRole: true,
    roles: new Set(['mlro']) as Set<AmlRole>,
    ...over,
  });

  it('is offered to a user with the flag and a role', () => {
    expect(amlNavEntry(access())).toEqual(AML_NAV_ITEM);
  });

  it('fails closed on every reading that is not a clear yes', () => {
    /* A navigation entry is a claim that a page will open. Drawing one the
       guard then refuses is worse than drawing none — including while the
       answer is still on its way. */
    expect(amlNavEntry(access({ loading: true }))).toBeNull();
    expect(amlNavEntry(access({ flagEnabled: false }))).toBeNull();
    expect(amlNavEntry(access({ hasAnyRole: false }))).toBeNull();
    expect(amlNavEntry(access({ roles: new Set() as Set<AmlRole> }))).toBeNull();
  });
});
