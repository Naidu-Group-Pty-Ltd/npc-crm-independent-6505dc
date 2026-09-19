import { describe, expect, it } from 'vitest';
import { escapePdfHtml } from '../escapePdfHtml';

describe('escapePdfHtml', () => {
  it('renders untrusted report values as text instead of executable markup', () => {
    expect(escapePdfHtml(`<img src=x onerror="window.opener.pwned=true">'&`))
      .toBe('&lt;img src=x onerror=&quot;window.opener.pwned=true&quot;&gt;&#39;&amp;');
  });
});
