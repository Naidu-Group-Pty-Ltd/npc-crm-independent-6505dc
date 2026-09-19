/**
 * Turnstile identity: one widget, one deployment.
 *
 * A widget is a (site key, secret) pair, and this deployment's site key was a
 * literal in `components/auth/TurnstileWidget.tsx`. Every repository mirrored
 * from this one inherited it verbatim — `npc-client-dashboard` rendered THIS
 * deployment's widget on a different tenant's login page, which is one
 * credential, one rotation and one domain allowlist spanning tenants that are
 * supposed to be separate. `siteverify` does report the hostname a token was
 * solved on, and no login handler here reads it.
 *
 * Two rules, and this file is where they are enforced. The key is named in
 * exactly ONE module, so a mirror has one thing to change rather than a search
 * to run. And the built-in is bound to the backend its secret lives in, so a
 * fork pointed at its own Supabase project stops using this widget on its own.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { resolveTurnstileSiteKey, TURNSTILE_SITE_KEY_ENV } from '../turnstileSiteKey';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC = join(REPO_ROOT, 'src');

/** This deployment's own widget, and the backend its secret lives in. */
const OWN_SITE_KEY = '0x4AAAAAAChQyb0ZxBORhxWq';
const OWN_BACKEND_REF = 'dduzbchuswwbefdunfct';

/** The one module allowed to name it. */
const RESOLVER = join('src', 'lib', 'turnstileSiteKey.ts');
const THIS_SPEC = join('src', 'lib', '__tests__', 'turnstileIdentity.spec.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('the site key is named in exactly one module', () => {
  const files = walk(SRC).map((f) => relative(REPO_ROOT, f));

  it('scans a plausible number of files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('is not inlined anywhere else under src/', () => {
    const naming = files.filter(
      (f) => f !== RESOLVER && f !== THIS_SPEC && readFileSync(join(REPO_ROOT, f), 'utf8').includes(OWN_SITE_KEY),
    );
    expect(naming, 'these files inline the Turnstile site key instead of resolving it').toEqual([]);
  });

  it('the resolver does name it', () => {
    expect(readFileSync(join(REPO_ROOT, RESOLVER), 'utf8')).toContain(OWN_SITE_KEY);
  });
});

describe('resolveTurnstileSiteKey precedence', () => {
  it('uses the configured key when one is set, over the built-in', () => {
    const r = resolveTurnstileSiteKey({
      configured: '0x4AAAAAAtenantOwnKey11',
      backendRef: OWN_BACKEND_REF,
    });
    expect(r).toEqual({ siteKey: '0x4AAAAAAtenantOwnKey11', source: 'env', warning: null });
  });

  it('trims a configured key and ignores a blank one', () => {
    expect(resolveTurnstileSiteKey({ configured: '  0x4key  ' }).siteKey).toBe('0x4key');
    expect(resolveTurnstileSiteKey({ configured: '   ', backendRef: null }).siteKey).toBeNull();
  });

  it('uses the built-in for this deployment', () => {
    const r = resolveTurnstileSiteKey({ backendRef: OWN_BACKEND_REF });
    expect(r).toEqual({ siteKey: OWN_SITE_KEY, source: 'built-in', warning: null });
  });

  it('a build pointed at another project gets nothing, not this widget', () => {
    const r = resolveTurnstileSiteKey({ backendRef: 'plisdzywzleljorrphxv' });
    expect(r.siteKey).toBeNull();
    expect(r.source).toBe('unset');
    expect(r.warning).toContain(TURNSTILE_SITE_KEY_ENV);
    expect(r.warning).toContain(OWN_BACKEND_REF);
  });

  it('a build whose backend cannot be identified gets nothing', () => {
    expect(resolveTurnstileSiteKey({ backendRef: null }).siteKey).toBeNull();
  });

  it('a mirror that clears the built-in resolves to unset', () => {
    const r = resolveTurnstileSiteKey({
      builtInSiteKey: null,
      builtInBackendRef: null,
      backendRef: OWN_BACKEND_REF,
    });
    expect(r.siteKey).toBeNull();
    expect(r.warning).toContain(TURNSTILE_SITE_KEY_ENV);
  });
});
