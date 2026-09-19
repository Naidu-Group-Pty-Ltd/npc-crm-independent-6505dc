import { describe, expect, it } from 'vitest';
import { codeFileTypeInfo, extensionForName, formatBytes, summarizeCodeIntake } from '../ingestion/codeIntake';

describe('code upload intake', () => {
  it('detects source type from extension or MIME', () => {
    expect(extensionForName('App.TSX')).toBe('tsx');
    expect(extensionForName('download', 'text/html')).toBe('html');
    expect(codeFileTypeInfo('styles.scss')).toMatchObject({ category: 'style', ingestible: true });
    expect(codeFileTypeInfo('diagram.svg')).toMatchObject({ category: 'asset', renderRole: 'asset' });
  });

  it('formats bytes for upload summaries', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB');
  });

  it('summarizes folder uploads by type, size, root, and entry candidates', () => {
    const summary = summarizeCodeIntake([
      { name: 'index.html', size: 1000, type: 'text/html', webkitRelativePath: 'landing/index.html' },
      { name: 'app.tsx', size: 2000, type: 'text/typescript', webkitRelativePath: 'landing/src/app.tsx' },
      { name: 'hero.png', size: 3000, type: 'image/png', webkitRelativePath: 'landing/assets/hero.png' },
      { name: 'theme.css', size: 500, type: 'text/css', webkitRelativePath: 'landing/theme.css' },
    ]);

    expect(summary.mode).toBe('folder');
    expect(summary.rootName).toBe('landing');
    expect(summary.fileCount).toBe(4);
    expect(summary.totalBytes).toBe(6500);
    expect(summary.entryCandidates).toContain('landing/index.html');
    expect(summary.breakdown.map((b) => b.extension)).toEqual(expect.arrayContaining(['html', 'tsx', 'png', 'css']));
  });
});
