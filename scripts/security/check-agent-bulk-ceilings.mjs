#!/usr/bin/env node
// WP-05C gate: every bulk_* agent tool policy must declare maxBatchSize.
// Prevents a config-only regression that would silently disable the batch
// ceiling implemented in _shared/agentToolAuthz.ts::authorizeAgentTool.
import { readFileSync } from 'node:fs';
const src = readFileSync('supabase/functions/_shared/agentToolAuthz.ts', 'utf8');
const rowRe = /'(bulk_[a-z0-9_]+)'\s*:\s*\{([^}]*)\}/g;
const missing = [];
let m;
while ((m = rowRe.exec(src))) {
  if (!/maxBatchSize\s*:/.test(m[2])) missing.push(m[1]);
}
if (missing.length) {
  console.error(`Bulk-tool ceiling check FAILED — missing maxBatchSize on: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('Bulk-tool ceiling check passed.');
