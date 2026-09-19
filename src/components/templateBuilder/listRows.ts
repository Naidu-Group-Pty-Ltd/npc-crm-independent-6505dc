export type ListRow = Record<string, unknown>;

export function createEmptyListRow(sample?: ListRow): ListRow {
  if (!sample) return { cells: ['', ''] };

  return Object.fromEntries(
    Object.entries(sample).map(([key, value]) => {
      if (Array.isArray(value)) return [key, value.map(() => '')];
      if (typeof value === 'boolean') return [key, false];
      if (typeof value === 'number') return [key, 0];
      return [key, ''];
    }),
  );
}

export function updateListRowValue(
  rows: ListRow[],
  rowIndex: number,
  key: string,
  value: unknown,
  valueIndex?: number,
): ListRow[] {
  return rows.map((row, index) => {
    if (index !== rowIndex) return row;
    if (valueIndex === undefined) return { ...row, [key]: value };

    const values = Array.isArray(row[key]) ? [...row[key]] : [];
    values[valueIndex] = value;
    return { ...row, [key]: values };
  });
}
