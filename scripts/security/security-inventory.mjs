#!/usr/bin/env node
/** Deterministic, source-only Edge Function security inventory (WP-00). */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const functionsDir = join(root, 'supabase', 'functions');
const registryPath = join(root, 'supabase', 'functions-registry', 'SECURITY_REGISTRY.json');
const configPath = join(root, 'supabase', 'config.toml');
const inventoryPath = join(root, 'docs', 'security', 'SECURITY_INVENTORY.json');
const write = process.argv.includes('--write');

const functionNames = readdirSync(functionsDir)
  .filter((name) => name !== '_shared' && statSync(join(functionsDir, name)).isDirectory())
  .sort();
const registry = JSON.parse(readFileSync(registryPath, 'utf8')).functions;
const config = readFileSync(configPath, 'utf8');
const configVerifyJwt = {};
for (const section of config.split(/(?=^\[functions\.)/m)) {
  const match = section.match(/^\[functions\.([A-Za-z0-9_-]+)\]/);
  if (match) configVerifyJwt[match[1]] = (section.match(/^verify_jwt\s*=\s*(true|false)/m)?.[1] ?? 'true') === 'true';
}

const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const file = join(directory, entry.name);
  return entry.isDirectory() ? walk(file) : /\.(?:ts|tsx|js)$/.test(entry.name) ? [file] : [];
});
const files = walk(functionsDir).filter((file) => !file.includes('/_shared/tests/')).sort();
const sharedAuthModules = ['auth.ts', 'auth_v2.ts', 'authz.ts', 'permissions.ts', 'internalCall.ts', 'resetTokens.ts', 'notify.ts', 'reportMetering.ts', 'requestSecurity.ts'];
const sharedImports = Object.fromEntries(sharedAuthModules.map((module) => [module, []]));
const internalEdges = new Set();
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const rel = relative(functionsDir, file).replaceAll('\\', '/');
  const caller = rel.split('/')[0];
  for (const module of sharedAuthModules) {
    if (source.includes(`_shared/${module.replace('.ts', '')}`) || source.includes(`_shared/${module}`)) sharedImports[module].push(rel);
  }
  for (const match of source.matchAll(/functions\/v1\/([A-Za-z0-9_-]+)/g)) internalEdges.add(`${caller}->${match[1]}`);
}
for (const imports of Object.values(sharedImports)) imports.sort();
const exposureClassCounts = {};
for (const entry of Object.values(registry)) exposureClassCounts[entry.exposure_class] = (exposureClassCounts[entry.exposure_class] ?? 0) + 1;
const inventory = {
  schema_version: 1,
  source: 'repository-static-analysis',
  edge_function_count: functionNames.length,
  config_declared_function_count: Object.keys(configVerifyJwt).length,
  registry_function_count: Object.keys(registry).length,
  verify_jwt_false_count: Object.values(registry).filter((entry) => entry.verify_jwt === false).length,
  exposure_class_counts: Object.fromEntries(Object.entries(exposureClassCounts).sort(([a], [b]) => a.localeCompare(b))),
  needs_review_count: exposureClassCounts['needs-review'] ?? 0,
  functions_importing_shared_auth_modules: sharedImports,
  statically_derivable_inter_function_graph: [...internalEdges].sort(),
};
const output = `${JSON.stringify(inventory, null, 2)}\n`;
if (write) {
  await import('node:fs/promises').then(({ writeFile }) => writeFile(inventoryPath, output));
  console.log(`Wrote ${relative(root, inventoryPath)}.`);
} else console.log(output);
