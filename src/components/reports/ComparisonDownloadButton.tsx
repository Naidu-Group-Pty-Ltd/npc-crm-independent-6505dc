/**
 * The one control that hands someone a saved Property Comparison Analysis.
 *
 * A split button: pressing it typesets the stored comparison server-side, and the
 * caret beside it points at the AI-written report the product has always
 * produced.
 *
 * ## Why the second item is not a download
 *
 * `SnapshotDownloadButton`'s second item runs the in-browser generator;
 * `PortfolioReportDownloadButton`'s offers the stored PDF. Neither is available
 * here. `property_comparisons` has no `pdf_file_path`, and
 * `ComparisonPDFGenerator` has no importable entry point — it is a component that
 * calls an edge function and mounts `PixelPerfectPDFGenerator`, which exposes
 * only a ref handle returning a URL.
 *
 * So the second item opens the viewer where that button already lives, and it
 * **states what pressing it costs**. That is not decoration: the legacy path asks
 * a model to rewrite the stored analysis on every single download, so it spends
 * report credits and the wording differs each time. Someone choosing between the
 * two deserves to know that before they choose, and the sub-label is the only
 * place in the product that says so.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';
import { ChevronDown, FileText, Loader2, Sparkles, Wand2 } from 'lucide-react';
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
import { deliverComparisonPdf } from '@/lib/reports/propertyComparison/deliverComparisonPdf';

export interface ComparisonDownloadButtonProps {
  /** The `property_comparisons` row to typeset. */
  comparisonId: string;
  label?: string;
  /**
   * Opens the surface where the AI-written report is produced.
   *
   * Omitted where there is nothing to open — the item is then shown disabled
   * with its reason rather than hidden, because a missing item reads as a
   * feature that does not exist.
   */
  onOpenLegacy?: () => void;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  disabled?: boolean;
  onDelivered?: () => void;
  /**
   * `split` — a primary action with a caret beside it. The default.
   *
   * `menu` — one button that opens both choices, for a card footer or a dialog
   * title bar where a labelled split button would not fit.
   */
  appearance?: 'split' | 'menu';
  /** `menu` only: rendered inside the trigger instead of the label. */
  icon?: ReactNode;
  /** `menu` only: the trigger's accessible name when it shows only an icon. */
  triggerLabel?: string;
}

export function ComparisonDownloadButton({
  comparisonId,
  label = 'Download comparison',
  onOpenLegacy,
  variant = 'outline',
  size = 'sm',
  className,
  disabled = false,
  onDelivered,
  appearance = 'split',
  icon,
  triggerLabel,
}: ComparisonDownloadButtonProps) {
  const [running, setRunning] = useState(false);
  // Which template this comes out in, offered beside the button that uses it.
  const template = useReportTemplateMenu('comparison');

  const run = async () => {
    if (running) return;
    setRunning(true);
    try {
      const result = await deliverComparisonPdf({ comparisonId });

      if (result.brandGaps.length) {
        // Said at the moment someone is about to send it, not buried in a log.
        toast.warning(`Comparison ready, with gaps: ${result.brandGaps.join('; ')}`);
      } else if (!result.recordComplete) {
        // The document says this on its first page too. It is repeated here
        // because the moment that matters is the one before it is emailed.
        toast.warning(
          'Comparison ready — the saved analysis was cut short, so some sections '
          + 'were never recorded. The document says which.',
          { duration: 8_000 },
        );
      } else {
        toast.success('Property Comparison Analysis ready');
      }
      onDelivered?.();
    } catch (e) {
      console.error('[ComparisonDownloadButton]', e);
      toast.error(e instanceof Error ? e.message : 'Could not produce the comparison');
    } finally {
      setRunning(false);
    }
  };

  // One menu body, used by both appearances, so the two choices cannot drift
  // apart between a card footer and a dialog title bar.
  const choices = (
    <DropdownMenuContent align="end" className="w-80">
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        The comparison, two ways
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={(e) => { e.preventDefault(); run(); }}
        className="cursor-pointer"
      >
        <FileText className="mr-2 h-4 w-4 text-primary" />
        <div className="flex flex-col">
          <span>{label} (typeset)</span>
          <span className="text-xs text-muted-foreground">
            Typeset from the saved analysis, on your branding. Free, and the same every time.
          </span>
        </div>
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={(e) => { e.preventDefault(); onOpenLegacy?.(); }}
        disabled={!onOpenLegacy}
        className="cursor-pointer"
      >
        <Wand2 className="mr-2 h-4 w-4 text-muted-foreground" />
        <div className="flex flex-col">
          <span>Download the AI-written report</span>
          <span className="text-xs text-muted-foreground">
            {onOpenLegacy
              ? 'Re-written by AI on every download — uses report credits, and the wording differs each time.'
              : 'Open the comparison to reach the AI-written report.'}
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
            disabled={disabled || running}
            aria-label={triggerLabel ?? label}
            className={className}
          >
            {running
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
        disabled={disabled || running}
        onClick={run}
        className="rounded-r-none"
      >
        {running
          ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
        {running ? 'Rendering…' : label}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            disabled={disabled || running}
            aria-label="Other comparison formats"
            className="rounded-l-none border-l-0 px-2"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        {choices}
      </DropdownMenu>
      {template.dialog}
    </div>
  );
}
