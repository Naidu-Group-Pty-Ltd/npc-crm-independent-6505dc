/**
 * CalculatorPrefillContext
 * ------------------------
 * Bidirectional bridge between Commercial / Industrial property records and
 * their calculator suites. Provides:
 *  - selectedProperty + asset domain
 *  - prefill payload normalised for every calculator card
 *  - pushBack() to persist calculator-derived values to the property record
 *  - query-param auto-select (?propertyId=...)
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { commercialApi, type CommercialProperty } from '@/hooks/useCommercialProperties';
import { industrialApi, type IndustrialProperty } from '@/hooks/useIndustrialProperties';
import { buildCommercialPrefill, buildIndustrialPrefill } from '@/lib/ciAssessment/registerProperty';

export type CalculatorDomain = 'commercial' | 'industrial';

export interface CalculatorPrefill {
  // Identity
  propertyId: string;
  domain: CalculatorDomain;
  address: string;
  state?: string | null;
  assetCategory: 'commercial' | 'industrial';
  assetSubtype?: string | null;
  gstTreatment?: string | null;
  // Valuation
  purchasePrice?: number | null;
  valuation?: number | null;
  // Areas
  gfaSqm?: number | null;
  nlaSqm?: number | null;
  glaSqm?: number | null;
  siteAreaSqm?: number | null;
  hardstandSqm?: number | null;
  officePct?: number | null;
  siteCoverPct?: number | null;
  parkingBays?: number | null;
  // Industrial specs
  clearanceMetres?: number | null;
  powerKva?: number | null;
  dockDoors?: number | null;
  groundFloorLoadKpa?: number | null;
  // Income (derived from rent-roll if available, otherwise vendor estimate / null)
  grossPassingRentPa?: number | null;
  marketRentPa?: number | null;
  recoveredOutgoingsPa?: number | null;
  outgoings?: Record<string, number>;
  passingNoi?: number | null;
  marketNoi?: number | null;
  walesYears?: number | null;
  // Misc
  yearBuilt?: number | null;
  zoning?: string | null;
  conditionRating?: string | null;
}

export interface PushBackResult { ok: boolean; error?: string }

interface ContextValue {
  domain: CalculatorDomain;
  loading: boolean;
  property: CommercialProperty | IndustrialProperty | null;
  prefill: CalculatorPrefill | null;
  selectProperty: (id: string | null) => Promise<void>;
  pushBack: (patch: Partial<Record<string, unknown>>) => Promise<PushBackResult>;
  clear: () => void;
}

const Ctx = createContext<ContextValue | undefined>(undefined);

// The row-to-prefill mapping lives in `lib/ciAssessment/registerProperty.ts`,
// which the assessment workflow uses to start an assessment from a register
// property. One mapping, so a building reads the same in both places.

interface ProviderProps { domain: CalculatorDomain; children: ReactNode }

export function CalculatorPrefillProvider({ domain, children }: ProviderProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [property, setProperty] = useState<CommercialProperty | IndustrialProperty | null>(null);
  const [loading, setLoading] = useState(false);

  const selectProperty = useCallback(async (id: string | null) => {
    if (!id) { setProperty(null); setSearchParams(p => { const n = new URLSearchParams(p); n.delete('propertyId'); return n; }, { replace: true }); return; }
    setLoading(true);
    try {
      const res = domain === 'commercial'
        ? await commercialApi.getProperty(id)
        : await industrialApi.getProperty(id);
      if (res.error) {
        toast.error(`Failed to load property: ${res.error.message}`);
        setProperty(null);
      } else if (res.data) {
        setProperty(res.data as any);
        setSearchParams(p => { const n = new URLSearchParams(p); n.set('propertyId', id); return n; }, { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }, [domain, setSearchParams]);

  // Auto-select from URL on mount / domain change
  useEffect(() => {
    const queryId = searchParams.get('propertyId');
    if (queryId && (!property || property.id !== queryId)) {
      void selectProperty(queryId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  const prefill = useMemo<CalculatorPrefill | null>(() => {
    if (!property) return null;
    return domain === 'commercial'
      ? buildCommercialPrefill(property as CommercialProperty)
      : buildIndustrialPrefill(property as IndustrialProperty);
  }, [property, domain]);

  const pushBack = useCallback(async (patch: Partial<Record<string, unknown>>): Promise<PushBackResult> => {
    if (!property) {
      toast.error('Select a property first to save calculator values back.');
      return { ok: false, error: 'no_property' };
    }
    const id = property.id;
    const res = domain === 'commercial'
      ? await commercialApi.updateProperty(id, patch as any)
      : await industrialApi.updateProperty(id, patch as any);
    if (res.error) {
      toast.error(`Save back failed: ${res.error.message}`);
      return { ok: false, error: res.error.message };
    }
    if (res.data) setProperty(res.data as any);
    toast.success('Calculator values saved to property.');
    return { ok: true };
  }, [domain, property]);

  const clear = useCallback(() => { void selectProperty(null); }, [selectProperty]);

  const value = useMemo<ContextValue>(() => ({
    domain, loading, property, prefill, selectProperty, pushBack, clear,
  }), [domain, loading, property, prefill, selectProperty, pushBack, clear]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCalculatorPrefill(): ContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCalculatorPrefill must be used inside CalculatorPrefillProvider');
  return v;
}

/**
 * useApplyPrefill — utility hook used by individual calculator cards.
 * Calls the mapper whenever the prefill payload changes. Mapper receives the
 * prefill object and should call its provided setters with `String(value)`.
 */
export function useApplyPrefill(map: (p: CalculatorPrefill) => void) {
  const { prefill } = useCalculatorPrefill();
  useEffect(() => {
    if (prefill) map(prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.propertyId]);
}
