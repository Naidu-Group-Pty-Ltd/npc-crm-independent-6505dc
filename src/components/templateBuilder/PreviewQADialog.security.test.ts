import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dialogSource = readFileSync(
  resolve(process.cwd(), 'src/components/templateBuilder/PreviewQADialog.tsx'),
  'utf8',
);

describe('PreviewQADialog security boundary', () => {
  it('renders editor-controlled HTML in a fully sandboxed iframe', () => {
    const previewIframe = dialogSource.match(/<iframe\s+title="html-preview"[^>]*\/>/)?.[0];

    expect(previewIframe).toBeDefined();
    expect(previewIframe).toMatch(/\ssandbox=""(?:\s|>)/);
    expect(previewIframe).not.toMatch(/allow-scripts|allow-same-origin/);
  });
});
