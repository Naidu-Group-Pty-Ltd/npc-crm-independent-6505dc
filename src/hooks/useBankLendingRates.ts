import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

export interface LendingRate {
  lenderId: string;
  lenderName: string;
  productId: string;
  productName: string;
  rate: number;
  comparisonRate: number | null;
  rateType: 'FIXED' | 'VARIABLE';
  loanPurpose: 'OWNER_OCCUPIED' | 'INVESTMENT';
  repaymentType: 'PRINCIPAL_AND_INTEREST' | 'INTEREST_ONLY';
  lvrMin: number | null;
  lvrMax: number | null;
  minLoanAmount: number | null;
  maxLoanAmount: number | null;
  features: string[];
  lastUpdated: string;
}

export interface Lender {
  id: string;
  name: string;
  logo?: string;
}

export interface LenderSummary {
  lenderId: string;
  lenderName: string;
  rateCount: number;
  fetchedAt: string;
  expiresAt: string;
  lowestRate: number | null;
}

interface UseBankLendingRatesOptions {
  loanPurpose?: 'OWNER_OCCUPIED' | 'INVESTMENT';
  repaymentType?: 'PRINCIPAL_AND_INTEREST' | 'INTEREST_ONLY';
  lvr?: number;
}

// Helper to call edge function with query params via POST body
async function invokeEdgeFunctionSecure(action: string, params?: Record<string, string | number | undefined>) {
  const { data, error } = await invokeSecureFunction('cdr-lending-rates-service', {
    action, ...params,
  });
  
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Request failed');
  return data.data;
}

export function useBankLendingRates(options?: UseBankLendingRatesOptions) {
  const queryClient = useQueryClient();
  const [selectedLender, setSelectedLender] = useState<string | null>(null);

  // Fetch available lenders
  const {
    data: lenders,
    isLoading: isLoadingLenders,
    error: lendersError,
  } = useQuery({
    queryKey: ['bank-lenders'],
    queryFn: async () => {
      const result = await invokeEdgeFunctionSecure('lenders');
      return result as Lender[];
    },
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
  });

  // Fetch rates summary (cached data)
  const {
    data: ratesSummary,
    isLoading: isLoadingSummary,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ['bank-rates-summary'],
    queryFn: async () => {
      const result = await invokeEdgeFunctionSecure('list');
      return result as LenderSummary[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch rates for a specific lender
  const fetchLenderRates = useCallback(async (lenderId: string): Promise<LendingRate[]> => {
    const result = await invokeEdgeFunctionSecure('rates', {
      lender: lenderId,
      purpose: options?.loanPurpose,
      repayment: options?.repaymentType,
      lvr: options?.lvr,
    });
    // Round rates to 2 decimal places to avoid floating point artifacts
    return (result as LendingRate[]).map(r => ({
      ...r,
      rate: Math.round(r.rate * 100) / 100,
      comparisonRate: r.comparisonRate !== null ? Math.round(r.comparisonRate * 100) / 100 : null,
    }));
  }, [options?.loanPurpose, options?.repaymentType, options?.lvr]);

  // Query for selected lender's rates
  const {
    data: selectedLenderRates,
    isLoading: isLoadingSelectedRates,
    refetch: refetchSelectedRates,
  } = useQuery({
    queryKey: ['bank-rates', selectedLender, options?.loanPurpose, options?.repaymentType, options?.lvr],
    queryFn: () => fetchLenderRates(selectedLender!),
    enabled: !!selectedLender,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch best rates across all lenders
  const {
    data: bestRates,
    isLoading: isLoadingBestRates,
    refetch: refetchBestRates,
  } = useQuery({
    queryKey: ['bank-best-rates', options?.loanPurpose, options?.repaymentType, options?.lvr],
    queryFn: async () => {
      const result = await invokeEdgeFunctionSecure('best-rates', {
        purpose: options?.loanPurpose,
        repayment: options?.repaymentType,
        lvr: options?.lvr,
      });
      return (result as LendingRate[]).map(r => ({
        ...r,
        rate: Math.round(r.rate * 100) / 100,
        comparisonRate: r.comparisonRate !== null ? Math.round(r.comparisonRate * 100) / 100 : null,
      }));
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Refresh all lender caches (long-running: parallel CDR fetches server-side,
  // bump client timeout well past edge-function default to avoid AbortError).
  const refreshAllMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await invokeSecureFunction(
        'cdr-lending-rates-service',
        { action: 'refresh-all' },
        { timeoutMs: 180_000 } // 3 minutes
      );
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Refresh failed');
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-rates-summary'] });
      queryClient.invalidateQueries({ queryKey: ['bank-rates'] });
      queryClient.invalidateQueries({ queryKey: ['bank-best-rates'] });
      toast.success('Bank rates refreshed successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to refresh rates: ${error.message}`);
    },
  });

  // Get the lowest rate for a specific lender from summary
  const getLowestRateForLender = useCallback((lenderId: string): number | null => {
    const summary = ratesSummary?.find(s => s.lenderId === lenderId);
    return summary?.lowestRate ?? null;
  }, [ratesSummary]);

  // Select a lender and get their rates
  const selectLender = useCallback((lenderId: string | null) => {
    setSelectedLender(lenderId);
  }, []);

  return {
    // Lenders
    lenders,
    isLoadingLenders,
    lendersError,

    // Summary
    ratesSummary,
    isLoadingSummary,
    refetchSummary,

    // Selected lender rates
    selectedLender,
    selectLender,
    selectedLenderRates,
    isLoadingSelectedRates,
    refetchSelectedRates,

    // Best rates
    bestRates,
    isLoadingBestRates,
    refetchBestRates,

    // Helpers
    getLowestRateForLender,
    fetchLenderRates,

    // Mutations
    refreshAll: refreshAllMutation.mutate,
    isRefreshing: refreshAllMutation.isPending,
  };
}
