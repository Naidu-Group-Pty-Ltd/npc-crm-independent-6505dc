import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';
import { logActivityDirect } from '@/hooks/useActivityLogger';

async function manageDealData(params: {
  operation: string;
  table: string;
  clientId?: string;
  recordId?: string;
  data?: any;
}) {
  const { data, error } = await invokeSecureFunction('manage-client-data', params);
  // The server puts a generic sentence in `error` and the actual cause in
  // `details`. Both branches below have to say the cause, and only the second
  // one did: a non-2xx takes the FIRST branch, so every database fault on this
  // path reported as the bare "Failed to update record" — six words that name
  // nothing and cannot be acted on. That is the whole of what an operator saw
  // when marking a commission received.
  const withDetail = (message: string, details?: string | null) =>
    details && details !== message ? `${message} (${details})` : message;
  if (error) throw new Error(withDetail(error.message || 'Operation failed', error.details));
  if (!data?.success) {
    throw new Error(withDetail(data?.error || 'Operation failed', data?.details));
  }
  return data.result;
}

/**
 * Provides mutations for updating build payments and deal data
 * from the pipeline page (cross-client context).
 */
export function usePipelineMutations() {
  const queryClient = useQueryClient();

  /**
   * Both readings of a deal, not just this page's.
   *
   * This invalidated `all-deals` alone, while the client page's own
   * `useDealActions` invalidates BOTH — so the two surfaces refreshed each
   * other in one direction only. Marking a commission received on the
   * pipeline left the client's Deals tab showing the old value until
   * something else happened to refetch it, which is half of "it doesn't sync
   * the commission status between the client page and the deal pipeline".
   *
   * The client key is per-client and the pipeline is cross-client, so the
   * predicate matches every `client-deals` entry rather than guessing which
   * one the edited row belongs to.
   */
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['all-deals'] });
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === 'client-deals',
    });
  };

  const updateBuildPayment = useMutation({
    mutationFn: async ({ paymentId, clientId, data }: { paymentId: string; clientId: string; data: any }) => {
      return manageDealData({
        operation: 'update',
        table: 'build_progress_payments',
        clientId,
        recordId: paymentId,
        data,
      });
    },
    onSuccess: (_: any, variables: { paymentId: string; clientId: string; data: any }) => {
      invalidate();
      logActivityDirect({
        actionType: 'build_payment_updated',
        entityType: 'deal',
        entityId: variables.paymentId,
      });
    },
    onError: (err: any) => {
      toast.error('Failed to update: ' + err.message);
    },
  });

  const updateDeal = useMutation({
    mutationFn: async ({ dealId, clientId, data }: { dealId: string; clientId: string; data: any }) => {
      return manageDealData({
        operation: 'update',
        table: 'client_deals',
        clientId,
        recordId: dealId,
        data,
      });
    },
    onSuccess: (_: any, variables: { dealId: string; clientId: string; data: any }) => {
      invalidate();
      logActivityDirect({
        actionType: 'deal_updated',
        entityType: 'deal',
        entityId: variables.dealId,
      });
      toast.success('Deal updated');
    },
    onError: (err: any) => {
      toast.error('Failed to update deal: ' + err.message);
    },
  });

  const updateDealStage = useMutation({
    mutationFn: async ({ stageId, clientId, data, dealId, allStages }: { stageId: string; clientId: string; data: any; dealId?: string; allStages?: any[] }) => {
      // Update the stage itself
      const result = await manageDealData({
        operation: 'update',
        table: 'deal_stages',
        clientId,
        recordId: stageId,
        data,
      });

      // After status change, advance the parent deal's current_stage
      // to reflect the next actionable stage (in_progress or first pending)
      if (data.status && dealId && allStages) {
        const updatedStages = allStages.map(s =>
          s.id === stageId ? { ...s, ...data } : s
        ).sort((a: any, b: any) => a.display_order - b.display_order);

        const nextActive = updatedStages.find((s: any) => s.status === 'in_progress')
          || updatedStages.find((s: any) => s.status === 'pending');

        if (nextActive) {
          await manageDealData({
            operation: 'update',
            table: 'client_deals',
            clientId,
            recordId: dealId,
            data: {
              current_stage: nextActive.stage_name,
              current_stage_number: nextActive.stage_number,
            },
          });
        } else {
          // All stages complete/skipped
          const lastComplete = [...updatedStages].reverse().find((s: any) => s.status === 'complete');
          if (lastComplete) {
            await manageDealData({
              operation: 'update',
              table: 'client_deals',
              clientId,
              recordId: dealId,
              data: {
                current_stage: lastComplete.stage_name,
                current_stage_number: lastComplete.stage_number,
              },
            });
          }
        }
      }

      return result;
    },
    onSuccess: (_: any, variables: { stageId: string; clientId: string; data: any; dealId?: string; allStages?: any[] }) => {
      invalidate();
      logActivityDirect({
        actionType: 'deal_stage_changed',
        entityType: 'deal',
        entityId: variables.stageId,
      });
      toast.success('Stage updated');
    },
    onError: (err: any) => {
      toast.error('Failed to update stage: ' + err.message);
    },
  });

  return { updateBuildPayment, updateDeal, updateDealStage };
}
