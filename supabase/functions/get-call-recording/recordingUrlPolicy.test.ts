import { describe, expect, it, vi } from 'vitest';
import { assertSafeRecordingUrl } from './recordingUrlPolicy';

const publicDns = vi.fn(async (_hostname: string, type: 'A' | 'AAAA') =>
  type === 'A' ? ['104.16.0.1'] : []);

describe('call recording URL policy', () => {
  it.each([
    'https://storage.vapi.ai/recording.wav?token=signed',
    'https://account.r2.cloudflarestorage.com/bucket/recording.wav?token=signed',
    'https://recordings.example.r2.dev/recording.wav?token=signed',
  ])('allows expected recording host %s', async (value) => {
    await expect(assertSafeRecordingUrl(value, publicDns)).resolves.toMatchObject({ protocol: 'https:' });
  });

  it.each([
    'http://storage.vapi.ai/recording.wav',
    'https://vapi.ai.attacker.example/recording.wav',
    'https://127.0.0.1/recording.wav',
  ])('rejects unexpected recording target %s', async (value) => {
    await expect(assertSafeRecordingUrl(value, publicDns)).rejects.toThrow();
  });

  it('rejects an allowlisted hostname that resolves privately', async () => {
    const privateDns = vi.fn(async () => ['127.0.0.1']);
    await expect(assertSafeRecordingUrl('https://storage.vapi.ai/recording.wav', privateDns))
      .rejects.toThrow('private or reserved');
  });
});
