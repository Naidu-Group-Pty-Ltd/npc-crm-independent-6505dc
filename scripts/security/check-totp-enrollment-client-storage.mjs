import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/settings/TotpEnrollmentCard.tsx', 'utf8');
for (const forbidden of ['localStorage', 'sessionStorage', 'otpauthUri']) {
  if (forbidden !== 'otpauthUri' && source.includes(forbidden)) throw new Error(`TOTP enrollment material must not use ${forbidden}`);
}
if (!source.includes("useState<{ token: string; secret: string; otpauthUri: string } | null>")) throw new Error('TOTP enrollment token must remain component-local');
console.log('TOTP enrollment secrets remain out of browser storage.');

const qr = readFileSync('src/components/settings/LocalOtpAuthQrCode.tsx', 'utf8');
if (!qr.includes("new QRCode(-1, QRErrorCorrectLevel.M)")) throw new Error('TOTP QR code must be rendered locally with medium error correction.');
if (qr.includes('fetch(') || qr.includes('http://') || qr.includes('https://')) throw new Error('TOTP QR code must not call an external rendering service.');
const license = readFileSync('src/lib/security/vendor/qrcode/LICENSE.txt', 'utf8');
if (!license.includes('MIT License')) throw new Error('Vendored local QR encoder must retain its license notice.');
