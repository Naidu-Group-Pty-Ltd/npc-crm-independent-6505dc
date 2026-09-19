/**
 * Shared Messages thread UI component used in both partner-side (Finance Portal)
 * and internal staff-side (admin) contexts.
 *
 * The parent supplies the invoke function so this component is auth-agnostic:
 *  - Partner side: useFinancePortalAuth().invokeFinanceFunction
 *  - Staff side:   invokeSecureFunction wrapper
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Send, Paperclip, Download, X, ShieldCheck } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
// Audit item 48 — who sent this, and how the bubble reads.
import { bubbleClassFor, senderIdentity } from '@/lib/finance-portal/messageSender.pure';

export interface ThreadMessage {
  id: string;
  thread_id: string;
  sender_type: 'partner' | 'staff' | 'client';
  sender_name: string | null;
  body: string;
  attachment_path: string | null;
  attachment_filename: string | null;
  attachment_mime: string | null;
  attachment_size_bytes: number | null;
  created_at: string;
}

export type InvokeFn = (fn: string, body: any) => Promise<{ data: any; error: any }>;

interface Props {
  threadId: string;
  /** 'partner' = current user is a finance partner; 'staff' = current user is internal staff */
  viewerSide: 'partner' | 'staff';
  invoke: InvokeFn;
  onMessageSent?: () => void;
  /** Polling interval in ms, default 8s */
  pollMs?: number;
  className?: string;
  fillContainer?: boolean;
}

const formatStamp = (iso: string) => {
  const d = new Date(iso);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`;
  return format(d, 'd MMM, h:mm a');
};

const formatBytes = (n: number | null) => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export function FinanceMessagesThread({ threadId, viewerSide, invoke, onMessageSent, pollMs = 8000, className, fillContainer = false }: Props) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);

  const load = async (markRead = false) => {
    const { data, error } = await invoke('finance-portal-messages', {
      operation: 'list_messages',
      thread_id: threadId,
    });
    if (error) {
      console.error('[FinanceMessagesThread] load error', error);
      setLoading(false);
      return;
    }
    const list = (data?.messages || []) as ThreadMessage[];
    setMessages(list);
    setLoading(false);
    if (markRead) {
      invoke('finance-portal-messages', { operation: 'mark_thread_read', thread_id: threadId }).catch(() => {});
    }
  };

  useEffect(() => {
    setLoading(true);
    load(true);
    const id = setInterval(() => load(true), pollMs);
    return () => clearInterval(id);
  }, [threadId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    if (messages.length !== lastCountRef.current) {
      lastCountRef.current = messages.length;
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }, 50);
    }
  }, [messages.length]);

  const handleAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) {
      toast.error('File too large (max 25 MB)');
      return;
    }
    setAttachment(f);
  };

  const send = async () => {
    const trimmed = draft.trim();
    if (!trimmed && !attachment) return;
    setSending(true);
    try {
      let attachmentMeta: any = null;
      if (attachment) {
        setUploading(true);
        const { data: signed, error: sErr } = await invoke('finance-portal-messages', {
          operation: 'upload_attachment_url',
          thread_id: threadId,
          filename: attachment.name,
          mime: attachment.type,
          size: attachment.size,
        });
        if (sErr || !signed?.signedUrl) throw new Error(sErr?.message || 'Upload URL failed');

        const putRes = await fetch(signed.signedUrl, {
          method: 'PUT',
          body: attachment,
          headers: { 'content-type': attachment.type || 'application/octet-stream' },
        });
        if (!putRes.ok) throw new Error('Upload failed');
        attachmentMeta = {
          path: signed.path,
          filename: attachment.name,
          mime: attachment.type,
          size: attachment.size,
        };
        setUploading(false);
      }

      const { error } = await invoke('finance-portal-messages', {
        operation: 'send_message',
        thread_id: threadId,
        body: trimmed,
        attachment: attachmentMeta,
      });
      if (error) throw new Error(error.message);

      setDraft('');
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onMessageSent?.();
      await load(false);
    } catch (e: any) {
      toast.error(e.message || 'Failed to send');
    } finally {
      setSending(false);
      setUploading(false);
    }
  };

  const downloadAttachment = async (messageId: string, filename: string) => {
    try {
      const { data, error } = await invoke('finance-portal-messages', {
        operation: 'get_attachment_url',
        message_id: messageId,
      });
      if (error || !data?.url) throw new Error(error?.message || 'Could not get download URL');
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      toast.error(e.message || 'Download failed');
    }
  };

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card', fillContainer ? 'h-full' : 'h-[600px]', className)}>
      <ScrollArea className="flex-1 bg-[radial-gradient(circle_at_top,rgba(139,92,246,0.07),transparent_34%)] p-4 [scrollbar-color:rgba(139,92,246,0.4)_rgba(24,24,27,0.9)]" ref={scrollRef as any}>
        {loading ? (
          <div className="mx-auto my-12 max-w-sm rounded-3xl border border-accent/15 bg-background dark:bg-black/25 px-6 py-8 text-center text-sm text-muted-foreground shadow-xl shadow-sm dark:shadow-black/20">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent/80" />
            <p className="mt-3 font-medium text-foreground">Loading finance messages…</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Syncing the latest partner thread activity.</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="mx-auto my-12 max-w-sm rounded-3xl border border-accent/15 bg-background dark:bg-black/25 px-6 py-8 text-center text-sm text-muted-foreground shadow-xl shadow-sm dark:shadow-black/20">
            <ShieldCheck className="mx-auto mb-3 h-9 w-9 text-accent/65" />
            <p className="font-medium text-foreground">No messages yet. Start the conversation below.</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">This finance channel is ready for partner communication.</p>
          </div>
        ) : (
          <div className="space-y-4 pb-1">
            {messages.map(m => {
              const mine = m.sender_type === viewerSide;
              return (
                <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                  <div className={cn(
                    'max-w-[92%] rounded-2xl sm:max-w-[82%] border px-3.5 py-2.5 text-sm leading-6 whitespace-pre-wrap break-words shadow-lg shadow-sm dark:shadow-black/15 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(0,0,0,0.22)]',
                    // Audit item 48: every incoming message used one bubble,
                    // so a client and a finance partner were indistinguishable
                    // — which matters most when, as reported, both sides are
                    // the same address.
                    mine
                      ? 'border-accent/30 bg-gradient-to-br from-accent to-info text-black'
                      : bubbleClassFor(m.sender_type),
                  )}>
                    {!mine && (() => {
                      // The role always, the person when the record holds one
                      // that is not an email address. `sender_name` is the
                      // partner's and the client's email for every message
                      // stored so far.
                      const { role, name } = senderIdentity(m.sender_type, m.sender_name);
                      return (
                        <div className="mb-1.5 flex flex-wrap items-baseline gap-x-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">
                          <span>{role}</span>
                          {name && <span className="normal-case tracking-normal opacity-90">{name}</span>}
                        </div>
                      );
                    })()}
                    <div>{m.body}</div>
                    {m.attachment_path && m.attachment_filename && (
                      <button
                        onClick={() => downloadAttachment(m.id, m.attachment_filename!)}
                        aria-label={`Download attachment ${m.attachment_filename}`}
                        className={cn(
                          'mt-3 flex items-center gap-2 rounded-xl border border-border dark:border-white/10 bg-background dark:bg-black/15 px-2.5 py-2 text-xs underline-offset-2 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:bg-accent/10 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                          mine ? 'text-primary-foreground/90' : 'text-foreground/80'
                        )}
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>{m.attachment_filename}</span>
                        <span className="opacity-70">{formatBytes(m.attachment_size_bytes)}</span>
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5 px-1 text-[10px] text-muted-foreground/85">{formatStamp(m.created_at)}</div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <div className="shrink-0 space-y-2 border-t border-accent/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.96),rgba(9,9,11,0.98))] p-3 shadow-[0_-18px_45px_rgba(0,0,0,0.22)]">
        {attachment && (
          <div className="flex items-center gap-2 rounded-2xl border border-border dark:border-white/10 bg-background dark:bg-black/30 px-3 py-2 text-xs text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" />
            <span className="truncate flex-1">{attachment.name}</span>
            <span className="text-muted-foreground">{formatBytes(attachment.size)}</span>
            <button aria-label="Remove selected attachment" onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
              className="rounded-full text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-border dark:border-white/10 bg-background dark:bg-black/30 p-2 shadow-inner shadow-sm dark:shadow-black/20">
          <Textarea
            ref={textareaRef}
            aria-label="Compose Finance Portal message"
            placeholder="Write a message..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
            }}
            disabled={sending}
            className="max-h-32 min-h-[72px] flex-1 resize-none rounded-xl border-0 bg-transparent text-sm leading-6 transition-all placeholder:text-muted-foreground/65 focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
            maxLength={5000}
          />
          <div className="flex flex-col gap-1.5">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleAttach} />
            <Button type="button" variant="outline" size="icon" aria-label="Attach file to Finance Portal message" onClick={() => fileInputRef.current?.click()} disabled={sending} className="h-9 w-9 rounded-xl border-border dark:border-white/10 bg-background dark:bg-black/25 text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:bg-accent/10 hover:text-accent-foreground hover:shadow-[0_10px_24px_rgba(0,0,0,0.2)] focus-visible:ring-accent/40 disabled:opacity-50 disabled:hover:translate-y-0">
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" aria-label="Send Finance Portal message" onClick={send} disabled={sending || (!draft.trim() && !attachment)} className="h-9 w-9 rounded-xl bg-accent/30 text-black shadow-lg shadow-accent/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent/20 hover:shadow-[0_14px_32px_rgba(139,92,246,0.22)] focus-visible:ring-accent disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none disabled:hover:translate-y-0">
              {sending || uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/80">Press ⌘/Ctrl+Enter to send · Max 25 MB attachments</p>
      </div>
    </div>
  );
}
