import { ArrowLeft, Calculator, Download, Edit, FolderOpen, History, Images, Loader2, MoreHorizontal, Send, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { ReportVariantControls } from '@/components/reports/ReportVariantControls';
import type { ClientInfo, InvestmentReport } from './types';
import { resolveInvestmentReportType } from '@/lib/reports/reportVariants';
import { ReportTypeBadge } from '@/components/reports/ReportTypeBadge';

interface Props {
  report: InvestmentReport;
  clientInfo: ClientInfo | null;
  isClientReport: boolean;
  onBack: () => void;
  /**
   * Names where "back" goes when the caller knows. Set when the report was
   * reached by drilling in from another module's list — the Cash Flow
   * Analysis property list today — where a generic "Back" understates the
   * journey and the client shortcut below is not the route the adviser came
   * in on. When set it wins over that shortcut.
   */
  backLabel?: string;
  onReportsHome: () => void;
  onBackToClient: () => void;
  onNavigateToReport: (reportId: string) => void;
  onSendToClient: () => void;
  onCashFlow: () => void;
  onEdit: () => void;
  onOverride: () => void;
  onManageHeroImages: () => void;
  onOpenVersionHistory: () => void;
  onDownload: () => void;
  /** True while the document render is in flight — a multi-second wait with no feedback reads as broken. */
  downloadBusy?: boolean;
  /** The raw-markdown export, for the menu item that says exactly that. */
  onExportText?: () => void;
}

export function InvestmentReportCommandHeader({
  report,
  clientInfo,
  isClientReport,
  onBack,
  backLabel,
  onReportsHome,
  onBackToClient,
  onNavigateToReport,
  onSendToClient,
  onCashFlow,
  onEdit,
  onOverride,
  onManageHeroImages,
  onOpenVersionHistory,
  onDownload,
  downloadBusy = false,
  onExportText,
}: Props) {
  const reportType = resolveInvestmentReportType(report);

  return (
    <div className="sticky top-0 z-30 border-b bg-background/95 px-3 py-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80 flex-shrink-0 sm:px-4">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          <Button variant="outline" size="sm" onClick={onReportsHome} className="shrink-0 bg-background/80 px-2 shadow-sm sm:px-3">
            <FolderOpen className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Generated Reports</span>
            <span className="sr-only sm:hidden">Generated Reports home</span>
          </Button>
          {backLabel ? (
            <Button variant="ghost" size="sm" onClick={onBack} aria-label={backLabel} className="shrink-0 px-2 sm:px-3">
              <ArrowLeft className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">{backLabel}</span>
            </Button>
          ) : isClientReport && clientInfo ? (
            <Button variant="ghost" size="sm" onClick={onBackToClient} className="shrink-0 px-2 sm:px-3">
              <ArrowLeft className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Back to {clientInfo.primary_first_name} {clientInfo.primary_surname}</span>
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0 px-2 sm:px-3">
              <ArrowLeft className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Back</span>
            </Button>
          )}
          <Separator orientation="vertical" className="hidden h-7 lg:block" />
          <div className="hidden min-w-[14rem] flex-1 items-center gap-2 lg:flex" aria-label={`Report workspace for ${report.property_address}`}>
            <ReportTypeBadge type={reportType} className="shrink-0" />
            <span className="min-w-0 break-words text-sm font-medium leading-snug text-foreground">{report.property_address}</span>
          </div>
        </div>

        <div className="order-3 flex w-full flex-wrap items-center gap-2 lg:order-2 lg:w-auto lg:flex-1 lg:justify-center">
          <div className="rounded-lg border bg-card/70 p-1 shadow-sm">
            <ReportVariantControls
              compositeReportId={report.derived_from_report_id || report.parent_report_id || report.id}
              reportVariant={report.report_variant}
              onNavigate={onNavigateToReport}
            />
          </div>
        </div>

        <div className="order-2 ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 lg:order-3">
          <Button variant="default" size="sm" onClick={onDownload} disabled={downloadBusy} className="shrink-0 shadow-sm">
            {downloadBusy
              ? <Loader2 className="h-4 w-4 animate-spin sm:mr-1" />
              : <Download className="h-4 w-4 sm:mr-1" />}
            <span className="hidden sm:inline">{downloadBusy ? 'Preparing…' : 'Download PDF'}</span>
          </Button>

          <Button variant="outline" size="sm" onClick={onSendToClient} className="hidden shrink-0 bg-background/80 shadow-sm md:inline-flex">
            <Send className="h-4 w-4 mr-1" />
            Send to Client
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0 bg-background/80 px-2 shadow-sm sm:px-3">
                <MoreHorizontal className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">More</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Report actions</DropdownMenuLabel>
              <DropdownMenuItem onClick={onSendToClient} className="md:hidden">
                <Send className="h-4 w-4 mr-2" />
                Send to Client
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOverride}>
                <Settings className="h-4 w-4 mr-2" />
                Override Data
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onCashFlow}>
                <Calculator className="h-4 w-4 mr-2" />
                Cash Flow Analysis
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onManageHeroImages}>
                <Images className="h-4 w-4 mr-2" />
                Manage Hero Images
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenVersionHistory}>
                <History className="h-4 w-4 mr-2" />
                Version History
              </DropdownMenuItem>
              {onExportText && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onExportText}>
                    <Download className="h-4 w-4 mr-2" />
                    Raw text download
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
