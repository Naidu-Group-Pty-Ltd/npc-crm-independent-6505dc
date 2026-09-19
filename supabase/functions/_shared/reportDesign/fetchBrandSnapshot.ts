/**
 * Reading a tenant's brand out of the database and freezing it.
 *
 * `snapshot.pure.ts` turns records into a snapshot and `fetchBrandAssets.ts`
 * turns a logo URL into bytes. Between them sits about forty lines of the same
 * two queries, the same `theme_config` unpacking and the same key/value walk
 * over `global_report_settings` — currently written out longhand in each of the
 * eight render routes that need it. This is that middle, once.
 *
 * ## What it is careful about
 *
 * **`global_report_settings` is `(setting_key, setting_value jsonb)`.** Reading
 * it as though it had `contact_details` and `disclaimer` columns is the mistake
 * that shipped every Borrowing Capacity Snapshot without an ABN.
 *
 * **A missing brand is not a failed render.** Every read below degrades to the
 * house defaults rather than throwing: a tenant who has not filled in their
 * branding gets a plainer document, which is recoverable, instead of an error,
 * which is not. What is missing comes back in `gaps` for the caller to log.
 *
 * The clock lives here, at the edge, and nowhere in the pure modules.
 */
import { inlineBrandAssets } from './fetchBrandAssets.ts';
import {
  buildReportBrandSnapshot,
  type ReportBrandSnapshot,
} from './snapshot.pure.ts';

export interface FetchedBrandSnapshot {
  snapshot: ReportBrandSnapshot;
  /** `global_report_settings.professional_disclaimer`, unread and unvalidated. */
  disclaimer: Record<string, unknown> | null;
  /** The tenant's own cover art as a `data:` URI, when they have one. */
  coverArtDataUri: string | null;
  /** Everything worth a log line: an asset that would not inline, a query that failed. */
  notes: string[];
}

/**
 * Read `whitelabel_settings` and `global_report_settings`, inline the marks,
 * and return the frozen snapshot.
 *
 * `capturedAt` is a parameter rather than `new Date()` so a caller that already
 * stamped its artefact can pin both to the same instant.
 */
export async function fetchReportBrandSnapshot(
  supabase: {
    from: (table: string) => {
      select: (columns: string) => any;
    };
  },
  opts: { supabaseUrl: string; capturedAt: string },
): Promise<FetchedBrandSnapshot> {
  const notes: string[] = [];

  const [whitelabelRes, settingsRes] = await Promise.all([
    supabase.from('whitelabel_settings').select('*').limit(1).maybeSingle(),
    supabase
      .from('global_report_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['contact_details', 'professional_disclaimer']),
  ]);

  if (whitelabelRes?.error) notes.push(`whitelabel_settings unreadable: ${whitelabelRes.error.message}`);
  if (settingsRes?.error) notes.push(`global_report_settings unreadable: ${settingsRes.error.message}`);

  const whitelabel = (whitelabelRes?.data ?? null) as Record<string, unknown> | null;
  const themeConfig = (whitelabel?.theme_config ?? {}) as Record<string, unknown>;

  let contact: Record<string, unknown> | null = null;
  let disclaimer: Record<string, unknown> | null = null;
  for (const row of (Array.isArray(settingsRes?.data) ? settingsRes.data : []) as Record<string, unknown>[]) {
    const value = row.setting_value;
    if (!value || typeof value !== 'object') continue;
    if (row.setting_key === 'contact_details') contact = value as Record<string, unknown>;
    else if (row.setting_key === 'professional_disclaimer') disclaimer = value as Record<string, unknown>;
  }

  const { assets, notes: assetNotes } = await inlineBrandAssets(
    (whitelabel?.logo_config ?? {}) as Record<string, string | null>,
    { supabaseUrl: opts.supabaseUrl },
  );
  for (const note of assetNotes) {
    notes.push(`asset ${note.key} not inlined (${note.reason}): ${note.detail}`);
  }

  const { snapshot, skippedAssets } = buildReportBrandSnapshot({
    whitelabel: whitelabel
      ? {
        id: String(whitelabel.id ?? ''),
        themeVersion: Number(whitelabel.theme_version ?? 0) || null,
        companyName: String(whitelabel.company_name ?? ''),
        tradingName: String(themeConfig.tradingName ?? ''),
        brandColour: String(themeConfig.brandColour ?? whitelabel.primary_color ?? ''),
        preset: String(themeConfig.reportPreset ?? ''),
        assets,
      }
      : null,
    contact: contact as never,
    document: {
      confidentiality: String(themeConfig.reportConfidentiality ?? ''),
      preparedBy: String(whitelabel?.company_name ?? ''),
    },
    capturedAt: opts.capturedAt,
  });

  for (const skipped of skippedAssets) {
    notes.push(`asset ${skipped.source} skipped (${skipped.reason}): ${skipped.detail}`);
  }

  const cover = (assets.cover ?? '').trim();
  return {
    snapshot,
    disclaimer,
    coverArtDataUri: cover.startsWith('data:') ? cover : null,
    notes,
  };
}
