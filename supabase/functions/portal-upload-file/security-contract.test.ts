import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('portal upload document requirement authorization contract', () => {
  it('only auto-links open requirements owned by and visible to the client', () => {
    const autoLinkBlock = functionSource.match(
      /\/\/ Wave B: auto-link([\s\S]*?)\n    \/\/ Wave B: notify/,
    )?.[1];

    expect(autoLinkBlock).toBeDefined();
    expect(autoLinkBlock?.match(/\.eq\('client_id', clientId\)/g)).toHaveLength(2);
    expect(autoLinkBlock?.match(/\.eq\('owner', 'client'\)/g)).toHaveLength(2);
    expect(autoLinkBlock?.match(/\.eq\('visible_to_client', true\)/g)).toHaveLength(2);
    expect(autoLinkBlock?.match(/\.in\('status', \['required', 'requested'\]\)/g)).toHaveLength(2);
  });
});
