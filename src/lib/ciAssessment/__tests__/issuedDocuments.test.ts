/**
 * The documents an assessment has issued, read from both report ledgers.
 *
 * A Capacity Report drawn through a report template is recorded in
 * `template_render_jobs`, not the C&I ledger, and every reader of the C&I
 * ledger alone missed it. These pin the one reader that serves both: what each
 * ledger row becomes, which client a document belongs to (the one linked when
 * it was drawn, not the one linked now), and where its bytes are.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ABANDONED_RENDER_AFTER_MS,
} from '../assessmentDeletion';
import {
  CAPACITY_REPORT_BUCKET, DID_NOT_FINISH_AFTER_MS, TEMPLATE_DOCUMENT_BUCKET,
  clientLinkedAt, documentFacts, documentRouteLabel, documentState, documentStorage,
  documentsForClient, projectIssuedDocuments, templateJobAssessmentId,
  type CapacityRenderRow, type ClientLinkRow, type TemplateJobRow,
} from '../issuedDocuments';

const NOW = Date.parse('2026-09-23T10:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const A1 = '11111111-1111-4111-8111-111111111111';
const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function render(over: Partial<CapacityRenderRow> = {}): CapacityRenderRow {
  return {
    id: 'r1', assessment_id: A1, status: 'succeeded', file_name: 'Commercial_Capacity_Report_CI-1_2026-09-23.pdf',
    storage_bucket: 'client-files', storage_path: `commercial-capacity/${A1}/2026-09-23/x-file.pdf`,
    bytes: 120_000, page_count: 9, has_analysis: true, analysis_note: null, error: null,
    created_at: minutesAgo(30), ...over,
  };
}

function job(over: Partial<TemplateJobRow> = {}): TemplateJobRow {
  return {
    id: 'j1', status: 'succeeded', file_name: 'commercial_capacity-CI-1-11111111.pdf',
    storage_path: 'template-builder/2026-09-23/y-file.pdf', bytes: 90_000, page_count: 7,
    template_name: 'Harbour · Slate', error: null, created_at: minutesAgo(10), requested_by: 'u1',
    metadata: { report_id: A1, html_bytes: 1000 }, ...over,
  };
}

function link(over: Partial<ClientLinkRow> = {}): ClientLinkRow {
  return { assessment_id: A1, client_id: CLIENT_A, linked_at: minutesAgo(120), unlinked_at: null, ...over };
}

describe('what a ledger status means to a reader', () => {
  it('reads succeeded as ready and failed as failed', () => {
    expect(documentState('succeeded', minutesAgo(1), NOW)).toBe('ready');
    expect(documentState('failed', minutesAgo(1), NOW)).toBe('failed');
  });

  it('reads a running or pending row as in progress until the delete rule calls it abandoned', () => {
    expect(documentState('running', minutesAgo(2), NOW)).toBe('in_progress');
    expect(documentState('pending', minutesAgo(2), NOW)).toBe('in_progress');
    expect(documentState('running', minutesAgo(16), NOW)).toBe('did_not_finish');
  });

  it('uses the delete rule’s own window, so the two screens cannot disagree', () => {
    expect(DID_NOT_FINISH_AFTER_MS).toBe(ABANDONED_RENDER_AFTER_MS);
  });

  it('reads an unreadable start time as still going, and an unknown status as a failure', () => {
    expect(documentState('running', 'not a date', NOW)).toBe('in_progress');
    expect(documentState('mystery', minutesAgo(1), NOW)).toBe('failed');
  });
});

describe('which client a document belongs to', () => {
  it('is the client linked when it was drawn', () => {
    expect(clientLinkedAt([link()], A1, minutesAgo(30))).toBe(CLIENT_A);
  });

  it('is nobody for a document drawn before the first link', () => {
    expect(clientLinkedAt([link({ linked_at: minutesAgo(20) })], A1, minutesAgo(30))).toBeNull();
  });

  it('does not follow a relink: the earlier document stays with the earlier client', () => {
    const history = [
      link({ client_id: CLIENT_A, linked_at: minutesAgo(120), unlinked_at: minutesAgo(40) }),
      link({ client_id: CLIENT_B, linked_at: minutesAgo(40) }),
    ];
    expect(clientLinkedAt(history, A1, minutesAgo(60))).toBe(CLIENT_A);
    expect(clientLinkedAt(history, A1, minutesAgo(5))).toBe(CLIENT_B);
  });

  it('is nobody while the assessment was unlinked', () => {
    const history = [link({ unlinked_at: minutesAgo(50) })];
    expect(clientLinkedAt(history, A1, minutesAgo(30))).toBeNull();
  });

  it('takes the later of two links left open by an old relink', () => {
    const history = [
      link({ client_id: CLIENT_A, linked_at: minutesAgo(120) }),
      link({ client_id: CLIENT_B, linked_at: minutesAgo(90) }),
    ];
    expect(clientLinkedAt(history, A1, minutesAgo(30))).toBe(CLIENT_B);
  });

  it('ignores another assessment’s links', () => {
    expect(clientLinkedAt([link({ assessment_id: 'other' })], A1, minutesAgo(30))).toBeNull();
  });
});

describe('both ledgers as one list', () => {
  it('merges the two routes, newest first', () => {
    const docs = projectIssuedDocuments({ renders: [render()], templateJobs: [job()], links: [link()], now: NOW });
    expect(docs.map((d) => `${d.ledger}:${d.id}`)).toEqual(['template:j1', 'capacity_report:r1']);
    expect(docs.every((d) => d.assessmentId === A1 && d.clientId === CLIENT_A)).toBe(true);
  });

  it('says what each route knows, and nothing it does not', () => {
    const [templated, standard] = projectIssuedDocuments({
      renders: [render({ has_analysis: false, analysis_note: 'The model was unavailable.' })],
      templateJobs: [job()], links: [], now: NOW,
    });
    expect(standard).toMatchObject({ hasAnalysis: false, analysisNote: 'The model was unavailable.', templateName: null });
    expect(templated).toMatchObject({ hasAnalysis: null, analysisNote: null, templateName: 'Harbour · Slate' });
  });

  it('leaves out a template job that names no assessment', () => {
    const docs = projectIssuedDocuments({
      renders: [], templateJobs: [job({ metadata: { failed_before_render: true } })], links: [], now: NOW,
    });
    expect(docs).toEqual([]);
    expect(templateJobAssessmentId({ metadata: null })).toBeNull();
  });

  it('offers a download only for a finished document with a stored file', () => {
    const docs = projectIssuedDocuments({
      renders: [
        render({ id: 'ok' }),
        render({ id: 'failed', status: 'failed', error: 'storage upload failed: quota' }),
        render({ id: 'nopath', storage_path: null }),
        render({ id: 'stuck', status: 'running', created_at: minutesAgo(40) }),
      ],
      templateJobs: [], links: [], now: NOW,
    });
    const byId = Object.fromEntries(docs.map((d) => [d.id, d]));
    expect(byId.ok.downloadable).toBe(true);
    expect(byId.failed).toMatchObject({ state: 'failed', downloadable: false, error: 'storage upload failed: quota' });
    expect(byId.nopath.downloadable).toBe(false);
    expect(byId.stuck).toMatchObject({ state: 'did_not_finish', downloadable: false });
    expect(byId.stuck.error).toMatch(/never stored/);
  });

  it('says a failure recorded no reason rather than showing nothing', () => {
    const [doc] = projectIssuedDocuments({ renders: [render({ status: 'failed', error: null })], templateJobs: [], links: [], now: NOW });
    expect(doc.error).toMatch(/without recording why/);
  });

  it('keeps only the documents drawn for a client', () => {
    const history = [
      link({ client_id: CLIENT_A, linked_at: minutesAgo(120), unlinked_at: minutesAgo(20) }),
      link({ client_id: CLIENT_B, linked_at: minutesAgo(20) }),
    ];
    const docs = projectIssuedDocuments({ renders: [render()], templateJobs: [job()], links: history, now: NOW });
    expect(documentsForClient(docs, CLIENT_A).map((d) => d.id)).toEqual(['r1']);
    expect(documentsForClient(docs, CLIENT_B).map((d) => d.id)).toEqual(['j1']);
  });
});

describe('where a document’s bytes are', () => {
  it('uses the direct route’s own bucket column, and the template route’s bucket', () => {
    expect(documentStorage('capacity_report', { status: 'succeeded', storage_path: 'p', storage_bucket: 'client-files' }))
      .toEqual({ bucket: 'client-files', path: 'p' });
    expect(documentStorage('capacity_report', { status: 'succeeded', storage_path: 'p', storage_bucket: null }))
      .toEqual({ bucket: CAPACITY_REPORT_BUCKET, path: 'p' });
    expect(documentStorage('template', { status: 'succeeded', storage_path: 'q' }))
      .toEqual({ bucket: TEMPLATE_DOCUMENT_BUCKET, path: 'q' });
  });

  it('has no bytes to offer for anything that did not succeed', () => {
    expect(documentStorage('capacity_report', { status: 'failed', storage_path: 'p' })).toBeNull();
    expect(documentStorage('template', { status: 'succeeded', storage_path: '  ' })).toBeNull();
  });

  it('names the buckets the two render functions actually write to', () => {
    const direct = readFileSync('supabase/functions/render-commercial-capacity-pdf/index.ts', 'utf8');
    const templated = readFileSync('supabase/functions/render-template-pdf/index.ts', 'utf8');
    expect(direct).toContain(`const PDF_BUCKET = '${CAPACITY_REPORT_BUCKET}';`);
    expect(templated).toContain(`const PDF_BUCKET = '${TEMPLATE_DOCUMENT_BUCKET}';`);
  });
});

describe('the words on the page', () => {
  it('names the route', () => {
    expect(documentRouteLabel({ ledger: 'capacity_report', templateName: null })).toBe('Standard layout');
    expect(documentRouteLabel({ ledger: 'template', templateName: 'Harbour · Slate' })).toBe('Template · Harbour · Slate');
    expect(documentRouteLabel({ ledger: 'template', templateName: null })).toBe('Report template');
  });

  it('says what is in the file, and only what the route recorded', () => {
    expect(documentFacts({ pageCount: 9, hasAnalysis: true, ledger: 'capacity_report' })).toBe('9 pages');
    expect(documentFacts({ pageCount: 1, hasAnalysis: false, ledger: 'capacity_report' })).toBe('1 page · without the analysis');
    expect(documentFacts({ pageCount: null, hasAnalysis: null, ledger: 'template' })).toBeNull();
  });
});
