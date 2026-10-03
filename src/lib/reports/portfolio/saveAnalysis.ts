/**
 * Saving a Portfolio Analysis someone has just generated, in the template they
 * chose.
 *
 * ## Why this exists
 *
 * The analysis is generated in the dialog `PortfolioAnalysisPDFGenerator`
 * opens, and until 1 Oct 2026 that dialog's one button, "Download & Save PDF",
 * drew it with the in-browser legacy generator (pdf-lib) and saved THAT file
 * as the report. The owner opened a client, chose a template, generated the
 * analysis and received the legacy document: the dialog never read the choice.
 *
 * The typeset route (`render-portfolio-review-pdf`) draws the same analysis in
 * the chosen design, but it reads a SAVED row. It is handed an id and never
 * the analysis, because everything the document says is read server-side. In
 * the dialog the analysis exists only in component state, and that is why the
 * typeset export was never offered there. So the export here does three
 * things in order:
 *
 *   1. save the analysis as its `portfolio_analysis_reports` row, once;
 *   2. render that row through the typeset route, in the chosen design;
 *   3. record the rendered document as the saved report's file.
 *
 * ## Five rules
 *
 * 1. **One analysis, one row.** The dialog keeps what this returns and hands it
 *    back. A second export (another template, or a retry) renders the SAME row
 *    again, and the legacy layout asked for afterwards saves no second copy of
 *    the analysis either.
 * 2. **The saved file is the document the person chose.** `pdf_file_path` is
 *    what "Send Portfolio to Client", the portal publish, the Reports tab's
 *    saved-PDF download and the reports list all read. The route itself never
 *    writes that column, and still does not (`legacyPathStays.spec.ts`). The
 *    act of saving an analysis records the document it produced, and the
 *    dialog's primary act produces the one in the chosen template. The legacy
 *    layout records its file only where nothing else has.
 * 3. **The analysis is the analysis.** `includeReview: false`. The legacy
 *    document never carried a review, and a review is a separate assessment
 *    the person did not ask for here. The route's own words for this flag are
 *    "to reproduce the document as the analysis alone described it". The
 *    Reports tab's Export PDF still folds the latest review in, as it always
 *    has.
 * 4. **A failure says what is saved.** A render that fails after the row
 *    exists leaves the analysis saved, with no file. The legacy generator
 *    leaves the same state when its upload fails, and everything downstream
 *    already handles it (`publishReportToPortal` renders on publish). The
 *    caller is told which step failed, so the person reads "saved, but its PDF
 *    could not be produced" rather than "failed".
 * 5. **Only a `client-files` object is recorded.** The publish operation signs
 *    `pdf_file_path` in `client-files` and nothing else, so a document stored
 *    anywhere else is downloaded but never recorded there.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { deliverPortfolioReview, type DeliveredPortfolioReview } from './deliverPortfolioReview';

/** The bucket a saved analysis's file lives in, and the only one the publish operation signs. */
export const PORTFOLIO_FILE_BUCKET = 'client-files';

/**
 * The part of a generated analysis the row's summary columns are read from.
 * The whole object is stored as `report_data`, exactly as it arrived.
 */
export interface PortfolioAnalysisRecord {
  clientName: string;
  portfolioMetrics?: {
    totalValue?: number | null;
    totalEquity?: number | null;
    netMonthlyCashflow?: number | null;
    totalProperties?: number | null;
    averageLVR?: number | null;
    averageYield?: number | null;
  } | null;
  analysis?: {
    executiveSummary?: {
      healthScore?: number | null;
      overallHealth?: string | null;
    } | null;
  } | null;
}

/** Where a generated analysis stands: its row, and the file recorded on it. */
export interface SavedPortfolioAnalysis {
  /** The `portfolio_analysis_reports` row. */
  reportId: string;
  /** `pdf_file_path`: a `client-files` key, or null while no file is recorded. */
  filePath: string | null;
  /** Which renderer drew the recorded file. */
  renderer: 'template' | 'legacy' | null;
}

/**
 * The row an analysis is saved as. Both renderers write it through this, so
 * the two paths cannot come to save different summaries of one analysis.
 *
 * The `|| null` on each summary column is the generator's own, kept exactly:
 * these columns are a list's summary, `report_data` is the record, and
 * changing what a zero becomes is not this module's decision.
 */
export function portfolioAnalysisRow(
  analysisData: PortfolioAnalysisRecord,
  clientId: string,
  pdfFilePath: string | null,
): Record<string, unknown> {
  return {
    client_id: clientId,
    client_name: analysisData.clientName,
    health_score: analysisData.analysis?.executiveSummary?.healthScore || null,
    overall_health: analysisData.analysis?.executiveSummary?.overallHealth || null,
    portfolio_value: analysisData.portfolioMetrics?.totalValue || null,
    total_equity: analysisData.portfolioMetrics?.totalEquity || null,
    net_monthly_cashflow: analysisData.portfolioMetrics?.netMonthlyCashflow || null,
    total_properties: analysisData.portfolioMetrics?.totalProperties || null,
    average_lvr: analysisData.portfolioMetrics?.averageLVR || null,
    average_yield: analysisData.portfolioMetrics?.averageYield || null,
    report_data: analysisData,
    pdf_file_path: pdfFilePath,
    status: 'completed',
  };
}

/** The client's documents list entry for a saved analysis's file. */
export function portfolioFileIndexEntry(input: {
  fileName: string;
  filePath: string;
  bytes: number;
  savedAt?: Date;
}): Record<string, unknown> {
  return {
    category: 'report',
    file_name: input.fileName,
    file_path: input.filePath,
    file_type: 'application/pdf',
    file_size: input.bytes,
    description: `Portfolio Performance Analysis - ${(input.savedAt ?? new Date()).toLocaleDateString('en-AU')}`,
    report_type: 'portfolio',
  };
}

/** A message as a sentence: one closing stop, never two. */
export function asSentence(message: string): string {
  const text = message.trim();
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/** The message a failed call carries, whichever shape it arrived in. */
function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return fallback;
}

/**
 * Insert the analysis's row and answer its id.
 *
 * Throws with the reason when the row was not written, or when it was written
 * and no id came back. A row nobody can name cannot be rendered or recorded
 * against, and saying "saved" about it would be untrue.
 */
export async function saveAnalysisRow(
  clientId: string,
  analysisData: PortfolioAnalysisRecord,
  pdfFilePath: string | null,
): Promise<string> {
  const { data, error } = await invokeSecureFunction('manage-client-data', {
    operation: 'create',
    table: 'portfolio_analysis_reports',
    clientId,
    data: portfolioAnalysisRow(analysisData, clientId, pdfFilePath),
  });
  if (error) throw new Error(messageOf(error, 'The analysis could not be saved'));
  const id = (data as { result?: { id?: unknown } } | null)?.result?.id;
  if (typeof id !== 'string' || !id) {
    throw new Error('The analysis was sent to Reports but no record came back to name it');
  }
  return id;
}

/**
 * Point the saved report at its file. The same operation, permission and
 * client binding as saving it: both need `portfolio_reports` edit access.
 */
export async function recordAnalysisFile(
  clientId: string,
  reportId: string,
  filePath: string,
): Promise<{ error: string | null }> {
  const { error } = await invokeSecureFunction('manage-client-data', {
    operation: 'update',
    table: 'portfolio_analysis_reports',
    clientId,
    recordId: reportId,
    data: { pdf_file_path: filePath },
  });
  return { error: error ? messageOf(error, 'The file could not be recorded against the report') : null };
}

/** List the file among the client's documents, as the legacy generator always has. */
export async function indexAnalysisFile(
  clientId: string,
  entry: { fileName: string; filePath: string; bytes: number },
): Promise<{ error: string | null }> {
  const { error } = await invokeSecureFunction('manage-client-data', {
    operation: 'create',
    table: 'client_files',
    clientId,
    data: portfolioFileIndexEntry(entry),
  });
  return { error: error ? messageOf(error, "The file could not be listed among the client's documents") : null };
}

/** Which step of the export did not happen. */
export type TemplateExportStage = 'save' | 'render' | 'record';

export interface TemplateExportResult {
  /** Where the analysis stands now: null only when it could not be saved at all. */
  saved: SavedPortfolioAnalysis | null;
  /** The file the browser received, or null when nothing was rendered. */
  delivered: DeliveredPortfolioReview | null;
  /** Whether the saved report's file is now this document. */
  recorded: boolean;
  /** Why it could not be listed among the client's documents, or null when it was (or nothing was recorded to list). */
  indexError: string | null;
  failure: { stage: TemplateExportStage; message: string } | null;
}

/** Wire boundary, injectable so the sequence is tested without a network. */
export interface TemplateExportDeps {
  saveRow: typeof saveAnalysisRow;
  render: typeof deliverPortfolioReview;
  recordFile: typeof recordAnalysisFile;
  indexFile: typeof indexAnalysisFile;
}

const WIRE: TemplateExportDeps = {
  saveRow: saveAnalysisRow,
  render: deliverPortfolioReview,
  recordFile: recordAnalysisFile,
  indexFile: indexAnalysisFile,
};

/**
 * Save the analysis (once), draw it in the chosen template, hand the file to
 * the browser and record it as the saved report's document.
 *
 * Never throws. Every outcome is a value, because the dialog's message differs
 * by which step stopped: nothing saved, saved without a file, or saved and
 * downloaded but not recorded.
 */
export async function exportAnalysisInTemplate(
  input: {
    clientId: string;
    analysis: PortfolioAnalysisRecord;
    /** What an earlier export or save in this dialog answered, if anything. */
    saved: SavedPortfolioAnalysis | null;
  },
  deps: TemplateExportDeps = WIRE,
): Promise<TemplateExportResult> {
  let saved = input.saved;

  if (!saved) {
    try {
      saved = { reportId: await deps.saveRow(input.clientId, input.analysis, null), filePath: null, renderer: null };
    } catch (e) {
      return {
        saved: null, delivered: null, recorded: false, indexError: null,
        failure: { stage: 'save', message: messageOf(e, 'The analysis could not be saved') },
      };
    }
  }

  let delivered: DeliveredPortfolioReview;
  try {
    delivered = await deps.render({
      variant: 'server',
      request: { reportId: saved.reportId, includeReview: false },
    });
  } catch (e) {
    return {
      saved, delivered: null, recorded: false, indexError: null,
      failure: { stage: 'render', message: messageOf(e, 'The PDF could not be produced') },
    };
  }

  if (!delivered.storagePath || delivered.storageBucket !== PORTFOLIO_FILE_BUCKET) {
    return {
      saved, delivered, recorded: false, indexError: null,
      failure: {
        stage: 'record',
        message: delivered.storagePath
          ? 'The PDF was stored where a saved report cannot point'
          : 'The renderer did not say where it stored the PDF',
      },
    };
  }

  const record = await deps.recordFile(input.clientId, saved.reportId, delivered.storagePath);
  if (record.error) {
    return {
      saved, delivered, recorded: false, indexError: null,
      failure: { stage: 'record', message: record.error },
    };
  }
  saved = { ...saved, filePath: delivered.storagePath, renderer: 'template' };

  const index = await deps.indexFile(input.clientId, {
    fileName: delivered.fileName,
    filePath: delivered.storagePath,
    bytes: delivered.bytes,
  });

  return { saved, delivered, recorded: true, indexError: index.error, failure: null };
}
