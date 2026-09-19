/**
 * Whether a partner's AML/CTF Compliance page exists on this deployment.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * READ THROUGH THE SERVER, NOT THE TABLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This hook used to run `supabase.from("feature_flags").select(...)` from the
 * page. That read can never work for a PARTNER, and the way it fails is
 * silent — the same trap already documented on `useAmlV3Flags` and
 * `useBuilderStockMarketplaceFlag`:
 *
 *   • `public.feature_flags` grants SELECT `TO authenticated`.
 *   • A Finance, Builder or Solicitor portal user is not a Supabase-auth
 *     user. Their identity is that portal's own cookie or token session, and
 *     the browser's Supabase client is anon.
 *   • RLS does not error on a role that matches no policy. It FILTERS. The
 *     query returned `[]` with HTTP 200, `error` was null, and every flag
 *     coerced from `undefined` to `false`.
 *
 * So the compliance page reported **"The compliance workspace is not
 * available"** to every partner, in every portal, however the database was
 * set — and the nav entry never appeared, which is what "I cannot see
 * anywhere the AML/CTF Compliance page is located" actually was. Turning the
 * flags on changed nothing, because the reading never came from the database.
 *
 * `aml-reliance` answers it with the service role, on an op that needs no
 * session and discloses nothing: whether a page exists is what the navigation
 * shows anyway, and no case, partner or record is named.
 *
 * ── Two rules this module is built around ─────────────────────────────
 * It fails CLOSED: an unreadable answer hides the entry, so a surface can
 * never be switched on by a broken read. But it never CACHES a failure —
 * that is what turns a transient problem into a permanent one — and
 * `unknown` is reported separately, because a surface that cares about the
 * difference must be able to say "we could not tell" rather than asserting
 * "switched off".
 */
import { useEffect, useState } from "react";
import { invokeSecureFunction } from "@/lib/secureInvoke";

export type WorkspaceSurfaceKey = "finance" | "builder" | "solicitor";

/** The portal_type the server expects for each surface. */
const SURFACE_PORTAL_TYPE: Record<WorkspaceSurfaceKey, string> = {
  finance: "finance",
  builder: "builder",
  solicitor: "solicitor_conveyancer",
};

export interface SurfaceAvailability {
  /** The compliance page exists at all. */
  compliancePage: boolean;
  /** The Compliance Passport document is served onto it. */
  passportView: boolean;
  /** True when no reading could be obtained — safe, but not KNOWN. */
  unknown: boolean;
}

const UNKNOWN: SurfaceAvailability = {
  compliancePage: false, passportView: false, unknown: true,
};

/**
 * Session-scoped memo so a layout, its nav and the page share one read.
 * A FAILED read is never stored: caching it would turn one bad moment into a
 * portal that hides its compliance page until the tab is closed.
 */
const cache = new Map<string, Promise<SurfaceAvailability>>();

async function readAvailability(surface: WorkspaceSurfaceKey): Promise<SurfaceAvailability> {
  const { data, error } = await invokeSecureFunction<{
    availability?: { compliance_page?: boolean; passport_view?: boolean };
    error?: string;
  }>("aml-reliance", {
    op: "get_partner_surface_availability",
    portal_type: SURFACE_PORTAL_TYPE[surface],
  });
  if (error || !data || (data as { error?: string }).error) return UNKNOWN;
  const a = data.availability;
  // A response that carries no `availability` is a deployment that predates
  // this op — unknown, not off.
  if (!a) return UNKNOWN;
  return {
    compliancePage: a.compliance_page === true,
    passportView: a.passport_view === true,
    unknown: false,
  };
}

function useAvailability(surface: WorkspaceSurfaceKey): {
  loading: boolean; availability: SurfaceAvailability;
} {
  const [state, setState] = useState<{ loading: boolean; availability: SurfaceAvailability }>({
    loading: true, availability: UNKNOWN,
  });

  useEffect(() => {
    let alive = true;
    const cached = cache.get(surface);
    const pending = cached ?? readAvailability(surface).catch(() => UNKNOWN);
    if (!cached) cache.set(surface, pending);
    pending.then((availability) => {
      // Never keep a failure: the next mount asks again.
      if (availability.unknown) cache.delete(surface);
      if (alive) setState({ loading: false, availability });
    });
    return () => { alive = false; };
  }, [surface]);

  return state;
}

/**
 * Does this portal have a compliance page at all?
 *
 * `enabled` is the gate for a NAVIGATION entry — an entry that leads nowhere
 * is worse than none. A PAGE should not gate on it: the server refuses the
 * workspace operations on its own and says so in its own words, and two
 * authorities disagreeing about one surface is what produced a page that
 * announced itself unavailable while the server was ready to serve it.
 */
export function usePartnerWorkspaceEnabled(surface: WorkspaceSurfaceKey): {
  loading: boolean; enabled: boolean; unknown: boolean;
} {
  const { loading, availability } = useAvailability(surface);
  return { loading, enabled: availability.compliancePage, unknown: availability.unknown };
}

/**
 * Whether ANY partner portal serves the Compliance Passport.
 *
 * The Command Centre needs this to be honest about where a Passport actually
 * appears. Both halves are required: the page has to exist AND the document
 * has to be served onto it — a surface with no Passport on it is not a place
 * a partner can read this record, so the Command Centre must not offer it as
 * one. `null` while unread, and `null` when it could not be told: neither is
 * the same as "off", and the panel says nothing rather than something false.
 */
export function useAnyPartnerWorkspaceEnabled(): { loading: boolean; enabled: boolean | null } {
  const finance = useAvailability("finance");
  const builder = useAvailability("builder");
  const solicitor = useAvailability("solicitor");
  const loading = finance.loading || builder.loading || solicitor.loading;
  if (loading) return { loading, enabled: null };
  const readings = [finance.availability, builder.availability, solicitor.availability];
  if (readings.every((r) => r.unknown)) return { loading: false, enabled: null };
  return {
    loading: false,
    enabled: readings.some((r) => r.passportView),
  };
}

/** `aml_partner_passport_view`, for one surface. */
export function usePassportViewInPortalEnabled(surface: WorkspaceSurfaceKey = "builder"): {
  loading: boolean; enabled: boolean;
} {
  const { loading, availability } = useAvailability(surface);
  return { loading, enabled: availability.passportView };
}
