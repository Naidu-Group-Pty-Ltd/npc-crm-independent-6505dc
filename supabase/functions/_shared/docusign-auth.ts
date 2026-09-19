/**
 * Shared DocuSign JWT Grant authentication helpers.
 * Extracted so multiple edge functions can obtain access tokens without duplicating the
 * PKCS#1→PKCS#8 conversion and JWT exchange logic.
 */
import { SignJWT, importPKCS8 } from 'https://deno.land/x/jose@v5.2.2/index.ts';

function wrapAsn1(tag: number, content: Uint8Array): Uint8Array {
  const len = content.length;
  let header: Uint8Array;
  if (len < 128) header = new Uint8Array([tag, len]);
  else if (len < 256) header = new Uint8Array([tag, 0x81, len]);
  else if (len < 65536) header = new Uint8Array([tag, 0x82, (len >> 8) & 0xff, len & 0xff]);
  else header = new Uint8Array([tag, 0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  const out = new Uint8Array(header.length + content.length);
  out.set(header, 0); out.set(content, header.length);
  return out;
}
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}
function convertPkcs1ToPkcs8Pem(pem: string): string {
  if (pem.includes('BEGIN PRIVATE KEY')) return pem;
  const b64 = pem.replace(/-----BEGIN RSA PRIVATE KEY-----/g, '').replace(/-----END RSA PRIVATE KEY-----/g, '').replace(/\s/g, '');
  const pkcs1Der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const rsaOid = new Uint8Array([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
  const nullParam = new Uint8Array([0x05, 0x00]);
  const algoId = wrapAsn1(0x30, concatBytes(rsaOid, nullParam));
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const privKeyOctet = wrapAsn1(0x04, pkcs1Der);
  const pkcs8Der = wrapAsn1(0x30, concatBytes(version, algoId, privKeyOctet));
  const pkcs8B64 = btoa(String.fromCharCode(...pkcs8Der));
  const lines = pkcs8B64.match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
}

export async function getDocuSignAccessToken(): Promise<string> {
  const integrationKey = Deno.env.get('DOCUSIGN_INTEGRATION_KEY')?.trim();
  const userId = Deno.env.get('DOCUSIGN_USER_ID')?.trim();
  let rsaPrivateKey = Deno.env.get('DOCUSIGN_RSA_PRIVATE_KEY')?.trim();
  if (!integrationKey || !userId || !rsaPrivateKey) {
    throw new Error('DocuSign JWT credentials not configured.');
  }
  rsaPrivateKey = rsaPrivateKey.replace(/\\n/g, '\n');
  if (rsaPrivateKey.includes('BEGIN RSA PRIVATE KEY')) {
    rsaPrivateKey = convertPkcs1ToPkcs8Pem(rsaPrivateKey);
  }
  const privateKey = await importPKCS8(rsaPrivateKey, 'RS256');
  const restBase = (Deno.env.get('DOCUSIGN_BASE_URL') || '').toLowerCase();
  const isProd = restBase.includes('//www.docusign.net') || restBase.includes('//na') || restBase.includes('//eu') || restBase.includes('//au');
  const oauthHost = Deno.env.get('DOCUSIGN_OAUTH_HOST')?.trim() || (isProd ? 'account.docusign.com' : 'account-d.docusign.com');
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ iss: integrationKey, sub: userId, aud: oauthHost, scope: 'signature impersonation' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(privateKey);
  const tokenResponse = await fetch(`https://${oauthHost}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok) {
    if (tokenData.error === 'consent_required') {
      const consentUrl = `https://${oauthHost}/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=${integrationKey}&redirect_uri=https://www.docusign.com`;
      throw new Error(`DocuSign consent_required. Visit: ${consentUrl}`);
    }
    throw new Error(`DocuSign token exchange failed: ${tokenData.error || tokenData.error_description || 'Unknown'}`);
  }
  return tokenData.access_token;
}

export function getDocuSignRestBaseUrl(): string {
  const configured = (Deno.env.get('DOCUSIGN_BASE_URL') || 'https://demo.docusign.net/restapi').trim();
  const normalized = configured.replace(/\/+$/, '');
  return normalized.toLowerCase().endsWith('/restapi') ? normalized : `${normalized}/restapi`;
}
