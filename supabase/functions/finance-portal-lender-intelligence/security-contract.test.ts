import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

describe('finance portal lender intelligence security contract', () => {
  it('does not delegate privileged CDR cache refreshes for portal sessions', () => {
    expect(source).not.toContain("operation === 'refresh_rates'");
    expect(source).not.toContain('/functions/v1/cdr-lending-rates-service');
    expect(source).not.toContain("action: 'refresh-all'");
  });
});
