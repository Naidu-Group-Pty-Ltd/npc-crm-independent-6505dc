/**
 * The finance portal's notification feed, and why nothing was in it.
 *
 * Reported as "the new finance partner did not receive the agreement
 * notification". The notification had been written correctly, to the right
 * partner, with the right link. Measured on production before this was fixed:
 *
 *   238 notifications, 236 unread, 0 readable.
 *
 * `finance-portal-notifications` filters every read and every mutation on three
 * routing columns from migration `20260717000000`. That migration was merged
 * and never applied, so the columns do not exist — and PostgREST answers a
 * filter on a missing column with `42703` for the whole statement, not with an
 * empty set. List, unread_count, mark_read and mark_all_read all returned 500,
 * for every partner and every notification type, from the day it merged.
 *
 * The remedy is not only "apply the migration". A boundary that lives solely in
 * columns is one a deploy can silently switch off, and this one did. The same
 * policy is derivable from the notification's own type, which the table has
 * always had, so it is stated once and enforced whichever shape the table is
 * in — strict filter where the columns exist, equivalent type filter where they
 * do not, and the recipient filter unconditionally in both.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NON_FINANCE_NOTIFICATION_TYPES,
  UNDEFINED_COLUMN,
  isFinanceDomainNotification,
  nonFinanceTypeFilter,
  routingModeFromProbe,
} from '../../../../supabase/functions/_shared/financeNotificationRouting.pure';

describe('which notifications belong in a partner feed', () => {
  it('admits the agreement types this programme writes', () => {
    for (const type of [
      'agreement_issued', 'agreement_reissued', 'agreement_awaiting_you',
      'agreement_resent', 'agreement_voided',
    ]) {
      expect(isFinanceDomainNotification(type)).toBe(true);
    }
  });

  it('keeps out the reporting and property fan-out the migration quarantines', () => {
    for (const type of NON_FINANCE_NOTIFICATION_TYPES) {
      expect(isFinanceDomainNotification(type)).toBe(false);
    }
  });

  it('treats a missing type as not finance', () => {
    expect(isFinanceDomainNotification(null)).toBe(false);
    expect(isFinanceDomainNotification('')).toBe(false);
  });
});

describe('the type filter handed to PostgREST', () => {
  it('is a parenthesised list', () => {
    const filter = nonFinanceTypeFilter();
    expect(filter.startsWith('(')).toBe(true);
    expect(filter.endsWith(')')).toBe(true);
    expect(filter).toContain('market_update');
  });

  it('contains no character that would need quoting', () => {
    // Keeps this a formatting concern rather than an injection one.
    for (const type of NON_FINANCE_NOTIFICATION_TYPES) {
      expect(type).toMatch(/^[a-z_]+$/);
    }
  });
});

describe('choosing an enforcement path', () => {
  it('uses the strict column filter when the probe succeeds', () => {
    expect(routingModeFromProbe(null)).toBe('columns');
    expect(routingModeFromProbe(undefined)).toBe('columns');
  });

  it('falls back to types only on "column does not exist"', () => {
    expect(routingModeFromProbe({ code: UNDEFINED_COLUMN })).toBe('types');
    expect(routingModeFromProbe({
      message: 'column finance_portal_notifications.target_portal does not exist',
    })).toBe('types');
  });

  it('keeps the strict path on any other failure', () => {
    // A network blip or a permissions problem must never be read as "the
    // migration is missing" — that would quietly loosen the boundary on a
    // database that has it.
    for (const error of [
      { code: '42501', message: 'permission denied' },
      { code: 'PGRST301', message: 'JWT expired' },
      { message: 'fetch failed' },
      {},
    ]) {
      expect(routingModeFromProbe(error)).toBe('columns');
    }
  });
});

describe('the two enforcement paths agree', () => {
  const migration = readFileSync(
    join(process.cwd(),
      'supabase/migrations/20260717000000_restrict_finance_portal_notification_routing.sql'),
    'utf8',
  );

  it('quarantines exactly what the migration quarantines', () => {
    // Two expressions of one policy only work while they say the same thing.
    for (const type of NON_FINANCE_NOTIFICATION_TYPES) {
      expect(migration).toContain(`'${type}'`);
    }
  });

  it('leaves no quarantined type out of this module', () => {
    // The name appears twice — DROP CONSTRAINT IF EXISTS, then ADD CONSTRAINT.
    // Take the quarantine list itself out of the second one's `NOT IN (...)`,
    // not the whole block: the surrounding predicate also names 'finance_portal'.
    const parts = migration.split('finance_portal_notifications_non_finance_type_check');
    const inCheck = /NOT IN \(([^)]*)\)/.exec(parts[parts.length - 1] ?? '')?.[1] ?? '';
    const listed = [...inCheck.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(listed.length).toBeGreaterThan(0);
    for (const type of listed) {
      expect(NON_FINANCE_NOTIFICATION_TYPES).toContain(type);
    }
  });
});

describe('the reader no longer assumes the migration landed', () => {
  const fn = readFileSync(
    join(process.cwd(), 'supabase/functions/finance-portal-notifications/index.ts'), 'utf8',
  );

  it('passes the resolved mode to every operation', () => {
    // Four operations shared one helper and all four were broken. A new
    // operation that forgets the argument will not compile, but a call that
    // drops it silently would — so the count is asserted.
    expect(fn.match(/authorisedFinanceRoute\(/g)?.length).toBe(5); // 1 definition + 4 uses
    expect(fn.match(/, routingMode\)/g)?.length).toBe(4);
  });

  it('still filters by recipient in both modes', () => {
    expect(fn.match(/\.eq\('portal_user_id', portalUser\.id\)/g)?.length).toBe(4);
  });
});
