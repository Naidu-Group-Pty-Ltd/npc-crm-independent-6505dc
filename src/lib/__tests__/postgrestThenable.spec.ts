import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

/**
 * A PostgREST query builder is a Thenable, not a Promise.
 *
 * It implements `then()` — which is why `await` works on it — and implements
 * neither `catch()` nor `finally()`. So this, which reads as ordinary
 * defensive code, throws at runtime:
 *
 *     await supabase.from('client_activity_log').insert({ … }).catch(() => {});
 *     //                                                    ^ undefined
 *     // TypeError: supabase.from(...).insert(...).catch is not a function
 *
 * It threw in production in three places, and the two that mattered were both
 * halves of "View as Client": the mint threw after writing a valid handoff
 * token (operator saw "Internal error", token orphaned) and the redeem threw
 * one step after consuming that token and creating the portal session
 * (operator saw "Handoff failed", and the one-time link was already spent).
 *
 * The failure mode is why this is a scan and not a code review note: the line
 * is only reached when the optional write is reached, it looks correct, and
 * TypeScript accepts it — `PostgrestBuilder` declares `then`, and calling an
 * undefined property is not something the types here catch.
 *
 * `supabase.storage.from(...)` is a DIFFERENT object whose methods return real
 * Promises, so `.catch()` on a storage call is correct and is not flagged.
 */

const ROOT = resolve(__dirname, '../../..');
const ROOTS = ['supabase/functions', 'src'];

/** A query-builder chain: `.from(…)` or `.rpc(…)`, but not on `storage`. */
const BUILDER = /(?<!storage)\s*\.(?:from|rpc)\s*\(/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries;
    try { entries = readdirSync(join(ROOT, d), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        walk(rel);
      } else if (/\.tsx?$/.test(e.name)) {
        out.push(rel);
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * Comments removed, line numbering preserved.
 *
 * The scan found two false positives on its first run and both were PROSE
 * describing the bug — including this module's own helper, whose doc comment
 * quotes the broken line so the next reader can recognise it. A negative
 * assertion has to be made about the code, not about the file, or writing
 * down what went wrong becomes an offence against the rule that records it.
 */
function code(source: string): string {
  const keepLines = (m: string) => m.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, keepLines)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** Everything since the last statement boundary before `at`. */
function statementBefore(source: string, at: number): string {
  const window = source.slice(Math.max(0, at - 1500), at);
  const cut = Math.max(window.lastIndexOf(';'), window.lastIndexOf('\n\n'));
  return window.slice(cut + 1);
}

function offenders(): string[] {
  const found: string[] = [];
  for (const root of ROOTS) {
    for (const rel of sourceFiles(root)) {
      if (rel.includes('__tests__') || /\.(spec|test)\.tsx?$/.test(rel)) continue;
      const source = code(readFileSync(join(ROOT, rel), 'utf8'));
      for (const m of source.matchAll(/\.(catch|finally)\s*\(/g)) {
        const stmt = statementBefore(source, m.index!);
        if (!BUILDER.test(stmt)) continue;
        if (stmt.includes('storage')) continue;      // real Promise
        if (stmt.includes('.then(')) continue;        // already a promise chain
        const line = source.slice(0, m.index!).split('\n').length;
        found.push(`${rel}:${line} — .${m[1]}() on a PostgREST builder`);
      }
    }
  }
  return found;
}

describe('a PostgREST builder is never given .catch() or .finally()', () => {
  it('scans both source trees, not a list of files', () => {
    expect(sourceFiles('supabase/functions').length).toBeGreaterThan(300);
    expect(sourceFiles('src').length).toBeGreaterThan(500);
  });

  it('no query builder is handed a method it does not have', () => {
    const found = offenders();
    expect(
      found,
      `A PostgREST builder has then() and no catch()/finally(). Use `
        + `bestEffort(...) from _shared/bestEffortWrite.ts, or await inside `
        + `try/catch:\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('the scan can tell a builder from a storage call', () => {
    // Proves the rule discriminates rather than just returning empty — a
    // storage `.remove()` IS a real Promise and five call sites rely on it.
    const storage = "await supabase.storage.from('client-files').remove([p]).catch(() => {});";
    const builder = "await supabase.from('client_activity_log').insert({ a: 1 }).catch(() => {});";
    const flagged = (s: string) =>
      [...s.matchAll(/\.(catch|finally)\s*\(/g)].some((m) => {
        const stmt = statementBefore(s, m.index!);
        return BUILDER.test(stmt) && !stmt.includes('storage') && !stmt.includes('.then(');
      });
    expect(flagged(builder)).toBe(true);
    expect(flagged(storage)).toBe(false);
  });
});

describe('the best-effort helper says what it is for', () => {
  const helper = readFileSync(
    join(ROOT, 'supabase/functions/_shared/bestEffortWrite.ts'),
    'utf8',
  );

  it('awaits inside try/catch rather than chaining', () => {
    expect(helper).toMatch(/try\s*\{[\s\S]*await work/);
    expect(helper).not.toMatch(/work\s*\.catch\(/);
  });

  it('leaves a trace instead of swallowing', () => {
    // "Best effort" should still be visible when it did not succeed.
    expect(helper).toMatch(/console\.warn/);
  });

  it("reads PostgREST's error field, which is not a rejection", () => {
    // A failed write is reported in `error`, not by throwing — so a try/catch
    // alone would still be silent about it.
    expect(helper).toMatch(/'error' in result/);
  });
});

describe('both halves of the staff handoff are fixed', () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

  it('the mint no longer throws after writing the token', () => {
    const src = read('supabase/functions/staff-client-portal-handoff-create/index.ts');
    expect(src).toContain('bestEffort(');
    expect(src).not.toMatch(/insert\([\s\S]{0,400}?\)\s*\.catch\(/);
  });

  it('the redeem no longer throws after consuming the token', () => {
    const src = read('supabase/functions/finance-portal-handoff-redeem/index.ts');
    expect(src).toContain('bestEffort(');
    expect(src).not.toMatch(/insert\([\s\S]{0,500}?\)\s*\.catch\(/);
  });

  it('the finance-partner branch is untouched', () => {
    // It never had the bug: it is written plainly and has always worked.
    // Removing a defect must not rewrite the path that was already correct.
    const src = read('supabase/functions/finance-portal-handoff-redeem/index.ts');
    expect(src).toMatch(/finance_portal_activity_log'\)\s*\.insert\(/);
  });
});
