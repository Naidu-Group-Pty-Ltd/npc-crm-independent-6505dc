
drop function if exists public.match_agent_memories(uuid, vector, int, float);

alter table public.agent_messages
  add column if not exists recalled_memory_ids uuid[] not null default '{}';

alter table public.agent_semantic_memories
  add column if not exists feedback_score integer not null default 0;

create table if not exists public.agent_memory_feedback (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.agent_semantic_memories(id) on delete cascade,
  user_id uuid not null,
  message_id uuid references public.agent_messages(id) on delete set null,
  rating smallint not null check (rating in (-1, 1)),
  created_at timestamptz not null default now(),
  unique (memory_id, user_id, message_id)
);

grant select, insert, update, delete on public.agent_memory_feedback to authenticated;
grant all on public.agent_memory_feedback to service_role;

alter table public.agent_memory_feedback enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='agent_memory_feedback' and policyname='Users manage own memory feedback') then
    create policy "Users manage own memory feedback"
      on public.agent_memory_feedback for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='agent_memory_feedback' and policyname='Service role full access agent_memory_feedback') then
    create policy "Service role full access agent_memory_feedback"
      on public.agent_memory_feedback for all to service_role using (true) with check (true);
  end if;
end $$;

create index if not exists agent_memory_feedback_memory_idx
  on public.agent_memory_feedback(memory_id);

create or replace function public.agent_memory_feedback_touch()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce(NEW.memory_id, OLD.memory_id);
begin
  update public.agent_semantic_memories m
     set feedback_score = coalesce((select sum(rating)::int from public.agent_memory_feedback where memory_id = v_id), 0),
         updated_at = now()
   where m.id = v_id;
  return null;
end $$;

drop trigger if exists agent_memory_feedback_aiud on public.agent_memory_feedback;
create trigger agent_memory_feedback_aiud
after insert or update or delete on public.agent_memory_feedback
for each row execute function public.agent_memory_feedback_touch();

create or replace function public.match_agent_memories(
  p_user_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 6,
  p_min_similarity float default 0.55
)
returns table (
  id uuid, content text, tags text[], importance smallint, kind text,
  created_at timestamptz, similarity float, feedback_score int
)
language sql stable security definer set search_path = public as $$
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
    where raw_sim >= p_min_similarity
  )
  select id, content, tags, importance, kind, created_at, raw_sim, feedback_score
  from scored
  order by boosted desc
  limit p_match_count;
$$;

grant execute on function public.match_agent_memories(uuid, vector, int, float) to authenticated, service_role;

create or replace function public.prune_agent_memories(p_user_id uuid, p_max int default 500)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_total_deleted int := 0;
  v_step int := 0;
  v_now timestamptz := now();
begin
  delete from public.agent_semantic_memories
   where user_id = p_user_id and feedback_score <= -2;
  get diagnostics v_step = row_count; v_total_deleted := v_total_deleted + v_step;

  delete from public.agent_semantic_memories
   where user_id = p_user_id
     and kind = 'auto'
     and importance <= 2
     and feedback_score <= 0
     and coalesce(use_count, 0) = 0
     and last_used_at is null
     and created_at < v_now - interval '90 days';
  get diagnostics v_step = row_count; v_total_deleted := v_total_deleted + v_step;

  with ranked as (
    select id,
      (importance::float * 20)
      + (least(coalesce(use_count, 0), 20) * 5)
      + (greatest(least(feedback_score, 10), -10) * 25)
      - (extract(epoch from (v_now - created_at)) / 86400.0) * 0.4
      as value_score
    from public.agent_semantic_memories
    where user_id = p_user_id
  ), overflow as (
    select id from ranked
    order by value_score desc
    offset greatest(p_max, 1)
  )
  delete from public.agent_semantic_memories
   where id in (select id from overflow);
  get diagnostics v_step = row_count; v_total_deleted := v_total_deleted + v_step;

  return v_total_deleted;
end $$;

grant execute on function public.prune_agent_memories(uuid, int) to authenticated, service_role;
