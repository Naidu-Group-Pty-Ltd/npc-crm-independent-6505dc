import { useState, useCallback } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface ListOptions {
  select?: string;
  status?: string | string[];
  isArchived?: boolean;
  isClientReport?: boolean | null;
  clientPropertyId?: string;
  clientPropertyIds?: string[];
  orderBy?: string;
  orderAsc?: boolean;
  limit?: number;
  createdAfter?: string;
}

interface InvestmentReport {
  id: string;
  property_address: string;
  property_listing_id: string | null;
  report_content?: string;
  sources_content?: string | null;
  created_at: string;
  current_version?: number;
  report_scope?: string;
  report_tier?: 'compass' | 'briefing' | 'snapshot';
  parent_report_id?: string | null;
  status?: string;
  is_archived?: boolean;
  manual_overrides?: any;
  financial_calculations?: any;
  demographics_data?: any;
  economic_data?: any;
  investment_score?: any;
  location_intelligence?: any;
  is_client_report?: boolean;
  client_property_id?: string;
  [key: string]: any;
}

export function useSecureInvestmentReports() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch a single report by ID
  const fetchReport = useCallback(async (reportId: string): Promise<InvestmentReport | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const { data, error: fnError } = await invokeSecureFunction('get-investment-reports', {
        reportId
      });

      if (!fnError && data?.success && data?.report) {
        return data.report;
      }
      
      console.error('Failed to fetch report:', fnError?.message || data?.error);
      setError(fnError?.message || data?.error || 'Failed to fetch report');
      return null;
    } catch (err: any) {
      console.error('Error fetching report:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch multiple reports by IDs
  const fetchReportsByIds = useCallback(async (reportIds: string[]): Promise<InvestmentReport[]> => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await invokeSecureFunction('get-investment-reports', {
        reportIds
      });

      if (!fnError && data?.success && data?.reports) {
        return data.reports;
      }
      
      console.error('Failed to fetch reports:', fnError?.message || data?.error);
      setError(fnError?.message || data?.error || 'Failed to fetch reports');
      return [];
    } catch (err: any) {
      console.error('Error fetching reports:', err);
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // List reports with filters
  const listReports = useCallback(async (options: ListOptions = {}): Promise<InvestmentReport[]> => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await invokeSecureFunction('get-investment-reports', {
        listMode: true, listOptions: options
      });

      if (!fnError && data?.success && data?.reports) {
        return data.reports;
      }
      
      console.error('Failed to list reports:', fnError?.message || data?.error);
      setError(fnError?.message || data?.error || 'Failed to list reports');
      return [];
    } catch (err: any) {
      console.error('Error listing reports:', err);
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Insert a new report
  const insertReport = useCallback(async (reportData: Partial<InvestmentReport>): Promise<InvestmentReport | null> => {
    setLoading(true);
    setError(null);

    try {
      const { data: result, error: fnError } = await invokeSecureFunction('manage-investment-reports', {
        action: 'insert', data: reportData
      });

      if (!fnError && result?.success && result?.report) {
        return result.report;
      }
      
      console.error('Failed to insert report:', fnError?.message || result?.error);
      setError(fnError?.message || result?.error || 'Failed to insert report');
      return null;
    } catch (err: any) {
      console.error('Error inserting report:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Update a report
  const updateReport = useCallback(async (reportId: string, reportData: Partial<InvestmentReport>): Promise<InvestmentReport | null> => {
    setLoading(true);
    setError(null);

    try {
      const { data: result, error: fnError } = await invokeSecureFunction('manage-investment-reports', {
        action: 'update', reportId, data: reportData
      });

      if (!fnError && result?.success && result?.report) {
        return result.report;
      }
      
      console.error('Failed to update report:', fnError?.message || result?.error);
      setError(fnError?.message || result?.error || 'Failed to update report');
      return null;
    } catch (err: any) {
      console.error('Error updating report:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Delete a report
  const deleteReport = useCallback(async (reportId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const { data: result, error: fnError } = await invokeSecureFunction('manage-investment-reports', {
        action: 'delete', reportId
      });

      if (!fnError && result?.success) {
        return true;
      }
      
      console.error('Failed to delete report:', fnError?.message || result?.error);
      setError(fnError?.message || result?.error || 'Failed to delete report');
      return false;
    } catch (err: any) {
      console.error('Error deleting report:', err);
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // Archive/unarchive a report
  const toggleArchive = useCallback(async (reportId: string, archive: boolean): Promise<InvestmentReport | null> => {
    setLoading(true);
    setError(null);

    try {
      const { data: result, error: fnError } = await invokeSecureFunction('manage-investment-reports', {
        action: archive ? 'archive' : 'unarchive', reportId
      });

      if (!fnError && result?.success && result?.report) {
        return result.report;
      }
      
      console.error('Failed to toggle archive:', fnError?.message || result?.error);
      setError(fnError?.message || result?.error || 'Failed to toggle archive');
      return null;
    } catch (err: any) {
      console.error('Error toggling archive:', err);
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Bulk delete reports by status
  const bulkDeleteByStatus = useCallback(async (statusFilter: string[]): Promise<number> => {
    setLoading(true);
    setError(null);

    try {
      const { data: result, error: fnError } = await invokeSecureFunction('manage-investment-reports', {
        action: 'bulkDelete', reportIds: [], data: { statusFilter }
      });

      if (!fnError && result?.success) {
        return result.deletedCount || 0;
      }
      
      console.error('Failed to bulk delete:', fnError?.message || result?.error);
      setError(fnError?.message || result?.error || 'Failed to bulk delete');
      return 0;
    } catch (err: any) {
      console.error('Error in bulk delete:', err);
      setError(err.message);
      return 0;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    error,
    fetchReport,
    fetchReportsByIds,
    listReports,
    insertReport,
    updateReport,
    deleteReport,
    toggleArchive,
    bulkDeleteByStatus
  };
}
