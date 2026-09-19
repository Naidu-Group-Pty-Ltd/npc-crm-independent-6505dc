// Depreciation Calculator Types

export type PurchaseDateCategory = 'pre_budget' | 'post_budget_second_hand' | 'post_budget_brand_new';
export type PropertyType = 'house' | 'townhouse' | 'unit' | 'highrise' | 'commercial' | 'industrial';
export type FinishStandard = 'low' | 'medium' | 'high';
export type NearestCity = 'sydney_nsw' | 'melbourne_vic' | 'perth_wa' | 'brisbane_qld' | 'adelaide_sa' | 'cairns_qld' | 'canberra_act' | 'darwin_nt' | 'hobart_tas';

export interface DepreciationInput {
  purchasePrice: number;
  purchaseDate?: Date;
  purchaseDateCategory: PurchaseDateCategory;
  buildYear: number;
  propertyType: PropertyType;
  finishStandard: FinishStandard;
  nearestCity: NearestCity;
  renovated: boolean;
  fullyFurnished: boolean;
}

export interface DepreciationComp {
  id: string;
  purchase_price: number;
  purchase_date_category: PurchaseDateCategory;
  build_year: number;
  property_type: PropertyType;
  finish_standard: FinishStandard;
  nearest_city: NearestCity;
  renovated: boolean;
  fully_furnished: boolean;
  dv_year1: number;
  dv_year2: number;
  dv_year3: number;
  dv_year4: number;
  dv_year5: number;
  dv_year6: number;
  dv_year7: number;
  dv_year8: number;
  dv_year9: number;
  dv_year10: number;
  pc_year1: number;
  pc_year2: number;
  pc_year3: number;
  pc_year4: number;
  pc_year5: number;
  pc_year6: number;
  pc_year7: number;
  pc_year8: number;
  pc_year9: number;
  pc_year10: number;
  notes?: string;
  created_at?: string;
}

export interface DepreciationResult {
  dv: number[];
  pc: number[];
  dvTotal: number;
  pcTotal: number;
  matchCount: number;
  topCompIds: string[];
  confidenceScore: number;
  // Age-adjusted projection metadata
  propertyAge: number;           // Years since build (e.g., 9 for 2016 property in 2025)
  startingYear: number;          // Which depreciation year we're starting from (1-10, or extrapolated)
  isExtrapolated: boolean;       // True if property is older than 10 years and we're extrapolating
  projectionYears: number[];     // Calendar years for the 10-year projection (e.g., [2025, 2026, ...])
}

export interface ScoredComp extends DepreciationComp {
  score: number;
}

export const CITY_LABELS: Record<NearestCity, string> = {
  sydney_nsw: 'Sydney NSW',
  melbourne_vic: 'Melbourne VIC',
  perth_wa: 'Perth WA',
  brisbane_qld: 'Brisbane QLD',
  adelaide_sa: 'Adelaide SA',
  cairns_qld: 'Cairns QLD',
  canberra_act: 'Canberra ACT',
  darwin_nt: 'Darwin NT',
  hobart_tas: 'Hobart TAS',
};

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  house: 'House',
  townhouse: 'Townhouse',
  unit: 'Unit',
  highrise: 'Highrise',
  commercial: 'Commercial Property',
  industrial: 'Industrial Property',
};

export const FINISH_STANDARD_LABELS: Record<FinishStandard, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const PURCHASE_CATEGORY_LABELS: Record<PurchaseDateCategory, string> = {
  pre_budget: 'Pre-Budget 9 May 2017',
  post_budget_second_hand: 'Post-Budget 9 May 2017 (Second Hand)',
  post_budget_brand_new: 'Post-Budget 9 May 2017 (Brand New)',
};
