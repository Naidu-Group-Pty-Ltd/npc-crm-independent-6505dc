import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import type { Json } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PreGenerationOverrides, PreGenerationData } from '@/components/reports/PreGenerationOverrides';
import { ManualDataOverrideModal } from '@/components/reports/ManualDataOverrideModal';
import { CashFlowAnalysisModal } from '@/components/reports/CashFlowAnalysisModal';
import { RegenerateReportButton } from '@/components/reports/RegenerateReportButton';
import { ReportVersionHistory } from '@/components/reports/ReportVersionHistory';
import { ComparisonViewer } from '@/components/reports/ComparisonViewer';
import { deliverInvestmentPdf } from '@/lib/reports/investment/deliverInvestmentPdf';
import { ReportTemplateSelector } from '@/components/reports/ReportTemplateSelector';
import { INVESTMENT_REPORT_FORMAT } from '@/lib/reportTemplate/reportFormats';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/contexts/NotificationsContext';
import { addBackgroundJob } from '@/components/BackgroundJobTracker';
import {
  FileText,
  Loader2,
  ChevronDown,
  Eye,
  Plus,
  Clock,
  CheckCircle2,
  AlertCircle,
  Settings,
  Trash2,
  Calculator,
  Download,
  RefreshCw,
  History,
  GitCompare,
} from 'lucide-react';
import { format } from 'date-fns';

interface InvestmentReportData {
  id: string;
  property_address: string;
  status: string;
  created_at: string;
  report_content: string;
  manual_overrides?: any;
  financial_calculations?: any;
  demographics_data?: any;
  economic_data?: any;
  investment_score?: any;
  location_intelligence?: any;
  current_version?: number;
  report_variant?: string | null;
}

interface ClientPropertyInvestmentReportProps {
  property: {
    id: string;
    address: string;
    property_type: string;
    value: number | null;
    loan_remaining: number | null;
    interest_rate: number | null;
    monthly_rental_income: number | null;
    total_monthly_expenditure: number | null;
    monthly_council_rates: number | null;
    monthly_water_rates: number | null;
    monthly_body_corporate: number | null;
    monthly_building_insurance: number | null;
    monthly_landlord_insurance: number | null;
    monthly_property_management: number | null;
    monthly_repairs_maintenance: number | null;
    weekly_rental_income: number | null;
  };
  clientId: string;
  clientName: string;
  onReportsChange?: (reports: InvestmentReportData[]) => void;
  selectedReportIds?: string[];
  onSelectReport?: (reportId: string, selected: boolean) => void;
  comparisonMode?: boolean;
}

export function ClientPropertyInvestmentReport({
  property,
  clientId,
  clientName,
  onReportsChange,
  selectedReportIds = [],
  onSelectReport,
  comparisonMode = false,
}: ClientPropertyInvestmentReportProps) {
  const [isOverrideSheetOpen, setIsOverrideSheetOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [preGenData, setPreGenData] = useState<PreGenerationData>({
    buildType: 'existing_property',
  });

  // Modal states for post-generation actions
  const [selectedReportForOverride, setSelectedReportForOverride] = useState<InvestmentReportData | null>(null);
  const [selectedReportForCashFlow, setSelectedReportForCashFlow] = useState<InvestmentReportData | null>(null);
  const [selectedReportForPDF, setSelectedReportForPDF] = useState<InvestmentReportData | null>(null);
  const [isDownloadingUnifiedPdf, setIsDownloadingUnifiedPdf] = useState(false);
  const [selectedReportForHistory, setSelectedReportForHistory] = useState<InvestmentReportData | null>(null);
  const [reportToDelete, setReportToDelete] = useState<InvestmentReportData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { toast } = useToast();
  const { user } = useAuth();
  const { addNotification } = useNotifications();
  const queryClient = useQueryClient();

  // Fetch existing investment reports for this property with full data for PDF
  const { data: existingReports = [], refetch: refetchReports } = useQuery({
    queryKey: ['client-property-reports', property.id],
    queryFn: async () => {
      // Use secure edge function (service_role) due to service-role-only DB security model.
      const { data, error } = await invokeSecureFunction('get-investment-reports', {
        listMode: true,
        listOptions: {
          select: `
            id,
            property_address,
            status,
            created_at,
            report_content,
            manual_overrides,
            financial_calculations,
            demographics_data,
            economic_data,
            investment_score,
            location_intelligence,
            current_version
          `,
          isClientReport: true,
          clientPropertyId: property.id,
          orderBy: 'created_at',
          orderAsc: false,
        },
      });

      if (error || !data?.success) {
        throw new Error(error?.message || data?.error || 'Failed to load reports');
      }

      return (data.reports || []) as InvestmentReportData[];
    },
  });

  // Notify parent of report changes
  useEffect(() => {
    if (onReportsChange) {
      onReportsChange(existingReports);
    }
  }, [existingReports, onReportsChange]);

  // Check if any reports are in-progress
  const hasInProgressReports = existingReports.some(
    (r) => r.status === 'pending' || r.status === 'processing'
  );

  // Poll for status updates when reports are in-progress
  useEffect(() => {
    if (!hasInProgressReports) return;

    const pollInterval = setInterval(() => {
      refetchReports();
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(pollInterval);
  }, [hasInProgressReports, refetchReports]);

  // Pre-populate PreGenerationOverrides with property data
  const handleOpenOverrideSheet = () => {
    // Calculate weekly rent from monthly if not directly available
    const weeklyRent = property.weekly_rental_income || 
      (property.monthly_rental_income ? Math.round(property.monthly_rental_income * 12 / 52) : undefined);

    // Convert monthly expenses to annual
    const annualCouncilRates = property.monthly_council_rates ? property.monthly_council_rates * 12 : undefined;
    const annualWaterRates = property.monthly_water_rates ? property.monthly_water_rates * 12 : undefined;
    const annualBodyCorp = property.monthly_body_corporate ? property.monthly_body_corporate * 12 : undefined;
    const annualInsurance = (property.monthly_building_insurance || 0) + (property.monthly_landlord_insurance || 0);
    const annualBuildingInsurance = annualInsurance ? annualInsurance * 12 : undefined;
    const annualRepairs = property.monthly_repairs_maintenance ? property.monthly_repairs_maintenance * 12 : undefined;

    // Calculate PM percentage from monthly value
    let pmPercent: number | undefined;
    if (property.monthly_property_management && property.monthly_rental_income) {
      pmPercent = (property.monthly_property_management / property.monthly_rental_income) * 100;
    }

    setPreGenData({
      buildType: 'existing_property',
      purchasePrice: property.value || undefined,
      propertyValue: property.value || undefined,
      weeklyRent,
      interestRate: property.interest_rate || undefined,
      loanAmount: property.loan_remaining || undefined,
      councilRates: annualCouncilRates,
      waterRates: annualWaterRates,
      bodyCorporateFees: annualBodyCorp,
      buildingLandlordInsurance: annualBuildingInsurance,
      propertyManagementFees: pmPercent,
      repairsMaintenance: annualRepairs,
    });

    setIsOverrideSheetOpen(true);
  };

  const handlePreGenDataChange = (data: PreGenerationData) => {
    setPreGenData(data);
  };

  const handleGenerateReport = async () => {
    if (!user) {
      toast({
        title: 'Authentication Required',
        description: 'Please log in to generate reports.',
        variant: 'destructive',
      });
      return;
    }

    setIsGenerating(true);

    try {
      // Build propertyDetails object with all override data
      const propertyDetails: Record<string, any> = {
        // Core details
        price: preGenData.purchasePrice || property.value,
        propertyType: property.property_type === 'investment' ? 'house' : property.property_type,
        buildType: preGenData.buildType,
        reportTier: 'compass',
        generationEngine: 'compass-40',
        
        // Pre-generation overrides
        ...preGenData,
      };

      // Clean overrides for database storage
      const cleanedOverrides = Object.fromEntries(
        Object.entries(preGenData).filter(([_, v]) => v !== undefined)
      ) as Json;

      // Create the report record with client_property_id and is_client_report flag
      // Use secure edge function for insert (service_role required due to RLS)
      const { data: insertResult, error: insertError } = await invokeSecureFunction('manage-investment-reports', {
        action: 'insert',
        data: {
          property_address: property.address,
          report_content: 'Generating report...',
          status: 'pending',
          report_scope: 'address',
          generated_by: null,
          manual_overrides: cleanedOverrides,
          client_property_id: property.id,
          is_client_report: true,
        }
      });

      if (insertError || !insertResult?.success) {
        console.error('Error creating report record:', insertError || insertResult?.error);
        throw new Error(`Failed to create report: ${insertError?.message || insertResult?.error || 'Database error'}`);
      }

      const pendingReport = insertResult.report;

      // Add to background job tracker
      addBackgroundJob({
        id: pendingReport.id,
        type: 'investment_report',
      });

      // Start generation in background
      invokeSecureFunction('generate-investment-report', {
        reportId: pendingReport.id,
        propertyAddress: property.address,
        propertyDetails,
      }).catch((error) => {
        console.error('Background generation error:', error);
      });

      // Add notification
      addNotification({
        type: 'report_generation_started',
        title: 'Report Generation Started',
        message: `Generating investment report for ${property.address}...`,
        entityId: pendingReport.id,
      });

      toast({
        title: 'Report Generation Started',
        description: `Your investment report for ${property.address} is being generated in the background.`,
      });

      // Close sheet and refresh reports
      setIsOverrideSheetOpen(false);
      refetchReports();
      
    } catch (error) {
      console.error('Error starting report generation:', error);
      toast({
        title: 'Failed to Start Generation',
        description: error instanceof Error ? error.message : 'Failed to start report generation.',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteReport = async () => {
    if (!reportToDelete) return;

    setIsDeleting(true);
    try {
      // Use secure edge function (service_role) due to service-role-only DB security model.
      const { data, error } = await invokeSecureFunction('manage-investment-reports', {
        action: 'delete',
        reportId: reportToDelete.id,
      });

      if (error || !data?.success) {
        throw new Error(error?.message || data?.error || 'Failed to delete report');
      }

      // Log activity
      logActivityDirect({
        actionType: 'report_deleted',
        entityType: 'investment_report',
        entityId: reportToDelete.id,
        entityName: reportToDelete.property_address,
        metadata: { source: 'client_property_report' }
      });

      toast({
        title: 'Report Deleted',
        description: 'The investment report has been deleted.',
      });

      refetchReports();
    } catch (error) {
      console.error('Error deleting report:', error);
      toast({
        title: 'Delete Failed',
        description: error instanceof Error ? error.message : 'Failed to delete the report.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setReportToDelete(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-3 w-3 text-success" />;
      case 'pending':
      case 'processing':
        return <Clock className="h-3 w-3 text-brand-500 animate-pulse" />;
      case 'failed':
        return <AlertCircle className="h-3 w-3 text-destructive" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="text-xs bg-success">Completed</Badge>;
      case 'pending':
      case 'processing':
        return <Badge variant="secondary" className="text-xs">Processing...</Badge>;
      case 'failed':
        return <Badge variant="destructive" className="text-xs">Failed</Badge>;
      default:
        return null;
    }
  };

  const hasExistingReports = existingReports.length > 0;
  const completedReports = existingReports.filter(r => r.status === 'completed');

  return (
    <>
      {hasExistingReports ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <FileText className="h-4 w-4 mr-2" />
              Reports ({existingReports.length})
              <ChevronDown className="h-3 w-3 ml-2" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-96">
            <DropdownMenuItem onClick={handleOpenOverrideSheet}>
              <Plus className="h-4 w-4 mr-2" />
              Generate New Report
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Existing Reports
            </DropdownMenuLabel>
            {existingReports.slice(0, 5).map((report) => (
              <div key={report.id} className="px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {/* Comparison checkbox */}
                    {comparisonMode && report.status === 'completed' && onSelectReport && (
                      <Checkbox
                        checked={selectedReportIds.includes(report.id)}
                        onCheckedChange={(checked) => onSelectReport(report.id, !!checked)}
                        className="h-4 w-4"
                      />
                    )}
                    {getStatusIcon(report.status)}
                    <span className="text-xs truncate">
                      {format(new Date(report.created_at), 'dd MMM yyyy HH:mm')}
                    </span>
                    {getStatusBadge(report.status)}
                    {report.current_version && report.current_version > 1 && (
                      <Badge variant="outline" className="text-xs">
                        v{report.current_version}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {report.status === 'completed' && (
                      <>
                        {/* View */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => window.open(`/investment-report/${report.id}`, '_blank')}
                          title="View Report"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {/* Download PDF */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setSelectedReportForPDF(report)}
                          title="Download PDF"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        {/* Cash Flow */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setSelectedReportForCashFlow(report)}
                          title="Cash Flow Analysis"
                        >
                          <Calculator className="h-3.5 w-3.5" />
                        </Button>
                        {/* Edit Overrides */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setSelectedReportForOverride(report)}
                          title="Edit Overrides"
                        >
                          <Settings className="h-3.5 w-3.5" />
                        </Button>
                        {/* Regenerate */}
                        <RegenerateReportButton
                          reportId={report.id}
                          propertyAddress={report.property_address}
                          onRegenerated={() => refetchReports()}
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                        />
                        {/* Version History */}
                        {report.current_version && report.current_version > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setSelectedReportForHistory(report)}
                            title="Version History"
                          >
                            <History className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                    {/* Delete */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setReportToDelete(report)}
                      title="Delete Report"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {existingReports.length > 5 && (
              <div className="px-2 py-1 text-xs text-muted-foreground text-center">
                +{existingReports.length - 5} more reports
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button variant="outline" size="sm" onClick={handleOpenOverrideSheet}>
          <FileText className="h-4 w-4 mr-2" />
          Generate Report
        </Button>
      )}

      {/* Pre-Generation Overrides Sheet */}
      <Sheet open={isOverrideSheetOpen} onOpenChange={setIsOverrideSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-hidden flex flex-col">
          <SheetHeader>
            <SheetTitle>Generate Investment Report</SheetTitle>
            <SheetDescription>
              Configure report parameters for {property.address}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 mt-4 pr-4">
            <div className="space-y-4">
              {/* Property Summary */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Property</span>
                  <Badge variant="secondary">{property.property_type}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{property.address}</p>
                {property.value && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Value:</span>{' '}
                    {new Intl.NumberFormat('en-AU', {
                      style: 'currency',
                      currency: 'AUD',
                      maximumFractionDigits: 0,
                    }).format(property.value)}
                  </p>
                )}
              </div>

              <Separator />

              {/* Pre-Generation Overrides Component */}
              <PreGenerationOverrides
                propertyAddress={property.address}
                onDataChange={handlePreGenDataChange}
                disabled={isGenerating}
                buildType={preGenData.buildType}
                onBuildTypeChange={(bt) => setPreGenData((prev) => ({ ...prev, buildType: bt }))}
                externalPurchasePrice={preGenData.purchasePrice}
                externalPropertyValue={preGenData.propertyValue}
                externalWeeklyRent={preGenData.weeklyRent}
                externalCouncilRates={preGenData.councilRates}
                externalWaterRates={preGenData.waterRates}
                externalBodyCorporateFees={preGenData.bodyCorporateFees}
                externalBuildingInsurance={preGenData.buildingLandlordInsurance}
                externalPropertyManagementPercent={preGenData.propertyManagementFees}
              />
            </div>
          </ScrollArea>

          {/* Generate Button */}
          <div className="mt-4 pt-4 border-t">
            <Button
              onClick={handleGenerateReport}
              disabled={isGenerating}
              className="w-full"
              size="lg"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Generate Investment Report
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Report will be generated in the background. You'll be notified when complete.
            </p>
          </div>
        </SheetContent>
      </Sheet>

      {/* Manual Data Override Modal */}
      <ManualDataOverrideModal
        report={selectedReportForOverride}
        isOpen={!!selectedReportForOverride}
        onClose={() => setSelectedReportForOverride(null)}
        onSave={() => {
          refetchReports();
          setSelectedReportForOverride(null);
        }}
      />

      {/* Cash Flow Analysis Modal */}
      <CashFlowAnalysisModal
        report={selectedReportForCashFlow}
        isOpen={!!selectedReportForCashFlow}
        onClose={() => setSelectedReportForCashFlow(null)}
        onReportUpdated={() => refetchReports()}
      />

      {/* PDF Download Modal */}
      {selectedReportForPDF && (
        <Sheet open={!!selectedReportForPDF} onOpenChange={(open) => !open && setSelectedReportForPDF(null)}>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Download Report</SheetTitle>
              <SheetDescription>
                Generate and download PDF for {selectedReportForPDF.property_address}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              {/* Which template the download comes out in, said before the
                  button that uses it — this sheet is the client profile's
                  investment exit and offered no way to see or change it. */}
              <ReportTemplateSelector
                reportType={INVESTMENT_REPORT_FORMAT.reportType}
                formatLabel={INVESTMENT_REPORT_FORMAT.label}
              />
              {/* ONE client-PDF action. A separately mounted browser
                  generator used to sit under this as "Download (legacy
                  layout)" with `includeSources` and `includeScoring` HARD-CODED
                  true — so this sheet offered two buttons that produced two
                  documents, and the second one ignored the template chosen
                  directly above it. `deliverInvestmentPdf` is the same contract
                  every other Investment surface asks. */}
              <Button
                className="gap-2"
                disabled={isDownloadingUnifiedPdf}
                onClick={async () => {
                  setIsDownloadingUnifiedPdf(true);
                  try {
                    await deliverInvestmentPdf(selectedReportForPDF.id, {
                      variant: selectedReportForPDF.report_variant ?? null,
                    });
                  } catch (error) {
                    toast({
                      title: 'Download failed',
                      description: error instanceof Error ? error.message : 'The report PDF could not be produced.',
                      variant: 'destructive',
                    });
                  } finally {
                    setIsDownloadingUnifiedPdf(false);
                  }
                }}
              >
                <Download className="h-4 w-4" />
                {isDownloadingUnifiedPdf ? 'Preparing…' : 'Download PDF'}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Version History Modal */}
      {selectedReportForHistory && (
        <ReportVersionHistory
          reportId={selectedReportForHistory.id}
          currentVersion={selectedReportForHistory.current_version || 1}
          open={!!selectedReportForHistory}
          onOpenChange={(open) => !open && setSelectedReportForHistory(null)}
          onVersionRestored={() => refetchReports()}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!reportToDelete} onOpenChange={(open) => !open && setReportToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Investment Report?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the investment report created on{' '}
              {reportToDelete && format(new Date(reportToDelete.created_at), 'dd MMM yyyy HH:mm')}.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteReport}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
