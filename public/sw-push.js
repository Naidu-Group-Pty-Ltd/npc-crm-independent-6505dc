// Minimal service worker dedicated to Web Push only.
// Does NOT cache anything — avoids stale-content issues in Lovable's preview iframe.
// Registered manually from src/lib/pushNotifications.ts only on production hosts.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Fallback artwork for a push whose payload carries no icon. NEVER
// '/favicon.ico' — that is the scaffold's stock mark, and a stock mark in a
// user's notification shade is a branding leak. White-labelled tenants send
// their own `icon` in the payload; everyone else gets the Aurixa Systems mark.
// `badge` is the monochrome status-bar glyph, so it stays the flat delta.
const DEFAULT_NOTIFICATION_ICON = '/brand/aurixa-notification-192.png';
const DEFAULT_NOTIFICATION_BADGE = '/brand/aurixa-badge-96.png';

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Notification', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Notification';
  const options = {
    body: data.body || '',
    icon: data.icon || DEFAULT_NOTIFICATION_ICON,
    badge: data.badge || DEFAULT_NOTIFICATION_BADGE,
    data: {
      url: data.url || '/',
      notification_id: data.notification_id || null,
      category: data.category || null,
    },
    tag: data.notification_id || undefined,
    renotify: !!data.notification_id,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Internal team messages are notified from the page itself (not Web Push), but
// they are shown through this registration so the bubble outlives the tab and
// can carry action buttons. Clicking one must land the user back in the
// conversation WITHOUT reloading the dashboard they were working in, so an
// already-open window is reached by postMessage rather than by navigation.
const INTERNAL_MESSAGE_KIND = 'internal-message';
const OPEN_INTERNAL_THREAD_MESSAGE = 'aurixa:open-internal-thread';

async function sameOriginClients() {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return all.filter((client) => {
    try {
      return new URL(client.url).origin === self.location.origin;
    } catch (e) {
      return false;
    }
  });
}

async function openInternalThread(data) {
  const clients = await sameOriginClients();
  // Prefer a window the user is already looking at.
  const ordered = clients.sort((a, b) => (b.focused ? 1 : 0) - (a.focused ? 1 : 0));
  for (const client of ordered) {
    try {
      await client.focus();
    } catch (e) {
      /* focus can be refused; the postMessage is still worth sending */
    }
    client.postMessage({
      type: OPEN_INTERNAL_THREAD_MESSAGE,
      thread_id: data.thread_id,
      kind: data.thread_kind || 'direct',
      title: data.thread_title || null,
    });
    return;
  }
  // No dashboard open: cold-start one straight into the conversation.
  await self.clients.openWindow(
    data.url || '/?internalThread=' + encodeURIComponent(data.thread_id || ''),
  );
}

// A builder's message is notified from the page too, and opens a page of the
// dashboard — its conversation. Like a team thread, an open window is sent
// there by postMessage (the page routes it without a reload), and a window is
// opened at that page only when none is open. The path is this origin's own:
// anything else is refused rather than opened.
const OPEN_PAGE_KIND = 'open-page';
const OPEN_PAGE_MESSAGE = 'aurixa:open-page';

function isSameOriginPath(path) {
  return typeof path === 'string' && path.charAt(0) === '/' && path.charAt(1) !== '/' && path.charAt(1) !== '\\';
}

async function openPage(path) {
  const clients = await sameOriginClients();
  const ordered = clients.sort((a, b) => (b.focused ? 1 : 0) - (a.focused ? 1 : 0));
  for (const client of ordered) {
    try {
      await client.focus();
    } catch (e) {
      /* focus can be refused; the postMessage is still worth sending */
    }
    client.postMessage({ type: OPEN_PAGE_MESSAGE, url: path });
    return;
  }
  await self.clients.openWindow(path);
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  // "Dismiss" is an acknowledgement, not a request to open anything.
  if (event.action === 'dismiss') return;

  if (data.kind === INTERNAL_MESSAGE_KIND && data.thread_id) {
    event.waitUntil(openInternalThread(data));
    return;
  }

  if (data.kind === OPEN_PAGE_KIND) {
    if (isSameOriginPath(data.url)) event.waitUntil(openPage(data.url));
    return;
  }

  const targetUrl = data.url || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Focus an existing window if one is open
      for (const client of allClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(targetUrl);
          }
          return;
        }
      }
      // Otherwise open new window
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
