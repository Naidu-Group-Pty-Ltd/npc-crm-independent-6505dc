import { PropertyListing } from '@/lib/airtable';

export interface DataValidationResult {
  isValid: boolean;
  issues: string[];
  warnings: string[];
  suggestions: string[];
}

export interface DataComparisonResult {
  dashboardCount: number;
  reportsCount: number;
  discrepancy: number;
  duplicatesFound: number;
  dataQualityScores: {
    dashboard: number;
    reports: number;
  };
  fieldComparison: Record<string, {
    dashboard: number;
    reports: number;
    match: boolean;
  }>;
}

/**
 * Utility functions for validating and comparing property data
 * to ensure consistency between dashboard and reports
 */
export class DataValidator {
  
  /**
   * Validate a single property listing
   */
  static validateListing(listing: PropertyListing): DataValidationResult {
    const issues: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Critical validation checks
    if (!listing.id) {
      issues.push('Missing listing ID');
    }

    if (!listing.price || listing.price <= 0) {
      issues.push('Invalid or missing price');
    } else if (listing.price > 50000000) {
      warnings.push('Price seems unusually high (>$50M)');
    }

    if (!listing.address && !listing.location) {
      issues.push('Missing address/location information');
    }

    if (!listing.suburb || listing.suburb === 'Unknown') {
      warnings.push('Missing or generic suburb information');
    }

    if (!listing.propertyType || listing.propertyType === 'Unknown') {
      warnings.push('Missing or generic property type');
    }

    // Data quality suggestions
    if (!listing.beds && !listing.bedrooms) {
      suggestions.push('Consider adding bedroom count for better classification');
    }

    if (!listing.baths && !listing.bathrooms) {
      suggestions.push('Consider adding bathroom count for better classification');
    }

    if (!listing.description || listing.description.length < 20) {
      suggestions.push('Consider adding more detailed property description');
    }

    if (!listing.agent && !listing.agentName) {
      suggestions.push('Consider adding agent information');
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings,
      suggestions
    };
  }

  /**
   * Validate an array of listings and return summary
   */
  static validateListingsArray(listings: PropertyListing[]): {
    totalListings: number;
    validListings: number;
    invalidListings: number;
    totalIssues: number;
    totalWarnings: number;
    commonIssues: Record<string, number>;
    dataCompleteness: number;
  } {
    let validCount = 0;
    let totalIssues = 0;
    let totalWarnings = 0;
    const issueTracker: Record<string, number> = {};

    let completenessScore = 0;

    listings.forEach(listing => {
      const validation = this.validateListing(listing);
      
      if (validation.isValid) {
        validCount++;
      }

      totalIssues += validation.issues.length;
      totalWarnings += validation.warnings.length;

      // Track common issues
      validation.issues.forEach(issue => {
        issueTracker[issue] = (issueTracker[issue] || 0) + 1;
      });

      // Calculate completeness score for this listing
      const fields = ['price', 'address', 'suburb', 'propertyType', 'beds', 'baths', 'agent', 'description'];
      let filledFields = 0;
      
      fields.forEach(field => {
        const value = (listing as any)[field] || (listing as any)[field + 's'] || (listing as any)[field + 'Name'];
        if (value !== null && value !== undefined && value !== '' && value !== 'Unknown') {
          filledFields++;
        }
      });
      
      completenessScore += (filledFields / fields.length) * 100;
    });

    return {
      totalListings: listings.length,
      validListings: validCount,
      invalidListings: listings.length - validCount,
      totalIssues,
      totalWarnings,
      commonIssues: issueTracker,
      dataCompleteness: listings.length > 0 ? completenessScore / listings.length : 0
    };
  }

  /**
   * Compare data between dashboard and reports to detect discrepancies
   */
  static compareDataSets(
    dashboardData: PropertyListing[], 
    reportsData: PropertyListing[]
  ): DataComparisonResult {
    const dashboardValidation = this.validateListingsArray(dashboardData);
    const reportsValidation = this.validateListingsArray(reportsData);

    // Check for duplicates within each dataset
    const dashboardIds = new Set(dashboardData.map(l => l.id));
    const reportsIds = new Set(reportsData.map(l => l.id));
    
    const dashboardDuplicates = dashboardData.length - dashboardIds.size;
    const reportsDuplicates = reportsData.length - reportsIds.size;

    // Check field completeness comparison
    const fieldComparison: Record<string, { dashboard: number; reports: number; match: boolean }> = {};
    
    const fieldsToCompare = ['price', 'address', 'suburb', 'propertyType', 'beds', 'baths'];
    
    fieldsToCompare.forEach(field => {
      const dashboardCount = dashboardData.filter(l => (l as any)[field] && (l as any)[field] !== 'Unknown').length;
      const reportsCount = reportsData.filter(l => (l as any)[field] && (l as any)[field] !== 'Unknown').length;
      
      fieldComparison[field] = {
        dashboard: dashboardCount,
        reports: reportsCount,
        match: Math.abs(dashboardCount - reportsCount) <= 1 // Allow small differences
      };
    });

    return {
      dashboardCount: dashboardData.length,
      reportsCount: reportsData.length,
      discrepancy: Math.abs(dashboardData.length - reportsData.length),
      duplicatesFound: dashboardDuplicates + reportsDuplicates,
      dataQualityScores: {
        dashboard: dashboardValidation.dataCompleteness,
        reports: reportsValidation.dataCompleteness
      },
      fieldComparison
    };
  }

  /**
   * Generate a comprehensive data quality report
   */
  static generateDataQualityReport(listings: PropertyListing[]): {
    summary: string;
    score: number;
    recommendations: string[];
    details: any;
  } {
    const validation = this.validateListingsArray(listings);
    const score = Math.max(0, 100 - (validation.totalIssues * 10) - (validation.totalWarnings * 2));

    const recommendations: string[] = [];

    if (validation.invalidListings > validation.totalListings * 0.1) {
      recommendations.push(`High number of invalid listings (${validation.invalidListings}). Review data quality at source.`);
    }

    if (validation.dataCompleteness < 70) {
      recommendations.push(`Low data completeness (${validation.dataCompleteness.toFixed(1)}%). Focus on collecting missing fields.`);
    }

    Object.entries(validation.commonIssues).forEach(([issue, count]) => {
      if (count > validation.totalListings * 0.2) {
        recommendations.push(`Common issue affects ${count} listings: ${issue}`);
      }
    });

    const summary = `Data quality score: ${score.toFixed(1)}/100. ${validation.validListings}/${validation.totalListings} listings are valid. ${validation.dataCompleteness.toFixed(1)}% field completeness.`;

    return {
      summary,
      score,
      recommendations,
      details: validation
    };
  }
}

/**
 * Helper function to log data comparison results
 */
export function logDataComparison(comparison: DataComparisonResult): void {
  console.group('📊 Data Comparison Results');
  
  console.log(`Dashboard listings: ${comparison.dashboardCount}`);
  console.log(`Reports listings: ${comparison.reportsCount}`);
  console.log(`Discrepancy: ${comparison.discrepancy} listings`);
  console.log(`Duplicates found: ${comparison.duplicatesFound}`);
  
  console.log('Data Quality Scores:');
  console.log(`  Dashboard: ${comparison.dataQualityScores.dashboard.toFixed(1)}%`);
  console.log(`  Reports: ${comparison.dataQualityScores.reports.toFixed(1)}%`);
  
  console.log('Field Completeness Comparison:');
  Object.entries(comparison.fieldComparison).forEach(([field, data]) => {
    const status = data.match ? '✅' : '❌';
    console.log(`  ${field}: ${data.dashboard} vs ${data.reports} ${status}`);
  });
  
  if (comparison.discrepancy > 0) {
    console.warn(`⚠️ Significant discrepancy detected: ${comparison.discrepancy} listings difference`);
  }
  
  const mismatchedFields = Object.entries(comparison.fieldComparison)
    .filter(([, data]) => !data.match)
    .map(([field]) => field);
    
  if (mismatchedFields.length > 0) {
    console.warn(`⚠️ Field mismatches detected in: ${mismatchedFields.join(', ')}`);
  }
  
  console.groupEnd();
}