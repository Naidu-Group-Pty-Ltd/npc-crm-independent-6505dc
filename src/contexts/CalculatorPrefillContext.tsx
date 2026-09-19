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

function sumOutgoings(map?: Record<string, number> | null): number {
  if (!map) return 0;
  return Object.values(map).reduce((acc, v) => acc + (Number(v) || 0), 0);
}

function buildCommercialPrefill(p: CommercialProperty): CalculatorPrefill {
  const specs = (p.industrial_specs ?? {}) as Record<string, any>;
  const outgoings = (p.outgoings_recoverable ?? {}) as Record<string, number>;
  return {
    propertyId: p.id,
    domain: 'commercial',
    address: p.address,
    state: p.state ?? null,
    assetCategory: p.asset_class === 'industrial' ? 'industrial' : 'commercial',
    assetSubtype: p.asset_sub_type ?? p.asset_class,
    gstTreatment: p.gst_treatment,
    purchasePrice: p.purchase_price ?? null,
    valuation: p.valuation ?? null,
    gfaSqm: p.gfa_sqm ?? null,
    nlaSqm: p.nla_sqm ?? null,
    glaSqm: p.nla_sqm ?? null,
    siteAreaSqm: p.site_area_sqm ?? null,
    parkingBays: p.parking_bays ?? null,
    hardstandSqm: Number(specs.hardstand_sqm) || null,
    officePct: Number(specs.office_pct) || null,
    siteCoverPct: Number(specs.site_cover_pct) || null,
    clearanceMetres: Number(specs.clearance_metres) || null,
    powerKva: Number(specs.power_kva) || null,
    dockDoors: Number(specs.dock_doors) || null,
    groundFloorLoadKpa: Number(specs.ground_floor_load_kpa) || null,
    recoveredOutgoingsPa: sumOutgoings(outgoings) || null,
    outgoings,
    yearBuilt: p.year_built ?? null,
    zoning: p.zoning ?? null,
  };
}

function buildIndustrialPrefill(p: IndustrialProperty): CalculatorPrefill {
  return {
    propertyId: p.id,
    domain: 'industrial',
    address: [p.street, p.suburb, p.state, p.postcode].filter(Boolean).join(', '),
    state: p.state ?? null,
    assetCategory: 'industrial',
    assetSubtype: p.asset_subtype,
    purchasePrice: p.purchase_price ?? null,
    valuation: p.current_valuation ?? null,
    glaSqm: p.gla_sqm ?? null,
    siteAreaSqm: p.site_area_sqm ?? null,
    siteCoverPct: p.site_cover_pct ?? null,
    officePct: p.office_pct ?? null,
    hardstandSqm: p.hardstand_sqm ?? null,
    clearanceMetres: p.clearance_metres ?? null,
    powerKva: p.power_kva ?? null,
    dockDoors: p.dock_doors ?? null,
    groundFloorLoadKpa: p.ground_floor_load_kpa ?? null,
    yearBuilt: p.year_built ?? null,
    zoning: p.zoning ?? null,
    conditionRating: p.condition_rating ?? null,
  };
}

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
