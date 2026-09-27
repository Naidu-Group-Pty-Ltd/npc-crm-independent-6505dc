import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

import { PRIME_BACKEND_REF, isPrimeDeployment } from '../primeDeployment';
import { TREE_IS_PRIME } from '../testSupport/primeTree';
import { isPrimeOnlyPath } from '../../../scripts/lib/primeOnlyFeatures.mjs';

describe('isPrimeDeployment', () => {
  it('recognises the prime by the backend it talks to', () => {
    expect(isPrimeDeployment(PRIME_BACKEND_REF)).toBe(true);
  });

  /*
   * A clone is pointed at its own Supabase project by Mission Control, so it
   * cannot match by accident. `plisdzywzleljorrphxv` is the NPC Client
   * Dashboard's, used here as a real example rather than a placeholder.
   */
  it('does not recognise a clone', () => {
    expect(isPrimeDeployment('plisdzywzleljorrphxv')).toBe(false);
  });

  /*
   * Fails CLOSED. The two answers do not cost the same: a hidden internal tool
   * inconveniences NPC staff who know where it lives, a visible one shows a
   * tenant the inside of somebody else's incident response.
   */
  it('fails closed where the backend cannot be read', () => {
    expect(isPrimeDeployment(null)).toBe(false);
    expect(isPrimeDeployment('')).toBe(false);
  });
});

/*
 * The GHL migration pages were built to handle a security incident on NPC's
 * own GoHighLevel account. No tenant has that account or that incident.
 *
 * `ModuleGuard` cannot carry this: it opens every available module to a
 * SUPERADMIN as the deployment's operator, and a tenant's own administrator is
 * a superadmin of their own workspace — so an entitlement gate would hide the
 * tool from their staff and show it to the one person most likely to go
 * looking. This pins the guard that does carry it.
 */
describe('the GHL migration route is internal tooling', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const routeLine = app.split('\n').find((l) => l.includes('integrations/ghl-migration'));
  const PAGE = 'src/pages/admin/GhlMigration.tsx';

  /*
   * The page is the prime's alone (scripts/lib/primeOnlyFeatures.mjs). A clone
   * that has shed it has nothing to guard; one that still holds it guards it
   * exactly as the prime does.
   */
  it.runIf(existsSync(PAGE))('is wrapped in the internal tooling guard wherever the page is', () => {
    expect(routeLine, 'the ghl-migration route is missing entirely').toBeDefined();
    expect(routeLine).toContain('InternalToolingGuard');
  });

  /*
   * And is not left to the entitlement gate instead, which would read as
   * closed while being open to exactly the wrong person.
   */
  it('does not rely on ModuleGuard alone', () => {
    const line = routeLine ?? '';
    expect(line.includes('ModuleGuard') && !line.includes('InternalToolingGuard')).toBe(false);
  });

  /*
   * No clone carries the page, and a static import() of a file that is not
   * there fails the build. The prime's App.tsx is the one every clone's is
   * reconciled from, so it finds the page through import.meta.glob, which
   * answers an empty record for a missing file, and draws the route only
   * where the glob found it.
   */
  it.runIf(TREE_IS_PRIME)('finds the page through import.meta.glob, so a tree without it still builds', () => {
    expect(isPrimeOnlyPath(PAGE)).toBe(true);
    expect(existsSync(PAGE)).toBe(true);
    expect(app).toMatch(/import\.meta\.glob(<.*?>)?\(\s*['"]\.\/pages\/admin\/GhlMigration\.tsx['"]\s*\)/);
    expect(app).not.toMatch(/import\(\s*["'`]\.\/pages\/admin\/GhlMigration/);
    expect(app).not.toMatch(/from\s+["']\.\/pages\/admin\/GhlMigration/);
    expect(routeLine?.trimStart().startsWith('{GhlMigration && <Route ')).toBe(true);
  });
});
