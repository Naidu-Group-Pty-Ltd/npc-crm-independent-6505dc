// Area-Level Report Schema Definitions
// Separate from property-level reportSchema.ts — these define the mandatory structure
// for Suburb, Postcode, and Statewide analysis reports.

import type { ReportSection, TableStructure } from './reportSchema';

// ============================================================================
// SUBURB COMPASS REPORT SCHEMA v1.0
// ============================================================================
export const SUBURB_REPORT_SCHEMA: ReportSection[] = [
  {
    id: 'executive_summary',
    title: 'Executive Summary',
    required: true,
    order: 1,
    subsections: [
      { id: 'suburb_thesis', title: 'Suburb Investment Thesis', required: true, order: 1, minLength: 150, maxLength: 400 },
      { id: 'key_takeaways', title: 'Key Takeaways', required: true, order: 2, minLength: 100, maxLength: 300 },
    ],
  },
  {
    id: 'suburb_profile',
    title: 'Suburb Profile',
    required: true,
    order: 2,
    subsections: [
      { id: 'overview_character', title: 'Overview & Character', required: true, order: 1, minLength: 150 },
      { id: 'geographic_context', title: 'Geographic Context', required: true, order: 2, minLength: 100 },
      { id: 'statistical_areas', title: 'Statistical Areas (SA2/SA3/LGA)', required: true, order: 3, minLength: 50 },
    ],
  },
  {
    id: 'market_analysis',
    title: 'Market Analysis',
    required: true,
    order: 3,
    subsections: [
      { id: 'current_market_snapshot', title: 'Current Market Snapshot', required: true, order: 1, minLength: 200 },
      { id: 'market_activity', title: 'Market Activity', required: true, order: 2, minLength: 150 },
      { id: 'auction_clearance', title: 'Auction Clearance & Vendor Discounts', required: true, order: 3, minLength: 100 },
    ],
  },
  {
    id: 'price_trends',
    title: 'Price Trends & Growth',
    required: true,
    order: 4,
    subsections: [
      { id: 'capital_growth_history', title: 'Capital Growth History (1/3/5/10yr)', required: true, order: 1, minLength: 150 },
      { id: 'price_distribution', title: 'Price Distribution', required: true, order: 2, minLength: 100 },
      { id: 'quarterly_movement', title: 'Quarterly Movement', required: true, order: 3, minLength: 100 },
    ],
  },
  {
    id: 'rental_market',
    title: 'Rental Market Deep Dive',
    required: true,
    order: 5,
    subsections: [
      { id: 'median_rents', title: 'Median Rents by Property Type', required: true, order: 1, minLength: 100 },
      { id: 'rental_yield_trends', title: 'Rental Yield Trends', required: true, order: 2, minLength: 100 },
      { id: 'vacancy_history', title: 'Vacancy Rate History', required: true, order: 3, minLength: 80 },
      { id: 'rental_demand_drivers', title: 'Rental Demand Drivers', required: true, order: 4, minLength: 100 },
    ],
  },
  {
    id: 'demographics',
    title: 'Demographics & Economics',
    required: true,
    order: 6,
    subsections: [
      { id: 'population_growth', title: 'Population & Growth', required: true, order: 1, minLength: 100 },
      { id: 'age_profile', title: 'Age Profile', required: true, order: 2, minLength: 80 },
      { id: 'household_income', title: 'Household Income', required: true, order: 3, minLength: 100 },
      { id: 'employment_sectors', title: 'Employment Sectors', required: true, order: 4, minLength: 100 },
      { id: 'household_composition', title: 'Household Composition & Tenure', required: true, order: 5, minLength: 80 },
    ],
  },
  {
    id: 'location_amenities',
    title: 'Location & Amenities',
    required: true,
    order: 7,
    subsections: [
      { id: 'transport', title: 'Transport & Accessibility', required: true, order: 1, minLength: 100 },
      { id: 'schools', title: 'Schools & Education', required: true, order: 2, minLength: 100 },
      { id: 'shopping', title: 'Shopping & Retail', required: true, order: 3, minLength: 50 },
      { id: 'healthcare', title: 'Healthcare Facilities', required: true, order: 4, minLength: 50 },
      { id: 'recreation', title: 'Recreation & Lifestyle', required: true, order: 5, minLength: 50 },
    ],
  },
  {
    id: 'supply_pipeline',
    title: 'Supply & Development Pipeline',
    required: true,
    order: 8,
    subsections: [
      { id: 'da_approvals', title: 'DA Approvals & New Builds', required: true, order: 1, minLength: 100 },
      { id: 'rezoning', title: 'Rezoning Activity', required: true, order: 2, minLength: 80 },
    ],
  },
  {
    id: 'risk_assessment',
    title: 'Risk Assessment',
    required: true,
    order: 9,
    subsections: [
      { id: 'natural_hazards', title: 'Natural Hazards (Flood/Bushfire)', required: true, order: 1, minLength: 100 },
      { id: 'market_concentration', title: 'Market Concentration Risk', required: true, order: 2, minLength: 80 },
      { id: 'crime_safety', title: 'Crime & Safety', required: true, order: 3, minLength: 100 },
    ],
  },
  {
    id: 'investment_score',
    title: 'Investment Score & SWOT',
    required: true,
    order: 10,
    subsections: [
      { id: 'suburb_score', title: 'Suburb Investment Score', required: true, order: 1, minLength: 80 },
      { id: 'swot', title: 'SWOT Analysis', required: true, order: 2, minLength: 200 },
    ],
  },
  {
    id: 'comparative_context',
    title: 'Comparative Context',
    required: true,
    order: 11,
    subsections: [
      { id: 'neighbouring_comparison', title: 'Neighbouring Suburb Comparison', required: true, order: 1, minLength: 150 },
      { id: 'lga_benchmarks', title: 'LGA & Metro Benchmarks', required: true, order: 2, minLength: 100 },
    ],
  },
  {
    id: 'disclaimer',
    title: 'Disclaimer',
    required: true,
    order: 12,
    subsections: [
      { id: 'disclaimer_content', title: 'Legal Disclaimer', required: true, order: 1, minLength: 200 },
      { id: 'contact_info', title: 'Contact Information', required: true, order: 2, minLength: 50 },
    ],
  },
];

// ============================================================================
// POSTCODE COMPASS REPORT SCHEMA v1.0
// ============================================================================
export const POSTCODE_REPORT_SCHEMA: ReportSection[] = [
  {
    id: 'executive_summary',
    title: 'Executive Summary',
    required: true,
    order: 1,
    subsections: [
      { id: 'postcode_thesis', title: 'Postcode Investment Thesis', required: true, order: 1, minLength: 150, maxLength: 400 },
      { id: 'key_takeaways', title: 'Key Takeaways', required: true, order: 2, minLength: 100, maxLength: 300 },
    ],
  },
  {
    id: 'zone_profile',
    title: 'Zone Profile',
    required: true,
    order: 2,
    subsections: [
      { id: 'suburbs_covered', title: 'Suburbs Covered', required: true, order: 1, minLength: 100 },
      { id: 'lga_boundaries', title: 'LGA & Geographic Boundaries', required: true, order: 2, minLength: 80 },
      { id: 'zone_character', title: 'Zone Character & Overview', required: true, order: 3, minLength: 100 },
    ],
  },
  {
    id: 'market_overview',
    title: 'Market Overview',
    required: true,
    order: 3,
    subsections: [
      { id: 'aggregated_medians', title: 'Aggregated Medians (Houses/Units)', required: true, order: 1, minLength: 150 },
      { id: 'dom_clearance', title: 'Days on Market & Clearance Rates', required: true, order: 2, minLength: 100 },
      { id: 'stock_levels', title: 'Stock on Market', required: true, order: 3, minLength: 80 },
    ],
  },
  {
    id: 'suburb_breakdown',
    title: 'Suburb-by-Suburb Breakdown',
    required: true,
    order: 4,
    subsections: [
      { id: 'suburb_comparison_table', title: 'Suburb Comparison Table', required: true, order: 1, minLength: 200 },
      { id: 'standout_suburbs', title: 'Standout Performers', required: true, order: 2, minLength: 100 },
    ],
  },
  {
    id: 'price_trends',
    title: 'Price Trends & Growth',
    required: true,
    order: 5,
    subsections: [
      { id: 'postcode_growth', title: 'Postcode-Wide Historical Trends', required: true, order: 1, minLength: 150 },
      { id: 'metro_state_benchmarks', title: 'Metro & State Benchmarks', required: true, order: 2, minLength: 100 },
    ],
  },
  {
    id: 'rental_market',
    title: 'Rental Market',
    required: true,
    order: 6,
    subsections: [
      { id: 'aggregate_rental', title: 'Aggregate Rental Data', required: true, order: 1, minLength: 100 },
      { id: 'suburb_yield_comparison', title: 'Suburb-Level Yield Comparison', required: true, order: 2, minLength: 100 },
      { id: 'vacancy_rates', title: 'Vacancy Rates Across Zone', required: true, order: 3, minLength: 80 },
    ],
  },
  {
    id: 'demographics',
    title: 'Demographics & Economics',
    required: true,
    order: 7,
    subsections: [
      { id: 'population', title: 'Population & Growth', required: true, order: 1, minLength: 100 },
      { id: 'income_employment', title: 'Income & Employment', required: true, order: 2, minLength: 100 },
      { id: 'household_profile', title: 'Household Profile', required: true, order: 3, minLength: 80 },
    ],
  },
  {
    id: 'infrastructure',
    title: 'Infrastructure & Development',
    required: true,
    order: 8,
    subsections: [
      { id: 'major_projects', title: 'Major Projects & Transport Upgrades', required: true, order: 1, minLength: 100 },
      { id: 'rezoning_pipeline', title: 'Rezoning & Development Pipeline', required: true, order: 2, minLength: 80 },
    ],
  },
  {
    id: 'risk_assessment',
    title: 'Risk Assessment',
    required: true,
    order: 9,
    subsections: [
      { id: 'hazard_mapping', title: 'Zone-Level Hazard Mapping', required: true, order: 1, minLength: 100 },
      { id: 'diversification', title: 'Market Diversification Analysis', required: true, order: 2, minLength: 80 },
    ],
  },
  {
    id: 'investment_score',
    title: 'Investment Score & Hotspot Identification',
    required: true,
    order: 10,
    subsections: [
      { id: 'zone_score', title: 'Zone Investment Score', required: true, order: 1, minLength: 80 },
      { id: 'hotspot_suburbs', title: 'Best Value Suburbs Within Postcode', required: true, order: 2, minLength: 150 },
      { id: 'swot', title: 'SWOT Analysis', required: true, order: 3, minLength: 200 },
    ],
  },
  {
    id: 'disclaimer',
    title: 'Disclaimer',
    required: true,
    order: 11,
    subsections: [
      { id: 'disclaimer_content', title: 'Legal Disclaimer', required: true, order: 1, minLength: 200 },
      { id: 'contact_info', title: 'Contact Information', required: true, order: 2, minLength: 50 },
    ],
  },
];

// ============================================================================
// STATEWIDE COMPASS REPORT SCHEMA v1.0
// ============================================================================
export const STATEWIDE_REPORT_SCHEMA: ReportSection[] = [
  {
    id: 'executive_summary',
    title: 'Executive Summary',
    required: true,
    order: 1,
    subsections: [
      { id: 'state_thesis', title: 'State Investment Climate Summary', required: true, order: 1, minLength: 200, maxLength: 500 },
      { id: 'key_takeaways', title: 'Key Takeaways', required: true, order: 2, minLength: 100, maxLength: 300 },
    ],
  },
  {
    id: 'economic_overview',
    title: 'State Economic Overview',
    required: true,
    order: 2,
    subsections: [
      { id: 'gdp_output', title: 'GDP & Economic Output', required: true, order: 1, minLength: 150 },
      { id: 'employment_industries', title: 'Employment & Major Industries', required: true, order: 2, minLength: 150 },
      { id: 'population_migration', title: 'Population Growth & Migration', required: true, order: 3, minLength: 150 },
    ],
  },
  {
    id: 'property_market',
    title: 'Property Market Overview',
    required: true,
    order: 3,
    subsections: [
      { id: 'statewide_medians', title: 'State-Wide Medians & Activity', required: true, order: 1, minLength: 150 },
      { id: 'dom_clearance', title: 'Days on Market & Clearance Rates', required: true, order: 2, minLength: 100 },
      { id: 'total_listings', title: 'Total Listings Volume', required: true, order: 3, minLength: 80 },
    ],
  },
  {
    id: 'regional_comparison',
    title: 'Regional Comparison',
    required: true,
    order: 4,
    subsections: [
      { id: 'metro_vs_regional', title: 'Metro vs Regional Performance', required: true, order: 1, minLength: 200 },
      { id: 'top_bottom_suburbs', title: 'Top & Bottom Performing Areas', required: true, order: 2, minLength: 200 },
    ],
  },
  {
    id: 'price_trends',
    title: 'Price Trends & Affordability',
    required: true,
    order: 5,
    subsections: [
      { id: 'state_growth', title: 'State Growth vs National Benchmarks', required: true, order: 1, minLength: 150 },
      { id: 'affordability_index', title: 'Affordability Index', required: true, order: 2, minLength: 100 },
    ],
  },
  {
    id: 'rental_market',
    title: 'Rental Market',
    required: true,
    order: 6,
    subsections: [
      { id: 'state_vacancy', title: 'State Vacancy Rates', required: true, order: 1, minLength: 100 },
      { id: 'rental_growth', title: 'Rental Growth by Region', required: true, order: 2, minLength: 100 },
      { id: 'yield_by_region', title: 'Rental Yield by Region', required: true, order: 3, minLength: 100 },
    ],
  },
  {
    id: 'government_policy',
    title: 'Government Policy & Regulation',
    required: true,
    order: 7,
    subsections: [
      { id: 'stamp_duty', title: 'Stamp Duty & Land Tax', required: true, order: 1, minLength: 100 },
      { id: 'fhb_schemes', title: 'First Home Buyer Schemes', required: true, order: 2, minLength: 80 },
      { id: 'planning_reforms', title: 'Planning Reforms & Zoning Changes', required: true, order: 3, minLength: 100 },
    ],
  },
  {
    id: 'infrastructure_pipeline',
    title: 'Infrastructure Pipeline',
    required: true,
    order: 8,
    subsections: [
      { id: 'major_projects', title: 'Major State Projects', required: true, order: 1, minLength: 150 },
      { id: 'impact_zones', title: 'Investment Impact Zones', required: true, order: 2, minLength: 100 },
    ],
  },
  {
    id: 'risk_macro',
    title: 'Risk & Macro Factors',
    required: true,
    order: 9,
    subsections: [
      { id: 'interest_sensitivity', title: 'Interest Rate Sensitivity', required: true, order: 1, minLength: 100 },
      { id: 'supply_risk', title: 'Supply Pipeline Risk', required: true, order: 2, minLength: 80 },
      { id: 'growth_corridors', title: 'Population Growth Corridors', required: true, order: 3, minLength: 100 },
    ],
  },
  {
    id: 'investment_hotspots',
    title: 'Investment Hotspots',
    required: true,
    order: 10,
    subsections: [
      { id: 'top_regions', title: 'Top Opportunity Regions/Suburbs', required: true, order: 1, minLength: 200 },
      { id: 'reasoning', title: 'Hotspot Reasoning & Data', required: true, order: 2, minLength: 150 },
      { id: 'swot', title: 'State-Level SWOT Analysis', required: true, order: 3, minLength: 200 },
    ],
  },
  {
    id: 'disclaimer',
    title: 'Disclaimer',
    required: true,
    order: 11,
    subsections: [
      { id: 'disclaimer_content', title: 'Legal Disclaimer', required: true, order: 1, minLength: 200 },
      { id: 'contact_info', title: 'Contact Information', required: true, order: 2, minLength: 50 },
    ],
  },
];

// ============================================================================
// REQUIRED TABLES PER SCOPE
// ============================================================================

export const SUBURB_REQUIRED_TABLES: TableStructure[] = [
  {
    id: 'market_snapshot',
    title: 'Current Market Snapshot',
    required: true,
    columns: [
      { id: 'property_type', header: 'Property Type', type: 'text', required: true },
      { id: 'median_price', header: 'Median Price', type: 'currency', required: true, format: '$#,##0' },
      { id: 'median_rent', header: 'Median Rent (Weekly)', type: 'currency', required: true, format: '$#,##0' },
      { id: 'gross_yield', header: 'Gross Yield', type: 'percentage', required: true, format: '0.00%' },
      { id: 'annual_growth', header: 'Annual Growth', type: 'percentage', required: true, format: '+/-0.0%' },
    ],
    minRows: 2,
    maxRows: 4,
  },
  {
    id: 'market_activity',
    title: 'Market Activity',
    required: true,
    columns: [
      { id: 'metric', header: 'Metric', type: 'text', required: true },
      { id: 'houses', header: 'Houses', type: 'text', required: true },
      { id: 'units', header: 'Units', type: 'text', required: true },
    ],
    minRows: 4,
    maxRows: 8,
  },
  {
    id: 'suburb_comparison',
    title: 'Neighbouring Suburb Comparison',
    required: true,
    columns: [
      { id: 'suburb', header: 'Suburb', type: 'text', required: true },
      { id: 'median_price', header: 'Median Price', type: 'currency', required: true, format: '$#,##0' },
      { id: 'growth', header: '5yr Growth', type: 'percentage', required: true },
      { id: 'yield', header: 'Gross Yield', type: 'percentage', required: true },
    ],
    minRows: 3,
    maxRows: 8,
  },
];

export const POSTCODE_REQUIRED_TABLES: TableStructure[] = [
  {
    id: 'suburb_breakdown',
    title: 'Suburb-by-Suburb Breakdown',
    required: true,
    columns: [
      { id: 'suburb', header: 'Suburb', type: 'text', required: true },
      { id: 'median_price', header: 'Median Price', type: 'currency', required: true, format: '$#,##0' },
      { id: 'growth', header: 'Annual Growth', type: 'percentage', required: true },
      { id: 'yield', header: 'Gross Yield', type: 'percentage', required: true },
      { id: 'vacancy', header: 'Vacancy', type: 'percentage', required: true },
    ],
    minRows: 2,
    maxRows: 15,
  },
  {
    id: 'rental_yield_comparison',
    title: 'Suburb Rental Yield Comparison',
    required: true,
    columns: [
      { id: 'suburb', header: 'Suburb', type: 'text', required: true },
      { id: 'median_rent', header: 'Median Rent', type: 'currency', required: true, format: '$#,##0' },
      { id: 'yield_houses', header: 'House Yield', type: 'percentage', required: true },
      { id: 'yield_units', header: 'Unit Yield', type: 'percentage', required: true },
    ],
    minRows: 2,
    maxRows: 15,
  },
];

export const STATEWIDE_REQUIRED_TABLES: TableStructure[] = [
  {
    id: 'regional_comparison',
    title: 'Metro vs Regional Performance',
    required: true,
    columns: [
      { id: 'region', header: 'Region', type: 'text', required: true },
      { id: 'median_price', header: 'Median Price', type: 'currency', required: true, format: '$#,##0' },
      { id: 'annual_growth', header: 'Annual Growth', type: 'percentage', required: true },
      { id: 'yield', header: 'Gross Yield', type: 'percentage', required: true },
      { id: 'vacancy', header: 'Vacancy', type: 'percentage', required: true },
    ],
    minRows: 2,
    maxRows: 20,
  },
  {
    id: 'top_performers',
    title: 'Top Performing Areas',
    required: true,
    columns: [
      { id: 'area', header: 'Area/Suburb', type: 'text', required: true },
      { id: 'median_price', header: 'Median Price', type: 'currency', required: true, format: '$#,##0' },
      { id: 'growth', header: '12-Month Growth', type: 'percentage', required: true },
      { id: 'driver', header: 'Key Driver', type: 'text', required: true },
    ],
    minRows: 5,
    maxRows: 10,
  },
];

// Schema versions
export const SUBURB_SCHEMA_VERSION = '1.0.0';
export const POSTCODE_SCHEMA_VERSION = '1.0.0';
export const STATEWIDE_SCHEMA_VERSION = '1.0.0';

// Helper: get schema by report scope
export function getSchemaByScope(scope: string): ReportSection[] {
  switch (scope) {
    case 'suburb': return SUBURB_REPORT_SCHEMA;
    case 'postcode': return POSTCODE_REPORT_SCHEMA;
    case 'statewide': return STATEWIDE_REPORT_SCHEMA;
    default: return [];
  }
}

// Helper: get required tables by scope
export function getRequiredTablesByScope(scope: string): TableStructure[] {
  switch (scope) {
    case 'suburb': return SUBURB_REQUIRED_TABLES;
    case 'postcode': return POSTCODE_REQUIRED_TABLES;
    case 'statewide': return STATEWIDE_REQUIRED_TABLES;
    default: return [];
  }
}
