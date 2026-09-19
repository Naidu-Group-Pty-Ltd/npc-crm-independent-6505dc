import { ChevronDown, Download, FileText, Loader2, Printer, Send, Settings2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { useReportTemplateMenu } from '@/components/reports/useReportTemplateMenu';

interface CashFlowExportMenuProps {
  includeAllChartsInExport: boolean;
  chartExportToggles: {
    cashFlowTrends: boolean;
    yieldChart: boolean;
    comparisonChart: boolean;
  };
  onGlobalChartsToggle: (checked: boolean) => void;
  onChartToggle: (chartKey: 'cashFlowTrends' | 'yieldChart' | 'comparisonChart', checked: boolean) => void;
  onExportExcel: () => void;
  /**
   * The typeset PDF — built server-side and rendered by WeasyPrint.
   *
   * Separate from `onExportPdf` rather than replacing it: the jsPDF generator
   * stays available while this path beds in, and an adviser who needs the
   * layout they are used to can still have it.
   */
  onExportServerPdf: () => void;
  isExportingServerPdf?: boolean;
  onExportPdf: (options?: { returnBlob?: boolean }) => Promise<Blob | void>;
  onPrintView: () => void;
  onSendToClient: () => void;
  filename: string;
}

export function CashFlowExportMenu({
  includeAllChartsInExport,
  chartExportToggles,
  onGlobalChartsToggle,
  onChartToggle,
  onExportExcel,
  onExportServerPdf,
  isExportingServerPdf = false,
  onExportPdf,
  onPrintView,
  onSendToClient,
  filename,
}: CashFlowExportMenuProps) {
  // Which template this comes out in. The 10 Year Cash Flow only uses it when
  // the projection on screen is the saved one — the export says so when it
  // cannot — but the choice belongs here either way, beside the button.
  const template = useReportTemplateMenu('cashflow', { formatLabel: '10 Year Cash Flow' });
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-10 shrink-0 rounded-xl shadow-sm">
          <FileText className="mr-2 h-4 w-4" />
          Export
          <ChevronDown className="ml-1 h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] max-w-[380px] border bg-background p-0 shadow-xl">
        <div className="border-b bg-gradient-to-br from-card dark:from-background via-card dark:via-background to-background p-4 text-foreground dark:text-white">
          <DropdownMenuLabel className="p-0 text-sm text-foreground dark:text-white">Export & Publish</DropdownMenuLabel>
          <p className="mt-1 text-xs text-muted-foreground dark:text-foreground">Package this analysis for download, print, or client delivery.</p>
        </div>

        <div className="grid gap-1 p-2">
          <DropdownMenuItem onClick={onExportExcel} className="min-h-10 cursor-pointer rounded-xl">
            <Download className="mr-2 h-4 w-4 text-success" />
            Export Excel
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onExportServerPdf}
            disabled={isExportingServerPdf}
            className="min-h-10 cursor-pointer rounded-xl"
          >
            {isExportingServerPdf
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" />
              : <Sparkles className="mr-2 h-4 w-4 text-primary" />}
            {isExportingServerPdf ? 'Generating PDF…' : 'Generate PDF'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onExportPdf()} className="min-h-10 cursor-pointer rounded-xl">
            <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
            Generate PDF (legacy layout)
          </DropdownMenuItem>
          <div className="px-2 py-1">
            <FlattenPdfIconButton
              inline
              variant="outline"
              size="sm"
              className="min-h-10 w-full justify-start rounded-xl"
              label="Generate Flattened PDF"
              getPdfBlob={async () => {
                const b = await onExportPdf({ returnBlob: true });
                if (!b) throw new Error('Failed to generate cash flow PDF');
                return b;
              }}
              filename={filename}
            />
          </div>
          <DropdownMenuItem onClick={onPrintView} className="min-h-10 cursor-pointer rounded-xl">
            <Printer className="mr-2 h-4 w-4 text-muted-foreground" />
            Print View
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onSendToClient} className="min-h-10 cursor-pointer rounded-xl">
            <Send className="mr-2 h-4 w-4 text-info" />
            Send to Client
          </DropdownMenuItem>
          {template.section}
        </div>

        <DropdownMenuSeparator />

        <div className="space-y-3 p-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Settings2 className="h-3.5 w-3.5" />
              PDF Options
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Control which chart sections are included in PDF outputs.</p>
          </div>

          <div className="rounded-2xl border bg-muted/20 p-3 space-y-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-xl px-1 py-1 hover:bg-background/70">
              <Checkbox
                checked={includeAllChartsInExport}
                onCheckedChange={(checked) => onGlobalChartsToggle(checked === true)}
              />
              <span className="text-sm font-medium">Include all charts</span>
            </label>
            <Separator className="my-2" />
            <label className="flex cursor-pointer items-center gap-2 rounded-xl px-1 py-1 pl-4 hover:bg-background/70">
              <Checkbox
                checked={chartExportToggles.cashFlowTrends}
                onCheckedChange={(checked) => onChartToggle('cashFlowTrends', checked === true)}
              />
              <span className="text-sm">Cash flow trends</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl px-1 py-1 pl-4 hover:bg-background/70">
              <Checkbox
                checked={chartExportToggles.yieldChart}
                onCheckedChange={(checked) => onChartToggle('yieldChart', checked === true)}
              />
              <span className="text-sm">Yield percentages</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl px-1 py-1 pl-4 hover:bg-background/70">
              <Checkbox
                checked={chartExportToggles.comparisonChart}
                onCheckedChange={(checked) => onChartToggle('comparisonChart', checked === true)}
              />
              <span className="text-sm">Property comparison</span>
            </label>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
    {/* Outside the menu: its content unmounts on close and would take the
        dialog with it. */}
    {template.dialog}
    </>
  );
}
