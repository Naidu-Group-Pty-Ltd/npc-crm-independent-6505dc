import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_FACING_HIDDEN_PATHS,
  deploymentAllowances,
  isClientFacingDeployment,
  isDeveloperToolPath,
  isPathVisibleInDeployment,
  matchedHiddenPath,
  parseDeploymentAllowances,
  resolveClientFacingFlag,
} from '../clientFacing';
import { ADMIN_NAVIGATION_ITEMS, NAVIGATION_ITEMS } from '@/lib/navigation/registry';

describe('resolveClientFacingFlag', () => {
  it('enables only on an explicit opt-in', () => {
    expect(resolveClientFacingFlag('true')).toBe(true);
    expect(resolveClientFacingFlag('1')).toBe(true);
    expect(resolveClientFacingFlag(true)).toBe(true);
  });

  it('stays off for everything else — an unset flag must change nothing', () => {
    expect(resolveClientFacingFlag(undefined)).toBe(false);
    expect(resolveClientFacingFlag('')).toBe(false);
    expect(resolveClientFacingFlag('false')).toBe(false);
    expect(resolveClientFacingFlag('0')).toBe(false);
    expect(resolveClientFacingFlag(false)).toBe(false);
    expect(resolveClientFacingFlag('yes')).toBe(false);
  });
});

describe('CLIENT_FACING_HIDDEN_PATHS hygiene', () => {
  it('entries are absolute, unduplicated, and carry no trailing slash', () => {
    for (const path of CLIENT_FACING_HIDDEN_PATHS) {
      expect(path.startsWith('/')).toBe(true);
      expect(path.endsWith('/')).toBe(false);
    }
    expect(new Set(CLIENT_FACING_HIDDEN_PATHS).size).toBe(CLIENT_FACING_HIDDEN_PATHS.length);
  });
});

describe('isDeveloperToolPath', () => {
  it('matches an entry exactly and anything underneath it', () => {
    expect(isDeveloperToolPath('/integrations')).toBe(true);
    expect(isDeveloperToolPath('/integrations/')).toBe(true);
    expect(isDeveloperToolPath('/integrations/ghl-migration')).toBe(true);
    expect(isDeveloperToolPath('/workflow-playground')).toBe(true);
    expect(isDeveloperToolPath('/admin/pdf-import-diagnostics')).toBe(true);
  });

  it('never matches by string prefix alone', () => {
    // `/integrations-summary` would be a different page, not a child.
    expect(isDeveloperToolPath('/integrations-summary')).toBe(false);
    expect(isDeveloperToolPath('/sourcess')).toBe(false);
  });

  it('leaves the client surfaces alone', () => {
    for (const path of [
      '/',
      '/listings',
      '/listings/abc-123',
      '/reports',
      '/call-logs',
      '/clients',
      '/billing',
      '/settings',
      '/templates',
      '/admin/users',
      '/admin/template-builder',
      '/admin/aml',
    ]) {
      expect(isDeveloperToolPath(path), path).toBe(false);
    }
  });
});

describe('isPathVisibleInDeployment', () => {
  it('hides developer tooling only in client-facing mode', () => {
    // An explicit empty allowance: these assert the LIST's rule, which must not
    // move when a deployment is built with `VITE_CLIENT_FACING_ALLOW` set.
    expect(isPathVisibleInDeployment('/integrations', true, [])).toBe(false);
    expect(isPathVisibleInDeployment('/integrations', false, [])).toBe(true);
    expect(isPathVisibleInDeployment('/listings', true, [])).toBe(true);
  });
});

/**
 * The mode is decided by a build constant, and it has to STAY one.
 *
 * Reading `import.meta.env` looked equivalent and was not: written through a
 * TypeScript cast it compiles to `(_a = import.meta) == null ? void 0 : _a.env`,
 * Vite's substitution never matches, and the browser's `import.meta` has no
 * `env` — so the flag was `false` in every client-facing bundle while the
 * `define` that drops the page chunks was `true`. Nothing reproduces that here:
 * the dev server and this test runner both give `import.meta` a real `env`, so
 * the only way to hold the rule is to read the source.
 */
describe('isClientFacingDeployment reads the build constant and nothing else', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/clientFacing.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('never names import.meta outside a comment', () => {
    expect(code).not.toContain('import.meta');
  });

  it('reads __CLIENT_FACING__', () => {
    expect(code).toContain('__CLIENT_FACING__');
  });

  it('falls back to the internal console where the constant was not injected', () => {
    // vitest.config.ts deliberately defines neither constant, so this exercises
    // the guard a non-Vite consumer (or a stale build) would hit.
    expect(isClientFacingDeployment()).toBe(false);
    expect(deploymentAllowances()).toEqual([]);
  });
});

describe('parseDeploymentAllowances', () => {
  const hidden = ['/integrations', '/billing', '/admin/users'];

  it('takes a comma-separated list, trimming and dropping empties', () => {
    expect(parseDeploymentAllowances(' /integrations , /billing ,,', hidden)).toEqual([
      '/integrations',
      '/billing',
    ]);
  });

  it('ignores a trailing slash and a repeated entry', () => {
    expect(parseDeploymentAllowances('/integrations/,/integrations', hidden)).toEqual([
      '/integrations',
    ]);
  });

  it('honours only what the hidden list actually took', () => {
    // A typo, a path that is not hidden at all, and a child of a hidden entry
    // are all refused: an allowance gives something back, it never grants.
    expect(parseDeploymentAllowances('/integration,/listings,/integrations/ghl-migration', hidden))
      .toEqual([]);
  });

  it('is empty for an unset, empty or whitespace value', () => {
    expect(parseDeploymentAllowances(undefined, hidden)).toEqual([]);
    expect(parseDeploymentAllowances('', hidden)).toEqual([]);
    expect(parseDeploymentAllowances('   ', hidden)).toEqual([]);
  });

  it('defaults to the real list, so a live entry resolves and a fiction does not', () => {
    expect(parseDeploymentAllowances('/integrations')).toEqual(['/integrations']);
    expect(parseDeploymentAllowances('/not-a-real-page')).toEqual([]);
  });
});

describe('matchedHiddenPath', () => {
  it('names the entry a path falls under', () => {
    expect(matchedHiddenPath('/integrations/ghl-migration')).toBe('/integrations');
    expect(matchedHiddenPath('/listings')).toBeNull();
  });

  it('prefers the longest entry, whatever order the list is written in', () => {
    // Both entries match. The specific page must keep its own decision, so
    // allowing the parent cannot silently un-hide what sits under it — and the
    // answer must not depend on which entry happens to be written first.
    const nested = ['/admin/thing', '/admin/thing/health'];
    const reversed = [...nested].reverse();
    for (const hidden of [nested, reversed]) {
      expect(matchedHiddenPath('/admin/thing/health', hidden)).toBe('/admin/thing/health');
      expect(matchedHiddenPath('/admin/thing/other', hidden)).toBe('/admin/thing');
    }
  });
});

describe('isPathVisibleInDeployment with allowances', () => {
  it('gives back exactly the allowed entry and nothing beside it', () => {
    const allow = ['/integrations'];
    expect(isPathVisibleInDeployment('/integrations', true, allow)).toBe(true);
    expect(isPathVisibleInDeployment('/integrations/ghl-migration', true, allow)).toBe(true);
    expect(isPathVisibleInDeployment('/workflow-playground', true, allow)).toBe(false);
  });

  it('changes nothing on the internal console', () => {
    expect(isPathVisibleInDeployment('/integrations', false, [])).toBe(true);
  });
});

/**
 * A control must not lead where this deployment refuses.
 *
 * `ModuleGuard`'s "not included in your subscription" alert offers two buttons
 * and both land on `/billing`, which the hidden-path list can take away — a
 * client-facing workspace's subscription is Aurixa's relationship with it
 * rather than something it administers. With the mode dead at runtime that
 * never showed; with the mode live, the buttons would land on "not available
 * on this dashboard", which is worse than offering nothing.
 */
describe('ModuleGuard does not offer a link to a hidden page', () => {
  const guard = readFileSync(join(process.cwd(), 'src/components/auth/ModuleGuard.tsx'), 'utf8');

  it('asks the deployment whether /billing is reachable', () => {
    expect(guard).toContain("isPathVisibleInDeployment('/billing'");
    expect(guard).toContain('isClientFacingDeployment()');
  });

  it('draws the billing buttons only behind that answer', () => {
    // The `<Link to="/billing">` pair must sit inside the conditional branch,
    // never beside it.
    const conditional = guard.indexOf('billingReachable ? (');
    expect(conditional).toBeGreaterThan(-1);
    expect(guard.indexOf('<Link to="/billing">')).toBeGreaterThan(conditional);
  });
});

describe('against the navigation registry', () => {
  const allItems = [...NAVIGATION_ITEMS, ...ADMIN_NAVIGATION_ITEMS];

  it('removes the named operator tools from a client-facing deployment', () => {
    const hiddenTitles = allItems
      .filter((item) => !isPathVisibleInDeployment(item.url, true, []))
      .map((item) => item.title);
    for (const title of [
      'Integrations',
      'Workflow Playground',
      'Cloudflare',
      'API Usage',
      'Model Hub',
      'Monitoring',
      'Quality Assurance',
      'Error Logs',
      'Sources',
      'Token Audit Log',
      'PDF Import Engine',
      'PDF Import Diagnostics',
      'BC Segment Engine',
      'Reclassify Property',
    ]) {
      expect(hiddenTitles, title).toContain(title);
    }
  });

  it('keeps every client-workspace feature visible', () => {
    const visibleTitles = allItems
      .filter((item) => isPathVisibleInDeployment(item.url, true, []))
      .map((item) => item.title);
    for (const title of [
      'Overview',
      'Property Marketplace',
      'Reports',
      'Call Logs',
      'Clients',
      'Billing & Usage',
      'Templates',
      'Template Builder',
      'Branding',
      'Settings',
      'User Management',
      'Client Portal',
      'Support',
    ]) {
      expect(visibleTitles, title).toContain(title);
    }
  });

  it('hides nothing when the deployment is the internal console', () => {
    expect(allItems.filter((item) => !isPathVisibleInDeployment(item.url, false, []))).toEqual([]);
  });
});
