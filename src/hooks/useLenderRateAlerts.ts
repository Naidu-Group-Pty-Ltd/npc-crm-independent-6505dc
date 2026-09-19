import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export interface LenderRateAlert {
  id: string;
  user_id: string;
  lender_id: string;
  lender_name: string;
  threshold_rate: number;
  loan_purpose: 'OWNER_OCCUPIED' | 'INVESTMENT' | null;
  repayment_type: 'PRINCIPAL_AND_INTEREST' | 'INTEREST_ONLY' | null;
  lvr_max: number | null;
  is_enabled: boolean;
  last_triggered_at: string | null;
  last_triggered_rate: number | null;
  created_at: string;
  updated_at: string;
}

async function call(action: string, params: Record<string, any> = {}) {
  const { data, error } = await invokeSecureFunction('manage-lender-rate-alerts', { action, ...params });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Request failed');
  return data.data;
}

export function useLenderRateAlerts() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['lender-rate-alerts'],
    queryFn: () => call('list') as Promise<LenderRateAlert[]>,
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: (v: Partial<LenderRateAlert>) => call('create', v),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lender-rate-alerts'] }); toast.success('Alert created'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, ...v }: Partial<LenderRateAlert> & { id: string }) => call('update', { id, ...v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender-rate-alerts'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (id: string) => call('toggle', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender-rate-alerts'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => call('delete', { id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lender-rate-alerts'] }); toast.success('Alert removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    alerts: data ?? [],
    isLoading,
    create: create.mutate,
    update: update.mutate,
    toggle: toggle.mutate,
    remove: remove.mutate,
  };
}
