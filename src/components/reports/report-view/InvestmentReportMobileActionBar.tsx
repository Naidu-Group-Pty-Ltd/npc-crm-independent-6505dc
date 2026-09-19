import { Calculator, Download, Edit, Images, Loader2, MoreHorizontal, Send, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  onDownload: () => void;
  /** True while the document render is in flight. */
  downloadBusy?: boolean;
  onSendToClient: () => void;
  onCashFlow: () => void;
  onEdit: () => void;
  onOverride: () => void;
  onManageHeroImages: () => void;
}

export function InvestmentReportMobileActionBar({
  onDownload,
  downloadBusy = false,
  onSendToClient,
  onCashFlow,
  onEdit,
  onOverride,
  onManageHeroImages,
}: Props) {
  return (
    <div className="sticky bottom-0 z-30 border-t bg-background/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:hidden">
      <div className="mx-auto flex max-w-7xl items-center gap-2">
        <Button className="min-w-0 flex-1" size="sm" onClick={onDownload} disabled={downloadBusy}>
          {downloadBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
          {downloadBusy ? 'Preparing…' : 'Download PDF'}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0 bg-background/80">
              <MoreHorizontal className="h-4 w-4 mr-1.5" />
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel>Report actions</DropdownMenuLabel>
            <DropdownMenuItem onClick={onSendToClient}>
              <Send className="h-4 w-4 mr-2" />
              Send to Client
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCashFlow}>
              <Calculator className="h-4 w-4 mr-2" />
              Cash Flow Analysis
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onEdit}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOverride}>
              <Settings className="h-4 w-4 mr-2" />
              Override Data
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onManageHeroImages}>
              <Images className="h-4 w-4 mr-2" />
              Manage Hero Images
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
