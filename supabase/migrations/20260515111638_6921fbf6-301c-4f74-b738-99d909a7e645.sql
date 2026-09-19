create index if not exists idx_email_copilot_snippets_user_updated
on public.email_copilot_snippets (user_id, updated_at desc);

create index if not exists idx_scheduled_sends_user_status_due
on public.email_copilot_scheduled_sends (user_id, status, scheduled_for asc);

create index if not exists idx_client_reminders_assigned_status_due_gin
on public.client_reminders using gin (assigned_to);

create index if not exists idx_client_reminders_status_due
on public.client_reminders (status, due_date asc);

analyze public.email_copilot_snippets;
analyze public.email_copilot_scheduled_sends;
analyze public.client_reminders;
analyze public.user_sessions;
analyze public.custom_users;