import { invokeSecureFunction } from '@/lib/secureInvoke';

/**
 * Shared utility to fetch the latest borrowing capacity assessment for a client.
 * Uses the secure edge function mediation pattern (HttpOnly cookies + service_role).
 * 
 * Used by:
 * - FormaraPDFGenerator (Client Finance Form)
 * - PortfolioAnalysisPDFGenerator (PPR) — when needing standalone fetch
 * - BorrowingCapacityPDFReport (Standalone BC PDF)
 * - Any future generator that needs BC assessment data
 */
export async function fetchLatestBorrowingCapacity(clientId: string) {
  const { data, error } = await invokeSecureFunction('get-client-data', {
    clientId,
    include: {
      borrowingCapacity: true,
      incomeSources: true,
      liabilities: true,
      expenses: true,
      properties: true,
      client: true,
    },
  });

  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error('Failed to fetch borrowing capacity data');

  const assessments = data.borrowingCapacity || [];
  
  return {
    /** The most recent assessment record, or null if none exist */
    latestAssessment: assessments.length > 0 ? assessments[0] : null,
    /** Up to 10 historical assessments (newest first) */
    assessmentHistory: assessments.slice(0, 10),
    /** Supporting data for rich PDF rendering */
    incomeSources: data.incomeSources || [],
    liabilities: data.liabilities || [],
    expenses: data.expenses || [],
    properties: data.properties || [],
    client: data.client || null,
  };
}
