import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export type LenderSubmissionStatus =
  | 'draft' | 'pre_assessment' | 'submitted' | 'conditional_approval'
  | 'unconditional_approval' | 'loan_docs_issued' | 'settled' | 'declined' | 'withdrawn';

export interface LenderSubmission {
  id: string;
  client_id: string;
  deal_id: string | null;
  lender_id: string;
  lender_name: string;
  product_name: string | null;
  loan_amount: number | null;
  lvr: number | null;
  interest_rate: number | null;
  comparison_rate: number | null;
  loan_purpose: 'OWNER_OCCUPIED' | 'INVESTMENT' | null;
  repayment_type: 'PRINCIPAL_AND_INTEREST' | 'INTEREST_ONLY' | null;
  loan_term_years: number | null;
  status: LenderSubmissionStatus;
  submitted_at: string | null;
  approved_at: string | null;
  settled_at: string | null;
  decline_reason: string | null;
  assigned_broker_id: string | null;
  external_reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LenderSubmissionDoc {
  id: string;
  submission_id: string;
  doc_type: string;
  doc_name: string;
  status: 'required' | 'received' | 'verified' | 'waived';
  storage_path: string | null;
  uploaded_at: string | null;
  verified_at: string | null;
  notes: string | null;
  display_order: number;
}

export interface LenderTimelineEvent {
  id: string;
  submission_id: string;
  event_type: string;
  event_label: string;
  payload: Record<string, any>;
  created_at: string;
}

export interface LenderComparisonSheet {
  id: string;
  client_id: string | null;
  deal_id: string | null;
  name: string;
  lender_ids: string[];
  rate_snapshot: any[];
  filters: Record<string, any>;
  notes: string | null;
  shared_with_client: boolean;
  created_at: string;
}

const FN = 'manage-lender-submissions';

async function call(action: string, params: Record<string, any> = {}) {
  const { data, error } = await invokeSecureFunction(FN, { action, ...params });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Request failed');
  return data.data;
}

export function useLenderSubmissions(opts?: { clientId?: string; dealId?: string }) {
  const qc = useQueryClient();
  const key = ['lender-submissions', opts?.clientId, opts?.dealId];

  const { data: submissions, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => {
      if (opts?.clientId) return call('listForClient', { client_id: opts.clientId }) as Promise<LenderSubmission[]>;
      if (opts?.dealId) return call('listForDeal', { deal_id: opts.dealId }) as Promise<LenderSubmission[]>;
      return call('list') as Promise<LenderSubmission[]>;
    },
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: (data: Partial<LenderSubmission>) => call('create', { data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lender-submissions'] }); toast.success('Submission created'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<LenderSubmission> }) => call('update', { id, data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender-submissions'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const transition = useMutation({
    mutationFn: ({ id, to_status, decline_reason }: { id: string; to_status: LenderSubmissionStatus; decline_reason?: string }) =>
      call('transition', { id, to_status, data: { decline_reason } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lender-submissions'] }); toast.success('Status updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => call('delete', { id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lender-submissions'] }); toast.success('Submission deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    submissions: submissions ?? [],
    isLoading,
    create: create.mutate,
    update: update.mutate,
    transition: transition.mutate,
    remove: remove.mutate,
  };
}

export function useSubmissionDocs(submissionId: string | null | undefined) {
  const qc = useQueryClient();
  const key = ['lender-submission-docs', submissionId];

  const { data: docs, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => call('listDocs', { id: submissionId }) as Promise<LenderSubmissionDoc[]>,
    enabled: !!submissionId,
  });

  const add = useMutation({
    mutationFn: (data: Partial<LenderSubmissionDoc>) => call('addDoc', { id: submissionId, data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success('Document added'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateStatus = useMutation({
    mutationFn: ({ doc_id, ...data }: { doc_id: string; status: LenderSubmissionDoc['status']; notes?: string; storage_path?: string }) =>
      call('updateDocStatus', { doc_id, data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (doc_id: string) => call('deleteDoc', { doc_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });

  return { docs: docs ?? [], isLoading, add: add.mutate, updateStatus: updateStatus.mutate, remove: remove.mutate };
}

export function useSubmissionTimeline(submissionId: string | null | undefined) {
  return useQuery({
    queryKey: ['lender-submission-timeline', submissionId],
    queryFn: () => call('listTimeline', { id: submissionId }) as Promise<LenderTimelineEvent[]>,
    enabled: !!submissionId,
  });
}

export function useComparisonSheets(opts?: { clientId?: string; dealId?: string }) {
  const qc = useQueryClient();
  const key = ['lender-comparison-sheets', opts?.clientId, opts?.dealId];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => call('listComparisons', { client_id: opts?.clientId, deal_id: opts?.dealId }) as Promise<LenderComparisonSheet[]>,
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: (data: Partial<LenderComparisonSheet>) => call('createComparison', { data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lender-comparison-sheets'] }); toast.success('Comparison saved'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<LenderComparisonSheet> }) => call('updateComparison', { id, data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender-comparison-sheets'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => call('deleteComparison', { id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lender-comparison-sheets'] }); toast.success('Comparison deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { sheets: data ?? [], isLoading, create: create.mutate, update: update.mutate, remove: remove.mutate };
}

export const STATUS_LABEL: Record<LenderSubmissionStatus, string> = {
  draft: 'Draft',
  pre_assessment: 'Pre-Assessment',
  submitted: 'Submitted',
  conditional_approval: 'Conditional Approval',
  unconditional_approval: 'Unconditional Approval',
  loan_docs_issued: 'Loan Docs Issued',
  settled: 'Settled',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

export const STATUS_PIPELINE: LenderSubmissionStatus[] = [
  'draft','pre_assessment','submitted','conditional_approval',
  'unconditional_approval','loan_docs_issued','settled',
];
