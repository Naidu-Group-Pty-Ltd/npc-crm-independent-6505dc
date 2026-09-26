/**
 * The presentation layer's one entry point: a validated report plus the
 * template chosen for its format, drawn in the browser.
 *
 * Resolves a production-capable adapter for the report, resolves the chosen or
 * best-matching active template, renders it through the Report Presentation
 * Renderer, and returns null so callers fall back to the standard presentation
 * whenever this is not ready.
 *
 * ## The template never becomes a second source of truth
 *
 * `adapter.buildBindingContext` produces ONE frozen payload describing the
 * report after generation, calculation, reconciliation, validation and the
 * user's own edits. Everything below binds against that payload and nothing
 * else: no calculation runs here, no geography is resolved, no model is
 * called and nothing is fetched from a source table. One validated report,
 * several approved presentations.
 *
 * ## Two renderers, chosen by the caller
 *
 * The same validated payload and the same template can be drawn two ways:
 *
 *  * `browser` — the Report Presentation Renderer (jsPDF), in this tab.
 *    Instant, free, and limited: it embeds no fonts (every face becomes
 *    Helvetica), draws no block the registry marks partial, and cannot draw
 *    text on a filled panel legibly. It is the PREVIEW.
 *  * `weasyprint` — the same template compiled to print HTML and rendered by
 *    the pinned engine through `render-template-pdf`. Every declared typeface
 *    embedded, every block the HTML renderer knows, the document stored where
 *    a portal can serve it. It is the FINAL client document, and it is asked
 *    for only by a deliberate final action (RV-1, 14 Sep 2026).
 *
 * Nothing above the renderer changes with the choice: one adapter, one frozen
 * payload, one template, the same guards. Only the last step differs.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { SUPABASE_URL } from '@/integrations/supabase/env';
import { preloadImagesWithReport } from '@/lib/reportTemplate/imagePreloader';
import { renderTemplateToBlob } from '@/lib/reportTemplate/pdfRenderer';
import { judgeBrowserProductionExport } from '@/lib/reportTemplate/browserExportGuard';
import { compileTemplateHtmlForPdf } from '@/lib/reportTemplate/compileTemplateForPdf';
import { renderFinalHtmlToPdf, RenderServiceError } from '@/lib/reportTemplate/weasyRenderClient';
import { getBlockRendererCapabilities } from '@/lib/reportTemplate/blocks';
import { parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { resolveReportTemplate, type ReportVariant } from '@/lib/reportTemplate/resolveTemplate';
import { refuseUnboundReconstruction } from '@/lib/reportTemplate/rendering/productionTemplateGuard';
import { getAdapter, listAdapters, type ReportTemplateAdapter } from '@/lib/reportTemplate/adapters';
import { isSelectableTemplate } from '@/lib/reportTemplate/templateSelection';
import { measureBindingCoverage } from '@/lib/reportTemplate/templateBindingCoverage.pure';
import { composeTemplateWithDonor } from '@/lib/reportTemplate/templateComposition.pure';
import { withIssuerTagline } from '@/lib/reportTemplate/houseTaglineGuard.pure';
import { isPrimeDeployment } from '@/lib/primeDeployment';

/**
 * Why the templated document was not produced.
 *
 * The route answers `null` for eight distinct reasons and, until this existed,
 * said the same nothing for all of them: the caller fell back to the legacy
 * generator, which on the migrated formats is itself a well-typeset WeasyPrint
 * document, so "your template rendered" and "your template was skipped" looked
 * identical from the outside AND from the console. Diagnosing one refusal cost
 * a production ledger query and a round trip.
 *
 * Named here so a person can be told which gate closed, in the toast, on the
 * first attempt rather than the third.
 */
export type TemplateRouteRefusal =
  /** No production adapter claims this report type. */
  | 'no_adapter'
  /** The adapter cannot serve this record — unreadable, or nothing to draw. */
  | 'adapter_declined_record'
  /** The report type is outside the caller's allow-list (the Compass pilot). */
  | 'report_type_not_allowed'
  /** Nothing active is published for the format, and nothing was chosen. */
  | 'no_active_template'
  /**
   * The renderer cannot draw one of this template's blocks, so the document
   * would carry a placeholder panel where a client expects content.
   *
   * This used to be `template_not_weasyprint` and was decided by the
   * template's `engine` column — a fact about which service had been chosen
   * for it, not about whether it can be drawn. Compatibility is asked of the
   * renderer itself now (`judgeBrowserProductionExport`), which is the only
   * thing that actually knows.
   */
  | 'template_not_browser_renderable'
  /** The HTML renderer has no drawing for one of this template's blocks. */
  | 'template_not_renderable'
  /** The adapter loaded the record but published nothing bindable. */
  | 'adapter_published_no_data'
  /** The template's schema does not parse against the current contract. */
  | 'template_schema_invalid'
  /** A static copy of one client's report; see `productionTemplateGuard`. */
  | 'template_unbound_reconstruction'
  /**
   * The template binds nothing of this report's body, and no published
   * template for the format could lend it one. Measured, never inferred:
   * every bound path was resolved against the data the adapter built, the
   * way the renderer would resolve it (`templateBindingCoverage.pure.ts`).
   * On 15 Sep 2026 a five-page library template shipped near-empty under the
   * tenant's letterhead because nothing measured this.
   */
  | 'template_carries_no_content'
  /**
   * The print engine did not answer — the render service host answered
   * 502/503/504 or nothing at all. Distinct from `render_failed` because the
   * remedy is different (wait, or check the Cloud Run service) and because
   * on 15 Sep 2026 every chosen template fell back to the standard layout
   * for this reason while the operator was told only that "the renderer
   * could not produce the document" (QA-291SM).
   */
  | 'engine_unavailable'
  /** WeasyPrint refused or failed the document, or storage or the signed URL failed. */
  | 'render_failed'
  /** Anything unforeseen; the message is in the console. */
  | 'unexpected_error';

/** Human wording for a refusal, for the person who chose a template. */
export const TEMPLATE_ROUTE_REFUSAL_TEXT: Readonly<Record<TemplateRouteRefusal, string>> = {
  no_adapter: 'This report format has no design-system pipeline yet',
  adapter_declined_record: 'This record could not be read, or holds nothing this format can draw',
  report_type_not_allowed: 'This report type is not routed through the design system here',
  no_active_template: 'No active template is published for this format',
  template_not_browser_renderable: 'The chosen template uses layout blocks this renderer cannot draw yet',
  template_not_renderable: 'The chosen template uses a layout block no renderer can draw',
  adapter_published_no_data: 'This record published no data for the template to bind',
  template_schema_invalid: 'The template could not be read against the current schema',
  template_unbound_reconstruction: 'The template is a fixed copy of one report and cannot be reused',
  template_carries_no_content: 'The chosen template binds none of this report\'s content, and no template that does is published for the format',
  engine_unavailable: 'The print engine did not answer',
  render_failed: 'The renderer could not produce the document',
  unexpected_error: 'Something went wrong preparing the document',
};

export type TemplateRenderer = 'browser' | 'weasyprint';

export interface TemplateBuilderRouteResult {
  /** The document itself. */
  blob: Blob;
  fileName: string;
  /**
   * What actually drew it. A literal is how telemetry comes to claim a
   * renderer the product stopped using, so this is the renderer's own
   * identifier rather than a string written here.
   */
  renderer: typeof BROWSER_PRESENTATION_RENDERER | typeof WEASYPRINT_FINAL_RENDERER;
  templateId: string;
  source: string;
  /**
   * Where the render service stored the document, when one did. A browser
   * render has none: the blob exists only in this tab until a caller stores
   * it. A final render is stored by the service and this names it, so a
   * publish reuses the bytes already on disk rather than uploading a copy.
   */
  storagePath: string | null;
  /**
   * Set when the caller asked for the FINAL renderer and got the preview one
   * instead: the print engine did not answer (or answered with a 5xx of its
   * own), the template's blocks are all ones the in-tab renderer draws in
   * full, and the same template was drawn here with the same bound data.
   *
   * `renderer` on this result already says which engine drew the bytes; this
   * says WHY it was not the one asked for, in the route's own refusal
   * vocabulary and with the engine's words, so the person can be told that
   * their template was honoured and their final document was not produced.
   * Null whenever the renderer asked for is the renderer that drew.
   */
  degradedFrom: {
    renderer: typeof WEASYPRINT_FINAL_RENDERER;
    refusal: Extract<TemplateRouteRefusal, 'engine_unavailable' | 'render_failed'>;
    detail: string;
  } | null;
  /**
   * Set when the chosen template could not carry the report and was composed
   * over a donor: its closing pages kept, its cover kept only where it
   * resolves this report's identity, its content pages that resolved nothing
   * of this report left out, and the report body — and the cover, where the
   * chosen one could not name this report — drawn from the donor's pages
   * under the chosen template's tokens. Null when the template was drawn as
   * designed. See `templateComposition.pure.ts`.
   */
  composed: {
    donorTemplateId: string;
    donorName: string | null;
    /** Names of the chosen template's pages that were kept, in order. */
    kept: string[];
    /** Names of the chosen template's pages left out. */
    dropped: string[];
    bodyPages: number;
    /** Whose cover leads the composed document. */
    coverFrom: 'chosen' | 'donor' | 'none';
  } | null;
}

/**
 * Named once, and imported by anything that reports which engine drew a file.
 *
 * It is NOT the same identity as the standard presentation's. Both draw in the
 * browser, and they are different renderers drawing different documents —
 * `investmentPdfDocument` composes the standard document with pdf-lib, this
 * draws a chosen template with jsPDF. Telemetry has one question to answer:
 * which renderer produced these exact bytes. One name for two answers is how
 * that question stops being answerable.
 */
export const BROWSER_PRESENTATION_RENDERER = 'browser_template_jspdf' as const;

/**
 * The final client document's renderer: the pinned WeasyPrint engine behind
 * `render-template-pdf`. Named once, here, beside the preview renderer it is
 * chosen instead of.
 */
export const WEASYPRINT_FINAL_RENDERER = 'weasyprint_final' as const;

/**
 * Whether the preview renderer may stand in for the final one, given how the
 * final render failed.
 *
 * ## Why a stand-in exists at all
 *
 * On 15 Sep 2026 the render container answered every request with Cloud
 * Run's own 500 page for more than five hours (`RENDER_SERVICE_AVAILABILITY.md`).
 * Every chosen template fell back to the standard pdf-lib layout, and the one
 * person who needed the templated document — to audit the content in the
 * design it would be sent in — could not get it from the product at all,
 * while the in-tab renderer that had drawn that exact template for a year
 * (RV-1 retired it as the FINAL renderer, not as a renderer) sat idle.
 *
 * ## What may stand in, and what may not
 *
 * Only a failure OF THE ENGINE: it did not answer (`engine_unavailable`), or
 * it answered with a 5xx of its own (`engine_failed`) — in both the document
 * was never drawn. A refusal (`engine_refused`: credentials, a document it
 * will not take) is not stood in for, because the browser would ship the
 * same document the engine declined. And nothing but a `RenderServiceError`
 * qualifies: the client-readiness gate answers 409 as a plain error, and a
 * document the server refused as not client-ready must not come out of a
 * different renderer. (The gate runs BEFORE the engine is called, so an
 * engine failure means the gate had already passed for this document.)
 *
 * And only where every block is one the browser renderer draws in full —
 * the same judgement `renderer: 'browser'` is subject to. A placeholder
 * panel on a client's page is worse than the standard document.
 *
 * The result is still marked (`degradedFrom`, and `renderer` names the
 * browser): a stand-in is a templated document, not the final one, and the
 * caller says so.
 */
function browserStandInFor(
  failure: unknown,
  schema: Parameters<typeof judgeBrowserProductionExport>[0],
): TemplateBuilderRouteResult['degradedFrom'] {
  if (!(failure instanceof RenderServiceError)) return null;
  const engineDidNotDraw = failure.kind === 'engine_unavailable'
    || (failure.kind === 'engine_failed' && (failure.upstreamStatus ?? 500) >= 500);
  if (!engineDidNotDraw) return null;
  if (judgeBrowserProductionExport(schema).ok === false) return null;
  return {
    renderer: WEASYPRINT_FINAL_RENDERER,
    refusal: failure.kind === 'engine_unavailable' ? 'engine_unavailable' : 'render_failed',
    detail: failure.message,
  };
}

function candidateAdapters(reportType?: string | null): ReportTemplateAdapter[] {
  const explicit = getAdapter(reportType);
  if (explicit) return [explicit];
  return listAdapters().filter((adapter) => adapter.supportsProduction);
}

/**
 * The template the person chose, when they chose one.
 *
 * Read back from the server rather than trusted from the caller: the id
 * travelled through the browser, and the row it names has to still be active
 * and still belong to this format. `manage-templates` applies its own read
 * scope on top, so a caller cannot fetch a template they may not see.
 *
 * Returns null — never throws and never substitutes — when the selection no
 * longer applies. The caller then resolves by ranking exactly as it did before
 * selections existed, which is also what the picker has already told the user
 * is happening (`status: 'unavailable'`).
 */
async function loadSelectedTemplate(
  templateId: string, reportType: string,
): Promise<any | null> {
  try {
    const { data, error } = await invokeSecureFunction('manage-templates', {
      operation: 'get',
      table: 'report_templates',
      recordId: templateId,
    });
    const row = (data as any)?.record;
    if (error || !row) {
      console.warn('[routeReportThroughTemplate] selected template unreadable', error);
      return null;
    }
    if (!isSelectableTemplate(row, reportType)) {
      console.warn(
        `[routeReportThroughTemplate] selected template ${templateId} no longer applies to `
        + `${reportType} (active=${row.is_active}, type=${row.report_type}) — falling back to ranking`,
      );
      return null;
    }
    return row;
  } catch (e) {
    console.warn('[routeReportThroughTemplate] selected template lookup failed', e);
    return null;
  }
}

/** How many published templates the donor search will read the schema of. */
const DONOR_SEARCH_LIMIT = 8;

interface BodyDonor {
  id: string;
  name: string | null;
  schema: ReturnType<typeof parseTemplate>;
}

/**
 * A published template for this format that carries the report body, for a
 * chosen template that does not.
 *
 * The ranking's own answer is asked first — it is what the document would
 * have come out in had nobody chosen — but the ranking prefers a person's own
 * templates over the global masters (`resolve_report_template`: user > agency
 * > global), so the very template that cannot carry the report can also be
 * the one the ranking picks. The published set is then read, defaults and
 * global scope first, one schema at a time up to `DONOR_SEARCH_LIMIT`, until
 * one measures as carrying the body against THIS report's data. A candidate
 * that does not parse, or does not carry it, is passed over rather than
 * reported: the caller names the refusal once, when none does.
 */
async function findBodyDonor(
  reportType: string,
  excludeId: string,
  data: Record<string, unknown>,
  ranking: { variant: ReportVariant | null; agencyId: string | null; userId: string | null },
): Promise<BodyDonor | null> {
  const tried = new Set<string>([excludeId]);
  // A donor that carries the report's narrative is preferred; one that
  // resolves any content at all is the fallback, for formats with no narrative.
  let contentOnly: BodyDonor | null = null;
  const consider = (row: any): BodyDonor | null => {
    if (!row?.id || tried.has(row.id)) return null;
    tried.add(row.id);
    try {
      const schema = parseTemplate(row.schema);
      const cov = measureBindingCoverage(schema, data);
      const donor = { id: row.id, name: row.name ?? null, schema };
      if (cov.carriesBody) return donor;
      if (cov.carriesContent && !contentOnly) contentOnly = donor;
      return null;
    } catch {
      return null;
    }
  };
  try {
    const ranked = await resolveReportTemplate({ reportType, ...ranking });
    const fromRanking = ranked ? consider(ranked.template) : null;
    if (fromRanking) return fromRanking;
    const listing = await invokeSecureFunction('manage-templates', {
      operation: 'list',
      table: 'report_templates',
      listOptions: {
        select: 'id,name,report_type,engine,is_active,is_default,is_draft,scope,priority,updated_at',
        orderBy: 'priority',
        orderAsc: false,
        filters: { is_active: true },
        limit: 200,
      },
    });
    const records = (listing?.data as { records?: unknown } | null | undefined)?.records;
    if (listing?.error || !Array.isArray(records)) return contentOnly;
    const rank = (r: any): number =>
      (r.is_default ? 0 : 1) * 10 + (r.scope === 'global' || !r.scope ? 0 : 1);
    const candidates = (records as any[])
      .filter((r) => !tried.has(r.id) && isSelectableTemplate(r, reportType))
      .sort((a, b) => rank(a) - rank(b)
        || (Number(b.priority ?? 0) - Number(a.priority ?? 0))
        || String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
      .slice(0, DONOR_SEARCH_LIMIT);
    for (const candidate of candidates) {
      const got = await invokeSecureFunction('manage-templates', {
        operation: 'get',
        table: 'report_templates',
        recordId: candidate.id,
      });
      const hit = consider((got?.data as { record?: unknown } | null | undefined)?.record);
      if (hit) return hit;
    }
  } catch (e) {
    console.warn('[routeReportThroughTemplate] body donor search failed', e);
  }
  return contentOnly;
}

export async function routeReportThroughTemplate(
  reportId: string,
  opts?: {
    agencyId?: string | null;
    userId?: string | null;
    brand?: any;
    reportType?: string | null;
    allowedReportTypes?: readonly string[];
    /**
     * The format's own sub-selection — which scenario, tier or edition of the
     * document this is. Read four times below and, until now, declared nowhere:
     * `tryRouteThroughTemplateBuilderFor` has always passed it and the property
     * has always arrived, so the omission was invisible at runtime and only a
     * type check would ever have found it.
     */
    variant?: string | null;
    /**
     * The template the person chose for this format, if they have chosen one.
     *
     * An explicit choice beats the ranking — that is the whole point of a
     * choice. It is still validated against the format and re-read from the
     * server (`loadSelectedTemplate`), and a choice that no longer applies
     * falls back to the ranking rather than failing the generation.
     */
    templateId?: string | null;
    /**
     * The caller's own reviewed data, for the adapter that documents it
     * (`payload` on `ReportTemplateAdapter`). Passed through verbatim; the
     * adapter validates it exactly as it validates a stored row.
     */
    payload?: Record<string, unknown> | null;
    /**
     * Told which gate closed, when one does. The route still answers `null` —
     * every failure is a fallback and never an error — but the caller can now
     * say *why* instead of "it could not be applied".
     */
    onRefusal?: (refusal: TemplateRouteRefusal, detail?: string) => void;
    /**
     * Which engine draws the document. `browser` (the default) is the preview
     * renderer in this tab; `weasyprint` is the FINAL client document, asked
     * for by a deliberate final action and never by a preview, an edit or a
     * page load. See the module header.
     */
    renderer?: TemplateRenderer;
  },
): Promise<TemplateBuilderRouteResult | null> {
  const renderer: TemplateRenderer = opts?.renderer ?? 'browser';
  // The last gate reached, so a caller hears about the furthest the route got
  // rather than about the first adapter that was not asked.
  let refusedAt: TemplateRouteRefusal = 'no_adapter';
  // The detail travels with the reason. It used to be written to the console
  // and dropped, so the render service's own answer — its status and what it
  // said — never reached the person who chose the template.
  let refusedDetail: string | undefined;
  const refuse = (reason: TemplateRouteRefusal, detail: string): void => {
    refusedAt = reason;
    refusedDetail = detail;
    console.warn(`[routeReportThroughTemplate] ${reason}: ${detail}`);
  };
  try {
    for (const adapter of candidateAdapters(opts?.reportType)) {
      if (!adapter.supportsProduction) continue;

      const routing = await adapter.resolveRoutingContext({
        reportId,
        variant: opts?.variant ?? null,
        payload: opts?.payload ?? null,
      });
      if (!routing?.reportType) {
        refuse('adapter_declined_record',
          `${adapter.reportType} could not resolve routing for ${reportId}`);
        continue;
      }
      if (opts?.allowedReportTypes && !opts.allowedReportTypes.includes(routing.reportType.toLowerCase())) {
        refuse('report_type_not_allowed', `${routing.reportType} is outside this caller's allow-list`);
        continue;
      }

      const selected = opts?.templateId
        ? await loadSelectedTemplate(opts.templateId, routing.reportType)
        : null;

      const resolved = selected
        ? { template: selected, engine: (selected.engine ?? 'jspdf') as 'jspdf' | 'weasyprint', source: 'selected' }
        : await resolveReportTemplate({
          reportType: routing.reportType,
          variant: routing.variant as ReportVariant | null,
          agencyId: opts?.agencyId ?? null,
          userId: opts?.userId ?? null,
        });
      if (!resolved) {
        refuse('no_active_template', `nothing active is published for ${routing.reportType}`);
        continue;
      }
      const tplRow = resolved.template;
      // The same variant the routing call received: the two answers must
      // describe one document, and the adapter is the one that knows whether
      // the variant means anything for its format.
      const ctx = await adapter.buildBindingContext({
        reportId,
        variant: opts?.variant ?? null,
        brand: opts?.brand,
        payload: opts?.payload ?? null,
      });
      // Null is every adapter's way of saying "I cannot produce a document
      // from this record" — no stored projection, a conversation with no
      // answer in it, one of nine reads that errored — and its documented
      // consequence is the legacy generator.
      //
      // This read `ctx?.data ?? {}` and carried on. An unresolved binding
      // renders as the empty string rather than as a visible `{{…}}`, so the
      // refusal did not produce an error or a blank page: it produced the
      // whole document with every field empty, uploaded it, and returned it as
      // a success — which also meant the caller never fell back, because it
      // had a URL. A client would have received a report of blank tables under
      // their own letterhead. Falling through here is what makes the adapters'
      // "returns null rather than a document full of blanks" true of the
      // pipeline and not only of the adapter.
      // An empty context is refused on the same ground rather than on a
      // separate one: every adapter publishes at least `report` and `brand`,
      // so there is no record for which `{}` is the right answer, and it
      // renders identically to the null case.
      if (!ctx?.data || Object.keys(ctx.data).length === 0) {
        refuse('adapter_published_no_data',
          `${adapter.reportType} declined report ${reportId}; falling back to its legacy generator`);
        continue;
      }
      const bindingData = ctx.data;

      // Parsed inside the loop's own guard: a schema that does not satisfy the
      // current contract is this template's problem, not the request's, and it
      // used to throw past every remaining gate into the outer catch — where
      // it was indistinguishable from a network failure.
      let schema: ReturnType<typeof parseTemplate>;
      try {
        schema = parseTemplate(tplRow.schema);
      } catch (e) {
        refuse('template_schema_invalid',
          `${tplRow.name ?? tplRow.id}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      // A template that is a static copy of one client's report will render
      // that client's report for everybody, with only the title substituted.
      // That shipped for two months; see `productionTemplateGuard`. Refusing
      // here falls back to the legacy generator, which is wrong-looking rather
      // than wrong.
      const unbound = refuseUnboundReconstruction(schema);
      if (unbound) {
        refuse('template_unbound_reconstruction',
          `refusing template ${tplRow.id} (${tplRow.name}): ${unbound.reason}`);
        continue;
      }

      /*
       * Does this template carry the report at all?
       *
       * The two guards above catch a static copy and an empty context. A
       * template that binds the WRONG vocabulary passed both: the library's
       * "First-Home Buyer Report" binds `client.deposit`, `grants.fhog` and
       * `steps.0` — a sample preset no adapter publishes — and on 15 Sep 2026
       * it drew five near-empty pages under the tenant's letterhead, as a
       * success. Every bound path is now resolved against the data the
       * adapter built, and a template that binds content of which NONE
       * resolves is COMPOSED rather than drawn: its cover and closing pages
       * kept, its blank pages left out, and the body drawn from a published
       * template that does carry the report, under the chosen template's own
       * tokens. The choice is honoured as a design; the report is never absent
       * from its own document. A template that resolves even one content
       * field, or binds nothing at all, is the author's document and is drawn
       * exactly as designed. See `templateComposition.pure.ts`.
       */
      let composed: TemplateBuilderRouteResult['composed'] = null;
      const coverage = measureBindingCoverage(schema, bindingData);
      if (coverage.needsComposition) {
        const donor = await findBodyDonor(routing.reportType, tplRow.id, bindingData, {
          variant: routing.variant as ReportVariant | null,
          agencyId: opts?.agencyId ?? null,
          userId: opts?.userId ?? null,
        });
        const composition = donor ? composeTemplateWithDonor(schema, donor.schema, bindingData) : null;
        if (!donor || !composition) {
          refuse('template_carries_no_content',
            `${tplRow.name ?? tplRow.id}: ${coverage.resolved.length} of ${coverage.bound.length} bound `
            + `fields resolve on this report and none of them is its body; `
            + (donor ? 'the donor could not be composed' : `no published ${routing.reportType} template carries the body`));
          continue;
        }
        try {
          schema = parseTemplate(composition.schema);
        } catch (e) {
          refuse('template_schema_invalid',
            `composed ${tplRow.name ?? tplRow.id} over ${donor.name ?? donor.id}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        composed = {
          donorTemplateId: donor.id,
          donorName: donor.name,
          kept: composition.kept.map((p) => p.name),
          dropped: composition.dropped.map((p) => p.name),
          bodyPages: composition.bodyPages,
          coverFrom: composition.coverFrom,
        };
        console.info(
          `[routeReportThroughTemplate] composed ${tplRow.name ?? tplRow.id} over ${donor.name ?? donor.id}: `
          + `kept ${composed.kept.join(', ') || 'nothing'}; dropped ${composed.dropped.join(', ') || 'nothing'}; `
          + `${composition.bodyPages} body pages; cover from ${composition.coverFrom}`,
        );
      }

      // A clone's cover never carries the house's tagline, whether or not
      // seed v23 reached this deployment or this master was customised
      // (`houseTaglineGuard.pure.ts`). The prime's template is untouched.
      schema = withIssuerTagline(schema, { prime: isPrimeDeployment() });

      /*
       * Compatibility is asked of the RENDERER, not of a column.
       *
       * The gate here used to be `engine !== 'weasyprint'`, which is a record
       * of which service a template was authored for rather than a fact about
       * whether it can be drawn. What matters to a client is that no page
       * carries a placeholder panel where content belongs, and only the block
       * registry knows that. `judgeBrowserProductionExport` refuses, names the
       * blocks for the operator, and never falls back to a render service or
       * to a raster — both of which would ship a worse document quietly.
       */
      if (renderer === 'browser') {
        const drawable = judgeBrowserProductionExport(schema);
        if (drawable.ok === false) {
          refuse('template_not_browser_renderable',
            `${tplRow.name ?? tplRow.id}: ${drawable.blockTypes.join(', ')}`);
          continue;
        }
      } else {
        // The HTML renderer draws every block the browser one does and the
        // ones it marks partial; only a type with no renderer at all is
        // refused, on the same ground: a page with a hole in it is worse than
        // the standard document.
        const undrawable = [...new Set(
          schema.pages.flatMap((p) => (p.blocks ?? []).map((b) => String((b as { type?: unknown }).type ?? '')))
            .filter((t) => t && getBlockRendererCapabilities(t).html === 'unsupported'),
        )];
        if (undrawable.length) {
          refuse('template_not_renderable', `${tplRow.name ?? tplRow.id}: ${undrawable.join(', ')}`);
          continue;
        }
      }

      const safeLabel = String(routing.fileLabel ?? routing.title ?? routing.reportType ?? 'report')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 60);
      // An adapter that names its own document (the Investment family names
      // it by tier, address and date) is honoured; the generic shape stays
      // for every adapter that does not.
      const fileName = routing.fileName ?? `${routing.reportType}-${safeLabel}-${reportId.slice(0, 8)}.pdf`;

      let blob: Blob;
      let storagePath: string | null = null;
      let degradedFrom: TemplateBuilderRouteResult['degradedFrom'] = null;
      /*
       * The in-tab drawing. Assets are resolved through the same module the
       * HTML path uses, in `inline` mode because this renderer cannot fetch:
       * jsPDF draws from the bytes it is handed. The other half of that
       * module's rule travels with it — an asset that cannot be brought inside
       * is DROPPED and named rather than carried in, so one unreachable
       * picture thins a page instead of failing the document.
       */
      const drawInBrowser = async (): Promise<Blob> => {
        const { template: prepared } = await preloadImagesWithReport(schema, {
          mode: 'inline',
          data: bindingData,
          tokens: undefined,
          supabaseUrl: SUPABASE_URL,
        });
        return renderTemplateToBlob(prepared, { data: bindingData });
      };
      try {
        if (renderer === 'weasyprint') {
          /*
           * The FINAL document. The template is compiled to print HTML by the
           * same compiler every design-system render goes through — assets
           * resolved to what the engine may fetch, fonts sourced from the
           * container — and handed to the pinned engine in `final` mode, which
           * stores the PDF and answers its path. Nothing is recalculated,
           * re-narrated or re-decided here: the payload is the one built above.
           */
          try {
            const compiled = await compileTemplateHtmlForPdf(schema, { data: bindingData });
            const rendered = await renderFinalHtmlToPdf({
              html: compiled.html,
              fileName,
              mode: 'final',
              reportId,
              reportType: adapter.reportType,
              templateId: tplRow.id,
              templateName: tplRow.name ?? null,
              pageCount: schema.pages.length,
            });
            blob = rendered.blob;
            storagePath = rendered.path;
          } catch (e) {
            // The engine did not draw it. Where the in-tab renderer can draw
            // this template in full, the chosen template is still honoured —
            // marked as a stand-in, never as the final document. See
            // `browserStandInFor` for what qualifies and why.
            const standIn = browserStandInFor(e, schema);
            if (!standIn) throw e;
            console.warn(
              `[routeReportThroughTemplate] ${standIn.refusal}: ${standIn.detail} — drawing `
              + `${tplRow.name ?? tplRow.id} with the in-tab renderer instead`,
            );
            degradedFrom = standIn;
            blob = await drawInBrowser();
          }
        } else {
          blob = await drawInBrowser();
        }
      } catch (e) {
        // Guarded on its own rather than left to the outer catch: a failure
        // drawing one template must fall through to the next candidate adapter
        // and be reported as the render gate it is. The route's contract is
        // that every failure is a fallback — but WHICH gate is said: an
        // engine that did not answer is not a document that could not be
        // drawn.
        const unavailable = e instanceof RenderServiceError && e.kind === 'engine_unavailable';
        refuse(unavailable ? 'engine_unavailable' : 'render_failed',
          e instanceof Error ? e.message : String(e));
        continue;
      }

      // A zero-byte document is not a document. It would save as a file that
      // opens to an error, which is worse than the standard presentation.
      if (!blob.size) {
        refuse('render_failed', `${tplRow.id} produced an empty document`);
        continue;
      }

      return {
        blob,
        fileName,
        // The renderer that DREW these bytes — the one asked for, unless the
        // preview renderer stood in for the final one.
        renderer: renderer === 'weasyprint' && !degradedFrom
          ? WEASYPRINT_FINAL_RENDERER
          : BROWSER_PRESENTATION_RENDERER,
        templateId: tplRow.id,
        source: `${resolved.source}:${adapter.reportType}`,
        storagePath,
        degradedFrom,
        composed,
      };
    }

    opts?.onRefusal?.(refusedAt, refusedDetail);
    return null;
  } catch (e) {
    console.warn('[routeReportThroughTemplate] unexpected error, falling back', e);
    opts?.onRefusal?.('unexpected_error', e instanceof Error ? e.message : String(e));
    return null;
  }
}
