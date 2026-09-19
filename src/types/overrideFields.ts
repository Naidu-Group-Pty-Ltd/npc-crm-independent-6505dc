// ============================================================
// UNIFIED OVERRIDE FIELD CONFIGURATION SYSTEM
// Used by both PreGenerationOverrides and ManualDataOverrideModal
// ============================================================

/**
 * Represents a single override field configuration
 */
export type BuildType = 'new_build' | 'existing_property' | 'land_only';

export interface OverrideFieldConfig {
  key: string;
  label: string;
  category: OverrideCategory;
  type: 'currency' | 'percentage' | 'number' | 'select' | 'toggle';
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  tooltip?: string;
  defaultValue?: string | number | boolean;
  options?: { value: string; label: string }[];
  // Visibility conditions - supports array for multiple build types
  showForBuildType?: BuildType | BuildType[] | 'both';
  showInPreGen?: boolean;
  showInManualOverride?: boolean;
  isCashFlowField?: boolean;
  // Computed/derived field indicator
  isComputed?: boolean;
  computeFrom?: string[];
  // Validation
  min?: number;
  max?: number;
}

/**
 * Categories for grouping override fields
 */
export type OverrideCategory = 
  | 'property'
  | 'zoning'
  | 'loan'
  | 'rental'
  | 'expenses_rates'
  | 'expenses_strata'
  | 'expenses_insurance'
  | 'expenses_management'
  | 'acquisition'
  | 'tax_growth'
  | 'construction';

/**
 * Unified override data structure used by both components
 */
export interface UnifiedOverrideData {
  // Build type
  buildType: BuildType;
  
  // Property Details
  purchasePrice?: number;
  propertyValue?: number;
  landPrice?: number;
  buildPrice?: number;
  carSpaces?: number;
  propertyType?: string;
  landSizeSqm?: number;
  buildSizeSqm?: number;
  
  // Loan & Deposit
  depositValue?: number;
  loanToValueRatio?: number;
  loanAmount?: number;
  interestRate?: number;
  loanTermYears?: number;
  loanType?: 'interest_only' | 'principal_interest';
  interestOnlyPeriodYears?: number;
  repaymentFrequency?: 'weekly' | 'fortnightly' | 'monthly';
  extraRepaymentPerMonth?: number;
  offsetBalance?: number;
  
  // Rental Income
  weeklyRent?: number;
  occupancyRate?: number;
  
  // Annual Expenses - Rates & Taxes
  councilRates?: number;
  waterRates?: number;
  landTax?: number;
  
  // Annual Expenses - Strata/Body Corp
  bodyCorporateFees?: number;
  strataAdminFund?: number;
  strataSinkingFund?: number;
  strataSpecialLevies?: number;
  
  // Annual Expenses - Insurance
  buildingLandlordInsurance?: number;
  
  // Annual Expenses - Management
  propertyManagementFees?: number;
  repairsMaintenance?: number;
  lettingFees?: number;
  
  // Acquisition Costs
  stampDuty?: number;
  solicitorFees?: number;
  agentFee?: number;
  isFirstHomeBuyer?: boolean;
  
  // Tax & Growth Settings
  capitalGrowth?: number;
  cpiGrowthRate?: number;
  depreciation?: number;
  taxRate?: number;
  marketValueNow?: number;
  
  // Construction (New Build Only)
  constructionDurationMonths?: number;
  constructionYear?: number;
  stageDepositPercent?: number;
  stageSlabPercent?: number;
  stageFramePercent?: number;
  stageLockupPercent?: number;
  stageFixingPercent?: number;
  stageCompletionPercent?: number;
  schedulePreset?: 'rapid' | 'even' | 'custom';
  customStageMonths?: { [stageIndex: number]: number };
  
  // Zoning Information
  zoningCode?: string;
  zoningDescription?: string;
  permittedUses?: string;
  developmentPotential?: string;
  zoningOverlays?: string;
  minimumLotSize?: number;
  maximumHeight?: number;
  floorSpaceRatio?: number;
}

/**
 * Master field configuration - single source of truth
 */
export const OVERRIDE_FIELD_CONFIG: OverrideFieldConfig[] = [
  // ===== PROPERTY DETAILS =====
  {
    key: 'buildType',
    label: 'Build Type',
    category: 'property',
    type: 'select',
    options: [
      { value: 'new_build', label: 'New Build' },
      { value: 'existing_property', label: 'Existing Property' },
      { value: 'land_only', label: 'Land Only' }
    ],
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true,
    defaultValue: 'existing_property'
  },
  {
    key: 'purchasePrice',
    label: 'Purchase Price',
    category: 'property',
    type: 'currency',
    prefix: '$',
    placeholder: '750,000',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'propertyValue',
    label: 'Property Value',
    category: 'property',
    type: 'currency',
    prefix: '$',
    placeholder: '800,000',
    tooltip: 'Current market value (may differ from purchase price)',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'landPrice',
    label: 'Land Price',
    category: 'property',
    type: 'currency',
    prefix: '$',
    placeholder: '350,000',
    showForBuildType: ['new_build', 'land_only'],
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'buildPrice',
    label: 'Build Price',
    category: 'property',
    type: 'currency',
    prefix: '$',
    placeholder: '400,000',
    showForBuildType: 'new_build',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'carSpaces',
    label: 'Car Spaces',
    category: 'property',
    type: 'number',
    placeholder: '2',
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'propertyType',
    label: 'Property Type',
    category: 'property',
    type: 'select',
    options: [
      { value: 'house', label: 'House' },
      { value: 'apartment', label: 'Apartment/Unit' },
      { value: 'townhouse', label: 'Townhouse' },
      { value: 'villa', label: 'Villa' },
      { value: 'land', label: 'Vacant Land' }
    ],
    defaultValue: 'house',
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'landSizeSqm',
    label: 'Land Size',
    category: 'property',
    type: 'number',
    suffix: 'sqm',
    placeholder: '450',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'buildSizeSqm',
    label: 'Build Size',
    category: 'property',
    type: 'number',
    suffix: 'sqm',
    placeholder: '180',
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  
  // ===== ZONING & PLANNING =====
  {
    key: 'zoningCode',
    label: 'Zoning Code',
    category: 'zoning',
    type: 'select',
    options: [
      { value: 'R1', label: 'R1 - General Residential' },
      { value: 'R2', label: 'R2 - Low Density Residential' },
      { value: 'R3', label: 'R3 - Medium Density Residential' },
      { value: 'R4', label: 'R4 - High Density Residential' },
      { value: 'R5', label: 'R5 - Large Lot Residential' },
      { value: 'RU1', label: 'RU1 - Primary Production' },
      { value: 'RU2', label: 'RU2 - Rural Landscape' },
      { value: 'RU5', label: 'RU5 - Village' },
      { value: 'B1', label: 'B1 - Neighbourhood Centre' },
      { value: 'B2', label: 'B2 - Local Centre' },
      { value: 'B4', label: 'B4 - Mixed Use' },
      { value: 'IN1', label: 'IN1 - General Industrial' },
      { value: 'IN2', label: 'IN2 - Light Industrial' },
      { value: 'SP1', label: 'SP1 - Special Activities' },
      { value: 'SP2', label: 'SP2 - Infrastructure' },
      { value: 'RE1', label: 'RE1 - Public Recreation' },
      { value: 'E1', label: 'E1 - National Parks' },
      { value: 'E2', label: 'E2 - Environmental Conservation' },
      { value: 'E3', label: 'E3 - Environmental Management' },
      { value: 'E4', label: 'E4 - Environmental Living' },
      { value: 'other', label: 'Other (Specify in Description)' }
    ],
    placeholder: 'Select zoning code',
    tooltip: 'Primary zoning classification for the property',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'zoningDescription',
    label: 'Zoning Description',
    category: 'zoning',
    type: 'select',
    options: [
      { value: 'residential', label: 'Residential' },
      { value: 'rural_residential', label: 'Rural Residential' },
      { value: 'commercial', label: 'Commercial' },
      { value: 'mixed_use', label: 'Mixed Use' },
      { value: 'industrial', label: 'Industrial' },
      { value: 'rural', label: 'Rural/Agricultural' },
      { value: 'environmental', label: 'Environmental' }
    ],
    placeholder: 'Select description',
    tooltip: 'General zoning category',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'permittedUses',
    label: 'Permitted Uses',
    category: 'zoning',
    type: 'select',
    options: [
      { value: 'dwelling_only', label: 'Dwelling House Only' },
      { value: 'dual_occupancy', label: 'Dual Occupancy Permitted' },
      { value: 'multi_dwelling', label: 'Multi-Dwelling Housing' },
      { value: 'attached_dwelling', label: 'Attached Dwelling' },
      { value: 'secondary_dwelling', label: 'Secondary Dwelling (Granny Flat)' },
      { value: 'home_business', label: 'Home Business' },
      { value: 'boarding_house', label: 'Boarding House' },
      { value: 'group_home', label: 'Group Home' },
      { value: 'childcare', label: 'Childcare Centre' },
      { value: 'mixed', label: 'Mixed Residential/Commercial' }
    ],
    placeholder: 'Select permitted uses',
    tooltip: 'Primary permitted land uses',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'developmentPotential',
    label: 'Development Potential',
    category: 'zoning',
    type: 'select',
    options: [
      { value: 'none', label: 'No Development Potential' },
      { value: 'subdivision', label: 'Subdivision Possible' },
      { value: 'dual_occ', label: 'Dual Occupancy Potential' },
      { value: 'townhouses', label: 'Townhouse Development' },
      { value: 'apartments', label: 'Apartment Development' },
      { value: 'granny_flat', label: 'Granny Flat Addition' },
      { value: 'mixed_use', label: 'Mixed Use Development' },
      { value: 'stca', label: 'STCA (Subject to Council Approval)' }
    ],
    placeholder: 'Select development potential',
    tooltip: 'Potential for future development',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'zoningOverlays',
    label: 'Planning Overlays',
    category: 'zoning',
    type: 'select',
    options: [
      { value: 'none', label: 'No Significant Overlays' },
      { value: 'heritage', label: 'Heritage Conservation' },
      { value: 'flood', label: 'Flood Planning Area' },
      { value: 'bushfire', label: 'Bushfire Prone Land' },
      { value: 'environmental', label: 'Environmental Protection' },
      { value: 'airport', label: 'Airport/Flight Path' },
      { value: 'acid_sulfate', label: 'Acid Sulfate Soils' },
      { value: 'coastal', label: 'Coastal Zone' },
      { value: 'contaminated', label: 'Contaminated Land' },
      { value: 'multiple', label: 'Multiple Overlays Apply' }
    ],
    placeholder: 'Select overlays',
    tooltip: 'Planning overlays that may restrict development',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'minimumLotSize',
    label: 'Minimum Lot Size',
    category: 'zoning',
    type: 'number',
    suffix: 'sqm',
    placeholder: '450',
    tooltip: 'Minimum lot size for subdivision',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'maximumHeight',
    label: 'Max Building Height',
    category: 'zoning',
    type: 'number',
    suffix: 'm',
    placeholder: '8.5',
    tooltip: 'Maximum building height allowed',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'floorSpaceRatio',
    label: 'Floor Space Ratio (FSR)',
    category: 'zoning',
    type: 'number',
    placeholder: '0.5',
    tooltip: 'Maximum floor space ratio (e.g., 0.5 = 50% of land area)',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  
  // ===== LOAN & DEPOSIT =====
  {
    key: 'depositValue',
    label: 'Deposit',
    category: 'loan',
    type: 'currency',
    prefix: '$',
    placeholder: 'Auto-calculated',
    tooltip: 'Auto-calculated from Purchase Price × (100% - LVR)',
    isComputed: true,
    computeFrom: ['purchasePrice', 'loanToValueRatio'],
    showForBuildType: ['existing_property', 'land_only'],
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'loanToValueRatio',
    label: 'LVR',
    category: 'loan',
    type: 'percentage',
    suffix: '%',
    placeholder: '80',
    defaultValue: '80',
    min: 0,
    max: 100,
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'loanAmount',
    label: 'Loan Amount Override',
    category: 'loan',
    type: 'currency',
    prefix: '$',
    placeholder: 'Auto-calculated',
    tooltip: 'Override calculated loan (Price × LVR)',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true,
    isCashFlowField: true
  },
  {
    key: 'interestRate',
    label: 'Interest Rate',
    category: 'loan',
    type: 'percentage',
    suffix: '%',
    placeholder: '6.5',
    defaultValue: '6.5',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'loanTermYears',
    label: 'Loan Term',
    category: 'loan',
    type: 'number',
    suffix: 'yrs',
    placeholder: '30',
    defaultValue: '30',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'loanType',
    label: 'Loan Type',
    category: 'loan',
    type: 'select',
    options: [
      { value: 'interest_only', label: 'Interest Only' },
      { value: 'principal_interest', label: 'Principal & Interest' }
    ],
    defaultValue: 'interest_only',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'interestOnlyPeriodYears',
    label: 'IO Period',
    category: 'loan',
    type: 'number',
    suffix: 'yrs',
    placeholder: '5',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true,
    isCashFlowField: true
  },
  {
    key: 'repaymentFrequency',
    label: 'Repayment Frequency',
    category: 'loan',
    type: 'select',
    options: [
      { value: 'weekly', label: 'Weekly' },
      { value: 'fortnightly', label: 'Fortnightly' },
      { value: 'monthly', label: 'Monthly' }
    ],
    defaultValue: 'monthly',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true,
    isCashFlowField: true
  },
  {
    key: 'extraRepaymentPerMonth',
    label: 'Extra Repayment /mo',
    category: 'loan',
    type: 'currency',
    prefix: '$',
    placeholder: '0',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true,
    isCashFlowField: true
  },
  {
    key: 'offsetBalance',
    label: 'Offset Balance',
    category: 'loan',
    type: 'currency',
    prefix: '$',
    placeholder: '0',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true,
    isCashFlowField: true
  },
  
  // ===== RENTAL INCOME =====
  {
    key: 'weeklyRent',
    label: 'Weekly Rent',
    category: 'rental',
    type: 'currency',
    prefix: '$',
    placeholder: '550',
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'occupancyRate',
    label: 'Occupancy',
    category: 'rental',
    type: 'number',
    suffix: 'weeks',
    placeholder: '52',
    defaultValue: '52',
    tooltip: 'Expected weeks of tenancy per year',
    min: 0,
    max: 52,
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  
  // ===== EXPENSES - RATES & TAXES =====
  {
    key: 'councilRates',
    label: 'Council Rates',
    category: 'expenses_rates',
    type: 'currency',
    prefix: '$',
    placeholder: '2,000',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'waterRates',
    label: 'Water Rates',
    category: 'expenses_rates',
    type: 'currency',
    prefix: '$',
    placeholder: '1,200',
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'landTax',
    label: 'Land Tax',
    category: 'expenses_rates',
    type: 'currency',
    prefix: '$',
    placeholder: '2,500',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  
  // ===== EXPENSES - STRATA/BODY CORP =====
  {
    key: 'bodyCorporateFees',
    label: 'Body Corporate / Strata Fees',
    category: 'expenses_strata',
    type: 'currency',
    prefix: '$',
    placeholder: '3,000',
    isComputed: true,
    computeFrom: ['strataAdminFund', 'strataSinkingFund', 'strataSpecialLevies'],
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'strataAdminFund',
    label: 'Admin Fund',
    category: 'expenses_strata',
    type: 'currency',
    prefix: '$',
    placeholder: '1,800',
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'strataSinkingFund',
    label: 'Sinking Fund',
    category: 'expenses_strata',
    type: 'currency',
    prefix: '$',
    placeholder: '900',
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'strataSpecialLevies',
    label: 'Special Levies',
    category: 'expenses_strata',
    type: 'currency',
    prefix: '$',
    placeholder: '300',
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  
  // ===== EXPENSES - INSURANCE =====
  {
    key: 'buildingLandlordInsurance',
    label: 'Building & Landlord Insurance',
    category: 'expenses_insurance',
    type: 'currency',
    prefix: '$',
    placeholder: '1,800',
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  
  // ===== EXPENSES - MANAGEMENT =====
  {
    key: 'propertyManagementFees',
    label: 'Property Management Fees',
    category: 'expenses_management',
    type: 'percentage',
    suffix: '%',
    placeholder: '8',
    defaultValue: '8',
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'repairsMaintenance',
    label: 'Repairs & Maintenance',
    category: 'expenses_management',
    type: 'currency',
    prefix: '$',
    placeholder: '2,000',
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'lettingFees',
    label: 'Letting Fees (1 Week Rent)',
    category: 'expenses_management',
    type: 'currency',
    prefix: '$',
    placeholder: '= Weekly Rent',
    tooltip: 'Usually 1 week\'s rent',
    isComputed: true,
    computeFrom: ['weeklyRent'],
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true
  },
  
  // ===== ACQUISITION COSTS =====
  {
    key: 'stampDuty',
    label: 'Stamp Duty',
    category: 'acquisition',
    type: 'currency',
    prefix: '$',
    placeholder: '25,000',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'solicitorFees',
    label: 'Solicitor Fees',
    category: 'acquisition',
    type: 'currency',
    prefix: '$',
    placeholder: '2,000',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'agentFee',
    label: 'Agent Fee',
    category: 'acquisition',
    type: 'currency',
    prefix: '$',
    placeholder: '15,000',
    showForBuildType: 'new_build',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'isFirstHomeBuyer',
    label: 'First Home Buyer',
    category: 'acquisition',
    type: 'toggle',
    tooltip: 'May qualify for stamp duty concessions',
    defaultValue: false,
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  
  // ===== TAX & GROWTH SETTINGS =====
  {
    key: 'capitalGrowth',
    label: 'Capital Growth',
    category: 'tax_growth',
    type: 'percentage',
    suffix: '%',
    placeholder: '5',
    defaultValue: '5',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'cpiGrowthRate',
    label: 'CPI Growth',
    category: 'tax_growth',
    type: 'percentage',
    suffix: '%',
    placeholder: '3',
    tooltip: 'Annual rate for rent/expense increases. Default: 3%',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true,
    isCashFlowField: true
  },
  {
    key: 'depreciation',
    label: 'Depreciation',
    category: 'tax_growth',
    type: 'currency',
    prefix: '$',
    placeholder: '6,000',
    tooltip: 'Year 1 depreciation deduction for tax',
    showForBuildType: ['new_build', 'existing_property'],
    showInPreGen: true,
    showInManualOverride: true,
    isCashFlowField: true
  },
  {
    key: 'taxRate',
    label: 'Tax Rate',
    category: 'tax_growth',
    type: 'percentage',
    suffix: '%',
    placeholder: '30',
    tooltip: 'Marginal tax rate for refund calculations. Default: 30%',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true,
    isCashFlowField: true
  },
  {
    key: 'marketValueNow',
    label: 'Market Value (Y0)',
    category: 'tax_growth',
    type: 'currency',
    prefix: '$',
    placeholder: '= Purchase Price',
    tooltip: 'Current value if different from purchase price',
    showForBuildType: 'both',
    showInPreGen: true,
    showInManualOverride: true,
    isCashFlowField: true
  },
  
  // ===== CONSTRUCTION (NEW BUILD ONLY) =====
  {
    key: 'constructionDurationMonths',
    label: 'Construction Duration',
    category: 'construction',
    type: 'number',
    suffix: 'months',
    placeholder: '12',
    showForBuildType: 'new_build',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'constructionYear',
    label: 'Construction Year',
    category: 'construction',
    type: 'number',
    placeholder: new Date().getFullYear().toString(),
    showForBuildType: 'new_build',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'stageDepositPercent',
    label: 'Deposit Stage',
    category: 'construction',
    type: 'percentage',
    suffix: '%',
    placeholder: '5',
    defaultValue: '5',
    showForBuildType: 'new_build',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'stageSlabPercent',
    label: 'Slab/Base Stage',
    category: 'construction',
    type: 'percentage',
    suffix: '%',
    placeholder: '15',
    defaultValue: '15',
    showForBuildType: 'new_build',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'stageFramePercent',
    label: 'Frame Stage',
    category: 'construction',
    type: 'percentage',
    suffix: '%',
    placeholder: '20',
    defaultValue: '20',
    showForBuildType: 'new_build',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'stageLockupPercent',
    label: 'Lock-up Stage',
    category: 'construction',
    type: 'percentage',
    suffix: '%',
    placeholder: '25',
    defaultValue: '25',
    showForBuildType: 'new_build',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'stageFixingPercent',
    label: 'Fixing Stage',
    category: 'construction',
    type: 'percentage',
    suffix: '%',
    placeholder: '20',
    defaultValue: '20',
    showForBuildType: 'new_build',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'stageCompletionPercent',
    label: 'Completion Stage',
    category: 'construction',
    type: 'percentage',
    suffix: '%',
    placeholder: '15',
    defaultValue: '15',
    showForBuildType: 'new_build',
    showInPreGen: true,
    showInManualOverride: true
  },
  {
    key: 'schedulePreset',
    label: 'Schedule Mode',
    category: 'construction',
    type: 'select',
    options: [
      { value: 'rapid', label: 'Rapid Build (Months 2-7)' },
      { value: 'even', label: 'Even Distribution' },
      { value: 'custom', label: 'Custom Positioning' }
    ],
    defaultValue: 'rapid',
    showForBuildType: 'new_build',
    showInPreGen: true,
    showInManualOverride: true
  }
];

/**
 * Helper function to get fields by category
 */
export function getFieldsByCategory(category: OverrideCategory): OverrideFieldConfig[] {
  return OVERRIDE_FIELD_CONFIG.filter(f => f.category === category);
}

/**
 * Helper function to get fields visible for a specific build type
 */
export function getFieldsForBuildType(
  buildType: BuildType,
  context: 'pregen' | 'manual'
): OverrideFieldConfig[] {
  return OVERRIDE_FIELD_CONFIG.filter(field => {
    // Handle array of build types, 'both', or single build type
    let buildTypeMatch = false;
    if (field.showForBuildType === 'both') {
      buildTypeMatch = true;
    } else if (Array.isArray(field.showForBuildType)) {
      buildTypeMatch = field.showForBuildType.includes(buildType);
    } else {
      buildTypeMatch = field.showForBuildType === buildType;
    }
    
    const contextMatch = context === 'pregen' 
      ? field.showInPreGen 
      : field.showInManualOverride;
    
    return buildTypeMatch && contextMatch;
  });
}

/**
 * Helper function to get a single field config by key
 */
export function getFieldConfig(key: string): OverrideFieldConfig | undefined {
  return OVERRIDE_FIELD_CONFIG.find(f => f.key === key);
}

/**
 * Get category display info
 */
export const CATEGORY_INFO: Record<OverrideCategory, { label: string; icon: string }> = {
  property: { label: 'Property Details', icon: 'Building2' },
  zoning: { label: 'Zoning & Planning', icon: 'Map' },
  loan: { label: 'Loan & Deposit', icon: 'Percent' },
  rental: { label: 'Rental Income', icon: 'TrendingUp' },
  expenses_rates: { label: 'Rates & Taxes', icon: 'DollarSign' },
  expenses_strata: { label: 'Strata / Body Corp', icon: 'Building2' },
  expenses_insurance: { label: 'Insurance', icon: 'Shield' },
  expenses_management: { label: 'Management', icon: 'Wrench' },
  acquisition: { label: 'Acquisition Costs', icon: 'Receipt' },
  tax_growth: { label: 'Tax & Growth', icon: 'TrendingUp' },
  construction: { label: 'Construction Schedule', icon: 'Building2' }
};
