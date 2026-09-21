/**
 * The signed-internal timestamp window, and why it is asymmetric.
 *
 * A signed internal request is minted by `cron_signed_internal_headers`, which
 * stamps `clock_timestamp()` — the wall clock at ENQUEUE — and hands the
 * request to `pg_net`, which delivers it from a background queue. The window
 * therefore has to cover the queue wait, which nothing in this codebase
 * bounds.
 *
 * Measured on the prime, 19-20 Sep 2026: 19 refusals in 24 hours, sporadic
 * rather than constant, arriving in tight clusters — four denials inside 27 ms
 * at 16:32:32, three inside 47 ms at 16:26:15. That is one pg_net batch
 * flushing after a stall. A wrong secret or a wrong unit refuses EVERY
 * request; a drifting clock does not arrive in batches.
 *
 * What it cost: `resume-investment-reports` is the watchdog that continues an
 * investment report after it hands off on its wall-clock budget. While it was
 * refused, a Compass — which hands off four times — only finished if somebody
 * had a browser tab open.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const REPO = resolve(__dirname, '../../../..');
const src = readFileSync(
  resolve(REPO, 'supabase/functions/_shared/auth_v2.ts'),
  'utf8',
);

const numberOf = (name: string): number => {
  const m = src.match(new RegExp(`const ${name} = (\\d+);`));
  if (!m) throw new Error(`${name} is not declared as a plain number`);
  return Number(m[1]);
};

describe('the internal timestamp window is asymmetric, and says which way', () => {
  it('tolerates a LATE stamp far more than an early one', () => {
    const past = numberOf('INTERNAL_SKEW_PAST_SECONDS');
    const future = numberOf('INTERNAL_SKEW_FUTURE_SECONDS');
    expect(past).toBeGreaterThan(future);
  });

  it('keeps the future side tight, because nothing legitimate is ahead of us', () => {
    // A stamp from the future is a clock anomaly or a forgery. Widening this
    // side buys nothing and loses the one direction that carries a signal.
    expect(numberOf('INTERNAL_SKEW_FUTURE_SECONDS')).toBeLessThanOrEqual(90);
  });

  it('covers a pg_net batch stall on the past side, and stays bounded', () => {
    const past = numberOf('INTERNAL_SKEW_PAST_SECONDS');
    expect(past).toBeGreaterThanOrEqual(600);
    expect(past).toBeLessThanOrEqual(3600);
  });

  it('checks the two directions separately rather than on an absolute value', () => {
    // `Math.abs(now - ts) > N` is what made the window symmetric, and it is
    // the shape this test exists to keep out.
    expect(src).not.toMatch(/Math\.abs\(now - ts\)/);
    expect(src).toMatch(/skew > INTERNAL_SKEW_PAST_SECONDS/);
    expect(src).toMatch(/skew < -INTERNAL_SKEW_FUTURE_SECONDS/);
  });

  it('logs the measured delta, because the word alone cannot be diagnosed', () => {
    // Queue latency, a drifting clock and a wrong unit all present as
    // `internal_timestamp_skew`. Only the number tells them apart.
    const refusal = src.slice(
      src.indexOf('internal timestamp outside the accepted window'),
      src.indexOf("errorCode: 'internal_timestamp_skew'"),
    );
    expect(refusal).toContain('skewSeconds');
    expect(refusal).toContain('direction');
    expect(refusal).toContain('caller');
  });

  it('still bounds the memory-nonce sweep by the wider side', () => {
    // The in-memory fallback must not evict a nonce while a signature
    // carrying it is still inside the accepted window.
    expect(src).toMatch(/INTERNAL_SKEW_SECONDS = INTERNAL_SKEW_PAST_SECONDS/);
  });
});

describe('the nonce, not the clock, is what stops a replay', () => {
  it('inserts the nonce into a durable table and treats 23505 as a replay', () => {
    expect(src).toContain("from('internal_request_nonces')");
    expect(src).toContain("'23505'");
    expect(src).toMatch(/errorCode: 'internal_replay'/);
  });
});
