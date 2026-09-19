import { describe, expect, it } from 'vitest';
import { sanitizePdfHtml } from '../sanitizePdfHtml';

describe('sanitizePdfHtml', () => {
  it('preserves PDF layout while removing executable content', () => {
    const html = `<!doctype html><html><head><style>.value { font-weight: bold; }</style></head><body>
      <table><tbody><tr><td class="value">Safe value</td></tr></tbody></table>
      <img src="x" onerror="window.parent.localStorage.getItem('token')">
      <script>window.parent.localStorage.getItem('token')</script>
      <iframe srcdoc="<script>alert(1)</script>"></iframe>
    </body></html>`;

    const sanitized = sanitizePdfHtml(html);

    expect(sanitized).toContain('<style>.value { font-weight: bold; }</style>');
    expect(sanitized).toContain('<td class="value">Safe value</td>');
    expect(sanitized).not.toMatch(/onerror|<script|<iframe|localStorage/i);
  });

  it('removes dangerous URL protocols from generated content', () => {
    const sanitized = sanitizePdfHtml('<img src="javascript:alert(1)"><a href="javascript:alert(1)">link</a>');

    expect(sanitized).not.toMatch(/javascript:/i);
  });
});
