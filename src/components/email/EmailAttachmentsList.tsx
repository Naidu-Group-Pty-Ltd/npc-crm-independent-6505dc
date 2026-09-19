import { useEffect, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Paperclip,
  Eye,
  Download,
  FileIcon,
  Image as ImageIcon,
  FileText,
  X,
  Loader2,
} from 'lucide-react';

export interface EmailAttachment {
  name: string;
  contentType: string;
  size: number;
  /** Legacy: permanent (public) URL. May be absent on newer records. */
  storageUrl?: string | null;
  /** Preferred: object path resolved to a short-lived signed URL on demand. */
  storagePath?: string | null;
  storageBucket?: string | null;
}

interface EmailAttachmentsListProps {
  attachments: EmailAttachment[];
}

/**
 * Resolve a viewable URL for each attachment. Newer records carry a storagePath
 * (bucket is or will become private) — fetch a fresh signed URL via the
 * secure-storage proxy. Older records fall back to their stored storageUrl.
 * Returns a map keyed by attachment index.
 */
function useResolvedAttachmentUrls(attachments: EmailAttachment[]): Record<number, string> {
  const [urls, setUrls] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resolved: Record<number, string> = {};
      await Promise.all(
        attachments.map(async (att, i) => {
          // Prefer the object path; for legacy records that only have a stored
          // public URL, parse the bucket+path out of it so we can still fetch a
          // signed URL once the bucket is private (STOR-004).
          let bucket = att.storageBucket || 'email-attachments';
          let path = att.storagePath || null;
          if (!path && att.storageUrl) {
            const m = att.storageUrl.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
            if (m) { bucket = m[1]; path = decodeURIComponent(m[2]); }
          }
          if (path) {
            const { data } = await invokeSecureFunction('secure-storage', {
              operation: 'signedUrl', bucket, path, expires_in: 900,
            });
            const signed = (data as any)?.data?.signedUrl;
            if (signed) { resolved[i] = signed; return; }
          }
          if (att.storageUrl) resolved[i] = att.storageUrl; // last-resort legacy fallback
        }),
      );
      if (!cancelled) setUrls(resolved);
    })();
    return () => { cancelled = true; };
  }, [attachments]);

  return urls;
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadFile(url: string, name: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function AttachmentIcon({ contentType }: { contentType: string }) {
  if (contentType?.startsWith('image/')) return <ImageIcon className="h-4 w-4 text-primary" />;
  if (contentType === 'application/pdf') return <FileText className="h-4 w-4 text-primary" />;
  return <FileIcon className="h-4 w-4 text-primary" />;
}

function ImageThumb({
  attachment,
  url,
  onOpen,
}: {
  attachment: EmailAttachment;
  url: string | undefined;
  onOpen: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative h-32 w-32 overflow-hidden rounded-2xl border border-border/70 bg-muted/30 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
      title={`Preview ${attachment.name}`}
    >
      {!loaded && !errored && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {!errored && url ? (
        <img
          src={url}
          alt={attachment.name}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          className={`h-full w-full object-cover transition-opacity ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 truncate bg-background/85 px-2 py-1 text-[10px] font-medium text-foreground backdrop-blur-sm">
        {attachment.name}
      </div>
    </button>
  );
}

export default function EmailAttachmentsList({ attachments }: EmailAttachmentsListProps) {
  const [preview, setPreview] = useState<{ att: EmailAttachment; url: string | undefined } | null>(null);
  const urls = useResolvedAttachmentUrls(attachments || []);

  if (!attachments || attachments.length === 0) return null;

  const entries = attachments.map((att, i) => ({ att, i, url: urls[i] }));
  const images = entries.filter((e) => e.att.contentType?.startsWith('image/'));
  const others = entries.filter((e) => !e.att.contentType?.startsWith('image/'));

  const isPreviewable = (a: EmailAttachment) =>
    a.contentType?.startsWith('image/') || a.contentType === 'application/pdf';

  return (
    <div className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-[linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.88))] shadow-[0_18px_48px_hsl(var(--background)/0.16)]">
      <div className="flex items-center gap-2 border-b border-border/55 bg-muted/20 px-5 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-primary/10">
          <Paperclip className="h-4 w-4 text-primary" />
        </span>
        <span className="text-sm font-semibold text-foreground">Attachments ({attachments.length})</span>
      </div>

      <div className="space-y-5 p-5">
        {images.length > 0 && (
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Images
            </p>
            <div className="flex flex-wrap gap-3">
              {images.map(({ att, i, url }) => (
                <ImageThumb
                  key={`img-${i}`}
                  attachment={att}
                  url={url}
                  onOpen={() => setPreview({ att, url })}
                />
              ))}
            </div>
          </div>
        )}

        {others.length > 0 && (
          <div className="space-y-2">
            {others.map(({ att: attachment, i: index, url }) => (
              <div
                key={`file-${index}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border/65 bg-muted/20 p-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:bg-muted/35 hover:shadow-md"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="rounded-xl border border-primary/15 bg-primary/10 p-2.5 shadow-inner">
                    <AttachmentIcon contentType={attachment.contentType} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground" title={attachment.name}>{attachment.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatSize(attachment.size)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {isPreviewable(attachment) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary"
                      onClick={() => setPreview({ att: attachment, url })}
                      title="Preview"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary"
                    onClick={() => url && downloadFile(url, attachment.name)}
                    disabled={!url}
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-5xl p-0">
          <DialogHeader className="border-b px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="truncate text-sm">{preview?.att.name}</DialogTitle>
              <div className="flex items-center gap-1">
                {preview?.url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => preview.url && downloadFile(preview.url, preview.att.name)}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setPreview(null)}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </DialogHeader>
          <div className="h-[80vh] w-full bg-muted/30">
            {preview?.att.contentType?.startsWith('image/') ? (
              <div className="flex h-full w-full items-center justify-center overflow-auto p-4">
                <img
                  src={preview.url}
                  alt={preview.att.name}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : preview?.att.contentType === 'application/pdf' ? (
              <iframe
                key={preview.url}
                src={preview.url}
                title={preview.att.name}
                className="h-full w-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Preview not available for this file type.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
