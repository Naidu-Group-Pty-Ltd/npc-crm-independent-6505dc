-- Market Updates Q&A — deep research.
--
-- Three things were capping answer depth in the database layer:
--   1. `market_updates.embedding` has been populated hourly since Phase 6 and
--      indexed with ivfflat, but nothing ever queried it — the Q&A endpoint ran
--      ILIKE and labelled the result "vector". This adds the matcher.
--   2. The Q&A agent keys carried max_tokens of 900/1400, which is a hard
--      ceiling on how much analysis can come back regardless of prompt.
--   3. Answer turns had nowhere to record depth, plan or per-audience analysis.

-- 1. Semantic matcher over the existing embedding column ---------------------
-- SECURITY DEFINER so it can read the column behind RLS, but it hard-filters to
-- published, non-archived rows: it can never widen what a caller may already
-- read through the Q&A endpoint.
create or replace function public.match_market_updates(
  query_embedding vector(1536),
  match_count integer default 30,
  match_threshold double precision default 0.15,
  p_segment text default null
)
returns table (id uuid, similarity double precision)
language sql
stable
security definer
set search_path = public
as $$
  select mu.id,
         (1 - (mu.embedding <=> query_embedding))::double precision as similarity
  from public.market_updates mu
  where mu.embedding is not null
    and mu.status = 'published'
    and mu.archived_at is null
    and (p_segment is null or mu.segments @> jsonb_build_array(p_segment))
    and (1 - (mu.embedding <=> query_embedding)) > match_threshold
  order by mu.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 30), 100));
$$;

revoke all on function public.match_market_updates(vector, integer, double precision, text) from public, anon;
grant execute on function public.match_market_updates(vector, integer, double precision, text) to service_role;

comment on function public.match_market_updates(vector, integer, double precision, text) is
  'Cosine nearest-neighbour search over published Market Updates embeddings. Used by market-updates-qa deep research retrieval.';

-- 2. Answer-turn telemetry ---------------------------------------------------
alter table public.market_update_questions
  add column if not exists depth_mode text,
  add column if not exists research_plan jsonb not null default '{}'::jsonb,
  add column if not exists implications jsonb not null default '{}'::jsonb,
  add column if not exists timeline jsonb not null default '[]'::jsonb,
  add column if not exists watch_items jsonb not null default '[]'::jsonb,
  add column if not exists contrarian_view text,
  add column if not exists retrieval_strategies jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'market_update_questions_depth_mode_check'
  ) then
    alter table public.market_update_questions
      add constraint market_update_questions_depth_mode_check
      check (depth_mode is null or depth_mode in ('brief','standard','deep'));
  end if;
end $$;

-- 3. Agent assignments -------------------------------------------------------
-- The planner is deliberately small and cheap; the research/narrative keys are
-- where the token budget goes. Existing administrator choices are preserved —
-- only the starved token ceilings on the two original keys are lifted, and only
-- where they still sit at their seeded values.
with preferred_route as (
  select route, model_id
  from public.agent_model_assignments
  where route = 'openrouter' and coalesce(is_active, true)
  order by updated_at desc
  limit 1
), defaults(agent_key, agent_label, agent_description, temperature, max_tokens, reasoning_effort) as (
  values
    ('market_updates_qa_planner', 'Market Updates Q&A Planner', 'Repairs and decomposes a market question into parallel retrieval queries.', 0.0::numeric, 700, 'low'),
    ('market_updates_qa_research', 'Market Updates Q&A Research', 'Extracts structured evidence, figures and per-audience implications from retrieved updates.', 0.1::numeric, 3200, 'medium'),
    ('market_updates_qa_narrative', 'Market Updates Q&A Narrative', 'Streams the long-form grounded market analysis shown to the user.', 0.25::numeric, 6000, 'medium')
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

-- Lift the seeded ceilings that were truncating answers. Guarded on the exact
-- seeded values so an administrator who has already tuned these keeps their setting.
update public.agent_model_assignments set max_tokens = 2000
  where agent_key = 'market_updates_qa_fast' and max_tokens = 900;
update public.agent_model_assignments set max_tokens = 4000
  where agent_key = 'market_updates_qa_deep' and max_tokens = 1400;
