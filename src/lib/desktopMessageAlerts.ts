/**
 * Desktop alerts for internal staff messages.
 *
 * Problem: when the Command Centre tab is in the background (another tab,
 * another window, minimised browser) — or the user is simply working in a
 * different module — the in-app chip/pop-up is invisible, so inbound team
 * messages went unnoticed.
 *
 * Strategy — four independent, layered signals, all client-side and all
 * non-blocking, each degrading cleanly into the next:
 *   1. Native OS notification, raised through the push service worker where one
 *      is available (so it carries actions and its click is handled by the SW
 *      even if every tab is backgrounded) and through the page-level
 *      `Notification` constructor otherwise. Clicking it focuses the dashboard
 *      and pops the conversation open on the page the user was already on.
 *   2. Tab title badge + favicon count badge, so an un-focused-but-visible tab
 *      still signals in the tab strip. Needs no permission at all.
 *   3. A short audible ping.
 *   4. The caller's in-app fallback (chip dock / catch-up toast) whenever the
 *      OS route is unavailable — see `deliverDesktopMessageAlert`'s outcome.
 *
 * Reliability contract:
 *   • Exactly ONE alert per message, per person — not per tab. Every dashboard
 *     tab polls independently, so alerts are gated behind a shared claim record
 *     (localStorage + BroadcastChannel) keyed by thread and message timestamp.
 *   • The claim record is persistent, so a reload, a re-login or a route change
 *     never replays a notification the user has already been shown.
 *
 * Nothing here fetches or trusts message content from the wire — callers pass
 * already-verified data loaded through the `internal-messaging` edge function.
 */
import { requestPopOutInternalThread, type PopOutThreadHint } from '@/lib/internalMessagingBus';
import { isPushBlockedInThisContext } from '@/lib/pushNotifications';

const PREF_KEY = 'aurixa.internalMessages.desktopAlerts';
const SOUND_KEY = 'aurixa.internalMessages.alertSound';
const PROMPTED_KEY = 'aurixa.internalMessages.desktopAlertsPrompted';
const SNOOZE_KEY = 'aurixa.internalMessages.desktopAlertsSnoozedUntil';
const CLAIM_KEY = 'aurixa.internalMessages.alertClaims';

const SW_URL = '/sw-push.js';
/** Claims older than this are pruned — the map must not grow without bound. */
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CLAIMS = 200;
/** How long a dismissed opt-in invitation stays quiet. */
const PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const CLAIM_CHANNEL = 'aurixa-internal-message-alerts';

/**
 * Platform default artwork. `/favicon.ico` is deliberately NOT used anywhere on
 * this path: it is the scaffold's stock icon, and a stock icon on a client's
 * notification is a branding leak. When no white-label logo is configured the
 * Aurixa Systems mark stands in.
 */
export const AURIXA_NOTIFICATION_ICON = '/brand/aurixa-notification-192.png';
/**
 * Android draws `badge` as a monochrome status-bar glyph — it keeps the alpha
 * and discards the colour. A client's full-colour logo would come back as a
 * grey block, so the badge slot always carries the flat Aurixa delta.
 */
export const AURIXA_NOTIFICATION_BADGE = '/brand/aurixa-badge-96.png';
/** The scaffold icon. Recognised only so it can be refused. */
const STOCK_FAVICON = '/favicon.ico';

/** Query parameter used to cold-start the dashboard straight into a thread. */
export const INTERNAL_THREAD_DEEPLINK_PARAM = 'internalThread';
/** postMessage type the service worker uses to reach an already-open tab. */
export const SW_OPEN_THREAD_MESSAGE = 'aurixa:open-internal-thread';
/** Notification `data.kind` marking a bubble the service worker must route. */
export const INTERNAL_NOTIFICATION_KIND = 'internal-message';

export type DesktopAlertStatus = 'unsupported' | 'default' | 'denied' | 'granted';

export function getDesktopAlertStatus(): DesktopAlertStatus {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as DesktopAlertStatus;
}

/* --------------------------------------------------------- preferences */

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw !== 'off';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, enabled: boolean) {
  try {
    localStorage.setItem(key, enabled ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

/** User-level opt-out (defaults to enabled once permission is granted). */
export function desktopAlertsEnabled(): boolean {
  return readFlag(PREF_KEY, true);
}

export function setDesktopAlertsEnabled(enabled: boolean) {
  writeFlag(PREF_KEY, enabled);
  if (!enabled) closeAllDesktopMessageAlerts();
}

/** The audible ping is a separate opt-out — some staff want silent alerts. */
export function messageSoundEnabled(): boolean {
  return readFlag(SOUND_KEY, true);
}

export function setMessageSoundEnabled(enabled: boolean) {
  writeFlag(SOUND_KEY, enabled);
}

export function hasPromptedDesktopAlerts(): boolean {
  try {
    return localStorage.getItem(PROMPTED_KEY) === '1';
  } catch {
    return true;
  }
}

export function markPromptedDesktopAlerts() {
  try {
    localStorage.setItem(PROMPTED_KEY, '1');
  } catch {
    /* ignore */
  }
}

/**
 * A dismissed (rather than answered) invitation goes quiet for a week instead
 * of forever: ignoring a toast is not the same as saying no, and Settings is
 * still the deliberate way in.
 */
export function snoozeDesktopAlertPrompt(now = Date.now()) {
  try {
    localStorage.setItem(SNOOZE_KEY, String(now + PROMPT_SNOOZE_MS));
  } catch {
    /* ignore */
  }
}

export function isDesktopAlertPromptSnoozed(now = Date.now()): boolean {
  try {
    const raw = Number(localStorage.getItem(SNOOZE_KEY) ?? '0');
    return Number.isFinite(raw) && raw > now;
  } catch {
    return false;
  }
}

/** True when it is polite and useful to offer the desktop-alert opt-in. */
export function shouldOfferDesktopAlerts(): boolean {
  if (getDesktopAlertStatus() !== 'default') return false;
  if (!desktopAlertsEnabled()) return false;
  if (hasPromptedDesktopAlerts() || isDesktopAlertPromptSnoozed()) return false;
  return true;
}

/** Ask the browser for permission. Must be called from a user gesture. */
export async function requestDesktopAlertPermission(): Promise<DesktopAlertStatus> {
  if (getDesktopAlertStatus() === 'unsupported') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission as DesktopAlertStatus;
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      // Warm the service worker now so the very first alert can already carry
      // actions and SW-side click routing.
      void getAlertRegistration();
    }
    return result as DesktopAlertStatus;
  } catch {
    return 'denied';
  }
}

/* ------------------------------------------------------------------ sound */

let audioCtx: AudioContext | null = null;

/** Two-tone synthesised ping — no asset download, no autoplay video surface. */
export function playMessagePing() {
  if (!messageSoundEnabled()) return;
  try {
    const Ctx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const now = audioCtx.currentTime;
    [
      { f: 880, t: 0 },
      { f: 1174, t: 0.12 },
    ].forEach(({ f, t }) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.09, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.22);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.25);
    });
  } catch {
    /* audio is a nice-to-have */
  }
}

/* -------------------------------------------- cross-tab alert claim ledger */

interface AlertClaim {
  /** Timestamp of the newest message this thread has already alerted on. */
  stamp: string;
  /** When the claim was recorded (for pruning). */
  at: number;
}

let claimMirror: Record<string, AlertClaim> | null = null;
let claimChannel: BroadcastChannel | null = null;
let claimSyncWired = false;

function newerThan(candidate: string, existing: string): boolean {
  const a = Date.parse(candidate);
  const b = Date.parse(existing);
  if (Number.isFinite(a) && Number.isFinite(b)) return a > b;
  return candidate > existing;
}

function pruneClaims(map: Record<string, AlertClaim>, now = Date.now()) {
  const entries = Object.entries(map)
    .filter(([, v]) => v && typeof v.stamp === 'string' && now - (v.at ?? 0) < CLAIM_TTL_MS)
    .sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
    .slice(0, MAX_CLAIMS);
  return Object.fromEntries(entries) as Record<string, AlertClaim>;
}

function readClaims(): Record<string, AlertClaim> {
  if (claimMirror) return claimMirror;
  try {
    const raw = localStorage.getItem(CLAIM_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    claimMirror =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? pruneClaims(parsed as Record<string, AlertClaim>)
        : {};
  } catch {
    claimMirror = {};
  }
  return claimMirror;
}

function writeClaims(map: Record<string, AlertClaim>) {
  claimMirror = map;
  try {
    localStorage.setItem(CLAIM_KEY, JSON.stringify(map));
  } catch {
    /* a full quota must not stop the notification itself */
  }
}

/**
 * Keep the in-memory mirror hot from peer tabs. `storage` alone would do, but
 * it does not fire in the writing tab and can lag; the BroadcastChannel closes
 * the window between two tabs polling at the same instant.
 */
function ensureClaimSync() {
  if (claimSyncWired || typeof window === 'undefined') return;
  claimSyncWired = true;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      claimChannel = new BroadcastChannel(CLAIM_CHANNEL);
      claimChannel.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; thread_id?: string; stamp?: string } | null;
        if (!data || data.type !== 'claim') return;
        if (typeof data.thread_id !== 'string' || typeof data.stamp !== 'string') return;
        const map = { ...readClaims() };
        const existing = map[data.thread_id];
        if (existing && !newerThan(data.stamp, existing.stamp)) return;
        map[data.thread_id] = { stamp: data.stamp, at: Date.now() };
        claimMirror = map;
      };
    }
  } catch {
    claimChannel = null;
  }
  try {
    window.addEventListener('storage', (event) => {
      if (event.key === CLAIM_KEY) claimMirror = null;
    });
  } catch {
    /* ignore */
  }
}

function announceClaim(threadId: string, stamp: string) {
  try {
    claimChannel?.postMessage({ type: 'claim', thread_id: threadId, stamp });
  } catch {
    /* best-effort */
  }
}

/**
 * Try to become the one tab that alerts for this message.
 *
 * Returns true exactly once per (thread, message) across every open tab and
 * across reloads. Any later message in the same thread claims again, so a
 * conversation keeps notifying — it is duplicates that are suppressed, not
 * follow-ups.
 */
export function claimMessageAlert(threadId: string, stamp: string): boolean {
  if (!threadId || !stamp) return false;
  ensureClaimSync();
  const map = readClaims();
  const existing = map[threadId];
  if (existing && !newerThan(stamp, existing.stamp)) return false;
  writeClaims(pruneClaims({ ...map, [threadId]: { stamp, at: Date.now() } }));
  announceClaim(threadId, stamp);
  return true;
}

/**
 * Record a message as already handled WITHOUT alerting. Used for the first
 * sweep after a tab loads: a backlog of unread threads is shown as chips, it is
 * never replayed as a wall of OS notifications.
 */
export function seedMessageAlert(threadId: string, stamp: string) {
  if (!threadId || !stamp) return;
  ensureClaimSync();
  const map = readClaims();
  const existing = map[threadId];
  if (existing && !newerThan(stamp, existing.stamp)) return;
  writeClaims(pruneClaims({ ...map, [threadId]: { stamp, at: Date.now() } }));
  announceClaim(threadId, stamp);
}

/** Test seam / diagnostics: has this exact message already been alerted on? */
export function hasClaimedMessageAlert(threadId: string, stamp: string): boolean {
  const existing = readClaims()[threadId];
  return !!existing && !newerThan(stamp, existing.stamp);
}

/** Drop every claim — used when the signed-in user changes. */
export function resetMessageAlertClaims() {
  writeClaims({});
}

/* ------------------------------------------------------- tab title badge */

let baseTitle: string | null = null;
let flashTimer: ReturnType<typeof setInterval> | null = null;
let flashOn = false;

function stopFlashing() {
  if (flashTimer) {
    clearInterval(flashTimer);
    flashTimer = null;
  }
  if (baseTitle !== null) document.title = baseTitle;
  flashOn = false;
}

/**
 * Reflect the pending unread count in the tab title and on the favicon,
 * alternating with a "New message" flash so a background tab is noticeable in
 * the tab strip. Requires no notification permission — this is the signal that
 * always works.
 */
export function setTabUnreadBadge(count: number, label?: string) {
  if (typeof document === 'undefined') return;
  if (baseTitle === null) baseTitle = document.title;

  setFaviconBadge(count);

  if (count <= 0) {
    stopFlashing();
    return;
  }

  const badge = `(${count > 99 ? '99+' : count})`;
  const alt = `${badge} ${label ? `${label} sent a message` : 'New team message'}`;
  const primary = `${badge} ${baseTitle}`;

  document.title = primary;
  if (flashTimer) return;
  flashTimer = setInterval(() => {
    flashOn = !flashOn;
    document.title = flashOn ? alt : primary;
  }, 1600);
}

export function clearTabUnreadBadge() {
  stopFlashing();
  setFaviconBadge(0);
}

/* ------------------------------------------------------------ brand artwork */

let brandNotificationIcon: string | null = null;

/**
 * Publish the tenant's white-label mark for use on notifications and on the
 * favicon badge. `BrandProvider` calls this whenever branding resolves —
 * including with `null`, which reverts to the Aurixa Systems mark.
 *
 * Passing the stock scaffold icon is treated as "no logo": it must never reach
 * a user's notification shade.
 */
export function setBrandNotificationIcon(src: string | null | undefined) {
  const trimmed = typeof src === 'string' ? src.trim() : '';
  const next = !trimmed || trimmed === STOCK_FAVICON ? null : trimmed;
  if (next === brandNotificationIcon) return;
  brandNotificationIcon = next;

  // The favicon badge is drawn on top of this mark, so its cached base and the
  // "already at this count" short-circuit both have to be invalidated.
  faviconBasePromise = null;
  const showing = faviconCount;
  faviconCount = -1;
  setFaviconBadge(Math.max(0, showing));
}

/**
 * Notification artwork is fetched by the browser, and for a service-worker
 * notification it is resolved against the worker's scope rather than the page.
 * Absolutising here removes any doubt about which base a relative path lands
 * on — a 404 icon is a silently unbranded notification.
 */
function absolute(path: string): string {
  if (typeof window === 'undefined') return path;
  try {
    return new URL(path, window.location.origin).href;
  } catch {
    return path;
  }
}

/** The icon shown on a notification: white-label logo, else Aurixa Systems. */
export function getNotificationIcon(): string {
  return absolute(brandNotificationIcon ?? AURIXA_NOTIFICATION_ICON);
}

/** The monochrome status-bar glyph. Always the Aurixa delta — see above. */
export function getNotificationBadge(): string {
  return absolute(AURIXA_NOTIFICATION_BADGE);
}

/* ----------------------------------------------------------- favicon badge */

let faviconLink: HTMLLinkElement | null = null;
let faviconOriginalHref: string | null = null;
let faviconBasePromise: Promise<HTMLImageElement | null> | null = null;
let faviconCount = -1;

function ensureFaviconLink(): HTMLLinkElement | null {
  if (typeof document === 'undefined') return null;
  if (faviconLink && document.head.contains(faviconLink)) return faviconLink;
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (faviconOriginalHref === null) {
    const declared = link.getAttribute('href') || '';
    // A page still pointing at the stock icon is treated as having none.
    faviconOriginalHref = declared && declared !== STOCK_FAVICON ? declared : null;
  }
  faviconLink = link;
  return link;
}

/** The unbadged mark: white-label logo, else whatever the page declared, else Aurixa. */
function faviconSourceHref(): string {
  return brandNotificationIcon || faviconOriginalHref || AURIXA_NOTIFICATION_ICON;
}

function loadFaviconBase(): Promise<HTMLImageElement | null> {
  if (faviconBasePromise) return faviconBasePromise;
  faviconBasePromise = new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = faviconSourceHref();
    } catch {
      resolve(null);
    }
  });
  return faviconBasePromise;
}

/** Resolve a theme token to a canvas-usable colour (canvas cannot read vars). */
function tokenColour(token: string, fallback: string): string {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    if (!raw) return fallback;
    // Tokens are stored as bare HSL channels ("0 84% 60%").
    return raw.startsWith('hsl') || raw.startsWith('#') || raw.startsWith('rgb')
      ? raw
      : `hsl(${raw})`;
  } catch {
    return fallback;
  }
}

/**
 * Stamp the unread count onto the favicon. This is the one unread indicator
 * that survives every permission state, so it is applied unconditionally.
 */
export function setFaviconBadge(count: number) {
  if (typeof document === 'undefined') return;
  const next = Math.max(0, Math.floor(count));
  if (next === faviconCount) return;
  const link = ensureFaviconLink();
  if (!link) return;
  faviconCount = next;

  if (next <= 0) {
    link.setAttribute('href', faviconSourceHref());
    return;
  }

  void loadFaviconBase().then((base) => {
    // A newer call may have won the race while the base image decoded.
    if (faviconCount !== next) return;
    try {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (base) {
        ctx.drawImage(base, 0, 0, size, size);
      } else {
        // No decodable favicon (or a browser that refuses to draw .ico): a
        // plain branded tile still carries the count.
        ctx.fillStyle = tokenColour('--primary', 'navy');
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(0, 0, size, size, 14);
          ctx.fill();
        } else {
          ctx.fillRect(0, 0, size, size);
        }
      }

      const label = next > 9 ? '9+' : String(next);
      const r = 22;
      const cx = size - r - 2;
      const cy = size - r - 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = tokenColour('--destructive', 'crimson');
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = tokenColour('--card', 'white');
      ctx.stroke();

      ctx.fillStyle = tokenColour('--destructive-foreground', 'white');
      ctx.font = 'bold 30px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy + 1);

      link.setAttribute('href', canvas.toDataURL('image/png'));
    } catch {
      /* the title badge still carries the count */
    }
  });
}

/* ------------------------------------------------- native OS notification */

export interface DesktopMessageAlert {
  thread_id: string;
  /** Conversation label — person, group or announcement title. */
  title: string;
  /** Who sent it. */
  sender: string;
  /** Plain-text preview (already server-verified). */
  body: string;
  kind?: 'direct' | 'group' | 'broadcast';
  priority?: 'normal' | 'high' | 'urgent';
  hasAttachments?: boolean;
}

/**
 * Why an alert did or did not reach the operating system. Callers use this to
 * decide whether an in-app fallback is owed:
 *   • `shown`             — the OS bubble is up, nothing more to do.
 *   • `suppressed-focused`— the user is looking at this tab; the in-app chip
 *                           already told them. NOT a failure.
 *   • everything else     — the OS route is unavailable, so the caller should
 *                           fall back (catch-up toast, badge, ping).
 */
export type DesktopAlertOutcome =
  | 'shown'
  | 'suppressed-focused'
  | 'disabled'
  | 'denied'
  | 'unsupported'
  | 'failed';

/** Page-level notifications we opened, so they can be closed on read. */
const live = new Map<string, Notification>();
let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function internalNotificationTag(threadId: string) {
  return `aurixa-internal-${threadId}`;
}

/**
 * The push service worker, when this context can host one. It is reused rather
 * than re-registered, and never registered in the editor preview / iframe where
 * push is blocked anyway.
 */
async function getAlertRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  if (swRegistrationPromise) return swRegistrationPromise;
  swRegistrationPromise = (async () => {
    try {
      const existing = await navigator.serviceWorker.getRegistration(SW_URL);
      if (existing) return existing;
      if (isPushBlockedInThisContext()) return null;
      if (Notification.permission !== 'granted') return null;
      return await navigator.serviceWorker.register(SW_URL, { scope: '/' });
    } catch {
      return null;
    }
  })();
  return swRegistrationPromise;
}

/** Heading + body copy for an inbound message. Exported for contract tests. */
export function buildAlertCopy(alert: DesktopMessageAlert): { heading: string; body: string } {
  const prefix =
    alert.priority === 'urgent' ? '🔴 Urgent · ' : alert.priority === 'high' ? '🟡 ' : '';
  const heading =
    alert.kind === 'broadcast'
      ? `${prefix}Announcement · ${alert.title}`
      : alert.kind === 'group'
        ? `${prefix}${alert.sender} in ${alert.title}`
        : `${prefix}${alert.sender || alert.title}`;

  const preview = (alert.body ?? '').replace(/\s+/g, ' ').trim();
  const base = preview || (alert.hasAttachments ? 'Sent an attachment' : 'New message');
  const trimmed = base.length > 180 ? `${base.slice(0, 179)}…` : base;
  const body = alert.hasAttachments && preview ? `${trimmed} · 📎 attachment` : trimmed;

  return { heading, body };
}

function notificationOptions(alert: DesktopMessageAlert, withActions: boolean) {
  const { body } = buildAlertCopy(alert);
  return {
    body,
    // One notification per conversation: later messages replace the earlier OS
    // bubble instead of stacking a wall of alerts, and a second tab raising the
    // same tag can only ever collapse into the same bubble.
    tag: internalNotificationTag(alert.thread_id),
    renotify: true,
    // The tenant's own mark where one is configured, the Aurixa Systems mark
    // otherwise. Never the scaffold's stock icon.
    icon: getNotificationIcon(),
    badge: getNotificationBadge(),
    // Urgent messages stay on screen until acknowledged; everything else obeys
    // the platform's own timeout so the desktop never feels cluttered.
    requireInteraction: alert.priority === 'urgent',
    silent: false,
    data: {
      kind: INTERNAL_NOTIFICATION_KIND,
      thread_id: alert.thread_id,
      thread_kind: alert.kind ?? 'direct',
      thread_title: alert.title,
      url: `/?${INTERNAL_THREAD_DEEPLINK_PARAM}=${encodeURIComponent(alert.thread_id)}`,
    },
    ...(withActions
      ? {
          actions: [
            { action: 'open', title: 'Open conversation' },
            { action: 'dismiss', title: 'Dismiss' },
          ],
        }
      : {}),
  } as NotificationOptions;
}

/**
 * Raise an OS-level notification for an inbound message. Safe to call always:
 * it self-suppresses when the tab is focused, permission is missing, or the
 * user has opted out — and it reports which of those happened so the caller can
 * fall back in-app.
 *
 * Callers are expected to have already won `claimMessageAlert` for this
 * message; this function does not de-duplicate on its own.
 */
export async function deliverDesktopMessageAlert(
  alert: DesktopMessageAlert,
): Promise<DesktopAlertOutcome> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (!desktopAlertsEnabled()) return 'disabled';
  if (Notification.permission !== 'granted') {
    return Notification.permission === 'denied' ? 'denied' : 'unsupported';
  }
  // Focused tab already shows the chip/pop-up — don't double-notify.
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    document.hasFocus()
  ) {
    return 'suppressed-focused';
  }

  const { heading } = buildAlertCopy(alert);

  // Preferred route: the service worker. Its notifications survive the tab
  // being discarded, support action buttons, and route their own clicks.
  try {
    const registration = await getAlertRegistration();
    if (registration) {
      await registration.showNotification(heading, notificationOptions(alert, true));
      // A page-level bubble for the same thread would now be a duplicate.
      closePageNotification(alert.thread_id);
      return 'shown';
    }
  } catch {
    /* fall through to the page-level constructor */
  }

  try {
    live.get(alert.thread_id)?.close();

    const n = new Notification(heading, notificationOptions(alert, false));
    live.set(alert.thread_id, n);

    n.onclick = () => {
      try {
        window.focus();
        window.parent?.focus?.();
      } catch {
        /* ignore cross-origin focus refusal */
      }
      requestPopOutInternalThread({
        thread_id: alert.thread_id,
        kind: alert.kind,
        title: alert.title,
      });
      n.close();
      live.delete(alert.thread_id);
    };
    n.onclose = () => live.delete(alert.thread_id);
    return 'shown';
  } catch {
    return 'failed';
  }
}

/** Back-compat boolean wrapper around {@link deliverDesktopMessageAlert}. */
export async function showDesktopMessageAlert(alert: DesktopMessageAlert): Promise<boolean> {
  return (await deliverDesktopMessageAlert(alert)) === 'shown';
}

function closePageNotification(threadId: string) {
  const n = live.get(threadId);
  if (!n) return;
  try {
    n.close();
  } catch {
    /* ignore */
  }
  live.delete(threadId);
}

/** Close any OS bubble still showing for a conversation the user just opened. */
export function dismissDesktopMessageAlert(threadId: string) {
  closePageNotification(threadId);
  void (async () => {
    try {
      const registration = await getAlertRegistration();
      const open = await registration?.getNotifications?.({
        tag: internalNotificationTag(threadId),
      });
      open?.forEach((n) => n.close());
    } catch {
      /* ignore */
    }
  })();
}

/** Close every internal-message bubble (sign-out, alerts switched off). */
export function closeAllDesktopMessageAlerts() {
  [...live.keys()].forEach(closePageNotification);
  void (async () => {
    try {
      const registration = await getAlertRegistration();
      const open = await registration?.getNotifications?.();
      open
        ?.filter((n) => (n.data as { kind?: string } | null)?.kind === INTERNAL_NOTIFICATION_KIND)
        .forEach((n) => n.close());
    } catch {
      /* ignore */
    }
  })();
}

/* --------------------------------------------------------- deep linking */

/**
 * Read (and strip) a `?internalThread=` deep link. The service worker uses it
 * when no dashboard window was open to receive a postMessage, so a notification
 * clicked hours later still lands on the right conversation.
 */
export function consumeInternalThreadDeepLink(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const id = url.searchParams.get(INTERNAL_THREAD_DEEPLINK_PARAM);
    if (!id) return null;
    url.searchParams.delete(INTERNAL_THREAD_DEEPLINK_PARAM);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    return id;
  } catch {
    return null;
  }
}

/** Listen for "open this thread" instructions posted by the service worker. */
export function onServiceWorkerThreadOpen(
  handler: (hint: PopOutThreadHint) => void,
): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  const listener = (event: MessageEvent) => {
    const data = event.data as
      | { type?: string; thread_id?: string; kind?: string; title?: string }
      | null;
    if (!data || data.type !== SW_OPEN_THREAD_MESSAGE) return;
    if (typeof data.thread_id !== 'string' || !data.thread_id) return;
    handler({
      thread_id: data.thread_id,
      kind: (data.kind as PopOutThreadHint['kind']) ?? undefined,
      title: data.title ?? null,
    });
  };
  try {
    navigator.serviceWorker.addEventListener('message', listener);
  } catch {
    return () => {};
  }
  return () => {
    try {
      navigator.serviceWorker.removeEventListener('message', listener);
    } catch {
      /* ignore */
    }
  };
}

/* -------------------------------------------------------- diagnostics / QA */

export interface DesktopAlertDiagnostics {
  status: DesktopAlertStatus;
  enabled: boolean;
  soundEnabled: boolean;
  /** Preview iframes cannot host a service worker; alerts still work in-page. */
  serviceWorkerBlocked: boolean;
}

export function getDesktopAlertDiagnostics(): DesktopAlertDiagnostics {
  return {
    status: getDesktopAlertStatus(),
    enabled: desktopAlertsEnabled(),
    soundEnabled: messageSoundEnabled(),
    serviceWorkerBlocked:
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      isPushBlockedInThisContext(),
  };
}

/**
 * Fire a sample notification so a user can confirm, from Settings, that alerts
 * really reach their desktop. Bypasses the focused-tab suppression — the whole
 * point is to see it while looking at the page.
 */
export async function sendTestDesktopAlert(): Promise<DesktopAlertOutcome> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'granted') {
    return Notification.permission === 'denied' ? 'denied' : 'unsupported';
  }
  const alert: DesktopMessageAlert = {
    thread_id: 'test',
    title: 'Desktop alerts',
    sender: 'NPC Command Centre',
    body: 'This is what a new team message looks like.',
    kind: 'direct',
    priority: 'normal',
  };
  const { heading } = buildAlertCopy(alert);
  // A sample must not pretend to be a real conversation: strip the routing
  // payload so clicking it just focuses the dashboard.
  const options = {
    ...notificationOptions(alert, false),
    tag: 'aurixa-internal-test',
    requireInteraction: false,
    data: { kind: 'internal-message-test', url: '/' },
  } as NotificationOptions;
  try {
    const registration = await getAlertRegistration();
    if (registration) {
      await registration.showNotification(heading, options);
      return 'shown';
    }
    const n = new Notification(heading, options);
    n.onclick = () => n.close();
    return 'shown';
  } catch {
    return 'failed';
  }
}
