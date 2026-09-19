/**
 * A stand-in for `https://deno.land/x/djwt`, for Vitest only.
 *
 * `_shared/jwt.ts` is a Deno module and djwt is a Deno-only dependency with no
 * `node_modules` copy to map onto — the same situation as the `unpdf` stub
 * beside this one, and the reason the existing `npm:` / `esm.sh` aliases do
 * not help: this specifier is a `deno.land` URL.
 *
 * It reaches the test runner only as a transitive import. `clientAccess.ts` →
 * `authz.ts` → `auth_v2.ts` → `jwt.ts`, and a test of
 * `canAccessAllOf` (audit item 36) needs that chain to LOAD without ever
 * signing or verifying anything.
 *
 * So every export throws. If a test ever genuinely needs JWT behaviour it will
 * say so loudly here rather than quietly passing against a fake.
 */
const unavailable = (name: string) => () => {
  throw new Error(
    `djwt.${name} is stubbed in tests. If a test needs real JWT behaviour, `
    + 'give it a real implementation rather than extending this stub.',
  );
};

export const create = unavailable('create');
export const verify = unavailable('verify');
export const decode = unavailable('decode');
export const getNumericDate = unavailable('getNumericDate');

export type Header = Record<string, unknown>;
export type Payload = Record<string, unknown>;
