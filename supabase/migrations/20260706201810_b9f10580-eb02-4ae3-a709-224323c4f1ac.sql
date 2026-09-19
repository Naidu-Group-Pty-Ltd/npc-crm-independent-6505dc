
-- Phase 4: Semantic memory / RAG for Aurixa agent
create extension if not exists vector;

create table if not exists public.agent_semantic_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid,
  kind text not null default 'auto',              -- 'auto' | 'explicit' | 'summary'
  content text not null,
  content_hash text not null,
  tags text[] not null default '{}',
  importance smallint not null default 3,          -- 1..5, 5 = most important
  embedding vector(1536) not null,
  source_message_id uuid,
  last_used_at timestamptz,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, content_hash)
);

create index if not exists agent_semantic_memories_user_idx
  on public.agent_semantic_memories (user_id, created_at desc);

create index if not exists agent_semantic_memories_embedding_idx
  on public.agent_semantic_memories using hnsw (embedding vector_cosine_ops);

grant select, insert, update, delete on public.agent_semantic_memories to authenticated;
grant all on public.agent_semantic_memories to service_role;

alter table public.agent_semantic_memories enable row level security;

create policy "Users manage own semantic memories"
  on public.agent_semantic_memories
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Service role full access agent_semantic_memories"
  on public.agent_semantic_memories
  for all
  to service_role
  using (true) with check (true);

create trigger agent_semantic_memories_touch_updated_at
  before update on public.agent_semantic_memories
  for each row execute function public.update_updated_at_column();

-- Similarity search RPC (scoped per user)
create or replace function public.match_agent_memories(
  p_user_id uuid,
  p_query_embedding vector(1536),
  p_match_count int default 6,
  p_min_similarity float default 0.55
)
returns table (
  id uuid,
  content text,
  tags text[],
  importance smallint,
  kind text,
  created_at timestamptz,
  similarity float
)
language sql stable security definer set search_path = public as $$
  select
    m.id,
    m.content,
    m.tags,
    m.importance,
    m.kind,
    m.created_at,
    1 - (m.embedding <=> p_query_embedding) as similarity
  from public.agent_semantic_memories m
  where m.user_id = p_user_id
    and (1 - (m.embedding <=> p_query_embedding)) >= p_min_similarity
  order by m.embedding <=> p_query_embedding
  limit p_match_count;
$$;

grant execute on function public.match_agent_memories(uuid, vector, int, float) to authenticated, service_role;
