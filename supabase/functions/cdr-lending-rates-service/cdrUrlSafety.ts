const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home', '.lan', '.test'];

function isPublicIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [a, b, c] = octets;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || (b === 168) || (b === 0 && c === 2))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function isPublicHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;

  if (host.includes(':')) {
    const firstHextet = Number.parseInt(host.split(':', 1)[0], 16);
    return firstHextet >= 0x2000 && firstHextet <= 0x3fff && !host.startsWith('2001:db8:');
  }

  if (/^\d+(?:\.\d+){3}$/.test(host)) return isPublicIpv4(host);
  return host.includes('.') && /^[a-z0-9.-]+$/.test(host);
}

export function isSafeCdrUrl(value: string, allowQuery = true): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      !url.hash &&
      (allowQuery || !url.search) &&
      isPublicHostname(url.hostname);
  } catch {
    return false;
  }
}
