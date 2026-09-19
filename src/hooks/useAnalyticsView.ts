import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export type AnalyticsView = 'vw_pipeline_funnel' | 'vw_lender_mix' | 'vw_broker_scorecard' | 'vw_revenue_dashboard';

async function call(view: AnalyticsView) {
  const { data, error } = await invokeSecureFunction('analytics-query', { view });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Request failed');
  return data.data as any[];
}

export function useAnalyticsView<T = any>(view: AnalyticsView, enabled = true) {
  return useQuery({
    queryKey: ['analytics-view', view],
    queryFn: () => call(view) as Promise<T[]>,
    staleTime: 60_000,
    enabled,
  });
}

export interface PipelineFunnelRow { period: string; status: string; submission_count: number; total_loan_amount: number; }
export interface LenderMixRow { lender_id: string; lender_name: string; total_submissions: number; approved_count: number; settled_count: number; declined_count: number; total_loan_volume: number; approval_rate_pct: number | null; }
export interface BrokerScorecardRow { broker_id: string; total_submissions: number; approvals: number; settlements: number; avg_days_to_settle: number | null; commission_ytd_net: number; }
export interface RevenueDashboardRow { period: string; forecast_net: number; received_net: number; clawback_net: number; entries: number; }
