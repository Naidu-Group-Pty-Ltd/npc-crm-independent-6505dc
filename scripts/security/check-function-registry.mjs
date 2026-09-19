#!/usr/bin/env node
/**
 * Edge Function security registry consistency check (WP-00).
 *
 * Fails on missing registry entries, duplicate config declarations, registry /
 * config verify_jwt drift, invalid exposure classes, new unreviewed functions,
 * and growth of the exact grandfathered needs-review backlog.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const functionsDir = join(root, 'supabase', 'functions');
const registryPath = process.env.SECURITY_REGISTRY_PATH || join(root, 'supabase', 'functions-registry', 'SECURITY_REGISTRY.json');
const baselinePath = join(root, 'supabase', 'functions-registry', 'needs-review-baseline.json');
const configPath = join(root, 'supabase', 'config.toml');
const exposureClasses = new Set([
  'public-auth', 'human-authenticated', 'portal-authenticated', 'internal-service',
  'webhook', 'cron-worker', 'public', 'needs-review', 'authenticated-staff',
  'module-gated', 'webhook-secret', 'authenticated-or-service',
  'webhook-clientstate', 'superadmin-only',
]);

const registryRaw = readFileSync(registryPath, 'utf8');
const registry = JSON.parse(registryRaw).functions;

// JSON.parse keeps the LAST of two identically-named keys and discards the
// first without complaint, so a duplicated function entry is invisible to
// every check below — they only ever see the survivor. That is not
// hypothetical: "aml-reliance" was declared twice, once by hand with the
// correct verify_jwt and once by a later bulk backfill with the wrong one,
// and the gate reported drift against config.toml while the file it was
// reading looked correct to a human scrolling to the first match.
//
// The raw text is rescanned here because the parsed object cannot show it.
const registryKeys = [...registryRaw.matchAll(/^ {4}"([^"]+)":\s*\{/gm)].map((m) => m[1]);
const duplicateRegistryEntries = [
  ...new Set(registryKeys.filter((k, i) => registryKeys.indexOf(k) !== i)),
];
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
if (!Array.isArray(baseline.needs_review_functions) || !Array.isArray(baseline.unreviewed_functions)) {
  throw new Error('Invalid needs-review baseline: expected needs_review_functions and unreviewed_functions arrays.');
}
const config = readFileSync(configPath, 'utf8');
const declared = new Map();
const duplicateDeclarations = [];
for (const section of config.split(/(?=^\[functions\.)/m)) {
  const header = section.match(/^\[functions\.([A-Za-z0-9_-]+)\]/);
  if (!header) continue;
  const name = header[1];
  const verifyJwt = section.match(/^verify_jwt\s*=\s*(true|false)/m);
  if (declared.has(name)) duplicateDeclarations.push(name);
  declared.set(name, verifyJwt ? verifyJwt[1] === 'true' : true);
}
const onDisk = readdirSync(functionsDir).filter((name) => name !== '_shared' && statSync(join(functionsDir, name)).isDirectory());
const errors = [];
for (const name of duplicateDeclarations) errors.push(`Function "${name}" is declared more than once in config.toml.`);
for (const name of onDisk) if (!registry[name]) errors.push(`Function "${name}" exists on disk but is not in SECURITY_REGISTRY.json.`);
for (const name of declared.keys()) if (!registry[name]) errors.push(`Function "${name}" is declared in config.toml but is not in SECURITY_REGISTRY.json.`);
for (const [name, entry] of Object.entries(registry)) {
  if (typeof entry.exposure_class !== 'string' || !exposureClasses.has(entry.exposure_class)) errors.push(`Function "${name}" has an empty or invalid exposure_class.`);
  if (typeof entry.owner !== 'string' || entry.owner.trim() === '') errors.push(`Function "${name}" has an empty owner.`);
  if (typeof entry.verify_jwt !== 'boolean') errors.push(`Function "${name}" must record verify_jwt as a boolean.`);
  if (onDisk.includes(name) && entry.verify_jwt !== (declared.get(name) ?? true)) errors.push(`verify_jwt drift for "${name}": registry says ${entry.verify_jwt}, config.toml resolves to ${declared.get(name) ?? true}.`);
}
for (const name of duplicateRegistryEntries) {
  errors.push(`Function "${name}" is declared more than once in the registry; JSON.parse silently keeps only the last.`);
}
const needsReview = Object.entries(registry).filter(([, entry]) => entry.exposure_class === 'needs-review').map(([name]) => name).sort();
const unreviewed = Object.entries(registry).filter(([, entry]) => entry.reviewed !== true).map(([name]) => name).sort();
// WP-14: baseline is now zero and strictly enforced. Any needs-review or
// unreviewed entry fails the gate — the historical grandfathering window is
// closed.
if (needsReview.length > 0) errors.push(`WP-14: needs-review must be zero. Offenders: ${needsReview.join(', ')}.`);
if (unreviewed.length > 0) errors.push(`WP-14: every registry entry must be reviewed: true. Offenders: ${unreviewed.join(', ')}.`);
console.log(`Registry: ${Object.keys(registry).length} entries; ${onDisk.length} functions on disk; ${needsReview.length} needs-review; ${unreviewed.length} unreviewed.`);
if (errors.length) {
  console.error('\nSecurity registry check FAILED:\n');
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}
console.log('Security registry check passed.');
