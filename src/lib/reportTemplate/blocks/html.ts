/**
 * HTML block-renderer registry — mirror of `blocks/index.ts` for the
 * WeasyPrint pipeline. One entry per block type.
 */
import type { Block } from '../templateSchema';
import type { HtmlBlockContext, HtmlBlockRenderer } from './_shared.html';
import { registerChartOverlayRenderers } from './_shared.html';
import { renderCoverHtml } from './cover.html';
import { renderTextBlockHtml } from './textBlock.html';
import { renderMarkdownBlockHtml } from './markdownBlock.html';
import { renderKpiGridHtml } from './kpiGrid.html';
import { renderDataTableHtml } from './dataTable.html';
import { renderDividerHtml } from './divider.html';
import { renderSpacerHtml } from './spacer.html';
import { renderFooterHtml } from './footer.html';
import { renderPageNumberHtml } from './pageNumber.html';
import { renderHeroHtml } from './hero.html';
import { renderChartHtml } from './chart.html';
import { renderImageBlockHtml } from './image.html';
import { renderGalleryHtml } from './gallery.html';
import { renderCalloutHtml } from './callout.html';
import { renderTwoColumnHtml } from './twoColumn.html';
import { renderBadgeListHtml } from './badgeList.html';
import { renderTocHtml } from './toc.html';
import { renderSignatureHtml } from './signature.html';
import { renderSlotHtml } from './slot.html';
import { renderDisclaimerHtml } from './disclaimer.html';
import { renderQrCodeHtml } from './qrCode.html';
import { renderScorecardHtml } from './scorecard.html';
import { renderStrengthsWatchHtml } from './strengthsWatch.html';
import { renderRiskRegisterHtml } from './riskRegister.html';
import { renderDecisionBoxHtml } from './decisionBox.html';
import { renderDDChecklistHtml } from './ddChecklist.html';
import { renderInfraTimelineHtml } from './infraTimeline.html';
import { renderPlanningTableHtml } from './planningTable.html';
import { renderAmenityMatrixHtml } from './amenityMatrix.html';
import {
  renderTimelineHtml,
  renderSwotHtml,
  renderGanttHtml,
  renderComparisonHtml,
  renderStatCalloutHtml,
  renderPullQuoteHtml,
  renderFaqHtml,
  renderPricingCardHtml,
  renderFeatureListHtml,
  renderProcessStepsHtml,
  renderProgressBarsHtml,
  renderMapHtml,
  renderIconGridHtml,
  renderTestimonialsHtml,
  renderRibbonHtml,
  renderMetricDeltaHtml,
  renderDefinitionListHtml,
  renderSparklineHtml,
  renderBeforeAfterHtml,
  renderImageTextHtml,
} from './extras.html';
import { renderDataGridHtml, renderPivotTableHtml } from './dataGrid.html';
import {
  renderBarChartHtml,
  renderLineChartHtml,
  renderAreaChartHtml,
  renderPieChartHtml,
  renderDonutChartHtml,
  renderScatterChartHtml,
  renderRadarChartHtml,
  renderHeatmapHtml,
  renderKpiStripHtml,
  renderLegendHtml,
  renderStackedBarChartHtml,
} from './charts.html';
import { renderAutoTocHtml } from './autoToc.html';




const HTML_RENDERERS: Record<string, HtmlBlockRenderer> = {
  cover: renderCoverHtml,
  'text-block': renderTextBlockHtml,
  text: renderTextBlockHtml,
  'markdown-block': renderMarkdownBlockHtml,
  'kpi-grid': renderKpiGridHtml,
  'data-table': renderDataTableHtml,
  divider: renderDividerHtml,
  spacer: renderSpacerHtml,
  footer: renderFooterHtml,
  'page-number': renderPageNumberHtml,
  hero: renderHeroHtml,
  chart: renderChartHtml,
  image: renderImageBlockHtml,
  gallery: renderGalleryHtml,
  callout: renderCalloutHtml,
  'two-column': renderTwoColumnHtml,
  'badge-list': renderBadgeListHtml,
  toc: renderTocHtml,
  signature: renderSignatureHtml,
  slot: renderSlotHtml,
  disclaimer: renderDisclaimerHtml,
  qr: renderQrCodeHtml,
  scorecard: renderScorecardHtml,
  'strengths-watch': renderStrengthsWatchHtml,
  'risk-register': renderRiskRegisterHtml,
  'decision-box': renderDecisionBoxHtml,
  'dd-checklist': renderDDChecklistHtml,
  'infra-timeline': renderInfraTimelineHtml,
  'planning-table': renderPlanningTableHtml,
  'amenity-matrix': renderAmenityMatrixHtml,
  // Phase 3 expansion ─────────────────────────────────────────────────────────
  timeline: renderTimelineHtml,
  swot: renderSwotHtml,
  gantt: renderGanttHtml,
  comparison: renderComparisonHtml,
  'stat-callout': renderStatCalloutHtml,
  'pull-quote': renderPullQuoteHtml,
  faq: renderFaqHtml,
  'pricing-card': renderPricingCardHtml,
  'feature-list': renderFeatureListHtml,
  'process-steps': renderProcessStepsHtml,
  'progress-bars': renderProgressBarsHtml,
  map: renderMapHtml,
  'icon-grid': renderIconGridHtml,
  testimonials: renderTestimonialsHtml,
  ribbon: renderRibbonHtml,
  'metric-delta': renderMetricDeltaHtml,
  'definition-list': renderDefinitionListHtml,
  sparkline: renderSparklineHtml,
  'before-after': renderBeforeAfterHtml,
  'image-text': renderImageTextHtml,
  // Phase 6 — data-driven blocks ──────────────────────────────────────────────
  'data-grid': renderDataGridHtml,
  'pivot-table': renderPivotTableHtml,
  'chart-bar': renderBarChartHtml,
  'chart-stacked-bar': renderStackedBarChartHtml,
  'chart-line': renderLineChartHtml,
  'chart-area': renderAreaChartHtml,
  'chart-pie': renderPieChartHtml,
  'chart-donut': renderDonutChartHtml,
  'chart-scatter': renderScatterChartHtml,
  'chart-radar': renderRadarChartHtml,
  heatmap: renderHeatmapHtml,
  'kpi-strip': renderKpiStripHtml,
  legend: renderLegendHtml,
  'auto-toc': renderAutoTocHtml,
  // 'free' blocks have no body — only overlays — and render as nothing.
  free: () => '',

};

export function getHtmlBlockRenderer(type: string): HtmlBlockRenderer | undefined {
  return HTML_RENDERERS[type];
}

// W3 — let the chart OVERLAY renderer in `_shared.html.ts` reach these same
// functions. It cannot import them directly (charts.html.ts imports
// _shared.html.ts), and duplicating chart drawing code to dodge that cycle
// would put imported charts and authored charts on renderers that drift apart.
// This module already imports both sides, so it is the right place to bind.
registerChartOverlayRenderers((kind) => HTML_RENDERERS[`chart-${kind}`] ?? null);

export function htmlBlockTypes(): string[] {
  return Object.keys(HTML_RENDERERS);
}

export type { HtmlBlockContext, HtmlBlockRenderer };

/** Fallback for unsupported block types. */
export function renderUnsupportedHtml(block: Block, _ctx: HtmlBlockContext): string {
  return `<div style="position:absolute;left:24pt;top:24pt;padding:8pt 12pt;background:#FFF4D6;border:1pt dashed #BF9B50;color:#7A5B00;font-size:9pt;font-family:Helvetica;">
    Block type "<strong>${block.type}</strong>" has no HTML renderer.
  </div>`;
}
