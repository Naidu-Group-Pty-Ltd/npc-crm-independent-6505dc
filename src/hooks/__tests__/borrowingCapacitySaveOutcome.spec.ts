/**
 * A borrowing capacity that was calculated but never kept.
 *
 * Found while proving audit item 9 and settled with it, because it produces
 * the same symptom by a different route. The save path read its error and
 * threw it away:
 *
 *     if (saveError) { console.error("Failed to save assessment:", saveError); }
 *
 * The function then answered `success: true` with a null `assessmentId`, and
 * the browser raised "Borrowing capacity calculated successfully". But the
 * client card renders the STORED assessment — so a failed save leaves the
 * operator looking at the old figure having just been told the new one
 * worked, which is indistinguishable from a recalculation that never ran.
 *
 * The calculation itself is fine and every figure in the response is good, so
 * this is still a 200 and still `success: true`. What changed is that the
 * response says whether the figure was KEPT, and the browser repeats what it
 * was told instead of assuming.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');
const engine = readFileSync(
  join(root, 'supabase', 'functions', 'calculate-borrowing-capacity', 'index.ts'),
  'utf8',
);
const hook = readFileSync(join(root, 'src', 'hooks', 'useBorrowingCapacity.ts'), 'utf8');

describe('the server reports the save separately from the calculation', () => {
  it('still answers success for a calculation that worked', () => {
    // The figures are good whether or not the row was written. Turning a
    // storage fault into a failed calculation would throw away a correct
    // answer the operator can still read.
    expect(engine).toMatch(/success: true,\s*\n\s*data: \{/);
  });

  it('records a failed insert rather than only logging it', () => {
    expect(engine).toMatch(/saveFailure = saveError\.message/);
  });

  it('records a failed client update too', () => {
    // `clients.borrowing_capacity` is what the client list and several
    // reports read, so a silent failure there splits the figure across
    // surfaces just as effectively.
    expect(engine).toMatch(/const \{ error: clientUpdateError \} = await supabase/);
    expect(engine).toMatch(/saved = false;/);
  });

  it('keeps the first failure rather than the last', () => {
    expect(engine).toMatch(/saveFailure\s*\n?\s*\?\?\s*\(clientUpdateError\.message/);
  });

  it('distinguishes "not saved" from "never asked to save"', () => {
    // `saveResult: false` is the calculator's live preview. It must not read
    // as a storage failure.
    expect(engine).toMatch(/saveRequested: saveResult === true/);
    expect(engine).toMatch(/saved,/);
    expect(engine).toMatch(/saveError: saveFailure,/);
  });
});

describe('the browser repeats what it was told', () => {
  it('only warns when a save was asked for and did not happen', () => {
    expect(hook).toMatch(/\?\.saveRequested === true/);
    expect(hook).toMatch(/\?\.saved === false/);
  });

  it('says the card is unchanged, which is the part that misleads', () => {
    expect(hook).toMatch(/The figure on the card is unchanged/);
  });

  it('still reports an ordinary success as a success', () => {
    expect(hook).toMatch(/toast\.success\('Borrowing capacity calculated successfully'\)/);
  });

  it('never reports a failed save as a success', () => {
    // The success toast has to be on the else branch. If it ever runs
    // unconditionally again, this is the line that catches it.
    const onSuccess = hook.slice(hook.indexOf('const saveFailed'), hook.indexOf('onError'));
    expect(onSuccess).toMatch(/if \(saveFailed\) \{/);
    expect(onSuccess.indexOf('toast.warning')).toBeLessThan(onSuccess.indexOf("toast.success"));
    expect(onSuccess).toMatch(/\} else \{\s*\n\s*toast\.success/);
  });
});
