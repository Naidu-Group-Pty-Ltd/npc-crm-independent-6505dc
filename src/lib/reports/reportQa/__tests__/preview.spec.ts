/**
 * The export dialog's Preview: the document the export would make, in the
 * chosen template, drawn before anything is made — and keeping nothing.
 *
 * The owner asked (30 Sep 2026) to see "the entirety of how the document's
 * layout will be" in the dialog, in whichever template is chosen, and to edit
 * before downloading. The route draws the preview with the same record, brand,
 * design and engine as the export; what makes it a preview is that it may carry
 * the editor's unsaved text and writes nothing at all.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyPreviewDraft,
  MAX_PREVIEW_DRAFT_CHARS,
  parseRenderRequest,
  pdfToBase64,
} from '../route.pure';

const CID = '11111111-1111-4111-8111-111111111111';
const MID = '71111111-1111-4111-8111-111111111111';
const REPO = resolve(__dirname, '../../../../..');

const parse = (over: Record<string, unknown> = {}) =>
  parseRenderRequest({ conversationId: CID, subject: 'answer', messageId: MID, ...over });

describe('what a preview may ask for', () => {
  it('is a preview only when it says so, and carries no draft otherwise', () => {
    const plain = parse();
    expect(plain.ok && plain.request.preview).toBe(false);
    expect(plain.ok && plain.request.draft).toBeNull();
    const preview = parse({ preview: true, draft: '# Title\n\nText.' });
    expect(preview.ok && preview.request.preview).toBe(true);
    expect(preview.ok && preview.request.draft).toBe('# Title\n\nText.');
  });

  it('draws a draft only in a preview — a kept document is always the record', () => {
    const refused = parse({ draft: 'Edited.' });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toMatch(/only in a preview/);
  });

  it('never draws a transcript from a draft', () => {
    const refused = parseRenderRequest({ conversationId: CID, subject: 'transcript', preview: true, draft: 'x' });
    expect(refused.ok === false && refused.error).toMatch(/transcript/);
  });

  it('refuses an empty draft, a draft that is not text, and one past the bound', () => {
    expect(parse({ preview: true, draft: '   ' }).ok).toBe(false);
    expect(parse({ preview: true, draft: 42 }).ok).toBe(false);
    expect(parse({ preview: true, draft: 'x'.repeat(MAX_PREVIEW_DRAFT_CHARS + 1) }).ok).toBe(false);
    expect(parse({ preview: true, draft: 'x'.repeat(MAX_PREVIEW_DRAFT_CHARS) }).ok).toBe(true);
  });

  it('can neither post a file into the conversation nor spend tokens', () => {
    const preview = parseRenderRequest({
      conversationId: CID, subject: 'structured', preview: true, attachToConversation: true, generateIfMissing: true,
    });
    expect(preview.ok && preview.request.attachToConversation).toBe(false);
    expect(preview.ok && preview.request.generateIfMissing).toBe(false);
  });
});

describe('the draft stands in for what it edits', () => {
  const conversation = { id: CID, structured_report: '# Stored write-up' };
  const messages = [
    { id: 'q', role: 'user', content: 'Question?', edited_content: null },
    { id: MID, role: 'assistant', content: 'Stored answer.', edited_content: 'Saved edit.' },
    { id: 'other', role: 'assistant', content: 'Another answer.', edited_content: null },
  ];

  it('as the answer\'s edit — the slot Save writes, so a preview draws what saving would', () => {
    const out = applyPreviewDraft(conversation, messages, { subject: 'answer', messageId: MID, draft: 'Draft.' });
    expect(out.messages.find((m) => m.id === MID)?.edited_content).toBe('Draft.');
    expect(out.messages.find((m) => m.id === 'other')?.edited_content).toBeNull();
    expect(out.conversation).toBe(conversation);
  });

  it('as the write-up, for the structured document', () => {
    const out = applyPreviewDraft(conversation, messages, { subject: 'structured', messageId: null, draft: '# Draft' });
    expect(out.conversation.structured_report).toBe('# Draft');
  });

  it('changes nothing it read, and nothing at all without a draft', () => {
    applyPreviewDraft(conversation, messages, { subject: 'answer', messageId: MID, draft: 'Draft.' });
    applyPreviewDraft(conversation, messages, { subject: 'structured', messageId: null, draft: '# Draft' });
    expect(messages[1].edited_content).toBe('Saved edit.');
    expect(conversation.structured_report).toBe('# Stored write-up');
    const none = applyPreviewDraft(conversation, messages, { subject: 'answer', messageId: MID, draft: null });
    expect(none.messages).toEqual(messages);
  });
});

describe('the bytes', () => {
  it('survive the trip as base64, past the slice a single call would overflow', () => {
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31 + 7) % 256;
    const back = Uint8Array.from(atob(pdfToBase64(bytes)), (c) => c.charCodeAt(0));
    expect(back).toEqual(bytes);
  });
});

describe('the route keeps nothing for a preview', () => {
  const source = readFileSync(resolve(REPO, 'supabase/functions/render-report-qa-pdf/index.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const previewReturn = source.indexOf('return json(preview)');

  it('answers the preview before the ledger row, the upload, the signed link and the attachment', () => {
    expect(previewReturn).toBeGreaterThan(-1);
    for (const write of [
      ".from('report_qa_renders')",
      '.storage.from(STORAGE_BUCKET).upload(',
      '.createSignedUrl(',
      ".from('report_qa_messages')\n        .insert(",
    ]) {
      const at = source.indexOf(write);
      expect(at, write).toBeGreaterThan(previewReturn);
    }
  });

  it('records the frozen brand only for a document that is kept', () => {
    expect(source).toMatch(/request\.preview\s*\?\s*\{ data: null \}\s*:\s*await supabase\.rpc\('upsert_report_brand_snapshot'/);
  });

  it('takes the rights of the edit it shows before it draws a draft', () => {
    const gate = source.indexOf('if (request.draft !== null)');
    expect(gate).toBeGreaterThan(-1);
    expect(source.slice(gate, gate + 600)).toContain('canWrite(access.role)');
    expect(source.slice(gate, gate + 600)).toContain("'can_edit'");
    expect(gate).toBeLessThan(source.indexOf('applyPreviewDraft('));
  });
});
