import { describe, expect, it } from 'vitest';
import { createEmptyListRow, updateListRowValue } from './listRows';

describe('list row shape helpers', () => {
  it('preserves the legacy cell-array shape', () => {
    const rows = [{ cells: ['Address', '{{property.address}}'] }];

    expect(createEmptyListRow(rows[0])).toEqual({ cells: ['', ''] });
    expect(updateListRowValue(rows, 0, 'cells', 'Suburb', 0)).toEqual([
      { cells: ['Suburb', '{{property.address}}'] },
    ]);
  });

  it('creates a structured row with the same keys and value types', () => {
    const sample = {
      label: 'Launch',
      year: 2026,
      done: true,
      values: ['Strong', 'Moderate'],
    };

    expect(createEmptyListRow(sample)).toEqual({
      label: '',
      year: 0,
      done: false,
      values: ['', ''],
    });
  });

  it('updates a structured property without replacing sibling data', () => {
    const rows = [{ q: 'Question', a: 'Answer' }];

    expect(updateListRowValue(rows, 0, 'q', 'Updated question')).toEqual([
      { q: 'Updated question', a: 'Answer' },
    ]);
  });

  it('preserves a boolean array when updating one of its values', () => {
    const rows = [{ flags: [true, false], label: 'Checks' }];

    expect(updateListRowValue(rows, 0, 'flags', true, 1)).toEqual([
      { flags: [true, true], label: 'Checks' },
    ]);
  });
});
