/**
 * The Property Listing Scraper's model is a choice, and for a long time it was not.
 *
 * `scrape-property-listing` hardcoded `sonar-pro` behind a direct fetch to
 * api.perplexity.ai, deliberately bypassing `llmRouter` because the router's
 * native Perplexity caller dropped `response_format`. Two things followed, and
 * both were reported as one bug — "I changed the property scraper model in Model
 * Hub and it still shows a 502 for Perplexity":
 *
 *   1. `agent_model_assignments.listing_scrape` did nothing. The Model Hub row
 *      saved, the scrape ignored it.
 *   2. The agent's fallback chain never ran, so a Perplexity 502 failed the job
 *      outright — four in production on 2026-08-15, every one of them
 *      `Perplexity request failed with status 502` — while the Agent Bindings
 *      panel says "The fallback chain auto-engages on 404/410/5xx errors".
 *
 * The first block below unit-tests the failure/retry policy. The second is a
 * source contract, in the style of `llmUsageBinding.pure.spec.ts`'s drift guard:
 * these are Deno edge modules that reach `Deno.env` and a live provider, so what
 * is worth locking is the shape of the wiring, and the regression to fear is
 * someone reintroducing a hardcoded provider here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  describeScrapeFailure,
  shouldRetryWithoutSchema,
  type ScrapeModelAttempt,
} from '../../../supabase/functions/scrape-property-listing/scrapeFailure.pure';

const FN_DIR = resolve(__dirname, '../../../supabase/functions');
const SCRAPER_SRC = readFileSync(resolve(FN_DIR, 'scrape-property-listing/index.ts'), 'utf8');
const ROUTER_SRC = readFileSync(resolve(FN_DIR, '_shared/llmRouter.ts'), 'utf8');

const attempt = (over: Partial<ScrapeModelAttempt> = {}): ScrapeModelAttempt => ({
  route: 'openrouter', model_id: 'openai/gpt-5.6-sol', ok: false, ...over,
});

/** The chain as production had it the day this was reported. */
const PRODUCTION_502_CHAIN: ScrapeModelAttempt[] = [
  attempt({ route: 'openrouter', model_id: 'openai/gpt-5.6-sol', status: 502, error: 'provider_http_502' }),
  attempt({ route: 'gateway', model_id: 'google/gemini-3-flash-preview', status: 502, error: 'provider_http_502' }),
];

describe('describeScrapeFailure', () => {
  it('names every model tried and where to change it', () => {
    const message = describeScrapeFailure({ status: 503, attempts: PRODUCTION_502_CHAIN });
    // The old message was "Perplexity request failed with status 502" — a
    // provider the operator had already tried to move off, and no model at all.
    expect(message).toContain('openrouter/openai/gpt-5.6-sol (HTTP 502)');
    expect(message).toContain('gateway/google/gemini-3-flash-preview (HTTP 502)');
    expect(message).toContain('Model Hub → Agent Bindings → Property Listing Scraper');
    expect(message).toContain('all 2 models');
  });

  it('reports a credential or quota answer against the model that hit it', () => {
    // Another model cannot fix these, and the router stops the chain on them —
    // so "all N models failed" would be a lie and the advice would be wrong.
    expect(describeScrapeFailure({ status: 429, attempts: [attempt({ status: 429 })] }))
      .toBe('openrouter/openai/gpt-5.6-sol: the provider rate limit was hit (429). Wait a moment and try again.');
    expect(describeScrapeFailure({ status: 402, attempts: [attempt({ status: 402 })] }))
      .toContain('out of credit (402)');
    expect(describeScrapeFailure({ status: 401, attempts: [attempt({ status: 401 })] }))
      .toContain('rejected the API key (401)');
  });

  it('says so when no model was reached at all', () => {
    expect(describeScrapeFailure({ message: "Assignment 'listing_scrape' is disabled" }))
      .toContain('before any model was called');
    expect(describeScrapeFailure({})).toBe('Listing extraction failed before any model was called.');
  });

  it('leaks no provider body — only routes, model ids and status codes', () => {
    // A provider's error body is where a forwarded API key or an internal host
    // turns up. The router has already reduced it to a sanitised token.
    const message = describeScrapeFailure({
      status: 503,
      attempts: [attempt({ status: 502, error: 'provider_http_502' })],
      message: 'Bearer pplx-secret-key upstream connect error to 10.1.2.3:443',
    });
    expect(message).not.toContain('pplx-secret-key');
    expect(message).not.toContain('10.1.2.3');
  });

  it('uses singular wording for a one-model chain', () => {
    expect(describeScrapeFailure({ attempts: [attempt({ status: 500 })] })).toContain('all 1 model bound');
  });
});

describe('shouldRetryWithoutSchema', () => {
  it('retries when every model failed on something a simpler request could change', () => {
    // Perplexity answers `check-model-availability`'s two-token probe while
    // 502-ing this request, which differs mainly by a 62-property json_schema.
    expect(shouldRetryWithoutSchema(PRODUCTION_502_CHAIN)).toBe(true);
    expect(shouldRetryWithoutSchema([attempt({ status: 400 })])).toBe(true);
    expect(shouldRetryWithoutSchema([attempt({ status: 504, error: 'provider_timeout' })])).toBe(true);
    expect(shouldRetryWithoutSchema([attempt({ status: undefined, error: 'provider_error' })])).toBe(true);
  });

  it('does not spend a second billed call on a credential or quota answer', () => {
    for (const status of [401, 402, 403, 429]) {
      expect(shouldRetryWithoutSchema([attempt({ status: 502 }), attempt({ status })]), `status ${status}`).toBe(false);
    }
  });

  it('does not retry when there was nothing to retry', () => {
    expect(shouldRetryWithoutSchema([])).toBe(false);
    expect(shouldRetryWithoutSchema(undefined)).toBe(false);
  });
});

describe('scrape-property-listing routes through its Model Hub binding', () => {
  it('asks the router for the listing_scrape assignment', () => {
    expect(SCRAPER_SRC).toMatch(/callLLM\(\{/);
    expect(SCRAPER_SRC).toMatch(/agentKey:\s*LISTING_SCRAPE_AGENT_KEY/);
    expect(SCRAPER_SRC).toMatch(/LISTING_SCRAPE_AGENT_KEY\s*=\s*'listing_scrape'/);
  });

  it('names no model and calls no provider endpoint of its own for the extraction', () => {
    // The bug in one assertion: a model id written here is a model id the Model
    // Hub cannot change.
    expect(SCRAPER_SRC).not.toMatch(/model:\s*["']sonar/);
    expect(SCRAPER_SRC).not.toContain('api.perplexity.ai/chat/completions');
  });

  it('still reaches Perplexity Search for source text, which is a different concern', () => {
    // That call fetches the page's content when Firecrawl and reader mode fail;
    // it is not the extraction model and does not follow the binding.
    expect(SCRAPER_SRC).toContain('api.perplexity.ai/search');
  });

  it('bounds the model phase, which the direct fetch never did', () => {
    expect(SCRAPER_SRC).toMatch(/timeoutMs:\s*PER_MODEL_TIMEOUT_MS/);
    expect(SCRAPER_SRC).toMatch(/deadlineAt/);
  });

  it('does not meter the model call itself — the router does', () => {
    // Logging in both places bills the tenant twice, which
    // API_USAGE_METERING.md rates worse than not billing at all.
    expect(SCRAPER_SRC).not.toMatch(/logApiUsage\s*\(/);
    expect(SCRAPER_SRC).toMatch(/meterUserId/);
  });
});

describe('llmRouter carries what the bypass existed to preserve', () => {
  it('forwards response_format on the native Perplexity path', () => {
    // Dropping it is the entire stated reason the scraper bypassed the router.
    const perplexity = /async function callPerplexityNative[\s\S]*?\n}/.exec(ROUTER_SRC)?.[0] ?? '';
    expect(perplexity).toBeTruthy();
    expect(perplexity).toMatch(/body\.response_format = opts\.response_format/);
    expect(ROUTER_SRC).toMatch(/callPerplexityNative\(modelId, args\.messages, \{[^}]*response_format: args\.responseFormat/);
  });

  it('scopes provider extras to the provider that understands them', () => {
    // A flat pass-through would send Perplexity's `search_domain_filter` to the
    // gateway on fallback, turning the rescue attempt into a 400.
    expect(ROUTER_SRC).toMatch(/function providerExtrasFor/);
    expect(ROUTER_SRC).toMatch(/resolveLlmCredential\(route, modelId\)\?\.serviceName/);
  });

  it('never lets an extra redirect a request', () => {
    expect(ROUTER_SRC).toMatch(/RESERVED_BODY_KEYS = new Set\(\['model', 'messages', 'stream'\]\)/);
  });

  it('still treats 502 as retryable, which is what makes the fallback engage', () => {
    expect(ROUTER_SRC).toMatch(/RETRYABLE_STATUSES = new Set\(\[[^\]]*502/);
  });
});
