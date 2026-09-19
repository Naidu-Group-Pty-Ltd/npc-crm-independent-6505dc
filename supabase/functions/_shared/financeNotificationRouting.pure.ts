/**
 * Which notifications belong in the Finance Portal's feed — expressed twice, on
 * purpose.
 *
 * ## What happened
 *
 * `finance_portal_notifications` used to identify only a recipient, so a broad
 * Command Centre fan-out could become a partner's feed. Migration
 * `20260717000000_restrict_finance_portal_notification_routing.sql` fixed that
 * properly: three routing columns, defaults, NOT NULL, CHECK constraints, a
 * partial index. `finance-portal-notifications` was written against it and
 * filters **every** read and mutation on all three:
 *
 * ```ts
 * .eq('target_portal', 'finance_portal')
 * .eq('notification_domain', 'finance')
 * .eq('command_centre_authorised', true)
 * ```
 *
 * The migration was merged. It was never applied. Migrations in this repo are
 * applied out of band (`docs/agreements/DEPLOYMENT.md`), and this one was not —
 * so the function has been filtering on three columns that do not exist, which
 * PostgREST answers with `42703` for the whole statement. Not "no rows": an
 * error. Every operation the function offers — list, unread_count, mark_read,
 * mark_all_read — returned 500.
 *
 * Measured on production before this module was written: **238 notifications,
 * 236 unread, 0 readable**, going back to the day the migration merged. The
 * agreement notification that prompted this was in the table the whole time,
 * addressed to the right partner, with the right link. Nobody could ever have
 * seen it.
 *
 * ## Why the fix is not "apply the migration"
 *
 * It is, and it should be applied. But a boundary that only exists in columns
 * is a boundary that a deploy can switch off, and this one silently did — for
 * three weeks, across every notification type, with no error surfaced to
 * anybody. The same policy is available from data the table has always had: the
 * notification's own type. So it is stated here once and enforced whichever
 * shape the table is in.
 *
 * When the columns are present the column filter runs, because it is stricter —
 * it can catch a row whose type looks fine but whose routing was set wrong.
 * When they are absent this type filter runs instead. Neither depends on the
 * other having shipped, and the strict one takes over the moment it can.
 *
 * The recipient filter (`portal_user_id`) is unconditional in both. That is the
 * boundary that keeps one partner's notifications away from another, and it has
 * never been in question.
 */

/**
 * Types quarantined from the finance feed.
 *
 * Copied from the migration's own `UPDATE` and its
 * `finance_portal_notifications_non_finance_type_check`, and it must stay
 * identical to them: these are general reporting, property and market events
 * that a Command Centre fan-out could route at a partner. Changing this list
 * without changing the migration gives the two enforcement paths different
 * opinions, which is the failure the duplication exists to survive.
 */
export const NON_FINANCE_NOTIFICATION_TYPES: readonly string[] = [
  'report_request_in_progress',
  'report_request_completed',
  'new_report_available',
  'report_available',
  'property_report',
  'property_report_update',
  'report_qa',
  'market_update',
  'property_insight',
];

/** Whether this notification type may appear in a finance partner's feed. */
export function isFinanceDomainNotification(type: string | null | undefined): boolean {
  if (!type) return false;
  return !NON_FINANCE_NOTIFICATION_TYPES.includes(type);
}

/**
 * The quarantined list as a PostgREST `in` filter value.
 *
 * PostgREST wants `(a,b,c)`; the types are plain identifiers with no commas or
 * quotes, which is asserted by a test so this stays a formatting concern rather
 * than an injection one.
 */
export function nonFinanceTypeFilter(): string {
  return `(${NON_FINANCE_NOTIFICATION_TYPES.join(',')})`;
}

/**
 * Which enforcement path a query should take.
 *
 * `columns` is the migration's design and is preferred. `types` is the same
 * policy against a table that has not had the migration applied. `unknown` is
 * only used before the first probe resolves.
 */
export type FinanceRoutingMode = 'columns' | 'types';

/** The PostgREST error code for "column does not exist". */
export const UNDEFINED_COLUMN = '42703';

/**
 * Read a failed probe: absent columns mean the migration has not been applied.
 *
 * Anything else — a network blip, a permissions problem — must NOT be read as
 * "the migration is missing", because that would quietly downgrade the strict
 * filter on a database that has it. An inconclusive probe keeps the strict
 * path, which fails loudly rather than loosening a boundary by accident.
 */
export function routingModeFromProbe(
  probeError: { code?: string | null; message?: string | null } | null | undefined,
): FinanceRoutingMode {
  if (!probeError) return 'columns';
  if (probeError.code === UNDEFINED_COLUMN) return 'types';
  if (typeof probeError.message === 'string'
    && /column .*target_portal.* does not exist/i.test(probeError.message)) {
    return 'types';
  }
  return 'columns';
}
