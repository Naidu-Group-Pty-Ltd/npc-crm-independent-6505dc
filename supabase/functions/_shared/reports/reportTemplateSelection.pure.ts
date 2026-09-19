/**
 * Which templates a report format may be generated with, and which one is.
 *
 * ## The thing this makes possible
 *
 * A template reached a document by RANKING alone — `resolve_report_template()`
 * sorts the active rows for a report type by scope, variant, priority and
 * recency and takes the first. Nobody chose it, nobody could see which one it
 * was, and the only surface in the product that touched templates at all was
 * the Template Builder, which is an editor. "Pick the template this report
 * comes out in" was therefore a thing you did by opening a page designed for
 * something else, or not at all.
 *
 * This module is the rule the picker renders and the generation path reads: the
 * candidate set for a format, and what a stored selection resolves to. It is
 * NOT an authorisation boundary. A template is a candidate because it is
 * already `is_active`, and a row only becomes active by passing
 * `validateReportTemplateUpdate` in `manage-templates` — superadmin, approved,
 * a production adapter for the type, and a schema that renders. Selecting is
 * choosing among things somebody already approved.
 *
 * ## The two rules that keep biting
 *
 * **A format has several spellings and they are one format.** `compass`,
 * `investment_compass`, `investment_report` and `property_investment` are all
 * the Investment report, and the broker will activate a template stored under
 * any of them. A picker that matched the raw column would show a different set
 * depending on which spelling a template happened to be saved under, and a
 * selection keyed on the raw column would be a different selection for each.
 * Everything here goes through `normaliseReportType`, and a selection is stored
 * under the normalised key.
 *
 * **A selection can go stale without being deleted.** The template can be
 * deactivated, or retyped onto another format, and the row still points at it.
 * `resolveTemplateSelection` answers `unavailable` for that — never a silent
 * fallback — because the person who chose it needs to be told their choice
 * stopped applying rather than handed a document they did not pick.
 *
 * Pure and dependency-free: no `@/` aliases, no imports, parses under Deno and
 * imports cleanly into a vitest suite in `src/`.
 */

/**
 * Raw `report_type` spelling → the format's canonical key.
 *
 * This is the one map. `src/lib/reportTemplate/adapters/index.ts` re-exports
 * `normaliseReportType` from here rather than keeping a second copy, and
 * `reportTemplateSelection.spec.ts` checks every spelling
 * `PRODUCTION_REPORT_TEMPLATE_TYPES` will activate lands on an adapter — that
 * check is what found `commercial_industrial`, which the broker activated and
 * the registry then failed to resolve to anything.
 */
export const REPORT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  compass: 'investment',
  investment_compass: 'investment',
  investment_report: 'investment',
  property_investment: 'investment',
  borrowing: 'borrowing_capacity',
  // Both spellings reach `PRODUCTION_REPORT_TEMPLATE_TYPES` in the broker,
  // which matches the raw `report_type` and does not run it through this map.
  // Without the alias the two gates would disagree about `cash_flow`.
  cash_flow: 'cashflow',
  clientdetails: 'client_details',
  formara: 'client_details',
  // The broker activates a template stored under either spelling; without this
  // one, a `commercial_industrial` template was activatable and then resolved
  // to no adapter at all, so it could never be picked or rendered.
  commercial_industrial: 'commercial_capacity',
};

export function normaliseReportType(reportType?: string | null): string {
  const key = String(reportType ?? '').trim().toLowerCase();
  return REPORT_TYPE_ALIASES[key] ?? key;
}

/**
 * The parts of a `report_templates` row a chooser needs.
 *
 * Deliberately narrow. Choosing a template does not require its schema, its
 * CSS, its config or its lineage — those are megabytes on some rows, and none
 * of them changes which template is the right one to pick.
 */
export interface SelectableTemplateRow {
  id: string;
  name?: string | null;
  description?: string | null;
  report_type?: string | null;
  engine?: string | null;
  is_active?: boolean | null;
  is_default?: boolean | null;
  is_draft?: boolean | null;
  scope?: string | null;
  variant?: string | null;
  tier?: string | null;
  priority?: number | null;
  updated_at?: string | null;
  thumbnail_url?: string | null;
  /**
   * Where the row came from, when it came from the Template Library.
   *
   * The `libraryLineage` block `buildWorkingCopyPayload` writes into `config`,
   * selected on its own so the chooser can tie an active row back to the
   * catalogue entry it was copied from without ever fetching `config` itself.
   * Absent (or null) on hand-built templates, which is itself the signal: a
   * row with no lineage is not a library design.
   */
  libraryLineage?: {
    entryId?: string | null;
    entrySlug?: string | null;
    entryVersion?: number | null;
    familyKey?: string | null;
    familyName?: string | null;
    templateCode?: string | null;
    variantAxis?: string | null;
    density?: string | null;
    colourway?: string | null;
    colourwayName?: string | null;
    ground?: string | null;
  } | null;
}

/**
 * Whether this template will actually be drawn by the design system.
 *
 * `routeReportThroughTemplate` skips anything that is not `weasyprint` and the
 * caller falls through to the legacy generator — one of the four silent paths
 * `docs/reports/COVERAGE.md` measured, and the reason 80 of 81 template rows
 * render nothing. Selecting such a template is legitimate (it is what the
 * ranking would have picked anyway) but the picker has to SAY so, because
 * "chosen" and "used" are otherwise indistinguishable from the outside.
 */
export function templateRendersThroughDesignSystem(row: SelectableTemplateRow): boolean {
  return String(row?.engine ?? 'jspdf').toLowerCase() === 'weasyprint';
}

/** Whether this template belongs to the given format, across every spelling. */
export function templateMatchesFormat(
  row: SelectableTemplateRow, reportType: string,
): boolean {
  const format = normaliseReportType(reportType);
  if (!format) return false;
  return normaliseReportType(row?.report_type) === format;
}

/** Active, published, and for this format. Draft rows are not choices. */
export function isSelectableTemplate(
  row: SelectableTemplateRow, reportType: string,
): boolean {
  if (!row?.id) return false;
  if (row.is_active !== true) return false;
  if (row.is_draft === true) return false;
  return templateMatchesFormat(row, reportType);
}

/**
 * The candidate list, in the order a chooser should read it.
 *
 * Templates that will actually be drawn come first — the alternative is a list
 * whose top entry silently produces the legacy document. After that it mirrors
 * the ranking the resolver would apply anyway (the house default, then
 * priority, then recency), so the first entry is what you would get without
 * choosing and the list reads as "this, or one of these instead".
 */
export function selectableTemplatesForFormat(
  rows: SelectableTemplateRow[] | null | undefined, reportType: string,
): SelectableTemplateRow[] {
  const candidates = (rows ?? []).filter((row) => isSelectableTemplate(row, reportType));
  return candidates.sort((a, b) => {
    const designA = templateRendersThroughDesignSystem(a) ? 0 : 1;
    const designB = templateRendersThroughDesignSystem(b) ? 0 : 1;
    if (designA !== designB) return designA - designB;

    const defaultA = a.is_default === true ? 0 : 1;
    const defaultB = b.is_default === true ? 0 : 1;
    if (defaultA !== defaultB) return defaultA - defaultB;

    const priorityA = Number(a.priority ?? 0);
    const priorityB = Number(b.priority ?? 0);
    if (priorityA !== priorityB) return priorityB - priorityA;

    const updatedA = new Date(a.updated_at ?? 0).getTime();
    const updatedB = new Date(b.updated_at ?? 0).getTime();
    if (updatedA !== updatedB) return updatedB - updatedA;

    return String(a.name ?? '').localeCompare(String(b.name ?? ''));
  });
}

export type TemplateSelectionStatus =
  /** Nothing chosen. The resolver's ranking decides, exactly as before. */
  | 'none'
  /** Chosen, still selectable, and what the next document will use. */
  | 'selected'
  /**
   * Chosen, and no longer a candidate — deactivated, retyped, or gone.
   *
   * Deliberately its own status rather than collapsing to `none`. Generation
   * falls back to the ranking either way; the difference is that this one is
   * said out loud, because a choice that stopped applying is news.
   */
  | 'unavailable';

export interface ResolvedTemplateSelection {
  status: TemplateSelectionStatus;
  /** The chosen row, only when it is still a candidate. */
  template: SelectableTemplateRow | null;
  /** The id that was stored, whatever became of it. */
  selectedTemplateId: string | null;
  /**
   * True when the design system will draw the next document with this choice.
   * False for `none`, for `unavailable`, and for a chosen jsPDF template.
   */
  rendersThroughDesignSystem: boolean;
}

/**
 * What a stored selection means against the templates that exist now.
 *
 * The candidate list is the authority: a selection is honoured only if the row
 * it names is still selectable for this format. That is what makes retiring a
 * template safe — deactivating it cannot leave somebody generating from it, and
 * cannot silently swap their document for a different one without telling them.
 */
export function resolveTemplateSelection(args: {
  selectedTemplateId?: string | null;
  templates?: SelectableTemplateRow[] | null;
  reportType: string;
}): ResolvedTemplateSelection {
  const selectedTemplateId = args.selectedTemplateId ? String(args.selectedTemplateId) : null;
  const candidates = selectableTemplatesForFormat(args.templates, args.reportType);

  if (!selectedTemplateId) {
    return {
      status: 'none', template: null, selectedTemplateId: null,
      rendersThroughDesignSystem: false,
    };
  }

  const template = candidates.find((row) => row.id === selectedTemplateId) ?? null;
  if (!template) {
    return {
      status: 'unavailable', template: null, selectedTemplateId,
      rendersThroughDesignSystem: false,
    };
  }

  return {
    status: 'selected',
    template,
    selectedTemplateId,
    rendersThroughDesignSystem: templateRendersThroughDesignSystem(template),
  };
}
