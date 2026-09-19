/**
 * Shared GHL fetch helper for migration workers.
 *
 * Wraps `ghlFetchShared` (the cross-isolate DB-backed limiter) with the
 * same circuit-breaker pattern the contacts worker pioneered, so every
 * migration worker (contacts, opportunities, conversations, notes) speaks
 * to GHL with identical pacing and back-off semantics.
 *
 * Usage:
 *   const ctx = createGhlFetchContext({
 *     supabase, sourceTokenKey, targetTokenKey, logTag: 'opps-worker',
 *   });
 *   const res = await ctx.ghlFetch(url, init, 3, 'target');
 *   if (ctx.isCircuitTripped()) { partialExit(...); return; }
 *
 * Why a context object instead of module-level state?
 *   Edge isolates are reused across invocations. Module-level vars from a
 *   prior request (e.g. a tripped breaker) would leak into the next job.
 *   A per-invocation context guarantees clean isolation.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { ghlFetchShared, noteGhlRateLimitHit } from './ghl-rate-limiter.ts';

// GHL documented burst is ~10 req/s (100 req / 10s window). 8/s is the
// pragmatic ceiling — leaves headroom for webhook + cron callers using
// the same token.
export const GHL_PER_TOKEN_RATE_PER_SEC = 8;
export const GHL_PER_TOKEN_WINDOW_MS = 1_000;
export const GHL_CIRCUIT_BREAKER_THRESHOLD = 3;
export const GHL_CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

export interface GhlFetchContextOptions {
  supabase: SupabaseClient;
  sourceTokenKey: string;
  targetTokenKey: string;
  /** Used as the prefix in log lines, e.g. "opps-worker". */
  logTag: string;
  /** Override the per-token rolling-window budget. Default 8 req/s. */
  ratePerSec?: number;
  /** Override how many consecutive 429s trip the breaker. Default 3. */
  circuitThreshold?: number;
  /** Override the global cooldown broadcast on trip. Default 30 s. */
  circuitCooldownMs?: number;
}

export interface GhlFetchContext {
  ghlFetch: (
    url: string,
    init: RequestInit,
    maxRetries?: number,
    bucket?: 'source' | 'target',
  ) => Promise<Response>;
  isCircuitTripped: () => boolean;
  resetCircuitBreaker: () => void;
  /** Read-only count of consecutive 429s observed. Useful for diagnostics. */
  getConsecutive429s: () => number;
}

export function createGhlFetchContext(opts: GhlFetchContextOptions): GhlFetchContext {
  const ratePerSec = opts.ratePerSec ?? GHL_PER_TOKEN_RATE_PER_SEC;
  const threshold = opts.circuitThreshold ?? GHL_CIRCUIT_BREAKER_THRESHOLD;
  const cooldownMs = opts.circuitCooldownMs ?? GHL_CIRCUIT_BREAKER_COOLDOWN_MS;

  let consecutive429s = 0;
  let circuitTripped = false;

  async function ghlFetch(
    url: string,
    init: RequestInit,
    maxRetries = 3,
    bucket: 'source' | 'target' = 'target',
  ): Promise<Response> {
    if (circuitTripped) {
      console.warn(`[${opts.logTag}] circuit breaker OPEN — refusing call to ${url.substring(0, 80)}`);
      return new Response(JSON.stringify({ error: 'circuit_breaker_open' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const tokenKey = bucket === 'source' ? opts.sourceTokenKey : opts.targetTokenKey;
    const res = await ghlFetchShared(opts.supabase, tokenKey, url, init, {
      maxPerWindow: ratePerSec,
      windowMs: GHL_PER_TOKEN_WINDOW_MS,
      maxRetries,
      default429CooldownMs: 5_000,
      logTag: `${opts.logTag}:${bucket}`,
    });

    if (res.status === 429) {
      consecutive429s++;
      if (consecutive429s >= threshold) {
        circuitTripped = true;
        console.error(
          `[${opts.logTag}] CIRCUIT BREAKER TRIPPED after ${consecutive429s} consecutive 429s — broadcasting ${cooldownMs}ms global cooldown on ${bucket}`,
        );
        try {
          await noteGhlRateLimitHit(opts.supabase, tokenKey, cooldownMs);
        } catch {
          /* fail open */
        }
      }
    } else if (res.status < 400) {
      consecutive429s = 0;
    }
    return res;
  }

  return {
    ghlFetch,
    isCircuitTripped: () => circuitTripped,
    resetCircuitBreaker: () => {
      consecutive429s = 0;
      circuitTripped = false;
    },
    getConsecutive429s: () => consecutive429s,
  };
}
