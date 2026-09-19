import { describe, it, expect } from 'vitest';
import { resolveEditorV2Flag } from '../editorV2Flag';

describe('resolveEditorV2Flag', () => {
  it('defaults to ON (V2 is the default editor — rehaul Phase 8)', () => {
    expect(resolveEditorV2Flag({})).toBe(true);
  });

  it('kill-switches force V1: ?editorV2=0, storage "0", env "0"/false/"false"', () => {
    expect(resolveEditorV2Flag({ searchParams: '?editorV2=0' })).toBe(false);
    expect(resolveEditorV2Flag({ storageValue: '0' })).toBe(false);
    expect(resolveEditorV2Flag({ envValue: '0' })).toBe(false);
    expect(resolveEditorV2Flag({ envValue: false })).toBe(false);
    expect(resolveEditorV2Flag({ envValue: 'false' })).toBe(false);
  });

  it('URL param wins over storage (both directions)', () => {
    expect(resolveEditorV2Flag({ searchParams: '?editorV2=1', storageValue: '0' })).toBe(true);
    expect(resolveEditorV2Flag({ searchParams: '?editorV2=0', storageValue: '1' })).toBe(false);
  });

  it('honours the sticky storage preference, else defaults ON', () => {
    expect(resolveEditorV2Flag({ storageValue: '1' })).toBe(true);
    expect(resolveEditorV2Flag({ storageValue: '0' })).toBe(false);
    expect(resolveEditorV2Flag({ storageValue: null })).toBe(true); // null → default ON
  });

  it('honours the build-time env override, else defaults ON', () => {
    expect(resolveEditorV2Flag({ envValue: true })).toBe(true);
    expect(resolveEditorV2Flag({ envValue: '1' })).toBe(true);
    expect(resolveEditorV2Flag({ envValue: 'false' })).toBe(false);
    expect(resolveEditorV2Flag({ envValue: undefined })).toBe(true); // undefined → default ON
  });

  it('ignores unrelated search params (default ON applies)', () => {
    expect(resolveEditorV2Flag({ searchParams: '?foo=bar' })).toBe(true);
  });
});
