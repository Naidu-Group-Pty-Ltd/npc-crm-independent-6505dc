import {
  loadClientRecord as loadClientRecordSecure,
  loadCommercialAssessment,
  listCommercialAssessments,
} from './secureSource';
import type {
  BrandContext, ReportListing, ReportTemplateAdapter, RoutingContext, TemplateBindingContext,
} from './types';
import {
  buildCapacitySnapshot,
} from '../../../../supabase/functions/_shared/reports/commercialCapacity/normalise.pure';
import {
  isReportable,
} from '../../../../supabase/functions/_shared/reports/commercialCapacity/route.pure';
import {
  applyCommercialCapacityProjection,
} from '../../../../supabase/functions/_shared/commercialCapacityProjection.pure';
import { applyOrganisationAndBrand } from './organisation';

/**
 * Commercial & Industrial Capacity, from the stored calculation run.
 *
 * `buildCapacitySnapshot` is the same normaliser `render-commercial-capacity-pdf`
 * calls, so a template and the flowing route describe one assessment the same
 * way. The format's first rule — every figure comes from the stored run and
 * never from a recomputation — is kept by construction: this adapter reads
 * `outputs` and `inputs_snapshot` off the run and computes nothing.
 *
 * ## It declines most assessments, and that is correct
 *
 * Of the sixteen assessments in production, **thirteen have no calculation
 * run** — seven `draft`, four `archived`, two `data_entry`. There are no figures
 * for a document to carry, so this returns `null` rather than a document full of
 * blanks. That is the Cash Flow adapter's behaviour and for the same reason.
 *
 * ## Reportability follows the render route rather than the run
 *
 * A run is necessary but not sufficient: `isReportable` is the route's own
 * policy and this defers to it, so a template cannot produce a document the
 * flowing route would refuse. That costs one assessment today — a `calculated`
 * row carrying a complete run and outcome — and the alternative is two parts of
 * one product disagreeing about whether a deal may be sent to a client, which is
 * worse than a row you have to link first.
 */

/*
 * This file used to hold an `ASSESSMENT_COLUMNS` / `RUN_COLUMNS` pair naming
 * the thirty-one columns the two reads selected. The reads are the broker's
 * now (see `loadSnapshotInputs`), which returns whole rows, so the lists chose
 * nothing — and a column list that no read uses is the exact shape of the
 * defect `adapterSelectColumns.spec.ts` exists to catch: it looks checked, it
 * looks load-bearing, and a rename would leave it wrong with nothing failing.
 * What this format binds is stated where it is used, in
 * `commercialCapacityProjection.pure.ts` and `normalise.pure.ts`.
 */

/**
 * The linked client's display name, when there is one.
 *
 * An assessment need not be linked — the C&I workflow allows one to be built
 * standalone — so an absent name is normal and the snapshot falls back to the
 * assessment's own title. `clients` is queried for the columns that exist on it;
 * this is the mistake that cost the Comparison adapter a working cover, where
 * `client_name` was read off a table that has never had the column.
 */
async function loadClientName(clientId: string | null): Promise<string | null> {
  if (!clientId) return null;
  // Through the broker: `clients` is invisible to the browser client under
  // this app's custom auth, so the report's client line was empty for every
  // assessment. See `secureSource.ts`.
  const record = await loadClientRecordSecure(clientId, { properties: false });
  const data = record?.client as Record<string, any> | undefined;
  if (!data) return null;
  const name = [data.primary_first_name, data.primary_surname]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return name || null;
}

/**
 * The assessment and its stored run, in one authorised call.
 *
 * Both tables are service-role-only — `service_role manages ci assessments` is
 * their single policy — so reading them on the browser client returned zero
 * rows for every assessment and every user. Not an error: an empty result,
 * which this function answered as `null`, the router read as "this adapter
 * refuses this record", and the caller turned into the legacy generator. This
 * format had rendered no design-system document at all.
 *
 * `manage-ci-assessments`' `get` returns exactly the pair this needs, scoped to
 * the caller by its own `loadOwned`, so this is a broker that already exists
 * rather than a new authorisation decision. It hands back the assessment's
 * LATEST base run; the previous read followed `current_calculation_id`, so the
 * run is checked against it rather than assumed — a re-issued report must say
 * what the first one said.
 */
async function loadSnapshotInputs(reportId: string) {
  const found = await loadCommercialAssessment(reportId);
  if (!found) return null;
  const { assessment, latestRun } = found;
  if (!isReportable(assessment.status)) return null;

  const runId = assessment.current_calculation_id as string | null;
  if (!runId) return null;
  // The broker returns the latest base run. If the assessment points at a
  // different one, the figures on the page would not be the ones the record
  // names, and a plausible wrong number is this programme's top risk.
  if (!latestRun || latestRun.id !== runId || !latestRun.outputs) return null;

  return { assessment, run: latestRun };
}

export const commercialCapacityAdapter: ReportTemplateAdapter = {
  reportType: 'commercial_capacity',
  label: 'Commercial & Industrial Capacity',
  supportsProduction: true,
  legacyFallback: {
    label: 'Commercial & Industrial Capacity report',
    route: 'render-commercial-capacity-pdf',
    reason:
      'The archetype route renders the full assessment including the method trail. '
      + 'A template carries the assessment and its analysis, and stays available for '
      + 'an assessment with a stored calculation run.',
  },

  /**
   * Only assessments a document can be produced for: reportable status and a
   * linked run. `isReportable` is applied here exactly as it gates the render,
   * so the picker cannot offer a row the adapter would then decline — of the
   * sixteen in production, three would list. Filtered after the read because
   * the policy lives in `isReportable`, not in a status list this file would
   * have to keep in step.
   */
  async listRecentReports({ limit = 20 }: { limit?: number } = {}): Promise<ReportListing[]> {
    try {
      // Through the broker, for the same reason `loadSnapshotInputs` is.
      const data = await listCommercialAssessments(Math.max(limit * 3, 30));
      if (!data.length) return [];
      return data
        .filter((row) => isReportable(row.status) && row.current_calculation_id)
        .slice(0, limit)
        .map((row) => ({
          id: String(row.id),
          label: (row.title as string) || (row.reference as string) || 'Capacity assessment',
          savedAt: (row.created_at as string) ?? null,
        }));
    } catch {
      return [];
    }
  },

  async resolveRoutingContext({ reportId }): Promise<RoutingContext | null> {
    const loaded = await loadSnapshotInputs(reportId);
    if (!loaded) return null;
    const { assessment } = loaded;
    return {
      reportId,
      reportType: 'commercial_capacity',
      variant: (assessment.segment as string) ?? null,
      tier: null,
      title: (assessment.title as string) || 'Commercial & Industrial Capacity',
      fileLabel: 'commercial-industrial-capacity',
      sourceTable: 'commercial_industrial_assessments',
      legacyFallback: commercialCapacityAdapter.legacyFallback,
    };
  },

  async buildBindingContext(
    { reportId, brand }: { reportId: string; brand?: BrandContext | null },
  ): Promise<TemplateBindingContext | null> {
    const loaded = await loadSnapshotInputs(reportId);
    if (!loaded) return null;
    const { assessment, run } = loaded;

    const snapshot = buildCapacitySnapshot({
      assessment,
      outputs: run.outputs,
      inputs: run.inputs_snapshot,
      clientName: await loadClientName(assessment.client_id ?? null),
      // Reused from the run, never regenerated here. A re-issued report must say
      // what the first one said, and a template render is not the place to spend
      // a metered model call.
      analysis: (run.analysis ?? null) as never,
    });

    const data: Record<string, any> = {
      report: {
        id: assessment.id,
        type: 'commercial_capacity',
        generated_at: assessment.updated_at ?? assessment.created_at,
      },
      assessment,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    applyCommercialCapacityProjection(data, snapshot);
    await applyOrganisationAndBrand(data);

    return {
      data,
      meta: {
        reportId,
        reportType: 'commercial_capacity',
        variant: (assessment.segment as string) ?? null,
        tier: null,
      },
    };
  },
};
