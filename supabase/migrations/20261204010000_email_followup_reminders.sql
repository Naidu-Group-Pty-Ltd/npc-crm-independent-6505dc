-- ============================================================
-- "Remind me" on an email could never write a reminder.
--
-- The Email Copilot's Remind-me dialog posts
-- `email-copilot-extras / create_followup_reminder`, which inserts into
-- `client_reminders`. Two things in that insert are refused by the table, each
-- of them on its own, and both surface as the same opaque "Failed to create
-- reminder: Internal error" the 19 Sep 2026 clone audit screenshotted — the
-- function catches the Postgres error and answers `internalError`, which
-- deliberately says nothing about the schema.
-- ============================================================

-- ── 1. `email_followup` is not in the type vocabulary ───────────────────────
--
-- `reminder_type` is CHECK-constrained to a closed list and has been widened
-- twice (once for the pipeline kinds, once for the AML ones). The email
-- follow-up kind was never added, so every write from that dialog violated the
-- constraint.
--
-- Widened rather than bent into `follow_up`: what kind of reminder this is is
-- exactly what this column is for, and the Reminders hub filters and draws an
-- icon from it. This is the same lesson `20261016000000` recorded for the AML
-- kinds and `template_library_entries_category_check` before that — the column
-- decides.
ALTER TABLE public.client_reminders
  DROP CONSTRAINT IF EXISTS client_reminders_reminder_type_check;

ALTER TABLE public.client_reminders
  ADD CONSTRAINT client_reminders_reminder_type_check
  CHECK (reminder_type = ANY (ARRAY[
    'follow_up', 'review', 'call', 'meeting', 'document', 'other',
    'task', 'settlement', 'finance', 'admin',
    -- AML/CTF obligations, written by `_shared/aml/complianceReminders.ts`.
    'aml_periodic_review', 'aml_trigger_review', 'aml_passport_issued',
    -- A follow-up on an email thread, written by `email-copilot-extras`.
    'email_followup'
  ]));

-- ── 2. A reminder that belongs to nobody's client ───────────────────────────
--
-- `client_id` was declared `NOT NULL` when this table held client reminders and
-- nothing else. It now also holds TEAM reminders (`reminder_scope = 'team'`,
-- written by `CreateReminderForm` with no client) and PERSONAL ones (an email
-- follow-up on a thread with no client behind it). Both are reminders about
-- work rather than about a customer, and neither has a client id to give.
--
-- Nothing depends on the column being non-null: RLS on this table is
-- service-role only and names no client join, and every reader already handles
-- the absence (`clientMap[r.client_id] || 'Unknown'`). `reminder_scope` is what
-- says which kind of reminder a row is.
--
-- Idempotent: a no-op on a deployment where this was already dropped.
ALTER TABLE public.client_reminders
  ALTER COLUMN client_id DROP NOT NULL;

COMMENT ON COLUMN public.client_reminders.client_id IS
  'The customer this reminder is about, when it is about one. NULL for a team or personal reminder — `reminder_scope` says which. It was NOT NULL while this table held client reminders alone, which made every team and personal reminder impossible to write.';
