import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'supabase/functions/finance-portal-ai-copilot/index.ts'),
  'utf8',
);

describe('finance portal voice transcription abuse controls', () => {
  it('bounds the request, decoded audio size, and server-authoritative duration', () => {
    expect(source).toContain('enforceJsonBodyLimit<Record<string, unknown>>(req, MAX_REQUEST_BYTES)');
    expect(source).toContain('MAX_VOICE_AUDIO_BYTES = 2 * 1024 * 1024');
    expect(source).toContain('audioBase64.length % 4 !== 0 || decodedBytes > MAX_VOICE_AUDIO_BYTES');
    expect(source).toContain('durationSeconds > MAX_VOICE_DURATION_SECONDS');
  });

  it('consumes a persistent per-user quota before calling the paid gateway', () => {
    const routeStart = source.indexOf('case "transcribe_voice"');
    const route = source.slice(routeStart, source.indexOf('default:', routeStart));

    expect(routeStart).toBeGreaterThan(-1);
    expect(route).toContain('validateVoiceMemo(body.audio_base64, body.duration_seconds)');
    expect(route).toContain('consumeRateLimit(supabase, `finance-voice-transcription:user:${userId}`, 5, 60 * 60)');
    expect(route).toContain('status: 429');
    expect(route.indexOf('consumeRateLimit')).toBeLessThan(route.indexOf('transcribeVoice'));
  });
});
