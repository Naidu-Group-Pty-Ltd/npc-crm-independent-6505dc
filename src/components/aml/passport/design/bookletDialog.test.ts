/**
 * The booklet dialog must override the primitive at the SAME breakpoint.
 *
 * `DialogContent` sets `sm:max-w-lg`, `sm:max-h-[85dvh]` and
 * `sm:overflow-visible`. tailwind-merge treats an unprefixed `max-w-*` as a
 * different utility group from `sm:max-w-*`, so a plain `max-w-[1180px]`
 * silently LOSES on every screen ≥640px — which is how the booklet came to
 * render inside a 512px dialog and then spill off the bottom of the viewport.
 *
 * This is asserted on the source because it is a class-collision bug: it has
 * no runtime error, no type error and no failing render — jsdom has no layout,
 * so a render test cannot see it either. The only thing that catches it is
 * checking that the override carries the breakpoint.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(__dirname, 'PassportBooklet.tsx'),
  'utf8',
);

const dialogClasses = source.match(/<DialogContent className="([^"]+)"/)?.[1] ?? '';

describe('booklet dialog sizing', () => {
  it('overrides the width at the sm breakpoint, not unprefixed', () => {
    expect(dialogClasses).toMatch(/sm:max-w-\[/);
  });

  it('caps its height so the book can never exceed the viewport', () => {
    expect(dialogClasses).toMatch(/max-h-\[\d+dvh\]/);
    expect(dialogClasses).toMatch(/sm:max-h-\[\d+dvh\]/);
  });

  it('re-asserts overflow at the sm breakpoint, where the primitive sets visible', () => {
    // `sm:overflow-visible` on the primitive would let the board spill out of
    // the capped height, which is the same defect wearing a different hat.
    expect(dialogClasses).toMatch(/sm:overflow-hidden/);
  });

  it('is a flex column, so the board is a shrinkable child that can be measured', () => {
    expect(dialogClasses).toMatch(/\bflex\b/);
    expect(dialogClasses).toMatch(/flex-col/);
    expect(source).toMatch(/PassportBook[\s\S]{0,120}min-h-0 flex-1/);
  });
});
