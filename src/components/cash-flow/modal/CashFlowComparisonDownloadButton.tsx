/**
 * The one control that hands someone a typeset Cash Flow Comparison Analysis.
 *
 * Pressing it sends the projections on screen to the server and saves the
 * document that comes back. It sits beside the two Export PDF buttons that
 * already exist rather than replacing either, and it is the only one of the
 * three that puts the ten years of every property in the comparison into a
 * client's hands.
 *
 * ## It is not gated on the written analysis, deliberately
 *
 * `exportAiAnalysisPDF` returns without drawing anything when `aiAnalysis` is
 * null, so today an adviser who has not pressed "Generate AI Analysis" has no
 * way to hand over the comparison at all. Here the analysis is a suffix: the
 * tables are the document, and a comparison without model prose is a complete
 * report that says so on its last section.
 *
 * ## What the caller passes
 *
 * A `WireComparison` built by `toWireComparison`, or null when there is not yet
 * a comparison to send — fewer than two properties, or projections that have not
 * finished computing. Null disables the button and says why, rather than hiding
 * it: a missing control reads as a feature that does not exist.
 */
import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { deliverCashFlowComparisonPdf } from '@/lib/reports/cashFlowComparison/deliverCashFlowComparisonPdf';
import type { WireComparison } from '@/lib/reports/cashFlowComparison/toWireComparison';

export interface CashFlowComparisonDownloadButtonProps {
  /** Built fresh on each press by the host, so it carries unsaved overrides. */
  build: () => WireComparison | null;
  label?: string;
  /** Why the button is unavailable, when it is. Shown in a tooltip. */
  unavailableReason?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
  onDelivered?: () => void;
}

export function CashFlowComparisonDownloadButton({
  build,
  label = 'Typeset comparison',
  unavailableReason,
  variant = 'outline',
  size = 'sm',
  className,
  onDelivered,
}: CashFlowComparisonDownloadButtonProps) {
  const [running, setRunning] = useState(false);
  const disabled = Boolean(unavailableReason) || running;

  const run = async () => {
    if (running) return;
    // Built at press time rather than held in state, so the document carries the
    // overrides as they are at the moment someone asks for it.
    const comparison = build();
    if (!comparison) {
      toast.error(unavailableReason || 'There is nothing to compare yet');
      return;
    }

    setRunning(true);
    try {
      const result = await deliverCashFlowComparisonPdf(comparison);

      if (result.brandGaps.length) {
        // Said at the moment someone is about to send it, not buried in a log.
        toast.warning(`Comparison ready, with gaps: ${result.brandGaps.join('; ')}`);
      } else if (result.hasAnalysis && result.missingSections.length) {
        // The document says this in its last section too. Repeated here because
        // the moment that matters is the one before it is emailed.
        toast.warning(
          `Comparison ready — the written analysis is missing ${result.missingSections.length} `
          + 'of its sections. Every figure in the document is unaffected.',
          { duration: 8_000 },
        );
      } else {
        toast.success(
          `Cash Flow Comparison ready — ${result.propertyCount} properties`
          + `${result.pageCount ? `, ${result.pageCount} pages` : ''}`,
        );
      }
      onDelivered?.();
    } catch (e) {
      console.error('[CashFlowComparisonDownloadButton]', e);
      toast.error(e instanceof Error ? e.message : 'Could not produce the comparison');
    } finally {
      setRunning(false);
    }
  };

  const button = (
    <Button
      variant={variant}
      size={size}
      disabled={disabled}
      onClick={run}
      className={cn('gap-2', className)}
    >
      {running
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : <Sparkles className="h-4 w-4 text-primary" />}
      {running ? 'Rendering…' : label}
    </Button>
  );

  if (!unavailableReason) return button;

  // Disabled controls do not fire pointer events, so the trigger wraps a span
  // that does — otherwise the reason a button is unavailable is unreachable by
  // exactly the person who needs it.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{button}</span>
      </TooltipTrigger>
      <TooltipContent>{unavailableReason}</TooltipContent>
    </Tooltip>
  );
}
