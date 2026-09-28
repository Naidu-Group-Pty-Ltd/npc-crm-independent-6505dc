/**
 * The Reminders hub drew a badge from a three-key map against a four-value
 * column, so one Urgent reminder crashed the whole page. These tests hold the
 * two halves of the fix: the vocabulary is the column's, and the lookup is
 * total.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REMINDER_PRIORITY,
  ESCALATED_REMINDER_PRIORITIES,
  REMINDER_PRIORITIES,
  isEscalatedPriority,
  isReminderPriority,
  reminderPriorityBadge,
} from '../priority.pure';

/** The migration that created `client_reminders`, CHECK constraint and all. */
const TABLE_MIGRATION =
  'supabase/migrations/20251230234123_db40c905-2e0a-4a7f-bf94-ab0bc23c7881.sql';

describe('the vocabulary is the column‘s', () => {
  it('names exactly the values client_reminders.priority accepts', () => {
    const sql = readFileSync(TABLE_MIGRATION, 'utf8');
    // priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent'))
    const check = /priority\s+TEXT[^\n]*CHECK\s*\(\s*priority\s+IN\s*\(([^)]*)\)/i.exec(sql);
    expect(check, `no priority CHECK constraint found in ${TABLE_MIGRATION}`).not.toBeNull();

    const fromColumn = [...check![1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    expect(fromColumn.length).toBeGreaterThan(0);
    expect([...fromColumn].sort()).toEqual([...REMINDER_PRIORITIES].sort());
  });

  it('takes its default from the column‘s own default', () => {
    const sql = readFileSync(TABLE_MIGRATION, 'utf8');
    const def = /priority\s+TEXT\s+NOT NULL\s+DEFAULT\s+'([^']+)'/i.exec(sql);
    expect(def).not.toBeNull();
    expect(def![1]).toBe(DEFAULT_REMINDER_PRIORITY);
  });

  it('orders them most severe first, so a filter reads as a scale', () => {
    expect([...REMINDER_PRIORITIES]).toEqual(['urgent', 'high', 'medium', 'low']);
  });
});

describe('reminderPriorityBadge', () => {
  it.each([...REMINDER_PRIORITIES])('renders %s with a label and a colour', value => {
    const badge = reminderPriorityBadge(value);
    expect(badge.label.length).toBeGreaterThan(0);
    expect(badge.color.length).toBeGreaterThan(0);
  });

  it('gives Urgent a badge of its own rather than reusing High‘s', () => {
    // The page drew both as the same tinted red once `urgent` was added by
    // hand; two severities that look identical are not a hierarchy.
    expect(reminderPriorityBadge('urgent').color).not.toBe(reminderPriorityBadge('high').color);
    expect(reminderPriorityBadge('urgent').label).toBe('Urgent');
  });

  it('is total — this is the call that crashed the page', () => {
    // `PRIORITY_CONFIG['urgent']` was undefined and `.color` threw. Nothing a
    // caller can pass may produce an object without these two fields.
    for (const value of ['urgent', 'critical', 'NOT_A_PRIORITY', '', '  ']) {
      const badge = reminderPriorityBadge(value);
      expect(typeof badge.color).toBe('string');
      expect(typeof badge.label).toBe('string');
    }
    for (const value of [null, undefined]) {
      expect(() => reminderPriorityBadge(value)).not.toThrow();
    }
  });

  it('names an unrecognised value rather than re-labelling it Medium', () => {
    // Falling back to a neighbour would state a priority the row does not
    // carry, which is a fabricated fact about somebody's workload.
    expect(reminderPriorityBadge('critical').label).toBe('Critical');
    expect(reminderPriorityBadge('not_set').label).toBe('Not set');
    expect(reminderPriorityBadge('critical').color).not.toBe(reminderPriorityBadge('medium').color);
  });

  it('falls back to the column default only where there is no value at all', () => {
    expect(reminderPriorityBadge(null)).toEqual(reminderPriorityBadge(DEFAULT_REMINDER_PRIORITY));
    expect(reminderPriorityBadge('')).toEqual(reminderPriorityBadge(DEFAULT_REMINDER_PRIORITY));
  });
});

describe('the escalated pair', () => {
  it('counts Urgent as high-priority work', () => {
    // An urgent item missing from the "High Priority" figure understates the
    // very thing the figure exists to surface. The AML backfill migration
    // collapses the same pair: `case when r.priority in ('high','urgent')`.
    expect(isEscalatedPriority('urgent')).toBe(true);
    expect(isEscalatedPriority('high')).toBe(true);
    expect(isEscalatedPriority('medium')).toBe(false);
    expect(isEscalatedPriority('low')).toBe(false);
  });

  it('escalates nothing outside the vocabulary', () => {
    expect(isEscalatedPriority('critical')).toBe(false);
    expect(ESCALATED_REMINDER_PRIORITIES.every(isReminderPriority)).toBe(true);
  });
});

describe('isReminderPriority', () => {
  it('accepts the four and refuses everything else', () => {
    for (const value of REMINDER_PRIORITIES) expect(isReminderPriority(value)).toBe(true);
    for (const value of ['critical', 'Urgent', '', null, undefined, 1, {}]) {
      expect(isReminderPriority(value)).toBe(false);
    }
  });
});

describe('the hub cannot reintroduce a partial map', () => {
  it('draws its priority badge through this module and indexes no map of its own', () => {
    const page = readFileSync('src/pages/RemindersHub.tsx', 'utf8');
    expect(page).toContain('reminderPriorityBadge(reminder.priority)');
    // The crash was `PRIORITY_CONFIG[reminder.priority]` with no fallback.
    expect(page).not.toMatch(/PRIORITY_CONFIG\s*\[/);
  });

  it('offers every priority in the filter, so the crashing value is excludable', () => {
    // The filter listed high/medium/low only, so an urgent reminder could not
    // be filtered away — there was no way back to the page from inside it.
    const page = readFileSync('src/pages/RemindersHub.tsx', 'utf8');
    expect(page).toContain('REMINDER_PRIORITIES.map');
  });
});
