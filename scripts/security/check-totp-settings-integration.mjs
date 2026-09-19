import { readFileSync } from 'node:fs';
const source = readFileSync('src/components/settings/TotpEnrollmentCard.tsx', 'utf8');
for (const name of ['beginTotpEnrollment', 'confirmTotpEnrollment', 'useState<{ token: string; secret: string; otpauthUri: string } | null>', 'LocalOtpAuthQrCode']) if (!source.includes(name)) throw new Error(`Missing secure TOTP settings integration: ${name}`);
if (source.includes('fetch(')) throw new Error('TOTP settings must use the secure enrollment helpers.');
console.log('TOTP settings use secure enrollment helpers.');
