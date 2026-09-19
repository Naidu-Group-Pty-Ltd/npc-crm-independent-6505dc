/**
 * The rule: a surface that changes a client's record may not hold a private
 * list of the keys that record is read under.
 *
 * `ClientDetailsModal` reads `['secure-client-data', clientId, include]`. Four
 * surfaces wrote their own invalidation lists and not one of them named that
 * key, so a write landed, its toast fired, and the card kept the value it had
 * until it was closed and reopened. The 19 Sep 2026 clone audit reported it as
 * the follow-up date that would not appear; the Formara import's tabs and the
 * follow-up flag had the same fault and had not been reported yet.
 *
 * Nothing fails when an invalidation list is short — that is the whole problem,
 * and it is why this is a source-level guard rather than a behavioural test.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CLIENT_QUERY_KEYS } from '../invalidateClientQueries';

const root = join(__dirname, '..', '..', '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('the client invalidation list', () => {
  it('names the key the open client card actually reads', () => {
    // If `useSecureClientData` is ever re-keyed, this is the line that has to
    // move with it — and it will fail here rather than in production.
    const hook = readFileSync(join(root, 'src', 'hooks', 'useSecureClientData.ts'), 'utf8');
    expect(hook).toMatch(/queryKey:\s*\['secure-client-data'/);
    expect(CLIENT_QUERY_KEYS.scoped).toContain('secure-client-data');
  });

  it('names the cross-client lists a per-client value shows up in', () => {
    expect(CLIENT_QUERY_KEYS.lists).toContain('clients');
    expect(CLIENT_QUERY_KEYS.lists).toContain('client-tracker');
  });
});

describe('no surface keeps its own list', () => {
  /**
   * A file that invalidates the clients LIST is changing a client, so it must
   * also refresh that client's own record — and the only way to be sure it
   * refreshes all of it is to go through the shared helper.
   *
   * Two exemptions, both deliberate and both narrow: the helper itself, and a
   * file that invalidates `['clients']` while naming `secure-client-data` too
   * (it is already correct, whatever route it took).
   */
  const offenders = sourceFiles(join(root, 'src'))
    .filter((file) => !file.endsWith(join('lib', 'clients', 'invalidateClientQueries.ts')))
    .map((file) => ({ file, src: readFileSync(file, 'utf8') }))
    .filter(({ src }) => /invalidateQueries\(\s*\{\s*queryKey:\s*\['clients'\]/.test(src))
    .filter(({ src }) => !src.includes('invalidateClientQueries'))
    .filter(({ src }) => !src.includes("'secure-client-data'"))
    .map(({ file }) => file.slice(root.length + 1));

  it('finds files rather than trusting a list', () => {
    // The scan must be able to see the pattern at all; if this ever reports
    // that nothing in the codebase invalidates `['clients']`, the scan broke.
    const anyMatch = sourceFiles(join(root, 'src')).some((file) =>
      /invalidateQueries\(\s*\{\s*queryKey:\s*\['clients'\]/.test(readFileSync(file, 'utf8')),
    );
    expect(anyMatch).toBe(true);
  });

  it('leaves none behind', () => {
    expect(offenders).toEqual([]);
  });
});
