/**
 * Hook + helpers for Commercial Property data via secure edge function.
 */
import { useCallback, useEffect, useState } from 'react';
import { invokeSecureFunction, type InvokeResult } from '@/lib/secureInvoke';

export type CommercialAssetClass =
  | 'office' | 'retail' | 'industrial' | 'mixed_use'
  | 'medical' | 'childcare' | 'hospitality' | 'other';

export type CommercialTenure = 'freehold' | 'leasehold' | 'strata';
export type GstTreatment = 'going_concern' | 'margin_scheme' | 'plus_gst' | 'standard' | 'input_taxed';
export type RentBasis = 'gross' | 'net' | 'semi_gross';
export type ReviewType = 'cpi' | 'fixed_percent' | 'market' | 'hybrid' | 'none';
export type LeaseStatus = 'occupied' | 'vacant' | 'holdover' | 'under_offer' | 'expired';
export type SecurityType = 'bond' | 'bank_guarantee' | 'personal_guarantee' | 'none';

export interface CommercialProperty {
  id: string;
  user_id: string;
  client_id?: string | null;
  address: string;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  asset_class: CommercialAssetClass;
  asset_sub_type?: string | null;
  tenure: CommercialTenure;
  zoning?: string | null;
  gfa_sqm?: number | null;
  nla_sqm?: number | null;
  site_area_sqm?: number | null;
  parking_bays?: number | null;
  year_built?: number | null;
  purchase_price?: number | null;
  acquisition_date?: string | null;
  gst_treatment: GstTreatment;
  valuation?: number | null;
  valuation_date?: string | null;
  valuer?: string | null;
  outgoings_recoverable: Record<string, number>;
  industrial_specs: Record<string, any>;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommercialLease {
  id: string;
  property_id: string;
  user_id: string;
  tenant_name: string;
  suite_unit?: string | null;
  nla_sqm?: number | null;
  lease_start?: string | null;
  lease_end?: string | null;
  option_terms: any[];
  base_rent_pa: number;
  rent_basis: RentBasis;
  review_type: ReviewType;
  review_freq_months?: number | null;
  next_review_date?: string | null;
  review_amount?: number | null;
  rent_free_months?: number | null;
  fitout_contribution?: number | null;
  cash_incentive?: number | null;
  outgoings_recovery_pct?: number | null;
  security_type: SecurityType;
  security_amount?: number | null;
  status: LeaseStatus;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export type CommercialCapexCategory =
  | 'base_building' | 'fit_out' | 'compliance' | 'lifts' | 'hvac'
  | 'roof' | 'facade' | 'sustainability' | 'other';

export interface CommercialCapexItem {
  id: string;
  property_id: string;
  year: number;
  amount: number;
  category: CommercialCapexCategory | string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommercialFinancing {
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

export interface CommercialDcfRun {
  id: string;
  property_id: string;
  user_id: string;
  scenario_name?: string | null;
  hold_period_years?: number | null;
  discount_rate?: number | null;
  terminal_cap_rate?: number | null;
  rental_growth_assumptions?: any;
  vacancy_allowance_pct?: number | null;
  capex_schedule?: any;
  loan_amount?: number | null;
  interest_rate?: number | null;
  loan_term_years?: number | null;
  outputs?: Record<string, any> | null;
  irr?: number | null;
  npv?: number | null;
  equity_multiple?: number | null;
  peak_equity?: number | null;
  created_at: string;
  updated_at: string;
}

type Table = 'commercial_properties' | 'commercial_leases' | 'commercial_dcf_runs' | 'commercial_capex' | 'commercial_financing';

type EdgeEnvelope<T> = { success?: boolean; data?: T };

function unwrapEdgeEnvelope<T>(res: InvokeResult<EdgeEnvelope<T> | T>): InvokeResult<T> {
  const payload = res.data;
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return { ...res, data: (payload as EdgeEnvelope<T>).data ?? null };
  }
  return res as InvokeResult<T>;
}

async function call<T = any>(operation: string, table: Table, payload: any = {}) {
  const res = await invokeSecureFunction<EdgeEnvelope<T> | T>('manage-commercial-data', { operation, table, ...payload });
  return unwrapEdgeEnvelope<T>(res);
}

export const commercialApi = {
  listProperties: (clientId?: string) =>
    call<CommercialProperty[]>('list', 'commercial_properties', { clientId }),
  getProperty: (recordId: string) =>
    call<CommercialProperty>('get', 'commercial_properties', { recordId }),
  createProperty: (data: Partial<CommercialProperty>) =>
    call<CommercialProperty>('create', 'commercial_properties', { data }),
  updateProperty: (recordId: string, data: Partial<CommercialProperty>) =>
    call<CommercialProperty>('update', 'commercial_properties', { recordId, data }),
  deleteProperty: (recordId: string) =>
    call('delete', 'commercial_properties', { recordId }),

  listLeases: (propertyId: string) =>
    call<CommercialLease[]>('list', 'commercial_leases', { propertyId }),
  createLease: (data: Partial<CommercialLease>) =>
    call<CommercialLease>('create', 'commercial_leases', { data }),
  updateLease: (recordId: string, data: Partial<CommercialLease>) =>
    call<CommercialLease>('update', 'commercial_leases', { recordId, data }),
  deleteLease: (recordId: string) =>
    call('delete', 'commercial_leases', { recordId }),

  // DCF runs (assumptions, audit trail, generated schedule and report-ready outputs)
  listDcfRuns: (propertyId: string) =>
    call<CommercialDcfRun[]>('list', 'commercial_dcf_runs', { propertyId }),
  createDcfRun: (data: Partial<CommercialDcfRun>) =>
    call<CommercialDcfRun>('create', 'commercial_dcf_runs', { data }),
  updateDcfRun: (recordId: string, data: Partial<CommercialDcfRun>) =>
    call<CommercialDcfRun>('update', 'commercial_dcf_runs', { recordId, data }),
  deleteDcfRun: (recordId: string) =>
    call('delete', 'commercial_dcf_runs', { recordId }),

  // Capex
  listCapex: (propertyId: string) =>
    call<CommercialCapexItem[]>('list', 'commercial_capex', { propertyId }),
  createCapex: (data: Partial<CommercialCapexItem>) =>
    call<CommercialCapexItem>('create', 'commercial_capex', { data }),
  updateCapex: (recordId: string, data: Partial<CommercialCapexItem>) =>
    call<CommercialCapexItem>('update', 'commercial_capex', { recordId, data }),
  deleteCapex: (recordId: string) =>
    call('delete', 'commercial_capex', { recordId }),

  // Financing (one-to-one with property)
  listFinancing: (propertyId: string) =>
    call<CommercialFinancing[]>('list', 'commercial_financing', { propertyId }),
  createFinancing: (data: Partial<CommercialFinancing>) =>
    call<CommercialFinancing>('create', 'commercial_financing', { data }),
  updateFinancing: (recordId: string, data: Partial<CommercialFinancing>) =>
    call<CommercialFinancing>('update', 'commercial_financing', { recordId, data }),
  deleteFinancing: (recordId: string) =>
    call('delete', 'commercial_financing', { recordId }),
};

export function useCommercialProperties() {
  const [properties, setProperties] = useState<CommercialProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await commercialApi.listProperties();
    if (res.error) setError(res.error.message);
    else { setProperties(res.data || []); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { properties, loading, error, refresh };
}

export function useCommercialLeases(propertyId: string | null) {
  const [leases, setLeases] = useState<CommercialLease[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!propertyId) { setLeases([]); return; }
    setLoading(true);
    const res = await commercialApi.listLeases(propertyId);
    if (!res.error) setLeases(res.data || []);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { leases, loading, refresh };
}

export function useCommercialCapex(propertyId: string | null) {
  const [items, setItems] = useState<CommercialCapexItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!propertyId) { setItems([]); return; }
    setLoading(true);
    const res = await commercialApi.listCapex(propertyId);
    if (!res.error) setItems(res.data || []);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { items, loading, refresh };
}

export function useCommercialFinancing(propertyId: string | null) {
  const [financing, setFinancing] = useState<CommercialFinancing | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!propertyId) { setFinancing(null); return; }
    setLoading(true);
    const res = await commercialApi.listFinancing(propertyId);
    if (!res.error) setFinancing((res.data && res.data[0]) || null);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { financing, loading, refresh };
}
