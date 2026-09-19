/**
 * The one place that decides which Turnstile widget this build renders.
 *
 * A Turnstile widget IS a (site key, secret) pair. The site key is public and
 * is rendered by the browser; the secret lives in the backend and is what
 * `siteverify` checks the resulting token against. A token minted by one
 * widget does not verify against another widget's secret, and — this is the
 * part that matters — a token minted by ONE tenant's widget verifies perfectly
 * well against ANOTHER tenant's backend if both were handed the same pair.
 * Cloudflare returns the hostname the challenge was solved on and no login
 * handler in this repository reads it.
 *
 * The site key used to be a literal in `components/auth/TurnstileWidget.tsx`.
 * That is fine for this deployment, whose widget it is, and it is exactly
 * wrong for every deployment mirrored from this one: `npc-client-dashboard`
 * inherited the literal verbatim and rendered this deployment's widget on a
 * different tenant's login page, which is one credential, one rotation and one
 * domain allowlist spanning tenants that are supposed to be separate.
 *
 * ── The pairing rule ────────────────────────────────────────────────────────
 *
 * `integrations/supabase/env.ts` already reasons about this shape for the
 * Supabase URL and its anon key. The same rule settles it here: the built-in
 * site key is used ONLY when this build talks to the backend that key's secret
 * lives in. A fork pointed at its own Supabase project therefore stops using
 * this widget without anybody having to remember to unset anything — the
 * failure mode becomes a visible "not configured" rather than a silent share.
 *
 * Aurixa Mission Control mints each clone its own widget and publishes the
 * site key as `VITE_TURNSTILE_SITE_KEY`.
 */
import { SUPABASE_PROJECT_REF } from '@/integrations/supabase/env';

/** This deployment's own widget. */
const BUILT_IN_SITE_KEY: string | null = '0x4AAAAAAChQyb0ZxBORhxWq';

/** The backend that widget's `TURNSTILE_SECRET_KEY` lives in — its twin. */
const BUILT_IN_BACKEND_REF: string | null = 'dduzbchuswwbefdunfct';

/** The environment variable that carries this deployment's own site key. */
export const TURNSTILE_SITE_KEY_ENV = 'VITE_TURNSTILE_SITE_KEY';

export type TurnstileSiteKeyResolution = {
  /** The site key to render, or null when this build has none. */
  siteKey: string | null;
  source: 'env' | 'built-in' | 'unset';
  /** Operator-facing reason, present whenever `siteKey` is null. */
  warning: string | null;
};

/**
 * Resolve the site key. Exported and pure so the precedence is testable
 * without stubbing `import.meta`.
 */
export function resolveTurnstileSiteKey(input: {
  configured?: string | null;
  builtInSiteKey?: string | null;
  builtInBackendRef?: string | null;
  backendRef?: string | null;
}): TurnstileSiteKeyResolution {
  const configured = typeof input.configured === 'string' ? input.configured.trim() : '';
  if (configured.length > 0) {
    return { siteKey: configured, source: 'env', warning: null };
  }

  const builtIn = input.builtInSiteKey === undefined ? BUILT_IN_SITE_KEY : input.builtInSiteKey;
  if (!builtIn) {
    return {
      siteKey: null,
      source: 'unset',
      warning: `${TURNSTILE_SITE_KEY_ENV} is not set. This deployment has no Turnstile widget of its own, and it must never render another tenant's.`,
    };
  }

  const builtInRef =
    input.builtInBackendRef === undefined ? BUILT_IN_BACKEND_REF : input.builtInBackendRef;
  const backendRef = input.backendRef === undefined ? null : input.backendRef;
  if (builtInRef && builtInRef !== backendRef) {
    return {
      siteKey: null,
      source: 'unset',
      warning: `The built-in Turnstile site key is the twin of the secret in Supabase project "${builtInRef}", but this build talks to ${backendRef ? `"${backendRef}"` : 'an unrecognised project'}. Set ${TURNSTILE_SITE_KEY_ENV} to this deployment's own site key.`,
    };
  }

  return { siteKey: builtIn, source: 'built-in', warning: null };
}

/**
 * Read the configured site key.
 *
 * STATIC on purpose. Vite replaces the exact expression
 * `import.meta.env.VITE_TURNSTILE_SITE_KEY` with the value at BUILD time. A
 * dynamic lookup — `import.meta.env[name]`, which is what this used to do — is
 * not an expression the bundler can see through, so it is never replaced and
 * reads `undefined` in a production bundle however the environment is set.
 *
 * It cost the mirror repository a silent failure: Mission Control minted that
 * deployment's own widget, published `VITE_TURNSTILE_SITE_KEY` to its hosting
 * project and rebuilt, and the bundle came out BYTE-IDENTICAL. Nothing about
 * the deployment was wrong; the read was.
 *
 * Do not refactor this back into a helper that takes the name as an argument.
 * `TURNSTILE_SITE_KEY_ENV` below is the name for MESSAGES; this is the read.
 */
function readConfiguredSiteKey(): string | undefined {
  try {
    const value = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

let resolved: TurnstileSiteKeyResolution | null = null;

/** Resolved once per module load, so the console says it once. */
export function turnstileSiteKey(): TurnstileSiteKeyResolution {
  if (!resolved) {
    resolved = resolveTurnstileSiteKey({
      configured: readConfiguredSiteKey(),
      backendRef: SUPABASE_PROJECT_REF,
    });
    if (resolved.warning) {
      console.error(`[turnstile] ${resolved.warning}`);
    }
  }
  return resolved;
}
