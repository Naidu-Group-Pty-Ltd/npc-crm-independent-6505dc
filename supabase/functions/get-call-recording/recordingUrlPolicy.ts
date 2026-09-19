import { isPrivateOrReservedAddress } from '../_shared/ssrfGuard.ts';

export type RecordingDnsResolver = (
  hostname: string,
  recordType: 'A' | 'AAAA',
) => Promise<string[]>;

const RECORDING_HOST_SUFFIXES = [
  'vapi.ai',
  'r2.cloudflarestorage.com',
  'r2.dev',
];

export async function assertSafeRecordingUrl(
  value: string,
  resolveDns: RecordingDnsResolver,
  base?: string,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new Error('Invalid recording URL');
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Recording URL must use HTTPS without credentials');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const allowed = RECORDING_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
  if (!allowed) throw new Error('Recording URL host is not allowed');

  const results = await Promise.allSettled([
    resolveDns(hostname, 'A'),
    resolveDns(hostname, 'AAAA'),
  ]);
  const addresses = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
  if (!addresses.length) throw new Error('Recording URL host could not be resolved');
  if (addresses.some(isPrivateOrReservedAddress)) {
    throw new Error('Recording URL resolved to a private or reserved address');
  }

  return url;
}
