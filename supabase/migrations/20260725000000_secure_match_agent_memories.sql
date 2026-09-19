-- Run semantic-memory searches with the caller's RLS permissions so authenticated
-- users cannot select another user's memories via p_user_id.
drop function if exists public.match_agent_memories(uuid, vector, int, float);

create function public.match_agent_memories(
  p_user_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 6,
  p_min_similarity float default 0.55
)
returns table (
  id uuid, content text, tags text[], importance smallint, kind text,
  created_at timestamptz, similarity float, feedback_score int
)
language sql stable security invoker set search_path = public as $$
  with base as (
    select m.id, m.content, m.tags, m.importance, m.kind, m.created_at, m.feedback_score,
           1 - (m.embedding <=> p_query_embedding) as raw_sim
    from public.agent_semantic_memories m
    where m.user_id = p_user_id
      and m.feedback_score > -2
  ), scored as (
    select *,
      raw_sim
        + greatest(least(feedback_score, 5), -5) * 0.03
        + (importance - 3) * 0.01
        as boosted
    from base
    where raw_sim >= greatest(-1.0, least(1.0, coalesce(p_min_similarity, 0.55)))
  )
  select id, content, tags, importance, kind, created_at, raw_sim, feedback_score
  from scored
  order by boosted desc
  limit greatest(1, least(50, coalesce(p_match_count, 6)));
$$;

revoke all on function public.match_agent_memories(uuid, vector, int, float) from public;
grant execute on function public.match_agent_memories(uuid, vector, int, float) to authenticated, service_role;
