/**
 * Web Push notification helper for the staff dashboard.
 *
 * Strategy:
 * - Service worker `/sw-push.js` is registered only on production hosts (NOT in preview/iframe).
 * - VAPID public key is fetched from the `get-vapid-public-key` edge function.
 * - Subscription is persisted via the `push-subscribe` edge function.
 * - Unsubscribe via `push-unsubscribe`.
 */
// `supabase.functions.invoke` sends the anon key and NO cookies, so every
// call to these session-authenticated functions was rejected 401 and the
// failure surfaced only as "Failed to subscribe". `push_subscriptions` has
// been empty since the feature shipped. invokeSecureFunction carries the
// HttpOnly `__Host-session_token` cookie, which is what verifyAuth reads.
import { invokeSecureFunction } from '@/lib/secureInvoke';

const SW_URL = '/sw-push.js';

export type PushSupportStatus =
  | 'unsupported'
  | 'preview-blocked'
  | 'denied'
  | 'default'
  | 'granted';

function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function isPreviewHost(): boolean {
  const h = window.location.hostname;
  return (
    h.includes('id-preview--') ||
    h.includes('lovableproject.com') ||
    h === 'localhost' ||
    h === '127.0.0.1'
  );
}

export function isPushBlockedInThisContext(): boolean {
  return isInIframe() || isPreviewHost();
}

export function getPushSupportStatus(): PushSupportStatus {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (isPushBlockedInThisContext()) return 'preview-blocked';
  return Notification.permission as PushSupportStatus;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_URL);
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_URL, { scope: '/' });
}

async function fetchVapidPublicKey(): Promise<string> {
  const { data, error } = await invokeSecureFunction<{ publicKey?: string }>(
    'get-vapid-public-key',
    {},
  );
  if (error) throw new Error(error.message ?? 'Could not read the push server key.');
  if (!data?.publicKey) throw new Error('VAPID public key not configured on server');
  return data.publicKey;
}

export async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  if (isPushBlockedInThisContext() || !('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function subscribeToPush(): Promise<{ success: boolean; reason?: string }> {
  if (isPushBlockedInThisContext()) {
    return {
      success: false,
      reason: 'Push notifications only work on the published site, not in the editor preview.',
    };
  }

  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { success: false, reason: 'Your browser does not support push notifications.' };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return { success: false, reason: 'Notification permission denied.' };
  }

  try {
    const reg = await registerServiceWorker();
    await navigator.serviceWorker.ready;

    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      const publicKey = await fetchVapidPublicKey();
      const appServerKey = urlBase64ToUint8Array(publicKey);
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: the spec accepts BufferSource; some TS lib versions narrow this incorrectly.
        applicationServerKey: appServerKey.buffer.slice(
          appServerKey.byteOffset,
          appServerKey.byteOffset + appServerKey.byteLength,
        ) as ArrayBuffer,
      });
    }

    const json = subscription.toJSON();
    const { data: saved, error } = await invokeSecureFunction<{ success?: boolean; error?: string }>(
      'push-subscribe',
      {
        subscriber_type: 'staff',
        endpoint: json.endpoint,
        keys: json.keys,
        user_agent: navigator.userAgent,
        device_label: detectDeviceLabel(),
      },
    );
    // A browser-side subscription that the server never stored is worse than no
    // subscription: the toggle reads as "on" and nothing is ever delivered.
    if (error || !saved?.success) {
      await subscription.unsubscribe().catch(() => { /* best effort */ });
      throw new Error(saved?.error ?? error?.message ?? 'Server did not store the subscription.');
    }

    return { success: true };
  } catch (err: any) {
    console.error('[pushNotifications] subscribe failed', err);
    return { success: false, reason: err?.message || 'Failed to subscribe to push notifications.' };
  }
}

export async function unsubscribeFromPush(): Promise<{ success: boolean; reason?: string }> {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await invokeSecureFunction('push-unsubscribe', { endpoint });
    }
    return { success: true };
  } catch (err: any) {
    console.error('[pushNotifications] unsubscribe failed', err);
    return { success: false, reason: err?.message };
  }
}

function detectDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/i.test(ua)) return 'macOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown device';
}
