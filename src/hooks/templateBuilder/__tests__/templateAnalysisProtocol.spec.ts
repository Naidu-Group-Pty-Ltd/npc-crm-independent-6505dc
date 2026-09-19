/**
 * Rehaul Phase 3 — analysis worker wire protocol.
 *
 * Invariants:
 * - a request to a fresh worker ships every page in full,
 * - subsequent requests ship only changed pages (stubs otherwise),
 * - the worker reassembles a document equal to the original,
 * - desync (worker missing a stubbed page) is detected, and a full resend
 *   always assembles,
 * - sample data travels only when changed.
 */
import { describe, expect, it } from 'vitest';
import {
  assembleAnalysisInput,
  buildAnalysisRequest,
  createAnalysisWorkerState,
  createWorkerKnownState,
  rememberAnalysisRequest,
} from '../templateAnalysisProtocol';
import { makeBlankTemplate, type Page, type ReportTemplate } from '@/lib/reportTemplate/templateSchema';

const pg = (id: string, text: string): Page =>
  ({
    id,
    name: `Page ${id}`,
    size: { width: 595, height: 842 },
    blocks: [{ id: `${id}-b`, type: 'text', props: { content: text }, overlays: [] }],
  }) as unknown as Page;

const makeDoc = (): ReportTemplate => ({
  ...makeBlankTemplate(),
  pages: [pg('p1', 'one'), pg('p2', 'two'), pg('p3', 'three')],
});

const data = { a: 1 };

describe('templateAnalysisProtocol', () => {
  it('ships full payloads to a fresh worker and reassembles the document', () => {
    const doc = makeDoc();
    const known = createWorkerKnownState();
    const request = buildAnalysisRequest(1, doc, data, known);

    expect(request.pages.every((p) => p.page !== undefined)).toBe(true);
    expect(request.sampleData).toEqual(data);

    const worker = createAnalysisWorkerState();
    const input = assembleAnalysisInput(worker, request);
    expect(input).not.toBeNull();
    expect(input!.template).toEqual(doc);
    expect(input!.sampleData).toEqual(data);
  });

  it('ships only the changed page on subsequent requests', () => {
    const doc = makeDoc();
    const known = createWorkerKnownState();
    const worker = createAnalysisWorkerState();

    const first = buildAnalysisRequest(1, doc, data, known);
    rememberAnalysisRequest(first, known);
    assembleAnalysisInput(worker, first);

    const edited: ReportTemplate = {
      ...doc,
      pages: doc.pages.map((p) => (p.id === 'p2' ? pg('p2', 'two EDITED') : p)),
    };
    const second = buildAnalysisRequest(2, edited, data, known);
    const fullPayloads = second.pages.filter((p) => p.page !== undefined);
    expect(fullPayloads.map((p) => p.id)).toEqual(['p2']);
    // Sample data unchanged — not retransmitted.
    expect(second.sampleData).toBeUndefined();

    const input = assembleAnalysisInput(worker, second);
    expect(input).not.toBeNull();
    expect(input!.template).toEqual(edited);
    expect(input!.sampleData).toEqual(data);
  });

  it('retransmits sample data only when it changes', () => {
    const doc = makeDoc();
    const known = createWorkerKnownState();
    const first = buildAnalysisRequest(1, doc, data, known);
    rememberAnalysisRequest(first, known);

    const sameData = buildAnalysisRequest(2, doc, { a: 1 }, known);
    expect(sameData.sampleData).toBeUndefined();

    const newData = buildAnalysisRequest(3, doc, { a: 2 }, known);
    expect(newData.sampleData).toEqual({ a: 2 });
  });

  it('detects desync (stub for a page the worker lacks) and recovers via full resend', () => {
    const doc = makeDoc();
    const known = createWorkerKnownState();
    const first = buildAnalysisRequest(1, doc, data, known);
    rememberAnalysisRequest(first, known);

    // Simulate a restarted worker that never saw the first request.
    const freshWorker = createAnalysisWorkerState();
    const second = buildAnalysisRequest(2, doc, data, known);
    expect(assembleAnalysisInput(freshWorker, second)).toBeNull();

    // Recovery path: reset known state → full payloads → always assembles.
    const resetKnown = createWorkerKnownState();
    const retry = buildAnalysisRequest(2, doc, data, resetKnown);
    expect(retry.pages.every((p) => p.page !== undefined)).toBe(true);
    const input = assembleAnalysisInput(freshWorker, retry);
    expect(input).not.toBeNull();
    expect(input!.template).toEqual(doc);
  });

  it('prunes deleted pages from the worker state', () => {
    const doc = makeDoc();
    const known = createWorkerKnownState();
    const worker = createAnalysisWorkerState();
    const first = buildAnalysisRequest(1, doc, data, known);
    rememberAnalysisRequest(first, known);
    assembleAnalysisInput(worker, first);
    expect(worker.pages.size).toBe(3);

    const shrunk: ReportTemplate = { ...doc, pages: doc.pages.filter((p) => p.id !== 'p3') };
    const second = buildAnalysisRequest(2, shrunk, data, known);
    rememberAnalysisRequest(second, known);
    const input = assembleAnalysisInput(worker, second);
    expect(input!.template).toEqual(shrunk);
    expect(worker.pages.size).toBe(2);
  });
});
