/**
 * Batch 10 — Threaded comments on any purchase-file entity
 * (purchase_file_entity_comments — shared OR internal_npc).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, MessageSquare, Trash2, Lock, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

const FN = 'finance-portal-batch9-10';

interface Props {
  purchaseFileId: string;
  entityType?: string;
  entityId?: string | null;
  title?: string;
  compact?: boolean;
}

export function EntityCommentsThread({
  purchaseFileId,
  entityType = 'purchase_file',
  entityId = null,
  title = 'Comments',
  compact = false,
}: Props) {
  const { invokeFinanceFunction, user } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'shared' | 'internal_npc'>('shared');
  const [posting, setPosting] = useState(false);

  const queryKey = ['pf-entity-comments', purchaseFileId, entityType, entityId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(FN, {
        operation: 'comments_list',
        purchase_file_id: purchaseFileId,
        entity_type: entityType,
        entity_id: entityId,
      });
      if (error) throw error;
      return data?.comments ?? [];
    },
    enabled: !!purchaseFileId,
  });

  const post = async () => {
    if (!body.trim()) return;
    setPosting(true);
    const { error } = await invokeFinanceFunction(FN, {
      operation: 'comment_post',
      purchase_file_id: purchaseFileId,
      entity_type: entityType,
      entity_id: entityId,
      body,
      visibility,
    });
    setPosting(false);
    if (error) {
      toast.error('Failed to post comment');
      return;
    }
    setBody('');
    qc.invalidateQueries({ queryKey });
  };

  const del = async (id: string) => {
    await invokeFinanceFunction(FN, { operation: 'comment_delete', id });
    qc.invalidateQueries({ queryKey });
  };

  const Wrapper: any = compact ? 'div' : Card;
  const Inner: any = compact ? 'div' : CardContent;

  return (
    <Wrapper className={compact ? '' : ''}>
      {!compact && (
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-primary" /> {title}
            {data && <Badge variant="outline">{data.length}</Badge>}
          </CardTitle>
        </CardHeader>
      )}
      <Inner className={compact ? 'space-y-3' : 'space-y-3'}>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !data?.length ? (
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {data.map((c: any) => (
              <div
                key={c.id}
                className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-1">
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground">{c.author_name || 'Unknown'}</span>
                    <Badge
                      variant={c.visibility === 'internal_npc' ? 'secondary' : 'outline'}
                      className="text-[10px] py-0 px-1.5"
                    >
                      {c.visibility === 'internal_npc' ? (
                        <Lock className="h-2.5 w-2.5 mr-0.5" />
                      ) : (
                        <Globe className="h-2.5 w-2.5 mr-0.5" />
                      )}
                      {c.visibility === 'internal_npc' ? 'Internal' : 'Shared'}
                    </Badge>
                  </span>
                  <span className="flex items-center gap-2">
                    <span>{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</span>
                    {c.author_id === user?.id && (
                      <button onClick={() => del(c.id)} className="hover:text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-foreground">{c.body}</p>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <Textarea
            placeholder="Add a comment…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            className="text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={visibility === 'shared' ? 'default' : 'outline'}
                onClick={() => setVisibility('shared')}
                className="h-7 text-xs"
              >
                <Globe className="h-3 w-3 mr-1" /> Shared
              </Button>
              <Button
                size="sm"
                variant={visibility === 'internal_npc' ? 'default' : 'outline'}
                onClick={() => setVisibility('internal_npc')}
                className="h-7 text-xs"
              >
                <Lock className="h-3 w-3 mr-1" /> Internal
              </Button>
            </div>
            <Button size="sm" onClick={post} disabled={posting || !body.trim()}>
              {posting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Post
            </Button>
          </div>
        </div>
      </Inner>
    </Wrapper>
  );
}
