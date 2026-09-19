import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';

const FN = 'partner-compliance';

async function call(action: string, params: Record<string, unknown> = {}) {
  const { data, error } = await invokeSecureFunction(FN, { action, ...params });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

export interface PartnerAuditEvent {
  id: string;
  chain_key: string;
  agreement_id: string | null;
  referral_id: string | null;
  scope_type: string;
  scope_id: string | null;
  actor_type: string;
  actor_label: string | null;
  severity: 'info' | 'notice' | 'warn' | 'critical';
  category: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  prev_hash: string | null;
  row_hash: string | null;
  created_at: string;
}

export interface PrivacyIncident {
  id: string;
  reference: string;
  agreement_id: string | null;
  incident_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: string;
  reported_by_party: string;
  discovered_at: string;
  occurred_at: string | null;
  notification_deadline_at: string | null;
  assessment_due_at: string | null;
  title: string;
  description: string | null;
  affected_data_categories: string[];
  affected_individual_count: number;
  containment_actions: string | null;
  remediation_actions: string | null;
  root_cause: string | null;
  is_notifiable: boolean | null;
  notified_partner_at: string | null;
  notified_individuals_at: string | null;
  notified_regulator_at: string | null;
  regulator_reference: string | null;
  closed_at: string | null;
  closure_note: string | null;
  created_at: string;
}

export interface RetentionRecord {
  id: string;
  direction: string;
  status: string;
  version: number;
  partner_legal_name: string | null;
  partner_trading_name: string | null;
  effective_date: string | null;
  termination_effective_date: string | null;
  terminated_at: string | null;
  records_retention_years: number | null;
  retention_until: string | null;
  retention_hold: boolean;
  retention_hold_reason: string | null;
  destroyed_at: string | null;
  retention_state: string;
  days_until_retention_end: number | null;
}

export interface AccruedEntitlements {
  pending_commission_count: number;
  pending_commission_total: number;
  unpaid_statement_count: number;
  unpaid_statement_total: number;
  open_clawback_count: number;
  open_clawback_total: number;
  open_dispute_count: number;
}

export function usePartnerComplianceOverview() {
  return useQuery({
    queryKey: ['partner-compliance', 'overview'],
    queryFn: () => call('overview'),
    staleTime: 60_000,
  });
}

export function usePartnerAuditTrail(filters: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: ['partner-compliance', 'audit', filters],
    queryFn: async () => ((await call('audit_timeline', filters)).events ?? []) as PartnerAuditEvent[],
    staleTime: 30_000,
  });
}

export function useVerifyPartnerChain() {
  return useMutation({
    mutationFn: (agreementId?: string) => call('audit_verify', agreementId ? { agreement_id: agreementId } : {}),
    onSuccess: (res: any) => {
      if (res.ok) toast.success(`Chain intact — ${res.total} sealed entries verified`);
      else toast.error(`Chain integrity failure at entry ${res.broken_at}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function usePrivacyIncidents(filters: Record<string, unknown> = {}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['partner-compliance', 'incidents', filters],
    queryFn: async () => ((await call('incident_list', filters)).incidents ?? []) as PrivacyIncident[],
    staleTime: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['partner-compliance'] });
  };

  const create = useMutation({
    mutationFn: (data: Partial<PrivacyIncident>) => call('incident_create', { data }),
    onSuccess: () => { invalidate(); toast.success('Privacy incident logged'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PrivacyIncident> & { status?: string } }) =>
      call('incident_update', { id, data }),
    onSuccess: () => { invalidate(); toast.success('Incident updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const notify = useMutation({
    mutationFn: ({ id, party, regulator_reference }: { id: string; party: 'partner' | 'individuals' | 'regulator'; regulator_reference?: string }) =>
      call('incident_notify', { id, party, regulator_reference }),
    onSuccess: () => { invalidate(); toast.success('Notification recorded'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const close = useMutation({
    mutationFn: ({ id, closure_note, override }: { id: string; closure_note?: string; override?: boolean }) =>
      call('incident_close', { id, closure_note, override }),
    onSuccess: () => { invalidate(); toast.success('Incident closed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { ...query, create, update, notify, close };
}

export function useRetentionRegister(filters: Record<string, unknown> = {}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['partner-compliance', 'retention', filters],
    queryFn: async () => ((await call('retention_register', filters)).records ?? []) as RetentionRecord[],
    staleTime: 60_000,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['partner-compliance'] });

  const setHold = useMutation({
    mutationFn: ({ id, hold, reason }: { id: string; hold: boolean; reason?: string }) =>
      call('retention_set_hold', { id, hold, reason }),
    onSuccess: () => { invalidate(); toast.success('Legal hold updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const markDestroyed = useMutation({
    mutationFn: ({ id, note, override }: { id: string; note?: string; override?: boolean }) =>
      call('retention_mark_destroyed', { id, note, override }),
    onSuccess: () => { invalidate(); toast.success('Destruction recorded'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { ...query, setHold, markDestroyed };
}

export function useTerminationWorkflow() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['partner-compliance'] });
    qc.invalidateQueries({ queryKey: ['partner-agreements'] });
  };

  const preview = useMutation({
    mutationFn: (id: string) => call('termination_preview', { id }),
    onError: (e: Error) => toast.error(e.message),
  });
  const execute = useMutation({
    mutationFn: (params: {
      id: string;
      termination_reason: string;
      termination_effective_date?: string;
      post_termination_cutoff_date?: string;
    }) => call('termination_execute', params),
    onSuccess: () => { invalidate(); toast.success('Agreement terminated and entitlements snapshotted'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const resolveEntitlements = useMutation({
    mutationFn: ({ id, note, override }: { id: string; note?: string; override?: boolean }) =>
      call('termination_resolve_entitlements', { id, note, override }),
    onSuccess: () => { invalidate(); toast.success('Accrued entitlements marked resolved'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { preview, execute, resolveEntitlements };
}

export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  unauthorised_disclosure: 'Unauthorised disclosure',
  unauthorised_access: 'Unauthorised access',
  data_loss: 'Data loss',
  misdirected_communication: 'Misdirected communication',
  system_compromise: 'System compromise',
  boundary_breach: 'Information boundary breach',
  other: 'Other',
};

export const RETENTION_STATE_LABELS: Record<string, string> = {
  retained: 'Retained',
  expiring_soon: 'Expiring soon',
  eligible_for_destruction: 'Eligible for destruction',
  legal_hold: 'Legal hold',
  destroyed: 'Destroyed',
  unknown: 'Unknown',
};
