/**
 * What an Intelligence Hub document is called, and what it says it is about.
 *
 * The owner's words (28 Sep 2026): the download said "QA Summary" where it
 * should say the Intelligence Hub summary, on every document, and "it should
 * pick up a small piece of information on what the report is generating and
 * have that as a title too for the download". The PDF they attached was named
 * `QA_Summary_-_28_09_2026_1.pdf` and printed "Investment Property Analysis"
 * over a suburb shortlist.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  HUB_DOCUMENT_NAME,
  clipAtWord,
  fileSafe,
  firstHeadingOf,
  hubDocumentFileName,
  hubDocumentTopic,
  hubEmailSubject,
  storageSafeFileName,
} from '../documentIdentity.pure';
import { reportQaFileName, reportQaStoragePath } from '../route.pure';
import { buildReportQaDocument } from '../normalise.pure';
import { DOCUMENT_NAME, renderReportQaFromBrand } from '../render.pure';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';

const REPO = resolve(__dirname, '../../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');

/** The head of the answer the owner exported, verbatim. */
const SHORTLIST = [
  '# Investment Property Suburb Shortlist Report',
  '## Budget: Up to $750,000 Purchase Price',
  '**Prepared for:** Client Presentation',
  '',
  '---',
  '',
  '## 1. Executive recommendation',
  '',
  'For a **$750,000 residential investment budget**, the most practical strategy is …',
].join('\n');

describe('the name', () => {
  it('is the Intelligence Hub Summary, and the renderer prints it', () => {
    expect(HUB_DOCUMENT_NAME).toBe('Intelligence Hub Summary');
    // The archetype spells it for the design system, which imports no format;
    // the two must not drift.
    expect(DOCUMENT_NAME).toBe(HUB_DOCUMENT_NAME);
  });

  it('is no longer "Report Q&A" or "Investment Property Analysis" on anything the Hub downloads', () => {
    for (const path of [
      'src/components/report-qa/MessageReportEditor.tsx',
      'src/components/report-qa/ConversationReportEditor.tsx',
    ]) {
      const code = read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toContain('Investment Property Analysis');
      expect(code).not.toContain('Q&A Summary');
    }
    const edge = read('supabase/functions/report-qa/index.ts');
    expect(edge).not.toContain("drawText('Q&A Conversation Export'");
  });
});

describe('the topic', () => {
  it('is the answer’s own title where it wrote one', () => {
    expect(hubDocumentTopic({ body: SHORTLIST, conversationTitle: 'Suburbs for 750k' }))
      .toBe('Investment Property Suburb Shortlist Report');
  });

  it('drops a section number but never a figure', () => {
    expect(firstHeadingOf('## 1. Executive recommendation')).toBe('Executive recommendation');
    expect(firstHeadingOf('## Section 3: Risks')).toBe('Risks');
    expect(firstHeadingOf('## 2026 outlook for Perth')).toBe('2026 outlook for Perth');
    expect(firstHeadingOf('### 3.5 bedroom homes')).toBe('3.5 bedroom homes');
  });

  it('strips emphasis, and ignores a heading inside a code fence', () => {
    expect(firstHeadingOf('# **Perth** market _view_')).toBe('Perth market view');
    expect(firstHeadingOf('```\n# not a heading\n```\n## Real title')).toBe('Real title');
    expect(firstHeadingOf('#### A caption, not a title')).toBe('');
  });

  it('falls back to a title somebody gave the conversation, then to the question', () => {
    expect(hubDocumentTopic({ body: 'No headings at all.', conversationTitle: 'Perth vs Adelaide growth' }))
      .toBe('Perth vs Adelaide growth');
    expect(hubDocumentTopic({ body: '', conversationTitle: 'New conversation', question: 'Which suburbs in Perth suit a $750k budget? Please be thorough.' }))
      .toBe('Which suburbs in Perth suit a $750k budget');
    expect(hubDocumentTopic({ conversationTitle: 'Report Q&A' })).toBe('');
  });

  it('is short: clipped at a word', () => {
    const long = 'word '.repeat(40).trim();
    const clipped = clipAtWord(long, 30);
    expect(clipped.length).toBeLessThanOrEqual(30);
    expect(clipped.endsWith('word')).toBe(true);
  });
});

describe('the filename', () => {
  it('names the product, the topic and the day, readably', () => {
    expect(hubDocumentFileName('Investment Property Suburb Shortlist Report', '2026-09-28T05:00:00Z'))
      .toBe('Intelligence Hub Summary - Investment Property Suburb Shortlist Report - 28 Sep 2026.pdf');
  });

  it('never carries a character a filesystem or a mail client refuses', () => {
    const name = hubDocumentFileName('Perth / Adelaide: "best" picks? <$750k> & more', '2026-09-28');
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name).toContain('Perth Adelaide best picks $750k and more');
    expect(fileSafe('A – B')).toBe('A - B');
  });

  it('says what a transcript is, and states the name once where there is no topic', () => {
    expect(hubDocumentFileName('Perth growth', '2026-09-28', { kind: 'transcript', extension: 'md' }))
      .toBe('Intelligence Hub Summary - Transcript - Perth growth - 28 Sep 2026.md');
    expect(hubDocumentFileName('', '2026-09-28')).toBe('Intelligence Hub Summary - 28 Sep 2026.pdf');
    expect(reportQaFileName(HUB_DOCUMENT_NAME, 'answer', '2026-09-28T00:00:00Z'))
      .toBe('Intelligence Hub Summary - 28 Sep 2026.pdf');
  });

  it('keeps the storage key to URL-safe characters while the person gets the readable name', () => {
    const name = reportQaFileName('Investment Property Suburb Shortlist Report', 'answer', '2026-09-28T00:00:00Z');
    const key = reportQaStoragePath('c0ffee00-0000-4000-8000-000000000000', name, '2026-09-28T00:00:00Z', 'u1');
    expect(key).toMatch(/^report-qa\/c0ffee00-0000-4000-8000-000000000000\/2026-09-28\/u1-[A-Za-z0-9._-]+$/);
    expect(storageSafeFileName('A b & c.pdf')).toBe('A_b_c.pdf');
  });

  it('gives an email a subject a client can read', () => {
    expect(hubEmailSubject('Intelligence Hub Summary - Perth growth - 28 Sep 2026.pdf'))
      .toBe('Intelligence Hub Summary - Perth growth - 28 Sep 2026');
    expect(hubEmailSubject('qa-export-1234.pdf')).toBe('Intelligence Hub Summary - qa-export-1234');
  });
});

describe('the typeset document', () => {
  const conversationId = 'c0ffee00-0000-4000-8000-000000000000';
  const messageId = 'aaaaaaaa-0000-4000-8000-000000000001';
  const built = buildReportQaDocument({
    conversation: { id: conversationId, title: 'Suburbs for 750k', report_names: [] },
    messages: [
      { id: 'q1', role: 'user', content: 'Shortlist suburbs for $750k', created_at: '2026-09-28T01:00:00Z' },
      {
        id: messageId,
        role: 'assistant',
        content: 'Old text',
        // The editor's edits, as the export stores them before it draws.
        edited_content: SHORTLIST,
        created_at: '2026-09-28T01:01:00Z',
      },
    ],
    subject: 'answer',
    messageId,
    preparedOn: '2026-09-28T05:00:00Z',
  });

  it('prints the edited answer, titled by its own heading', () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.document.body).toBe(SHORTLIST);
    expect(built.document.meta.title).toBe('Investment Property Suburb Shortlist Report');
    // A finished answer opens on itself: no framing sentence about the Hub.
    expect(built.document.narrative).toBe('');
    // Its title block is placed rather than printed twice: the subtitle and
    // the addressee go on the cover, and the body starts at its first section.
    expect(built.document.presentation?.subtitle).toBe('Budget: Up to $750,000 Purchase Price');
    expect(built.document.presentation?.preparedFor).toBe('Client Presentation');
    expect(built.document.presentation?.body.trim().startsWith('## 1. Executive recommendation')).toBe(true);
    expect(reportQaFileName(built.document.meta.title, 'answer', '2026-09-28T05:00:00Z'))
      .toBe('Intelligence Hub Summary - Investment Property Suburb Shortlist Report - 28 Sep 2026.pdf');
  });

  it('carries the name as its eyebrow and PDF title, and its title once — not also as the first heading', () => {
    if (!built.ok) return;
    const { snapshot } = buildReportBrandSnapshot({
      whitelabel: { companyName: 'Tenant Advisory', brandColour: '#B8873A', preset: 'signature' },
      contact: { company_name: 'Tenant Advisory Pty Ltd' },
      capturedAt: '2026-09-28T05:00:00Z',
    });
    const { html } = renderReportQaFromBrand({ document: built.document, snapshot });
    expect(html).toContain('<title>Intelligence Hub Summary — Investment Property Suburb Shortlist Report</title>');
    expect(html).toContain('Intelligence Hub Summary');
    expect(html).not.toContain('Report Q&amp;A');
    // The H1 is the chapter's title; set again under the header it would print twice.
    const headings = html.match(/>Investment Property Suburb Shortlist Report</g) ?? [];
    expect(headings.length).toBeGreaterThanOrEqual(1);
    expect(html).not.toMatch(/<h[1-4][^>]*>\s*Investment Property Suburb Shortlist Report\s*<\/h[1-4]>\s*<h[1-4][^>]*>\s*Investment Property Suburb Shortlist Report/);
  });
});
