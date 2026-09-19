import { describe, expect, it, vi } from 'vitest';
import {
  fetchDeployedBuildId,
  isStaleBuild,
  parseVersionManifest,
  VERSION_MANIFEST_PATH,
} from '@/lib/buildVersion';

describe('parseVersionManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(parseVersionManifest({ buildId: 'abc123' })).toEqual({ buildId: 'abc123' });
  });

  it('rejects anything it cannot trust', () => {
    expect(parseVersionManifest(null)).toBeNull();
    expect(parseVersionManifest('abc123')).toBeNull();
    expect(parseVersionManifest({})).toBeNull();
    expect(parseVersionManifest({ buildId: '' })).toBeNull();
    expect(parseVersionManifest({ buildId: 42 })).toBeNull();
  });
});

describe('isStaleBuild', () => {
  it('flags a tab running a different build to the deployed one', () => {
    expect(isStaleBuild('aaa111', { buildId: 'bbb222' })).toBe(true);
  });

  it('is quiet when the tab is current', () => {
    expect(isStaleBuild('aaa111', { buildId: 'aaa111' })).toBe(false);
  });

  it('never nags when the manifest is unavailable', () => {
    // Offline, blocked, or not deployed yet — must not prompt a reload.
    expect(isStaleBuild('aaa111', null)).toBe(false);
  });

  it('stays out of the way during development', () => {
    expect(isStaleBuild('dev', { buildId: 'aaa111' })).toBe(false);
    expect(isStaleBuild('aaa111', { buildId: 'dev' })).toBe(false);
  });
});

describe('fetchDeployedBuildId', () => {
  it('bypasses every cache layer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ buildId: 'deployed1' }),
    });

    const result = await fetchDeployedBuildId(fetchImpl as unknown as typeof fetch, 1234);

    expect(result).toEqual({ buildId: 'deployed1' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain(VERSION_MANIFEST_PATH);
    // A query string defeats intermediaries that ignore Cache-Control.
    expect(url).toMatch(/\?t=/);
    expect(init).toMatchObject({ cache: 'no-store' });
  });

  it('treats a network failure as "current" rather than stale', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(fetchDeployedBuildId(fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
  });

  it('treats a non-OK response as "current"', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(fetchDeployedBuildId(fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
  });

  it('treats an HTML error page as "current"', async () => {
    // A SPA host that rewrites unknown paths to index.html would otherwise
    // make every tab look stale.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    await expect(fetchDeployedBuildId(fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
  });
});
