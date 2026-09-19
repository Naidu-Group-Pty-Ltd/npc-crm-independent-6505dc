import { describe, expect, it, vi } from 'vitest';
import {
  assertArrayField,
  assertObjectResponse,
  errorMessage,
  responseErrorMessage,
  withTimeout,
} from '@/lib/modelHubData';

describe('Model Hub response guards', () => {
  it('rejects null and non-object function responses', () => {
    expect(() => assertObjectResponse(null, 'Catalog')).toThrow('Catalog returned an invalid response.');
    expect(() => assertObjectResponse([], 'Catalog')).toThrow('Catalog returned an invalid response.');
  });

  it('requires collection fields instead of allowing a render-time crash', () => {
    expect(() => assertArrayField({ success: true }, 'models', 'Catalog')).toThrow(
      'Catalog response is missing models.',
    );
  });

  it('surfaces a server error and safely formats unknown errors', () => {
    expect(responseErrorMessage({ error: 'Probe unavailable' }, 'fallback')).toBe('Probe unavailable');
    expect(errorMessage('failure')).toBe('An unexpected error occurred.');
  });

  it('stops waiting when an edge function hangs', async () => {
    vi.useFakeTimers();
    const result = withTimeout(new Promise<never>(() => undefined), 100);
    const expectation = expect(result).rejects.toThrow('did not respond in time');
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
    vi.useRealTimers();
  });
});
