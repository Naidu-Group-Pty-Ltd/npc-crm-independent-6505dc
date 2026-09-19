/**
 * An optional section that is absent is not a defect. A typo is.
 *
 * `evalConditional` rejects any expression naming something the data does not
 * bind, and must keep doing so: an unbound name resolves against the global
 * scope, which is what the allow-list exists to stop. But it reported the
 * *designed* path as a warning.
 *
 * The Borrowing Capacity masters guard three optional namespaces —
 * `explanation`, `audit` and `scenarios`. `explanation` and `audit_trail` are
 * columns written only by calculator runs since the keep-update, so 127 of the
 * 128 stored assessments do not carry them, and `scenarios` has no stored
 * producer at all. Those pages are meant to stay dark, and the guards in the
 * masters say so. Every render of every one of those masters logged three
 * "Rejected expression referencing unbound name" warnings — which is the noise a
 * genuine typo would hide in, and the typo is the case the check exists for.
 *
 * The rejection is unchanged. Only the reporting is.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { evalConditional } from '../bindingResolver';

const ctx = (data: Record<string, unknown>) => ({
  data,
  tokens: { colors: {}, fonts: {}, spacing: {} },
}) as never;

afterEach(() => vi.restoreAllMocks());

describe('conditional gating is unchanged', () => {
  it('is false when a guarded namespace is absent', () => {
    expect(evalConditional('explanation && explanation.steps', ctx({ capacity: {} }))).toBe(false);
    expect(evalConditional('audit && audit.rows', ctx({ capacity: {} }))).toBe(false);
  });

  it('is true when the guarded namespace is present', () => {
    const data = { explanation: { steps: [{ title: 'a' }] } };
    expect(evalConditional('explanation && explanation.steps', ctx(data))).toBe(true);
    expect(evalConditional(
      'explanation && explanation.steps && explanation.steps.length > 5',
      ctx({ explanation: { steps: Array.from({ length: 8 }, () => ({})) } }),
    )).toBe(true);
  });

  it('still refuses a name that would reach the global scope', () => {
    // The security case. `window` is all word characters and passes the
    // character whitelist; only the name allow-list stops it.
    expect(evalConditional('window && window.location', ctx({}))).toBe(false);
    expect(evalConditional('globalThis', ctx({}))).toBe(false);
  });
});

describe('what gets reported', () => {
  it('says nothing when the author guarded the absent namespace', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    evalConditional('explanation && explanation.steps', ctx({ capacity: {} }));
    evalConditional('scenarios && scenarios.rows', ctx({ capacity: {} }));
    evalConditional('audit && audit.rows && audit.rows.length > 7', ctx({ capacity: {} }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('still warns when an unguarded name is referenced', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Dereferenced without ever being tested — the shape of a typo that is
    // meant to be loud.
    evalConditional('explanation.steps.length > 0', ctx({ capacity: {} }));
    expect(warn).toHaveBeenCalled();
  });

  it('warns when only some of the unbound names are guarded', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    evalConditional('explanation && explanation.steps && audit.rows', ctx({ capacity: {} }));
    expect(warn).toHaveBeenCalled();
  });
});
