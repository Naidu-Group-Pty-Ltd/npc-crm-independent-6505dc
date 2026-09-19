import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export interface AgencyAgreement {
  id: string;
  client_id: string;
  deal_id: string | null;
  status: string;
  docusign_envelope_id: string | null;
  docusign_status: string | null;
  docusign_sent_at: string | null;
  docusign_signed_at: string | null;
  buyer_names: string;
  buyer_address: string | null;
  buyer_phone: string | null;
  buyer_email: string | null;
  agreement_date: string;
  secondary_buyer_name: string | null;
  pdf_storage_path: string | null;
  signed_pdf_storage_path: string | null;
  sent_via: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  client_name?: string;
}

export function useAgencyAgreements(clientId?: string) {
  return useQuery({
    queryKey: ['agency-agreements', clientId || 'all'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction<{ agreements: AgencyAgreement[] }>('manage-agency-agreements', {
        action: 'list',
        ...(clientId ? { client_id: clientId } : {}),
      });
      if (error) throw new Error(error.message);
      return data?.agreements || [];
    },
  });
}

export function useAgreementMutations() {
  const queryClient = useQueryClient();

  const generateAgreement = useMutation({
    mutationFn: async (params: {
      clientId: string;
      buyerNames: string;
      buyerAddress: string;
      buyerPhone: string;
      buyerEmail: string;
      agreementDate: string;
      secondaryBuyerName?: string;
      secondaryBuyerEmail?: string;
      dealId?: string;
      notes?: string;
      initialCommitmentFee?: string;
      templateId?: string;
    }) => {
      const { data, error } = await invokeSecureFunction('manage-agency-agreements', {
        action: 'generate',
        client_id: params.clientId,
        buyer_names: params.buyerNames,
        buyer_address: params.buyerAddress,
        buyer_phone: params.buyerPhone,
        buyer_email: params.buyerEmail,
        agreement_date: params.agreementDate,
        secondary_buyer_name: params.secondaryBuyerName,
        secondary_buyer_email: params.secondaryBuyerEmail,
        deal_id: params.dealId,
        notes: params.notes,
        initial_commitment_fee: params.initialCommitmentFee,
        template_id: params.templateId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agency-agreements'] });
      toast.success('Agreement generated successfully');
    },
    onError: (error: Error) => {
      toast.error('Failed to generate agreement: ' + error.message);
    },
  });

  const sendViaDocuSign = useMutation({
    mutationFn: async (agreementId: string) => {
      const { data, error } = await invokeSecureFunction('manage-agency-agreements', {
        action: 'send_docusign',
        agreement_id: agreementId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agency-agreements'] });
      toast.success('Agreement sent via DocuSign');
    },
    onError: (error: Error) => {
      toast.error('Failed to send via DocuSign: ' + error.message);
    },
  });

  const checkStatus = useMutation({
    mutationFn: async (agreementId: string) => {
      const { data, error } = await invokeSecureFunction('manage-agency-agreements', {
        action: 'check_status',
        agreement_id: agreementId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agency-agreements'] });
    },
  });

  const voidAgreement = useMutation({
    mutationFn: async (params: { agreementId: string; reason: string }) => {
      const { data, error } = await invokeSecureFunction('manage-agency-agreements', {
        action: 'void',
        agreement_id: params.agreementId,
        void_reason: params.reason,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agency-agreements'] });
      toast.success('Agreement voided');
    },
    onError: (error: Error) => {
      toast.error('Failed to void agreement: ' + error.message);
    },
  });

  const retryPdf = useMutation({
    mutationFn: async (agreementId: string) => {
      const { data, error } = await invokeSecureFunction<{ success: boolean; pdf_url: string | null; status: string }>('manage-agency-agreements', {
        action: 'retry_pdf',
        agreement_id: agreementId,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data) => {
      if (data?.success) {
        queryClient.invalidateQueries({ queryKey: ['agency-agreements'] });
      }
    },
  });

  return { generateAgreement, sendViaDocuSign, checkStatus, voidAgreement, retryPdf };
}
