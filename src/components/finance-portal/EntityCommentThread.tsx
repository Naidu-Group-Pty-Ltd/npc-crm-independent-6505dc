import { useEffect, useState, useCallback, useMemo } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  MessageSquare, Trash2, Send, Eye, EyeOff, Loader2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export type CommentEntityType =
  | 'condition' | 'document' | 'valuation' | 'decision' | 'date' | 'file' | 'general';

interface Comment {
  id: string;
  parent_id: string | null;
  body: string;
  visibility: 'shared' | 'internal_npc';
  author_id: string | null;
  author_name: string | null;
  author_type: string;
  created_at: string;
}

interface Props {
  purchaseFileId: string;
  entityType: CommentEntityType;
  entityId?: string | null;
  /** Compact = small icon trigger inside list rows */
  trigger?: 'button' | 'icon';
  /** Default visibility for new comments */
  defaultVisibility?: 'shared' | 'internal_npc';
  label?: string;
}

export function EntityCommentThread({
  purchaseFileId, entityType, entityId, trigger = 'icon',
  defaultVisibility = 'internal_npc', label,
}: Props) {
  const { invokeFinanceFunction, user } = useFinancePortalAuth();
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [draft, setDraft] = useState('');
  const [visibility, setVisibility] = useState<'shared' | 'internal_npc'>(defaultVisibility);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    const { data } = await invokeFinanceFunction('finance-portal-settings', {
      operation: 'list_comments',
      purchase_file_id: purchaseFileId,
      entity_type: entityType,
      entity_id: entityId || null,
    });
    setComments(data?.comments || []);
    setLoading(false);
  }, [open, purchaseFileId, entityType, entityId, invokeFinanceFunction]);

  useEffect(() => { void load(); }, [load]);

  const post = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    const { data, error } = await invokeFinanceFunction('finance-portal-settings', {
      operation: 'post_comment',
      purchase_file_id: purchaseFileId,
      entity_type: entityType,
      entity_id: entityId || null,
      parent_id: replyTo,
      body: draft.trim(),
      visibility,
    });
    setPosting(false);
    if (error || data?.error) {
      toast.error(data?.error || 'Failed to post');
      return;
    }
    setDraft('');
    setReplyTo(null);
    void load();
  };

  const del = async (id: string) => {
    const { error } = await invokeFinanceFunction('finance-portal-settings', {
      operation: 'delete_comment', id,
    });
    if (!error) {
      setComments((cs) => cs.filter((c) => c.id !== id));
    }
  };

  // tree
  const tree = useMemo(() => {
    const byParent = new Map<string | null, Comment[]>();
    for (const c of comments) {
      const k = c.parent_id;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(c);
    }
    return byParent;
  }, [comments]);

  const renderNode = (c: Comment, depth = 0) => (
    <div key={c.id} className={cn('py-2', depth > 0 && 'ml-4 border-l border-border/40 pl-3')}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium">{c.author_name || 'Partner'}</span>
            <Badge
              variant="outline"
              className={cn(
                'text-[9px] px-1 py-0',
                c.visibility === 'shared'
                  ? 'bg-success/10 text-success border-success/20'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {c.visibility === 'shared' ? <Eye className="h-2.5 w-2.5 mr-1" /> : <EyeOff className="h-2.5 w-2.5 mr-1" />}
              {c.visibility === 'shared' ? 'Shared' : 'Internal'}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
            </span>
          </div>
          <p className="text-sm mt-0.5 whitespace-pre-wrap break-words">{c.body}</p>
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              className="text-[10px] text-muted-foreground hover:text-primary"
              onClick={() => setReplyTo(c.id)}
            >
              Reply
            </button>
            {c.author_id === user?.id && (
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-destructive inline-flex items-center gap-0.5"
                onClick={() => del(c.id)}
              >
                <Trash2 className="h-2.5 w-2.5" /> Delete
              </button>
            )}
          </div>
        </div>
      </div>
      {(tree.get(c.id) || []).map((child) => renderNode(child, depth + 1))}
    </div>
  );

  const count = comments.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger === 'icon' ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-muted-foreground hover:text-primary">
            <MessageSquare className="h-3.5 w-3.5" />
            {count > 0 && <span className="text-[10px]">{count}</span>}
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-2">
            <MessageSquare className="h-3.5 w-3.5" />
            {label || 'Comments'}
            {count > 0 && <Badge variant="outline" className="text-[10px] ml-1">{count}</Badge>}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-96 p-3" align="end">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-primary" /> Thread
          </h4>
          <Badge variant="outline" className="text-[10px] capitalize">{entityType}</Badge>
        </div>
        <div className="max-h-72 overflow-y-auto -mx-3 px-3 border-y border-border/40">
          {loading ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
            </div>
          ) : comments.length === 0 ? (
            <p className="py-4 text-xs text-center text-muted-foreground">No comments yet.</p>
          ) : (
            (tree.get(null) || []).map((c) => renderNode(c, 0))
          )}
        </div>

        {replyTo && (
          <div className="text-[10px] text-muted-foreground mt-2 flex items-center gap-2">
            Replying to thread
            <button onClick={() => setReplyTo(null)} className="text-primary hover:underline">Cancel</button>
          </div>
        )}

        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          rows={2}
          className="mt-2 text-sm"
        />
        <div className="flex items-center justify-between gap-2 mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] gap-1"
            onClick={() => setVisibility((v) => (v === 'shared' ? 'internal_npc' : 'shared'))}
          >
            {visibility === 'shared' ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {visibility === 'shared' ? 'Visible to client' : 'Internal only'}
          </Button>
          <Button size="sm" onClick={post} disabled={posting || !draft.trim()}>
            {posting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
            Post
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
