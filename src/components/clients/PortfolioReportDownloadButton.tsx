/**
 * The one control that hands someone a saved Portfolio Performance Review.
 *
 * A split button: pressing it asks the server to typeset the review from the
 * stored data, and the caret beside it offers the PDF the legacy generator
 * already produced and saved.
 *
 * ## How this differs from `SnapshotDownloadButton`
 *
 * That control's second item *runs* the in-browser generator. This one cannot —
 * `PortfolioAnalysisPDFGenerator` is a 3,878-line component with no importable
 * entry point, and the only way to reach it is to mount it and click through
 * *Generate* then *Download & Save*. So the second item here is the **stored**
 * file at `portfolio_analysis_reports.pdf_file_path`, and where a report has
 * none it says so and points at the generator rather than pretending it can
 * produce one.
 *
 * That difference is why the typeset item is the primary action rather than the
 * polite alternative: it reads `report_data`, so it works for the seven of
 * twenty-one stored reports that have no file at all and are un-downloadable
 * today.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ChevronDown, FileDown, FileText, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useReportTemplateMenu } from '@/components/reports/useReportTemplateMenu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  deliverPortfolioReview,
  type PortfolioVariant,
} from '@/lib/reports/portfolio/deliverPortfolioReview';
import { PORTFOLIO_REPORT_LABEL } from '@/lib/reports/portfolio/label';

export interface PortfolioReportDownloadButtonProps {
  /** The `portfolio_analysis_reports` row to typeset. */
  reportId: string;
  /** That row's `pdf_file_path`, for the stored-PDF item. */
  storedPath?: string | null;
  /** What to call the saved file on the stored path. */
  storedFileName?: string;
  /** Fold in the client's latest completed review. Defaults to true. */
  includeReview?: boolean;
  label?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  disabled?: boolean;
  /** Called after either path succeeds. */
  onDelivered?: (source: PortfolioVariant) => void;
  /**
   * `split` — a primary action with a caret beside it. The default.
   *
   * `menu` — one button that opens the two choices, for a row menu or a card
   * header where a labelled split button would not fit. Both offer the same two
   * options; only the room they take changes.
   */
  appearance?: 'split' | 'menu';
  /** `menu` only: rendered inside the trigger instead of the label. */
  icon?: ReactNode;
  /** `menu` only: the trigger's accessible name when it shows only an icon. */
  triggerLabel?: string;
}

export function PortfolioReportDownloadButton({
  reportId,
  storedPath,
  storedFileName,
  includeReview = true,
  label = 'Download review (typeset)',
  variant = 'outline',
  size = 'sm',
  className,
  disabled = false,
  onDelivered,
  appearance = 'split',
  icon,
  triggerLabel,
}: PortfolioReportDownloadButtonProps) {
  const [running, setRunning] = useState<PortfolioVariant | null>(null);
  // Which template this comes out in, offered beside the button that uses it.
  const template = useReportTemplateMenu('portfolio');
  const hasStored = Boolean((storedPath ?? '').trim());

  const run = async (which: PortfolioVariant) => {
    if (running) return;
    setRunning(which);
    try {
      const result = await deliverPortfolioReview({
        variant: which,
        request: { reportId, includeReview },
        storedPath,
        storedFileName,
      });

      if (result.brandGaps.length) {
        // Said at the moment someone is about to send it, not buried in a log.
        toast.warning(`Review ready, with gaps: ${result.brandGaps.join('; ')}`);
      } else if (which === 'server') {
        toast.success(
          result.reviewIncluded
            ? `${PORTFOLIO_REPORT_LABEL} ready, including the latest review`
            : `${PORTFOLIO_REPORT_LABEL} ready`,
        );
      } else {
        toast.success('Saved PDF downloaded');
      }
      onDelivered?.(result.source);
    } catch (e) {
      console.error('[PortfolioReportDownloadButton]', e);
      toast.error(e instanceof Error ? e.message : 'Could not produce the review');
    } finally {
      setRunning(null);
    }
  };

  const busy = running !== null;

  // One menu body, used by both appearances, so the two choices cannot drift
  // apart between a row menu and a card header.
  const choices = (
    <DropdownMenuContent align="end" className="w-72">
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        The review, two ways
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => run('server')} className="cursor-pointer">
        <FileText className="mr-2 h-4 w-4 text-primary" />
        <div className="flex flex-col">
          <span>{label}</span>
          <span className="text-xs text-muted-foreground">
            Typeset from the stored analysis, on your branding
          </span>
        </div>
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => run('stored')}
        // Not hidden when absent. A missing item is read as a feature that does
        // not exist; a disabled one with a reason is read as this report having
        // no saved file, which is the true and actionable thing.
        disabled={!hasStored}
        className="cursor-pointer"
      >
        <FileDown className="mr-2 h-4 w-4 text-muted-foreground" />
        <div className="flex flex-col">
          <span>Download the saved PDF</span>
          <span className="text-xs text-muted-foreground">
            {hasStored
              ? 'The file generated when this report was created'
              : 'No saved file — use Generate Performance Report to make one'}
          </span>
        </div>
      </DropdownMenuItem>
      {template.section}
    </DropdownMenuContent>
  );

  if (appearance === 'menu') {
    return (
      <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={disabled || busy}
            aria-label={triggerLabel ?? label}
            className={className}
          >
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : icon ?? <FileText className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        {choices}
      </DropdownMenu>
      {/* Outside the menu: its content unmounts on close. */}
      {template.dialog}
      </>
    );
  }

  return (
    <div className={cn('inline-flex items-stretch', className)}>
      <Button
        variant={variant}
        size={size}
        disabled={disabled || busy}
        onClick={() => run('server')}
        className="rounded-r-none"
      >
        {running === 'server'
          ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
        {running === 'server' ? 'Rendering…' : label}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={disabled || busy}
            aria-label="Other portfolio report formats"
            className="rounded-l-none border-l-0 px-2"
          >
            {running === 'stored'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </DropdownMenuTrigger>
        {choices}
      </DropdownMenu>
      {template.dialog}
    </div>
  );
}
