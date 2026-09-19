import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { requestOpenInternalMessages } from '@/lib/internalMessagingBus';
import { resolveNotificationLink } from '@/lib/notificationLink';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export type NotificationType = 
  | 'report_generated' 
  | 'report_failed' 
  | 'info' 
  | 'call_completed' 
  | 'appointment_created' 
  | 'appointment_rescheduled' 
  | 'appointment_cancelled'
  // Phase 1 additions
  | 'client_reminder_due'
  | 'client_reminder_overdue'
  | 'call_alert_triggered'
  | 'missed_call'
  | 'email_received'
  | 'email_reply_sent'
  // Phase 2 additions - Report Lifecycle
  | 'report_generation_started'
  | 'report_generation_completed'
  | 'report_generation_failed'
  | 'report_regeneration_started'
  | 'report_regeneration_completed'
  | 'report_regeneration_failed'
  | 'report_archived'
  | 'report_restored'
  // Phase 3 additions - Client & Portfolio
  | 'client_created'
  | 'client_updated'
  | 'portfolio_updated'
  | 'formara_form_uploaded'
  | 'formara_form_exported'
  | 'finance_agent_notified'
  | 'client_file_shared'
  // Phase 4 additions - System & User
  | 'user_role_updated'
  | 'new_user_invited'
  | 'system_maintenance'
  | 'data_import_complete'
  | 'report_comment_added'
  // Phase 3 additions - Deal Lifecycle
  | 'deal_finance_expiry_warning'
  | 'deal_finance_expiry_overdue'
  | 'deal_settlement_warning'
  | 'deal_settlement_overdue'
  | 'deal_build_date_warning'
  // Phase 5 - Assignment notifications
  | 'reminder_assigned'
  | 'deal_assigned'
  | 'report_request'
  // Outlook calendar
  | 'outlook_event_created'
  // Phase 6 additions - Extended coverage
  | 'agreement_generated'
  | 'new_ghl_contact'
  | 'new_marketing_lead'
  | 'portal_report_requested'
  | 'client_reminder_upcoming'
  | 'conversation_shared'
  // Game Plan
  | 'game_plan_created'
  | 'game_plan_updated'
  | 'game_plan_milestone_completed'
  | 'conversation_reply'
  // Portal messaging
  | 'portal_message_received'
  | 'finance_portal_message_received'
  // Conversation sync
  | 'bulk_conversation_sync_completed'
  // Producers repaired in 20260803030000 — every one of these was writing a
  // column that did not exist on `notifications`, so none had ever been seen.
  | 'internal_message'
  | 'lender_submission_status'
  | 'purchase_file_unconditional_approval'
  | 'purchase_file_linked'
  | 'purchase_file_unlinked'
  | 'agent_insight'
  | 'agent_plan_scheduled'
  | 'market_qa_digest'
  | 'market_qa_subscription'
  | 'qa_conversation_shared'
  | 'client_data_updated'
  | 'client_property_added';

/**
 * The DB no longer enumerates notification types (it validates the slug format
 * only), so new backend/trigger types must never be dropped by the client.
 * The union above stays for autocomplete + routing; unknown slugs are allowed.
 */
export type AnyNotificationType = NotificationType | (string & {});

export interface Notification {
  id: string;
  type: AnyNotificationType;
  title: string;
  message: string;
  reportId?: string;

  entityId?: string;
  targetUserId?: string;
  timestamp: Date;
  read: boolean;
  /** Optional in-app path supplied by the producer. */
  link?: string;
  /** Producer-supplied context; `link_path`/`url` are honoured for routing. */
  metadata?: Record<string, unknown>;
}

interface NotificationsContextType {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearNotification: (id: string) => void;
  clearAll: () => void;
  handleNotificationClick: (notification: Notification) => void;
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

// Deployed slot for the bell feed. `notifications-feed` kept serving a stale
// bundle whose CSRF allowlist rejected the preview origin; `-v2` is the same
// source deployed fresh.
const NOTIFICATIONS_FN = 'notifications-feed-v2';

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const navigate = useNavigate();
  const { accessToken, user } = useAuth();
  // Data now moves over `notifications-feed` (staff session cookie). This client
  // is kept ONLY for the realtime subscription, which is a best-effort "something
  // changed" hint — if its JWT is absent the socket simply never delivers, and
  // the polling fallback below carries the bell.
  const { supabase } = useAuthenticatedSupabase();

  const fetchNotifications = useCallback(async () => {
    try {
      // Read over the staff session cookie, not the browser-held Supabase JWT.
      //
      // The direct PostgREST path silently degraded to the anon key whenever
      // that JWT was missing: `notifications` policies are all TO authenticated
      // but `anon` still held a SELECT grant, so Postgres matched no policy and
      // PostgREST answered `200 []`. The bell showed "No notifications yet"
      // while the same query as the signed-in user returned 50 unread rows.
      const { data: feed, error: feedError } = await invokeSecureFunction<{
        success?: boolean;
        notifications?: Array<Record<string, unknown>>;
      }>(NOTIFICATIONS_FN, { action: 'list', limit: 50 });

      if (feedError || !feed?.success) {
        throw new Error(
          (feed as { error?: string } | null)?.error
          || (feedError as { message?: string } | null)?.message
          || 'notifications_unavailable',
        );
      }

      // Internal staff chat has its own surfaces — an unread count on the
      // minimised chat chip and on the Aurixa team icon. Keeping those rows out
      // of the global bell stops one busy conversation from burying operational
      // alerts (141 rows landed in a single day).
      const data = (feed.notifications ?? []).filter(
        (n: any) => n?.type !== 'internal_message',
      );

      if (data) {
        const notificationsWithDates = data.map((n: any) => ({
          ...n,
          reportId: n.report_id,
          entityId: n.entity_id,
          targetUserId: n.target_user_id,
          link: typeof n.link === 'string' ? n.link : undefined,
          metadata: n.metadata && typeof n.metadata === 'object' ? n.metadata : undefined,
          timestamp: new Date(n.timestamp)
        }));
        setNotifications(notificationsWithDates);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  }, []);

  // Load notifications from Supabase on mount and when user changes
  useEffect(() => {
    // Signed out there is no feed to read: `notifications-feed-v2` answers 401
    // and the failure surfaced as a runtime error on /auth. The staff session
    // cookie is unreadable from JS, so a resolved `user` from
    // custom-auth-verify-v2 is the browser's evidence that one exists.
    if (!user) {
      setNotifications([]);
      return;
    }
    fetchNotifications();
    
    // Realtime removed with the HS256 token (ES256 remediation). `postgres_changes`
    // authorises via a project JWT, and the browser no longer holds one — under
    // RLS the socket would deliver nothing while still looking healthy. The
    // bounded poll below was already the reliable path and is now the only one.
    // Realtime is a best-effort transport, not a guarantee: corporate proxies
    // block WebSockets outright, the socket dies silently on sleep/resume, and
    // a CHANNEL_ERROR surfaces nowhere the user can see. When it fails the bell
    // simply freezes on whatever it had at mount, which reads as "notifications
    // are broken". Poll on an interval and whenever the tab regains focus so
    // the bell keeps filling in regardless of the socket's health.
    const refresh = () => {
      if (document.visibilityState === 'visible') fetchNotifications();
    };
    const poll = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);

    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [fetchNotifications, user?.id]);


  /**
   * Mutations go through the same session-authenticated function as the read.
   *
   * These previously wrote straight to PostgREST and then waited for realtime
   * to echo the change back. Under the anon fallback that was doubly broken:
   * the write matched no policy so it silently affected zero rows, and the UI
   * never moved because nothing was echoed. "Mark all read" looked like a
   * no-op for a month, and the table agrees — zero of ~2,000 rows written
   * since 3 July were ever marked read.
   */
  const mutate = async (payload: Record<string, unknown>, failure: string) => {
    const { data, error } = await invokeSecureFunction<{ success?: boolean }>(
      NOTIFICATIONS_FN,
      payload,
    );
    if (error || !data?.success) {
      console.error(failure, error ?? data);
      fetchNotifications(); // fall back to server truth
    }
  };

  const addNotification = async (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    // Previously a direct insert, which under the anon fallback was rejected by
    // RLS and swallowed into console.error — every client-raised notification
    // was silently discarded.
    await mutate(
      {
        action: 'create',
        type: notification.type,
        title: notification.title,
        message: notification.message,
        report_id: notification.reportId ?? null,
        entity_id: notification.entityId ?? null,
        target_user_id: notification.targetUserId ?? null,
        // Omitting a target used to mean "broadcast to everyone". That is now
        // opt-in; an untargeted client notification belongs to whoever raised it.
        broadcast: false,
      },
      'Failed to add notification:',
    );
    fetchNotifications();
  };

  /**
   * Every mutation below applies to local state first.
   *
   * These used to write to the database and then wait for the realtime
   * subscription to echo the change back before the UI moved. When the socket
   * is not connected — the normal case behind a proxy that blocks WebSockets —
   * "Mark all read" and "Clear all" appeared to do nothing at all. Apply the
   * change immediately and re-sync from the server only if the write failed.
   */
  const markAsRead = async (id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
    await mutate({ action: 'mark_read', id }, 'Failed to mark notification as read:');
  };

  const markAllAsRead = async () => {
    setNotifications(prev => prev.map(n => (n.read ? n : { ...n, read: true })));
    await mutate({ action: 'mark_all_read' }, 'Failed to mark all as read:');
  };

  const clearNotification = async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    await mutate({ action: 'clear', id }, 'Failed to clear notification:');
  };

  const clearAll = async () => {
    setNotifications([]);
    await mutate({ action: 'clear_all' }, 'Failed to clear all notifications:');
  };

  const handleNotificationClick = (notification: Notification) => {
    markAsRead(notification.id);
    
    switch (notification.type) {
      case 'report_generated':
      case 'report_generation_completed':
      case 'report_regeneration_completed':
        if (notification.reportId || notification.entityId) {
          localStorage.setItem('openReportId', notification.reportId || notification.entityId || '');
        }
        navigate('/generated-reports?tab=investment');
        break;
      case 'report_failed':
      case 'report_generation_failed':
      case 'report_regeneration_failed':
      case 'report_generation_started':
      case 'report_regeneration_started':
      case 'report_archived':
      case 'report_restored':
        navigate('/generated-reports?tab=investment');
        break;
      case 'call_completed':
      case 'missed_call':
        navigate('/call-logs');
        break;
      case 'call_alert_triggered':
        navigate('/call-logs');
        break;
      case 'appointment_created':
      case 'appointment_rescheduled':
      case 'appointment_cancelled':
        navigate('/calendar');
        break;
      case 'client_reminder_due':
      case 'client_reminder_overdue':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/clients');
        }
        break;
      case 'email_received':
      case 'email_reply_sent':
        navigate('/email-copilot');
        break;
      case 'client_created':
      case 'client_updated':
      case 'portfolio_updated':
      case 'formara_form_uploaded':
      case 'formara_form_exported':
      case 'finance_agent_notified':
      case 'client_file_shared':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/clients');
        }
        break;
      // Phase 4 - System & User
      case 'user_role_updated':
      case 'new_user_invited':
        navigate('/admin/users');
        break;
      case 'system_maintenance':
        // Just mark as read, no navigation
        break;
      case 'data_import_complete':
        navigate('/data-import');
        break;
      // Deal lifecycle notifications
      case 'deal_finance_expiry_warning':
      case 'deal_finance_expiry_overdue':
      case 'deal_settlement_warning':
      case 'deal_settlement_overdue':
      case 'deal_build_date_warning':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/deal-pipeline');
        }
        break;
      case 'report_comment_added':
        if (notification.reportId || notification.entityId) {
          localStorage.setItem('openReportId', notification.reportId || notification.entityId || '');
        }
        navigate('/generated-reports?tab=investment');
        break;
      case 'reminder_assigned':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/reminders');
        }
        break;
      case 'deal_assigned':
        if (notification.entityId) {
          navigate(`/deal-pipeline`);
        } else {
          navigate('/deal-pipeline');
        }
        break;
      case 'report_request':
      case 'portal_report_requested':
        if (notification.entityId) {
          navigate(`/report-requests?highlight=${notification.entityId}`);
        } else {
          navigate('/report-requests');
        }
        break;
      case 'agreement_generated':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        }
        break;
      case 'new_ghl_contact':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/clients');
        }
        break;
      case 'new_marketing_lead':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/marketing-analytics');
        }
        break;
      case 'client_reminder_upcoming':
        if (notification.entityId) {
          navigate(`/clients?highlight=${notification.entityId}`);
        } else {
          navigate('/reminders');
        }
        break;
      case 'conversation_reply':
        if (notification.entityId) {
          // entityId is the client_id; find conversation to deep-link
          // For now navigate to conversations page — the notification trigger stores client_id as entity_id
          // We'll look up the conversation ID from the conversations list
          navigate(`/conversations`);
        } else {
          navigate('/conversations');
        }
        break;
      case 'conversation_shared':
        // Open the Oryxa agent widget and navigate to the shared conversation
        window.dispatchEvent(new CustomEvent('open-agent-conversation', { 
          detail: { conversationId: notification.entityId, tab: 'shared_with_me' } 
        }));
        break;
      case 'game_plan_created':
      case 'game_plan_updated':
      case 'game_plan_milestone_completed':
        navigate('/game-plan');
        break;
      case 'portal_message_received':
        if (notification.entityId) {
          navigate(`/clients?clientId=${notification.entityId}&tab=portal-messages`);
        } else {
          navigate('/clients');
        }
        break;
      case 'finance_portal_message_received':
        if (notification.entityId) {
          navigate(`/clients?clientId=${notification.entityId}&tab=finance-messages`);
        } else {
          navigate('/clients');
        }
        break;
      case 'bulk_conversation_sync_completed':
        navigate('/conversations');
        break;
      case 'internal_message':
        // Internal messaging lives in the Aurixa widget, not on a route.
        // `entity_id` is the thread id.
        requestOpenInternalMessages(notification.entityId);
        break;
      default: {
        // Types added by the backend no longer need a `case` here: producers
        // ship `link` (or `metadata.link_path`) and we follow it.
        const target = resolveNotificationLink(notification);
        if (target) navigate(target);
        break;
      }
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <NotificationsContext.Provider
      value={{
        notifications,
        unreadCount,
        addNotification,
        markAsRead,
        markAllAsRead,
        clearNotification,
        clearAll,
        handleNotificationClick
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationsProvider');
  }
  return context;
}

/**
 * Non-throwing variant. Returns null when no provider is mounted (e.g. during
 * an HMR partial refresh) so background listeners never blank the screen.
 */
export function useNotificationsOptional() {
  return useContext(NotificationsContext) ?? null;
}

