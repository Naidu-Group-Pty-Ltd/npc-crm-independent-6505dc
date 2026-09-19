import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Share2, UserX, Users } from 'lucide-react';

interface TeamMember {
  id: string;
  username: string;
  email: string;
  role: string;
}

interface ActiveShare {
  shared_with: string;
  username: string;
  permission: string;
  handoff_note?: string | null;
  created_at: string;
}

interface ShareConversationDialogProps {
  conversationId: string | null;
  conversationTitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShared?: () => void;
}

export function ShareConversationDialog({
  conversationId,
  conversationTitle,
  open,
  onOpenChange,
  onShared,
}: ShareConversationDialogProps) {
  const { toast } = useToast();
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [activeShares, setActiveShares] = useState<ActiveShare[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [permission, setPermission] = useState<'view' | 'collaborate'>('view');
  const [handoffNote, setHandoffNote] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const [membersRes, sharesRes] = await Promise.all([
          invokeSecureFunction('report-qa', { action: 'get-team-members' }),
          invokeSecureFunction('report-qa', { action: 'get-shares', conversationId }),
        ]);
        if (cancelled) return;
        setTeamMembers(membersRes.data?.team_members || []);
        setActiveShares(sharesRes.data?.shares || []);
      } catch (err) {
        console.error('[ShareConversationDialog] Failed to load share data:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, conversationId]);

  const resetForm = () => {
    setSelectedIds([]);
    setPermission('view');
    setHandoffNote('');
  };

  const toggleMember = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  };

  const alreadySharedIds = new Set(activeShares.map(s => s.shared_with));
  const shareableMembers = teamMembers.filter(m => !alreadySharedIds.has(m.id));

  const handleShare = async () => {
    if (!conversationId || selectedIds.length === 0) return;
    setIsSharing(true);
    const failures: string[] = [];
    for (const targetUserId of selectedIds) {
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'share-conversation',
        conversationId,
        targetUserId,
        permission,
        handoffNote: handoffNote.trim() || undefined,
      });
      if (error || !data?.success) {
        const member = teamMembers.find(m => m.id === targetUserId);
        failures.push(member?.username || targetUserId);
      }
    }
    setIsSharing(false);

    const successCount = selectedIds.length - failures.length;
    if (successCount > 0) {
      toast({
        title: 'Conversation shared',
        description: `Shared with ${successCount} team member${successCount !== 1 ? 's' : ''} (${permission === 'collaborate' ? 'can collaborate' : 'view only'})`,
      });
      onShared?.();
    }
    if (failures.length > 0) {
      toast({
        title: 'Some shares failed',
        description: `Could not share with: ${failures.join(', ')}`,
        variant: 'destructive',
      });
    }
    if (failures.length === 0) {
      resetForm();
      // Refresh the active share list in place so the dialog reflects reality.
      const { data } = await invokeSecureFunction('report-qa', { action: 'get-shares', conversationId });
      setActiveShares(data?.shares || []);
    }
  };

  const handleRevoke = async (targetUserId: string, username: string) => {
    if (!conversationId) return;
    setRevokingId(targetUserId);
    try {
      const { data, error } = await invokeSecureFunction('report-qa', {
        action: 'revoke-share',
        conversationId,
        targetUserId,
      });
      if (error || !data?.success) throw new Error(error?.message || 'Revoke failed');
      setActiveShares(prev => prev.filter(s => s.shared_with !== targetUserId));
      toast({ title: 'Access revoked', description: `${username} no longer has access to this conversation` });
      onShared?.();
    } catch (err) {
      console.error('[ShareConversationDialog] Revoke failed:', err);
      toast({ title: 'Failed to revoke access', description: 'Please try again', variant: 'destructive' });
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) resetForm(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" />
            Share conversation
          </DialogTitle>
          <DialogDescription className="truncate">
            {conversationTitle ? `Give teammates access to "${conversationTitle}"` : 'Give teammates access to this Q&A session'}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading team members...
          </div>
        ) : (
          <div className="space-y-4">
            {activeShares.length > 0 && (
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                  <Users className="h-3 w-3" />
                  Currently shared with
                </Label>
                <div className="space-y-1.5">
                  {activeShares.map((share) => (
                    <div key={share.shared_with} className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{share.username}</p>
                        {share.handoff_note && (
                          <p className="truncate text-xs text-muted-foreground" title={share.handoff_note}>“{share.handoff_note}”</p>
                        )}
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {share.permission === 'collaborate' ? 'Collaborate' : 'View'}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 shrink-0 p-0 text-destructive hover:text-destructive"
                        aria-label={`Revoke access for ${share.username}`}
                        disabled={revokingId === share.shared_with}
                        onClick={() => handleRevoke(share.shared_with, share.username)}
                      >
                        {revokingId === share.shared_with
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <UserX className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  ))}
                </div>
                <Separator />
              </div>
            )}

            {shareableMembers.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                {teamMembers.length === 0
                  ? 'No other active team members found.'
                  : 'This conversation is already shared with every other team member.'}
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Share with</Label>
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                    {shareableMembers.map((member) => (
                      <label
                        key={member.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={selectedIds.includes(member.id)}
                          onCheckedChange={() => toggleMember(member.id)}
                          aria-label={`Share with ${member.username}`}
                        />
                        <span className="flex-1 truncate font-medium text-foreground">{member.username}</span>
                        <span className="truncate text-xs text-muted-foreground">{member.email}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="share-permission" className="text-xs uppercase tracking-wide text-muted-foreground">Permission</Label>
                  <Select value={permission} onValueChange={(v) => setPermission(v as 'view' | 'collaborate')}>
                    <SelectTrigger id="share-permission" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="view">View only — can read the conversation</SelectItem>
                      <SelectItem value="collaborate">Collaborate — can ask questions and edit reports</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="share-note" className="text-xs uppercase tracking-wide text-muted-foreground">Handoff note (optional)</Label>
                  <Textarea
                    id="share-note"
                    placeholder="Context for your teammate, e.g. 'Please review the yield analysis on page 2'"
                    value={handoffNote}
                    onChange={(e) => setHandoffNote(e.target.value)}
                    className="min-h-[60px] resize-none text-sm"
                    maxLength={500}
                  />
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {shareableMembers.length > 0 && (
            <Button onClick={handleShare} disabled={isSharing || selectedIds.length === 0}>
              {isSharing ? (
                <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Sharing...</>
              ) : (
                <><Share2 className="mr-1.5 h-3.5 w-3.5" />Share{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
