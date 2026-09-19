import type { QueryClient } from '@tanstack/react-query';

/**
 * One list of the query keys a client's record is read through.
 *
 * ## Why this exists
 *
 * A client's data is read under several keys by several surfaces, and every
 * mutation that changes it wrote its own list of keys to invalidate. Those
 * lists drifted: `ClientDetailsModal` — the card an operator actually has open
 * — reads `['secure-client-data', clientId, include]`, and the follow-up
 * banner, the follow-up flag and the Formara import all invalidated
 * `['clients']`, `['client-tracker']` and a handful of legacy keys, none of
 * which is that one.
 *
 * So the write landed, the toast said so, and the card kept showing the value
 * it had. The 19 Sep 2026 clone audit reported it as "the notification pops up
 * at the bottom as follow up set … it still didn't show up and it says as no
 * follow up date set. It only appears after I close the client card and
 * re-open it" — closing the card unmounts the query, and reopening refetches.
 *
 * A hand-written key list at each call site cannot be kept correct, because
 * nothing fails when one is wrong. This module is the list; a call site names
 * the client and nothing else.
 *
 * ## The rule
 *
 * `secure-client-data` is a PREFIX match. Its full key carries the `include`
 * object each caller asks for (`['secure-client-data', id, { deals: true, … }]`),
 * so two surfaces reading the same client under different includes are two
 * cache entries. React Query matches a shorter key against the head of a
 * longer one, so passing the two-element prefix reaches every include
 * combination — matching the full key would refresh one surface and leave the
 * others stale, which is the defect in a new shape.
 */

/** The per-client keys. Prefixes, so every `include` variant is reached. */
const CLIENT_SCOPED_KEYS = [
  // Canonical: what `useSecureClientData` reads, and therefore what the client
  // card, the portfolio panels and the tabs are drawn from.
  'secure-client-data',
  'secure-client',
  'secure-client-properties',
  'client-detail',
  'client-details',
  'client-properties',
  'client-income',
  'client-assets',
  'client-liabilities',
  'client-expenses',
  'client-employment',
  'client-reminders',
  'client-formara-forms',
] as const;

/** Cross-client lists that show a per-client value. */
const CLIENT_LIST_KEYS = [
  'clients',
  'client-tracker',
  'all-reminders',
] as const;

export interface InvalidateClientQueriesOptions {
  /**
   * Extra keys this particular surface also reads. Use it for a key that is
   * genuinely local to one feature — anything a second surface reads belongs
   * in the lists above instead.
   */
  also?: readonly (readonly unknown[])[];
}

/**
 * Mark every reading of `clientId` stale, so an open client card shows a
 * change as soon as it is written rather than on its next mount.
 */
export function invalidateClientQueries(
  queryClient: QueryClient,
  clientId: string | null | undefined,
  options: InvalidateClientQueriesOptions = {},
): void {
  if (clientId) {
    for (const key of CLIENT_SCOPED_KEYS) {
      queryClient.invalidateQueries({ queryKey: [key, clientId] });
    }
  }
  for (const key of CLIENT_LIST_KEYS) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
  for (const key of options.also ?? []) {
    queryClient.invalidateQueries({ queryKey: key as unknown[] });
  }
}

/** Exported for the guard that asserts no surface keeps a private copy. */
export const CLIENT_QUERY_KEYS = {
  scoped: CLIENT_SCOPED_KEYS,
  lists: CLIENT_LIST_KEYS,
} as const;
