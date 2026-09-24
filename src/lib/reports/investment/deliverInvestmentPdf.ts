/**
 * Getting the Investment report into someone's hands — download, send, or
 * portal — as ONE document, produced ONE way.
 *
 * ## What this replaces
 *
 * The audit (F11/F12) measured the highest-volume format delivering three
 * different artefacts depending on which control was pressed:
 *
 *  * the report page's PRIMARY "Download" saved the markdown as a `.txt`;
 *  * "Send to Client" published whatever `pdf_url` held — written by the
 *    legacy server route *or* the browser html2canvas generator, whichever
 *    ran last — or minted a fresh browser raster on the spot;
 *  * only `PremiumPdfButton`, low in a collapsible panel, produced the real
 *    chain: chosen template → a render service.
 *
 * That chain — the person's template selection honoured first, a standard
 * document as the fallback — was correct and lived inside one button. It
 * lives here now, and every surface (the primary download, the send, the
 * premium button, the flatten copy) asks this module, so a client receives
 * the same document the operator reviewed.
 *
 * ## One report, two presentations, one final renderer
 *
 * The record is read once and checked for client readiness once, and only
 * then is a presentation chosen: the template the person selected for this
 * format, or the standard one. Both draw the SAME validated report and neither
 * is a second version of the document — which is why the readiness gate sits
 * above both rather than inside either.
 *
 * A chosen template is drawn by the pinned WeasyPrint engine through
 * `render-template-pdf` (RV-1, 14 Sep 2026): the browser renderer embeds no
 * fonts and drew the executive dashboard's headline figures illegibly. The
 * browser still draws the standard presentation (pdf-lib, which does embed its
 * faces) when no template applies, and it still draws every PREVIEW. Nothing
 * here is the render service's to decide — it prints the completed report.
 *
 * ## One finalisation → one PDF
 *
 * A final render is asked for by a deliberate action — Generate, Download,
 * Send, Publish — and never by an edit, a preview or a page load. Two
 * protections keep one action to one render: concurrent calls for the same
 * report share one in-flight production, and a completed finalisation is
 * remembered (per tab) under a fingerprint of the record's version, the
 * chosen template and the panel's controls (the five switches and the
 * audience), so Download after Generate, or Send
 * after Download, reuse the document rather than drawing it again. Change the
 * report, the template or a control and the fingerprint moves.
 *
 * ## Every failure is a fallback, never an error — until there is nothing
 *
 * A refused template, no selection, a stale choice, a template carrying a
 * block this renderer cannot draw: the standard presentation still renders
 * (`tryTemplateDocument`'s own contract). Only when neither can produce the
 * document does this throw, with the message in front of the person who
 * clicked. A report that is not client-ready is the one exception: it is
 * refused rather than fallen back from, because the defect is in the report.
 *
 * ## Coverage
 *
 * `engine` on the returned document names the renderer that actually drew the
 * bytes: the final engine for a templated document, one of the two browser
 * renderers otherwise. A final render also leaves its own row in
 * `template_render_jobs`, stamped with the report it was of.
 *
 * ## `pdf_url` has one meaning now
 *
 * "The storage path of the most recent standard-delivery document." Every
 * write goes through the `manage-investment-reports` broker, and after
 * `publishInvestmentPdf` the row points at the exact bytes that were just
 * published to a portal — because nothing else persists a render any more.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  saveTemplateDocument,
  selectedTemplateFor,
  tryTemplateDocument,
} from '@/lib/reportTemplate/templateDocument';
import {
  BROWSER_PRESENTATION_RENDERER,
  WEASYPRINT_FINAL_RENDERER,
} from '@/lib/reportTemplate/routeReportThroughTemplate';
import {
  generateInvestmentPdfBlob,
  BROWSER_PDF_RENDERER,
} from '@/lib/reports/investment/investmentPdfDocument';
import {
  loadInvestmentReportForPdf,
  projectRowForPdf,
  type StoredInvestmentReportRow,
} from '@/lib/reports/investment/investmentPdfSource';
import { assertInvestmentReportClientReady } from '@/lib/reports/investment/clientReadiness';
import {
  applyPresentationOptionsToContent,
  resolvePresentationOptions,
  type InvestmentPresentationOptions,
} from '@/lib/reports/investment/presentationOptions';
import { loadInvestmentHeroImages } from '@/lib/reports/investment/investmentHeroImages';
import { applyAudienceToMarkdown, audiencePolicyFor } from '@/lib/reports/investment/audienceContent.pure';
import { contentPolicyFor } from '@/lib/reports/investment/tierContent.pure';
import { composeOwnerOccupierLens } from '../../../../supabase/functions/_shared/reports/location/ownerOccupierLens.pure';
import { secureStorageUpload } from '@/hooks/useSecureStorage';
import type { PdfDesignOptions } from '@/components/reports/premiumPdfDesign';

export interface InvestmentDocument {
  blob: Blob;
  fileName: string;
  /**
   * Which renderer produced these exact bytes.
   *
   * Two browser renderers, two identities, because they draw two different
   * documents: `browser_pdf_lib` is the standard presentation composed with
   * pdf-lib, `browser_template_jspdf` is a chosen template drawn by the Report
   * Presentation Renderer. Neither is a render service — `legacy_server` and
   * `premium_weasyprint` named one that no longer runs, and a telemetry value
   * naming a retired service is worse than none, because it is read as
   * evidence.
   */
  engine: typeof WEASYPRINT_FINAL_RENDERER | typeof BROWSER_PRESENTATION_RENDERER | typeof BROWSER_PDF_RENDERER;
  /** The template that rendered it, when the template engine did. */
  templateId: string | null;
  /**
   * Where the render service stored these exact bytes, when one did. Null for
   * a document drawn in this tab, which exists only until somebody stores it.
   */
  storagePath: string | null;
}

export interface ProduceInvestmentOptions extends Partial<InvestmentPresentationOptions> {
  /** The report's variant (financial / briefing / snapshot), for the adapter. */
  variant?: string | null;
  designOptions?: PdfDesignOptions;
}


/**
 * What a finalisation is OF: everything the document is drawn from.
 *
 * The record as read (every column but `pdf_url`, which publishing itself
 * writes and which changes nothing on the page), the template chosen for it,
 * the imagery that will be placed, the variant, the five controls and the
 * design options. Two calls with the same fingerprint ask for the same
 * document; anything that changes the document changes the fingerprint.
 *
 * The row is keyed whole rather than by a version stamp because the detail
 * projection the row is read through carries `current_version` and not
 * `updated_at` — and an edit moves only the latter. Keying on the content
 * cannot miss an edit, whatever the projection carries.
 */
function finalisationFingerprint(
  row: StoredInvestmentReportRow,
  selectedTemplateId: string | null,
  heroImages: ReadonlyArray<{ sectionKey: string; bytes: Uint8Array }>,
  options: ProduceInvestmentOptions,
  presentation: InvestmentPresentationOptions,
): string {
  const { pdf_url: _published, ...content } = row;
  return JSON.stringify([
    content, selectedTemplateId,
    heroImages.map((h) => [h.sectionKey, h.bytes.byteLength]),
    options.variant ?? null, presentation, options.designOptions ?? null,
  ]);
}

interface Finalised { fingerprint: string; doc: InvestmentDocument }

/**
 * Per report, the last completed finalisation in this tab — bounded, because
 * each one holds a document's bytes.
 */
const finalised = new Map<string, Finalised>();
const FINALISED_LIMIT = 8;
/** Per (report, request), the production already running. */
const inFlight = new Map<string, Promise<InvestmentDocument>>();

function rememberFinalised(reportId: string, entry: Finalised): void {
  finalised.delete(reportId);
  finalised.set(reportId, entry);
  while (finalised.size > FINALISED_LIMIT) {
    const oldest = finalised.keys().next().value;
    if (oldest === undefined) break;
    finalised.delete(oldest);
  }
}

/** Forget every remembered finalisation — for tests, and for a signed-out tab. */
export function forgetFinalisedInvestmentDocuments(): void {
  finalised.clear();
}

/**
 * The document, template-first.
 *
 * Throws only when no engine could produce it; the message is the one the
 * failing engine gave.
 */
export async function produceInvestmentDocument(
  reportId: string,
  options: ProduceInvestmentOptions = {},
): Promise<InvestmentDocument> {
  if (!reportId) throw new Error('A report is required to produce the document.');

  // A double-click, a re-rendered button, two surfaces asking at once: one
  // production, shared. Keyed on the request as well as the report, so a
  // genuinely different request is not handed somebody else's document.
  const flightKey = `${reportId}|${JSON.stringify(options)}`;
  const running = inFlight.get(flightKey);
  if (running) return running;
  const production = produceInvestmentDocumentOnce(reportId, options)
    .finally(() => { inFlight.delete(flightKey); });
  inFlight.set(flightKey, production);
  return production;
}

async function produceInvestmentDocumentOnce(
  reportId: string,
  options: ProduceInvestmentOptions,
): Promise<InvestmentDocument> {

  /*
   * The record is read ONCE, before a presentation is chosen, and the
   * client-readiness gate is applied to it.
   *
   * That gate used to live inside `render-template-pdf` and
   * `render-investment-report-pdf` — two render services, both now off this
   * path. Applying it here restores it to the template route and extends it to
   * the standard one, which never had it: a report that asserts a governed
   * fact it does not hold is refused whichever presentation it would have come
   * out in, because the defect is in the report and not in the layout.
   *
   * The read is not wasted on the template path: `tryTemplateDocument`'s
   * adapter reads the same row again, and one extra call is the price of a
   * gate that cannot be skipped by choosing a template.
   */
  const row = await loadInvestmentReportForPdf(reportId);
  assertInvestmentReportClientReady(row);

  /*
   * The five controls, resolved once and applied once.
   *
   * Two of them — Sources and Scoring — decide what the report CONTAINS, and
   * the other three decide what is DRAWN. The content rules are applied to the
   * report's own Markdown here, above the choice of presentation, so a chosen
   * template and the standard document agree about which sections belong in
   * this client's copy. They were inside the standard generator before, which
   * meant a report delivered through a template carried its source notes and
   * its scoring sections however the switches were set. See
   * `presentationOptions.ts` for why the two kinds are kept apart.
   *
   * Nothing here recalculates, re-scores or re-narrates anything. A section
   * that is not included is not printed; every figure in every section that IS
   * printed is the figure the record holds.
   */
  const presentation = resolvePresentationOptions(options);
  const presentedRow = {
    ...row,
    report_content: applyPresentationOptionsToContent(
      presentForAudience(row, presentation.audience, options.variant ?? null),
      presentation,
    ),
  };

  /*
   * The person's template choice, read ONCE here and handed down, so the
   * fingerprint below and the template actually rendered come from the same
   * read. A failed read is null — the route then resolves by ranking, exactly
   * as it does when nothing was chosen.
   */
  const selectedTemplateId = await selectedTemplateFor('investment');

  const heroImages = presentation.includeHeroImages
    ? await loadInvestmentHeroImages(reportId)
    : [];

  const fingerprint = finalisationFingerprint(row, selectedTemplateId, heroImages, options, presentation);
  const remembered = finalised.get(reportId);
  if (remembered && remembered.fingerprint === fingerprint) return remembered.doc;

  const templated = await tryTemplateDocument('investment', reportId, {
    variant: options.variant ?? null,
    // The SAME payload the standard presentation would draw. The adapter reads
    // the record itself for everything else; the operator's two CONTENT
    // switches travel beside the content they shaped — the Markdown has its
    // sections removed here, and the adapter reads the switch itself for the
    // BOUND values (`scores.*`) that no section filter can reach, so a
    // template with a grade block on its dashboard page draws no grade when
    // scoring is off, exactly as the standard document prints none.
    payload: {
      reportContent: presentedRow.report_content,
      includeScoring: presentation.includeScoring,
      includeSources: presentation.includeSources,
      // Read by the adapter for the BOUND values a Markdown edit cannot reach:
      // the rent and yield tiles, the cash-flow rows, the standfirst.
      audience: presentation.audience,
    },
    // The FINAL document: the chosen template drawn by the pinned engine.
    renderer: 'weasyprint',
    selectedTemplateId,
  });
  if (templated) {
    const doc: InvestmentDocument = {
      blob: templated.blob,
      fileName: templated.fileName,
      engine: templated.renderer === WEASYPRINT_FINAL_RENDERER
        ? WEASYPRINT_FINAL_RENDERER
        : BROWSER_PRESENTATION_RENDERER,
      templateId: templated.templateId,
      storagePath: templated.storagePath ?? null,
    };
    // A stand-in (the in-tab renderer drew the chosen template because the
    // print engine did not) is delivered but never REMEMBERED as the
    // finalisation: the next request for the same document must ask the
    // engine again rather than hand back the stand-in for the rest of the
    // session. One finalisation is one PDF, and this was not one.
    if (!templated.degradedFrom) rememberFinalised(reportId, { fingerprint, doc });
    return doc;
  }

  // The standard document, drawn HERE.
  //
  // This used to POST to `render-investment-report-pdf`, which composed HTML
  // and handed it to WeasyPrint on Cloud Run. The drawing is now
  // `investmentPdfDocument` — the same pdf-lib implementation that produced
  // 263 of the 275 Investment PDFs this product has delivered. It is the
  // presentation a report gets when no template applies, and the only one
  // the print engine is not asked for: pdf-lib embeds its faces, and there is
  // no template to compile.
  //
  // The projection is shared with `ClientPDFGenerator` rather than repeated,
  // because it is where stored financials are healed and an historic row's
  // overrides are overlaid. One transform, one set of numbers.
  const { report, reportTier } = projectRowForPdf(presentedRow);
  const drawn = await generateInvestmentPdfBlob({
    report,
    reportTier,
    presentation,
    heroImages,
  });
  if (!drawn.blob.size) throw new Error('The rendered PDF was empty.');
  const doc: InvestmentDocument = {
    blob: drawn.blob,
    fileName: drawn.fileName,
    engine: drawn.renderer,
    templateId: null,
    storagePath: null,
  };
  rememberFinalised(reportId, { fingerprint, doc });
  return doc;
}

/**
 * The report's own Markdown as the chosen audience reads it.
 *
 * Investor is the report as stored, byte for byte. An owner-occupier's copy
 * leaves out the sections whose whole subject is a letting and gains the
 * owner-occupier's view, composed from the record (`ownerOccupierLens.pure.ts`);
 * "both" gains the section and loses nothing. The tier decides two of the
 * section's lines: whether the land use qualifications travel with it (they
 * are already printed where a tier carries the planning register) and whether
 * a line about land tax is owed (only where the financial model is printed).
 */
function presentForAudience(
  row: StoredInvestmentReportRow,
  audience: InvestmentPresentationOptions['audience'],
  variant: string | null,
): string {
  const content = typeof row.report_content === 'string' ? row.report_content : '';
  const policy = audiencePolicyFor(audience);
  if (!policy.ownerOccupierSection && policy.lettingSections) return content;
  const stored = row as unknown as Record<string, unknown>;
  // The order `projectRowForPdf` reads the tier in, so the section and the
  // document it lands in agree about which tier this is.
  const tier = contentPolicyFor(String(variant || row.report_variant || row.report_tier || ''));
  const section = composeOwnerOccupierLens({
    locationIntelligence: stored.location_intelligence,
    demographicsData: stored.demographics_data,
    economicData: stored.economic_data,
    carriesPlanningRegister: tier.locationDepth,
    carriesFinancialModelling: tier.financialModelling,
  });
  return applyAudienceToMarkdown(content, policy.audience, section).markdown;
}

/** Produce and save to the browser's downloads. */
export async function deliverInvestmentPdf(
  reportId: string,
  options: ProduceInvestmentOptions = {},
): Promise<InvestmentDocument> {
  const doc = await produceInvestmentDocument(reportId, options);
  saveTemplateDocument({ blob: doc.blob, fileName: doc.fileName, templateId: doc.templateId ?? '' });
  return doc;
}

const STORAGE_BUCKET = 'investment-reports';


/**
 * Record the published path on the row, through the one broker every client
 * write uses. Best-effort: the document is already published; failing the
 * caller over bookkeeping would un-send nothing.
 */
async function rememberInvestmentPdfPath(reportId: string, path: string): Promise<void> {
  try {
    await invokeSecureFunction('manage-investment-reports', {
      action: 'update',
      reportId,
      data: { pdf_url: path },
    });
  } catch (err) {
    console.warn('[deliverInvestmentPdf] could not record pdf_url:', err);
  }
}

export interface PublishedInvestmentPdf {
  /** Path in the `investment-reports` bucket — what a portal row stores. */
  path: string;
  engine: InvestmentDocument['engine'];
  templateId: string | null;
  /**
   * The bytes that were stored.
   *
   * Carried back so a caller that both publishes and hands the file to the
   * person can do it from ONE render. The alternative is producing the
   * document twice, or downloading back what was just uploaded — and the
   * second copy is the one that can differ.
   */
  blob: Blob;
  fileName: string;
}

/**
 * Produce the document and make it a stored artefact a portal can serve.
 *
 * Every document is uploaded here and recorded through the same broker, and
 * the returned path IS what `pdf_url` names.
 *
 * There used to be a shortcut: the server route persisted its own render and
 * wrote the path to the row, so this read it back rather than uploading the
 * same bytes twice. That shortcut read the ROW, so it returned whichever render
 * happened to run last. What replaces it reads the DOCUMENT: a final render
 * carries the path the engine stored it at, and the bytes in hand are the bytes
 * at that path, so the portal is pointed at them and nothing is uploaded twice.
 * A document drawn in this tab has no such path and is uploaded here.
 */
export async function publishInvestmentPdf(
  reportId: string,
  options: ProduceInvestmentOptions = {},
): Promise<PublishedInvestmentPdf> {
  const doc = await produceInvestmentDocument(reportId, options);

  let storedPath: string;
  if (doc.storagePath) {
    // The render service already stored these bytes; the portal is pointed
    // at that object. Uploading them again would make a second copy of the
    // same document, and the second copy is the one that can differ.
    storedPath = doc.storagePath;
  } else {
    const safeName = doc.fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const path = `${reportId}_${Date.now()}_${safeName}`;
    const upload = await secureStorageUpload(STORAGE_BUCKET, path, doc.blob, {
      contentType: 'application/pdf',
      upsert: true,
      resourceId: reportId,
    });
    if (!upload.success) {
      throw new Error(upload.error || 'The document rendered but could not be stored.');
    }
    storedPath = upload.path || path;
  }
  await rememberInvestmentPdfPath(reportId, storedPath);
  return {
    path: storedPath,
    engine: doc.engine,
    templateId: doc.templateId,
    blob: doc.blob,
    fileName: doc.fileName,
  };
}
