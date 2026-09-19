-- Report render coverage — one view answering "which engine produced every
-- document", the number docs/reports/COVERAGE.md existed to compute by hand.
--
-- Three sources, deliberately non-overlapping:
--
--   * the nine per-format `*_renders` ledgers — authoritative for the
--     design-system composer routes (each route writes its row server-side);
--   * `template_render_jobs` — authoritative for the white-label template
--     route (`render-template-pdf` writes it before the engine runs);
--   * `activity_logs` rows that carry `metadata->>'engine'` — the coverage
--     events the client writes (src/lib/reports/renderEvent.ts and the
--     auto-tag in src/lib/secureInvoke.ts). Server-route engines are
--     EXCLUDED on this leg because their ledgers above already count them;
--     what this leg contributes is everything that has no ledger: the
--     browser generators, print views, flatten copies, re-served stored
--     PDFs, and the legacy investment route (which writes no ledger).
--
-- Reading it: the view is created WITH (security_invoker = on), so it opens
-- only to roles that can already read the underlying tables — the SQL editor
-- and service-role jobs. `activity_logs` is deliberately not readable by app
-- roles (security phase 7), and an analytics view must not become the hole in
-- that.
--
-- The weekly question COVERAGE.md asks becomes:
--   select date_trunc('week', occurred_at) wk, format, engine, count(*)
--   from public.report_render_coverage group by 1,2,3 order by 1 desc, 4 desc;

create or replace view public.report_render_coverage
with (security_invoker = on) as
  select created_at as occurred_at, 'borrowing_capacity' as format,
         'design_composer' as engine, 'render-borrowing-capacity-pdf' as source,
         assessment_id::text as ref_id, requested_by::text as actor
    from public.borrowing_capacity_renders where status = 'succeeded'
  union all
  select created_at, 'cashflow', 'design_composer', 'render-cash-flow-pdf',
         report_id::text, requested_by::text
    from public.cash_flow_renders where status = 'succeeded'
  union all
  select created_at, 'cash_flow_comparison', 'design_composer', 'render-cash-flow-comparison-pdf',
         primary_report_id::text, requested_by::text
    from public.cash_flow_comparison_renders where status = 'succeeded'
  union all
  select created_at, 'client_details', 'design_composer', 'render-client-details-pdf',
         client_id::text, requested_by::text
    from public.client_details_renders where status = 'succeeded'
  union all
  select created_at, 'commercial_capacity', 'design_composer', 'render-commercial-capacity-pdf',
         assessment_id::text, requested_by::text
    from public.commercial_industrial_report_renders where status = 'succeeded'
  union all
  select created_at, 'market_intelligence', 'design_composer', 'render-market-intelligence-pdf',
         report_id::text, requested_by::text
    from public.market_intelligence_renders where status = 'succeeded'
  union all
  select created_at, 'portfolio', 'design_composer', 'render-portfolio-review-pdf',
         report_id::text, requested_by::text
    from public.portfolio_review_renders where status = 'succeeded'
  union all
  select created_at, 'comparison', 'design_composer', 'render-property-comparison-pdf',
         comparison_id::text, requested_by::text
    from public.property_comparison_renders where status = 'succeeded'
  union all
  select created_at, 'qa', 'design_composer', 'render-report-qa-pdf',
         conversation_id::text, requested_by::text
    from public.report_qa_renders where status = 'succeeded'
  union all
  select j.created_at, coalesce(rt.report_type, 'unknown'),
         'template', coalesce(j.template_name, 'render-template-pdf'),
         j.template_id::text, j.requested_by::text
    from public.template_render_jobs j
    left join public.report_templates rt on rt.id = j.template_id
   where j.status = 'succeeded'
  union all
  select created_at,
         coalesce(nullif(metadata->>'format', ''), 'unknown'),
         metadata->>'engine',
         coalesce(nullif(metadata->>'source', ''), 'unlabelled'),
         coalesce(entity_id::text, metadata->>'report_ref'),
         coalesce(username, user_id::text)
    from public.activity_logs
   where action_type = 'report_pdf_downloaded'
     and metadata ? 'engine'
     and metadata->>'engine' not in ('template', 'design_composer');

comment on view public.report_render_coverage is
  'Every produced report document, tagged by the engine that made it. '
  'Ledgers count the server routes; activity engine-events count everything '
  'ledgerless (browser generators, print views, stored copies, the legacy '
  'investment route). See docs/reports/COVERAGE.md.';
