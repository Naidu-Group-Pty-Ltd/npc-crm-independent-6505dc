import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * RS-5c.5b — the Report Q&A structured write-up is not a templated document.
 *
 * Measured through the browser journey (14 Sep 2026, Chancery `ae7734d5`): a
 * conversation holding a 5,460-character `structured_report` came out of the
 * templated path as a cover, "The question" with the note "This document
 * carries 0 of 4 exchanges; 4 are not shown", the sources page and the back
 * cover — a finished-looking shell with the write-up nowhere in it. The
 * projection never publishes `structured_report` (by design) and no master
 * binds it, so routing the subject to a template cannot produce the document.
 * The templated path declines and the delivery falls through to the route
 * that draws the write-up.
 */
const conversation = {
  id: 'conv-1', title: 'Q&A: fixture', report_names: ['fixture.pdf'],
  structured_report: '# Write-up\n\nA stored structured report.', created_at: '2026-09-01T00:00:00Z',
};
const messages = [
  { id: 'm1', role: 'user', content: 'Q?', created_at: '2026-09-01T00:00:01Z' },
  { id: 'm2', role: 'assistant', content: 'A.', created_at: '2026-09-01T00:00:02Z' },
];

function builder(table: string) {
  const result = table === 'report_qa_messages'
    ? { data: messages, count: messages.filter((m) => m.role === 'assistant').length, error: null }
    : { data: [conversation], count: 1, error: null };
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'in', 'limit']) b[m] = () => b;
  b.maybeSingle = () => Promise.resolve({ data: conversation, error: null });
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return b;
}
vi.mock('@/hooks/useAuthenticatedSupabase', () => ({
  getAuthenticatedSupabaseClient: () => ({ from: (table: string) => builder(table) }),
}));

const { qaAdapter } = await import('../adapters/qaAdapter');

describe('the structured write-up is not a templated document', () => {
  it('declines to route the structured subject even when a write-up is stored', async () => {
    const routing = await qaAdapter.resolveRoutingContext({ reportId: 'conv-1', variant: 'structured' });
    expect(routing).toBeNull();
  });

  it('still routes the transcript and a single answer', async () => {
    const transcript = await qaAdapter.resolveRoutingContext({ reportId: 'conv-1', variant: 'transcript' });
    expect(transcript?.variant).toBe('transcript');
    const answer = await qaAdapter.resolveRoutingContext({ reportId: 'conv-1', variant: 'answer' });
    expect(answer?.variant).toBe('answer');
  });

  it('holds exactly while no master binds the write-up', () => {
    // The day the composer gives the structured report a page of its own, this
    // fails on purpose: the refusal in `resolveRoutingContext` is then the line
    // to remove, not this test.
    const composer = readFileSync(resolve(__dirname, '../../../../scripts/template-library/investmentCompass/reportQa.ts'), 'utf8');
    expect(composer).not.toMatch(/qa\.structured|structured_report|structuredReport/);
    const projection = readFileSync(resolve(__dirname, '../../../../supabase/functions/_shared/reportQaProjection.pure.ts'), 'utf8');
    expect(projection).toMatch(/What it deliberately does not publish/);
  });
});
