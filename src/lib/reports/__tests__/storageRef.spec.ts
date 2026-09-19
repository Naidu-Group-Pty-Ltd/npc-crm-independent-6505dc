/**
 * Reading a stored file reference.
 *
 * Every shape below is one that is actually in the database today — checked by
 * querying it, not imagined. The bug this fixes is that two of the four were
 * passed to the storage client unchanged, as if a URL were an object key.
 */
import { describe, expect, it } from 'vitest';

import { bucketCandidates, isExternalUrl, parseStorageRef } from '../storageRef';

const KEY = 'generated/2026-07-08/9f1c-report.pdf';

describe('parseStorageRef', () => {
  it('passes a bare storage key through', () => {
    expect(parseStorageRef(KEY)).toEqual({ bucket: null, path: KEY });
  });

  /**
   * 263 rows of `investment_reports.pdf_url` look like this. The bucket is
   * private, so the URL itself resolves for nobody — but the key inside it is
   * good, which is what makes those rows recoverable.
   */
  it('extracts the key from a public object URL', () => {
    expect(parseStorageRef(
      `https://dduzbchuswwbefdunfct.supabase.co/storage/v1/object/public/investment-reports/${KEY}`,
    )).toEqual({ bucket: 'investment-reports', path: KEY });
  });

  it('extracts the key from a signed URL, dropping the token', () => {
    expect(parseStorageRef(
      `https://x.supabase.co/storage/v1/object/sign/client-files/${KEY}?token=eyJhbGciOi.abc`,
    )).toEqual({ bucket: 'client-files', path: KEY });
  });

  it('extracts the key from an authenticated object URL', () => {
    expect(parseStorageRef(
      `https://x.supabase.co/storage/v1/object/authenticated/client-files/${KEY}`,
    )).toEqual({ bucket: 'client-files', path: KEY });
  });

  it('extracts the key from a bare object URL', () => {
    expect(parseStorageRef(
      `https://x.supabase.co/storage/v1/object/client-files/${KEY}`,
    )).toEqual({ bucket: 'client-files', path: KEY });
  });

  /** A key is percent-encoded in a URL and must not be when it goes back. */
  it('decodes the key it took out of a URL', () => {
    expect(parseStorageRef(
      'https://x.supabase.co/storage/v1/object/public/client-files/reports/Smith%20%26%20Co.pdf',
    )).toEqual({ bucket: 'client-files', path: 'reports/Smith & Co.pdf' });
  });

  it('survives a malformed escape rather than throwing', () => {
    const ref = parseStorageRef('https://x.supabase.co/storage/v1/object/public/b/bad%ZZ.pdf');
    expect(ref.bucket).toBe('b');
    expect(ref.path).toBe('bad%ZZ.pdf');
  });

  /** Legacy rows stored the whole `secureStorageUpload` response. */
  it('unwraps a stringified upload result, taking the bucket from fullPath', () => {
    expect(parseStorageRef(JSON.stringify({ path: KEY, fullPath: `client-files/${KEY}` })))
      .toEqual({ bucket: 'client-files', path: KEY });
  });

  it('unwraps one that carries only a path', () => {
    expect(parseStorageRef(JSON.stringify({ path: KEY })))
      .toEqual({ bucket: null, path: KEY });
  });

  it('treats a brace that is not JSON as a key', () => {
    expect(parseStorageRef('{not json').path).toBe('{not json');
  });

  it('has nothing to say about an empty reference', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(parseStorageRef(empty)).toEqual({ bucket: null, path: '' });
    }
  });

  /**
   * A URL somewhere else entirely. There is no key to extract, and handing the
   * caller a "path" that is really a URL is how this bug started — so the URL
   * comes back as-is and `isExternalUrl` is how a caller notices.
   */
  it('does not invent a key for a URL on another host', () => {
    const external = 'https://cdn.example.com/report.pdf';
    expect(parseStorageRef(external)).toEqual({ bucket: null, path: external });
    expect(isExternalUrl(external)).toBe(true);
    expect(isExternalUrl(KEY)).toBe(false);
  });
});

describe('bucketCandidates', () => {
  it('trusts the bucket the reference named', () => {
    expect(bucketCandidates({ bucket: 'investment-reports', path: KEY }, 'client-files', 'other'))
      .toEqual(['investment-reports']);
  });

  it('tries the preferred bucket then the fallback when the reference named none', () => {
    expect(bucketCandidates({ bucket: null, path: KEY }, 'client-files', 'investment-reports'))
      .toEqual(['client-files', 'investment-reports']);
  });

  it('does not try the same bucket twice', () => {
    expect(bucketCandidates({ bucket: null, path: KEY }, 'client-files', 'client-files'))
      .toEqual(['client-files']);
  });
});
