/**
 * The declaration diff that decides which functions a `config.toml`-only push
 * redeploys.
 *
 * A declaration only reaches production if the function it describes is
 * redeployed, and the changed-function list is otherwise built entirely from
 * `supabase/functions/**` paths — so a config-only push deploys nothing unless
 * this reports the function. That is the mechanism behind the whole drift
 * class, and `request_timeout` was found sitting in it: raising the number
 * without this would have changed the file and shipped nothing.
 */
import { describe, expect, it } from 'vitest';

import { parseDeclarations } from '../../../../scripts/deploy/verify-jwt-changed.mjs';

const changed = (before: string, after: string) => {
  const b = parseDeclarations(before);
  const a = parseDeclarations(after);
  return [...new Set([...b.keys(), ...a.keys()])]
    .filter((fn) => b.get(fn) !== a.get(fn))
    .sort();
};

const block = (name: string, jwt: string, timeout?: number) =>
  `[functions.${name}]\nverify_jwt = ${jwt}\n`
  + (timeout === undefined ? '' : `request_timeout = ${timeout}\n`);

describe('parseDeclarations', () => {
  it('reports a request_timeout change', () => {
    // Audit item 34: the gateway was cutting the request before the function
    // was allowed to answer. Raising it must redeploy the function.
    expect(
      changed(block('compare-investment-reports', 'true', 120),
              block('compare-investment-reports', 'true', 180)),
    ).toEqual(['compare-investment-reports']);
  });

  it('still reports a verify_jwt change', () => {
    expect(changed(block('a', 'true'), block('a', 'false'))).toEqual(['a']);
  });

  it('reads keys written after verify_jwt', () => {
    // Scanning used to stop at the first key found, and request_timeout is
    // always written after verify_jwt in this file — so it was unreachable.
    expect(parseDeclarations(block('a', 'true', 180)).get('a'))
      .toBe('verify_jwt=true,request_timeout=180');
  });

  it('reports an added or removed timeout, not just an edited one', () => {
    expect(changed(block('a', 'true'), block('a', 'true', 180))).toEqual(['a']);
    expect(changed(block('a', 'true', 180), block('a', 'true'))).toEqual(['a']);
  });

  it('stays quiet when nothing about the declaration changed', () => {
    const before = `# a comment\n${block('a', 'true', 120)}`;
    const after = `# a different comment\n${block('a', 'true', 120)}`;
    expect(changed(before, after)).toEqual([]);
  });

  it('reports an added or removed block', () => {
    expect(changed('', block('a', 'true'))).toEqual(['a']);
    expect(changed(block('a', 'true'), '')).toEqual(['a']);
  });

  it('ignores keys outside a [functions.X] block', () => {
    const toml = `[api]\nrequest_timeout = 999\n\n${block('a', 'true', 120)}`;
    expect(parseDeclarations(toml).get('a')).toBe('verify_jwt=true,request_timeout=120');
    expect(parseDeclarations(toml).has('api')).toBe(false);
  });
});
