import { describe, expect, it } from 'vitest';
import { isRequestBody, readBoundedJson, RequestTooLargeError } from './requestGuards';

describe('NOI request guards', () => {
  it('accepts the supported request shape and rejects invalid snapshots', () => {
    expect(isRequestBody({ snapshot: { address: '1 Example Street' }, session_token: 'token' })).toBe(true);
    expect(isRequestBody({ snapshot: 'large caller-controlled text' })).toBe(false);
    expect(isRequestBody({ snapshot: [] })).toBe(false);
  });

  it('rejects a declared oversized body before reading it', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      headers: { 'content-length': String(32 * 1024 + 1) },
      body: '{}',
    });
    await expect(readBoundedJson(request)).rejects.toBeInstanceOf(RequestTooLargeError);
  });

  it('rejects an oversized streamed body without a content-length header', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: JSON.stringify({ snapshot: { address: 'x'.repeat(33 * 1024) } }),
    });
    await expect(readBoundedJson(request)).rejects.toBeInstanceOf(RequestTooLargeError);
  });
});
