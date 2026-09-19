/**
 * Internal messaging realtime bus.
 *
 * The internal messaging tables are service_role-only, so Postgres change
 * streams are not available to the browser. Instead every Command Centre tab
 * joins one shared Supabase Realtime **broadcast** channel and publishes two
 * lightweight signals:
 *
 *   • `message` — "something was posted in thread X" (no message content is
 *     trusted from the wire: receivers re-fetch through the edge function,
 *     which re-verifies participation).
 *   • `typing`  — ephemeral typing indicator for a thread.
 *
 * Broadcast payloads are hints only. Nothing here grants access to data.
 */
import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

const CHANNEL = 'internal-messaging-bus';

export interface MessageSignal {
  thread_id: string;
  sender_id?: string | null;
  sender_name?: string | null;
  at: string;
}

export interface TypingSignal {
  thread_id: string;
  user_id: string;
  user_name: string;
  at: string;
}

type MessageHandler = (signal: MessageSignal) => void;
type TypingHandler = (signal: TypingSignal) => void;

let channel: RealtimeChannel | null = null;
let refCount = 0;
const messageHandlers = new Set<MessageHandler>();
const typingHandlers = new Set<TypingHandler>();

function ensureChannel(): RealtimeChannel {
  if (channel) return channel;
  channel = supabase
    .channel(CHANNEL, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'message' }, ({ payload }) => {
      messageHandlers.forEach((h) => {
        try { h(payload as MessageSignal); } catch { /* ignore handler faults */ }
      });
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      typingHandlers.forEach((h) => {
        try { h(payload as TypingSignal); } catch { /* ignore handler faults */ }
      });
    });
  channel.subscribe();
  return channel;
}

function release() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && channel) {
    const ch = channel;
    channel = null;
    supabase.removeChannel(ch);
  }
}

/** Subscribe to "new message posted" hints. Returns an unsubscribe fn. */
export function onInternalMessage(handler: MessageHandler): () => void {
  ensureChannel();
  refCount += 1;
  messageHandlers.add(handler);
  return () => {
    messageHandlers.delete(handler);
    release();
  };
}

/** Subscribe to typing hints. Returns an unsubscribe fn. */
export function onInternalTyping(handler: TypingHandler): () => void {
  ensureChannel();
  refCount += 1;
  typingHandlers.add(handler);
  return () => {
    typingHandlers.delete(handler);
    release();
  };
}

export function publishInternalMessage(signal: Omit<MessageSignal, 'at'>) {
  try {
    ensureChannel().send({
      type: 'broadcast',
      event: 'message',
      payload: { ...signal, at: new Date().toISOString() },
    });
  } catch { /* best-effort */ }
}

export function publishInternalTyping(signal: Omit<TypingSignal, 'at'>) {
  try {
    ensureChannel().send({
      type: 'broadcast',
      event: 'typing',
      payload: { ...signal, at: new Date().toISOString() },
    });
  } catch { /* best-effort */ }
}

/**
 * Tracks whether the Aurixa widget is currently showing the internal messages
 * panel. Pop-up alerts are suppressed while the user is already reading there.
 */
let messagesPanelOpen = false;

export function setInternalMessagesPanelOpen(open: boolean) {
  messagesPanelOpen = open;
}

export function isInternalMessagesPanelOpen() {
  return messagesPanelOpen;
}

/** Window event used to pop the Aurixa widget open on the messages panel. */
export const OPEN_INTERNAL_MESSAGES_EVENT = 'aurixa:open-internal-messages';

export function requestOpenInternalMessages(threadId?: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_INTERNAL_MESSAGES_EVENT, { detail: { threadId } }),
  );
}

/**
 * Window event used to detach a conversation from the Aurixa widget into a
 * free-floating, draggable, resizable pop-out chat window.
 */
export const POP_OUT_INTERNAL_THREAD_EVENT = 'aurixa:pop-out-internal-thread';

export interface PopOutThreadHint {
  thread_id: string;
  kind?: 'direct' | 'group' | 'broadcast';
  /** Best-known display title so the pop-out renders instantly. */
  title?: string | null;
}

/** Ask the floating pop-out layer to open (and expand) this conversation. */
export function requestPopOutInternalThread(hint: PopOutThreadHint) {
  window.dispatchEvent(
    new CustomEvent(POP_OUT_INTERNAL_THREAD_EVENT, { detail: hint }),
  );
}

/** Subscribe to pop-out requests. Returns an unsubscribe fn. */
export function onInternalThreadPopOut(
  handler: (hint: PopOutThreadHint) => void,
): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent).detail as PopOutThreadHint | undefined;
    if (detail?.thread_id) handler(detail);
  };
  window.addEventListener(POP_OUT_INTERNAL_THREAD_EVENT, listener);
  return () => window.removeEventListener(POP_OUT_INTERNAL_THREAD_EVENT, listener);
}


