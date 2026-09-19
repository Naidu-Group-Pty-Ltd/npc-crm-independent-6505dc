/**
 * Audit item 21: Quick Add drew two date pickers and two time pickers.
 *
 * `utilities.css` replaces the native indicator with a branded lucide calendar
 * (a clock for `type="time"`), and this dialog also draws its own labelled
 * button — deliberately, because the UA pseudo-element cannot be reached with
 * Tab and carries no accessible name. Both are reasonable; both at once is not.
 *
 * The dialog tried to hide the system's with
 * `[&::-webkit-calendar-picker-indicator]:opacity-0`, which never worked and
 * could not: the system rule is
 * `input[type="date"]::-webkit-calendar-picker-indicator` — element, attribute
 * and pseudo-element — and out-ranks a utility class on the same pseudo. No
 * amount of tuning the utility would have changed it.
 *
 * The keyboard-operable button is the one that survives, so the accessible
 * trigger is kept and the decorative duplicate goes. `QuickAddAppointmentModal`
 * asserts the button still opens the native control; this pins the removal.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const modal = readFileSync(join(__dirname, 'QuickAddAppointmentModal.tsx'), 'utf8');
const utilities = readFileSync(
  join(__dirname, '..', '..', 'styles', 'utilities.css'),
  'utf8',
);

describe('Quick Add date and time pickers', () => {
  it('opts the native indicator out on both fields', () => {
    const optedOut = modal.match(/has-custom-picker/g) ?? [];
    expect(optedOut).toHaveLength(2);
  });

  it('never reaches for the utility that cannot win', () => {
    expect(modal).not.toMatch(/\[&::-webkit-calendar-picker-indicator\]/);
  });

  it('removes the indicator rather than merely hiding it', () => {
    // An invisible indicator still takes its width and still answers a click:
    // a second, unlabelled hit target beside the real button.
    const rule = utilities.slice(utilities.indexOf('.has-custom-picker'));
    const block = rule.slice(rule.indexOf('{'), rule.indexOf('}'));
    expect(block).toMatch(/display:\s*none/);
    expect(block).not.toMatch(/opacity/);
  });

  it('keeps the opt-out ranked above the rule it overrides', () => {
    // Element + attribute + class + pseudo beats element + attribute + pseudo.
    expect(utilities).toMatch(
      /input\[type="date"\]\.has-custom-picker::-webkit-calendar-picker-indicator/,
    );
  });
});
