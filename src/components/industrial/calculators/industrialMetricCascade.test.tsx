import { act, renderHook } from '@testing-library/react';
import type { CalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { useCascadedIndustrialField } from './industrialMetricCascade';

function prefill(propertyId: string, glaSqm: number | null): CalculatorPrefill {
  return {
    propertyId,
    domain: 'industrial',
    address: `${propertyId} Example Street`,
    assetCategory: 'industrial',
    glaSqm,
  };
}

describe('useCascadedIndustrialField', () => {
  it('clears overrides and history when the selected property changes', () => {
    const propertyA = prefill('property-a', 1_000);
    const propertyB = prefill('property-b', 2_000);
    const { result, rerender } = renderHook(
      ({ selected }) => useCascadedIndustrialField(selected, [
        { value: selected.glaSqm, source: 'Property Profile' },
      ]),
      { initialProps: { selected: propertyA } },
    );

    act(() => {
      result.current.setValue('1250');
      result.current.markVerified();
    });

    expect(result.current.value).toBe('1250');
    expect(result.current.source).toBe('Verified');
    expect(result.current.history).toHaveLength(1);

    rerender({ selected: propertyB });

    expect(result.current).toMatchObject({
      value: '2000',
      source: 'Property Profile',
      originalValue: '2000',
      originalSource: 'Property Profile',
      history: [],
      pendingSource: undefined,
    });
  });

  it('preserves an override when source data changes for the same property', () => {
    const propertyA = prefill('property-a', 1_000);
    const { result, rerender } = renderHook(
      ({ selected }) => useCascadedIndustrialField(selected, [
        { value: selected.glaSqm, source: 'Property Profile' },
      ]),
      { initialProps: { selected: propertyA } },
    );

    act(() => result.current.setValue('1250'));
    rerender({ selected: prefill('property-a', 1_100) });

    expect(result.current.value).toBe('1250');
    expect(result.current.source).toBe('User Override');
    expect(result.current.pendingSource).toEqual({ value: '1100', source: 'Property Profile' });
  });
});
