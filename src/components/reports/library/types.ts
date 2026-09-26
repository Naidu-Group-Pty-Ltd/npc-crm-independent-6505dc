export interface GeneratedReport {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  listing_count: number;
  chart_images: any;
  kpis: any;
  analytics: any;
  insights: any;
  config: any;
  generated_by?: string | null;
  source_snapshot?: any;
  pdf_bucket?: string | null;
  pdf_path?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  generated_at?: string | null;
  report_type?: string | null;
  status?: string | null;
  workspace_id?: string | null;
}

export interface InvestmentReport {
  id: string;
  property_address: string;
  property_listing_id: string | null;
  client_property_id?: string | null;
  /** Server-resolved identity used to keep all report variants on one property package. */
  canonical_property_key?: string | null;
  report_content?: string;
  sources_content?: string | null;
  created_at: string;
  /** Trigger-stamped on every write — read only for a report still being written. */
  updated_at?: string | null;
  /** When a child report was last drawn from its parent. */
  variant_generated_at?: string | null;
  /**
   * When this report was generated, resolved by `get-investment-reports`
   * (`reportGeneratedAt.pure.ts`). A regeneration reuses the row, so
   * `created_at` is the first generation's time and never the latest.
   */
  generated_at?: string | null;
  generated_at_basis?: 'generation' | 'activity' | 'created' | null;
  current_version: number;
  report_scope?: string;
  report_tier?: 'compass' | 'financial' | 'strategic' | 'briefing' | 'snapshot' | string;
  report_variant?: 'compass' | 'composite' | 'financial' | 'strategic' | 'briefing' | 'snapshot' | 'due_diligence' | null;
  derived_from_report_id?: string | null;
  parent_report_id?: string | null;
  status?: string;
  is_archived?: boolean | null;
  is_client_report?: boolean | null;
  manual_overrides?: any;
  financial_calculations?: any;
  demographics_data?: any;
  economic_data?: any;
  investment_score?: any;
  location_intelligence?: any;
  generated_by?: string | null;
}

export interface ComparisonAnalysis {
  id: string;
  property_count: number;
  property_addresses?: string[];
  property_states?: string[];
  report_title?: string;
  report_ids: string[];
  created_at: string;
  analysis_summary: string | null;
  executive_summary: string | null;
  rankings: any;
  recommendations: any;
  financial_comparison: any;
  location_comparison: any;
  risk_comparison: any;
  red_flags: any;
  created_by?: string | null;
  /** Which report family was compared — 'compass' | 'briefing' | 'snapshot' |
   *  'financial' | 'strategic'. Null on legacy rows the backfill could not
   *  type (dangling or mixed source reports). */
  comparison_type?: string | null;
  analysis_depth?: string | null;
  investor_profile?: string | null;
  is_archived?: boolean | null;
}
