/**
 * The guide is part of the product surface, so it is gated like the product.
 *
 * A Launch clone reading the Finance Portal guide is not just noise — someone
 * follows a walkthrough for a screen that is not in their sidebar, concludes
 * the product is broken, and raises a ticket. These tests pin both directions:
 * what must be hidden, and just as importantly what must never be.
 */

import { describe, it, expect } from 'vitest';
import {
  isSectionEntitled,
  filterEntitledSections,
  lockedSections,
  SECTION_MODULE_SLUGS,
  SECTION_PROXY_MODULES,
} from '../userGuideEntitlements';
import { userGuideKnowledge, formatKnowledgeBaseForAI } from '../userGuideKnowledge';
import { MODULE_TIERS } from '../pricing/planEntitlements';

const ids = () => userGuideKnowledge.map((s) => s.id);
const visibleOn = (planSlug: string | null, addonSlugs?: string[]) =>
  filterEntitledSections(userGuideKnowledge, { planSlug, addonSlugs }).map((s) => s.id);

describe('tier gating', () => {
  it('hides Scale-only guides from a Launch workspace', () => {
    const launch = visibleOn('launch');
    expect(launch).not.toContain('finance-portal');
    expect(launch).not.toContain('commercial-industrial');
    expect(launch).not.toContain('model-hub');
    expect(launch).not.toContain('marketing-analytics');
  });

  it('hides Growth-only guides from a Launch workspace', () => {
    expect(visibleOn('launch')).not.toContain('market-updates');
    expect(visibleOn('launch')).not.toContain('deal-pipeline');
  });

  it('shows Growth guides on Growth but still hides Scale ones', () => {
    const growth = visibleOn('growth');
    expect(growth).toContain('deal-pipeline');
    expect(growth).not.toContain('finance-portal');
    expect(growth).not.toContain('model-hub');
    // Market News Feed is Scale-bundled or an add-on — a Growth workspace
    // sees its guide only after buying it.
    expect(visibleOn('growth', [])).not.toContain('market-updates');
    expect(visibleOn('growth', ['market-updates'])).toContain('market-updates');
  });

  it('shows everything tier-gated on Scale', () => {
    const scale = visibleOn('scale');
    for (const id of ['finance-portal', 'model-hub', 'commercial-industrial', 'market-updates']) {
      expect(scale, `${id} should be visible on Scale`).toContain(id);
    }
  });

  it('is monotonic — a higher tier never sees fewer guides', () => {
    expect(visibleOn('growth').length).toBeGreaterThanOrEqual(visibleOn('launch').length);
    expect(visibleOn('scale').length).toBeGreaterThanOrEqual(visibleOn('growth').length);
  });
});

describe('universal sections', () => {
  it('keeps platform basics on every plan', () => {
    // Hiding "how do I log in" from a paying customer would be absurd.
    for (const plan of ['launch', 'growth', 'scale']) {
      const v = visibleOn(plan);
      for (const id of [
        'getting-started',
        'settings',
        'notifications',
        'troubleshooting',
        'keyboard-shortcuts',
        'client-management',
      ]) {
        expect(v, `${id} hidden on ${plan}`).toContain(id);
      }
    }
  });

  it('shows AML when the SKU carries it — entitlement follows the purchase, not the tier', () => {
    // Mission Control states aml-ctf for every headline SKU, so the normal
    // Launch workspace sees the guide; a without-AML SKU (no slug) does not.
    expect(visibleOn('launch', ['aml-ctf'])).toContain('aml-ctf');
    expect(visibleOn('launch', [])).not.toContain('aml-ctf');
  });

  it('treats an unmapped section as universal', () => {
    // Absence from the map means "always show", so a newly added section is
    // visible by default and hiding it takes a deliberate act.
    expect(isSectionEntitled('some-brand-new-section', { planSlug: 'launch' })).toBe(true);
  });
});

describe('unknown plan gates open', () => {
  it('shows every section when the plan is unknown or still loading', () => {
    for (const plan of [null, undefined, 'enterprise']) {
      expect(visibleOn(plan as string | null)).toHaveLength(ids().length);
    }
  });

  it('reports nothing as locked when the plan is unknown', () => {
    // Otherwise the page would claim guides are locked while showing them.
    expect(lockedSections(userGuideKnowledge, { planSlug: null })).toEqual([]);
  });
});

describe('add-on entitlement', () => {
  it('unlocks a guide the tier excludes when the add-on is held', () => {
    expect(visibleOn('launch')).not.toContain('market-updates');
    expect(visibleOn('launch', ['market-updates'])).toContain('market-updates');
  });

  it('unlocks a Scale-only guide for a Launch workspace that bought it', () => {
    expect(visibleOn('launch', ['finance-portal'])).toContain('finance-portal');
  });

  it('does not unlock anything the workspace did not buy', () => {
    const v = visibleOn('launch', ['market-updates']);
    expect(v).toContain('market-updates');
    expect(v).not.toContain('model-hub');
  });

  it('falls through rather than denying when add-ons were never supplied', () => {
    // `email-copilot` is add-on-only (empty tier list). Mission Control not
    // telling us what a workspace holds is not evidence it holds nothing —
    // denying here would strip a module a customer pays for.
    expect(isSectionEntitled('email-copilot', { planSlug: 'launch' })).toBe(true);
  });

  it('denies an add-on-only module once we know the workspace holds none', () => {
    expect(isSectionEntitled('email-copilot', { planSlug: 'launch', addonSlugs: [] })).toBe(false);
    expect(
      isSectionEntitled('email-copilot', { planSlug: 'launch', addonSlugs: ['email-copilot'] }),
    ).toBe(true);
  });
});

describe('locked section reporting', () => {
  it('names what a Launch workspace is missing and why', () => {
    const locked = lockedSections(userGuideKnowledge, { planSlug: 'launch', addonSlugs: [] });
    expect(locked.length).toBeGreaterThan(0);
    const byId = new Map(locked.map((l) => [l.id, l]));
    expect(byId.get('finance-portal')?.moduleSlug).toBe('finance-portal');
    expect(byId.get('market-updates')?.moduleSlug).toBe('market-updates');
  });

  it('locked and visible partition the full set with no overlap', () => {
    const ctx = { planSlug: 'launch', addonSlugs: [] as string[] };
    const visible = filterEntitledSections(userGuideKnowledge, ctx).map((s) => s.id);
    const locked = lockedSections(userGuideKnowledge, ctx).map((l) => l.id);
    expect(visible.length + locked.length).toBe(ids().length);
    expect(visible.filter((v) => locked.includes(v))).toEqual([]);
  });

  it('locks nothing on Scale with every add-on held', () => {
    const all = Object.keys(MODULE_TIERS);
    expect(lockedSections(userGuideKnowledge, { planSlug: 'scale', addonSlugs: all })).toEqual([]);
  });
});

describe('mapping integrity', () => {
  it('every mapped section exists in the guide', () => {
    const known = new Set(ids());
    for (const id of [
      ...Object.keys(SECTION_MODULE_SLUGS),
      ...Object.keys(SECTION_PROXY_MODULES),
    ]) {
      expect(known.has(id), `mapping references unknown section "${id}"`).toBe(true);
    }
  });

  it('every mapped module exists in the pricing catalogue', () => {
    for (const [id, slug] of [
      ...Object.entries(SECTION_MODULE_SLUGS),
      ...Object.entries(SECTION_PROXY_MODULES),
    ]) {
      expect(MODULE_TIERS[slug], `${id} maps to unknown module "${slug}"`).toBeDefined();
    }
  });

  it('no section is both directly mapped and proxied', () => {
    for (const id of Object.keys(SECTION_MODULE_SLUGS)) {
      expect(SECTION_PROXY_MODULES[id], `${id} mapped twice`).toBeUndefined();
    }
  });
});

describe('AI knowledge base respects entitlement', () => {
  it('omits sections the workspace cannot see', () => {
    // The typical Launch snapshot carries aml-ctf (headline SKUs include it,
    // and Mission Control states it as an add-on slug).
    const launch = formatKnowledgeBaseForAI('launch', ['aml-ctf']);
    // Feeding the assistant a section the page will not render produces links
    // that scroll nowhere, and walkthroughs for absent screens.
    expect(launch).not.toContain('Section ID: `finance-portal`');
    expect(launch).not.toContain('Section ID: `model-hub`');
    expect(launch).toContain('Section ID: `aml-ctf`');
    // A without-AML SKU never carries the slug, and the guide follows.
    expect(formatKnowledgeBaseForAI('launch', [])).not.toContain('Section ID: `aml-ctf`');
  });

  it('includes a section unlocked by an add-on', () => {
    const ctx = formatKnowledgeBaseForAI('launch', ['market-updates']);
    expect(ctx).toContain('Section ID: `market-updates`');
  });

  it('counts a purchased add-on as included, not as an upsell', () => {
    const ctx = formatKnowledgeBaseForAI('launch', ['finance-portal']);
    const included = ctx.slice(
      ctx.indexOf('### Included in this plan'),
      ctx.indexOf('### Not included'),
    );
    expect(included).toContain('Finance Portal');
    expect(included).toContain('separately purchased add-on');
  });

  it('still documents everything when the plan is unknown', () => {
    const ctx = formatKnowledgeBaseForAI(null);
    for (const id of ids()) expect(ctx).toContain(`Section ID: \`${id}\``);
  });

  it('every section it describes is one the page would render', () => {
    const ctx = formatKnowledgeBaseForAI('growth', []);
    const described = [...ctx.matchAll(/Section ID: `([a-z0-9-]+)`/g)].map((m) => m[1]);
    const visible = new Set(visibleOn('growth', []));
    for (const id of described) {
      expect(visible.has(id), `AI knows about "${id}" but the page hides it`).toBe(true);
    }
  });
});
