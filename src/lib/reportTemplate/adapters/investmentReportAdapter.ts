import { getAuthenticatedSupabaseClient } from '@/hooks/useAuthenticatedSupabase';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { extractStructureHeadings, selectStructureTemplate } from '@/lib/reportTemplate/cascadeMap';
import { chunkReportContent } from '@/lib/reportTemplate/reportSections';
import { presentStoredMarkdown } from '@/lib/reports/investment/derivedHygiene.pure';
import { readEvidenceInventory } from '@/lib/reports/investment/chartEvidence.pure';
import { investmentReportFileName } from '@/lib/reports/investment/reportFileName.pure';
import {
  photographResumeRequest,
  PHOTOGRAPH_RESUME_TIMEOUT_MS,
  readPhotographCapture,
  type PhotographCaptureReading,
} from '@/lib/reports/urlExtractPhotographs';
import { applyInvestmentProjection } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import type { BrandContext, ReportListing, ReportTemplateAdapter, RoutingContext, TemplateBindingContext } from './types';
import { applyOrganisationAndBrand } from './organisation';
import { inlineReportPhotographs, type SignedPhotograph } from './reportPhotographs';

function flatten(obj: any): Record<string, any> {
  if (!obj || typeof obj !== 'object') return {};
  return { ...obj };
}

/**
 * Best-effort headings of the active report-structure guide for this report's
 * type/tier, so `sections.*` chunk ids line up with the Cascade contract ids.
 * Failures (offline, a guide that is not published) degrade to chunking by the
 * report's own headings.
 *
 * ## Why the gateway client and not the browser one
 *
 * `report_structure_templates`' only SELECT policy is
 * `auth.role() = 'authenticated'`, and this app's identity is a custom HttpOnly
 * cookie — so the browser client is `anon` and the read returned **0 of the 4
 * published guides**, for every user, every time. Not an error: an empty
 * result, which fell straight into the documented "degrade to the report's own
 * headings" path. So the degradation was not a fallback at all, it was the only
 * behaviour, and `sections.<contract id>` resolved to the empty string on every
 * Investment render. Measured in production 2026-08-16; see `secureSource.ts`
 * for the rest of the same class.
 */
/**
 * The `report_category` a guide is filed under, for this report.
 *
 * Not the format. The four active guides carry `investment` or `suburb`, and
 * this used to be passed the report's *format* — `investment_compass`, or
 * `address` once `getReportType` had fallen through to `report_scope`. Neither
 * has ever been a category, so the (tier, category) lookup missed on every one
 * of the 1,187 stored reports.
 *
 * `suburb` is a scope AND a category, which is the whole reason the confusion
 * was possible: `Suburb Compass Structure v1` is `(compass, suburb)`. So a
 * suburb-scoped report asks for `suburb` and every other report asks for
 * `investment`.
 */
function structureCategoryFor(row: any): string {
  return String(row?.report_scope ?? '').toLowerCase() === 'suburb' ? 'suburb' : 'investment';
}

async function loadStructureHeadings(tier: string | null, category: string | null): Promise<string[]> {
  try {
    const { data, error } = await getAuthenticatedSupabaseClient()
      .from('report_structure_templates')
      .select('id,name,parsed_content,report_tier,report_category,priority')
      .eq('template_type', 'ai_structure')
      .eq('is_active', true);
    if (error || !data) return [];
    const row = selectStructureTemplate(data as any[], { tier, category });
    return extractStructureHeadings((row as any)?.parsed_content || '');
  } catch {
    return [];
  }
}

async function loadInvestmentReport(reportId: string): Promise<any | null> {
  const { data: resp, error } = await invokeSecureFunction('get-investment-reports', {
    table: 'investment_reports',
    reportId,
    listOptions: { select: '*' },
  } as any);

  // No browser-client fallback: `investment_reports` is invisible to it under
  // this app's custom auth (see `adapters/secureSource.ts`), so the fallback
  // could only ever turn a broker failure into the same null more slowly —
  // while reading as though a second route existed.
  if (error) return null;
  return ((resp as any)?.report as any) ?? null;
}

/**
 * The report and the property's own photographs, in one read.
 *
 * The same broker and the same `reports` permission as `loadInvestmentReport`;
 * the photographs are an ADDITION the broker never lets fail the read, so a
 * report with none — or whose photographs could not be read — loads exactly as
 * it always did. See `reportPhotographs.pure.ts` for which may lead a client's
 * document.
 *
 * A URL-extract report's photographs are captured from its listing page after
 * the report is created, and an attempt the listing's host did not answer
 * leaves work over. The broker says so (`pending`), and this document asks for
 * the rest before it is drawn — waiting a bounded time, and reading again only
 * if the attempt ran — so it carries what the capture keeps rather than what
 * the first attempt managed. Nothing about it can fail the read.
 *
 * Exported for the standard presentation (`deliverInvestmentPdf.ts`), which
 * draws the same report's pictures and must read them by the same rule: one
 * reader, so a report cannot carry a photograph in one presentation that the
 * other refuses.
 */
export async function loadInvestmentReportWithPhotographs(
  reportId: string,
): Promise<{ report: any; photographs: SignedPhotograph[]; floorPlans: SignedPhotograph[] } | null> {
  const first = await readReportAndPhotographs(reportId);
  if (!first) return null;
  const resume = photographResumeRequest(first.capture);
  if (!resume) return first;
  const { error } = await invokeSecureFunction('listing-images', { ...resume }, { timeoutMs: PHOTOGRAPH_RESUME_TIMEOUT_MS })
    .catch(() => ({ error: { message: 'unreachable' } }));
  if (error) return first;
  return (await readReportAndPhotographs(reportId)) ?? first;
}

async function readReportAndPhotographs(
  reportId: string,
): Promise<{
  report: any;
  photographs: SignedPhotograph[];
  floorPlans: SignedPhotograph[];
  capture: PhotographCaptureReading | null;
} | null> {
  const { data: resp, error } = await invokeSecureFunction('get-investment-reports', {
    table: 'investment_reports',
    reportId,
    photographs: true,
    listOptions: { select: '*' },
  } as any);
  if (error) return null;
  const report = (resp as any)?.report ?? null;
  if (!report) return null;
  const photographs = Array.isArray((resp as any)?.photographs) ? (resp as any).photographs as SignedPhotograph[] : [];
  // Served apart because they are drawn apart: whole, on a page of their own.
  const floorPlans = Array.isArray((resp as any)?.floorPlans) ? (resp as any).floorPlans as SignedPhotograph[] : [];
  return { report, photographs, floorPlans, capture: readPhotographCapture(resp) };
}

/**
 * Which format a stored investment report is.
 *
 * ## `report_type` is not a column on this table
 *
 * `investment_reports` has `report_tier`, `report_variant` and `report_scope`;
 * there has never been a `report_type`. So `row.report_type` was `undefined`
 * for every row ever read, and the expression fell through to `report_scope` —
 * which is `address` or `suburb`, a *geography*, not a format.
 *
 * Measured 2026-08-16 over the 1,187 stored reports:
 *
 * | tier | rows | resolved to | reaches a template? |
 * | --- | ---: | --- | --- |
 * | `compass` | 1,124 | `investment_compass` | yes |
 * | `snapshot` | 24 | **`address`** | no |
 * | `briefing` | 21 | **`address`** | no |
 * | `strategic` | 9 | **`address`** | no |
 * | `financial` | 9 | **`address`** | no |
 *
 * `address` matches no adapter, no entry in `REPORT_TYPE_ALIASES` and no row in
 * `report_templates`, so `routeReportThroughTemplate` refused with
 * `no_active_template` and fell back to the legacy generator every time. The
 * render ledger agrees: of every job it holds, five are `investment_compass`
 * and **none** is any other tier.
 *
 * All five tiers are one format. `REPORT_TYPE_ALIASES` already folds
 * `investment_compass` onto `investment`, so naming the compass tier separately
 * costs nothing and keeps the routing context readable — but the scope must
 * never be mistaken for a format again.
 */
function getReportType(row: any): string {
  const tier = String(row?.report_tier ?? '').toLowerCase();
  const variant = String(row?.report_variant ?? '').toLowerCase();
  if (tier === 'compass' || variant === 'compass') return 'investment_compass';
  return 'investment';
}

export const investmentReportAdapter: ReportTemplateAdapter = {
  reportType: 'investment',
  label: 'Investment Report',
  supportsProduction: true,
  samplePresetIds: ['investment-default'],
  legacyFallback: {
    label: 'Investment legacy PDF generator',
    reason: 'Used when no active WeasyPrint template matches the investment report context.',
  },

  /**
   * Through `get-investment-reports` — the same edge function and therefore
   * the same `reports` module permission check as every other read of this
   * table — with the direct-table fallback `loadInvestmentReport` has.
   */
  async listRecentReports({ limit = 20 }: { limit?: number } = {}): Promise<ReportListing[]> {
    try {
      const { data: resp, error } = await invokeSecureFunction('get-investment-reports', {
        listMode: true,
        listOptions: {
          select: 'id, property_address, created_at',
          orderBy: 'created_at',
          orderAsc: false,
          limit,
        },
      } as any);
      // Same reason as `loadReport`: there is no second route to fall back to.
      const rows: any[] | null = error ? null : ((resp as any)?.reports ?? null);
      return (rows ?? []).map((row) => ({
        id: String(row.id),
        label: (row.property_address as string) || `Report ${String(row.id).slice(0, 8)}`,
        savedAt: (row.created_at as string) ?? null,
      }));
    } catch {
      return [];
    }
  },

  async resolveRoutingContext({ reportId }): Promise<RoutingContext | null> {
    const row = await loadInvestmentReport(reportId);
    if (!row) return null;
    const reportType = getReportType(row);
    return {
      reportId,
      reportType,
      variant: (row.report_variant ?? null) as string | null,
      tier: (row.report_tier ?? null) as string | null,
      title: row.property_address ?? null,
      fileLabel: row.property_address ?? reportType,
      // Named the way the standard presentation names it, so the two
      // presentations of one report download under one name.
      fileName: investmentReportFileName({
        tier: (row.report_variant ?? row.report_tier ?? null) as string | null,
        address: row.property_address ?? null,
        at: new Date(),
      }),
      sourceTable: 'investment_reports',
      legacyFallback: investmentReportAdapter.legacyFallback,
    };
  },

  async buildBindingContext({ reportId, brand, payload }: {
    reportId: string;
    brand?: BrandContext | null;
    /**
     * The caller's already-presented report content.
     *
     * `deliverInvestmentPdf` applies the two CONTENT rules — Sources and
     * Scoring — to the report's Markdown before it chooses a presentation, so
     * that a chosen template and the standard document contain the same
     * sections. Without this the switches reached the standard document alone
     * and a templated report carried whatever the operator had turned off.
     *
     * It is the report's own content with sections removed, never new content:
     * a caller cannot use this to put anything into a document that the record
     * does not already say.
     */
    payload?: Record<string, unknown> | null;
  }): Promise<TemplateBindingContext | null> {
    const withPhotographs = await loadInvestmentReportWithPhotographs(reportId);
    if (!withPhotographs) return null;
    const loaded = withPhotographs.report;
    const presentedContent = typeof payload?.reportContent === 'string'
      ? payload.reportContent
      : null;
    // "Include scoring" OFF. The section filter above removed the scoring
    // chapters from the Markdown, but a template binds the grade, the score
    // and the breakdown DIRECTLY (`scores.*`, and the projection's own verdict
    // blocks read the row), so a dashboard page still drew the grade the
    // operator had switched off. The switch is read here, once, and the row
    // the template and the projection both draw from carries no score — the
    // same document the standard presentation prints with scoring off.
    // Absent means "not included", never "not graded": nothing here rewrites
    // the stored row, and the default (the switch not sent) includes it.
    const includeScoring = payload?.includeScoring !== false;
    // Who the document is for. The Markdown already carries the audience's
    // sections (`deliverInvestmentPdf`); what it cannot reach are the BOUND
    // values — the rent and yield tiles, the cash-flow rows, the standfirst —
    // which the projection withholds or rewords for an owner-occupier. Absent
    // is the investor, which binds exactly what it always did.
    const audience = typeof payload?.audience === 'string' ? payload.audience : null;
    // Through the read-path placeholder scrub every renderer applies
    // (`presentStoredMarkdown`): a derived report stored before the write-path
    // hygiene carries its "N/A" cells verbatim, and the templated document is
    // drawn from this row twice — `sections` below and the projection's own
    // narrative — so the row is presented once, here, for both.
    const row = {
      ...loaded,
      report_content: presentStoredMarkdown(
        presentedContent === null ? loaded.report_content : presentedContent,
        readEvidenceInventory(loaded as unknown as Record<string, unknown>),
      ),
      ...(includeScoring ? {} : { investment_score: null }),
    };

    const reportType = getReportType(row);
    const variant = (row.report_variant ?? null) as string | null;
    const tier = (row.report_tier ?? null) as string | null;
    const structureHeadings = await loadStructureHeadings(tier, structureCategoryFor(row));

    const data: Record<string, any> = {
      report: {
        id: row.id,
        type: reportType,
        variant,
        tier,
        address: row.property_address ?? '',
        generated_at: row.updated_at ?? row.created_at,
        status: row.status,
      },
      property: flatten(row.property_specs),
      financials: flatten(row.financial_calculations),
      scores: flatten(row.investment_score),
      demographics: flatten(row.demographics_data),
      economic: flatten(row.economic_data),
      location: flatten(row.location_intelligence),
      sections: chunkReportContent(row.report_content, { structureHeadings }),
      sources: flatten(row.sources_content),
      overrides: flatten(row.manual_overrides),
      tier,
      variant,
      brand: {
        tokens: brand?.tokens ?? {},
        logo: brand?.logoUrl ?? null,
      },
    };

    // The raw namespaces above are the database's vocabulary; the seeded
    // catalogue binds a different one. Without this, 79 of the 50 Compass
    // masters' 80 bindings resolve to nothing on a real report — see
    // `reportBindingProjection.pure.ts`. Additive: nothing above is replaced.
    applyInvestmentProjection(data, row as Record<string, unknown>, { audience });
    // The letterhead — the wordmark on the cover and the contact block on the
    // disclaimer page every template ends with. Nothing published `org` until
    // August 2026, so both printed blank on every report this product has ever
    // generated. See `organisationProjection.pure.ts`.
    await applyOrganisationAndBrand(data);

    // The property's own photographs, where its listing holds any a client's
    // document may carry. `property.images.N` is what the photographic masters
    // bind — a cover hero on three, full-page plates on five — and every slot
    // is conditional, so a report with none draws exactly what it drew before.
    // Set after the projection so nothing above can overwrite it.
    const [images, floorPlans] = await Promise.all([
      inlineReportPhotographs(withPhotographs.photographs),
      // The floor plans, where the brochure or the listing held one: bound
      // apart as `property.floorPlans`, because every photo slot crops to fill
      // its frame and a plan is drawn whole, on a page of its own.
      inlineReportPhotographs(withPhotographs.floorPlans),
    ]);
    if (images.length) data.property = { ...(data.property ?? {}), images };
    if (floorPlans.length) data.property = { ...(data.property ?? {}), floorPlans };

    return {
      data,
      meta: { reportId, reportType, variant, tier },
    };
  },
};
