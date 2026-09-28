/**
 * The one place that decides which billing identity this build spends against.
 *
 * ## What the identity IS
 *
 * Aurixa Mission Control keys every purchase on a `billing_user_id` — a
 * workspace's stable handle, which travels as `?uid=` on the Aurixa Systems
 * pricing page and becomes the attribution on the Stripe session. Mission
 * Control resolves a uid against `clones` FIRST and `tenants` only if that
 * misses, so a uid is not a hint: it names exactly one workspace's balance,
 * and whatever is bought with it lands there.
 *
 * ## The defect this exists for
 *
 * This deployment's own identity — `npc-prime`, seeded by Mission Control
 * migration `20260714180000` — was compiled in as a literal default:
 *
 *     ((import.meta.env.VITE_AURIXA_BILLING_UID as string | undefined) ?? 'npc-prime')
 *
 * Every clone mirrored from this repository inherited that line, and Mission
 * Control published `VITE_AURIXA_BILLING_UID` to no clone at all — measured
 * 22 Sep 2026, all four live clones carried NULL in `clones.billing_user_id`
 * and nothing had ever written the column. So every clone's bundle carried the
 * PRIME's identity as its fallback, and a customer on a clone clicking "buy
 * more tokens" with no server-minted link available would have credited the
 * prime's balance: Stripe takes the money, a ledger row lands, and the number
 * that customer is looking at never moves.
 *
 * ## The pairing rule
 *
 * The same rule `turnstileSiteKey.ts` applies to the CAPTCHA widget, for the
 * same reason. A site key is the twin of a secret in one Supabase project; a
 * billing uid is the handle of the workspace that RUNS on one Supabase
 * project. So the built-in identity is used ONLY while this build talks to the
 * backend it belongs to. A fork or a clone pointed at its own project resolves
 * to NO identity and browses rather than buying against somebody else's
 * account — without anybody having to remember to unset anything.
 *
 * "No identity" is a real and safe state, not a broken one. The purchase link
 * a clone actually uses is minted server-side by Mission Control
 * (`/api/public/tokens/packs` → `topup_url`), which knows that clone's own
 * `billing_user_id`; this constant is the last-resort fallback for when that
 * mint is unavailable, and a browse-only pricing page is the right fallback
 * when the alternative is charging the wrong workspace.
 *
 * Mission Control publishes each clone `VITE_AURIXA_BILLING_UID` during
 * `syncing_env`, before the build — Vite inlines `VITE_*` at BUILD time, so an
 * identity that arrives later is one the bundle does not have.
 *
 * ## What each half actually guarantees
 *
 * Stated rather than assumed, because the two halves are not equally strong.
 *
 * The **published identity** is the guarantee. `readConfiguredUid` below reads
 * `import.meta.env.VITE_AURIXA_BILLING_UID` in the one form the bundler
 * substitutes, and it wins over the built-in unconditionally — so a clone
 * Mission Control has published to spends its own identity whatever anything
 * else resolves to.
 *
 * The **pairing check** is the fallback for a clone that was never published
 * to, and it is only as good as `SUPABASE_PROJECT_REF`. That value comes from
 * `integrations/supabase/env.ts`, which until 23 Sep 2026 read through
 * `readEnv(key)` — `import.meta?.env?.[key]` — a form no bundler replaces, so
 * every deployment resolved to its built-in fallback however its environment
 * was set. `npc-crm-independent` fixed its own copy first, and the fix could
 * not travel: cascades run from the prime outward, so the prime's broken copy
 * was the one they kept delivering. It reads statically here now
 * (`supabaseTarget.pure.ts` holds the per-deployment pair,
 * `buildTimeEnvReads.spec.ts` refuses any read a bundler cannot see through).
 *
 * One case is still invisible from here: a clone whose variables were dropped
 * AND whose built-in pair still names the prime resolves to the prime's
 * project, and so to the prime's identity. `shippedBackendIdentity.spec.ts` is
 * what keeps that pair the deployment's own — the same thing `env.ts`'s own
 * header says about the browser generally:
 *
 *     "Nothing in the browser can tell those apart, which is why the guarantee
 *      that a clone's build carries its OWN project belongs to the
 *      provisioner."
 *
 * So the pairing check is the fallback it was always meant to be, and nothing
 * here is written as though it were the guarantee.
 */
import { SUPABASE_PROJECT_REF } from "@/integrations/supabase/env";

/** This deployment's own workspace handle in Mission Control. */
const BUILT_IN_BILLING_UID: string | null = "npc-prime";

/** The Supabase project that workspace runs on — its twin. */
const BUILT_IN_BACKEND_REF: string | null = "dduzbchuswwbefdunfct";

/** The environment variable that carries this deployment's own identity. */
export const AURIXA_BILLING_UID_ENV = "VITE_AURIXA_BILLING_UID";

/** The customer-facing storefront. Never a Mission Control page: that is an
 *  operator console and a customer has no account on it. */
export const AURIXA_PRICING_BASE = "https://www.aurixasystems.com.au/pricing";

export type BillingIdentityResolution = {
  /** The uid to spend, or null when this build has none of its own. */
  uid: string | null;
  source: "env" | "built-in" | "unset";
  /** Operator-facing reason, present whenever `uid` is null. */
  warning: string | null;
};

/**
 * Resolve the billing identity. Exported and pure so the precedence is
 * testable without stubbing `import.meta`.
 */
export function resolveAurixaBillingUid(input: {
  configured?: string | null;
  builtInUid?: string | null;
  builtInBackendRef?: string | null;
  backendRef?: string | null;
}): BillingIdentityResolution {
  const configured =
    typeof input.configured === "string" ? input.configured.trim() : "";
  if (configured.length > 0) {
    return { uid: configured, source: "env", warning: null };
  }

  const builtIn =
    input.builtInUid === undefined ? BUILT_IN_BILLING_UID : input.builtInUid;
  if (!builtIn) {
    return {
      uid: null,
      source: "unset",
      warning: `${AURIXA_BILLING_UID_ENV} is not set. This deployment has no billing identity of its own, and it must never spend another workspace's.`,
    };
  }

  const builtInRef =
    input.builtInBackendRef === undefined
      ? BUILT_IN_BACKEND_REF
      : input.builtInBackendRef;
  const backendRef = input.backendRef === undefined ? null : input.backendRef;
  if (builtInRef && builtInRef !== backendRef) {
    return {
      uid: null,
      source: "unset",
      warning: `The built-in billing identity "${builtIn}" belongs to the workspace running on Supabase project "${builtInRef}", but this build talks to ${
        backendRef ? `"${backendRef}"` : "an unrecognised project"
      }. Purchase links will be browse-only until ${AURIXA_BILLING_UID_ENV} is set to this deployment's own identity.`,
    };
  }

  return { uid: builtIn, source: "built-in", warning: null };
}

/**
 * Read the configured identity.
 *
 * STATIC on purpose. Vite replaces the exact expression
 * `import.meta.env.VITE_AURIXA_BILLING_UID` with the value at BUILD time. A
 * dynamic lookup — `import.meta.env[name]` — is not an expression the bundler
 * can see through, so it is never replaced and reads `undefined` in a
 * production bundle however the environment is set. That exact mistake cost
 * the mirror repository its Turnstile widget: the site key was published, the
 * project rebuilt, and the bundle came out byte-identical.
 *
 * Do not refactor this into a helper that takes the name as an argument.
 * `AURIXA_BILLING_UID_ENV` above is the name for MESSAGES; this is the read.
 */
function readConfiguredUid(): string | undefined {
  try {
    const value = import.meta.env.VITE_AURIXA_BILLING_UID as string | undefined;
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

let resolved: BillingIdentityResolution | null = null;

/** Resolved once per module load, so the console says it once. */
export function aurixaBillingIdentity(): BillingIdentityResolution {
  if (!resolved) {
    resolved = resolveAurixaBillingUid({
      configured: readConfiguredUid(),
      backendRef: SUPABASE_PROJECT_REF,
    });
    if (resolved.warning) {
      console.error(`[billing] ${resolved.warning}`);
    }
  }
  return resolved;
}

/** This build's billing identity, or null. */
export function aurixaBillingUid(): string | null {
  return aurixaBillingIdentity().uid;
}

/**
 * The storefront URL for this deployment, carrying its credential where it
 * has one.
 *
 * Pure and exported so the "no credential" reading is testable: with no uid
 * this is the bare pricing page, which the storefront renders browse-only —
 * every price visible, no Buy button — rather than a checkout attributed to
 * somebody else.
 */
export function pricingUrlFor(uid: string | null, extraQuery?: string): string {
  const query = [uid ? `uid=${encodeURIComponent(uid)}` : "", extraQuery ?? ""]
    .filter(Boolean)
    .join("&");
  return query ? `${AURIXA_PRICING_BASE}?${query}` : AURIXA_PRICING_BASE;
}

/**
 * A stable per-deployment key for BROWSER-LOCAL caches.
 *
 * Deliberately not the billing uid, and deliberately never null. It keys
 * `localStorage`, so it must exist on a deployment with no billing identity,
 * and it must differ between deployments so one workspace's cached
 * entitlements cannot be read by another sharing a browser profile. The
 * Supabase project ref is exactly that: present on every build, different per
 * deployment, and not a credential.
 */
export function workspaceCacheKey(): string {
  return aurixaBillingUid() ?? SUPABASE_PROJECT_REF ?? "unknown-workspace";
}
