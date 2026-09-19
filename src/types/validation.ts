// Phase 1: Validation and Property Specs Types

export interface PropertySpecs {
  land_size_sqm?: number | null;
  building_size_sqm?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  parking?: number | null;
  year_built?: number | null;
  property_type?: 'house' | 'unit' | 'townhouse' | 'apartment' | null;
  zoning?: string | null;
  council_area?: string | null;
}

export interface ValidationFlag {
  type: 'warning' | 'error' | 'info';
  severity: 'critical' | 'high' | 'medium' | 'low';
  field: string;
  message: string;
  value: number | string;
  expected_range?: string;
  recommendation?: string;
}

export interface DataSource {
  source: string;
  confidence: number; // 0.0 - 1.0
  timestamp: string;
}

export interface DataSources {
  demographics?: DataSource | null;
  financials?: DataSource | null;
  marketData?: DataSource | null;
  locationIntelligence?: DataSource | null;
  [key: string]: DataSource | null | undefined;
}

export interface ValidationResult {
  isValid: boolean;
  flags: ValidationFlag[];
  qualityScore: number; // 0-100
}

export interface EnhancedInvestmentReport {
  id: string;
  property_address: string;
  report_content: string;
  property_specs?: PropertySpecs;
  validation_flags?: ValidationFlag[];
  calculation_version?: string;
  data_sources?: DataSources;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
}

// Helper function to check if property specs are complete
export function arePropertySpecsComplete(specs: PropertySpecs | null | undefined): boolean {
  if (!specs) return false;
  
  const requiredFields: (keyof PropertySpecs)[] = [
    'land_size_sqm',
    'building_size_sqm',
    'bedrooms',
    'bathrooms',
    'property_type'
  ];
  
  return requiredFields.every(field => {
    const value = specs[field];
    return value !== null && value !== undefined && value !== '';
  });
}

// Helper function to get validation severity color
export function getValidationSeverityColor(severity: ValidationFlag['severity']): string {
  switch (severity) {
    case 'critical':
      return 'destructive';
    case 'high':
      return 'destructive';
    case 'medium':
      return 'warning';
    case 'low':
      return 'secondary';
    default:
      return 'secondary';
  }
}

// Helper function to get validation type icon
export function getValidationTypeIcon(type: ValidationFlag['type']): string {
  switch (type) {
    case 'error':
      return '⛔';
    case 'warning':
      return '⚠️';
    case 'info':
      return 'ℹ️';
    default:
      return '';
  }
}

// Helper function to calculate data quality score from sources
export function calculateOverallDataQuality(sources: DataSources | null | undefined): number {
  if (!sources) return 0;
  
  const sourceEntries = Object.values(sources).filter((s): s is DataSource => s !== null && s !== undefined);
  
  if (sourceEntries.length === 0) return 0;
  
  const avgConfidence = sourceEntries.reduce((sum, source) => sum + source.confidence, 0) / sourceEntries.length;
  
  return Math.round(avgConfidence * 100);
}
