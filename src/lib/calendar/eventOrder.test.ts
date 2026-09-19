/**
 * Audit item 23, second half: the 28th listed 16:00 above 13:00 while the 29th
 * listed 14:00 above 16:00, on the same screen. Neither the grid nor the panel
 * sorted at all — both only filtered — so a day came out in whatever order the
 * provider returned it.
 */
import { describe, expect, it } from 'vitest';

import { byStartTimeAscending } from './eventOrder.pure';

const parse = (value: string): Date | null => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const at = (startTime: string | null | undefined) => ({ startTime });

describe('byStartTimeAscending', () => {
  it('reads a day forwards', () => {
    const day = [
      at('2026-08-28T16:00:00Z'),
      at('2026-08-28T13:00:00Z'),
      at('2026-08-28T14:30:00Z'),
    ].sort(byStartTimeAscending(parse));

    expect(day.map((e) => e.startTime)).toEqual([
      '2026-08-28T13:00:00Z',
      '2026-08-28T14:30:00Z',
      '2026-08-28T16:00:00Z',
    ]);
  });

  it('orders two days the same way as each other', () => {
    // The reported defect was not one wrong order but two different ones.
    const order = (times: string[]) =>
      times.map(at).sort(byStartTimeAscending(parse)).map((e) => e.startTime);

    expect(order(['2026-08-28T16:00:00Z', '2026-08-28T13:00:00Z']))
      .toEqual(['2026-08-28T13:00:00Z', '2026-08-28T16:00:00Z']);
    expect(order(['2026-08-29T14:00:00Z', '2026-08-29T16:00:00Z']))
      .toEqual(['2026-08-29T14:00:00Z', '2026-08-29T16:00:00Z']);
  });

  it('keeps an unplaceable event, and puts it last', () => {
    // A broken timestamp must not be dropped, and must not decide where its
    // neighbours appear.
    const sorted = [
      at('not a date'),
      at('2026-08-28T16:00:00Z'),
      at(null),
      at('2026-08-28T09:00:00Z'),
    ].sort(byStartTimeAscending(parse));

    expect(sorted).toHaveLength(4);
    expect(sorted.slice(0, 2).map((e) => e.startTime)).toEqual([
      '2026-08-28T09:00:00Z',
      '2026-08-28T16:00:00Z',
    ]);
  });
});
