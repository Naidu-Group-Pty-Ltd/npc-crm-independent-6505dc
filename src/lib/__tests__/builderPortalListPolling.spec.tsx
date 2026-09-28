import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Builder Portal's two list reads — Activated Properties and the inbox —
 * poll on an interval. A refusal (signed out, Listings access withdrawn, the
 * feature switched off) is final for this page: every later poll would be
 * refused too, and each 403 counts towards the client's authentication
 * breaker, which clears an otherwise valid session after a run of them. So a
 * refusal stops the poll, exactly as the conversation read already does, and
 * a transient failure keeps it going.
 */
const calls: string[] = [];
let answer: { data: unknown; error: unknown } = { data: null, error: null };
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: vi.fn(async (_name: string, body: { operation: string }) => {
    calls.push(body.operation);
    return answer;
  }),
}));

import { useBuilderPortalActivations, useMyBuilderConversations } from '../marketplaceBuilderStock';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function pollFor(ms: number) {
  for (let t = 0; t < ms; t += 5_000) {
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  }
}

describe('the Builder Portal list polls stop once access is refused', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    calls.length = 0;
  });
  afterEach(() => { vi.useRealTimers(); });

  const cases: Array<[string, string, () => unknown]> = [
    ['Activated Properties', 'list_builder_portal_activations', () => useBuilderPortalActivations()],
    ['the inbox', 'list_my_builder_conversations', () => useMyBuilderConversations()],
  ];

  for (const [label, operation, hook] of cases) {
    it(`${label}: a 403 is asked once and never polled again`, async () => {
      answer = { data: null, error: { message: 'Forbidden', status: 403 } };
      renderHook(hook, { wrapper: wrapper() });
      await pollFor(5 * 60_000);
      expect(calls.filter((c) => c === operation)).toHaveLength(1);
    });

    it(`${label}: the feature switched off stops the poll too`, async () => {
      answer = { data: { error: 'off', code: 'builder_stock_disabled' }, error: null };
      renderHook(hook, { wrapper: wrapper() });
      await pollFor(5 * 60_000);
      expect(calls.filter((c) => c === operation)).toHaveLength(1);
    });

    it(`${label}: a transient failure keeps polling`, async () => {
      answer = { data: null, error: { message: 'unavailable', status: 503 } };
      renderHook(hook, { wrapper: wrapper() });
      await pollFor(5 * 60_000);
      expect(calls.filter((c) => c === operation).length).toBeGreaterThan(2);
    });
  }
});
