import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export type ReferralDirection = 'inbound_property_referral' | 'outbound_finance_referral';

export type ReferralStatus =
  | 'draft'
  | 'submitted'
  | 'accepted'
  | 'contacted'
  | 'engaged'
  | 'contracted'
  | 'application'
  | 'approved'
  | 'settled'
  | 'declined'
  | 'withdrawn';

export type PriorClientCheck = 'unchecked' | 'new' | 'existing' | 'duplicate';
export type CommercialEligibility = 'pending' | 'eligible' | 'not_eligible';

export interface PartnerReferral {
  id: string;
  reference: string;
  direction: ReferralDirection;
  agreement_id: string | null;
  agreement_version: number | null;

  finance_agent_contact_id: string | null;
  referring_entity_name: string | null;
  referring_individual_name: string | null;
  referring_individual_crn: string | null;
  referring_contact_email: string | null;
  referring_contact_phone: string | null;

  client_first_name: string;
  client_surname: string | null;
  client_email: string | null;
  client_phone: string | null;
  general_purpose: string | null;
  preferred_contact_method: string | null;
  preferred_contact_time: string | null;

  consent_obtained: boolean;
  consent_obtained_at: string | null;
  consent_method: string | null;
  consent_artefact_path: string | null;
  benefit_disclosed: boolean;
  benefit_disclosed_at: string | null;
  prior_client_check: PriorClientCheck;

  assigned_consultant_id: string | null;
  assigned_consultant_name: string | null;
  assigned_finance_user_id: string | null;
  assigned_loan_writer_name: string | null;

  status: ReferralStatus;
  status_reason: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  completed_at: string | null;

  commercial_eligibility: CommercialEligibility;
  eligibility_reason: string | null;
  estimated_value: number | null;

  client_id: string | null;
  purchase_file_id: string | null;
  client_deal_id: string | null;

  internal_notes: string | null;
  shared_notes: string | null;
  metadata: Record<string, unknown>;

  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerReferralEvent {
  id: string;
  referral_id: string;
  event_type: string;
  actor_id: string | null;
  actor_label: string | null;
  actor_surface: string | null;
  summary: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ActiveAgreementOption {
  id: string;
  direction: ReferralDirection;
  version: number;
  partner_legal_name: string;
  finance_agent_contact_id: string | null;
  status: string;
  effective_date: string | null;
}

export interface FinanceUserOption {
  id: string;
  email: string;
  finance_contact_id: string | null;
  finance_agent_contacts?: { name: string | null; company: string | null } | null;
}

const FN = 'manage-partner-referrals';

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeSecureFunction<T>(FN, payload);
  if (error) throw new Error(error.message);
  const err = (data as { error?: string; message?: string } | null)?.error;
  if (err) throw new Error((data as { message?: string })?.message || err);
  return data as T;
}

export function usePartnerReferrals(filters?: {
  direction?: ReferralDirection;
  status?: ReferralStatus;
  commercial_eligibility?: CommercialEligibility;
}) {
  return useQuery({
    queryKey: [
      'partner-referrals',
      filters?.direction ?? 'all',
      filters?.status ?? 'all',
      filters?.commercial_eligibility ?? 'all',
    ],
    queryFn: async () => {
      const data = await call<{ referrals: PartnerReferral[] }>({
        action: 'list',
        ...(filters?.direction ? { direction: filters.direction } : {}),
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.commercial_eligibility ? { commercial_eligibility: filters.commercial_eligibility } : {}),
      });
      return data.referrals ?? [];
    },
  });
}

export function usePartnerReferral(id: string | null) {
  return useQuery({
    queryKey: ['partner-referral', id],
    enabled: !!id,
    queryFn: () =>
      call<{
        referral: PartnerReferral;
        events: PartnerReferralEvent[];
        agreement: Record<string, unknown> | null;
      }>({ action: 'get', id }),
  });
}

export function useActiveAgreementOptions(direction?: ReferralDirection) {
  return useQuery({
    queryKey: ['partner-referral-agreements', direction ?? 'all'],
    queryFn: async () => {
      const data = await call<{ agreements: ActiveAgreementOption[] }>({
        action: 'list_active_agreements',
        ...(direction ? { direction } : {}),
      });
      return data.agreements ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useFinanceUserOptions() {
  return useQuery({
    queryKey: ['partner-referral-finance-users'],
    queryFn: async () => {
      const data = await call<{ users: FinanceUserOption[] }>({ action: 'list_finance_users' });
      return data.users ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function usePartnerReferralMutations() {
  const queryClient = useQueryClient();

  const invalidate = (id?: string) => {
    queryClient.invalidateQueries({ queryKey: ['partner-referrals'] });
    if (id) queryClient.invalidateQueries({ queryKey: ['partner-referral', id] });
  };

  const createReferral = useMutation({
    mutationFn: (payload: Partial<PartnerReferral>) =>
      call<{ referral: PartnerReferral; duplicate_matches: unknown[] }>({ action: 'create', ...payload }),
    onSuccess: (res) => {
      invalidate(res.referral.id);
      toast.success(`Referral ${res.referral.reference} registered`);
      if ((res.duplicate_matches ?? []).length > 0) {
        toast.warning('Potential duplicate referral — review the prior-client check.');
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateReferral = useMutation({
    mutationFn: ({ id, ...payload }: Partial<PartnerReferral> & { id: string }) =>
      call<{ referral: PartnerReferral }>({ action: 'update', id, ...payload }),
    onSuccess: (res) => {
      invalidate(res.referral.id);
      toast.success('Referral updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const transitionReferral = useMutation({
    mutationFn: (params: { id: string; status: ReferralStatus; reason?: string }) =>
      call<{ referral: PartnerReferral }>({ action: 'transition', ...params }),
    onSuccess: (res) => {
      invalidate(res.referral.id);
      toast.success(`Referral is now ${REFERRAL_STATUS_LABELS[res.referral.status]}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setEligibility = useMutation({
    mutationFn: (params: { id: string; commercial_eligibility: CommercialEligibility; eligibility_reason?: string }) =>
      call<{ referral: PartnerReferral }>({ action: 'set_eligibility', ...params }),
    onSuccess: (res) => {
      invalidate(res.referral.id);
      toast.success('Commercial eligibility recorded');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runPriorClientCheck = useMutation({
    mutationFn: (id: string) =>
      call<{ referral: PartnerReferral; matches: Record<string, unknown>[] }>({ action: 'run_prior_client_check', id }),
    onSuccess: (res) => {
      invalidate(res.referral.id);
      toast.success(`Prior-client check: ${res.referral.prior_client_check}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const convertToClient = useMutation({
    mutationFn: (id: string) => call<{ referral: PartnerReferral; client_id: string }>({ action: 'convert_to_client', id }),
    onSuccess: (res) => {
      invalidate(res.referral.id);
      toast.success('Referral converted to a client record');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assignLoanWriter = useMutation({
    mutationFn: (params: {
      id: string;
      loan_writer_undertaking_id: string | null;
      assigned_finance_user_id?: string | null;
    }) => call<{ referral: PartnerReferral }>({ action: 'assign_loan_writer', ...params }),
    onSuccess: (res) => {
      invalidate(res.referral.id);
      queryClient.invalidateQueries({ queryKey: ['loan-writer-undertakings'] });
      toast.success(
        res.referral.assigned_loan_writer_name
          ? `Assigned to ${res.referral.assigned_loan_writer_name}`
          : 'Loan writer assignment cleared',
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addNote = useMutation({

    mutationFn: (params: { id: string; note: string }) => call<{ success: boolean }>({ action: 'add_note', ...params }),
    onSuccess: (_res, vars) => {
      invalidate(vars.id);
      toast.success('Note added');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDraft = useMutation({
    mutationFn: (id: string) => call<{ success: boolean }>({ action: 'delete_draft', id }),
    onSuccess: () => {
      invalidate();
      toast.success('Draft referral deleted');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    createReferral,
    updateReferral,
    transitionReferral,
    setEligibility,
    runPriorClientCheck,
    convertToClient,
    assignLoanWriter,

    addNote,
    deleteDraft,
  };
}

export const REFERRAL_DIRECTION_LABELS: Record<ReferralDirection, string> = {
  inbound_property_referral: 'Inbound — partner → NPC (property)',
  outbound_finance_referral: 'Outbound — NPC → partner (finance)',
};

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  accepted: 'Accepted',
  contacted: 'Contacted',
  engaged: 'Engaged',
  contracted: 'Contracted',
  application: 'Application',
  approved: 'Approved',
  settled: 'Settled',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

export const REFERRAL_STATUS_FLOW: Record<ReferralDirection, Record<string, ReferralStatus[]>> = {
  inbound_property_referral: {
    draft: ['submitted', 'withdrawn'],
    submitted: ['accepted', 'declined', 'withdrawn'],
    accepted: ['contacted', 'declined', 'withdrawn'],
    contacted: ['engaged', 'declined', 'withdrawn'],
    engaged: ['contracted', 'withdrawn'],
    contracted: ['settled', 'withdrawn'],
    settled: [],
    declined: [],
    withdrawn: [],
  },
  outbound_finance_referral: {
    draft: ['submitted', 'withdrawn'],
    submitted: ['accepted', 'declined', 'withdrawn'],
    accepted: ['contacted', 'declined', 'withdrawn'],
    contacted: ['application', 'declined', 'withdrawn'],
    application: ['approved', 'declined', 'withdrawn'],
    approved: ['settled', 'withdrawn'],
    settled: [],
    declined: [],
    withdrawn: [],
  },
};

export const ELIGIBILITY_LABELS: Record<CommercialEligibility, string> = {
  pending: 'Pending',
  eligible: 'Eligible',
  not_eligible: 'Not eligible',
};
