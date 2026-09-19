import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export type GeneratedDocStatus = 'draft' | 'generated' | 'sent' | 'viewed' | 'signed' | 'voided' | 'expired';
export type TemplateDocType =
  | 'loan_application' | 'supporting_docs_cover' | 'bid' | 'credit_guide'
  | 'cost_disclosure' | 'consent_form' | 'fact_find' | 'preliminary_assessment' | 'generic';

export interface GeneratedDocument {
  id: string;
  client_id: string | null;
  deal_id: string | null;
  submission_id: string | null;
  template_id: string | null;
  template_type: TemplateDocType;
  title: string;
  status: GeneratedDocStatus;
  pdf_storage_path: string | null;
  signed_pdf_storage_path: string | null;
  docusign_envelope_id: string | null;
  docusign_status: string | null;
  sent_to: string[] | null;
  sent_at: string | null;
  viewed_at: string | null;
  signed_at: string | null;
  voided_at: string | null;
  voided_reason: string | null;
  generation_payload: Record<string, any>;
  audit: any[];
  shared_with_client: boolean;
  created_at: string;
  updated_at: string;
}

const FN = 'manage-generated-documents';
async function call(action: string, params: Record<string, any> = {}) {
  const { data, error } = await invokeSecureFunction(FN, { action, ...params });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Request failed');
  return data.data;
}

export function useGeneratedDocuments(opts?: { clientId?: string; dealId?: string; submissionId?: string; status?: GeneratedDocStatus }) {
  const qc = useQueryClient();
  const filters: Record<string, any> = {};
  if (opts?.clientId) filters.client_id = opts.clientId;
  if (opts?.dealId) filters.deal_id = opts.dealId;
  if (opts?.submissionId) filters.submission_id = opts.submissionId;
  if (opts?.status) filters.status = opts.status;

  const { data: documents, isLoading } = useQuery({
    queryKey: ['generated-documents', filters],
    queryFn: () => call('list', { filters }) as Promise<GeneratedDocument[]>,
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: (data: Partial<GeneratedDocument>) => call('create', { data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['generated-documents'] }); toast.success('Document created'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateStatus = useMutation({
    mutationFn: ({ id, ...data }: { id: string; status: GeneratedDocStatus; [k: string]: any }) =>
      call('update_status', { id, data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['generated-documents'] }); toast.success('Status updated'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<GeneratedDocument> }) => call('update', { id, data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['generated-documents'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => call('delete', { id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['generated-documents'] }); toast.success('Document removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { documents: documents ?? [], isLoading, create: create.mutate, update: update.mutate, updateStatus: updateStatus.mutate, remove: remove.mutate };
}

export const TEMPLATE_TYPE_LABEL: Record<TemplateDocType, string> = {
  loan_application: 'Loan Application',
  supporting_docs_cover: 'Supporting Docs Cover',
  bid: 'BID Statement',
  credit_guide: 'Credit Guide',
  cost_disclosure: 'Cost Disclosure',
  consent_form: 'Consent Form',
  fact_find: 'Fact Find',
  preliminary_assessment: 'Preliminary Assessment',
  generic: 'Generic',
};
