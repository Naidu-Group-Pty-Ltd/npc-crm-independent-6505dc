import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAutoSearchMemory,
  recordAutoSearch,
  RETRY_AFTER_MS,
  shouldAutoSearch,
} from './autoPhotoMemory';

describe('autoPhotoMemory', () => {
  beforeEach(clearAutoSearchMemory);

  it('allows a listing that has never been searched', () => {
    expect(shouldAutoSearch('rec1')).toBe(true);
  });

  it('blocks a repeat of a fruitless search until it ages out', () => {
    const t0 = 1_000_000;
    recordAutoSearch('rec1', 0, t0);
    expect(shouldAutoSearch('rec1', t0 + 1)).toBe(false);
    expect(shouldAutoSearch('rec1', t0 + RETRY_AFTER_MS - 1)).toBe(false);
    // The agency may have added photography since; three days on, look again.
    expect(shouldAutoSearch('rec1', t0 + RETRY_AFTER_MS)).toBe(true);
  });

  it('remembers across instances — the point is surviving a reload', () => {
    recordAutoSearch('rec2', 0, 5_000);
    // A fresh read path (no shared in-memory state) must still know.
    expect(shouldAutoSearch('rec2', 6_000)).toBe(false);
  });

  it('keeps entries independent', () => {
    recordAutoSearch('rec3', 0, 1_000);
    expect(shouldAutoSearch('rec4', 2_000)).toBe(true);
  });

  it('survives corrupted storage rather than throwing', () => {
    window.localStorage.setItem('npc.autoPhotoSearch.v1', '{not json');
    expect(shouldAutoSearch('rec5')).toBe(true);
    expect(() => recordAutoSearch('rec5', 2)).not.toThrow();
  });
});
