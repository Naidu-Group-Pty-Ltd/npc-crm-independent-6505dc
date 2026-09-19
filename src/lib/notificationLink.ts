/**
 * Where a notification should navigate when its type has no explicit route.
 *
 * The bell used to need a new `case` in a switch for every notification type,
 * and any type without one fell through to `default: break` — clicking it did
 * nothing. Producers now ship a path instead (`link`, or `link_path`/`url`
 * inside `metadata`), so a new backend type is clickable the day it ships.
 */

export interface LinkableNotification {
  link?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Returns a same-origin path to navigate to, or null.
 *
 * `metadata` is producer-supplied free-form JSON, so only absolute in-app paths
 * are accepted. Handing the router `//evil.example` or an `https://` URL would
 * turn a notification row into an open redirect.
 */
export function resolveNotificationLink(notification: LinkableNotification): string | null {
  const candidates: unknown[] = [notification.link];
  const meta = notification.metadata;
  if (meta && typeof meta === 'object') {
    candidates.push(meta.link_path, meta.url, meta.path);
  }
  const target = candidates.find((v): v is string => typeof v === 'string' && v.length > 0);
  if (!target) return null;
  return target.startsWith('/') && !target.startsWith('//') ? target : null;
}
