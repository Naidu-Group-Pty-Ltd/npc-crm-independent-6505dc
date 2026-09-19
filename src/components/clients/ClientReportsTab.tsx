import { useState, useMemo } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { secureStorageDownload, secureStorageUpload } from '@/hooks/useSecureStorage';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
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
import {
  FileText,
  Download,
  Mail,
  Plus,
  Building2,
  PieChart,
  FileSpreadsheet,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  Eye,
  Trash2,
  MoreVertical,
  Loader2,
  SortAsc,
  Landmark,
  Send,
  Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { PropertyReportGenerator } from './PropertyReportGenerator';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { fetchAndGenerateBorrowingCapacityPDF, generateBorrowingCapacityPDF } from '@/components/borrowing-capacity/BorrowingCapacityPDFReport';
import { bucketCandidates, isExternalUrl, parseStorageRef } from '@/lib/reports/storageRef';
import { SnapshotDownloadButton } from '@/components/borrowing-capacity/SnapshotDownloadButton';
import { PortfolioReportDownloadButton } from '@/components/clients/PortfolioReportDownloadButton';
import { snapshotBlob } from '@/lib/reports/borrowingCapacity/deliverSnapshot';
import { fetchLatestBorrowingCapacity } from '@/lib/fetchLatestBorrowingCapacity';
import { useClientReportInventory } from '@/hooks/useClientReportInventory';
import { publishReportToPortal } from '@/lib/reports/publishReportToPortal';
import { publishInvestmentPdf } from '@/lib/reports/investment/deliverInvestmentPdf';
import type { UnifiedReport } from '@/lib/reports/clientReportInventory.pure';
import { useAuth } from '@/hooks/useAuth';
import { PORTFOLIO_REPORT_LABEL } from '@/lib/reports/portfolio/label';

interface ClientReportsTabProps {
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  fullClient: any;
  properties: any[];
  employment: any[];
  income: any[];
  assets: any[];
  liabilities: any[];
  expenses?: any[];
  onEmailClick: (blob: Blob, fileName: string) => void;
  onOpenEmailCompose: () => void;
}

type ReportType = 'all' | 'portfolio' | 'formara' | 'investment' | 'property' | 'borrowing' | 'published';
type SortMode = 'newest' | 'oldest' | 'name';

/* `UnifiedReport` is declared once, in `clientReportInventory.pure.ts`. */

export function ClientReportsTab({
  clientId,
  clientName,
  clientEmail,
  fullClient,
  properties,
  employment,
  income,
  assets,
  liabilities,
  expenses = [],
  onEmailClick,
  onOpenEmailCompose,
}: ClientReportsTabProps) {
  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ReportType>('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [reportToDelete, setReportToDelete] = useState<UnifiedReport | null>(null);
  /** The report currently being rendered, so its button can show progress. */
  const [generatingReportId, setGeneratingReportId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  /* The signed-in reading is still the page's own: the hook declines to fetch
     without a user, and this says why the library is empty rather than
     leaving a blank panel. */
  const canFetchReports = !authLoading && !!user;

  /**
   * Every report this client has, from the five places they live.
   *
   * These queries used to be written out here and the Sent Reports tab had
   * none of them, so publishing a generated report meant downloading it and
   * uploading it again. They are one hook now, shared by both tabs with the
   * same query keys — so the publish picker costs no extra round trip and
   * neither list can quietly acquire a source the other lacks.
   */
  const propertyIds = useMemo(() => properties.map((p) => p.id), [properties]);
  const {
    reports: allReports,
    publishedFiles,
    isLoading: portfolioLoading,
    portalReports,
  } = useClientReportInventory(clientId, propertyIds);

  const deletePortfolioMutation = useMutation({
    mutationFn: async (reportId: string) => {
      const { error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'portfolio_analysis_reports',
        reportId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_: any, reportId: string) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-analysis-reports', clientId] });
      logActivityDirect({
        actionType: 'report_deleted',
        entityType: 'portfolio_report',
        entityId: reportId,
        metadata: { client_id: clientId }
      });
      toast.success('Report deleted');
      setReportToDelete(null);
    },
    onError: () => {
      toast.error('Portfolio report could not be deleted. No data was removed. Please try again.');
    },
  });

  // Filter + sort
  const filteredReports = useMemo(() => {
    let filtered = activeFilter === 'all' ? allReports : allReports.filter(r => r.type === activeFilter);

    filtered.sort((a, b) => {
      if (sortMode === 'newest') return new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime();
      if (sortMode === 'oldest') return new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime();
      return a.name.localeCompare(b.name);
    });

    return filtered;
  }, [allReports, activeFilter, sortMode]);

  // Type counts for filter chips
  const typeCounts = useMemo(() => ({
    all: allReports.length,
    portfolio: allReports.filter(r => r.type === 'portfolio').length,
    formara: allReports.filter(r => r.type === 'formara').length,
    investment: allReports.filter(r => r.type === 'investment').length,
    property: allReports.filter(r => r.type === 'property').length,
    borrowing: allReports.filter(r => r.type === 'borrowing').length,
    published: allReports.filter(r => r.type === 'published').length,
  }), [allReports]);

  const getReportIcon = (type: string) => {
    switch (type) {
      case 'formara': return <FileSpreadsheet className="h-4 w-4" />;
      case 'portfolio': return <PieChart className="h-4 w-4" />;
      case 'borrowing': return <Landmark className="h-4 w-4" />;
      case 'property':
      case 'investment': return <Building2 className="h-4 w-4" />;
      case 'published': return <Send className="h-4 w-4" />;
      default: return <FileText className="h-4 w-4" />;
    }
  };

  const getTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'formara': return 'bg-primary/10 text-primary border-primary/20';
      case 'portfolio': return 'bg-accent/50 text-accent-foreground border-accent';
      case 'investment': return 'bg-secondary/50 text-secondary-foreground border-secondary';
      case 'borrowing': return 'bg-primary/15 text-primary border-primary/25';
      case 'property': return 'bg-muted text-muted-foreground border-border';
      case 'published': return 'bg-accent/50 text-accent-foreground border-accent';
      default: return '';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
      case 'pending': return <Clock className="h-3.5 w-3.5 text-brand-500" />;
      case 'failed': return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
      default: return null;
    }
  };

  /**
   * Fetch a stored report, whatever shape its reference is in.
   *
   * The old version of this only unwrapped a stringified upload result, so a
   * `pdf_url` holding a full storage URL — which is what 263 investment report
   * rows hold — was handed to the storage client as if it were an object key.
   * Both the primary call and its fallback failed, every time, for every one
   * of those reports. `parseStorageRef` takes the key out of the URL; the
   * bucket it names is then the only one worth trying.
   */
  const fetchStoredReport = async (reference: string): Promise<Blob> => {
    const ref = parseStorageRef(reference);
    if (!ref.path) throw new Error('This report has no file attached.');
    if (isExternalUrl(reference)) {
      throw new Error('This report is stored outside the app and cannot be downloaded here.');
    }

    const errors: string[] = [];
    for (const bucket of bucketCandidates(ref, 'client-files', 'investment-reports')) {
      try {
        const result = await secureStorageDownload(bucket as Parameters<typeof secureStorageDownload>[0], ref.path);
        if (result.success && result.blob) return result.blob;
        errors.push(`${bucket}: ${result.error || 'not found'}`);
      } catch (e: any) {
        errors.push(`${bucket}: ${e?.message || 'failed'}`);
      }
    }
    throw new Error(errors.join('; ') || 'Download failed');
  };

  const handleDownloadFile = async (fileUrl: string, fileName: string) => {
    try {
      const blob = await fetchStoredReport(fileUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Report downloaded');
    } catch (error: any) {
      // The message names which buckets were tried and why each said no. The
      // old version reported "Failed to download report" for every cause.
      console.error('[handleDownloadFile]', error, 'reference=', fileUrl);
      toast.error(error?.message || 'Failed to download report');
    }
  };

  const handleViewFile = async (fileUrl: string) => {
    // Open the tab synchronously inside the click handler so popup blockers
    // (Chrome/Safari) don't kill it after the async storage download.
    const viewer = window.open('', '_blank');
    if (viewer) {
      viewer.document.write(
        '<title>Loading PDF…</title><style>body{margin:0;background:#0d0d0d;color:#d4a843;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh}</style><body>Loading PDF…</body>'
      );
    }

    const openBlob = (blob: Blob) => {
      // Force application/pdf so the browser renders inline instead of downloading.
      const pdfBlob = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfBlob);
      if (viewer) {
        viewer.location.href = url;
      } else {
        // Popup blocked — fall back to same-tab download link.
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.click();
      }
      // Revoke after the viewer has had time to load the blob.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };

    try {
      openBlob(await fetchStoredReport(fileUrl));
    } catch (err: any) {
      if (viewer) viewer.close();
      console.error('[handleViewFile]', err, 'reference=', fileUrl);
      toast.error(err?.message || 'Failed to open PDF');
    }
  };

  /**
   * Produce an investment report that has no stored file, store it, and hand
   * it to the person.
   *
   * This used to POST to `render-investment-report-pdf` and then fetch the
   * signed URL it answered with. It goes through `publishInvestmentPdf` now —
   * the one module every Investment surface asks — so this row's download is
   * the same document the report page, the portal send and the premium button
   * produce, drawn in this browser. The stored bytes and the downloaded bytes
   * come from ONE render rather than two.
   */
  const handleGenerateInvestmentPdf = async (report: UnifiedReport) => {
    setGeneratingReportId(report.id);
    try {
      const published = await publishInvestmentPdf(report.id);

      const url = URL.createObjectURL(published.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = published.fileName || `${report.name}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success('Report generated');
      // The row now carries a path, so the View / Email actions appear on the
      // next render rather than after a page reload.
      queryClient.invalidateQueries({ queryKey: ['client-investment-reports', clientId] });
    } catch (e: any) {
      console.error('[handleGenerateInvestmentPdf]', e);
      toast.error(e?.message || 'Could not generate the report');
    } finally {
      setGeneratingReportId(null);
    }
  };

  const handleEmailReport = async (report: UnifiedReport) => {
    if (!report.fileUrl) {
      toast.error('No file available to attach');
      return;
    }
    try {
      onEmailClick(await fetchStoredReport(report.fileUrl), report.name);
    } catch {
      toast.error('Failed to prepare report for email');
    }
  };

  /**
   * The paper-plane on a row, and the picker in the Sent Reports dialog, are
   * the same act. `publishReportToPortal` is that act — including the
   * borrowing-capacity assessment's render-on-publish, which used to be
   * written out here and existed nowhere else.
   */
  const handleSendToPortal = async (report: UnifiedReport) => {
    const toastId = `portal-${report.id}`;
    const outcome = await publishReportToPortal({
      report,
      clientId,
      clientName,
      onProgress: (message) => toast.loading(message, { id: toastId }),
    });
    toast.dismiss(toastId);
    if (!outcome.ok) {
      toast.error('Failed to publish: ' + outcome.error);
      return;
    }
    toast.success(
      outcome.generated ? 'Report generated and published to client portal' : 'Report published to client portal',
    );
    queryClient.invalidateQueries({ queryKey: ['client-portal-reports', clientId] });
    queryClient.invalidateQueries({ queryKey: ['client-portal-reports-unified', clientId] });
  };

  const handleDelete = (report: UnifiedReport) => {
    setReportToDelete(report);
  };

  const confirmDelete = () => {
    if (!reportToDelete) return;
    if (reportToDelete.source === 'portfolio_report') {
      deletePortfolioMutation.mutate(reportToDelete.id);
    } else {
      // For now, only portfolio reports support deletion from this view
      toast.info('This report type cannot be deleted from here');
      setReportToDelete(null);
    }
  };

  const filterChips: { key: ReportType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'portfolio', label: 'Portfolio' },
    { key: 'borrowing', label: 'Borrowing' },
    { key: 'formara', label: 'Client Forms' },
    { key: 'investment', label: 'Investment' },
    { key: 'property', label: 'Property' },
    { key: 'published', label: 'Published' },
  ];

  return (
    <div className="space-y-4 overflow-x-hidden overflow-y-auto">
      {/* Reports remain focused on existing report records and property-specific generation. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground mr-1">Generate property report:</span>

        {/* Property Report Dropdown */}
        {properties.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Building2 className="h-4 w-4 mr-1.5" />
                Property
                <ChevronDown className="h-3.5 w-3.5 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Select Property</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {properties.map((property) => (
                <DropdownMenuItem
                  key={property.id}
                  onClick={() => setSelectedProperty(property.id)}
                  className="flex items-start gap-2 py-2"
                >
                  <Building2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium truncate max-w-[200px]">
                      {property.address}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {property.property_type === 'investment' ? 'Investment' : property.property_type === 'owner_occupied' ? 'Owner Occupied' : property.property_type === 'smsf' ? 'SMSF' : property.property_type === 'rental' ? 'Rental' : property.property_type}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Selected Property Inline Generator */}
      {selectedProperty && (() => {
        const selectedProp = properties.find(p => p.id === selectedProperty);
        if (!selectedProp) return null;
        return (
          <div className="p-3 bg-muted/50 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm truncate">{selectedProp.address}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <PropertyReportGenerator property={selectedProp} clientName={clientName} />
              <Button variant="ghost" size="sm" onClick={() => setSelectedProperty(null)}>Cancel</Button>
            </div>
          </div>
        );
      })()}

      <Separator />

      {/* ─── Filter Chips + Sort ─── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {filterChips.map(chip => {
            const count = typeCounts[chip.key];
            if (chip.key !== 'all' && count === 0) return null;
            return (
              <button
                key={chip.key}
                onClick={() => setActiveFilter(chip.key)}
                className={cn(
                  "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border",
                  activeFilter === chip.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {chip.label}
                {count > 0 && (
                  <span className={cn(
                    "text-[10px] rounded-full px-1.5 min-w-[18px] text-center",
                    activeFilter === chip.key ? "bg-primary-foreground/20" : "bg-muted-foreground/20"
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
              <SortAsc className="h-3.5 w-3.5 mr-1" />
              {sortMode === 'newest' ? 'Newest' : sortMode === 'oldest' ? 'Oldest' : 'Name'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setSortMode('newest')}>Most Recent</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortMode('oldest')}>Oldest First</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortMode('name')}>Name A-Z</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ─── Unified Report Library ─── */}
      {!canFetchReports ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">Please sign in to view client reports</p>
        </div>
      ) : authLoading || portfolioLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">
            {activeFilter === 'all' ? 'No reports generated yet' : `No ${activeFilter} reports found`}
          </p>
          <p className="text-xs mt-1">Use the buttons above to generate your first report</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredReports.map((report) => (
            <div
              key={`${report.source}-${report.id}`}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
            >
              {/* Left: Icon + Info */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="p-2 rounded-md bg-muted flex-shrink-0">
                  {getReportIcon(report.type)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{report.name}</span>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", getTypeBadgeClass(report.type))}>
                      {report.type.charAt(0).toUpperCase() + report.type.slice(1)}
                    </Badge>
                    {getStatusIcon(report.status)}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 flex-wrap">
                    <Clock className="h-3 w-3 flex-shrink-0" />
                    <span>{format(new Date(report.generatedAt), 'dd MMM yyyy, HH:mm')}</span>
                    {report.propertyAddress && (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <span className="truncate">{report.propertyAddress}</span>
                      </>
                    )}
                    {report.overallHealth && (
                      <>
                        <span className="text-muted-foreground/50">·</span>
                        <span>Health: {report.overallHealth}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-1 sm:gap-1 flex-shrink-0 ml-auto">
                {/* View (for investment reports without file or any report with file) */}
                {report.type === 'investment' && report.source === 'investment_report' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 sm:h-8 sm:w-8"
                    onClick={() => window.open(`/investment-report/${report.id}`, '_blank')}
                    title="View Report"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}

                {/* Download PDF for borrowing capacity assessments */}
                {report.type === 'borrowing' && report.source === 'borrowing_assessment' && (
                  <SnapshotDownloadButton
                    appearance="menu"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 sm:h-8 sm:w-8"
                    icon={<Download className="h-4 w-4" />}
                    triggerLabel="Download PDF"
                    request={{ clientId, clientName }}
                    legacy={() => fetchAndGenerateBorrowingCapacityPDF(
                      clientId, clientName, undefined, undefined, { returnBlob: true },
                    )}
                    label="Download PDF"
                  />
                )}

                {/*
                  The typeset {PORTFOLIO_REPORT_LABEL}.

                  Offered on every portfolio row, including the ones with no
                  `pdf_file_path` — 7 of the 21 stored reports are in that state
                  and show no download button at all below, because the block
                  under this one is gated on `report.fileUrl`. This path reads
                  `report_data` rather than the file, so it works for them.

                  The stored PDF stays reachable through the same control's
                  second item, and through the View / Download buttons below
                  wherever there is one.
                */}
                {report.type === 'portfolio' && report.source === 'portfolio_report' && (
                  <PortfolioReportDownloadButton
                    appearance="menu"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 sm:h-8 sm:w-8"
                    icon={<Sparkles className="h-4 w-4" />}
                    triggerLabel={`Download the ${PORTFOLIO_REPORT_LABEL}`}
                    reportId={report.id}
                    storedPath={report.fileUrl}
                    storedFileName={`${report.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`}
                  />
                )}

                {/*
                  An investment report whose row has no file reference.
                  899 of 1,157 completed reports are in this state, because the
                  renderer returned a signed URL and never recorded where the
                  file went — so every button below was hidden and the report
                  looked undownloadable. It is not: it can be rendered again.
                */}
                {report.type === 'investment' && !report.fileUrl && report.status === 'completed' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 sm:h-8 sm:w-8"
                    disabled={generatingReportId === report.id}
                    onClick={() => handleGenerateInvestmentPdf(report)}
                    title="Generate PDF"
                  >
                    {generatingReportId === report.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Download className="h-4 w-4" />}
                  </Button>
                )}

                {report.fileUrl && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 sm:h-8 sm:w-8"
                      onClick={() => handleViewFile(report.fileUrl!)}
                      title="View PDF"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 sm:h-8 sm:w-8"
                      onClick={() => handleDownloadFile(report.fileUrl!, report.name)}
                      title="Download"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 sm:h-8 sm:w-8"
                      onClick={() => handleEmailReport(report)}
                      title="Email this report"
                    >
                      <Mail className="h-4 w-4" />
                    </Button>
                  </>
                )}

                {/* Send to Client Portal (hide for already-published portal reports) */}
                {report.source !== 'portal_report' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 sm:h-8 sm:w-8 text-primary"
                  onClick={() => handleSendToPortal(report)}
                  title="Send to Client Portal"
                >
                  <Send className="h-4 w-4" />
                </Button>
                )}

                {/* More actions (delete for portfolio reports) */}
                {report.source === 'portfolio_report' && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-10 w-10 sm:h-8 sm:w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => handleDelete(report)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!reportToDelete} onOpenChange={() => setReportToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{reportToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
