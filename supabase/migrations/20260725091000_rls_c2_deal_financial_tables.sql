-- =============================================================================
-- RLS-C2 (Critical): lock deal-financial tables to service-role only
-- =============================================================================
--
-- client_deals, deal_stages, build_progress_payments, and builder_invoices each
-- had a single blanket policy `ALL USING(true)/WITH CHECK(true)` for the
-- authenticated role, so any signed-in user could read/write every client's
-- commission, loan, settlement, invoice and builder-payment data — bypassing the
-- app's per-client permission model.
--
-- These tables are never queried directly from the browser; every access goes
-- through the get-client-data / manage-client-data / manage-deal-data edge
-- functions, which run as service_role (bypassing RLS) and enforce module +
-- per-client authorization in-function. So the correct RLS posture is
-- service-role-only: deny direct PostgREST access from anon/authenticated.
-- =============================================================================

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('client_deals','deal_stages','build_progress_payments','builder_invoices')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_deals','deal_stages','build_progress_payments','builder_invoices']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR ALL TO public
        USING (((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role')
        WITH CHECK (((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role')
    $f$, t || '_service_role_only', t);
  END LOOP;
END $$;
