/**
 * Reading and writing "which template this report format comes out in".
 *
 * The rules are shared with the server
 * (`_shared/reports/reportTemplateSelection.pure.ts`); this module is the
 * transport. Both halves go through `manage-templates`, which scopes every
 * selection read and write to the verified session user — the owner is stamped
 * server-side and an `owner_user_id` in a request body is inert.
 *
 * Nothing here opens the Template Builder. That was the whole problem: choosing
 * a template meant navigating into an editor, which is a different job, and the
 * choice you made there was a working copy rather than a selection.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  normaliseReportType,
  resolveTemplateSelection,
  selectableTemplatesForFormat,
  type ResolvedTemplateSelection,
  type SelectableTemplateRow,
} from '../../../supabase/functions/_shared/reports/reportTemplateSelection.pure.ts';

export {
  REPORT_TYPE_ALIASES,
  isSelectableTemplate,
  normaliseReportType,
  resolveTemplateSelection,
  selectableTemplatesForFormat,
  templateMatchesFormat,
  templateRendersThroughDesignSystem,
  type ResolvedTemplateSelection,
  type SelectableTemplateRow,
  type TemplateSelectionStatus,
} from '../../../supabase/functions/_shared/reports/reportTemplateSelection.pure.ts';

/** One stored answer, as the table holds it. */
export interface ReportTemplateSelectionRow {
  id: string;
  report_type: string;
  template_id: string;
  selected_at?: string | null;
  updated_at?: string | null;
}

/**
 * The columns a chooser needs, and no more.
 *
 * `schema`, `config` and `custom_css` are deliberately absent: some rows carry
 * hundreds of kilobytes of page definition, none of it changes which template
 * is the right one to pick, and the picker lists every active template for the
 * format at once.
 */
const TEMPLATE_COLUMNS =
  'id,name,description,report_type,engine,is_active,is_default,is_draft,scope,variant,tier,priority,updated_at,thumbnail_url,'
  // The lineage block alone, NOT `config` (which carries megabytes of page
  // definition on some rows). It is how the picker recognises that an active
  // row IS a library design — the seeded masters and adopted copies both
  // carry it — so the library list can show "this one is yours already"
  // instead of listing the same design twice.
  + 'libraryLineage:config->libraryLineage';

/**
 * Every active template, so the caller can group them by format itself.
 *
 * One request rather than one per format: the whole table is 81 rows in
 * production, and the surfaces that list formats need all of them anyway. The
 * `report_type` column is NOT filtered server-side, because a format is stored
 * under up to four spellings and a `.eq()` would see one of them —
 * `selectableTemplatesForFormat` does the matching through the alias map.
 */
export async function fetchActiveReportTemplates(): Promise<SelectableTemplateRow[]> {
  const { data, error } = await invokeSecureFunction('manage-templates', {
    operation: 'list',
    table: 'report_templates',
    listOptions: {
      select: TEMPLATE_COLUMNS,
      orderBy: 'updated_at',
      orderAsc: false,
      filters: { is_active: true },
      limit: 500,
    },
  });
  if (error) throw new Error(error.message);
  return (data?.records ?? []) as SelectableTemplateRow[];
}

/**
 * Page one of every active template, for the picker's tiles.
 *
 * A standalone active row (no library lineage in the listed catalogue) has no
 * `preview_schema`, so its face comes from the template's own `schema` — but
 * fetching `schema` whole is exactly what `TEMPLATE_COLUMNS` exists to avoid:
 * some rows carry hundreds of kilobytes of page definition. This asks
 * PostgREST for page one and the token palette alone (measured across
 * production's active rows: ~50KB total, largest page 3.9KB), and only when
 * the dialog is open with such a row to draw.
 *
 * A row whose schema has no pages is simply absent from the map — the tile
 * draws its empty sheet — and a failed fetch is the caller's to swallow: a
 * missing picture must never take the chooser down.
 */
export async function fetchActiveTemplatePreviewPages(): Promise<Map<string, unknown>> {
  const { data, error } = await invokeSecureFunction('manage-templates', {
    operation: 'list',
    table: 'report_templates',
    listOptions: {
      select: 'id,previewPage:schema->pages->0,previewTokens:schema->tokens',
      orderBy: 'updated_at',
      orderAsc: false,
      filters: { is_active: true },
      limit: 500,
    },
  });
  if (error) throw new Error(error.message);
  const map = new Map<string, unknown>();
  const rows = (data?.records ?? []) as Array<{ id?: string; previewPage?: unknown; previewTokens?: unknown }>;
  for (const row of rows) {
    if (row?.id && row.previewPage && typeof row.previewPage === 'object') {
      // The shape `TemplateDocumentPreview` reads: one page plus the palette.
      map.set(row.id, { pages: [row.previewPage], tokens: row.previewTokens ?? {} });
    }
  }
  return map;
}

/** This user's selections, every format at once. Scoped server-side. */
export async function fetchTemplateSelections(): Promise<ReportTemplateSelectionRow[]> {
  const { data, error } = await invokeSecureFunction('manage-templates', {
    operation: 'list',
    table: 'report_template_selections',
    listOptions: { orderBy: 'updated_at', orderAsc: false, limit: 200 },
  });
  if (error) throw new Error(error.message);
  return (data?.records ?? []) as ReportTemplateSelectionRow[];
}

/**
 * Lock a template in for a format.
 *
 * Upsert on `(owner_user_id, report_type)`: choosing again replaces the answer
 * rather than adding a second one, which is what makes "locked in unless you
 * change it" a database constraint instead of a convention.
 */
export async function saveTemplateSelection(
  reportType: string, templateId: string,
): Promise<void> {
  const format = normaliseReportType(reportType);
  if (!format) throw new Error('A report format is required.');
  if (!templateId) throw new Error('A template is required.');

  const { error } = await invokeSecureFunction('manage-templates', {
    operation: 'upsert',
    table: 'report_template_selections',
    data: { report_type: format, template_id: templateId, selected_at: new Date().toISOString() },
    onConflict: 'owner_user_id,report_type',
  });
  if (error) throw new Error(error.message);
}

/** Hand the format back to the resolver's ranking. */
export async function clearTemplateSelection(selectionId: string): Promise<void> {
  const { error } = await invokeSecureFunction('manage-templates', {
    operation: 'delete',
    table: 'report_template_selections',
    recordId: selectionId,
  });
  if (error) throw new Error(error.message);
}

/** Index the selection rows by their normalised format key. */
export function selectionsByFormat(
  rows: ReportTemplateSelectionRow[] | null | undefined,
): Map<string, ReportTemplateSelectionRow> {
  const out = new Map<string, ReportTemplateSelectionRow>();
  for (const row of rows ?? []) {
    const key = normaliseReportType(row?.report_type);
    if (key && row?.template_id) out.set(key, row);
  }
  return out;
}

/**
 * The whole answer for one format: what is chosen, whether it still applies,
 * and what there is to choose from.
 */
export interface FormatTemplateState extends ResolvedTemplateSelection {
  reportType: string;
  candidates: SelectableTemplateRow[];
  /** The stored row, so it can be cleared without a second lookup. */
  selectionId: string | null;
}

export function buildFormatTemplateState(args: {
  reportType: string;
  templates: SelectableTemplateRow[] | null | undefined;
  selections: ReportTemplateSelectionRow[] | null | undefined;
}): FormatTemplateState {
  const reportType = normaliseReportType(args.reportType);
  const selection = selectionsByFormat(args.selections).get(reportType) ?? null;
  const candidates = selectableTemplatesForFormat(args.templates, reportType);
  const resolved = resolveTemplateSelection({
    selectedTemplateId: selection?.template_id ?? null,
    templates: args.templates,
    reportType,
  });
  return { ...resolved, reportType, candidates, selectionId: selection?.id ?? null };
}
