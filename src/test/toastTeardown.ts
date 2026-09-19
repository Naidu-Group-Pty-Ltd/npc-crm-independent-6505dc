/**
 * Letting sonner's unmount timer land before the test environment goes away.
 *
 * ## The failure
 *
 * CI, 1 September 2026: `verify` failed with **every test passing** —
 * 226 files, 4,417 passed, 0 failed — and one unhandled error outside any
 * test:
 *
 * ```
 * ReferenceError: window is not defined
 *   ❯ getCurrentEventPriority  react-dom
 *   ❯ dispatchSetState         react-dom
 *   ❯ sonner/dist/index.mjs:1011
 *   ❯ Timeout._onTimeout       sonner/dist/index.mjs:635
 * originated in src/pages/aml/__tests__/amlAustracReporting.test.tsx
 * ```
 *
 * Vitest treats an unhandled error as a failed run, so a green suite reported
 * red — and it reported red naming a file whose tests had all passed, which
 * sends a reader looking for a defect that is not there.
 *
 * ## Why it happens
 *
 * `sonner`'s `deleteToast` is this, at `index.mjs:629`:
 *
 * ```js
 * setHeights((h) => h.filter((height) => height.toastId !== toast.id));
 * setTimeout(() => { removeToast(toast); }, TIME_BEFORE_UNMOUNT);
 * ```
 *
 * That timer exists to let the exit animation finish, and **nothing cancels
 * it** — not unmounting the `Toaster`, not `toast.dismiss()`, not
 * `@testing-library/react`'s cleanup. When it fires, `removeToast` calls a
 * React `setState`, React asks for the current event priority, and that reads
 * `window`. Inside a test that is fine. If the file has finished and Vitest
 * has disposed its jsdom in the 200ms since the last dismissal, `window` is
 * gone.
 *
 * So it is a race between a fixed 200ms timer and however long teardown takes,
 * which is why it appears on a loaded CI runner and not on an idle machine —
 * this was NOT reproducible locally, in isolation, or with a synthetic probe.
 * The diagnosis is the stack, not a local repro, and the remedy does not
 * depend on reproducing it: a file that waits past `TIME_BEFORE_UNMOUNT`
 * before it ends has no such timer left to lose the race with.
 *
 * ## Why waiting, rather than something cleverer
 *
 * The alternatives are worse. Cancelling every timer outstanding at the end of
 * a file means wrapping `globalThis.setTimeout` and clearing ids we did not
 * schedule — including Vitest's own. Suppressing unhandled errors
 * (`dangerouslyIgnoreUnhandledErrors`) turns off the reporting for the whole
 * suite to silence one library, which is how a real fault goes unseen. And
 * neither is available at the only place that could fix this properly, which
 * is inside `sonner`.
 *
 * The cost is bounded and small: one wait, in `afterAll`, in the files that
 * actually mount a `Toaster` — today exactly one, asserted by
 * `toastTeardown.spec.ts`.
 */

/**
 * How long to wait, in milliseconds.
 *
 * Must exceed sonner's own `TIME_BEFORE_UNMOUNT` (200ms at the version this
 * was written against), and `toastTeardown.spec.ts` reads that constant out of
 * the installed package and fails if the margin ever disappears — so a sonner
 * upgrade that lengthens the animation window reopens this as a red test
 * rather than as an intermittent one.
 */
export const TOAST_UNMOUNT_DRAIN_MS = 400;

/**
 * Wait out any sonner unmount timer still in flight.
 *
 * Call from `afterAll` in a test file that mounts a `<Toaster />`:
 *
 * ```ts
 * afterAll(drainToastTimers);
 * ```
 */
export function drainToastTimers(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, TOAST_UNMOUNT_DRAIN_MS);
  });
}
