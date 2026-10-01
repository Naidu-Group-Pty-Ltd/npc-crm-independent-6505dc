/**
 * The one place in the browser that decides where this deployment's CRM lives.
 *
 * The backend twin is `supabase/functions/_shared/crm/crmProvider.pure.ts` and
 * its header carries the reasoning; this module is the reading Vite inlines at
 * build time, and the routing table that turns the answer into a function name.
 *
 * ── Why the names live here and nowhere else ────────────────────────────────
 *
 * `turnstileSiteKey.ts` is the precedent, for the reason its own spec records:
 * a value named in one module gives a mirror ONE thing to change rather than a
 * search to run. The same applies to a function name. `useGHLCalendar` invokes
 * `'ghl-calendar'` at twelve call sites; had the literal stayed at each of
 * them, switching a provider would be twelve edits and eleven of them would be
 * right. `crmFunction()` is the whole routing table, and
 * `crmIndependence.spec.ts` fails when a CRM function name is spelled anywhere
 * else.
 *
 * ── The read is STATIC, and that is not a style choice ──────────────────────
 *
 * Vite replaces the exact expression `import.meta.env.VITE_CRM_PROVIDER` at
 * BUILD time. A dynamic lookup — `import.meta.env[name]` — is not an
 * expression the bundler can see through, is never replaced, and reads
 * `undefined` in a production bundle however the environment is set. That
 * exact mistake cost the mirror repository a silent failure once already
 * (see `turnstileSiteKey.ts`), and the bundle came out byte-identical, so
 * nothing anywhere reported it. Do not refactor this into a helper that takes
 * the variable name as an argument.
 */
import {
  crmProviderMismatchHeaderName,
  resolveCrmProvider,
  type CrmProvider,
  type CrmProviderResolution,
} from "../../../supabase/functions/_shared/crm/crmProvider.pure.ts";

export type { CrmProvider, CrmProviderResolution };
export { crmProviderMismatchHeaderName, resolveCrmProvider };

/**
 * The environment variable that carries this deployment's choice.
 *
 * Deliberately a DIFFERENT name from the edge runtime's `CRM_PROVIDER`: Vite
 * only inlines what is prefixed `VITE_`. Both must be set to the same word,
 * and `crmProviderMismatch` below is what notices when they are not.
 */
export const CRM_PROVIDER_ENV = "VITE_CRM_PROVIDER";

/** STATIC on purpose — see the header. */
function readConfiguredProvider(): string | undefined {
  try {
    const value = import.meta.env.VITE_CRM_PROVIDER as string | undefined;
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

let resolved: CrmProviderResolution | null = null;

/** Resolved once per module load, so a mistyped value says so once. */
export function crmProvider(): CrmProviderResolution {
  if (!resolved) {
    resolved = resolveCrmProvider(readConfiguredProvider(), CRM_PROVIDER_ENV);
    if (resolved.warning) console.error(`[crm] ${resolved.warning}`);
  }
  return resolved;
}

/**
 * This line is a CLOSED system, so its answer is always `native`.
 *
 * The CRM-independent line does not carry the GoHighLevel integration at all.
 * Mission Control withholds its functions, shared modules, tests and crons
 * from this line by class (`crmLineFeatures.pure.ts` there), so a `ghl` build
 * of this repository would route every CRM call to a function that is not
 * deployed. A `VITE_CRM_PROVIDER` naming anything else is reported once
 * rather than obeyed; it is never silently accepted.
 */
export function isNativeCrm(): boolean {
  const configured = crmProvider();
  if (configured.provider !== "native" && !warnedAboutGhl) {
    warnedAboutGhl = true;
    console.error(
      `[crm] ${CRM_PROVIDER_ENV} names "${configured.provider}", but this deployment carries no ` +
        `GoHighLevel integration. Its CRM is native; the setting is ignored.`,
    );
  }
  return true;
}

let warnedAboutGhl = false;

/**
 * The CRM capabilities a surface can ask about, and the function that serves
 * each.
 *
 * One column, because this line has one provider. The GoHighLevel column the
 * prime's routing would need is not here, and that is deliberate: a name in a
 * routing table is a claim that the function is deployed.
 */
const ROUTES = {
  calendar: "crm-calendar",
  sendMessage: "crm-send-message",
} as const;

export type CrmCapability = keyof typeof ROUTES;

/** The edge function that serves `capability` on this deployment. */
export function crmFunction(capability: CrmCapability): string {
  isNativeCrm();
  return ROUTES[capability];
}

/**
 * Acts that RECONCILE a deployment with GoHighLevel.
 *
 * `conversationSync` pulls threads from GoHighLevel; `opportunityStage` pushes
 * a stage change to it after the local write has already succeeded. On this
 * line the threads are written here and the local write IS the act, so there
 * is nothing on the other side to reconcile with. Both answer null, and a
 * caller cannot invoke a function it was not given — the absence is
 * structural rather than a rule a test has to police.
 */
export type VendorReconciliation = "conversationSync" | "opportunityStage";

/** Kept for callers that name a provider explicitly: always null here. */
export function vendorReconciliationFunctionFor(
  _provider: CrmProvider,
  _step: VendorReconciliation,
): string | null {
  return null;
}

/** Null: the act is complete without it. Not an error, never reported as one. */
export function vendorReconciliationFunction(_step: VendorReconciliation): string | null {
  return null;
}

/**
 * Whether a GoHighLevel-only affordance may be drawn: never, on this line.
 *
 * Absent rather than disabled — a disabled button claims the thing exists and
 * is currently unavailable, and there is no GoHighLevel account here for it
 * ever to become available against.
 */
export function ghlAffordancesAvailable(): boolean {
  return false;
}

/**
 * The prime's GoHighLevel functions a prime-shaped surface may still name.
 *
 * Several components arrive from the prime unchanged and call these directly
 * (a note synced after it is saved, a client synced after it is created). On
 * this line none of them is deployed, so `invokeSecureFunction` answers them
 * locally, as NOT CARRIED, without a request — a 404 from a function that was
 * withheld on purpose would read as an outage. The list is Mission Control's
 * register for this line, spelled here because this is the one module that
 * may spell a CRM function name (`crmIndependence.spec.ts`).
 */
export const WITHHELD_CRM_FUNCTIONS: readonly string[] = [
  "backfill-lead-attributions",
  "backfill-message-directions",
  "backfill-notes-to-ghl",
  "conversation-sync-cron",
  "diagnose-ghl-attribution",
  "ghl-calendar",
  "ghl-calendar-proxy",
  "ghl-calendar-test",
  "ghl-conversations-cron",
  "ghl-webhook-receiver",
  "import-clients-from-ghl",
  "one-time-bulk-conversation-sync",
  "send-ghl-message",
  "sync-client-to-ghl",
  "sync-ghl-conversations",
  "sync-ghl-marketing-assets",
  "sync-ghl-pipelines",
  "sync-notes-to-ghl",
  "update-ghl-opportunity-stage",
];

const WITHHELD = new Set(WITHHELD_CRM_FUNCTIONS);

/** The code a local refusal carries, so a caller can tell it from a failure. */
export const CRM_FUNCTION_NOT_CARRIED = "crm_function_not_carried";

/** The refusal for a withheld function, or null for any other name. */
export function withheldCrmFunctionRefusal(
  functionName: string,
): { message: string; code: string; functionName: string; retryable: false } | null {
  if (!WITHHELD.has(functionName)) return null;
  return {
    message:
      "This deployment's CRM is its own and carries no GoHighLevel integration, so " +
      `${functionName} is not available here.`,
    code: CRM_FUNCTION_NOT_CARRIED,
    functionName,
    retryable: false,
  };
}

/**
 * Compare what the browser believes with what actually served a response.
 *
 * Returns an operator-facing sentence when they disagree, and null when they
 * do not — including when the server said nothing, because an older function
 * that does not report a provider is not evidence of a mismatch. The two
 * halves deploy separately, and `VERIFY_JWT.md` records what a declaration and
 * a production that disagree cost the last time nothing was asking.
 */
export function crmProviderMismatch(servedBy: unknown): string | null {
  if (typeof servedBy !== "string" || servedBy.length === 0) return null;
  const believed: CrmProvider = isNativeCrm() ? "native" : crmProvider().provider;
  if (servedBy === believed) return null;
  return (
    `This build is configured for the "${believed}" CRM but the request was served by ` +
    `"${servedBy}". The browser bundle and the edge functions deploy separately: set ` +
    `${CRM_PROVIDER_ENV} and CRM_PROVIDER to the same value and rebuild.`
  );
}
