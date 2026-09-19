-- A backfill is not an arrival.
--
-- `email-sync-cron`'s historical backfill wrote every message it recovered as
-- `status = 'unread'` and raised a targeted notification for each, fanned out
-- to every Email Co-Pilot viewer. Measured on the prime 13 Sep 2026: one hour
-- (07:00–08:00 UTC) wrote 2,303 rows carrying `received_at` between
-- 2025-01-27 and 2025-11-24 — mail between ten and twenty months old — and
-- raised **9,196** bell notifications, four recipients × ~2,299 messages.
-- Every other hour in the preceding three days raised between three and six.
--
-- The code fault is fixed separately: the notification is now raised only for
-- messages the INCREMENTAL pass returned, so no future backfill can do this.
-- This repairs what the one run left behind.
--
-- ## What this deliberately does NOT do
--
-- The same change fixed `mailboxPathFor`, which had resolved the inbox to
-- `/users/{email}/messages` — the whole mailbox, Sent and Drafts and Deleted
-- Items included. An earlier reading of that damage claimed two repairable
-- signatures, and measuring them found neither holds:
--
--   * "934 own-domain senders sitting in `folder = 'inbox'`" — 660 of those
--     pre-date the incident entirely. A colleague emailing you lands in your
--     Inbox and belongs there, so an own-domain sender is an ordinary inbox
--     state and not a marker of anything.
--   * "34 messages present in BOTH folders" — real, but every one was created
--     between January and 2 September 2026. Not one is in the damage hour.
--     Inside it, both the (subject, received_at) and the
--     (conversation_id, received_at) cross-folder tests return ZERO.
--
-- So nothing stored says which of those 2,303 rows came from Sent rather than
-- the Inbox, and re-filing on a guess would HIDE real inbox mail — a worse
-- outcome than a few of your own sent messages showing in a list. The folder
-- is repaired by re-reading Graph through the now-correct path, not by SQL.
-- This migration touches `folder` on no row.
--
-- ## Why the predicate is the age of the mail, not the hour of the incident
--
-- Hard-coding 2026-09-13 07:00 would repair the prime and nothing else. The
-- signature of a backfill marked as an arrival is that the message was ALREADY
-- OLD when it was imported, which is true wherever and whenever the buggy code
-- ran. Thirty days is deliberately conservative: measured on the prime it
-- selects 2,306 rows against the incident's 2,303, and the three extras are
-- the same class (real mail imported 33, 34 and 59 days after it arrived,
-- unread since January and April). At seven days it would take 124 extra, and
-- 3,903 genuinely recent unread messages sit outside it either way.
--
-- Both statements are idempotent: a second run matches nothing, because the
-- rows they touch no longer satisfy the predicate.

-- Notifications first. After the emails move off `unread` the CTE below is
-- empty, so this statement has to run while it can still identify them.
with backfilled as (
  select id
    from public.email_copilot_emails
   where status = 'unread'
     and received_at < created_at - interval '30 days'
)
update public.notifications n
   set read = true
 where n.type = 'email_received'
   and n.read = false
   -- `notifications.entity_id` is TEXT while the email id is UUID, so the
   -- comparison needs an explicit cast — and the cast needs a guard, because
   -- one malformed row would fail the whole statement. Measured: 0 of the
   -- existing `email_received` rows carry a non-UUID entity_id.
   and n.entity_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   and n.entity_id::uuid in (select id from backfilled);

-- `read` is already in `email_copilot_emails_status_check`; it simply had no
-- rows. It is what the Email Co-Pilot's own unread badge counts against, so
-- this clears the badge without inventing a status value.
update public.email_copilot_emails
   set status = 'read',
       updated_at = now()
 where status = 'unread'
   and received_at < created_at - interval '30 days';
