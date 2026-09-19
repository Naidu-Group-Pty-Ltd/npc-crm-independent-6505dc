/**
 * FOUR TABLES WHOSE RLS POLICY WAS OPEN TO `public`.
 *
 * Measured against the live catalogue on 12 September 2026: 41 policies in
 * `public` are `TO public` with an unconditional `true` predicate. Most are
 * correct — published reference data, or a "service role full access" policy on
 * a table where `anon` and `authenticated` hold no DML grant at all. Four were
 * not, and `20261119160000_narrow_four_open_public_policies.sql` is what
 * narrowed them.
 *
 *   report_templates          `anon` holds SELECT, so the publishable key in
 *                             every shipped bundle read every template row.
 *   client_portal_messages    every signed-in principal read every client's
 *                             portal correspondence.
 *   report_qa_conversations   six "Anyone can view / create / update / delete"
 *   report_qa_messages        policies, held back only by a GRANT nobody made.
 *
 * These tests read the migration rather than the database, so they pin the
 * SHAPE of the change: what a later edit to that file may not reintroduce, and
 * what the rest of the platform depends on it still permitting.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = 'supabase/migrations';
const FILE = '20261119160000_narrow_four_open_public_policies.sql';
const VERSION = FILE.slice(0, 14);

/** The four the audit found. Named, because a rule over every table is noise. */
const NARROWED_TABLES = [
  'report_templates',
  'client_portal_messages',
  'report_qa_conversations',
  'report_qa_messages',
];

const sql = readFileSync(join(process.cwd(), MIGRATIONS, FILE), 'utf8');

/** Statement bodies only — the file's own prose quotes what it removes. */
const statements = (text: string) =>
  text
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

const creates = statements(sql).filter((s) => /^CREATE\s+POLICY/i.test(s));
const drops = statements(sql).filter((s) => /^DROP\s+POLICY/i.test(s));

const nameOf = (statement: string) => /"([^"]+)"/.exec(statement)?.[1] ?? '';
const tableOf = (statement: string) => /ON\s+public\.(\w+)/i.exec(statement)?.[1] ?? '';

describe('the migration that narrowed them', () => {
  it('names an explicit role on every policy it creates', () => {
    // A `CREATE POLICY` with no `TO` clause defaults to `public`, which is the
    // whole defect. Every policy here has to say who it is for.
    expect(creates.length).toBeGreaterThan(0);
    for (const statement of creates) {
      const to = /\bTO\s+(\w+)/i.exec(statement)?.[1];
      expect(to, `"${nameOf(statement)}" does not name a role`).toBeTruthy();
      expect(to, `"${nameOf(statement)}" is still TO public`).not.toBe('public');
    }
  });

  it('touches only the four tables the audit named', () => {
    for (const statement of [...creates, ...drops]) {
      expect(NARROWED_TABLES).toContain(tableOf(statement));
    }
  });

  it('recreates a narrowing under the same name, so the fleet gate can see it is one', () => {
    // `assessSqlDestructiveness` exempts a DROP POLICY recreated under the same
    // name on the same table. That is exactly what a narrowing is, and what a
    // removal is not — so the exemption has to fall where the intent does.
    const recreated = new Set(creates.map((s) => `${tableOf(s)}::${nameOf(s)}`));
    const narrowings = ['report_templates', 'client_portal_messages'];
    for (const statement of drops) {
      const key = `${tableOf(statement)}::${nameOf(statement)}`;
      const isNarrowing = narrowings.includes(tableOf(statement));
      expect(recreated.has(key), `${key} recreated: ${recreated.has(key)}`).toBe(isNarrowing);
    }
  });

  it('removes the six Q&A policies outright and puts nothing back', () => {
    // Leaving a narrowed copy under a name that says "anyone" would keep the
    // misleading half of what is being removed.
    const qa = drops.filter((s) => tableOf(s).startsWith('report_qa_'));
    expect(qa.map(nameOf).sort()).toEqual([
      'Anyone can create Q&A conversations',
      'Anyone can create Q&A messages',
      'Anyone can delete Q&A conversations',
      'Anyone can update Q&A conversations',
      'Anyone can view Q&A conversations',
      'Anyone can view Q&A messages',
    ]);
    expect(creates.filter((s) => tableOf(s).startsWith('report_qa_'))).toEqual([]);
  });

  it('keeps a SELECT path for `authenticated` on portal messages', () => {
    // Three postgres_changes subscriptions watch that table, realtime respects
    // RLS, and it delivers under the subscriber's role. Two of them are staff
    // and they keep working only because of this policy. A narrowing that
    // removed it would not error — realtime would simply stop delivering, which
    // is indistinguishable from a quiet channel.
    const portalSelect = creates.find(
      (s) => tableOf(s) === 'client_portal_messages' && /FOR\s+SELECT/i.test(s),
    );
    expect(portalSelect, 'no SELECT policy for the realtime subscribers').toBeTruthy();
    expect(/\bTO\s+authenticated\b/i.test(portalSelect!)).toBe(true);
  });

  it('runs as one transaction', () => {
    expect(/^\s*BEGIN;/m.test(sql)).toBe(true);
    expect(/^\s*COMMIT;/m.test(sql)).toBe(true);
  });
});

describe('and nothing later reopens them', () => {
  it('creates no unconditional TO public policy on those four tables after this', () => {
    // A ratchet over four named tables rather than a rule over every one:
    // `check-policy-predicates.mjs` records why a check that is mostly false
    // positives is worse than no check at all.
    const later = readdirSync(join(process.cwd(), MIGRATIONS))
      .filter((f) => f.endsWith('.sql') && /^\d{14}_/.test(f) && f.slice(0, 14) > VERSION);

    const offending: string[] = [];
    for (const file of later) {
      const text = readFileSync(join(process.cwd(), MIGRATIONS, file), 'utf8');
      for (const statement of statements(text)) {
        if (!/^CREATE\s+POLICY/i.test(statement)) continue;
        if (!NARROWED_TABLES.includes(tableOf(statement))) continue;
        const to = /\bTO\s+(\w+)/i.exec(statement)?.[1];
        if (!to || to.toLowerCase() === 'public') offending.push(`${file}: ${nameOf(statement)}`);
      }
    }
    expect(offending).toEqual([]);
  });
});
