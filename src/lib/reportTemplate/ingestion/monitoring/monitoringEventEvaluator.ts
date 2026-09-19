/**
 * monitoringEventEvaluator — Phase 11C durable-event evaluation + lifecycle.
 *
 * Turns fired signals into candidate durable events, computes a severity/status
 * aware health rollup, and provides the pure reconciliation + lifecycle
 * transition logic the Edge Function applies against persisted rows. Nothing
 * here performs remediation, retries, reruns, reconciliation, or template
 * mutation — it only classifies and manages alert lifecycle state.
 */
import { getMonitoringEventRule } from './monitoringEventRules';
import { deriveMonitoringSignals } from './monitoringEventSignals';
import {
  MONITORING_EVENT_ACTIVE_STATUSES,
  MONITORING_EVENT_RULES_FALLBACK_OWNER,
  MONITORING_EVENT_SEVERITY_RANK,
  PDF_IMPORT_MONITORING_EVENT_VERSION,
  type MonitoringEvaluationInput,
  type MonitoringEvaluationResult,
  type MonitoringEvent,
  type MonitoringEventLifecycleAction,
  type MonitoringEventOwner,
  type MonitoringEventRuleId,
  type MonitoringEventSeverity,
  type MonitoringEventSignal,
  type MonitoringEventStatus,
  type MonitoringHealthRollup,
  type MonitoringHealthStatus,
} from './monitoringEventTypes';
import { MONITORING_EVENT_RULES } from './monitoringEventRules';

const ACTIVE_STATUS_SET = new Set<MonitoringEventStatus>(MONITORING_EVENT_ACTIVE_STATUSES);

/** Deterministic dedupe key. Scope defaults to 'global' (one open event per rule). */
export function buildMonitoringEventKey(
  ruleId: MonitoringEventRuleId,
  dedupeScope: string = 'global',
): string {
  const scope = String(dedupeScope || 'global').trim() || 'global';
  return `${ruleId}:${scope}`;
}

function isActive(status: MonitoringEventStatus): boolean {
  return ACTIVE_STATUS_SET.has(status);
}

/** Highest severity across active events (info when none active). */
export function resolveHighestActiveSeverity(events: MonitoringEvent[]): MonitoringEventSeverity {
  let highest: MonitoringEventSeverity = 'info';
  for (const e of Array.isArray(events) ? events : []) {
    if (!isActive(e.status)) continue;
    if (MONITORING_EVENT_SEVERITY_RANK[e.severity] > MONITORING_EVENT_SEVERITY_RANK[highest]) {
      highest = e.severity;
    }
  }
  return highest;
}

/** Advisory primary owner: owner of the highest-severity active event. */
export function resolvePrimaryOwner(events: MonitoringEvent[]): MonitoringEventOwner {
  const active = (Array.isArray(events) ? events : []).filter((e) => isActive(e.status));
  if (active.length === 0) return MONITORING_EVENT_RULES_FALLBACK_OWNER;
  const highest = resolveHighestActiveSeverity(active);
  const first = active.find((e) => e.severity === highest);
  return first?.owner ?? MONITORING_EVENT_RULES_FALLBACK_OWNER;
}

function statusFromSeverity(severity: MonitoringEventSeverity): MonitoringHealthStatus {
  switch (severity) {
    case 'critical':
      return 'critical_alerts_present';
    case 'high':
      return 'high_alerts_present';
    case 'warning':
      return 'warnings_present';
    default:
      return 'info_present';
  }
}

/** Severity/status-aware rollup over a set of events. */
export function buildMonitoringHealthRollup(
  events: MonitoringEvent[],
  now: () => Date = () => new Date(),
): MonitoringHealthRollup {
  const list = Array.isArray(events) ? events : [];
  const active = list.filter((e) => isActive(e.status));

  const counts = {
    total: list.length,
    active: active.length,
    open: list.filter((e) => e.status === 'open').length,
    acknowledged: list.filter((e) => e.status === 'acknowledged').length,
    resolved: list.filter((e) => e.status === 'resolved').length,
    suppressed: list.filter((e) => e.status === 'suppressed').length,
    falsePositive: list.filter((e) => e.status === 'false_positive').length,
    info: active.filter((e) => e.severity === 'info').length,
    warning: active.filter((e) => e.severity === 'warning').length,
    high: active.filter((e) => e.severity === 'high').length,
    critical: active.filter((e) => e.severity === 'critical').length,
  };

  const highestActiveSeverity = resolveHighestActiveSeverity(active);
  const status: MonitoringHealthStatus = active.length === 0 ? 'healthy' : statusFromSeverity(highestActiveSeverity);

  return {
    status,
    highestActiveSeverity,
    primaryOwner: resolvePrimaryOwner(active),
    releaseBlockingActive: active.some((e) => e.releaseBlocking),
    counts,
    generatedAt: now().toISOString(),
  };
}

/** Build a fresh, open candidate event from a fired signal. */
export function buildCandidateEvent(
  signal: MonitoringEventSignal,
  options?: { dedupeScope?: string; now?: () => Date },
): MonitoringEvent {
  const rule = getMonitoringEventRule(signal.ruleId);
  const now = options?.now ?? (() => new Date());
  const iso = now().toISOString();
  return {
    id: '',
    version: PDF_IMPORT_MONITORING_EVENT_VERSION,
    eventKey: buildMonitoringEventKey(signal.ruleId, options?.dedupeScope),
    ruleId: signal.ruleId,
    domain: rule.domain,
    severity: signal.severity ?? rule.defaultSeverity,
    status: 'open',
    owner: rule.owner,
    releaseBlocking: rule.releaseBlocking,
    title: rule.title,
    summary: signal.summary,
    metricValue: signal.metricValue,
    threshold: signal.threshold,
    occurrenceCount: 1,
    firstSeenAt: iso,
    lastSeenAt: iso,
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    suppressedUntil: null,
    note: null,
    runbookAnchor: rule.runbookAnchor,
    context: { ...(signal.context ?? {}) },
    createdAt: iso,
    updatedAt: iso,
  };
}

/**
 * Full evaluation: signals → candidate events + rollup + the rule ids that did
 * NOT fire (used by the Edge Function to auto-resolve stale open events).
 */
export function evaluateMonitoringEvents(input: MonitoringEvaluationInput): MonitoringEvaluationResult {
  const now = input?.now ?? (() => new Date());
  const signals = deriveMonitoringSignals(input.metrics, input?.thresholds);
  const dedupeScope = 'global';
  const candidates = signals.map((s) => buildCandidateEvent(s, { dedupeScope, now }));

  const firedRuleIds = new Set<MonitoringEventRuleId>(signals.map((s) => s.ruleId));
  const clearedRuleIds = MONITORING_EVENT_RULES.map((r) => r.ruleId).filter((id) => !firedRuleIds.has(id));

  return {
    version: PDF_IMPORT_MONITORING_EVENT_VERSION,
    signals,
    candidates,
    clearedRuleIds,
    rollup: buildMonitoringHealthRollup(candidates, now),
    generatedAt: now().toISOString(),
  };
}

/**
 * Reconcile a candidate against an existing persisted row of the same eventKey.
 * Idempotent: an already-resolved/suppressed/false_positive event is NOT
 * reopened here unless it is stale (its suppression window elapsed) — the
 * reopen decision is left to `shouldReopenSuppressed`. Returns the merged event
 * to upsert.
 */
export function mergeCandidateIntoExisting(
  existing: MonitoringEvent,
  candidate: MonitoringEvent,
  now: () => Date = () => new Date(),
): MonitoringEvent {
  const iso = now().toISOString();

  // Suppressed with an unexpired window → keep suppressed, just bump last-seen.
  if (existing.status === 'suppressed' && !isSuppressionExpired(existing, now)) {
    return { ...existing, lastSeenAt: iso, occurrenceCount: existing.occurrenceCount + 1, updatedAt: iso };
  }

  // false_positive stays false_positive (deliberate human decision) — bump seen only.
  if (existing.status === 'false_positive') {
    return { ...existing, lastSeenAt: iso, occurrenceCount: existing.occurrenceCount + 1, updatedAt: iso };
  }

  // Otherwise the signal is firing again: reopen (from resolved/suppressed) or
  // keep active, refreshing severity/summary/metric and incrementing count.
  const reopened = existing.status === 'resolved' || existing.status === 'suppressed';
  return {
    ...existing,
    status: reopened ? 'open' : existing.status,
    severity: candidate.severity,
    summary: candidate.summary,
    metricValue: candidate.metricValue,
    threshold: candidate.threshold,
    context: { ...candidate.context },
    occurrenceCount: existing.occurrenceCount + 1,
    lastSeenAt: iso,
    resolvedAt: reopened ? null : existing.resolvedAt,
    resolvedBy: reopened ? null : existing.resolvedBy,
    suppressedUntil: reopened ? null : existing.suppressedUntil,
    updatedAt: iso,
  };
}

export function isSuppressionExpired(event: MonitoringEvent, now: () => Date = () => new Date()): boolean {
  if (event.status !== 'suppressed') return false;
  if (!event.suppressedUntil) return false; // indefinite suppression
  return new Date(event.suppressedUntil).getTime() <= now().getTime();
}

/**
 * Decide whether an existing open/acknowledged event whose rule no longer fires
 * should be auto-resolved. Suppressed & false_positive are never auto-resolved.
 */
export function shouldAutoResolve(event: MonitoringEvent): boolean {
  return event.status === 'open' || event.status === 'acknowledged';
}

/** Pure lifecycle transition. Returns the updated event, or null if the transition is invalid. */
export function applyLifecycleAction(
  event: MonitoringEvent,
  action: MonitoringEventLifecycleAction,
  options: { actorId?: string | null; note?: string | null; suppressUntil?: string | null; now?: () => Date },
): MonitoringEvent | null {
  const now = options?.now ?? (() => new Date());
  const iso = now().toISOString();
  const actor = options?.actorId ?? null;
  const note = options?.note ?? event.note;

  switch (action) {
    case 'acknowledge':
      if (event.status !== 'open') return null;
      return { ...event, status: 'acknowledged', acknowledgedAt: iso, acknowledgedBy: actor, note, updatedAt: iso };
    case 'resolve':
      if (event.status === 'resolved') return null;
      return { ...event, status: 'resolved', resolvedAt: iso, resolvedBy: actor, note, updatedAt: iso };
    case 'suppress':
      if (event.status === 'resolved' || event.status === 'false_positive') return null;
      return { ...event, status: 'suppressed', suppressedUntil: options?.suppressUntil ?? null, note, updatedAt: iso };
    case 'mark_false_positive':
      if (event.status === 'false_positive') return null;
      return { ...event, status: 'false_positive', resolvedAt: iso, resolvedBy: actor, note, updatedAt: iso };
    default:
      return null;
  }
}
