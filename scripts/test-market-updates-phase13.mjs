import { spawnSync } from 'node:child_process';

const commands = [
  ['bun', ['test', 'tests/market-updates/phase13-core.test.ts']],
  ['node', ['scripts/validate-market-source-reconciliation.mjs']],
  ['node', ['scripts/validate-market-updates-read-contract.mjs']],
  ['node', ['scripts/validate-market-updates-llm-router.mjs']],
  ['node', ['scripts/validate-market-updates-publication-decisions.mjs']],
  ['node', ['scripts/validate-market-source-refresh-cadence.mjs']],
  ['node', ['scripts/validate-market-updates-digest.mjs']],
  ['node', ['scripts/validate-market-updates-qa.mjs']],
  ['node', ['scripts/validate-market-updates-frontend-recovery.mjs']],
  ['node', ['scripts/validate-market-updates-automation.mjs']],
  ['node', ['scripts/validate-market-updates-observability.mjs']],
  ['node', ['scripts/validate-market-updates-security-legal.mjs']],
];

for (const [command, args] of commands) {
  const label = [command, ...args].join(' ');
  console.log(`\n[phase13] ${label}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Phase 13 gate failed (${result.status}): ${label}`);
  }
}

console.log('\nMarket Updates Phase 13 test gate passed.');
