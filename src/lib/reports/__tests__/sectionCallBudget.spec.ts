/**
 * Every model call in the section loop answers to the run's clock.
 *
 * Measured on the generation trace, 15 Sep 2026: the closing section
 * ("Risks & Recommendations", 4,000 tokens, a 68 KB prompt) took 40-110s
 * whenever it completed, against a fixed 60s call timeout — so the
 * full-prompt attempt timed out on every run, the compact retry ran in
 * whatever was left, and 43 invocations across two reports were killed by
 * the platform with no status written. The report sat at
 * "Section 12 of 12 · 10h 45m elapsed".
 *
 * These assertions are over the generator's source, because the loop runs
 * only against Perplexity and the platform clock. They pin the rule rather
 * than a number: a call is given the window the run can spare, a call with
 * no window is deferred as a hand-off rather than counted as a failure, and
 * the run's own hard stop sits inside the watchdog's inner timeout so the
 * two never disagree about whether a run is alive.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..', '..');
const GENERATOR = readFileSync(join(ROOT, 'supabase', 'functions', 'generate-investment-report', 'index.ts'), 'utf8');
const WATCHDOG = readFileSync(join(ROOT, 'supabase', 'functions', 'resume-investment-reports', 'index.ts'), 'utf8');

const constant = (src: string, name: string): number => {
  const m = new RegExp(`const ${name} = ([0-9_]+);`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return Number(m[1].replace(/_/g, ''));
};

describe('the section call budget', () => {
  it('the run\'s hard stop sits inside the watchdog\'s inner timeout and the platform ceiling', () => {
    const hardStop = constant(GENERATOR, 'SECTION_CALL_HARD_STOP_MS');
    const watchdogInner = constant(WATCHDOG, 'INNER_CALL_TIMEOUT_MS');
    expect(hardStop).toBeLessThan(watchdogInner);
    expect(hardStop).toBeLessThan(150_000);
    // Room after the hard stop for the progressive save and the response.
    expect(150_000 - hardStop).toBeGreaterThanOrEqual(15_000);
  });

  it('the full-prompt ceiling covers the closing section\'s measured latency, and the compact prompt keeps a reserve', () => {
    expect(constant(GENERATOR, 'SECTION_REQUEST_TIMEOUT_MS')).toBeGreaterThanOrEqual(90_000);
    expect(constant(GENERATOR, 'SECTION_FULL_PROMPT_MIN_WINDOW_MS')).toBe(60_000);
    expect(constant(GENERATOR, 'SECTION_SECOND_ATTEMPT_RESERVE_MS')).toBeGreaterThanOrEqual(30_000);
    expect(constant(GENERATOR, 'SECTION_EMERGENCY_TIMEOUT_MS')).toBeGreaterThanOrEqual(45_000);
  });

  it('every model call takes the window it can have, never the constant', () => {
    expect(GENERATOR).toContain('deadlineAt: number | null = null');
    expect(GENERATOR).toContain("}, attemptTimeoutMs, 'perplexity-api');");
    expect(GENERATOR).toContain("}, continuationWindowMs, 'perplexity-api');");
    expect(GENERATOR).not.toContain("}, SECTION_REQUEST_TIMEOUT_MS, 'perplexity-api');");
    expect(GENERATOR).not.toContain("}, SECTION_CONTINUATION_TIMEOUT_MS, 'perplexity-api');");
  });

  it('a full-prompt attempt that cannot get its measured floor goes straight to the compact prompt', () => {
    expect(GENERATOR).toContain('const useCompactPrompt = attempt > 1 || fullPromptWindowMs < SECTION_FULL_PROMPT_MIN_WINDOW_MS;');
    expect(GENERATOR).toContain('const fullPromptWindowMs = remainingMs - SECTION_SECOND_ATTEMPT_RESERVE_MS;');
  });

  it('the deadline is the run\'s clock less the post-processing reserve on the closing section', () => {
    expect(GENERATOR).toContain('const sectionDeadlineAt = runStartedAt + SECTION_CALL_HARD_STOP_MS');
    expect(GENERATOR).toContain('- (isLastSection ? POST_PROCESSING_RESERVE_MS : 0);');
    expect(GENERATOR).toContain('sectionDeadlineAt,\n        );');
  });

  it('no window is a deferral — a hand-off, never a failed section', () => {
    expect(GENERATOR).toContain("return { content: '', citations: [], error: SECTION_BUDGET_DEFERRED };");
    expect(GENERATOR).toContain('if (result.error === SECTION_BUDGET_DEFERRED) {');
    // The single-section answer for a deferral is the budget hand-off shape,
    // which the browser pump and the watchdog already treat as progress.
    const deferral = GENERATOR.slice(GENERATOR.indexOf('} else if (sectionDeferred && !bestContent) {'));
    const block = deferral.slice(0, deferral.indexOf('} else {'));
    expect(block).toContain('success: true,');
    expect(block).toContain('resumeRequired: true,');
    expect(block).toContain('deferred: true,');
    expect(block).not.toContain('error_message');
    expect(block).not.toContain("status: 'failed'");
  });

  it('a continuation never starts into a window it cannot finish in', () => {
    expect(GENERATOR).toContain('if (continuationWindowMs < 15_000) {');
  });
});
