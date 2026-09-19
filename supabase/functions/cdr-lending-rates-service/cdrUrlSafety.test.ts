import { describe, expect, it } from 'vitest';
import { isSafeCdrUrl } from './cdrUrlSafety';

describe('isSafeCdrUrl', () => {
  it('accepts public HTTPS CDR URLs and request query strings', () => {
    expect(isSafeCdrUrl('https://api.example.com/cds-au/v1')).toBe(true);
    expect(isSafeCdrUrl('https://api.example.com/cds-au/v1/banking/products?page-size=100')).toBe(true);
  });

  it.each([
    'http://api.example.com/cds-au/v1',
    'https://user:password@api.example.com/cds-au/v1',
    'https://localhost/cds-au/v1',
    'https://service.internal/cds-au/v1',
    'https://127.0.0.1/cds-au/v1',
    'https://10.0.0.1/cds-au/v1',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/cds-au/v1',
    'https://api.example.com:8443/cds-au/v1',
    'https://api.example.com/cds-au/v1#fragment',
  ])('rejects unsafe outbound target %s', (url) => {
    expect(isSafeCdrUrl(url)).toBe(false);
  });

  it('rejects query strings on register base URLs only', () => {
    expect(isSafeCdrUrl('https://api.example.com/cds-au/v1?redirect=internal', false)).toBe(false);
  });
});
