/**
 * The Borrowing Capacity Snapshot's Template Builder adapter.
 *
 * ## Why this exists
 *
 * Until now every report type but `investment` was a `previewOnlyAdapter`: a
 * stub whose `buildBindingContext` returns `null`. That is what
 * `supportsProduction` gates and what `deriveEntryFacts` reads to decide
 * `production_ready`, so a Borrowing Capacity template could be browsed, previewed
 * and copied but could never render a real client's assessment. Seeding a design
 * catalogue for the format without this would have shipped 50 templates that look
 * finished and cannot do the job.
 *
 * It is the natural second format to make real. `borrowing_capacity_assessments`
 * is a **typed, columnar table** — 35 columns, mostly numeric — rather than the
 * loose jsonb blob `investment_reports` keeps its figures in, and it holds 143
 * real assessments. The projection reads that shape rather than guessing it; see
 * `borrowingCapacityProjection.pure.ts`, and `docs/reports/BORROWING_CAPACITY.md`
 * for what guessing it cost the last time somebody tried.
 *
 * ## What this does NOT do
 *
 * It does not calculate anything. Every figure it exposes is one the calculator
 * already stored on the row, restated in the vocabulary a template binds. The
 * one exception is unit conversion — monthly to annual, and gross-minus-shaded —
 * which is arithmetic on stored values, not a second opinion about someone's
 * borrowing capacity. `docs/reports/BORROWING_CAPACITY.md` describes five
 * separate PDF implementations of this format; this adds no sixth calculator.
 */
import { applyBorrowingCapacityProjection } from '../../../../supabase/functions/_shared/borrowingCapacityProjection.pure';
import {
  CLIENT_NAME_COLUMNS, clientDisplayName, type ClientNameRow,
} from '../../../../supabase/functions/_shared/clientName';
import { applyOrganisationAndBrand } from './organisation';
import {
  loadClientRecord as loadClientRecordSecure,
  loadClientRowsByIds,
  loadBorrowingCapacityRow,
  listBorrowingCapacityRows,
} from './secureSource';
import type {
  BrandContext, ReportListing, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';

/**
 * One assessment, through the broker.
 *
 * `borrowing_capacity_assessments`' only non-service SELECT policy is a join
 * on `clients.created_by = auth.uid()`, and `auth.uid()` is always NULL in this
 * browser — identity is a custom HttpOnly cookie. So this read returned zero
 * rows for all 128 stored assessments and every user: not an error, an empty
 * result, which became `null`, which the router read as a refusal and turned
 * into the legacy generator. This format had rendered no design-system
 * document at all. See `secureSource.ts`.
 */
async function loadAssessment(reportId: string): Promise<Record<string, any> | null> {
  return loadBorrowingCapacityRow(reportId);
}

/**
 * The client behind an assessment.
 *
 * The projection deliberately will not guess a name from a `client_id`, so the
 * join is done here — and it asks for `CLIENT_NAME_COLUMNS` rather than naming
 * columns itself. That constant exists because both legacy render routes
 * invented their own spelling of this table, and one of them selected three
 * columns that do not exist and so 404'd for every client in the database.
 *
 * All 143 stored assessments carry a `client_id` that resolves to a real row.
 * A failed lookup still returns null rather than throwing: the document is
 * about the capacity, and losing the name off the cover is not a reason to fail
 * the whole render.
 */
async function loadClient(clientId: unknown): Promise<ClientNameRow | null> {
  if (typeof clientId !== 'string' || !clientId) return null;
  // Through the broker: `clients` is invisible to the browser client under
  // this app's custom auth, so this read returned null for every client and
  // the Snapshot's cover printed no name at all. See `secureSource.ts`.
  const record = await loadClientRecordSecure(clientId, { properties: false });
  return (record?.client as ClientNameRow) ?? null;
}

export const borrowingCapacityAdapter: ReportTemplateAdapter = {
  reportType: 'borrowing_capacity',
  label: 'Borrowing Capacity',
  supportsProduction: true,
  legacyFallback: {
    label: 'Borrowing Capacity Snapshot legacy generator',
    reason: 'The jsPDF Snapshot remains the default until a template is activated for this report type.',
  },

  /**
   * Two reads: the assessments, then one `.in()` on `clients` for the names —
   * through `CLIENT_NAME_COLUMNS`, because this table's columns have already
   * been misspelt into a 404 for every client once. An assessment whose client
   * cannot be read still lists; it just lists without a name.
   */
  async listRecentReports({ limit = 20 }: { limit?: number } = {}): Promise<ReportListing[]> {
    try {
      // Through the broker, for the same reason `loadAssessment` is.
      const data = await listBorrowingCapacityRows(limit, 'id, client_id, created_at');
      if (!data.length) return [];

      const clientIds = [...new Set(
        data.map((row: Record<string, any>) => row.client_id).filter((v: unknown) => typeof v === 'string'),
      )] as string[];
      const names = new Map<string, string>();
      if (clientIds.length > 0) {
        // One brokered list, indexed — `clients` is invisible to the browser
        // client, so this lookup used to label nothing at all.
        const rows = await loadClientRowsByIds(clientIds, CLIENT_NAME_COLUMNS);
        for (const [id, row] of rows) {
          const name = clientDisplayName(row as ClientNameRow);
          if (name) names.set(id, name);
        }
      }

      return (data as Record<string, any>[]).map((row) => ({
        id: String(row.id),
        label: names.get(String(row.client_id)) ?? 'Borrowing capacity assessment',
        savedAt: (row.created_at as string) ?? null,
      }));
    } catch {
      return [];
    }
  },

  async resolveRoutingContext({ reportId }): Promise<RoutingContext | null> {
    const row = await loadAssessment(reportId);
    if (!row) return null;
    return {
      reportId,
      reportType: 'borrowing_capacity',
      // The format has no variant or tier axis; the columns do not exist.
      variant: null,
      tier: null,
      title: 'Borrowing Capacity Snapshot',
      fileLabel: 'borrowing-capacity-snapshot',
      sourceTable: 'borrowing_capacity_assessments',
      legacyFallback: borrowingCapacityAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, brand }: { reportId: string; brand?: BrandContext | null },
  ): Promise<TemplateBindingContext | null> {
    const row = await loadAssessment(reportId);
    if (!row) return null;

    const data: Record<string, any> = {
      report: {
        id: row.id,
        type: 'borrowing_capacity',
        generated_at: row.updated_at ?? row.created_at,
      },
      // The raw row stays available under its own column names, exactly as the
      // investment adapter keeps `property_specs` beside the projected view.
      // Anything already bound to a column name keeps resolving.
      assessment: row,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    applyBorrowingCapacityProjection(data, row, await loadClient(row.client_id));
    // The letterhead — the wordmark on the cover and the contact block on the
    // disclaimer page every template ends with. Nothing published `org` until
    // August 2026, so both printed blank on every report this product has ever
    // generated. See `organisationProjection.pure.ts`.
    await applyOrganisationAndBrand(data);


    return {
      data,
      meta: { reportId, reportType: 'borrowing_capacity', variant: null, tier: null },
    };
  },
};
