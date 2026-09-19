// Phase 2: Investment Report Schema Definition
// This defines the mandatory structure all reports must follow

export interface ReportSection {
  id: string;
  title: string;
  required: boolean;
  order: number;
  subsections?: ReportSubsection[];
  validationRules?: SectionValidationRule[];
}

export interface ReportSubsection {
  id: string;
  title: string;
  required: boolean;
  order: number;
  minLength?: number;
  maxLength?: number;
}

export interface SectionValidationRule {
  field: string;
  required: boolean;
  type: 'text' | 'number' | 'table' | 'list' | 'metric';
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  expectedFormat?: string;
}

export interface TableStructure {
  id: string;
  title: string;
  columns: TableColumn[];
  required: boolean;
  minRows?: number;
  maxRows?: number;
}

export interface TableColumn {
  id: string;
  header: string;
  type: 'text' | 'number' | 'currency' | 'percentage' | 'date';
  required: boolean;
  format?: string;
}

// DEFINITIVE INVESTMENT REPORT SCHEMA v1.0
export const INVESTMENT_REPORT_SCHEMA: ReportSection[] = [
  {
    id: 'executive_summary',
    title: 'Executive Summary',
    required: true,
    order: 1,
    subsections: [
      {
        id: 'property_overview',
        title: 'Property Overview',
        required: true,
        order: 1,
        minLength: 100,
        maxLength: 300
      },
      {
        id: 'investment_highlights',
        title: 'Investment Highlights',
        required: true,
        order: 2,
        minLength: 150,
        maxLength: 400
      },
      {
        id: 'key_findings',
        title: 'Key Findings',
        required: true,
        order: 3,
        minLength: 100,
        maxLength: 300
      }
    ]
  },
  {
    id: 'property_details',
    title: 'Property Details',
    required: true,
    order: 2,
    validationRules: [
      { field: 'address', required: true, type: 'text', minLength: 10 },
      { field: 'property_type', required: true, type: 'text' },
      { field: 'land_size', required: true, type: 'number' },
      { field: 'building_size', required: true, type: 'number' },
      { field: 'bedrooms', required: true, type: 'number' },
      { field: 'bathrooms', required: true, type: 'number' },
      { field: 'parking', required: true, type: 'number' }
    ]
  },
  {
    id: 'market_analysis',
    title: 'Market Analysis',
    required: true,
    order: 3,
    subsections: [
      {
        id: 'suburb_overview',
        title: 'Suburb Overview',
        required: true,
        order: 1,
        minLength: 200
      },
      {
        id: 'market_kpis',
        title: 'Key Market Indicators',
        required: true,
        order: 2,
        minLength: 150
      },
      {
        id: 'price_trends',
        title: 'Price Trends',
        required: true,
        order: 3,
        minLength: 100
      },
      {
        id: 'rental_market',
        title: 'Rental Market',
        required: true,
        order: 4,
        minLength: 100
      }
    ]
  },
  {
    id: 'financial_analysis',
    title: 'Financial Analysis',
    required: true,
    order: 4,
    subsections: [
      {
        id: 'purchase_costs',
        title: 'Initial Purchase Costs',
        required: true,
        order: 1
      },
      {
        id: 'ongoing_costs',
        title: 'Ongoing Annual Costs',
        required: true,
        order: 2
      },
      {
        id: 'cash_flow_analysis',
        title: 'Cash Flow Analysis',
        required: true,
        order: 3
      },
      {
        id: 'return_metrics',
        title: 'Return on Investment Metrics',
        required: true,
        order: 4
      }
    ]
  },
  {
    id: 'location_intelligence',
    title: 'Location & Amenities',
    required: true,
    order: 5,
    subsections: [
      {
        id: 'transport_access',
        title: 'Transport & Accessibility',
        required: true,
        order: 1,
        minLength: 100
      },
      {
        id: 'schools_education',
        title: 'Schools & Education',
        required: true,
        order: 2,
        minLength: 100
      },
      {
        id: 'shopping_retail',
        title: 'Shopping & Retail',
        required: true,
        order: 3,
        minLength: 50
      },
      {
        id: 'healthcare',
        title: 'Healthcare Facilities',
        required: true,
        order: 4,
        minLength: 50
      },
      {
        id: 'recreation',
        title: 'Recreation & Lifestyle',
        required: true,
        order: 5,
        minLength: 50
      }
    ]
  },
  {
    id: 'demographics',
    title: 'Demographics & Economics',
    required: true,
    order: 6,
    subsections: [
      {
        id: 'population_profile',
        title: 'Population Profile',
        required: true,
        order: 1,
        minLength: 100
      },
      {
        id: 'employment',
        title: 'Employment & Income',
        required: true,
        order: 2,
        minLength: 100
      },
      {
        id: 'household_composition',
        title: 'Household Composition',
        required: true,
        order: 3,
        minLength: 80
      }
    ]
  },
  {
    id: 'risk_assessment',
    title: 'Risk Assessment',
    required: true,
    order: 7,
    subsections: [
      {
        id: 'natural_hazards',
        title: 'Natural Hazards',
        required: true,
        order: 1,
        minLength: 100
      },
      {
        id: 'market_risks',
        title: 'Market Risks',
        required: true,
        order: 2,
        minLength: 100
      },
      {
        id: 'financial_risks',
        title: 'Financial Risks',
        required: true,
        order: 3,
        minLength: 100
      }
    ]
  },
  {
    id: 'investment_score',
    title: 'Investment Score & Recommendation',
    required: true,
    order: 8,
    subsections: [
      {
        id: 'overall_score',
        title: 'Overall Investment Score',
        required: true,
        order: 1,
        minLength: 50
      },
      {
        id: 'score_breakdown',
        title: 'Score Breakdown',
        required: true,
        order: 2,
        minLength: 150
      },
      {
        id: 'swot_analysis',
        title: 'SWOT Analysis',
        required: true,
        order: 3,
        minLength: 200
      },
      {
        id: 'recommendation',
        title: 'Investment Recommendation',
        required: true,
        order: 4,
        minLength: 100
      }
    ]
  },
  {
    id: 'projections',
    title: '10-Year Financial Projections',
    required: true,
    order: 9,
    subsections: [
      {
        id: 'scenario_analysis',
        title: 'Scenario Analysis',
        required: true,
        order: 1,
        minLength: 100
      },
      {
        id: 'conservative_projection',
        title: 'Conservative Scenario',
        required: true,
        order: 2
      },
      {
        id: 'moderate_projection',
        title: 'Moderate Scenario',
        required: true,
        order: 3
      },
      {
        id: 'optimistic_projection',
        title: 'Optimistic Scenario',
        required: true,
        order: 4
      }
    ]
  },
  // REMOVED: Data Sources & Methodology section (no longer part of report structure)
  {
    id: 'disclaimer',
    title: 'Disclaimer',
    required: true,
    order: 11,
    subsections: [
      {
        id: 'disclaimer_content',
        title: 'Legal Disclaimer',
        required: true,
        order: 1,
        minLength: 200
      },
      {
        id: 'contact_info',
        title: 'Contact Information',
        required: true,
        order: 2,
        minLength: 50
      }
    ]
  }
];

// Required tables that must be present in reports
export const REQUIRED_TABLES: TableStructure[] = [
  {
    id: 'initial_costs',
    title: 'Initial Purchase Costs',
    required: true,
    columns: [
      { id: 'cost_item', header: 'Cost Item', type: 'text', required: true },
      { id: 'calculation', header: 'Calculation', type: 'text', required: false },
      { id: 'amount', header: 'Amount', type: 'currency', required: true, format: '$#,##0' }
    ],
    minRows: 5,
    maxRows: 15
  },
  {
    id: 'annual_costs',
    title: 'Annual Operating Costs',
    required: true,
    columns: [
      { id: 'cost_item', header: 'Cost Item', type: 'text', required: true },
      { id: 'calculation', header: 'Calculation', type: 'text', required: false },
      { id: 'amount', header: 'Amount', type: 'currency', required: true, format: '$#,##0' }
    ],
    minRows: 5,
    maxRows: 15
  },
  {
    id: 'cash_flow_scenarios',
    title: 'Cash Flow Scenarios',
    required: true,
    columns: [
      { id: 'scenario', header: 'Scenario', type: 'text', required: true },
      { id: 'deposit', header: 'Deposit', type: 'percentage', required: true, format: '0%' },
      { id: 'weekly_cashflow', header: 'Weekly Cash Flow', type: 'currency', required: true, format: '$#,##0' },
      { id: 'annual_cashflow', header: 'Annual Cash Flow', type: 'currency', required: true, format: '$#,##0' }
    ],
    minRows: 2,
    maxRows: 4
  }
];

// Schema version for tracking changes
export const SCHEMA_VERSION = '1.0.0';

// Helper function to get section by ID
export function getSectionById(sectionId: string): ReportSection | undefined {
  return INVESTMENT_REPORT_SCHEMA.find(s => s.id === sectionId);
}

// Helper function to get all required sections
export function getRequiredSections(): ReportSection[] {
  return INVESTMENT_REPORT_SCHEMA.filter(s => s.required);
}

// Helper function to validate section order
export function validateSectionOrder(sections: Array<{ id: string; order: number }>): boolean {
  const schema = INVESTMENT_REPORT_SCHEMA;
  
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const schemaSection = schema.find(s => s.id === section.id);
    
    if (!schemaSection) continue;
    
    if (section.order !== schemaSection.order) {
      return false;
    }
  }
  
  return true;
}
