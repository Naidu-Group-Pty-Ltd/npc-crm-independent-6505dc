/**
 * HTML renderer — turns a `ReportTemplate` JSON into a complete HTML document
 * sized for WeasyPrint print rendering. Mirrors `pdfRenderer.ts` (jsPDF) so
 * editors can choose either engine at production time.
 *
 * The same template + data + tokens MUST produce the same visual output across
 * renderers within the bounds of each engine's capabilities (jsPDF is pixel-
 * exact; HTML reflows). Both walk the same schema.
 */
import {
  type Block,
  type ReportTemplate,
  type Page,
  type Tokens,
  parseTemplate,
} from './templateSchema';
import { resolvePageOutputPolicy, resolvePageRenderPlan, shouldRenderPageBackgroundImage, shouldFallBackToNativeBlocks, pageContainedRegions } from './rendering/pdfImportPagePolicy';
import { shouldRenderBlock } from './renderVisibility';
import { applyNarrativePlan, planNarrative } from './narrativePlan';
import { closeDroppedBlocks } from './closeDroppedBlocks';
import { layoutFlowColumn } from './flowLayout';
import { flowFactsFor } from './flowFacts';
import {
  NARRATIVE_GEOMETRY_KEY, NARRATIVE_NOTES_KEY, resolveMarkdownBlockContent,
} from './blocks/markdownBlockContent';
import { sectionIndexFromBuckets } from '../../../supabase/functions/_shared/reports/markdownPaging.pure';
import { NARRATIVE_INDEX_KEY, type NarrativeIndex } from './narrativeIndex';
import {
  resolveRegionRenderPlanProjection, suppressedOverlayIdSet, buildFinalCropElementsHtml, pageCompositionDataAttrs,
} from './rendering/regionRenderPlanApply';
import {
  type ResolveContext,
  resolveBindable,
  resolveBindableColor,
  evalConditional,
} from './bindingResolver';
import { getHtmlBlockRenderer, renderUnsupportedHtml, type HtmlBlockContext } from './blocks/html';
import { renderOverlay } from './blocks/_shared.html';
import { pagesForDocument } from '../../../supabase/functions/_shared/reports/investment/tierPageSequence.pure';
import { tokensToCssVariables, tokensToFontFaceCss, tokenCssDeclaration } from './cssTokens';
import {
  substitutePrintFontFaces,
  substitutePrintTokenFonts,
} from '@/lib/reportDesign/printFontPolicy.pure';
import { toRendererHex } from './cssColor';
import { sortBlocksForPaint, sortOverlaysForPaint } from './paintOrder';
import { stableJson, templateMetaKey } from './previewCache';

export interface HtmlRenderOptions {
  data?: Record<string, any>;
  tokenOverrides?: Partial<Tokens>;
  /** Optional free-form CSS appended after the base/page styles. */
  customCss?: string;
  /** Document title (PDF metadata). */
  title?: string;
  /** Emit WeasyPrint PDF outline metadata for bookmarked blocks. Defaults to true. */
  includeBookmarks?: boolean;
  /**
   * Editor mode: wrap each block in a `data-block-id` element, tag pages
   * with `data-page-id`, and inject a small runtime that posts click
   * messages to the parent window and accepts selection highlighting.
   */
  editorMode?: boolean;
  /**
   * Optional per-page section cache for repeated document renders (rehaul
   * Phase 3). Pass a caller-owned Map that persists across calls: pages whose
   * content AND cross-page context (index, page count, page ids/names, TOC,
   * data, tokens/themes/slots) are unchanged reuse their rendered section
   * instead of re-rendering, so editing one page re-renders only that page.
   * The renderer prunes stale entries automatically.
   */
  pageCache?: Map<string, string>;
  /** Emit non-visual data-cascade-* attributes on anchored blocks/overlays. */
  cascadeMetadata?: boolean;
  /** Render visible designer proof tags near anchored blocks/overlays. */
  cascadeDebug?: boolean;
  /**
   * Render PDF-import reference underlays (`page.background.underlay`). The
   * editor canvas opts in so designers can align overlays against the source
   * raster; every preview/print/export path leaves this off — printing the
   * underlay would duplicate all source content behind the reconstruction.
   */
  showReferenceUnderlay?: boolean;
  /**
   * Editor opt-in: render the reconstructed native layers on a RASTER-ONLY
   * page (`outputStrategy: 'raster-only'`), which final output suppresses in
   * favour of the source raster. The editor canvas needs them — they are what
   * the person edits — and without this flag a raster-only page whose raster
   * URL is resolved at request time renders as nothing at all. Maps to the
   * page-policy option of the same name (`resolvePageRenderPlan`).
   */
  showReconstructedLayers?: boolean;
  /**
   * E7 (runtime-only): map an E6 final-crop region id → an ephemeral image src
   * (signed/object/data URL) to hydrate final source-crop elements at paint
   * time. Never persisted; when omitted, crops render as locked placeholders so
   * the quality capture can still detect a missing asset.
   */
  regionCropSrc?: (regionId: string) => string | null;
  /**
   * Where the typefaces come from.
   *
   * `'remote'` (the default) is the browser: a template's `tokens.fontFaces`
   * `cssUrl` is emitted as an `@import`, which is how a webfont has always
   * reached a preview.
   *
   * `'container'` is **every render bound for WeasyPrint**, and it is a
   * correctness requirement rather than a preference.
   * `render-template-pdf` asserts that the HTML can make no network request
   * before it invokes the engine, so one remote `@import` fails the entire
   * document — and all 500 seeded masters carry one. Under `'container'` the
   * stylesheet links are withheld and the families are resolved by fontconfig
   * inside the image, which is already how the ten legacy report formats set
   * type. Families the image does not install are substituted explicitly
   * first; see `printFontPolicy.pure.ts`.
   *
   * Callers do not choose this by hand: `compileTemplateHtmlForPdf` — the one
   * way to compile a template for the PDF renderer — sets it.
   */
  fontSource?: 'remote' | 'container';
}

export interface HtmlRenderResult {
  html: string;
  css: string;
}

/**
 * Merge token layers, and rewrite any face the render container cannot set.
 *
 * The substitution happens HERE rather than at the top of the render because
 * this is the one funnel every token layer passes through — the document's own
 * tokens, an active theme, caller overrides, and each page's theme delta. A
 * per-page theme naming Fraunces would otherwise reach the page untouched, and
 * a face the image lacks prints as the engine's default with no warning from
 * anything. See `printFontPolicy.pure.ts`.
 *
 * Applied in the preview too, deliberately: a preview that fetched Fraunces
 * from Google would show a document the printer cannot produce, and a preview
 * that disagrees with the print is worse than one that shows the substitute.
 */
function mergeTokens(base: Tokens, ...overrides: Array<Partial<Tokens> | undefined>): Tokens {
  const out: Tokens = {
    colors: { ...base.colors },
    fonts: { ...base.fonts },
    spacing: { ...base.spacing },
    radii: { ...(base as any).radii },
    shadows: { ...(base as any).shadows },
    gradients: { ...(base as any).gradients },
    typeScale: { ...(base as any).typeScale },
    fontFaces: (base as any).fontFaces,
    computed: (base as any).computed,
  } as Tokens;
  for (const o of overrides) {
    if (!o) continue;
    if (o.colors) out.colors = { ...out.colors, ...o.colors };
    if (o.fonts) out.fonts = { ...out.fonts, ...o.fonts };
    if (o.spacing) out.spacing = { ...out.spacing, ...o.spacing };
    if ((o as any).radii) (out as any).radii = { ...(out as any).radii, ...(o as any).radii };
    if ((o as any).shadows) (out as any).shadows = { ...(out as any).shadows, ...(o as any).shadows };
    if ((o as any).gradients) (out as any).gradients = { ...(out as any).gradients, ...(o as any).gradients };
    if ((o as any).typeScale) (out as any).typeScale = { ...(out as any).typeScale, ...(o as any).typeScale };
    if ((o as any).fontFaces?.length) {
      const existing = new Set(((out as any).fontFaces ?? []).map((face: any) => face.family));
      (out as any).fontFaces = [
        ...((out as any).fontFaces ?? []),
        ...((o as any).fontFaces ?? []).filter((face: any) => !existing.has(face.family)),
      ];
    }
  }
  out.fonts = substitutePrintTokenFonts(out.fonts as Record<string, unknown>) as Tokens['fonts'];
  (out as any).fontFaces = (out as any).fontFaces
    ? substitutePrintFontFaces((out as any).fontFaces)
    : (out as any).fontFaces;
  return out;
}

/** Phase 10 — emit only the *delta* CSS variables for a per-page theme override. */
function themeOverrideCss(pageIndex: number, base: Tokens, merged: Tokens): string {
  const diffs: string[] = [];
  const push = (prefix: string, baseMap: any, mergedMap: any, suffix = '') => {
    for (const [k, v] of Object.entries(mergedMap || {})) {
      if ((baseMap || {})[k] !== v) {
        const declaration = tokenCssDeclaration(prefix, k, v, suffix);
        if (declaration) diffs.push(declaration);
      }
    }
  };
  push('color', base.colors, merged.colors);
  push('font', base.fonts, merged.fonts);
  push('space', base.spacing, merged.spacing, 'px');
  push('radius', (base as any).radii, (merged as any).radii, 'px');
  push('shadow', (base as any).shadows, (merged as any).shadows);
  push('gradient', (base as any).gradients, (merged as any).gradients);
  push('text', (base as any).typeScale, (merged as any).typeScale, 'pt');
  if (!diffs.length) return '';
  return `.tpl-page-${pageIndex} {\n${diffs.join('\n')}\n}`;
}

function baseCss(): string {
  return `
*, *::before, *::after { box-sizing: border-box; }
/* A rendered document must be CLOSED OVER ITS ENVIRONMENT: the same template
   must paint identically in the editor iframe (whose host is dark-themed), in
   WeasyPrint, and in any PDF viewer. color-scheme pins the browser's default
   canvas to light — without it, Chrome gives an iframe inside a dark host a
   BLACK default canvas, which is exactly how "white" imported pages were
   rendering black. WeasyPrint ignores the property, so print is unaffected. */
html { color-scheme: only light; }
html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: var(--font-body, 'Helvetica', sans-serif); color: var(--color-text, #111); }
.tpl-page {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  page-break-after: always;
  break-after: page;
  /* A page is PAPER: white unless the template says otherwise, exactly as a
     PDF viewer treats a page. This is a stylesheet default, so a page that
     sets its own colour still wins — that lands as an inline style, which
     always beats this rule. Backgrounds are dropped by more than one template
     transformation (the CDIR round-trip is a documented one), and a page with
     no colour used to render TRANSPARENT, showing whatever the host painted
     behind it. Paper does not inherit its colour from the desk it lies on. */
  background-color: #ffffff;
}
.tpl-page:last-child { page-break-after: auto; break-after: auto; }
img { max-width: 100%; }
table { border-collapse: collapse; }
h1, h2, h3, h4 { font-family: var(--font-heading, var(--font-body, 'Helvetica', sans-serif)); }
.tpl-cascade-index th, .tpl-cascade-index td { border:0.5pt solid #cbd5e1; padding:4pt 5pt; vertical-align:top; overflow-wrap:anywhere; }
.tpl-cascade-index th { text-align:left; font-weight:700; }
.tpl-cascade-index tbody tr:nth-child(even) { background:#eef2f7; }
.tpl-cascade-index span { color:#64748b; font-size:6.5pt; }
.tpl-cascade-index code { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:6.8pt; }
`;
}

function escapeCssString(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}

interface PageRuleInfo {
  ruleName: string;       // unique @page name combining size + master + numbering tweaks
  className: string;      // matching .tpl-page-N class
}

function pageCss(
  pages: Page[],
  template: ReportTemplate,
  ctxBase: ResolveContext,
): { css: string; pageInfo: PageRuleInfo[] } {
  const masters = (template as any).pageMasters as Record<string, any> | undefined;
  const defaultMasterId = (template as any).defaultPageMasterId as string | undefined;
  const rules: string[] = [];
  const seen = new Set<string>();
  const pageInfo: PageRuleInfo[] = [];

  pages.forEach((p, i) => {
    const masterId = (p as any).pageMasterId || defaultMasterId;
    const master = masterId && masters ? masters[masterId] : null;
    const numbering = ((p as any).numbering ?? master?.numbering ?? {}) as any;
    const fmt = numbering.format || 'decimal';
    const suppressFirst = master?.suppressOnFirstPage && i === 0;
    const isHidden = (p as any).numbering?.hide;

    // Unique rule key so masters with different boxes get isolated @page rules.
    const key = `${p.size.width}x${p.size.height}|${masterId ?? ''}|${fmt}|${i}`;
    const ruleName = `pg${i}`;

    // Build margin-box content (skip on suppressed first page).
    const boxes = (!suppressFirst && master?.boxes) ? master.boxes : {};
    const styleFs = master?.style?.fontSize ? `font-size:${Number(master.style.fontSize)}pt;` : 'font-size:9pt;';
    const styleFf = master?.style?.fontFamily ? `font-family:${master.style.fontFamily};` : '';
    const styleColor = master?.style?.color ? `color:${resolveBindableColor(master.style.color, ctxBase, '#666')};` : 'color:#666;';
    const styleBorderColor = master?.style?.borderColor
      ? resolveBindableColor(master.style.borderColor, ctxBase, '#ddd') : '#ddd';

    const renderBox = (zone: string, raw: any): string => {
      if (!raw) return '';
      // Resolve bindings (pageNumber/pageCount already injected by caller).
      // Replace {{pageCounter}} with CSS content counter(page, fmt).
      let s = String(raw);
      const hasCounter = s.includes('{{pageCounter}}');
      // Resolve other bindings except pageCounter
      s = s.replace(/\{\{\s*pageCounter\s*\}\}/g, '__PAGECOUNTER__');
      const resolved = resolveBindable(s, ctxBase);
      // Split around the counter placeholder so we can interleave with counter().
      const parts = resolved.split('__PAGECOUNTER__');
      const counterStr = `" counter(page, ${fmt}) "`;
      const contentExpr = hasCounter
        ? '"' + parts.map(escapeCssString).join(counterStr) + '"'
        : `"${escapeCssString(resolved)}"`;
      const borderRule =
        (zone.startsWith('top') && master?.style?.borderBottom) ? `border-bottom:0.5pt solid ${styleBorderColor};padding-bottom:4pt;` :
        (zone.startsWith('bottom') && master?.style?.borderTop) ? `border-top:0.5pt solid ${styleBorderColor};padding-top:4pt;` : '';
      return `@${zone} { content: ${contentExpr}; ${styleFs}${styleFf}${styleColor}${borderRule} }`;
    };

    const margins = master?.margins ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const mb = isHidden ? {} : boxes;
    const marginBoxRules = [
      renderBox('top-left',     mb.topLeft),
      renderBox('top-center',   mb.topCenter),
      renderBox('top-right',    mb.topRight),
      renderBox('bottom-left',  mb.bottomLeft),
      renderBox('bottom-center',mb.bottomCenter),
      renderBox('bottom-right', mb.bottomRight),
    ].filter(Boolean).join(' ');

    const marginCss = master
      ? `margin: ${margins.top}pt ${margins.right}pt ${margins.bottom}pt ${margins.left}pt;`
      : `margin: 0;`;

    rules.push(
      `@page ${ruleName} { size: ${p.size.width}pt ${p.size.height}pt; ${marginCss} ${marginBoxRules} }`,
    );
    rules.push(`.tpl-page-${i} { page: ${ruleName}; width: ${p.size.width}pt; height: ${p.size.height}pt; }`);

    // Counter restart on this page if requested
    const numStart = (p as any).numbering?.startAt ?? master?.numbering?.startAt;
    const numRestart = (p as any).numbering?.restart;
    if ((i === 0 && numStart) || numRestart) {
      const start = Math.max(1, Number(numStart || 1)) - 1;
      rules.push(`.tpl-page-${i} { counter-reset: page ${start}; }`);
    }

    pageInfo.push({ ruleName, className: `tpl-page-${i}` });
    seen.add(key);
  });

  return { css: rules.join('\n'), pageInfo };
}

const SHADOW_PRESETS: Record<string, string> = {
  none: 'none',
  sm: '0 1pt 2pt rgba(15,23,42,0.08)',
  md: '0 3pt 8pt rgba(15,23,42,0.10)',
  lg: '0 8pt 20pt rgba(15,23,42,0.14)',
  xl: '0 16pt 40pt rgba(15,23,42,0.18)',
};


function decorationBackdrop(block: any, ctx: ResolveContext): string {
  const s = block.style;
  if (!s) return '';
  const hasDecor =
    s.backgroundColor || s.borderColor || s.borderWidth || s.borderRadius || (s.shadow && s.shadow !== 'none');
  if (!hasDecor) return '';
  const p = (block.props ?? {}) as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? 547);
  const h = Number(p.height ?? 100);
  const pt = Number(s.paddingTop ?? 0);
  const pr = Number(s.paddingRight ?? 0);
  const pb = Number(s.paddingBottom ?? 0);
  const pl = Number(s.paddingLeft ?? 0);
  const bg = s.backgroundColor ? resolveBindableColor(s.backgroundColor, ctx, 'transparent') : 'transparent';
  const borderCol = s.borderColor ? resolveBindableColor(s.borderColor, ctx, 'transparent') : 'transparent';
  const bw = Number(s.borderWidth ?? 0);
  const bs = String(s.borderStyle ?? 'solid');
  const radius = Number(s.borderRadius ?? 0);
  const shadow = SHADOW_PRESETS[String(s.shadow ?? 'none')] ?? 'none';
  return `<div aria-hidden="true" style="position:absolute;left:${x - pl}pt;top:${y - pt}pt;width:${w + pl + pr}pt;height:${h + pt + pb}pt;background:${bg};border:${bw}pt ${bs} ${borderCol};border-radius:${radius}pt;box-shadow:${shadow};pointer-events:none;"></div>`;
}

function resolveLinkHref(
  link: any,
  ctxBase: ResolveContext,
  pages: Page[],
): { href: string; target: string; title: string } | null {
  if (!link?.href) return null;
  const raw = resolveBindable(link.href, ctxBase).trim();
  if (!raw) return null;
  let href = raw;
  if (raw.startsWith('page:')) {
    const pid = raw.slice(5);
    const idx = pages.findIndex((p) => p.id === pid);
    href = idx >= 0 ? `#tpl-page-${idx}` : '#';
  } else if (raw.startsWith('anchor:')) {
    href = `#anc-${raw.slice(7).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  } else if (!/^(?:https?:|mailto:|tel:)/i.test(raw)) {
    // Do not pass renderer-capable schemes (for example file: or data:) to
    // WeasyPrint, and do not emit browser-executable javascript: links.
    return null;
  }
  const target = link.target ?? (href.startsWith('#') ? '_self' : '_blank');
  const title = link.title ? resolveBindable(link.title, ctxBase) : '';
  return { href, target, title };
}

function bookmarkAttrs(bm: any, ctxBase: ResolveContext): string {
  if (!bm?.name) return '';
  const anchorId = `anc-${String(bm.name).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const idAttr = `id="${escapeHtml(anchorId)}"`;
  if ((ctxBase as ResolveContext & { _includeBookmarks?: boolean })._includeBookmarks === false) return ` ${idAttr}`;
  const label = bm.label ? resolveBindable(bm.label, ctxBase) : bm.name;
  const level = Number(bm.level ?? 2);
  // WeasyPrint reads `bookmark-label` / `bookmark-level` for the PDF outline.
  const cssLabel = String(label).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]/g, ' ');
  const style = `bookmark-label:'${cssLabel}';bookmark-level:${level};`;
  return ` ${idAttr} style="${escapeHtml(style)}"`;
}


// Overlay/block stacking comes from the shared paintOrder module
// (sortOverlaysForPaint / sortBlocksForPaint imports) — never re-implement.

function cascadeAttrs(node: { anchors?: any[] }, ctxBase: ResolveContext): string {
  const anchors = Array.isArray(node?.anchors) ? node.anchors : [];
  if (!anchors.length || !((ctxBase as any)._cascadeMetadata || (ctxBase as any)._cascadeDebug || (ctxBase as any)._editorMode)) return '';
  const primary = anchors[0] ?? {};
  return [
    `data-cascade-anchor-id="${escapeHtml(String(primary.id || ''))}"`,
    primary.kind ? `data-cascade-kind="${escapeHtml(String(primary.kind))}"` : '',
    primary.sectionId ? `data-cascade-section-id="${escapeHtml(String(primary.sectionId))}"` : '',
    primary.fieldPath ? `data-cascade-field-path="${escapeHtml(String(primary.fieldPath))}"` : '',
    primary.bindingPath ? `data-cascade-binding-path="${escapeHtml(String(primary.bindingPath))}"` : '',
    primary.qaStatus ? `data-cascade-qa-status="${escapeHtml(String(primary.qaStatus))}"` : '',
    primary.qaOwner ? `data-cascade-qa-owner="${escapeHtml(String(primary.qaOwner))}"` : '',
    `data-cascade-anchor-count="${anchors.length}"`,
  ].filter(Boolean).join(' ');
}

function cascadeDebugBadge(node: { anchors?: any[] }, ctxBase: ResolveContext): string {
  if (!(ctxBase as any)._cascadeDebug) return '';
  const anchors = Array.isArray(node?.anchors) ? node.anchors : [];
  if (!anchors.length) return '';
  const label = anchors[0]?.label || anchors[0]?.fieldPath || anchors[0]?.sectionId || anchors[0]?.id || 'cascade anchor';
  return `<span style="position:absolute;left:0;top:-12pt;z-index:999999;background:#0f172a;color:#f8fafc;border:0.5pt solid #fbbf24;border-radius:3pt;padding:1pt 3pt;font:7pt ui-monospace,monospace;line-height:1;white-space:nowrap;max-width:260pt;overflow:hidden;text-overflow:ellipsis;">§ ${escapeHtml(String(label))}</span>`;
}

function renderBlockOnce(block: any, ctxBase: ResolveContext, blockCtx: HtmlBlockContext, pages: Page[], editorMode = false): string {
  const renderer = getHtmlBlockRenderer(block.type);
  const body = renderer ? renderer(block, blockCtx) : renderUnsupportedHtml(block, blockCtx);
  // E7: a native overlay the E6 render plan SUPPRESSES (hidden behind a final
  // source crop) must not paint — otherwise the crop AND the native text render.
  const suppressedOverlays = (ctxBase as { _pdfSuppressedOverlayIds?: Set<string> })._pdfSuppressedOverlayIds;
  const overlays = sortOverlaysForPaint((block.overlays ?? []).filter((o: any) => !o?.hidden && !(suppressedOverlays && o?.id && suppressedOverlays.has(String(o.id))))).map((o: any) => renderOverlay(o, ctxBase)).join('');
  const backdrop = decorationBackdrop(block, ctxBase);
  const s = block.style ?? {};
  const opacity = s.opacity != null ? Number(s.opacity) : 1;
  const rotation = s.rotation != null ? Number(s.rotation) : 0;
  const z = s.zIndex != null ? `z-index:${Number(s.zIndex)};` : '';

  // Phase 8 — bookmark + link wrapping
  const bmAttrs = bookmarkAttrs(block.bookmark, ctxBase);
  const link = resolveLinkHref(block.link, ctxBase, pages);
  const wrap = (inner: string) => {
    if (link) {
      const titleAttr = link.title ? ` title="${escapeHtml(link.title)}"` : '';
      return `<a href="${escapeHtml(link.href)}" target="${escapeHtml(link.target)}"${titleAttr} style="text-decoration:none;color:inherit;display:contents;">${inner}</a>`;
    }
    return inner;
  };

  let content: string;
  if (opacity === 1 && rotation === 0 && !z) {
    content = `${backdrop}${body}${overlays}`;
  } else {
    const p = (block.props ?? {}) as Record<string, unknown>;
    const ox = Number(p.x ?? 0);
    const oy = Number(p.y ?? 0);
    content = `<div style="position:absolute;left:0;top:0;opacity:${opacity};transform:rotate(${rotation}deg);transform-origin:${ox}pt ${oy}pt;${z}">${backdrop}${body}${overlays}</div>`;
  }

  // If we have a bookmark, attach the id to a wrapping span so anchor jumps work
  if (bmAttrs) {
    content = `<span${bmAttrs}>${content}</span>`;
  }
  const cAttrs = cascadeAttrs(block, ctxBase);
  const cBadge = cascadeDebugBadge(block, ctxBase);
  if (cAttrs || cBadge) {
    content = `<span ${cAttrs} style="display:contents">${cBadge}${content}</span>`;
  }
  let out = wrap(content);
  if (editorMode && block.id) {
    out = `<div data-block-id="${escapeHtml(String(block.id))}" data-block-type="${escapeHtml(String(block.type ?? ''))}" style="display:contents">${out}</div>`;
  }
  return out;
}


function renderBlockWithRepeat(block: any, ctxBase: ResolveContext, blockCtx: HtmlBlockContext, pages: Page[], editorMode = false): string[] {
  const r = block.repeat;
  if (!r || !r.path) return [renderBlockOnce(block, ctxBase, blockCtx, pages, editorMode)];
  const raw = r.path.split('.').reduce((acc: any, k: string) => (acc == null ? acc : acc[k.trim()]), ctxBase.data);
  const items = Array.isArray(raw) ? raw : [];
  const max = r.max ?? items.length;
  const alias = r.alias || 'item';
  const spacing = Number(r.spacing ?? 0);
  const baseY = Number((block.props as any)?.y ?? 0);
  const out: string[] = [];
  for (let i = 0; i < Math.min(items.length, max); i++) {
    const offsetY = baseY + i * spacing;
    const itemBlock = {
      ...block,
      props: { ...(block.props ?? {}), y: offsetY },
      repeat: undefined,
    };
    const itemCtx: ResolveContext = { ...ctxBase, data: { ...ctxBase.data, [alias]: items[i], [`${alias}Index`]: i } };
    const itemBlockCtx: HtmlBlockContext = { ...blockCtx, data: itemCtx.data };
    out.push(renderBlockOnce(itemBlock, itemCtx, itemBlockCtx, pages, editorMode));
  }
  return out;
}


/**
 * Page furniture — what a page carries whether or not it has anything to say.
 *
 * The running foot and the page number by TYPE; the running head, the part
 * marker and the section opener by the NAME the shared Investment Compass
 * master gives them (`investmentCompass/blocks.ts`), which every active row
 * copied. A page whose every other block drew nothing is a heading over white
 * space, and it is dropped — see `pagesWithContent`.
 */
const FURNITURE_TYPES = new Set(['footer', 'page-number', 'divider', 'spacer']);
const FURNITURE_NAMES = new Set(['Running head', 'Part marker', 'Section opener']);
const isFurniture = (block: Block): boolean =>
  FURNITURE_TYPES.has(String(block.type)) || FURNITURE_NAMES.has(String(block.name ?? ''));

/** Would this block put anything on the page? Asked of its renderer. */
function blockDrawsContent(block: Block, ctxBase: ResolveContext, blockCtx: HtmlBlockContext): boolean {
  if (!shouldRenderBlock(block, ctxBase)) return false;
  // An imported page is overlays on a container whose own renderer draws
  // nothing; the overlays are the page.
  if ((block.overlays ?? []).some((o) => !(o as { hidden?: boolean }).hidden)) return true;
  const r = (block as any).repeat;
  if (r?.path) {
    const raw = String(r.path).split('.').reduce((acc: any, k: string) => (acc == null ? acc : acc[k.trim()]), ctxBase.data);
    return Array.isArray(raw) && raw.length > 0;
  }
  const renderer = getHtmlBlockRenderer(block.type);
  // A type this renderer has no drawing for is not known to be empty. A page
  // is dropped on evidence that its blocks drew nothing, never on the absence
  // of a way to look — the page loop still emits the wrapper (and any bookmark
  // anchor) for such a block, and a reader reaching that anchor needs a page.
  if (!renderer) return true;
  return renderer(block, blockCtx).trim() !== '';
}

/**
 * The pages that have something on them.
 *
 * Measured on a record with no financials (RS-3, 14 Sep 2026): the Financial
 * position, Ten-year projection and Risk pages each drew their running head,
 * their part marker, a section opener and a foot — and, once the blocks that
 * had nothing to say stopped drawing, nothing else. Three consecutive pages of
 * a client document that were a heading over white space. A page is dropped
 * when it has at least one block that is not furniture and every such block
 * draws nothing. A page made only of furniture, a page with a background
 * raster (a plate is its picture), and every page in the editor — where an
 * author needs to see what they are building — are kept.
 *
 * This is the conditional-page capability applied by what the page turns out
 * to hold rather than by an expression the master remembered to write; the
 * `conditional` pages are already gone by the time this runs.
 */
function pagesWithContent(pages: Page[], template: ReportTemplate, ctxBase: ResolveContext): Page[] {
  return pages.filter((page) => {
    if ((page.background as { imageUrl?: unknown } | undefined)?.imageUrl) return true;
    const content = page.blocks.filter((b) => !isFurniture(b));
    if (content.length === 0) return true;
    // The page-scoped values every rendered page receives (`renderTemplateToHtml`
    // sets them per page, after this pass has decided which pages exist). A
    // block that binds only these — "Part {{partNumber}} of {{partCount}}" in
    // a body — always resolves at paint time, so the check must see them as
    // present: their values are counted later, their presence is certain now.
    const checkCtx: ResolveContext = {
      ...ctxBase,
      data: {
        ...ctxBase.data,
        pageNumber: 1, pageCount: 1, partNumber: 1, partCount: 1, __tocEntries: [],
      },
    };
    const blockCtx: HtmlBlockContext = {
      ...checkCtx,
      page: { width: page.size.width, height: page.size.height },
      pageIndex: 0,
      pages: pages.map((p) => ({ id: p.id, name: p.name, tocContinues: p.tocContinues === true })),
      slots: template.slots ?? {},
    };
    return content.some((b) => blockDrawsContent(b, checkCtx, blockCtx));
  });
}

/**
 * The part number a static part marker should carry, per visible page.
 *
 * The composer binds `{{partNumber}}` now, but the active rows predate that
 * and bake `Part 04 · Financials` into the marker — so a dropped page left the
 * running heads counting 01, 02, 03, 07. Healed on read, the way the counted
 * part is: one number per run of pages sharing a marker label, in the order
 * the pages are drawn. A marker that binds its number is left to the binding.
 */
const STATIC_PART_RE = /^Part\s+\d+/i;
/**
 * Where a marker block carries its part text: a running head sets it as the
 * `Part marker`'s body, a railed family as the `Rail marker`'s eyebrow.
 *
 * The rail was not read here until 23 Sep 2026, so the eleven railed Compass
 * masters kept every hole a dropped page left in their numbering while the
 * thirty-nine running-head ones were healed.
 */
const PART_TEXT_KEY: Readonly<Record<string, 'body' | 'eyebrow'>> = {
  'Part marker': 'body',
  'Rail marker': 'eyebrow',
};
/** A marker block's static `Part NN · Label`, or null for anything else. */
function staticPartText(b: Block): string | null {
  const key = PART_TEXT_KEY[String(b.name ?? '')];
  if (!key) return null;
  const text = (b.props as Record<string, unknown> | undefined)?.[key];
  return typeof text === 'string' && !text.includes('{{') && STATIC_PART_RE.test(text) ? text : null;
}
function staticPartMarkerBody(page: Page): string | null {
  for (const b of page.blocks) {
    const text = staticPartText(b);
    if (text !== null) return text;
  }
  return null;
}
function healedPartNumbers(pages: Page[]): Array<number | null> {
  let count = 0;
  let previous: string | null = null;
  return pages.map((page) => {
    const body = staticPartMarkerBody(page);
    if (body === null) return null;
    const label = body.replace(STATIC_PART_RE, '').trim();
    if (label !== previous) { count += 1; previous = label; }
    return count;
  });
}
/** The marker block with its static number replaced by the healed one. */
function healPartMarker(block: Block, part: number | null): Block {
  if (part === null) return block;
  const text = staticPartText(block);
  if (text === null) return block;
  const key = PART_TEXT_KEY[String(block.name ?? '')];
  const numeral = String(part).padStart(2, '0');
  return { ...block, props: { ...(block.props as Record<string, unknown>), [key]: text.replace(STATIC_PART_RE, `Part ${numeral}`) } } as Block;
}

/**
 * The section numeral, healed with the marker it was composed beside.
 *
 * A master that bakes its parts counts them at compose time, and the section
 * opener's numeral comes off the same counter (`nextNumeral()` returns the
 * number `nextPart()` just took). Healing the marker alone left the two
 * disagreeing on one page: the 23 Sep 2026 Compass for 97 Poole Road ran its
 * openers 01, 03, 04, 07, 09 over running heads reading Part 01 to Part 06,
 * and its Method page said "Part 06 · Sources" above "09 How this assessment
 * was reached".
 *
 * Only a numeral that EQUALS the page's static part number is touched, so a
 * number an author typed for any other reason is left alone. It sits in one of
 * the two places `sectionHeading` puts it — the `numeral` opener's left
 * heading, or the `decimal` opener's heading prefix.
 */
function healSectionNumeral(block: Block, staticPart: string | null, part: number | null): Block {
  if (part === null || staticPart === null || String(block.name ?? '') !== 'Section opener') return block;
  const healed = String(part).padStart(2, '0');
  if (healed === staticPart) return block;
  const props = block.props as Record<string, unknown>;
  if (props.leftHeading === staticPart) {
    return { ...block, props: { ...props, leftHeading: healed } } as Block;
  }
  const heading = props.heading;
  if (typeof heading === 'string' && heading.startsWith(`${staticPart}  `)) {
    return { ...block, props: { ...props, heading: `${healed}${heading.slice(staticPart.length)}` } } as Block;
  }
  return block;
}

/** `Part 09 · Sources` → `09`: the number exactly as the composer padded it. */
function staticPartNumeral(page: Page): string | null {
  const text = staticPartMarkerBody(page);
  return text ? /^Part\s+(\d+)/i.exec(text)?.[1] ?? null : null;
}

/**
 * ## What a PDF outline entry is allowed to be
 *
 * WeasyPrint builds the outline from every `h1`–`h6` it draws, which on this
 * path meant two very different things were competing to name the document.
 * A `markdown-block` heading IS a section name. A `text-block` heading is
 * DISPLAY TYPE bound to the record — so the third entry in every Investment
 * Compass outline read *"AVOID - Poor investment opportunity with multiple red
 * flags"*, the first nested one repeated the property's address under the
 * document title, and the pages named "The assessment" and "Risk and
 * recommendation" appeared under their headlines instead. A conclusion about a
 * property is not a name for the part of the document that carries it.
 *
 * So a text-block heading contributes no outline entry (`bookmark-level:none`,
 * set where it is drawn) and a page contributes its own NAME instead — but
 * only where the page's narrative names no section of its own, because a page
 * that opens "Demand Drivers" should say so rather than "The report (6)".
 * That is exactly the rule the contents block applies, from the same two
 * inputs, so the outline and the contents page cannot disagree.
 *
 * Level 2 puts a page beside a narrative `h2` and under the document's `h1`,
 * which is the shape the outline already had.
 */
const PAGE_BOOKMARK_LEVEL = 2;

function pageBookmarkStyle(label: string | null): string {
  if (!label) return '';
  const css = label.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]/g, ' ');
  return `bookmark-label:'${css}';bookmark-level:${PAGE_BOOKMARK_LEVEL};`;
}

function renderPage(page: Page, ctxBase: ResolveContext, pageIndex: number, template: ReportTemplate, pages: Page[], editorMode = false, bookmarkLabel: string | null = null): string {
  const blockCtx: HtmlBlockContext = {
    ...ctxBase,
    page: { width: page.size.width, height: page.size.height },
    pageIndex,
    pages: pages.map(p => ({ id: p.id, name: p.name, tocContinues: p.tocContinues === true })),
    slots: template.slots ?? {},
  };

  const pagePolicy = resolvePageOutputPolicy(page as unknown as Page);
  const pageRenderPlan = resolvePageRenderPlan(pagePolicy, {
    showReconstructedLayers: Boolean((ctxBase as { _showReconstructedLayers?: boolean })._showReconstructedLayers),
    showReferenceRaster: Boolean((ctxBase as { _showReferenceUnderlay?: boolean })._showReferenceUnderlay),
  });

  let bgStyle = '';
  const bgImages: string[] = [];
  const bgSizes: string[] = [];
  if (page.background?.color) {
    const c = resolveBindableColor(page.background.color, ctxBase, '#FFFFFF');
    bgStyle += `background-color:${c};`;
  }
  // Optional gradient (Phase 11) — sits above solid color, below raster image.
  const gradient = (page.background as any)?.gradient;
  if (gradient?.stops?.length) {
    const stops = gradient.stops
      .slice()
      .sort((a: any, b: any) => a.position - b.position)
      .map((s: any) => `${s.color} ${s.position}%`)
      .join(', ');
    const grad = gradient.type === 'radial'
      ? `radial-gradient(circle, ${stops})`
      : `linear-gradient(${gradient.angle ?? 180}deg, ${stops})`;
    bgImages.push(grad);
    bgSizes.push('100% 100%');
  }
  // PDF-import reference underlays are editor-canvas-only alignment aids; in
  // preview/print/export the reconstructed overlays ARE the page, and painting
  // the source raster behind them would double-render every element.
  let sourceRasterPainted = false;
  if (page.background?.imageUrl && shouldRenderPageBackgroundImage(page, pageRenderPlan)) {
    const url = resolveBindable(page.background.imageUrl, ctxBase);
    if (url) {
      sourceRasterPainted = true;
      // Full-page source rasters set imageFit:'fill' so the reference exactly
      // covers the page box (no aspect-ratio crop/stretch). Decorative images
      // keep the historical 'cover' default.
      const fit = (page.background as any)?.imageFit;
      const size = fit === 'fill' ? '100% 100%' : fit === 'contain' ? 'contain' : 'cover';
      // Phase 6B — page.background.opacity dims the raster *reference* so the
      // reconstructed overlays lead visually. CSS background-image has no own
      // opacity, and element opacity would dim foreground content too — so veil
      // the raster with white at (1 - opacity) alpha layered ON TOP of it (the
      // page background is white). Renders identically on the canvas and in the
      // WeasyPrint export (multi-layer background-image + background-size).
      const rawOpacity = (page.background as any)?.opacity;
      const op = typeof rawOpacity === 'number' && Number.isFinite(rawOpacity)
        ? Math.max(0, Math.min(1, rawOpacity))
        : 1;
      if (op < 1) {
        const veil = (1 - op).toFixed(3);
        bgImages.push(`linear-gradient(rgba(255,255,255,${veil}),rgba(255,255,255,${veil}))`);
        bgSizes.push('100% 100%');
      }
      bgImages.push(`url('${url}')`);
      bgSizes.push(size);
      bgStyle += `background-position:center;background-repeat:no-repeat;`;
    }
  }
  if (bgImages.length) {
    bgStyle += `background-image:${bgImages.join(', ')};`;
    if (bgSizes.length) bgStyle += `background-size:${bgSizes.join(', ')};`;
  }

  // C5: a raster-only page renders the source raster as its final output and
  // MUST NOT also render native blocks — otherwise a full raster and duplicate
  // native content render together. Editor opt-in shows the reconstructed layers
  // via `_showReconstructedLayers`.
  // E7: consume the resolved E6 region render plan (if any) at paint time — the
  // SAME composition the quality gate evaluates. Suppress the plan's suppressed
  // overlays and paint its final crops; absent a plan this is a no-op (identical
  // legacy output). Editor references are never painted in final output.
  const regionPlan = resolveRegionRenderPlanProjection(page as unknown as Page);
  // A1 — region-scoped containment. An unverified table used to rasterize its
  // whole page, taking every heading and paragraph on it into the pixels. The
  // window below shows the SAME source pixels over the table's own box, so
  // nothing about the table is trusted any further, while the rest of the page
  // keeps a text layer. See tableRegionContainment.pure.ts.
  //
  // The raster is resolved FIRST, and the whole mechanism stands down without
  // it. Suppressing an overlay whose window never paints would delete the table
  // outright — the one outcome worse than the page-wide raster this replaces.
  // Same principle as `shouldFallBackToNativeBlocks`: degraded beats absent.
  //
  // The editor's `showReconstructedLayers` opt-in reveals what is underneath,
  // exactly as it does on a raster-only page: same affordance, same meaning,
  // so a reviewer can inspect and correct the table the window is covering.
  const containedRasterUrl = resolveBindable(page.background?.imageUrl, ctxBase);
  const containedRegions = containedRasterUrl
    && !(ctxBase as { _showReconstructedLayers?: boolean })._showReconstructedLayers
    ? pageContainedRegions(pagePolicy, page.size)
    : [];
  const suppressedOverlays = suppressedOverlayIdSet(regionPlan);
  for (const region of containedRegions) {
    for (const id of region.overlayIds ?? []) suppressedOverlays.add(id);
  }
  const blockCtxBase = suppressedOverlays.size
    ? ({ ...ctxBase, _pdfSuppressedOverlayIds: suppressedOverlays } as ResolveContext)
    : ctxBase;
  const blocks: string[] = [];
  // …and if the raster that was supposed to BE this page never resolved, the
  // reconstruction renders after all rather than shipping a blank sheet. The
  // raster URL is signed at render time and is simply absent whenever that
  // signing fails, so this is the difference between a degraded page and an
  // empty one. See `shouldFallBackToNativeBlocks`.
  const renderNativeBlocks = pageRenderPlan.renderNativeBlocks
    || shouldFallBackToNativeBlocks(pageRenderPlan, sourceRasterPainted);
  const healedPart = (ctxBase.data as { __healedPartNumber?: number | null } | undefined)?.__healedPartNumber ?? null;
  const composedPart = staticPartNumeral(page);
  if (renderNativeBlocks) {
    // A dropped block leaves no hole: the blocks under it in its column move
    // up to where it began. Never in the editor. See `closeDroppedBlocks`.
    // A FLOWING page goes further: its column is re-stacked from what draws,
    // so a block that draws fewer of its declared rows gives the difference
    // back too. See `flowLayout.ts`.
    const laid = editorMode
      ? page.blocks
      : (page as { flow?: boolean }).flow === true
        ? layoutFlowColumn(page.blocks, flowFactsFor(blockCtxBase, blockCtx))
        : closeDroppedBlocks(page.blocks, (b) => !blockDrawsContent(b, blockCtxBase, blockCtx), isFurniture);
    for (const authored of sortBlocksForPaint(laid)) {
      const block = healSectionNumeral(healPartMarker(authored, healedPart), composedPart, healedPart);
      if (!shouldRenderBlock(block, ctxBase)) continue;
      blocks.push(...renderBlockWithRepeat(block, blockCtxBase, blockCtx, pages, editorMode));
    }
  }
  // Final source-crop elements from the E6 plan.
  //
  // These crops are rendered at SOURCE_SCENE_CROP_DPI (300), and chart regions
  // at CHART_CROP_MIN_DPI (300) — materially sharper than the page raster
  // underneath them. They used to be suppressed on raster-only pages, which
  // meant the pages that had ALREADY lost their native layers, and so had the
  // least fidelity left, were also denied the highest-resolution assets in the
  // system. That is backwards: a raster-only page is exactly where a crisp
  // chart or table crop earns the most.
  //
  // Painting them over the page raster is safe because both come from the same
  // source page at the same geometry — the crop lands exactly on top of the
  // region it was cut from, replacing a blurrier copy of itself.
  const regionCropsHtml = !regionPlan
    ? '' : buildFinalCropElementsHtml(regionPlan, {
      escapeHtml,
      resolveSrc: (crop) => {
        const resolver = (ctxBase as { _pdfRegionCropSrc?: (regionId: string) => string | null })._pdfRegionCropSrc;
        return resolver ? resolver(crop.regionId) : null;
      },
    });

  // The contained windows themselves. Painted AFTER the native blocks so the
  // source pixels are what a reader sees in that box — the suppression above
  // handles ownership, this handles paint order, and neither alone is enough.
  //
  // The image is the full page raster, sized to the page and offset so that
  // exactly the window's own area shows through. That is the same picture the
  // page-wide raster would have put there, cut to the region rather than
  // re-cut as a new artifact: no second asset, no second signing path, and no
  // possibility of the crop and the page disagreeing about geometry.
  const containedHtml = containedRegions.map((r) => (
    `<div aria-hidden="true" data-pdf-contained-region="1" style="position:absolute;`
    + `left:${r.x}pt;top:${r.y}pt;width:${r.width}pt;height:${r.height}pt;overflow:hidden;">`
    + `<img alt="" src="${escapeHtml(String(containedRasterUrl))}" style="position:absolute;`
    + `left:${-r.x}pt;top:${-r.y}pt;width:${page.size.width}pt;height:${page.size.height}pt;`
    + `max-width:none;" />`
    + `</div>`
  )).join('');

  // Phase 5 — baseline grid (printed when page.baselineGrid.show is true).
  let baselineEl = '';
  const bg = (page as any).baselineGrid;
  if (bg?.show) {
    const size = Number(bg.size ?? 12);
    const color = toRendererHex(bg.color) ?? '#BF9B5033';
    const offset = Number(bg.offset ?? 0);
    baselineEl = `<div aria-hidden="true" style="position:absolute;inset:0;pointer-events:none;background-image:repeating-linear-gradient(to bottom, transparent 0, transparent ${size - 1}pt, ${color} ${size - 1}pt, ${color} ${size}pt);background-position:0 ${offset}pt;"></div>`;
  }

  // E7: stamp composition identity (page id + render-plan hash + strategy) so
  // the quality capture reads plan identity — in BOTH editor and final output —
  // never element text. The existing editor `data-page-id`/`data-page-index`
  // attributes are preserved unchanged for their existing consumers.
  const editorAttrs = editorMode ? ` data-page-id="${escapeHtml(String(page.id))}" data-page-index="${pageIndex}"` : '';
  const compositionAttrs = ` ${pageCompositionDataAttrs(page as unknown as Page, regionPlan, escapeHtml)}`;
  const dataAttrs = editorAttrs + compositionAttrs;
  // The outline entry rides the page's own element, so it lands on the page
  // it names however the content above it paginated.
  const outline = (ctxBase as ResolveContext & { _includeBookmarks?: boolean })._includeBookmarks === false
    ? '' : pageBookmarkStyle(bookmarkLabel);
  return `<section id="tpl-page-${pageIndex}" class="tpl-page tpl-page-${pageIndex}"${dataAttrs} style="${escapeHtml(bgStyle + outline)}">${baselineEl}${blocks.join('\n')}${containedHtml}${regionCropsHtml}</section>`;
}
interface CascadeIndexEntry {
  pageIndex: number;
  pageName: string;
  blockId: string;
  blockName?: string;
  blockType?: string;
  overlayId?: string;
  overlayType?: string;
  anchor: any;
}

function collectCascadeIndexEntries(pages: Page[], ctxBase: ResolveContext): CascadeIndexEntry[] {
  const entries: CascadeIndexEntry[] = [];
  pages.forEach((page, pageIndex) => {
    if (!evalConditional(page.conditional, ctxBase)) return;
    for (const block of page.blocks) {
      if (!shouldRenderBlock(block, ctxBase)) continue;
      for (const anchor of (((block as any).anchors ?? []) as any[])) {
        entries.push({
          pageIndex,
          pageName: page.name,
          blockId: block.id,
          blockName: block.name,
          blockType: block.type,
          anchor,
        });
      }
      for (const overlay of block.overlays ?? []) {
        if ((overlay as any).hidden) continue;
        if (!evalConditional((overlay as any).conditional, ctxBase)) continue;
        for (const anchor of ((((overlay as any).anchors ?? []) as any[]))) {
          entries.push({
            pageIndex,
            pageName: page.name,
            blockId: block.id,
            blockName: block.name,
            blockType: block.type,
            overlayId: overlay.id,
            overlayType: overlay.type,
            anchor,
          });
        }
      }
    }
  });
  return entries;
}

function renderCascadeDebugIndexPage(template: ReportTemplate, pages: Page[], ctxBase: ResolveContext): string {
  const entries = collectCascadeIndexEntries(pages, ctxBase);
  if (!entries.length) return '';
  const firstPage = pages[0];
  const width = firstPage?.size?.width ?? 595;
  const height = firstPage?.size?.height ?? 842;
  const rows = entries.map((entry, index) => {
    const label = entry.anchor?.label || entry.anchor?.fieldPath || entry.anchor?.sectionId || entry.anchor?.id || 'Cascade anchor';
    const target = entry.overlayId
      ? `block ${entry.blockId} / overlay ${entry.overlayId}`
      : `block ${entry.blockId}`;
    const path = entry.anchor?.fieldPath || entry.anchor?.bindingPath || entry.anchor?.sectionId || '';
    const qa = [entry.anchor?.qaStatus || 'unreviewed', entry.anchor?.qaOwner].filter(Boolean).join(' · ');
    return `<tr>
      <td>${index + 1}</td>
      <td>Page ${entry.pageIndex + 1}<br/><span>${escapeHtml(entry.pageName || '')}</span></td>
      <td>${escapeHtml(String(label))}<br/><span>${escapeHtml(String(entry.anchor?.kind || 'field'))}</span></td>
      <td><code>${escapeHtml(String(path))}</code></td>
      <td>${escapeHtml(target)}<br/><span>${escapeHtml(entry.overlayType || entry.blockType || '')}</span></td>
      <td>${escapeHtml(qa)}${entry.anchor?.qaNote ? `<br/><span>${escapeHtml(String(entry.anchor.qaNote))}</span>` : ''}</td>
    </tr>`;
  }).join('');
  return `<section class="tpl-page tpl-cascade-index" style="width:${width}pt;height:${height}pt;padding:28pt;background:#f8fafc;color:#0f172a;overflow:hidden;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:18pt;margin-bottom:14pt;border-bottom:1pt solid #cbd5e1;padding-bottom:10pt;">
      <div>
        <div style="font:700 18pt var(--font-heading, var(--font-body, Helvetica, sans-serif));">Cascade anchor index</div>
        <div style="margin-top:3pt;font:9pt var(--font-body, Helvetica, sans-serif);color:#475569;">Debug-only page generated when Cascade tags are enabled.</div>
      </div>
      <div style="text-align:right;font:8pt ui-monospace, SFMono-Regular, Menlo, monospace;color:#475569;">
        ${entries.length} anchor${entries.length === 1 ? '' : 's'}<br/>${escapeHtml(String((template as any).meta?.title || 'Template preview'))}
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;font:7.5pt var(--font-body, Helvetica, sans-serif);table-layout:fixed;">
      <thead>
        <tr style="background:#0f172a;color:#f8fafc;">
          <th style="width:24pt;">#</th><th style="width:72pt;">Page</th><th style="width:128pt;">Anchor</th><th>Section / field / binding</th><th style="width:125pt;">Target</th><th style="width:110pt;">QA</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}



/** Compile a template + data into a print-ready HTML document. */
export function renderTemplateToHtml(
  rawTemplate: ReportTemplate | unknown,
  options: HtmlRenderOptions = {},
): HtmlRenderResult {
  const template = parseTemplate(rawTemplate);
  const themes = (template as any).themes as Record<string, any> | undefined;
  const activeTheme = themes && (template as any).activeThemeId ? themes[(template as any).activeThemeId] : null;
  const baseTokens = mergeTokens(template.tokens, activeTheme?.tokens, options.tokenOverrides);
  // The narrative pre-pass runs before any page conditional is read: it files
  // the geometry every markdown instance packs with and writes each run's
  // true page count over the projection's template-blind estimate. See
  // `narrativePlan.ts`.
  const ctxSeed: ResolveContext = { data: options.data ?? {}, tokens: baseTokens };
  const ctxBase = applyNarrativePlan(ctxSeed, planNarrative(template, ctxSeed));
  (ctxBase as ResolveContext & { _includeBookmarks?: boolean })._includeBookmarks = options.includeBookmarks !== false;

  const conditionalPages = template.pages.filter((p) => evalConditional(p.conditional, ctxBase));
  // A derived tier draws only the typed pages the registry gives it — the
  // Snapshot printed seventeen pages of which six were Compass depth — and a
  // record that issued no grade draws no page about how the grade was
  // reached. See `tierPageSequence.pure.ts`; every other format is untouched,
  // and the editor sees every page it is building.
  const tierPages = options.editorMode
    ? conditionalPages
    : pagesForDocument(conditionalPages, ctxBase.data as Parameters<typeof pagesForDocument>[1]);
  // Then the pages that turned out to hold something — never in the editor,
  // where an author needs to see every page they are building.
  const visiblePages = options.editorMode ? tierPages : pagesWithContent(tierPages, template, ctxBase);
  const healedParts = healedPartNumbers(visiblePages);

  // Part numbers, counted over the pages that actually render. A composer
  // that bakes "Part 07" into a page's furniture keeps counting pages a
  // conditional later drops — a real comparison shipped with its running
  // heads jumping Part 12 → Part 19. A page opts in by binding
  // `{{partNumber}}` anywhere in its content; every such visible page
  // increments the counter, and the same number serves the running head and
  // the section numeral because both resolve from one per-page value.
  let partCount = 0;
  const partNumbers = visiblePages.map((p) =>
    (JSON.stringify(p).includes('{{partNumber') ? ++partCount : partCount));

  // Phase 8 — walk all bookmarks to build a TOC index that auto-toc blocks read.
  const tocEntries: Array<{ label: string; level: number; pageIndex: number; anchor: string }> = [];
  visiblePages.forEach((pg, pi) => {
    for (const b of pg.blocks) {
      if (!shouldRenderBlock(b, ctxBase)) continue;
      const bm: any = (b as any).bookmark;
      if (!bm?.name) continue;
      if (bm.includeInToc === false) continue;
      const label = bm.label ? resolveBindable(bm.label, ctxBase) : (b.name || bm.name);
      tocEntries.push({
        label: String(label),
        level: Number(bm.level ?? 2),
        pageIndex: pi,
        anchor: `anc-${String(bm.name).replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      });
    }
  });

  /**
   * ## The report's own sections, and where each one landed
   *
   * A contents list and a PDF outline both name parts of a document. On this
   * path they named PAGE ARCHETYPES: the Compass contents read *Cover ·
   * Contents · Executive dashboard · The assessment · Risk and recommendation
   * · The report · Sources and methodology · Important information* — eight
   * rows for a 36-page report whose body is twenty-one sections, because the
   * twenty-nine narrative pages declare `tocContinues` and fold into the one
   * row named "The report". Every section a reader would look for was inside
   * that row and reachable only by turning pages.
   *
   * The sections exist; nothing had ever read them. A `markdown-block` packs
   * its source into buckets and draws bucket `pageIndex` on this page, so the
   * headings in THAT bucket are the sections this page opens — which is the
   * mapping pagination and conditional content would otherwise destroy, and
   * the reason it is computed here rather than declared in a master. The
   * buckets are memoised on (source, geometry, palette), so asking each
   * instance what it holds costs one index rather than one render.
   *
   * `level` is the heading's own; `pageIndex` is the index into
   * `visiblePages`, which is the same index `renderPage` stamps as
   * `id="tpl-page-N"`, so a folio and a destination cannot disagree.
   */
  const narrativeIndex: NarrativeIndex = { narrativePages: [], sections: [] };
  visiblePages.forEach((pg, pi) => {
    let drawsNarrative = false;
    for (const b of pg.blocks) {
      if (b.type !== 'markdown-block') continue;
      if (!shouldRenderBlock(b, ctxBase)) continue;
      const content = resolveMarkdownBlockContent(b, ctxBase);
      if (!content || !content.page.length) continue;
      drawsNarrative = true;
      for (const s of sectionIndexFromBuckets([content.page])) {
        narrativeIndex.sections.push({ label: s.label, level: s.level, pageIndex: pi, anchor: s.id });
      }
    }
    if (drawsNarrative) narrativeIndex.narrativePages.push(pi);
  });
  /**
   * A sheet in the middle of a section is not a part of the document.
   *
   * `narrativePages` is every visible page the run draws on; `sections` is the
   * subset that OPEN one. The outline and the contents both suppress a page's
   * own name on the first and list the second, which is why pages 25 to 28 of
   * a real Compass — the middle of the risk register — stopped announcing
   * themselves as "The report (20)" … "The report (23)".
   */
  const narrativePages = new Set(narrativeIndex.narrativePages);

  // Rehaul Phase 3 — per-page section cache. A page section's HTML depends on
  // its own content plus this cross-page context; everything is folded into
  // the cache key so a hit is always byte-identical to a fresh render.
  const pageCache = options.pageCache;
  const docContextSig = pageCache
    ? [
        templateMetaKey(template),
        stableJson(options.data ?? {}),
        stableJson(options.tokenOverrides ?? null),
        String(!!options.editorMode),
        String(!!options.cascadeMetadata),
        String(!!options.cascadeDebug),
        String(!!options.showReferenceUnderlay),
        String(options.includeBookmarks !== false),
        String(visiblePages.length),
        visiblePages.map((p) => `${p.id}\u0000${p.name}`).join('\u0001'),
        JSON.stringify(tocEntries),
        JSON.stringify(narrativeIndex),
        // A page part number depends on which PRECEDING pages opted in,
        // which the per-page cache key cannot see.
        partNumbers.join(','),
        healedParts.join(','),
      ].join('\u0002')
    : '';
  const liveCacheKeys = pageCache ? new Set<string>() : null;

  // Phase 10 — per-page theme delta CSS (only emitted when page.themeId set).
  const perPageThemeCss: string[] = [];
  const pageHtml = visiblePages.map((page, idx) => {
    const pageThemeId = (page as any).themeId as string | undefined;
    const pageTheme = pageThemeId && themes ? themes[pageThemeId] : null;
    const pageTokens = pageTheme ? mergeTokens(baseTokens, pageTheme.tokens) : baseTokens;
    if (pageTheme) {
      // Cheap (token diff only) — always computed, even on a section cache hit,
      // because this CSS lives in the document head, not in the section.
      const css = themeOverrideCss(idx, baseTokens, pageTokens);
      if (css) perPageThemeCss.push(css);
    }
    const cacheKey = pageCache ? `${stableJson(page)}\u0002${idx}\u0002${docContextSig}` : '';
    if (pageCache) {
      liveCacheKeys!.add(cacheKey);
      const hit = pageCache.get(cacheKey);
      if (hit !== undefined) return hit;
    }
    const pageCtx: ResolveContext = {
      tokens: pageTokens,
      data: {
        ...ctxBase.data,
        pageNumber: idx + 1,
        pageCount: visiblePages.length,
        partNumber: partNumbers[idx],
        partCount,
        __healedPartNumber: healedParts[idx],
        __tocEntries: tocEntries,
        [NARRATIVE_INDEX_KEY]: narrativeIndex,
      },
    };
    // pageCtx is built fresh (see the note on `_includeBookmarks` below), so
    // the narrative geometry the pre-pass filed has to be carried across too,
    // or every markdown instance would pack on the profile's constants while
    // the page conditionals were evaluated on the geometry's count.
    (pageCtx as any)[NARRATIVE_GEOMETRY_KEY] = (ctxBase as any)[NARRATIVE_GEOMETRY_KEY];
    // The folded continuation notes travel with the geometry they were
    // planned against (RS-5c.6): a page context rebuilt without them draws
    // the last allowed page of a run without its note.
    (pageCtx as any)[NARRATIVE_NOTES_KEY] = (ctxBase as any)[NARRATIVE_NOTES_KEY];
    (pageCtx as any)._cascadeMetadata = !!options.cascadeMetadata;
    (pageCtx as any)._cascadeDebug = !!options.cascadeDebug;
    (pageCtx as any)._editorMode = !!options.editorMode;
    (pageCtx as any)._showReferenceUnderlay = !!options.showReferenceUnderlay;
    (pageCtx as any)._showReconstructedLayers = !!options.showReconstructedLayers;
    // pageCtx is built fresh rather than spread from ctxBase, so every private
    // flag has to be re-set here. Missing this one meant `includeBookmarks:
    // false` was read as `undefined` at paint time and the PDF outline metadata
    // was emitted anyway — the option had no effect on output at all.
    (pageCtx as any)._includeBookmarks = options.includeBookmarks !== false;
    // E7: runtime-only resolver mapping a region id → an ephemeral crop src
    // (signed/object/data URL). Never persisted; consumed only at paint time.
    if (options.regionCropSrc) (pageCtx as any)._pdfRegionCropSrc = options.regionCropSrc;
    const rendered = renderPage(
      page, pageCtx, idx, template, visiblePages, !!options.editorMode,
      narrativePages.has(idx) ? null : String(page.name ?? '').trim() || null,
    );
    if (pageCache) pageCache.set(cacheKey, rendered);
    return rendered;
  }).join('\n');
  const cascadeDebugIndexHtml = options.cascadeDebug ? renderCascadeDebugIndexPage(template, visiblePages, ctxBase) : '';

  // Prune entries that no longer correspond to a live page/context so the
  // caller-owned cache cannot grow unboundedly across edits.
  if (pageCache && liveCacheKeys) {
    for (const key of Array.from(pageCache.keys())) {
      if (!liveCacheKeys.has(key)) pageCache.delete(key);
    }
  }


  const editorCss = options.editorMode ? `
/* Editor mode chrome */
.tpl-page { box-shadow: 0 1pt 4pt rgba(0,0,0,0.08); margin: 0 auto 24px auto; outline: 1px solid rgba(0,0,0,0.08); }
[data-block-id] > * { cursor: pointer; }
[data-block-id].__tpl-hover { outline: 1.5pt dashed hsl(45 80% 50% / 0.7); outline-offset: 2pt; }
[data-block-id].__tpl-selected { outline: 2pt solid hsl(45 95% 50%); outline-offset: 2pt; box-shadow: 0 0 0 4pt hsl(45 95% 50% / 0.18); }
[data-cascade-anchor-id] { outline: 1pt dashed hsl(217 91% 60% / 0.55); outline-offset: 1pt; }
` : '';

  const css = [
    // `container` withholds every remote stylesheet link. See `fontSource` on
    // HtmlRenderOptions: one `@import` of a Google Fonts URL is enough for
    // `render-template-pdf` to reject the whole document at its resource
    // boundary, which is what made every design-system render fall back to the
    // legacy generator.
    tokensToFontFaceCss(baseTokens, {
      remoteStylesheets: options.fontSource !== 'container',
    }),
    tokensToCssVariables(baseTokens),
    baseCss(),
    pageCss(visiblePages, template, ctxBase).css,
    perPageThemeCss.join('\n'),
    editorCss,
    options.customCss ?? '',
  ].join('\n');

  // Phase 8 — document metadata
  const meta = (template as any).meta ?? {};
  const lang = meta.lang || 'en';
  const r = (v: unknown) => v ? escapeHtml(resolveBindable(v, ctxBase)) : '';
  const metaTags = [
    meta.author   && `<meta name="author" content="${r(meta.author)}"/>`,
    meta.subject  && `<meta name="description" content="${r(meta.subject)}"/>`,
    meta.keywords && `<meta name="keywords" content="${r(meta.keywords)}"/>`,
    meta.creator  && `<meta name="generator" content="${r(meta.creator)}"/>`,
  ].filter(Boolean).join('\n');
  /**
   * The document's own title, and the heading that carries it.
   *
   * Two things were found by validating a produced file rather than by reading
   * the export settings.
   *
   * **The title was the literal `Report`.** `options.title` is passed by the
   * editor's preview and by nothing on the production path, and no seeded
   * master declares `meta.title` — so `routeReportThroughTemplate`'s
   * `compileTemplateHtmlForPdf(schema, { data })` fell through to the fallback
   * on every report. WeasyPrint writes it into the PDF's `/Title`, and the
   * render contract also sets `/ViewerPreferences /DisplayDocTitle true`,
   * which asks the reader to show the title instead of the file name. So a
   * client opening any templated report saw a window headed **Report**. The
   * binding data already names the document and the property; it is read here
   * rather than added to 500 generated masters.
   *
   * **And nothing in the document was an `<h1>`.** veraPDF 1.30.2 fails the
   * 36-page Templates render on clause 7.4.2 test 1 — "if any heading tags are
   * used, H1 shall be the first" — with 22 `h2` and 29 `h3` and no `h1` at
   * all. The `cover` block does emit one, but the catalogue's masters set
   * their cover title as positioned display type, which carries no heading
   * role, so the first heading in the file is the `h2` on the page after it.
   * The document's title IS its first-level heading, so it is emitted as one.
   * It is placed out of the visual surface because the cover already shows it
   * in display type, and printing it twice would change every master's cover.
   * The better fix is for the masters to declare the semantic role on the
   * title they already draw; that is a change to the generator, not to a
   * renderer, and until it is made this keeps every existing master
   * conformant.
   *
   * **And "0 x 0 and clipped" did not clip it.** That was the mechanism this
   * used, and it was believed rather than measured. WeasyPrint lays the
   * heading out at the position given and PAINTS ITS GLYPHS regardless of the
   * box's declared size — `overflow: hidden` on a zero-size absolutely
   * positioned box does not suppress the text run. Measured 18 September 2026
   * on a real Financial Analysis render: `pdftotext` returns the title a
   * second time at the top of page 1, broken one word per line by the
   * zero-width box (`Financial` / `Analysis` / `—` / `1/27D` / `Mitchell` /
   * `Street`), drawn at no contrast against the cover's own ground, and its
   * word boxes OVERLAP the letterhead's. Three consequences, none visible on
   * screen and all of them real: the client's PDF carries its own title twice
   * to copy-paste, to search and to a screen reader; the document measures
   * ILLEGIBLE and OVERLAP on its cover; and the second copy is fragments
   * rather than a sentence.
   *
   * `font-size: 0` is what actually removes it from the surface. The element
   * and its heading role stay in the box tree — which is what the structure
   * tree is built from, and what 7.4.2 reads — while there is no glyph of any
   * size to paint or extract. The zero-size clipped box is kept as well, so
   * nothing about the layout changes.
   */
  const bound = (expr: string): string => {
    try {
      return String(resolveBindable(expr, ctxBase) ?? '').trim();
    } catch {
      return '';
    }
  };
  const declared = options.title ?? (meta.title ? resolveBindable(meta.title, ctxBase) : '');
  const named = [bound('{{report.documentTitle}}'), bound('{{property.address}}')]
    .filter(Boolean).join(' — ');
  const docTitle = declared || named || 'Report';
  // Present in the structure tree, absent from the painted surface. The size
  // is what does that — see the note above; the clipped box alone did not.
  const titleHeading = `<h1 style="position:absolute;top:0;left:0;width:0;height:0;`
    + `overflow:hidden;margin:0;font-size:0;line-height:0;">${escapeHtml(docTitle)}</h1>`;

  const editorRuntime = options.editorMode ? `
<script>(function(){
  function findBlock(el){ while(el && el!==document.body){ if(el.dataset && el.dataset.blockId) return el; el = el.parentElement; } return null; }
  function findPage(el){ while(el && el!==document.body){ if(el.dataset && el.dataset.pageId) return el; el = el.parentElement; } return null; }
  document.addEventListener('click', function(e){
    var b = findBlock(e.target); var p = findPage(e.target);
    if (b || p) {
      e.preventDefault(); e.stopPropagation();
      parent.postMessage({ source:'tpl-preview', type:'select',
        blockId: b ? b.dataset.blockId : null,
        blockType: b ? b.dataset.blockType : null,
        pageId: p ? p.dataset.pageId : null,
        pageIndex: p ? Number(p.dataset.pageIndex) : null,
      }, '*');
    }
  }, true);
  document.addEventListener('mouseover', function(e){
    var b = findBlock(e.target); if (!b) return;
    if (b.__hovered) return; b.__hovered = true; b.classList.add('__tpl-hover');
  }, true);
  document.addEventListener('mouseout', function(e){
    var b = findBlock(e.target); if (!b) return;
    b.__hovered = false; b.classList.remove('__tpl-hover');
  }, true);
  window.addEventListener('message', function(ev){
    var m = ev.data; if (!m || m.source !== 'tpl-preview-host') return;
    if (m.type === 'select') {
      document.querySelectorAll('[data-block-id].__tpl-selected').forEach(function(n){ n.classList.remove('__tpl-selected'); });
      if (m.blockId) {
        var el = document.querySelector('[data-block-id="'+CSS.escape(m.blockId)+'"]');
        if (el) { el.classList.add('__tpl-selected'); if (m.scroll !== false) el.scrollIntoView({ behavior:'smooth', block:'center' }); }
      } else if (m.pageId) {
        var pg = document.querySelector('[data-page-id="'+CSS.escape(m.pageId)+'"]');
        if (pg && m.scroll !== false) pg.scrollIntoView({ behavior:'smooth', block:'start' });
      }
    }
  });
  parent.postMessage({ source:'tpl-preview', type:'ready' }, '*');
})();</script>` : '';

  const html = `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(docTitle)}</title>
${metaTags}
<style>${escapeStyleElementContent(css)}</style>
</head>
<body>
${titleHeading}
${pageHtml}
${cascadeDebugIndexHtml}
${editorRuntime}
</body>
</html>`;


  return { html, css };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

/**
 * Keep generated CSS inside the HTML parser's raw-text style element.
 *
 * Escaping every less-than sign as CSS preserves its value while preventing
 * untrusted template tokens (or other generated CSS) from spelling an HTML
 * `</style>` end tag.
 */
function escapeStyleElementContent(css: string): string {
  return css.replace(/</g, '\\3C ');
}
