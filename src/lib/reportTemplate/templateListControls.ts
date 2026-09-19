/**
 * Pure list-control helpers for the Template Builder landing page.
 *
 * Keeping search/filter/sort logic here makes the page easier to review and
 * gives us a small surface that can be tested without rendering React.
 */
import { getAdapter } from './adapters';

export const TEMPLATE_SORT_OPTIONS = ['updated_desc', 'name_asc', 'name_desc', 'type', 'active_first', 'pages_desc'] as const;
export const TEMPLATE_STATUS_FILTERS = ['all', 'active', 'draft'] as const;

export type TemplateSortOption = (typeof TEMPLATE_SORT_OPTIONS)[number];
export type TemplateStatusFilter = (typeof TEMPLATE_STATUS_FILTERS)[number];

export interface TemplateListRecord {
  id: string;
  name: string;
  description: string | null;
  report_type: string | null;
  tier: string | null;
  schema?: {
    pages?: unknown[];
  } | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface TemplateListFilters {
  search: string;
  reportType: string;
  status: TemplateStatusFilter;
  sort: TemplateSortOption;
}

/**
 * What a card on the list needs from a template row.
 *
 * Wider than `TemplateListRecord` because the card also reads the two lock
 * flags. Structural rather than the generated row type, so a card can be handed
 * a record from either query without a cast.
 */
export interface TemplateRowLike {
  id: string;
  name: string;
  description?: string | null;
  report_type?: string | null;
  tier?: string | null;
  version?: number | string | null;
  is_active?: boolean | null;
  locked_for_review?: boolean | null;
  updated_at?: string | null;
}

/**
 * Why this template cannot be deleted, or null when it can.
 *
 * One function rather than a condition repeated at each call site. The rule —
 * active templates and templates locked for review are undeletable — is
 * enforced in the database too; this exists so the UI can say *which* of the
 * two it is instead of just greying a button out.
 */
export function deleteBlockedReason(template: TemplateRowLike): string | null {
  if (template.is_active) return 'Deactivate the template before deleting it.';
  if (template.locked_for_review) return 'Unlock the review before deleting it.';
  return null;
}

export const DEFAULT_TEMPLATE_LIST_FILTERS: TemplateListFilters = {
  search: '',
  reportType: 'all',
  status: 'all',
  sort: 'updated_desc',
};

const templateDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export const isTemplateSortOption = (value: string | null): value is TemplateSortOption =>
  !!value && TEMPLATE_SORT_OPTIONS.includes(value as TemplateSortOption);

export const isTemplateStatusFilter = (value: string | null): value is TemplateStatusFilter =>
  !!value && TEMPLATE_STATUS_FILTERS.includes(value as TemplateStatusFilter);

export const formatTemplateDate = (value?: string | null) => {
  if (!value) return 'Never updated';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Never updated';
  return templateDateFormatter.format(parsed);
};

export const getTemplateTimestamp = (tpl: TemplateListRecord) => {
  const timestamp = new Date(tpl.updated_at ?? tpl.created_at ?? 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export const getTemplatePageCount = (tpl: TemplateListRecord) => tpl.schema?.pages?.length ?? 0;

export const sortTemplateRecords = <T extends TemplateListRecord>(items: T[], sort: TemplateSortOption) => {
  const sorted = [...items];
  sorted.sort((a, b) => {
    switch (sort) {
      case 'name_asc':
        return String(a.name ?? '').localeCompare(String(b.name ?? ''));
      case 'name_desc':
        return String(b.name ?? '').localeCompare(String(a.name ?? ''));
      case 'type':
        return (
          String(a.report_type ?? '').localeCompare(String(b.report_type ?? ''))
          || String(a.name ?? '').localeCompare(String(b.name ?? ''))
        );
      case 'pages_desc':
        return getTemplatePageCount(b) - getTemplatePageCount(a);
      case 'active_first':
        return (
          Number(Boolean(b.is_active)) - Number(Boolean(a.is_active))
          || String(a.name ?? '').localeCompare(String(b.name ?? ''))
        );
      case 'updated_desc':
      default:
        return getTemplateTimestamp(b) - getTemplateTimestamp(a);
    }
  });
  return sorted;
};

export const getTemplateReportTypeOptions = (templates: TemplateListRecord[]) => {
  const seen = new Set<string>();
  return templates
    .map((tpl) => tpl.report_type)
    .filter((type: string | null | undefined): type is string => {
      if (!type || seen.has(type)) return false;
      seen.add(type);
      return true;
    });
};

export const filterAndSortTemplates = <T extends TemplateListRecord>(
  templates: T[],
  filters: TemplateListFilters,
) => {
  const query = filters.search.trim().toLowerCase();
  const filtered = templates.filter((tpl) => {
    const matchesSearch = !query
      || String(tpl.name ?? '').toLowerCase().includes(query)
      || String(tpl.description ?? '').toLowerCase().includes(query)
      || String(tpl.report_type ?? '').toLowerCase().includes(query)
      || String(tpl.tier ?? '').toLowerCase().includes(query);
    const matchesType = filters.reportType === 'all' || tpl.report_type === filters.reportType;
    const matchesStatus = filters.status === 'all'
      || (filters.status === 'active' ? Boolean(tpl.is_active) : !tpl.is_active);
    return matchesSearch && matchesType && matchesStatus;
  });
  return sortTemplateRecords(filtered, filters.sort);
};

export const getTemplateStats = (templates: TemplateListRecord[]) => {
  const active = templates.filter((tpl) => tpl.is_active).length;
  const previewOnly = templates.filter((tpl) => {
    const adapter = tpl.report_type ? getAdapter(tpl.report_type) : null;
    return adapter ? !adapter.supportsProduction : false;
  }).length;

  return {
    active,
    draft: templates.length - active,
    previewOnly,
    total: templates.length,
  };
};

export const readTemplateListFiltersFromParams = (params: URLSearchParams): TemplateListFilters => ({
  search: params.get('q') ?? DEFAULT_TEMPLATE_LIST_FILTERS.search,
  reportType: params.get('type') ?? DEFAULT_TEMPLATE_LIST_FILTERS.reportType,
  status: isTemplateStatusFilter(params.get('status'))
    ? params.get('status') as TemplateStatusFilter
    : DEFAULT_TEMPLATE_LIST_FILTERS.status,
  sort: isTemplateSortOption(params.get('sort'))
    ? params.get('sort') as TemplateSortOption
    : DEFAULT_TEMPLATE_LIST_FILTERS.sort,
});

export const writeTemplateListFiltersToParams = (filters: TemplateListFilters) => {
  const next = new URLSearchParams();
  const trimmedSearch = filters.search.trim();
  if (trimmedSearch) next.set('q', trimmedSearch);
  if (filters.reportType !== DEFAULT_TEMPLATE_LIST_FILTERS.reportType) next.set('type', filters.reportType);
  if (filters.status !== DEFAULT_TEMPLATE_LIST_FILTERS.status) next.set('status', filters.status);
  if (filters.sort !== DEFAULT_TEMPLATE_LIST_FILTERS.sort) next.set('sort', filters.sort);
  return next;
};
