/**
 * The browser's live performer is thin on purpose — the value it adds over
 * calling the edge function directly is refusing early and normalising the
 * answer, so those are what is tested.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCatalogNode } from '../../catalog';
import type { PerformInput } from '../engine';
import { CATALOG } from '@/lib/workflow/catalog';
import { LIVE_CAPABLE } from '../performers';
import { createServerPerformer } from '../transport';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/lib/secureInvoke', () => ({ invokeSecureFunction: invoke }));

const inputFor = (type: string, config: Record<string, unknown> = {}): PerformInput => {
  const definition = getCatalogNode(type);
  if (!definition) throw new Error(`${type} is not in the catalog`);
  return {
    definition,
    node: { id: 'n1', type, position: { x: 0, y: 0 }, config },
    config,
    scope: {},
  };
};

describe('server performer', () => {
  beforeEach(() => invoke.mockReset());

  /**
   * Named by derivation rather than by hand. This test used to say
   * `resend.send_email`, which stopped being an example of an unrunnable step
   * the day Resend gained a request descriptor — the test then failed for the
   * good reason that coverage had grown, which is not a signal worth having.
   */
  it('refuses a step with no executor without calling the server', async () => {
    const unrunnable = CATALOG.find((n) => n.kind === 'action' && !LIVE_CAPABLE.has(n.id));
    if (!unrunnable) throw new Error('every action is runnable — retire this test');
    const outcome = await createServerPerformer()(inputFor(unrunnable.id));

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/no executor/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sends the resolved config, not the template', async () => {
    invoke.mockResolvedValue({ data: { status: 'succeeded', output: { status: 200 } }, error: null });

    await createServerPerformer()(
      inputFor('core.http', { url: 'https://example.test/hook', method: 'POST' }),
    );

    expect(invoke).toHaveBeenCalledWith('execute-workflow-step', {
      nodeType: 'core.http',
      config: { url: 'https://example.test/hook', method: 'POST' },
    });
  });

  it('passes the server outcome through', async () => {
    invoke.mockResolvedValue({
      data: { status: 'failed', output: { status: 500 }, error: 'The endpoint answered 500.' },
      error: null,
    });

    const outcome = await createServerPerformer()(inputFor('core.http', { url: 'https://example.test' }));

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBe('The endpoint answered 500.');
    expect(outcome.output).toEqual({ status: 500 });
  });

  it('treats a status it does not recognise as a failure', async () => {
    // A step that quietly reported success it did not have would be worse than
    // one that admits it does not know.
    invoke.mockResolvedValue({ data: { status: 'weird' }, error: null });

    const outcome = await createServerPerformer()(inputFor('core.http', { url: 'https://example.test' }));

    expect(outcome.status).toBe('failed');
  });

  it('reports a transport failure rather than throwing', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Authentication required' } });

    const outcome = await createServerPerformer()(inputFor('core.http', { url: 'https://example.test' }));

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBe('Authentication required');
  });
});

describe('locally handled steps', () => {
  beforeEach(() => invoke.mockReset());

  it('answers a webhook without calling the executor', async () => {
    // The endpoint's allow-list has no entry for this step, so sending it there
    // failed a live run over something that needs neither network nor secret.
    const outcome = await createServerPerformer()(
      inputFor('core.webhook_respond', { status: 201, body: { ok: true } }),
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.output).toEqual({ status: 201, body: { ok: true } });
    expect(invoke).not.toHaveBeenCalled();
  });
});
