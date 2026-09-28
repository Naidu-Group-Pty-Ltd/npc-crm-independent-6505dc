/**
 * A re-download is the stored file, never a re-render.
 *
 * The server signs a short-lived link to the bytes kept when the document was
 * produced; the app saves them under the name the ledger recorded, through the
 * same save step Generate report uses. Somebody who reached the document
 * through a client sends that client, which is how the server decides they may
 * read it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const documentUrl = vi.fn();
const downloadCapacityReport = vi.fn();

vi.mock('@/hooks/useCiAssessments', () => ({
  ciAssessmentApi: { documentUrl: (...args: unknown[]) => documentUrl(...args) },
}));
vi.mock('@/lib/reports/commercialCapacity/requestCapacityReport', () => ({
  downloadCapacityReport: (...args: unknown[]) => downloadCapacityReport(...args),
}));

const { downloadIssuedDocument } = await import('../documentDownload');

const DOC = { ledger: 'template' as const, id: 'j1', assessmentId: 'a1', fileName: 'fallback.pdf' };

beforeEach(() => {
  documentUrl.mockReset().mockResolvedValue({
    data: { url: 'https://example.test/signed', fileName: 'Stored_Name.pdf', expiresInSeconds: 300 },
    error: null,
  });
  downloadCapacityReport.mockReset().mockResolvedValue(undefined);
});

describe('downloading an issued document', () => {
  it('asks the server for the stored file and saves it under the recorded name', async () => {
    await downloadIssuedDocument(DOC);
    expect(documentUrl).toHaveBeenCalledWith({ assessmentId: 'a1', ledger: 'template', documentId: 'j1', clientId: null });
    expect(downloadCapacityReport).toHaveBeenCalledWith({ url: 'https://example.test/signed', fileName: 'Stored_Name.pdf' });
  });

  it('sends the client it was reached through', async () => {
    await downloadIssuedDocument(DOC, { viaClientId: 'c1' });
    expect(documentUrl).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'c1' }));
  });

  it('says why when the server will not sign it', async () => {
    documentUrl.mockResolvedValue({ data: null, error: 'Document not found' });
    await expect(downloadIssuedDocument(DOC)).rejects.toThrow('Document not found');
    expect(downloadCapacityReport).not.toHaveBeenCalled();
  });
});
