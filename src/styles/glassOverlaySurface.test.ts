/**
 * Audit item 17: the Quick Add recipient dropdown was reported as transparent —
 * the contact list and the form it covered were both readable, on top of each
 * other.
 *
 * `bg-popover` was swept up by the glass rule for hand-built cards
 * (`.border.bg-card`), which fills at `--glass-fill` — 55% in dark mode. The
 * dropdown carries `bg-popover border`, matched at (0,2,0), and out-ranked its
 * own `bg-popover`.
 *
 * A card and an overlay want opposite things. `--popover` is the token for a
 * surface that floats ABOVE content, and hiding what it covers is the whole
 * job. Twelve hand-rolled overlays across the app carry `bg-popover border`.
 *
 * Blur is not the alternative: Radix's own select and dropdown get away with a
 * translucent raised fill because they PORTAL to the body. These render inline,
 * usually inside a dialog that already carries `backdrop-filter`, and a nested
 * backdrop filter does not blur the dialog's own content. Both the raised fill
 * and raised-plus-blur were rendered against the real compiled stylesheet and
 * left the text underneath legible.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const glass = readFileSync(join(__dirname, 'glass.css'), 'utf8');

/** The declaration block whose selector list contains `.border.bg-popover`. */
function popoverSurfaceBlock(): string {
  const start = glass.indexOf('.border.bg-popover');
  expect(start).toBeGreaterThan(-1);
  const open = glass.indexOf('{', start);
  const close = glass.indexOf('}', open);
  return glass.slice(open + 1, close);
}

describe('hand-rolled overlay surfaces', () => {
  it('fills bg-popover opaquely, so an overlay hides what it covers', () => {
    const block = popoverSurfaceBlock();
    expect(block).toMatch(/background-color:\s*hsl\(var\(--popover\)\)/);
  });

  it('never gives bg-popover a translucent glass fill', () => {
    const block = popoverSurfaceBlock();
    // `--glass-fill` is 55% and `--glass-fill-raised` 86%; both were measured
    // to leave the covered form readable through the overlay.
    expect(block).not.toMatch(/background-color:\s*var\(--glass-fill/);
  });

  it('keeps bg-popover out of the hand-built card rule', () => {
    // The card rule is deliberately blur-free because it is broad. Sharing it
    // is what made an overlay translucent in the first place.
    const cardBlockStart = glass.indexOf('.border.bg-card');
    const cardSelectorEnd = glass.indexOf('{', cardBlockStart);
    const cardSelectors = glass.slice(cardBlockStart, cardSelectorEnd);
    expect(cardSelectors).not.toMatch(/bg-popover/);
  });
});
