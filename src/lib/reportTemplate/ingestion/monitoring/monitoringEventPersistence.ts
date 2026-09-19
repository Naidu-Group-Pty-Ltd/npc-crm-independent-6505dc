/**
 * monitoringEventPersistence — Phase 11C client-side invokers + row normalizer.
 *
 * Thin, safe wrappers around the secure `pdf-import-monitoring` Edge Function.
 * All authorization (capability checks, RLS, service-role access) is enforced
 * server-side; the browser never queries `pdf_import_monitoring_events`
 * directly. This module stores/relays only safe scalar alert metadata — never
 * raw PDF text, OCR, screenshots, or signed URLs.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  PDF_IMPORT_MONITORING_EVENT_VERSION,
  type MonitoringEvent,
  type MonitoringEventSeverity,
  type MonitoringEventStatus,
  type MonitoringHealthRollup,
} from './monitoringEventTypes';

export const PDF_IMPORT_MONITORING_FUNCTION = 'pdf-import-monitoring';

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;

export type MonitoringPersistenceResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'error'; message: string };

function errorMessage(error: unknown): string {
  if (!error) return 'unknown error';
  if (typeof error === 'string') return error;
  const maybe = error as { message?: unknown };
  return String(maybe?.message ?? error);
}

function asString(value: unknown): string {
  return value == null ? '' : String(value);
}

function asNullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function asScalar(value: unknown): number | boolean | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return null;
}

function asSafeContext(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v == null) out[k] = null;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v;
    // objects/arrays are intentionally dropped — no nested raw content.
  }
  return out;
}

/**
 * Normalize a DB row (snake_case) or an already-camelCase object into a
 * `MonitoringEvent`. Returns null on missing required fields.
 */
export function normalizeMonitoringEventRecord(raw: unknown): MonitoringEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const id = asString(r.id ?? r.event_id);
  const ruleId = asString(r.ruleId ?? r.rule_id);
  const eventKey = asString(r.eventKey ?? r.event_key);
  if (!id || !ruleId || !eventKey) return null;

  const firstSeen = asString(r.firstSeenAt ?? r.first_seen_at ?? r.created_at ?? '');
  const lastSeen = asString(r.lastSeenAt ?? r.last_seen_at ?? firstSeen);
  const created = asString(r.createdAt ?? r.created_at ?? firstSeen);
  const updated = asString(r.updatedAt ?? r.updated_at ?? lastSeen);

  return {
    id,
    version: PDF_IMPORT_MONITORING_EVENT_VERSION,
    eventKey,
    ruleId: ruleId as MonitoringEvent['ruleId'],
    domain: asString(r.domain ?? 'monitoring_self') as MonitoringEvent['domain'],
    severity: (asString(r.severity ?? 'warning') as MonitoringEventSeverity),
    status: (asString(r.status ?? 'open') as MonitoringEventStatus),
    owner: asString(r.owner ?? 'unknown') as MonitoringEvent['owner'],
    releaseBlocking: Boolean(r.releaseBlocking ?? r.release_blocking ?? false),
    title: asString(r.title),
    summary: asString(r.summary),
    metricValue: asScalar(r.metricValue ?? r.metric_value),
    threshold: asScalar(r.threshold),
    occurrenceCount: Number(r.occurrenceCount ?? r.occurrence_count ?? 1) || 1,
    firstSeenAt: firstSeen,
    lastSeenAt: lastSeen,
    acknowledgedAt: asNullableString(r.acknowledgedAt ?? r.acknowledged_at),
    acknowledgedBy: asNullableString(r.acknowledgedBy ?? r.acknowledged_by),
    resolvedAt: asNullableString(r.resolvedAt ?? r.resolved_at),
    resolvedBy: asNullableString(r.resolvedBy ?? r.resolved_by),
    suppressedUntil: asNullableString(r.suppressedUntil ?? r.suppressed_until),
    note: asNullableString(r.note),
    runbookAnchor: asString(r.runbookAnchor ?? r.runbook_anchor),
    context: asSafeContext(r.context),
    createdAt: created,
    updatedAt: updated,
  };
}

function normalizeMany(raw: unknown): MonitoringEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => normalizeMonitoringEventRecord(r))
    .filter((e): e is MonitoringEvent => e !== null);
}

async function call<T>(
  body: Record<string, unknown>,
  onData: (data: any) => MonitoringPersistenceResult<T>,
): Promise<MonitoringPersistenceResult<T>> {
  try {
    const { data, error } = await invokeSecureFunction<any>(PDF_IMPORT_MONITORING_FUNCTION, {
      body,
    } as any);
    if (error) return { kind: 'error', message: errorMessage(error) };
    if (!data || data.error || data.ok !== true) {
      return { kind: 'error', message: String(data?.error ?? `${body.operation} did not return ok`) };
    }
    return onData(data);
  } catch (error) {
    return { kind: 'error', message: errorMessage(error) };
  }
}

export interface RunMonitoringCheckResult {
  events: MonitoringEvent[];
  rollup: MonitoringHealthRollup | null;
  inserted: number;
  updated: number;
  autoResolved: number;
}

export interface ListMonitoringEventsOptions {
  status?: MonitoringEventStatus | 'active' | 'all';
  domain?: string;
  severity?: MonitoringEventSeverity;
  limit?: number;
}

/** Run a server-side monitoring check (detect + persist). No remediation. */
export async function runMonitoringCheck(options?: {
  thresholds?: Record<string, number>;
}): Promise<MonitoringPersistenceResult<RunMonitoringCheckResult>> {
  return call<RunMonitoringCheckResult>(
    { operation: 'run_check', thresholds: options?.thresholds ?? undefined },
    (data) => ({
      kind: 'ok',
      value: {
        events: normalizeMany(data.events),
        rollup: (data.rollup as MonitoringHealthRollup) ?? null,
        inserted: Number(data.inserted ?? 0) || 0,
        updated: Number(data.updated ?? 0) || 0,
        autoResolved: Number(data.auto_resolved ?? data.autoResolved ?? 0) || 0,
      },
    }),
  );
}

export async function listMonitoringEvents(
  options?: ListMonitoringEventsOptions,
): Promise<MonitoringPersistenceResult<{ events: MonitoringEvent[]; rollup: MonitoringHealthRollup | null }>> {
  const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Number(options?.limit) || DEFAULT_LIST_LIMIT));
  return call(
    {
      operation: 'list_events',
      status: options?.status ?? 'active',
      domain: options?.domain ?? undefined,
      severity: options?.severity ?? undefined,
      limit,
    },
    (data) => ({
      kind: 'ok',
      value: {
        events: normalizeMany(data.events),
        rollup: (data.rollup as MonitoringHealthRollup) ?? null,
      },
    }),
  );
}

async function lifecycle(
  operation: 'acknowledge_event' | 'resolve_event' | 'suppress_event' | 'mark_false_positive',
  eventId: string,
  extra?: Record<string, unknown>,
): Promise<MonitoringPersistenceResult<MonitoringEvent>> {
  if (!eventId) return { kind: 'error', message: 'eventId is required' };
  return call<MonitoringEvent>({ operation, event_id: eventId, ...(extra ?? {}) }, (data) => {
    const event = normalizeMonitoringEventRecord(data.event);
    if (!event) return { kind: 'error', message: 'invalid event record' };
    return { kind: 'ok', value: event };
  });
}

export function acknowledgeMonitoringEvent(eventId: string, note?: string) {
  return lifecycle('acknowledge_event', eventId, note ? { note } : undefined);
}

export function resolveMonitoringEvent(eventId: string, note?: string) {
  return lifecycle('resolve_event', eventId, note ? { note } : undefined);
}

export function suppressMonitoringEvent(eventId: string, suppressUntil?: string | null, note?: string) {
  return lifecycle('suppress_event', eventId, {
    suppress_until: suppressUntil ?? null,
    ...(note ? { note } : {}),
  });
}

export function markMonitoringEventFalsePositive(eventId: string, note?: string) {
  return lifecycle('mark_false_positive', eventId, note ? { note } : undefined);
}
