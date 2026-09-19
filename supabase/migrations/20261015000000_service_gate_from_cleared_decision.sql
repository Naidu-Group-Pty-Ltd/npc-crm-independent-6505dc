-- ═══════════════════════════════════════════════════════════════════════
-- The service gate follows the cleared decision it was always waiting on
-- ═══════════════════════════════════════════════════════════════════════
--
-- ── What this repairs ─────────────────────────────────────────────────
-- `aml.service_gate_decisions` held ZERO rows across the entire database.
-- The gate was a second decision, recorded on Stage 9, that nobody ever
-- performed: `aml-risk`'s `decide` wrote `status`, `case_stage` and
-- `client_portal_status` and deliberately left the gate alone, while
-- `aml-cases`' `transition` has always mapped `cleared → approved`. Which
-- one a case got depended on which button moved it — so `AML-2026-00005`
-- ended up `status = cleared` with `service_gate_status = under_review`,
-- and its Passport read "Refresh required" for that single reason.
--
-- `decide` now records the gate itself. This backfills the cases that were
-- decided before it did.
--
-- ── Why this is a record and not an invention ─────────────────────────
-- It writes NOTHING it cannot point at. Every row it creates is derived
-- from a real `aml.decisions` row with `outcome = 'cleared'` — a decision a
-- real reviewer recorded, at a recorded time, which `clearanceBlockReasons`
-- had to pass at that moment for the decision to exist at all. The gate row
-- carries that decision's id, its author as `approved_by`, its timestamp as
-- `effective_at`, and a reason that says exactly where it came from. No
-- approval is manufactured; the consequence of one already made is recorded.
--
-- ── What it will not touch ────────────────────────────────────────────
--   · A gate already `approved` or `approved_with_controls` — nothing owed.
--   · A gate `locked` or `terminated` — the MLRO's standing restriction and
--     the only way a live Passport is suspended or revoked. Reviving one
--     from a decision is the exact bug `reopen_case` was fixed for.
--   · A case with no cleared decision, or whose latest decision is not
--     cleared. The gate follows the CURRENT decision, never a superseded one.
--   · A case that already has any `service_gate_decisions` row — this is a
--     backfill, not a re-write of history.
--
-- Open conditions produce `approved_with_controls`, never plain `approved`,
-- which is the same rule `set_service_gate` enforces.

do $$
declare
  v_case      record;
  v_decision  record;
  v_conditions jsonb;
  v_status    text;
  v_policy    text;
  v_gate_id   uuid;
  v_repaired  integer := 0;
begin
  for v_case in
    select c.id, c.service_gate_status
      from aml.cases c
     -- `aml.cases.status` is the enum `aml.case_status`, so coalescing it to
     -- an empty string is not a valid value for the type and the comparison
     -- itself errors. Cast first. (`service_gate_status` is text; the cast is
     -- kept for symmetry and costs nothing.)
     where coalesce(c.status::text, '') = 'cleared'
       and coalesce(c.service_gate_status::text, '') not in
           ('approved', 'approved_with_controls', 'locked', 'terminated')
       and not exists (
             select 1 from aml.service_gate_decisions g where g.case_id = c.id)
  loop
    -- The CURRENT decision, and only if it is the cleared one.
    select d.id, d.outcome, d.decided_at, d.decided_by, d.rationale, d.program_version
      into v_decision
      from aml.decisions d
     where d.case_id = v_case.id
     order by d.decided_at desc
     limit 1;

    continue when v_decision.id is null or v_decision.outcome::text <> 'cleared';

    select coalesce(
             jsonb_agg(jsonb_build_object(
               'id', cc.id, 'label', cc.label, 'status', cc.status::text)),
             '[]'::jsonb)
      into v_conditions
      from aml.case_conditions cc
     where cc.case_id = v_case.id and cc.status = 'open';

    v_status := case when jsonb_array_length(v_conditions) > 0
                     then 'approved_with_controls' else 'approved' end;
    v_policy := coalesce(v_decision.program_version, 'v1');

    insert into aml.service_gate_decisions
      (case_id, status, effective_at, conditions, decision_id,
       approved_by, policy_version, reason)
    values
      (v_case.id, v_status, v_decision.decided_at, v_conditions, v_decision.id,
       v_decision.decided_by, v_policy,
       'Recorded from the cleared compliance decision on this case. The gate is '
       || 'granted by that decision; this row backfills cases decided before the '
       || 'decision carried it.')
    returning id into v_gate_id;

    update aml.cases
       set service_gate_status = v_status,
           service_gate_effective_at = v_decision.decided_at,
           service_gate_policy_version = v_policy
     where id = v_case.id;

    v_repaired := v_repaired + 1;
    raise notice 'service gate backfilled: case % → % (decision %)',
      v_case.id, v_status, v_decision.id;
  end loop;

  raise notice 'service gate backfill complete: % case(s) repaired', v_repaired;
end $$;
