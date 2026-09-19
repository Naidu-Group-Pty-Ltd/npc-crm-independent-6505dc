/**
 * Block types the production HTML/WeasyPrint renderer supports.
 *
 * This is a verbatim copy of `PRODUCTION_SAFE_BLOCK_TYPES` in
 * `supabase/functions/manage-templates/index.ts`. It is duplicated rather than
 * imported because `manage-templates` is the live Template Builder write path
 * and is deliberately not being modified — refactoring a working broker to
 * export a constant is exactly the kind of incidental change that turns a
 * template-library bug into a Builder outage.
 *
 * The two copies are locked together by
 * `src/lib/templateLibrary/__tests__/productionBlockParity.spec.ts`, which
 * reads both files and fails if the sets diverge. If you edit one, edit both.
 */
export const PRODUCTION_SAFE_BLOCK_TYPES = new Set([
  'free',
  'disclaimer',
  'hero',
  'kpi-grid',
  'data-table',
  'chart',
  'image',
  'text-block',
  'text',
  'footer',
  'cover',
  'divider',
  'callout',
  'two-column',
  'gallery',
  'page-number',
  'spacer',
  'qr',
  'badge-list',
  'toc',
  'signature',
  'slot',
  'scorecard',
  'risk-register',
  'infra-timeline',
  'amenity-matrix',
  'planning-table',
  'dd-checklist',
  'decision-box',
  'strengths-watch',
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
  'definition-list',
  'sparkline',
  'before-after',
  'image-text',
  'data-grid',
  'pivot-table',
  'chart-bar',
  'chart-stacked-bar',
  'chart-line',
  'chart-area',
  'chart-pie',
  'chart-donut',
  'chart-scatter',
  'chart-radar',
  'heatmap',
  'kpi-strip',
  'legend',
  'auto-toc',
  // Takes Markdown *source* and renders it itself through the programme's
  // escape-first renderer, so it cannot emit markup the author of the content
  // chose. That is what makes it admissible here: this list is a security
  // boundary, and a block that accepted rendered HTML would be a hole in it for
  // exactly the content least able to be trusted. See `markdownBlock.html.ts`.
  'markdown-block',
]);

/**
 * Report types with a production Template Builder adapter.
 *
 * Verbatim copy of `PRODUCTION_REPORT_TEMPLATE_TYPES` in `manage-templates`,
 * for the same reason and under the same parity test. A library entry whose
 * report type is outside this set can still be browsed, previewed and copied —
 * the copy simply cannot be activated for live report generation, which is
 * surfaced honestly on the card rather than discovered at activation time.
 */
export const PRODUCTION_REPORT_TEMPLATE_TYPES = new Set([
  'investment',
  'compass',
  'investment_compass',
  'investment_report',
  'property_investment',
  // Borrowing Capacity gained a real adapter reading
  // `borrowing_capacity_assessments` — a typed 35-column table with 143 rows.
  // Both spellings are listed because this set matches the raw `report_type`
  // and does not run it through the client registry's alias map.
  'borrowing_capacity',
  'borrowing',
  // Portfolio Performance Review reads `portfolio_analysis_reports`.
  'portfolio',
  // Property Comparison Analysis reads `property_comparisons`, through the
  // normaliser its own render route uses.
  'comparison',
  // Client Details reads nine `client_*` tables through the normaliser the
  // format's own render route uses. `formara` is the legacy generator's name
  // for the same document and reaches the same adapter, so a template stored
  // under it is activatable rather than stranded.
  'client_details',
  'formara',
  // 10 Year Cash Flow reads the stored `financial_calculations.projections` on
  // `investment_reports`; `cash_flow_analyses` holds 0 rows by design. Its
  // adapter returns null for the 1,020 reports that store no series, so a
  // template being activatable for the type does not make every report render.
  'cashflow',
  'cash_flow',
  // Report Q&A reads `report_qa_conversations` / `report_qa_messages` through
  // the normaliser its own render route uses. Activatable since `markdown-block`
  // gave the vocabulary a way to set model-authored Markdown as structure; the
  // flowing route stays the default for a long transcript, because a template is
  // a fixed page sequence and carries the first exchanges.
  'qa',
  // Commercial & Industrial Capacity reads the stored calculation run through
  // the normaliser its own render route uses, and defers to that route's
  // `isReportable` so a template cannot produce a document the route refuses.
  'commercial_capacity',
  'commercial_industrial',
  // Market Intelligence reads `marketing_intelligence_reports` through the
  // normaliser its own route uses, so the three editorial strips are applied
  // before a word reaches a page.
  'market_intelligence',
]);
