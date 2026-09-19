DROP POLICY IF EXISTS "Users can create emails for their clients" ON public.email_copilot_emails;

CREATE POLICY email_copilot_emails_insert_scoped
  ON public.email_copilot_emails
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (client_id IS NULL OR EXISTS (
       SELECT 1 FROM public.clients c
        WHERE c.id = email_copilot_emails.client_id
          AND (c.created_by)::text = (auth.uid())::text
    ))
    AND (created_by = auth.uid() OR created_by IS NULL)
  );

REVOKE INSERT ON public.email_copilot_emails FROM anon;

DROP POLICY IF EXISTS agency_agreements_select_module ON public.agency_agreements;
CREATE POLICY agency_agreements_select_module ON public.agency_agreements
  FOR SELECT TO authenticated USING (current_user_can_view('agreements'));

DROP POLICY IF EXISTS client_additional_contacts_select_module ON public.client_additional_contacts;
CREATE POLICY client_additional_contacts_select_module ON public.client_additional_contacts
  FOR SELECT TO authenticated USING (current_user_can_view('client_management'));
DROP POLICY IF EXISTS client_additional_contacts_insert_module ON public.client_additional_contacts;
CREATE POLICY client_additional_contacts_insert_module ON public.client_additional_contacts
  FOR INSERT TO authenticated WITH CHECK (current_user_can_edit('client_management'));
DROP POLICY IF EXISTS client_additional_contacts_update_module ON public.client_additional_contacts;
CREATE POLICY client_additional_contacts_update_module ON public.client_additional_contacts
  FOR UPDATE TO authenticated USING (current_user_can_edit('client_management'));

DROP POLICY IF EXISTS client_portal_report_requests_select_module ON public.client_portal_report_requests;
CREATE POLICY client_portal_report_requests_select_module ON public.client_portal_report_requests
  FOR SELECT TO authenticated USING (current_user_can_view('report_requests'));

DROP POLICY IF EXISTS client_portal_reports_select_module ON public.client_portal_reports;
CREATE POLICY client_portal_reports_select_module ON public.client_portal_reports
  FOR SELECT TO authenticated USING (current_user_can_view('client_management'));

DROP POLICY IF EXISTS lead_source_attributions_select_module ON public.lead_source_attributions;
CREATE POLICY lead_source_attributions_select_module ON public.lead_source_attributions
  FOR SELECT TO authenticated USING (current_user_can_view('marketing_analytics'));

REVOKE ALL ON public.agency_agreements,
              public.client_additional_contacts,
              public.client_portal_report_requests,
              public.client_portal_reports,
              public.lead_source_attributions
  FROM anon;

GRANT SELECT ON public.agency_agreements,
                public.client_portal_report_requests,
                public.client_portal_reports,
                public.lead_source_attributions
  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.client_additional_contacts TO authenticated;