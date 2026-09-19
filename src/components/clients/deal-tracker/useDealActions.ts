import { useQueryClient, useMutation } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import {
  DealType,
  Deal,
  EXISTING_PROPERTY_STAGES,
  HOUSE_AND_LAND_STAGES,
  REFINANCE_STAGES,
  BUILD_PAYMENT_STAGES,
} from './types';

async function manageDealData(params: {
  operation: string;
  table: string;
  clientId?: string;
  recordId?: string;
  data?: any;
}) {
  const { data, error } = await invokeSecureFunction('manage-client-data', params);
  // Both branches must say the cause. `error` alone is the generic "Failed to
  // update record" sentence, and a non-2xx takes the FIRST branch — so the
  // details this file already knew to surface were unreachable for exactly
  // the failures that most needed them.
  const withDetail = (message: string, details?: string | null) =>
    details && details !== message ? `${message} (${details})` : message;
  if (error) throw new Error(withDetail(error.message || 'Operation failed', error.details));
  if (!data?.success) {
    throw new Error(withDetail(data?.error || 'Operation failed', data?.details));
  }
  return data.result;
}

export function useDealActions(clientId: string) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['secure-client-data', clientId] });
    queryClient.invalidateQueries({ queryKey: ['client-deals', clientId] });
    queryClient.invalidateQueries({ queryKey: ['all-deals'] });
  };

  const createDeal = useMutation({
    mutationFn: async ({ dealType, propertyId, responsibleUserId }: { dealType: DealType; propertyId?: string; responsibleUserId?: string }) => {
      // Determine initial stage name
      const initialStage = dealType === 'existing_property'
        ? 'Initial Holding Deposit (0.25%)'
        : dealType === 'house_and_land'
        ? 'Lot Secured'
        : 'Client Engaged (Exclusive)';

      // 1. Create the deal record
      const deal = await manageDealData({
        operation: 'create',
        table: 'client_deals',
        clientId,
        data: {
          deal_type: dealType,
          property_id: propertyId || null,
          current_stage: initialStage,
          current_stage_number: 1,
          responsible_person: responsibleUserId || null,
        },
      });

      const dealId = deal.id;

      // 2. Create stage templates
      const stageTemplates = dealType === 'existing_property'
        ? EXISTING_PROPERTY_STAGES
        : dealType === 'house_and_land'
        ? HOUSE_AND_LAND_STAGES
        : REFINANCE_STAGES;
      const stagesData = stageTemplates.map((s, i) => ({
        deal_id: dealId,
        stage_number: s.stage_number,
        stage_name: s.stage_name,
        stage_category: s.stage_category,
        responsible: s.responsible,
        internal_action: s.internal_action,
        client_action: s.client_action,
        percentage_or_amount: (s as any).percentage_or_amount || null,
        display_order: i,
        status: 'pending',
      }));

      await manageDealData({
        operation: 'create',
        table: 'deal_stages',
        clientId,
        data: stagesData,
      });

      // 3. For H&L, create build payment stages
      if (dealType === 'house_and_land') {
        const paymentsData = BUILD_PAYMENT_STAGES.map((p, i) => ({
          deal_id: dealId,
          stage_number: p.stage_number,
          stage_name: p.stage_name,
          percentage: p.percentage,
          is_commission_trigger: p.is_commission_trigger,
          display_order: i,
        }));

        await manageDealData({
          operation: 'create',
          table: 'build_progress_payments',
          clientId,
          data: paymentsData,
        });
      }

      return deal;
    },
    onSuccess: (_: any, variables: { dealType: DealType; propertyId?: string; responsibleUserId?: string }) => {
      invalidate();
      logActivityDirect({
        actionType: 'deal_created',
        entityType: 'deal',
        entityId: clientId,
        metadata: { deal_type: variables.dealType }
      });
      toast.success('Deal created successfully');
    },
    onError: (err: any) => {
      toast.error('Failed to create deal: ' + err.message);
    },
  });

  const updateDeal = useMutation({
    mutationFn: async ({ dealId, data }: { dealId: string; data: Partial<Deal> }) => {
      return manageDealData({
        operation: 'update',
        table: 'client_deals',
        clientId,
        recordId: dealId,
        data,
      });
    },
    onSuccess: (_: any, variables: { dealId: string; data: Partial<Deal> }) => {
      invalidate();
      logActivityDirect({
        actionType: 'deal_updated',
        entityType: 'deal',
        entityId: variables.dealId,
      });
    },
    onError: (err: any) => {
      toast.error('Failed to update deal: ' + err.message);
    },
  });

  const updateStage = useMutation({
    mutationFn: async ({ stageId, data }: { stageId: string; data: any }) => {
      return manageDealData({
        operation: 'update',
        table: 'deal_stages',
        clientId,
        recordId: stageId,
        data,
      });
    },
    onSuccess: (_: any, variables: { stageId: string; data: any }) => {
      invalidate();
      logActivityDirect({
        actionType: 'deal_stage_changed',
        entityType: 'deal',
        entityId: variables.stageId,
      });
    },
  });

  const updateBuildPayment = useMutation({
    mutationFn: async ({ paymentId, data }: { paymentId: string; data: any }) => {
      return manageDealData({
        operation: 'update',
        table: 'build_progress_payments',
        clientId,
        recordId: paymentId,
        data,
      });
    },
    onSuccess: (_: any, variables: { paymentId: string; data: any }) => {
      invalidate();
      logActivityDirect({
        actionType: 'build_payment_updated',
        entityType: 'deal',
        entityId: variables.paymentId,
      });
    },
  });

  const deleteDeal = useMutation({
    mutationFn: async (dealId: string) => {
      return manageDealData({
        operation: 'delete',
        table: 'client_deals',
        clientId,
        recordId: dealId,
      });
    },
    onSuccess: (_: any, dealId: string) => {
      invalidate();
      logActivityDirect({
        actionType: 'deal_deleted',
        entityType: 'deal',
        entityId: dealId,
      });
      toast.success('Deal deleted');
    },
    onError: (err: any) => {
      toast.error('Failed to delete deal: ' + err.message);
    },
  });

  return { createDeal, updateDeal, updateStage, updateBuildPayment, deleteDeal };
}
