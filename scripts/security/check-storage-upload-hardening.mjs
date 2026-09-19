import { readFileSync } from 'node:fs';

const storage = readFileSync('supabase/functions/secure-storage/index.ts', 'utf8');
const authz = readFileSync('supabase/functions/_shared/storageAuthz.ts', 'utf8');
const failures = [];

for (const bucket of ['investment-reports', 'quantitative-reports', 'qa_exports', 'branding-assets']) {
  const row = storage.match(new RegExp(`'${bucket}':\\s*\\{([^}]+)\\}`));
  if (!row?.[1].includes('permissionTable:')) failures.push(`${bucket} lacks explicit mutation permission table`);
}
// The property: a human caller can never overwrite an existing object. It was
// asserted as `if (upsert === true) return createForbiddenResponse` — rejecting
// the flag outright — which broke callers that passed `upsert` defensively (the
// Branding page did). The control is now to IGNORE the flag for human callers
// rather than 403 on it, which is equally safe here and strictly more forgiving:
// the destination path is server-generated and unique per upload, so there is
// nothing to overwrite, and `upsert` is forced false for anyone not internal.
// The two needles that carry that (the randomised uploadPath, and the
// isInternal-gated upsert) are asserted below and are together sufficient —
// dropping either one fails this gate.
//
// Every term in the path is resolved server-side from an authoritative row —
// `objectClientId` is the client the stored object belongs to, derived from the
// report rather than supplied by the caller — and the randomised segment is
// what makes the destination unique. A caller-supplied value appearing in this
// expression is what this needle exists to catch.
for (const required of [
  'uploadPath = `${uploadBinding.clientId || uploadBinding.objectClientId || uploadBinding.ownerUserId || actorId}/${crypto.randomUUID()}',
  'resource_type: isInternal',
  'upsert: isInternal ? upsert === true : false',
]) if (!storage.includes(required)) failures.push(`missing human upload control: ${required}`);
if (/LEGACY_FALLBACK_BUCKETS = new Set<string>\(\[\s*['"]/.test(authz)) failures.push('sensitive legacy fallback buckets remain enabled');
if (!authz.includes(".insert(\n      {")) failures.push('binding creation is not immutable insert-only');
if (failures.length) { console.error(`Storage upload hardening FAILED:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('Storage upload hardening check passed.');
