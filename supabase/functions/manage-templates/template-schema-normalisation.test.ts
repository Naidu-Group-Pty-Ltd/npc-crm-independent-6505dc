import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('template schema normalisation contract', () => {
  it('discards malformed page and block entries before normalising them', () => {
    expect(source).toContain(
      "s.pages.filter((page: unknown) => page !== null && typeof page === 'object' && !Array.isArray(page))",
    );
    expect(source).toContain(
      "page.blocks.filter((block: unknown) => block !== null && typeof block === 'object' && !Array.isArray(block))",
    );
  });
});
