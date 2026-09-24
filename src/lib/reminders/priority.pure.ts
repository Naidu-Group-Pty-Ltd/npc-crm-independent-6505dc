/**
 * What a reminder's priority may be, and what it looks like on the hub.
 *
 * ## The defect this exists for
 *
 * `public.client_reminders.priority` has carried a four-value CHECK constraint
 * since the table was created —
 * `CHECK (priority IN ('low', 'medium', 'high', 'urgent'))` — and **Urgent is
 * offered by every form that writes one**: the hub's own New Reminder form,
 * the hub's edit dialog, the per-client Reminders tab and the team tab.
 *
 * The Reminders hub's client tab rendered the badge from a map with three
 * keys, dereferenced unguarded:
 *
 * ```ts
 * const priorityCfg = PRIORITY_CONFIG[reminder.priority];   // undefined for 'urgent'
 * …
 * <Badge className={cn(…, priorityCfg.color)}>{priorityCfg.label}</Badge>
 * ```
 *
 * So one urgent reminder anywhere in the account threw
 * `TypeError: Cannot read properties of undefined (reading 'color')` during
 * render, and the dashboard's error boundary replaced the whole page with
 * "Something went wrong". Not the row — the page. Every other reminder the
 * account holds became unreachable because one of them was marked Urgent, and
 * no filter could exclude it either: the priority filter offered only High,
 * Medium and Low, so the crashing value could not be filtered away.
 *
 * Nothing in the gate could see it. `UnifiedReminder.priority` was declared
 * `'high' | 'medium' | 'low'`, so TypeScript believed the index was total and
 * vouched for a lookup the database contradicts. **A type that asserts less
 * than the column permits is not type safety, it is a second source of truth
 * that happens to be wrong** — the same class as naming a column the table
 * does not have, and it fails the same way: silently, until real data arrives.
 *
 * ## The rules
 *
 * **The vocabulary is the column's.** `REMINDER_PRIORITIES` is exactly the
 * constraint's four values, and `priority.spec.ts` reads the migration and
 * fails if the two ever diverge. Widening the column without widening this is
 * how the page breaks again.
 *
 * **The lookup is total by construction.** `reminderPriorityBadge` is a
 * function rather than a map, so there is no call site left that *can* be
 * written unguarded. A value outside the four renders its own name in a
 * neutral badge — it neither crashes nor claims the reminder is Medium, which
 * would be a fabricated fact about somebody's workload.
 *
 * The other three surfaces already handle all four values (their maps were
 * written with `urgent` in them) and keep their own palettes, which differ by
 * design — the client tab's is a light-theme palette. What they must not do is
 * disagree about which values EXIST, which is what this module fixes.
 */

/** The four values `client_reminders.priority` accepts, most severe first. */
export const REMINDER_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

export type ReminderPriority = (typeof REMINDER_PRIORITIES)[number];

/** The column's own DEFAULT, used where a row carries no priority at all. */
export const DEFAULT_REMINDER_PRIORITY: ReminderPriority = 'medium';

/**
 * Priorities that count as "high priority" in a summary figure.
 *
 * Urgent outranks high, so a count of high-priority work that excluded it
 * would understate the very items it exists to surface. The AML backfill
 * migration already collapses the pair the same way
 * (`case when r.priority in ('high', 'urgent') then 'high' …`).
 */
export const ESCALATED_REMINDER_PRIORITIES: readonly ReminderPriority[] = ['urgent', 'high'];

export function isReminderPriority(value: unknown): value is ReminderPriority {
  return typeof value === 'string' && (REMINDER_PRIORITIES as readonly string[]).includes(value);
}

/** True when this priority should read as escalated work. */
export function isEscalatedPriority(value: string): boolean {
  return (ESCALATED_REMINDER_PRIORITIES as readonly string[]).includes(value);
}

export interface ReminderPriorityBadge {
  label: string;
  /** Tailwind classes for the hub's badge — semantic tokens only. */
  color: string;
}

/**
 * The hub's badge for each priority.
 *
 * Urgent is a filled destructive badge and High a tinted one, so the two read
 * as a hierarchy rather than as the same red twice. Low and Medium are
 * unchanged from the map this replaces.
 */
const BADGES: Record<ReminderPriority, ReminderPriorityBadge> = {
  urgent: {
    label: 'Urgent',
    color:
      'bg-destructive text-destructive-foreground border-destructive shadow-[0_0_18px_rgba(248,113,113,0.28)]',
  },
  high: {
    label: 'High',
    color:
      'bg-destructive/15 text-destructive border-destructive/40 shadow-[0_0_18px_rgba(248,113,113,0.14)]',
  },
  medium: {
    label: 'Medium',
    color:
      'bg-brand-500/15 text-brand-200 border-brand-300/35 shadow-[0_0_18px_rgba(245,158,11,0.12)]',
  },
  low: {
    label: 'Low',
    color: 'bg-success/10 text-success border-success/30 shadow-[0_0_18px_rgba(16,185,129,0.10)]',
  },
};

/** A neutral badge for a value the column has grown and this module has not. */
const UNRECOGNISED: ReminderPriorityBadge = {
  label: '',
  color: 'bg-card/5 dark:bg-white/5 text-muted-foreground border-border dark:border-white/10',
};

/**
 * How a priority is drawn on the Reminders hub. Total: every string has an
 * answer, so no call site can dereference `undefined`.
 *
 * An unrecognised value is titled from its own slug rather than mapped onto a
 * neighbour — `not_set` reads "Not set", never "Medium".
 */
export function reminderPriorityBadge(value: string | null | undefined): ReminderPriorityBadge {
  if (isReminderPriority(value)) return BADGES[value];
  const raw = (value ?? '').trim();
  if (!raw) return BADGES[DEFAULT_REMINDER_PRIORITY];
  return { ...UNRECOGNISED, label: titleCase(raw) };
}

/** `trigger_review` → `Trigger review`. Database vocabulary never reaches the operator raw. */
function titleCase(slug: string): string {
  const words = slug.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}
