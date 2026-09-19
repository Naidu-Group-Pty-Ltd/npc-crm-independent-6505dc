-- =============================================================================
-- WP-22: the RLS residue the July programme left, re-checked against live state
-- =============================================================================
--
-- Three of the four items the July docs carry as open are already closed. Read
-- live on 11 August 2026:
--
--   * RLS-W2 (`20260725093000_..._after_republish.sql`) HAS been applied.
--     `generated_reports`, `global_report_settings`, `depreciation_comps` and
--     `gamma_agreement_templates` are all `{authenticated}`-scoped with no anon.
--
--   * `notifications` INSERT is no longer `WITH CHECK(true)`. It is
--     `notifications_insert_attributed`, `{authenticated}`,
--     `WITH CHECK (created_by = auth.uid())` — a staff user can no longer record
--     a notification as having come from somebody else. They can still target
--     another user, which is what the assignment-notify feature needs, so the
--     remaining question is authorisation-to-notify rather than attribution.
--     Left alone deliberately; see the WP-22 doc.
--
--   * `investment-reports` is private (STOR-005).
--
-- What is left is below.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. `email_copilot_emails` still accepts an UNAUTHENTICATED insert
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The July work narrowed SELECT/UPDATE/DELETE to `authenticated`, but the
-- original INSERT policy from `20251209112552` survived, still granted to
-- `public` — which includes `anon`, i.e. the publishable key in the browser
-- bundle.
--
-- Its `WITH CHECK` looks protective, and for a signed-in user it is:
--
--     (client_id IS NULL OR EXISTS (SELECT 1 FROM clients c
--        WHERE c.id = client_id AND c.created_by::text = auth.uid()::text))
--     AND (created_by = auth.uid() OR created_by IS NULL)
--
-- For `anon`, `auth.uid()` is NULL. The first arm passes on `client_id IS NULL`;
-- the second passes on `created_by IS NULL`. So anyone on the internet can
-- insert unattached rows into the email table with nothing but the publishable
-- key. It reads nothing and links to no client, so this is junk-row injection
-- rather than a data leak — but it is unauthenticated write access to a table in
-- the client-communications path, and there is no reason for it.
--
-- Re-scoped to `authenticated`. The predicate is unchanged, so nothing a real
-- user could do before changes: for them `auth.uid()` was never NULL.
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Five tables the browser reads, and cannot
-- ─────────────────────────────────────────────────────────────────────────────
--
-- These have RLS enabled and **no policy at all**, which denies every role
-- except `service_role`. For most of the 37 tables in that state it is the
-- intended service-role-only posture. For these five it is not, because the
-- browser reads them directly with `.from()`:
--
--   agency_agreements             SendAgreementDialog (PDF-ready poll),
--                                 useAgreementNotifications
--   client_additional_contacts    EventDetailsModal, QuickAddAppointmentModal,
--                                 PersonalDetailsManualEntry, +2
--   client_portal_report_requests ReportRequests, ClientReportRequestsTab, +2
--   client_portal_reports         ClientReportsTab, SendToClientModal, +2
--   lead_source_attributions      LeadAttributionPanel, useAllDeals, +2
--
-- Every one of those reads returns nothing today. `SendAgreementDialog` polls
-- for a `pdf_storage_path` it can never observe, so it always times out. This is
-- a functional defect, not an exposure — deny-all is the safe direction — which
-- is why it survived: nothing fails loudly.
--
-- Policies follow the convention `generated_reports` established: a
-- `{authenticated}` policy gated on the module-permission predicate, so access
-- is the same permission the sidebar already gates the screen on, and
-- superadmins pass via the predicate's own second arm.
--
-- NOTE ON THE MODULE KEYS. Each is an existing key from `dashboard_modules`,
-- chosen to match the screen the read serves. If one is wrong the read stays
-- denied — i.e. exactly the behaviour today, not a regression — so the failure
-- mode of a bad guess here is "still broken", never "too open". Confirm each
-- against how its screen is gated before treating this as done.

-- agency_agreements → `agreements`
CREATE POLICY agency_agreements_select_module ON public.agency_agreements
  FOR SELECT TO authenticated USING (current_user_can_view('agreements'));

-- client_additional_contacts → `client_management`
CREATE POLICY client_additional_contacts_select_module ON public.client_additional_contacts
  FOR SELECT TO authenticated USING (current_user_can_view('client_management'));
CREATE POLICY client_additional_contacts_insert_module ON public.client_additional_contacts
  FOR INSERT TO authenticated WITH CHECK (current_user_can_edit('client_management'));
CREATE POLICY client_additional_contacts_update_module ON public.client_additional_contacts
  FOR UPDATE TO authenticated USING (current_user_can_edit('client_management'));

-- client_portal_report_requests → `report_requests`
CREATE POLICY client_portal_report_requests_select_module ON public.client_portal_report_requests
  FOR SELECT TO authenticated USING (current_user_can_view('report_requests'));

-- client_portal_reports → `client_management`
CREATE POLICY client_portal_reports_select_module ON public.client_portal_reports
  FOR SELECT TO authenticated USING (current_user_can_view('client_management'));

-- lead_source_attributions → `marketing_analytics`
CREATE POLICY lead_source_attributions_select_module ON public.lead_source_attributions
  FOR SELECT TO authenticated USING (current_user_can_view('marketing_analytics'));

-- The grants these policies sit on top of. WP-17 revoked the moot
-- anon/authenticated grants on the 16 deny-all tables with NO browser reader and
-- deliberately left these five alone, so the reads and their grants land
-- together rather than a phase apart. Anon stays revoked throughout: these are
-- staff screens.
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


-- ─────────────────────────────────────────────────────────────────────────────
-- Verify after applying:
--   * SendAgreementDialog's PDF poll resolves instead of timing out;
--   * a staff user WITHOUT the module permission still reads nothing;
--   * `select * from pg_policies where tablename = 'email_copilot_emails'`
--     shows no `{public}` row.
-- ─────────────────────────────────────────────────────────────────────────────
