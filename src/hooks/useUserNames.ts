import { useEffect, useState, useCallback } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface UserName {
  id: string;
  username: string | null;
  email: string | null;
}

const cache = new Map<string, UserName>();
// IDs we've attempted to resolve at least once — prevents perma-loading
// when the user no longer exists in custom_users or the call failed.
const attempted = new Set<string>();

/**
 * Resolve a list of user IDs to their usernames/emails.
 * Results are cached in-memory across components for the session.
 */
export function useUserNames(userIds: (string | null | undefined)[]) {
  const [, setTick] = useState(0);

  const load = useCallback(async (ids: string[]) => {
    const missing = ids.filter((id) => !cache.has(id) && !attempted.has(id));
    if (missing.length === 0) {
      setTick((n) => n + 1);
      return;
    }

    // Mark optimistically so duplicate effect runs don't re-fire while in flight
    missing.forEach((id) => attempted.add(id));

    try {
      const { data, error } = await invokeSecureFunction<{ success: boolean; users: UserName[] }>(
        'get-user-names',
        { userIds: missing },
      );
      if (!error && data?.success) {
        (data.users || []).forEach((u) => cache.set(u.id, u));
      } else if (error) {
        console.warn('[useUserNames] resolve failed', error);
        // Allow a retry later for transient failures
        missing.forEach((id) => attempted.delete(id));
      }
    } catch (e) {
      console.warn('[useUserNames] failed', e);
      missing.forEach((id) => attempted.delete(id));
    }

    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const unique = Array.from(
      new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0)),
    );
    if (unique.length === 0) return;
    load(unique);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIds.join(',')]);

  /** Display label: username, then email-local-part, then "Unknown user" once resolved, else "Loading…". */
  const labelFor = useCallback(
    (id: string | null | undefined): string => {
      if (!id) return 'System';
      const u = cache.get(id);
      if (u) {
        return u.username || (u.email ? u.email.split('@')[0] : null) || 'Unknown user';
      }
      // We've already tried this ID and the server didn't return it
      if (attempted.has(id)) return 'Unknown user';
      return 'Loading…';
    },
    [],
  );

  return { labelFor };
}

