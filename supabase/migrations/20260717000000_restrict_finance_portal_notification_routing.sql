-- Finance Portal notification boundary.
--
-- finance_portal_notifications used to identify only a recipient.  That made it
-- possible for broad Command Centre fan-out jobs (and legacy rows) to become a
-- Finance Portal feed.  Routing is now first-class and is enforced on write as
-- well as on every Finance Portal read/mutation.

ALTER TABLE public.finance_portal_notifications
  ADD COLUMN IF NOT EXISTS origin_portal text,
  ADD COLUMN IF NOT EXISTS target_portal text,
  ADD COLUMN IF NOT EXISTS notification_domain text,
  ADD COLUMN IF NOT EXISTS related_entity_type text,
  ADD COLUMN IF NOT EXISTS related_entity_id uuid,
  ADD COLUMN IF NOT EXISTS finance_file_id uuid,
  ADD COLUMN IF NOT EXISTS recipient_organisation_id uuid,
  ADD COLUMN IF NOT EXISTS recipient_team_id uuid,
  ADD COLUMN IF NOT EXISTS recipient_role text,
  ADD COLUMN IF NOT EXISTS command_centre_authorised boolean,
  ADD COLUMN IF NOT EXISTS correlation_id text;

-- Existing rows are not trusted merely because they landed in this table.
-- Retain finance-shaped records and quarantine known general reporting/property
-- events so historic leakage disappears from list, count and read operations.
UPDATE public.finance_portal_notifications
SET
  origin_portal = COALESCE(origin_portal, metadata->>'origin_portal', 'system'),
  target_portal = CASE
    WHEN notification_type IN (
      'report_request_in_progress', 'report_request_completed',
      'new_report_available', 'report_available', 'property_report',
      'property_report_update', 'report_qa', 'market_update',
      'property_insight'
    ) THEN 'command_center'
    ELSE COALESCE(target_portal, metadata->>'target_portal', 'finance_portal')
  END,
  notification_domain = CASE
    WHEN notification_type IN (
      'report_request_in_progress', 'report_request_completed',
      'new_report_available', 'report_available', 'property_report',
      'property_report_update', 'report_qa'
    ) THEN 'reporting'
    WHEN notification_type = 'market_update' THEN 'market'
    WHEN notification_type = 'property_insight' THEN 'property'
    ELSE COALESCE(notification_domain, metadata->>'notification_domain', 'finance')
  END,
  command_centre_authorised = CASE
    WHEN notification_type IN (
      'report_request_in_progress', 'report_request_completed',
      'new_report_available', 'report_available', 'property_report',
      'property_report_update', 'report_qa', 'market_update',
      'property_insight'
    ) THEN false
    ELSE COALESCE(command_centre_authorised, (metadata->>'command_centre_authorised')::boolean, true)
  END,
  related_entity_type = COALESCE(related_entity_type, metadata->>'related_entity_type'),
  correlation_id = COALESCE(correlation_id, metadata->>'correlation_id');

ALTER TABLE public.finance_portal_notifications
  ALTER COLUMN origin_portal SET DEFAULT 'system',
  ALTER COLUMN origin_portal SET NOT NULL,
  ALTER COLUMN target_portal SET DEFAULT 'finance_portal',
  ALTER COLUMN target_portal SET NOT NULL,
  ALTER COLUMN notification_domain SET DEFAULT 'finance',
  ALTER COLUMN notification_domain SET NOT NULL,
  ALTER COLUMN command_centre_authorised SET DEFAULT true,
  ALTER COLUMN command_centre_authorised SET NOT NULL;

ALTER TABLE public.finance_portal_notifications
  DROP CONSTRAINT IF EXISTS finance_portal_notifications_origin_check,
  ADD CONSTRAINT finance_portal_notifications_origin_check
    CHECK (origin_portal IN ('command_center', 'client_portal', 'finance_portal', 'system')),
  DROP CONSTRAINT IF EXISTS finance_portal_notifications_target_check,
  ADD CONSTRAINT finance_portal_notifications_target_check
    CHECK (target_portal IN ('command_center', 'client_portal', 'finance_portal')),
  DROP CONSTRAINT IF EXISTS finance_portal_notifications_domain_check,
  ADD CONSTRAINT finance_portal_notifications_domain_check
    CHECK (notification_domain IN ('finance', 'property', 'reporting', 'market', 'operations', 'system')),
  DROP CONSTRAINT IF EXISTS finance_portal_notifications_route_check,
  ADD CONSTRAINT finance_portal_notifications_route_check CHECK (
    target_portal <> 'finance_portal'
    OR (
      notification_domain = 'finance'
      AND command_centre_authorised
      AND (link_path IS NULL OR link_path LIKE '/finance%')
      AND (origin_portal <> 'command_center' OR command_centre_authorised)
    )
  ),
  DROP CONSTRAINT IF EXISTS finance_portal_notifications_non_finance_type_check,
  ADD CONSTRAINT finance_portal_notifications_non_finance_type_check CHECK (
    target_portal <> 'finance_portal'
    OR notification_type NOT IN (
      'report_request_in_progress', 'report_request_completed',
      'new_report_available', 'report_available', 'property_report',
      'property_report_update', 'report_qa', 'market_update',
      'property_insight'
    )
  );

CREATE INDEX IF NOT EXISTS idx_fpn_authorised_recipient_unread
  ON public.finance_portal_notifications (portal_user_id, is_read, created_at DESC)
  WHERE target_portal = 'finance_portal'
    AND notification_domain = 'finance'
    AND command_centre_authorised;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fpn_recipient_correlation
  ON public.finance_portal_notifications (portal_user_id, correlation_id)
  WHERE correlation_id IS NOT NULL;

COMMENT ON TABLE public.finance_portal_notifications IS
  'Authoritative finance-only notification stream. Finance reads must require target_portal=finance_portal, notification_domain=finance and command_centre_authorised=true.';
