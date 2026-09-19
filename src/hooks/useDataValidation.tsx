import { useState, useEffect, useCallback } from 'react';
import { PropertyListing } from '@/lib/airtable';
import { DataValidator, DataComparisonResult } from '@/utils/dataValidation';
import { propertyDataService } from '@/services/propertyDataService';

export interface DataValidationState {
  isValidating: boolean;
  comparison: DataComparisonResult | null;
  lastValidation: Date | null;
  error: string | null;
}

export function useDataValidation(
  dashboardData?: PropertyListing[],
  reportsData?: PropertyListing[]
) {
  const [state, setState] = useState<DataValidationState>({
    isValidating: false,
    comparison: null,
    lastValidation: null,
    error: null,
  });

  const runValidation = useCallback(async () => {
    setState(prev => ({ ...prev, isValidating: true, error: null }));
    
    try {
      let dashboard = dashboardData;
      let reports = reportsData;

      // If no data provided, fetch fresh data
      if (!dashboard || !reports) {
        const [dashResult, reportsResult] = await Promise.all([
          propertyDataService.fetchAllListings({ maxRecords: 100 }),
          propertyDataService.fetchAllListings()
        ]);
        
        dashboard = dashResult.listings;
        reports = reportsResult.listings;
      }

      const comparison = DataValidator.compareDataSets(dashboard, reports);
      
      setState(prev => ({
        ...prev,
        comparison,
        lastValidation: new Date(),
        isValidating: false,
      }));

      console.log('Data Validation Results:', comparison);
      return comparison;
    } catch (error) {
      console.error('Data validation failed:', error);
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Validation failed',
        isValidating: false,
      }));
      return null;
    }
  }, [dashboardData, reportsData]);

  const clearValidation = useCallback(() => {
    setState({
      isValidating: false,
      comparison: null,
      lastValidation: null,
      error: null,
    });
  }, []);

  return {
    ...state,
    runValidation,
    clearValidation,
  };
}