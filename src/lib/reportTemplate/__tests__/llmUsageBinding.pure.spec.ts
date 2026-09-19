/**
 * Which credential a model call spent — the billing contract.
 *
 * `api_usage_log` is drained into Mission Control and recharged to the tenant,
 * so two failures matter more than a missing row: a row naming the WRONG
 * credential bills the wrong tenant, and a service name the map does not know is
 * metered and never billed. Both are locked here.
 *
 * The last describe block is a drift guard: `llmRouter.callRoute` picks a
 * provider from a hardcoded `if` chain, and this module mirrors it. If someone
 * teaches the router a new model family and not the resolver, that family's
 * calls silently stop being billed — so the test reads the router's own source
 * and fails on the difference.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveLlmCredential,
  extractUsageTokens,
  resolveModelUsed,
  CLAUDE_RECONSTRUCT_BINDING,
} from '../../../../supabase/functions/_shared/llmUsageBinding.pure';

const ROUTER_SRC = resolve(__dirname, '../../../../supabase/functions/_shared/llmRouter.ts');

describe('resolveLlmCredential', () => {
  it('maps the gateway route to the Lovable key', () => {
    // The gateway bills LOVABLE_API_KEY whatever model it proxies — the model
    // name says nothing about which credential was spent.
    expect(resolveLlmCredential('gateway', 'gpt-5.2')).toEqual({
      serviceName: 'lovable-ai-gateway', secretName: 'LOVABLE_API_KEY',
    });
    expect(resolveLlmCredential('gateway', 'claude-opus-4-8')?.secretName).toBe('LOVABLE_API_KEY');
  });

  it('maps the openrouter route to the OpenRouter key', () => {
    expect(resolveLlmCredential('openrouter', 'anything/at-all')).toEqual({
      serviceName: 'openrouter', secretName: 'OPENROUTER_API_KEY',
    });
  });

  it.each([
    ['gpt-4o', 'openai', 'OPENAI_API_KEY'],
    ['o3-mini', 'openai', 'OPENAI_API_KEY'],
    ['chatgpt-4o-latest', 'openai', 'OPENAI_API_KEY'],
    ['claude-opus-4-8', 'anthropic', 'ANTHROPIC_API_KEY'],
    ['gemini-2.5-pro', 'gemini', 'GEMINI_API_KEY'],
    ['sonar-pro', 'perplexity', 'PERPLEXITY_API_KEY'],
  ])('routes native %s to %s', (model, serviceName, secretName) => {
    expect(resolveLlmCredential('native', model)).toEqual({ serviceName, secretName });
  });

  it('returns null rather than guessing an unknown family', () => {
    // A plausible-looking guess here recharges the wrong tenant. The caller
    // logs nothing and warns instead, which is visible and fixable.
    expect(resolveLlmCredential('native', 'llama-3-70b')).toBeNull();
    expect(resolveLlmCredential('native', 'mistral-large')).toBeNull();
    expect(resolveLlmCredential('native', '')).toBeNull();
    expect(resolveLlmCredential('native', null)).toBeNull();
    expect(resolveLlmCredential('made-up-route', 'gpt-4o')).toBeNull();
    expect(resolveLlmCredential(null, null)).toBeNull();
  });

  it('names the credential claudeReconstruct always spends', () => {
    // That adapter never goes through the router, so it has no route to resolve.
    expect(CLAUDE_RECONSTRUCT_BINDING).toEqual({
      serviceName: 'anthropic', secretName: 'ANTHROPIC_API_KEY',
    });
  });
});

describe('extractUsageTokens', () => {
  it('reads the OpenAI-compatible shape', () => {
    expect(extractUsageTokens({ usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } }))
      .toEqual({ promptTokens: 120, completionTokens: 30, totalTokens: 150 });
  });

  it('reads the Anthropic shape', () => {
    // `toOpenAIShape` passes Anthropic's usage object through untouched, so both
    // shapes reach the logger and both have to be understood here.
    expect(extractUsageTokens({ usage: { input_tokens: 200, output_tokens: 50 } }))
      .toEqual({ promptTokens: 200, completionTokens: 50, totalTokens: 250 });
  });

  it('counts cached prompt tokens towards the prompt total', () => {
    // They are billed at a different RATE — that is the rate card's job — but
    // they were consumed, and a ledger that drops them under-reports real cost.
    expect(extractUsageTokens({
      usage: { input_tokens: 10, cache_creation_input_tokens: 400, cache_read_input_tokens: 1_000, output_tokens: 25 },
    })).toEqual({ promptTokens: 1_410, completionTokens: 25, totalTokens: 1_435 });
  });

  it('prefers a provider-reported total over the sum', () => {
    expect(extractUsageTokens({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 99 } })?.totalTokens)
      .toBe(99);
  });

  it('returns null when there is no usable usage, so no quantity is invented', () => {
    for (const raw of [null, undefined, {}, { usage: null }, { usage: 'nope' }, { usage: {} },
      { usage: { prompt_tokens: 0, completion_tokens: 0 } }]) {
      expect(extractUsageTokens(raw as never)).toBeNull();
    }
  });

  it('ignores negative and non-numeric counts', () => {
    expect(extractUsageTokens({ usage: { prompt_tokens: -5, completion_tokens: 'x', total_tokens: 7 } }))
      .toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 7 });
  });
});

describe('resolveModelUsed', () => {
  it('prefers the model the provider echoed back', () => {
    expect(resolveModelUsed({ model: 'claude-opus-4-8-20260101' }, 'claude-opus-4-8'))
      .toBe('claude-opus-4-8-20260101');
  });

  it('falls back to the requested model', () => {
    expect(resolveModelUsed({}, 'gpt-4o')).toBe('gpt-4o');
    expect(resolveModelUsed(null, 'gpt-4o')).toBe('gpt-4o');
    expect(resolveModelUsed({ model: '   ' }, 'gpt-4o')).toBe('gpt-4o');
    expect(resolveModelUsed(null, null)).toBe('');
  });
});

describe('drift guard — the resolver must mirror llmRouter.callRoute', () => {
  const src = readFileSync(ROUTER_SRC, 'utf8');

  it('resolves every native model prefix the router dispatches on', () => {
    // Every `modelId.startsWith('X')` in the router's native chain is a family
    // it can call. One this module does not know is a family billed to nobody.
    const prefixes = [...src.matchAll(/modelId\.startsWith\('([^']+)'\)/g)].map((m) => m[1]);
    expect(prefixes.length).toBeGreaterThan(0);
    for (const prefix of prefixes) {
      expect(resolveLlmCredential('native', `${prefix}test-model`), `native prefix ${prefix}`).not.toBeNull();
    }
  });

  it('covers every route the router declares', () => {
    const declared = /export type LLMRoute = ([^;]+);/.exec(src)?.[1] ?? '';
    const routes = [...declared.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(routes.sort()).toEqual(['gateway', 'native', 'openrouter']);
    // gateway/openrouter resolve without a model; native is covered above.
    expect(resolveLlmCredential('gateway', '')).not.toBeNull();
    expect(resolveLlmCredential('openrouter', '')).not.toBeNull();
  });

  it('meters by default — an omitted flag must not mean unbilled', () => {
    // The whole liability was silence. `meterUsage` is opt-OUT by design.
    expect(src).toMatch(/args\.meterUsage !== false/);
  });
});
