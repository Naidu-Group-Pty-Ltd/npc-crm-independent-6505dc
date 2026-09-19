/**
 * FlattenPdfMenuItem — a drop-in `<DropdownMenuItem>` that flattens a generated
 * PDF and downloads it. Use inside any existing dropdown that already exposes
 * a normal "Download PDF" item.
 *
 * Usage:
 *   <DropdownMenu>
 *     <DropdownMenuTrigger>…</DropdownMenuTrigger>
 *     <DropdownMenuContent>
 *       <DropdownMenuItem onClick={handleDownload}>Download PDF</DropdownMenuItem>
 *       <FlattenPdfMenuItem getPdfBlob={getPdfBlob} filename="foo.pdf" />
 *     </DropdownMenuContent>
 *   </DropdownMenu>
 */
import { useState } from 'react';
import { FileLock2, Loader2 } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { flattenAndDownloadPdf } from '@/lib/pdf/downloadPdf';
import { cn } from '@/lib/utils';

export interface FlattenPdfMenuItemProps {
  /** Async producer of the PDF Blob — runs only when the user clicks Flatten. */
  getPdfBlob: () => Promise<Blob>;
  /** Filename for the flattened download (a `-flattened` suffix is appended). */
  filename: string;
  /** Label override; defaults to "Download as Flattened PDF". */
  label?: string;
  /** Optional disabled flag (e.g. when the source isn't ready yet). */
  disabled?: boolean;
  /** Optional styling hook for menu-specific item presentation. */
  className?: string;
}

export function FlattenPdfMenuItem({
  getPdfBlob,
  filename,
  label = 'Download as Flattened PDF',
  disabled,
  className,
}: FlattenPdfMenuItemProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleClick = async (e: Event) => {
    e.preventDefault();
    if (busy || disabled) return;
    setBusy(true);
    try {
      toast({
        title: 'Flattening PDF…',
        description: 'Rasterising every page. This may take a few seconds for large reports.',
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

  return (
    <DropdownMenuItem onSelect={handleClick} disabled={disabled || busy} className={cn(className)}>
      {busy ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <FileLock2 className="mr-2 h-4 w-4" />
      )}
      {busy ? 'Flattening…' : label}
    </DropdownMenuItem>
  );
}
