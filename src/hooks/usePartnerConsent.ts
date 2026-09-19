import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type ConsentRequestStatus = 'pending' | 'viewed' | 'signed' | 'declined' | 'revoked' | 'expired';

export interface PartnerConsentRequest {
  id: string;
  referral_id: string;
  channel: 'email' | 'sms' | 'manual' | 'in_person';
  recipient_name: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  statement_version: string;
  statement_text: string;
  disclosure_text: string | null;
  status: ConsentRequestStatus;
  sent_at: string;
  first_viewed_at: string | null;
  signed_at: string | null;
  declined_at: string | null;
  revoked_at: string | null;
  expires_at: string;
  signature_name: string | null;
  signature_ip: string | null;
  created_at: string;
}

const FN = 'manage-partner-referrals';

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>(FN, payload);
  if (error) throw new Error(error.message);
  const err = (data as { error?: string; message?: string } | null)?.error;
  if (err) throw new Error((data as { message?: string })?.message || err);
  return data as T;
}

export function useConsentRequests(referralId: string | null) {
  return useQuery({
    queryKey: ['partner-consent-requests', referralId],
    enabled: !!referralId,
    queryFn: async () => {
      const data = await call<{ consent_requests: PartnerConsentRequest[] }>({
        action: 'list_consent_requests',
        id: referralId,
      });
      return data.consent_requests ?? [];
    },
  });
}

export function useConsentMutations(referralId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['partner-consent-requests', referralId] });
    queryClient.invalidateQueries({ queryKey: ['partner-referral', referralId] });
    queryClient.invalidateQueries({ queryKey: ['partner-referrals'] });
  };

  const issueConsentRequest = useMutation({
    mutationFn: (params: { channel?: string; recipient_email?: string; recipient_phone?: string; expires_in_days?: number }) =>
      call<{ consent_request: PartnerConsentRequest; consent_link: string }>({
        action: 'issue_consent_request',
        id: referralId,
        ...params,
      }),
    onSuccess: () => {
      invalidate();
      toast.success('Consent link issued');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeConsentRequest = useMutation({
    mutationFn: (params: { consent_request_id: string; reason?: string }) =>
      call<{ consent_request: PartnerConsentRequest }>({ action: 'revoke_consent_request', ...params }),
    onSuccess: () => {
      invalidate();
      toast.success('Consent link revoked');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recordManualConsent = useMutation({
    mutationFn: (params: { consent_method: string; consent_artefact_path?: string; note?: string }) =>
      call<{ referral: unknown }>({ action: 'record_manual_consent', id: referralId, ...params }),
    onSuccess: () => {
      invalidate();
      toast.success('Consent recorded');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { issueConsentRequest, revokeConsentRequest, recordManualConsent };
}

/* ── Public signing surface (no session — token only) ───────────────── */

export interface PublicConsentView {
  id: string;
  status: ConsentRequestStatus;
  statement_version: string;
  statement_text: string;
  disclosure_text: string | null;
  recipient_name: string | null;
  expires_at: string;
  signed_at: string | null;
  signature_name: string | null;
  reference: string | null;
  direction: string | null;
  client_first_name: string | null;
}

async function publicCall(action: string, token: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('partner-consent-portal', {
    body: { action, token, ...extra },
  });
  if (error) throw new Error(error.message);
  const payload = data as { error?: string; message?: string; request?: PublicConsentView };
  if (payload?.error) throw new Error(payload.message || payload.error);
  return payload.request as PublicConsentView;
}

export function usePublicConsent(token: string | undefined) {
  return useQuery({
    queryKey: ['public-consent', token],
    enabled: !!token,
    retry: false,
    queryFn: () => publicCall('view', token as string),
  });
}

export function usePublicConsentActions(token: string | undefined) {
  const queryClient = useQueryClient();
  const done = (request: PublicConsentView) => {
    queryClient.setQueryData(['public-consent', token], request);
  };

  const sign = useMutation({
    mutationFn: (signature_name: string) => publicCall('sign', token as string, { signature_name }),
    onSuccess: done,
    onError: (e: Error) => toast.error(e.message),
  });

  const decline = useMutation({
    mutationFn: () => publicCall('decline', token as string),
    onSuccess: done,
    onError: (e: Error) => toast.error(e.message),
  });

  return { sign, decline };
}

export const CONSENT_STATUS_LABELS: Record<ConsentRequestStatus, string> = {
  pending: 'Sent',
  viewed: 'Opened',
  signed: 'Signed',
  declined: 'Declined',
  revoked: 'Revoked',
  expired: 'Expired',
};

export function consentStatusVariant(status: ConsentRequestStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'signed') return 'default';
  if (status === 'declined' || status === 'revoked' || status === 'expired') return 'destructive';
  if (status === 'pending') return 'outline';
  return 'secondary';
}
