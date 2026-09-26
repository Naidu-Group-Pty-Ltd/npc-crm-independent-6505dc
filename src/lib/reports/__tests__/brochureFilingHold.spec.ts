/**
 * The pictures ticked from a brochure hold the page while they are filed.
 *
 * Codex's review of #2775 (P1, posted after it merged): the filing was an
 * un-awaited chain owned by the page, the report was announced and the form
 * cleared the moment it started, and a brochure's pictures exist nowhere but
 * that page — so a close or a reload in those seconds lost them for good, and
 * the report was finished without them.
 *
 * What is held here:
 *
 *   - for as long as the filing is in flight, leaving the page asks first, and
 *     not a moment longer;
 *   - the caller is answered once the filing lands, or once the patience runs
 *     out — after which the filing carries on, still holding the page, and its
 *     outcome is reported when it lands, exactly once;
 *   - a filing that throws releases the page and says so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BROCHURE_FILING_PATIENCE_MS,
  fileWhilePageHeld,
  type UnloadTarget,
} from '../brochurePhotographs';
import {
  BROCHURE_FILING_BROKE,
  BROCHURE_FILING_STILL_RUNNING,
  type BrochureFiling,
} from '../brochurePhotographs.pure';

/** A page: what is listening for `beforeunload`, and what leaving it would meet. */
function page() {
  const listeners = new Set<(event: BeforeUnloadEvent) => void>();
  const target: UnloadTarget = {
    addEventListener: (_type, listener) => { listeners.add(listener); },
    removeEventListener: (_type, listener) => { listeners.delete(listener); },
  };
  /** True where a close or a reload is asked about first. */
  const leave = () => {
    let asked = false;
    const event = { preventDefault: () => { asked = true; }, returnValue: undefined } as unknown as BeforeUnloadEvent;
    for (const listener of listeners) listener(event);
    return asked;
  };
  return { target, leave, held: () => listeners.size > 0 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

const FILED: BrochureFiling = { filed: 3, refused: {}, failed: 0 };

describe('the ticked pictures hold the page while they are in flight', () => {
  afterEach(() => vi.useRealTimers());

  it('asks before a close or a reload for as long as the filing runs, and not after', async () => {
    const { target, leave, held } = page();
    const filing = deferred<BrochureFiling>();
    const result = fileWhilePageHeld(() => filing.promise, { target });
    expect(held()).toBe(true);
    expect(leave()).toBe(true);
    filing.resolve(FILED);
    await expect(result).resolves.toEqual({ state: 'settled', outcome: FILED });
    expect(held()).toBe(false);
    expect(leave()).toBe(false);
  });

  it('lets the adviser go on after the patience, and keeps holding the page until the filing lands', async () => {
    vi.useFakeTimers();
    const { target, held } = page();
    const filing = deferred<BrochureFiling>();
    const late = vi.fn();
    const result = fileWhilePageHeld(() => filing.promise, { target, onLateOutcome: late });
    await vi.advanceTimersByTimeAsync(BROCHURE_FILING_PATIENCE_MS + 1);
    await expect(result).resolves.toEqual({ state: 'pending' });
    // Still in flight, so still held — and nothing reported yet.
    expect(held()).toBe(true);
    expect(late).not.toHaveBeenCalled();
    filing.resolve(FILED);
    await vi.advanceTimersByTimeAsync(0);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith(FILED);
    expect(held()).toBe(false);
  });

  it('answers as soon as the filing lands, and reports it once', async () => {
    vi.useFakeTimers();
    const { target } = page();
    const late = vi.fn();
    const result = fileWhilePageHeld(async () => FILED, { target, onLateOutcome: late });
    await expect(result).resolves.toEqual({ state: 'settled', outcome: FILED });
    // The patience is cleared with the answer: nothing is left counting down.
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(BROCHURE_FILING_PATIENCE_MS * 2);
    expect(late).not.toHaveBeenCalled();
  });

  it('releases the page and says so when the filing throws, which it is not meant to', async () => {
    const { target, held } = page();
    await expect(fileWhilePageHeld(() => Promise.reject(new Error('unexpected')), { target }))
      .resolves.toEqual({ state: 'settled', outcome: null });
    expect(held()).toBe(false);
    await expect(fileWhilePageHeld(() => { throw new Error('before any promise'); }, { target }))
      .resolves.toEqual({ state: 'settled', outcome: null });
    expect(held()).toBe(false);
  });

  it('tells the adviser, in their words, what a wait cut short or a failed filing means', () => {
    expect(BROCHURE_FILING_STILL_RUNNING.description).toMatch(/Keep this page open/);
    expect(BROCHURE_FILING_BROKE.description).toMatch(/The report is made without them\.$/);
    for (const message of [BROCHURE_FILING_STILL_RUNNING, BROCHURE_FILING_BROKE]) {
      expect(`${message.title} ${message.description}`).not.toMatch(/[a-z]+_[a-z]+/);
    }
  });
});
