alter table public.market_update_questions
  add column if not exists conversation_id uuid null,
  add column if not exists follow_up_questions jsonb not null default '[]'::jsonb,
  add column if not exists key_figures jsonb not null default '[]'::jsonb,
  add column if not exists time_horizon text null,
  add column if not exists sentiment text null,
  add column if not exists model_used text null;

create index if not exists market_update_questions_conv_idx
  on public.market_update_questions (conversation_id, created_at desc);