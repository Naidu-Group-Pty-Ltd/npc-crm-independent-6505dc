-- Appointment notes — audit item 30.
--
-- The Event Details panel reported "No notes" on bookings whose notes had been
-- typed and had reached the confirmation email. Measured against the live
-- GoHighLevel account on 2026-08-31: of 65 appointments across 7 calendars, 62
-- carry a `notes` key and exactly ONE has anything in it — seven characters.
-- Both the list endpoint and the appointment-detail endpoint return the field,
-- so nothing was being dropped on the way in. The notes were never stored on
-- the GHL appointment in the first place, and the panel had nowhere else to
-- look.
--
-- They were, however, already being written HERE — into
-- `appointment_secondary_recipients.appointment_notes`, by
-- `send-appointment-notification`, one row per recipient. That table is a
-- notification log: `finance_contact_id` is NOT NULL, so a booking with no
-- additional invitees writes no row at all, which is why 11 appointments have
-- notes stored out of the 65 that exist. Notes belong to the appointment, not
-- to whoever happened to be copied in.
--
-- One row per appointment, keyed by the GHL event id, which is the only
-- identifier every surface already holds.

create table if not exists public.appointment_notes (
  appointment_ghl_id text primary key,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.custom_users(id) on delete set null
);

comment on table public.appointment_notes is
  'Notes for a calendar appointment, keyed by GoHighLevel event id. GHL does not persist appointment notes (measured: 1 of 65 events), so this is where they live. Written by ghl-calendar on create and reschedule; read back onto the events payload.';

comment on column public.appointment_notes.appointment_ghl_id is
  'The GoHighLevel event id. Not a foreign key: appointments live in GHL, not in this database.';

-- Row-level security on, no policies — the same posture as
-- `appointment_secondary_recipients`. Reached only by edge functions holding
-- the service role; no browser client reads or writes this table directly.
alter table public.appointment_notes enable row level security;

-- Backfill from the notification log, so notes already captured against a
-- booking appear immediately rather than only on bookings made from now on.
-- Takes the most recently updated non-empty note per appointment; a recipient
-- row that recorded no note contributes nothing.
insert into public.appointment_notes (appointment_ghl_id, notes, updated_at)
select distinct on (r.appointment_ghl_id)
  r.appointment_ghl_id,
  r.appointment_notes,
  r.updated_at
from public.appointment_secondary_recipients r
where coalesce(trim(r.appointment_notes), '') <> ''
order by r.appointment_ghl_id, r.updated_at desc
on conflict (appointment_ghl_id) do nothing;
