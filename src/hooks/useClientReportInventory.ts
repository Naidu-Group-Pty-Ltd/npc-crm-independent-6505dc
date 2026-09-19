import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useAuth } from '@/hooks/useAuth';
import {
  buildClientReportInventory,
  publishedFileIndex,
  type UnifiedReport,
} from '@/lib/reports/clientReportInventory.pure';

/**
 * Every report that exists for a client, from the five places they live.
 *
 * This is `ClientReportsTab`'s own set of queries, lifted out so the Sent
 * Reports tab can offer the same reports for publishing without assembling a
 * second list beside it. The queries and their keys are unchanged, so both
 * tabs share one cache: opening the publish picker after looking at Reports
 * costs no round trip, and publishing from either invalidates the same keys.
 *
 * `properties` is only needed for the investment reports, which are found by
 * the client's property ids rather than by the client. A caller that has no
 * properties to hand still gets the other four sources.
 */
export interface ClientReportInventory {
  reports: UnifiedReport[];
  /** The stored files the portal already holds, by resolved bucket and key. */
  publishedFiles: Map<string, string | null>;
  isLoading: boolean;
  portalReports: any[];
}

export function useClientReportInventory(
  clientId: string,
  propertyIds: string[] = [],
): ClientReportInventory {
  const { user, loading: authLoading } = useAuth();
  const canFetchReports = !authLoading && !!user;

  const { data: reportFiles = [], isLoading: filesLoading } = useQuery({
    queryKey: ['client-report-files', clientId],
    enabled: canFetchReports,
    retry: false,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        clientId,
        include: { files: true },
      });
      if (error || !data?.success) {
        console.warn('[useClientReportInventory] Failed to fetch client files:', error?.message || 'unknown error');
        return [];
      }
      return (data.files || []).filter((f: any) => f.is_formara_form || f.report_type);
    },
  });

  const { data: investmentReports = [] } = useQuery({
    queryKey: ['client-investment-reports', clientId, propertyIds],
    enabled: canFetchReports && propertyIds.length > 0,
    retry: false,
    queryFn: async () => {
      if (propertyIds.length === 0) return [];
      const { data, error } = await invokeSecureFunction('get-investment-reports', {
        listMode: true,
        listOptions: {
          isClientReport: true,
          clientPropertyIds: propertyIds,
          select: 'id,property_address,status,created_at,client_property_id',
          orderBy: 'created_at',
          orderAsc: false,
        },
      });
      if (error) {
        console.warn('[useClientReportInventory] Failed to fetch investment reports:', error.message);
        return [];
      }
      return data?.reports || [];
    },
  });

  const { data: bcAssessments = [] } = useQuery({
    queryKey: ['client-bc-assessments', clientId],
    enabled: canFetchReports,
    retry: false,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'borrowing_capacity_assessments',
          select: 'id,created_at,borrowing_capacity,serviceability_band,updated_at',
          orderBy: 'created_at',
          order_asc: false,
          filters: { client_id: clientId },
        },
      });
      if (error) {
        console.warn('[useClientReportInventory] Failed to fetch BC assessments:', error.message);
        return [] as any[];
      }
      return (data?.records || []) as any[];
    },
  });

  const { data: portfolioReports = [], isLoading: portfolioLoading } = useQuery({
    queryKey: ['portfolio-analysis-reports', clientId],
    enabled: canFetchReports,
    retry: false,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'portfolio_analysis_reports',
          select: '*',
          orderBy: 'created_at',
          order_asc: false,
          filters: { client_id: clientId },
        },
      });
      if (error) {
        console.warn('[useClientReportInventory] Failed to fetch portfolio reports:', error.message);
        return [] as any[];
      }
      return (data?.records || []) as any[];
    },
  });

  const { data: portalReports = [] } = useQuery({
    queryKey: ['client-portal-reports-unified', clientId],
    enabled: canFetchReports,
    retry: false,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'client_portal_reports',
          select: '*',
          filters: { client_id: clientId },
          orderBy: 'published_at',
          order_asc: false,
        },
      });
      if (error) {
        console.warn('[useClientReportInventory] Failed to fetch portal reports:', error.message);
        return [] as any[];
      }
      return (data?.records || []) as any[];
    },
  });

  const reports = useMemo(
    () =>
      buildClientReportInventory(
        { reportFiles, investmentReports, portfolioReports, bcAssessments, portalReports },
        (iso) => format(new Date(iso), 'dd MMM yyyy'),
      ),
    [reportFiles, investmentReports, portfolioReports, bcAssessments, portalReports],
  );

  const publishedFiles = useMemo(() => publishedFileIndex(portalReports), [portalReports]);

  return {
    reports,
    publishedFiles,
    isLoading: filesLoading || portfolioLoading,
    portalReports,
  };
}

/** The query keys a publish invalidates, named once so no caller forgets one. */
export const CLIENT_REPORT_INVENTORY_KEYS = (clientId: string) => [
  ['client-portal-reports', clientId],
  ['client-portal-reports-unified', clientId],
];
