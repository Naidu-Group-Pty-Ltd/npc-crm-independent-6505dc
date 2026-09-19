import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { PRIME_BACKEND_REF, isPrimeDeployment } from '../primeDeployment';

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

  it('is wrapped in the internal tooling guard', () => {
    const line = app.split('\n').find((l) => l.includes('integrations/ghl-migration'));
    expect(line, 'the ghl-migration route is missing entirely').toBeDefined();
    expect(line).toContain('InternalToolingGuard');
  });

  /*
   * And is not left to the entitlement gate instead, which would read as
   * closed while being open to exactly the wrong person.
   */
  it('does not rely on ModuleGuard alone', () => {
    const line = app.split('\n').find((l) => l.includes('integrations/ghl-migration')) ?? '';
    expect(line.includes('ModuleGuard') && !line.includes('InternalToolingGuard')).toBe(false);
  });
});
