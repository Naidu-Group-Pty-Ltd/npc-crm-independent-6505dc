import { describe, expect, it } from 'vitest';
import {
  detectUnsafeClientReportContent,
  sanitizeClientReportPayload,
  sanitizeClientReportSection,
  sanitizeClientReportText,
  type PdfImportClientReportPayload,
} from '../ingestion/clientReports';

function textOf(value: string, audience: any = 'external_client') {
  return sanitizeClientReportText({ value, audience, field: 'body' });
}

describe('sanitizeClientReportText', () => {
  it('removes a signed URL', () => {
    const r = textOf('See https://x.supabase.co/object/sign/a?token=abc&signature=z here');
    expect(r.value).not.toContain('token=');
    expect(r.value).toContain('[redacted]');
    expect(r.redactions.length).toBeGreaterThan(0);
  });

  it('removes a storage/bucket path', () => {
    const r = textOf('path template-import-artifacts/imports/imp-1/vq.json done');
    expect(r.value).not.toContain('template-import-artifacts');
  });

  it('removes a service-role reference', () => {
    expect(textOf('uses SUPABASE_SERVICE_ROLE_KEY here').value).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(textOf('the service_role client').value).not.toContain('service_role');
  });

  it('removes a stack trace', () => {
    const r = textOf('Error: boom\n  at handler (index.ts:12:5)');
    expect(r.value).toContain('[redacted]');
  });

  it('removes a raw JSON-like payload', () => {
    const r = textOf('meta {"a":"' + 'x'.repeat(80) + '"}');
    expect(r.redactions.some((x) => x.code === 'raw_json_dump')).toBe(true);
  });

  it('removes an http URL with token', () => {
    expect(textOf('go http://h/p?token=zzz now').value).not.toContain('token=');
  });

  it('strips internal UUIDs for external audience but keeps them for internal_operator', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    expect(textOf(`import ${uuid}`).value).not.toContain(uuid);
    expect(sanitizeClientReportText({ value: `import ${uuid}`, audience: 'internal_operator', field: 'body' }).value).toContain(uuid);
  });

  it('preserves safe wording', () => {
    const r = textOf('The template import passed quality review and is ready for use.');
    expect(r.value).toBe('The template import passed quality review and is ready for use.');
    expect(r.redactions).toEqual([]);
  });
});

describe('sanitizeClientReportSection + payload', () => {
  it('sanitizes section body and items', () => {
    const r = sanitizeClientReportSection({
      section: { id: 's', title: 'T', body: 'signed_url here', status: 'info', items: ['template-import-artifacts/x', 'safe item'] },
      audience: 'external_client',
    });
    expect(r.section.body).not.toContain('signed_url');
    expect(r.section.items.join(' ')).not.toContain('template-import-artifacts');
    expect(r.section.items).toContain('safe item');
  });

  it('detectUnsafe is safe after sanitization and flags remaining unsafe content', () => {
    const payload: PdfImportClientReportPayload = {
      version: 'pdf-import-client-report-v1',
      reportType: 'import_status_summary',
      audience: 'external_client',
      safetyLevel: 'safe',
      status: 'draft',
      importId: null, templateId: null,
      title: 'Status', summary: 'All good.',
      sections: [{ id: 's', title: 'S', body: 'signed_url https://h?token=x', status: 'info', items: [] }],
      redactions: [], sourceSummary: { operatorDecision: null, qualityGateStatus: null, exportParityStatus: null, manualReviewRequired: null, generatedFrom: [] },
      generatedAt: '2026-07-09T00:00:00.000Z',
    };
    expect(detectUnsafeClientReportContent({ payload }).safe).toBe(false);
    const sanitized = sanitizeClientReportPayload(payload);
    expect(detectUnsafeClientReportContent({ payload: sanitized }).safe).toBe(true);
    expect(sanitized.redactions.length).toBeGreaterThan(0);
  });
});
