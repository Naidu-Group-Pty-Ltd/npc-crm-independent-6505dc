/**
 * Contract tests for the notification bell.
 *
 * The reported symptom was "no notifications are coming in despite substantial
 * activity on the front-end". The read path was fine — a superadmin's exact
 * client query returned 50 unread rows straight from the database. The bell was
 * empty because most of the *producers* had never written a row in their lives.
 *
 * `public.notifications` has these columns and no others:
 *
 *   id, type, title, message, report_id, timestamp, read, created_at,
 *   entity_id, target_user_id, created_by
 *
 * Yet producers across triggers and edge functions wrote `metadata`, `link`,
 * `is_read`, `user_id` and `body`. Postgres rejects an INSERT that names an
 * unknown column outright, so those notifications never existed. A census of
 * the live table proved it: of ~55 types the UI can render, only 11 had EVER
 * been written, and two producers accounted for 94% of all rows — precisely the
 * two using the plain (type, title, message, entity_id, read) shape.
 *
 * Five broken producers sat inside `EXCEPTION WHEN OTHERS`, so they failed
 * silently for months. Three had no guard at all, which meant the *business*
 * write failed with them: `notify_purchase_file_deal_link` inserts into
 * `notifications (user_id, ...)` with no handler, so linking a finance file to
 * a deal could not be recorded at all.
 *
 * These tests pin the column set, so a producer that invents a column fails
 * here rather than disappearing in production.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveNotificationLink } from '@/lib/notificationLink';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const REPAIR_MIGRATION = 'supabase/migrations/20260803030000_repair_notification_producers.sql';

/**
 * The real column list, as it stands after the repair migration. Anything a
 * producer names that is not here is rejected by Postgres.
 */
const NOTIFICATION_COLUMNS = new Set([
  'id',
  'type',
  'title',
  'message',
  'report_id',
  'timestamp',
  'read',
  'created_at',
  'entity_id',
  'target_user_id',
  'created_by',
  // added by the repair migration
  'metadata',
  'link',
]);

/** Columns producers were observed inventing. None of these may come back. */
const PHANTOM_COLUMNS = ['is_read', 'user_id', 'body'];

// ---------------------------------------------------------------- migration

describe('the repair migration restores the columns producers expect', () => {
  const sql = read(REPAIR_MIGRATION);

  it('adds metadata and link idempotently', () => {
    expect(sql).toMatch(/add column if not exists metadata jsonb/i);
    expect(sql).toMatch(/add column if not exists link text/i);
  });

  it('indexes metadata, because producers de-duplicate with a containment check', () => {
    // notify_staff_on_client_portal_message and friends run
    // `metadata @> '{"message_id": ...}'` on every inbound portal message.
    expect(sql).toMatch(/create index if not exists notifications_metadata_gin/i);
    expect(sql).toMatch(/using gin \(metadata jsonb_path_ops\)/i);
  });

  it('renames the phantom columns rather than adding duplicates for them', () => {
    // user_id/body/is_read were never missing columns — they were wrong names
    // for target_user_id/message/read. Adding them would entrench the mistake.
    for (const phantom of ['is_read', 'body']) {
      expect(sql).not.toMatch(new RegExp(`add column if not exists ${phantom}\\b`, 'i'));
    }
    expect(sql).not.toMatch(/add column if not exists user_id\b/i);
  });

  it('carries a deploy-time assertion that fails on an unknown column', () => {
    expect(sql).toMatch(/raise exception[\s\S]{0,120}do not exist on public\.notifications/i);
    // The assertion must compare against the live catalogue, not a hardcoded
    // list that can drift away from the table it is meant to protect.
    expect(sql).toMatch(/from information_schema\.columns/i);
    expect(sql).toMatch(/table_name = 'notifications'/i);
  });

  it('guards the producers that used to abort their own business write', () => {
    // notify_purchase_file_deal_link and notify_on_unconditional_approval had
    // no exception handler, so a bad notification insert rolled back the audit
    // row / the approval itself.
    for (const fn of ['notify_purchase_file_deal_link', 'notify_on_unconditional_approval']) {
      const body = sql.slice(sql.indexOf(`function public.${fn}()`));
      const end = body.indexOf('$function$;');
      expect(end).toBeGreaterThan(0);
      expect(body.slice(0, end)).toMatch(/EXCEPTION WHEN OTHERS THEN/i);
    }
  });

  it('reads the client columns that actually exist', () => {
    // The old notify_purchase_file_deal_link selected first_name, last_name,
    // assigned_advisor_id and assigned_broker_id from `clients`. None of those
    // columns exist; the real ones are primary_first_name, primary_surname and
    // assigned_team_user_id.
    const fn = sql.slice(sql.indexOf('function public.notify_purchase_file_deal_link()'));
    const body = fn.slice(0, fn.indexOf('$function$;'));
    expect(body).toMatch(/primary_first_name/);
    expect(body).toMatch(/primary_surname/);
    expect(body).toMatch(/assigned_team_user_id/);
    expect(body).not.toMatch(/assigned_advisor_id/);
    expect(body).not.toMatch(/\bc\.first_name\b/);
  });

  it('never targets a null user for a client-specific finance notification', () => {
    // target_user_id IS NULL is a BROADCAST under this table's RLS. A lender
    // submission with no broker and no creator must be skipped, not fanned out
    // to every staff member.
    const fn = sql.slice(sql.indexOf('function public.fn_lender_submission_status_change()'));
    const body = fn.slice(0, fn.indexOf('$function$;'));
    expect(body).toMatch(/IF COALESCE\(NEW\.assigned_broker_id, NEW\.created_by\) IS NOT NULL THEN/i);
  });
});

// ---------------------------------------------------------------- edge functions

/**
 * Blank out the contents of every comment, string and template literal,
 * preserving length so offsets still line up.
 *
 * Without this the scanner reads `message: \`...to their portfolio: ${x}\`` and
 * reports a phantom `portfolio` column. Template interpolations are walked so a
 * `}` inside `${}` does not close the surrounding object literal.
 *
 * Comments must be skipped for the same reason and one more: an apostrophe in
 * prose (`// Called from AgentChatWidget's approval card`) opens a string that
 * never closes, and everything after it — including the insert this test exists
 * to check — silently stops being scanned.
 */
export function maskStringLiterals(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  /** Scan a quoted string starting at the opening quote; return the index after it. */
  const scanQuoted = (start: number, quote: string): number => {
    let j = start + 1;
    while (j < src.length && src[j] !== quote) {
      if (src[j] === '\\') j += 1;
      j += 1;
    }
    blank(start + 1, j);
    return j + 1;
  };

  /**
   * Scan code from `i`. When `stopAtCloseBrace`, stop at the `}` that closes the
   * enclosing `${` and return the index just past it.
   */
  const scanCode = (start: number, stopAtCloseBrace: boolean): number => {
    let i = start;
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') {
        const nl = src.indexOf('\n', i);
        const end = nl === -1 ? src.length : nl;
        blank(i, end);
        i = end;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        const close = src.indexOf('*/', i + 2);
        const end = close === -1 ? src.length : close + 2;
        blank(i, end);
        i = end;
        continue;
      }
      if (c === "'" || c === '"') { i = scanQuoted(i, c); continue; }
      if (c === '`') { i = scanTemplate(i); continue; }
      if (stopAtCloseBrace) {
        if (c === '{') depth += 1;
        else if (c === '}') {
          if (depth === 0) return i + 1;
          depth -= 1;
        }
      }
      i += 1;
    }
    return i;
  };

  /** Scan a template literal starting at its backtick; return the index after it. */
  function scanTemplate(start: number): number {
    let j = start + 1;
    let textStart = j;
    while (j < src.length) {
      if (src[j] === '\\') { blank(j, j + 2); j += 2; continue; }
      if (src[j] === '`') { blank(textStart, j); return j + 1; }
      if (src[j] === '$' && src[j + 1] === '{') {
        blank(textStart, j);
        // Hide the `${` markers, then scan the interpolation as real code so
        // quotes and braces inside it are handled rather than counted. Without
        // this, `${x ? ' Property: ' + y : ''}` leaks a phantom `Property` key.
        out[j] = ' ';
        out[j + 1] = ' ';
        const end = scanCode(j + 2, true);
        if (end - 1 < out.length) out[end - 1] = ' ';
        j = end;
        textStart = j;
        continue;
      }
      j += 1;
    }
    blank(textStart, j);
    return j;
  }

  scanCode(0, false);
  return out.join('');
}

/** Top-level keys of an object literal, ignoring anything nested. */
function topLevelKeys(block: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  for (let i = 0; i < block.length; i += 1) {
    const c = block[i];
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') depth -= 1;
    else if (depth === 1) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(block.slice(i));
      // A key is only a key when it opens an entry — i.e. the previous
      // non-whitespace character is `{` or `,`. Without this rule the `:` of a
      // ternary reads as a separator and `x ? null : y` reports a `null` column.
      const before = block.slice(0, i).replace(/\s+$/, '');
      const prev = before.charAt(before.length - 1);
      if (m && (prev === '{' || prev === ',')) {
        keys.push(m[1]);
        i += m[0].length - 1;
      }
    }
  }
  return keys;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

/** Every `.from('notifications').insert({ ... })` payload in the repo. */
function notificationInsertPayloads(): Array<{ file: string; keys: string[] }> {
  const found: Array<{ file: string; keys: string[] }> = [];
  for (const file of walk('supabase/functions')) {
    const raw = read(file);
    // Locate the call sites in the raw text (the table name lives inside
    // quotes), then scan the payload in a same-length copy whose string
    // contents are blanked, so prose never reads as a column name.
    const src = maskStringLiterals(raw);
    const re = /from\(['"]notifications['"]\)\s*\n?\s*\.insert\(\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      const start = src.lastIndexOf('{', m.index + m[0].length);
      let depth = 0;
      let end = start;
      for (let i = start; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      found.push({ file, keys: topLevelKeys(src.slice(start, end + 1)) });
    }
  }
  return found;
}

describe('every edge-function producer writes columns that exist', () => {
  const payloads = notificationInsertPayloads();

  it('finds the producers at all (guards against the scanner silently matching nothing)', () => {
    expect(payloads.length).toBeGreaterThanOrEqual(10);
    // Name specific producers: a masker that desyncs stops finding call sites
    // rather than reporting a problem, so "zero offenders" would look like a
    // pass. These three cover a plain payload, one with `metadata`, and one
    // with `link`.
    const files = new Set(payloads.map((p) => p.file));
    for (const expected of [
      'supabase/functions/agent-planner/index.ts',
      'supabase/functions/outlook-email-webhook/index.ts',
      'supabase/functions/agent-insights-runner/index.ts',
    ]) {
      expect(files, `scanner lost ${expected}`).toContain(expected);
    }
  });

  it('names only real notification columns', () => {
    const offenders = payloads
      .flatMap(({ file, keys }) =>
        keys.filter((k) => !NOTIFICATION_COLUMNS.has(k)).map((k) => `${file}: ${k}`),
      );
    // Before the fix this listed agent-planner, market-qa-digest-runner and
    // market-qa-subscriptions, each writing `is_read` instead of `read`.
    expect(offenders).toEqual([]);
  });

  it('never reintroduces a phantom column anywhere in a notifications insert', () => {
    for (const { file, keys } of payloads) {
      for (const phantom of PHANTOM_COLUMNS) {
        expect(keys, `${file} writes ${phantom}`).not.toContain(phantom);
      }
    }
  });
});

// ---------------------------------------------------------------- client

describe('the bell can route what the backend now sends', () => {
  const context = read('src/contexts/NotificationsContext.tsx');
  const dropdown = read('src/components/layout/NotificationsDropdown.tsx');

  it('routes internal_message, the only type currently in flight', () => {
    // 141 internal_message rows landed in a single day and clicking one did
    // nothing: there was no case for it, so it fell through to `default: break`.
    expect(context).toMatch(/case 'internal_message':/);
    expect(context).toMatch(/requestOpenInternalMessages\(notification\.entityId\)/);
    expect(dropdown).toMatch(/case 'internal_message':/);
  });

  it('gives the repaired types an icon instead of the generic fallback', () => {
    for (const type of [
      'lender_submission_status',
      'purchase_file_unconditional_approval',
      'purchase_file_linked',
      'agent_insight',
      'agent_plan_scheduled',
      'market_qa_digest',
      'portal_message_received',
    ]) {
      expect(dropdown, `no icon for ${type}`).toContain(`case '${type}':`);
    }
  });

  it('uses only design tokens that exist', () => {
    // `text-success-foreground0` and friends are not tokens — the trailing zero
    // means Tailwind emits no class and the icon renders in the inherited
    // colour. They were copied through this file 24 times.
    expect(dropdown).not.toMatch(/foreground0/);
  });

  it('surfaces link and metadata from the row', () => {
    expect(context).toMatch(/link: typeof n\.link === 'string'/);
    expect(context).toMatch(/metadata: n\.metadata && typeof n\.metadata === 'object'/);
  });

  it('keeps working when realtime never connects', () => {
    // The subscription was the only thing that ever refreshed the list. Behind
    // a proxy that blocks WebSockets the bell froze at whatever it had at mount.
    expect(context).toMatch(/setInterval\(refresh/);
    expect(context).toMatch(/addEventListener\('visibilitychange', refresh\)/);
    expect(context).toMatch(/removeEventListener\('visibilitychange', refresh\)/);
  });

  it('applies read/clear to local state instead of waiting for an echo', () => {
    for (const fn of ['markAsRead', 'markAllAsRead', 'clearNotification', 'clearAll']) {
      const start = context.indexOf(`const ${fn} = async`);
      expect(start, `${fn} missing`).toBeGreaterThan(0);
      const body = context.slice(start, start + 700);
      expect(body, `${fn} does not update local state`).toMatch(/setNotifications\(/);
    }
  });
});

describe('resolveNotificationLink', () => {
  it('prefers the link column', () => {
    expect(resolveNotificationLink({ link: '/agent-insights' })).toBe('/agent-insights');
  });

  it('falls back to metadata paths', () => {
    expect(resolveNotificationLink({ metadata: { link_path: '/clients?tab=portal-messages' } }))
      .toBe('/clients?tab=portal-messages');
    expect(resolveNotificationLink({ metadata: { url: '/admin/pdf-import-diagnostics' } }))
      .toBe('/admin/pdf-import-diagnostics');
  });

  it('returns null when the producer supplied nothing', () => {
    expect(resolveNotificationLink({})).toBeNull();
    expect(resolveNotificationLink({ metadata: { client_id: 'abc' } })).toBeNull();
  });

  it('refuses anything that is not a same-origin path', () => {
    // metadata is producer-supplied. Handing the router `//evil.example` would
    // turn a notification row into an open redirect.
    expect(resolveNotificationLink({ link: '//evil.example/steal' })).toBeNull();
    expect(resolveNotificationLink({ link: 'https://evil.example' })).toBeNull();
    expect(resolveNotificationLink({ metadata: { link_path: 'javascript:alert(1)' } })).toBeNull();
  });
});
