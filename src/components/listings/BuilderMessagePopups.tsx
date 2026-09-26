import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { playMessagePing } from '@/lib/desktopMessageAlerts';
import {
  BUILDER_MESSAGE_POPUP_POLL_MS, builderMessagePopup, type NewBuilderMessage,
} from '@/lib/builderMessagePopups.pure';

/**
 * "New message from <builder>" — a popup wherever the reader is in the
 * Command Centre when a builder writes in one of their conversations.
 *
 * It asks `list_new_builder_messages` for what arrived after its cursor, every
 * ten seconds while the tab is in view and at once when the tab comes back.
 * The first read only takes the cursor, so opening the Command Centre never
 * replays messages from before. The server lists only conversations the
 * reader is in; a refused read stops asking rather than retrying for ever.
 */
export function BuilderMessagePopups() {
  const { canView, loading } = useModulePermissions('listings');
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

  useEffect(() => {
    if (loading || !canView) return undefined;
    let cursor: string | null = null;
    let stopped = false;
    let inFlight = false;
    const shown = new Set<string>();

    const check = async () => {
      if (stopped || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const { data, error } = await invokeSecureFunction<{ cursor?: string; messages?: NewBuilderMessage[] }>(
          'builder-stock-marketplace',
          { operation: 'list_new_builder_messages', ...(cursor ? { since: cursor } : {}) },
        );
        if (error) {
          // A refusal will not change on the next tick; anything else might.
          if (error.status === 401 || error.status === 403) stopped = true;
          return;
        }
        const firstRead = cursor === null;
        if (data?.cursor) cursor = data.cursor;
        if (firstRead) return;
        const fresh = (data?.messages ?? []).filter((m) => !shown.has(m.message_id));
        if (!fresh.length) return;
        playMessagePing();
        for (const message of fresh) {
          shown.add(message.message_id);
          const popup = builderMessagePopup(message);
          toast(popup.title, {
            id: `builder-message-${popup.id}`,
            description: popup.description,
            duration: 12_000,
            action: { label: 'Open', onClick: () => navigateRef.current(popup.href) },
          });
        }
      } catch {
        // A network hiccup: the next tick asks again from the same cursor.
      } finally {
        inFlight = false;
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), BUILDER_MESSAGE_POPUP_POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [canView, loading]);

  return null;
}
