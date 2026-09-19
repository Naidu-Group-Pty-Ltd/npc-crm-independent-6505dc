const TRACKING = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|ref|source)$/i;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (isPrivateIpv4(value)) return true;
  const mappedIpv4 = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
  const mappedHex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return value === '::' || value === '::1' || value.startsWith('2001:db8:') || /^f[cd]/.test(value) || /^fe[89ab]/.test(value) || /^ff/.test(value);
}

function isIpLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  return host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

function parseAllowedUrl(value: string, base: string | undefined, allowed: string[]): URL {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Disallowed URL scheme');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const domains = allowed.map((domain) => domain.toLowerCase().replace(/^\[|\]$/g, ''));
  if (!domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error('Disallowed source domain');
  }
  if (host === 'localhost' || isPrivateAddress(host)) throw new Error('Private network targets are forbidden');
  return url;
}

async function validateFetchTarget(value: string, base: string | undefined, allowed: string[]): Promise<URL> {
  const url = parseAllowedUrl(value, base, allowed);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIpLiteral(host)) return url;

  const lookups = await Promise.allSettled([
    Deno.resolveDns(host, 'A'),
    Deno.resolveDns(host, 'AAAA'),
  ]);
  const addresses = lookups.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  if (!addresses.length) throw new Error('Source domain could not be resolved');
  if (addresses.some(isPrivateAddress)) throw new Error('Private network targets are forbidden');
  return url;
}

export function normaliseUrl(value: string, base: string, allowed: string[]): string {
  const url = parseAllowedUrl(value, base, allowed);
  url.hash = '';
  [...url.searchParams.keys()].forEach((key) => {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  });
  return url.toString();
}

export const sourceDomains = (source: { primary_url?: string | null; feed_urls: string[]; listing_urls: string[] }) =>
  [source.primary_url, ...source.feed_urls, ...source.listing_urls]
    .filter(Boolean)
    .map((value) => new URL(value!).hostname.toLowerCase().replace(/^\[|\]$/g, ''));

export function safeSourceExcerpt(source:{copyright_mode?:string|null}, value:unknown):string|null {
  if (String(source.copyright_mode ?? '').includes('link_and_metadata_only')) return null;
  const text=String(value ?? '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  if(!text) return null;
  const configured=Number(Deno.env.get('MARKET_UPDATES_EXCERPT_MAX_CHARS') ?? 700);
  const limit=Math.max(120,Math.min(1200,Number.isFinite(configured)?configured:700));
  return text.slice(0,limit);
}

export async function boundedFetch(
  value: string,
  allowed: string[],
  init: RequestInit = {},
  timeout = 15_000,
  maxBytes = 3_000_000,
): Promise<{ response: Response; body: string; latency: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = Date.now();
  try {
    let url = await validateFetchTarget(value, undefined, allowed);
    let response: Response | undefined;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      response = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
      if (response.url) await validateFetchTarget(response.url, undefined, allowed);
      if (!REDIRECT_STATUSES.has(response.status)) break;
      if (redirects === MAX_REDIRECTS) throw new Error('Source returned too many redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error('Source redirect omitted its location');
      url = await validateFetchTarget(location, url.toString(), allowed);
    }
    if (!response?.ok) throw new Error(`Source returned HTTP ${response?.status ?? 0}`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maxBytes) throw new Error('Source response exceeded maximum size');
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > maxBytes) throw new Error('Source response exceeded maximum size');
    return { response, body, latency: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
