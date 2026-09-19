import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const previewSource = readFileSync(resolve('src/pages/TemplateSharePreview.tsx'), 'utf8');

describe('TemplateSharePreview iframe isolation', () => {
  it('sandboxes untrusted template HTML without granting any capabilities', () => {
    const iframe = previewSource.match(/<iframe[\s\S]*?\/>/)?.[0];

    expect(iframe).toBeDefined();
    expect(iframe).toContain('srcDoc={rendered.html}');
    expect(iframe).toContain('sandbox=""');
    expect(iframe).not.toMatch(/allow-scripts|allow-same-origin/);
  });
});
