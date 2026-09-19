import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../escapeHtml';

describe('escapeHtml', () => {
  it('encodes markup and attribute delimiters', () => {
    expect(escapeHtml(`<img src=x onerror="alert('xss')"> & text`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt; &amp; text',
    );
  });

  it('converts non-string report values to escaped text', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('null');
  });
});
