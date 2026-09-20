/**
 * The deployment's organisation, loaded once per page rather than per adapter
 * call.
 *
 * Every one of the five production adapters needs the same single row, and a
 * preview surface renders many templates in a row — the Template Library grid
 * builds a binding context per card. Without the cache that is one round trip
 * per card for a row that changes when somebody edits the Branding page.
 *
 * Deliberately a module-level promise rather than a TTL cache: the value is
 * stable for the life of a page, and an operator who has just edited their
 * branding reloads to see it, which is how the rest of the Branding surface
 * behaves already.
 *
 * A failure resolves to `null`, never throws, and is **not** cached — a
 * transient RLS or network error must not blank the letterhead for the rest of
 * the session. `applyOrganisationProjection` treats null as "publish nothing",
 * which leaves the bindings exactly as they were before this existed.
 *
 * ## Two clients, on purpose
 *
 * `whitelabel_settings` is deliberately public — its policy is "Anyone can view
 * whitelabel settings", granted to PUBLIC — so the wordmark and the logo load
 * on the anon client and always did.
 *
 * `global_report_settings` is not. It grants SELECT to `authenticated` and
 * `service_role` only, and the Command Centre has no Supabase Auth session, so
 * that read has to go through the staff-session gateway
 * (`getAuthenticatedSupabaseClient`). Reading it on the anon client does not
 * fail — PostgREST returns `200 []` — which is how the disclaimer, the ABN and
 * the postal address came to be missing from every design-system document
 * while the letterhead beside them looked fine.
 */
import { supabase } from '@/integrations/supabase/client';
import { getAuthenticatedSupabaseClient } from '@/hooks/useAuthenticatedSupabase';
import {
  ORGANISATION_COLUMNS,
  applyOrganisationProjection,
  type BrandMarks,
  type OrganisationRowLike,
  type ReportSettingsLike,
} from '../../../../supabase/functions/_shared/organisationProjection.pure';
import {
  resolveReportAsset,
} from '../../../../supabase/functions/_shared/reportDesign/assets.pure';
import {
  inlineBrandAssets,
} from '../../../../supabase/functions/_shared/reportDesign/fetchBrandAssets';

let inFlight: Promise<OrganisationRowLike | null> | null = null;

export async function loadOrganisation(): Promise<OrganisationRowLike | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { data, error } = await supabase
        .from('whitelabel_settings')
        .select(ORGANISATION_COLUMNS)
        .limit(1)
        .maybeSingle();
      if (error || !data) {
        inFlight = null;
        return null;
      }
      return data as unknown as OrganisationRowLike;
    } catch {
      inFlight = null;
      return null;
    }
  })();
  return inFlight;
}

let marksInFlight: Promise<BrandMarks> | null = null;

/**
 * The tenant's brand marks, fetched and inlined.
 *
 * ## Why this did not exist
 *
 * The legacy render routes have resolved a mark from `whitelabel_settings.
 * logo_config` for a while — `assets.pure.ts` decides whether one may be used
 * and `fetchBrandAssets.ts` reads the bytes. The design-system path never did:
 * `tryRouteThroughTemplateBuilder` passes no `brand` at all, so every adapter
 * built `brand: { logo: null }` and no template could bind a mark even if it
 * wanted to. Binding one without this would have put an unresolved path on 543
 * covers, which renders as the empty string.
 *
 * ## Two slots, because the mark is not inverted
 *
 * `report` is the lockup for ivory paper, `report-mono` the one for an obsidian
 * ground. `ASSET_FALLBACK` walks the tenant's other uploads when the preferred
 * one is missing, and a key that fails policy does not stop the walk.
 *
 * Inlined rather than linked. `renderResourcePolicy` would admit a project
 * storage URL, but a `data:` URI is what makes the render network-free and
 * reproducible — the same reason `assets.pure.ts` gives at length.
 *
 * Never throws, and a failure is not cached: a logo that could not be fetched
 * is a thinner document, not a failed one.
 */
export async function loadBrandMarks(): Promise<BrandMarks> {
  if (marksInFlight) return marksInFlight;
  marksInFlight = (async () => {
    try {
      const { data, error } = await supabase
        .from('whitelabel_settings')
        .select('logo_config')
        .limit(1)
        .maybeSingle();
      if (error || !data) {
        marksInFlight = null;
        return {};
      }
      const stored = ((data as any).logo_config ?? {}) as Record<string, string | null>;
      if (!stored || !Object.keys(stored).length) return {};

      const supabaseUrl = (import.meta as any)?.env?.VITE_SUPABASE_URL
        ?? (supabase as any)?.supabaseUrl ?? '';
      const { assets } = await inlineBrandAssets(stored, { supabaseUrl });

      const mark = resolveReportAsset(assets as any, 'report').resolved?.asset.dataUri ?? null;
      const mono = resolveReportAsset(assets as any, 'report-mono').resolved?.asset.dataUri ?? null;
      return { mark, markMono: mono };
    } catch {
      marksInFlight = null;
      return {};
    }
  })();
  return marksInFlight;
}

/**
 * The letterhead and the mark, in one call.
 *
 * Every adapter needs both and none of them should be able to remember one and
 * forget the other — which is exactly how `org.*` came to have no producer for
 * long enough that every document this product generated printed a blank
 * letterhead.
 */
export async function applyOrganisationAndBrand(
  data: Record<string, any>,
): Promise<Record<string, any>> {
  const [row, marks, settings] = await Promise.all([
    loadOrganisation(), loadBrandMarks(), loadReportSettings(),
  ]);
  return applyOrganisationProjection(data, row, marks, settings);
}

/**
 * `global_report_settings`, the row the Report Settings page writes.
 *
 * It carries the firm's ABN and postal address — the two `org` fields the
 * `whitelabel_settings` row genuinely has no column for — and the professional
 * disclaimer, which is what the last page of every report is *for*. The render
 * routes have always read this row; they passed it to the legacy composer and
 * nowhere else, so the design-system path never saw it.
 *
 * Cached and failure-tolerant on the same terms as the two above: a settings
 * read that fails leaves the standard disclaimer and the signature-column
 * contact lines, which is what the documents had before this existed.
 */
let settingsInFlight: Promise<ReportSettingsLike | null> | null = null;

export async function loadReportSettings(): Promise<ReportSettingsLike | null> {
  if (settingsInFlight) return settingsInFlight;
  settingsInFlight = (async () => {
    try {
      /*
       * The staff-session client, NOT the anon one.
       *
       * `global_report_settings` grants SELECT to `authenticated` and
       * `service_role` only — RLS-W2 dropped its anon grant, and
       * `GlobalReportSettings.tsx` was moved onto `useAuthenticatedSupabase`
       * for exactly that reason. This read was not, and the Command Centre has
       * no Supabase Auth session: identity is a custom HttpOnly cookie, so
       * `@/integrations/supabase/client` is the bare anon key.
       *
       * PostgREST answers an anon SELECT on an RLS-protected table with
       * `200 []`, not a 403. So this returned `{contact: null, disclaimer:
       * null}`, `projectReportSettings` published neither key, and
       * `{{org.disclaimer}}` resolved to the empty string — at which point
       * `disclaimer.html.ts` fell through to its fallback and printed the
       * generic boilerplate on every design-system document. The ABN and the
       * postal address come from the same row and went the same way.
       *
       * That is why binding the templates did not fix it: the binding was
       * correct and the data behind it was empty. Verified against production
       * on 16 Aug — the exact query this makes returns `[]` as anon and two
       * rows as `authenticated`.
       *
       * `useAuthenticatedSupabase`'s own header records this class: an anon
       * read of an RLS table "came back empty instead of failing. Fourteen
       * tables across sixteen modules were affected." This module is the one
       * the migration missed.
       */
      const authed = getAuthenticatedSupabaseClient();
      const { data, error } = await authed
        .from('global_report_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['contact_details', 'professional_disclaimer']);
      if (error || !data) {
        settingsInFlight = null;
        return null;
      }
      /*
       * Say so when the row is missing rather than degrading in silence.
       *
       * A deployment that has never opened Report Settings legitimately has no
       * rows, so this cannot throw — but "no disclaimer configured" and "the
       * read was quietly unauthorised" produced the same blank for months, and
       * only one of them is a deployment's own choice.
       */
      if (!data.length) {
        console.warn(
          '[organisation] global_report_settings returned no rows — the report '
          + 'disclaimer, ABN and postal address will fall back to their defaults. '
          + 'If Report Settings is populated, this read is not authenticated.',
        );
      }
      let contact: Record<string, unknown> | null = null;
      let disclaimer: Record<string, unknown> | null = null;
      for (const row of data as Array<Record<string, unknown>>) {
        const value = row.setting_value;
        if (!value || typeof value !== 'object') continue;
        if (row.setting_key === 'contact_details') contact = value as Record<string, unknown>;
        else if (row.setting_key === 'professional_disclaimer') disclaimer = value as Record<string, unknown>;
      }
      return { contact, disclaimer };
    } catch {
      settingsInFlight = null;
      return null;
    }
  })();
  return settingsInFlight;
}

/** Test seam: drop the memoised row so a spec can change what is returned. */
export function resetOrganisationCache(): void {
  inFlight = null;
  marksInFlight = null;
  settingsInFlight = null;
}
