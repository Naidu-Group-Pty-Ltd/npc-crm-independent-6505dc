/* @vitest-environment jsdom */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenYearCashFlowCard } from './TenYearCashFlowCard';
import { getDefaultCommercialIndustrialDealProfile, useCommercialDealState } from '@/utils/commercial/commercialDealState';

vi.mock('@/contexts/CalculatorPrefillContext', () => ({
  useCalculatorPrefill: () => ({ prefill: null }),
}));

describe('TenYearCashFlowCard report output lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
    useCommercialDealState.setState({
      profile: {
        ...getDefaultCommercialIndustrialDealProfile(),
        tenYearCashFlowOutputs: { summary: { year1Noi: 123456 } } as any,
      },
    });
  });

  it('clears a stale report output when there is no current generated model', async () => {
    render(<TenYearCashFlowCard />);

    await waitFor(() => {
      expect(useCommercialDealState.getState().profile.tenYearCashFlowOutputs).toBeUndefined();
    });
  });
});
