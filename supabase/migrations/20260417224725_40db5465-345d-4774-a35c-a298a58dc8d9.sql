-- =====================================================================
-- PHASE 1: Dynamic Model Management Foundation
-- =====================================================================

-- 1. Agent → Model assignments registry
CREATE TABLE public.agent_model_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text NOT NULL UNIQUE,
  agent_label text NOT NULL,
  agent_category text NOT NULL DEFAULT 'agent',
  agent_description text,
  route text NOT NULL DEFAULT 'gateway',
  model_id text NOT NULL,
  fallback_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  temperature numeric,
  max_tokens integer,
  reasoning_effort text,
  is_locked boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  last_error text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_route_valid CHECK (route IN ('gateway', 'native', 'openrouter'))
);

CREATE INDEX idx_agent_assignments_category ON public.agent_model_assignments(agent_category);

ALTER TABLE public.agent_model_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on agent_model_assignments"
  ON public.agent_model_assignments FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

CREATE TRIGGER update_agent_model_assignments_updated_at
  BEFORE UPDATE ON public.agent_model_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Live model catalog cache (probed from each provider)
CREATE TABLE public.model_catalog_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  route text NOT NULL,
  model_id text NOT NULL,
  display_name text,
  status text NOT NULL DEFAULT 'available',
  context_window integer,
  capabilities text[] DEFAULT '{}',
  pricing_input_per_1m numeric,
  pricing_output_per_1m numeric,
  raw_metadata jsonb DEFAULT '{}'::jsonb,
  last_probed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  probe_error text,
  CONSTRAINT model_status_valid CHECK (status IN ('available', 'preview', 'deprecated', 'unavailable')),
  CONSTRAINT model_route_valid CHECK (route IN ('gateway', 'native', 'openrouter')),
  UNIQUE (provider, route, model_id)
);

CREATE INDEX idx_model_catalog_route ON public.model_catalog_cache(route, status);
CREATE INDEX idx_model_catalog_provider ON public.model_catalog_cache(provider);

ALTER TABLE public.model_catalog_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on model_catalog_cache"
  ON public.model_catalog_cache FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- 3. Per-provider integration settings
CREATE TABLE public.llm_integration_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT false,
  monthly_spend_cap_usd numeric,
  last_test_at timestamptz,
  last_test_success boolean,
  last_test_error text,
  metadata jsonb DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.llm_integration_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on llm_integration_settings"
  ON public.llm_integration_settings FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

CREATE TRIGGER update_llm_integration_settings_updated_at
  BEFORE UPDATE ON public.llm_integration_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Seed agent assignments with current production defaults
INSERT INTO public.agent_model_assignments (agent_key, agent_label, agent_category, agent_description, route, model_id, fallback_chain) VALUES
  ('bc_scenario_agent',          'BC What-If Scenario Agent',     'agent',      'Borrowing capacity scenario modeling and recommendations',                'gateway', 'google/gemini-3.1-pro-preview',  '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"},{"route":"gateway","model_id":"google/gemini-2.5-pro"},{"route":"gateway","model_id":"google/gemini-2.5-flash"}]'::jsonb),
  ('report_qa',                  'Report QA Agent',                'agent',      'Reviews investment reports for accuracy, tone, and integrity',           'gateway', 'google/gemini-3.1-pro-preview',  '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"},{"route":"gateway","model_id":"google/gemini-2.5-pro"}]'::jsonb),
  ('dashboard_agent',            'Oryxa Dashboard Agent',          'agent',      'Conversational AI agent for dashboard operations and tool calls',        'gateway', 'google/gemini-3-flash-preview',  '[{"route":"gateway","model_id":"google/gemini-2.5-flash"},{"route":"gateway","model_id":"google/gemini-2.5-pro"}]'::jsonb),
  ('email_copilot',              'Email Copilot',                  'agent',      'Drafts and triages emails using client context',                         'native',  'gpt-4o-mini',                    '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"},{"route":"gateway","model_id":"google/gemini-2.5-flash"}]'::jsonb),
  ('user_guide_assistant',       'User Guide Assistant',           'agent',      'In-app help assistant',                                                  'gateway', 'google/gemini-3-flash-preview',  '[{"route":"gateway","model_id":"google/gemini-2.5-flash"}]'::jsonb),
  ('investment_report_primary',  'Investment Report Generator',    'report',     'Primary narrative generator for investment reports',                     'gateway', 'google/gemini-2.5-pro',          '[{"route":"gateway","model_id":"google/gemini-3.1-pro-preview"},{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('investment_report_qualitative','Investment Report Qualitative Pass','report','Regenerates qualitative sections of investment reports',                  'gateway', 'google/gemini-2.5-pro',          '[{"route":"gateway","model_id":"google/gemini-3.1-pro-preview"},{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('investment_report_condense', 'Investment Report Condensor',    'report',     'Condenses long reports into executive summaries',                        'gateway', 'google/gemini-2.5-flash',        '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('report_comparison',          'Report Comparison Engine',       'report',     'Compares two or more investment reports',                                'gateway', 'google/gemini-2.5-pro',          '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('cash_flow_comparison',       'Cash Flow Comparison Engine',    'report',     'Compares cash flow projections across properties',                       'gateway', 'google/gemini-2.5-pro',          '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('comparison_formatter',       'Comparison Report Formatter',    'report',     'Formats comparison output for PDF',                                      'gateway', 'google/gemini-2.5-flash',        '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('portfolio_analysis',         'Portfolio Analysis',             'report',     'Generates portfolio review narratives',                                  'gateway', 'google/gemini-2.5-pro',          '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('market_intelligence',        'Market Intelligence Report',     'report',     'Generates market intelligence reports with live data',                   'native',  'sonar-pro',                      '[{"route":"native","model_id":"sonar"},{"route":"gateway","model_id":"google/gemini-2.5-pro"}]'::jsonb),
  ('chart_analysis',             'Chart Analysis',                 'extraction', 'Generates analytical commentary for embedded report charts',             'native',  'gpt-4o-mini',                    '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('pdf_property_extraction',    'PDF Property Extraction',        'extraction', 'Extracts structured property data from listing PDFs',                    'native',  'gpt-4o',                         '[{"route":"gateway","model_id":"google/gemini-2.5-pro"}]'::jsonb),
  ('pdf_vownet_extraction',      'VowNet PDF Extraction',          'extraction', 'Extracts client + property data from VowNet PDF exports',                'native',  'gpt-4o',                         '[{"route":"gateway","model_id":"google/gemini-2.5-pro"}]'::jsonb),
  ('template_parsing',           'Template Document Parsing',      'extraction', 'Parses uploaded template documents for structure and tone',              'gateway', 'google/gemini-2.5-pro',          '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('template_retrieval',         'Template Context Retrieval',     'extraction', 'Retrieves relevant template context for generation',                     'gateway', 'google/gemini-2.5-flash',        '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('listing_scrape',             'Property Listing Scraper',       'extraction', 'Cleans and structures scraped listing HTML',                             'gateway', 'google/gemini-2.5-flash',        '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('expense_estimation',         'Property Expense Estimator',     'extraction', 'Estimates ownership expenses from property attributes',                  'gateway', 'google/gemini-2.5-flash',        '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('transcript_cleaning',        'Call Transcript Cleaner',        'extraction', 'Cleans VAPI call transcripts and extracts notes',                        'native',  'gpt-4o-mini',                    '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('vapi_call_summary',          'Call Summary Generator',         'extraction', 'Summarizes VAPI calls for CRM logging',                                  'native',  'gpt-4o-mini',                    '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('meta_ads_analysis',          'Meta Ads Analysis',              'agent',      'Analyzes Meta ad performance across phases',                             'gateway', 'google/gemini-2.5-pro',          '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('rba_data_service',           'RBA Data Interpreter',           'extraction', 'Interprets RBA economic data for narrative use',                         'gateway', 'google/gemini-2.5-flash',        '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('chart_image_generation',     'Chart Image Generator',          'extraction', 'Generates and styles chart images',                                      'gateway', 'google/gemini-2.5-flash',        '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"}]'::jsonb),
  ('agent_task_runner',          'Scheduled Agent Task Runner',    'agent',      'Executes scheduled agent playbooks',                                     'gateway', 'google/gemini-3-flash-preview',  '[{"route":"gateway","model_id":"google/gemini-2.5-flash"}]'::jsonb),
  ('default',                    'Default Fallback',               'agent',      'Catch-all assignment when no specific agent_key matches',                'gateway', 'google/gemini-3-flash-preview',  '[{"route":"gateway","model_id":"google/gemini-2.5-flash"}]'::jsonb);

-- 5. Seed integration settings rows for known providers
INSERT INTO public.llm_integration_settings (provider, is_enabled) VALUES
  ('lovable_gateway', true),
  ('openai',          true),
  ('anthropic',       false),
  ('gemini',          false),
  ('perplexity',      true),
  ('openrouter',      false);