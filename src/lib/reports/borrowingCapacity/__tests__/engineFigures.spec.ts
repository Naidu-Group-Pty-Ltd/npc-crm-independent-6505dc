/**
 * What `calculate-borrowing-capacity` writes into a client-facing string.
 *
 * The engine is a Deno edge function that cannot be imported here, so this
 * follows the precedent `audit.spec.ts` already set for the same file: read the
 * source and assert on what it *emits*. Weaker than calling the function, and
 * the only automated check the file has — three Deno test files sit beside it
 * and none of them imports `index.ts`, and no workflow runs `deno test`.
 *
 * Both defects below were read off a rendered page, not inferred.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { titleCase } from '../normalise.pure';

const SOURCE = readFileSync(
  resolve(__dirname, '../../../../../supabase/functions/calculate-borrowing-capacity/index.ts'),
  'utf8',
);

/** Comments legitimately quote the defect they fixed; assert on code only. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('figures in the assumptions list', () => {
  it('uses no bare toLocaleString, which prints three fraction digits', () => {
    // `203958.7523.toLocaleString('en-AU')` is `203,958.752` — seventeen significant
    // figures beside the same number rounded to `$203,959` two pages away. And
    // one line had no formatter at all, so `1000` printed without a separator.
    // `repairFloatArtefacts` cannot catch either: it needs eight fraction
    // digits before it looks.
    const bare = [...CODE.matchAll(/\$\{[^}]*\.toLocaleString\(\)[^}]*\}/g)].map((m) => m[0]);
    expect(bare, `still formatting by hand:\n${bare.join('\n')}`).toEqual([]);
  });

  it('interpolates no raw number straight into a dollar string', () => {
    // `` `$${activePolicy.conservativeMode.minimumSurplusFloor}/mo` `` — no
    // formatter, no separator.
    //
    // Writing this found three more of the same shape that nobody had reported:
    // an audit note, a warning, and the expense row's own rule, all printing
    // `$1000/mo`. Console logs are exempt — nobody reads those on a page.
    const raw = CODE.split('\n')
      .filter((line) => !/\bconsole\.\w+\(/.test(line))
      .flatMap((line) => [...line.matchAll(/\$\$\{(?!fmtCurrencyServer|fmtPercentServer)[A-Za-z][\w.]*\}\/(?:mo|yr)/g)])
      .map((m) => m[0]);
    expect(raw, `unformatted:\n${raw.join('\n')}`).toEqual([]);
  });
});

describe('enum keys never reach a client-facing label', () => {
  it('humanises the liability type the catch-all branch passes through', () => {
    // The three branches above it write `'Credit Card'`, `'HECS/HELP'` and
    // `'Buy Now Pay Later'`; this one passed `liability.liability_type`
    // through, and the value becomes an audit row's *label*. The liabilities
    // table humanises the same column; the audit trail did not, so one document
    // called the same thing "Vehicle Loan" and `vehicle_loan` five pages apart.
    expect(CODE).not.toMatch(/type:\s*liability\.liability_type\s*\|\|/);
    expect(CODE).toMatch(/type:\s*titleCase\(String\(liability\.liability_type/);
  });

  it('humanises the expense method printed as a rule', () => {
    expect(CODE).not.toContain('`Method: ${expenseMethodUsed}`');
    expect(CODE).toContain('`Method: ${titleCase(expenseMethodUsed)}`');
  });

  it('shares one humanising rule with the report side rather than copying it', () => {
    expect(CODE).toMatch(
      /import \{ titleCase \} from '\.\.\/_shared\/reports\/borrowingCapacity\/normalise\.pure\.ts'/,
    );
    // And that rule knows HEM is an acronym, not a surname.
    expect(titleCase('hem')).toBe('HEM');
    expect(titleCase('vehicle_loan')).toBe('Vehicle Loan');
    expect(titleCase('declared_higher')).toBe('Declared Higher');
  });
});
