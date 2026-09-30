import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useAuthUserIdOptional } from '@/hooks/useAuth';
import {
  BUILDER_BADGE_SOURCE, claimMessageAlert, clearSourceUnreadBadge, deliverPageAlert, dismissPageAlert,
  markPromptedDesktopAlerts, onServiceWorkerOpenPage, playMessagePing, requestDesktopAlertPermission,
  seedMessageAlert, setSourceUnreadBadge, shouldOfferDesktopAlerts, snoozeDesktopAlertPrompt,
} from '@/lib/desktopMessageAlerts';
import { builderMessageArrivalKeys } from '@/lib/marketplaceBuilderStock';
import {
  BUILDER_MESSAGE_BACKGROUND_POLL_MS, BUILDER_MESSAGE_POPUP_POLL_MS, builderAlertKey, builderCatchUpKey,
  builderConversationIdFromPath, builderConversationPopup, builderMessageCheckState,
  builderMessagePollingRefused, groupBuilderMessages, isViewingBuilderConversation, type NewBuilderMessage,
} from '@/lib/builderMessagePopups.pure';

/**
 * "New message from <builder>" — wherever the reader is, not only on the
 * Builder Portal page.
 *
 * It asks `list_new_builder_messages` for what arrived after its cursor:
 * every five seconds while the tab is in view, every thirty while it is not,
 * and at once when the tab comes back. The first read only takes the cursor,
 * so opening the Command Centre never replays messages from before. The
 * server lists only conversations the reader is in; a refused read stops
 * asking rather than retrying for ever.
 *
 * Where the message reaches them:
 *   • In this tab — a popup with an Open button, one per conversation, so a
 *     conversation that received three messages says so once. Nothing is
 *     raised over the conversation they are already reading.
 *   • Somewhere else — another tab, another window, another application — a
 *     desktop notification (once per person however many tabs are open,
 *     through the same ledger team messages use), a count on the tab, and the
 *     popup waiting when they come back. A tab that was not looked at never
 *     repeats a popup another tab already showed.
 *
 * The same answer tells the conversation it names, and the reader's
 * conversation lists, to re-read themselves at once: a thread already on
 * screen shows the message within one check instead of on its own ten-second
 * cadence. It is still polling; nothing is pushed.
 */
export function BuilderMessagePopups() {
  const { canView, loading } = useModulePermissions('listings');
  const reader = useAuthUserIdOptional();
  if (loading || !canView) return null;
  // A different reader starts again, from their own cursor.
  return <BuilderMessagePoller key={reader ?? ''} reader={reader} />;
}

function BuilderMessagePoller({ reader }: { reader: string | null }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();

  // The loop below runs once per mount; these keep what it reads current.
  const navigateRef = useRef(navigate);
  const pathnameRef = useRef(pathname);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  // Opening a conversation puts away its desktop notification.
  useEffect(() => {
    const open = builderConversationIdFromPath(pathname);
    if (open) dismissPageAlert(builderAlertKey(open));
  }, [pathname]);

  // A click on a notification the service worker raised lands in this tab.
  useEffect(() => onServiceWorkerOpenPage((path) => navigateRef.current(path)), []);

  useEffect(() => {
    const state = builderMessageCheckState(reader);
    let stopped = false;
    let inFlight = false;
    let lastAskedAt = 0;
    let invited = false;
    /** What arrived while nobody was looking at this tab, by conversation. */
    const held = new Map<string, NewBuilderMessage[]>();

    const open = (path: string) => navigateRef.current(path);

    const raise = (messages: NewBuilderMessage[]) => {
      const popup = builderConversationPopup(messages);
      toast(popup.title, {
        id: `builder-conversation-${popup.id}`,
        description: popup.description,
        duration: 12_000,
        action: { label: 'Open', onClick: () => open(popup.href) },
      });
    };

    const showHeldCount = () => {
      let count = 0;
      let label: string | undefined;
      for (const messages of held.values()) {
        count += messages.length;
        label = messages[messages.length - 1].builder_name?.trim() || label;
      }
      if (count) setSourceUnreadBadge(BUILDER_BADGE_SOURCE, count, label);
      else clearSourceUnreadBadge(BUILDER_BADGE_SOURCE);
    };

    // Offered once, the first time a message arrives while desktop
    // notifications are still unanswered — the moment they are worth having.
    const offerDesktopAlerts = () => {
      if (invited || !shouldOfferDesktopAlerts()) return;
      invited = true;
      toast('Get desktop alerts for builder messages?', {
        description: 'We’ll tell you when a builder writes, even from another tab. Change this in Settings.',
        duration: 15_000,
        action: {
          label: 'Turn on',
          onClick: () => {
            markPromptedDesktopAlerts();
            void requestDesktopAlertPermission().then((result) => {
              if (result === 'granted') toast.success('Desktop alerts are on');
              else if (result === 'denied') {
                toast.message('Your browser is blocking notifications', {
                  description: 'Allow them for this site from the padlock in the address bar.',
                });
              }
            });
          },
        },
        cancel: { label: 'Not now', onClick: () => markPromptedDesktopAlerts() },
        // Ignoring the question is not answering it: ask again in a week.
        onDismiss: () => snoozeDesktopAlertPrompt(),
        onAutoClose: () => snoozeDesktopAlertPrompt(),
      });
    };

    const check = async () => {
      if (stopped || inFlight) return;
      if (document.visibilityState === 'hidden' && Date.now() - lastAskedAt < BUILDER_MESSAGE_BACKGROUND_POLL_MS) return;
      inFlight = true;
      lastAskedAt = Date.now();
      try {
        const { data, error } = await invokeSecureFunction<{ cursor?: string; messages?: NewBuilderMessage[] }>(
          'builder-stock-marketplace',
          { operation: 'list_new_builder_messages', ...(state.cursor ? { since: state.cursor } : {}) },
        );
        if (error) {
          // A refusal will not change on the next tick; anything else might.
          if (builderMessagePollingRefused(error.status)) stopped = true;
          return;
        }
        const firstRead = state.cursor === null;
        if (data?.cursor) state.cursor = data.cursor;
        if (firstRead) return;
        const fresh = (data?.messages ?? []).filter((m) => !state.shown.has(m.message_id));
        if (!fresh.length) return;
        for (const message of fresh) state.shown.add(message.message_id);

        // The popup's check is the open thread's doorbell.
        for (const conversationId of new Set(fresh.map((m) => m.conversation_id))) {
          for (const queryKey of builderMessageArrivalKeys(reader, conversationId)) {
            void queryClient.invalidateQueries({ queryKey });
          }
        }

        const away = document.visibilityState === 'hidden';
        for (const arrival of groupBuilderMessages(fresh)) {
          // The conversation is on screen: it has just re-read itself.
          if (!away && isViewingBuilderConversation(pathnameRef.current, arrival.conversationId)) {
            seedMessageAlert(builderAlertKey(arrival.conversationId), arrival.latest.received_at);
            seedMessageAlert(builderCatchUpKey(arrival.conversationId), arrival.latest.received_at);
            continue;
          }
          // Once per person, however many tabs are open.
          if (claimMessageAlert(builderAlertKey(arrival.conversationId), arrival.latest.received_at)) {
            playMessagePing();
            const popup = builderConversationPopup(arrival.messages);
            void deliverPageAlert(
              { key: builderAlertKey(arrival.conversationId), heading: popup.title, body: popup.description, path: popup.href },
              open,
            ).then((outcome) => {
              if (outcome === 'unsupported' && document.visibilityState === 'visible') offerDesktopAlerts();
            });
          }
          if (away) {
            held.set(arrival.conversationId, [...(held.get(arrival.conversationId) ?? []), ...arrival.messages]);
          } else {
            seedMessageAlert(builderCatchUpKey(arrival.conversationId), arrival.latest.received_at);
            raise(arrival.messages);
          }
        }
        showHeldCount();
      } catch {
        // A network hiccup: the next tick asks again from the same cursor.
      } finally {
        inFlight = false;
      }
    };

    // Back in front of the reader: what arrived while they were away, once.
    const showHeld = () => {
      if (document.visibilityState !== 'visible' || !held.size) return;
      const waiting = [...held.values()];
      held.clear();
      showHeldCount();
      for (const messages of waiting) {
        const latest = messages[messages.length - 1];
        if (isViewingBuilderConversation(pathnameRef.current, latest.conversation_id)) continue;
        // Another tab the reader came back to first has already shown these.
        if (!claimMessageAlert(builderCatchUpKey(latest.conversation_id), latest.received_at)) continue;
        raise(messages);
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), BUILDER_MESSAGE_POPUP_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      showHeld();
      void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearSourceUnreadBadge(BUILDER_BADGE_SOURCE);
    };
  }, [queryClient, reader]);

  return null;
}
