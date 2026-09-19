/**
 * Block registry: each block type knows how to draw itself with jsPDF.
 *
 * To add a new block type:
 *   1. Create a new file in this folder exporting a `BlockRenderer`.
 *   2. Register it in BLOCK_RENDERERS below.
 *   3. Add a default-props factory + inspector schema to BLOCK_DEFS.
 */
import type { jsPDF } from 'jspdf';
import type { Block } from '../templateSchema';
import type { ResolveContext } from '../bindingResolver';
import { drawDisclaimerBlock } from './disclaimer';
import { drawHeroBlock } from './hero';
import { drawKpiGridBlock } from './kpiGrid';
import { drawDataTableBlock } from './dataTable';
import { drawChartBlock } from './chart';
import { drawImageBlock } from './imageBlock';
import { drawTextBlock } from './textBlock';
import { drawFooterBlock } from './footer';
import { drawCoverBlock } from './cover';
import { drawDividerBlock } from './divider';
import { drawCalloutBlock } from './callout';
import { drawTwoColumnBlock } from './twoColumn';
import { drawGalleryBlock } from './gallery';
import { drawPageNumberBlock } from './pageNumber';
import { drawSpacerBlock } from './spacer';
import { drawQrBlock } from './qrCode';
import { drawBadgeListBlock } from './badgeList';
import { drawTocBlock } from './toc';
import { drawSignatureBlock } from './signature';
import { drawSlotBlock } from './slot';
import { drawScorecardBlock } from './scorecard';
import { drawRiskRegisterBlock } from './riskRegister';
import { drawInfraTimelineBlock } from './infraTimeline';
import { drawAmenityMatrixBlock } from './amenityMatrix';
import { drawPlanningTableBlock } from './planningTable';
import { drawDDChecklistBlock } from './ddChecklist';
import { drawDecisionBoxBlock } from './decisionBox';
import { drawStrengthsWatchBlock } from './strengthsWatch';
import { drawExtrasPlaceholder } from './extras';
import { drawDefinitionListBlock } from './definitionList';
import { drawChartLineBlock } from './chartLine';
import { drawMarkdownBlock } from './markdownBlock';

export type RendererCapability = 'full' | 'partial' | 'unsupported';
export type RendererEngine = 'html' | 'weasyprint' | 'jspdf';

export interface BlockRendererCapabilities {
  /** Browser/editor HTML renderer support. */
  html: RendererCapability;
  /** Production print renderer support. WeasyPrint consumes the HTML renderer. */
  weasyprint: RendererCapability;
  /** Legacy/in-editor jsPDF renderer support. */
  jspdf: RendererCapability;
  /** True when this block is safe to route through the production renderer. */
  productionSafe: boolean;
  /** Human-readable caveat surfaced by lint/readiness checks. */
  notes?: string;
}

const FULL_RENDERER_CAPABILITIES: BlockRendererCapabilities = {
  html: 'full',
  weasyprint: 'full',
  jspdf: 'full',
  productionSafe: true,
};

const HTML_FIRST_RENDERER_CAPABILITIES: BlockRendererCapabilities = {
  html: 'full',
  weasyprint: 'full',
  jspdf: 'partial',
  productionSafe: true,
  notes: 'Production HTML/WeasyPrint output is supported; legacy jsPDF preview/export renders a placeholder.',
};

const UNSUPPORTED_RENDERER_CAPABILITIES: BlockRendererCapabilities = {
  html: 'unsupported',
  weasyprint: 'unsupported',
  jspdf: 'unsupported',
  productionSafe: false,
  notes: 'No renderer is registered for this block type.',
};

export const HTML_FIRST_BLOCK_TYPES = new Set<string>([
  'timeline',
  'swot',
  'gantt',
  'comparison',
  'stat-callout',
  'pull-quote',
  'faq',
  'pricing-card',
  'feature-list',
  'process-steps',
  'progress-bars',
  'map',
  'icon-grid',
  'testimonials',
  'ribbon',
  'metric-delta',
  'sparkline',
  'before-after',
  'image-text',
  'data-grid',
  'pivot-table',
  'chart-bar',
  'chart-stacked-bar',
  'chart-area',
  'chart-pie',
  'chart-donut',
  'chart-scatter',
  'chart-radar',
  'heatmap',
  'kpi-strip',
  'legend',
  'auto-toc',
]);

export interface BlockRenderContext extends ResolveContext {
  doc: jsPDF;
  page: { width: number; height: number };
  /**
   * All visible pages in render order — used by TOC and similar blocks.
   * `tocContinues` travels with them because the contents block reads it to
   * fold a section that runs over two pages into one entry.
   */
  pages?: Array<{ name: string; id: string; tocContinues?: boolean }>;
  /** Reusable slots (Header/Footer/etc) keyed by slotKey. */
  slots?: Record<string, Block>;
  /** Internal: draw a single overlay (provided by pdfRenderer). */
  _drawOverlay?: (overlay: import('../templateSchema').Overlay, ctx: BlockRenderContext) => void;
}

export type BlockRenderer = (block: Block, ctx: BlockRenderContext) => void;

export const BLOCK_RENDERERS: Record<string, BlockRenderer> = {
  disclaimer: drawDisclaimerBlock,
  hero: drawHeroBlock,
  'kpi-grid': drawKpiGridBlock,
  'data-table': drawDataTableBlock,
  chart: drawChartBlock,
  image: drawImageBlock,
  'text-block': drawTextBlock,
  footer: drawFooterBlock,
  cover: drawCoverBlock,
  divider: drawDividerBlock,
  callout: drawCalloutBlock,
  'two-column': drawTwoColumnBlock,
  gallery: drawGalleryBlock,
  'page-number': drawPageNumberBlock,
  spacer: drawSpacerBlock,
  qr: drawQrBlock,
  'badge-list': drawBadgeListBlock,
  toc: drawTocBlock,
  signature: drawSignatureBlock,
  slot: drawSlotBlock,
  // Compass-40 visual components (Phase 4)
  scorecard: drawScorecardBlock,
  'risk-register': drawRiskRegisterBlock,
  'infra-timeline': drawInfraTimelineBlock,
  'amenity-matrix': drawAmenityMatrixBlock,
  'planning-table': drawPlanningTableBlock,
  'dd-checklist': drawDDChecklistBlock,
  'decision-box': drawDecisionBoxBlock,
  'strengths-watch': drawStrengthsWatchBlock,
  // Phase 3 — HTML-first blocks (jsPDF shows a placeholder)
  timeline: drawExtrasPlaceholder,
  swot: drawExtrasPlaceholder,
  gantt: drawExtrasPlaceholder,
  comparison: drawExtrasPlaceholder,
  'stat-callout': drawExtrasPlaceholder,
  'pull-quote': drawExtrasPlaceholder,
  faq: drawExtrasPlaceholder,
  'pricing-card': drawExtrasPlaceholder,
  'feature-list': drawExtrasPlaceholder,
  'process-steps': drawExtrasPlaceholder,
  'progress-bars': drawExtrasPlaceholder,
  map: drawExtrasPlaceholder,
  'icon-grid': drawExtrasPlaceholder,
  testimonials: drawExtrasPlaceholder,
  ribbon: drawExtrasPlaceholder,
  'metric-delta': drawExtrasPlaceholder,
  'definition-list': drawDefinitionListBlock,
  sparkline: drawExtrasPlaceholder,
  'before-after': drawExtrasPlaceholder,
  'image-text': drawExtrasPlaceholder,
  // Phase 6 — data-driven blocks (jsPDF placeholder; real fidelity in HTML)
  'data-grid': drawExtrasPlaceholder,
  'pivot-table': drawExtrasPlaceholder,
  'chart-bar': drawExtrasPlaceholder,
  'chart-stacked-bar': drawExtrasPlaceholder,
  'chart-line': drawChartLineBlock,
  'markdown-block': drawMarkdownBlock,
  'chart-area': drawExtrasPlaceholder,
  'chart-pie': drawExtrasPlaceholder,
  'chart-donut': drawExtrasPlaceholder,
  'chart-scatter': drawExtrasPlaceholder,
  'chart-radar': drawExtrasPlaceholder,
  heatmap: drawExtrasPlaceholder,
  'kpi-strip': drawExtrasPlaceholder,
  legend: drawExtrasPlaceholder,
  'auto-toc': drawExtrasPlaceholder,
};


export function getBlockRenderer(type: string): BlockRenderer | null {
  return BLOCK_RENDERERS[type] ?? null;
}

export function getBlockRendererCapabilities(type: string): BlockRendererCapabilities {
  if (!type) return UNSUPPORTED_RENDERER_CAPABILITIES;
  if (type === 'free') return FULL_RENDERER_CAPABILITIES;
  if (HTML_FIRST_BLOCK_TYPES.has(type)) return HTML_FIRST_RENDERER_CAPABILITIES;
  return BLOCK_RENDERERS[type] ? FULL_RENDERER_CAPABILITIES : UNSUPPORTED_RENDERER_CAPABILITIES;
}

// ─── Inspector schemas + defaults ────────────────────────────────────────────
export type BlockField =
  | { kind: 'bindable'; key: string; label: string; multiline?: boolean; placeholder?: string }
  | { kind: 'number'; key: string; label: string; step?: number; min?: number; max?: number }
  | { kind: 'color'; key: string; label: string }
  | { kind: 'select'; key: string; label: string; options: string[] }
  | { kind: 'list-strings'; key: string; label: string }
  | { kind: 'list-rows'; key: string; label: string };

export interface BlockDef {
  type: string;
  label: string;
  defaultProps: () => Record<string, unknown>;
  fields: BlockField[];
  /** Optional override for renderer readiness; defaults to registry-derived capabilities. */
  capabilities?: BlockRendererCapabilities;
}

export const BLOCK_DEFS: Record<string, BlockDef> = {
  cover: {
    type: 'cover',
    label: 'Cover page',
    defaultProps: () => ({
      eyebrow: 'Investment Report',
      title: '{{property.address}}',
      subtitle: 'Prepared for {{client.name}}',
      footnote: '{{reportType | upper}}',
      bg: 'token:bg',
      accent: 'token:primary',
      titleSize: 40,
    }),
    fields: [
      { kind: 'bindable', key: 'eyebrow', label: 'Eyebrow' },
      { kind: 'bindable', key: 'title', label: 'Title', multiline: true },
      { kind: 'bindable', key: 'subtitle', label: 'Subtitle' },
      { kind: 'bindable', key: 'footnote', label: 'Footnote' },
      { kind: 'bindable', key: 'imageUrl', label: 'Background image URL' },
      { kind: 'color', key: 'bg', label: 'Background' },
      { kind: 'color', key: 'accent', label: 'Accent' },
      { kind: 'number', key: 'titleSize', label: 'Title size', min: 10, max: 80 },
    ],
  },
  hero: {
    type: 'hero',
    label: 'Hero banner',
    defaultProps: () => ({
      title: '{{property.address}}',
      subtitle: '{{property.suburb}}',
      align: 'left',
      x: 0, y: 0, width: 595, height: 280,
      titleSize: 28,
      subtitleSize: 14,
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'bindable', key: 'subtitle', label: 'Subtitle' },
      { kind: 'bindable', key: 'imageUrl', label: 'Background image URL' },
      { kind: 'color', key: 'tint', label: 'Tint' },
      { kind: 'select', key: 'align', label: 'Align', options: ['left', 'center', 'right'] },
      { kind: 'number', key: 'x', label: 'X' },
      { kind: 'number', key: 'y', label: 'Y' },
      { kind: 'number', key: 'width', label: 'Width' },
      { kind: 'number', key: 'height', label: 'Height' },
    ],
  },
  'kpi-grid': {
    type: 'kpi-grid',
    label: 'KPI grid',
    defaultProps: () => ({
      x: 24, y: 320, width: 547, height: 90, columns: 3, gap: 12,
      items: [
        { label: 'Weekly rent', value: '{{financials.weeklyRent | currency}}' },
        { label: 'Purchase price', value: '{{financials.purchasePrice | currency}}' },
        { label: 'Tier', value: '{{tier | upper}}' },
      ],
    }),
    fields: [
      { kind: 'number', key: 'columns', label: 'Columns', min: 1, max: 6 },
      { kind: 'number', key: 'gap', label: 'Gap (pt)' },
      { kind: 'color', key: 'tileBg', label: 'Tile bg' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  'data-table': {
    type: 'data-table',
    label: 'Data table',
    defaultProps: () => ({
      x: 24, y: 440, width: 547, rowHeight: 22,
      headers: ['Field', 'Value'],
      rows: [
        { cells: ['Address', '{{property.address}}'] },
        { cells: ['Suburb', '{{property.suburb}}'] },
        { cells: ['Weekly rent', '{{financials.weeklyRent | currency}}'] },
      ],
    }),
    fields: [
      { kind: 'list-strings', key: 'headers', label: 'Headers' },
      { kind: 'list-rows', key: 'rows', label: 'Rows' },
      { kind: 'number', key: 'rowHeight', label: 'Row height' },
      { kind: 'color', key: 'headerBg', label: 'Header bg' },
    ],
  },
  chart: {
    type: 'chart',
    label: 'Chart (URL)',
    defaultProps: () => ({
      x: 24, y: 320, width: 547, height: 240,
      chartUrl:
        'https://quickchart.io/chart?c={type:%27bar%27,data:{labels:[%27Q1%27,%27Q2%27,%27Q3%27,%27Q4%27],datasets:[{label:%27Yield%27,data:[3.2,3.5,3.8,4.1]}]}}',
      caption: 'Sample chart — replace URL with your QuickChart link.',
    }),
    fields: [
      { kind: 'bindable', key: 'chartUrl', label: 'Chart URL' },
      { kind: 'bindable', key: 'caption', label: 'Caption' },
    ],
  },
  image: {
    type: 'image',
    label: 'Image block',
    defaultProps: () => ({
      x: 24, y: 320, width: 547, height: 220,
      src: '{{property.imageUrl}}',
      caption: '',
    }),
    fields: [
      { kind: 'bindable', key: 'src', label: 'Image URL' },
      { kind: 'bindable', key: 'caption', label: 'Caption' },
    ],
  },
  'text-block': {
    type: 'text-block',
    label: 'Text block',
    defaultProps: () => ({
      x: 24, y: 320, width: 547,
      heading: 'Section heading',
      body: 'Body copy supports {{property.address}} bindings and \\nline breaks.',
      headingSize: 16,
      bodySize: 10,
    }),
    fields: [
      { kind: 'bindable', key: 'heading', label: 'Heading' },
      { kind: 'bindable', key: 'body', label: 'Body', multiline: true },
      { kind: 'number', key: 'headingSize', label: 'Heading size' },
      { kind: 'number', key: 'bodySize', label: 'Body size' },
      { kind: 'color', key: 'color', label: 'Body color' },
    ],
  },
  footer: {
    type: 'footer',
    label: 'Footer bar',
    defaultProps: () => ({
      text: '{{client.name}} — {{reportType}}',
      bg: 'token:bg',
      color: 'token:muted',
      align: 'center',
      height: 28,
    }),
    fields: [
      { kind: 'bindable', key: 'text', label: 'Text' },
      { kind: 'color', key: 'bg', label: 'Background' },
      { kind: 'color', key: 'color', label: 'Text color' },
      { kind: 'select', key: 'align', label: 'Align', options: ['left', 'center', 'right'] },
      { kind: 'number', key: 'height', label: 'Height' },
    ],
  },
  disclaimer: {
    type: 'disclaimer',
    label: 'Disclaimer page',
    defaultProps: () => ({
      companyName: 'Property Consulting',
      website: 'example.com.au',
      email: 'hello@example.com.au',
      phone: '+61 0 0000 0000',
      address: 'Sydney, NSW 2000',
      abn: '00 000 000 000',
      disclaimerText:
        'This document is general information only and does not constitute financial advice.',
    }),
    fields: [
      { kind: 'bindable', key: 'companyName', label: 'Company name' },
      { kind: 'bindable', key: 'website', label: 'Website' },
      { kind: 'bindable', key: 'email', label: 'Email' },
      { kind: 'bindable', key: 'phone', label: 'Phone' },
      { kind: 'bindable', key: 'address', label: 'Address' },
      { kind: 'bindable', key: 'abn', label: 'ABN' },
      { kind: 'bindable', key: 'disclaimerText', label: 'Disclaimer text', multiline: true },
    ],
  },
  divider: {
    type: 'divider',
    label: 'Divider',
    defaultProps: () => ({ x: 24, y: 200, width: 547, thickness: 1, color: 'token:muted', style: 'solid' }),
    fields: [
      { kind: 'number', key: 'y', label: 'Y' },
      { kind: 'number', key: 'width', label: 'Width' },
      { kind: 'number', key: 'thickness', label: 'Thickness' },
      { kind: 'color', key: 'color', label: 'Color' },
      { kind: 'select', key: 'style', label: 'Style', options: ['solid', 'dashed', 'dotted'] },
    ],
  },
  callout: {
    type: 'callout',
    label: 'Callout',
    defaultProps: () => ({
      x: 24, y: 320, width: 547,
      variant: 'info',
      title: 'Heads up',
      body: 'Use callouts to highlight key takeaways or warnings.',
    }),
    fields: [
      { kind: 'select', key: 'variant', label: 'Variant', options: ['info', 'success', 'warning', 'danger', 'quote'] },
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'bindable', key: 'body', label: 'Body', multiline: true },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  'two-column': {
    type: 'two-column',
    label: 'Two-column',
    defaultProps: () => ({
      x: 24, y: 320, width: 547, gap: 16, ratio: 0.5,
      leftHeading: 'Left heading',
      leftBody: 'Left column body copy.',
      rightHeading: 'Right heading',
      rightBody: 'Right column body copy.',
    }),
    fields: [
      { kind: 'bindable', key: 'leftHeading', label: 'Left heading' },
      { kind: 'bindable', key: 'leftBody', label: 'Left body', multiline: true },
      { kind: 'bindable', key: 'rightHeading', label: 'Right heading' },
      { kind: 'bindable', key: 'rightBody', label: 'Right body', multiline: true },
      { kind: 'number', key: 'ratio', label: 'Left ratio (0-1)', step: 0.05, min: 0.1, max: 0.9 },
      { kind: 'number', key: 'gap', label: 'Gap' },
    ],
  },
  gallery: {
    type: 'gallery',
    label: 'Image gallery',
    defaultProps: () => ({
      x: 24, y: 320, width: 547, height: 260, columns: 3, gap: 8,
      items: [
        { src: '{{property.imageUrl}}', caption: 'Front' },
        { src: '{{property.imageUrl}}', caption: 'Side' },
        { src: '{{property.imageUrl}}', caption: 'Rear' },
      ],
    }),
    fields: [
      { kind: 'number', key: 'columns', label: 'Columns', min: 1, max: 6 },
      { kind: 'number', key: 'gap', label: 'Gap' },
    ],
  },
  'page-number': {
    type: 'page-number',
    label: 'Page number',
    defaultProps: () => ({
      text: 'Page {{pageNumber}} of {{pageCount}}',
      align: 'center',
      size: 8,
    }),
    fields: [
      { kind: 'bindable', key: 'text', label: 'Text' },
      { kind: 'select', key: 'align', label: 'Align', options: ['left', 'center', 'right'] },
      { kind: 'number', key: 'size', label: 'Size' },
      { kind: 'color', key: 'color', label: 'Color' },
    ],
  },
  spacer: {
    type: 'spacer',
    label: 'Spacer',
    defaultProps: () => ({ x: 24, y: 200, width: 547, height: 24, showGuide: false }),
    fields: [
      { kind: 'number', key: 'y', label: 'Y' },
      { kind: 'number', key: 'height', label: 'Height' },
      { kind: 'select', key: 'showGuide', label: 'Show guide', options: ['true', 'false'] },
    ],
  },
  qr: {
    type: 'qr',
    label: 'QR code',
    defaultProps: () => ({
      x: 24, y: 320, size: 120,
      data: 'https://example.com',
      caption: 'Scan to learn more',
    }),
    fields: [
      { kind: 'bindable', key: 'data', label: 'Encoded data / URL' },
      { kind: 'number', key: 'size', label: 'Size (pt)' },
      { kind: 'bindable', key: 'caption', label: 'Caption' },
      { kind: 'color', key: 'color', label: 'Caption color' },
    ],
  },
  'badge-list': {
    type: 'badge-list',
    label: 'Badge list',
    defaultProps: () => ({
      x: 24, y: 320, width: 547,
      items: ['Investor ready', 'High yield', 'Sub-3% vacancy'],
      bg: 'token:primary',
      color: '#FFFFFF',
    }),
    fields: [
      { kind: 'list-strings', key: 'items', label: 'Badges' },
      { kind: 'color', key: 'bg', label: 'Background' },
      { kind: 'color', key: 'color', label: 'Text color' },
      { kind: 'number', key: 'fontSize', label: 'Font size' },
      { kind: 'number', key: 'radius', label: 'Radius' },
    ],
  },
  toc: {
    type: 'toc',
    label: 'Table of contents',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'Contents',
      titleSize: 22,
      size: 11,
      lineHeight: 18,
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'number', key: 'titleSize', label: 'Title size' },
      { kind: 'number', key: 'size', label: 'Entry size' },
      { kind: 'number', key: 'lineHeight', label: 'Line height' },
      { kind: 'color', key: 'color', label: 'Entry color' },
      { kind: 'color', key: 'indexColor', label: 'Index color' },
    ],
  },
  'auto-toc': {
    type: 'auto-toc',
    label: 'Auto table of contents',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'Contents',
      titleSize: 22,
      size: 11,
      lineHeight: 20,
      indent: 12,
      dotLeader: true,
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'number', key: 'titleSize', label: 'Title size' },
      { kind: 'number', key: 'size', label: 'Entry size' },
      { kind: 'number', key: 'lineHeight', label: 'Line height' },
      { kind: 'number', key: 'indent', label: 'Indent per level (pt)' },
      { kind: 'number', key: 'maxLevel', label: 'Max level' },
      { kind: 'color', key: 'color', label: 'Entry color' },
      { kind: 'color', key: 'accent', label: 'Page-number color' },
      { kind: 'select', key: 'dotLeader', label: 'Dot leader', options: ['true', 'false'] },
    ],
  },



  signature: {
    type: 'signature',
    label: 'Signature',
    defaultProps: () => ({
      x: 24, y: 720, width: 240,
      signerName: '{{client.name}}',
      signerRole: 'Buyer signature',
      dateLabel: 'Date: ____________',
    }),
    fields: [
      { kind: 'bindable', key: 'signerName', label: 'Name' },
      { kind: 'bindable', key: 'signerRole', label: 'Role / label' },
      { kind: 'bindable', key: 'dateLabel', label: 'Date label' },
      { kind: 'number', key: 'width', label: 'Line width' },
      { kind: 'color', key: 'lineColor', label: 'Line color' },
    ],
  },
  slot: {
    type: 'slot',
    label: 'Slot reference',
    defaultProps: () => ({ slotKey: 'header' }),
    fields: [
      { kind: 'bindable', key: 'slotKey', label: 'Slot key (e.g. header, footer)' },
    ],
  },
  // ─── Compass-40 visual components (Phase 4) ────────────────────────────────
  scorecard: {
    type: 'scorecard',
    label: 'Macro Scorecard',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'Macro Investment Scorecard',
      items: [
        { category: 'Capital growth outlook', rating: 'Strong',   note: '10-yr CAGR above national median.' },
        { category: 'Rental demand',          rating: 'Strong',   note: 'Vacancy under 2%.' },
        { category: 'Infrastructure pipeline',rating: 'Moderate', note: 'Funded short-term projects.' },
        { category: 'Demographics',           rating: 'Strong',   note: 'Family-skew, growing income.' },
        { category: 'Employment depth',       rating: 'Moderate', note: 'Diverse but concentrated.' },
        { category: 'Planning risk',          rating: 'Watch',    note: 'Active rezoning nearby.' },
        { category: 'Environmental risk',     rating: 'Moderate', note: 'Climate exposure noted.' },
        { category: 'Liquidity',              rating: 'Strong',   note: 'Days-on-market below median.' },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'list-rows', key: 'items', label: 'Categories' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  'risk-register': {
    type: 'risk-register',
    label: 'Risk Register',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'Risk Register',
      items: [
        { risk: 'Flood (1-in-100)',  rating: 'Medium', confidence: 'Verified',   why: 'Property within mapped flood overlay.', ddAction: 'Order flood-risk certificate.' },
        { risk: 'Bushfire',          rating: 'Low',    confidence: 'Verified',   why: 'Outside BAL zones.',                    ddAction: 'Confirm at council.' },
        { risk: 'Heat / climate',    rating: 'Medium', confidence: 'Indicative', why: 'Rising summer extremes.',                ddAction: 'Check insulation & cooling.' },
        { risk: 'Crime — property',  rating: 'Low',    confidence: 'Verified',   why: 'Below LGA average.',                     ddAction: 'Review 12-mo BOCSAR data.' },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'list-rows', key: 'items', label: 'Risk items' },
    ],
  },
  'infra-timeline': {
    type: 'infra-timeline',
    label: 'Infrastructure Timeline',
    defaultProps: () => ({
      x: 24, y: 80, width: 547, height: 220,
      title: 'Infrastructure & Growth Pipeline',
      items: [
        { phase: 'Existing', label: 'Train station upgrade',     year: 2024, confidence: 'Verified' },
        { phase: 'Short',    label: 'New primary school',        year: 2026, confidence: 'Planned' },
        { phase: 'Medium',   label: 'Town-centre revitalisation', year: 2029, confidence: 'Planned' },
        { phase: 'Long',     label: 'Light-rail extension',      year: 2032, confidence: 'Indicative' },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'list-rows', key: 'items', label: 'Pipeline items' },
      { kind: 'number', key: 'height', label: 'Height' },
    ],
  },
  'amenity-matrix': {
    type: 'amenity-matrix',
    label: 'Amenity Matrix',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'Amenity & Livability Matrix',
      items: [
        { amenity: 'Schools',    current: '3 within 2km', future: '+1 by 2027',         relevance: 'Drives family demand.' },
        { amenity: 'Transport',  current: 'Bus + train',  future: 'Light-rail station',  relevance: 'Improves liquidity & rent.' },
        { amenity: 'Retail',     current: 'Local strip',  future: 'Town-centre revamp', relevance: 'Lifestyle premium.' },
        { amenity: 'Healthcare', current: 'GP + clinic',  future: 'No change planned',   relevance: 'Adequate for owner-occ.' },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'list-rows', key: 'items', label: 'Amenities' },
    ],
  },
  'planning-table': {
    type: 'planning-table',
    label: 'Planning Action Table',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'Zoning & Planning — Action Table',
      items: [
        { item: 'Rezoning to R3',  status: 'Lodged',   relevance: 'Could lift land value & density.', action: 'Track council decision Q3.' },
        { item: 'Heritage overlay', status: 'Approved', relevance: 'Restricts external works.',         action: 'Plan compliant cosmetic uplift.' },
        { item: 'DA for adjacent',  status: 'Pending',  relevance: 'May change view / amenity.',         action: 'Object or monitor depending on use.' },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'list-rows', key: 'items', label: 'Planning items' },
    ],
  },
  'dd-checklist': {
    type: 'dd-checklist',
    label: 'DD Checklist',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'Due-Diligence Checklist',
      items: [
        { action: 'Order Section 32 / contract review',  owner: 'Solicitor',     timing: 'Week 1', done: false },
        { action: 'Building & pest inspection',          owner: 'Buyer',         timing: 'Week 1', done: false },
        { action: 'Flood-risk certificate',              owner: 'Buyer agent',   timing: 'Week 2', done: false },
        { action: 'Finance pre-approval refresh',        owner: 'Broker',        timing: 'Week 2', done: false },
        { action: 'Rental appraisal x 2',                owner: 'Property mgr.', timing: 'Week 2', done: false },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'list-rows', key: 'items', label: 'Checklist items' },
    ],
  },
  'decision-box': {
    type: 'decision-box',
    label: 'Decision Box (What this means)',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      heading: 'What this means',
      body: 'Short, plain-English takeaway. Max 60 words. Use one per section to summarise the investor implication.',
    }),
    fields: [
      { kind: 'bindable', key: 'heading', label: 'Heading' },
      { kind: 'bindable', key: 'body', label: 'Body (≤60 words)', multiline: true },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  'strengths-watch': {
    type: 'strengths-watch',
    label: 'Strengths & Watch Points',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      strengthsTitle: 'Strengths',
      watchTitle: 'Watch Points',
      strengths: [
        'Sub-2% vacancy and growing tenant pool.',
        'Funded transport upgrade within 5 years.',
        'Family-skew demographic supporting demand.',
      ],
      watch: [
        'Active rezoning on adjacent lot.',
        'Climate / heat exposure rising.',
        'Single-employer concentration in suburb.',
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'strengthsTitle', label: 'Strengths title' },
      { kind: 'bindable', key: 'watchTitle', label: 'Watch title' },
      { kind: 'list-strings', key: 'strengths', label: 'Strengths' },
      { kind: 'list-strings', key: 'watch', label: 'Watch points' },
    ],
  },
  // ─── Phase 3 — Block library expansion ─────────────────────────────────────
  timeline: {
    type: 'timeline',
    label: 'Timeline (milestones)',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'Project timeline',
      items: [
        { label: 'Discovery', date: 'Jan 2026', note: 'Stakeholder workshops.' },
        { label: 'Design',    date: 'Mar 2026', note: 'Concept locked.' },
        { label: 'Build',     date: 'Jun 2026', note: 'Sprints 1–4.' },
        { label: 'Launch',    date: 'Sep 2026', note: 'Go-to-market.' },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'list-rows', key: 'items', label: 'Milestones' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  swot: {
    type: 'swot',
    label: 'SWOT 2×2',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'SWOT analysis',
      strengths: ['Established demand', 'Strong yield', 'Quality build'],
      weaknesses: ['Tight margins', 'Single tenant exposure'],
      opportunities: ['Rezoning upside', 'Infra pipeline'],
      threats: ['Rate-cycle risk', 'Climate exposure'],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'list-strings', key: 'strengths', label: 'Strengths' },
      { kind: 'list-strings', key: 'weaknesses', label: 'Weaknesses' },
      { kind: 'list-strings', key: 'opportunities', label: 'Opportunities' },
      { kind: 'list-strings', key: 'threats', label: 'Threats' },
    ],
  },
  gantt: {
    type: 'gantt',
    label: 'Mini Gantt',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'Delivery plan',
      startMonth: 1, endMonth: 12,
      items: [
        { label: 'Discovery', start: 1, end: 2 },
        { label: 'Design',    start: 2, end: 4 },
        { label: 'Build',     start: 4, end: 9 },
        { label: 'Launch',    start: 9, end: 10 },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'number', key: 'startMonth', label: 'Start month' },
      { kind: 'number', key: 'endMonth', label: 'End month' },
      { kind: 'list-rows', key: 'items', label: 'Tasks' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  comparison: {
    type: 'comparison',
    label: 'Comparison table',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'How we compare',
      columns: [{ label: 'Our pick' }, { label: 'Option A' }, { label: 'Option B' }],
      rows: [
        { label: 'Yield', values: ['5.8%', '4.2%', '4.0%'] },
        { label: 'Growth outlook', values: ['Strong', 'Moderate', 'Moderate'] },
        { label: 'Vacancy', values: ['1.8%', '2.4%', '2.9%'] },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'list-rows', key: 'columns', label: 'Columns' },
      { kind: 'list-rows', key: 'rows', label: 'Rows' },
      { kind: 'color', key: 'accent', label: 'Highlight' },
    ],
  },
  'stat-callout': {
    type: 'stat-callout',
    label: 'Stat callout',
    defaultProps: () => ({
      x: 24, y: 80, width: 280,
      value: '5.8%', label: 'Gross rental yield',
      delta: '+0.4 pts YoY', deltaDir: 'up',
      valueSize: 42,
    }),
    fields: [
      { kind: 'bindable', key: 'value', label: 'Value' },
      { kind: 'bindable', key: 'label', label: 'Label' },
      { kind: 'bindable', key: 'delta', label: 'Delta text' },
      { kind: 'select', key: 'deltaDir', label: 'Delta direction', options: ['up', 'down'] },
      { kind: 'number', key: 'valueSize', label: 'Value size' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  'pull-quote': {
    type: 'pull-quote',
    label: 'Pull quote',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      quote: 'The market signals are aligned for a generational entry point.',
      attribution: 'Jane Analyst',
      role: 'Senior Investment Strategist',
    }),
    fields: [
      { kind: 'bindable', key: 'quote', label: 'Quote', multiline: true },
      { kind: 'bindable', key: 'attribution', label: 'Attribution' },
      { kind: 'bindable', key: 'role', label: 'Role' },
      { kind: 'bindable', key: 'avatarUrl', label: 'Avatar URL' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  faq: {
    type: 'faq',
    label: 'FAQ list',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'Frequently asked questions',
      items: [
        { q: 'What is the expected gross yield?', a: 'Based on current comparable rents, the gross yield is forecast at 5.6–6.1%.' },
        { q: 'How long is the typical settlement?', a: '30–45 days is typical; finance pre-approval can shorten this.' },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'list-rows', key: 'items', label: 'Q & A' },
    ],
  },
  'pricing-card': {
    type: 'pricing-card',
    label: 'Pricing card',
    defaultProps: () => ({
      x: 24, y: 80, width: 240,
      badge: 'Most popular',
      tier: 'Concierge',
      price: '$9,500',
      period: '/ engagement',
      description: 'End-to-end buyer-advocacy across search, negotiation and settlement.',
      features: ['Dedicated buyer agent', 'Off-market access', 'Negotiation', 'Settlement support'],
    }),
    fields: [
      { kind: 'bindable', key: 'badge', label: 'Badge' },
      { kind: 'bindable', key: 'tier', label: 'Tier' },
      { kind: 'bindable', key: 'price', label: 'Price' },
      { kind: 'bindable', key: 'period', label: 'Period' },
      { kind: 'bindable', key: 'description', label: 'Description', multiline: true },
      { kind: 'list-strings', key: 'features', label: 'Features' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  'feature-list': {
    type: 'feature-list',
    label: 'Feature list',
    defaultProps: () => ({
      x: 24, y: 80, width: 547, columns: 2,
      title: 'Why this opportunity',
      items: [
        { icon: '★', title: 'Premium location', body: 'Walk to transport, retail and education hubs.' },
        { icon: '◆', title: 'Strong tenant pool', body: 'Family demographic with low vacancy.' },
        { icon: '✓', title: 'Future-proof', body: 'Aligned with 10-year infra pipeline.' },
        { icon: '↗', title: 'Yield + growth', body: 'Balanced risk / reward profile.' },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'number', key: 'columns', label: 'Columns', min: 1, max: 4 },
      { kind: 'list-rows', key: 'items', label: 'Features' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  'process-steps': {
    type: 'process-steps',
    label: 'Process steps',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'How it works',
      items: [
        { title: 'Discovery call', body: 'We map your brief, budget and timeline.' },
        { title: 'Shortlist & inspect', body: 'Curated properties matched to your strategy.' },
        { title: 'Negotiate & secure', body: 'Strategic offers and contract management.' },
        { title: 'Settlement support', body: 'Coordinated handover with your team.' },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'list-rows', key: 'items', label: 'Steps' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  'progress-bars': {
    type: 'progress-bars',
    label: 'Progress bars',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'Suburb scorecard',
      items: [
        { label: 'Capital growth (10y)', value: 82 },
        { label: 'Rental demand', value: 74 },
        { label: 'Infrastructure', value: 68 },
        { label: 'Risk profile (inverse)', value: 55 },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'list-rows', key: 'items', label: 'Bars' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  map: {
    type: 'map',
    label: 'Map preview',
    defaultProps: () => ({
      x: 24, y: 80, width: 547, height: 240,
      staticMapUrl: '',
      caption: '{{property.address}}',
    }),
    fields: [
      { kind: 'bindable', key: 'staticMapUrl', label: 'Static map URL' },
      { kind: 'bindable', key: 'caption', label: 'Caption' },
    ],
  },
  'icon-grid': {
    type: 'icon-grid',
    label: 'Icon grid',
    defaultProps: () => ({
      x: 24, y: 80, width: 547, columns: 4,
      title: 'Local amenities',
      items: [
        { icon: '🏫', label: 'Schools', sub: '3 within 2km' },
        { icon: '🚆', label: 'Transport', sub: 'Train + bus' },
        { icon: '🛒', label: 'Retail', sub: 'Town centre' },
        { icon: '🏥', label: 'Health', sub: 'GP + clinic' },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'number', key: 'columns', label: 'Columns', min: 1, max: 6 },
      { kind: 'list-rows', key: 'items', label: 'Items' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  testimonials: {
    type: 'testimonials',
    label: 'Testimonials',
    defaultProps: () => ({
      x: 24, y: 80, width: 547, columns: 2,
      title: 'What clients say',
      items: [
        { body: 'They unlocked an off-market deal in under three weeks.', name: 'A. Patel', role: 'Investor, Sydney' },
        { body: 'Truly white-glove. Their analysis was bank-grade.',     name: 'M. Nguyen', role: 'Investor, Brisbane' },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'number', key: 'columns', label: 'Columns', min: 1, max: 3 },
      { kind: 'list-rows', key: 'items', label: 'Testimonials' },
    ],
  },
  ribbon: {
    type: 'ribbon',
    label: 'Ribbon banner',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      label: 'Featured opportunity',
      sub: 'Strategic Insight Report — Confidential',
    }),
    fields: [
      { kind: 'bindable', key: 'label', label: 'Label' },
      { kind: 'bindable', key: 'sub', label: 'Sub label' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  'metric-delta': {
    type: 'metric-delta',
    label: 'Metric cards (delta)',
    defaultProps: () => ({
      x: 24, y: 80, width: 547, columns: 3,
      title: 'Suburb performance',
      items: [
        { label: 'Median price', value: '$1.24M', delta: '+8.4%', dir: 'up' },
        { label: 'Days on market', value: '24',  delta: '-6 days', dir: 'down' },
        { label: 'Auction clearance', value: '74%', delta: '+3 pts', dir: 'up' },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'number', key: 'columns', label: 'Columns', min: 1, max: 4 },
      { kind: 'list-rows', key: 'items', label: 'Metrics' },
    ],
  },
  'definition-list': {
    type: 'definition-list',
    label: 'Definition list',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      title: 'Key terms',
      items: [
        { term: 'LVR',  definition: 'Loan to Value Ratio — loan size as a percentage of property value.' },
        { term: 'LMI',  definition: 'Lenders Mortgage Insurance — protects the lender, not the borrower.' },
        { term: 'CGT',  definition: 'Capital Gains Tax payable on profit when selling an investment.' },
      ],
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'list-rows', key: 'items', label: 'Terms' },
    ],
  },
  sparkline: {
    type: 'sparkline',
    label: 'Sparkline + KPI',
    defaultProps: () => ({
      x: 24, y: 80, width: 240, height: 60,
      title: 'Median price (10y)',
      value: '$1.24M',
      values: [620, 660, 705, 740, 790, 845, 910, 985, 1080, 1240],
      caption: 'Source: Cotality',
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'bindable', key: 'value', label: 'Headline value' },
      { kind: 'list-strings', key: 'values', label: 'Series values' },
      { kind: 'bindable', key: 'caption', label: 'Caption' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  'before-after': {
    type: 'before-after',
    label: 'Before / After',
    defaultProps: () => ({
      x: 24, y: 80, width: 547, height: 220,
      beforeUrl: '', afterUrl: '',
    }),
    fields: [
      { kind: 'bindable', key: 'beforeUrl', label: 'Before image URL' },
      { kind: 'bindable', key: 'afterUrl', label: 'After image URL' },
    ],
  },
  'image-text': {
    type: 'image-text',
    label: 'Image + text',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      imageUrl: '{{property.imageUrl}}',
      imageSide: 'left',
      heading: 'Why this location',
      body: 'A concise narrative paragraph sits beside the imagery. Use this for storytelling sections — neighbourhood, lifestyle, vision.',
    }),
    fields: [
      { kind: 'bindable', key: 'imageUrl', label: 'Image URL' },
      { kind: 'select', key: 'imageSide', label: 'Image side', options: ['left', 'right'] },
      { kind: 'bindable', key: 'heading', label: 'Heading' },
      { kind: 'bindable', key: 'body', label: 'Body', multiline: true },
    ],
  },
  // ─── Phase 6 — data-driven blocks ──────────────────────────────────────────
  'data-grid': {
    type: 'data-grid',
    label: 'Data grid (bound)',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      dataPath: 'properties',
      columns: [
        { key: 'address', label: 'Address' },
        { key: 'suburb', label: 'Suburb' },
        { key: 'price', label: 'Price', format: 'currency', align: 'right' },
      ],
      maxRows: 20,
    }),
    fields: [
      { kind: 'bindable', key: 'dataPath', label: 'Data path (e.g. properties)' },
      { kind: 'number', key: 'maxRows', label: 'Max rows', min: 1, max: 200 },
      { kind: 'color', key: 'headerBg', label: 'Header bg' },
      { kind: 'color', key: 'stripeBg', label: 'Stripe bg' },
    ],
  },
  'pivot-table': {
    type: 'pivot-table',
    label: 'Pivot table',
    defaultProps: () => ({
      x: 24, y: 80, width: 547,
      dataPath: 'sales',
      groupBy: 'suburb',
      metric: 'price',
      aggregation: 'sum',
      format: 'currency',
      showShare: true,
    }),
    fields: [
      { kind: 'bindable', key: 'dataPath', label: 'Data path' },
      { kind: 'bindable', key: 'groupBy', label: 'Group by (row key)' },
      { kind: 'bindable', key: 'metric', label: 'Metric (row key)' },
      { kind: 'select', key: 'aggregation', label: 'Aggregation', options: ['sum', 'avg', 'count', 'min', 'max'] },
      { kind: 'select', key: 'format', label: 'Format', options: ['auto', 'currency', 'percent', 'number'] },
    ],
  },
  'chart-bar': {
    type: 'chart-bar',
    label: 'Bar chart',
    defaultProps: () => ({
      x: 24, y: 80, width: 547, height: 240,
      dataPath: 'chartData',
      labelKey: 'label', valueKey: 'value',
      orientation: 'vertical',
      title: '', caption: '',
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'bindable', key: 'dataPath', label: 'Data path' },
      { kind: 'bindable', key: 'labelKey', label: 'Label key' },
      { kind: 'bindable', key: 'valueKey', label: 'Value key' },
      { kind: 'select', key: 'orientation', label: 'Orientation', options: ['vertical', 'horizontal'] },
      { kind: 'color', key: 'accent', label: 'Accent' },
      { kind: 'bindable', key: 'caption', label: 'Caption' },
    ],
  },
  'chart-stacked-bar': {
    type: 'chart-stacked-bar',
    label: 'Stacked bar',
    defaultProps: () => ({
      x: 24, y: 80, width: 547, height: 240,
      dataPath: 'chartData', labelKey: 'label',
      stackKeys: ['a', 'b', 'c'],
      title: '',
    }),
    fields: [
      { kind: 'bindable', key: 'dataPath', label: 'Data path' },
      { kind: 'bindable', key: 'labelKey', label: 'Label key' },
      { kind: 'list-strings', key: 'stackKeys', label: 'Stack keys' },
      { kind: 'bindable', key: 'title', label: 'Title' },
    ],
  },
  'chart-line': {
    type: 'chart-line',
    label: 'Line chart',
    defaultProps: () => ({ x: 24, y: 80, width: 547, height: 240, dataPath: 'chartData', labelKey: 'label', valueKey: 'value', title: '' }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'bindable', key: 'dataPath', label: 'Data path' },
      { kind: 'bindable', key: 'labelKey', label: 'Label key' },
      { kind: 'bindable', key: 'valueKey', label: 'Value key' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  'chart-area': {
    type: 'chart-area',
    label: 'Area chart',
    defaultProps: () => ({ x: 24, y: 80, width: 547, height: 240, dataPath: 'chartData', labelKey: 'label', valueKey: 'value', title: '' }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'bindable', key: 'dataPath', label: 'Data path' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  'chart-pie': {
    type: 'chart-pie',
    label: 'Pie chart',
    defaultProps: () => ({ x: 24, y: 80, width: 547, height: 240, dataPath: 'chartData', labelKey: 'label', valueKey: 'value', title: '' }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'bindable', key: 'dataPath', label: 'Data path' },
    ],
  },
  'chart-donut': {
    type: 'chart-donut',
    label: 'Donut chart',
    defaultProps: () => ({ x: 24, y: 80, width: 547, height: 240, dataPath: 'chartData', labelKey: 'label', valueKey: 'value', title: '' }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'bindable', key: 'dataPath', label: 'Data path' },
    ],
  },
  'chart-scatter': {
    type: 'chart-scatter',
    label: 'Scatter chart',
    defaultProps: () => ({ x: 24, y: 80, width: 547, height: 240, dataPath: 'scatterData', xKey: 'x', yKey: 'y', title: '' }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'bindable', key: 'dataPath', label: 'Data path' },
      { kind: 'bindable', key: 'xKey', label: 'X key' },
      { kind: 'bindable', key: 'yKey', label: 'Y key' },
    ],
  },
  'chart-radar': {
    type: 'chart-radar',
    label: 'Radar chart',
    defaultProps: () => ({ x: 24, y: 80, width: 547, height: 280, dataPath: 'chartData', labelKey: 'label', valueKey: 'value', title: '' }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'bindable', key: 'dataPath', label: 'Data path' },
    ],
  },
  heatmap: {
    type: 'heatmap',
    label: 'Heatmap',
    defaultProps: () => ({
      x: 24, y: 80, width: 547, height: 220,
      dataPath: 'matrix',
      rowLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      colLabels: ['Wk1', 'Wk2', 'Wk3', 'Wk4'],
      title: '',
    }),
    fields: [
      { kind: 'bindable', key: 'title', label: 'Title' },
      { kind: 'bindable', key: 'dataPath', label: 'Data path (2D array)' },
      { kind: 'list-strings', key: 'rowLabels', label: 'Row labels' },
      { kind: 'list-strings', key: 'colLabels', label: 'Col labels' },
      { kind: 'color', key: 'accent', label: 'Accent' },
    ],
  },
  'kpi-strip': {
    type: 'kpi-strip',
    label: 'KPI strip (bound)',
    defaultProps: () => ({
      x: 24, y: 80, width: 547, height: 64, gap: 8,
      dataPath: 'kpis',
    }),
    fields: [
      { kind: 'bindable', key: 'dataPath', label: 'Data path' },
      { kind: 'number', key: 'gap', label: 'Gap' },
      { kind: 'color', key: 'accent', label: 'Accent' },
      { kind: 'color', key: 'tileBg', label: 'Tile bg' },
    ],
  },
  legend: {
    type: 'legend',
    label: 'Legend',
    defaultProps: () => ({
      x: 24, y: 80, width: 547, height: 32,
      items: [
        { label: 'Series A', color: '#BF9B50' },
        { label: 'Series B', color: '#7BAEFF' },
        { label: 'Series C', color: '#7BD4A7' },
      ],
      direction: 'horizontal',
    }),
    fields: [
      { kind: 'select', key: 'direction', label: 'Direction', options: ['horizontal', 'vertical'] },
    ],
  },
  free: {

    type: 'free',
    label: 'Free / overlays',
    defaultProps: () => ({}),
    fields: [],
  },
};

export function getBlockDef(type: string): BlockDef | null {
  return BLOCK_DEFS[type] ?? null;
}
