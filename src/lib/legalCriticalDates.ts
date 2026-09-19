/**
 * Critical Date + Settlement Runway domain constants (Solicitor Portal — Phase 4).
 * Mirrors `supabase/functions/_shared/legalCriticalDates.ts` — keep in step.
 */

export type LegalCriticalDateType =
  | 'contract_date' | 'exchange' | 'cooling_off_expiry' | 'deposit_due' | 'balance_deposit_due'
  | 'finance_approval' | 'building_pest' | 'strata_report' | 'survey' | 'sunset_date'
  | 'notice_to_complete' | 'stamp_duty_due' | 'settlement' | 'pexa_lodgement' | 'other';

export type LegalCriticalDateStatus =
  | 'pending' | 'at_risk' | 'satisfied' | 'waived' | 'extended' | 'missed' | 'not_applicable';

export type LegalSettlementTaskStatus =
  | 'not_started' | 'in_progress' | 'blocked' | 'complete' | 'not_applicable';

export type LegalDateOwner =
  | 'solicitor' | 'client' | 'npc' | 'lender' | 'agent' | 'builder' | 'other';

export interface LegalCriticalDate {
  id: string;
  legal_matter_id: string;
  date_type: LegalCriticalDateType;
  label: string;
  due_date: string | null;
  due_time: string | null;
  status: LegalCriticalDateStatus;
  owner: LegalDateOwner;
  is_key: boolean;
  source: string;
  reminder_days: number[];
  last_reminder_sent_at: string | null;
  satisfied_at: string | null;
  satisfied_by_type: string | null;
  extended_from_date: string | null;
  visible_to_client: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LegalSettlementTask {
  id: string;
  legal_matter_id: string;
  task_key: string;
  label: string;
  sequence: number;
  status: LegalSettlementTaskStatus;
  owner: LegalDateOwner;
  offset_days: number | null;
  due_date: string | null;
  completed_at: string | null;
  completed_by_type: string | null;
  blocked_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunwaySummary {
  overdue_dates: number;
  due_soon_dates: number;
  tasks_total: number;
  tasks_complete: number;
  tasks_blocked: number;
  tasks_overdue: number;
  percent_complete: number;
}

export const CRITICAL_DATE_TYPE_LABELS: Record<LegalCriticalDateType, string> = {
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

export const CRITICAL_DATE_STATUS_LABELS: Record<LegalCriticalDateStatus, string> = {
  pending: 'Pending',
  at_risk: 'At risk',
  satisfied: 'Satisfied',
  waived: 'Waived',
  extended: 'Extended',
  missed: 'Missed',
  not_applicable: 'Not applicable',
};

/** Semantic tokens only. */
export const CRITICAL_DATE_STATUS_CLASSES: Record<LegalCriticalDateStatus, string> = {
  pending: 'border-border bg-muted text-muted-foreground',
  at_risk: 'border-warning/40 bg-warning/10 text-warning',
  satisfied: 'border-success/40 bg-success/10 text-success',
  waived: 'border-border bg-muted text-muted-foreground',
  extended: 'border-primary/30 bg-primary/10 text-primary',
  missed: 'border-destructive/40 bg-destructive/10 text-destructive',
  not_applicable: 'border-border bg-muted text-muted-foreground',
};

export const SETTLEMENT_TASK_STATUS_LABELS: Record<LegalSettlementTaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  complete: 'Complete',
  not_applicable: 'Not applicable',
};

export const SETTLEMENT_TASK_STATUS_CLASSES: Record<LegalSettlementTaskStatus, string> = {
  not_started: 'border-border bg-muted text-muted-foreground',
  in_progress: 'border-primary/30 bg-primary/10 text-primary',
  blocked: 'border-destructive/40 bg-destructive/10 text-destructive',
  complete: 'border-success/40 bg-success/10 text-success',
  not_applicable: 'border-border bg-muted text-muted-foreground',
};

export const DATE_OWNER_LABELS: Record<LegalDateOwner, string> = {
  solicitor: 'Solicitor',
  client: 'Client',
  npc: 'NPC',
  lender: 'Lender',
  agent: 'Agent',
  builder: 'Builder',
  other: 'Other',
};

export const CLOSED_DATE_STATUSES = new Set<LegalCriticalDateStatus>([
  'satisfied', 'waived', 'not_applicable',
]);

export const REMINDER_PRESETS: Array<{ label: string; days: number[] }> = [
  { label: '7 / 3 / 1 days', days: [7, 3, 1] },
  { label: '14 / 7 / 2 days', days: [14, 7, 2] },
  { label: '3 / 1 days', days: [3, 1] },
  { label: 'No reminders', days: [] },
];

export function isDateOverdue(d: Pick<LegalCriticalDate, 'status' | 'due_date'>): boolean {
  if (CLOSED_DATE_STATUSES.has(d.status)) return false;
  if (!d.due_date) return false;
  const target = new Date(`${d.due_date.slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return target.getTime() < today.getTime();
}
