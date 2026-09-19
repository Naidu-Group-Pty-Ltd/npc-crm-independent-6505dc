/**
 * Phase 14 — Template Analytics client helpers.
 *
 * Fire-and-forget logger + typed query helpers powered by the
 * `template-analytics` edge function. Read calls use the secure
 * invoker so they inherit the staff session; `logEvent` is best-effort
 * and never throws.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';

export type TemplateEventType =
  | 'edit_save'
  | 'edit_autosave'
  | 'edit_snapshot'
  | 'edit_restore'
  | 'render_success'
  | 'render_failed'
  | 'render_started'
  | 'preview_open'
  | 'share_view'
  | 'export_started'
  | 'export_completed'
  | string;

export interface TemplateEventLog {
  templateId: string;
  eventType: TemplateEventType;
  templateVersion?: number;
  pageId?: string;
  blockId?: string;
  shareToken?: string;
  metadata?: Record<string, unknown>;
}

/** Best-effort log. Never throws — safe to fire inside any handler. */
export function logTemplateEvent(evt: TemplateEventLog): void {
  invokeSecureFunction('template-analytics', { op: 'log', ...evt })
    .catch(() => { /* swallow */ });
}

// ─── Read APIs ────────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  days: number;
  total: number;
  byType: Record<string, number>;
  uniqueActors: number;
  lastEventAt: string | null;
}

export interface TimelinePoint {
  date: string;
  edits: number;
  renders: number;
  views: number;
  other: number;
}

export interface HeatmapResponse {
  days: number;
  pages: Array<{ id: string; count: number }>;
  blocks: Array<{ id: string; pageId: string | null; count: number }>;
}

export interface ShareTokenStat {
  token: string;
  count: number;
  lastAt: string | null;
  label?: string | null;
  mode?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
}

export interface RecentEvent {
  id: string;
  event_type: string;
  page_id: string | null;
  block_id: string | null;
  share_token: string | null;
  actor_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  template_version: number | null;
}

async function call<T>(op: string, payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction('template-analytics', { op, ...payload });
  if (error) throw new Error(error.message);
  return data as T;
}

export const templateAnalytics = {
  summary: (templateId: string, days = 30) =>
    call<AnalyticsSummary>('summary', { templateId, days }),
  timeline: (templateId: string, days = 30) =>
    call<{ days: number; timeline: TimelinePoint[] }>('timeline', { templateId, days }),
  heatmap: (templateId: string, days = 30) =>
    call<HeatmapResponse>('heatmap', { templateId, days }),
  shareViews: (templateId: string, days = 30) =>
    call<{ days: number; total: number; tokens: ShareTokenStat[] }>('shareViews', { templateId, days }),
  recent: (templateId: string, limit = 50) =>
    call<{ events: RecentEvent[] }>('recent', { templateId, limit }),
};
