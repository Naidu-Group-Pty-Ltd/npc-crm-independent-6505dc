import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export type ComplianceRecordType =
  | 'bid' | 'fact_find' | 'preliminary_assessment' | 'credit_guide'
  | 'privacy_consent' | 'fha' | 'best_interests_duty' | 'cost_disclosure';

export type ComplianceStatus = 'draft' | 'pending_signature' | 'signed' | 'expired' | 'superseded' | 'voided';

export interface ComplianceRecord {
  id: string;
  client_id: string;
  deal_id: string | null;
  type: ComplianceRecordType;
  version: number;
  is_current: boolean;
  status: ComplianceStatus;
  title: string;
  content: Record<string, any>;
  pdf_storage_path: string | null;
  signed_pdf_storage_path: string | null;
  signature_method: 'docusign' | 'wet' | 'portal_consent' | 'email_consent' | null;
  docusign_envelope_id: string | null;
  docusign_status: string | null;
  generated_at: string;
  signed_at: string | null;
  signed_by_name: string | null;
  expires_at: string | null;
  superseded_by: string | null;
  notes: string | null;
}

export interface CompliancePackExport {
  id: string;
  client_id: string;
  deal_id: string | null;
  included_record_ids: string[];
  included_types: ComplianceRecordType[];
  pdf_storage_path: string | null;
  page_count: number | null;
  generated_at: string;
  shared_with_client: boolean;
  notes: string | null;
}

const FN = 'manage-compliance-records';
async function call(action: string, params: Record<string, any> = {}) {
  const { data, error } = await invokeSecureFunction(FN, { action, ...params });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Request failed');
  return data.data;
}

export function useComplianceRecords(opts?: { clientId?: string; dealId?: string; type?: ComplianceRecordType; currentOnly?: boolean }) {
  const qc = useQueryClient();
  const filters: Record<string, any> = {};
  if (opts?.clientId) filters.client_id = opts.clientId;
  if (opts?.dealId) filters.deal_id = opts.dealId;
  if (opts?.type) filters.type = opts.type;
  if (opts?.currentOnly) filters.is_current = true;

  const { data: records, isLoading } = useQuery({
    queryKey: ['compliance-records', filters],
    queryFn: () => call('list', { filters }) as Promise<ComplianceRecord[]>,
    enabled: !!opts?.clientId || !opts,
    staleTime: 30_000,
  });

  const createVersion = useMutation({
    mutationFn: (data: Partial<ComplianceRecord>) => call('create_version', { data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['compliance-records'] }); toast.success('New version saved'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, ...data }: { id: string; status: ComplianceStatus; signed_at?: string; signed_by_name?: string; signed_pdf_storage_path?: string; docusign_status?: string }) =>
      call('update_status', { id, data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['compliance-records'] }); toast.success('Status updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => call('delete', { id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['compliance-records'] }); toast.success('Record deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { records: records ?? [], isLoading, createVersion: createVersion.mutate, updateStatus: updateStatus.mutate, remove: remove.mutate };
}

export function useCompliancePacks(clientId: string | null | undefined) {
  const qc = useQueryClient();
  const { data: packs, isLoading } = useQuery({
    queryKey: ['compliance-packs', clientId],
    queryFn: () => call('list_packs', { filters: { client_id: clientId } }) as Promise<CompliancePackExport[]>,
    enabled: !!clientId,
  });

  const generate = useMutation({
    mutationFn: (data: Partial<CompliancePackExport>) => call('pack_export', { data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['compliance-packs'] }); toast.success('Compliance pack generated'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { packs: packs ?? [], isLoading, generate: generate.mutate };
}

export const COMPLIANCE_TYPE_LABEL: Record<ComplianceRecordType, string> = {
  bid: 'Best Interests Duty',
  fact_find: 'Fact Find',
  preliminary_assessment: 'Preliminary Assessment',
  credit_guide: 'Credit Guide',
  privacy_consent: 'Privacy Consent',
  fha: 'Financial Hardship Assistance',
  best_interests_duty: 'BID Statement',
  cost_disclosure: 'Cost Disclosure',
};
