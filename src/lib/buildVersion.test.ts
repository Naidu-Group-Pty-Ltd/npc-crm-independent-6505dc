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

/**
 * The manifest also says which backend the build resolved.
 *
 * Read the block in `VersionManifest` for why: the prime's project ref is
 * compiled into every bundle as the fallback constant, so a correctly
 * configured clone's JavaScript names BOTH its own project and the prime's,
 * and no amount of text matching says which one the client uses. Measured on a
 * real build, a scan of the 5,036,633-byte entry chunk can only answer
 * "unproven"; the manifest answers in 89 bytes.
 */
describe('parseVersionManifest — the resolved backend', () => {
  it('reads a whole declaration', () => {
    const m = parseVersionManifest({
      buildId: 'd62fb9c0aacb',
      supabase: { projectRef: 'qvuwrvwzjyigptmnijyb', source: 'env' },
    });
    expect(m?.supabase).toEqual({ projectRef: 'qvuwrvwzjyigptmnijyb', source: 'env' });
  });

  it('still reads a manifest from a build that predates the field', () => {
    // Every deployment in the fleet today. Absent must mean "not declared",
    // never "no backend" and certainly never a pass.
    const m = parseVersionManifest({ buildId: '5842dfcd5946' });
    expect(m?.buildId).toBe('5842dfcd5946');
    expect(m?.supabase).toBeUndefined();
  });

  it('drops a half-read block rather than asserting a ref it does not have', () => {
    for (const bad of [
      { projectRef: 'abc' },
      { source: 'env' },
      { projectRef: 'abc', source: 'somewhere-else' },
      { projectRef: 42, source: 'env' },
      'not-an-object',
      null,
    ]) {
      const m = parseVersionManifest({ buildId: 'x', supabase: bad });
      expect(m?.buildId).toBe('x');
      expect(m?.supabase).toBeUndefined();
    }
  });

  it('keeps a declared fallback, because which SOURCE it came from is the remedy', () => {
    // `fallback` on a clone means its variables never reached the build — a
    // configuration fix. `env` naming the wrong project is a different fault
    // with a different remedy, so the field is carried rather than collapsed.
    const m = parseVersionManifest({
      buildId: 'x',
      supabase: { projectRef: 'dduzbchuswwbefdunfct', source: 'fallback' },
    });
    expect(m?.supabase?.source).toBe('fallback');
  });

  it('accepts an explicitly null ref without inventing one', () => {
    const m = parseVersionManifest({ buildId: 'x', supabase: { projectRef: null, source: 'env' } });
    expect(m?.supabase).toEqual({ projectRef: null, source: 'env' });
  });
});
