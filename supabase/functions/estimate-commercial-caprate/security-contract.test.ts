import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
const upstreamCall = source.indexOf("fetch('https://ai.gateway.lovable.dev/v1/chat/completions'");

describe('estimate-commercial-caprate security contract', () => {
  it('bounds and validates caller-controlled input before the paid AI call', () => {
    expect(source).toContain('enforceJsonBodyLimit');
    expect(source).toContain('MAX_REQUEST_BYTES');
    expect(source).toContain('isValidSnapshot(body.snapshot)');
    expect(source.indexOf('isValidSnapshot(body.snapshot)')).toBeLessThan(upstreamCall);
  });

  it('requires module access and distributed rate-limit reservations before the paid AI call', () => {
    expect(source).toContain("checkModuleView(supabase, userId, 'listings', authMethod)");
    expect(source).toContain('caprate-estimate:user:');
    expect(source).toContain("consumeRateLimit(supabase, 'caprate-estimate:global'");
    expect(source).toContain("securityJsonError(503, 'metering_unavailable')");
    expect(source.indexOf('checkModuleView(supabase')).toBeLessThan(upstreamCall);
    expect(source.indexOf('consumeRateLimit(supabase')).toBeLessThan(upstreamCall);
  });
});
