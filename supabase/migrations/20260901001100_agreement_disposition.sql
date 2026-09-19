-- ─────────────────────────────────────────────────────────────────────────────
-- Agreement Centre — disposition: void, archive, delete.
--
-- The register could create and progress an agreement but never get rid of
-- one. Three different acts hide behind that, and this migration gives the two
-- that leave a record somewhere to put it (the third, deletion, is defined by
-- what it is NOT allowed to touch — see `agreementDeleteVerdict`):
--
--   Void     A statement about the AGREEMENT: it is of no effect. Already a
--            lifecycle status; what it never had was a timestamp or a reason,
--            so "when and why" lived only in an event summary string. The
--            existing generic transition wrote the reason into
--            `termination_reason`, which is the wrong column — a void
--            agreement was never terminated, and a report grouping by
--            termination reason counted them as if they had been.
--   Archive  A statement about the LIST: not my current work. Reversible and
--            orthogonal to status, which is exactly why it is a pair of
--            columns and not a twelfth enum value — an archived agreement that
--            is `active` is still active, and still governs commission.
--
-- The one property worth stating out loud: `effective_schedule` (the resolver
-- the commission engine calls to find the agreement governing a referral) does
-- NOT filter on `archived_at`, and must not. Archiving is a filing decision by
-- one person in one list; letting it change what a partner gets paid would
-- make a tidy-up into a financial event.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.partner_agreements
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID,
  ADD COLUMN IF NOT EXISTS archived_by_label TEXT,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT;

COMMENT ON COLUMN public.partner_agreements.voided_at IS
  'When the agreement was declared of no effect. Set only by the void action, which requires a reason; never by the generic transition.';
COMMENT ON COLUMN public.partner_agreements.void_reason IS
  'Why it was voided. Its own column rather than termination_reason: a voided agreement was never terminated, and conflating them mis-counts both.';
COMMENT ON COLUMN public.partner_agreements.archived_at IS
  'Filing state, not lifecycle state. An archived agreement keeps its status and every legal consequence of it — including governing commission — and is simply out of the working list until restored.';
COMMENT ON COLUMN public.partner_agreements.archive_reason IS
  'Optional note for whoever finds it in the archive later.';

-- The working list is "everything not archived", ordered by recency. A partial
-- index over exactly that predicate keeps the common query off a seq scan as
-- the archive grows past the live set — which is the steady state for a
-- register nobody deletes from.
CREATE INDEX IF NOT EXISTS idx_partner_agreements_active_list
  ON public.partner_agreements(created_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_partner_agreements_archived
  ON public.partner_agreements(archived_at DESC)
  WHERE archived_at IS NOT NULL;
