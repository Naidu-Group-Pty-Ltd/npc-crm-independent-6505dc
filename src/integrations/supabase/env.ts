/**
 * The one place that decides which Supabase project this build talks to.
 *
 * Both the URL and the publishable ("anon") key used to be written into 31
 * source files by hand. That is why this repository could not be pointed at
 * its own backend: changing `VITE_SUPABASE_URL` moved nothing, because almost
 * every caller ignored it and dialled the prime's project directly.
 *
 * ── The pairing rule ─────────────────────────────────────────────────────────
 *
 * The anon key is a JWT whose `ref` claim names the project it belongs to, so
 * a URL from one project and a key from another authenticate to nothing. They
 * are therefore resolved as a PAIR: either the environment supplies both, or
 * neither is taken from it. A half-configured environment falls back to the
 * built-in pair and says so loudly, because silently mixing them produces
 * 401s that look like an auth bug rather than a configuration one.
 *
 * ── Why the prime's values are still the fallback ────────────────────────────
 *
 * So that this change is a no-op upstream. A build with no Supabase variables
 * set behaves exactly as it did when the values were inlined; only a build
 * that sets them moves. That is what makes it safe to land in the internal
 * console and the client-facing deployment at the same time.
 *
 * ── The read is STATIC, and that is the whole of it ──────────────────────────
 *
 * Every name below is read as the literal expression `import.meta.env.VITE_X`.
 * Vite replaces that exact token sequence with the value at BUILD time. Put
 * anything between `import.meta` and `.env` — an optional chain, a bracket
 * index — and the sequence no longer matches, nothing is replaced, and the
 * read is a property access on a browser's real `import.meta`, which has no
 * `env`. It returns `undefined` forever, however the environment is set.
 *
 * This module used to read through `readEnv(key)` — `import.meta?.env?.[key]`
 * — and it cost every clone its own backend. Measured 19 Sep 2026 on
 * `npc-crm-independent`: Mission Control provisioned Supabase project
 * `qvuwrvwzjyigptmnijyb`, wrote the admin's password into it, published all
 * five `VITE_*` variables to the hosting project and rebuilt — and the
 * deployed bundle carried neither the URL nor the key. The browser resolved
 * to the fallback and authenticated against the PRIME, where that password
 * does not exist, so the reported symptom was "I cannot log in to the new
 * clone with the credentials Mission Control issued". Loading the live page
 * in a real Chromium showed it opening a realtime socket to
 * `dduzbchuswwbefdunfct` with the prime's anon key. `preflight-property-group`
 * does the same thing, so this was true of every clone ever provisioned.
 *
 * Two things made it invisible. The fallback is the PRIME's own pair, so the
 * one deployment anybody tests on — the prime — is correct by accident. And
 * `resolveSupabaseTarget` warns on a HALF-configured environment and says
 * nothing when neither value arrives, because that is the prime's ordinary
 * state; a clone whose variables were dropped looks exactly like the prime.
 * Nothing in the browser can tell those apart, which is why the guarantee that
 * a clone's build carries its OWN project belongs to the provisioner, asserted
 * against the deployed bundle rather than against the variables it set.
 *
 * `turnstileSiteKey.ts` fixed this same defect for its own variable and cites
 * THIS module as the precedent for the pairing rule. It was right about the
 * rule and wrong about the read; the read is fixed here now, and
 * `buildTimeEnvReads.spec.ts` fails on any form a bundler cannot see through.
 *
 * One consequence worth naming: while this was broken `SUPABASE_PROJECT_REF`
 * resolved to the prime on every clone, so `turnstileSiteKey`'s pairing rule
 * — "the built-in widget is used only while the build talks to the project its
 * secret lives in" — was being fed a lie and handed each clone the PRIME's
 * widget. The rule was intact; its input was not.
 */

/** The project this repository has always shipped against. */
const FALLBACK_URL = 'https://dduzbchuswwbefdunfct.supabase.co';
const FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk';

/**
 * Trim to a usable value, or `undefined`. Takes the value, never the name:
 * a helper that took the name is what made the read dynamic in the first
 * place. Each `import.meta.env.VITE_X` below is written out in full, at the
 * call site, because that is the only form the bundler replaces.
 */
function usable(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** This build's Supabase URL, inlined at build time or absent. */
function readConfiguredUrl(): string | undefined {
  try {
    return usable(import.meta.env.VITE_SUPABASE_URL);
  } catch {
    return undefined;
  }
}

/**
 * This build's publishable key. Two names, because the variable was renamed
 * upstream and both are still published; the newer one wins.
 */
function readConfiguredAnonKey(): string | undefined {
  try {
    return (
      usable(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ??
      usable(import.meta.env.VITE_SUPABASE_ANON_KEY)
    );
  } catch {
    return undefined;
  }
}

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

/**
 * Resolve the pair. Exported and pure so the precedence is unit-testable
 * without stubbing `import.meta`.
 */
export function resolveSupabaseTarget(input: {
  url?: string;
  anonKey?: string;
  fallbackUrl?: string;
  fallbackAnonKey?: string;
}): { url: string; anonKey: string; source: 'env' | 'fallback'; warning: string | null } {
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

const resolved = resolveSupabaseTarget({
  url: readConfiguredUrl(),
  anonKey: readConfiguredAnonKey(),
});

if (resolved.warning) {
  console.error(`[supabase/env] ${resolved.warning}`);
}

/**
 * Base URL of the Supabase project this build talks to, with any trailing
 * slash removed. Callers build `${SUPABASE_URL}/functions/v1/...`, so a
 * trailing slash would produce a double slash on every one of them.
 */
export const SUPABASE_URL = resolved.url.replace(/\/+$/, '');

/** Publishable (anon) key for that same project. Always paired with the URL. */
export const SUPABASE_ANON_KEY = resolved.anonKey;

/** Project ref of that same project, derived rather than typed a second time. */
export const SUPABASE_PROJECT_REF = projectRefFromUrl(resolved.url);

/** Whether the target came from the environment or from the built-in default. */
export const SUPABASE_TARGET_SOURCE = resolved.source;
