/**
 * Internal staff messaging panel — rendered inside the Aurixa agent widget.
 *
 * Modes:
 *   • Direct message  — pick one active staff member
 *   • Group chat      — pick several colleagues, optionally name the group
 *   • Broadcast       — one announcement to every active staff member
 *
 * Threads can be archived / unarchived per person to cut clutter.
 *
 * All transport goes through the `internal-messaging` edge function, which is the
 * sole mediator for the service_role-only messaging tables.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  Loader2,
  Megaphone,
  MessageSquare,
  Paperclip,
  Pencil,
  PictureInPicture2,
  Plus,
  Search,
  Send,
  Users,
  UsersRound,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/useAuth';
import {
  AttachmentDropOverlay,
  InternalAttachmentQueue,
  InternalAttachmentList,
} from '@/components/agent/InternalAttachmentChips';
import { useInternalAttachmentQueue } from '@/hooks/useInternalAttachmentQueue';
import { TypingPresence, type TypingPerson } from '@/components/messaging/TypingPresence';
import {
  INTERNAL_ATTACHMENT_ACCEPT,
  filesFromDataTransfer,
  sendInternalMessageWithAttachments,
  type InternalAttachment,
  hydrateThreadAttachments,
} from '@/lib/internalMessageAttachments';
import {
  onInternalMessage,
  onInternalTyping,
  publishInternalMessage,
  publishInternalTyping,
  requestPopOutInternalThread,
} from '@/lib/internalMessagingBus';



export interface InternalStaffMember {
  id: string;
  username: string;
  email: string | null;
  role?: string | null;
}

export interface InternalThreadParticipant {
  user_id: string;
  username: string;
  mine?: boolean;
}

export interface InternalThread {
  id: string;
  kind: 'direct' | 'group' | 'broadcast';
  title: string | null;
  display_title: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread: number;
  participant_count: number;
  participants?: InternalThreadParticipant[];
  archived?: boolean;
}

export interface InternalMessage {
  id: string;
  thread_id: string;
  body: string;
  sender_name: string;
  mine: boolean;
  is_system: boolean;
  created_at: string;
  attachments?: InternalAttachment[] | null;
}

const call = async (payload: Record<string, unknown>) => {
  const { data, error } = await invokeSecureFunction('internal-messaging', payload);
  if (error) throw new Error(error.message || 'Request failed');
  if (data && (data as any).success === false) throw new Error((data as any).error || 'Request failed');
  return data as any;
};

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?';
}

function timeLabel(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

type View = 'threads' | 'compose' | 'thread';
type ComposeMode = 'direct' | 'group' | 'broadcast';

export function InternalMessagesPanel({
  onUnreadChange,
  initialThreadId,
}: {
  onUnreadChange?: (n: number) => void;
  initialThreadId?: string | null;
}) {
  const { user } = useAuth();
  const myName = (user as any)?.username || (user as any)?.email || 'Someone';

  const [view, setView] = useState<View>('threads');
  const [threads, setThreads] = useState<InternalThread[] | null>(null);
  const [archivedCount, setArchivedCount] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [staff, setStaff] = useState<InternalStaffMember[]>([]);
  const [activeThread, setActiveThread] = useState<InternalThread | null>(null);
  const [messages, setMessages] = useState<InternalMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [typingBy, setTypingBy] = useState<Record<string, number>>({});
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');

  // compose state
  const [composeMode, setComposeMode] = useState<ComposeMode>('direct');
  const [staffSearch, setStaffSearch] = useState('');
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState('');
  const [broadcastTitle, setBroadcastTitle] = useState('');

  // Attachments — every MIME type, no client-side size cap. The queue tracks
  // per-file progress, retries and errors so nothing fails silently.
  const attachmentQueue = useInternalAttachmentQueue();
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composeFileInputRef = useRef<HTMLInputElement>(null);


  const bottomRef = useRef<HTMLDivElement>(null);
  const lastTypingSentRef = useRef<number>(0);
  const openedInitialRef = useRef<string | null>(null);


  const loadThreads = useCallback(async (includeArchived?: boolean) => {
    try {
      const data = await call({ action: 'list_threads', include_archived: !!includeArchived });
      const list: InternalThread[] = data?.threads ?? [];
      setThreads(list);
      setArchivedCount(data?.archived_count ?? 0);
      onUnreadChange?.(
        list.reduce((sum, t) => sum + (t.archived ? 0 : t.unread || 0), 0),
      );
    } catch (err) {
      setThreads([]);
      console.error('[InternalMessages] list_threads', err);
    }
  }, [onUnreadChange]);

  const loadStaff = useCallback(async () => {
    if (staff.length) return;
    try {
      const data = await call({ action: 'list_staff' });
      setStaff(data?.staff ?? []);
    } catch (err) {
      console.error('[InternalMessages] list_staff', err);
    }
  }, [staff.length]);

  const openThread = useCallback(async (thread: InternalThread) => {
    setActiveThread(thread);
    setView('thread');
    setMessages(null);
    setRenaming(false);
    try {
      const data = await call({ action: 'get_thread', thread_id: thread.id });
      setMessages(await hydrateThreadAttachments(thread.id, data?.messages ?? []));
      if (data?.thread) {
        setActiveThread(prev => (prev && prev.id === thread.id
          ? { ...prev, title: data.thread.title ?? prev.title, participants: data.thread.participants ?? prev.participants }
          : prev));
      }
      setThreads(prev => prev?.map(t => (t.id === thread.id ? { ...t, unread: 0 } : t)) ?? prev);
      onUnreadChange?.(
        (threads ?? []).reduce((sum, t) => sum + (t.id === thread.id ? 0 : t.unread || 0), 0),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open conversation');
      setMessages([]);
    }
  }, [threads, onUnreadChange]);

  useEffect(() => { loadThreads(showArchived); }, [loadThreads, showArchived]);

  // Deep-link: open a specific thread (e.g. from a pop-up message alert).
  useEffect(() => {
    if (!initialThreadId || !threads || openedInitialRef.current === initialThreadId) return;
    const target = threads.find(t => t.id === initialThreadId);
    if (!target) return;
    openedInitialRef.current = initialThreadId;
    openThread(target);
  }, [initialThreadId, threads, openThread]);

  // Refresh the moment anyone posts (realtime broadcast hint), then re-verify
  // through the edge function. Falls back to a short poll if realtime drops.
  const refreshActive = useCallback(() => {
    loadThreads(showArchived);
    if (activeThread) {
      call({ action: 'get_thread', thread_id: activeThread.id })
        .then(async d => setMessages(await hydrateThreadAttachments(activeThread.id, d?.messages ?? [])))
        .catch(() => {});
    }
  }, [loadThreads, showArchived, activeThread]);

  useEffect(() => {
    const off = onInternalMessage(() => refreshActive());
    const id = setInterval(refreshActive, 6_000);
    return () => { off(); clearInterval(id); };
  }, [refreshActive]);

  // ── Typing indicators ──────────────────────────────────────────────
  const signalTyping = useCallback(() => {
    if (!activeThread) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 1_800) return;
    lastTypingSentRef.current = now;
    publishInternalTyping({
      thread_id: activeThread.id,
      user_id: user?.id ?? 'unknown',
      user_name: myName,
    });
  }, [activeThread, user?.id, myName]);

  useEffect(() => {
    const off = onInternalTyping(signal => {
      if (!signal?.thread_id || signal.user_id === user?.id) return;
      setTypingBy(prev => ({ ...prev, [`${signal.thread_id}|${signal.user_name}`]: Date.now() }));
    });
    const id = setInterval(() => {
      setTypingBy(prev => {
        const now = Date.now();
        const next: Record<string, number> = {};
        let changed = false;
        for (const [k, v] of Object.entries(prev)) {
          if (now - v < 4_000) next[k] = v; else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1_000);
    return () => { off(); clearInterval(id); };
  }, [user?.id]);

  const typingPeople = useMemo<TypingPerson[]>(() => {
    if (!activeThread) return [];
    return Object.keys(typingBy)
      .filter(k => k.startsWith(`${activeThread.id}|`))
      .map(k => k.split('|')[1])
      .filter(Boolean)
      .map(name => ({ name }));
  }, [typingBy, activeThread]);



  useEffect(() => {
    if (view === 'compose') loadStaff();
  }, [view, loadStaff]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length]);

  const filteredStaff = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(s =>
      s.username.toLowerCase().includes(q) || (s.email ?? '').toLowerCase().includes(q));
  }, [staff, staffSearch]);

  const addFiles = (files: File[]) => {
    if (!files.length) return;
    attachmentQueue.addFiles(files);
  };

  /** Upload staged files against a known thread. Returns null when any failed. */
  const uploadStaged = async (threadId: string): Promise<InternalAttachment[] | null> => {
    if (attachmentQueue.items.length === 0) return [];
    const { uploaded, failed } = await attachmentQueue.uploadAll(threadId);
    if (failed.length) {
      toast.error(
        `${failed.length} file${failed.length === 1 ? '' : 's'} failed to upload — retry or remove before sending`,
      );
      return null;
    }
    return uploaded;
  };

  const sendInThread = async () => {
    const text = draft.trim();
    const hasFiles = attachmentQueue.items.length > 0;
    if ((!text && !hasFiles) || !activeThread || sending) return;
    setSending(true);
    try {
      const attachments = await uploadStaged(activeThread.id);
      if (!attachments) { setSending(false); return; }
      await (attachments.length
        ? await sendInternalMessageWithAttachments(activeThread.id, text, attachments)
        : await call({ action: 'send_message', thread_id: activeThread.id, body: text }));

      setDraft('');
      attachmentQueue.clear();
      publishInternalMessage({
        thread_id: activeThread.id,
        sender_id: user?.id ?? null,
        sender_name: myName,
      });
      const data = await call({ action: 'get_thread', thread_id: activeThread.id });
      setMessages(await hydrateThreadAttachments(activeThread.id, data?.messages ?? []));
      loadThreads(showArchived);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Message failed to send');
    } finally {
      setSending(false);
    }
  };



  const sendNew = async () => {
    const text = draft.trim();
    const hasFiles = attachmentQueue.items.length > 0;
    if ((!text && !hasFiles) || sending) return;
    if (composeMode === 'direct' && !recipientId) {
      toast.error('Pick a team member first');
      return;
    }
    if (composeMode === 'group' && groupIds.length < 2) {
      toast.error('Pick at least two colleagues for a group chat');
      return;
    }
    setSending(true);
    try {
      // Attachments need a thread to live under, so create/resolve the thread
      // first for direct + group chats, then upload, then post the message.
      let threadId: string | null = null;
      if (composeMode === 'direct') {
        const started = await call({ action: 'start_direct', user_id: recipientId });
        threadId = started?.thread_id ?? null;
      } else if (composeMode === 'group') {
        const created = await call({
          action: 'create_group',
          member_ids: groupIds,
          title: groupTitle.trim() || undefined,
        });
        threadId = created?.thread_id ?? null;
      }

      let attachments: InternalAttachment[] = [];
      if (hasFiles) {
        if (!threadId) {
          toast.error('Attachments are not supported on company announcements');
          setSending(false);
          return;
        }
        const uploaded = await uploadStaged(threadId);
        if (!uploaded) { setSending(false); return; }
        attachments = uploaded;
      }

      const payload = composeMode === 'broadcast'
        ? { action: 'send_message', broadcast: true, title: broadcastTitle.trim() || undefined, body: text }
        : { action: 'send_message', thread_id: threadId, body: text, attachments };
      const data = attachments.length && threadId
        ? await sendInternalMessageWithAttachments(threadId, text, attachments)
        : await call(payload);
      publishInternalMessage({ thread_id: data?.thread_id, sender_id: user?.id ?? null, sender_name: myName });


      setDraft('');
      setBroadcastTitle('');
      setGroupTitle('');
      setGroupIds([]);
      setRecipientId(null);
      attachmentQueue.clear();
      toast.success(
        composeMode === 'broadcast'
          ? 'Announcement sent to all staff'
          : composeMode === 'group' ? 'Group chat started' : 'Message sent',
      );
      const refreshed = await call({ action: 'list_threads' });
      const list: InternalThread[] = refreshed?.threads ?? [];
      setThreads(list);
      const created = list.find(t => t.id === (data?.thread_id ?? threadId));
      if (created) await openThread(created);
      else setView('threads');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Message failed to send');
    } finally {
      setSending(false);
    }
  };

  const setArchived = async (thread: InternalThread, archived: boolean) => {
    try {
      await call({
        action: archived ? 'archive_thread' : 'unarchive_thread',
        thread_id: thread.id,
      });
      toast.success(archived ? 'Conversation archived' : 'Conversation restored');
      await loadThreads(showArchived);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update conversation');
    }
  };

  /**
   * Detach a conversation into the free-floating pop-out chat window so it can
   * be dragged, resized and used anywhere in the Command Centre while the
   * Aurixa widget itself is closed. Direct, group and announcement threads are
   * all supported. The panel falls back to the thread list so the same
   * conversation is never rendered twice.
   */
  const popOut = (thread: InternalThread) => {
    requestPopOutInternalThread({
      thread_id: thread.id,
      kind: thread.kind,
      title: thread.title || thread.display_title,
    });
    setView('threads');
    setActiveThread(null);
    setRenaming(false);
    toast.success('Chat popped out — drag or resize it anywhere');
  };


  const commitRename = async () => {
    if (!activeThread) return;
    const title = renameDraft.trim();
    if (!title) { setRenaming(false); return; }
    try {
      await call({ action: 'rename_group', thread_id: activeThread.id, title });
      setActiveThread(prev => (prev ? { ...prev, title, display_title: title } : prev));
      setRenaming(false);
      await loadThreads(showArchived);
      const data = await call({ action: 'get_thread', thread_id: activeThread.id });
      setMessages(await hydrateThreadAttachments(activeThread.id, data?.messages ?? []));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not rename group');
    }
  };

  const toggleGroupMember = (id: string) => {
    setGroupIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  // ── Thread view ────────────────────────────────────────────────────
  if (view === 'thread' && activeThread) {
    const isGroup = activeThread.kind === 'group';
    const memberNames = (activeThread.participants ?? [])
      .filter(p => !p.mine)
      .map(p => p.username);
    return (
      <div
        className="relative w-full flex flex-col min-h-0"
        onDragEnter={(e) => {
          if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragActive(true);
        }}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragActive(false);
        }}
        onDrop={(e) => {
          const dropped = filesFromDataTransfer(e.dataTransfer);
          if (!dropped.length) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragActive(false);
          addFiles(dropped);
        }}
      >
        {dragActive && <AttachmentDropOverlay />}
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setView('threads'); setActiveThread(null); }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {activeThread.kind === 'broadcast'
            ? <Megaphone className="h-4 w-4 text-warning shrink-0" />
            : isGroup
              ? <UsersRound className="h-4 w-4 text-primary shrink-0" />
              : <MessageSquare className="h-4 w-4 text-primary shrink-0" />}
          <div className="min-w-0 flex-1">
            {renaming ? (
              <div className="flex items-center gap-1">
                <Input
                  autoFocus
                  value={renameDraft}
                  onChange={e => setRenameDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                  placeholder="Group name"
                  className="h-7 text-xs"
                />
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={commitRename} aria-label="Save group name">
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setRenaming(false)} aria-label="Cancel rename">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-semibold truncate">{activeThread.title || activeThread.display_title}</h3>
                {activeThread.kind === 'broadcast' && (
                  <p className="text-[10px] text-muted-foreground">Announcement · {activeThread.participant_count} recipients</p>
                )}
                {isGroup && (
                  <p className="text-[10px] text-muted-foreground truncate">
                    {memberNames.length ? memberNames.join(', ') : `${activeThread.participant_count} members`}
                  </p>
                )}
              </>
            )}
          </div>
          {isGroup && !renaming && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              aria-label="Rename group"
              title="Rename group"
              onClick={() => { setRenameDraft(activeThread.title || ''); setRenaming(true); }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-primary hover:text-primary"
            aria-label="Pop out chat into a floating window"
            title="Pop out chat"
            onClick={() => popOut(activeThread)}
          >
            <PictureInPicture2 className="h-3.5 w-3.5" />
          </Button>
          <Button

            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            aria-label={activeThread.archived ? 'Unarchive conversation' : 'Archive conversation'}
            title={activeThread.archived ? 'Unarchive conversation' : 'Archive conversation'}
            onClick={() => setArchived(activeThread, !activeThread.archived)}
          >
            {activeThread.archived
              ? <ArchiveRestore className="h-3.5 w-3.5" />
              : <Archive className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <ScrollArea className="flex-1 px-4 py-3">
          {!messages ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : messages.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No messages yet — say hello.</p>
          ) : (
            <div className="space-y-3">
              {messages.map(m => (
                m.is_system ? (
                  <p key={m.id} className="text-center text-[10px] text-muted-foreground">
                    {m.body} · {timeLabel(m.created_at)}
                  </p>
                ) : (
                <div key={m.id} className={cn('flex flex-col gap-1', m.mine ? 'items-end' : 'items-start')}>
                  <span className="text-[10px] text-muted-foreground px-1">
                    {m.sender_name} · {timeLabel(m.created_at)}
                  </span>
                  <div className={cn(
                    'max-w-[85%] rounded-2xl px-3 py-2 text-xs whitespace-pre-wrap break-words',
                    m.mine ? 'bg-primary/15 text-foreground' : 'bg-muted/60 text-foreground',
                  )}>
                    {m.body}
                    {!m.body?.trim() && !(m.attachments?.length) && (
                      <span className="italic text-muted-foreground">Attachment unavailable</span>
                    )}
                    <InternalAttachmentList
                      threadId={activeThread.id}
                      attachments={m.attachments ?? []}
                      mine={m.mine}
                    />
                  </div>
                </div>
                )
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>
        {typingPeople.length > 0 && (
          <div className="px-4 pb-1 shrink-0">
            <TypingPresence people={typingPeople} />
          </div>
        )}
        <div className="border-t p-3 shrink-0">
          <InternalAttachmentQueue
            items={attachmentQueue.items}
            onRemove={attachmentQueue.remove}
            onRetry={(id) => attachmentQueue.retry(activeThread.id, id)}
          />
          <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={INTERNAL_ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={e => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label="Attach files"
            title="Attach files — drag, paste or click. Any format, any size."
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            value={draft}
            onChange={e => { setDraft(e.target.value); signalTyping(); }}
            onPaste={e => {
              const pasted = filesFromDataTransfer(e.clipboardData);
              if (!pasted.length) return;
              e.preventDefault();
              addFiles(pasted);
            }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInThread(); } }}
            placeholder="Write a message… (drag or paste files to attach)"
            rows={1}
            className="min-h-[36px] max-h-28 resize-none text-xs"
          />

          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={sendInThread}
            disabled={sending || (!draft.trim() && attachmentQueue.items.length === 0)}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
          </div>
        </div>
      </div>
    );

  }

  // ── Compose view ───────────────────────────────────────────────────
  if (view === 'compose') {
    return (
      <div
        className="relative w-full flex flex-col min-h-0"
        onDragEnter={(e) => {
          if (composeMode === 'broadcast') return;
          if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
          e.preventDefault();
          dragDepth.current += 1;
          setDragActive(true);
        }}
        onDragOver={(e) => {
          if (composeMode === 'broadcast') return;
          if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragActive(false);
        }}
        onDrop={(e) => {
          if (composeMode === 'broadcast') return;
          const dropped = filesFromDataTransfer(e.dataTransfer);
          if (!dropped.length) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragActive(false);
          addFiles(dropped);
        }}
      >
        {dragActive && <AttachmentDropOverlay />}
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setView('threads')}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-sm font-semibold">New internal message</h3>
        </div>

        <div className="px-4 pt-3 flex flex-wrap gap-1.5">
          {(['direct', 'group', 'broadcast'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setComposeMode(mode)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
                composeMode === mode
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/70',
              )}
            >
              {mode === 'direct'
                ? <MessageSquare className="h-3 w-3" />
                : mode === 'group'
                  ? <UsersRound className="h-3 w-3" />
                  : <Megaphone className="h-3 w-3" />}
              {mode === 'direct' ? 'Direct message' : mode === 'group' ? 'Group chat' : 'Everyone'}
            </button>
          ))}
        </div>

        {composeMode !== 'broadcast' ? (
          <>
            {composeMode === 'group' && (
              <div className="px-4 pt-3 space-y-2">
                <Input
                  value={groupTitle}
                  onChange={e => setGroupTitle(e.target.value)}
                  placeholder="Group name (optional — you can rename later)"
                  className="h-8 text-xs"
                />
                {groupIds.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {groupIds.map(id => {
                      const member = staff.find(s => s.id === id);
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                        >
                          {member?.username ?? 'Member'}
                          <button
                            type="button"
                            aria-label={`Remove ${member?.username ?? 'member'}`}
                            onClick={() => toggleGroupMember(id)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="px-4 pt-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={staffSearch}
                  onChange={e => setStaffSearch(e.target.value)}
                  placeholder="Search staff…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
            <ScrollArea className="flex-1 px-4 py-2 min-h-0">
              {staff.length === 0 ? (
                <div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="space-y-1">
                  {filteredStaff.map(s => {
                    const selected = composeMode === 'group'
                      ? groupIds.includes(s.id)
                      : recipientId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => (composeMode === 'group' ? toggleGroupMember(s.id) : setRecipientId(s.id))}
                        className={cn(
                          'w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                          selected ? 'bg-primary/15 text-primary' : 'hover:bg-accent hover:text-accent-foreground',
                        )}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                          {initials(s.username)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium truncate">{s.username}</span>
                          {s.email && <span className="block text-[10px] text-muted-foreground truncate">{s.email}</span>}
                        </span>
                        {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    );
                  })}
                  {filteredStaff.length === 0 && (
                    <p className="text-[11px] text-muted-foreground px-2 py-3">No staff match that search.</p>
                  )}
                </div>
              )}
            </ScrollArea>
          </>
        ) : (
          <div className="px-4 pt-3 space-y-2 flex-1 min-h-0">
            <Input
              value={broadcastTitle}
              onChange={e => setBroadcastTitle(e.target.value)}
              placeholder="Announcement title (optional)"
              className="h-8 text-xs"
            />
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Users className="h-3.5 w-3.5 mt-px shrink-0" />
              This goes to every active staff member and raises an in-app notification for each of them.
            </p>
          </div>
        )}

        <div className="border-t p-3 shrink-0">
          {composeMode !== 'broadcast' && (
            <InternalAttachmentQueue
              items={attachmentQueue.items}
              onRemove={attachmentQueue.remove}
              onRetry={() => toast.info('Send the message to retry the upload')}
            />
          )}
          <div className="flex items-end gap-2">
            {composeMode !== 'broadcast' && (
              <>
                <input
                  ref={composeFileInputRef}
                  type="file"
                  multiple
                  accept={INTERNAL_ATTACHMENT_ACCEPT}
                  className="hidden"
                  onChange={e => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  aria-label="Attach files"
                  title="Attach files — drag, paste or click. Any format, any size."
                  onClick={() => composeFileInputRef.current?.click()}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
              </>
            )}
            <Textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onPaste={e => {
                if (composeMode === 'broadcast') return;
                const pasted = filesFromDataTransfer(e.clipboardData);
                if (!pasted.length) return;
                e.preventDefault();
                addFiles(pasted);
              }}
              placeholder={
                composeMode === 'broadcast'
                  ? 'Announcement to all staff…'
                  : composeMode === 'group'
                    ? 'Kick off the group chat…'
                    : 'Write a message…'
              }
              rows={2}
              className="min-h-[44px] max-h-28 resize-none text-xs"
            />
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={sendNew}
              disabled={sending || (!draft.trim() && attachmentQueue.items.length === 0)}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

    );
  }

  // ── Thread list ────────────────────────────────────────────────────
  const visibleThreads = (threads ?? []).filter(t => (showArchived ? !!t.archived : !t.archived));

  return (
    <div className="w-full flex flex-col min-h-0">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" /> Team messages
        </h3>
        <div className="flex items-center gap-1">
          {(archivedCount > 0 || showArchived) && (
            <Button
              size="sm"
              variant="ghost"
              className={cn('h-7 text-[11px]', showArchived && 'text-primary')}
              onClick={() => setShowArchived(v => !v)}
            >
              <Archive className="h-3 w-3 mr-1" />
              {showArchived ? 'Active' : `Archived${archivedCount ? ` (${archivedCount})` : ''}`}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setView('compose')}>
            <Plus className="h-3 w-3 mr-1" /> New
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1 p-3 min-h-0">
        {!threads ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : visibleThreads.length === 0 ? (
          <div className="text-center py-8 px-4 space-y-2">
            <p className="text-xs text-muted-foreground">
              {showArchived ? 'Nothing archived.' : 'No internal conversations yet.'}
            </p>
            {!showArchived && (
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setView('compose')}>
                Message a colleague
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {visibleThreads.map(t => (
              <div
                key={t.id}
                className="group flex items-start gap-1 rounded-lg pr-1 hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                <button
                  type="button"
                  onClick={() => openThread(t)}
                  className="flex-1 min-w-0 flex items-start gap-2 px-2 py-2 text-left"
                >
                  <span className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                    t.kind === 'broadcast' ? 'bg-warning/15 text-warning' : 'bg-muted',
                  )}>
                    {t.kind === 'broadcast'
                      ? <Megaphone className="h-3.5 w-3.5" />
                      : t.kind === 'group'
                        ? <UsersRound className="h-3.5 w-3.5" />
                        : initials(t.display_title)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">{t.display_title}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{timeLabel(t.last_message_at)}</span>
                    </span>
                    {t.last_message_preview && (
                      <span className="block text-[11px] text-muted-foreground truncate">{t.last_message_preview}</span>
                    )}
                  </span>
                  {t.unread > 0 && (
                    <span className="mt-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                      {t.unread > 9 ? '9+' : t.unread}
                    </span>
                  )}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="mt-1.5 h-7 w-7 shrink-0 text-primary opacity-60 hover:opacity-100 hover:text-primary"
                  aria-label={`Pop out ${t.display_title} into a floating chat`}
                  title="Pop out chat"
                  onClick={() => popOut(t)}
                >
                  <PictureInPicture2 className="h-3.5 w-3.5" />
                </Button>
                <Button

                  size="icon"
                  variant="ghost"
                  className="mt-1.5 h-7 w-7 shrink-0 opacity-60 hover:opacity-100"
                  aria-label={t.archived ? 'Unarchive conversation' : 'Archive conversation'}
                  title={t.archived ? 'Unarchive conversation' : 'Archive conversation'}
                  onClick={() => setArchived(t, !t.archived)}
                >
                  {t.archived
                    ? <ArchiveRestore className="h-3.5 w-3.5" />
                    : <Archive className="h-3.5 w-3.5" />}
                </Button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
