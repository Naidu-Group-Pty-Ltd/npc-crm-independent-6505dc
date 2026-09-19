import { describe, it, expect } from 'vitest';
import {
  detectProvider,
  normalizeImportUrl,
  isHttpUrl,
  isLikelyPrivateHost,
  suggestedName,
} from '../importUrl';

describe('detectProvider', () => {
  it('recognises the major providers', () => {
    expect(detectProvider('https://drive.google.com/file/d/ABCDEFGHIJ123/view')).toBe('google-drive');
    expect(detectProvider('https://docs.google.com/document/d/ABCDEFGHIJ123/edit')).toBe('google-doc');
    expect(detectProvider('https://docs.google.com/presentation/d/ABCDEFGHIJ123/edit')).toBe('google-slides');
    expect(detectProvider('https://www.dropbox.com/s/x/file.pdf?dl=0')).toBe('dropbox');
    expect(detectProvider('https://1drv.ms/b/s!abc')).toBe('onedrive');
    expect(detectProvider('https://acme.sharepoint.com/:b:/g/abc')).toBe('sharepoint');
    expect(detectProvider('https://www.figma.com/design/AbCdEf123456/My-File')).toBe('figma');
    expect(detectProvider('https://www.canva.com/design/DA123/view')).toBe('canva');
    expect(detectProvider('https://gamma.app/docs/My-Deck-abc123')).toBe('gamma');
    expect(detectProvider('https://example.com/brochure.pdf')).toBe('generic');
    expect(detectProvider('not a url')).toBe('generic');
  });
});

describe('normalizeImportUrl', () => {
  it('rewrites a Google Drive view link to a direct download', () => {
    const n = normalizeImportUrl('https://drive.google.com/file/d/ABCDEFGHIJ123/view?usp=sharing');
    expect(n.fetchUrl).toBe('https://drive.google.com/uc?export=download&id=ABCDEFGHIJ123');
    expect(n.resourceId).toBe('ABCDEFGHIJ123');
    expect(n.needsExport).toBe(false);
  });

  it('exports Google Docs/Slides/Sheets to PDF', () => {
    expect(normalizeImportUrl('https://docs.google.com/document/d/DOC1234567890/edit').fetchUrl)
      .toBe('https://docs.google.com/document/d/DOC1234567890/export?format=pdf');
    expect(normalizeImportUrl('https://docs.google.com/presentation/d/SLD1234567890/edit#slide=1').fetchUrl)
      .toBe('https://docs.google.com/presentation/d/SLD1234567890/export/pdf');
    expect(normalizeImportUrl('https://docs.google.com/spreadsheets/d/SHT1234567890/edit').fetchUrl)
      .toBe('https://docs.google.com/spreadsheets/d/SHT1234567890/export?format=pdf');
    expect(normalizeImportUrl('https://docs.google.com/document/d/DOC1234567890/edit').expectedKind).toBe('pdf');
  });

  it('forces a Dropbox direct download', () => {
    const n = normalizeImportUrl('https://www.dropbox.com/s/abc/brochure.pdf?dl=0');
    expect(n.fetchUrl).toBe('https://dl.dropboxusercontent.com/s/abc/brochure.pdf?dl=1');
    expect(n.expectedKind).toBe('pdf');
  });

  it('flags Figma/Canva/Gamma as export-needed with guidance', () => {
    const fig = normalizeImportUrl('https://www.figma.com/design/AbCdEf123456/My-File?node-id=0-1');
    expect(fig.needsExport).toBe(true);
    expect(fig.resourceId).toBe('AbCdEf123456');
    expect(fig.guidance).toMatch(/Figma/i);
    expect(normalizeImportUrl('https://www.canva.com/design/DA123/view').needsExport).toBe(true);
    expect(normalizeImportUrl('https://gamma.app/docs/Deck-abc').needsExport).toBe(true);
  });

  it('passes generic file links through, guessing kind from the extension', () => {
    expect(normalizeImportUrl('https://example.com/a/report.pdf').expectedKind).toBe('pdf');
    expect(normalizeImportUrl('https://example.com/a/poster.png').expectedKind).toBe('image');
    expect(normalizeImportUrl('https://example.com/a/page').expectedKind).toBe('unknown');
  });
});

describe('isHttpUrl', () => {
  it('accepts http/https and rejects others', () => {
    expect(isHttpUrl('https://x.com')).toBe(true);
    expect(isHttpUrl('http://x.com')).toBe(true);
    expect(isHttpUrl('ftp://x.com')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl('nope')).toBe(false);
  });
});

describe('isLikelyPrivateHost (SSRF guard)', () => {
  it('blocks local/private/reserved hosts', () => {
    for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.10', '172.16.0.1', '169.254.169.254', '0.0.0.0', '::1', 'foo.local', 'metadata.internal']) {
      expect(isLikelyPrivateHost(h)).toBe(true);
    }
  });
  it('allows public hosts', () => {
    for (const h of ['drive.google.com', 'example.com', '8.8.8.8', '1.1.1.1', 'dl.dropboxusercontent.com']) {
      expect(isLikelyPrivateHost(h)).toBe(false);
    }
  });
});

describe('suggestedName', () => {
  it('derives a readable name from the path, else the provider', () => {
    expect(suggestedName('https://example.com/files/Q3-Brochure.pdf', 'generic')).toBe('Q3 Brochure');
    expect(suggestedName('https://drive.google.com/file/d/ABCDEFGHIJ1234567890/view', 'google-drive')).toBe('google drive import');
  });
});
