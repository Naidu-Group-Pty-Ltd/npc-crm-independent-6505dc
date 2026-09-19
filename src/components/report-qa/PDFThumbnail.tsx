import { useState, useEffect } from 'react';
import { FileText, Eye, X, Loader2, FileWarning, CheckCircle2, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface PDFThumbnailProps {
  fileName: string;
  content: string;
  uploadedAt: Date;
  fileSizeBytes?: number;
  totalPages?: number;
  onRemove?: () => void;
  isActive?: boolean;
  onClick?: () => void;
  className?: string;
}

export function PDFThumbnail({
  fileName,
  content,
  uploadedAt,
  fileSizeBytes,
  totalPages,
  onRemove,
  isActive,
  onClick,
  className
}: PDFThumbnailProps) {
  const [showPreview, setShowPreview] = useState(false);

  const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };
  
  // Extract first ~500 chars as preview text
  const previewText = content.substring(0, 500).replace(/\n+/g, ' ').trim();
  const wordCount = content.split(/\s+/).length;
  const pageEstimate = Math.ceil(wordCount / 300); // Rough estimate: ~300 words per page
  const displayPages = totalPages && totalPages > 0 ? totalPages : pageEstimate;
  
  // Get file size estimate based on content length
  const contentSizeKB = Math.round(content.length / 1024);
  const displaySize = fileSizeBytes && fileSizeBytes > 0 ? formatBytes(fileSizeBytes) : `${contentSizeKB}KB`;
  
  return (
    <div 
      className={cn(
        "group relative rounded-lg border-2 transition-all cursor-pointer overflow-hidden",
        isActive 
          ? "border-primary bg-primary/5 ring-2 ring-primary/20" 
          : "border-border hover:border-primary/50 bg-muted/30",
        className
      )}
      onClick={onClick}
    >
      {/* Thumbnail preview area */}
      <div className="aspect-[3/4] relative bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
        {/* Decorative PDF icon with lines */}
        <div className="absolute inset-4 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded bg-destructive/20 flex items-center justify-center">
              <FileText className="h-3.5 w-3.5 text-destructive" />
            </div>
            <div className="flex-1 h-2 bg-muted-foreground/10 rounded" />
          </div>
          {/* Fake content lines */}
          <div className="flex-1 space-y-1.5">
            {[...Array(6)].map((_, i) => (
              <div 
                key={i} 
                className="h-1.5 bg-muted-foreground/10 rounded" 
                style={{ width: `${70 + Math.random() * 30}%` }}
              />
            ))}
          </div>
        </div>
        
        {/* Active indicator */}
        {isActive && (
          <div className="absolute top-2 right-2">
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
              ACTIVE
            </span>
          </div>
        )}
        
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-background dark:bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Dialog open={showPreview} onOpenChange={setShowPreview}>
            <DialogTrigger asChild>
              <Button 
                variant="secondary" 
                size="sm" 
                className="gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <Eye className="h-3.5 w-3.5" />
                Preview
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-destructive" />
                  {fileName}
                </DialogTitle>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh]">
                <div className="p-4 bg-muted/50 rounded-lg font-mono text-xs whitespace-pre-wrap">
                  {content.substring(0, 5000)}
                  {content.length > 5000 && (
                    <span className="text-muted-foreground italic">
                      ... ({content.length - 5000} more characters)
                    </span>
                  )}
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      
      {/* Info footer */}
      <div className="p-2 border-t bg-background">
        <div className="flex items-start justify-between gap-1">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" title={fileName}>
              {fileName.replace('.pdf', '')}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {displayPages} pages • {displaySize}
            </p>
          </div>
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface UploadProgressItemProps {
  fileName: string;
  progress: number;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  error?: string;
  /** Removes the entry from the upload list — errors otherwise stay forever. */
  onDismiss?: () => void;
}

export function UploadProgressItem({ fileName, progress, status, error, onDismiss }: UploadProgressItemProps) {
  const isPending = status === 'uploading' || status === 'processing';
  const statusLabel =
    status === 'error' ? 'Error' :
    status === 'complete' ? 'Ready' :
    status === 'processing' ? 'Processing…' :
    `${progress}%`;
  const helperCopy =
    status === 'error' ? 'Upload error' :
    status === 'complete' ? 'Report uploaded and ready for Q&A' :
    status === 'processing' ? 'Parsing report content for retrieval' :
    'Uploading report securely';

  return (
    <div
      className={cn(
        "rounded-2xl border p-3 shadow-sm transition-all",
        status === 'error'
          ? "border-destructive/30 bg-destructive/10"
          : status === 'complete'
            ? "border-success/30 bg-success/10"
            : "border-brand-500/30 bg-brand-500/10"
      )}
    >
      <div className="flex items-start gap-3">
      <div
        className={cn(
          "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border shadow-sm",
          status === 'error'
            ? "border-destructive/25 bg-destructive/15 text-destructive"
            : status === 'complete'
              ? "border-success/25 bg-success/15 text-success"
              : "border-brand-500/25 bg-brand-500/15 text-brand-500"
        )}
      >
        {status === 'error' ? (
          <FileWarning className="h-5 w-5" />
        ) : status === 'complete' ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : status === 'uploading' ? (
          <UploadCloud className="h-5 w-5" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{fileName}</p>
            <p
              className={cn(
                "mt-0.5 text-xs",
                status === 'error'
                  ? "text-destructive"
                  : status === 'complete'
                    ? "text-success dark:text-success"
                    : "text-brand-600 dark:text-brand-300"
              )}
            >
              {helperCopy}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]",
                status === 'error'
                  ? "border-destructive/25 bg-destructive/10 text-destructive"
                  : status === 'complete'
                    ? "border-success/25 bg-success/10 text-success dark:text-success"
                    : "border-brand-500/25 bg-brand-500/10 text-brand-600 dark:text-brand-300"
              )}
            >
              {statusLabel}
            </span>
            {onDismiss && !isPending && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label={`Dismiss ${fileName} from the upload list`}
                title="Remove from upload list"
                className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-2 overflow-hidden rounded-full bg-background/70 shadow-inner">
            <div 
              className={cn(
                "h-full rounded-full transition-all duration-500",
                status === 'error' ? "bg-destructive" :
                status === 'complete' ? "bg-gradient-to-r from-success to-success" :
                "bg-gradient-to-r from-brand-500 via-brand-400 to-warning",
                isPending && "animate-pulse"
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {error && (
          <p className="mt-2 rounded-lg border border-destructive/20 bg-background/60 px-2 py-1.5 text-xs text-destructive">{error}</p>
        )}
      </div>
      </div>
    </div>
  );
}
