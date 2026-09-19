/**
 * The two things that keep the toast-teardown fix honest.
 *
 * It is a wait, and a wait is only correct while two facts hold: that it is
 * longer than the timer it is waiting out, and that every file which can
 * schedule one actually waits. Both are read rather than assumed, because
 * neither is visible from the code that depends on them — the first lives in
 * `node_modules`, and the second is a property of the test suite as a whole.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TOAST_UNMOUNT_DRAIN_MS } from '../toastTeardown';

const root = join(__dirname, '..', '..', '..');

describe('the wait is longer than the timer it waits out', () => {
  it('exceeds sonner’s own TIME_BEFORE_UNMOUNT', () => {
    // Read from the installed package, so an upgrade that lengthens the exit
    // animation fails here instead of quietly reopening the race.
    const sonner = readFileSync(join(root, 'node_modules', 'sonner', 'dist', 'index.mjs'), 'utf8');
    const declared = /const TIME_BEFORE_UNMOUNT\s*=\s*(\d+)/.exec(sonner);
    expect(declared, 'sonner no longer declares TIME_BEFORE_UNMOUNT — re-read deleteToast').not.toBeNull();

    const timeBeforeUnmount = Number(declared![1]);
    expect(timeBeforeUnmount).toBeGreaterThan(0);
    expect(
      TOAST_UNMOUNT_DRAIN_MS,
      `sonner now waits ${timeBeforeUnmount}ms before unmounting; raise TOAST_UNMOUNT_DRAIN_MS above it`,
    ).toBeGreaterThan(timeBeforeUnmount);
  });

  it('is still the timer nothing cancels', () => {
    // If sonner ever cleans this up itself, the wait is dead weight and should
    // go. `deleteToast` returning a cleanup, or the id being captured in a
    // ref, would both show up as a `clearTimeout` in that callback.
    const sonner = readFileSync(join(root, 'node_modules', 'sonner', 'dist', 'index.mjs'), 'utf8');
    const at = sonner.indexOf('const deleteToast');
    expect(at, 'sonner no longer has deleteToast — re-read why this wait exists').toBeGreaterThan(-1);
    const body = sonner.slice(at, at + 600);
    expect(body).toContain('TIME_BEFORE_UNMOUNT');
    expect(body, 'sonner now cancels its own unmount timer — this wait can go').not.toContain('clearTimeout');
  });
});

describe('every file that can schedule one waits for it', () => {
  /** Every test file under `src/`. */
  function testFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        out.push(...testFiles(full));
      } else if (/\.(test|spec)\.tsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  }

  /**
   * Found, never listed.
   *
   * A hand-written list of the files that mount a `Toaster` would go stale the
   * first time somebody adds one — and the failure it causes is an
   * intermittent red run naming a file whose tests all passed, which is the
   * hardest kind to attribute. Today the answer is one file; the point is that
   * a second one fails here on the day it is written.
   */
  const mountsToaster = testFiles(join(root, 'src'))
    .filter((file) => /<Toaster[\s/>]/.test(readFileSync(file, 'utf8')));

  it('finds the files by reading them', () => {
    expect(mountsToaster.length).toBeGreaterThan(0);
  });

  it.each(mountsToaster.map((f) => f.slice(root.length + 1)))('%s drains on afterAll', (relative) => {
    const source = readFileSync(join(root, relative), 'utf8');
    expect(
      source,
      `${relative} mounts a Toaster, so it can end with sonner's uncancellable `
        + 'unmount timer in flight. Add `afterAll(drainToastTimers)` — see src/test/toastTeardown.ts',
    ).toMatch(/afterAll\(\s*drainToastTimers\s*\)/);
  });
});
