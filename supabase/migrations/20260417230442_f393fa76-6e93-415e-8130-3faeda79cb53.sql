
-- Seed agent_model_assignments for analytical agents being migrated to llmRouter
INSERT INTO public.agent_model_assignments
  (agent_key, agent_label, agent_description, agent_category, route, model_id, fallback_chain, temperature, max_tokens, reasoning_effort)
VALUES
  ('meta_ads_digest', 'Meta Ads Daily Digest', 'Generates the executive summary digest for Meta Ads daily performance.', 'marketing', 'gateway', 'google/gemini-3-flash-preview',
    '[{"route":"gateway","model_id":"google/gemini-2.5-flash"},{"route":"gateway","model_id":"openai/gpt-5-mini"}]'::jsonb, 0.4, 4000, NULL),
  ('meta_ads_strategy', 'Meta Ads Strategy Advisor', 'Phase 2 budget/audience strategy recommendations for Meta Ads.', 'marketing', 'gateway', 'google/gemini-3-flash-preview',
    '[{"route":"gateway","model_id":"google/gemini-2.5-flash"},{"route":"gateway","model_id":"openai/gpt-5-mini"}]'::jsonb, 0.4, 4000, NULL),
  ('meta_ads_lead_quality', 'Meta Ads Lead Quality Analyst', 'Phase 2 lead-quality-by-source analyst.', 'marketing', 'gateway', 'google/gemini-3-flash-preview',
    '[{"route":"gateway","model_id":"google/gemini-2.5-flash"}]'::jsonb, 0.3, 1500, NULL),
  ('meta_ads_forecast', 'Meta Ads Forecast & Risk', 'Phase 3 forecasting and anomaly synthesis.', 'marketing', 'gateway', 'google/gemini-2.5-flash',
    '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"},{"route":"gateway","model_id":"openai/gpt-5-mini"}]'::jsonb, 0.4, 4000, NULL),
  ('meta_ads_benchmarks', 'Meta Ads Benchmark Extractor', 'Phase 4 benchmark + market events structured extractor.', 'marketing', 'gateway', 'google/gemini-2.5-flash',
    '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb, 0.3, 4000, NULL),
  ('chart_analysis', 'Chart Analysis Generator', 'Produces inline chart commentary for investment reports.', 'reports', 'gateway', 'openai/gpt-5-mini',
    '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"},{"route":"gateway","model_id":"google/gemini-2.5-flash"}]'::jsonb, 0.7, 500, NULL),
  ('market_intelligence_writer', 'Market Intelligence Report Writer', 'Long-form premium client market intelligence report writer.', 'reports', 'gateway', 'google/gemini-2.5-flash',
    '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"},{"route":"gateway","model_id":"openai/gpt-5"}]'::jsonb, 0.3, 6000, NULL),
  ('market_intelligence_events', 'Market Intelligence Event Extractor', 'Structured market events extractor.', 'reports', 'gateway', 'google/gemini-2.5-flash',
    '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb, 0.2, 4000, NULL)
ON CONFLICT (agent_key) DO UPDATE SET
  agent_label = EXCLUDED.agent_label,
  agent_description = EXCLUDED.agent_description,
  agent_category = EXCLUDED.agent_category,
  fallback_chain = EXCLUDED.fallback_chain,
  updated_at = now();
