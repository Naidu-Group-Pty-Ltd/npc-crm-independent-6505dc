-- Add missing tables to the Supabase realtime publication
-- so that postgres_changes listeners actually receive events

ALTER PUBLICATION supabase_realtime ADD TABLE public.investment_reports;
ALTER PUBLICATION supabase_realtime ADD TABLE public.client_portal_report_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agency_agreements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.clients;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_source_attributions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.email_copilot_emails;
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_alert_history;