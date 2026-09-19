/**
 * FlattenPdfIconButton — a tiny secondary button you can drop next to ANY
 * existing "Download PDF" trigger without restructuring it. Clicking it
 * generates the PDF via the same producer the host already uses, runs the
 * bytes through the flatten pipeline (rasterise every page, image-only output)
 * and downloads the result.
 *
 * Designed to be the universal additive surface for "Download as Flattened
 * PDF" across the entire dashboard.
 */
import { ReactNode, useState } from 'react';
import { FileLock2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { flattenAndDownloadPdf } from '@/lib/pdf/downloadPdf';

export interface FlattenPdfIconButtonProps {
  /** Async producer of the PDF Blob — invoked only when the user clicks. */
  getPdfBlob: () => Promise<Blob>;
  /** Filename for the flattened download (a `-flattened` suffix is appended). */
  filename: string;
  /** Disable while the host's primary download is busy or unavailable. */
  disabled?: boolean;
  /** Optional override label (rendered for `inline` variant). */
  label?: ReactNode;
  /** Visual variant for the button. */
  variant?: React.ComponentProps<typeof Button>['variant'];
  /** Size pass-through. */
  size?: React.ComponentProps<typeof Button>['size'];
  /** Render the label inline instead of just an icon with a tooltip. */
  inline?: boolean;
  /** Optional className for the button itself. */
  className?: string;
}

export function FlattenPdfIconButton({
  getPdfBlob,
  filename,
  disabled,
  label = 'Download flattened PDF',
  variant = 'outline',
  size = 'sm',
  inline = false,
  className,
}: FlattenPdfIconButtonProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      toast({
        title: 'Flattening PDF…',
        description: 'Rasterising every page. Larger reports may take 10-30 seconds.',
      });
      const blob = await getPdfBlob();
      await flattenAndDownloadPdf(blob, filename);
      toast({ title: 'Flattened PDF downloaded' });
    } catch (err) {
      console.error('[flatten-pdf]', err);
      toast({
        title: 'Flatten failed',
        description: err instanceof Error ? err.message : 'Unable to flatten the PDF.',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const buttonNode = (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled || busy}
      onClick={handleClick}
      aria-label={typeof label === 'string' ? label : 'Download flattened PDF'}
      className={className}
    >
      {busy ? (
        <Loader2 className={`h-4 w-4 animate-spin ${inline ? 'mr-2' : ''}`} />
      ) : (
        <FileLock2 className={`h-4 w-4 ${inline ? 'mr-2' : ''}`} />
      )}
      {inline ? (busy ? 'Flattening…' : label) : null}
    </Button>
  );

  if (inline) return buttonNode;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{buttonNode}</TooltipTrigger>
        <TooltipContent side="top">{busy ? 'Flattening…' : label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
