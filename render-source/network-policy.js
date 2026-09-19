const dns = require('dns').promises;
const net = require('net');

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function isPrivateAddress(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0];
  if (net.isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (net.isIP(normalized) !== 6) return true;

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return normalized === '::' || normalized === '::1' ||
    /^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized) ||
    /^ff/.test(normalized) || /^2001:db8(?::|$)/.test(normalized);
}

function parseHttpUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed.');
  }
  return url;
}

async function assertPublicUrl(rawUrl, lookup = dns.lookup) {
  const url = parseHttpUrl(rawUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Refusing to render a private/reserved host.');
  }

  const literalFamily = net.isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Refusing to render a private/reserved host.');
  }
  return url;
}

function installNetworkPolicy(page, { localOrigin } = {}) {
  return page.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    try {
      const url = new URL(requestUrl);
      if (['data:', 'blob:', 'about:'].includes(url.protocol)) return route.continue();
      if (localOrigin && url.origin === localOrigin) return route.continue();
      await assertPublicUrl(requestUrl);
      return route.continue();
    } catch {
      return route.abort('blockedbyclient');
    }
  });
}

module.exports = { assertPublicUrl, installNetworkPolicy, isPrivateAddress };
