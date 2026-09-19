/**
 * Solicitor Portal Phase 6 — communications client helpers.
 *
 * Thin, typed wrapper over the `solicitor-portal-comms` edge function so panels
 * never hand-roll transport or scope strings.
 */
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';

export const LEGAL_THREAD_SCOPES = [
  'solicitor_npc',
  'solicitor_client',
  'solicitor_finance',
  'firm_internal',
] as const;
export type LegalThreadScope = (typeof LEGAL_THREAD_SCOPES)[number];

export type LegalMessageSenderType =
  | 'solicitor_user'
  | 'staff'
  | 'client'
  | 'finance_partner'
  | 'system';

export interface LegalMatterThread {
  id: string;
  legal_matter_id: string;
  client_id: string | null;
  firm_id: string | null;
  scope: LegalThreadScope;
  subject: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_sender_type: LegalMessageSenderType | null;
  unread_count_solicitor: number;
  unread_count_staff: number;
  unread_count_client: number;
  unread_count_finance: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface LegalMatterMessage {
  id: string;
  thread_id: string;
  legal_matter_id: string;
  client_id: string | null;
  scope: LegalThreadScope;
  sender_type: LegalMessageSenderType;
  sender_solicitor_user_id: string | null;
  sender_name: string | null;
  body: string;
  is_internal: boolean;
  mirrored_client_message_id: string | null;
  mirrored_finance_message_id: string | null;
  created_at: string;
}

export interface SolicitorNotification {
  id: string;
  notification_type: string;
  title: string;
  body: string | null;
  link_path: string | null;
  legal_matter_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface SolicitorNotificationPref {
  event_type: string;
  channels: string[];
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
  is_enabled: boolean;
}

export const SCOPE_META: Record<LegalThreadScope, { label: string; description: string }> = {
  solicitor_npc: {
    label: 'NPC Command Centre',
    description: 'Direct line to the NPC team managing this transaction.',
  },
  solicitor_client: {
    label: 'Client',
    description: 'Mirrors into the client portal inbox so the buyer sees one conversation.',
  },
  solicitor_finance: {
    label: 'Finance partner',
    description: 'Reaches the broker working on the loan for this matter.',
  },
  firm_internal: {
    label: 'Firm internal',
    description: 'Private to your practice. Never visible to NPC, the client or the broker.',
  },
};

export const SCOPE_ORDER: LegalThreadScope[] = [
  'solicitor_npc',
  'solicitor_client',
  'solicitor_finance',
  'firm_internal',
];

export const NOTIFICATION_EVENT_LABELS: Record<string, string> = {
  message_received: 'New message',
  document_requested: 'Document requested',
  document_uploaded: 'Document uploaded',
  critical_date_due: 'Critical date approaching',
  requisition_raised: 'Requisition raised',
  matter_status_changed: 'Matter status changed',
  settlement_task_due: 'Settlement task due',
};

async function call<T = any>(operation: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await invokeSolicitorFunction<T>('solicitor-portal-comms', {
    operation,
    ...payload,
  });
  if (error) return { data: null, error: error.message };
  if ((data as any)?.error) return { data: null, error: (data as any).error as string };
  return { data: data as T, error: null };
}

export const solicitorComms = {
  listThreads: (matterId?: string) => call('list_threads', matterId ? { matter_id: matterId } : {}),
  getThread: (matterId: string, opts: { scope?: LegalThreadScope; threadId?: string }) =>
    call('get_thread', { matter_id: matterId, scope: opts.scope, thread_id: opts.threadId }),
  postMessage: (matterId: string, scope: LegalThreadScope, body: string) =>
    call('post_message', { matter_id: matterId, scope, body }),
  markThreadRead: (matterId: string, threadId: string) =>
    call('mark_thread_read', { matter_id: matterId, thread_id: threadId }),
  archiveThread: (matterId: string, threadId: string, archived = true) =>
    call('archive_thread', { matter_id: matterId, thread_id: threadId, archived }),
  unreadSummary: () => call('unread_summary'),
  listNotifications: (unreadOnly = false) => call('list_notifications', { unread_only: unreadOnly }),
  markNotificationRead: (notificationId: string) =>
    call('mark_notification_read', { notification_id: notificationId }),
  markAllNotificationsRead: () => call('mark_all_notifications_read'),
  getPrefs: () => call('get_prefs'),
  updatePrefs: (pref: Partial<SolicitorNotificationPref> & { event_type: string }) =>
    call('update_prefs', pref as Record<string, unknown>),
};

export function senderLabel(message: LegalMatterMessage): string {
  if (message.sender_name) return message.sender_name;
  switch (message.sender_type) {
    case 'staff': return 'NPC Command Centre';
    case 'client': return 'Client';
    case 'finance_partner': return 'Finance partner';
    case 'system': return 'System';
    default: return 'Solicitor';
  }
}
