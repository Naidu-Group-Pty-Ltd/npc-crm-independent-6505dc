import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { 
  calculateBorrowingCapacity as calculateLocal,
  getHemBenchmark,
  type BorrowingCapacityInput,
  type BorrowingCapacityResult,
  type FullAssessmentResult,
  type ServiceabilityBand,
} from '@/utils/borrowingCapacityCalculations';
import { toast } from 'sonner';
import { invalidateClientQueries } from '@/lib/clients/invalidateClientQueries';

interface BorrowingCapacityOverrides {
  grossAnnualIncome?: number;
  shadedAnnualIncome?: number;
  additionalIncome?: number;
  livingExpenses?: number;
  existingCommitments?: number;
  additionalLiabilities?: number;
  totalDebtBalances?: number;
  interestRate?: number;
  bufferRate?: number;
  loanTermYears?: number;
  proposedLoanAmount?: number;
  calculationMode?: 'bank' | 'conservative';
  dtiCapEnabled?: boolean;
  dtiCapLimit?: number;
  selectedLenderName?: string;
  // LMI fields
  lmiAmount?: number;
  lmiMode?: string;
  lmiPropertyValue?: number;
  lmiDepositAmount?: number;
  isFirstHomeBuyer?: boolean;
  // Proposed rental income (next purchase)
  proposedRentalIncome?: {
    inputAmount: number;
    frequency: string;
    shadingRate: number;
    vacancyRate: number;
    interestOnlyOffset: number;
  };
  // Phase 4: Scenario deltas to run server-side
  scenarioDeltas?: { name: string; deltas: import('@/utils/borrowingCapacityTypes').ScenarioDelta[] }[];
}

interface UseBorrowingCapacityOptions {
  clientId: string;
  autoFetch?: boolean;
}

export function useBorrowingCapacity({ clientId, autoFetch = true }: UseBorrowingCapacityOptions) {
  const queryClient = useQueryClient();
  const [localResult, setLocalResult] = useState<BorrowingCapacityResult | null>(null);

  // Fetch latest assessment from database with secure Edge Function
  const {
    data: latestAssessment,
    isLoading: isLoadingAssessment,
    error: assessmentError,
    refetch: refetchAssessment,
  } = useQuery({
    queryKey: ['borrowing-capacity', clientId],
    queryFn: async () => {
      try {
        const { data, error } = await invokeSecureFunction('get-client-data', {
          clientId,
          include: { borrowingCapacity: true },
        });
        
        if (!error && data?.success && data.borrowingCapacity) {
          // Return the latest assessment (already sorted by created_at desc)
          const assessments = data.borrowingCapacity;
          return assessments.length > 0 ? assessments[0] : null;
        }
        throw new Error(error?.message || 'Failed to fetch borrowing capacity');
      } catch (err) {
        throw err;
      }
    },
    enabled: autoFetch && !!clientId,
  });

  // Fetch assessment history with secure Edge Function
  const {
    data: assessmentHistory,
    isLoading: isLoadingHistory,
  } = useQuery({
    queryKey: ['borrowing-capacity-history', clientId],
    queryFn: async () => {
      try {
        const { data, error } = await invokeSecureFunction('get-client-data', {
          clientId,
          include: { borrowingCapacity: true },
        });
        
        if (!error && data?.success && data.borrowingCapacity) {
          // Return up to 10 assessments for history
          return data.borrowingCapacity.slice(0, 10).map((a: any) => ({
            id: a.id,
            borrowing_capacity: a.borrowing_capacity,
            serviceability_band: a.serviceability_band,
            created_at: a.created_at,
          }));
        }
        throw new Error(error?.message || 'Failed to fetch assessment history');
      } catch (err) {
        throw err;
      }
    },
    enabled: autoFetch && !!clientId,
  });

  // Calculate borrowing capacity via edge function
  const calculateMutation = useMutation({
    mutationFn: async (overrides?: BorrowingCapacityOverrides) => {
      const { data, error } = await invokeSecureFunction('calculate-borrowing-capacity', {
        clientId,
        overrides: overrides ? { ...overrides, scenarioDeltas: undefined } : undefined,
        saveResult: true,
        scenarioDeltas: overrides?.scenarioDeltas,
      });

      if (error) throw new Error(error.message);
      if (!data.success) throw new Error(data.error || 'Calculation failed');
      
      return data.data as FullAssessmentResult;
    },
    onSuccess: (data) => {
      // Invalidate BC-specific queries
      queryClient.invalidateQueries({ queryKey: ['borrowing-capacity', clientId] });
      queryClient.invalidateQueries({ queryKey: ['borrowing-capacity-history', clientId] });
      // Invalidate broader client queries so BC tab card, PDF exports, and other views pick up the new value
      queryClient.invalidateQueries({ queryKey: ['borrowing-capacity-client-data', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client-data', clientId] });
      queryClient.invalidateQueries({ queryKey: ['get-client-data'] });
      // …and the keys the open client card is drawn from, which this list did
      // not name — so the BC tab refreshed and the card beside it did not.
      invalidateClientQueries(queryClient, clientId);
      // ── Phase 3: portfolio segment invalidation (commercial/industrial) ──
      queryClient.invalidateQueries({ queryKey: ['client-portfolio', 'residential', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client-portfolio', 'commercial', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client-portfolio', 'industrial', clientId] });
      queryClient.invalidateQueries({ queryKey: ['commercial-properties', clientId] });
      queryClient.invalidateQueries({ queryKey: ['industrial-properties', clientId] });

      // Say what actually happened. The card reads the STORED assessment, so
      // a save that failed leaves the operator looking at the old figure
      // having just been told the new one succeeded — the recalculation is
      // then indistinguishable from one that never ran. The server reports
      // the save separately from the calculation because they can differ.
      const saveFailed = (data as { saveRequested?: boolean; saved?: boolean })?.saveRequested === true
        && (data as { saved?: boolean })?.saved === false;
      if (saveFailed) {
        const reason = (data as { saveError?: string | null })?.saveError;
        toast.warning(
          'Borrowing capacity calculated, but not saved',
          { description: reason ? `${reason}. The figure on the card is unchanged.` : 'The figure on the card is unchanged.' },
        );
      } else {
        toast.success('Borrowing capacity calculated successfully');
      }
    },
    onError: (error: Error) => {
      console.error('Borrowing capacity calculation failed:', error);
      toast.error(`Calculation failed: ${error.message}`);
    },
  });

  // Calculate locally for instant feedback (what-if scenarios)
  const calculateLocally = useCallback((input: BorrowingCapacityInput): BorrowingCapacityResult => {
    const result = calculateLocal(input);
    setLocalResult(result);
    return result;
  }, []);

  // Quick calculate using client data without saving
  const quickCalculate = useCallback(async (overrides?: BorrowingCapacityOverrides) => {
    try {
      const { data, error } = await invokeSecureFunction('calculate-borrowing-capacity', {
        clientId,
        overrides,
        saveResult: false, // Don't save - just calculate
      });

      if (error) throw new Error(error.message);
      if (!data.success) throw new Error(data.error || 'Calculation failed');
      
      return data.data as FullAssessmentResult;
    } catch (error) {
      console.error('Quick calculation failed:', error);
      throw error;
    }
  }, [clientId]);

  // Get formatted result for display
  const getDisplayResult = useCallback((): {
    capacity: number;
    band: ServiceabilityBand;
    surplus: number;
    dtiRatio: number;
    stressTested: number;
    lastCalculated: string | null;
  } | null => {
    if (latestAssessment) {
      return {
        capacity: latestAssessment.borrowing_capacity || 0,
        band: (latestAssessment.serviceability_band as ServiceabilityBand) || 'red',
        surplus: latestAssessment.monthly_surplus || 0,
        dtiRatio: latestAssessment.dti_ratio || 0,
        stressTested: latestAssessment.stress_tested_capacity || 0,
        lastCalculated: latestAssessment.created_at,
      };
    }
    return null;
  }, [latestAssessment]);

  // ── Phase 3: Hybrid segment selectors ──
  // The edge function persists segment results under
  // `assumptions._segmentReconciliation` / `assumptions._portfolioCapacity`.
  // These selectors return null when the segment engine wasn't triggered, so
  // residential-only consumers see a no-op.
  const getSegmentReconciliation = useCallback(() => {
    const a: any = (latestAssessment as any)?.assumptions;
    return (a?._segmentReconciliation as any) || null;
  }, [latestAssessment]);

  const getPortfolioCapacity = useCallback((): number | null => {
    const a: any = (latestAssessment as any)?.assumptions;
    const v = a?._portfolioCapacity;
    return typeof v === 'number' ? v : null;
  }, [latestAssessment]);

  const getSegmentBreakdown = useCallback(() => {
    const recon = getSegmentReconciliation();
    return (recon?.segmentBreakdown || []) as any[];
  }, [getSegmentReconciliation]);

  return {
    // State
    latestAssessment,
    assessmentHistory,
    localResult,
    isLoading: isLoadingAssessment || calculateMutation.isPending,
    isLoadingHistory,
    error: assessmentError || calculateMutation.error,
    isCalculating: calculateMutation.isPending,

    // Actions
    calculate: calculateMutation.mutate,
    calculateAsync: calculateMutation.mutateAsync,
    calculateLocally,
    quickCalculate,
    refetch: refetchAssessment,

    // Helpers
    getDisplayResult,
    getHemBenchmark,
    // Phase 3 — hybrid segment helpers (additive)
    getSegmentReconciliation,
    getPortfolioCapacity,
    getSegmentBreakdown,
  };
}

// Export types
export type {
  BorrowingCapacityOverrides,
  UseBorrowingCapacityOptions,
  BorrowingCapacityInput,
  BorrowingCapacityResult,
  FullAssessmentResult,
  ServiceabilityBand,
};

// Re-export Phase 2 types for convenience
export type {
  ThreeOutputAssessment,
  CurrentCapacityResult,
  ProposedLoanCheckResult,
  ScenarioCapacityResult,
  ScenarioDelta,
} from '@/utils/borrowingCapacityTypes';
