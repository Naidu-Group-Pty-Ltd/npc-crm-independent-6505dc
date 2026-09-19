ALTER VIEW public.partner_agreement_retention_register SET (security_invoker = true);
ALTER VIEW public.cross_portal_rollout_reconciliation  SET (security_invoker = true);

REVOKE ALL ON public.partner_agreement_retention_register FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cross_portal_rollout_reconciliation  FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.partner_agreement_retention_register TO service_role;
GRANT  SELECT ON public.cross_portal_rollout_reconciliation  TO service_role;

ALTER FUNCTION public.canonical_report_address_key(raw_address text)
  SET search_path = public;
ALTER FUNCTION public.resolve_investment_report_property_key(p_listing_id text, p_client_property_id uuid, p_address text)
  SET search_path = public;
ALTER FUNCTION public.is_legal_matter_transition_allowed(_from legal_matter_status, _to legal_matter_status)
  SET search_path = public;
ALTER FUNCTION aml.assert_partner_event_payload_safe(_payload jsonb, _path text)
  SET search_path = aml, public;
ALTER FUNCTION aml.tg_reject_simulator_idv()
  SET search_path = aml, public;

DO $$
DECLARE
  fn record;
  keep_names text[] := ARRAY[
    'has_role',
    'has_aml_role',
    'has_aml_write_role',
    'has_any_aml_role',
    'has_tenant_aml_role',
    'has_any_tenant_aml_role',
    'is_superadmin',
    'current_user_can_view',
    'current_user_can_edit',
    'current_user_can_delete',
    'get_shared_qa_answer',
    'resolve_report_template',
    'retry_failed_bulk_items',
    'api_usage_billing_breakdown',
    'get_all_cache_stats',
    'get_api_health_stats',
    'get_report_changelog'
  ];
BEGIN
  FOR fn IN
    SELECT n.nspname AS schema,
           p.proname AS name,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'aml')
       AND p.prosecdef
       AND p.proname <> ALL (keep_names)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
                   fn.schema, fn.name, fn.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
                   fn.schema, fn.name, fn.args);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.api_usage_billing_breakdown(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.api_usage_billing_breakdown(integer) TO authenticated, service_role;

DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    'agent_action_log',
    'agent_conversation_handoffs',
    'agent_conversation_shares',
    'agent_file_uploads',
    'agent_user_preferences',
    'appointment_secondary_recipients',
    'client_qa_memory',
    'email_linking_excluded_addresses',
    'finance_partner_commissions',
    'finance_partner_statement_lines',
    'finance_partner_statements',
    'ghl_rate_state',
    'mfa_webauthn_challenges',
    'migration_uploaded_source_chunks',
    'purchase_file_client_tasks',
    'user_webauthn_credentials'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    END IF;
  END LOOP;
END $$;