import { describe, expect, it } from 'vitest';
import { LIVE_PREVIEW_SANDBOX } from './LiveHtmlPreview';

describe('LiveHtmlPreview sandbox', () => {
  it('runs the editor runtime in an opaque origin', () => {
    const permissions = LIVE_PREVIEW_SANDBOX.split(/\s+/);

    expect(permissions).toContain('allow-scripts');
    expect(permissions).not.toContain('allow-same-origin');
  });
});
