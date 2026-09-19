/**
 * Attachment chips for internal messages — used by both the Aurixa messages
 * panel and the pop-up conversation bubbles.
 */
import { useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  RotateCcw,
  ShieldCheck,
  ShieldQuestion,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  attachmentScanStatus,
  formatAttachmentSize,
  isImageAttachment,
  openInternalAttachment,
  type InternalAttachment,
} from '@/lib/internalMessageAttachments';
import type { QueueItem } from '@/hooks/useInternalAttachmentQueue';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

/** Read-only list rendered inside a message bubble. */
export function InternalAttachmentList({
  threadId,
  attachments,
  mine,
  className,
}: {
  threadId: string;
  attachments: InternalAttachment[];
  mine?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!attachments?.length) return null;

  return (
    <div className={cn('mt-1 flex flex-col gap-1', className)}>
      {attachments.map((a) => {
        const Icon = isImageAttachment(a) ? ImageIcon : FileText;
        const scan = attachmentScanStatus(a);
        return (
          <button
            key={a.path}
            type="button"
            onClick={async () => {
              setBusy(a.path);
              try {
                await openInternalAttachment(threadId, a, true);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : `Could not download ${a.name}`);
              } finally {
                setBusy(null);
              }
            }}
            className={cn(
              'flex max-w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left text-[11px] transition-colors',
              mine
                ? 'border-primary-foreground/25 bg-primary-foreground/10 hover:bg-primary-foreground/20'
                : 'border-border/60 bg-background/60 hover:bg-muted',
            )}
            title={
              scan === 'clean'
                ? `Open ${a.name} — safety checked`
                : scan === 'unscanned'
                  ? `Open ${a.name} — not virus-scanned`
                  : `Open ${a.name}`
            }
          >
            {busy === a.path ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <Icon className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
            {a.size ? (
              <span className="shrink-0 opacity-70">{formatAttachmentSize(a.size)}</span>
            ) : null}
            {scan === 'clean' && (
              <ShieldCheck className="h-3 w-3 shrink-0 text-success" aria-label="Safety checked" />
            )}
            {scan === 'unscanned' && (
              <ShieldQuestion
                className="h-3 w-3 shrink-0 text-warning"
                aria-label="Not virus-scanned"
              />
            )}
            <Download className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Staged files shown above the composer, with per-file progress and a retry
 * button for anything that failed.
 */
export function InternalAttachmentQueue({
  items,
  onRemove,
  onRetry,
  className,
}: {
  items: QueueItem[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  className?: string;
}) {
  if (!items.length) return null;

  return (
    <div className={cn('mb-2 flex flex-col gap-1.5', className)}>
      {items.map((item) => {
        const failed = item.status === 'error' || item.status === 'cancelled';
        const pct = Math.round(item.progress * 100);
        return (
          <div
            key={item.id}
            className={cn(
              'rounded-xl border px-2.5 py-1.5',
              failed
                ? 'border-destructive/50 bg-destructive/5'
                : item.status === 'done'
                  ? 'border-success/40 bg-success/5'
                  : 'border-border/60 bg-muted/40',
            )}
          >
            <div className="flex items-center gap-1.5">
              {failed ? (
                <AlertTriangle className="h-3 w-3 shrink-0 text-destructive" aria-hidden />
              ) : item.status === 'uploading' ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" aria-hidden />
              ) : (
                <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate text-[10px] font-medium">
                {item.file.name}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {formatAttachmentSize(item.file.size)}
              </span>
              {failed && (
                <button
                  type="button"
                  aria-label={`Retry upload of ${item.file.name}`}
                  title="Retry upload"
                  onClick={() => onRetry(item.id)}
                  className="shrink-0 rounded-full p-0.5 text-destructive hover:bg-destructive/10"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
              {item.status !== 'uploading' && (
                <button
                  type="button"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => onRemove(item.id)}
                  className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>

            {item.status === 'uploading' && (
              <div className="mt-1 flex items-center gap-2">
                <Progress value={pct} className="h-1 flex-1" />
                <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">
                  {pct}%
                  {item.attempt > 1 ? ` · retry ${item.attempt - 1}/${item.attempts - 1}` : ''}
                </span>
              </div>
            )}
            {failed && item.error && (
              <p className="mt-0.5 text-[9px] leading-tight text-destructive">{item.error}</p>
            )}
            {item.status === 'done' && (
              <p className="mt-0.5 text-[9px] leading-tight text-success">Uploaded</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Full-surface drop hint overlay. */
export function AttachmentDropOverlay({ label = 'Drop files to attach' }: { label?: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] border-2 border-dashed border-primary/60 bg-primary/10 backdrop-blur-sm">
      <span className="flex items-center gap-2 rounded-full bg-card/90 px-3 py-1.5 text-[11px] font-semibold text-primary shadow-sm">
        <Paperclip className="h-3.5 w-3.5" /> {label}
      </span>
    </div>
  );
}
