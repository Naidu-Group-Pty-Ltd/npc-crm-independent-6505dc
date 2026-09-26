/**
 * Which design a document drawn in the browser is drawn in.
 *
 * Nine documents are drawn here rather than typeset on the server, and none has
 * a template of its own (`DRAWN_DOCUMENTS`). Each wears the design the person
 * chose for the report type it is made from: this module reads that choice,
 * reads the chosen template's design exactly as a render route would
 * (`templateDesignRead.ts`) — its tokens and its library lineage, never its
 * pages — and hands the document what a drawn document can honour of it
 * (`drawnDesign.pure.ts`).
 *
 * ## The same rules as the typeset path
 *
 * - **Who may use a row** is decided by `manage-templates`' read scope, the one
 *   the Template Builder lists by, and **which rows a report type may use** by
 *   `designRowUsableFor`, the one the render routes apply. So a design the
 *   server would refuse for the report type is refused here as well.
 * - **Nothing chosen is the house design**, byte for byte. So is a choice that
 *   cannot be read at all — the person has no access to templates, the read
 *   failed — because that is what the document was before designs existed.
 * - **A choice that was read and cannot be honoured is said out loud**, in the
 *   same words the typeset routes use (`DESIGN_REFUSAL_TEXT`), because a
 *   standard document handed over in silence looks exactly like a chosen
 *   design that was honoured.
 *
 * A design is never worth the document: this never throws.
 */
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  DESIGN_REFUSAL_TEXT,
  designFromTemplateRow,
  type TemplateDesignRefusal,
} from '@/lib/reportDesign/templateDesign.pure';
import { drawnDesignOf, type DrawnDocumentDesign } from '@/lib/reportDesign/drawnDesign.pure';
import {
  designRowUsableFor,
  drawnDocumentDesignSource,
  type DesignTemplateRow,
  type DrawnDocumentKey,
} from '../../../supabase/functions/_shared/reports/templateDesignRoute.pure.ts';
import { normaliseReportType } from '../../../supabase/functions/_shared/reports/reportTemplateSelection.pure.ts';
import {
  fetchTemplateSelections,
  selectionsByFormat,
  type ReportTemplateSelectionRow,
} from '@/lib/reportTemplate/templateSelection';
import { DESIGN_NOT_USED_TITLE } from '@/lib/reportTemplate/standardDesign';

export type { DrawnDocumentKey } from '../../../supabase/functions/_shared/reports/templateDesignRoute.pure.ts';
export type { DrawnDocumentDesign } from '@/lib/reportDesign/drawnDesign.pure';

/** A template row with the two columns a design is read from. */
export interface DrawnDesignTemplateRow extends DesignTemplateRow {
  tokens?: unknown;
  lineage?: unknown;
}

/**
 * Only the columns a design is read from — the render routes' own list
 * (`templateDesignRead.ts`). `schema` and `config` are never read whole: some
 * rows carry megabytes of page definition, and none of it is a design.
 */
export const DRAWN_DESIGN_COLUMNS =
  'id,name,report_type,engine,scope,owner_user_id,is_active,is_draft,'
  + 'tokens:schema->tokens,lineage:config->libraryLineage';

export interface DrawnDesignDeps {
  /** The person's own choices, one per report type. */
  fetchSelections: () => Promise<ReportTemplateSelectionRow[]>;
  /** One template row, as the person may see it, or null where they may not. */
  fetchTemplateRow: (templateId: string) => Promise<DrawnDesignTemplateRow | null>;
  /** Say, beside the working file, that a choice was not honoured. */
  notify: (title: string, description: string) => void;
}

async function fetchTemplateRow(templateId: string): Promise<DrawnDesignTemplateRow | null> {
  const { data, error } = await invokeSecureFunction('manage-templates', {
    operation: 'list',
    table: 'report_templates',
    listOptions: { select: DRAWN_DESIGN_COLUMNS, filters: { id: templateId }, limit: 1 },
  });
  if (error) throw new Error(error.message || 'The chosen template could not be read');
  const records = (data as { records?: unknown } | null)?.records;
  const row = Array.isArray(records) ? records[0] : null;
  return row && typeof row === 'object' ? row as DrawnDesignTemplateRow : null;
}

export const DEFAULT_DRAWN_DESIGN_DEPS: DrawnDesignDeps = {
  fetchSelections: fetchTemplateSelections,
  fetchTemplateRow,
  notify: (title, description) => {
    toast.warning(title, { description, duration: 12_000 });
  },
};

/**
 * The design a drawn document is drawn in, or null for the house design.
 *
 * `document` names the document; the report type whose choice it wears is the
 * register's (`DRAWN_DOCUMENTS`), never the caller's to name.
 */
export async function drawnDesignFor(
  document: DrawnDocumentKey,
  deps: DrawnDesignDeps = DEFAULT_DRAWN_DESIGN_DEPS,
): Promise<DrawnDocumentDesign | null> {
  const reportType = drawnDocumentDesignSource(document);

  // No readable choice is no choice: the document everyone already had.
  let templateId: string | undefined;
  try {
    templateId = selectionsByFormat(await deps.fetchSelections())
      .get(normaliseReportType(reportType))?.template_id;
  } catch {
    return null;
  }
  if (!templateId) return null;

  const refuse = (reason: TemplateDesignRefusal, detail: string): null => {
    console.warn(`[drawnDocumentDesign] ${document}: design not applied (${reason}): ${detail}`);
    deps.notify(DESIGN_NOT_USED_TITLE, DESIGN_REFUSAL_TEXT[reason]);
    return null;
  };

  let row: DrawnDesignTemplateRow | null;
  try {
    row = await deps.fetchTemplateRow(templateId);
  } catch (e) {
    // A read that failed is not a template that is gone: try again, not choose another.
    return refuse('template_unreadable', e instanceof Error ? e.message : String(e));
  }
  if (!row) return refuse('template_unavailable', 'no such template, or not visible to this person');
  if (!designRowUsableFor(row, reportType)) return refuse('template_unavailable', `not offered for ${reportType}`);

  const result = designFromTemplateRow({ id: row.id, name: row.name ?? null, tokens: row.tokens, lineage: row.lineage });
  if (result.ok === false) return refuse(result.reason, result.detail);
  for (const note of result.design.notes) console.warn(`[drawnDocumentDesign] ${document}: ${result.design.label}: ${note}`);
  return drawnDesignOf(result.design);
}
