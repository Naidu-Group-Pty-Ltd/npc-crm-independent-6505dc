import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Calculator, LineChart } from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { CashFlowAnalysisModal } from '@/components/reports/CashFlowAnalysisModal';
import {
  CASH_FLOW_ANALYSIS_BACK_LABEL,
  navigateBackToCashFlowAnalysis,
} from '@/lib/navigation/cashFlowOrigin';
import type { InvestmentReport } from '@/components/cash-flow/types';

/**
 * The 10-Year Cash Flow workspace as a routed page.
 *
 * It used to be a dialog opened over the property list, which made the deepest
 * surface in the module the one thing with no address, no back button and no
 * browser history. This route drills into a single property the same way
 * "View Report" does, and the workspace itself is unchanged — the same
 * `CashFlowAnalysisModal`, asked for its page presentation.
 */

/** Everything the workspace binds. Kept verbatim from the list's old fetch. */
const FULL_REPORT_SELECT =
  'id, property_address, property_listing_id, report_content, created_at, current_version, report_scope, status, manual_overrides, financial_calculations, demographics_data, economic_data, investment_score, location_intelligence';

export default function CashFlowAnalysisDetail() {
  useModulePermissions('cash_flow');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  const [report, setReport] = useState<InvestmentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loggedReportId = useRef<string | null>(null);

  const fetchReport = useCallback(async (reportId: string) => {
    const { data, error: fetchError } = await invokeSecureFunction('get-investment-reports', {
      reportId,
      listOptions: { select: FULL_REPORT_SELECT },
    });
    if (fetchError) throw new Error(fetchError.message);
    return (data?.report ?? null) as InvestmentReport | null;
  }, []);

  useEffect(() => {
    if (!id) {
      setError('No report was specified.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchReport(id)
      .then((fullReport) => {
        if (cancelled) return;
        if (!fullReport) {
          setError('This report could not be found. It may have been archived or deleted.');
          return;
        }
        setReport(fullReport);
        // The list logged this on click; the route logs it on arrival so a
        // deep link, a refresh and a bookmark all record the same thing once.
        if (loggedReportId.current !== fullReport.id) {
          loggedReportId.current = fullReport.id;
          logActivityDirect({
            actionType: 'cash_flow_created',
            entityType: 'cash_flow_analysis',
            entityId: fullReport.id,
            entityName: fullReport.property_address,
            metadata: { action: 'view_analysis' },
          });
        }
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.error('Error loading full report:', err);
        setError('Failed to load full report data.');
        toast({
          title: 'Error',
          description: 'Failed to load full report data',
          variant: 'destructive',
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [id, fetchReport, toast]);

  /**
   * The route back: pop when the property list is demonstrably the previous
   * entry, address it by path otherwise. See `navigateBackToCashFlowAnalysis`.
   */
  const backToList = useCallback(() => {
    navigateBackToCashFlowAnalysis(navigate, location);
  }, [navigate, location]);

  const handleReportUpdated = useCallback(() => {
    if (!id) return;
    fetchReport(id)
      .then((fresh) => { if (fresh) setReport(fresh); })
      .catch((err: any) => console.error('Error refreshing report:', err));
  }, [id, fetchReport]);

  if (loading) {
    return <CashFlowDetailLoading onBack={backToList} />;
  }

  if (error || !report) {
    return <CashFlowDetailError message={error} onBack={backToList} />;
  }

  return (
    <div className="flex min-w-0 flex-col p-4 md:p-6">
      <CashFlowAnalysisModal
        report={report}
        isOpen
        presentation="page"
        backLabel={CASH_FLOW_ANALYSIS_BACK_LABEL}
        onClose={backToList}
        onReportUpdated={handleReportUpdated}
      />
    </div>
  );
}

function BackRail({ onBack }: { onBack: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onBack}
      className="-ml-2 min-h-9 self-start rounded-xl px-2 text-muted-foreground hover:text-foreground sm:px-3"
    >
      <ArrowLeft className="mr-2 h-4 w-4" />
      {CASH_FLOW_ANALYSIS_BACK_LABEL}
    </Button>
  );
}

function CashFlowDetailLoading({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <BackRail onBack={onBack} />

      <Card className="overflow-hidden border-primary/10 bg-primary/5">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-primary/10 p-3">
              <Calculator className="h-5 w-5 animate-pulse text-primary" />
            </div>
            <div>
              <p className="font-semibold">Opening the 10-year cash flow</p>
              <p className="text-sm text-muted-foreground">
                Loading assumptions, overrides and ten years of projections…
              </p>
            </div>
          </div>
          <LineChart className="hidden h-6 w-6 animate-pulse text-primary/60 sm:block" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-2xl" />
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}

function CashFlowDetailError({ message, onBack }: { message: string | null; onBack: () => void }) {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <BackRail onBack={onBack} />

      <Card className="overflow-hidden border-dashed py-12">
        <CardContent className="flex flex-col items-center justify-center px-6 text-center">
          <div className="mb-4 rounded-3xl bg-destructive/10 p-4 text-destructive">
            <AlertTriangle className="h-10 w-10" />
          </div>
          <div className="max-w-xl space-y-2">
            <h1 className="text-xl font-semibold">Cash flow unavailable</h1>
            <p className="text-muted-foreground">
              {message || 'This cash-flow analysis could not be opened.'}
            </p>
          </div>
          {/* Never a dead end: the way back is offered here too. */}
          <Button onClick={onBack} className="mt-6 min-h-10 rounded-xl">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {CASH_FLOW_ANALYSIS_BACK_LABEL}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
