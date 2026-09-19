/**
 * The edge runtime's reading of the CRM provider.
 *
 * Split from `crmProvider.pure.ts` for one reason: that file is imported by the
 * browser (`src/lib/crm/crmProvider.ts`), which is the convention this
 * repository already uses for `_shared/workflow/*` — "one engine serves three
 * callers … `src/lib/workflow/*` are one-line shims onto it". A `.pure.ts` that
 * names `Deno` is not importable from a Vite bundle, so the environment read —
 * the ONE thing that genuinely differs between the two runtimes — lives here
 * and the rule lives there, stated once.
 */
import {
  crmProviderMismatchHeaderName,
  resolveCrmProvider,
  resolveCrmProviderFromEnv,
  GOHIGHLEVEL_CREDENTIAL_NAMES,
  CRM_PROVIDER_ENV,
  type CrmProvider,
  type CrmProviderResolution,
} from "./crmProvider.pure.ts";

/**
 * Materialise the handful of names the resolver reads.
 *
 * `Deno.env` is a reader, not a record, and `Deno.env.toObject()` would hand a
 * pure module every secret this project holds so it could look at five of
 * them. Naming the five is the same instinct as `aml-idv-retention`
 * enumerating FIXED keys: what is not named is not passed, so a future secret
 * cannot arrive somewhere it was never meant to be read.
 */
function envObject(env: {
  get(key: string): string | undefined;
}): Record<string, string | undefined> {
  const names = [CRM_PROVIDER_ENV, ...GOHIGHLEVEL_CREDENTIAL_NAMES.flat()];
  const out: Record<string, string | undefined> = {};
  for (const name of names) out[name] = env.get(name);
  return out;
}

export {
  CRM_PROVIDER_ENV,
  DEFAULT_CRM_PROVIDER,
  hasGoHighLevelCredentials,
  isNativeCrm,
  resolveCrmProvider,
  resolveCrmProviderFromEnv,
} from "./crmProvider.pure.ts";
export type { CrmProvider, CrmProviderResolution } from "./crmProvider.pure.ts";

let cached: CrmProviderResolution | null = null;

/**
 * This deployment's provider, resolved once per isolate.
 *
 * The warning is logged on first read rather than on every call, so a mistyped
 * value says so once in the function log instead of once per request.
 */
export function crmProvider(
  env: { get(key: string): string | undefined } = Deno.env,
): CrmProviderResolution {
  if (!cached) {
    // The credential-derived default, not the blunt constant: a deployment
    // holding a live GoHighLevel account must not become `native` because
    // nobody typed a word into a secrets panel.
    cached = resolveCrmProviderFromEnv(envObject(env));
    if (cached.warning) console.error(`[crm] ${cached.warning}`);
  }
  return cached;
}

/** This deployment's provider word, for stamping onto a response. */
export function servingCrmProvider(): CrmProvider {
  return crmProvider().provider;
}

/**
 * Refuse a request that reached the wrong provider's function.
 *
 * `crm-*` functions are deployed to every clone — the backend drain replicates
 * the prime's whole function set — so a GHL deployment can reach `crm-calendar`
 * by nothing worse than a stale bundle. Answering it normally would write
 * appointments into tables that deployment's operators never look at, which is
 * worse than refusing: a silent second system is how two systems come to
 * disagree about the same customer.
 *
 * Returns null when the call is legitimate.
 */
export function refuseWrongProvider(
  expected: CrmProvider,
  corsHeaders: Record<string, string>,
): Response | null {
  const actual = servingCrmProvider();
  if (actual === expected) return null;
  return new Response(
    JSON.stringify({
      success: false,
      error: `This deployment's CRM provider is "${actual}"; this function serves "${expected}".`,
      provider: actual,
      code: "crm_provider_mismatch",
    }),
    {
      status: 409,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        [crmProviderMismatchHeaderName]: actual,
      },
    },
  );
}
