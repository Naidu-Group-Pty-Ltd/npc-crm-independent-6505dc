/**
 * The copy that answers "which of these three do I want?".
 *
 * Worth a spec because it is the fix for a real complaint — three unlabelled
 * buttons, no way to tell Import from Convert — and because copy is exactly the
 * kind of thing a later refactor drops without noticing. If `outcome` ever goes
 * missing, the page silently returns to being confusing.
 */
import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_CONVERTER_PATH,
  TEMPLATE_START_ROUTES,
} from '../templateStartRoutes';

describe('TEMPLATE_START_ROUTES', () => {
  it('offers exactly three ways in, with unique keys', () => {
    expect(TEMPLATE_START_ROUTES).toHaveLength(3);
    const keys = TEMPLATE_START_ROUTES.map((r) => r.key);
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual(['blank', 'import', 'convert']);
  });

  it('every route says what happens and what you end up with', () => {
    for (const route of TEMPLATE_START_ROUTES) {
      expect(route.title.trim().length, route.key).toBeGreaterThan(0);
      expect(route.body.trim().length, route.key).toBeGreaterThan(20);
      expect(route.outcome.trim().length, route.key).toBeGreaterThan(0);
      expect(route.cta.trim().length, route.key).toBeGreaterThan(0);
    }
  });

  it('distinguishes Import from Convert on the thing that differs', () => {
    // Import keeps the layout; Convert throws it away and keeps the structure.
    // That sentence is the whole reason the two cannot be merged into one
    // "bring in a PDF" action, so it has to survive in the copy.
    const importRoute = TEMPLATE_START_ROUTES.find((r) => r.key === 'import')!;
    const convertRoute = TEMPLATE_START_ROUTES.find((r) => r.key === 'convert')!;
    expect(importRoute.body.toLowerCase()).toContain('layout');
    expect(convertRoute.body.toLowerCase()).toContain('structure');
    expect(convertRoute.body.toLowerCase()).toContain('not carried across');
  });

  it('is honest that a conversion yields a PDF as well as a template', () => {
    const convertRoute = TEMPLATE_START_ROUTES.find((r) => r.key === 'convert')!;
    expect(convertRoute.outcome.toLowerCase()).toContain('pdf');
    expect(convertRoute.outcome.toLowerCase()).toContain('editable template');
  });

  it('points exactly one route at the converter', () => {
    const withHref = TEMPLATE_START_ROUTES.filter((r) => r.href === TEMPLATE_CONVERTER_PATH);
    expect(withHref).toHaveLength(1);
    expect(withHref[0].key).toBe('convert');
  });
});
