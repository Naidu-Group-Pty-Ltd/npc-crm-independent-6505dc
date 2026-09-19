/**
 * PdfDownloadSplitButton — drop-in replacement for a single "Download PDF"
 * button. Renders a primary button (runs the existing onClick unchanged) plus
 * a chevron that opens a menu with a "Download as Flattened PDF" action.
 *
 * For surfaces where the existing UI is already a dropdown, prefer
 * `<FlattenPdfMenuItem>` directly instead.
 */
import { ReactNode, useState } from 'react';
import { ChevronDown, Download, FileLock2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { flattenAndDownloadPdf } from '@/lib/pdf/downloadPdf';

export interface PdfDownloadSplitButtonProps {
  /** Primary click handler — kept identical to the current behaviour. */
  onPrimaryClick: () => void | Promise<void>;
  /** Async producer of the PDF Blob — used only when the user picks Flatten. */
  getPdfBlob: () => Promise<Blob>;
  /** Filename for the flattened download (a `-flattened` suffix is appended). */
  filename: string;
  /** Primary button label. Default: "Download PDF". */
  primaryLabel?: ReactNode;
  /** Disable both halves (e.g. while the underlying report is loading). */
  disabled?: boolean;
  /** Show a loading state on the primary button. */
  loading?: boolean;
  /** Visual variant for the primary button — matches shadcn Button variants. */
  variant?: React.ComponentProps<typeof Button>['variant'];
  /** Size pass-through. */
  size?: React.ComponentProps<typeof Button>['size'];
  /** Optional className applied to the wrapping container. */
  className?: string;
  /** Primary button icon override. Defaults to a download glyph. */
  primaryIcon?: ReactNode;
}

export function PdfDownloadSplitButton({
  onPrimaryClick,
  getPdfBlob,
  filename,
  primaryLabel = 'Download PDF',
  disabled,
  loading,
  variant = 'default',
  size = 'default',
  className,
  primaryIcon,
}: PdfDownloadSplitButtonProps) {
  const { toast } = useToast();
  const [flattening, setFlattening] = useState(false);

  const handleFlatten = async (e: Event) => {
    e.preventDefault();
    if (flattening || disabled) return;
    setFlattening(true);
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
      setFlattening(false);
    }
  };

  const busy = !!loading;

  return (
    <div className={`inline-flex items-stretch ${className ?? ''}`}>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled || busy}
        onClick={() => {
          if (busy) return;
          void onPrimaryClick();
        }}
        className="rounded-r-none"
      >
        {busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          primaryIcon ?? <Download className="mr-2 h-4 w-4" />
        )}
        {primaryLabel}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size={size}
            disabled={disabled || busy || flattening}
            aria-label="More download options"
            className="rounded-l-none border-l border-l-background/30 px-2"
          >
            {flattening ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={handleFlatten} disabled={flattening}>
            <FileLock2 className="mr-2 h-4 w-4" />
            {flattening ? 'Flattening…' : 'Download as Flattened PDF'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
