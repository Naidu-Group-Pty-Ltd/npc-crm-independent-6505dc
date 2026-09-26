/**
 * `npx tsx scripts/gnaf/verify-gnaf-shards.ts <dir>` — check a built G-NAF
 * register against itself before anything serves it (`gnafVerify.ts`).
 * Exits 1 with the reasons when it may not be served; appends its table to
 * `$GITHUB_STEP_SUMMARY` when there is one.
 */
import { appendFileSync } from 'node:fs';
import { verificationMarkdown, verificationRefusals, verifyGnafShards } from './gnafVerify.ts';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: npx tsx scripts/gnaf/verify-gnaf-shards.ts <dir holding v1/>');
  process.exit(2);
}
const result = verifyGnafShards({ dir, sampleShards: Number(process.env.GNAF_VERIFY_SHARDS ?? 400), perShard: 5 });
const refusals = verificationRefusals(result, Number(process.env.GNAF_VERIFY_MAX_NOT_FOUND ?? 0.02));
const markdown = verificationMarkdown(result, refusals);
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
process.exit(refusals.length ? 1 : 0);
