export interface InvestmentReport {
  id: string;
  property_address: string;
  property_listing_id: string | null;
  report_content?: string;
  sources_content?: string | null;
  created_at: string;
  current_version?: number;
  report_scope?: string;
  status?: string;
  /** Lightweight display scalars resolved by the secure report-list endpoint. */
  cash_flow_purchase_price?: number | null;
  cash_flow_weekly_rent?: number | null;
  manual_overrides?: any;
  financial_calculations?: any;
  demographics_data?: any;
  economic_data?: any;
  investment_score?: any;
  location_intelligence?: any;
}

export type BuildTypeFilter = 'all' | 'new_build' | 'existing_property' | 'land_only';
export type DateRangeFilter = '30' | '90' | '180' | '365' | 'all';
export type BuildType = 'new_build' | 'existing_property' | 'land_only';

export interface InvestmentGrade {
  grade: string;
  color: string;
}
