import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Loader2, MessageSquare, Send, Check, Trash2, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import type { Block, Page, Overlay } from '@/lib/reportTemplate/templateSchema';

interface TemplateCommentsPanelProps {
  templateId: string;
  activePage: Page | null;
  selectedBlock: Block | null;
  selectedOverlay: Overlay | null;
  selectedOverlayBlockId?: string | null;
  currentUserId?: string | null;
  currentUserName?: string | null;
  onRowsChange?: (rows: Row[]) => void;
  onJumpToAnchor?: (anchor: { pageId?: string | null; blockId?: string | null; overlayId?: string | null }) => void;
}

type Row = {
  id: string;
  template_id: string;
  thread_id: string;
  parent_id: string | null;
  page_id: string | null;
  block_id: string | null;
  overlay_id: string | null;
  author_id: string | null;
  author_name: string | null;
  body: string;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
};

export function TemplateCommentsPanel({
  templateId,
  activePage,
  selectedBlock,
  selectedOverlay,
  selectedOverlayBlockId,
  currentUserId,
  currentUserName,
  onRowsChange,
  onJumpToAnchor,
}: TemplateCommentsPanelProps) {
  // Comment writes carry the staff JWT for Phase 7 RLS (author-scoped).
  const { supabase: authedSupabase } = useAuthenticatedSupabase();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [anchorToSelection, setAnchorToSelection] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [posting, setPosting] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const load = async () => {
    if (!templateId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('template_comments')
      .select('*')
      .eq('template_id', templateId)
      .order('created_at', { ascending: true });
    if (!error && data) {
      const nextRows = data as Row[];
      setRows(nextRows);
      onRowsChange?.(nextRows);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (!templateId) return;
    const ch = supabase
      .channel(`tpl-comments:${templateId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'template_comments', filter: `template_id=eq.${templateId}` },
        () => load())
      .subscribe();
    channelRef.current = ch;
    return () => { supabase.removeChannel(ch); };
  }, [templateId]);

  const threads = useMemo(() => {
    const visible = showResolved ? rows : rows.filter(r => !r.resolved);
    const byThread: Record<string, Row[]> = {};
    for (const r of visible) {
      (byThread[r.thread_id] ||= []).push(r);
    }
    return Object.values(byThread).sort((a, b) =>
      new Date(b[0].created_at).getTime() - new Date(a[0].created_at).getTime(),
    );
  }, [rows, showResolved]);

  const post = async (parent?: Row) => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      const threadId = parent?.thread_id ?? crypto.randomUUID();
      const anchor = anchorToSelection && !parent ? {
        page_id: activePage?.id ?? null,
        block_id: selectedOverlay ? (selectedOverlayBlockId ?? selectedBlock?.id ?? null) : (selectedBlock?.id ?? null),
        overlay_id: selectedOverlay?.id ?? null,
      } : {
        page_id: parent?.page_id ?? null,
        block_id: parent?.block_id ?? null,
        overlay_id: parent?.overlay_id ?? null,
      };

      const { error } = await authedSupabase.from('template_comments').insert({
        template_id: templateId,
        thread_id: threadId,
        parent_id: parent?.id ?? null,
        page_id: anchor.page_id,
        block_id: anchor.block_id,
        overlay_id: anchor.overlay_id,
        author_id: currentUserId ?? null,
        author_name: currentUserName ?? null,
        body: draft.trim(),
      });
      if (error) throw error;
      setDraft('');
    } catch (e: any) {
      toast.error(`Comment failed: ${e?.message ?? e}`);
    } finally {
      setPosting(false);
    }
  };

  const toggleResolved = async (thread: Row[]) => {
    const root = thread[0];
    const target = !root.resolved;
    const ids = thread.map(r => r.id);
    await authedSupabase
      .from('template_comments')
      .update({
        resolved: target,
        resolved_at: target ? new Date().toISOString() : null,
        resolved_by: target ? (currentUserId ?? null) : null,
      })
      .in('id', ids);
  };

  const remove = async (id: string) => {
    await authedSupabase.from('template_comments').delete().eq('id', id);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="h-4 w-4" /> Comments
          <Badge variant="secondary" className="text-[10px]">{rows.filter(r => !r.resolved).length}</Badge>
        </div>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <Switch checked={showResolved} onCheckedChange={setShowResolved} />
          Resolved
        </label>
      </div>

      <ScrollArea className="flex-1 px-3 py-2">
        {loading ? (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : threads.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">No comments yet. Be the first.</p>
        ) : (
          <ul className="space-y-3">
            {threads.map(thread => {
              const root = thread[0];
              const replies = thread.slice(1);
              return (
                <li key={root.id} className={`rounded-lg border p-2 text-xs ${root.resolved ? 'opacity-60' : ''}`}>
                  <CommentItem row={root} onDelete={() => remove(root.id)} canDelete={root.author_id === currentUserId} />
                  {(root.page_id || root.block_id || root.overlay_id) && (
                    <button
                      type="button"
                      onClick={() => onJumpToAnchor?.({ pageId: root.page_id, blockId: root.block_id, overlayId: root.overlay_id })}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1 hover:text-primary"
                    >
                      <MapPin className="h-3 w-3" />
                      {root.overlay_id
                        ? `Overlay ${root.overlay_id.slice(0, 6)}`
                        : root.block_id
                        ? `Block ${root.block_id.slice(0, 6)}`
                        : root.page_id
                        ? `Page ${root.page_id.slice(0, 6)}`
                        : 'Template'}
                    </button>
                  )}
                  {replies.length > 0 && (
                    <ul className="mt-2 ml-3 pl-2 border-l space-y-2">
                      {replies.map(rep => (
                        <li key={rep.id}>
                          <CommentItem row={rep} onDelete={() => remove(rep.id)} canDelete={rep.author_id === currentUserId} />
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center gap-2 mt-2 pt-2 border-t">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[11px] px-1"
                      onClick={() => toggleResolved(thread)}
                    >
                      <Check className="h-3 w-3 mr-1" />
                      {root.resolved ? 'Reopen' : 'Resolve'}
                    </Button>
                    <ReplyBox onSubmit={async (body) => {
                      if (!body.trim()) return;
                      await authedSupabase.from('template_comments').insert({
                        template_id: templateId,
                        thread_id: root.thread_id,
                        parent_id: root.id,
                        page_id: root.page_id,
                        block_id: root.block_id,
                        overlay_id: root.overlay_id,
                        author_id: currentUserId ?? null,
                        author_name: currentUserName ?? null,
                        body: body.trim(),
                      });
                    }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>

      <div className="border-t p-3 space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={anchorToSelection
            ? `Comment on ${selectedOverlay ? 'selected overlay' : selectedBlock ? 'selected block' : activePage ? 'this page' : 'template'}…`
            : 'New comment on template…'}
          rows={3}
          className="text-xs"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Switch checked={anchorToSelection} onCheckedChange={setAnchorToSelection} />
            Anchor to selection
          </label>
          <Button size="sm" onClick={() => post()} disabled={posting || !draft.trim()}>
            {posting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
            Post
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentItem({ row, onDelete, canDelete }: { row: Row; onDelete: () => void; canDelete: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold truncate">{row.author_name || 'Anon'}</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
          </span>
          {canDelete && (
            <button onClick={onDelete} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words">{row.body}</p>
    </div>
  );
}

function ReplyBox({ onSubmit }: { onSubmit: (body: string) => Promise<void> }) {
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-1 flex-1">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="Reply…"
        className="flex-1 h-6 px-2 text-[11px] border rounded bg-background"
        onKeyDown={async (e) => {
          if (e.key === 'Enter' && val.trim()) {
            setBusy(true);
            await onSubmit(val);
            setVal('');
            setBusy(false);
          }
        }}
      />
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
    </div>
  );
}
