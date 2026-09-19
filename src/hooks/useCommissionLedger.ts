import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export type CommissionType = 'upfront' | 'trail' | 'bonus' | 'clawback';
export type CommissionStatus = 'forecast' | 'invoiced' | 'received' | 'reconciled' | 'clawed_back';

export interface CommissionLedgerEntry {
  id: string;
  deal_id: string | null;
  client_id: string | null;
  submission_id: string | null;
  lender_id: string | null;
  lender_name: string | null;
  type: CommissionType;
  loan_amount: number | null;
  commission_rate: number | null;
  gross_amount: number;
  broker_split_pct: number;
  broker_amount: number;
  aggregator_fee: number;
  gst_amount: number;
  net_amount: number;
  status: CommissionStatus;
  expected_date: string | null;
  invoiced_date: string | null;
  received_date: string | null;
  reconciled_date: string | null;
  reference: string | null;
  broker_id: string | null;
  notes: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface RevenueRow {
  period: string;
  forecast_net: number;
  received_net: number;
  clawback_net: number;
  entries: number;
}

const FN = 'manage-commission-ledger';

async function call(action: string, params: Record<string, any> = {}) {
  const { data, error } = await invokeSecureFunction(FN, { action, ...params });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Request failed');
  return data.data;
}

export function useCommissionLedger(filters?: Record<string, any>) {
  const qc = useQueryClient();
  const key = ['commission-ledger', filters];

  const { data: entries, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => call('list', { filters }) as Promise<CommissionLedgerEntry[]>,
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: (data: Partial<CommissionLedgerEntry>) => call('create', { data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['commission-ledger'] }); toast.success('Commission entry added'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CommissionLedgerEntry> }) => call('update', { id, data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commission-ledger'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const markReceived = useMutation({
    mutationFn: ({ id, received_date, reference }: { id: string; received_date?: string; reference?: string }) =>
      call('mark_received', { id, data: { received_date, reference } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['commission-ledger'] }); toast.success('Marked received'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reconcile = useMutation({
    mutationFn: (id: string) => call('reconcile', { id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['commission-ledger'] }); toast.success('Reconciled'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => call('delete', { id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['commission-ledger'] }); toast.success('Entry removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    entries: entries ?? [],
    isLoading,
    create: create.mutate,
    update: update.mutate,
    markReceived: markReceived.mutate,
    reconcile: reconcile.mutate,
    remove: remove.mutate,
  };
}

export function useRevenueDashboard() {
  return useQuery({
    queryKey: ['commission-revenue-dashboard'],
    queryFn: () => call('forecast_chart') as Promise<RevenueRow[]>,
    staleTime: 60_000,
  });
}

// Payouts
export interface CommissionPayout {
  id: string;
  broker_id: string;
  broker_name: string | null;
  period_start: string;
  period_end: string;
  total_gross: number;
  total_net: number;
  total_gst: number;
  ledger_entry_ids: string[];
  entry_count: number;
  status: 'draft' | 'pending' | 'paid' | 'cancelled';
  payment_reference: string | null;
  payment_method: string | null;
  pdf_storage_path: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
}

const PAYOUT_FN = 'generate-commission-payout';
async function callPayout(action: string, params: Record<string, any> = {}) {
  const { data, error } = await invokeSecureFunction(PAYOUT_FN, { action, ...params });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Request failed');
  return data.data;
}

export function useCommissionPayouts(brokerId?: string) {
  const qc = useQueryClient();
  const { data: payouts, isLoading } = useQuery({
    queryKey: ['commission-payouts', brokerId],
    queryFn: () => callPayout('list', { filters: brokerId ? { broker_id: brokerId } : {} }) as Promise<CommissionPayout[]>,
    staleTime: 30_000,
  });

  const generate = useMutation({
    mutationFn: (data: { broker_id: string; broker_name?: string; period_start: string; period_end: string }) =>
      callPayout('generate', { data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission-payouts'] });
      qc.invalidateQueries({ queryKey: ['commission-ledger'] });
      toast.success('Payout generated');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const markPaid = useMutation({
    mutationFn: ({ id, payment_reference, payment_method }: { id: string; payment_reference?: string; payment_method?: string }) =>
      callPayout('mark_paid', { id, data: { payment_reference, payment_method } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['commission-payouts'] }); toast.success('Marked paid'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => callPayout('cancel', { id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['commission-payouts'] });
      qc.invalidateQueries({ queryKey: ['commission-ledger'] });
      toast.success('Payout cancelled');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { payouts: payouts ?? [], isLoading, generate: generate.mutate, markPaid: markPaid.mutate, cancel: cancel.mutate };
}

export const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  forecast: 'Forecast',
  invoiced: 'Invoiced',
  received: 'Received',
  reconciled: 'Reconciled',
  clawed_back: 'Clawed Back',
};
