import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export type UndertakingStatus = 'draft' | 'pending_signature' | 'active' | 'expired' | 'terminated';

export interface LoanWriterUndertaking {
  id: string;
  reference: string;
  agreement_id: string | null;
  finance_agent_contact_id: string | null;
  finance_user_id: string | null;

  writer_full_name: string;
  writer_email: string | null;
  writer_phone: string | null;
  writer_entity_name: string | null;
  licensee_name: string | null;
  acl_number: string | null;
  crn: string | null;
  authorisation_end_date: string | null;

  status: UndertakingStatus;
  effective_date: string | null;
  expiry_date: string | null;

  signed_at: string | null;
  signed_by_name: string | null;
  signature_method: string | null;
  signature_artefact_path: string | null;
  envelope_id: string | null;

  terminated_at: string | null;
  termination_reason: string | null;

  notes: string | null;
  is_live?: boolean;
  created_at: string;
  updated_at: string;
}

const FN = 'manage-loan-writer-undertakings';

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>(FN, payload);
  if (error) throw new Error(error.message);
  const err = (data as { error?: string; message?: string } | null)?.error;
  if (err) throw new Error((data as { message?: string })?.message || err);
  return data as T;
}

export function useLoanWriterUndertakings(filters?: { status?: UndertakingStatus; agreement_id?: string }) {
  return useQuery({
    queryKey: ['loan-writer-undertakings', filters?.status ?? 'all', filters?.agreement_id ?? 'all'],
    queryFn: async () => {
      const data = await call<{ undertakings: LoanWriterUndertaking[] }>({
        action: 'list',
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.agreement_id ? { agreement_id: filters.agreement_id } : {}),
      });
      return data.undertakings ?? [];
    },
  });
}

export function useLoanWriterUndertaking(id: string | null) {
  return useQuery({
    queryKey: ['loan-writer-undertaking', id],
    enabled: !!id,
    queryFn: () =>
      call<{ undertaking: LoanWriterUndertaking; referrals: Record<string, unknown>[] }>({ action: 'get', id }),
  });
}

export function useLoanWriterUndertakingMutations() {
  const queryClient = useQueryClient();
  const invalidate = (id?: string) => {
    queryClient.invalidateQueries({ queryKey: ['loan-writer-undertakings'] });
    queryClient.invalidateQueries({ queryKey: ['partner-referral-undertakings'] });
    if (id) queryClient.invalidateQueries({ queryKey: ['loan-writer-undertaking', id] });
  };

  const createUndertaking = useMutation({
    mutationFn: (payload: Partial<LoanWriterUndertaking>) =>
      call<{ undertaking: LoanWriterUndertaking }>({ action: 'create', ...payload }),
    onSuccess: (res) => {
      invalidate(res.undertaking.id);
      toast.success(`Undertaking ${res.undertaking.reference} created`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateUndertaking = useMutation({
    mutationFn: ({ id, ...payload }: Partial<LoanWriterUndertaking> & { id: string }) =>
      call<{ undertaking: LoanWriterUndertaking }>({ action: 'update', id, ...payload }),
    onSuccess: (res) => {
      invalidate(res.undertaking.id);
      toast.success('Undertaking updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recordSignature = useMutation({
    mutationFn: (params: {
      id: string;
      signed_by_name: string;
      signature_method?: string;
      signature_artefact_path?: string | null;
      envelope_id?: string | null;
    }) => call<{ undertaking: LoanWriterUndertaking }>({ action: 'record_signature', ...params }),
    onSuccess: (res) => {
      invalidate(res.undertaking.id);
      toast.success('Signature recorded');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transitionUndertaking = useMutation({
    mutationFn: (params: { id: string; status: UndertakingStatus; reason?: string }) =>
      call<{ undertaking: LoanWriterUndertaking }>({ action: 'transition', ...params }),
    onSuccess: (res) => {
      invalidate(res.undertaking.id);
      toast.success(`Undertaking is now ${UNDERTAKING_STATUS_LABELS[res.undertaking.status]}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDraft = useMutation({
    mutationFn: (id: string) => call<{ success: boolean }>({ action: 'delete_draft', id }),
    onSuccess: () => {
      invalidate();
      toast.success('Draft undertaking deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { createUndertaking, updateUndertaking, recordSignature, transitionUndertaking, deleteDraft };
}

export const UNDERTAKING_STATUS_LABELS: Record<UndertakingStatus, string> = {
  draft: 'Draft',
  pending_signature: 'Pending signature',
  active: 'Active',
  expired: 'Expired',
  terminated: 'Terminated',
};

export const UNDERTAKING_TRANSITIONS: Record<UndertakingStatus, UndertakingStatus[]> = {
  draft: ['pending_signature', 'terminated'],
  pending_signature: ['active', 'draft', 'terminated'],
  active: ['expired', 'terminated'],
  expired: ['terminated'],
  terminated: [],
};

export function undertakingStatusVariant(status: UndertakingStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'terminated' || status === 'expired') return 'destructive';
  if (status === 'draft') return 'outline';
  return 'secondary';
}
