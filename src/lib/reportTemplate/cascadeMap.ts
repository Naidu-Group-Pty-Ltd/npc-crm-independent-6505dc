/**
 * Report cascade map — semantic traceability between the configured report
 * structure, generated binding data, and visual landing points in a PDF design.
 *
 * The functions in this module are pure and renderer-agnostic so they can power
 * the Template Builder UI, activation linting, tests, and optional render-time
 * debug metadata without calling Supabase or WeasyPrint.
 */
import { evalConditional } from './bindingResolver';
import { parseTemplate, type Block, type Overlay, type ReportAnchor, type ReportTemplate } from './templateSchema';

export interface ReportStructureTemplateLike {
  id?: string | null;
  name?: string | null;
  parsed_content?: string | null;
  report_tier?: string | null;
  report_category?: string | null;
  priority?: number | null;
}

export interface ReportOutputFieldContract {
  path: string;
  label: string;
  type: 'text' | 'richText' | 'table' | 'chart' | 'image' | 'number' | 'list' | 'unknown';
  required: boolean;
  repeatable?: boolean;
  sectionId: string;
}

export interface ReportOutputSectionContract {
  id: string;
  label: string;
  order: number;
  required: boolean;
  source: 'report_structure_templates' | 'template_anchors' | 'fallback';
  structureTemplateId?: string;
  fields: ReportOutputFieldContract[];
}

export interface ReportOutputContract {
  reportType?: string | null;
  tier?: string | null;
  category?: string | null;
  structureTemplateId?: string | null;
  structureTemplateName?: string | null;
  version: number;
  sections: ReportOutputSectionContract[];
}

export interface CascadeTarget {
  pageId: string;
  pageName: string;
  pageIndex: number;
  blockId: string;
  blockName?: string;
  blockType?: string;
  overlayId?: string;
  overlayType?: string;
  anchorId: string;
  anchor: ReportAnchor;
  fieldPath?: string;
  bindingExpression?: string;
}

export interface CascadeSectionStatus {
  sectionId: string;
  label: string;
  required: boolean;
  status: 'mapped' | 'partially_mapped' | 'missing_anchor' | 'unused_generated_output';
  fields: ReportOutputFieldContract[];
  targets: CascadeTarget[];
}

export interface CascadeIssue {
  severity: 'info' | 'warning' | 'error';
  code:
    | 'missing_required_anchor'
    | 'binding_path_not_in_structure'
    | 'anchor_without_binding'
    | 'generated_output_unused'
    | 'duplicate_anchor'
    | 'conditional_anchor_hidden'
    | 'repeat_without_array_source';
  message: string;
  target?: CascadeTarget;
  sectionId?: string;
  fieldPath?: string;
}

export interface CascadeMap {
  templateId?: string | null;
  structureTemplateId?: string | null;
  reportType?: string | null;
  tier?: string | null;
  pages: Array<{ id: string; name: string; index: number; targetCount: number }>;
  sections: CascadeSectionStatus[];
  unmappedTargets: CascadeTarget[];
  issues: CascadeIssue[];
  stats: {
    requiredSections: number;
    mappedRequiredSections: number;
    totalSections: number;
    mappedSections: number;
    totalAnchors: number;
    issueCount: number;
    errorCount: number;
    warningCount: number;
  };
}

const DEFAULT_FIELD_SUFFIXES = [
  { key: 'title', label: 'Title', type: 'text' as const, required: true },
  { key: 'body', label: 'Body', type: 'richText' as const, required: true },
  { key: 'highlights', label: 'Highlights', type: 'list' as const, required: false, repeatable: true },
];

export function slugifySectionId(value: string, fallback = 'section'): string {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

export function canonicalSectionFieldPath(sectionId: string, field = 'body'): string {
  return `sections.${sectionId}.${field}`;
}

export function extractStructureHeadings(markdown = ''): string[] {
  const headings: string[] = [];
  const seen = new Set<string>();
  const re = /^(#{1,4})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const text = match[2]
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_~>#]/g, '')
      .trim();
    if (text.length < 3) continue;
    const normalized = text.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    headings.push(text);
  }
  return headings;
}

function fieldsForSection(sectionId: string, label: string): ReportOutputFieldContract[] {
  return DEFAULT_FIELD_SUFFIXES.map((field) => ({
    path: canonicalSectionFieldPath(sectionId, field.key),
    label: `${label} ${field.label}`,
    type: field.type,
    required: field.required,
    repeatable: field.repeatable,
    sectionId,
  }));
}

export function contractFromStructureTemplate(
  row: ReportStructureTemplateLike | null | undefined,
  opts: { reportType?: string | null; tier?: string | null; category?: string | null } = {},
): ReportOutputContract {
  const headings = extractStructureHeadings(row?.parsed_content || '');
  const labels = headings.length ? headings : ['Executive Summary', 'Property Snapshot', 'Financial Analysis', 'Risk & Recommendations'];
  const used = new Map<string, number>();
  const sections = labels.map((label, index) => {
    const base = slugifySectionId(label, `section_${index + 1}`);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const id = count ? `${base}_${count + 1}` : base;
    return {
      id,
      label,
      order: index,
      required: true,
      source: row?.id ? 'report_structure_templates' as const : 'fallback' as const,
      structureTemplateId: row?.id ?? undefined,
      fields: fieldsForSection(id, label),
    };
  });
  return {
    reportType: opts.reportType ?? null,
    tier: opts.tier ?? row?.report_tier ?? null,
    category: opts.category ?? row?.report_category ?? null,
    structureTemplateId: row?.id ?? null,
    structureTemplateName: row?.name ?? null,
    version: 1,
    sections,
  };
}

/**
 * What a report's tier is called in `report_structure_templates`.
 *
 * The generator writes `briefing`; the guide for it is filed under `executive`
 * ("Executive Briefing Structure v1"). One name for one thing was not on
 * offer — both are in production data — so the mapping is stated here rather
 * than left to a lookup that silently misses.
 */
const STRUCTURE_TIER_ALIASES: Readonly<Record<string, string>> = {
  briefing: 'executive',
};

export function structureTierFor(tier?: string | null): string | null {
  const key = String(tier ?? '').trim().toLowerCase();
  if (!key) return null;
  return STRUCTURE_TIER_ALIASES[key] ?? key;
}

/**
 * The configured structure guide for a report, or `null` when there is none.
 *
 * ## Why the last resort is `null` and not "the first one"
 *
 * This used to end `?? active[0]`, which reads as a kind fallback and is not
 * one. The guide's headings are what `chunkReportContent` keys the report's
 * sections by, so handing back an unrelated guide does not degrade the result —
 * it silently keys a Compass report's sections against the Snapshot contract,
 * and every `sections.<id>` binding resolves to the empty string with nothing
 * anywhere reporting a mismatch.
 *
 * Measured 2026-08-16, the four active `ai_structure` guides are
 * `(compass, investment)`, `(executive, investment)`, `(snapshot, investment)`
 * and `(compass, suburb)` — and **no** production report matched any of them,
 * because the caller passed the report's *format* as the category
 * (`investment_compass`, or `address` after the `report_type` defect above it).
 * So every investment report in the database took the `active[0]` branch and
 * was chunked against whichever guide the database happened to return first.
 *
 * `strategic` and `financial` have no guide at all. `null` is the honest answer
 * for them, and `chunkReportContent` already falls back to the report's own
 * headings when it is given none — which is a real degradation with a real
 * cause, rather than a wrong contract that looks like a right one.
 */
export function selectStructureTemplate(
  rows: ReportStructureTemplateLike[] = [],
  opts: { tier?: string | null; category?: string | null } = {},
): ReportStructureTemplateLike | null {
  const active = [...rows].sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0));
  const tier = structureTierFor(opts.tier);
  const category = opts.category || null;
  return active.find((t) => structureTierFor(t.report_tier) === tier && t.report_category === category)
    ?? active.find((t) => structureTierFor(t.report_tier) === tier && !t.report_category)
    ?? active.find((t) => !t.report_tier && t.report_category === category)
    ?? active.find((t) => !t.report_tier && !t.report_category)
    ?? null;
}

function getValueAtPath(data: any, path: string): unknown {
  if (!path) return undefined;
  const clean = path.replace(/^data\./, '');
  return clean.split('.').reduce((cur, part) => (cur == null ? undefined : cur[part]), data);
}

function bindingExpressionsFromText(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const out: string[] = [];
  value.replace(/\{\{\s*([^}|=][^}|]*?)(?:\|[^}]*)?\s*\}\}/g, (_m, expr) => {
    const path = String(expr || '').trim();
    if (path) out.push(path);
    return _m;
  });
  return out;
}

function collectOverlayBindings(overlay: Overlay): string[] {
  const o: any = overlay;
  const values = [o.content, o.src, o.fill, o.stroke, o.color, o.data, o.fontFamily, o.headerBg, o.rowBg];
  return values.flatMap(bindingExpressionsFromText);
}

function collectBlockBindings(block: Block): string[] {
  const b: any = block;
  const props = b.props && typeof b.props === 'object' ? Object.values(b.props) : [];
  return [
    ...bindingExpressionsFromText(b.conditional),
    ...bindingExpressionsFromText(b.repeat?.path),
    ...props.flatMap(bindingExpressionsFromText),
  ];
}

function anchorKey(anchor: ReportAnchor): string {
  return anchor.fieldPath || anchor.bindingPath || anchor.sectionId || anchor.id;
}

function targetPath(target: CascadeTarget): string | undefined {
  return target.fieldPath || target.anchor.fieldPath || target.anchor.bindingPath;
}

function templateAnchorFallbackContract(template: ReportTemplate): ReportOutputContract {
  const sections = new Map<string, ReportOutputSectionContract>();
  for (const page of template.pages) {
    for (const block of page.blocks) {
      for (const anchor of ((block as any).anchors ?? []) as ReportAnchor[]) {
        const sectionId = anchor.sectionId || (anchor.fieldPath ? anchor.fieldPath.split('.')[1] : null);
        if (!sectionId || sections.has(sectionId)) continue;
        sections.set(sectionId, {
          id: sectionId,
          label: anchor.label || sectionId.replace(/_/g, ' '),
          order: sections.size,
          required: !!anchor.required,
          source: 'template_anchors',
          structureTemplateId: anchor.structureTemplateId,
          fields: anchor.fieldPath ? [{
            path: anchor.fieldPath,
            label: anchor.label || anchor.fieldPath,
            type: 'unknown',
            required: !!anchor.required,
            sectionId,
          }] : [],
        });
      }
    }
  }
  return { version: 1, sections: Array.from(sections.values()) };
}

export function buildCascadeMap(
  rawTemplate: ReportTemplate | unknown,
  contract?: ReportOutputContract | null,
  opts: { data?: Record<string, any>; templateId?: string | null } = {},
): CascadeMap {
  const template = parseTemplate(rawTemplate);
  const effectiveContract = contract?.sections?.length ? contract : templateAnchorFallbackContract(template);
  const data = opts.data ?? {};
  const issues: CascadeIssue[] = [];
  const allTargets: CascadeTarget[] = [];
  const allKnownFieldPaths = new Set(effectiveContract.sections.flatMap((s) => s.fields.map((f) => f.path)));
  const allKnownSectionIds = new Set(effectiveContract.sections.map((s) => s.id));
  const anchorKeyCounts = new Map<string, CascadeTarget[]>();
  const bindingPaths = new Set<string>();

  template.pages.forEach((page, pageIndex) => {
    const pageVisible = evalConditional(page.conditional, { data, tokens: template.tokens });
    page.blocks.forEach((block) => {
      const blockVisible = pageVisible && !block.hidden && evalConditional(block.conditional, { data, tokens: template.tokens });
      collectBlockBindings(block).forEach((p) => bindingPaths.add(p));
      const blockAnchors = ((block as any).anchors ?? []) as ReportAnchor[];
      for (const anchor of blockAnchors) {
        const target: CascadeTarget = {
          pageId: page.id,
          pageName: page.name,
          pageIndex,
          blockId: block.id,
          blockName: block.name,
          blockType: block.type,
          anchorId: anchor.id,
          anchor,
          fieldPath: anchor.fieldPath,
          bindingExpression: anchor.bindingPath || anchor.fieldPath,
        };
        allTargets.push(target);
        const key = anchorKey(anchor);
        anchorKeyCounts.set(key, [...(anchorKeyCounts.get(key) ?? []), target]);
        if (!blockVisible) issues.push({ severity: 'warning', code: 'conditional_anchor_hidden', message: `Anchor “${anchor.label || anchor.id}” is currently hidden by page/block conditions.`, target });
      }

      block.overlays.forEach((overlay) => {
        collectOverlayBindings(overlay).forEach((p) => bindingPaths.add(p));
        const overlayVisible = blockVisible && !overlay.hidden && evalConditional(overlay.conditional, { data, tokens: template.tokens });
        const overlayAnchors = ((overlay as any).anchors ?? []) as ReportAnchor[];
        for (const anchor of overlayAnchors) {
          const bindings = collectOverlayBindings(overlay);
          const target: CascadeTarget = {
            pageId: page.id,
            pageName: page.name,
            pageIndex,
            blockId: block.id,
            blockName: block.name,
            blockType: block.type,
            overlayId: overlay.id,
            overlayType: overlay.type,
            anchorId: anchor.id,
            anchor,
            fieldPath: anchor.fieldPath,
            bindingExpression: anchor.bindingPath || anchor.fieldPath || bindings[0],
          };
          allTargets.push(target);
          const key = anchorKey(anchor);
          anchorKeyCounts.set(key, [...(anchorKeyCounts.get(key) ?? []), target]);
          if (!overlayVisible) issues.push({ severity: 'warning', code: 'conditional_anchor_hidden', message: `Anchor “${anchor.label || anchor.id}” is currently hidden by page/block/overlay conditions.`, target });
          if (anchor.kind === 'field' && !target.bindingExpression) {
            issues.push({ severity: 'warning', code: 'anchor_without_binding', message: `Field anchor “${anchor.label || anchor.id}” has no binding path or bound overlay value.`, target });
          }
        }
      });
    });
  });

  for (const [key, targets] of anchorKeyCounts.entries()) {
    if (targets.length > 1) {
      targets.forEach((target) => issues.push({ severity: 'warning', code: 'duplicate_anchor', message: `Anchor target “${key}” is mapped ${targets.length} times.`, target }));
    }
  }

  for (const target of allTargets) {
    const path = targetPath(target);
    if (target.anchor.sectionId && !allKnownSectionIds.has(target.anchor.sectionId)) {
      issues.push({ severity: 'warning', code: 'binding_path_not_in_structure', message: `Anchor section “${target.anchor.sectionId}” is not in the selected report structure.`, target, sectionId: target.anchor.sectionId });
    }
    if (path && allKnownFieldPaths.size && !allKnownFieldPaths.has(path)) {
      issues.push({ severity: 'warning', code: 'binding_path_not_in_structure', message: `Anchor field “${path}” is not in the selected report structure contract.`, target, fieldPath: path });
    }
  }

  for (const path of bindingPaths) {
    if (/^(pageNumber|pageCount|__tocEntries)\b/.test(path)) continue;
    if (allKnownFieldPaths.size && path.startsWith('sections.') && !allKnownFieldPaths.has(path)) {
      issues.push({ severity: 'info', code: 'binding_path_not_in_structure', message: `Binding “${path}” is not declared in the selected structure contract.`, fieldPath: path });
    }
  }

  const sections = effectiveContract.sections.map((section) => {
    const targets = allTargets.filter((target) => target.anchor.sectionId === section.id || targetPath(target)?.startsWith(`sections.${section.id}.`));
    const mappedFieldCount = section.fields.filter((field) => targets.some((target) => targetPath(target) === field.path)).length;
    const status: CascadeSectionStatus['status'] = targets.length === 0
      ? 'missing_anchor'
      : mappedFieldCount > 0 && mappedFieldCount < section.fields.filter((f) => f.required).length
        ? 'partially_mapped'
        : 'mapped';
    if (section.required && targets.length === 0) {
      issues.push({ severity: 'error', code: 'missing_required_anchor', message: `Required report section “${section.label}” has no PDF anchor.`, sectionId: section.id });
    }
    for (const field of section.fields) {
      const hasGeneratedValue = getValueAtPath(data, field.path) != null;
      const hasTarget = targets.some((target) => targetPath(target) === field.path);
      if (hasGeneratedValue && !hasTarget) {
        issues.push({ severity: 'info', code: 'generated_output_unused', message: `Generated output “${field.label}” is not mapped to the PDF design.`, sectionId: section.id, fieldPath: field.path });
      }
    }
    return { sectionId: section.id, label: section.label, required: section.required, status, fields: section.fields, targets };
  });

  const unmappedTargets = allTargets.filter((target) => {
    const sid = target.anchor.sectionId;
    const path = targetPath(target);
    return (sid && !allKnownSectionIds.has(sid)) || (path && allKnownFieldPaths.size && !allKnownFieldPaths.has(path));
  });
  const pages = template.pages.map((page, index) => ({
    id: page.id,
    name: page.name,
    index,
    targetCount: allTargets.filter((target) => target.pageId === page.id).length,
  }));
  const mappedSections = sections.filter((s) => s.status === 'mapped' || s.status === 'partially_mapped').length;
  const requiredSections = sections.filter((s) => s.required).length;
  const mappedRequiredSections = sections.filter((s) => s.required && (s.status === 'mapped' || s.status === 'partially_mapped')).length;

  return {
    templateId: opts.templateId ?? null,
    structureTemplateId: effectiveContract.structureTemplateId ?? null,
    reportType: effectiveContract.reportType ?? null,
    tier: effectiveContract.tier ?? null,
    pages,
    sections,
    unmappedTargets,
    issues,
    stats: {
      requiredSections,
      mappedRequiredSections,
      totalSections: sections.length,
      mappedSections,
      totalAnchors: allTargets.length,
      issueCount: issues.length,
      errorCount: issues.filter((i) => i.severity === 'error').length,
      warningCount: issues.filter((i) => i.severity === 'warning').length,
    },
  };
}

/**
 * Placeholder `sections.*` data for the editor: lets `{{sections.<id>.*}}`
 * bindings preview with readable copy before a real report is loaded. At
 * production render time the adapter binding context supplies the real
 * chunked report content (`reportSections.ts`) under the same ids.
 */
export function buildSampleSectionsData(
  contract: ReportOutputContract | null | undefined,
): Record<string, { title: string; body: string; highlights: string[] }> {
  const sections: Record<string, { title: string; body: string; highlights: string[] }> = {};
  for (const section of contract?.sections ?? []) {
    sections[section.id] = {
      title: section.label,
      body: `Sample content for “${section.label}”. When a real report is rendered, the generated ${section.label.toLowerCase()} copy from the report structure lands here.`,
      highlights: [
        `${section.label} — key point one`,
        `${section.label} — key point two`,
      ],
    };
  }
  return sections;
}

/**
 * Merge placeholder section data into editor sample data without overriding
 * anything the user typed into the Data tab (existing `sections` keys win).
 */
export function withSampleSectionData(
  data: Record<string, any>,
  contract: ReportOutputContract | null | undefined,
): Record<string, any> {
  const sample = buildSampleSectionsData(contract);
  if (!Object.keys(sample).length) return data;
  const existing = data?.sections && typeof data.sections === 'object' ? data.sections : {};
  return { ...data, sections: { ...sample, ...existing } };
}

export function makeSectionAnchor(section: ReportOutputSectionContract): ReportAnchor {
  return {
    id: `anchor_${section.id}`,
    kind: 'section',
    sectionId: section.id,
    label: section.label,
    required: section.required,
    structureTemplateId: section.structureTemplateId,
    renderMode: 'replace',
    visibility: 'designer',
    qaStatus: 'unreviewed',
  };
}

export function makeFieldAnchor(field: ReportOutputFieldContract): ReportAnchor {
  return {
    id: `anchor_${field.path.replace(/[^a-zA-Z0-9_-]+/g, '_')}`,
    kind: field.repeatable ? 'repeat' : 'field',
    sectionId: field.sectionId,
    fieldPath: field.path,
    bindingPath: field.path,
    label: field.label,
    required: field.required,
    renderMode: field.repeatable ? 'repeat' : 'replace',
    visibility: 'designer',
    qaStatus: 'unreviewed',
  };
}

export type CascadeQaStatus = NonNullable<ReportAnchor['qaStatus']>;

export interface CascadeQaPatchFilter {
  anchorIds?: string[];
  sectionIds?: string[];
  fieldPaths?: string[];
  currentStatuses?: CascadeQaStatus[];
  requiredOnly?: boolean;
}

export interface CascadeQaPatchInput {
  qaStatus: CascadeQaStatus;
  qaOwner?: string;
  qaNote?: string;
  qaReviewedAt?: string;
}

export interface CascadeQaPatchResult {
  next: ReportTemplate;
  updated: number;
}

function anchorMatchesQaPatchFilter(anchor: ReportAnchor, filter: CascadeQaPatchFilter): boolean {
  if (filter.anchorIds?.length && !filter.anchorIds.includes(anchor.id)) return false;
  if (filter.sectionIds?.length && (!anchor.sectionId || !filter.sectionIds.includes(anchor.sectionId))) return false;
  if (filter.fieldPaths?.length) {
    const paths = [anchor.fieldPath, anchor.bindingPath].filter(Boolean) as string[];
    if (!paths.some((path) => filter.fieldPaths!.includes(path))) return false;
  }
  if (filter.currentStatuses?.length) {
    const current = anchor.qaStatus ?? 'unreviewed';
    if (!filter.currentStatuses.includes(current)) return false;
  }
  if (filter.requiredOnly && !anchor.required) return false;
  return true;
}

function patchAnchorQa(anchor: ReportAnchor, patch: CascadeQaPatchInput): ReportAnchor {
  return {
    ...anchor,
    qaStatus: patch.qaStatus,
    ...(patch.qaOwner !== undefined ? { qaOwner: patch.qaOwner.trim() || undefined } : {}),
    ...(patch.qaNote !== undefined ? { qaNote: patch.qaNote.trim() || undefined } : {}),
    qaReviewedAt: patch.qaReviewedAt ?? new Date().toISOString(),
  };
}

export function patchCascadeAnchorsQaStatus(
  templateInput: ReportTemplate,
  patch: CascadeQaPatchInput,
  filter: CascadeQaPatchFilter = {},
): CascadeQaPatchResult {
  let updated = 0;
  const template = parseTemplate(templateInput);
  const patchAnchors = (anchors: ReportAnchor[] | undefined): ReportAnchor[] | undefined => {
    if (!Array.isArray(anchors) || anchors.length === 0) return anchors;
    let changed = false;
    const nextAnchors = anchors.map((anchor) => {
      if (!anchorMatchesQaPatchFilter(anchor, filter)) return anchor;
      updated += 1;
      changed = true;
      return patchAnchorQa(anchor, patch);
    });
    return changed ? nextAnchors : anchors;
  };

  const next: ReportTemplate = {
    ...template,
    pages: template.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((block) => {
        const blockAnchors = patchAnchors((block as any).anchors);
        const overlays = block.overlays.map((overlay) => {
          const overlayAnchors = patchAnchors((overlay as any).anchors);
          return overlayAnchors === (overlay as any).anchors ? overlay : ({ ...overlay, anchors: overlayAnchors } as Overlay);
        });
        return blockAnchors === (block as any).anchors && overlays.every((overlay, index) => overlay === block.overlays[index])
          ? block
          : ({ ...block, anchors: blockAnchors, overlays } as Block);
      }),
    })),
  };
  return { next, updated };
}

export interface CascadeAnchorSuggestion {
  pageId: string;
  pageName: string;
  pageIndex: number;
  blockId: string;
  blockName?: string;
  blockType?: string;
  overlayId?: string;
  overlayType?: string;
  fieldPath: string;
  sectionId: string;
  label: string;
  confidence: number;
  reason: 'exact_binding_match' | 'repeat_path_match' | 'block_prop_match';
  duplicateBindingCount: number;
  anchor: ReportAnchor;
}

interface CascadeAnchorSuggestionCandidate extends Omit<CascadeAnchorSuggestion, 'duplicateBindingCount'> {}

function hasAnchorForPath(existing: ReportAnchor[] | undefined, path: string): boolean {
  return Array.isArray(existing) && existing.some((anchor) => (anchor.fieldPath || anchor.bindingPath) === path);
}

function suggestionForTarget(
  params: {
    page: ReportTemplate['pages'][number];
    pageIndex: number;
    block: Block;
    overlay?: Overlay;
    field: ReportOutputFieldContract;
    reason: CascadeAnchorSuggestion['reason'];
  },
): CascadeAnchorSuggestionCandidate {
  const anchor = makeFieldAnchor(params.field);
  return {
    pageId: params.page.id,
    pageName: params.page.name,
    pageIndex: params.pageIndex,
    blockId: params.block.id,
    blockName: params.block.name,
    blockType: params.block.type,
    overlayId: params.overlay?.id,
    overlayType: params.overlay?.type,
    fieldPath: params.field.path,
    sectionId: params.field.sectionId,
    label: params.field.label,
    confidence: params.overlay ? 0.98 : params.reason === 'repeat_path_match' ? 0.95 : 0.9,
    reason: params.reason,
    anchor,
  };
}

function candidateRank(candidate: CascadeAnchorSuggestionCandidate): number {
  const reasonScore = candidate.reason === 'exact_binding_match' ? 100 : candidate.reason === 'repeat_path_match' ? 90 : 80;
  const targetScore = candidate.overlayId ? 10 : 0;
  return reasonScore + targetScore + candidate.confidence;
}

export function buildCascadeAnchorSuggestions(
  rawTemplate: ReportTemplate | unknown,
  contract?: ReportOutputContract | null,
  opts: { includeDuplicates?: boolean } = {},
): CascadeAnchorSuggestion[] {
  const template = parseTemplate(rawTemplate);
  const effectiveContract = contract?.sections?.length ? contract : templateAnchorFallbackContract(template);
  const fieldsByPath = new Map(effectiveContract.sections.flatMap((section) => section.fields.map((field) => [field.path, field] as const)));
  if (!fieldsByPath.size) return [];

  const anchoredPaths = new Set<string>();
  template.pages.forEach((page) => {
    page.blocks.forEach((block) => {
      for (const anchor of ((block as any).anchors ?? []) as ReportAnchor[]) {
        const path = anchor.fieldPath || anchor.bindingPath;
        if (path) anchoredPaths.add(path);
      }
      block.overlays.forEach((overlay) => {
        for (const anchor of ((overlay as any).anchors ?? []) as ReportAnchor[]) {
          const path = anchor.fieldPath || anchor.bindingPath;
          if (path) anchoredPaths.add(path);
        }
      });
    });
  });

  const candidates: CascadeAnchorSuggestionCandidate[] = [];
  template.pages.forEach((page, pageIndex) => {
    page.blocks.forEach((block) => {
      const blockAnchors = ((block as any).anchors ?? []) as ReportAnchor[];
      const blockBindings = collectBlockBindings(block);
      const repeatPath = (block as any).repeat?.path;
      for (const path of Array.from(new Set(blockBindings))) {
        const field = fieldsByPath.get(path);
        if (!field || (!opts.includeDuplicates && anchoredPaths.has(path)) || hasAnchorForPath(blockAnchors, path)) continue;
        candidates.push(suggestionForTarget({
          page,
          pageIndex,
          block,
          field,
          reason: path === repeatPath ? 'repeat_path_match' : 'block_prop_match',
        }));
      }

      block.overlays.forEach((overlay) => {
        const overlayAnchors = ((overlay as any).anchors ?? []) as ReportAnchor[];
        for (const path of Array.from(new Set(collectOverlayBindings(overlay)))) {
          const field = fieldsByPath.get(path);
          if (!field || (!opts.includeDuplicates && anchoredPaths.has(path)) || hasAnchorForPath(overlayAnchors, path)) continue;
          candidates.push(suggestionForTarget({ page, pageIndex, block, overlay, field, reason: 'exact_binding_match' }));
        }
      });
    });
  });

  const duplicateCounts = candidates.reduce((acc, candidate) => {
    acc.set(candidate.fieldPath, (acc.get(candidate.fieldPath) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());

  const selected = opts.includeDuplicates
    ? candidates
    : Array.from(candidates.reduce((acc, candidate) => {
      const existing = acc.get(candidate.fieldPath);
      if (!existing || candidateRank(candidate) > candidateRank(existing)) acc.set(candidate.fieldPath, candidate);
      return acc;
    }, new Map<string, CascadeAnchorSuggestionCandidate>()).values());

  return selected
    .map((candidate) => ({ ...candidate, duplicateBindingCount: duplicateCounts.get(candidate.fieldPath) ?? 1 }))
    .sort((a, b) => a.pageIndex - b.pageIndex || a.blockId.localeCompare(b.blockId) || (a.overlayId || '').localeCompare(b.overlayId || '') || a.fieldPath.localeCompare(b.fieldPath));
}

export interface CascadeActivationReadinessItem {
  code: CascadeIssue['code'] | 'auto_map_available' | 'qa_approval_required';
  message: string;
  sectionId?: string;
  fieldPath?: string;
  severity: 'info' | 'warning' | 'error';
}

export interface CascadeActivationReadiness {
  status: 'ready' | 'blocked';
  requiredSections: number;
  mappedRequiredSections: number;
  totalAnchors: number;
  blockerCount: number;
  warningCount: number;
  autoMapSuggestionCount: number;
  qaApprovedRequiredSections: number;
  qaApprovalRequiredCount: number;
  blockers: CascadeActivationReadinessItem[];
  warnings: CascadeActivationReadinessItem[];
  nextActions: string[];
}

export function buildCascadeActivationReadiness(
  cascade: CascadeMap,
  suggestions: CascadeAnchorSuggestion[] = [],
  opts: { requireQaApproved?: boolean } = {},
): CascadeActivationReadiness {
  const blockers: CascadeActivationReadinessItem[] = cascade.issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => ({
      code: issue.code,
      message: issue.message,
      sectionId: issue.sectionId ?? issue.target?.anchor.sectionId,
      fieldPath: issue.fieldPath ?? issue.target?.fieldPath ?? issue.target?.anchor.fieldPath,
      severity: 'error' as const,
    }));
  const warnings: CascadeActivationReadinessItem[] = cascade.issues
    .filter((issue) => issue.severity === 'warning')
    .map((issue) => ({
      code: issue.code,
      message: issue.message,
      sectionId: issue.sectionId ?? issue.target?.anchor.sectionId,
      fieldPath: issue.fieldPath ?? issue.target?.fieldPath ?? issue.target?.anchor.fieldPath,
      severity: 'warning' as const,
    }));
  if (suggestions.length > 0) {
    warnings.unshift({
      code: 'auto_map_available',
      message: `${suggestions.length} unanchored report binding${suggestions.length === 1 ? '' : 's'} can be auto-mapped in the Cascade tab.`,
      severity: 'warning',
    });
  }

  const qaApprovedRequiredSections = cascade.sections.filter((section) => section.required && section.targets.some((target) => target.anchor.qaStatus === 'approved')).length;
  const qaApprovalBlockers = opts.requireQaApproved
    ? cascade.sections
      .filter((section) => section.required && section.targets.length > 0 && !section.targets.some((target) => target.anchor.qaStatus === 'approved'))
      .map((section) => ({
        code: 'qa_approval_required' as const,
        message: `Required report section “${section.label}” has mapped anchors but no QA-approved anchor.`,
        sectionId: section.sectionId,
        severity: 'error' as const,
      }))
    : [];
  blockers.push(...qaApprovalBlockers);

  const nextActions: string[] = [];
  if (blockers.some((blocker) => blocker.code === 'missing_required_anchor')) nextActions.push('Map every required report-structure section before activation.');
  if (qaApprovalBlockers.length > 0) nextActions.push('QA-approve every required mapped section before activation.');
  if (suggestions.length > 0) nextActions.push('Review and apply Cascade auto-map suggestions for existing bindings.');
  if (warnings.some((warning) => warning.code === 'duplicate_anchor')) nextActions.push('Review duplicate anchors so generated output lands in intentional places.');
  if (nextActions.length === 0) nextActions.push(opts.requireQaApproved ? 'Cascade coverage and QA approvals are ready for activation.' : 'Cascade coverage is ready for activation.');

  return {
    status: blockers.length > 0 ? 'blocked' : 'ready',
    requiredSections: cascade.stats.requiredSections,
    mappedRequiredSections: cascade.stats.mappedRequiredSections,
    totalAnchors: cascade.stats.totalAnchors,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    autoMapSuggestionCount: suggestions.length,
    qaApprovedRequiredSections,
    qaApprovalRequiredCount: qaApprovalBlockers.length,
    blockers,
    warnings,
    nextActions,
  };
}

export interface CascadeDiagnosticsExport {
  generatedAt: string;
  templateId?: string | null;
  reportType?: string | null;
  tier?: string | null;
  structure: {
    templateId?: string | null;
    templateName?: string | null;
    version: number;
    sectionCount: number;
  };
  stats: CascadeMap['stats'];
  sections: Array<{
    sectionId: string;
    label: string;
    required: boolean;
    status: CascadeSectionStatus['status'];
    mappedTargetCount: number;
    fields: Array<{
      path: string;
      label: string;
      required: boolean;
      type: ReportOutputFieldContract['type'];
      mapped: boolean;
      targetCount: number;
    }>;
    targets: Array<{
      pageIndex: number;
      pageName: string;
      blockId: string;
      blockName?: string;
      blockType?: string;
      overlayId?: string;
      overlayType?: string;
      anchorId: string;
      fieldPath?: string;
      bindingExpression?: string;
      qaStatus?: ReportAnchor['qaStatus'];
      qaOwner?: string;
      qaNote?: string;
      qaReviewedAt?: string;
    }>;
  }>;
  issues: Array<{
    severity: CascadeIssue['severity'];
    code: CascadeIssue['code'];
    message: string;
    sectionId?: string;
    fieldPath?: string;
    pageIndex?: number;
    pageName?: string;
    blockId?: string;
    overlayId?: string;
  }>;
}

export function buildCascadeDiagnosticsExport(
  cascade: CascadeMap,
  contract: ReportOutputContract,
  opts: { generatedAt?: string } = {},
): CascadeDiagnosticsExport {
  return {
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    templateId: cascade.templateId,
    reportType: cascade.reportType,
    tier: cascade.tier,
    structure: {
      templateId: contract.structureTemplateId,
      templateName: contract.structureTemplateName,
      version: contract.version,
      sectionCount: contract.sections.length,
    },
    stats: cascade.stats,
    sections: cascade.sections.map((section) => ({
      sectionId: section.sectionId,
      label: section.label,
      required: section.required,
      status: section.status,
      mappedTargetCount: section.targets.length,
      fields: section.fields.map((field) => {
        const targetCount = section.targets.filter((target) => targetPath(target) === field.path).length;
        return {
          path: field.path,
          label: field.label,
          required: field.required,
          type: field.type,
          mapped: targetCount > 0,
          targetCount,
        };
      }),
      targets: section.targets.map((target) => ({
        pageIndex: target.pageIndex,
        pageName: target.pageName,
        blockId: target.blockId,
        blockName: target.blockName,
        blockType: target.blockType,
        overlayId: target.overlayId,
        overlayType: target.overlayType,
        anchorId: target.anchorId,
        fieldPath: target.fieldPath || target.anchor.fieldPath,
        bindingExpression: target.bindingExpression,
        qaStatus: target.anchor.qaStatus,
        qaOwner: target.anchor.qaOwner,
        qaNote: target.anchor.qaNote,
        qaReviewedAt: target.anchor.qaReviewedAt,
      })),
    })),
    issues: cascade.issues.map((issue) => ({
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      sectionId: issue.sectionId ?? issue.target?.anchor.sectionId,
      fieldPath: issue.fieldPath ?? issue.target?.fieldPath ?? issue.target?.anchor.fieldPath,
      pageIndex: issue.target?.pageIndex,
      pageName: issue.target?.pageName,
      blockId: issue.target?.blockId,
      overlayId: issue.target?.overlayId,
    })),
  };
}

function csvCell(value: unknown): string {
  const raw = String(value ?? '');
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function cascadeDiagnosticsToCsv(diag: CascadeDiagnosticsExport): string {
  const rows: unknown[][] = [[
    'section_id',
    'section_label',
    'section_status',
    'section_required',
    'field_path',
    'field_label',
    'field_type',
    'field_required',
    'field_mapped',
    'target_count',
    'target_pages',
    'target_blocks',
    'target_overlays',
    'qa_status',
    'qa_owner',
    'qa_note',
  ]];
  for (const section of diag.sections) {
    if (!section.fields.length) {
      rows.push([section.sectionId, section.label, section.status, section.required, '', '', '', '', section.mappedTargetCount > 0, section.mappedTargetCount, '', '', '', '', '', '']);
      continue;
    }
    for (const field of section.fields) {
      const fieldTargets = section.targets.filter((target) => target.fieldPath === field.path || target.bindingExpression === field.path);
      rows.push([
        section.sectionId,
        section.label,
        section.status,
        section.required,
        field.path,
        field.label,
        field.type,
        field.required,
        field.mapped,
        field.targetCount,
        fieldTargets.map((target) => `${target.pageIndex + 1}:${target.pageName}`).join('; '),
        fieldTargets.map((target) => target.blockId).join('; '),
        fieldTargets.map((target) => target.overlayId || '').filter(Boolean).join('; '),
        fieldTargets.map((target) => target.qaStatus || '').filter(Boolean).join('; '),
        fieldTargets.map((target) => target.qaOwner || '').filter(Boolean).join('; '),
        fieldTargets.map((target) => target.qaNote || '').filter(Boolean).join('; '),
      ]);
    }
  }
  rows.push([]);
  rows.push(['issues']);
  rows.push(['severity', 'code', 'message', 'section_id', 'field_path', 'page', 'block_id', 'overlay_id']);
  for (const issue of diag.issues) {
    rows.push([issue.severity, issue.code, issue.message, issue.sectionId, issue.fieldPath, issue.pageIndex != null ? issue.pageIndex + 1 : '', issue.blockId, issue.overlayId]);
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}
