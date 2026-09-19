import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const calendar = fs.readFileSync('src/pages/Calendar.tsx', 'utf8');

test('calendar non-modal menus do not lock the page scroll surface', () => {
  assert.match(calendar, /<DropdownMenu modal=\{false\}>/);
  assert.equal((calendar.match(/<ContextMenu key=\{tab\.id\} modal=\{false\}/g) ?? []).length, 3);
});

test('stale pointer-lock recovery only preserves genuinely blocking overlays', () => {
  const recoveryStart = calendar.indexOf('const releaseStuckOverlayLocks');
  assert.notEqual(recoveryStart, -1);

  const recovery = calendar.slice(recoveryStart, recoveryStart + 1_200);
  assert.match(recovery, /\[role="dialog"\]\[data-state="open"\]/);
  assert.doesNotMatch(recovery, /data-radix-popper-content-wrapper/);
  assert.match(recovery, /removeProperty\('pointer-events'\)/);
  assert.match(recovery, /removeAttribute\('data-scroll-locked'\)/);
});

test('pointer-lock checks are frame-coalesced and cleaned up on unmount', () => {
  assert.match(calendar, /if \(pointerLockFrame !== null\) return;/);
  assert.match(calendar, /cancelAnimationFrame\(pointerLockFrame\)/);
  assert.match(calendar, /cancelAnimationFrame\(pointerLockSettleFrame\)/);
});

test('wheel gestures over calendar content reach the dashboard scroll owner', () => {
  assert.match(calendar, /calendarPage\.addEventListener\('wheel', handleCalendarWheel, \{ passive: false, capture: true \}\)/);
  assert.match(calendar, /calendarPage\.closest\('\.dashboard-main'\)/);
  assert.match(calendar, /dashboardMain\.scrollBy\(\{ top: deltaY, behavior: 'auto' \}\)/);
  assert.match(calendar, /window\.scrollBy\(\{ top: deltaY, behavior: 'auto' \}\)/);
  assert.match(calendar, /if \(canScrollVertically && hasRoom\) return;/);
  assert.match(calendar, /event\.ctrlKey \|\| event\.metaKey/);
});