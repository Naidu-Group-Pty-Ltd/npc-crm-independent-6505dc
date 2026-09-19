import { describe, expect, it } from 'vitest';
import { renderQrCodeHtml } from '../blocks/qrCode.html';

describe('QR code HTML security', () => {
  it('encodes resolved bindable data locally without exposing it in a remote URL', () => {
    const sensitiveUrl = 'https://portal.example/client/acme?token=s3cr3t';
    const html = renderQrCodeHtml({
      id: 'qr-1',
      type: 'qr',
      props: { data: '{{client.portalUrl}}', size: 120 },
      overlays: [],
    } as any, {
      data: { client: { portalUrl: sensitiveUrl } },
      tokens: { colors: {}, fonts: {}, spacing: {} },
    } as any);

    expect(html).toContain('<svg');
    expect(html).toContain('<path');
    expect(html).not.toContain('api.qrserver.com');
    expect(html).not.toContain(sensitiveUrl);
    expect(html).not.toContain(encodeURIComponent(sensitiveUrl));
  });
});
