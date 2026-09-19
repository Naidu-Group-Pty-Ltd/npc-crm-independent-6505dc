/**
 * useTemplateHistory — the editor's document state machine (template +
 * patch-based undo/redo + governance read-only guard), extracted from
 * TemplateBuilderEdit in rehaul Phase 2.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTemplateHistory } from '../useTemplateHistory';
import { makeBlankTemplate } from '@/lib/reportTemplate/templateSchema';

function withName(name: string) {
  return (t: ReturnType<typeof makeBlankTemplate>) => ({ ...t, name });
}

describe('useTemplateHistory', () => {
  it('starts from a blank template by default', () => {
    const { result } = renderHook(() => useTemplateHistory());
    expect(result.current.template.pages).toBeDefined();
  });

  it('records history on setTemplate and supports undo/redo', () => {
    const { result } = renderHook(() => useTemplateHistory());
    const original = result.current.template.name;

    act(() => result.current.setTemplate(withName('First')));
    act(() => result.current.setTemplate(withName('Second')));
    expect(result.current.template.name).toBe('Second');

    act(() => result.current.undo());
    expect(result.current.template.name).toBe('First');
    act(() => result.current.undo());
    expect(result.current.template.name).toBe(original);

    act(() => result.current.redo());
    expect(result.current.template.name).toBe('First');
    act(() => result.current.redo());
    expect(result.current.template.name).toBe('Second');
  });

  it('undo/redo on empty history is a safe no-op', () => {
    const { result } = renderHook(() => useTemplateHistory());
    const before = result.current.template;
    act(() => result.current.undo());
    act(() => result.current.redo());
    expect(result.current.template).toEqual(before);
  });

  it('loadTemplate replaces the document without recording history', () => {
    const { result } = renderHook(() => useTemplateHistory());
    const loaded = { ...makeBlankTemplate(), name: 'Loaded from server' };

    act(() => result.current.loadTemplate(loaded));
    expect(result.current.template.name).toBe('Loaded from server');

    // No history entry was recorded — undo keeps the loaded document.
    act(() => result.current.undo());
    expect(result.current.template.name).toBe('Loaded from server');
  });

  it('clears the redo stack when a new edit lands after undo', () => {
    const { result } = renderHook(() => useTemplateHistory());
    act(() => result.current.setTemplate(withName('A')));
    act(() => result.current.setTemplate(withName('B')));
    act(() => result.current.undo());
    expect(result.current.template.name).toBe('A');

    act(() => result.current.setTemplate(withName('C')));
    act(() => result.current.redo());
    // Redo to "B" is no longer possible.
    expect(result.current.template.name).toBe('C');
  });

  it('rejects edits while governance read-only, but loadTemplate still works', () => {
    const { result } = renderHook(() => useTemplateHistory());
    act(() => result.current.setTemplate(withName('Editable')));
    act(() => result.current.setGovernanceReadOnly(true));

    act(() => result.current.setTemplate(withName('Should be blocked')));
    expect(result.current.template.name).toBe('Editable');

    const branch = { ...makeBlankTemplate(), name: 'Hydrated anyway' };
    act(() => result.current.loadTemplate(branch));
    expect(result.current.template.name).toBe('Hydrated anyway');

    act(() => result.current.setGovernanceReadOnly(false));
    act(() => result.current.setTemplate(withName('Editable again')));
    expect(result.current.template.name).toBe('Editable again');
  });
});
