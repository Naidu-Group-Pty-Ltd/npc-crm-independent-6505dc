/**
 * The one module that decides where this deployment's CRM lives.
 *
 * Measured on the prime, 19 Sep 2026: 235 files under `src/` and 142 under
 * `supabase/functions/` name GoHighLevel, and **41 edge functions call
 * `services.leadconnectorhq.com` directly**. Four surfaces carry the tie-up:
 *
 *   | surface        | today                                                        |
 *   | -------------- | ------------------------------------------------------------ |
 *   | Clients        | `manage-client-data` / `get-client-data` — ZERO GHL API refs; |
 *   |                | already Supabase. GHL enters only as `sync-client-to-ghl`.    |
 *   | Client Tracker | reads the `ghl_*` mirrors, writes stage through GHL.          |
 *   | Conversations  | reads `ghl_conversations`, sends through `send-ghl-message`.  |
 *   | Calendar       | **live GHL on every read. No calendar table exists at all.**  |
 *
 * A CRM-independent deployment answers all four out of its own Postgres. That
 * is a substitution, not a deletion: the surfaces stay, the provider behind
 * them changes.
 *
 * ── Why a provider and not a fork ───────────────────────────────────────────
 *
 * This repository already reasons about swappable back-ends four times over —
 * `GEOCODER_PROVIDERS`, `AMENITY_PROVIDERS`, `COMMUTE_PROVIDERS`,
 * `STREET_IMAGERY_PROVIDERS` — and the rule it arrived at there is the rule
 * here: the default names YESTERDAY'S behaviour rather than the new one, so a
 * deployment that has never heard of this setting degrades to what it already
 * did rather than to nulls. Ripping GHL out of a clone's tree instead would
 * stop every prime fix cascading to it, which is the defect
 * `npc-client-dashboard` already lives with (`MODULES_TO_CLONES.md`).
 *
 * ── Three rules ─────────────────────────────────────────────────────────────
 *
 * **The vocabulary is an ALLOW-LIST and it fails to this deployment's own
 * default.** `payingCanUnlock` is the precedent and the reason is the same: a
 * rule written as `value !== 'native'` answers YES to every word this build has
 * never heard of, including the empty string a missing variable reads as. Here
 * that would send four surfaces at a GoHighLevel account this deployment does
 * not have. So exactly two words resolve, and everything else is
 * `DEFAULT_CRM_PROVIDER` WITH A NAMED REASON — never a silent third state.
 *
 * **`native` is a statement about this deployment, never about a tenant.** It
 * is resolved from the environment once per isolate. There is no per-user,
 * per-role or per-request path into it, because a CRM that is native for one
 * reader and GHL for another is two systems disagreeing about the same
 * customer.
 *
 * **Who served the request travels in the answer.** Every CRM response carries
 * `provider`, and the browser compares it with its own build-time reading. A
 * front end built `native` against a backend still on `ghl` renders a page
 * whose every list is empty and whose every write 404s, and the two halves
 * deploy separately — `VERIFY_JWT.md` records what a declaration and a
 * production that disagree cost last time. It is cheap to carry and it is the
 * only thing that catches a half-flipped deployment.
 */

export type CrmProvider = "ghl" | "native";

/**
 * This repository's default, and it is `native` on purpose.
 *
 * In the PRIME the safe default would be `ghl` — the rule every provider chain
 * here already follows, "degrade to yesterday's behaviour, not to nulls". This
 * is not the prime. This repository IS the CRM-independent deployment: it is
 * provisioned with no `GOHIGHLEVEL_*` secret of any kind, so a fallback to
 * `ghl` could not reach a CRM at all. It would render four surfaces whose every
 * read fails against a vendor this deployment has no account with — an outage
 * dressed as a configuration default.
 *
 * So the safe default here is the opposite word, for the same reason. `ghl`
 * stays spellable rather than being deleted: it is the rollback, and it is what
 * makes a prime cascade that touches a GHL path still merge instead of
 * conflicting.
 */
export const DEFAULT_CRM_PROVIDER: CrmProvider = "native";

/**
 * The variable that carries the choice into an edge function.
 *
 * The browser's twin is `VITE_CRM_PROVIDER` — a different name for the same
 * decision, because Vite only inlines what is prefixed `VITE_`. Both must be
 * set to the same word on a deployment; `crmProviderMismatch` in the browser
 * module is what notices when they are not.
 */
export const CRM_PROVIDER_ENV = "CRM_PROVIDER";

/**
 * The header a CRM function stamps with the provider that actually served it.
 *
 * A header rather than a body field, for the reason `VERIFICATION_BROKER.md`
 * already paid for: "who refused is read from a header … rather than guessed
 * from a body, because both ends answer 401 with similar JSON and send an
 * operator to opposite remedies". A provider mismatch and an ordinary
 * application error are exactly that pair — both are a non-2xx with a
 * `{success:false, error}` body, and they send an operator to opposite
 * remedies (rebuild the bundle vs. read the stack trace).
 */
export const crmProviderMismatchHeaderName = "x-crm-provider";

/** The only two words that resolve. Anything else is not a third option. */
const KNOWN_PROVIDERS: readonly CrmProvider[] = ["ghl", "native"];

export type CrmProviderResolution = {
  provider: CrmProvider;
  /** `configured` only when the environment named a word this build knows. */
  source: "configured" | "default";
  /**
   * Operator-facing, and present exactly when a value was supplied that this
   * build does not recognise. A silent fallback is how a typo becomes a
   * fleet-wide outage nobody can name.
   */
  warning: string | null;
};

/**
 * Resolve the provider from a raw environment reading.
 *
 * Pure, so the precedence is testable without a Deno environment. Case and
 * surrounding whitespace are forgiven — `"Native"` and `" native "` are the
 * word — because an operator typing into a secrets panel is not writing code.
 * Nothing else is forgiven.
 */
export function resolveCrmProvider(
  raw: string | null | undefined,
  envName: string = CRM_PROVIDER_ENV,
): CrmProviderResolution {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (value.length === 0) {
    return { provider: DEFAULT_CRM_PROVIDER, source: "default", warning: null };
  }

  if ((KNOWN_PROVIDERS as readonly string[]).includes(value)) {
    return {
      provider: value as CrmProvider,
      source: "configured",
      warning: null,
    };
  }

  return {
    provider: DEFAULT_CRM_PROVIDER,
    source: "default",
    warning:
      `${envName} is set to "${raw}", which this build does not recognise. ` +
      `Falling back to "${DEFAULT_CRM_PROVIDER}". The only accepted values are ` +
      `${KNOWN_PROVIDERS.map((p) => `"${p}"`).join(" and ")}.`,
  };
}

/**
 * True when a resolution names a CRM that lives in this deployment's Postgres.
 *
 * Takes the resolution rather than reading the environment, so the browser and
 * the edge runtime can both use it. The environment read is the one thing that
 * differs between the two and it lives outside this module by design — this
 * file is `.pure.ts` and names neither `Deno` nor `import.meta`.
 */
export function isNativeCrm(resolution: CrmProviderResolution): boolean {
  return resolution.provider === "native";
}

/**
 * THE SERVER'S DEFAULT IS THE CREDENTIALS, NOT A CONSTANT.
 *
 * `resolveCrmProvider` above answers from one string, which is all the BROWSER
 * can ever have: a bundle cannot see a project secret, so it cannot know
 * whether this deployment holds a GoHighLevel account. Defaulting to `native`
 * there is right.
 *
 * On the server it is not enough. `DEFAULT_CRM_PROVIDER` is `native`, so a
 * deployment that holds a live GoHighLevel account and has simply never set
 * `CRM_PROVIDER` would resolve to `native` — silently moving a tenant's
 * conversations to a different system of record because nobody typed a word
 * into a secrets panel. A CRM must not change identity by omission.
 *
 * So where the environment is readable, an unset `CRM_PROVIDER` is answered by
 * what the deployment actually holds. An EXPLICIT setting still wins: a
 * configured `ghl` with no key stays `ghl` and the absence is reported
 * separately, because "configuration is not reachability" and the inverse is
 * just as wrong — hiding a broken integration behind a working-looking one.
 *
 * Measured on this clone 19 Sep 2026: no `GOHIGHLEVEL_*` secret is set, and
 * the fleet's secret policy carries no forward row for those names, so no
 * clone has ever been given them. `native` is derived here rather than needing
 * to be configured, and the prime keeps `ghl` without being configured either.
 */
export const GOHIGHLEVEL_CREDENTIAL_NAMES = [
  ["GOHIGHLEVEL_API_KEY", "GOHIGHLEVEL_LOCATION_ID"],
  ["GOHIGHLEVEL_API_KEY_NEW", "GOHIGHLEVEL_LOCATION_ID_NEW"],
] as const;

type CrmEnv = Readonly<Record<string, string | undefined>>;

/** `''` is not a secret. */
function hasValue(env: CrmEnv, name: string): boolean {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Whether this deployment can reach a GoHighLevel account at all.
 *
 * Both halves of a pair are required — a key with no location id addresses no
 * account, a location id with no key authorises nothing — which is the rule
 * `airtableListingsRoute` states as "a token with no base id is unconfigured,
 * never brokered". The `_NEW` pair is an ALTERNATIVE rather than an addition,
 * because the prime carries both spellings mid-rotation and demanding all four
 * would report a correctly-rotated deployment as uncredentialled.
 */
export function hasGoHighLevelCredentials(env: CrmEnv): boolean {
  return GOHIGHLEVEL_CREDENTIAL_NAMES.some((pair) =>
    pair.every((name) => hasValue(env, name)),
  );
}

export type CrmProviderEnvResolution = CrmProviderResolution & {
  /**
   * Whether the RESOLVED provider's credentials are present.
   *
   * Never a veto, and deliberately a separate field: a `ghl` deployment with
   * no key is a real and reportable state — it is what the prime looks like
   * the moment a key is rotated — and collapsing it into `native` would change
   * which system of record the tenant's messages go to.
   *
   * Always true for `native`, which is not short of a credential it does not
   * want. A permanent red mark on a correctly configured clone is how an
   * operator learns to ignore the reading.
   */
  credentialled: boolean;
};

/** The server's reading: the configured word, or what this deployment holds. */
export function resolveCrmProviderFromEnv(
  env: CrmEnv,
): CrmProviderEnvResolution {
  const configured = resolveCrmProvider(
    env[CRM_PROVIDER_ENV],
    CRM_PROVIDER_ENV,
  );
  const credentialled = hasGoHighLevelCredentials(env);

  // `source: 'configured'` is the only case where a word this build knows was
  // actually supplied. Everything else — unset, or a word it does not know —
  // falls through to the credentials rather than to the constant, and keeps
  // whatever warning the base resolver produced.
  if (configured.source === "configured") {
    return {
      ...configured,
      credentialled: configured.provider === "ghl" ? credentialled : true,
    };
  }

  const derived: CrmProvider = credentialled ? "ghl" : "native";
  return {
    provider: derived,
    source: "default",
    warning: configured.warning,
    credentialled: derived === "ghl" ? credentialled : true,
  };
}
