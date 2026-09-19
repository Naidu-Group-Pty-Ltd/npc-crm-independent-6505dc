import { describe, expect, it, vi } from 'vitest';
import { assertPublicUrl, isPrivateOrReservedAddress } from './ssrfGuard.ts';

describe('import-from-url SSRF guard', () => {
  it.each([
    '127.0.0.1', '169.254.169.254', '10.0.0.1', '::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe',
  ])('rejects private or mapped address %s', (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(true);
  });

  it('rejects a public-looking hostname when DNS returns a private address', async () => {
    const resolver = vi.fn(async (_hostname: string, type: 'A' | 'AAAA') =>
      type === 'A' ? ['127.0.0.1'] : []);

    await expect(assertPublicUrl('https://attacker.example/secret', resolver))
      .rejects.toThrow('private/internal');
    expect(resolver).toHaveBeenCalledWith('attacker.example', 'A');
  });

  it('allows a hostname only when all resolved addresses are public', async () => {
    const resolver = vi.fn(async (_hostname: string, type: 'A' | 'AAAA') =>
      type === 'A' ? ['93.184.216.34'] : ['2606:2800:220:1:248:1893:25c8:1946']);

    await expect(assertPublicUrl('https://example.com/document.pdf', resolver))
      .resolves.toMatchObject({ hostname: 'example.com' });
  });
});
