/**
 * The one control that produces a Borrowing Capacity Snapshot.
 *
 * A split button: pressing it renders server-side, and the caret beside it
 * offers the in-browser generator that has produced this document for the life
 * of the product. Both are first-class — see `deliverSnapshot.ts` for why the
 * legacy path is a choice here rather than a fallback nobody can reach.
 *
 * There are four surfaces that produce this document (the results panel, the
 * client card, the client reports tab, and the scenario modeller), and before
 * this component they had four slightly different buttons, three different
 * toast vocabularies and two different sets of failure handling. One control
 * means the answer to "how do I get this PDF" is the same wherever you are, and
 * that the legacy option cannot be present on three of them and missing from the
 * fourth.
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
  deliverSnapshot,
  type LegacySnapshot,
  type SnapshotVariant,
} from '@/lib/reports/borrowingCapacity/deliverSnapshot';
import type { SnapshotRequest } from '@/lib/reports/borrowingCapacity/requestSnapshot';

export interface SnapshotDownloadButtonProps {
  /**
   * What to ask the server for.
   *
   * A function when the request depends on state that must be read at the
   * moment of the click rather than at render: the scenario modeller builds a
   * transient preset from the live what-if inputs, and evaluating that on every
   * render would mint a new preset id each time.
   */
  request: SnapshotRequest | (() => SnapshotRequest);
  /** The in-browser generator, bound to what this call site knows. */
  legacy: () => Promise<LegacySnapshot>;
  /** Shown on the primary action. */
  label?: string;
  /**
   * What the legacy item says it gives you.
   *
   * The scenario modeller passes its own wording: there, the two renderers
   * genuinely produce different documents, and "legacy layout" alone would not
   * tell an adviser which one shows their unsaved what-if.
   */
  legacyLabel?: string;
  /** A line under the legacy item, when it needs one. */
  legacyHint?: string;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  disabled?: boolean;
  /** Called after either renderer succeeds. */
  onDelivered?: (source: 'server' | 'legacy') => void;
  /**
   * `split` — a primary action with a caret beside it. The default, and right
   * wherever there is room for a labelled button.
   *
   * `menu` — one button that opens the two choices. For a card header, where a
   * split button would be wider than the title beside it. Both offer exactly
   * the same two options; the only thing that changes is how much room it takes.
   */
  appearance?: 'split' | 'menu';
  /** `menu` only: rendered inside the trigger instead of the label. */
  icon?: ReactNode;
  /** `menu` only: the trigger's accessible name when it shows only an icon. */
  triggerLabel?: string;
}

export function SnapshotDownloadButton({
  request,
  legacy,
  label = 'Download snapshot',
  legacyLabel = 'Download (legacy layout)',
  legacyHint,
  variant = 'outline',
  size = 'sm',
  className,
  disabled = false,
  onDelivered,
  appearance = 'split',
  icon,
  triggerLabel,
}: SnapshotDownloadButtonProps) {
  const [running, setRunning] = useState<SnapshotVariant | null>(null);
  // Which template this comes out in, offered beside the button that uses it.
  const template = useReportTemplateMenu('borrowing_capacity');

  const run = async (which: SnapshotVariant) => {
    if (running) return;
    setRunning(which);
    try {
      const result = await deliverSnapshot({
        variant: which,
        request: typeof request === 'function' ? request() : request,
        legacy,
      });

      if (result.brandGaps.length) {
        // Said at the moment someone is about to send it, not buried in a log.
        toast.warning(`Snapshot ready, with gaps: ${result.brandGaps.join('; ')}`);
      } else if (which === 'server' && result.source === 'legacy') {
        toast.info('Rendered with the legacy layout — the server renderer is not deployed yet.');
      } else {
        toast.success('Borrowing Capacity Snapshot ready');
      }
      onDelivered?.(result.source);
    } catch (e) {
      console.error('[SnapshotDownloadButton]', e);
      toast.error(e instanceof Error ? e.message : 'Could not generate the snapshot');
    } finally {
      setRunning(null);
    }
  };

  const busy = running !== null;

  // One menu body, used by both appearances, so the two choices cannot drift
  // apart between a card header and a panel toolbar.
  const choices = (
    <DropdownMenuContent align="end" className="w-72">
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        The snapshot, two ways
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => run('server')} className="cursor-pointer">
        <FileText className="mr-2 h-4 w-4 text-primary" />
        <div className="flex flex-col">
          <span>{label}</span>
          <span className="text-xs text-muted-foreground">
            Typeset server-side, on your branding
          </span>
        </div>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => run('legacy')} className="cursor-pointer">
        <FileDown className="mr-2 h-4 w-4 text-muted-foreground" />
        <div className="flex flex-col">
          <span>{legacyLabel}</span>
          <span className="text-xs text-muted-foreground">
            {legacyHint ?? 'The layout this report has always used'}
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
            aria-label="Other snapshot formats"
            className="rounded-l-none border-l-0 px-2"
          >
            {running === 'legacy'
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
