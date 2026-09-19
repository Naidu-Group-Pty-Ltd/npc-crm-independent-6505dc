/**
 * A cached planning answer whose shape predates the code reading it.
 *
 * ## What this pins
 *
 * `planning-data-service` cached under the coordinate alone, for seven days.
 * Measured on the two subject rows on 17 September 2026, Maryborough's cached
 * object was 1,293 bytes with `constraints`, `constraintsAsked` and
 * `constraintRegisters` all absent — a complete, `live`, in-date answer taken
 * at `2026-09-16T23:37Z`, before the constraint register shipped, while
 * Kellyville's from `2026-09-17T08:58Z` carried 2 readings and 21 asked
 * families. So for a week, every report at that coordinate was served an
 * answer with no overlay, hazard or strategic-designation reading in it.
 *
 * The version now rides the key, so a widened answer stops matching a narrow
 * row. Nothing is migrated and nothing is deleted; the old rows age out under
 * the TTL they already have.
 *
 * Bumping the version is a decision. FORGETTING to is the failure mode, so
 * the second test reads the service's own answer literal and fails when a key
 * is added, removed or renamed without `PLANNING_ANSWER_KEYS` being updated —
 * which is the moment to ask whether the version needs to move with it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PLANNING_ANSWER_KEYS, PLANNING_ANSWER_VERSION, planningCacheKey,
} from '../../../../supabase/functions/_shared/planning/planningAnswerVersion.pure';

describe('the planning cache key', () => {
  it('carries the answer shape as well as the coordinate', () => {
    expect(planningCacheKey(-25.5161079, 152.7074047)).toBe(`-25.516108,152.707405@${PLANNING_ANSWER_VERSION}`);
  });

  it('keeps the coordinate precision the service has always used', () => {
    // Six places is ~0.1 m. A version bump must be the only thing that changes
    // about a key, or every deployment silently invalidates every row.
    expect(planningCacheKey(-33.7115485, 150.9586199)).toContain('-33.711548,150.958620');
  });

  it('cannot collide with a row written before the version existed', () => {
    // Maryborough's stale row is keyed `-25.516108,152.707405`. The new key is
    // a strict extension of it, so the old row is unreachable rather than
    // overwritten — and a reader who goes looking can still see what was
    // served.
    const old = '-25.516108,152.707405';
    expect(planningCacheKey(-25.5161079, 152.7074047)).not.toBe(old);
    expect(planningCacheKey(-25.5161079, 152.7074047).startsWith(`${old}@`)).toBe(true);
  });
});

describe('the recorded shape and the service agree', () => {
  it('names exactly the keys the service puts in its answer', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'supabase/functions/planning-data-service/index.ts'), 'utf8',
    );
    // The `const data = { … }` literal that becomes the cached answer, read by
    // balancing braces so a nested object cannot end it early.
    const open = src.indexOf('const data = {');
    expect(open, 'the answer literal').toBeGreaterThan(-1);
    let depth = 0;
    let i = src.indexOf('{', open);
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    const literal = src.slice(start + 1, i);
    // Top-level keys only: a nested object's keys sit at a deeper brace depth.
    // Shorthand counts — `jurisdiction,` is a key of the answer exactly as
    // `coordinate: {…}` is, and reading only the colon form missed it.
    const keys: string[] = [];
    let d = 0;
    for (const line of literal.split('\n')) {
      const trimmed = line.trim();
      if (d === 0) {
        const m = /^([A-Za-z_$][\w$]*)\s*[:,]/.exec(trimmed);
        if (m) keys.push(m[1]);
      }
      for (const c of line) {
        if ('{(['.includes(c)) d++;
        else if ('})]'.includes(c)) d--;
      }
    }
    expect([...keys].sort()).toEqual([...PLANNING_ANSWER_KEYS].sort());
  });
});
