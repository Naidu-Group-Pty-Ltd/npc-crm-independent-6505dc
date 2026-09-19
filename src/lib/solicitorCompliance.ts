/**
 * Solicitor Portal Phase 8 — compliance, audit & retention client helpers.
 *
 * Typed wrapper over the `solicitor-portal-compliance` edge function. All
 * authorisation happens server-side; this module only shapes payloads and
 * normalises responses for the compliance surfaces.
 */
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';

export type LegalAuditSeverity = 'info' | 'notice' | 'warning' | 'critical';

export interface LegalAuditEvent {
  id: string;
  legal_matter_id: string | null;
  client_id: string | null;
  firm_id: string | null;
  actor_type: string;
  actor_solicitor_user_id: string | null;
  actor_staff_user_id: string | null;
  actor_client_portal_user_id: string | null;
  severity: LegalAuditSeverity;
  category: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  fields_accessed: string[] | null;
  description: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  retention_class: string;
  prev_hash: string | null;
  row_hash: string | null;
  created_at: string;
}

export interface LegalAuditStats {
  total: number;
  critical: number;
  warning: number;
  by_category: Record<string, number>;
}

export interface LegalAuditChainVerification {
  verified: boolean;
  checked: number;
  broken_at: string | null;
  broken_reason: string | null;
  first_event_at: string | null;
  last_event_at: string | null;
}

export type ConflictOutcome = 'pending' | 'clear' | 'potential_conflict' | 'conflict' | 'waived';

export interface ConflictMatch {
  party_id: string;
  party_name: string | null;
  party_organisation: string | null;
  party_role: string | null;
  matched_term: string | null;
  matter_id: string;
  matter_reference: string | null;
  matter_title: string | null;
  matter_status: string | null;
  same_client: boolean;
}

export interface LegalConflictCheck {
  id: string;
  legal_matter_id: string;
  searched_terms: string[];
  outcome: ConflictOutcome;
  matches: ConflictMatch[];
  match_count: number;
  notes: string | null;
  cleared_at: string | null;
  cleared_by_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatterClosureState {
  closure_status: 'open' | 'closing' | 'closed' | 'archived';
  closure_reason: string | null;
  closure_checklist: Record<string, boolean>;
  closed_at: string | null;
  retention_class: string;
  retention_until: string | null;
  archived_at: string | null;
}

export interface ClosureBlocker { code: string; label: string; count: number }

export interface ComplianceHealthSignal {
  code: string;
  label: string;
  severity: string;
  matters: string[];
}

export const AUDIT_CATEGORY_LABELS: Record<string, string> = {
  access: 'Access',
  matter: 'Matter',
  party: 'Parties',
  document: 'Documents',
  search: 'Searches',
  requisition: 'Requisitions',
  disbursement: 'Disbursements',
  critical_date: 'Critical dates',
  settlement: 'Settlement',
  communication: 'Messages',
  intelligence: 'Intelligence',
  conflict: 'Conflict checks',
  closure: 'Closure',
  retention: 'Retention',
  export: 'Exports',
  admin: 'Administration',
};

export const CLOSURE_CHECKLIST_LABELS: Record<string, string> = {
  settlement_completed: 'Settlement completed',
  trust_account_reconciled: 'Trust account reconciled',
  disbursements_settled: 'Disbursements settled',
  documents_delivered: 'Documents delivered to client',
  title_registered: 'Title registered / dealing lodged',
  client_final_letter_sent: 'Final letter sent to client',
  file_deidentified: 'File de-identified where required',
};

export const RETENTION_CLASS_LABELS: Record<string, string> = {
  standard_7y: 'Standard — 7 years',
  conveyancing_7y: 'Conveyancing — 7 years',
  litigation_10y: 'Litigation — 10 years',
  trust_records_7y: 'Trust records — 7 years',
  permanent: 'Permanent retention',
};

export const CONFLICT_OUTCOME_LABELS: Record<ConflictOutcome, string> = {
  pending: 'Pending',
  clear: 'Clear',
  potential_conflict: 'Potential conflict',
  conflict: 'Conflict',
  waived: 'Waived (informed consent)',
};

export const CONFLICT_OUTCOME_CLASSES: Record<ConflictOutcome, string> = {
  pending: 'border-muted-foreground/30 text-muted-foreground',
  clear: 'border-success/40 text-success',
  potential_conflict: 'border-warning/40 text-warning',
  conflict: 'border-destructive/40 text-destructive',
  waived: 'border-primary/40 text-primary',
};

export const AUDIT_SEVERITY_CLASSES: Record<LegalAuditSeverity, string> = {
  info: 'border-muted-foreground/30 text-muted-foreground',
  notice: 'border-primary/40 text-primary',
  warning: 'border-warning/40 text-warning',
  critical: 'border-destructive/40 text-destructive',
};

async function call<T>(operation: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await invokeSolicitorFunction<T & { error?: string }>(
    'solicitor-portal-compliance',
    { operation, ...payload },
  );
  if (error) throw new Error(error.message);
  return data as T;
}

export const solicitorCompliance = {
  auditTimeline: (matter_id: string, filters: { category?: string; severity?: string; limit?: number } = {}) =>
    call<{ records: LegalAuditEvent[]; stats: LegalAuditStats }>('audit_timeline', { matter_id, ...filters }),

  auditVerify: (matter_id: string) =>
    call<{ verification: LegalAuditChainVerification }>('audit_verify', { matter_id }),

  conflictList: (matter_id: string) =>
    call<{ records: LegalConflictCheck[]; conflict_check_status: string; conflict_checked_at: string | null }>(
      'conflict_list', { matter_id },
    ),

  conflictRun: (matter_id: string, terms: string[] = [], notes?: string) =>
    call<{ record: LegalConflictCheck; outcome: ConflictOutcome; match_count: number }>(
      'conflict_run', { matter_id, terms, notes },
    ),

  conflictClear: (matter_id: string, check_id: string, outcome: ConflictOutcome, notes?: string) =>
    call<{ record: LegalConflictCheck }>('conflict_clear', { matter_id, check_id, outcome, notes }),

  closureState: (matter_id: string) =>
    call<{
      closure: MatterClosureState;
      checklist_keys: string[];
      retention_classes: string[];
      blockers: ClosureBlocker[];
    }>('closure_state', { matter_id }),

  closureUpdate: (
    matter_id: string,
    patch: { checklist?: Record<string, boolean>; retention_class?: string; closure_reason?: string },
  ) => call<{ closure: MatterClosureState }>('closure_update', { matter_id, ...patch }),

  closeMatter: (matter_id: string, opts: { retention_class?: string; reason?: string; archive?: boolean } = {}) =>
    call<{ closure: MatterClosureState }>('matter_close', { matter_id, ...opts }),

  reopenMatter: (matter_id: string, reason: string) =>
    call<{ closure: MatterClosureState }>('matter_reopen', { matter_id, reason }),

  exportPack: (matter_id: string, scope: 'full' | 'audit_only' = 'full') =>
    call<{ export: Record<string, unknown> }>('compliance_export', { matter_id, scope }),

  health: () =>
    call<{ health: {
      matters: number; open?: number; closed?: number; archived?: number;
      conflict_clear?: number; signals: ComplianceHealthSignal[];
      index?: Array<{ id: string; matter_reference: string | null; title: string }>;
    } }>('compliance_health'),
};

/** Download a compliance pack as a JSON file (client-side, no storage write). */
export function downloadCompliancePack(matterReference: string, pack: unknown) {
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `compliance-pack-${matterReference || 'matter'}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
