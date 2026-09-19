/**
 * Shared Critical Date + Settlement Runway helpers (Solicitor Portal — Phase 4).
 *
 * Used by both `solicitor-portal-matters` (portal-facing) and
 * `legal-matters-admin` (Command Centre) so the two surfaces can never drift.
 * Nothing here touches financial-position or AML-restricted data.
 */
import { cleanDate, cleanEnum, cleanNumber, cleanText } from './legalMatters.ts';

export const LEGAL_CRITICAL_DATE_TYPES = [
  'contract_date', 'exchange', 'cooling_off_expiry', 'deposit_due', 'balance_deposit_due',
  'finance_approval', 'building_pest', 'strata_report', 'survey', 'sunset_date',
  'notice_to_complete', 'stamp_duty_due', 'settlement', 'pexa_lodgement', 'other',
] as const;

export const LEGAL_CRITICAL_DATE_STATUSES = [
  'pending', 'at_risk', 'satisfied', 'waived', 'extended', 'missed', 'not_applicable',
] as const;

export const LEGAL_SETTLEMENT_TASK_STATUSES = [
  'not_started', 'in_progress', 'blocked', 'complete', 'not_applicable',
] as const;

export const LEGAL_DATE_OWNERS = [
  'solicitor', 'client', 'npc', 'lender', 'agent', 'builder', 'other',
] as const;

export const CRITICAL_DATE_SELECT = `
  id, legal_matter_id, date_type, label, due_date, due_time, status, owner,
  is_key, source, reminder_days, last_reminder_sent_at, satisfied_at,
  satisfied_by_type, extended_from_date, visible_to_client, notes,
  created_at, updated_at
`;

export const SETTLEMENT_TASK_SELECT = `
  id, legal_matter_id, task_key, label, sequence, status, owner, offset_days,
  due_date, completed_at, completed_by_type, blocked_reason, notes,
  created_at, updated_at
`;

/** Terminal states for a critical date — no reminder is ever sent for these. */
export const CLOSED_DATE_STATUSES = new Set(['satisfied', 'waived', 'not_applicable']);

export function buildCriticalDatePayload(
  body: Record<string, any>,
  { isCreate }: { isCreate: boolean },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if ('date_type' in body || isCreate) {
    payload.date_type = cleanEnum(body.date_type, LEGAL_CRITICAL_DATE_TYPES, 'other');
  }
  if ('label' in body || isCreate) {
    payload.label = cleanText(body.label, 160);
  }
  if ('due_date' in body || isCreate) payload.due_date = cleanDate(body.due_date);
  if ('due_time' in body) payload.due_time = cleanTime(body.due_time);
  if ('status' in body) {
    payload.status = cleanEnum(body.status, LEGAL_CRITICAL_DATE_STATUSES, 'pending');
  }
  if ('owner' in body) payload.owner = cleanEnum(body.owner, LEGAL_DATE_OWNERS, 'solicitor');
  if ('is_key' in body) payload.is_key = !!body.is_key;
  if ('visible_to_client' in body) payload.visible_to_client = !!body.visible_to_client;
  if ('notes' in body) payload.notes = cleanText(body.notes, 4000);
  if ('reminder_days' in body) payload.reminder_days = cleanReminderDays(body.reminder_days);
  if ('extended_from_date' in body) payload.extended_from_date = cleanDate(body.extended_from_date);

  if (isCreate && !payload.label) {
    payload.label = CRITICAL_DATE_TYPE_LABELS[String(payload.date_type || 'other')] || 'Critical date';
  }

  return payload;
}

export function buildSettlementTaskPayload(body: Record<string, any>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if ('status' in body) {
    payload.status = cleanEnum(body.status, LEGAL_SETTLEMENT_TASK_STATUSES, 'not_started');
  }
  if ('owner' in body) payload.owner = cleanEnum(body.owner, LEGAL_DATE_OWNERS, 'solicitor');
  if ('due_date' in body) payload.due_date = cleanDate(body.due_date);
  if ('notes' in body) payload.notes = cleanText(body.notes, 4000);
  if ('blocked_reason' in body) payload.blocked_reason = cleanText(body.blocked_reason, 500);
  if ('label' in body) payload.label = cleanText(body.label, 160);
  if ('sequence' in body) payload.sequence = cleanNumber(body.sequence);
  return payload;
}

export function cleanTime(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).trim().slice(0, 8);
  return /^\d{2}:\d{2}(:\d{2})?$/.test(s) ? s : null;
}

export function cleanReminderDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [7, 3, 1];
  const days = value
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 90);
  return Array.from(new Set(days)).sort((a, b) => b - a).slice(0, 6);
}

export const CRITICAL_DATE_TYPE_LABELS: Record<string, string> = {
  contract_date: 'Contract date',
  exchange: 'Exchange',
  cooling_off_expiry: 'Cooling-off expiry',
  deposit_due: 'Deposit due',
  balance_deposit_due: 'Balance deposit due',
  finance_approval: 'Finance approval',
  building_pest: 'Building & pest',
  strata_report: 'Strata report',
  survey: 'Survey',
  sunset_date: 'Sunset date',
  notice_to_complete: 'Notice to complete',
  stamp_duty_due: 'Stamp duty due',
  settlement: 'Settlement',
  pexa_lodgement: 'PEXA lodgement',
  other: 'Other',
};

/** Days until an ISO date, negative when overdue. */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const target = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target.getTime() - utcToday) / 86_400_000);
}

/**
 * Roll-up used by dashboards + the matter header. Pure function so both the
 * portal and Command Centre report the same numbers.
 */
export function summariseRunway(
  dates: Array<{ status: string; due_date: string | null }>,
  tasks: Array<{ status: string; due_date: string | null }>,
) {
  let overdueDates = 0;
  let dueSoonDates = 0;
  for (const d of dates) {
    if (CLOSED_DATE_STATUSES.has(d.status)) continue;
    const n = daysUntil(d.due_date);
    if (n === null) continue;
    if (n < 0) overdueDates++;
    else if (n <= 7) dueSoonDates++;
  }

  const active = tasks.filter((t) => t.status !== 'not_applicable');
  const complete = active.filter((t) => t.status === 'complete').length;
  const blocked = active.filter((t) => t.status === 'blocked').length;
  let overdueTasks = 0;
  for (const t of active) {
    if (t.status === 'complete') continue;
    const n = daysUntil(t.due_date);
    if (n !== null && n < 0) overdueTasks++;
  }

  return {
    overdue_dates: overdueDates,
    due_soon_dates: dueSoonDates,
    tasks_total: active.length,
    tasks_complete: complete,
    tasks_blocked: blocked,
    tasks_overdue: overdueTasks,
    percent_complete: active.length ? Math.round((complete / active.length) * 100) : 0,
  };
}
