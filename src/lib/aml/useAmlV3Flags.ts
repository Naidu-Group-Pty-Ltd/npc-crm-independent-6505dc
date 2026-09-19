/**
 * AML V3 rollout flags.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * READ THROUGH THE SERVER, NOT THE TABLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This hook used to run `supabase.from('feature_flags').select(...)` from the
 * page. That read can never work in this application, and the way it fails is
 * silent:
 *
 *   • `public.feature_flags` grants SELECT `TO authenticated`.
 *   • The Command Centre's browser client is anon-only. Identity here is the
 *     custom HttpOnly cookie session, and `createClient` is configured with
 *     `persistSession: false` precisely so GoTrue never competes with it —
 *     see `src/integrations/supabase/client.ts`. The client therefore never
 *     holds an `authenticated` role.
 *   • RLS does not error on a role that matches no policy. It filters. The
 *     query returned `[]` with HTTP 200, `error` was null, and every flag
 *     coerced from `undefined` to `false`.
 *
 * So EVERY V3 flag read as off, in every browser, for every user, however the
 * database was set — and `aml_v3_case_workspace` gates the whole staged case
 * workspace, which was consequently unreachable from the day it shipped.
 * Turning the flag on in the database changed nothing, because the reading
 * never came from the database.
 *
 * The same trap is documented on `useBuilderStockMarketplaceFlag` for
 * `builder_stock_marketplace`. The rule it states is the rule here: read
 * through the server. `aml-access` answers these flags with the service role
 * on the call every AML surface already makes for roles, so this costs no
 * extra round trip.
 *
 * ── Two rules this module is built around ─────────────────────────────
 * It fails CLOSED: an unreadable flag is off, so a rollout can never be
 * switched on by a broken read. But it never CACHES a failure — that is what
 * turned a transient problem into a permanent one — and it always revalidates
 * behind a cached value, so a flag flipped anywhere reaches every open tab on
 * its next mount rather than surviving until a new browser session.
 */
import { useEffect, useState } from "react";
import { invokeSecureFunction } from "@/lib/secureInvoke";

export type AmlV3FlagKey =
  | "aml_v3_nav"
  | "aml_v3_start_client_compliance"
  | "aml_v3_compliance_home"
  | "aml_v3_case_workspace"
  | "aml_v3_regulatory_hub"
  | "aml_v3_terminology_editor"
  | "aml_v3_metrics_relocation"
  | "aml_v3_org_settings";

export interface AmlV3Flags {
  v3Nav: boolean;
  startClientCompliance: boolean;
  complianceHome: boolean;
  caseWorkspace: boolean;
  regulatoryHub: boolean;
  terminologyEditor: boolean;
  metricsRelocation: boolean;
  orgSettings: boolean;
  loading: boolean;
  /**
   * True when no flag reading could be obtained at all — the server read
   * failed, or `aml-access` is deployed at a version that predates
   * `v3Flags`. Every flag then reads `false`, which is the SAFE answer but
   * not a KNOWN one, and a surface that cares about the difference (the
   * register's rollout notice) can say so instead of reporting the feature
   * as switched off. This distinction is the whole point: the previous
   * reader could not make it, which is why a broken read looked exactly
   * like a disabled feature for months.
   */
  unavailable: boolean;
}

/**
 * Cache key. BUMP THIS whenever a stale reading would be materially wrong.
 *
 * v1 → v2: the cache was written once per browser session and never
 * revalidated, and `sessionStorage` survives a reload — so a tab that had read
 * `false` kept reading `false` through refreshes.
 * v2 → v3: every v1/v2 entry was written by the anon table read described
 * above, which means every one of them says "all flags off" regardless of the
 * database. None of them may be trusted.
 */
const CACHE_KEY = "aml:v3_flags:v3";

type Cache = Omit<AmlV3Flags, "loading" | "unavailable">;

const ALL_OFF: Cache = {
  v3Nav: false,
  startClientCompliance: false,
  complianceHome: false,
  caseWorkspace: false,
  regulatoryHub: false,
  terminologyEditor: false,
  metricsRelocation: false,
  orgSettings: false,
};

/** Flag key → the field this module exposes it as. */
const FIELD_FOR_KEY: Record<AmlV3FlagKey, keyof Cache> = {
  aml_v3_nav: "v3Nav",
  aml_v3_start_client_compliance: "startClientCompliance",
  aml_v3_compliance_home: "complianceHome",
  aml_v3_case_workspace: "caseWorkspace",
  aml_v3_regulatory_hub: "regulatoryHub",
  aml_v3_terminology_editor: "terminologyEditor",
  aml_v3_metrics_relocation: "metricsRelocation",
  aml_v3_org_settings: "orgSettings",
};

let memory: Cache | null = null;
/** Set once a read has actually answered. Distinguishes "off" from "unknown". */
let lastReadOk = false;
const subs = new Set<(f: Cache) => void>();

/**
 * Whether the most recent read actually produced a reading.
 *
 * `false` means every flag below is `false` because nothing could be read —
 * not because the database says so. The two are indistinguishable in the
 * flag values themselves, which is exactly how a broken read passed for a
 * disabled feature for months.
 */
export function readAmlV3FlagsAvailability(): boolean {
  return lastReadOk;
}

function readCache(): Cache | null {
  if (memory) return memory;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) { memory = JSON.parse(raw) as Cache; return memory; }
  } catch { /* ignore */ }
  return null;
}

function writeCache(next: Cache) {
  memory = next;
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  subs.forEach((fn) => fn(next));
}

/** `true`, `"true"` and `{ enabled: true }` all mean on. Everything else is off. */
export function coerceAmlV3Flag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  if (value && typeof value === "object") {
    return (value as { enabled?: unknown }).enabled === true;
  }
  return false;
}

/**
 * One request per page load, however many components ask. Four surfaces read
 * these flags (the layout, the register, the case workspace, the case tabs);
 * since every mount revalidates, they share whichever call is in flight.
 */
let inFlight: Promise<Cache> | null = null;

export function refreshAmlV3Flags(): Promise<Cache> {
  if (inFlight) return inFlight;
  inFlight = fetchAmlV3Flags().finally(() => { inFlight = null; });
  return inFlight;
}

async function fetchAmlV3Flags(): Promise<Cache> {
  try {
    const { data, error } = await invokeSecureFunction<{
      v3Flags?: Record<string, unknown>;
    }>("aml-access", { op: "summary" }, { timeoutMs: 15000 });

    // An absent `v3Flags` is an OLD DEPLOYMENT of the function, not a set of
    // switched-off flags. Saying "off" for it would be the same silent lie
    // the table read told, so it is treated as unreadable: the last good
    // value stands, and nothing is written to the cache.
    if (error || !data?.v3Flags) {
      lastReadOk = false;
      return memory ?? ALL_OFF;
    }

    const next: Cache = { ...ALL_OFF };
    for (const [key, field] of Object.entries(FIELD_FOR_KEY) as Array<[AmlV3FlagKey, keyof Cache]>) {
      next[field] = coerceAmlV3Flag(data.v3Flags[key]);
    }
    lastReadOk = true;
    writeCache(next);
    return next;
  } catch {
    // A failed read never becomes a cached "off".
    lastReadOk = false;
    return memory ?? ALL_OFF;
  }
}

export function useAmlV3Flags(): AmlV3Flags {
  const cached = readCache();
  const [flags, setFlags] = useState<Cache>(cached ?? ALL_OFF);
  const [loading, setLoading] = useState<boolean>(!cached);
  const [unavailable, setUnavailable] = useState<boolean>(false);

  useEffect(() => {
    const listener = (f: Cache) => setFlags(f);
    subs.add(listener);
    /*
     * Stale-while-revalidate, and the revalidate half is the point. A cached
     * reading renders immediately — a flag that gates a whole surface must not
     * make every AML page wait on a round trip, and a flicker from "off" to
     * "on" is worse than a beat of staleness. But it is ALWAYS refreshed
     * behind, so a flag flipped in the cutover page (or in the database)
     * reaches every open tab on its next mount.
     */
    void refreshAmlV3Flags().finally(() => {
      setLoading(false);
      setUnavailable(!lastReadOk);
    });
    return () => { subs.delete(listener); };
  }, []);

  return { ...flags, loading, unavailable };
}
