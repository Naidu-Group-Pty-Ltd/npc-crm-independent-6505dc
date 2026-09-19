import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { canonicalPeriodWindow } from '../periodWindow.ts';

Deno.test('digest period windows are deterministic UTC buckets', () => {
  const reference = new Date('2026-07-26T18:42:00.000Z');
  assertEquals(canonicalPeriodWindow('24h', reference), { start:new Date('2026-07-26T00:00:00.000Z'), end:new Date('2026-07-27T00:00:00.000Z'), key:'24h:2026-07-26T00:00:00.000Z' });
  assertEquals(canonicalPeriodWindow('weekly', reference).start.toISOString(), '2026-07-20T00:00:00.000Z');
  assertEquals(canonicalPeriodWindow('monthly', reference).start.toISOString(), '2026-07-01T00:00:00.000Z');
  assertEquals(canonicalPeriodWindow('quarterly', reference).start.toISOString(), '2026-07-01T00:00:00.000Z');
  assertEquals(canonicalPeriodWindow('annual', reference).start.toISOString(), '2026-01-01T00:00:00.000Z');
});

Deno.test('biweekly window uses stable Monday anchor', () => {
  const first = canonicalPeriodWindow('biweekly', new Date('2026-07-26T10:00:00Z'));
  const retry = canonicalPeriodWindow('biweekly', new Date('2026-07-27T01:00:00Z'));
  assertEquals(first.key, retry.key);
  assertEquals(first.end.getTime() - first.start.getTime(), 14 * 86_400_000);
});
