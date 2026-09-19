/**
 * Native-PDF-to-Claude reconstruction (plan §7a).
 *
 * Sends the PDF itself to the design agent (which forwards it to Claude as a
 * native `document` block via `claudeReconstruct`), so a scanned/image-only PDF
 * is reconstructed from Claude's reading of the document rather than from sparse
 * deterministic text. The network call is injected (`InvokeFn`) for testability.
 */
import { parseTemplate, type ReportTemplate } from '../templateSchema';
import { validateReconstructedSchema } from '../referenceImport';
import type { GroundPdfResult } from '../pdfImport/groundPdfDocument';
import type { InvokeFn } from './codeIngest';

export interface PdfReconstructArgs {
  /** Base64 PDF bytes (no data: prefix). */
  pdfBase64: string;
  schema: ReportTemplate;
  activePageId?: string | null;
  sampleData?: unknown;
  instruction?: string;
  /**
   * Measurements read from these exact PDF bytes.
   *
   * Every other reference kind grounds the model before asking it to rebuild
   * anything — OCR words for an image, a box tree for code and for Figma. The
   * PDF path was the exception, and it is the one holding the best evidence:
   * a stated baseline and advance width rather than a recognition guess.
   * Omitted (never sent empty) when there are no measurements, so the agent
   * falls back to reading the document itself rather than being told the page
   * is blank.
   */
  grounding?: GroundPdfResult | null;
}

export interface PdfReconstructResult {
  schema: ReportTemplate;
  pageCount: number;
  modelUsed: string | null;
  warnings: string[];
}

export async function reconstructPdfWithClaude(
  args: PdfReconstructArgs,
  invoke: InvokeFn,
): Promise<PdfReconstructResult> {
  if (!args.pdfBase64) throw new Error('No PDF provided.');
  const instruction = args.instruction
    || 'Read the attached PDF and reconstruct it faithfully as editable native blocks on the active page. Transcribe the text exactly and keep the measured positions — do not redesign.';

  // Send grounding only when it carries measurements. An empty element list
  // would satisfy the agent's guard and then assert the pages have no text —
  // which on a scanned document is a lie the model would reproduce.
  const measured = (args.grounding?.pages ?? []).filter((p) => p.reference?.elements?.length);
  const grounding = measured.length
    ? {
        // `groundedReference` is the single-page key the agent already reads;
        // keeping it set means the first page grounds even a caller that knows
        // nothing about the multi-page shape.
        groundedReference: measured[0].reference,
        groundedPages: measured.map((p) => ({
          pageNumber: p.pageNumber, reference: p.reference, dropped: p.dropped,
        })),
        groundingCoverage: {
          totalPages: args.grounding?.totalPages ?? measured.length,
          pagesOmitted: args.grounding?.pagesOmitted ?? 0,
          elementsDropped: args.grounding?.elementsDropped ?? 0,
        },
      }
    : {};

  const { data, error } = await invoke('template-design-agent', {
    schema: args.schema,
    messages: [{ role: 'user', content: instruction }],
    instruction,
    activePageId: args.activePageId,
    mode: 'pdf_document',
    pdfBase64: args.pdfBase64,
    sampleData: args.sampleData,
    ...grounding,
  });
  if (error) throw new Error(error.message || 'Reconstruction failed');
  if (data?.error) throw new Error(String(data.error));

  const validation = validateReconstructedSchema(data?.schema);
  if (!validation.ok) throw new Error(`Reconstruction was not usable: ${validation.errors.join(' ')}`);

  return {
    schema: parseTemplate(data.schema),
    pageCount: validation.pageCount,
    modelUsed: data?.modelUsed ?? null,
    warnings: Array.isArray(data?.warnings) ? data.warnings : [],
  };
}
