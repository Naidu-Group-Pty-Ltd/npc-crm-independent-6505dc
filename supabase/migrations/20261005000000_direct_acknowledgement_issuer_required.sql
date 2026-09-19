-- The officer who issued a direct acknowledgement request is REQUIRED.
--
-- `aml.reliance_agreements.created_by` is NOT NULL, and rightly so: an
-- arrangement under section 37A is entered into by this business, and a record
-- of one with no responsible officer is not a record of anything.
--
-- The direct-link acceptance is the one path that creates such an arrangement
-- with no staff member in the request — the actor is the partner, over a public
-- link, and there is deliberately no session to read. It attributes the
-- arrangement to the officer who ISSUED the request: they chose the partner,
-- the case and the address, and sending the agreement is the act that commits
-- this business to what the partner's acceptance completes.
--
-- That attribution has to exist, or the acceptance has nothing to write. It
-- always did in practice — `sent_by` is written from an authenticated staff op
-- and is `auth.userId`, which that path refuses to run without — but "always in
-- practice" is what the column should say rather than what a reader has to
-- reconstruct from another function. Both existing rows carry it; the statement
-- below is a no-op on data and a promise about the future.
--
-- The edge function still refuses politely if it is ever absent, because a
-- partner who has read and ticked everything deserves a sentence they can act
-- on rather than a 500 — but with this constraint in place that branch is
-- unreachable, which is the point.

alter table aml.direct_partner_acknowledgements
  alter column sent_by set not null;

comment on column aml.direct_partner_acknowledgements.sent_by is
  'The staff member who issued this request. Required: the acceptance attributes '
  'aml.reliance_agreements.created_by to them, and that column is NOT NULL because '
  'an arrangement with no responsible officer on our side is not a record.';
