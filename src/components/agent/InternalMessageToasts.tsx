/**
 * InternalMessageToasts — bubbly, interactive conversation pop-ups for internal
 * messages so urgent items can be read AND replied to immediately, even when
 * the Aurixa widget is closed.
 *
 * Behaviour contract:
 *  • One pop-up per thread. New messages cascade inside that same bubble stack.
 *  • Nothing ever auto-expands. Reloads, sign-ins and new inbound messages all
 *    surface as minimised name-only chips carrying an unread badge; at most ONE
 *    conversation is expanded at a time and only after the user clicks a chip.
 *  • Every new message pops: dismissal is recorded per-thread against the
 *    message timestamp, so a later message re-opens that conversation.
 *  • No auto-dismiss — the user closes each pop-up manually.
 *  • Open conversations persist in localStorage so they survive reloads,
 *    session timeouts and re-logins — always restored as minimised chips.
 *  • Replies can be flagged Normal / High / Urgent; pop-ups are ranked with
 *    urgent first, then high, then most recent.
 *
 * Trust model: broadcasts only act as a "go and check" hint. All content shown
 * here comes from the `internal-messaging` edge function, which re-verifies
 * thread participation server-side.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Megaphone,
  MessageSquare,
  Minus,
  Paperclip,
  Send,
  X,
  AlertTriangle,
  Loader2,
  GripVertical,
  RotateCcw,
  UsersRound,
} from 'lucide-react';
import { useDraggablePosition } from '@/hooks/useDraggablePosition';
import { useResizablePanel } from '@/hooks/useResizablePanel';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  isInternalMessagesPanelOpen,
  onInternalMessage,
  onInternalThreadPopOut,
  onInternalTyping,
  publishInternalMessage,
  publishInternalTyping,
  requestPopOutInternalThread,
  type PopOutThreadHint,
} from '@/lib/internalMessagingBus';

import {
  AttachmentDropOverlay,
  InternalAttachmentQueue,
  InternalAttachmentList,
} from '@/components/agent/InternalAttachmentChips';
import { useInternalAttachmentQueue } from '@/hooks/useInternalAttachmentQueue';
import { TypingDots, TypingPresence } from '@/components/messaging/TypingPresence';
import {
  INTERNAL_ATTACHMENT_ACCEPT,
  filesFromDataTransfer,
  type InternalAttachment,
  sendInternalMessageWithAttachments,
  hydrateThreadAttachments,
} from '@/lib/internalMessageAttachments';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

import {
  claimMessageAlert,
  clearTabUnreadBadge,
  closeAllDesktopMessageAlerts,
  consumeInternalThreadDeepLink,
  deliverDesktopMessageAlert,
  dismissDesktopMessageAlert,
  markPromptedDesktopAlerts,
  onServiceWorkerThreadOpen,
  playMessagePing,
  requestDesktopAlertPermission,
  resetMessageAlertClaims,
  seedMessageAlert,
  setTabUnreadBadge,
  shouldOfferDesktopAlerts,
  snoozeDesktopAlertPrompt,
  type DesktopMessageAlert,
} from '@/lib/desktopMessageAlerts';



type Priority = 'normal' | 'high' | 'urgent';

interface PopupMessage {
  id: string;
  body: string;
  created_at: string;
  sender_name: string;
  mine: boolean;
  priority?: Priority;
  attachments?: InternalAttachment[] | null;
}

interface PopupThread {
  thread_id: string;
  kind: 'direct' | 'group' | 'broadcast';
  /** Counterparty / group / announcement title. */
  title: string;
  /** Name of the person who sent the latest inbound message. */
  sender: string;
  priority: Priority;
  lastAt: string;
  unread: number;
  messages: PopupMessage[];
  loading: boolean;
}

/** Chip / header label: DMs read best as the person, everything else as its title. */
function threadLabel(thread: PopupThread) {
  return thread.kind === 'direct' ? thread.sender || thread.title : thread.title || thread.sender;
}


const POLL_MS = 15_000;
/** Collapsed chips shown above the expanded card. */
const MAX_CHIPS = 6;
const OPEN_KEY = 'aurixa.internalMessages.openPopups';
const BASELINE_KEY = 'aurixa.internalMessages.threadBaselines';
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2 };

const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
};

function readOpenIds(): string[] {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function writeOpenIds(ids: string[]) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(ids.slice(0, 8)));
  } catch {
    /* ignore */
  }
}

/**
 * Every conversation restored from localStorage starts life as a minimised
 * chip. Expanding is a deliberate click, so a reload or a fresh sign-in never
 * throws a full transcript over the dashboard.
 */
function bootMinimised(): Record<string, true> {
  const next: Record<string, true> = {};
  readOpenIds().forEach((id) => {
    next[id] = true;
  });
  return next;
}

/** Per-thread "already handled up to this message time" markers. */
function readBaselines(): Record<string, string> {
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeBaselines(map: Record<string, string>) {
  try {
    localStorage.setItem(BASELINE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Chronological compare that degrades to string order on unparsable input. */
function isAfter(candidate: string, reference: string) {
  const a = Date.parse(candidate);
  const b = Date.parse(reference);
  if (Number.isFinite(a) && Number.isFinite(b)) return a > b;
  return candidate > reference;
}

function timeLabel(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * A minimised conversation chip. Each chip can be dragged out of the dock to any
 * spot on the page (position persisted per thread); the grip resets it back to
 * the dock on double-click.
 */
function MinimisedChip({
  thread,
  typingNow,
  onExpand,
  onDismiss,
}: {
  thread: PopupThread;
  typingNow: boolean;
  onExpand: () => void;
  onDismiss: () => void;
}) {
  const drag = useDraggablePosition(`aurixa.internalMessages.chipPos.${thread.thread_id}`);
  const label = threadLabel(thread);


  return (
    <div
      ref={drag.nodeRef}
      style={drag.positionStyle}
      className={cn(
        'pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full border-2 bg-card/95 px-2 py-1.5 backdrop-blur-xl',
        'shadow-[0_0_0_1px_hsl(var(--primary)/0.2),0_12px_28px_-14px_hsl(var(--primary)/0.4)]',
        drag.dragging && 'z-[70] scale-[1.02] shadow-[var(--elevation-3,0_18px_40px_-18px_rgba(0,0,0,0.55))]',
        drag.position && 'z-[65]',
        thread.priority === 'urgent'
          ? 'border-destructive/70 ring-2 ring-destructive/20'
          : thread.priority === 'high'
            ? 'border-warning/70 ring-2 ring-warning/15'
            : 'border-primary/55 ring-2 ring-primary/15',
      )}

    >
      <span
        {...drag.handleProps}
        onDoubleClick={drag.reset}
        role="button"
        tabIndex={-1}
        aria-label={`Move ${label} chat — double-click to snap back`}
        title="Drag to move · double-click to snap back"
        className="shrink-0 cursor-grab text-muted-foreground/70 hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      <button
        type="button"
        onClick={onExpand}
        className="flex min-w-0 items-center gap-2 text-left"
        aria-label={`Expand conversation with ${label}`}
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase',
            thread.kind === 'broadcast' ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary',
          )}
        >
        {thread.kind === 'broadcast' ? (
          <Megaphone className="h-3 w-3" />
        ) : thread.kind === 'group' ? (
          <UsersRound className="h-3 w-3" />
        ) : (
          thread.sender?.trim()?.[0] ?? <MessageSquare className="h-3 w-3" />
        )}

        </span>
        <span className="truncate text-xs font-semibold text-foreground">{label}</span>
        {thread.unread > 0 && (
          <span
            aria-label={`${thread.unread} unread message${thread.unread === 1 ? '' : 's'}`}
            className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold tabular-nums text-primary-foreground shadow-[0_0_0_2px_hsl(var(--card)),0_0_12px_hsl(var(--primary)/0.6)]"
          >
            {thread.unread > 99 ? '99+' : thread.unread}
          </span>
        )}
        {typingNow && <TypingDots className="shrink-0" />}
      </button>
      <button
        type="button"
        aria-label="Close conversation"
        onClick={onDismiss}
        className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}


export function InternalMessageToasts() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<PopupThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [priorities, setPriorities] = useState<Record<string, Priority>>({});
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  /**
   * Threads the user explicitly minimised. They stay open as side chips (like
   * the Going Live dock) instead of jumping into the Aurixa agent.
   */
  const [minimised, setMinimised] = useState<Record<string, true>>(bootMinimised);
  /**
   * One upload queue serves the expanded card (only one card is expanded at a
   * time). It tracks per-file progress, retries and errors.
   */
  const attachmentQueue = useInternalAttachmentQueue();
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const queuedForRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);


  const threadsRef = useRef<PopupThread[]>([]);
  threadsRef.current = threads;
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;
  /** Minimised map, read inside the poll loop without re-creating it. */
  const minimisedRef = useRef<Record<string, true>>({});
  minimisedRef.current = minimised;




  /** Baselines: thread_id → ISO timestamp of the newest message already handled. */
  const baselinesRef = useRef<Record<string, string>>(readBaselines());
  /** Session start — messages older than this never pop on first load. */
  const bootAtRef = useRef<string>(new Date().toISOString());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** thread_id → last time we broadcast a typing hint (throttling). */
  const lastTypingSentRef = useRef<Record<string, number>>({});
  /**
   * Desktop-alert bookkeeping. The "have we already alerted on this message?"
   * ledger lives in `desktopMessageAlerts` (shared across every tab and across
   * reloads); this ref only records whether THIS mount has completed its first
   * sweep, so a freshly-loaded tab seeds the ledger instead of replaying a
   * backlog of notifications.
   */
  const alertBootstrappedRef = useRef(false);
  /**
   * Messages that arrived while the OS route was unavailable (permission not
   * granted, alerts switched off, notification API missing). They become a
   * single quiet catch-up toast the next time the user looks at this tab, so
   * "notifications are off" never means "you silently missed something".
   */
  const missedRef = useRef<Map<string, { sender: string; hint: PopOutThreadHint }>>(new Map());
  /** One opt-in invitation per mount, at most. */
  const invitedRef = useRef(false);
  /** Who the alert ledger currently belongs to. */
  const alertOwnerRef = useRef<string | null>(null);




  const persist = useCallback((next: PopupThread[]) => {
    writeOpenIds(next.map((t) => t.thread_id));
  }, []);

  const setBaseline = useCallback((threadId: string, iso: string) => {
    baselinesRef.current = { ...baselinesRef.current, [threadId]: iso };
    writeBaselines(baselinesRef.current);
  }, []);

  const loadMessages = useCallback(async (threadId: string, clearUnread = true) => {
    try {
      const { data } = await invokeSecureFunction('internal-messaging', {
        action: 'get_thread',
        thread_id: threadId,
        // Only an explicit open marks the conversation reviewed server-side.
        mark_read: clearUnread,
      });
      const msgs: PopupMessage[] = await hydrateThreadAttachments(
        threadId,
        (data?.messages ?? []).slice(-60) as PopupMessage[],
      );
      setThreads((prev) =>
        prev.map((t) =>
          t.thread_id === threadId
            ? { ...t, messages: msgs, loading: false, unread: clearUnread ? 0 : t.unread }
            : t,
        ),
      );
    } catch {
      setThreads((prev) =>
        prev.map((t) => (t.thread_id === threadId ? { ...t, loading: false } : t)),
      );
    }
  }, []);


  /**
   * Offer desktop alerts once, in context, and never as a modal. Browsers only
   * grant `Notification` permission from a user gesture, so the actual request
   * is made from the toast's own button — the user opts in deliberately rather
   * than being ambushed by a browser dialog on first click.
   */
  const offerDesktopAlerts = useCallback(() => {
    if (invitedRef.current || !shouldOfferDesktopAlerts()) return;
    invitedRef.current = true;

    toast('Turn on desktop alerts for team messages?', {
      description:
        'Get notified when a colleague messages you while you are in another tab, page or module. You can change this any time in Settings.',
      duration: 15000,
      action: {
        label: 'Enable',
        onClick: () => {
          markPromptedDesktopAlerts();
          void requestDesktopAlertPermission().then((result) => {
            if (result === 'granted') {
              toast.success('Desktop alerts on', {
                description:
                  'New team messages will now reach your desktop, even while the dashboard is in the background.',
                duration: 6000,
              });
            } else if (result === 'denied') {
              toast.message('Desktop alerts stay off', {
                description:
                  'Your browser is blocking notifications for this site. Messages will keep arriving in the dashboard — you can allow notifications later from the padlock icon in the address bar.',
                duration: 8000,
              });
            }
          });
        },
      },
      cancel: {
        label: 'Not now',
        onClick: () => markPromptedDesktopAlerts(),
      },
      // Ignoring a toast is not the same as declining: go quiet for a week
      // rather than forever.
      onDismiss: () => snoozeDesktopAlertPrompt(),
      onAutoClose: () => snoozeDesktopAlertPrompt(),
    });
  }, []);

  /** Poll thread list: opens new pop-ups and refreshes already-open ones. */
  const check = useCallback(async () => {
    try {
      const { data } = await invokeSecureFunction('internal-messaging', { action: 'list_threads' });
      const list: any[] = data?.threads ?? [];
      const panelOpen = isInternalMessagesPanelOpen();
      const openIds = new Set(threadsRef.current.map((t) => t.thread_id));
      const persistedIds = new Set(readOpenIds());

      const toRefresh: string[] = [];
      const additions: PopupThread[] = [];
      let totalUnread = 0;
      let loudestSender: string | null = null;

      for (const t of list) {
        const lastAt: string | null = t.last_message_at ?? null;
        const senderName =
          t.last_message_sender_name && t.last_message_sender_name !== 'You'
            ? t.last_message_sender_name
            : t.kind === 'broadcast'
              ? t.display_title || 'Announcement'
              : t.display_title || 'Team member';

        totalUnread += t.unread ?? 0;

        // ---- OS-level desktop alert -------------------------------------
        // Fires whenever an inbound message is newer than the last one anyone
        // alerted on. `claimMessageAlert` is shared across every open tab and
        // survives reloads, so the user is notified exactly once per message no
        // matter how many dashboards they have open. The alert itself
        // self-suppresses when the tab is focused — the in-app chip has it.
        const inbound =
          !!lastAt &&
          (t.unread ?? 0) > 0 &&
          t.last_message_sender_name !== 'You';
        if (inbound) {
          const kind: DesktopMessageAlert['kind'] =
            t.kind === 'broadcast' ? 'broadcast' : t.kind === 'group' ? 'group' : 'direct';
          // Anything predating this mount is backlog: on the first sweep it is
          // recorded as seen (chips carry it) rather than replayed as a wall of
          // OS notifications. A message that lands *after* boot is genuinely
          // new even if the first sweep is what finds it — which also keeps the
          // desktop→mobile layout swap (a remount) from dropping an alert.
          if (!alertBootstrappedRef.current && !isAfter(lastAt!, bootAtRef.current)) {
            seedMessageAlert(t.id, lastAt!);
          } else if (claimMessageAlert(t.id, lastAt!)) {
            if (!loudestSender) loudestSender = senderName;
            const title = t.display_title || 'Team message';
            const alert: DesktopMessageAlert = {
              thread_id: t.id,
              title,
              sender: senderName,
              body: typeof t.last_message_preview === 'string' ? t.last_message_preview : '',
              kind,
              priority: (t.last_message_priority as Priority) ?? 'normal',
            };
            void deliverDesktopMessageAlert(alert).then((outcome) => {
              if (outcome === 'shown') {
                playMessagePing();
                return;
              }
              // The user is looking at this tab — the chip is the notification.
              if (outcome === 'suppressed-focused') return;
              // No OS route: ping (best effort) and queue the catch-up toast.
              playMessagePing();
              missedRef.current.set(t.id, {
                sender: senderName,
                hint: { thread_id: t.id, kind, title },
              });
              // A message just landed and desktop alerts are still unanswered —
              // the most useful possible moment to offer them.
              offerDesktopAlerts();
            });
          }
        }



        if (openIds.has(t.id)) {
          const current = threadsRef.current.find((x) => x.thread_id === t.id);
          const changed = !!lastAt && current?.lastAt !== lastAt;
          const isMinimised = !!minimisedRef.current[t.id];
          const isExpanded = activeRef.current === t.id && !isMinimised;
          if (current && (!current.messages.length || changed)) toRefresh.push(t.id);
          setThreads((prev) =>
            prev.map((x) =>
              x.thread_id === t.id
                ? {
                    ...x,
                    lastAt: lastAt ?? x.lastAt,
                    priority: (t.last_message_priority as Priority) ?? x.priority,
                    sender: senderName,
                    // The chip carries the count; the expanded card is "read".
                    // A background poll must never shrink a pending badge — it
                    // only clears when the user opens (reviews) the chat.
                    unread: isExpanded
                      ? 0
                      : Math.max(t.unread ?? 0, x.unread ?? 0),
                  }
                : x,
            ),
          );
          // A new inbound message only bumps the chip's unread badge. It never
          // promotes a conversation to a full card — expanding stays a
          // deliberate user action.

          continue;
        }

        // Re-open rule: any inbound message newer than the per-thread baseline
        // (or newer than this session's boot time for never-seen threads).
        const baseline = baselinesRef.current[t.id] ?? bootAtRef.current;
        const hasFreshInbound =
          (t.unread ?? 0) > 0 && !!lastAt && new Date(lastAt) > new Date(baseline);

        const shouldOpen = persistedIds.has(t.id) || (hasFreshInbound && !panelOpen);
        if (!shouldOpen) continue;

        additions.push({
          thread_id: t.id,
          kind: t.kind === 'broadcast' ? 'broadcast' : t.kind === 'group' ? 'group' : 'direct',
          title: t.display_title || 'Team message',
          sender: senderName,
          priority: (t.last_message_priority as Priority) ?? 'normal',
          lastAt: lastAt ?? new Date().toISOString(),
          unread: t.unread ?? 0,
          messages: [],
          loading: true,
        });
      }

      if (additions.length) {
        setThreads((prev) => {
          const next = [
            ...prev,
            ...additions.filter((a) => !prev.some((p) => p.thread_id === a.thread_id)),
          ];
          persist(next);
          return next;
        });
        // Arrive minimised: the chip's unread badge is the notification. Nothing
        // steals the screen, and no transcript is marked read behind the user.
        setMinimised((prev) => {
          const next = { ...prev };
          additions.forEach((a) => {
            next[a.thread_id] = true;
          });
          return next;
        });
        additions.forEach((a) => loadMessages(a.thread_id, false));
      }

      // Tab title badge: signals a background-but-visible tab in the tab strip.
      setTabUnreadBadge(totalUnread, loudestSender ?? undefined);
      // Offer the opt-in only to people who actually use internal messaging,
      // and never on the first sweep — landing on the dashboard should not be
      // greeted by a prompt.
      if (alertBootstrappedRef.current && list.length) offerDesktopAlerts();
      // The first sweep only records state — it must never replay a backlog of
      // OS notifications when the dashboard is opened.
      alertBootstrappedRef.current = true;

      // Refreshing a minimised conversation must not clear its unread badge.
      toRefresh.forEach((id) =>
        loadMessages(id, activeRef.current === id && !minimisedRef.current[id]),
      );

    } catch {
      /* silent — badge/panel remain the source of truth */
    }
  }, [loadMessages, persist, offerDesktopAlerts]);

  /**
   * The alert ledger is per-person, not per-browser. On a sign-out or a switch
   * of user, drop it (and any bubble still on screen) — a stale claim from the
   * previous account would otherwise silence the new one's first message.
   */
  useEffect(() => {
    const id = user?.id ?? null;
    if (alertOwnerRef.current && alertOwnerRef.current !== id) {
      resetMessageAlertClaims();
      missedRef.current.clear();
      closeAllDesktopMessageAlerts();
      alertBootstrappedRef.current = false;
    }
    alertOwnerRef.current = id;
  }, [user?.id]);

  // Realtime hint + safety-net poll
  useEffect(() => {
    if (!user) return;
    const off = onInternalMessage(() => {
      check();
    });
    check();
    const id = setInterval(check, POLL_MS);
    // Background tabs get their timers throttled, so re-sync the moment the
    // dashboard becomes visible again (and whenever it regains focus).
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      off();
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearTabUnreadBadge();
    };
  }, [user, check]);

  /**
   * Fallback for every context the OS route cannot serve — permission not
   * granted, alerts switched off, an unsupported browser, or a preview iframe.
   * Messages that could not raise a desktop notification are summarised in one
   * quiet toast the moment the user comes back to this tab, with a direct way
   * into the conversation. Nothing is ever silently missed.
   */
  useEffect(() => {
    if (!user) return;
    const flush = () => {
      if (document.visibilityState !== 'visible') return;
      const missed = [...missedRef.current.entries()];
      if (!missed.length) return;
      missedRef.current.clear();

      const senders = [...new Set(missed.map(([, m]) => m.sender))];
      const names =
        senders.length === 1
          ? senders[0]
          : `${senders.slice(0, 2).join(', ')}${senders.length > 2 ? ` +${senders.length - 2} more` : ''}`;
      const latest = missed[missed.length - 1][1];

      toast.message(
        missed.length === 1
          ? `New message from ${latest.sender}`
          : `${missed.length} new team messages`,
        {
          description:
            missed.length === 1
              ? 'Received while you were working elsewhere.'
              : `From ${names}, received while you were working elsewhere.`,
          duration: 10000,
          action: {
            label: 'Open',
            onClick: () => requestPopOutInternalThread(latest.hint),
          },
        },
      );
    };

    document.addEventListener('visibilitychange', flush);
    window.addEventListener('focus', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('focus', flush);
    };
  }, [user]);

  /**
   * Notification click routing. Two arrival paths, one destination:
   *  • the service worker posts to an already-open dashboard, so the user lands
   *    back in the conversation without losing the page they were working on;
   *  • a cold start (no window was open) carries `?internalThread=` instead.
   */
  useEffect(() => {
    if (!user) return;
    const deepLinked = consumeInternalThreadDeepLink();
    if (deepLinked) requestPopOutInternalThread({ thread_id: deepLinked });
    return onServiceWorkerThreadOpen((hint) => requestPopOutInternalThread(hint));
  }, [user]);



  /**
   * "Pop out chat" from the Aurixa widget: detach any conversation (direct,
   * group or announcement) into a free-floating, draggable, resizable window.
   * Unlike inbound traffic, this IS a deliberate user action, so the thread is
   * expanded immediately.
   */
  useEffect(() => {
    if (!user) return;
    return onInternalThreadPopOut((hint) => {
      const id = hint.thread_id;
      setThreads((prev) => {
        if (prev.some((t) => t.thread_id === id)) return prev;
        const seeded: PopupThread = {
          thread_id: id,
          kind: hint.kind ?? 'direct',
          title: hint.title || 'Team message',
          sender: hint.title || 'Team member',
          priority: 'normal',
          lastAt: new Date().toISOString(),
          unread: 0,
          messages: [],
          loading: true,
        };
        const next = [...prev, seeded];
        persist(next);
        return next;
      });
      // Clear any "minimised" memory so the card actually opens.
      setMinimised((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setActiveId(id);
      // The conversation is now on screen: retire every other signal for it.
      dismissDesktopMessageAlert(id);
      missedRef.current.delete(id);
      loadMessages(id, true);
      // Pull authoritative title / sender / priority for the new pop-out.
      check();
    });
  }, [user, persist, loadMessages, check]);


  // Pop-ups never auto-expand. A conversation is only ever rendered as a full
  // card when the user clicks its chip, so signing in with ten live threads
  // shows ten compact chips instead of ten stacked chat windows.
  useEffect(() => {
    if (!activeId) return;
    if (!threads.some((t) => t.thread_id === activeId)) setActiveId(null);
  }, [threads, activeId]);



  // Typing hints for threads with an open pop-up.
  useEffect(() => {
    if (!user) return;
    const off = onInternalTyping((s) => {
      if (s.user_id === user.id) return;
      if (!threadsRef.current.some((t) => t.thread_id === s.thread_id)) return;
      setTyping((prev) => ({ ...prev, [s.thread_id]: { name: s.user_name, at: Date.now() } }));
    });
    const sweep = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next: typeof prev = {};
        for (const [k, v] of Object.entries(prev)) if (now - v.at < 5000) next[k] = v;
        return next;
      });
    }, 1500);
    return () => {
      off();
      clearInterval(sweep);
    };
  }, [user]);

  /**
   * A conversation is expanded only while it is the active thread AND not
   * minimised. Threads restored on boot are always minimised, so the card can
   * never reappear on reload or re-login.
   */
  const active = useMemo(
    () => threads.find((t) => t.thread_id === activeId && !minimised[t.thread_id]) ?? null,
    [threads, activeId, minimised],
  );

  // Pin the transcript to the newest message (or the typing bubble) so nothing
  // is cut off.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    active?.thread_id,
    active?.messages.length,
    active?.loading,
    activeId ? !!typing[activeId] : false,
  ]);


  const dismiss = useCallback(
    (threadId: string) => {
      const thread = threadsRef.current.find((t) => t.thread_id === threadId);
      setBaseline(threadId, thread?.lastAt ?? new Date().toISOString());
      setThreads((prev) => {
        const next = prev.filter((t) => t.thread_id !== threadId);
        persist(next);
        return next;
      });
      setMinimised((prev) => {
        if (!prev[threadId]) return prev;
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
      if (queuedForRef.current === threadId) {
        queuedForRef.current = null;
        attachmentQueue.clear();
      }
      // Closing the chip is an acknowledgement: retire the OS bubble and drop
      // the thread from the catch-up summary.
      dismissDesktopMessageAlert(threadId);
      missedRef.current.delete(threadId);

      if (activeRef.current === threadId) setActiveId(null);
    },
    [persist, setBaseline],
  );

  /** Collapse the expanded card into a side chip (never opens another card). */
  const minimise = useCallback((threadId: string) => {
    setMinimised((prev) => ({ ...prev, [threadId]: true }));
    setActiveId((current) => (current === threadId ? null : current));
  }, []);



  /** Stage files against the expanded thread (drag, paste or picker). */
  const addFilesFor = useCallback(
    (threadId: string, files: File[]) => {
      if (!files.length) return;
      if (queuedForRef.current !== threadId) {
        attachmentQueue.clear();
        queuedForRef.current = threadId;
      }
      attachmentQueue.addFiles(files);
    },
    [attachmentQueue],
  );


  const send = useCallback(
    async (thread: PopupThread) => {
      const text = (drafts[thread.thread_id] ?? '').trim();
      const hasFiles =
        queuedForRef.current === thread.thread_id && attachmentQueue.items.length > 0;
      if ((!text && !hasFiles) || sending[thread.thread_id]) return;
      const priority = priorities[thread.thread_id] ?? 'normal';
      setSending((p) => ({ ...p, [thread.thread_id]: true }));
      try {
        let attachments: InternalAttachment[] = [];
        if (hasFiles) {
          const { uploaded, failed } = await attachmentQueue.uploadAll(thread.thread_id);
          if (failed.length) {
            setSending((p) => ({ ...p, [thread.thread_id]: false }));
            return;
          }
          attachments = uploaded;
          attachmentQueue.clear();
          queuedForRef.current = null;
        }

        const data = attachments.length
          ? await sendInternalMessageWithAttachments(thread.thread_id, text, attachments, priority)
          : (await invokeSecureFunction('internal-messaging', {
              action: 'send_message',
              thread_id: thread.thread_id,
              body: text,
              priority,
            })).data;
        const msg = data?.message;
        if (Array.isArray(msg?.attachments)) attachments = msg.attachments;
        const createdAt = msg?.created_at ?? new Date().toISOString();

        setDrafts((p) => ({ ...p, [thread.thread_id]: '' }));
        setBaseline(thread.thread_id, createdAt);
        setThreads((prev) =>
          prev.map((t) =>
            t.thread_id === thread.thread_id
              ? {
                  ...t,
                  lastAt: createdAt,
                  messages: [
                    ...t.messages,
                    {
                      id: msg?.id ?? `local-${Date.now()}`,
                      body: text,
                      created_at: createdAt,
                      sender_name: 'You',
                      mine: true,
                      priority,
                      attachments,
                    },
                  ].slice(-60),
                }
              : t,
          ),
        );
        publishInternalMessage({
          thread_id: thread.thread_id,
          sender_id: user?.id ?? null,
          sender_name: 'You',
        });
      } catch {
        /* keep the draft so nothing is lost */
      } finally {
        setSending((p) => ({ ...p, [thread.thread_id]: false }));
      }
    },
    [drafts, attachmentQueue, priorities, sending, user, setBaseline],

  );

  const onDraftChange = useCallback(
    (thread: PopupThread, value: string) => {
      setDrafts((p) => ({ ...p, [thread.thread_id]: value }));
      if (!value.trim() || !user) return;
      // Throttle so a fast typist emits at most one hint every 1.2s.
      const now = Date.now();
      if (now - (lastTypingSentRef.current[thread.thread_id] ?? 0) < 1200) return;
      lastTypingSentRef.current[thread.thread_id] = now;
      publishInternalTyping({
        thread_id: thread.thread_id,
        user_id: user.id,
        user_name: (user as any).username ?? 'A team member',
      });
    },
    [user],
  );


  /** Collapsed chips: every open conversation except the expanded one. */
  const chips = useMemo(
    () =>
      threads
        .filter((t) => t.thread_id !== active?.thread_id)
        .sort((a, b) => {
          const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
          if (p !== 0) return p;
          return a.lastAt < b.lastAt ? 1 : -1;
        })
        .slice(0, MAX_CHIPS),
    [threads, active?.thread_id],
  );

  /** The whole minimised stack can be dragged anywhere on the page. */
  const dock = useDraggablePosition('aurixa.internalMessages.dockPos');

  /**
   * The expanded conversation can be resized by dragging its bottom-left grip.
   * The dock is right-anchored, so dragging left grows the panel (`invertX`).
   */
  const panelResize = useResizablePanel('aurixa.internalMessages.panelSize', {
    invertX: true,
    minWidth: 288,
    minHeight: 260,
    maxWidth: 780,
    maxHeight: 820,
  });

  const priority = active ? priorities[active.thread_id] ?? 'normal' : 'normal';

  const typer = active ? typing[active.thread_id] : undefined;
  const headline = active ? threadLabel(active) : '';

  if (!user || (!active && !chips.length)) return null;

  return (
    <div
      ref={dock.nodeRef}
      style={{
        ...dock.positionStyle,
        ...(panelResize.size ? { width: panelResize.size.width } : {}),
      }}
      className={cn(
        'pointer-events-none fixed right-4 top-20 z-[60] flex flex-col items-end gap-2',
        !panelResize.size && 'w-[min(26rem,calc(100vw-2rem))]',
        (dock.dragging || panelResize.resizing) && 'z-[70]',
      )}
    >
      {/* Dock handle — drag the whole stack anywhere on the page */}
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-primary/40 bg-card/95 px-2.5 py-1.5 shadow-lg shadow-primary/10 ring-1 ring-primary/10 backdrop-blur-xl">
        <span
          {...dock.handleProps}
          role="button"
          tabIndex={-1}
          aria-label="Move messages dock"
          title="Drag to move all minimised chats"
          className="flex cursor-grab items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
          <span className="hidden sm:inline">Move</span>
        </span>
        {(dock.position || panelResize.size) && (
          <button
            type="button"
            onClick={() => {
              dock.reset();
              panelResize.reset();
            }}
            aria-label="Reset chat position and size"
            title="Reset position & size"
            className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        )}
      </div>

      {/* Collapsed conversations — name only, transcript hidden */}
      {chips.map((t) => (
        <MinimisedChip
          key={t.thread_id}
          thread={t}
          typingNow={!!typing[t.thread_id]}
          onExpand={() => {
            setMinimised((prev) => {
              if (!prev[t.thread_id]) return prev;
              const next = { ...prev };
              delete next[t.thread_id];
              return next;
            });
            setActiveId(t.thread_id);
            // Opening the conversation is what marks it read.
            setThreads((prev) =>
              prev.map((x) => (x.thread_id === t.thread_id ? { ...x, unread: 0 } : x)),
            );
            dismissDesktopMessageAlert(t.thread_id);
            missedRef.current.delete(t.thread_id);
            loadMessages(t.thread_id, true);

          }}
          onDismiss={() => dismiss(t.thread_id)}
        />
      ))}


      {/* Expanded conversation */}
      {active && (
      <div
        ref={panelResize.nodeRef}
        style={panelResize.size ? { height: panelResize.size.height } : undefined}
        role="dialog"
        aria-label={`Message from ${headline}`}
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
          addFilesFor(active.thread_id, dropped);
        }}
        className={cn(
          'pointer-events-auto relative flex w-full flex-col overflow-hidden rounded-3xl border-2 bg-card/95 backdrop-blur-xl',
          // Own identity: a lit primary edge plus a coloured halo so the panel
          // never camouflages against the dark dashboard behind it.
          'shadow-[0_0_0_1px_hsl(var(--primary)/0.22),0_24px_60px_-20px_hsl(var(--primary)/0.35),var(--elevation-3,0_18px_40px_-18px_rgba(0,0,0,0.55))]',
          'animate-in slide-in-from-right-4 fade-in-0 motion-reduce:animate-none',
          active.priority === 'urgent'
            ? 'border-destructive/70 ring-2 ring-destructive/25'
            : active.priority === 'high'
              ? 'border-warning/70 ring-2 ring-warning/20'
              : 'border-primary/55 ring-2 ring-primary/15',
        )}
      >
        {/* Identity accent — blue · gold · purple, matching the typing signal */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-info via-primary to-chart-5 opacity-90"
        />

        {/* Resize grip — drag the bottom-left corner to size the conversation.
            Arrow keys nudge it for keyboard users; double-click restores the
            default size. */}
        <span
          {...panelResize.handleProps}
          role="slider"
          tabIndex={0}
          aria-label="Resize conversation window"
          aria-valuetext={
            panelResize.size
              ? `${Math.round(panelResize.size.width)} by ${Math.round(panelResize.size.height)} pixels`
              : 'Default size'
          }
          title="Drag to resize · double-click to reset"
          onDoubleClick={panelResize.reset}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 48 : 16;
            if (e.key === 'ArrowLeft') panelResize.nudge(step, 0);
            else if (e.key === 'ArrowRight') panelResize.nudge(-step, 0);
            else if (e.key === 'ArrowDown') panelResize.nudge(0, step);
            else if (e.key === 'ArrowUp') panelResize.nudge(0, -step);
            else return;
            e.preventDefault();
          }}
          className={cn(
            'absolute bottom-0 left-0 z-10 flex h-6 w-6 cursor-nesw-resize items-end justify-start rounded-bl-3xl',
            'text-muted-foreground/60 transition-colors hover:text-primary focus-visible:outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring',
            panelResize.resizing && 'text-primary',
          )}
        >
          <svg viewBox="0 0 12 12" aria-hidden className="h-3.5 w-3.5 translate-x-1 -translate-y-1">
            <path d="M11 1 L1 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M11 5.5 L5.5 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
        {dragActive && <AttachmentDropOverlay />}



        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-border/50 px-3.5 py-2.5">
          <span
            {...dock.handleProps}
            role="button"
            tabIndex={-1}
            aria-label="Move conversation"
            title="Drag to move"
            className="-ml-1 shrink-0 cursor-grab text-muted-foreground/70 hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </span>
          <span

            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold uppercase',
              active.kind === 'broadcast' ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary',
            )}
          >
            {active.kind === 'broadcast' ? (
              <Megaphone className="h-4 w-4" />
            ) : active.kind === 'group' ? (
              <UsersRound className="h-4 w-4" />
            ) : (
              active.sender?.trim()?.[0] ?? <MessageSquare className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{headline}</p>
            <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground/80">
              {active.kind === 'broadcast'
                ? 'Announcement'
                : active.kind === 'group'
                  ? 'Group chat'
                  : 'Direct message'}
              {active.priority !== 'normal' && ` · ${PRIORITY_LABEL[active.priority]}`}
            </p>
          </div>

          {active.priority === 'urgent' && (
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          )}
          <button
            type="button"
            aria-label="Minimise conversation"
            title="Minimise"
            onClick={() => minimise(active.thread_id)}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Close message"
            onClick={() => dismiss(active.thread_id)}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Conversation — native scroll so the newest bubble is never clipped */}
        <div
          ref={scrollRef}
          className={cn(
            'overflow-y-auto overscroll-contain px-3 py-2.5 scrollbar-premium',
            panelResize.size ? 'min-h-0 flex-1' : 'h-64',
          )}
          aria-live="polite"
        >
          {active.loading ? (
            <div className="flex items-center gap-2 py-4 text-[11px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading conversation…
            </div>
          ) : active.messages.length === 0 ? (
            <p className="py-4 text-[11px] text-muted-foreground">No messages yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {active.messages.map((m) => (
                <div key={m.id} className={cn('flex flex-col', m.mine ? 'items-end' : 'items-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[12px] leading-snug',
                      m.mine
                        ? 'rounded-br-md bg-primary text-primary-foreground'
                        : 'rounded-bl-md bg-muted text-foreground',
                      m.priority === 'urgent' && !m.mine && 'ring-1 ring-destructive/50',
                    )}
                  >
                    {m.body}
                    {!m.body?.trim() && !(m.attachments?.length) && (
                      <span className="italic opacity-70">Attachment unavailable</span>
                    )}
                    <InternalAttachmentList
                      threadId={active.thread_id}
                      attachments={m.attachments ?? []}
                      mine={m.mine}
                    />
                  </div>
                  <span className="mt-0.5 px-1 text-[9px] text-muted-foreground/70">
                    {m.mine ? 'You' : m.sender_name} · {timeLabel(m.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {typer && (
            <div className="mt-1.5" aria-live="polite">
              <TypingPresence people={[{ name: typer.name }]} />
            </div>
          )}


        </div>

        {/* Reply */}
        <div className="border-t border-border/50 px-3 py-2.5">
          <InternalAttachmentQueue
            items={attachmentQueue.items}
            onRemove={attachmentQueue.remove}
            onRetry={(id) => attachmentQueue.retry(active.thread_id, id)}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={INTERNAL_ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              addFilesFor(active.thread_id, Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />

          <Textarea
            value={drafts[active.thread_id] ?? ''}
            onChange={(e) => onDraftChange(active, e.target.value)}
            onPaste={(e) => {
              const pasted = filesFromDataTransfer(e.clipboardData);
              if (!pasted.length) return;
              e.preventDefault();
              addFilesFor(active.thread_id, pasted);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(active);
              }
            }}
            placeholder="Reply… (drag or paste files to attach)"
            rows={2}
            className="min-h-[46px] resize-none rounded-2xl border-border/60 bg-background/60 text-[12px]"
          />

          <div className="mt-2 flex items-center justify-between gap-2 pl-8">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Attach files"
                title="Attach files — any format, any size"
                onClick={() => fileInputRef.current?.click()}
                className="mr-1 flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              {(['normal', 'high', 'urgent'] as Priority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriorities((prev) => ({ ...prev, [active.thread_id]: p }))}
                  aria-pressed={priority === p}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
                    priority === p
                      ? p === 'urgent'
                        ? 'border-destructive bg-destructive/15 text-destructive'
                        : p === 'high'
                          ? 'border-warning bg-warning/15 text-warning'
                          : 'border-primary bg-primary/15 text-primary'
                      : 'border-border/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              className="h-7 gap-1.5 rounded-full px-3 text-[11px]"
              disabled={
                (!((drafts[active.thread_id] ?? '').trim()) &&
                  attachmentQueue.items.length === 0) ||
                !!sending[active.thread_id]
              }

              onClick={() => send(active)}
            >
              {sending[active.thread_id] ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Send
            </Button>
          </div>
        </div>
      </div>
      )}
    </div>

  );
}

export default InternalMessageToasts;
