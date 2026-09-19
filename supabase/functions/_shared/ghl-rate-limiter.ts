/**
 * Shared cross-isolate / cross-function rate limiter for GoHighLevel tokens.
 *
 * Why this exists:
 *   GHL enforces a per-token rate limit (~100 req / 10s burst, plus a daily
 *   quota). Per-isolate in-memory throttles do NOT cooperate across:
 *     • multiple invocations of the same function (each new isolate)
 *     • different edge functions sharing the same token
 *   That means our nominal "8 req/s" can become 16+ req/s in practice and
 *   immediately trip a 429.
 *
 * The fix:
 *   A single Postgres row per token tracks the rolling-window count and
 *   any active cooldown. Every caller asks the DB "may I send a request
 *   now?" via the SECURITY DEFINER RPCs `ghl_rate_reserve` /
 *   `ghl_rate_note_429`. The DB serializes contention via row-level
 *   locking, so all callers truly cooperate.
 *
 * Public API:
 *   - reserveGhlSlot(supabase, tokenKey, opts)   → waits until a slot is granted
 *   - noteGhlRateLimitHit(supabase, tokenKey, ms)→ records a 429, forces global cooldown
 *   - ghlFetchShared(supabase, tokenKey, url, init, opts) → fully wrapped fetch
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { meteredFetch } from './meteredFetch.ts';

export interface RateLimitOptions {
  /** Max requests allowed per rolling window. Default: 6 */
  maxPerWindow?: number;
  /** Window length in ms. Default: 1000 (so 6 req/s). */
  windowMs?: number;
  /** Hard upper bound on how long we'll wait between attempts. Default: 30_000. */
  maxWaitMs?: number;
  /** Soft cap on total reserve attempts before giving up. Default: 30 (~5 min worst-case). */
  maxAttempts?: number;
}

const DEFAULTS: Required<RateLimitOptions> = {
  maxPerWindow: 6,
  windowMs: 1000,
  maxWaitMs: 30_000,
  maxAttempts: 30,
};

/**
 * Block until the DB grants this caller a slot. Returns the number of ms
 * spent waiting (useful for observability). Throws if the soft attempt
 * cap is exceeded — caller should treat that as "back off and try later".
 */
export async function reserveGhlSlot(
  supabase: SupabaseClient,
  tokenKey: string,
  opts: RateLimitOptions = {},
): Promise<number> {
  const cfg = { ...DEFAULTS, ...opts };
  const startedAt = Date.now();

  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    const { data, error } = await supabase.rpc('ghl_rate_reserve', {
      p_token_key: tokenKey,
      p_max_per_window: cfg.maxPerWindow,
      p_window_ms: cfg.windowMs,
    });

    if (error) {
      // If the limiter itself is sick, fail open after logging — a missed
      // slot is better than a hung worker.
      console.warn(`[ghl-rate-limiter] reserve RPC failed for ${tokenKey}: ${error.message}. Failing open.`);
      return Date.now() - startedAt;
    }

    const waitMs = Number(data ?? 0);
    if (waitMs <= 0) return Date.now() - startedAt;

    const sleep = Math.min(waitMs, cfg.maxWaitMs);
    await new Promise((r) => setTimeout(r, sleep));
  }

  throw new Error(`[ghl-rate-limiter] gave up reserving slot for ${tokenKey} after ${cfg.maxAttempts} attempts (~${Date.now() - startedAt}ms)`);
}

/**
 * Tell every caller of this token to back off for `cooldownMs`.
 * Call this immediately when GHL returns 429.
 */
export async function noteGhlRateLimitHit(
  supabase: SupabaseClient,
  tokenKey: string,
  cooldownMs: number,
): Promise<void> {
  const clamped = Math.max(500, Math.min(cooldownMs, 120_000));
  const { error } = await supabase.rpc('ghl_rate_note_429', {
    p_token_key: tokenKey,
    p_cooldown_ms: clamped,
  });
  if (error) {
    console.warn(`[ghl-rate-limiter] note_429 RPC failed for ${tokenKey}: ${error.message}`);
  }
}

/**
 * Stable identifier for a GHL token suitable for the rate-state table.
 * We deliberately do NOT store the raw token value — just an account label
 * + the token's last 12 chars so two different tokens for the same account
 * still get separate buckets.
 */
export function tokenKeyFor(account: 'legacy' | 'new', apiKey: string | undefined): string {
  if (!apiKey) return `ghl:${account}:missing`;
  return `ghl:${account}:${apiKey.slice(-12)}`;
}

export interface SharedFetchOptions extends RateLimitOptions {
  /** Max times to retry on 429 / 5xx. Default: 3 */
  maxRetries?: number;
  /** Default 429 cooldown when GHL doesn't send Retry-After. Default: 5_000 */
  default429CooldownMs?: number;
  /** Tag for log lines. */
  logTag?: string;
}

/**
 * One-stop fetch: reserve a shared slot, fire the request, honour Retry-After
 * on 429, broadcast cooldown to every other caller, retry with backoff — and
 * put the vendor bill on it.
 *
 * **The metering lives here because this is the chokepoint.** `ghl` is a mapped,
 * billable service (`GOHIGHLEVEL_API_KEY`, priced per request) and
 * `leadconnectorhq.com` is in `meteredFetch`'s host map, yet `api_usage_log`
 * held zero GHL rows: every caller reached the vendor through plain `fetch`,
 * so a workspace running on the prime's forwarded GoHighLevel key spent it for
 * free. Metering each call site instead would be the "remember to log" rule
 * `meteredFetch`'s own header says decays — and no current caller of this
 * function logs, so this cannot double-bill anything.
 *
 * A retried attempt is metered too, as an ERROR. That is what happened: GHL
 * received the request and refused it, the attempt consumed the token's quota,
 * and a 429 storm that leaves no trace is how a rate-limit problem stays
 * invisible. Only the attempt we return records `success`, so a call is
 * charged once and its failures are visible rather than billed.
 */
export async function ghlFetchShared(
  supabase: SupabaseClient,
  tokenKey: string,
  url: string,
  init: RequestInit,
  opts: SharedFetchOptions = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 3;
  const default429 = opts.default429CooldownMs ?? 5_000;
  const tag = opts.logTag ?? 'ghl-fetch';

  let attempt = 0;
  while (true) {
    await reserveGhlSlot(supabase, tokenKey, opts);
    const res = await meteredFetch(url, init, {
      feature: tag,
      metadata: { token_key: tokenKey, attempt: attempt + 1 },
    });
    if (res.status !== 429 && res.status < 500) return res;

    // Compute back-off
    let waitMs = 0;
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      if (retryAfter) {
        const asInt = Number(retryAfter);
        if (Number.isFinite(asInt)) waitMs = asInt * 1000;
        else {
          const dateMs = Date.parse(retryAfter);
          if (Number.isFinite(dateMs)) waitMs = Math.max(0, dateMs - Date.now());
        }
      }
      if (!waitMs) waitMs = default429;
      // Broadcast cooldown so every other caller stops slamming the token
      await noteGhlRateLimitHit(supabase, tokenKey, waitMs);
    } else {
      // 5xx — exponential backoff with jitter, but no global cooldown
      const base = 1000 * Math.pow(2, attempt);
      waitMs = Math.round(base * (0.75 + Math.random() * 0.5));
    }

    if (attempt >= maxRetries) {
      console.warn(`[${tag}] giving up after ${attempt + 1} attempts: status=${res.status}`);
      return res;
    }

    waitMs = Math.min(waitMs, opts.maxWaitMs ?? 30_000);
    try { await res.text(); } catch {}
    console.warn(`[${tag}] retry: status=${res.status} attempt=${attempt + 1}/${maxRetries} waiting=${waitMs}ms`);
    await new Promise((r) => setTimeout(r, waitMs));
    attempt++;
  }
}
