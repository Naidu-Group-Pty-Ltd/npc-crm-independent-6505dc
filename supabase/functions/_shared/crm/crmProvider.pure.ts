// WHICH CRM THIS DEPLOYMENT IS. One module decides it, and it is the only one
// that may.
//
// ## What this exists to stop
//
// The prime's CRM is GoHighLevel. Measured on this clone 19 Sep 2026: 41 edge
// functions reach `services.leadconnectorhq.com`, 73 source files name GHL,
// and NOT ONE line of browser code calls the vendor — every read a surface
// makes is against local `ghl_*` tables that a sync worker fills. So a
// deployment with no GoHighLevel account is not mostly broken. It is a
// deployment whose tables nothing fills and whose outbound messages have
// nowhere to go, while every page still renders.
//
// That is the dangerous shape: a CRM that looks like it works. A conversation
// list draws, a contact opens, a send button is live — and the send fails at
// a vendor the operator was never told this deployment does not have.
//
// This clone holds no `GOHIGHLEVEL_*` secret at all. That is not an accident
// or a provisioning gap: the fleet's secret policy carries no forward row for
// those names, so no clone has ever been given them and none ever will be.
// The absence is the product decision, and this module is where the product
// finally reads it.
//
// ## Three rules
//
// **An explicit setting is never overruled by a credential's absence.**
// `configuration is not reachability` is a rule this platform has already paid
// for on the verification broker, where every readiness reading was green on
// three tenants that had never completed a verification. The inverse is just
// as wrong: an operator who set `CRM_PROVIDER=gohighlevel` has said what this
// deployment IS, and quietly answering `native` because a key is missing hides
// a broken integration behind a working-looking one. The reading carries the
// absence instead, and the caller decides what to do about it.
//
// **A word this build has never heard of is not a provider.** The activation
// gate learned this one the expensive way: `reason !== "operator_locked"`
// answered yes to every unrecognised word, `unknown` included, and drew a
// full-width demand for money at somebody who owed nothing. So the accepted
// set is an ALLOW-list, and anything outside it is reported as unrecognised
// and falls back to what the credentials say — never silently to whichever
// provider happens to be first in a union type.
//
// **The reading says how it was reached.** `derived` and `configured` send an
// operator to opposite places — one to the environment, one to the vendor —
// and a reading that cannot tell them apart is how "screening never starts"
// came to mean four different faults at once.

/** The CRM implementations this build actually has code for. */
export type CrmProvider = "gohighlevel" | "native";

/**
 * How the answer was reached.
 *
 * `configured` — an operator set `CRM_PROVIDER` to a value this build knows.
 * `derived`    — nothing was set, so the credentials were read instead.
 * `unrecognised` — `CRM_PROVIDER` was set to something this build has no code
 *                  for. The answer is the derived one, and the word is carried
 *                  back so it can be named rather than swallowed.
 */
export type CrmProviderSource = "configured" | "derived" | "unrecognised";

export interface CrmProviderReading {
  readonly provider: CrmProvider;
  readonly source: CrmProviderSource;
  /**
   * Whether this deployment holds the credentials the RESOLVED provider needs.
   *
   * Deliberately separate from `provider`, and deliberately not a veto. A
   * `gohighlevel` deployment with no key is a real and reportable state — it
   * is what the prime looks like the moment a key is rotated — and collapsing
   * it into `native` would silently change which system of record a tenant's
   * messages go to. Nothing about a CRM should change identity because a
   * secret expired.
   */
  readonly credentialled: boolean;
  /** The unrecognised word, when there was one. Never invented. */
  readonly configuredAs: string | null;
}

/** Spelled once. A second copy is how two readers come to disagree. */
export const CRM_PROVIDER_ENV = "CRM_PROVIDER";

/**
 * The names whose PRESENCE means this deployment can talk to GoHighLevel.
 *
 * Both halves are required because neither is sufficient: a key with no
 * location id addresses no account, and a location id with no key authorises
 * nothing. This is the same rule `airtableListingsRoute` states about a token
 * with no base id — "unconfigured, never brokered" — because a half
 * configuration that reports as configured is worse than one that reports as
 * absent.
 *
 * The `_NEW` pair is read as an alternative rather than an addition: the prime
 * carries both spellings mid-rotation, and requiring all four would report a
 * correctly-rotated deployment as uncredentialled.
 */
export const GOHIGHLEVEL_CREDENTIAL_NAMES = [
  ["GOHIGHLEVEL_API_KEY", "GOHIGHLEVEL_LOCATION_ID"],
  ["GOHIGHLEVEL_API_KEY_NEW", "GOHIGHLEVEL_LOCATION_ID_NEW"],
] as const;

type Env = Readonly<Record<string, string | undefined>>;

/** A value is present only if it is a non-empty string. `""` is not a secret. */
function has(env: Env, name: string): boolean {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}

/** Whether this deployment can reach a GoHighLevel account at all. */
export function hasGoHighLevelCredentials(env: Env): boolean {
  return GOHIGHLEVEL_CREDENTIAL_NAMES.some((pair) =>
    pair.every((name) => has(env, name)),
  );
}

/** The allow-list. Anything outside it is `unrecognised`, never a provider. */
function asProvider(raw: string): CrmProvider | null {
  switch (raw.trim().toLowerCase()) {
    case "gohighlevel":
    case "ghl":
      return "gohighlevel";
    case "native":
      return "native";
    default:
      return null;
  }
}

/**
 * What CRM this deployment is, and how we know.
 *
 * Pure: it reads an environment object handed to it rather than a global, so
 * the same function answers for a test, an edge function and a projection
 * without three copies of the rule.
 */
export function resolveCrmProvider(env: Env): CrmProviderReading {
  const credentialled = hasGoHighLevelCredentials(env);
  // With nothing configured, the credentials are the only evidence there is:
  // a deployment that holds a GoHighLevel account is one, and a deployment
  // that holds none has no vendor to be.
  const derived: CrmProvider = credentialled ? "gohighlevel" : "native";

  const raw = env[CRM_PROVIDER_ENV];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {
      provider: derived,
      source: "derived",
      credentialled,
      configuredAs: null,
    };
  }

  const configured = asProvider(raw);
  if (configured === null) {
    return {
      provider: derived,
      source: "unrecognised",
      credentialled,
      configuredAs: raw.trim(),
    };
  }

  return {
    provider: configured,
    source: "configured",
    // A `native` deployment is never short of a GoHighLevel credential: it
    // does not want one. Reporting `credentialled: false` there would put a
    // permanent red mark on a correctly configured clone, which is how an
    // operator learns to ignore the reading.
    credentialled: configured === "gohighlevel" ? credentialled : true,
    configuredAs: null,
  };
}

/**
 * One sentence an operator can act on.
 *
 * Kept beside the resolver rather than in each surface, because the same four
 * states get rendered on the Integrations page, in a worker's log line and in
 * a refusal body — and three hand-written copies is how one of them comes to
 * describe a state the other two do not have.
 */
export function describeCrmProvider(reading: CrmProviderReading): string {
  if (reading.source === "unrecognised") {
    return (
      `${CRM_PROVIDER_ENV} is set to "${reading.configuredAs}", which this build has no CRM for. ` +
      `Running as ${reading.provider}, chosen from the credentials this deployment holds.`
    );
  }
  if (reading.provider === "native") {
    return reading.source === "configured"
      ? "This deployment keeps its CRM in its own database. No GoHighLevel account is involved."
      : "No GoHighLevel credentials are configured, so this deployment keeps its CRM in its own database.";
  }
  return reading.credentialled
    ? "This deployment's CRM is GoHighLevel."
    : `This deployment is set to GoHighLevel, but holds neither ${GOHIGHLEVEL_CREDENTIAL_NAMES[0].join(" nor ")}. ` +
        "Contacts, conversations and appointments will not sync until one is set.";
}
