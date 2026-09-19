/**
 * Locks the Template Library's copy of the production renderer allow-lists to
 * the ones `manage-templates` actually enforces.
 *
 * The library validates entries at PUBLISH time so a user is told a template is
 * preview-only on the card, rather than discovering it from a 422 after an
 * afternoon of edits. That check is only honest if it uses the same list the
 * Builder's broker uses at activation time. `manage-templates` is deliberately
 * not modified by this feature, so the list is duplicated — and this test is
 * what stops the duplicate from drifting.
 *
 * Parsed from source rather than imported: `manage-templates/index.ts` is Deno
 * code with `https://` imports that cannot be loaded into the Vitest module
 * graph.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const BROKER = resolve(ROOT, 'supabase/functions/manage-templates/index.ts');
const SHARED = resolve(ROOT, 'supabase/functions/_shared/productionBlockTypes.ts');

/** Extract the string literals from `const <name> = new Set([...])`. */
function extractSet(source: string, name: string): string[] {
  const start = source.indexOf(`${name} = new Set([`);
  if (start === -1) throw new Error(`Could not find "${name} = new Set([" in source`);
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  if (close === -1) throw new Error(`Unterminated Set literal for "${name}"`);
  return [...source.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('production allow-list parity', () => {
  const broker = readFileSync(BROKER, 'utf8');
  const shared = readFileSync(SHARED, 'utf8');

  it('block types match the broker exactly', () => {
    const brokerTypes = extractSet(broker, 'PRODUCTION_SAFE_BLOCK_TYPES');
    const sharedTypes = extractSet(shared, 'PRODUCTION_SAFE_BLOCK_TYPES');

    expect(brokerTypes.length).toBeGreaterThan(50);
    expect([...sharedTypes].sort()).toEqual([...brokerTypes].sort());
  });

  it('report types with a production adapter match the broker exactly', () => {
    const brokerTypes = extractSet(broker, 'PRODUCTION_REPORT_TEMPLATE_TYPES');
    const sharedTypes = extractSet(shared, 'PRODUCTION_REPORT_TEMPLATE_TYPES');

    expect(brokerTypes.length).toBeGreaterThan(0);
    expect([...sharedTypes].sort()).toEqual([...brokerTypes].sort());
  });

  it('the shared copy carries no duplicates', () => {
    const types = extractSet(shared, 'PRODUCTION_SAFE_BLOCK_TYPES');
    expect(new Set(types).size).toBe(types.length);
  });
});
