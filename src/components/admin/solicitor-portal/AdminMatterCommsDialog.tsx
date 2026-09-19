import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MessagesSquare, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { SCOPE_META, senderLabel, type LegalMatterMessage, type LegalThreadScope } from '@/lib/solicitorComms';

/** Scopes Command Centre staff may join. Firm-internal notes are excluded by design. */
const STAFF_SCOPES: LegalThreadScope[] = ['solicitor_npc', 'solicitor_finance'];

interface AdminMatterCommsDialogProps {
  matterId: string | null;
  matterTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Command Centre side of the matter conversation (Solicitor Portal — Phase 6).
 */
export function AdminMatterCommsDialog({ matterId, matterTitle, open, onOpenChange }: AdminMatterCommsDialogProps) {
  const [scope, setScope] = useState<LegalThreadScope>('solicitor_npc');
  const [messages, setMessages] = useState<LegalMatterMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!matterId || !open) return;
    setLoading(true);
    const { data, error } = await invokeSecureFunction('legal-matters-admin', {
      operation: 'get_thread', matter_id: matterId, scope,
    });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Could not load the conversation');
      setMessages([]);
    } else {
      setMessages(((data as any)?.messages || []) as LegalMatterMessage[]);
    }
    setLoading(false);
  }, [matterId, open, scope]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !matterId || sending) return;
    setSending(true);
    const { data, error } = await invokeSecureFunction('legal-matters-admin', {
      operation: 'post_message', matter_id: matterId, scope, body: text,
    });
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || 'Message not sent');
    } else {
      const message = (data as any)?.message as LegalMatterMessage | undefined;
      if (message) setMessages((prev) => [...prev, message]);
      setDraft('');
    }
    setSending(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessagesSquare className="h-4 w-4 text-primary" aria-hidden />
            {matterTitle || 'Matter conversation'}
          </DialogTitle>
          <DialogDescription>{SCOPE_META[scope].description}</DialogDescription>
        </DialogHeader>

        <Tabs value={scope} onValueChange={(v) => setScope(v as LegalThreadScope)}>
          <TabsList className="grid w-full grid-cols-2">
            {STAFF_SCOPES.map((key) => (
              <TabsTrigger key={key} value={key} className="text-xs">{SCOPE_META[key].label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <ScrollArea className="flex-1 rounded-md border border-border/60 bg-muted/20 p-3">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            </div>
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No messages yet. Start the conversation with the legal practice.
            </p>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => {
                const mine = message.sender_type === 'staff';
                return (
                  <div key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[85%] rounded-lg border px-3 py-2 text-sm',
                      mine ? 'border-primary/40 bg-primary/10' : 'border-border bg-card',
                    )}>
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">{senderLabel(message)}</span>
                        <span>{new Date(message.created_at).toLocaleString('en-AU', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}</span>
                      </div>
                      <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>

        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={8000}
            placeholder={`Message the ${SCOPE_META[scope].label.toLowerCase()} thread…`}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void send()} disabled={sending || !draft.trim()}>
              {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-2 h-4 w-4" aria-hidden />}
              Send
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AdminMatterCommsDialog;
