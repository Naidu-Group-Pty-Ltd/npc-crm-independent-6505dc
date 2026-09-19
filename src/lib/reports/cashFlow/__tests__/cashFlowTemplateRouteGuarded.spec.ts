/**
 * The 10 Year Cash Flow's template render **always carries the series on
 * screen**, and this file keeps the two halves of that rule from drifting
 * apart.
 *
 * ## Why this format is the exception
 *
 * Every other migrated format's delivery path reads the same stored record its
 * adapter reads, so the two agree by construction. This one does not:
 * `CashFlowAnalysisModal` recomputes ten years in the browser from
 * `manual_overrides` plus whatever the adviser has changed since it opened,
 * and `cashFlowAdapter` reads the stored `financial_calculations.projections`
 * — a different series whenever an override exists, which is the normal case.
 *
 * The first answer was a gate: `matchStoredScenario` had to prove the screen
 * equalled the store before the template was asked for at all. Correct, and
 * almost never satisfied — so a chosen template silently fell back to the
 * standard composer on nearly every download, and the picker's "your choice
 * is kept" was a promise the generator did not keep.
 *
 * The answer now is a channel: the request is always made, and the match
 * decides **what it carries**. A matched series routes as its named stored
 * scenario, so the document may honestly say "Moderate". An unmatched one
 * hands the adapter the same wire the composer receives (`payload`), and the
 * document says "Adviser-reviewed" — never a scenario label the series does
 * not satisfy. Both halves are asserted below, because either alone can be
 * true of code that ships wrong figures or wrong labels.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LIB = join(__dirname, '..');
const MODAL = join(__dirname, '../../../../components/reports/CashFlowAnalysisModal.tsx');

const withoutComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the cash flow library', () => {
  it('asks for no templated document of its own', () => {
    // The guard lives at the one call site that holds the on-screen series.
    // A `deliver*`-style helper here would have nothing to compare it against.
    for (const file of readdirSync(LIB).filter((f) => f.endsWith('.ts'))) {
      const code = withoutComments(readFileSync(join(LIB, file), 'utf8'));
      expect(code, `${file} routes through Template Builder — read this file's header`)
        .not.toContain('tryTemplateDocument');
    }
  });
});

describe('the modal', () => {
  const code = withoutComments(readFileSync(MODAL, 'utf8'));

  it('always asks, and the match decides what the request carries', () => {
    const at = code.indexOf('tryTemplateDocument(');
    expect(at, 'the modal no longer routes at all — that is a different change')
      .toBeGreaterThan(-1);

    // The match is still established before the request — it names the
    // scenario a matched series may honestly be labelled with.
    const matchAt = code.indexOf('matchStoredScenario(');
    expect(matchAt, 'the stored-series match no longer runs before the request')
      .toBeGreaterThan(-1);
    expect(matchAt).toBeLessThan(at);

    // The request itself is no longer conditional: `await` directly, not
    // `storedScenario ? … : null`. Gating it again is how the choice went
    // silently unhonoured on nearly every download of this format.
    const call = code.slice(Math.max(0, at - 120), at);
    expect(call, 'the request for a template has been gated again — read this file\'s header')
      .not.toMatch(/storedScenario\s*\?\s*(await\s+)?tryTemplateDocument/);

    // The payload is sent ALWAYS, not only when the series is unmatched.
    //
    // Sending it conditionally left the matched case depending on the adapter
    // re-reading `investment_reports` — a read that can be refused, and whose
    // refusal is indistinguishable from "this record cannot be templated", so
    // the document silently came out of the standard composer. Everything the
    // template needs is on screen, so nothing is re-read.
    const region = code.slice(at, at + 600);
    expect(region, 'the reviewed wire is no longer handed to the adapter on every render')
      .toMatch(/payload:\s*\{[\s\S]*?wire,/);
    expect(region, 'the address must travel with it, or the title needs a read')
      .toMatch(/propertyAddress:/);
    // The proved scenario travels too, so a matched series may still print
    // "Moderate" rather than being relabelled for no reason.
    expect(region, 'the proved scenario no longer travels with the payload')
      .toMatch(/scenario:\s*storedScenario/);
  });

  it('renders the scenario it proved, not a default one', () => {
    // The adapter picks one of three stored scenarios from `variant`, and
    // defaults to `moderate` when told nothing. Passing the matched scenario is
    // what stops a report whose on-screen series is the optimistic one being
    // typeset from the moderate one — same report, different figures.
    expect(code).toMatch(/tryTemplateDocument\(\s*'cashflow',[^)]*variant:\s*storedScenario/);
  });

  it('still says why, where the next person will look', () => {
    const request = readFileSync(join(LIB, 'requestCashFlowPdf.ts'), 'utf8');
    expect(request).toContain('Template Builder route');
    expect(request).toContain('manual_overrides');
  });
});
