/**
 * useClientPortfolio
 *
 * Phase 3 hook — fan-outs to the residential, commercial, and industrial data
 * sources and returns a normalised view of every property linked to a client.
 *
 * Purely additive: existing `useSecureClientData` keeps working unchanged.
 * Backed by `manage-client-data` + `manage-commercial-data` + `manage-industrial-data`
 * and mirrors the `client_portfolio_properties` SQL view shape (Phase 1).
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { commercialApi, type CommercialProperty } from './useCommercialProperties';
import { industrialApi, type IndustrialProperty } from './useIndustrialProperties';

export type PortfolioAssetClass = 'residential' | 'commercial' | 'industrial';

export interface PortfolioPropertyRow {
  id: string;
  client_id: string | null;
  asset_class: PortfolioAssetClass;
  sub_type: string | null;
  address: string;
  value: number | null;
  loan_remaining: number | null;
  interest_rate: number | null;
  monthly_repayment: number | null;
  ownership_percentage: number | null;
  lender_name: string | null;
  source_table: 'client_properties' | 'commercial_properties' | 'industrial_properties';
  linked_at: string | null;
  raw: any;
}

interface UseClientPortfolioOptions {
  clientId: string;
  enabled?: boolean;
}

function formatIndustrialAddress(p: IndustrialProperty): string {
  const parts = [p.street, p.suburb, p.state, p.postcode].filter(Boolean);
  return parts.length ? parts.join(', ') : (p.property_name || 'Industrial property');
}

export function useClientPortfolio({ clientId, enabled = true }: UseClientPortfolioOptions) {
  const queryClient = useQueryClient();

  const residentialQuery = useQuery({
    queryKey: ['client-portfolio', 'residential', clientId],
    enabled: enabled && !!clientId,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        clientId,
        include: { properties: true },
      });
      if (error) throw new Error(error.message);
      return (data?.properties || []) as any[];
    },
  });

  const commercialQuery = useQuery({
    queryKey: ['client-portfolio', 'commercial', clientId],
    enabled: enabled && !!clientId,
    queryFn: async () => {
      const res = await commercialApi.listProperties(clientId);
      if (res.error) throw new Error(res.error.message);
      return (res.data || []) as CommercialProperty[];
    },
  });

  const industrialQuery = useQuery({
    queryKey: ['client-portfolio', 'industrial', clientId],
    enabled: enabled && !!clientId,
    queryFn: async () => {
      const res = await industrialApi.listProperties(clientId);
      if (res.error) throw new Error(res.error.message);
      return (res.data || []) as IndustrialProperty[];
    },
  });

  const normalised = useMemo<{
    residential: PortfolioPropertyRow[];
    commercial: PortfolioPropertyRow[];
    industrial: PortfolioPropertyRow[];
    all: PortfolioPropertyRow[];
  }>(() => {
    const residential: PortfolioPropertyRow[] = (residentialQuery.data || []).map((p: any) => ({
      id: p.id,
      client_id: p.client_id ?? clientId,
      asset_class: 'residential',
      sub_type: p.property_type ?? null,
      address: p.address ?? '',
      value: p.value ?? p.current_value ?? null,
      loan_remaining: p.loan_remaining ?? null,
      interest_rate: p.interest_rate ?? null,
      monthly_repayment: p.monthly_interest_repayment ?? null,
      ownership_percentage: p.ownership_percentage ?? null,
      lender_name: p.lender_name ?? null,
      source_table: 'client_properties',
      linked_at: null,
      raw: p,
    }));

    const commercial: PortfolioPropertyRow[] = (commercialQuery.data || []).map((p) => ({
      id: p.id,
      client_id: p.client_id ?? null,
      asset_class: 'commercial',
      sub_type: p.asset_class ?? null,
      address: p.address ?? '',
      value: p.valuation ?? p.purchase_price ?? null,
      loan_remaining: null,
      interest_rate: null,
      monthly_repayment: null,
      ownership_percentage: null,
      lender_name: null,
      source_table: 'commercial_properties',
      linked_at: (p as any).linked_at ?? null,
      raw: p,
    }));

    const industrial: PortfolioPropertyRow[] = (industrialQuery.data || []).map((p) => {
      const fin = (p as any).industrial_financing || {};
      return {
        id: p.id,
        client_id: p.client_id ?? null,
        asset_class: 'industrial',
        sub_type: p.asset_subtype ?? null,
        address: formatIndustrialAddress(p),
        value: p.current_valuation ?? p.purchase_price ?? null,
        loan_remaining: typeof fin.loan_remaining === 'number' ? fin.loan_remaining : null,
        interest_rate: typeof fin.interest_rate === 'number' ? fin.interest_rate : null,
        monthly_repayment: typeof fin.monthly_repayment === 'number' ? fin.monthly_repayment : null,
        ownership_percentage: typeof fin.ownership_percentage === 'number' ? fin.ownership_percentage : null,
        lender_name: typeof fin.lender_name === 'string' ? fin.lender_name : null,
        source_table: 'industrial_properties',
        linked_at: (p as any).linked_at ?? null,
        raw: p,
      };
    });

    return {
      residential,
      commercial,
      industrial,
      all: [...residential, ...commercial, ...industrial],
    };
  }, [residentialQuery.data, commercialQuery.data, industrialQuery.data, clientId]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['client-portfolio', 'residential', clientId] });
    queryClient.invalidateQueries({ queryKey: ['client-portfolio', 'commercial', clientId] });
    queryClient.invalidateQueries({ queryKey: ['client-portfolio', 'industrial', clientId] });
  };

  return {
    ...normalised,
    counts: {
      residential: normalised.residential.length,
      commercial: normalised.commercial.length,
      industrial: normalised.industrial.length,
      total: normalised.all.length,
    },
    isLoading:
      residentialQuery.isLoading || commercialQuery.isLoading || industrialQuery.isLoading,
    isFetching:
      residentialQuery.isFetching || commercialQuery.isFetching || industrialQuery.isFetching,
    error:
      (residentialQuery.error as Error | null) ||
      (commercialQuery.error as Error | null) ||
      (industrialQuery.error as Error | null) ||
      null,
    refetch: () => {
      residentialQuery.refetch();
      commercialQuery.refetch();
      industrialQuery.refetch();
    },
    invalidate,
  };
}
