-- The second datum for the page bound: three months at SA2 grain.
--
-- `20261215000000` measured the first. One month answered **HTTP 200** and
-- wrote **5,814 rows** (`market_sales_sync` 75 -> 76, which is the proof a run
-- delivered rather than merely being queued), against six months answering
-- 546. So the bound lies between 1 and 6 and the register works.
--
-- Why a second datum rather than shipping `1`. One is proven and safe, and it
-- makes a full walk of the 33 months the Bureau holds into 33 pages — at one
-- page per nightly invocation, a month of backfill. Three months would make
-- it eleven. That is worth one more request to learn, and learning it is the
-- only honest way to set the constant: two points bracket a cliff, one point
-- picks a number and calls it a measurement.
--
-- 2026-05 -> 2026-07 is three months ending at the frontier CI measured, so a
-- short answer here would be about the publisher's lag rather than about the
-- load. Idempotent: 2026-07 is already loaded and the primary key is the
-- publisher's own (area_kind, area_code, period, building_type), so this
-- replaces that month and adds two.
--
-- No `@effect` probe, for the reason `20261214000000` states: the post is
-- queued, so any probe here asserts something untrue at the instant the file
-- finishes. The measurement is read from `function_logs`.

select public.market_sales_refresh(
  '{"stage": "approvals", "startPeriod": "2026-05", "endPeriod": "2026-07"}'::jsonb
);
