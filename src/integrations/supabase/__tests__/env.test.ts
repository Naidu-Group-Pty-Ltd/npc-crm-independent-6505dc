import { describe, expect, it } from 'vitest';
import {
  projectRefFromAnonKey,
  projectRefFromUrl,
  resolveSupabaseTarget,
} from '../env';

/**
 * A throwaway anon-shaped JWT for a fictitious project. Only the middle
 * segment is read, and only its `ref` claim — the signature is never checked
 * here (or by this module), so an unsigned string is the honest fixture.
 */
function anonKeyForRef(ref: string): string {
  const payload = btoa(JSON.stringify({ iss: 'supabase', ref, role: 'anon' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.signature-not-verified`;
}

const PRIME = { url: 'https://primeref00000000.supabase.co', key: anonKeyForRef('primeref00000000') };
const CLONE = { url: 'https://cloneref000000000.supabase.co', key: anonKeyForRef('cloneref000000000') };

describe('projectRefFromUrl', () => {
  it('reads the ref out of a Supabase project URL', () => {
    expect(projectRefFromUrl('https://dduzbchuswwbefdunfct.supabase.co')).toBe('dduzbchuswwbefdunfct');
    expect(projectRefFromUrl('https://dduzbchuswwbefdunfct.supabase.co/')).toBe('dduzbchuswwbefdunfct');
    expect(projectRefFromUrl('  https://plisdzywzleljorrphxv.supabase.co  ')).toBe('plisdzywzleljorrphxv');
  });

  it('returns null rather than a guess for anything else', () => {
    expect(projectRefFromUrl('http://localhost:54321')).toBeNull();
    expect(projectRefFromUrl('https://example.com')).toBeNull();
    expect(projectRefFromUrl('')).toBeNull();
  });
});

describe('projectRefFromAnonKey', () => {
  it('reads the ref claim out of an anon JWT', () => {
    expect(projectRefFromAnonKey(anonKeyForRef('somerefvalue0000'))).toBe('somerefvalue0000');
  });

  it('returns null for anything that is not one, instead of throwing', () => {
    expect(projectRefFromAnonKey('not-a-jwt')).toBeNull();
    expect(projectRefFromAnonKey('')).toBeNull();
    expect(projectRefFromAnonKey('a.!!!not-base64!!!.c')).toBeNull();
    // Valid JWT shape, no `ref` claim.
    expect(projectRefFromAnonKey(`x.${btoa('{"role":"anon"}')}.y`)).toBeNull();
  });
});

describe('resolveSupabaseTarget', () => {
  const fallbacks = { fallbackUrl: PRIME.url, fallbackAnonKey: PRIME.key };

  it('uses the built-in pair when the environment says nothing', () => {
    const r = resolveSupabaseTarget({ ...fallbacks });
    expect(r).toEqual({ url: PRIME.url, anonKey: PRIME.key, source: 'fallback', warning: null });
  });

  it('takes both from the environment when both are set and agree', () => {
    const r = resolveSupabaseTarget({ url: CLONE.url, anonKey: CLONE.key, ...fallbacks });
    expect(r.url).toBe(CLONE.url);
    expect(r.anonKey).toBe(CLONE.key);
    expect(r.source).toBe('env');
    expect(r.warning).toBeNull();
  });

  it('NEVER mixes a URL from one project with a key from another', () => {
    // Only the URL is configured — the tempting behaviour is to keep the
    // built-in key, which authenticates to nothing. Both must fall back.
    const urlOnly = resolveSupabaseTarget({ url: CLONE.url, ...fallbacks });
    expect(urlOnly.url).toBe(PRIME.url);
    expect(urlOnly.anonKey).toBe(PRIME.key);
    expect(urlOnly.source).toBe('fallback');
    expect(urlOnly.warning).toMatch(/half-configured/i);

    const keyOnly = resolveSupabaseTarget({ anonKey: CLONE.key, ...fallbacks });
    expect(keyOnly.url).toBe(PRIME.url);
    expect(keyOnly.anonKey).toBe(PRIME.key);
    expect(keyOnly.source).toBe('fallback');
    expect(keyOnly.warning).toMatch(/half-configured/i);

    // The resolved pair always belongs to one project, in every branch.
    for (const r of [urlOnly, keyOnly, resolveSupabaseTarget({ ...fallbacks })]) {
      expect(projectRefFromUrl(r.url)).toBe(projectRefFromAnonKey(r.anonKey));
    }
  });

  it('warns when a supplied pair belongs to two different projects', () => {
    const r = resolveSupabaseTarget({ url: CLONE.url, anonKey: PRIME.key, ...fallbacks });
    // Still honoured — the operator asked for it, and overriding their choice
    // would be a second silent surprise — but it is named on the console.
    expect(r.source).toBe('env');
    expect(r.url).toBe(CLONE.url);
    expect(r.anonKey).toBe(PRIME.key);
    expect(r.warning).toContain('cloneref000000000');
    expect(r.warning).toContain('primeref00000000');
  });

  it('says nothing about a pair it cannot check', () => {
    // A local stack has no ref in either half; that is not a mismatch.
    const r = resolveSupabaseTarget({
      url: 'http://localhost:54321',
      anonKey: 'local-development-key',
      ...fallbacks,
    });
    expect(r.source).toBe('env');
    expect(r.warning).toBeNull();
  });
});
