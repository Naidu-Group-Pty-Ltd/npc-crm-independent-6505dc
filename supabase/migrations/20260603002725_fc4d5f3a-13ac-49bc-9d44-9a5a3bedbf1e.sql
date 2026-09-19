
-- 1. Tracking fields on finance_portal_users
ALTER TABLE public.finance_portal_users
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_briefing_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_eod_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS streak_freeze_until date;

-- 2. Daily activity log (one row per partner per day)
CREATE TABLE IF NOT EXISTS public.finance_partner_daily_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_contact_id uuid NOT NULL,
  activity_date date NOT NULL,
  action_count integer NOT NULL DEFAULT 1,
  first_action_at timestamptz NOT NULL DEFAULT now(),
  last_action_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finance_contact_id, activity_date)
);

GRANT SELECT ON public.finance_partner_daily_activity TO authenticated;
GRANT ALL ON public.finance_partner_daily_activity TO service_role;
ALTER TABLE public.finance_partner_daily_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_daily_activity" ON public.finance_partner_daily_activity FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_fp_daily_activity_contact_date
  ON public.finance_partner_daily_activity (finance_contact_id, activity_date DESC);

-- 3. Momentum badges
CREATE TABLE IF NOT EXISTS public.finance_partner_engagement_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_contact_id uuid NOT NULL,
  badge_key text NOT NULL, -- e.g. 'streak_5', 'streak_10', 'inbox_zero_week', 'settlements_milestone_5'
  earned_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (finance_contact_id, badge_key)
);

GRANT SELECT ON public.finance_partner_engagement_badges TO authenticated;
GRANT ALL ON public.finance_partner_engagement_badges TO service_role;
ALTER TABLE public.finance_partner_engagement_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_badges" ON public.finance_partner_engagement_badges FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. RPC: bump today's activity counter
CREATE OR REPLACE FUNCTION public.bump_finance_partner_activity(_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _today date;
BEGIN
  IF _contact_id IS NULL THEN RETURN; END IF;
  _today := (now() AT TIME ZONE 'Australia/Sydney')::date;
  INSERT INTO public.finance_partner_daily_activity (finance_contact_id, activity_date, action_count)
    VALUES (_contact_id, _today, 1)
    ON CONFLICT (finance_contact_id, activity_date)
    DO UPDATE SET
      action_count = public.finance_partner_daily_activity.action_count + 1,
      last_action_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.bump_finance_partner_activity(uuid) TO service_role;

-- 5. Schedule briefing cron jobs (idempotent)
DO $cron$
DECLARE
  _anon text;
  _url  text;
BEGIN
  _url  := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/finance-portal-briefing-runner';
  _anon := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk';

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('finance-portal-morning-briefing','finance-portal-eod-wrap');

  PERFORM cron.schedule(
    'finance-portal-morning-briefing',
    '0 20 * * *', -- 20:00 UTC ~= 07:00 Sydney (AEDT, accepting 1h DST drift)
    format($job$select net.http_post(url:=%L, headers:=%L::jsonb, body:=%L::jsonb) as request_id;$job$,
           _url,
           '{"Content-Type":"application/json","apikey":"' || _anon || '"}',
           '{"mode":"morning"}')
  );

  PERFORM cron.schedule(
    'finance-portal-eod-wrap',
    '0 6 * * *', -- 06:00 UTC ~= 17:00 Sydney
    format($job$select net.http_post(url:=%L, headers:=%L::jsonb, body:=%L::jsonb) as request_id;$job$,
           _url,
           '{"Content-Type":"application/json","apikey":"' || _anon || '"}',
           '{"mode":"eod"}')
  );
END
$cron$;
