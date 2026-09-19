import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
/*
 * Repo-relative, not `import.meta.url`.
 *
 * Under this Vitest the transformed module's `import.meta.url` is not a
 * file-scheme URL, so `fileURLToPath` threw during COLLECTION and this file
 * failed before its assertion ran — a preview-isolation contract that was
 * enforcing nothing. Same repair as the other source-text contracts here.
 */

describe('PreviewQADialog HTML preview isolation', () => {
  it('sandboxes rendered template HTML without granting any capabilities', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/components/templateBuilder/PreviewQADialog.tsx'),
      'utf8',
    );
    const previewIframe = source.match(/<iframe\s+title="html-preview"[^>]*\/>/)?.[0];

    expect(previewIframe).toBeDefined();
    expect(previewIframe).toMatch(/\ssandbox=""/);
    expect(previewIframe).not.toMatch(/allow-scripts|allow-same-origin/);
  });
});
