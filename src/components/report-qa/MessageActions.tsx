import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Pin, Share2, GitBranch, Copy, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface MessageActionsProps {
  messageId: string;
  conversationId: string;
  pinned?: boolean;
  onPinChange?: (pinned: boolean) => void;
  onBranched?: (newConversationId: string) => void;
}

export function MessageActions({
  messageId,
  conversationId,
  pinned = false,
  onPinChange,
  onBranched,
}: MessageActionsProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const togglePin = async () => {
    setBusy(true);
    try {
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'toggle-pin-message',
        messageId,
        pinned: !pinned,
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      onPinChange?.(!pinned);
      toast({ title: !pinned ? 'Answer pinned' : 'Answer unpinned' });
    } catch (e: any) {
      toast({ title: 'Pin failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    setBusy(true);
    try {
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'generate-share-link',
        messageId,
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      const token = data?.shareToken;
      const url = `${window.location.origin}/qa/shared/${token}`;
      setShareUrl(url);
      setShareOpen(true);
    } catch (e: any) {
      toast({ title: 'Share failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const branch = async () => {
    setBusy(true);
    try {
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'branch-conversation',
        sourceConversationId: conversationId,
        branchFromMessageId: messageId,
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      toast({ title: 'Branched', description: 'Opened a new conversation from this point.' });
      onBranched?.(data.conversationId);
    } catch (e: any) {
      toast({ title: 'Branch failed', description: e.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const copyShare = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        className={cn('h-7 px-1.5', pinned && 'text-primary')}
        onClick={togglePin}
        aria-label={pinned ? 'Unpin answer' : 'Pin answer'}
      >
        <Pin className={cn('h-3 w-3', pinned && 'fill-current')} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        className="h-7 px-1.5"
        onClick={share}
        aria-label="Share this answer"
      >
        <Share2 className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        className="h-7 px-1.5"
        onClick={branch}
        aria-label="Branch from here"
      >
        <GitBranch className="h-3 w-3" />
      </Button>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Shareable answer link</DialogTitle>
            <DialogDescription>
              Anyone with this link can view this single answer (read-only, no login required).
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input value={shareUrl || ''} readOnly className="flex-1" />
            <Button onClick={copyShare} variant="secondary">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={async () => {
                await invokeSecureFunction('report-qa', { action: 'revoke-share-link', messageId });
                setShareOpen(false);
                toast({ title: 'Share link revoked' });
              }}
            >
              Revoke link
            </Button>
            <Button onClick={() => setShareOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
