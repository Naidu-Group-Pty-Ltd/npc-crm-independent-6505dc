import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escapeHtml';

describe('escapeHtml', () => {
  it('encodes characters that can create executable PDF markup', () => {
    const payload = `<img src="x" onerror='window.opener.stolen=true'>&`;

    expect(escapeHtml(payload)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;window.opener.stolen=true&#39;&gt;&amp;',
    );
  });
});
