import { useMemo } from 'react';
import { stageDisplayOf } from '@/lib/deals/dealJourney.pure';
import type { DealWithClient } from '@/hooks/useAllDeals';
import type { PipelineFilters } from '@/components/deals/PipelineToolbar';

const RISK_SORT_ORDER: Record<string, number> = {
  urgent: 0,
  needs_follow_up: 1,
  on_track: 2,
};

/**
 * Applies search, filters, and sorting to the deals array.
 * This hook is consumed by DealPipeline and provides filtered deals
 * to all child tabs.
 */
export function usePipelineFilters(
  deals: DealWithClient[],
  filters: PipelineFilters
): DealWithClient[] {
  return useMemo(() => {
    let result = [...deals];

    // Search filter
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(d => {
        const searchable = [
          d.client_name,
          d.current_stage,
          // What the cards actually print — derived from the stages array,
          // so a search finds a deal by the stage its badge shows.
          stageDisplayOf(d),
          d.responsible_person,
          d.notes,
          d.deal_type,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return searchable.includes(q);
      });
    }

    // Deal type filter
    if (filters.dealType !== 'all') {
      result = result.filter(d => d.deal_type === filters.dealType);
    }

    // Risk status filter
    if (filters.riskStatus !== 'all') {
      result = result.filter(d => d.risk_status === filters.riskStatus);
    }

    // Responsible person filter
    if (filters.responsiblePerson !== 'all') {
      result = result.filter(d => d.responsible_person === filters.responsiblePerson);
    }

    // Sorting
    const dir = filters.sortDirection === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      switch (filters.sortField) {
        case 'client_name': {
          const nameA = (a.client_name || '').toLowerCase();
          const nameB = (b.client_name || '').toLowerCase();
          return nameA.localeCompare(nameB) * dir;
        }
        case 'settlement_date': {
          const dateA = a.settlement_date ? new Date(a.settlement_date).getTime() : Infinity;
          const dateB = b.settlement_date ? new Date(b.settlement_date).getTime() : Infinity;
          return (dateA - dateB) * dir;
        }
        case 'total_contract_price': {
          const valA = a.total_contract_price || 0;
          const valB = b.total_contract_price || 0;
          return (valA - valB) * dir;
        }
        case 'current_stage_number': {
          return (a.current_stage_number - b.current_stage_number) * dir;
        }
        case 'risk_status': {
          const riskA = RISK_SORT_ORDER[a.risk_status] ?? 99;
          const riskB = RISK_SORT_ORDER[b.risk_status] ?? 99;
          return (riskA - riskB) * dir;
        }
        case 'created_at':
        default: {
          const tA = new Date(a.created_at).getTime();
          const tB = new Date(b.created_at).getTime();
          return (tA - tB) * dir;
        }
      }
    });

    return result;
  }, [deals, filters]);
}
