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

/** True when this build talks to a CRM that lives in its own Postgres. */
export function isNativeCrm(): boolean {
  return crmProvider().provider === "native";
}

/**
 * The CRM capabilities a surface can ask about, and the function that serves
 * each under each provider.
 *
 * Both columns are spelled out rather than one being derived from the other by
 * a prefix swap. A derived name is a name nothing checks: `crm-calendar` and
 * `ghl-calendar` happen to rhyme, and a rule that works for one capability is
 * worse than no rule because it is only wrong on the other.
 *
 * Only two capabilities are here, and which two is the whole finding — see
 * `VENDOR_RECONCILIATION` below.
 */
const ROUTES = {
  calendar: { ghl: "ghl-calendar", native: "crm-calendar" },
  sendMessage: { ghl: "send-ghl-message", native: "crm-send-message" },
} as const;

export type CrmCapability = keyof typeof ROUTES;

/** The edge function that serves `capability` on this deployment. */
export function crmFunction(capability: CrmCapability): string {
  return ROUTES[capability][crmProvider().provider];
}

/**
 * Acts that RECONCILE this deployment with GoHighLevel, and have no native
 * counterpart because under `native` there is nothing on the other side.
 *
 * ── Why these are not a third and fourth row of ROUTES ───────────────────────
 *
 * They were, and that was wrong in a way worth recording, because it is the
 * shape this repository keeps paying for: a capability named for what ONE
 * provider does, mapped onto a provider where the act does not exist.
 *
 * `conversationSync` PULLS threads from GoHighLevel into our tables. Under
 * `native` the threads are already in our tables — they were written here, by
 * `crm-send-message` and by the inbound path. There is no upstream to pull
 * from, so a `crm-conversations` function could only either do nothing or
 * copy a row onto itself.
 *
 * `opportunityStage` PUSHES a stage change to GoHighLevel, and both of its
 * call sites run it AFTER the local write has already succeeded — read the
 * code at `ClientTracker.tsx`: the error branch says "local update succeeded,
 * just log GHL failure". Under `native` the local write IS the act. A
 * `crm-pipelines` function here would re-perform a write the page has already
 * made, which is how two writes to one row come to disagree.
 *
 * So this returns **null** under `native` rather than a name. A caller cannot
 * invoke a function it was not given, which makes the absence structural
 * instead of a rule a test has to police — and it is why nothing in this
 * repository defines `crm-conversations` or `crm-pipelines`. A router entry
 * naming a function that is not deployed is a dead control, and this
 * repository has shipped one of those before (the AUSTRAC path card's step 3).
 *
 * The names stay HERE, in the one module allowed to spell them, so
 * `crmIndependence.spec.ts`'s rule is unchanged.
 */
const VENDOR_RECONCILIATION = {
  conversationSync: "sync-ghl-conversations",
  opportunityStage: "update-ghl-opportunity-stage",
} as const;

export type VendorReconciliation = keyof typeof VENDOR_RECONCILIATION;

/**
 * The function that reconciles `step` with GoHighLevel, or null where this
 * deployment has no GoHighLevel to reconcile with.
 *
 * Null is not an error and must not be reported as one: it means the act is
 * complete without it.
 */
export function vendorReconciliationFunction(
  step: VendorReconciliation,
): string | null {
  return ghlAffordancesAvailable() ? VENDOR_RECONCILIATION[step] : null;
}

/**
 * Whether a GHL-only affordance may be drawn.
 *
 * Read by every surface that offers "sync to GHL", "import from GHL", "open in
 * GHL" or the migration console. Under `native` those controls are not
 * disabled, they are ABSENT: a disabled button is a claim that the thing
 * exists and is currently unavailable, and on a CRM-independent deployment
 * there is no GHL account for it ever to become available against. This
 * repository has paid for that distinction twice — a dead control on the
 * AUSTRAC path card, and a Stripe button on a gate that paying could not open.
 */
export function ghlAffordancesAvailable(): boolean {
  return crmProvider().provider === "ghl";
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
  const believed = crmProvider().provider;
  if (servedBy === believed) return null;
  return (
    `This build is configured for the "${believed}" CRM but the request was served by ` +
    `"${servedBy}". The browser bundle and the edge functions deploy separately: set ` +
    `${CRM_PROVIDER_ENV} and CRM_PROVIDER to the same value and rebuild.`
  );
}
