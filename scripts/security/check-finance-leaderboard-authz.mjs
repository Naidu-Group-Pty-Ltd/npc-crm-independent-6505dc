import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const edgeFunction = await readFile(
  new URL('../../supabase/functions/finance-portal-pipeline/index.ts', import.meta.url),
  'utf8',
);

const leaderboardStart = edgeFunction.indexOf("if (operation === 'lender_leaderboard')");
assert.notEqual(leaderboardStart, -1, 'lender_leaderboard operation must exist');

const leaderboard = edgeFunction.slice(leaderboardStart);
assert.match(
  leaderboard,
  /purchase_files!inner\(assigned_finance_user_id\)/,
  'leaderboard submissions must include the authoritative purchase file assignment',
);
assert.match(
  leaderboard,
  /s\.purchase_files\?\.assigned_finance_user_id === portalUserId/,
  'partner metrics must be scoped to the current purchase file owner',
);
assert.doesNotMatch(
  leaderboard,
  /s\.finance_user_id === portalUserId/,
  'partner metrics must not trust denormalized submission ownership',
);

console.log('Finance portal lender leaderboard authorization checks passed.');
