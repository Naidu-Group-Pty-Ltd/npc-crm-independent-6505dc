import { parseTemplate, type Page, type ReportTemplate } from '../../templateSchema';
import {
  bindPagesToTokens,
  mergeImportTokens,
  type BindablePage,
} from '../../pdfImport/designSystemBinding.pure';
import type { TemplateImportPlan } from './types';

export interface ApplyImportPlanOptions {
  templateName?: string;
  baseTemplate?: ReportTemplate;
  activePageId?: string | null;
}

function freeBlockId(pageId: string): string {
  return `${pageId}_free`;
}

function importMeta(plan: TemplateImportPlan, title?: string, baseMeta?: ReportTemplate['meta']): ReportTemplate['meta'] {
  return {
    ...(baseMeta ?? {}),
    ...(title ? { title } : {}),
    creator: 'template-import-reconciliation-engine',
    subject: `Import ${plan.importId} · ${plan.importSummary.visualFidelityMode} · confidence ${Math.round(plan.confidenceScore * 100)}%`,
    keywords: [
      'template-import',
      plan.importSummary.visualFidelityMode,
      `${plan.importSummary.editableElementsCreated}-editable-elements`,
    ].join(', '),
  };
}

function planPageToTemplatePage(page: TemplateImportPlan['pages'][number], plan: TemplateImportPlan, override?: Pick<Page, 'id' | 'name'>): Page {
  const pageId = override?.id ?? page.id;
  return {
    id: pageId,
    name: override?.name ?? page.name,
    size: { width: page.width, height: page.height },
    background: {
      ...(page.background.color ? { color: page.background.color } : {}),
      imageUrl: page.background.imageUrl,
      ...(page.background.imageFit ? { imageFit: page.background.imageFit } : {}),
      ...(page.background.opacity !== undefined ? { opacity: page.background.opacity } : {}),
      ...(page.background.underlay !== undefined ? { underlay: page.background.underlay } : {}),
    },
    blocks: [{
      id: freeBlockId(pageId),
      type: 'free',
      props: {},
      overlays: page.overlays,
      locked: false,
      name: 'Editable import overlays',
    }],
    notes: [
      `Imported by Template Import Reconciliation Engine (${plan.importSummary.visualFidelityMode}).`,
      `Source page: ${page.sourcePageId}.`,
      `Warnings: ${page.warnings.length}.`,
    ].join(' '),
  };
}

/**
 * The design system an import brings with it, and the pages bound to it.
 *
 * Base-template tokens win every conflict: importing into an existing template
 * must not restyle the pages already in it. Binding then happens against the
 * MERGED map, which is what keeps the render byte-identical either way — a
 * derived `text #251F18` against a base that already defines `text #000000`
 * simply does not match the overlay, so the literal stays.
 */
function bindImportDesignSystem<T extends BindablePage>(
  plan: TemplateImportPlan,
  pages: T[],
  baseTokens: ReportTemplate['tokens'] | undefined,
): { pages: T[]; tokens: ReportTemplate['tokens'] } {
  const merged = mergeImportTokens(plan.tokens as never, baseTokens as never);
  const tokens = {
    ...(baseTokens ?? { colors: {}, fonts: {}, spacing: {} }),
    colors: merged.colors,
    fonts: merged.fonts,
    spacing: baseTokens?.spacing ?? {},
  } as ReportTemplate['tokens'];
  return { pages: bindPagesToTokens(pages, merged).pages, tokens };
}

/** Convert a validated TemplateImportPlan into the editor's deterministic schema. */
export function applyTemplateImportPlan(
  plan: TemplateImportPlan,
  options: ApplyImportPlanOptions = {},
): ReportTemplate {
  const importedPages = plan.pages.map((page) => planPageToTemplatePage(page, plan));

  if (options.baseTemplate?.pages?.length && options.activePageId && plan.pages.length === 1) {
    // Only the replaced page is bound. The rest of the base template is the
    // user's existing work and is not this import's to touch.
    const single = bindImportDesignSystem(
      plan,
      [planPageToTemplatePage(plan.pages[0], plan, {
        id: options.activePageId, name: options.baseTemplate.pages.find((p) => p.id === options.activePageId)?.name,
      })] as never[],
      options.baseTemplate.tokens,
    );
    return parseTemplate({
      ...options.baseTemplate,
      tokens: single.tokens,
      pages: options.baseTemplate.pages.map((page) => page.id === options.activePageId
        ? single.pages[0]
        : page),
      meta: importMeta(plan, options.baseTemplate.meta?.title, options.baseTemplate.meta),
    });
  }

  const bound = bindImportDesignSystem(plan, importedPages as never[], options.baseTemplate?.tokens);
  return parseTemplate({
    version: 1,
    tokens: bound.tokens,
    pages: bound.pages,
    slots: options.baseTemplate?.slots ?? {},
    meta: importMeta(plan, options.templateName ?? options.baseTemplate?.meta?.title ?? 'Imported template', options.baseTemplate?.meta),
  });
}
