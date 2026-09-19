import { useCallAlertNotifications } from '@/hooks/useCallAlertNotifications';
import { useAppointmentNotifications } from '@/hooks/useAppointmentNotifications';

/**
 * Component that initializes notification listeners that work client-side.
 * 
 * Most notifications are now created SERVER-SIDE via database triggers on:
 * - investment_reports (report completed/failed)
 * - client_portal_report_requests (new portal request)
 * - agency_agreements (agreement generated)
 * - clients (new GHL contact synced)
 * - lead_source_attributions (new marketing lead)
 * - vapi_call_logs (missed calls)
 * - client_reminders (due/overdue reminders)
 * - email_copilot_emails (handled by outlook-email-sync/webhook edge functions)
 * 
 * The NotificationsContext realtime subscription on the `notifications` table
 * picks up all server-side inserts automatically.
 * 
 * Only hooks that listen to tables with open RLS SELECT policies remain here:
 * - call_alert_history (public SELECT = true)
 * - activity_logs (public SELECT = true)
 */
export function Phase1NotificationListeners() {
  // Call alert triggered (call_alert_history has open public SELECT)
  useCallAlertNotifications();
  
  // Appointment events from activity logs (activity_logs has open public SELECT)
  useAppointmentNotifications();
  
  return null;
}
