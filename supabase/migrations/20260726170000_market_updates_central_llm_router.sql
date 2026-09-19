-- Market Updates Phase 4: central LLM router assignments and safe telemetry.
-- Existing administrator-selected assignments are never overwritten.

alter table public.agent_model_assignments
  add column if not exists is_active boolean not null default true,
  add column if not exists last_tested_at timestamptz,
  add column if not exists last_test_success boolean,
  add column if not exists last_test_result text;

alter table public.market_updates
  add column if not exists route_used text,
  add column if not exists provider_attempts jsonb not null default '[]'::jsonb,
  add column if not exists fallback_used boolean not null default false,
  add column if not exists ai_latency_ms integer,
  add column if not exists ai_failure_reason text;

alter table public.market_digests
  add column if not exists model_used text,
  add column if not exists route_used text,
  add column if not exists provider_attempts jsonb not null default '[]'::jsonb,
  add column if not exists fallback_used boolean not null default false,
  add column if not exists ai_latency_ms integer,
  add column if not exists ai_failure_reason text;

alter table public.market_update_questions
  add column if not exists route_used text,
  add column if not exists provider_attempts jsonb not null default '[]'::jsonb,
  add column if not exists fallback_used boolean not null default false,
  add column if not exists ai_latency_ms integer,
  add column if not exists ai_failure_reason text;

with preferred_route as (
  select route, model_id
  from public.agent_model_assignments
  where route = 'openrouter' and coalesce(is_active, true)
  order by updated_at desc
  limit 1
), defaults(agent_key, agent_label, agent_description, temperature, max_tokens, reasoning_effort) as (
  values
    ('market_updates_classifier', 'Market Updates Classifier', 'Classifies source-backed Australian market updates.', 0.1::numeric, 1400, 'low'),
    ('market_updates_digest', 'Market Updates Digest', 'Produces source-grounded Market Updates digests.', 0.2::numeric, 2200, 'medium'),
    ('market_updates_qa_fast', 'Market Updates Q&A Fast', 'Answers straightforward grounded Market Updates questions.', 0.1::numeric, 900, 'low'),
    ('market_updates_qa_deep', 'Market Updates Q&A Deep', 'Answers complex grounded Market Updates questions.', 0.1::numeric, 1400, 'medium')
)
insert into public.agent_model_assignments (
  agent_key, agent_label, agent_category, agent_description, route, model_id,
  fallback_chain, temperature, max_tokens, reasoning_effort, is_active
)
select d.agent_key, d.agent_label, 'market_updates', d.agent_description,
       coalesce(p.route, 'gateway'),
       coalesce(p.model_id, 'google/gemini-3-flash-preview'),
       case when p.route = 'openrouter'
         then '[{"route":"gateway","model_id":"google/gemini-3-flash-preview"},{"route":"gateway","model_id":"google/gemini-2.5-flash"}]'::jsonb
         else '[{"route":"gateway","model_id":"google/gemini-2.5-flash"}]'::jsonb
       end,
       d.temperature, d.max_tokens, d.reasoning_effort, true
from defaults d
left join preferred_route p on true
on conflict (agent_key) do nothing;
