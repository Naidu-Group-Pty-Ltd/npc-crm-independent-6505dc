import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('get-call-recording security contract', () => {
  it('checks call_logs view permission before reading a call log', () => {
    const permission = source.indexOf("checkModuleView(supabase, userId!, 'call_logs', authMethod, true)");
    const rowRead = source.indexOf(".from('vapi_call_logs')", permission);
    expect(permission).toBeGreaterThan(-1);
    expect(rowRead).toBeGreaterThan(permission);
  });

  it('validates recording URLs and manually handles redirects', () => {
    expect(source).toContain('assertSafeRecordingUrl(');
    expect(source).toContain("redirect: 'manual'");
  });
});
