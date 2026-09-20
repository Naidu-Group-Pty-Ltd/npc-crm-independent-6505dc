/**
 * Which Supabase project a build talks to — the decision, with no environment
 * in it.
 *
 * Split out of `env.ts` so the same rule can run in two places that cannot
 * share a runtime: the browser, where the values arrive inlined by the
 * bundler, and `vite.config.ts`, which writes the resolved answer into
 * `version.json` at build time so Mission Control can read it back without
 * guessing from five megabytes of minified JavaScript.
 *
 * Nothing here reads `import.meta`. That is the whole reason it is a separate
 * file: `env.ts` keeps the reads (which must be static — see its header) and
 * this keeps the judgement, so the manifest and the running client cannot
 * disagree about what this build resolved.
 */

/**
 * THIS deployment's own project.
 *
 * It used to be the PRIME's, `dduzbchuswwbefdunfct`, under the comment "the
 * project this repository has always shipped against" — a sentence that is
 * true in the repository it was written in and became false the moment it was
 * cascaded here. This module's own header, and `env.ts`'s above it, already
 * describe what that cost: a clone whose `VITE_*` variables never arrived
 * resolved to the fallback and authenticated against the prime, and looked
 * exactly like a healthy prime while doing it.
 *
 * The fallback is the path a deployment takes when nobody has configured it,
 * which is the ordinary state of a new one. It has to be the deployment's own.
 * `src/lib/__tests__/shippedBackendIdentity.spec.ts` is what keeps it so.
 */
export const FALLBACK_URL = 'https://qvuwrvwzjyigptmnijyb.supabase.co';
export const FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2dXdydnd6anlpZ3B0bW5panliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3OTQzMTgsImV4cCI6MjEwNTM3MDMxOH0.PxEpbu_uTJRjL4mdzfmW98SQEYFJB-IKP5vMLqG9BB0';

/** The `ref` sub-domain of a Supabase project URL, or null if it is not one. */
export function projectRefFromUrl(url: string): string | null {
  const match = /^https?:\/\/([a-z0-9]+)\.supabase\.(co|in|net)/i.exec(url.trim());
  return match ? match[1] : null;
}

/** The `ref` claim of a Supabase anon JWT, or null if it cannot be read. */
export function projectRefFromAnonKey(key: string): string | null {
  try {
    const payload = key.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const ref = (JSON.parse(json) as { ref?: unknown }).ref;
    return typeof ref === 'string' ? ref : null;
  } catch {
    return null;
  }
}

/** What a build resolved, and whether it came from the environment. */
export type SupabaseTarget = {
  url: string;
  anonKey: string;
  source: 'env' | 'fallback';
  warning: string | null;
};

/**
 * Resolve the pair. Exported and pure so the precedence is unit-testable
 * without stubbing `import.meta`.
 */
export function resolveSupabaseTarget(input: {
  url?: string;
  anonKey?: string;
  fallbackUrl?: string;
  fallbackAnonKey?: string;
}): SupabaseTarget {
  const fallbackUrl = input.fallbackUrl ?? FALLBACK_URL;
  const fallbackAnonKey = input.fallbackAnonKey ?? FALLBACK_ANON_KEY;
  const { url, anonKey } = input;

  if (url && anonKey) {
    const urlRef = projectRefFromUrl(url);
    const keyRef = projectRefFromAnonKey(anonKey);
    // A mismatch is always a configuration error, never a runtime one — say so
    // here rather than letting every request fail with an opaque 401.
    const warning =
      urlRef && keyRef && urlRef !== keyRef
        ? `Supabase misconfiguration: VITE_SUPABASE_URL names project "${urlRef}" but the publishable key belongs to "${keyRef}". Requests will be rejected until they match.`
        : null;
    return { url, anonKey, source: 'env', warning };
  }

  if (url || anonKey) {
    return {
      url: fallbackUrl,
      anonKey: fallbackAnonKey,
      source: 'fallback',
      warning: `Supabase is half-configured: ${url ? 'VITE_SUPABASE_URL is set but no publishable key is' : 'a publishable key is set but VITE_SUPABASE_URL is not'}. The URL and key are a matched pair, so BOTH built-in defaults are being used instead of mixing them.`,
    };
  }

  return { url: fallbackUrl, anonKey: fallbackAnonKey, source: 'fallback', warning: null };
}
