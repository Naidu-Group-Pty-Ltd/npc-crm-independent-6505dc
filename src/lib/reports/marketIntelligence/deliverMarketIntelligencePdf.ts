/**
 * Getting a typeset market intelligence report into someone's hands.
 *
 * Hands back the `Blob` as well as saving it, for the same reason the Q&A twin
 * does: the destination that matters for this format is not always a downloads
 * folder. `dispatch-marketing-reports` emails the stored file, and a caller that
 * wants to attach or preview the document needs the bytes rather than a saved
 * copy.
 *
 * The signed URL is fetched rather than followed, for the same reason it is in
 * the other formats: a PDF that opens in a tab is a PDF someone has to find
 * again.
 */
import { tryTemplateDocument } from '@/lib/reportTemplate/templateDocument';
import {
  type MarketIntelligencePdfResult,
  requestMarketIntelligencePdf,
  type RequestMarketIntelligenceOptions,
} from './requestMarketIntelligencePdf';

export interface DeliveredMarketIntelligence {
  fileName: string;
  pageCount: number | null;
  brandGaps: string[];
  sections: string[];
  dropped: string[];
  emptyLayers: string[];
  reportPeriod: string;
  audienceSegment: string;
  /** True when `pdf_storage_path` was set, so the email dispatch can attach it. */
  persisted: boolean;
  storagePath: MarketIntelligencePdfResult['storagePath'];
  /** The document itself, for the preview and attachment paths. */
  blob: Blob;
  /**
   * Rendered from an activated template, by the final renderer. The
   * diagnostics above describe the flowing render and are left empty rather
   * than measured.
   */
  templated?: boolean;
  /**
   * Where `render-template-pdf` stored a templated final (`investment-reports`),
   * or null for the flowing route, whose stored copy is `storagePath`.
   */
  templatePath?: string | null;
  /**
   * Whether the caller asked for the stored copy — said back, so a templated
   * document can tell the person that the scheduled email was not fed.
   */
  persistRequested?: boolean;
}

/** Save a file the way a browser saves files. */
function saveToBrowser(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // On a delay: Safari cancels an in-flight download when the URL disappears
  // underneath it.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Produce the document and return it.
 *
 * Throws on failure with the message the renderer gave, so a caller can put it
 * in front of the person who pressed the button rather than in a console.
 */
export async function deliverMarketIntelligencePdf(
  reportId: string,
  options: RequestMarketIntelligenceOptions & { save?: boolean } = {},
): Promise<DeliveredMarketIntelligence> {
  /**
   * An activated template wins for every call — whether or not the caller
   * asked for the stored copy to be refreshed.
   *
   * It used to win only for `persist: false`, and the button that produces
   * this document defaults `persist` ON — so on the one control that matters
   * a chosen template was never drawn, silently, while the picker beside it
   * said the choice was kept (RS-5c.4). The gate existed to protect
   * `pdf_storage_path`, which `dispatch-marketing-reports` attaches to a
   * scheduled email and which the template route does not write. That column
   * is still the flowing route's alone: a templated final is stored by
   * `render-template-pdf` (`templatePath`), the column is left untouched,
   * `persisted` is false, and the caller is told — a person who asked for the
   * stored copy hears that the standard layout is what the email would attach.
   *
   * Measured 14 Sep 2026 before choosing this: 8 market intelligence reports,
   * none with a stored PDF, no render ledger row ever, no schedule ever
   * created and no dispatch ever logged. Nothing downstream is starved by
   * honouring the choice here. Making the dispatch reuse a templated final
   * (the render ledger carries `report_id` since RS-2) is the step to take the
   * day a schedule exists, and is recorded in RUNTIME_CONSOLIDATION §9.
   */
  const templated = await tryTemplateDocument('market_intelligence', reportId, {
    // The audience edition is this format's variant: the same row is three
    // documents, and the adapter picks the closing panels from it.
    variant: options.audience ?? null,
    // The FINAL document: drawn by the pinned engine, never the browser's jsPDF (RS-5c).
    renderer: 'weasyprint',
  });
  if (templated) {
    if (options.save !== false) saveToBrowser(templated.blob, templated.fileName);
    return {
      fileName: templated.fileName,
      pageCount: null,
      brandGaps: [],
      sections: [],
      dropped: [],
      emptyLayers: [],
      reportPeriod: '',
      audienceSegment: String(options.audience ?? ''),
      persisted: false,
      storagePath: null,
      templatePath: templated.storagePath,
      persistRequested: options.persist !== false,
      blob: templated.blob,
      templated: true,
    };
  }

  const result = await requestMarketIntelligencePdf(reportId, options);

  const response = await fetch(result.url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();

  if (options.save !== false) saveToBrowser(blob, result.fileName);

  return {
    fileName: result.fileName,
    pageCount: result.pageCount,
    brandGaps: result.brandGaps,
    sections: result.sections,
    dropped: result.dropped,
    emptyLayers: result.emptyLayers,
    reportPeriod: result.reportPeriod,
    audienceSegment: result.audienceSegment,
    persisted: result.persisted,
    storagePath: result.storagePath,
    blob,
  };
}
