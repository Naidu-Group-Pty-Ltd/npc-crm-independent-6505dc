import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('supabase/functions/solicitor-portal-intelligence/index.ts', 'utf8');
const helper = source.slice(
  source.indexOf('const loadVisibleMatters = async () =>'),
  source.indexOf('// ───────────────────── PIPELINE BOARD'),
);

assert.match(
  helper,
  /resolveClientPermissions\(supabase, me\.id, clientId\)/,
  'portfolio matter reads must resolve each assigned client permission matrix',
);
assert.match(
  helper,
  /can\(permissions, 'matters', 'view'\)/,
  'portfolio matter reads must require matters.view',
);
assert.match(
  helper,
  /\.in\('client_id', visibleClientIds\)/,
  'the matter query must be scoped to clients with matters.view',
);
assert.ok(
  helper.indexOf("can(permissions, 'matters', 'view')") < helper.indexOf(".from('legal_matters')"),
  'authorization must precede the sensitive matter query',
);

for (const operation of ['pipeline_board', 'portfolio_kpis', 'at_risk_matters']) {
  const operationBlock = source.slice(source.indexOf(`operation === '${operation}'`));
  assert.match(
    operationBlock.slice(0, 500),
    /loadVisibleMatters\(\)/,
    `${operation} must use the permission-filtered portfolio helper`,
  );
}

console.log('Solicitor intelligence portfolio matter authorization check passed.');
