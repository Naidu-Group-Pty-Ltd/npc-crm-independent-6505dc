/**
 * Hook + helpers for Industrial Property data via secure edge function.
 */
import { useCallback, useEffect, useState } from 'react';
import { invokeSecureFunction, type InvokeResult } from '@/lib/secureInvoke';

export type IndustrialAssetSubtype =
  | 'warehouse' | 'logistics' | 'manufacturing' | 'cold_storage'
  | 'flex' | 'data_centre' | 'transport_yard' | 'other';

export type IndustrialStatus = 'active' | 'on_market' | 'under_offer' | 'sold' | 'inactive';
export type OutgoingsRecoveryType = 'net' | 'gross' | 'semi_gross';
export type AnnualReviewType = 'cpi' | 'fixed_percent' | 'market' | 'hybrid' | 'none';
export type IndustrialCapexCategory = 'roof' | 'hardstand' | 'racking' | 'compliance' | 'sprinkler' | 'office_fitout' | 'other';

export interface IndustrialProperty {
  id: string;
  user_id: string;
  client_id?: string | null;
  property_name?: string | null;
  street?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  asset_subtype: IndustrialAssetSubtype;
  purchase_price?: number | null;
  purchase_date?: string | null;
  current_valuation?: number | null;
  valuation_date?: string | null;
  gla_sqm?: number | null;
  site_area_sqm?: number | null;
  site_cover_pct?: number | null;
  office_pct?: number | null;
  hardstand_sqm?: number | null;
  clearance_metres?: number | null;
  power_kva?: number | null;
  dock_doors?: number | null;
  ground_floor_load_kpa?: number | null;
  zoning?: string | null;
  year_built?: number | null;
  condition_rating?: string | null;
  status: IndustrialStatus;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface IndustrialTenancy {
  id: string;
  property_id: string;
  tenant_name: string;
  anzsic_industry?: string | null;
  unit_label?: string | null;
  gla_sqm?: number | null;
  lease_start?: string | null;
  lease_end?: string | null;
  base_rent_per_sqm_pa?: number | null;
  base_rent_pa?: number | null;
  outgoings_recovery_type: OutgoingsRecoveryType;
  annual_review_type: AnnualReviewType;
  review_rate_pct?: number | null;
  option_terms_years?: number | null;
  bank_guarantee_months?: number | null;
  incentive_pct?: number | null;
  make_good_status?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface IndustrialCapexItem {
  id: string;
  property_id: string;
  year: number;
  amount: number;
  category: IndustrialCapexCategory;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface IndustrialFinancing {
  id: string;
  property_id: string;
  lender?: string | null;
  loan_amount?: number | null;
  loan_balance?: number | null;
  interest_rate?: number | null;
  loan_term_years?: number | null;
  io_period_years?: number | null;
  repayment_type?: 'pi' | 'io' | 'pi_after_io' | null;
  lvr_pct?: number | null;
  upfront_fees?: number | null;
  ongoing_fees_pa?: number | null;
  rate_type?: 'variable' | 'fixed' | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

type Table = 'industrial_properties' | 'industrial_tenancies' | 'industrial_capex' | 'industrial_financing';

type EdgeEnvelope<T> = { success?: boolean; data?: T };

function unwrapEdgeEnvelope<T>(res: InvokeResult<EdgeEnvelope<T> | T>): InvokeResult<T> {
  const payload = res.data;
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return { ...res, data: (payload as EdgeEnvelope<T>).data ?? null };
  }
  return res as InvokeResult<T>;
}

async function call<T = any>(operation: string, table: Table, payload: any = {}) {
  const res = await invokeSecureFunction<EdgeEnvelope<T> | T>('manage-industrial-data', { operation, table, ...payload });
  return unwrapEdgeEnvelope<T>(res);
}

export const industrialApi = {
  listProperties: (clientId?: string) =>
    call<IndustrialProperty[]>('list', 'industrial_properties', { clientId }),
  getProperty: (recordId: string) =>
    call<IndustrialProperty>('get', 'industrial_properties', { recordId }),
  createProperty: (data: Partial<IndustrialProperty>) =>
    call<IndustrialProperty>('create', 'industrial_properties', { data }),
  updateProperty: (recordId: string, data: Partial<IndustrialProperty>) =>
    call<IndustrialProperty>('update', 'industrial_properties', { recordId, data }),
  deleteProperty: (recordId: string) =>
    call('delete', 'industrial_properties', { recordId }),

  listTenancies: (propertyId: string) =>
    call<IndustrialTenancy[]>('list', 'industrial_tenancies', { propertyId }),
  createTenancy: (data: Partial<IndustrialTenancy>) =>
    call<IndustrialTenancy>('create', 'industrial_tenancies', { data }),
  updateTenancy: (recordId: string, data: Partial<IndustrialTenancy>) =>
    call<IndustrialTenancy>('update', 'industrial_tenancies', { recordId, data }),
  deleteTenancy: (recordId: string) =>
    call('delete', 'industrial_tenancies', { recordId }),

  listCapex: (propertyId: string) =>
    call<IndustrialCapexItem[]>('list', 'industrial_capex', { propertyId }),
  createCapex: (data: Partial<IndustrialCapexItem>) =>
    call<IndustrialCapexItem>('create', 'industrial_capex', { data }),
  updateCapex: (recordId: string, data: Partial<IndustrialCapexItem>) =>
    call<IndustrialCapexItem>('update', 'industrial_capex', { recordId, data }),
  deleteCapex: (recordId: string) =>
    call('delete', 'industrial_capex', { recordId }),

  // Financing (one-to-one with property)
  listFinancing: (propertyId: string) =>
    call<IndustrialFinancing[]>('list', 'industrial_financing', { propertyId }),
  createFinancing: (data: Partial<IndustrialFinancing>) =>
    call<IndustrialFinancing>('create', 'industrial_financing', { data }),
  updateFinancing: (recordId: string, data: Partial<IndustrialFinancing>) =>
    call<IndustrialFinancing>('update', 'industrial_financing', { recordId, data }),
  deleteFinancing: (recordId: string) =>
    call('delete', 'industrial_financing', { recordId }),
};

export function useIndustrialProperties() {
  const [properties, setProperties] = useState<IndustrialProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await industrialApi.listProperties();
    if (res.error) setError(res.error.message);
    else { setProperties(res.data || []); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { properties, loading, error, refresh };
}

export function useIndustrialTenancies(propertyId: string | null) {
  const [tenancies, setTenancies] = useState<IndustrialTenancy[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!propertyId) { setTenancies([]); return; }
    setLoading(true);
    const res = await industrialApi.listTenancies(propertyId);
    if (!res.error) setTenancies(res.data || []);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { tenancies, loading, refresh };
}

export function useIndustrialCapex(propertyId: string | null) {
  const [items, setItems] = useState<IndustrialCapexItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!propertyId) { setItems([]); return; }
    setLoading(true);
    const res = await industrialApi.listCapex(propertyId);
    if (!res.error) setItems(res.data || []);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { items, loading, refresh };
}

export function useIndustrialFinancing(propertyId: string | null) {
  const [financing, setFinancing] = useState<IndustrialFinancing | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!propertyId) { setFinancing(null); return; }
    setLoading(true);
    const res = await industrialApi.listFinancing(propertyId);
    if (!res.error) setFinancing((res.data && res.data[0]) || null);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { financing, loading, refresh };
}
