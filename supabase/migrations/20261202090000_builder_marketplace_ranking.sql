-- ============================================================================
-- The marketplace draws the network's ranking (Builders Network Phase 7, wave 6).
--
-- `list_stock` ordered by `created_at DESC`. In a multi-vendor marketplace that
-- is not the absence of a ranking, it IS one: it ranks by upload recency, it
-- rewards whichever builder touched their stock list last, no builder can be
-- told their position, and no operator can account for it. The Builders Network
-- now scores every builder and every property and publishes the answer; this
-- migration is the half that receives it and lays out a page from it.
--
-- WHY THE CLONE COMPUTES NOTHING. A clone's mirror is a PARTIAL view of the
-- market — the stock of the builders this workspace is connected to, and no
-- others. A clone that scored builders for itself would not merely disagree
-- with its siblings, it would be wrong: it would be ranking builders against a
-- cohort with most of the market missing. So the score arrives on
-- `stock.item.upserted` and is stored; nothing here recomputes it and nothing
-- here may.
--
-- WHAT THE CLONE DOES OWN is the shape of a PAGE, and that division is the
-- whole design. A score is a statement about a builder. How many of one
-- builder's properties may run consecutively before another appears, how many
-- promoted slots a list offers, where a pinned property lands once an offset is
-- applied — those are properties of the surface doing the paginating, and
-- folding them into a score would make a builder's position depend on who else
-- happened to be on the page with them. The page rule is identical in every
-- deployment because this file is.
--
-- THREE RULES BITE.
--
--   AN UNRANKED ROW SORTS AS IT ALWAYS DID. Every mirror row predates this
--   migration and carries no rank until the network's next run reaches it. A
--   NULL band must therefore not collapse to zero (which would put every
--   unranked property at the top) nor to the worst band (which would bury a
--   whole catalogue the moment this shipped). `ranked_band` resolves NULL to
--   the neutral band and the tie-break falls back to `created_at DESC` — so a
--   deployment that receives no rank at all behaves exactly as it did
--   yesterday. Absent is never zero, again.
--
--   THE CAP IS A SORT, NEVER A FILTER. The interleave is a window function over
--   the ordered set, so a builder with forty properties still has all forty in
--   the list — further down it. Nothing in this migration can remove a property
--   from the marketplace. The one exception is `placement_kind = 'suppressed'`,
--   which is an operator's recorded act taken on the network with a reason and
--   an expiry, not a conclusion the ordering reached by itself.
--
--   A BOUGHT OR PINNED POSITION IS LABELLED. `disclose` crosses with the rank
--   and the card draws a chip from it. An adviser reading this list recommends
--   what is on it to a client, so anything whose position was decided by
--   something other than merit says so where they read it.
-- ============================================================================

-- ===========================================================================
-- 1. The mirror carries the rank it was sent
-- ===========================================================================
ALTER TABLE public.builder_network_stock_items
  ADD COLUMN IF NOT EXISTS rank_item_score numeric(5,2),
  ADD COLUMN IF NOT EXISTS rank_item_confidence numeric(5,4),
  ADD COLUMN IF NOT EXISTS rank_builder_score numeric(5,2),
  ADD COLUMN IF NOT EXISTS rank_builder_confidence numeric(5,4),
  ADD COLUMN IF NOT EXISTS rank_builder_band smallint,
  ADD COLUMN IF NOT EXISTS rank_placement_kind text,
  ADD COLUMN IF NOT EXISTS rank_placement_position integer,
  ADD COLUMN IF NOT EXISTS rank_placement_tier text,
  ADD COLUMN IF NOT EXISTS rank_disclose boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rank_version integer,
  ADD COLUMN IF NOT EXISTS rank_computed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'builder_network_stock_items_rank_kind') THEN
    ALTER TABLE public.builder_network_stock_items
      ADD CONSTRAINT builder_network_stock_items_rank_kind
      CHECK (rank_placement_kind IS NULL
             OR rank_placement_kind IN ('organic', 'promoted', 'pinned', 'suppressed'));
  END IF;
  /*
   * The disclosure rule, held at the column rather than trusted to the sender.
   * A promoted or pinned row that arrived without its label would draw as an
   * ordinary listing that merit put first — which is the one outcome this
   * feature must never produce, and the one a bug at the far end could produce
   * silently.
   */
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'builder_network_stock_items_rank_disclosure') THEN
    ALTER TABLE public.builder_network_stock_items
      ADD CONSTRAINT builder_network_stock_items_rank_disclosure
      CHECK (rank_placement_kind IS NULL
             OR rank_placement_kind NOT IN ('promoted', 'pinned')
             OR rank_disclose = true);
  END IF;
END $$;

COMMENT ON COLUMN public.builder_network_stock_items.rank_builder_band IS
  'The builder''s band as the Builders Network computed it. 0 is best. NULL means this row has not been ranked yet and must sort at the neutral band, never at either extreme.';
COMMENT ON COLUMN public.builder_network_stock_items.rank_disclose IS
  'Whether the card must carry a visible placement label. Decided once, on the network, so the prime and every clone cannot disagree about whether a position was bought.';

CREATE INDEX IF NOT EXISTS builder_network_stock_items_rank_idx
  ON public.builder_network_stock_items
     (lifecycle_status, rank_builder_band, rank_item_score DESC);

-- ===========================================================================
-- 2. The page — one view, so every surface and every clone lay out the same
-- ===========================================================================

/*
 * THE INTERLEAVE IS A WINDOW FUNCTION, NOT A POST-PASS.
 *
 * A diversity cap applied to a page after it has been fetched cannot help when
 * the page is already one builder's — there is nobody on it to interleave with.
 * It has to be part of the ordering, before the offset.
 *
 * `slot` is each property's position within its OWN builder's stock, best
 * first; `interleave_bucket` is that divided by the cap. Ordering by the bucket
 * first takes the best three of every builder, then the next three of every
 * builder, and so on. A builder with forty properties and a rival with two
 * still shows all forty — the rival's two simply appear on page one rather than
 * after everything. Deterministic, stable under pagination, and a pure sort.
 *
 * `MAX_CONSECUTIVE_PER_BUILDER` is 3 and is stated in one place per side:
 * here, and in `marketplaceOrder.pure.ts` for the pin splice. A spec reads
 * both and fails when they drift, because two numbers that must agree and are
 * written twice is how a page comes to be laid out two different ways.
 */
/*
 * `security_invoker = true`, because a view without it reads its base tables
 * with the OWNER's rights and the caller's RLS never applies. This one selects
 * the whole mirror, so owner rights here would hand anyone who can reach the
 * view every builder's stock regardless of what `builder_network_stock_items`
 * permits them — and it would do it silently, looking exactly like a view that
 * works. The policies on the base table are the access rule; this view is a
 * sort over it and must not be a way around it.
 */
CREATE OR REPLACE VIEW public.builder_network_stock_ranked
WITH (security_invoker = true) AS
SELECT
  i.*,
  COALESCE(i.rank_builder_band, 2)::smallint AS ranked_band,
  COALESCE(i.rank_item_score, 50)::numeric   AS ranked_item_score,
  COALESCE(i.rank_placement_kind, 'organic') AS ranked_placement_kind,
  /* Promoted above organic; pinned is spliced by absolute position at the
     surface and so sorts with its merit here rather than jumping the queue
     twice. */
  CASE COALESCE(i.rank_placement_kind, 'organic')
    WHEN 'promoted' THEN 0 ELSE 1 END       AS ranked_placement_order,
  (row_number() OVER (
      PARTITION BY i.organisation_id
      ORDER BY
        CASE COALESCE(i.rank_placement_kind, 'organic') WHEN 'promoted' THEN 0 ELSE 1 END,
        COALESCE(i.rank_builder_band, 2),
        COALESCE(i.rank_item_score, 50) DESC,
        i.created_at DESC,
        i.id
   ) - 1) / 3                                AS interleave_bucket
FROM public.builder_network_stock_items i
WHERE COALESCE(i.rank_placement_kind, 'organic') <> 'suppressed';

COMMENT ON VIEW public.builder_network_stock_ranked IS
  'The marketplace ordering. Adds the interleave bucket that keeps one builder from owning a page, resolves an unranked row to the neutral band rather than to either extreme, and drops exactly one thing: a property an operator has explicitly suppressed on the network. Every other property in the mirror is in this view.';

GRANT SELECT ON public.builder_network_stock_ranked TO service_role;
REVOKE ALL ON public.builder_network_stock_ranked FROM anon, authenticated;

-- ===========================================================================
-- 3. The rank lands in its own sweep, beside the convergence sweep
-- ===========================================================================

/*
 * WHY THIS IS NOT AN EDIT TO `builder_network_apply_inbound_events`.
 *
 * That function is the clone's convergence sweep: seventeen kilobytes of
 * monotonic version guards, organisation checks, refusal bookkeeping and
 * catalogue reconciliation, with its own header explaining each. Adding two
 * lines to it means either restating the whole thing in this file — which is
 * how two copies of one sweep come to exist and then to differ — or patching
 * the deployed text by string replacement, which was tried here first and
 * refused: the anchor it needed is not in the deployed body at all, so the
 * "fix" would have been a migration that silently did nothing on the very
 * deployment it was written against.
 *
 * So the rank converges in a sweep of its own, reading the same events after
 * they have landed. It is idempotent (each event is stamped once), monotonic
 * (a replayed or out-of-order event cannot wind a card back), and it holds the
 * same rule the main sweep holds: the connection's mapped organisation is the
 * authority, and a payload claiming another builder's stock is refused.
 */
ALTER TABLE public.builder_network_inbound_events
  ADD COLUMN IF NOT EXISTS rank_applied_at timestamptz;

COMMENT ON COLUMN public.builder_network_inbound_events.rank_applied_at IS
  'When the rank block on this event was converged onto the mirror. Its PRESENCE is the guard, never its outcome — an event carrying no rank is stamped too, so it is not rescanned for ever.';

CREATE INDEX IF NOT EXISTS builder_network_inbound_events_rank_pending_idx
  ON public.builder_network_inbound_events (received_at)
  WHERE rank_applied_at IS NULL AND event_type = 'stock.item.upserted';

CREATE OR REPLACE FUNCTION public.builder_network_apply_stock_ranks(
  _limit integer DEFAULT 200)
RETURNS TABLE (applied integer, skipped integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_event record;
  v_rank jsonb;
  v_item_id uuid;
  v_org uuid;
  v_conn_org uuid;
  v_computed timestamptz;
  v_applied integer := 0;
  v_skipped integer := 0;
BEGIN
  FOR v_event IN
    SELECT e.id, e.connection_id, e.payload
    FROM public.builder_network_inbound_events e
    WHERE e.rank_applied_at IS NULL
      AND e.event_type = 'stock.item.upserted'
    ORDER BY e.received_at
    LIMIT greatest(1, least(_limit, 1000))
    FOR UPDATE SKIP LOCKED
  LOOP
    v_rank := v_event.payload->'rank';
    v_item_id := nullif(v_event.payload->>'id', '')::uuid;
    v_org := nullif(v_event.payload->>'organisation_id', '')::uuid;

    -- Stamped whatever the outcome. An event carrying no rank block — every
    -- event sent before the network's first ranking run — is settled here
    -- rather than being rescanned on every tick for ever.
    IF v_rank IS NULL OR jsonb_typeof(v_rank) <> 'object' OR v_item_id IS NULL THEN
      UPDATE public.builder_network_inbound_events
      SET rank_applied_at = now() WHERE id = v_event.id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- The connection's mapped organisation is the authority, exactly as in the
    -- main sweep: a payload naming another builder's stock is not applied.
    SELECT c.builder_organisation_id INTO v_conn_org
    FROM public.builder_network_connections c WHERE c.id = v_event.connection_id;
    IF v_conn_org IS NULL OR v_org IS DISTINCT FROM v_conn_org THEN
      UPDATE public.builder_network_inbound_events
      SET rank_applied_at = now() WHERE id = v_event.id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_computed := nullif(v_rank->>'computed_at', '')::timestamptz;

    /*
     * MONOTONIC BY THE RANK'S OWN CLOCK. A delivery retried out of order must
     * not wind a card back to an older run's band, and `computed_at` is the
     * network's stamp for exactly that. A row with no stamp yet accepts the
     * first one it is offered.
     */
    UPDATE public.builder_network_stock_items SET
      rank_item_score = nullif(v_rank->>'item_score', '')::numeric,
      rank_item_confidence = nullif(v_rank->>'item_confidence', '')::numeric,
      rank_builder_score = nullif(v_rank->>'builder_score', '')::numeric,
      rank_builder_confidence = nullif(v_rank->>'builder_confidence', '')::numeric,
      rank_builder_band = nullif(v_rank->>'builder_band', '')::smallint,
      rank_placement_kind = nullif(btrim(COALESCE(v_rank->>'placement_kind', '')), ''),
      rank_placement_position = nullif(v_rank->>'placement_position', '')::integer,
      rank_placement_tier = nullif(btrim(COALESCE(v_rank->>'placement_tier', '')), ''),
      rank_disclose = COALESCE((v_rank->>'disclose')::boolean, false),
      rank_version = nullif(v_rank->>'ranking_version', '')::integer,
      rank_computed_at = v_computed
    WHERE id = v_item_id
      AND (rank_computed_at IS NULL
           OR v_computed IS NULL
           OR v_computed >= rank_computed_at);

    UPDATE public.builder_network_inbound_events
    SET rank_applied_at = now() WHERE id = v_event.id;
    v_applied := v_applied + 1;
  END LOOP;

  RETURN QUERY SELECT v_applied, v_skipped;
END $fn$;

REVOKE ALL ON FUNCTION public.builder_network_apply_stock_ranks(integer)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.builder_network_apply_stock_ranks(integer) IS
  'Converges the rank block of stock.item.upserted events onto the mirror. Deliberately separate from builder_network_apply_inbound_events: adding to that function meant either restating 17kB of convergence logic in a migration or patching its deployed text, and the text anchor that patch needed does not exist in the deployed body.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'builder-network-rank-apply-1min') THEN
      PERFORM cron.schedule(
        'builder-network-rank-apply-1min',
        '* * * * *',
        $job$SELECT public.builder_network_apply_stock_ranks(200);$job$
      );
    END IF;
  END IF;
END $$;

-- ===========================================================================
-- 4. Post-migration assertions — asserted by effect, never by configuration
-- ===========================================================================
DO $$
DECLARE v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'builder_network_apply_stock_ranks'
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the rank convergence sweep is absent';
  END IF;

  -- Prove it RUNS rather than merely exists: a sweep that throws on its first
  -- call is indistinguishable from one nobody scheduled.
  PERFORM public.builder_network_apply_stock_ranks(50);

  -- The view must not be able to hide anything except a suppression. Proved by
  -- counting, not by reading the definition.
  SELECT (
    (SELECT count(*) FROM public.builder_network_stock_items
      WHERE COALESCE(rank_placement_kind, 'organic') <> 'suppressed')
    = (SELECT count(*) FROM public.builder_network_stock_ranked)
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the ranked view drops rows it may not drop';
  END IF;

  -- And an undisclosed promoted row must be refused at the column.
  IF EXISTS (SELECT 1 FROM public.builder_network_stock_items) THEN
    BEGIN
      UPDATE public.builder_network_stock_items
      SET rank_placement_kind = 'promoted', rank_placement_tier = 'partner', rank_disclose = false
      WHERE id = (SELECT id FROM public.builder_network_stock_items LIMIT 1);
      RAISE EXCEPTION
        'POST-MIGRATION FAILURE: a promoted row was accepted with rank_disclose = false';
    EXCEPTION
      WHEN check_violation THEN NULL;   -- the constraint bit, which is the pass
    END;
  END IF;
END $$;
